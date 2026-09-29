import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { stripe } from "@/lib/stripe"
import { fulfillCheckoutSession } from "@/lib/stripe-fulfillment"

// Called by /purchase/success right after Stripe redirects back. Retrieves the
// session directly from Stripe (source of truth, no delay) and fulfills it
// synchronously so credits are guaranteed to exist before the member is ever
// told "purchase complete." Safe to call even if the async webhook already
// processed this session — fulfillCheckoutSession is idempotent.
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { sessionId } = await req.json() as { sessionId?: string }
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })

  let checkoutSession
  try {
    checkoutSession = await stripe.checkout.sessions.retrieve(sessionId)
  } catch {
    return NextResponse.json({ error: "Session not found" }, { status: 404 })
  }

  if (checkoutSession.payment_status !== "paid") {
    return NextResponse.json({ fulfilled: false, paymentStatus: checkoutSession.payment_status })
  }

  const result = await fulfillCheckoutSession(checkoutSession)
  return NextResponse.json({ fulfilled: result.fulfilled, paymentStatus: checkoutSession.payment_status })
}
