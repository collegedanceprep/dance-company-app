"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { getSessionUserWithRole } from "@/lib/roles"
import { TABLES, appBase, getPrepMasterByEmail, getBookedSlots, getMostRecentInactivePlanForUser, setPlanStatus, type BookingFields, type ClientFields } from "@/lib/airtable"
import { getRecipientTimezone } from "@/lib/profile-core"
import { sendEmail, bookingUpdatedEmail, bookingCancelledEmail, bookingConfirmedByPmEmail, bookingDeclinedByPmEmail } from "@/lib/email"
import { createNotification } from "@/app/actions/notifications"
import { fmtDate, fmtTime, etToUtcIso, fmtTimeForNotif, fmtEmailTime, COMPANY_TZ } from "@/lib/utils"
import { db } from "@/lib/db"
import { user as userTable, calendarEventLink } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "@/lib/google-calendar"
import { getAvailabilityForEmail } from "@/app/actions/availability"
import { slotsForDate } from "@/lib/availability"

async function assertPrepMaster() {
  const user = await getSessionUserWithRole()
  if (!user || (user.role !== "prep_master" && user.role !== "admin")) throw new Error("Unauthorized")
  return user
}

async function getUserIdByEmail(email: string): Promise<string | null> {
  const [row] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email))
  return row?.id ?? null
}

/**
 * Returns available (unbooked) time slots for the authenticated PM on a given date.
 * Pass `excludeBookingId` to allow the current booking's slot to remain selectable.
 */
export async function getAvailableSlotsForDate(
  date: string,
  excludeBookingId?: string,
): Promise<string[]> {
  try {
    const user = await assertPrepMaster()
    const pm = await getPrepMasterByEmail(user.email)
    if (!pm) return []

    const week = await getAvailabilityForEmail(pm.email)
    const allSlots = slotsForDate(date, week)
    if (allSlots.length === 0) return []

    const bookedSlots = await getBookedSlots(pm.name, date)

    // Exclude already-booked slots, but keep the current booking's slot available
    let excludedTime: string | undefined
    if (excludeBookingId) {
      const safeId = excludeBookingId.replace(/'/g, "\\'")
      const records = await appBase.list<BookingFields>(TABLES.bookings, {
        filterByFormula: `RECORD_ID() = '${safeId}'`,
        maxRecords: 1,
      })
      excludedTime = records[0]?.fields.Time ?? undefined
    }

    return allSlots.filter((slot) => !bookedSlots.includes(slot) || slot === excludedTime)
  } catch {
    return []
  }
}

export async function confirmBooking(
  bookingId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertPrepMaster()
    const pm = await getPrepMasterByEmail(user.email)
    if (!pm) return { ok: false, error: "Staff record not found." }

    const records = await appBase.list<BookingFields>(TABLES.bookings, {
      filterByFormula: `AND({Prep Master Name} = '${pm.name.replace(/'/g, "\\'")}', RECORD_ID() = '${bookingId}')`,
      maxRecords: 1,
    })
    if (!records[0]) return { ok: false, error: "Booking not found." }

    await appBase.update<BookingFields>(TABLES.bookings, bookingId, { Status: "Confirmed" })

    // Notify member in-app
    const dancerUserId = records[0].fields["User ID"]
    const confirmDate = records[0].fields.Date ?? ""
    const confirmTime = records[0].fields.Time ?? ""
    if (dancerUserId) {
      const recipientTz = await getRecipientTimezone(dancerUserId)
      const utcConfirm = etToUtcIso(confirmDate, confirmTime, COMPANY_TZ)
      const confirmLabel = utcConfirm ? fmtTimeForNotif(utcConfirm, COMPANY_TZ, recipientTz) : `${fmtTime(confirmTime)} ET`
      createNotification({
        userId: dancerUserId,
        type: "booking_confirmed",
        title: "Booking confirmed",
        body: `${pm.name} has confirmed your session on ${fmtDate(confirmDate)} at ${confirmLabel}.`,
        bookingId,
        pushData: { route: "/member/bookings" },
      }).catch(() => {})
    }

    // Email dancer (+ parent CC)
    const confirmDancerEmail = records[0].fields["Client Email"]
    if (confirmDancerEmail) {
      const safeConfirmId = (dancerUserId ?? "").replace(/'/g, "\\'")
      const confirmMemberRecs = dancerUserId
        ? await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeConfirmId}'`, maxRecords: 1 })
        : []
      const confirmDancerName = confirmMemberRecs[0]?.fields.Name ?? confirmDancerEmail
      const confirmParentCC = confirmMemberRecs[0]?.fields?.["Parent Email"] ?? undefined
      const [pmTzConfirmRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id)).limit(1)
      const pmTzConfirm = pmTzConfirmRow?.timezone ?? COMPANY_TZ
      const utcConfirmEmail = etToUtcIso(confirmDate, confirmTime, pmTzConfirm)
      const { subject, html } = bookingConfirmedByPmEmail({
        dancerName: confirmDancerName,
        prepMasterName: pm.name,
        date: confirmDate,
        time: fmtEmailTime(confirmTime, pmTzConfirm, utcConfirmEmail, null),
      })
      sendEmail({ to: confirmDancerEmail, cc: confirmParentCC, subject, html }).catch(() => {})
    }

    // Create Google Calendar events for PM and dancer — fire and forget
    ;(async () => {
      const [pmUserRow] = await db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id)).limit(1)
      const pmTzCal = pmUserRow?.timezone ?? COMPANY_TZ
      let calDancerName = confirmDancerEmail ?? "Member"
      let dancerUserRow: { id: string } | undefined
      if (dancerUserId) {
        const safeId = dancerUserId.replace(/'/g, "\\'")
        const [clientRec, dRow] = await Promise.all([
          appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeId}'`, maxRecords: 1, revalidate: 0 }),
          db.select({ id: userTable.id }).from(userTable).where(eq(userTable.id, dancerUserId)).limit(1),
        ])
        if (clientRec[0]?.fields.Name) calDancerName = clientRec[0].fields.Name
        dancerUserRow = dRow[0]
      }
      const eventArgs = { dancerName: calDancerName, prepMasterName: pm.name, date: confirmDate, time: confirmTime, sessionType: records[0].fields["Session Type"] as string | undefined, timezone: pmTzCal }
      const [pmEventId, dancerEventId] = await Promise.all([
        pmUserRow ? createCalendarEvent(pmUserRow.id, eventArgs) : Promise.resolve(null),
        dancerUserRow ? createCalendarEvent(dancerUserRow.id, { ...eventArgs }) : Promise.resolve(null),
      ])
      const links = []
      if (pmUserRow && pmEventId) links.push({ id: crypto.randomUUID(), bookingId, userId: pmUserRow.id, gcalEventId: pmEventId })
      if (dancerUserRow && dancerEventId) links.push({ id: crypto.randomUUID(), bookingId, userId: dancerUserRow.id, gcalEventId: dancerEventId })
      if (links.length > 0) {
        await db.insert(calendarEventLink).values(links).onConflictDoNothing().catch(() => {})
      }
    })().catch(() => {})

    revalidatePath("/portal")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to confirm." }
  }
}

export async function adjustBooking(
  bookingId: string,
  fields: { date?: string; time?: string; notes?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertPrepMaster()
    const pm = await getPrepMasterByEmail(user.email)
    if (!pm) return { ok: false, error: "Staff record not found." }

    const records = await appBase.list<BookingFields>(TABLES.bookings, {
      filterByFormula: `AND({Prep Master Name} = '${pm.name.replace(/'/g, "\\'")}', RECORD_ID() = '${bookingId}')`,
      maxRecords: 1,
    })
    if (!records[0]) return { ok: false, error: "Booking not found." }

    const update: Partial<BookingFields> = {}
    if (fields.date) update.Date = fields.date
    if (fields.time) update.Time = fields.time
    if (fields.notes !== undefined) update.Notes = fields.notes

    await appBase.update<BookingFields>(TABLES.bookings, bookingId, update)

    const newDate = fields.date ?? records[0].fields.Date ?? ""
    const newTime = fields.time ?? records[0].fields.Time ?? ""
    const newNotes = fields.notes !== undefined ? fields.notes : (records[0].fields.Notes || undefined)
    const dancerEmail = records[0].fields["Client Email"]
    const dancerUserId = records[0].fields["User ID"]

    // Look up the dancer's proper name and parent email from their Member record
    let dancerName: string = dancerEmail ?? "Your member"
    let adjustParentCC: string | undefined
    if (dancerUserId) {
      const safeId = dancerUserId.replace(/'/g, "\\'")
      const memberRecords = await appBase.list<ClientFields>(TABLES.clients, {
        filterByFormula: `{User ID} = '${safeId}'`,
        maxRecords: 1,
      })
      if (memberRecords[0]?.fields.Name) dancerName = memberRecords[0].fields.Name
      adjustParentCC = memberRecords[0]?.fields?.["Parent Email"] ?? undefined
    }

    // Look up PM's timezone for accurate UTC conversion and time display
    const [pmAdjustTzRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id)).limit(1)
    const pmAdjustTz = pmAdjustTzRow?.timezone ?? COMPANY_TZ

    // In-app notification → member
    const utcAdjust = etToUtcIso(newDate, newTime, pmAdjustTz)
    if (dancerUserId) {
      const recipientTz = await getRecipientTimezone(dancerUserId)
      const memberAdjustLabel = utcAdjust ? fmtTimeForNotif(utcAdjust, pmAdjustTz, recipientTz) : fmtTime(newTime)
      createNotification({
        userId: dancerUserId,
        type: "booking_updated",
        title: "Session rescheduled",
        body: `${pm.name} has rescheduled your session to ${fmtDate(newDate)} at ${memberAdjustLabel}.`,
        bookingId,
        pushData: { route: "/member/bookings" },
      }).catch(() => {})
    }

    // In-app notification → PrepMaster (themselves, as a confirmation)
    const pmAdjustLabel = utcAdjust ? fmtTimeForNotif(utcAdjust, pmAdjustTz, pmAdjustTz) : fmtTime(newTime)
    createNotification({
      userId: user.id,
      type: "booking_updated",
      title: "Session updated",
      body: `You rescheduled the session to ${fmtDate(newDate)} at ${pmAdjustLabel}.`,
      bookingId,
      pushData: { route: "/portal" },
    }).catch(() => {})

    // Email both parties — fire and forget
    if (dancerEmail) {
      const { subject, html } = bookingUpdatedEmail({
        recipientName: dancerName,
        updatedByName: pm.name,
        updatedByRole: "PrepMaster",
        date: newDate,
        time: newTime,
        notes: newNotes,
      })
      sendEmail({ to: dancerEmail, cc: adjustParentCC, subject, html }).catch((e) => console.error("Update email to dancer failed:", e))
    }
    const { subject, html } = bookingUpdatedEmail({
      recipientName: pm.name,
      updatedByName: pm.name,
      updatedByRole: "PrepMaster",
      date: newDate,
      time: newTime,
      notes: newNotes,
    })
    sendEmail({ to: user.email, subject, html }).catch((e) => console.error("Update email to PM failed:", e))

    // Update Google Calendar events for all linked users — fire and forget
    if (fields.date || fields.time || fields.notes !== undefined) {
      ;(async () => {
        const links = await db
          .select({ userId: calendarEventLink.userId, gcalEventId: calendarEventLink.gcalEventId })
          .from(calendarEventLink)
          .where(eq(calendarEventLink.bookingId, bookingId))
        const sessionType = records[0].fields["Session Type"] as string | undefined
        const [pmTzRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id)).limit(1)
        const pmTz = pmTzRow?.timezone ?? COMPANY_TZ
        const eventArgs = {
          dancerName,
          prepMasterName: pm.name,
          date: newDate,
          time: newTime,
          notes: newNotes,
          sessionType,
          timezone: pmAdjustTz,
        }
        await Promise.all(links.map(({ userId, gcalEventId }) => updateCalendarEvent(userId, gcalEventId, eventArgs).catch(() => {})))
      })().catch(() => {})
    }

    // No revalidatePath here — the component updates optimistically in place,
    // so triggering a server re-render would cause the card to jump positions
    // in the sorted list, making it appear as a new card.
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to adjust." }
  }
}

export async function declineBooking(
  bookingId: string,
  reason: string,
  rescheduleAction?: "revert" | "cancel",
): Promise<{ ok: true; rescheduleReverted?: boolean } | { ok: false; error: string }> {
  try {
    const user = await assertPrepMaster()
    const pm = await getPrepMasterByEmail(user.email)
    if (!pm) return { ok: false, error: "Staff record not found." }

    const records = await appBase.list<BookingFields>(TABLES.bookings, {
      filterByFormula: `AND({Prep Master Name} = '${pm.name.replace(/'/g, "\\'")}', RECORD_ID() = '${bookingId}')`,
      maxRecords: 1,
    })
    if (!records[0]) return { ok: false, error: "Booking not found." }

    const booking = records[0]
    const currentDeclineStatus = (booking.fields.Status ?? "").toLowerCase()
    if (currentDeclineStatus.startsWith("cancelled") || currentDeclineStatus === "declined") {
      return { ok: false, error: "This booking has already been cancelled." }
    }
    const isReschedule = !!(booking.fields["Is Reschedule"])
    const dancerUserId = booking.fields["User ID"]

    if (rescheduleAction === "revert") {
      // PM explicitly chose to keep the original booking (reschedule denied)
      const origDate = booking.fields["Original Date"] || booking.fields.Date || ""
      const origTime = booking.fields["Original Time"] || booking.fields.Time || ""
      const origUtc = booking.fields["Original UTC Datetime"] || booking.fields["UTC Datetime"] || ""
      await appBase.update<BookingFields>(TABLES.bookings, bookingId, {
        Status: "Confirmed",
        "Is Reschedule": false,
        Date: origDate,
        Time: origTime,
        ...(origUtc ? { "UTC Datetime": origUtc } : {}),
        "Original Date": "",
        "Original Time": "",
        "Original UTC Datetime": "",
        "Decline Reason": reason,
      })
      if (dancerUserId) {
        const [pmRevertTzRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id)).limit(1)
        const pmRevertTz = pmRevertTzRow?.timezone ?? COMPANY_TZ
        const recipientTz = await getRecipientTimezone(dancerUserId)
        const utcForNotif = origUtc || etToUtcIso(origDate, origTime, pmRevertTz)
        const timeLabel = utcForNotif ? fmtTimeForNotif(utcForNotif, pmRevertTz, recipientTz) : fmtTime(origTime)
        createNotification({
          userId: dancerUserId,
          type: "booking_updated",
          title: "Reschedule request denied",
          body: `${pm.name} couldn't accommodate the reschedule. Your session remains on ${fmtDate(origDate)} at ${timeLabel}.`,
          bookingId,
          pushData: { route: "/member/bookings" },
        }).catch(() => {})

        // Email dancer that reschedule was denied and original time kept
        const revertDancerEmail = booking.fields["Client Email"]
        if (revertDancerEmail) {
          const safeId = dancerUserId.replace(/'/g, "\\'")
          const memberRecs = await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeId}'`, maxRecords: 1 })
          const revertDancerName = memberRecs[0]?.fields.Name ?? revertDancerEmail
          const revertParentCC = memberRecs[0]?.fields?.["Parent Email"] ?? undefined
          const { subject, html } = bookingDeclinedByPmEmail({
            dancerName: revertDancerName,
            prepMasterName: pm.name,
            date: origDate,
            time: timeLabel,
            customNote: `${pm.name} was unable to accommodate your reschedule request. Your session has been kept at the original time.`,
          })
          sendEmail({ to: revertDancerEmail, cc: revertParentCC, subject, html }).catch(() => {})
        }
      }
      revalidatePath("/portal")
      return { ok: true, rescheduleReverted: true }
    }

    // Full booking decline (no prior reschedule) — refund credit
    await appBase.update<BookingFields>(TABLES.bookings, bookingId, {
      Status: "Declined",
      "Is Reschedule": false,
      "Decline Reason": reason,
    })

    const SESSION_CREDIT_COST: Record<string, number> = { "pack-hour": 1, "private-60": 1, "private-45": 0.75, "private-30": 0.5, "private-90": 1.5 }
    if (dancerUserId) {
      const safeId = dancerUserId.replace(/'/g, "\\'")
      const clientRecords = await appBase.list<ClientFields>(TABLES.clients, {
        filterByFormula: `{User ID} = '${safeId}'`,
        maxRecords: 1,
        revalidate: 0,
      })
      const client = clientRecords[0]
      if (client) {
        const sessionType = booking.fields["Session Type"] ?? "private-60"
        const creditRefund = SESSION_CREDIT_COST[sessionType] ?? 1
        const current = client.fields["Credits Remaining"] ?? 0
        await appBase.update<ClientFields>(TABLES.clients, client.id, {
          "Credits Remaining": Math.round((current + creditRefund) * 100) / 100,
        })
        // Reactivate the most-recently-used plan if credits were at zero
        if (current === 0) {
          const inactivePlan = await getMostRecentInactivePlanForUser(dancerUserId)
          if (inactivePlan) await setPlanStatus(inactivePlan.id, "Active")
        }
      }
      revalidatePath(`/dashboard`)
    }

    // Notify member in-app
    const declineDate = booking.fields.Date ?? ""
    const declineTime = booking.fields.Time ?? ""
    const dateLabel = fmtDate(declineDate)
    const [pmTzDeclineRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id)).limit(1)
    const pmTzDecline = pmTzDeclineRow?.timezone ?? COMPANY_TZ
    const utcDecline = booking.fields["UTC Datetime"] ?? etToUtcIso(declineDate, declineTime, pmTzDecline)
    if (dancerUserId) {
      const recipientTz = await getRecipientTimezone(dancerUserId)
      const timeLabel = utcDecline ? fmtTimeForNotif(utcDecline, pmTzDecline, recipientTz) : `${fmtTime(declineTime)} ET`
      createNotification({
        userId: dancerUserId,
        type: "booking_cancelled",
        title: "Booking declined",
        body: `${pm.name} has declined your session on ${dateLabel} at ${timeLabel}. Your credit has been refunded.`,
        bookingId,
        pushData: { route: "/member/bookings" },
      }).catch(() => {})

      // Email dancer (+ parent CC) — BUG-18 fix
      const declineDancerEmail = booking.fields["Client Email"]
      if (declineDancerEmail) {
        const safeDeclineId = dancerUserId.replace(/'/g, "\\'")
        const declineMemberRecs = await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeDeclineId}'`, maxRecords: 1 })
        const declineDancerName = declineMemberRecs[0]?.fields.Name ?? declineDancerEmail
        const declineParentCC = declineMemberRecs[0]?.fields?.["Parent Email"] ?? undefined
        const declineRecipientTz = await getRecipientTimezone(dancerUserId)
        const { subject, html } = bookingDeclinedByPmEmail({
          dancerName: declineDancerName,
          prepMasterName: pm.name,
          date: declineDate,
          time: fmtEmailTime(declineTime, pmTzDecline, utcDecline, declineRecipientTz),
        })
        sendEmail({ to: declineDancerEmail, cc: declineParentCC, subject, html }).catch(() => {})
      }
    }

    revalidatePath("/portal")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to decline." }
  }
}

export async function cancelBookingAsPrepMaster(
  bookingId: string,
  reason: string,
): Promise<{ ok: true; creditRefunded: boolean } | { ok: false; error: string }> {
  try {
    const user = await assertPrepMaster()
    const pm = await getPrepMasterByEmail(user.email)
    if (!pm) return { ok: false, error: "Staff record not found." }

    const records = await appBase.list<BookingFields>(TABLES.bookings, {
      filterByFormula: `AND({Prep Master Name} = '${pm.name.replace(/'/g, "\\'")}', RECORD_ID() = '${bookingId}')`,
      maxRecords: 1,
    })
    if (!records[0]) return { ok: false, error: "Booking not found." }

    const booking = records[0].fields
    const currentCancelStatus = (booking.Status ?? "").toLowerCase()
    if (currentCancelStatus.startsWith("cancelled") || currentCancelStatus === "declined") {
      return { ok: false, error: "This booking has already been cancelled." }
    }
    const dateStr = booking.Date ?? ""
    const timeStr = booking.Time ?? ""
    const dancerUserId = booking["User ID"]
    const dancerEmail = booking["Client Email"]

    await appBase.update<BookingFields>(TABLES.bookings, bookingId, {
      Status: "Cancelled",
      "Cancellation Reason": reason,
    })

    const dateLabel = fmtDate(dateStr)
    const utcCancel = etToUtcIso(dateStr, timeStr, COMPANY_TZ)

    // PM cancellation always refunds the member's credit
    if (dancerUserId) {
      const safeId = dancerUserId.replace(/'/g, "\\'")
      const clientRecords = await appBase.list<ClientFields>(TABLES.clients, {
        filterByFormula: `{User ID} = '${safeId}'`,
        maxRecords: 1,
        revalidate: 0,
      })
      const client = clientRecords[0]
      if (client) {
        const SESSION_CREDIT_COST: Record<string, number> = { "pack-hour": 1, "private-60": 1, "private-45": 0.75, "private-30": 0.5, "private-90": 1.5 }
        const sessionType = (booking["Session Type"] as string) ?? "private-60"
        const creditRefund = SESSION_CREDIT_COST[sessionType] ?? 1
        const current = client.fields["Credits Remaining"] ?? 0
        await appBase.update<ClientFields>(TABLES.clients, client.id, {
          "Credits Remaining": Math.round((current + creditRefund) * 100) / 100,
        })
        if (current === 0) {
          const inactivePlan = await getMostRecentInactivePlanForUser(dancerUserId)
          if (inactivePlan) await setPlanStatus(inactivePlan.id, "Active").catch(() => {})
        }
      }
      revalidateTag(`member-${dancerUserId}`)
    }

    // Notify member
    if (dancerUserId) {
      const recipientTz = await getRecipientTimezone(dancerUserId)
      const memberCancelLabel = utcCancel ? fmtTimeForNotif(utcCancel, COMPANY_TZ, recipientTz) : `${fmtTime(timeStr)} ET`
      createNotification({
        userId: dancerUserId,
        type: "booking_cancelled",
        title: "Session cancelled by PrepMaster",
        body: `${pm.name} cancelled your session on ${dateLabel} at ${memberCancelLabel}. Your credit has been refunded.`,
        bookingId,
        pushData: { route: "/member/bookings" },
      }).catch(() => {})
    }

    // Notify PM (confirmation)
    const [pmRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, user.id)).limit(1)
    const pmCancelLabel = utcCancel ? fmtTimeForNotif(utcCancel, COMPANY_TZ, pmRow?.timezone ?? null) : `${fmtTime(timeStr)} ET`
    createNotification({
      userId: user.id,
      type: "booking_cancelled",
      title: "Session cancelled",
      body: `You cancelled the session on ${dateLabel} at ${pmCancelLabel}. The member's credit has been refunded.`,
      bookingId,
      pushData: { route: "/portal" },
    }).catch(() => {})

    // Email member (+ parent CC)
    if (dancerEmail) {
      let dancerName = dancerEmail
      let cancelParentCC: string | undefined
      if (dancerUserId) {
        const memberRecords = await appBase.list<ClientFields>(TABLES.clients, {
          filterByFormula: `{User ID} = '${dancerUserId.replace(/'/g, "\\'")}'`,
          maxRecords: 1,
        })
        if (memberRecords[0]?.fields.Name) dancerName = memberRecords[0].fields.Name
        cancelParentCC = memberRecords[0]?.fields?.["Parent Email"] ?? undefined
      }
      const pmCancelTz = pmRow?.timezone ?? COMPANY_TZ
      const { subject, html } = bookingCancelledEmail({
        dancerName,
        prepMasterName: pm.name,
        date: dateStr,
        time: fmtEmailTime(timeStr, pmCancelTz, utcCancel, null),
        creditRefunded: true,
      })
      sendEmail({ to: dancerEmail, cc: cancelParentCC, subject, html }).catch(() => {})
    }

    // Delete Google Calendar events for all linked users — fire and forget
    db.select({ userId: calendarEventLink.userId, gcalEventId: calendarEventLink.gcalEventId })
      .from(calendarEventLink).where(eq(calendarEventLink.bookingId, bookingId))
      .then((links) => { for (const { userId, gcalEventId } of links) deleteCalendarEvent(userId, gcalEventId).catch(() => {}) })
      .catch(() => {})

    revalidatePath("/portal")
    return { ok: true, creditRefunded: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to cancel." }
  }
}
