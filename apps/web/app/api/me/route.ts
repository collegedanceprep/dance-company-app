import { NextResponse } from "next/server"
import { getSessionUserWithRole } from "@/lib/roles"
import { db } from "@/lib/db"
import { user as userTable } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { TABLES, appBase, type ClientFields } from "@/lib/airtable"

export async function PATCH(req: Request) {
  const user = await getSessionUserWithRole()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { timezone } = await req.json() as { timezone?: string }
  if (!timezone || typeof timezone !== "string") return NextResponse.json({ error: "Invalid timezone" }, { status: 400 })
  await db.update(userTable).set({ timezone }).where(eq(userTable.id, user.id))
  return NextResponse.json({ ok: true })
}

export async function GET() {
  const user = await getSessionUserWithRole()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const [row] = await db.select({ status: userTable.status, isParentAccount: userTable.isParentAccount }).from(userTable).where(eq(userTable.id, user.id))
  // Default to "pending" when no row found — never let an unknown user through as active
  const status = row?.status ?? "pending"
  const isParentAccount = row?.isParentAccount ?? false

  // Check if this user is a parent (has children linked via Parent Email in Airtable)
  let isParent = false
  let effectiveStatus = status
  try {
    const safe = user.email.trim().toLowerCase().replace(/'/g, "\\'")
    const children = await appBase.list<ClientFields>(TABLES.clients, {
      filterByFormula: `LOWER({Parent Email}) = '${safe}'`,
      revalidate: 0,
    })
    isParent = children.length > 0
    // A parent account is only usable once at least one child is approved.
    // If every linked child is still pending/denied, treat the parent as pending too.
    if (isParent && status === "active") {
      const childUserIds = children
        .map((r) => (r as { fields: ClientFields }).fields?.["User ID"])
        .filter(Boolean) as string[]
      if (childUserIds.length > 0) {
        const { inArray } = await import("drizzle-orm")
        const childRows = await db
          .select({ status: userTable.status })
          .from(userTable)
          .where(inArray(userTable.id, childUserIds))
        const anyActive = childRows.some((r) => r.status === "active")
        if (!anyActive) effectiveStatus = "pending"
      } else {
        // No child has a User ID yet — all still pending
        effectiveStatus = "pending"
      }
    }
  } catch { /* non-fatal */ }

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: effectiveStatus,
    isParent,
    isParentAccount,
  })
}
