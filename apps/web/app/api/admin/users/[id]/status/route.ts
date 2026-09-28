import { NextResponse } from "next/server"
import { getSessionUserWithRole } from "@/lib/roles"
import { db } from "@/lib/db"
import { user as userTable, prepMasterInvite } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createNotification } from "@/app/actions/notifications"
import { sendPushToUser } from "@/lib/push"
import { appBase, TABLES } from "@/lib/airtable"
import type { ClientFields } from "@/lib/airtable"
import { sendEmail, accountApprovedEmail, accountDeniedEmail, prepMasterApprovedEmail, parentAccountApprovedEmail } from "@/lib/email"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.collegedanceprep.com"

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getSessionUserWithRole()
  if (me?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id } = await params
  const { status } = await req.json() as { status: "active" | "denied" }
  if (status !== "active" && status !== "denied") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 })
  }

  const [target] = await db.select().from(userTable).where(eq(userTable.id, id)).limit(1)
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })

  await db.update(userTable).set({
    status,
    updatedAt: new Date(),
    approvedBy: me.email,
    approvedAt: new Date(),
  }).where(eq(userTable.id, id))

  // Check if this user is a PrepMaster — they must not get a member (client) record
  let isPrepMaster = false
  try {
    const [invite] = await db
      .select({ id: prepMasterInvite.id })
      .from(prepMasterInvite)
      .where(eq(prepMasterInvite.email, target.email.toLowerCase()))
      .limit(1)
    isPrepMaster = Boolean(invite)
  } catch { /* non-fatal */ }

  const safeEmail = target.email.toLowerCase().replace(/'/g, "\\'")

  // When approving a member (not a PrepMaster), ensure an Airtable client record exists.
  // Skip if this email is already a Parent Email on someone else's record — they're a parent
  // account and should see their child's profile, not get their own member record.
  let parentEmail: string | null = null
  if (status === "active" && !isPrepMaster) {
    try {
      const [existing, asParent] = await Promise.all([
        appBase.list<ClientFields>(TABLES.clients, {
          filterByFormula: `{User ID} = '${id.replace(/'/g, "\\'")}'`,
          maxRecords: 1,
          revalidate: 0,
        }),
        appBase.list<ClientFields>(TABLES.clients, {
          filterByFormula: `LOWER({Parent Email}) = '${safeEmail}'`,
          maxRecords: 1,
          revalidate: 0,
        }),
      ])
      const isParent = asParent.length > 0
      if (existing.length === 0 && !isParent) {
        const created = await appBase.create<ClientFields>(TABLES.clients, {
          Name: target.name,
          Email: target.email,
          "User ID": id,
          "Credits Remaining": 0,
        })
        // Grab parent email from the newly created record if present
        parentEmail = (created as { fields?: ClientFields })?.fields?.["Parent Email"] ?? null
      } else if (existing.length > 0) {
        parentEmail = (existing[0] as { fields?: ClientFields })?.fields?.["Parent Email"] ?? null
      }
    } catch {
      // Non-fatal — member will be created on first dashboard load
    }
  }

  // On deny, delete the Airtable Members record so it doesn't linger in the tab
  if (status === "denied") {
    try {
      const records = await appBase.list<ClientFields>(TABLES.clients, {
        filterByFormula: `LOWER({Email}) = '${safeEmail}'`,
        maxRecords: 1,
        revalidate: 0,
      })
      if (records[0]) await appBase.destroy(TABLES.clients, records[0].id)
      else console.warn("[deny] no Airtable member record found for", safeEmail)
    } catch (e) {
      console.error("[deny] failed to delete Airtable member record for", safeEmail, e)
    }
  }

  // Notify the user
  const title = status === "active" ? "Account approved!" : "Account not approved"
  const body = status === "active"
    ? isPrepMaster
      ? "Your College Dance Prep account has been approved. You can now access the PrepMaster portal."
      : "Your College Dance Prep account has been approved. You can now book sessions."
    : "Your account request was not approved. Contact us if you think this is a mistake."

  const route = status === "active" ? (isPrepMaster ? "/portal" : "/member") : "/"
  createNotification({ userId: id, type: `account_${status}`, title, body }).catch(() => {})
  sendPushToUser(id, { title, body, data: { type: `account_${status}`, route } }).catch(() => {})

  // Send status email — dancer is primary `to:`, parent CC'd if one exists
  if (status === "active") {
    const dashboardUrl = `${APP_URL}/dashboard`
    const portalUrl = `${APP_URL}/portal`
    const approvalEmail = isPrepMaster
      ? prepMasterApprovedEmail({ prepMasterName: target.name, portalUrl })
      : accountApprovedEmail({ memberName: target.name, dashboardUrl })
    sendEmail({ to: target.email, cc: parentEmail ?? undefined, subject: approvalEmail.subject, html: approvalEmail.html }).catch(() => {})
    // Also send the parent their own approval email if a parent email is on record
    if (parentEmail && !isPrepMaster) {
      const { subject, html } = parentAccountApprovedEmail({ childName: target.name, parentEmail, dashboardUrl: `${APP_URL}/dashboard` })
      sendEmail({ to: parentEmail, subject, html }).catch(() => {})
    }
  } else {
    // Look up parent email for denied accounts too
    let deniedParentEmail: string | null = null
    try {
      const safeEmail = target.email.toLowerCase().replace(/'/g, "\\'")
      const asParent = await appBase.list<ClientFields>(TABLES.clients, {
        filterByFormula: `LOWER({Parent Email}) = '${safeEmail}'`,
        maxRecords: 1,
        revalidate: 0,
      })
      if (!asParent.length) {
        const byEmail = await appBase.list<ClientFields>(TABLES.clients, {
          filterByFormula: `LOWER({Email}) = '${safeEmail}'`,
          maxRecords: 1,
          revalidate: 0,
        })
        deniedParentEmail = byEmail[0]?.fields?.["Parent Email"] ?? null
      }
    } catch { /* non-fatal */ }
    const { subject, html } = accountDeniedEmail({ memberName: target.name })
    sendEmail({ to: target.email, cc: deniedParentEmail ?? undefined, subject, html }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
