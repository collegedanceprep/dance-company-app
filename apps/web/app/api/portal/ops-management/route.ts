import { NextRequest, NextResponse } from "next/server"
import { getSessionUserWithRole, isOpsManagementEmail } from "@/lib/roles"
import { getPrepMasters, getMonthBookingsForTeam, isAirtableConfigured } from "@/lib/airtable"

export async function GET(req: NextRequest) {
  const user = await getSessionUserWithRole()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  if (!isAirtableConfigured()) {
    return NextResponse.json({ error: "Airtable not configured" }, { status: 503 })
  }

  const isAdmin = user.role === "admin"
  const isOps = isOpsManagementEmail(user.email)

  if (!isAdmin && !isOps) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const now = new Date()
  const year  = parseInt(searchParams.get("year")  ?? String(now.getFullYear()), 10)
  const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1), 10)

  const allPMs = await getPrepMasters()
  const summaries = allPMs.length
    ? await getMonthBookingsForTeam(allPMs.map((pm) => pm.name), year, month)
    : []

  const pmMap = new Map(allPMs.map((pm) => [pm.name, pm]))
  const result = summaries.map((s) => ({
    pm: pmMap.get(s.pm.name) ?? s.pm,
    bookings: s.bookings,
  }))

  return NextResponse.json({ team: result, year, month })
}
