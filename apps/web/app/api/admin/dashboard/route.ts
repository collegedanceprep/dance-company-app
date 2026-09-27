import { NextResponse } from "next/server"
import { headers } from "next/headers"

export const dynamic = "force-dynamic"
import { auth } from "@/lib/auth"
import { isAdminEmail } from "@/lib/roles"
import {
  adminGetAllMembers,
  adminGetAllBookings,
  adminGetAllWorkers,
  adminGetAllPlans,
  isAirtableConfigured,
} from "@/lib/airtable"
import { PACKAGES } from "@/lib/packages"
import { db } from "@/lib/db"
import { prepMasterInvite, user as userTable } from "@/lib/db/schema"
import { inArray, eq } from "drizzle-orm"

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdminEmail(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  if (!isAirtableConfigured()) {
    return NextResponse.json({ error: "Airtable not configured" }, { status: 503 })
  }

  try {
    const [members, bookings, workers, plans] = await Promise.all([
      adminGetAllMembers(),
      adminGetAllBookings(),
      adminGetAllWorkers(),
      adminGetAllPlans(),
    ])

    // Join invite status from DB so the mobile app shows Joined/Pending/Revoked correctly
    const emails = workers.map((w) => w.email.trim().toLowerCase()).filter(Boolean)
    const invites = emails.length > 0
      ? await db
          .select({ email: prepMasterInvite.email, status: prepMasterInvite.status })
          .from(prepMasterInvite)
          .where(inArray(prepMasterInvite.email, emails))
      : []
    const inviteMap = Object.fromEntries(invites.map((i) => [i.email.toLowerCase(), i.status]))
    const workersWithStatus = workers.map((w) => ({
      ...w,
      inviteStatus: (inviteMap[w.email.trim().toLowerCase()] ?? null) as "pending" | "accepted" | "revoked" | null,
    }))

    // Join pending account status from DB by email
    const memberEmails = members.map((m) => m.email.trim().toLowerCase()).filter(Boolean)
    const pendingUsers = memberEmails.length > 0
      ? await db
          .select({ email: userTable.email, status: userTable.status })
          .from(userTable)
          .where(inArray(userTable.email, memberEmails))
      : []
    const pendingMap = new Map(pendingUsers.map((u) => [u.email.toLowerCase(), u.status]))
    const membersWithStatus = members.map((m) => ({
      ...m,
      accountStatus: (pendingMap.get(m.email.trim().toLowerCase()) === "pending" ? "pending" : "active") as "pending" | "active",
    }))

    return NextResponse.json({ members: membersWithStatus, bookings, workers: workersWithStatus, plans, packages: PACKAGES }, {
      headers: { "Cache-Control": "no-store" },
    })
  } catch (err) {
    console.error("[admin/dashboard] error:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load dashboard" },
      { status: 500 },
    )
  }
}
