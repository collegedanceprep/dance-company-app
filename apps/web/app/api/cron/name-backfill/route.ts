import { NextResponse } from "next/server"
import { findNameFixes, applyNameFixes } from "@/lib/name-backfill"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Nightly: replace placeholder Airtable member names (blank, an email, or just
 * the email prefix) with the real name from the app account. Apple private-relay
 * signups often get their name after the Airtable record was already created.
 * Never overwrites a real name. Protected by CRON_SECRET (Vercel Cron).
 * `?dry=1` reports what it would change without writing.
 */
export async function GET(req: Request) {
  if (process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const fixes = await findNameFixes()
  if (new URL(req.url).searchParams.get("dry") === "1") {
    return NextResponse.json({ ok: true, dry: true, count: fixes.length, fixes })
  }
  const fixed = await applyNameFixes(fixes)
  return NextResponse.json({ ok: true, found: fixes.length, fixed })
}
