import { NextRequest, NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { fulfillCheckoutSession } from "@/lib/stripe-fulfillment"

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
    if (!session.metadata?.userId || !session.metadata?.sessions) {
      console.error("Webhook missing metadata", session.metadata)
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 })
    }
    try {
      await fulfillCheckoutSession(session)
    } catch (err) {
      // A 2xx here tells Stripe delivery succeeded and it will never retry —
      // a real failure must return non-2xx so Stripe's retry schedule can
      // give this paid session another chance instead of silently dropping it.
      console.error("[stripe/webhook] fulfillment failed for session", session.id, err)
      return NextResponse.json({ error: "Fulfillment failed" }, { status: 500 })
    }
  }

  return NextResponse.json({ received: true })
}
