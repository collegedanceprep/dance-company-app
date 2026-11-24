import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { getCalendarAuthUrl, disconnectCalendar } from "@/lib/google-calendar"

// GET /api/google-calendar — redirect to Google OAuth consent screen
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { resolveRole } = await import("@/lib/roles")

  // state = "userId:web:member" or "userId:web:portal" so callback redirects correctly
  const role = await resolveRole(session.user.email)
  const returnPath = role === "dancer" ? "member" : "portal"
  const url = getCalendarAuthUrl(`${session.user.id}:web:${returnPath}`)
  return NextResponse.redirect(url)
}

// DELETE /api/google-calendar — disconnect calendar
export async function DELETE() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await disconnectCalendar(session.user.id)
  return NextResponse.json({ ok: true })
}
