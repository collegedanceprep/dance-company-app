import { NextRequest, NextResponse } from "next/server"
import { appBase, TABLES, type BookingFields, type ClientFields, type AirtableRecord, getMostRecentInactivePlanForUser, setPlanStatus, getPrepMasters, refundBookingCredit } from "@/lib/airtable"
import { sendEmail, bookingCancelledEmail, bookingConfirmedByPmEmail, bookingDeclinedByPmEmail } from "@/lib/email"
import { db } from "@/lib/db"
import { user as userTable, calendarEventLink } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createCalendarEvent, deleteCalendarEvent } from "@/lib/google-calendar"
import { COMPANY_TZ, verifyConfirmToken, fmtTimeForNotif, fmtEmailTime } from "@/lib/utils"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.collegedanceprep.com"
const SECRET = process.env.BOOKING_CONFIRM_SECRET
if (!SECRET) throw new Error("BOOKING_CONFIRM_SECRET env var is not set")

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const bookingId = searchParams.get("id")
  const action = searchParams.get("action") // "approve" | "deny"
  const token = searchParams.get("token")

  if (!bookingId || !action || !token || !verifyConfirmToken(SECRET!, bookingId, action, token)) {
    return NextResponse.redirect(`${APP_URL}/dashboard`)
  }

  try {
    const records = await appBase.list<BookingFields>(TABLES.bookings, {
      filterByFormula: `RECORD_ID() = '${bookingId}'`,
      maxRecords: 1,
    })
    const booking = records[0]
    if (!booking) return NextResponse.redirect(`${APP_URL}/dashboard`)

    const currentStatus = booking.fields.Status ?? ""
    if (currentStatus !== "Pending") {
      // Already handled — show a simple message
      return new NextResponse(
        `<html><body style="font-family:sans-serif;padding:40px;max-width:480px;margin:0 auto">
          <h2>Already processed</h2>
          <p>This booking request has already been ${currentStatus.toLowerCase()}.</p>
        </body></html>`,
        { headers: { "Content-Type": "text/html" } }
      )
    }

    if (action === "approve") {
      await appBase.update<BookingFields>(TABLES.bookings, bookingId, { Status: "Confirmed" })

      // In-app notification for dancer
      const dancerUserId = booking.fields["User ID"]
      if (dancerUserId) {
        const { createNotification } = await import("@/app/actions/notifications")
        createNotification({
          userId: dancerUserId,
          type: "booking_confirmed",
          title: "Booking confirmed",
          body: `${booking.fields["Prep Master Name"] ?? "Your PrepMaster"} confirmed your session on ${booking.fields.Date ?? ""}.`,
          bookingId,
          pushData: { route: "/member/bookings" },
        }).catch(() => {})
      }

      // Notify dancer via email
      const dancerEmail = booking.fields["Client Email"]
      const pmName = booking.fields["Prep Master Name"] ?? "your PrepMaster"
      const date = booking.fields.Date ?? ""
      const time = booking.fields.Time ?? ""
      if (dancerEmail) {
        const { getParentEmailForMember } = await import("@/lib/airtable")
        const userId = booking.fields["User ID"]
        const utcDt = booking.fields["UTC Datetime"] ?? null
        // Look up PM's actual timezone instead of assuming COMPANY_TZ
        let pmTzForEmail = COMPANY_TZ
        const pmNameForTz = booking.fields["Prep Master Name"] ?? ""
        if (pmNameForTz && utcDt) {
          const pmsForTz = await getPrepMasters()
          const pmForTz = pmsForTz.find((p) => p.name === pmNameForTz)
          if (pmForTz?.email) {
            const [pmRowForTz] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pmForTz.email)).limit(1)
            if (pmRowForTz?.timezone) pmTzForEmail = pmRowForTz.timezone
          }
        }
        const timeDisplay = utcDt ? fmtTimeForNotif(utcDt, pmTzForEmail, null) : time
        let dancerName = dancerEmail
        if (userId) {
          const safeId = userId.replace(/'/g, "\\'")
          const recs = await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeId}'`, maxRecords: 1, revalidate: 0 })
          if (recs[0]?.fields.Name) dancerName = recs[0].fields.Name
        }
        const parentCC = userId ? await getParentEmailForMember(userId).catch(() => null) : null
        const { subject, html } = bookingConfirmedByPmEmail({ dancerName, prepMasterName: pmName, date, time: timeDisplay })
        await sendEmail({ to: dancerEmail, cc: parentCC ?? undefined, subject, html })
      }

      // Create Google Calendar events for PM and dancer (fire-and-forget)
      ;(async () => {
        const pms = await getPrepMasters()
        const pm = pms.find((p) => p.name === (booking.fields["Prep Master Name"] ?? ""))
        if (!pm?.email) return
        const [[pmUser], dancerUserId] = await Promise.all([
          db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pm.email)).limit(1),
          Promise.resolve(booking.fields["User ID"] ?? null),
        ])
        const pmTz = pmUser?.timezone ?? COMPANY_TZ
        let dancerName = booking.fields["Client Email"] ?? "Member"
        const dancerUserRow = dancerUserId ? await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.id, dancerUserId)).limit(1).then((r) => r[0] ?? null) : null
        if (dancerUserId) {
          const safeId = dancerUserId.replace(/'/g, "\\'")
          const clientRecs = await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeId}'`, maxRecords: 1, revalidate: 0 })
          if (clientRecs[0]?.fields.Name) dancerName = clientRecs[0].fields.Name
        }
        const eventArgs = { dancerName, prepMasterName: pm.name, date: booking.fields.Date ?? "", time: booking.fields.Time ?? "", notes: booking.fields.Notes, sessionType: booking.fields["Session Type"], timezone: pmTz }
        const [pmEventId, dancerEventId] = await Promise.all([
          pmUser ? createCalendarEvent(pmUser.id, eventArgs) : Promise.resolve(null),
          dancerUserRow ? createCalendarEvent(dancerUserRow.id, { ...eventArgs }) : Promise.resolve(null),
        ])
        const links = []
        if (pmUser && pmEventId) links.push({ id: crypto.randomUUID(), bookingId, userId: pmUser.id, gcalEventId: pmEventId })
        if (dancerUserRow && dancerEventId) links.push({ id: crypto.randomUUID(), bookingId, userId: dancerUserRow.id, gcalEventId: dancerEventId })
        if (links.length > 0) {
          await db.insert(calendarEventLink).values(links).onConflictDoNothing().catch(() => {})
        }
      })().catch(() => {})

      return new NextResponse(
        `<html><body style="font-family:sans-serif;padding:40px;max-width:480px;margin:0 auto">
          <h2 style="color:#e91e8c">Booking confirmed ✓</h2>
          <p>The session has been confirmed and the member has been notified.</p>
        </body></html>`,
        { headers: { "Content-Type": "text/html" } }
      )
    }

    if (action === "deny") {
      // "Declined" = PM-initiated denial; "Cancelled" is reserved for member-initiated cancellations
      await appBase.update<BookingFields>(TABLES.bookings, bookingId, { Status: "Declined" })

      // Refund credit
      const userId = booking.fields["User ID"]
      const dancerEmail = booking.fields["Client Email"]
      // Hoisted so it's accessible in the notification block below
      let clients: AirtableRecord<ClientFields>[] = []
      if (userId) {
        clients = await appBase.list<ClientFields>(TABLES.clients, {
          filterByFormula: `{User ID} = '${userId.replace(/'/g, "\\'")}'`,
          maxRecords: 1,
        })
        const client = clients[0]
        if (client) {
          const sessionType = booking.fields["Session Type"] ?? "pack-hour"
          const usedSingleCredit = booking.fields["Single Credit Used"] === true
          await refundBookingCredit(client.id, client.fields, sessionType, usedSingleCredit, userId)
          if (!usedSingleCredit && (client.fields["Credits Remaining"] ?? 0) === 0) {
            const inactivePlan = await getMostRecentInactivePlanForUser(userId)
            if (inactivePlan) await setPlanStatus(inactivePlan.id, "Active")
          }
        }
      }

      // In-app notification for dancer
      const deniedDancerUserId = booking.fields["User ID"]
      if (deniedDancerUserId) {
        const { createNotification } = await import("@/app/actions/notifications")
        createNotification({
          userId: deniedDancerUserId,
          type: "booking_cancelled",
          title: "Booking declined",
          body: `${booking.fields["Prep Master Name"] ?? "Your PrepMaster"} declined your session on ${booking.fields.Date ?? ""}. Your credit has been refunded.`,
          bookingId,
          pushData: { route: "/member/bookings" },
        }).catch(() => {})
      }

      // Notify dancer via email — use bookingDeclinedByPmEmail (PM declined, not member cancellation)
      if (dancerEmail) {
        const pmName = booking.fields["Prep Master Name"] ?? "your PrepMaster"
        const date = booking.fields.Date ?? ""
        const time = booking.fields.Time ?? ""
        const parentCC = clients[0]?.fields?.["Parent Email"] ?? null
        const utcDtDeny = booking.fields["UTC Datetime"] ?? null
        // Look up PM's timezone for accurate time display
        const pms = await getPrepMasters()
        const pmEntry = pms.find((p) => p.name === pmName)
        const pmTzDeny = pmEntry?.email
          ? await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pmEntry.email)).limit(1).then((r) => r[0]?.timezone ?? COMPANY_TZ)
          : COMPANY_TZ
        const denyUserId = booking.fields["User ID"]
        const denyMemberTz = denyUserId
          ? await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, denyUserId)).limit(1).then((r) => r[0]?.timezone ?? null)
          : null
        const timeDenyDisplay = utcDtDeny ? fmtEmailTime(time, pmTzDeny, utcDtDeny, denyMemberTz) : time
        let denyDancerName = dancerEmail
        if (denyUserId) {
          const safeId = denyUserId.replace(/'/g, "\\'")
          const recs = await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `{User ID} = '${safeId}'`, maxRecords: 1, revalidate: 0 })
          if (recs[0]?.fields.Name) denyDancerName = recs[0].fields.Name
        }
        const { subject, html } = bookingDeclinedByPmEmail({
          dancerName: denyDancerName,
          prepMasterName: pmName,
          date,
          time: timeDenyDisplay,
        })
        await sendEmail({ to: dancerEmail, cc: parentCC ?? undefined, subject, html })
      }

      // Delete any calendar events that may exist (fire-and-forget)
      db.select({ userId: calendarEventLink.userId, gcalEventId: calendarEventLink.gcalEventId })
        .from(calendarEventLink).where(eq(calendarEventLink.bookingId, bookingId))
        .then((links) => { for (const { userId, gcalEventId } of links) deleteCalendarEvent(userId, gcalEventId).catch(() => {}) })
        .catch(() => {})

      return new NextResponse(
        `<html><body style="font-family:sans-serif;padding:40px;max-width:480px;margin:0 auto">
          <h2>Booking denied</h2>
          <p>The booking has been cancelled and the member's credit has been refunded.</p>
        </body></html>`,
        { headers: { "Content-Type": "text/html" } }
      )
    }
  } catch (err) {
    console.error("Booking confirm error:", err)
  }

  return NextResponse.redirect(`${APP_URL}/dashboard`)
}
