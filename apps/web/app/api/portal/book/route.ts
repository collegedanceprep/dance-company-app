import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import {
  getPrepMasterByEmail, getBookingsForPrepMaster, getBookedSlots,
  getMostRecentInactivePlanForUser, setPlanStatus,
  TABLES, appBase, type BookingFields, type ClientFields,
} from "@/lib/airtable"
import { getAvailabilityForEmail } from "@/app/actions/availability"
import { slotsForDate } from "@/lib/availability"
import { createNotification } from "@/app/actions/notifications"
import { sendEmail, portalBookedEmail } from "@/lib/email"
import { etToUtcIso, fmtEmailTime, fmtTimeForNotif, fmtDate } from "@/lib/utils"
import { db } from "@/lib/db"
import { user as userTable, calendarEventLink, bookingAttemptLock } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createCalendarEvent } from "@/lib/google-calendar"

async function requirePrepMaster() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  const { resolveRole } = await import("@/lib/roles")
  const role = await resolveRole(session.user.email)
  if (role !== "prep_master" && role !== "admin") return null
  return session.user
}

export async function GET() {
  const user = await requirePrepMaster()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const session = { user }

  const prepMaster = await getPrepMasterByEmail(session.user.email)
  if (!prepMaster) return NextResponse.json({ error: "NO_RECORD" }, { status: 404 })

  const bookings = await getBookingsForPrepMaster(prepMaster.name)
  const seen = new Set<string>()
  const clients: { userId: string; name: string; email: string }[] = []
  for (const b of bookings) {
    const key = b.dancerEmail || b.userId
    if (!key || seen.has(key)) continue
    seen.add(key)
    clients.push({ userId: b.userId, name: b.dancerName || b.dancerEmail, email: b.dancerEmail })
  }

  return NextResponse.json({ clients: clients.sort((a, b) => a.name.localeCompare(b.name)) })
}


export async function POST(req: Request) {
  const user = await requirePrepMaster()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const session = { user }

  const { dancerEmail, date, time, notes, sessionType } = await req.json() as {
    dancerEmail: string; date: string; time: string; notes?: string; sessionType?: string
  }

  const prepMaster = await getPrepMasterByEmail(session.user.email)
  if (!prepMaster) return NextResponse.json({ ok: false, error: "No PrepMaster record found." }, { status: 404 })

  // Verify dancer email belongs to a real member account in the DB (prevents spoofed emails)
  const [dancerDbRow] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, dancerEmail.toLowerCase())).limit(1)
  if (!dancerDbRow) return NextResponse.json({ ok: false, error: "Member not found." }, { status: 404 })

  const history = await getBookingsForPrepMaster(prepMaster.name)
  const knownEmails = new Set(history.map((b) => b.dancerEmail.toLowerCase()))
  if (!knownEmails.has(dancerEmail.toLowerCase())) {
    return NextResponse.json({ ok: false, error: "You can only book sessions for members you have previously worked with." }, { status: 403 })
  }

  const week = await getAvailabilityForEmail(prepMaster.email)
  const openSlots = slotsForDate(date, week)
  if (!openSlots.includes(time)) {
    return NextResponse.json({ ok: false, error: "That time is outside your availability for that day." }, { status: 422 })
  }

  const booked = await getBookedSlots(prepMaster.name, date)
  if (booked.includes(time)) {
    return NextResponse.json({ ok: false, error: "That time slot is already booked." }, { status: 409 })
  }

  const [[dancer], [pmRow]] = await Promise.all([
    db.select({ id: userTable.id, name: userTable.name, timezone: userTable.timezone })
      .from(userTable).where(eq(userTable.email, dancerEmail.toLowerCase())).limit(1),
    db.select({ id: userTable.id, timezone: userTable.timezone })
      .from(userTable).where(eq(userTable.email, session.user.email.toLowerCase())).limit(1),
  ])
  const pmTimezone = pmRow?.timezone ?? "America/New_York"

  // Credit deduction for PM-scheduled sessions — checks the type-specific
  // single-session credit first, then falls back to pack credits, matching
  // /api/booking/create (the member-initiated booking route). Without this,
  // a member with a single-session credit but no pack credits would get
  // wrongly blocked with NO_CREDITS when their PM books for them.
  const CREDIT_COST: Record<string, number> = { "pack-hour": 1, "private-30": 0.5, "private-45": 0.75, "private-60": 1, "private-90": 1.5 }
  const SINGLE_CREDIT_FIELDS: Record<string, keyof ClientFields> = {
    "private-30": "Single Credits 30",
    "private-45": "Single Credits 45",
    "private-60": "Single Credits 60",
    "private-90": "Single Credits 90",
  }
  const creditCost = CREDIT_COST[sessionType ?? "private-60"] ?? 1
  let dancerDisplayName: string = dancer?.name ?? dancerEmail
  let useSingleCredit = false
  let clientRecordId: string | null = null
  let creditFieldUsed: keyof ClientFields = "Credits Remaining"
  let creditValueBeforeDeduction = 0

  if (!dancer?.id) {
    return NextResponse.json({ ok: false, error: "Member not found." }, { status: 404 })
  }

  // Serialize concurrent booking attempts for this member+slot so two rapid
  // requests can't both pass the credit check and double-deduct.
  const lockId = crypto.randomUUID()
  try {
    await db.insert(bookingAttemptLock).values({ id: lockId, userId: dancer.id, date, time })
  } catch {
    return NextResponse.json({ ok: false, error: "A booking for that time is already in progress. Please try again." }, { status: 409 })
  }

  const safeId = dancer.id.replace(/'/g, "\\'")
  const clientRecords = await appBase.list<ClientFields>(
    TABLES.clients, { filterByFormula: `{User ID} = '${safeId}'`, maxRecords: 1, revalidate: 0 }
  )
  const clientRecord = clientRecords[0]
  if (!clientRecord) {
    await db.delete(bookingAttemptLock).where(eq(bookingAttemptLock.id, lockId)).catch(() => {})
    return NextResponse.json({ ok: false, error: "NO_CREDITS" }, { status: 422 })
  }

  if (clientRecord.fields.Name) dancerDisplayName = clientRecord.fields.Name
  const singleField = SINGLE_CREDIT_FIELDS[sessionType ?? ""]
  const singleCreditsForType = singleField ? ((clientRecord.fields[singleField] as number | undefined) ?? 0) : 0
  useSingleCredit = singleCreditsForType >= 1
  const effectiveCreditCost = useSingleCredit ? 1 : creditCost
  const availableCredits = useSingleCredit ? singleCreditsForType : ((clientRecord.fields["Credits Remaining"] ?? 0) as number)

  if (availableCredits < effectiveCreditCost) {
    await db.delete(bookingAttemptLock).where(eq(bookingAttemptLock.id, lockId)).catch(() => {})
    return NextResponse.json({ ok: false, error: "NO_CREDITS" }, { status: 422 })
  }

  clientRecordId = clientRecord.id
  creditValueBeforeDeduction = availableCredits
  if (useSingleCredit && singleField) {
    creditFieldUsed = singleField
    const newVal = Math.round((availableCredits - 1) * 100) / 100
    await appBase.update<ClientFields>(TABLES.clients, clientRecord.id, { [singleField]: newVal } as Partial<ClientFields>)
  } else {
    const newCredits = Math.round((availableCredits - creditCost) * 100) / 100
    await appBase.update(TABLES.clients, clientRecord.id, {
      "Credits Remaining": newCredits,
    })
    if (newCredits <= 0) {
      const planToMark = await getMostRecentInactivePlanForUser(dancer.id).catch(() => null)
      // If they still have an Active plan, mark it Used; otherwise mark the most recent active-status plan
      const safeIdPlan = dancer.id.replace(/'/g, "\\'")
      const activePlanRecs = await appBase.list(TABLES.plans, {
        filterByFormula: `AND({User ID} = '${safeIdPlan}', {Status} = 'Active')`,
        maxRecords: 1,
        revalidate: 0,
      })
      const activePlan = activePlanRecs[0]
      if (activePlan) await setPlanStatus(activePlan.id, "Used").catch(() => {})
      else if (planToMark) await setPlanStatus(planToMark.id, "Used").catch(() => {})
    }
  }

  const utcDatetime = etToUtcIso(date, time, pmTimezone)
  let newRecord: Awaited<ReturnType<typeof appBase.create<BookingFields>>>
  try {
    newRecord = await appBase.create<BookingFields>(TABLES.bookings, {
      "Client Email": dancerEmail,
      "User ID": dancer.id,
      "Prep Master Name": prepMaster.name,
      Date: date,
      Time: time,
      ...(utcDatetime ? { "UTC Datetime": utcDatetime } : {}),
      Status: "Confirmed",
      Notes: notes ?? "",
      "Session Type": sessionType ?? "private-60",
      ...(useSingleCredit ? { "Single Credit Used": true } : {}),
    })
  } catch (err) {
    // Booking creation failed — refund the credit so the member isn't charged
    if (clientRecordId) {
      await appBase.update<ClientFields>(TABLES.clients, clientRecordId, {
        [creditFieldUsed]: creditValueBeforeDeduction,
      } as Partial<ClientFields>).catch(() => {})
    }
    await db.delete(bookingAttemptLock).where(eq(bookingAttemptLock.id, lockId)).catch(() => {})
    return NextResponse.json({ ok: false, error: "Failed to create booking. The credit has been refunded." })
  }

  await db.delete(bookingAttemptLock).where(eq(bookingAttemptLock.id, lockId)).catch(() => {})

  if (dancer?.id) {
    createNotification({
      userId: dancer.id,
      type: "booking_confirmed",
      title: "Session booked",
      body: `${prepMaster.name} has booked a session with you on ${date} at ${time}.`,
      pushData: { route: "/member/bookings" },
    }).catch(() => {})
  }

  // Email member about the PM-scheduled session
  {
    const safeId = (dancer?.id ?? "").replace(/'/g, "\\'")
    const memberRecs = dancer?.id
      ? await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeId}'`, maxRecords: 1 })
      : []
    const memberName = memberRecs[0]?.fields?.Name ?? dancerDisplayName
    const parentCC = memberRecs[0]?.fields?.["Parent Email"] ?? undefined
    const dancerTz = dancer?.timezone ?? null
    const { subject, html } = portalBookedEmail({
      dancerName: memberName,
      prepMasterName: prepMaster.name,
      date,
      time: fmtEmailTime(time, pmTimezone, utcDatetime, dancerTz),
      sessionType: sessionType ?? undefined,
    })
    sendEmail({ to: dancerEmail, cc: parentCC, subject, html }).catch(() => {})

    // SMS to dancer
    const dancerPhone = memberRecs[0]?.fields?.Phone ?? null
    if (dancerPhone) {
      const { sendSms } = await import("@/lib/sms")
      const dateLabel = new Date(`${date} ${time}`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      sendSms(dancerPhone, `${prepMaster.name} has booked a session with you on ${dateLabel} at ${fmtEmailTime(time, pmTimezone, utcDatetime, null)}. Log in to College Dance Prep to view details.`).catch(() => {})
    }
  }

  // PM self-confirmation notification
  if (pmRow?.id) {
    const pmTimeLabel = utcDatetime ? fmtTimeForNotif(utcDatetime, pmTimezone, null) : time
    createNotification({
      userId: pmRow.id,
      type: "booking_confirmed",
      title: "Session booked",
      body: `You booked a session with ${dancerDisplayName} on ${fmtDate(date)} at ${pmTimeLabel}.`,
      pushData: { route: "/portal" },
    }).catch(() => {})
  }

  // Create Google Calendar events for both PM and dancer (booking is auto-confirmed)
  const bookingId = newRecord.id
  ;(async () => {
    const pmUserId = pmRow?.id
    const eventArgs = {
      dancerName: dancerDisplayName,
      prepMasterName: prepMaster.name,
      date,
      time,
      notes,
      sessionType,
      timezone: pmTimezone,
    }
    const [pmEventId, dancerEventId] = await Promise.all([
      pmUserId ? createCalendarEvent(pmUserId, eventArgs) : Promise.resolve(null),
      dancer?.id ? createCalendarEvent(dancer.id, { ...eventArgs, timezone: pmTimezone }) : Promise.resolve(null),
    ])
    const links = []
    if (pmUserId && pmEventId) links.push({ id: crypto.randomUUID(), bookingId, userId: pmUserId, gcalEventId: pmEventId })
    if (dancer?.id && dancerEventId) links.push({ id: crypto.randomUUID(), bookingId, userId: dancer.id, gcalEventId: dancerEventId })
    if (links.length > 0) {
      await db.insert(calendarEventLink).values(links)
        .onConflictDoNothing()
        .catch(() => {})
    }
  })().catch(() => {})

  return NextResponse.json({ ok: true })
}
