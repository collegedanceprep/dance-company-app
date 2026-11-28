import { db } from "@/lib/db"
import { memberPhoto } from "@/lib/db/schema"
import { inArray } from "drizzle-orm"

export const PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"])
export const PHOTO_MAX_BYTES = 1_500_000

/** Relative URL for a dancer photo. `v` busts caches after a change. */
export function memberPhotoUrl(recordId: string, updatedAt: Date): string {
  return `/api/member-photo/${encodeURIComponent(recordId)}?v=${updatedAt.getTime()}`
}

/** Map of recordId → photo URL for the given members (only those with a photo). */
export async function getMemberPhotoUrls(recordIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(recordIds.filter(Boolean))]
  if (ids.length === 0) return {}
  const rows = await db
    .select({ recordId: memberPhoto.recordId, updatedAt: memberPhoto.updatedAt })
    .from(memberPhoto)
    .where(inArray(memberPhoto.recordId, ids))
  return Object.fromEntries(rows.map((r) => [r.recordId, memberPhotoUrl(r.recordId, r.updatedAt)]))
}
