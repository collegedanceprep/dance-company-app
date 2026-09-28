import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { user as userTable } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  await db
    .update(userTable)
    .set({ isParentAccount: true, status: "active" })
    .where(eq(userTable.id, session.user.id))

  return NextResponse.json({ ok: true })
}
