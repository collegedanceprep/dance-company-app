import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getCalendarAuthUrl } from "@/lib/google-calendar"

// GET /api/google-calendar/url?for=portal|member — returns the Google OAuth URL as JSON (for mobile)
export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { resolveRole } = await import("@/lib/roles")

  const role = new URL(req.url).searchParams.get("for") ?? "portal"
  const url = getCalendarAuthUrl(session.user.id, `mobile:${role}` as any)
  return NextResponse.json({ url })
}
