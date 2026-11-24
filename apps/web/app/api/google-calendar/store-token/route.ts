import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { googleCalendarToken } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { randomUUID } from "crypto"

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { resolveRole } = await import("@/lib/roles")

  const body = await req.json().catch(() => ({})) as { accessToken?: string; refreshToken?: string; expiresIn?: number }
  if (!body.accessToken) return NextResponse.json({ error: "accessToken required" }, { status: 400 })

  const expiresAt = new Date(Date.now() + (body.expiresIn ?? 3600) * 1000)

  const existing = await db.select({ id: googleCalendarToken.id })
    .from(googleCalendarToken)
    .where(eq(googleCalendarToken.userId, session.user.id))

  if (existing.length > 0) {
    await db.update(googleCalendarToken)
      .set({
        accessToken: body.accessToken,
        ...(body.refreshToken ? { refreshToken: body.refreshToken } : {}),
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(googleCalendarToken.userId, session.user.id))
  } else {
    await db.insert(googleCalendarToken).values({
      id: randomUUID(),
      userId: session.user.id,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken ?? null,
      expiresAt,
    })
  }

  return NextResponse.json({ ok: true })
}
