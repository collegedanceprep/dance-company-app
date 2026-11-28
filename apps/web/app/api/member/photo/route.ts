import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { resolveRole } from "@/lib/roles"
import { db } from "@/lib/db"
import { memberPhoto } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { PHOTO_MAX_BYTES, PHOTO_MIME, memberPhotoUrl } from "@/lib/member-photo"

// Only dancers (and parents acting for their child, who resolve as dancers) may set a photo.
// The target record is always derived from the session, never from the request body.
async function resolveOwnRecord() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  if ((await resolveRole(session.user.email)) !== "dancer") {
    return { error: NextResponse.json({ error: "Only dancers can set a profile photo" }, { status: 403 }) }
  }
  const { resolveClientProfile } = await import("@/lib/profile-core")
  const profile = await resolveClientProfile(
    { id: session.user.id, email: session.user.email, name: session.user.name ?? "" },
    true,
  )
  if (!profile?.recordId) return { error: NextResponse.json({ error: "Profile not found" }, { status: 404 }) }
  return { recordId: profile.recordId }
}

// POST { mime, base64 } — set or replace the photo
export async function POST(req: NextRequest) {
  const r = await resolveOwnRecord()
  if ("error" in r) return r.error

  const body = (await req.json().catch(() => ({}))) as { mime?: string; base64?: string }
  const mime = body.mime ?? ""
  const base64 = (body.base64 ?? "").replace(/^data:[^,]+,/, "")
  if (!PHOTO_MIME.has(mime) || !base64) {
    return NextResponse.json({ error: "Send a JPEG, PNG or WebP image" }, { status: 400 })
  }
  const bytes = Buffer.from(base64, "base64")
  if (bytes.length === 0 || bytes.length > PHOTO_MAX_BYTES) {
    return NextResponse.json({ error: "Photo is too large" }, { status: 413 })
  }
  // Check the magic bytes so a non-image can't be stored under an image type.
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50
  const isWebp = bytes.subarray(8, 12).toString("ascii") === "WEBP"
  if (!isJpeg && !isPng && !isWebp) return NextResponse.json({ error: "Not a valid image" }, { status: 400 })

  const updatedAt = new Date()
  const data = bytes.toString("base64")
  await db
    .insert(memberPhoto)
    .values({ recordId: r.recordId, mime, data, updatedAt })
    .onConflictDoUpdate({ target: memberPhoto.recordId, set: { mime, data, updatedAt } })

  return NextResponse.json({ ok: true, photoUrl: memberPhotoUrl(r.recordId, updatedAt) })
}

// DELETE — remove the photo
export async function DELETE() {
  const r = await resolveOwnRecord()
  if ("error" in r) return r.error
  await db.delete(memberPhoto).where(eq(memberPhoto.recordId, r.recordId))
  return NextResponse.json({ ok: true })
}
