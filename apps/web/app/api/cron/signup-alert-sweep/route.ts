import { NextResponse } from "next/server"
import { notifyAdminsOfSignup, pendingSignupsAwaitingAlert } from "@/lib/signup-notify"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const MIN_AGE_MS = 3 * 60 * 1000
const MAX_AGE_MS = 6 * 60 * 60 * 1000

/**
 * Safety net for the new-signup admin alert: any pending signup between 3
 * minutes and 6 hours old that never got alerted (e.g. Apple never delivered a
 * name) is alerted now, falling back to their email address as the label.
 */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers.get("authorization")
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const ids = await pendingSignupsAwaitingAlert(MIN_AGE_MS, MAX_AGE_MS)
  let sent = 0
  for (const id of ids) {
    if (await notifyAdminsOfSignup(id, { allowBlankName: true }).catch(() => false)) sent++
  }
  return NextResponse.json({ ok: true, candidates: ids.length, sent })
}
