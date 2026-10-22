import { NextResponse } from "next/server"
import { TABLES, appBase, getPrepMasters, type BookingFields } from "@/lib/airtable"
import { db } from "@/lib/db"
import { pendingDigestSent, user as userTable } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createNotification } from "@/app/actions/notifications"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Sends a once-daily push to every active PrepMaster who has one or more
 * bookings still sitting "Pending" their approval. Meant to be hit by a
 * scheduled Vercel Cron Job (see vercel.json) — protected by CRON_SECRET,
 * which Vercel sends automatically as "Authorization: Bearer <CRON_SECRET>"
 * for its own cron requests.
 */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const today = new Date().toISOString().slice(0, 10)

  const pending = await appBase.list<BookingFields>(TABLES.bookings, {
    filterByFormula: `{Status} = 'Pending'`,
    revalidate: 0,
  })

  const countByPm = new Map<string, number>()
  for (const r of pending) {
    const pmName = r.fields["Prep Master Name"]
    if (!pmName) continue
    countByPm.set(pmName, (countByPm.get(pmName) ?? 0) + 1)
  }

  const prepMasters = await getPrepMasters()

  let sent = 0
  let skipped = 0
  for (const [pmName, count] of countByPm) {
    const pm = prepMasters.find((p) => p.name === pmName)
    if (!pm?.email) continue

    const [pmRow] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, pm.email)).limit(1)
    if (!pmRow) continue

    try {
      await db.insert(pendingDigestSent).values({ id: crypto.randomUUID(), workerUserId: pmRow.id, forDate: today })
    } catch {
      skipped++
      continue // already sent today
    }

    createNotification({
      userId: pmRow.id,
      type: "pending_approvals_digest",
      title: count === 1 ? "1 booking waiting on you" : `${count} bookings waiting on you`,
      body: count === 1
        ? "A dancer is waiting on you to confirm their session."
        : `${count} dancers are waiting on you to confirm their sessions.`,
      pushData: { route: "/portal" },
    }).catch(() => {})

    sent++
  }

  return NextResponse.json({ ok: true, prepMastersWithPending: countByPm.size, sent, skipped })
}
