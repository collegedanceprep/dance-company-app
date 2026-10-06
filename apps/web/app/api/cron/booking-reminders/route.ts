import { NextResponse } from "next/server"
import { TABLES, appBase, getPrepMasters, type BookingFields, type ClientFields } from "@/lib/airtable"
import { db } from "@/lib/db"
import { bookingReminderSent, user as userTable } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createNotification } from "@/app/actions/notifications"
import { fmtDate, fmtTimeForNotif, COMPANY_TZ } from "@/lib/utils"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const WINDOW_START_MS = 23 * 60 * 60 * 1000
const WINDOW_END_MS = 25 * 60 * 60 * 1000

function dateStr(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Sends a reminder push to both the dancer and the PrepMaster ~24 hours
 * before a Confirmed session. Meant to be hit by a scheduled Vercel Cron Job
 * (see vercel.json) — protected by CRON_SECRET, which Vercel sends
 * automatically as "Authorization: Bearer <CRON_SECRET>" for its own cron
 * requests.
 */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const now = Date.now()
  const windowStart = now + WINDOW_START_MS
  const windowEnd = now + WINDOW_END_MS

  // Narrow the Airtable fetch with a loose Date-string range (timezone-fuzzy
  // on purpose, a day wide on each side) — the precise cutoff is enforced
  // afterward using the real UTC Datetime.
  const loStr = dateStr(windowStart - 24 * 60 * 60 * 1000)
  const hiStr = dateStr(windowEnd + 24 * 60 * 60 * 1000)

  const records = await appBase.list<BookingFields>(TABLES.bookings, {
    filterByFormula: `AND({Status} = 'Confirmed', {Date} >= '${loStr}', {Date} <= '${hiStr}')`,
    revalidate: 0,
  })

  const due = records.filter((r) => {
    const utc = r.fields["UTC Datetime"]
    if (!utc) return false
    const t = new Date(utc).getTime()
    return t >= windowStart && t <= windowEnd
  })

  const prepMasters = await getPrepMasters()

  let sent = 0
  let skipped = 0
  for (const r of due) {
    try {
      await db.insert(bookingReminderSent).values({ bookingId: r.id })
    } catch {
      skipped++
      continue // already reminded on a previous cron tick
    }

    const dancerUserId = r.fields["User ID"]
    const pmName = r.fields["Prep Master Name"] ?? ""
    const date = r.fields.Date ?? ""
    const utcDt = r.fields["UTC Datetime"]!
    const pm = prepMasters.find((p) => p.name === pmName)

    let dancerName = "your dancer"
    if (dancerUserId) {
      const safeId = dancerUserId.replace(/'/g, "\\'")
      const clientRecs = await appBase.list<ClientFields>(TABLES.clients, {
        filterByFormula: `{User ID} = '${safeId}'`,
        maxRecords: 1,
        revalidate: 0,
      })
      if (clientRecs[0]?.fields.Name) dancerName = clientRecs[0].fields.Name
    }

    if (dancerUserId) {
      const [dancerRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, dancerUserId)).limit(1)
      const label = fmtTimeForNotif(utcDt, COMPANY_TZ, dancerRow?.timezone ?? null)
      createNotification({
        userId: dancerUserId,
        type: "booking_reminder",
        title: "Session tomorrow",
        body: `Reminder: your session with ${pmName || "your PrepMaster"} is tomorrow, ${fmtDate(date)} at ${label}.`,
        bookingId: r.id,
        pushData: { route: "/member/bookings" },
      }).catch(() => {})
    }

    if (pm?.email) {
      const [pmRow] = await db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, pm.email)).limit(1)
      if (pmRow) {
        const label = fmtTimeForNotif(utcDt, COMPANY_TZ, pmRow.timezone ?? null)
        createNotification({
          userId: pmRow.id,
          type: "booking_reminder",
          title: "Session tomorrow",
          body: `Reminder: your session with ${dancerName} is tomorrow, ${fmtDate(date)} at ${label}.`,
          bookingId: r.id,
          pushData: { route: "/portal" },
        }).catch(() => {})
      }
    }

    sent++
  }

  return NextResponse.json({ ok: true, candidates: records.length, due: due.length, sent, skipped })
}
