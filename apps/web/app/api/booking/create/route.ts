import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { resolveRole } from "@/lib/roles"
import {
  TABLES, appBase,
  getPrepMaster,
  getPrepMasterPhone,
  getActivePlanForUser,
  setPlanStatus,
  getBookedSlots,
  type BookingFields,
  type ClientFields,
} from "@/lib/airtable"
import { getAvailabilityForEmail } from "@/app/actions/availability"
import { slotsForDate } from "@/lib/availability"
import { createNotification } from "@/app/actions/notifications"
import { sendEmail, bookingConfirmationEmail, prepMasterBookingRequestEmail } from "@/lib/email"
import { sendSms } from "@/lib/sms"
import { fmtDate, fmtTime, etToUtcIso, fmtTimeForNotif, fmtEmailTime, COMPANY_TZ, makeConfirmToken } from "@/lib/utils"
import { db } from "@/lib/db"
import { user as userTable, bookingAttemptLock } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createCalendarEvent, getCalendarBusySlots } from "@/lib/google-calendar"
import { resolveClientProfile } from "@/lib/profile-core"
import type { SessionType } from "@/lib/session-types"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.collegedanceprep.com"
const CONFIRM_SECRET = process.env.BOOKING_CONFIRM_SECRET ?? ""

async function findClientRecord(userId: string, parentEmail?: string | null) {
  const safeId = userId.replace(/'/g, "\\'")
  const records = await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `{User ID} = '${safeId}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  if (records[0]) return records[0]
  // Parent view: look up child record by parent email
  if (parentEmail) {
    const safe = parentEmail.trim().toLowerCase().replace(/'/g, "\\'")
    const byParent = await appBase.list<ClientFields>(TABLES.clients, {
      filterByFormula: `LOWER({Parent Email}) = '${safe}'`,
      maxRecords: 1,
      revalidate: 0,
    })
    if (byParent[0]) return byParent[0]
  }
  return null
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const role = await resolveRole(session.user.email)
  if (role === "prep_master") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const user = session.user
  const body = await req.json() as {
    prepMasterId: string
    prepMasterName: string
    date: string
    time: string
    utcDatetime?: string
    notes?: string
    planId?: string
    planSessions?: number
    sessionType?: SessionType
  }

  const { prepMasterId, prepMasterName, date, time, utcDatetime, notes, planId, planSessions, sessionType } = body

  // Credit cost based on session type
  const CREDIT_COST: Record<string, number> = {
    "pack-hour": 1,
    "private-60": 1,
    "private-45": 0.75,
    "private-30": 0.5,
    "private-90": 1.5,
  }
  const SINGLE_CREDIT_FIELDS: Record<string, keyof ClientFields> = {
    "private-30": "Single Credits 30",
    "private-45": "Single Credits 45",
    "private-60": "Single Credits 60",
    "private-90": "Single Credits 90",
  }

  // Resolve parent → active child (respects parentActiveChild selection for multi-child families)
  const profile = await resolveClientProfile({ id: user.id, email: user.email, name: user.name ?? "" }, true)
  if (!profile.recordId) {
    console.error("[booking/create] NO_CREDITS: no recordId for user", user.id, "email", user.email)
    return NextResponse.json({ ok: false, error: "NO_CREDITS" })
  }
  const effectiveUserId = profile.effectiveUserId || user.id
  const effectiveEmail = profile.email || user.email

  // Check per-type single session credit first, then fall back to pack credits
  const SINGLE_CREDIT_KEY: Record<string, "30" | "45" | "60" | "90"> = {
    "private-30": "30", "private-45": "45", "private-60": "60", "private-90": "90",
  }
  const singleField = SINGLE_CREDIT_FIELDS[sessionType ?? ""]
  const singleCreditKey = SINGLE_CREDIT_KEY[sessionType ?? ""]
  const singleCreditsForType = (singleField && singleCreditKey) ? (profile.singleCredits[singleCreditKey] ?? 0) : 0
  const useSingleCredit = singleCreditsForType >= 1
  const creditCost = useSingleCredit ? 1 : (CREDIT_COST[sessionType ?? "private-60"] ?? 1)
  const credits = useSingleCredit ? singleCreditsForType : profile.creditsRemaining
  if (credits < creditCost) {
    console.error("[booking/create] NO_CREDITS: credits check failed for user", user.id, "sessionType", sessionType, "singleCredits", profile.singleCredits, "creditsRemaining", profile.creditsRemaining, "useSingleCredit", useSingleCredit, "credits", credits, "creditCost", creditCost)
    return NextResponse.json({ ok: false, error: "NO_CREDITS" })
  }

  // Validate slot is within availability
  const prepMaster = await getPrepMaster(prepMasterId)
  if (!prepMaster) {
    return NextResponse.json({ ok: false, error: "This PrepMaster is no longer available." })
  }
  const week = await getAvailabilityForEmail(prepMaster.email)
  const openSlots = slotsForDate(date, week)
  if (!openSlots.includes(time)) {
    return NextResponse.json({ ok: false, error: "That time is outside this PrepMaster's availability." })
  }

  // Prevent double-booking
  const booked = await getBookedSlots(prepMasterName, date)
  if (booked.includes(time)) {
    return NextResponse.json({ ok: false, error: "That time was just booked. Please choose another slot." })
  }

  // Block if PM's Google Calendar shows a conflict
  const [pmUserRow] = await db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, prepMaster.email))
  if (pmUserRow) {
    const pmTimezone = pmUserRow.timezone ?? COMPANY_TZ
    const busySlots = await getCalendarBusySlots(pmUserRow.id, date, 60, pmTimezone)
    if (busySlots.includes(time)) {
      return NextResponse.json({ ok: false, error: "That time is no longer available. Please choose another slot." })
    }
  }

  // Always compute UTC from the PM's server-side timezone so the stored value is correct
  // regardless of what timezone the client device is in. Fall back to client-supplied value
  // only when the PM has no user row yet (shouldn't happen in practice).
  const pmTimezone = pmUserRow?.timezone ?? COMPANY_TZ
  const serverUtcDatetime = pmUserRow ? (etToUtcIso(date, time, pmTimezone) ?? utcDatetime) : (utcDatetime ?? null)

  // Acquire a booking attempt lock — prevents two simultaneous requests from
  // both passing the credit check and double-deducting. The unique constraint
  // on (userId, date, time) means only one request wins; the other gets a 409.
  const lockId = crypto.randomUUID()
  try {
    await db.insert(bookingAttemptLock).values({ id: lockId, userId: effectiveUserId, date, time })
  } catch {
    return NextResponse.json({ ok: false, error: "A booking for that time is already in progress. Please try again." }, { status: 409 })
  }

  // Deduct credit before creating the booking so a booking is never created
  // without a corresponding credit deduction.
  const newCredits = Math.round((credits - creditCost) * 100) / 100
  if (useSingleCredit && singleField) {
    await appBase.update<ClientFields>(TABLES.clients, profile.recordId, {
      [singleField]: newCredits,
    } as Partial<ClientFields>)
  } else {
    await appBase.update<ClientFields>(TABLES.clients, profile.recordId, {
      "Credits Remaining": newCredits,
    })
  }

  // Create booking — rollback the credit deduction if this fails
  let record: Awaited<ReturnType<typeof appBase.create<BookingFields>>>
  try {
    record = await appBase.create<BookingFields>(TABLES.bookings, {
      "User ID": effectiveUserId,
      "Client Email": effectiveEmail,
      "Prep Master Name": prepMasterName,
      Date: date,
      Time: time,
      ...(serverUtcDatetime ? { "UTC Datetime": serverUtcDatetime } : {}),
      Status: "Pending",
      Notes: notes ?? "",
      "Session Type": sessionType ?? "private-60",
      ...(useSingleCredit ? { "Single Credit Used": true } : {}),
    })
  } catch (err) {
    // Booking creation failed — refund the credit so the member is not charged
    if (useSingleCredit && singleField) {
      await appBase.update<ClientFields>(TABLES.clients, profile.recordId, {
        [singleField]: singleCreditsForType,
      } as Partial<ClientFields>).catch(() => {})
    } else {
      await appBase.update<ClientFields>(TABLES.clients, profile.recordId, {
        "Credits Remaining": profile.creditsRemaining,
      }).catch(() => {})
    }
    await db.delete(bookingAttemptLock).where(eq(bookingAttemptLock.id, lockId)).catch(() => {})
    return NextResponse.json({ ok: false, error: "Failed to create booking. Your credit has been refunded." })
  }

  // Mark plan used if needed
  if (useSingleCredit && newCredits === 0) {
    const minLabel = sessionType?.replace("private-", "") ?? ""
    const { getPlansForUser } = await import("@/lib/airtable")
    const userPlans = await getPlansForUser(effectiveUserId)
    const matchingPlan = userPlans.find(
      (p) => p.status === "Active" && p.sessions === 1 && p.planName.toLowerCase().includes(minLabel)
    ) ?? userPlans.find((p) => p.status === "Active" && p.sessions === 1)
    if (matchingPlan) await setPlanStatus(matchingPlan.id, "Used")
  } else if (!useSingleCredit && planId && planSessions === 1) {
    await setPlanStatus(planId, "Used")
  } else if (!useSingleCredit && newCredits <= 0) {
    const planToMark = planId ? { id: planId } : await getActivePlanForUser(effectiveUserId)
    if (planToMark) await setPlanStatus(planToMark.id, "Used")
  }

  // Calendar events for PM and member are created at confirm time, not here.

  // Look up member timezone for notification body
  const [memberRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, effectiveUserId)).limit(1)
  const memberTz = memberRow?.timezone ?? null
  const utcForNotif = serverUtcDatetime ?? etToUtcIso(date, time, pmTimezone)
  const memberTimeLabel = utcForNotif ? fmtTimeForNotif(utcForNotif, pmTimezone, memberTz) : fmtTime(time)

  // In-app notification
  createNotification({
    userId: effectiveUserId,
    type: "booking_pending",
    title: "Booking requested",
    body: `Your session with ${prepMasterName} on ${fmtDate(date)} at ${memberTimeLabel} is pending confirmation.`,
    bookingId: record.id,
    pushData: { route: "/member/bookings" },
  }).catch(() => {})

  const dancerDisplayName = profile.name || user.name || "Dancer"

  // Emails — fire and forget
  const parentEmailCC = profile.parentEmail || null
  if (effectiveEmail) {
    const { subject, html } = bookingConfirmationEmail({
      dancerName: dancerDisplayName,
      prepMasterName,
      date,
      time: fmtEmailTime(time, pmTimezone, serverUtcDatetime, memberTz),
    })
    sendEmail({ to: effectiveEmail, subject, html, ...(parentEmailCC ? { cc: parentEmailCC } : {}) }).catch(() => {})
  }

  getPrepMaster(prepMasterId).then(async (pm) => {
    if (!pm?.email) return
    const approveUrl = `${APP_URL}/api/booking/confirm?id=${record.id}&action=approve&token=${makeConfirmToken(CONFIRM_SECRET, record.id, "approve")}`
    const denyUrl = `${APP_URL}/api/booking/confirm?id=${record.id}&action=deny&token=${makeConfirmToken(CONFIRM_SECRET, record.id, "deny")}`
    const { subject, html } = prepMasterBookingRequestEmail({
      prepMasterName: pm.name,
      dancerName: dancerDisplayName,
      dancerEmail: effectiveEmail ?? "",
      date,
      time: fmtEmailTime(time, pmTimezone, serverUtcDatetime, null),
      notes: notes || undefined,
      approveUrl,
      denyUrl,
    })
    sendEmail({ to: pm.email, subject, html }).catch(() => {})

    const [pmUser] = await db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pm.email))
    if (pmUser) {
      // Push with approve/deny actions
      createNotification({
        userId: pmUser.id,
        type: "booking_request",
        title: "New session request",
        body: `${dancerDisplayName} wants to book ${fmtDate(date)} at ${utcForNotif ? fmtTimeForNotif(utcForNotif, pmTimezone, pmUser?.timezone ?? null) : fmtTime(time)}.`,
        bookingId: record.id,
        pushCategory: "BOOKING_REQUEST",
        pushData: { bookingId: record.id, approveUrl, denyUrl },
      }).catch(() => {})

      // PM calendar event created at confirm time, not here.
    }
  }).catch(() => {})

  getPrepMasterPhone(prepMasterId).then((phone) => {
    if (!phone) return
    const dateLabel = new Date(`${date} ${time}`).toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
    })
    sendSms(phone, `New booking! ${dancerDisplayName} has booked a session with you on ${dateLabel} at ${time}. Log in to College Dance Prep to view details.`).catch(() => {})
  }).catch(() => {})

  // Release the booking attempt lock — booking is committed
  await db.delete(bookingAttemptLock).where(eq(bookingAttemptLock.id, lockId)).catch(() => {})

  return NextResponse.json({ ok: true, id: record.id, creditCost, newCredits })
}
