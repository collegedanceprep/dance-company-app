import { NextRequest, NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { stripe } from "@/lib/stripe"
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

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET
if (!WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET env var is not set")

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get("stripe-signature") ?? ""

  let event
  try {
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET)
  } catch (err) {
    console.error("Stripe webhook signature failed:", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object
    const { userId, userEmail, itemId, itemType, sessions, sessionType } =
      session.metadata ?? {}

    if (!userId || !sessions) {
      console.error("Webhook missing metadata", session.metadata)
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 })
    }

    // Idempotency — Stripe may retry delivery; use a Postgres unique insert to atomically
    // claim this session. If two deliveries race, only one will succeed the insert.
    const stripeSessionId = session.id
    try {
      await db.insert(stripeWebhookProcessed).values({ stripeSessionId, userId })
    } catch {
      // Unique constraint violation — already processed
      return NextResponse.json({ received: true })
    }

    // For packs, metadata `sessions` is the credit count directly.
    // For single sessions, duration determines fractional credits (30min=0.5, 45min=0.75, 60min=1).
    const SINGLE_SESSION_CREDITS: Record<string, number> = {
      "private-30": 0.5,
      "private-45": 0.75,
      "private-60": 1,
      "private-90": 1.5,
    }
    const rawCount = parseInt(sessions, 10)
    const creditAmount =
      itemType === "pack"
        ? rawCount
        : (sessionType ? (SINGLE_SESSION_CREDITS[sessionType] ?? rawCount) : rawCount)
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

    // Non-parent new member: create a record so credits land
    if (!client && userEmail) {
      client = await appBase.create<ClientFields>(TABLES.clients, {
        Name: userEmail.split("@")[0],
        Email: userEmail,
        "User ID": userId,
        "Credits Remaining": 0,
      })
    }

    // Use the child's User ID for plan/credit records when the purchaser is a parent
    const effectiveUserId = client?.fields["User ID"] || userId
    const effectiveEmail = client?.fields.Email || userEmail || ""

    const priorBalance = client ? (client.fields["Credits Remaining"] ?? 0) : 0
    const newBalance = Math.round((priorBalance + creditAmount) * 100) / 100
    if (client) {
      await appBase.update<ClientFields>(TABLES.clients, client.id, {
        "Credits Remaining": newBalance,
      })
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
    revalidateTag(`member-${effectiveUserId}`)
    if (effectiveUserId !== userId) revalidateTag(`member-${userId}`)

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
  }

  return NextResponse.json({ received: true })
}
