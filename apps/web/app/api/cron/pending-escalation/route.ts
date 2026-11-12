import { NextResponse } from "next/server"
import { TABLES, appBase, getPrepMasters, type BookingFields } from "@/lib/airtable"
import { db } from "@/lib/db"
import { pendingEscalationSent, user as userTable } from "@/lib/db/schema"
import { inArray } from "drizzle-orm"
import { createNotification } from "@/app/actions/notifications"
import { sendEmail, pendingEscalationEmail, type PendingEscalationItem } from "@/lib/email"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const HOUR = 60 * 60 * 1000

/**
 * Hourly sweep of bookings still "Pending" a PrepMaster response. Each stage
 * fires at most once per booking (pending_escalation_sent):
 *   - pm_rd_12h_away  session starts within 12h   -> the PrepMaster and her Regional
 *                                                    Director (admins if she has none)
 *   - admin_24h  pending 24h+ or session < 24h    -> admins
 *   - lapsed     session time passed unanswered   -> admins
 * Alerts are grouped so each person gets one push/email per run.
 * Protected by CRON_SECRET (sent automatically by Vercel Cron).
 */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET) {
    if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const now = Date.now()
  const pending = await appBase.list<BookingFields>(TABLES.bookings, {
    filterByFormula: `{Status} = 'Pending'`,
    revalidate: 0,
  })
  if (pending.length === 0) return NextResponse.json({ ok: true, pending: 0, sent: 0 })

  const prepMasters = await getPrepMasters()
  const pmByName = new Map(prepMasters.map((p) => [p.name, p]))

  const adminEmails = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)

  // recipient email -> { audience, items }
  const buckets = new Map<string, { audience: "prepmaster" | "rd" | "admin"; items: PendingEscalationItem[] }>()
  const add = (email: string | undefined, audience: "prepmaster" | "rd" | "admin", item: PendingEscalationItem) => {
    if (!email) return
    const key = email.toLowerCase()
    const b = buckets.get(key) ?? { audience, items: [] }
    b.items.push(item)
    buckets.set(key, b)
  }

  async function claim(bookingId: string, stage: string): Promise<boolean> {
    const rows = await db
      .insert(pendingEscalationSent)
      .values({ id: crypto.randomUUID(), bookingId, stage })
      .onConflictDoNothing()
      .returning({ id: pendingEscalationSent.id })
    return rows.length > 0
  }

  for (const r of pending) {
    const f = r.fields
    const pmName = f["Prep Master Name"] ?? ""
    const pm = pmByName.get(pmName)
    const startMs = f["UTC Datetime"] ? Date.parse(f["UTC Datetime"]) : NaN
    if (!pmName || Number.isNaN(startMs)) continue

    const ageMs = now - Date.parse(r.createdTime)
    const untilMs = startMs - now
    const item = (note: string): PendingEscalationItem => ({
      prepMaster: pmName,
      dancer: f["Client Email"] ?? "A dancer",
      when: `${f.Date ?? ""} ${f.Time ?? ""} ET`.trim(),
      note,
    })

    // The RD this PrepMaster reports to (by name); admins are the fallback.
    const rd = pm?.reportsTo ? prepMasters.find((p) => p.name === pm.reportsTo && p.workerRole === "Regional Director") : undefined

    // Session within 12h and still unanswered: ping the PrepMaster AND her
    // Regional Director (admins stand in if she has none). The dancer is not contacted.
    if (untilMs > 0 && untilMs <= 12 * HOUR && (await claim(r.id, "pm_rd_12h_away"))) {
      add(pm?.email, "prepmaster", item("starts in under 12 hours"))
      if (rd?.email) add(rd.email, "rd", item("starts in under 12 hours, PrepMaster hasn't responded"))
      else adminEmails.forEach((e) => add(e, "admin", item("starts in under 12 hours, no Regional Director on file")))
    }
    if (untilMs > 0 && (ageMs >= 24 * HOUR || untilMs <= 24 * HOUR) && (await claim(r.id, "admin_24h"))) {
      adminEmails.forEach((e) => add(e, "admin", item(untilMs <= 24 * HOUR ? "starts in under 24 hours, still unconfirmed" : `pending ${Math.floor(ageMs / HOUR)}h`)))
    }
    if (untilMs <= 0 && (await claim(r.id, "lapsed"))) {
      adminEmails.forEach((e) => add(e, "admin", item("session time passed and it was never confirmed")))
    }
  }

  if (buckets.size === 0) return NextResponse.json({ ok: true, pending: pending.length, sent: 0 })

  const emails = [...buckets.keys()]
  const users = await db.select({ id: userTable.id, email: userTable.email, name: userTable.name }).from(userTable).where(inArray(userTable.email, emails))
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]))

  let sent = 0
  for (const [email, { audience, items }] of buckets) {
    const u = userByEmail.get(email)
    const n = items.length
    const title = audience === "prepmaster"
      ? (n === 1 ? "Booking needs your response now" : `${n} bookings need your response now`)
      : (n === 1 ? "1 booking waiting on a PrepMaster" : `${n} bookings waiting on a PrepMaster`)
    const body = audience === "prepmaster"
      ? "A session is starting soon and you haven't confirmed it. Please approve or decline."
      : `${items[0].prepMaster} hasn't responded${n > 1 ? ` (and ${n - 1} more)` : ""}. Tap to review.`
    if (u) {
      createNotification({ userId: u.id, type: "pending_escalation", title, body, pushData: { route: audience === "admin" ? "/admin" : "/portal" } }).catch(() => {})
    }
    const mail = pendingEscalationEmail({ recipientName: u?.name ?? email, audience, items })
    sendEmail({ to: email, subject: mail.subject, html: mail.html }).catch(() => {})
    sent++
  }

  return NextResponse.json({ ok: true, pending: pending.length, sent })
}
