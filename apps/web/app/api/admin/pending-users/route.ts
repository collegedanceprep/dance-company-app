import { NextResponse } from "next/server"
import { getSessionUserWithRole } from "@/lib/roles"
import { db } from "@/lib/db"
import { user as userTable, prepMasterInvite } from "@/lib/db/schema"
import { inArray } from "drizzle-orm"
import { adminGetAllWorkers } from "@/lib/airtable"

export async function GET() {
  const me = await getSessionUserWithRole()
  if (me?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const rows = await db
    .select({ id: userTable.id, name: userTable.name, email: userTable.email, status: userTable.status, createdAt: userTable.createdAt })
    .from(userTable)
    .where(inArray(userTable.status, ["pending", "denied"]))
    .orderBy(userTable.createdAt)

  if (rows.length === 0) return NextResponse.json([])

  const emails = rows.map((r) => r.email.toLowerCase())

  // Check both the invite table and Airtable workers — Airtable is the source of truth
  const [invites, workers] = await Promise.all([
    db
      .select({ email: prepMasterInvite.email })
      .from(prepMasterInvite)
      .where(inArray(prepMasterInvite.email, emails)),
    adminGetAllWorkers().catch(() => [] as { email: string }[]),
  ])

  const prepMasterEmails = new Set([
    ...invites.map((i) => i.email.toLowerCase()),
    ...workers.map((w) => w.email.trim().toLowerCase()),
  ])

  return NextResponse.json(
    rows.map((r) => ({
      ...r,
      accountType: prepMasterEmails.has(r.email.toLowerCase()) ? "prepmaster" : "member",
    }))
  )
}
