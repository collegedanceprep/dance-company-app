import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { isAirtableConfigured } from "@/lib/airtable"
import { getCachedMemberDashboard } from "@/lib/airtable-cache"
import { resolveRole } from "@/lib/roles"

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const role = await resolveRole(session.user.email)
  if (role === "prep_master") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  if (!isAirtableConfigured()) {
    return NextResponse.json({ error: "Airtable not configured" }, { status: 503 })
  }

  try {
    const resolvedUser = { id: session.user.id, email: session.user.email, name: session.user.name ?? "" }
    const { profile, bookings, plans } = await getCachedMemberDashboard(resolvedUser)
    const memberId = profile.effectiveUserId || session.user.id

    const todayMs = new Date(new Date().toDateString()).getTime()
    const bookingMs = (date: string) => new Date(`${date}T00:00:00`).getTime()

    const upcoming = bookings
      .filter((b) => {
        if (b.status.toLowerCase().startsWith("cancelled") || b.status.toLowerCase() === "declined") return false
        const ms = bookingMs(b.date)
        return !Number.isNaN(ms) && ms >= todayMs
      })
      .sort((a, b) => bookingMs(a.date) - bookingMs(b.date))

    const past = bookings
      .filter((b) => {
        if (b.status.toLowerCase().startsWith("cancelled") || b.status.toLowerCase() === "declined") return false
        const ms = bookingMs(b.date)
        return !Number.isNaN(ms) && ms < todayMs
      })
      .sort((a, b) => bookingMs(b.date) - bookingMs(a.date))

    const cancelled = bookings
      .filter((b) => b.status.toLowerCase().startsWith("cancelled") || b.status.toLowerCase() === "declined")
      .sort((a, b) => bookingMs(b.date) - bookingMs(a.date))

    return NextResponse.json({
      profile: {
        recordId: profile.recordId,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        goals: profile.goals,
        creditsRemaining: profile.creditsRemaining,
        singleCredits: profile.singleCredits,
        parentEmail: profile.parentEmail,
        isParentView: profile.isParentView,
      },
      plans,
      upcoming,
      past,
      cancelled,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load dashboard" },
      { status: 500 },
    )
  }
}
