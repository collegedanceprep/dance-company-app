import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { revalidateTag } from "next/cache"
import { auth } from "@/lib/auth"
import { getPrepMasterByEmail, TABLES, appBase, getMostRecentInactivePlanForUser, setPlanStatus, refundBookingCredit, type BookingFields, type ClientFields } from "@/lib/airtable"
import { createNotification } from "@/app/actions/notifications"
import { sendEmail, bookingUpdatedEmail, bookingCancelledEmail, bookingConfirmedByPmEmail, bookingDeclinedByPmEmail } from "@/lib/email"
import { isWithin24Hours, fmtDate, fmtTime, etToUtcIso, fmtTimeForNotif, fmtEmailTime, COMPANY_TZ } from "@/lib/utils"
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "@/lib/google-calendar"
import { db } from "@/lib/db"
import { user as userTable, calendarEventLink } from "@/lib/db/schema"
import { eq, and } from "drizzle-orm"

async function saveCalendarLink(bookingId: string, userId: string, gcalEventId: string) {
  await db.insert(calendarEventLink)
    .values({ id: crypto.randomUUID(), bookingId, userId, gcalEventId })
    .onConflictDoUpdate({
      target: [calendarEventLink.bookingId, calendarEventLink.userId],
      set: { gcalEventId },
    })
}

async function getCalendarLinks(bookingId: string): Promise<{ userId: string; gcalEventId: string }[]> {
  return db.select({ userId: calendarEventLink.userId, gcalEventId: calendarEventLink.gcalEventId })
    .from(calendarEventLink)
    .where(eq(calendarEventLink.bookingId, bookingId))
}

async function getPmAndBooking(sessionEmail: string, bookingId: string) {
  const pm = await getPrepMasterByEmail(sessionEmail)
  if (!pm) return { pm: null, booking: null }
  const safe = pm.name.replace(/'/g, "\\'")
  const records = await appBase.list<BookingFields>(TABLES.bookings, {
    filterByFormula: `AND({Prep Master Name} = '${safe}', RECORD_ID() = '${bookingId}')`,
    maxRecords: 1,
    revalidate: 0,
  })
  return { pm, booking: records[0] ?? null }
}

// PATCH — adjust date/time/notes
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { pm, booking } = await getPmAndBooking(session.user.email, id)
  if (!pm || !booking) return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 })

  const body = await req.json() as { date?: string; time?: string; prepMasterNotes?: string; action?: "confirm" | "decline" | "cancel"; declineReason?: string; cancellationReason?: string; rescheduleAction?: "revert" | "cancel" }

  if (body.action === "confirm") {
    await appBase.update<BookingFields>(TABLES.bookings, id, {
      Status: "Confirmed",
      "Is Reschedule": false,
      "Original Date": "",
      "Original Time": "",
      "Original UTC Datetime": "",
    })
    revalidateTag(`portal-${session.user.email}`)
    const dancerUserId = booking.fields["User ID"]
    if (dancerUserId) {
      revalidateTag(`member-${dancerUserId}`)
      const [pmRow, dancerRow] = await Promise.all([
        db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, session.user.email)).limit(1),
        db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, dancerUserId)).limit(1),
      ])
      const pmTz = pmRow[0]?.timezone ?? COMPANY_TZ
      const dTz = dancerRow[0]?.timezone ?? null
      const utcStr = booking.fields["UTC Datetime"] ?? etToUtcIso(booking.fields.Date ?? "", booking.fields.Time ?? "", pmTz)
      const timeLabel = utcStr ? fmtTimeForNotif(utcStr, pmTz, dTz) : `${fmtTime(booking.fields.Time ?? "")} ET`
      createNotification({
        userId: dancerUserId,
        type: "booking_confirmed",
        title: "Booking confirmed",
        body: `${pm.name} has confirmed your session on ${fmtDate(booking.fields.Date ?? "")} at ${timeLabel}.`,
        bookingId: id,
        pushData: { route: "/member/bookings" },
      }).catch(() => {})

      // Send confirmation email to member (+ parent CC)
      const dancerEmailConfirm = booking.fields["Client Email"]
      if (dancerEmailConfirm) {
        const safeId = dancerUserId.replace(/'/g, "\\'")
        const memberRecs = await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeId}'`, maxRecords: 1 })
        const dancerName = memberRecs[0]?.fields.Name ?? dancerEmailConfirm
        const parentCC = memberRecs[0]?.fields?.["Parent Email"] ?? undefined
        const { subject, html } = bookingConfirmedByPmEmail({
          dancerName,
          prepMasterName: pm.name,
          date: booking.fields.Date ?? "",
          time: fmtEmailTime(booking.fields.Time ?? "", pmTz, utcStr, dTz),
        })
        sendEmail({ to: dancerEmailConfirm, cc: parentCC, subject, html }).catch(() => {})
      }
    }
    // Create or update Google Calendar events for both PM and member at confirm time.
    // If events already exist (reschedule flow), update them — don't create duplicates.
    // Fire in background — don't block the confirm response.
    ;(async () => {
      try {
        const [pmUserRow, dancerUserRow, existingLinks] = await Promise.all([
          db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, session.user.email)).limit(1),
          booking.fields["User ID"]
            ? db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, booking.fields["User ID"]!)).limit(1)
            : Promise.resolve([]),
          getCalendarLinks(id),
        ])
        const existingByUser = new Map(existingLinks.map((l) => [l.userId, l.gcalEventId]))
        const pmTz = pmUserRow[0]?.timezone ?? COMPANY_TZ
        const bDate = booking.fields.Date ?? ""
        const bTime = booking.fields.Time ?? ""
        const bNotes = booking.fields.Notes ?? ""
        const bType = booking.fields["Session Type"] ?? "private-60"
        let dancerName = booking.fields["Client Email"] ?? "Member"
        if (dancerUserId) {
          const safeIdCal = dancerUserId.replace(/'/g, "\\'")
          const calClientRecs = await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeIdCal}'`, maxRecords: 1, revalidate: 0 })
          if (calClientRecs[0]?.fields.Name) dancerName = calClientRecs[0].fields.Name
        }

        // PM event
        if (pmUserRow[0]) {
          const existingId = existingByUser.get(pmUserRow[0].id)
          if (existingId) {
            await updateCalendarEvent(pmUserRow[0].id, existingId, { dancerName, date: bDate, time: bTime, notes: bNotes, sessionType: bType, timezone: pmTz })
          } else {
            const newId = await createCalendarEvent(pmUserRow[0].id, { dancerName, date: bDate, time: bTime, notes: bNotes, sessionType: bType, timezone: pmTz })
            if (newId) await saveCalendarLink(id, pmUserRow[0].id, newId)
          }
        }

        // Member event (uses PM timezone so it shows the correct session time)
        if (dancerUserRow[0]) {
          const existingId = existingByUser.get(dancerUserRow[0].id)
          if (existingId) {
            await updateCalendarEvent(dancerUserRow[0].id, existingId, { dancerName, prepMasterName: pm.name, date: bDate, time: bTime, notes: bNotes, sessionType: bType, timezone: pmTz })
          } else {
            const newId = await createCalendarEvent(dancerUserRow[0].id, { dancerName, prepMasterName: pm.name, date: bDate, time: bTime, notes: bNotes, sessionType: bType, timezone: pmTz })
            if (newId) await saveCalendarLink(id, dancerUserRow[0].id, newId)
          }
        }
      } catch (e) {
        console.error("Calendar event upsert at confirm failed:", e)
      }
    })()
    return NextResponse.json({ ok: true })
  }

  if (body.action === "decline") {
    const currentDeclineStatus = (booking.fields.Status ?? "").toLowerCase()
    if (currentDeclineStatus.startsWith("cancelled") || currentDeclineStatus === "declined") {
      return NextResponse.json({ ok: false, error: "This booking has already been cancelled." }, { status: 409 })
    }
    const dancerUserId = booking.fields["User ID"]
    const isReschedule = !!(booking.fields["Is Reschedule"])

    if (body.rescheduleAction === "revert") {
      // PM explicitly chose to keep the original booking (reschedule denied)
      const origDate = booking.fields["Original Date"] ?? booking.fields.Date ?? ""
      const origTime = booking.fields["Original Time"] ?? booking.fields.Time ?? ""
      const origUtc = booking.fields["Original UTC Datetime"] ?? booking.fields["UTC Datetime"] ?? ""
      await appBase.update<BookingFields>(TABLES.bookings, id, {
        Status: "Confirmed",
        "Is Reschedule": false,
        Date: origDate,
        Time: origTime,
        ...(origUtc ? { "UTC Datetime": origUtc } : {}),
        "Original Date": "",
        "Original Time": "",
        "Original UTC Datetime": "",
        ...(body.declineReason ? { "Decline Reason": body.declineReason } : {}),
      })
      revalidateTag(`portal-${session.user.email}`)
      if (dancerUserId) {
        revalidateTag(`member-${dancerUserId}`)
        const [dTzRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, dancerUserId)).limit(1)
        const [pmTzRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, session.user.email)).limit(1)
        const pmTz = pmTzRow[0]?.timezone ?? COMPANY_TZ
        const utcForNotif = origUtc || etToUtcIso(origDate, origTime, pmTz)
        const timeLabel = utcForNotif ? fmtTimeForNotif(utcForNotif, pmTz, dTzRow[0]?.timezone ?? null) : `${fmtTime(origTime)} ET`
        createNotification({
          userId: dancerUserId,
          type: "booking_updated",
          title: "Reschedule request denied",
          body: `${pm.name} couldn't accommodate the reschedule. Your session remains on ${fmtDate(origDate)} at ${timeLabel}.`,
          bookingId: id,
          pushData: { route: "/member/bookings" },
        }).catch(() => {})

        // Email dancer that reschedule was denied and original time kept
        const revertDancerEmail = booking.fields["Client Email"]
        if (revertDancerEmail) {
          const safeRevertId = dancerUserId.replace(/'/g, "\\'")
          const revertMemberRecs = await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeRevertId}'`, maxRecords: 1 })
          const revertDancerName = revertMemberRecs[0]?.fields.Name ?? revertDancerEmail
          const revertParentCC = revertMemberRecs[0]?.fields?.["Parent Email"] ?? undefined
          const { subject, html } = bookingDeclinedByPmEmail({
            dancerName: revertDancerName,
            prepMasterName: pm.name,
            date: origDate,
            time: timeLabel,
            customNote: "Your reschedule request was declined. Your session has been kept at the original time.",
          })
          sendEmail({ to: revertDancerEmail, cc: revertParentCC, subject, html }).catch(() => {})
        }
      }
      return NextResponse.json({ ok: true, rescheduleReverted: true, origDate, origTime, origUtc: origUtc || null })
    }

    // Full booking decline (no prior reschedule) — refund credit
    await appBase.update<BookingFields>(TABLES.bookings, id, {
      Status: "Declined",
      "Is Reschedule": false,
      ...(body.declineReason ? { "Decline Reason": body.declineReason } : {}),
    })
    revalidateTag(`portal-${session.user.email}`)

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
        const usedSingleCredit = booking.fields["Single Credit Used"] === true
        await refundBookingCredit(client.id, client.fields, sessionType, usedSingleCredit)
        if (!usedSingleCredit && (client.fields["Credits Remaining"] ?? 0) === 0) {
          const inactivePlan = await getMostRecentInactivePlanForUser(dancerUserId)
          if (inactivePlan) await setPlanStatus(inactivePlan.id, "Active").catch(() => {})
        }
      }
      revalidateTag(`member-${dancerUserId}`)
      const [pmDRow, dTzRow] = await Promise.all([
        db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, session.user.email)).limit(1),
        db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, dancerUserId)).limit(1),
      ])
      const pmTzDecline = pmDRow[0]?.timezone ?? COMPANY_TZ
      const dTzDecline = dTzRow[0]?.timezone ?? null
      const utcDecline = booking.fields["UTC Datetime"] ?? etToUtcIso(booking.fields.Date ?? "", booking.fields.Time ?? "", pmTzDecline)
      const timeLabelDecline = utcDecline ? fmtTimeForNotif(utcDecline, pmTzDecline, dTzDecline) : `${fmtTime(booking.fields.Time ?? "")} ET`
      createNotification({
        userId: dancerUserId,
        type: "booking_cancelled",
        title: "Booking declined",
        body: `${pm.name} has declined your session on ${fmtDate(booking.fields.Date ?? "")} at ${timeLabelDecline}. Your credit has been refunded.`,
        bookingId: id,
        pushData: { route: "/member/bookings" },
      }).catch(() => {})

      // Send decline email to member (+ parent CC)
      const dancerEmailDecline = booking.fields["Client Email"]
      if (dancerEmailDecline) {
        const safeIdDecline = dancerUserId.replace(/'/g, "\\'")
        const memberRecs = await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeIdDecline}'`, maxRecords: 1 })
        const dancerNameDecline = memberRecs[0]?.fields.Name ?? dancerEmailDecline
        const parentCCDecline = memberRecs[0]?.fields?.["Parent Email"] ?? undefined
        const { subject, html } = bookingDeclinedByPmEmail({
          dancerName: dancerNameDecline,
          prepMasterName: pm.name,
          date: booking.fields.Date ?? "",
          time: fmtEmailTime(booking.fields.Time ?? "", pmTzDecline, utcDecline, dTzDecline),
        })
        sendEmail({ to: dancerEmailDecline, cc: parentCCDecline, subject, html }).catch(() => {})
      }
    }
    // Delete calendar events for all linked users
    getCalendarLinks(id).then((links) => {
      for (const { userId, gcalEventId } of links) {
        deleteCalendarEvent(userId, gcalEventId).catch(() => {})
      }
    }).catch(() => {})
    return NextResponse.json({ ok: true, creditRefunded: true })
  }

  if (body.action === "cancel") {
    const currentCancelStatus = (booking.fields.Status ?? "").toLowerCase()
    if (currentCancelStatus.startsWith("cancelled") || currentCancelStatus === "declined") {
      return NextResponse.json({ ok: false, error: "This booking has already been cancelled." }, { status: 409 })
    }
    if (!body.cancellationReason?.trim()) {
      return NextResponse.json({ ok: false, error: "A cancellation reason is required." }, { status: 400 })
    }
    const dateStr = booking.fields.Date ?? ""
    const timeStr = booking.fields.Time ?? ""
    const dancerUserId = booking.fields["User ID"]
    const dancerEmail = booking.fields["Client Email"]

    await appBase.update<BookingFields>(TABLES.bookings, id, {
      Status: "Cancelled",
      "Cancellation Reason": body.cancellationReason,
    })

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
        const sessionType = booking.fields["Session Type"] ?? "private-60"
        const usedSingleCredit = booking.fields["Single Credit Used"] === true
        await refundBookingCredit(client.id, client.fields, sessionType, usedSingleCredit)
        if (!usedSingleCredit && (client.fields["Credits Remaining"] ?? 0) === 0) {
          const inactivePlan = await getMostRecentInactivePlanForUser(dancerUserId)
          if (inactivePlan) await setPlanStatus(inactivePlan.id, "Active")
        }
      }
    }

    if (dancerUserId) {
      revalidateTag(`member-${dancerUserId}`)
      const [pmCancelNotifTzRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, session.user.email)).limit(1)
      const pmCancelNotifTz = pmCancelNotifTzRow?.timezone ?? COMPANY_TZ
      const utcCancelNotif = booking.fields["UTC Datetime"] ?? etToUtcIso(dateStr, timeStr, pmCancelNotifTz)
      const [memberCancelRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, dancerUserId)).limit(1)
      const cancelTimeLabel = utcCancelNotif ? fmtTimeForNotif(utcCancelNotif, pmCancelNotifTz, memberCancelRow?.timezone ?? null) : `${fmtTime(timeStr)} ET`
      createNotification({
        userId: dancerUserId,
        type: "booking_cancelled",
        title: "Session cancelled by PrepMaster",
        body: `${pm.name} cancelled your session on ${fmtDate(dateStr)} at ${cancelTimeLabel}. Your credit has been refunded.`,
        bookingId: id,
        pushData: { route: "/member/bookings" },
      }).catch(() => {})
    }

    if (dancerEmail) {
      let dancerName = dancerEmail
      let parentCC: string | null = null
      if (dancerUserId) {
        const safeId = dancerUserId.replace(/'/g, "\\'")
        const memberRecords = await appBase.list<ClientFields>(TABLES.clients, {
          filterByFormula: `{User ID} = '${safeId}'`,
          maxRecords: 1,
        })
        const memberRecord = memberRecords[0]
        if (memberRecord?.fields.Name) dancerName = memberRecord.fields.Name
        parentCC = memberRecord?.fields?.["Parent Email"] ?? null
      }
      const [pmCancelTzRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, session.user.email)).limit(1)
      const pmCancelTz = pmCancelTzRow?.timezone ?? COMPANY_TZ
      const utcCancel = booking.fields["UTC Datetime"] ?? etToUtcIso(dateStr, timeStr, pmCancelTz)
      const { subject, html } = bookingCancelledEmail({
        dancerName,
        prepMasterName: pm.name,
        date: dateStr,
        time: fmtEmailTime(timeStr, pmCancelTz, utcCancel, null),
        creditRefunded: true,
      })
      sendEmail({ to: dancerEmail, cc: parentCC ?? undefined, subject, html }).catch(() => {})
    }

    // Delete calendar events for all linked users
    getCalendarLinks(id).then((links) => {
      for (const { userId, gcalEventId } of links) {
        deleteCalendarEvent(userId, gcalEventId).catch(() => {})
      }
    }).catch(() => {})
    revalidateTag(`portal-${session.user.email}`)
    return NextResponse.json({ ok: true, creditRefunded: true })
  }

  // Edit date/time/PrepMaster notes
  const update: Partial<BookingFields> = {}
  if (body.date) update.Date = body.date
  if (body.time) update.Time = body.time
  if (body.prepMasterNotes !== undefined) update["Prep Master Notes"] = body.prepMasterNotes
  if (body.date || body.time) {
    const [pmTzRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, session.user.email)).limit(1)
    const pmTz = pmTzRow?.timezone ?? COMPANY_TZ
    const utc = etToUtcIso(
      body.date ?? booking.fields.Date ?? "",
      body.time ?? booking.fields.Time ?? "",
      pmTz,
    )
    if (utc) update["UTC Datetime"] = utc
  }
  await appBase.update<BookingFields>(TABLES.bookings, id, update)
  revalidateTag(`portal-${session.user.email}`)
  if (booking.fields["User ID"]) revalidateTag(`member-${booking.fields["User ID"]}`)

  const newDate = body.date ?? booking.fields.Date ?? ""
  const newTime = body.time ?? booking.fields.Time ?? ""

  const newNotes = body.prepMasterNotes !== undefined ? body.prepMasterNotes : (booking.fields["Prep Master Notes"] || undefined)

  // Look up dancer details once — used for both calendar update and email/notification
  const editDancerEmail = booking.fields["Client Email"]
  const editDancerUserId = booking.fields["User ID"]
  let editDancerName = editDancerEmail ?? "Member"
  let editDancerTz: string | null = null
  let editParentCC: string | null = null
  if (editDancerUserId) {
    const safeId = editDancerUserId.replace(/'/g, "\\'")
    const [memberRecord, dbRow] = await Promise.all([
      appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeId}'`, maxRecords: 1 }),
      db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, editDancerUserId)).limit(1),
    ])
    if (memberRecord[0]?.fields.Name) editDancerName = memberRecord[0].fields.Name
    editParentCC = memberRecord[0]?.fields?.["Parent Email"] ?? null
    editDancerTz = dbRow[0]?.timezone ?? null
  }

  // Update calendar events if date or time changed
  if (body.date || body.time) {
    const [pmTzForCal] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, session.user.email)).limit(1)
    const pmTzCal = pmTzForCal?.timezone ?? COMPANY_TZ
    getCalendarLinks(id).then(async (links) => {
      for (const { userId, gcalEventId } of links) {
        await updateCalendarEvent(userId, gcalEventId, {
          dancerName: editDancerName,
          prepMasterName: pm.name,
          date: newDate,
          time: newTime,
          notes: booking.fields.Notes,
          sessionType: booking.fields["Session Type"] ?? "private-60",
          timezone: pmTzCal,
        }).catch(() => {})
      }
    }).catch(() => {})
  }

  // Only notify and email the dancer when the date/time actually changed
  if (body.date || body.time) {
    const dancerEmail = editDancerEmail
    const dancerUserId = editDancerUserId
    const dancerName = editDancerName
    const dancerTz = editDancerTz
    const rescheduleParentCC = editParentCC
    const [pmDbRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, session.user.email)).limit(1)
    const pmTz = pmDbRow?.timezone ?? COMPANY_TZ

    if (dancerUserId) {
      const utcForNotif = update["UTC Datetime"] ?? booking.fields["UTC Datetime"] ?? etToUtcIso(newDate, newTime, pmTz)
      const timeLabel = utcForNotif
        ? fmtTimeForNotif(utcForNotif, pmTz, dancerTz)
        : `${fmtTime(newTime)} ET`
      createNotification({
        userId: dancerUserId,
        type: "booking_updated",
        title: "Session rescheduled",
        body: `${pm.name} has rescheduled your session to ${fmtDate(newDate)} at ${timeLabel}.`,
        bookingId: id,
        pushData: { route: "/member/bookings" },
      }).catch(() => {})
    }

    if (dancerEmail) {
      const utcForEmail = update["UTC Datetime"] ?? booking.fields["UTC Datetime"] ?? null
      const { subject, html } = bookingUpdatedEmail({
        recipientName: dancerName,
        updatedByName: pm.name,
        updatedByRole: "PrepMaster",
        date: newDate,
        time: fmtEmailTime(newTime, pmTz, utcForEmail, dancerTz),
        notes: newNotes,
      })
      sendEmail({ to: dancerEmail, cc: rescheduleParentCC ?? undefined, subject, html }).catch(() => {})
    }
  }

  // Return the computed UTC so the mobile app can update localUtcDatetime immediately
  return NextResponse.json({ ok: true, utcDatetime: update["UTC Datetime"] ?? null })
}
