"use server"

import { randomUUID } from "crypto"
import { headers } from "next/headers"
import { revalidatePath, revalidateTag } from "next/cache"
import { auth } from "@/lib/auth"
import { isAdminEmail } from "@/lib/roles"
import { db } from "@/lib/db"
import { prepMasterInvite, user as userTable } from "@/lib/db/schema"
import { eq, inArray } from "drizzle-orm"
import {
  adminGetAllMembers,
  adminGetAllBookings,
  adminGetAllWorkers,
  adminAddCredits,
  adminAddSingleSessionCredits,
  adminGetAllPlans,
  adminUpdateWorker,
  adminDeleteWorker,
  adminCreateMember,
  adminCreateWorker,
  createMemberPlan,
  getActivePlanForUser,
  setPlanStatus,
  TABLES,
  appBase,
  type ClientFields,
  type AdminMember,
  type AdminBooking,
  type AdminWorker,
  type MemberPlan,
} from "@/lib/airtable"

const SINGLE_SESSION_PLANS: Record<string, { name: string; price: number; sessionType: string }> = {
  "90 min": { name: "90-Min Single", price: 169, sessionType: "private-90" },
  "60 min": { name: "60-Min Single", price: 119, sessionType: "private-60" },
  "45 min": { name: "45-Min Single", price: 89,  sessionType: "private-45" },
  "30 min": { name: "30-Min Single", price: 65,  sessionType: "private-30" },
}
import { PACKAGES, type DancePackage } from "@/lib/packages"

async function assertAdmin() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user || !isAdminEmail(session.user.email)) {
    throw new Error("Unauthorized")
  }
}

export async function getAdminData(): Promise<{
  members: AdminMember[]
  bookings: AdminBooking[]
  workers: AdminWorker[]
  plans: MemberPlan[]
  packages: DancePackage[]
}> {
  await assertAdmin()
  const [members, bookings, workers, plans] = await Promise.all([
    adminGetAllMembers(),
    adminGetAllBookings(),
    adminGetAllWorkers(),
    adminGetAllPlans(),
  ])

  // Exclude PrepMasters — they're in the Workers table and have their own portal
  const workerEmails = new Set(workers.map((w) => w.email.trim().toLowerCase()).filter(Boolean))

  // Also exclude anyone with a prepMasterInvite record — catches invitees not yet in Airtable Workers
  const invitedPrepMasters = await db
    .select({ email: prepMasterInvite.email })
    .from(prepMasterInvite)
  const prepMasterEmails = new Set([
    ...workerEmails,
    ...invitedPrepMasters.map((i) => i.email.toLowerCase()),
  ])

  // Tag members whose auth account is still pending
  const pendingUsers = await db
    .select({ email: userTable.email })
    .from(userTable)
    .where(eq(userTable.status, "pending"))
  const pendingEmails = new Set(pendingUsers.map((u) => u.email.toLowerCase()))
  const approvedMembers = members
    .filter((m) => !prepMasterEmails.has(m.email.toLowerCase()))
    .map((m) => ({
      ...m,
      accountStatus: (pendingEmails.has(m.email.toLowerCase()) ? "pending" : "active") as "pending" | "active",
    }))

  // Join invite status from DB onto each worker by email
  const emails = workers.map((w) => w.email.trim().toLowerCase()).filter(Boolean)
  const invites = emails.length > 0
    ? await db
        .select({ email: prepMasterInvite.email, status: prepMasterInvite.status })
        .from(prepMasterInvite)
        .where(inArray(prepMasterInvite.email, emails))
    : []
  const inviteMap = Object.fromEntries(invites.map((i) => [i.email.toLowerCase(), i.status]))

  // Auto-create pending invite records for workers who don't have one yet,
  // so they can sign in and the admin sees "Pending" instead of nothing.
  const workersWithoutInvite = workers.filter((w) => {
    const e = w.email.trim().toLowerCase()
    return e && !inviteMap[e]
  })
  if (workersWithoutInvite.length > 0) {
    await db
      .insert(prepMasterInvite)
      .values(
        workersWithoutInvite.map((w) => ({
          id: randomUUID(),
          email: w.email.trim().toLowerCase(),
          name: w.name,
          invitedBy: "system",
          status: "pending" as const,
        })),
      )
      .onConflictDoNothing()
    for (const w of workersWithoutInvite) {
      inviteMap[w.email.trim().toLowerCase()] = "pending"
    }
  }

  const workersWithStatus = workers.map((w) => ({
    ...w,
    inviteStatus: (inviteMap[w.email.trim().toLowerCase()] ?? null) as AdminWorker["inviteStatus"],
  }))

  return { members: approvedMembers, bookings, workers: workersWithStatus, plans, packages: PACKAGES }
}

export async function addComplimentaryCredits(
  member: { id: string; userId: string; email: string; creditsRemaining: number; singleCredits: import("@/lib/airtable").SingleCreditsByType },
  label: string,
): Promise<{ ok: true; plan: MemberPlan } | { ok: false; error: string }> {
  try {
    await assertAdmin()
    const sessionPlan = SINGLE_SESSION_PLANS[label]
    if (!sessionPlan) return { ok: false, error: "Invalid session label." }
    const minuteKey = label.replace(" min", "") as keyof import("@/lib/airtable").SingleCreditsByType
    const currentForType = member.singleCredits[minuteKey] ?? 0
    const plan = await createMemberPlan({
      userId: member.userId,
      memberEmail: member.email,
      planName: sessionPlan.name,
      sessions: 1,
      pricePaid: sessionPlan.price,
      source: "admin",
    })
    await adminAddSingleSessionCredits(member.id, sessionPlan.sessionType, currentForType)
    revalidatePath("/admin")
    revalidatePath("/dashboard")
    revalidateTag(`member-${member.userId}`, "max")
    return { ok: true, plan }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add session." }
  }
}

export async function adminAssignPlan(
  member: { id: string; userId: string; email: string; creditsRemaining: number },
  packageId: string,
): Promise<{ ok: true; plan: MemberPlan } | { ok: false; error: string }> {
  try {
    await assertAdmin()
    const pkg = PACKAGES.find((p) => p.id === packageId)
    if (!pkg) return { ok: false, error: "Invalid package." }

    // Mark any existing active plan as Inactive before assigning the new one
    const existingActive = await getActivePlanForUser(member.userId)
    if (existingActive) await setPlanStatus(existingActive.id, "Inactive")

    const plan = await createMemberPlan({
      userId: member.userId,
      memberEmail: member.email,
      planName: pkg.name,
      sessions: pkg.sessions,
      pricePaid: pkg.price,
      expiryDays: pkg.expiryDays,
      source: "admin",
    })

    // Add the package's sessions as credits on the member record
    await adminAddCredits(member.id, member.creditsRemaining, pkg.sessions)
    revalidatePath("/admin")
    revalidatePath("/dashboard")
    revalidateTag(`member-${member.userId}`, "max")
    return { ok: true, plan }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to assign plan.",
    }
  }
}

export async function updatePrepMaster(
  workerId: string,
  fields: {
    name?: string
    email?: string
    phone?: string
    region?: string
    address?: string
    university?: string
    hourlyRate?: number
    active?: boolean
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertAdmin()
    await adminUpdateWorker(workerId, fields)
    revalidateTag("admin")
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update PrepMaster.",
    }
  }
}

export async function deletePrepMaster(
  workerId: string,
  workerEmail: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertAdmin()
    // Delete from Airtable
    await adminDeleteWorker(workerId)
    // Delete DB user account if one exists
    const users = await db.select().from(userTable).where(eq(userTable.email, workerEmail))
    if (users[0]) {
      await db.delete(userTable).where(eq(userTable.id, users[0].id))
    }
    // Remove any pending invite record
    await db.delete(prepMasterInvite).where(eq(prepMasterInvite.email, workerEmail))
    revalidateTag("admin")
    revalidatePath("/admin")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to delete PrepMaster." }
  }
}

export async function createMember(input: {
  name: string
  email: string
  phone?: string
  goals?: string
  creditsRemaining?: number
}): Promise<{ ok: true; member: AdminMember } | { ok: false; error: string }> {
  try {
    await assertAdmin()
    if (!input.name.trim()) return { ok: false, error: "Name is required." }
    if (!input.email.trim()) return { ok: false, error: "Email is required." }
    const member = await adminCreateMember(input)
    revalidatePath("/admin")
    return { ok: true, member }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create member.",
    }
  }
}

export async function addPrepMaster(input: {
  name: string
  email: string
  phone?: string
  region?: string
  hourlyRate?: number
}): Promise<{ ok: true; worker: AdminWorker } | { ok: false; error: string }> {
  try {
    await assertAdmin()
    if (!input.name.trim()) return { ok: false, error: "Name is required." }
    const email = input.email.trim().toLowerCase()
    if (!email) return { ok: false, error: "Email is required." }

    // Create the Airtable Worker record
    const worker = await adminCreateWorker({ ...input, email })

    // Create or reactivate the DB invite so they can sign in as a PrepMaster
    const existing = await db
      .select({ id: prepMasterInvite.id, status: prepMasterInvite.status })
      .from(prepMasterInvite)
      .where(eq(prepMasterInvite.email, email))
      .limit(1)

    if (existing[0]) {
      if (existing[0].status === "revoked") {
        await db
          .update(prepMasterInvite)
          .set({ status: "pending", name: input.name.trim() })
          .where(eq(prepMasterInvite.id, existing[0].id))
      }
    } else {
      await db.insert(prepMasterInvite).values({
        id: randomUUID(),
        email,
        name: input.name.trim(),
        invitedBy: "admin",
        status: "pending",
      })
    }

    revalidatePath("/admin")
    return { ok: true, worker }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to add PrepMaster.",
    }
  }
}


export async function adminSetCredits(
  memberId: string,
  newCredits: number,
  userId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertAdmin()
    if (newCredits < 0 || newCredits > 9999) return { ok: false, error: "Invalid credit amount." }
    await appBase.update<ClientFields>(TABLES.clients, memberId, {
      "Credits Remaining": newCredits,
    })
    revalidatePath("/admin")
    revalidatePath("/dashboard")
    if (userId) revalidateTag(`member-${userId}`, "max")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to set credits." }
  }
}

export async function adminRemovePlan(
  planId: string,
  memberId: string,
  planSessions: number,
  currentCredits: number,
  userId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertAdmin()
    // Delete the plan record entirely so it stays gone after refresh
    await appBase.destroy(TABLES.plans, planId)
    // Deduct the plan's sessions from the member's credits (floor at 0)
    const newCredits = Math.max(0, currentCredits - planSessions)
    await appBase.update<ClientFields>(TABLES.clients, memberId, {
      "Credits Remaining": newCredits,
    })
    revalidatePath("/admin")
    revalidatePath("/dashboard")
    if (userId) revalidateTag(`member-${userId}`, "max")
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to remove plan." }
  }
}
