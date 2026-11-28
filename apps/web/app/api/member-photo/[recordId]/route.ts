import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { resolveRole } from "@/lib/roles"
import { db } from "@/lib/db"
import { memberPhoto } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

// GET a dancer's photo. Visible only to admins, PrepMasters, and the dancer/parent who owns it.
export async function GET(_req: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const role = await resolveRole(session.user.email)
  if (role !== "admin" && role !== "prep_master") {
    const { resolveClientProfile } = await import("@/lib/profile-core")
    const own = await resolveClientProfile(
      { id: session.user.id, email: session.user.email, name: session.user.name ?? "" },
      true,
    )
    if (own?.recordId !== recordId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const [row] = await db.select().from(memberPhoto).where(eq(memberPhoto.recordId, recordId))
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return new NextResponse(Buffer.from(row.data, "base64"), {
    headers: {
      "Content-Type": row.mime,
      // Private: never cached by shared caches. URLs carry ?v= so changes show up immediately.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  })
}
