import { revalidateTag } from "next/cache"
import { sql } from "drizzle-orm"
import type Stripe from "stripe"
import {
  TABLES,
  appBase,
  createMemberPlan,
  type ClientFields,
} from "@/lib/airtable"
import { PACKAGES } from "@cdp/core"
import { createNotification } from "@/app/actions/notifications"
import { sendEmail, purchaseReceiptEmail } from "@/lib/email"
import { db } from "@/lib/db"
import { stripeWebhookProcessed } from "@/lib/db/schema"

// Stable 32-bit hash of a string → safe Postgres bigint for advisory locks
function advisoryLockKey(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

/**
 * Grants credits/plan for a completed Stripe Checkout session. Idempotent —
 * safe to call from both the Stripe webhook AND synchronously from the
 * /purchase/success page (whichever gets there first wins; the Postgres
 * unique insert on stripeSessionId makes the second call a no-op). This
 * lets the success page guarantee credits exist before ever telling the
 * member "purchase complete," instead of racing the async webhook delivery.
 */
export async function fulfillCheckoutSession(
  session: Stripe.Checkout.Session,
): Promise<{ fulfilled: boolean; alreadyProcessed: boolean }> {
  const { userId, userEmail, itemId, itemType, sessions, sessionType } = session.metadata ?? {}

  if (!userId || !sessions) {
    console.error("[fulfillCheckoutSession] Missing metadata", session.metadata)
    return { fulfilled: false, alreadyProcessed: false }
  }

  // Idempotency — Stripe may retry delivery, and the success page may race the
  // webhook. A Postgres unique insert atomically claims this session; whichever
  // caller loses the race just returns early.
  const stripeSessionId = session.id
  try {
    await db.insert(stripeWebhookProcessed).values({ stripeSessionId, userId })
  } catch {
    return { fulfilled: true, alreadyProcessed: true }
  }

  const SINGLE_CREDIT_FIELD_MAP: Record<string, keyof ClientFields> = {
    "private-30": "Single Credits 30",
    "private-45": "Single Credits 45",
    "private-60": "Single Credits 60",
    "private-90": "Single Credits 90",
  }
  const rawCount = parseInt(sessions, 10)
  // For packs: creditAmount is the number of pack credits.
  // For single sessions: creditAmount is always 1 (one session of that type).
  const creditAmount = itemType === "pack" ? rawCount : 1
  const pricePaid = (session.amount_total ?? 0) / 100

  // Find the member's Airtable record by User ID.
  // For parent accounts, the parent has no dancer record — look up their active child instead
  // so the credit lands on the child's record (which is what the booking flow checks).
  const safeId = userId.replace(/'/g, "\\'")
  let client = (await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `{User ID} = '${safeId}'`,
    maxRecords: 1,
  }))[0]

  if (!client && userEmail) {
    // Check if this is a parent purchasing on behalf of their child
    const safeEmail = userEmail.trim().toLowerCase().replace(/'/g, "\\'")
    const childRecords = await appBase.list<ClientFields>(TABLES.clients, {
      filterByFormula: `LOWER({Parent Email}) = '${safeEmail}'`,
      maxRecords: 1,
    })
    if (childRecords[0]) {
      client = childRecords[0]
    }
  }

  // Also check isParentAccount flag in DB — catches parents who signed up via the parent flow
  if (!client) {
    const { db: dbInst } = await import("@/lib/db")
    const { user: userTable } = await import("@/lib/db/schema")
    const { eq: eqOp } = await import("drizzle-orm")
    const [userRow] = await dbInst.select({ isParentAccount: userTable.isParentAccount, email: userTable.email })
      .from(userTable).where(eqOp(userTable.id, userId)).limit(1)
    if (userRow?.isParentAccount) {
      const safeEmail = (userRow.email ?? "").trim().toLowerCase().replace(/'/g, "\\'")
      const childRecords = await appBase.list<ClientFields>(TABLES.clients, {
        filterByFormula: `LOWER({Parent Email}) = '${safeEmail}'`,
        maxRecords: 1,
      })
      if (childRecords[0]) client = childRecords[0]
    }
  }

  // Non-parent new member: create a record so credits land.
  // Re-check by email first to avoid duplicate records from concurrent webhooks.
  if (!client && userEmail) {
    const safeEmail2 = userEmail.trim().toLowerCase().replace(/'/g, "\\'")
    const byEmail = (await appBase.list<ClientFields>(TABLES.clients, {
      filterByFormula: `LOWER({Email}) = '${safeEmail2}'`,
      maxRecords: 1,
    }))[0]
    if (byEmail) {
      client = byEmail
    } else {
      client = await appBase.create<ClientFields>(TABLES.clients, {
        Name: userEmail.split("@")[0],
        Email: userEmail,
        "User ID": userId,
        "Credits Remaining": 0,
      })
    }
  }

  // Use the child's User ID for plan/credit records when the purchaser is a parent
  const effectiveUserId = client?.fields["User ID"] || userId
  const effectiveEmail = client?.fields.Email || userEmail || ""

  // For single sessions, write to the type-specific field so the booking route
  // can enforce session-type locking. For packs, write to Credits Remaining.
  // Serialize concurrent webhooks for the same user with a Postgres advisory lock
  // so two rapid purchases don't both read the same stale value and both write +1.
  const singleField = sessionType ? SINGLE_CREDIT_FIELD_MAP[sessionType] : undefined
  let newBalance: number
  const lockKey = advisoryLockKey(effectiveUserId)
  await db.execute(sql`SELECT pg_advisory_lock(${lockKey}::bigint)`)
  try {
    if (client) {
      // Re-fetch the record inside the lock to get the latest value
      const fresh = (await appBase.list<ClientFields>(TABLES.clients, {
        filterByFormula: `{User ID} = '${effectiveUserId.replace(/'/g, "\\'")}'`,
        maxRecords: 1,
      }))[0] ?? client

      if (itemType !== "pack" && singleField) {
        const priorSingle = (fresh.fields[singleField] as number | undefined) ?? 0
        newBalance = priorSingle + 1
        await appBase.update<ClientFields>(TABLES.clients, fresh.id, {
          [singleField]: newBalance,
        } as Partial<ClientFields>)
      } else {
        const priorBalance = fresh.fields["Credits Remaining"] ?? 0
        newBalance = Math.round((priorBalance + creditAmount) * 100) / 100
        await appBase.update<ClientFields>(TABLES.clients, fresh.id, {
          "Credits Remaining": newBalance,
        })
      }
    } else {
      newBalance = creditAmount
    }
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${lockKey}::bigint)`)
  }

  // Create a Plan record in Airtable with the correct expiry
  const planName =
    itemType === "pack"
      ? `${rawCount}-Pack`
      : `Single ${sessionType?.replace("private-", "")}min`

  const matchedPackage = itemType === "pack"
    ? PACKAGES.find((p) => p.id === itemId) ?? PACKAGES.find((p) => p.sessions === rawCount)
    : undefined

  await createMemberPlan({
    userId: effectiveUserId,
    memberEmail: effectiveEmail,
    planName,
    sessions: creditAmount,
    pricePaid,
    source: "stripe",
    stripeSessionId,
    ...(matchedPackage?.expiryDays != null ? { expiryDays: matchedPackage.expiryDays } : {}),
  })

  // Bust the member's cached dashboard/profile data so the new credits show immediately
  revalidateTag(`member-${effectiveUserId}`, { expire: 0 })
  if (effectiveUserId !== userId) revalidateTag(`member-${userId}`, { expire: 0 })

  // In-app + push notification — send to the purchasing user (parent or dancer)
  createNotification({
    userId,
    type: "purchase_complete",
    title: "Purchase complete!",
    body: `Your ${planName} is ready. You have ${newBalance} credit${newBalance !== 1 ? "s" : ""} available.`,
    pushData: { route: "/member/plans" },
  }).catch(() => {})

  // Purchase receipt email — dancer is `to:`, parent CC'd if one exists
  if (userEmail) {
    const memberName = (client?.fields?.Name as string | undefined) ?? userEmail
    const parentCC = (client?.fields?.["Parent Email"] as string | undefined) ?? undefined
    const { subject, html } = purchaseReceiptEmail({ memberName, planName, creditAmount, pricePaid, newBalance })
    sendEmail({ to: userEmail, cc: parentCC, subject, html }).catch(() => {})
  }

  return { fulfilled: true, alreadyProcessed: false }
}
