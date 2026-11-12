import "server-only"
import { db } from "@/lib/db"
import { user as userTable } from "@/lib/db/schema"
import { inArray } from "drizzle-orm"
import { appBase, TABLES, type ClientFields } from "@/lib/airtable"

/** A name that is blank, an email, or just the first part of the account's email. */
export function isPlaceholderName(name: string | undefined | null, email: string | undefined | null): boolean {
  const n = (name ?? "").trim().toLowerCase()
  if (!n) return true
  if (n.includes("@")) return true
  const local = (email ?? "").split("@")[0]?.trim().toLowerCase()
  return Boolean(local) && n === local
}

export type NameFix = { recordId: string; from: string; to: string }

/**
 * Finds Airtable Members whose Name is a placeholder (blank / email / email
 * prefix — what Apple private-relay signups end up with when the real name
 * arrives late) while the app account has a real name, and returns the fixes.
 */
export async function findNameFixes(): Promise<NameFix[]> {
  const members = await appBase.list<ClientFields>(TABLES.clients, { revalidate: 0 })
  const candidates = members.filter(
    (m) => m.fields["User ID"] && isPlaceholderName(m.fields.Name, m.fields.Email),
  )
  if (candidates.length === 0) return []

  const ids = candidates.map((m) => m.fields["User ID"] as string)
  const users = await db
    .select({ id: userTable.id, name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(inArray(userTable.id, ids))
  const byId = new Map(users.map((u) => [u.id, u]))

  const fixes: NameFix[] = []
  for (const m of candidates) {
    const u = byId.get(m.fields["User ID"] as string)
    if (!u) continue
    const real = u.name?.trim()
    if (!real || isPlaceholderName(real, u.email) || isPlaceholderName(real, m.fields.Email)) continue
    fixes.push({ recordId: m.id, from: m.fields.Name ?? "", to: real })
  }
  return fixes
}

export async function applyNameFixes(fixes: NameFix[]): Promise<number> {
  let done = 0
  for (const f of fixes) {
    try {
      await appBase.update<ClientFields>(TABLES.clients, f.recordId, { Name: f.to })
      done++
    } catch (e) {
      console.error("[name-backfill] failed", f.recordId, e)
    }
  }
  return done
}
