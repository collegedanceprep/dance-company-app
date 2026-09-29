import "server-only"

import { cache } from "react"
import { headers } from "next/headers"
import { and, eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { prepMasterInvite, user } from "@/lib/db/schema"
import { getPrepMasterByEmail, adminUpdateWorker, isAirtableConfigured } from "@/lib/airtable"

export type Role = "admin" | "prep_master" | "dancer"

/**
 * The set of emails that should have admin access. Configured via the
 * ADMIN_EMAILS env var as a comma-separated list. Comparison is
 * case-insensitive. If unset, there are simply no admins (safe default).
 */
export function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email.trim().toLowerCase())
}

/**
 * The set of emails that should have access to the Ops Management tab
 * (company-wide bookings/scheduling view, no payment data). Configured via
 * the OPS_MANAGEMENT_EMAILS env var as a comma-separated list, same pattern
 * as ADMIN_EMAILS. If unset, no one has ops access (safe default).
 */
export function getOpsManagementEmails(): string[] {
  return (process.env.OPS_MANAGEMENT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isOpsManagementEmail(email: string): boolean {
  return getOpsManagementEmails().includes(email.trim().toLowerCase())
}

/** Returns true if the given email has an active prep master invite. */
export async function isInvitedPrepMaster(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase()
  const rows = await db
    .select({ status: prepMasterInvite.status })
    .from(prepMasterInvite)
    .where(eq(prepMasterInvite.email, normalized))
    .limit(1)
  const invite = rows[0]
  return Boolean(invite && invite.status !== "revoked")
}

/**
 * Returns true if the email belongs to an active record in the Airtable
 * Workers table. The Workers table is the source of truth for staff, so anyone
 * in it is treated as a prep master even without a separate invite.
 */
export async function isWorkerEmail(email: string): Promise<boolean> {
  if (!isAirtableConfigured()) return false
  try {
    return Boolean(await getPrepMasterByEmail(email))
  } catch {
    return false
  }
}

/** Determines a user's role from their email. */
export async function resolveRole(email: string): Promise<Role> {
  if (isAdminEmail(email)) return "admin"
  // Prep masters are recognized either by an admin invite OR by being present
  // in the Airtable Workers roster (the staff source of truth).
  // Run both checks in parallel to avoid sequential round trips.
  const [invited, worker] = await Promise.all([
    isInvitedPrepMaster(email),
    isWorkerEmail(email),
  ])
  if (invited || worker) return "prep_master"
  return "dancer"
}

export type SessionUserWithRole = {
  id: string
  name: string
  email: string
  image?: string | null
  role: Role
  status: string
}

/**
 * Fetches the current session user along with their resolved role.
 * Returns null when there is no authenticated session.
 */
export const getSessionUserWithRole = cache(async (): Promise<SessionUserWithRole | null> => {
  const t0 = Date.now()
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  const [role, dbUser] = await Promise.all([
    resolveRole(session.user.email),
    db.select({ status: user.status }).from(user).where(eq(user.id, session.user.id)).limit(1),
  ])
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
    role,
    status: dbUser[0]?.status ?? "active",
  }
})

/**
 * Marks a prep master's pending invite as accepted once they have signed in.
 * Safe to call on every portal visit; only updates rows still in "pending".
 */
export async function markInviteAccepted(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase()
  const result = await db
    .update(prepMasterInvite)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(
      and(
        eq(prepMasterInvite.email, normalized),
        eq(prepMasterInvite.status, "pending"),
      ),
    )
    .returning({ id: prepMasterInvite.id })

  // If a row was actually updated (first login), flip Active = true in Airtable
  if (result.length > 0 && isAirtableConfigured()) {
    try {
      const worker = await getPrepMasterByEmail(normalized)
      if (worker) await adminUpdateWorker(worker.id, { active: true })
    } catch {
      // Non-fatal — DB invite is already marked accepted
    }
  }
}

/** The landing route for each role after sign-in. */
export function homePathForRole(role: Role): string {
  switch (role) {
    case "admin":
      return "/admin"
    case "prep_master":
      return "/portal"
    default:
      return "/dashboard"
  }
}
