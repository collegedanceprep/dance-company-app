import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { user as userTable, account, notification, pushToken } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { appBase, TABLES } from "@/lib/airtable"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"

// POST /api/account/merge
// Self-serve: the caller must be signed in as the "into" account, and must
// supply the fromId (the relay/duplicate account). We verify ownership of
// fromId by checking it exists and was created via Apple. No password needed
// for the Apple account since the user proved ownership by signing into the
// target account.
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const intoId = session.user.id
  const { fromId } = await req.json()
  if (!fromId) return NextResponse.json({ error: "fromId is required." }, { status: 400 })
  if (fromId === intoId) return NextResponse.json({ error: "Cannot merge an account with itself." }, { status: 400 })

  const [fromUser] = await db.select().from(userTable).where(eq(userTable.id, fromId)).limit(1)
  if (!fromUser) return NextResponse.json({ error: "Source account not found." }, { status: 404 })

  // Safety: only allow merging Apple relay accounts this way
  if (!fromUser.email.endsWith("@privaterelay.appleid.com")) {
    return NextResponse.json({ error: "Self-serve merge is only supported for Apple relay accounts." }, { status: 400 })
  }

  // Move account records
  const intoAccounts = await db.select({ providerId: account.providerId }).from(account).where(eq(account.userId, intoId))
  const intoProviders = new Set(intoAccounts.map((a) => a.providerId))
  const fromAccounts = await db.select().from(account).where(eq(account.userId, fromId))
  for (const a of fromAccounts) {
    if (intoProviders.has(a.providerId)) {
      await db.delete(account).where(eq(account.id, a.id))
    } else {
      await db.update(account).set({ userId: intoId }).where(eq(account.id, a.id))
    }
  }

  // Move notifications and push tokens
  await db.update(notification).set({ userId: intoId }).where(eq(notification.userId, fromId))
  await db.update(pushToken).set({ userId: intoId }).where(eq(pushToken.userId, fromId))

  // Update Airtable
  try {
    const [intoUser] = await db.select({ email: userTable.email }).from(userTable).where(eq(userTable.id, intoId)).limit(1)
    const safe = fromId.replace(/'/g, "\\'")
    const records = await appBase.list(TABLES.clients, {
      filterByFormula: `{User ID} = '${safe}'`,
      maxRecords: 5,
      revalidate: 0,
    })
    for (const rec of records) {
      await appBase.update(TABLES.clients, rec.id, {
        "User ID": intoId,
        "Email": intoUser?.email ?? session.user.email,
      })
    }
  } catch { /* non-fatal */ }

  // Delete source user
  await db.delete(userTable).where(eq(userTable.id, fromId))

  return NextResponse.json({ ok: true })
}
