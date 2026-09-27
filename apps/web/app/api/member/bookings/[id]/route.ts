import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { revalidateTag } from "next/cache"
import { auth } from "@/lib/auth"
import { TABLES, appBase, type BookingFields, type ClientFields, getBookedSlots, getMostRecentInactivePlanForUser, setPlanStatus, refundBookingCredit } from "@/lib/airtable"
import { getAvailabilityForEmail } from "@/app/actions/availability"
import { slotsForDate } from "@/lib/availability"
import { createNotification } from "@/app/actions/notifications"
import { sendEmail, bookingCancelledEmail, bookingUpdatedEmail } from "@/lib/email"
import { isWithin24Hours, fmtDate, fmtTime, etToUtcIso, fmtTimeForNotif, fmtEmailTime, COMPANY_TZ } from "@/lib/utils"
import { getPrepMasters } from "@/lib/airtable"
import { db } from "@/lib/db"
import { user as userTable, calendarEventLink } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { resolveClientProfile } from "@/lib/profile-core"
import { deleteCalendarEvent } from "@/lib/google-calendar"

async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  const { resolveRole } = await import("@/lib/roles")
  if ((await resolveRole(session.user.email)) === "prep_master") return null
  return session.user
}

async function findClientRecord(userId: string) {
  const safeId = userId.replace(/'/g, "\\'")
  const records = await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `{User ID} = '${safeId}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  return records[0] ?? null
}

async function findClientByRecordId(recordId: string) {
  if (!recordId) return null
  const records = await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `RECORD_ID() = '${recordId}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  return records[0] ?? null
}

const SESSION_CREDIT_COST: Record<string, number> = {
  "pack-hour": 1, "private-60": 1, "private-45": 0.75, "private-30": 0.5, "private-90": 1.5,
}

// DELETE — cancel booking
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Resolve parent → child so parent cancels show on the dancer's record
  const profile = await resolveClientProfile({ id: user.id, email: user.email, name: user.name ?? "" }, true)
  const effectiveUserId = profile.effectiveUserId || user.id

  const { id } = await params
  const body = await req.json().catch(() => ({})) as { reason?: string }

  const safeEffectiveId = effectiveUserId.replace(/'/g, "\\'")
  const records = await appBase.list<BookingFields>(TABLES.bookings, {
    filterByFormula: `AND({User ID} = '${safeEffectiveId}', RECORD_ID() = '${id}')`,
    maxRecords: 1,
    revalidate: 0,
  })
  const booking = records[0]
  if (!booking) return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 })

  const currentStatus = (booking.fields.Status ?? "").toLowerCase()
  if (currentStatus.startsWith("cancelled") || currentStatus === "declined") {
    return NextResponse.json({ ok: false, error: "This booking has already been cancelled." }, { status: 409 })
  }
  if (!body.reason?.trim()) {
    return NextResponse.json({ ok: false, error: "A cancellation reason is required." }, { status: 400 })
  }

  const pmNameDel = booking.fields["Prep Master Name"] ?? ""
  const pmForDel = (await getPrepMasters()).find((p) => p.name === pmNameDel)
  const pmDelTz = pmForDel?.email
    ? await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pmForDel.email)).limit(1)
        .then((rows) => rows[0]?.timezone ?? COMPANY_TZ)
    : COMPANY_TZ
  const within24 = isWithin24Hours(booking.fields.Date ?? "", booking.fields.Time ?? "", pmDelTz)
  const sessionType = booking.fields["Session Type"] as string | undefined
  const creditCost = SESSION_CREDIT_COST[sessionType ?? "pack-hour"] ?? 1

  await appBase.update<BookingFields>(TABLES.bookings, id, {
    Status: within24 ? "Cancelled (Late)" : "Cancelled",
    "Cancellation Reason": body.reason,
    ...(within24 ? { "Payable to PrepMaster": true } : {}),
  })

  if (!within24) {
    const client = effectiveUserId
      ? await findClientRecord(effectiveUserId)
      : await findClientByRecordId(profile.recordId)
    if (client) {
      const usedSingleCredit = booking.fields["Single Credit Used"] === true
      await refundBookingCredit(client.id, client.fields, sessionType ?? "pack-hour", usedSingleCredit)
      if (!usedSingleCredit && (client.fields["Credits Remaining"] ?? 0) === 0 && effectiveUserId) {
        const inactivePlan = await getMostRecentInactivePlanForUser(effectiveUserId)
        if (inactivePlan) await setPlanStatus(inactivePlan.id, "Active").catch(() => {})
      }
    }
  }

  const pmName = booking.fields["Prep Master Name"] ?? "your PrepMaster"
  const dateLabel = booking.fields.Date ?? "your session"
  const cancelledTime = booking.fields.Time ?? ""
  const client = effectiveUserId
    ? await findClientRecord(effectiveUserId)
    : await findClientByRecordId(profile.recordId)
  const memberName = client?.fields.Name ?? user.name ?? user.email ?? "A member"

  // Notify the dancer (not the parent)
  createNotification({
    userId: effectiveUserId,
    type: "booking_cancelled",
    title: "Booking cancelled",
    body: `Your session with ${pmName} on ${dateLabel} has been cancelled.${within24 ? " No credit refunded (within 24 hours)." : ""}`,
    bookingId: id,
    pushData: { route: "/member/bookings" },
  }).catch(() => {})

  {
    const effectiveEmail = profile.email || user.email
    const parentCC = profile.isParentView && user.email && user.email !== effectiveEmail ? user.email : (client?.fields?.["Parent Email"] ?? null)
    const utcCancelMember = booking.fields["UTC Datetime"] ?? etToUtcIso(booking.fields.Date ?? "", cancelledTime, pmDelTz)
    const { subject, html } = bookingCancelledEmail({
      dancerName: memberName,
      prepMasterName: pmName,
      date: booking.fields.Date ?? dateLabel,
      time: fmtEmailTime(cancelledTime, pmDelTz, utcCancelMember, null),
      creditRefunded: !within24,
    })
    sendEmail({ to: effectiveEmail, cc: (parentCC && parentCC !== effectiveEmail ? parentCC : undefined) ?? undefined, subject, html }).catch(() => {})
  }

  // Notify the PrepMaster
  getPrepMasters().then(async (all) => {
    const pm = all.find((p) => p.name === pmName)
    if (!pm?.email) return
    const [pmUser] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, pm.email))
    if (pmUser) {
      createNotification({
        userId: pmUser.id,
        type: "booking_cancelled",
        title: "Session cancelled",
        body: `${memberName} cancelled their session on ${fmtDate(dateLabel)}${within24 ? " (within 24 hours — payable)" : ""}.`,
        bookingId: id,
        pushData: { route: "/portal" },
      }).catch(() => {})
    }
    const utcCancelPm = booking.fields["UTC Datetime"] ?? etToUtcIso(booking.fields.Date ?? "", cancelledTime, pmDelTz)
    const { subject, html } = bookingCancelledEmail({
      dancerName: memberName,
      prepMasterName: pm.name,
      date: booking.fields.Date ?? dateLabel,
      time: fmtEmailTime(cancelledTime, pmDelTz, utcCancelPm, null),
      creditRefunded: false,
    })
    sendEmail({ to: pm.email, subject, html }).catch(() => {})
  }).catch(() => {})

  // Delete calendar events for all linked users (fire-and-forget)
  db.select({ userId: calendarEventLink.userId, gcalEventId: calendarEventLink.gcalEventId })
    .from(calendarEventLink).where(eq(calendarEventLink.bookingId, id))
    .then((links) => { for (const { userId, gcalEventId } of links) deleteCalendarEvent(userId, gcalEventId).catch(() => {}) })
    .catch(() => {})

  revalidateTag(`member-${effectiveUserId}`)
  return NextResponse.json({ ok: true, creditRefunded: !within24 })
}

// PATCH — reschedule booking
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Resolve parent → child
  const profile = await resolveClientProfile({ id: user.id, email: user.email, name: user.name ?? "" }, true)
  const effectiveUserId = profile.effectiveUserId || user.id

  const { id } = await params
  const safeEffectiveId = effectiveUserId.replace(/'/g, "\\'")
  const records = await appBase.list<BookingFields>(TABLES.bookings, {
    filterByFormula: `AND({User ID} = '${safeEffectiveId}', RECORD_ID() = '${id}')`,
    maxRecords: 1,
    revalidate: 0,
  })
  const booking = records[0]
  if (!booking) return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 })

  const rescheduleStatus = (booking.fields.Status ?? "").toLowerCase()
  if (rescheduleStatus.startsWith("cancelled") || rescheduleStatus === "declined") {
    return NextResponse.json({ ok: false, error: "This booking cannot be rescheduled." }, { status: 409 })
  }

  // Look up PrepMaster timezone before 24hr check so the window is anchored to the PM's clock
  const pmName = booking.fields["Prep Master Name"] ?? ""
  const [pmEntry] = await getPrepMasters().then((all) => all.filter((p) => p.name === pmName))
  const pmTz = pmEntry?.email
    ? await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pmEntry.email)).limit(1)
        .then((rows) => rows[0]?.timezone ?? COMPANY_TZ)
    : COMPANY_TZ

  if (isWithin24Hours(booking.fields.Date ?? "", booking.fields.Time ?? "", pmTz)) {
    return NextResponse.json({ ok: false, error: "Bookings within 24 hours cannot be rescheduled." }, { status: 422 })
  }

  const body = await req.json() as { date?: string; time?: string; notes?: string }
  const update: Partial<BookingFields> = {
    Status: "Pending",
    "Is Reschedule": true,
    // Preserve original so PM can restore it if they deny the reschedule
    "Original Date": booking.fields.Date ?? "",
    "Original Time": booking.fields.Time ?? "",
    "Original UTC Datetime": booking.fields["UTC Datetime"] ?? "",
  }
  if (body.date) update.Date = body.date
  if (body.time) update.Time = body.time
  if (body.notes !== undefined) update.Notes = body.notes

  if (body.date || body.time) {
    const utc = etToUtcIso(
      body.date ?? booking.fields.Date ?? "",
      body.time ?? booking.fields.Time ?? "",
      pmTz,
    )
    if (utc) update["UTC Datetime"] = utc
  }
  // Validate the new slot (mirrors create route checks)
  if (body.date && body.time) {
    const keepingSameSlot = booking.fields.Date === body.date && booking.fields.Time === body.time
    if (!keepingSameSlot) {
      // Double-booking check
      const takenSlots = await getBookedSlots(pmName, body.date)
      if (takenSlots.includes(body.time)) {
        return NextResponse.json({ ok: false, error: "That time was just booked. Please choose another slot." }, { status: 409 })
      }
      // Availability check — slot must be within PM's configured hours
      if (pmEntry?.email) {
        const week = await getAvailabilityForEmail(pmEntry.email)
        const openSlots = slotsForDate(body.date, week)
        if (!openSlots.includes(body.time)) {
          return NextResponse.json({ ok: false, error: "That time is outside this PrepMaster's availability." }, { status: 422 })
        }
      }
    }
  }

  await appBase.update<BookingFields>(TABLES.bookings, id, update)

  const newDate = body.date ?? booking.fields.Date ?? ""
  const newTime = body.time ?? booking.fields.Time ?? ""
  const [client, memberDbRow] = await Promise.all([
    effectiveUserId ? findClientRecord(effectiveUserId) : findClientByRecordId(profile.recordId),
    db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, effectiveUserId)).limit(1),
  ])
  const memberName = client?.fields.Name ?? user.name ?? user.email ?? "Your member"
  const memberTz = memberDbRow[0]?.timezone ?? null
  const utcForNotif = update["UTC Datetime"] ?? null

  // Member notification — show time in their own timezone
  const memberTimeLabel = utcForNotif
    ? fmtTimeForNotif(utcForNotif, pmTz, memberTz)
    : `${fmtTime(newTime)} ET`
  createNotification({
    userId: effectiveUserId,
    type: "booking_updated",
    title: "Reschedule requested",
    body: `Your reschedule request for ${fmtDate(newDate)} at ${memberTimeLabel} is awaiting approval from ${pmName}.`,
    bookingId: id,
  }).catch(() => {})

  {
    const effectiveEmail = profile.email || user.email
    const parentCC = profile.isParentView && user.email && user.email !== effectiveEmail ? user.email : (client?.fields?.["Parent Email"] ?? null)
    const { subject, html } = bookingUpdatedEmail({
      recipientName: memberName,
      updatedByName: memberName,
      updatedByRole: "member",
      date: newDate,
      time: fmtEmailTime(newTime, pmTz, update["UTC Datetime"] ?? null, memberTz),
      notes: body.notes,
    })
    sendEmail({ to: effectiveEmail, cc: (parentCC && parentCC !== effectiveEmail ? parentCC : undefined) ?? undefined, subject, html }).catch(() => {})
  }

  // Notify PrepMaster
  getPrepMasters().then(async (all) => {
    const pm = all.find((p) => p.name === pmName)
    if (!pm?.email) return
    const [pmUser] = await db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pm.email))
    if (pmUser) {
      const pmTimeLabel = utcForNotif
        ? fmtTimeForNotif(utcForNotif, pmTz, pmUser.timezone ?? null)
        : `${fmtTime(newTime)} ET`
      createNotification({
        userId: pmUser.id,
        type: "booking_updated",
        title: "Reschedule request",
        body: `${memberName} wants to reschedule to ${fmtDate(newDate)} at ${pmTimeLabel}. Please approve or decline.`,
        bookingId: id,
        pushData: { route: "/portal" },
      }).catch(() => {})
    }
    const { subject, html } = bookingUpdatedEmail({
      recipientName: pm.name,
      updatedByName: memberName,
      updatedByRole: "member",
      date: newDate,
      time: fmtEmailTime(newTime, pmTz, update["UTC Datetime"] ?? null, null),
      notes: body.notes,
    })
    sendEmail({ to: pm.email, subject, html }).catch(() => {})
    // Bust PM's portal cache so the reschedule card appears immediately
    revalidateTag(`portal-${pm.email}`)
  }).catch(() => {})

  revalidateTag(`member-${effectiveUserId}`)
  return NextResponse.json({ ok: true })
}
