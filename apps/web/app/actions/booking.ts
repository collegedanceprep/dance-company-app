"use server"

import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { revalidatePath, revalidateTag } from "next/cache"
import {
  TABLES,
  appBase,
  getPrepMaster,
  getPrepMasterPhone,
  getPrepMasters,
  getBookedSlots,
  getActivePlanForUser,
  getMostRecentInactivePlanForUser,
  setPlanStatus,
  type BookingFields,
  type ClientFields,
} from "@/lib/airtable"
import { sendSms } from "@/lib/sms"
import { createNotification } from "@/app/actions/notifications"
import { createCalendarEvent, getCalendarBusySlots } from "@/lib/google-calendar"
import { db } from "@/lib/db"
import { user as userTable, bookingAttemptLock } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { getAvailabilityForEmail } from "@/app/actions/availability"
import { resolveClientProfile } from "@/lib/profile-core"
import { slotsForDate } from "@/lib/availability"
import { isWithin24Hours, fmtDate, fmtTime, etToUtcIso, fmtTimeForNotif, fmtEmailTime, COMPANY_TZ, makeConfirmToken } from "@/lib/utils"
import { sendEmail, bookingConfirmationEmail, bookingCancelledEmail, prepMasterBookingRequestEmail, bookingUpdatedEmail } from "@/lib/email"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.collegedanceprep.com"
const CONFIRM_SECRET = process.env.BOOKING_CONFIRM_SECRET ?? ""

async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user
}

export type Booking = {
  id: string
  prepMasterName: string
  date: string
  time: string
  utcDatetime: string | null
  status: string
  notes: string
  prepMasterNotes: string
  sessionType: string | null
}

export async function getMyBookings(): Promise<Booking[]> {
  const user = await getSessionUser()
  const profile = await resolveClientProfile({ id: user.id, email: user.email, name: user.name ?? "" }, true)
  return getBookingsForUserId(profile.effectiveUserId || user.id)
}

export async function getBookingsForUserId(userId: string): Promise<Booking[]> {
  const safeId = userId.replace(/'/g, "\\'")
  const records = await appBase.list<BookingFields>(TABLES.bookings, {
    filterByFormula: `{User ID} = '${safeId}'`,
    sort: [{ field: "Date", direction: "desc" }],
    revalidate: 0,
  })
  return records.map((r) => ({
    id: r.id,
    prepMasterName: r.fields["Prep Master Name"] ?? "",
    date: r.fields.Date ?? "",
    time: r.fields.Time ?? "",
    utcDatetime: r.fields["UTC Datetime"] ?? null,
    status: r.fields.Status ?? "Pending",
    notes: r.fields.Notes ?? "",
    prepMasterNotes: r.fields["Prep Master Notes"] ?? "",
    sessionType: (r.fields["Session Type"] as string) ?? null,
  }))
}

// Finds the dancer's Member record (or null) by their auth user id.
async function findClientRecord(userId: string) {
  const safeId = userId.replace(/'/g, "\\'")
  const records = await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `{User ID} = '${safeId}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  return records[0] ?? null
}

// Fallback for children who have no User ID set — look up directly by Airtable record ID.
async function findClientByRecordId(recordId: string) {
  if (!recordId) return null
  const records = await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `RECORD_ID() = '${recordId}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  return records[0] ?? null
}

export async function cancelBooking(
  bookingId: string,
  cancellationReason?: string,
): Promise<{ ok: true; creditRefunded: boolean } | { ok: false; error: string }> {
  try {
    const user = await getSessionUser()
    const profile = await resolveClientProfile({ id: user.id, email: user.email, name: user.name ?? "" }, true)
    const effectiveUserId = profile.effectiveUserId || user.id
    const effectiveEmail = profile.email || user.email

    const safeId = effectiveUserId.replace(/'/g, "\\'")
    const records = await appBase.list<BookingFields>(TABLES.bookings, {
      filterByFormula: `AND({User ID} = '${safeId}', RECORD_ID() = '${bookingId}')`,
      maxRecords: 1,
      revalidate: 0,
    })
    if (!records[0]) return { ok: false, error: "Booking not found." }

    const booking = records[0]
    const cancelStatus = (booking.fields.Status ?? "").toLowerCase()
    if (cancelStatus.startsWith("cancelled") || cancelStatus === "declined") {
      return { ok: false, error: "This booking has already been cancelled." }
    }

    const pmNameForTz = booking.fields["Prep Master Name"] ?? ""
    const pmForCancel = (await getPrepMasters()).find((p) => p.name === pmNameForTz)
    const pmCancelTz = pmForCancel?.email
      ? await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pmForCancel.email)).limit(1)
          .then((rows) => rows[0]?.timezone ?? COMPANY_TZ)
      : COMPANY_TZ
    const within24 = isWithin24Hours(booking.fields.Date ?? "", booking.fields.Time ?? "", pmCancelTz)

    await appBase.update<BookingFields>(TABLES.bookings, bookingId, {
      Status: within24 ? "Cancelled (Late)" : "Cancelled",
      ...(cancellationReason ? { "Cancellation Reason": cancellationReason } : {}),
      ...(within24 ? { "Payable to PrepMaster": true } : {}),
    })

    // Refund credit only when cancelled outside the 24-hour window
    if (!within24) {
      const client = effectiveUserId
        ? await findClientRecord(effectiveUserId)
        : await findClientByRecordId(profile.recordId)
      if (client) {
        const SESSION_CREDIT_COST: Record<string, number> = { "pack-hour": 1, "private-60": 1, "private-45": 0.75, "private-30": 0.5, "private-90": 1.5 }
        const REFUND_SINGLE_FIELD: Record<string, keyof ClientFields> = {
          "private-30": "Single Credits 30", "private-45": "Single Credits 45",
          "private-60": "Single Credits 60", "private-90": "Single Credits 90",
        }
        const sessionType = booking.fields["Session Type"] ?? "private-60"
        const refundSingleField = REFUND_SINGLE_FIELD[sessionType]
        const packNow = client.fields["Credits Remaining"] ?? 0
        // Refund to the type-matched single credit field; fall back to pack credits
        if (refundSingleField) {
          const singleNow = (client.fields[refundSingleField] as number | undefined) ?? 0
          await appBase.update<ClientFields>(TABLES.clients, client.id, { [refundSingleField]: singleNow + 1 } as Partial<ClientFields>)
        } else {
          const creditRefund = SESSION_CREDIT_COST[sessionType] ?? 1
          await appBase.update<ClientFields>(TABLES.clients, client.id, {
            "Credits Remaining": Math.round((packNow + creditRefund) * 100) / 100,
          })
        }

        // If pack credits were at 0, reactivate the most recently expired plan
        if (packNow === 0) {
          const inactivePlan = await getMostRecentInactivePlanForUser(effectiveUserId)
          if (inactivePlan) await setPlanStatus(inactivePlan.id, "Active")
        }
      }
    }

    const dateLabel = fmtDate(booking.fields.Date ?? "") || "your session"
    const pmName = booking.fields["Prep Master Name"] ?? "your PrepMaster"
    const cancelledTime = booking.fields.Time ?? ""
    const clientRecord = effectiveUserId
      ? await findClientRecord(effectiveUserId)
      : await findClientByRecordId(profile.recordId)
    const memberName = clientRecord?.fields.Name ?? user.name ?? user.email ?? "A member"

    // Notify the member (child's account)
    createNotification({
      userId: effectiveUserId,
      type: "booking_cancelled",
      title: "Booking cancelled",
      body: `Your session with ${pmName} on ${dateLabel} has been cancelled.${!within24 ? "" : " No credit was refunded (within 24 hours)."}`,
      bookingId,
      pushData: { route: "/member/bookings" },
    }).catch(() => {})

    const cancelParentCC = clientRecord?.fields?.["Parent Email"]
      ?? (profile.isParentView && user.email !== effectiveEmail ? user.email : undefined)

    const utcCancelIso = booking.fields["UTC Datetime"] ?? etToUtcIso(booking.fields.Date ?? "", cancelledTime, pmCancelTz)

    // Email dancer (primary) + CC parent
    if (effectiveEmail) {
      const { subject, html } = bookingCancelledEmail({
        dancerName: memberName,
        prepMasterName: pmName,
        date: booking.fields.Date ?? dateLabel,
        time: fmtEmailTime(cancelledTime, pmCancelTz, utcCancelIso, null),
        creditRefunded: !within24,
      })
      sendEmail({ to: effectiveEmail, cc: cancelParentCC ?? undefined, subject, html }).catch((e) => console.error("Cancel email to dancer failed:", e))
    }

    // Notify the PrepMaster separately
    getPrepMasters().then(async (all) => {
      const pm = all.find((p) => p.name === pmName)
      if (!pm?.email) return
      const [pmUser] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, pm.email))
      if (pmUser) {
        createNotification({
          userId: pmUser.id,
          type: "booking_cancelled",
          title: "Session cancelled",
          body: `${memberName} cancelled their session on ${dateLabel}${within24 ? " (within 24 hours — payable)" : ""}.`,
          bookingId,
          pushData: { route: "/portal" },
        }).catch(() => {})
      }
      const { subject, html } = bookingCancelledEmail({
        dancerName: memberName,
        prepMasterName: pm.name,
        date: booking.fields.Date ?? dateLabel,
        time: fmtEmailTime(cancelledTime, pmCancelTz, utcCancelIso, null),
        creditRefunded: false,
      })
      sendEmail({ to: pm.email, subject, html }).catch(() => {})
    }).catch(() => {})

    revalidatePath("/dashboard")
    revalidateTag(`member-${effectiveUserId}`)
    return { ok: true, creditRefunded: !within24 }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to cancel." }
  }
}

export async function rescheduleBooking(
  bookingId: string,
  newDate: string,
  newTime: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await getSessionUser()
    const profile = await resolveClientProfile({ id: user.id, email: user.email, name: user.name ?? "" }, true)
    const effectiveUserId = profile.effectiveUserId || user.id
    const effectiveEmail = profile.email || user.email

    const safeId = effectiveUserId.replace(/'/g, "\\'")
    const records = await appBase.list<BookingFields>(TABLES.bookings, {
      filterByFormula: `AND({User ID} = '${safeId}', RECORD_ID() = '${bookingId}')`,
      maxRecords: 1,
      revalidate: 0,
    })
    const existing = records[0]
    if (!existing) return { ok: false, error: "Booking not found." }

    const prepMasterName = existing.fields["Prep Master Name"] ?? ""
    const pmReschEntry = (await getPrepMasters()).find((p) => p.name === prepMasterName)
    const [pmReschTzRowEarly] = pmReschEntry?.email
      ? await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pmReschEntry.email)).limit(1)
      : [undefined]
    const pmReschTzEarly = pmReschTzRowEarly?.timezone ?? COMPANY_TZ

    if (isWithin24Hours(existing.fields.Date ?? "", existing.fields.Time ?? "", pmReschTzEarly)) {
      return { ok: false, error: "Bookings within 24 hours cannot be rescheduled." }
    }

    const booked = await getBookedSlots(prepMasterName, newDate)
    if (booked.includes(newTime)) {
      return { ok: false, error: "That time slot is already taken." }
    }

    // Look up the PrepMaster's timezone for correct UTC conversion
    const pmReschByName = (await getPrepMasters()).find((p) => p.name === prepMasterName)
    const [pmReschTzRow] = pmReschByName?.email
      ? await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pmReschByName.email)).limit(1)
      : [undefined]
    const pmReschTz = pmReschTzRow?.timezone ?? COMPANY_TZ

    // Compute UTC now so we can store it and use it for notifications
    const utcForReschedule = etToUtcIso(newDate, newTime, pmReschTz)

    await appBase.update<BookingFields>(TABLES.bookings, bookingId, {
      Date: newDate,
      Time: newTime,
      Status: "Pending",
      "Is Reschedule": true,
      // Preserve originals so PM can revert if they decline the reschedule
      "Original Date": existing.fields.Date ?? "",
      "Original Time": existing.fields.Time ?? "",
      "Original UTC Datetime": existing.fields["UTC Datetime"] ?? "",
      // Keep UTC Datetime in sync — mobile app uses this field for display
      ...(utcForReschedule ? { "UTC Datetime": utcForReschedule } : {}),
    })
    const [memberReschRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, effectiveUserId)).limit(1)
    const memberReschTz = memberReschRow?.timezone ?? null
    const memberReschLabel = utcForReschedule ? fmtTimeForNotif(utcForReschedule, pmReschTz, memberReschTz) : fmtTime(newTime)
    createNotification({
      userId: effectiveUserId,
      type: "booking_updated",
      title: "Reschedule requested",
      body: `Your reschedule request for ${fmtDate(newDate)} at ${memberReschLabel} is awaiting approval from ${prepMasterName}.`,
      bookingId,
      pushData: { route: "/member/bookings" },
    }).catch(() => {})

    // Email both parties about the reschedule — fire and forget
    // Use effectiveUserId so parent bookings show the dancer's name, not the parent's
    const clientRecord = effectiveUserId
      ? await findClientRecord(effectiveUserId)
      : await findClientByRecordId(profile.recordId)
    const memberName = clientRecord?.fields.Name ?? user.name ?? user.email ?? "Your member"
    const existingNotes = existing.fields.Notes || undefined
    const rescheduleParentCC = clientRecord?.fields?.["Parent Email"]
      ?? (profile.isParentView && user.email && user.email !== effectiveEmail ? user.email : undefined)

    // Email dancer (primary) + CC parent
    if (effectiveEmail) {
      const { subject, html } = bookingUpdatedEmail({
        recipientName: memberName,
        updatedByName: memberName,
        updatedByRole: "member",
        date: newDate,
        time: fmtEmailTime(newTime, pmReschTz, utcForReschedule, memberReschTz),
        notes: existingNotes,
      })
      sendEmail({ to: effectiveEmail, cc: rescheduleParentCC ?? undefined, subject, html }).catch((e) => console.error("Reschedule email to dancer failed:", e))
    }

    // Find PrepMaster's email + userId to notify them (email + in-app)
    getPrepMasters().then(async (all) => {
      const pm = all.find((p) => p.name === prepMasterName)
      if (!pm?.email) return

      // In-app notification → PrepMaster (needs their approval)
      const [pmUser] = await db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pm.email))
      if (pmUser) {
        const pmReschLabel = utcForReschedule ? fmtTimeForNotif(utcForReschedule, pmReschTz, pmUser.timezone ?? null) : fmtTime(newTime)
        const approveUrl = `${APP_URL}/api/booking/confirm?id=${bookingId}&action=approve&token=${makeConfirmToken(CONFIRM_SECRET, bookingId, "approve")}`
        const denyUrl = `${APP_URL}/api/booking/confirm?id=${bookingId}&action=deny&token=${makeConfirmToken(CONFIRM_SECRET, bookingId, "deny")}`
        createNotification({
          userId: pmUser.id,
          type: "booking_updated",
          title: "Reschedule request",
          body: `${memberName} wants to reschedule to ${fmtDate(newDate)} at ${pmReschLabel}. Please approve or decline.`,
          bookingId,
          pushData: { route: "/portal" },
          pushCategory: "BOOKING_REQUEST",
          approveUrl,
          denyUrl,
        }).catch(() => {})
      }

      // Email → PrepMaster separately
      const { subject, html } = bookingUpdatedEmail({
        recipientName: pm.name,
        updatedByName: memberName,
        updatedByRole: "member",
        date: newDate,
        time: fmtEmailTime(newTime, pmReschTz, utcForReschedule, null),
        notes: existingNotes,
      })
      sendEmail({ to: pm.email, subject, html }).catch((e) => console.error("Reschedule email to PM failed:", e))
    }).catch(() => {})

    revalidatePath("/dashboard")
    revalidateTag(`member-${effectiveUserId}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to reschedule." }
  }
}

export async function createBooking(input: {
  prepMasterId: string
  prepMasterName: string
  date: string
  time: string
  notes?: string
  planId?: string
  planSessions?: number
  sessionType?: import("@/lib/session-types").SessionType
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const user = await getSessionUser()

    // Resolve effective profile — parent accounts proxy to the child's record
    const profile = await resolveClientProfile({ id: user.id, email: user.email, name: user.name ?? "" }, true)
    const effectiveUserId = profile.effectiveUserId || user.id
    const effectiveEmail = profile.email || user.email

    // 1) Credit gate — block when the dancer doesn't have enough credits for this session type.
    // Use record ID fallback for children who have no auth User ID set in Airtable.
    const client = effectiveUserId
      ? await findClientRecord(effectiveUserId)
      : await findClientByRecordId(profile.recordId)
    const packCredits = client?.fields["Credits Remaining"] ?? 0
    const SINGLE_CREDIT_FIELDS: Record<string, keyof ClientFields> = {
      "private-30": "Single Credits 30",
      "private-45": "Single Credits 45",
      "private-60": "Single Credits 60",
      "private-90": "Single Credits 90",
    }
    const singleField = SINGLE_CREDIT_FIELDS[input.sessionType ?? ""]
    const singleCreditsForType = singleField ? (client?.fields[singleField] as number | undefined ?? 0) : 0
    const BOOKING_CREDIT_COST: Record<string, number> = {
      "pack-hour": 1, "private-60": 1, "private-45": 0.75, "private-30": 0.5, "private-90": 1.5,
    }
    // Use a type-matched single session credit if available, otherwise fall back to pack credits
    const useSingleCredit = singleCreditsForType >= 1
    const creditCost = useSingleCredit ? 1 : (BOOKING_CREDIT_COST[input.sessionType ?? "pack-hour"] ?? 1)
    const credits = useSingleCredit ? singleCreditsForType : packCredits
    if (!client || credits < creditCost) {
      return {
        ok: false,
        error: "NO_CREDITS",
      }
    }

    // 2) Validate the slot is within the PrepMaster's availability …
    const prepMaster = await getPrepMaster(input.prepMasterId)
    if (!prepMaster) {
      return { ok: false, error: "This PrepMaster is no longer available." }
    }
    const [pmTzRow] = await db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, prepMaster.email)).limit(1)
    const pmTz = pmTzRow?.timezone ?? COMPANY_TZ
    const week = await getAvailabilityForEmail(prepMaster.email)
    const openSlots = slotsForDate(input.date, week)
    if (!openSlots.includes(input.time)) {
      return {
        ok: false,
        error: "That time is outside this PrepMaster's availability.",
      }
    }

    // 3) … and not already taken (prevent double-booking).
    const booked = await getBookedSlots(input.prepMasterName, input.date)
    if (booked.includes(input.time)) {
      return {
        ok: false,
        error: "That time was just booked. Please choose another slot.",
      }
    }

    // 4) Block if PM's Google Calendar shows a conflict (matches the REST create route check).
    if (pmTzRow) {
      const busySlots = await getCalendarBusySlots(pmTzRow.id, input.date, 60, pmTz).catch(() => [] as string[])
      if (busySlots.includes(input.time)) {
        return { ok: false, error: "That time is no longer available. Please choose another slot." }
      }
    }

    // 4) Acquire a booking attempt lock to prevent double-deduction from concurrent requests.
    const lockId = crypto.randomUUID()
    try {
      await db.insert(bookingAttemptLock).values({ id: lockId, userId: effectiveUserId, date: input.date, time: input.time })
    } catch {
      return { ok: false, error: "A booking for that time is already in progress. Please try again." }
    }

    // Deduct credit before creating the booking record; rollback on failure.
    const utcForCreate = etToUtcIso(input.date, input.time, pmTz)
    const newCredits = Math.round((credits - creditCost) * 100) / 100
    await appBase.update<ClientFields>(TABLES.clients, client.id, useSingleCredit && singleField
      ? { [singleField]: newCredits } as Partial<ClientFields>
      : { "Credits Remaining": newCredits }
    )

    let record: Awaited<ReturnType<typeof appBase.create<BookingFields>>>
    try {
      record = await appBase.create<BookingFields>(TABLES.bookings, {
        "User ID": effectiveUserId,
        "Client Email": effectiveEmail,
        "Prep Master Name": input.prepMasterName,
        Date: input.date,
        Time: input.time,
        Status: "Pending",
        Notes: input.notes ?? "",
        "Session Type": input.sessionType ?? "pack-hour",
        ...(utcForCreate ? { "UTC Datetime": utcForCreate } : {}),
      })
    } catch (err) {
      await appBase.update<ClientFields>(TABLES.clients, client.id, { "Credits Remaining": credits }).catch(() => {})
      await db.delete(bookingAttemptLock).where(eq(bookingAttemptLock.id, lockId)).catch(() => {})
      return { ok: false, error: "Failed to create booking. Your credit has been refunded." }
    }

    // Mark the used plan as Used:
    // - Single-session plans (sessions=1): mark immediately
    // - Pack plans: mark when credits hit 0
    if (input.planId && input.planSessions === 1) {
      await setPlanStatus(input.planId, "Used")
    } else if (newCredits === 0) {
      const planToMark = input.planId ? { id: input.planId } : await getActivePlanForUser(effectiveUserId)
      if (planToMark) await setPlanStatus(planToMark.id, "Used")
    }

    // In-app notification for the dancer (use effectiveUserId so it goes to the child, not the parent)
    const [memberCreateRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, effectiveUserId)).limit(1)
    const memberCreateLabel = utcForCreate ? fmtTimeForNotif(utcForCreate, pmTz, memberCreateRow?.timezone ?? null) : fmtTime(input.time)
    createNotification({
      userId: effectiveUserId,
      type: "booking_pending",
      title: "Booking requested",
      body: `Your session with ${input.prepMasterName} on ${fmtDate(input.date)} at ${memberCreateLabel} is pending confirmation.`,
      bookingId: record.id,
      pushData: { route: "/member/bookings" },
    }).catch(() => {})

    const dancerDisplayName = client.fields.Name ?? user.name ?? "Dancer"

    // Send booking confirmation email to the dancer; CC parent if one exists
    if (effectiveEmail) {
      const createParentCC = client.fields?.["Parent Email"]
        ?? (profile.isParentView && user.email && user.email !== effectiveEmail ? user.email : undefined)
      const { subject, html } = bookingConfirmationEmail({
        dancerName: dancerDisplayName,
        prepMasterName: input.prepMasterName,
        date: input.date,
        time: fmtEmailTime(input.time, pmTz, utcForCreate ?? undefined, memberCreateRow?.timezone ?? null),
      })
      sendEmail({ to: effectiveEmail, cc: createParentCC ?? undefined, subject, html }).catch((e) => console.error("Confirmation email failed:", e))
    }

    // Email + push notification to PrepMaster with approve/deny — fire and forget
    getPrepMaster(input.prepMasterId).then(async (pm) => {
      if (!pm?.email) return
      const approveUrl = `${APP_URL}/api/booking/confirm?id=${record.id}&action=approve&token=${makeConfirmToken(CONFIRM_SECRET, record.id, "approve")}`
      const denyUrl = `${APP_URL}/api/booking/confirm?id=${record.id}&action=deny&token=${makeConfirmToken(CONFIRM_SECRET, record.id, "deny")}`
      const { subject, html } = prepMasterBookingRequestEmail({
        prepMasterName: pm.name,
        dancerName: dancerDisplayName,
        dancerEmail: effectiveEmail ?? "",
        date: input.date,
        time: input.time,
        notes: input.notes || undefined,
        approveUrl,
        denyUrl,
      })
      sendEmail({ to: pm.email, subject, html }).catch((e) => console.error("PM request email failed:", e))

      // Push notification with approve/deny actions
      const [pmUser] = await db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pm.email))
      if (pmUser) {
        const pmCreateLabel = utcForCreate ? fmtTimeForNotif(utcForCreate, pmTz, pmUser.timezone ?? null) : fmtTime(input.time)
        createNotification({
          userId: pmUser.id,
          type: "booking_request",
          title: "New session request",
          body: `${dancerDisplayName} wants to book ${fmtDate(input.date)} at ${pmCreateLabel}.`,
          bookingId: record.id,
          pushCategory: "BOOKING_REQUEST",
          pushData: {
            bookingId: record.id,
            approveUrl,
            denyUrl,
            route: "/portal",
          },
        }).catch(() => {})
      }
    }).catch(() => {})

    // PM and member calendar events are created at confirm time, not at booking request time.

    // Notify PrepMaster by SMS — fire and forget so a Twilio error never blocks the booking
    getPrepMasterPhone(input.prepMasterId).then((phone) => {
      if (!phone) return
      const dateLabel = new Date(`${input.date} ${input.time}`).toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric",
      })
      sendSms(
        phone,
        `New booking! ${dancerDisplayName} has booked a session with you on ${dateLabel} at ${input.time}. Log in to College Dance Prep to view details.`,
      ).catch((e) => console.error("SMS failed:", e))
    })

    revalidatePath("/dashboard")
    revalidateTag(`member-${effectiveUserId}`)
    await db.delete(bookingAttemptLock).where(eq(bookingAttemptLock.id, lockId)).catch(() => {})
    return { ok: true, id: record.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create booking"
    return { ok: false, error: message }
  }
}
