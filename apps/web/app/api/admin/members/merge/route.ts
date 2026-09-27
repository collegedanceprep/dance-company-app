import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { isAdminEmail } from "@/lib/roles"
import { db } from "@/lib/db"
import { user as userTable, account, session, notification, pushToken } from "@/lib/db/schema"
import { eq, and, ne } from "drizzle-orm"
import { appBase, TABLES } from "@/lib/airtable"

// POST /api/admin/members/merge
// Merges `fromId` into `intoId`: moves all auth methods, notifications, and
// push tokens from the source user to the target, updates Airtable, then
// deletes the source user.
export async function POST(req: Request) {
  const session_ = await auth.api.getSession({ headers: await headers() })
  if (!session_?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdminEmail(session_.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { fromId, intoId } = await req.json()
  if (!fromId || !intoId) return NextResponse.json({ error: "fromId and intoId are required." }, { status: 400 })
  if (fromId === intoId) return NextResponse.json({ error: "Cannot merge an account with itself." }, { status: 400 })

  const [fromUser] = await db.select().from(userTable).where(eq(userTable.id, fromId)).limit(1)
  const [intoUser] = await db.select().from(userTable).where(eq(userTable.id, intoId)).limit(1)
  if (!fromUser || !intoUser) return NextResponse.json({ error: "One or both users not found." }, { status: 404 })

  // Move account records (skip if intoUser already has the same providerId to avoid conflicts)
  const intoAccounts = await db.select({ providerId: account.providerId }).from(account).where(eq(account.userId, intoId))
  const intoProviders = new Set(intoAccounts.map((a) => a.providerId))
  const fromAccounts = await db.select().from(account).where(eq(account.userId, fromId))
  for (const a of fromAccounts) {
    if (intoProviders.has(a.providerId)) {
      // Target already has this provider — just drop the duplicate
      await db.delete(account).where(eq(account.id, a.id))
    } else {
      await db.update(account).set({ userId: intoId }).where(eq(account.id, a.id))
    }
  }

  // Move notifications and push tokens
  await db.update(notification).set({ userId: intoId }).where(eq(notification.userId, fromId))
  await db.update(pushToken).set({ userId: intoId }).where(eq(pushToken.userId, fromId))

  // Ensure the target account is active
  await db.update(userTable).set({ status: "active" }).where(eq(userTable.id, intoId))

  // Update Airtable: reassign any member record pointing at fromId → intoId and email
  try {
    const safe = fromId.replace(/'/g, "\\'")
    const records = await appBase.list(TABLES.clients, {
      filterByFormula: `{User ID} = '${safe}'`,
      maxRecords: 5,
      revalidate: 0,
    })
    for (const rec of records) {
      await appBase.update(TABLES.clients, rec.id, {
        "User ID": intoId,
        "Email": intoUser.email,
      })
    }
  } catch { /* non-fatal — admin can fix Airtable manually */ }

  // Delete the source user (cascades sessions)
  await db.delete(userTable).where(eq(userTable.id, fromId))

  return NextResponse.json({ ok: true, mergedInto: intoUser.email })
}
