import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { resolveRole } from "@/lib/roles"
import { stripe, APP_URL } from "@/lib/stripe"
import { PACKAGES, PER_PRIVATE } from "@/lib/packages"
import { resolveClientProfile } from "@/lib/profile-core"

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const role = await resolveRole(session.user.email)
  if (role === "prep_master") return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { itemId } = await req.json()
  const pkg = PACKAGES.find((p) => p.id === itemId)
  const perPrivate = !pkg ? PER_PRIVATE.find((s) => s.id === itemId) : null
  const item = pkg ?? perPrivate
  if (!item) return NextResponse.json({ error: "Unknown item." }, { status: 400 })

  // Resolve the effective profile — if this is a parent account, credits and
  // plan records must go to the child's userId, not the parent's own account.
  const profile = await resolveClientProfile(
    { id: session.user.id, email: session.user.email, name: session.user.name ?? "" },
    true, // noCreate — never auto-create a record from the checkout route
  )
  const effectiveUserId = profile.effectiveUserId || session.user.id
  const effectiveEmail = profile.email || session.user.email

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: item.price * 100,
          product_data: {
            name: pkg
              ? `${pkg.name} — ${pkg.sessions} hourly private sessions`
              : `${perPrivate!.name} private session`,
            description: pkg
              ? `${pkg.sessions} one-on-one prep sessions with your choice of PrepMaster`
              : `${perPrivate!.minutes}-minute one-on-one prep session`,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      userId: effectiveUserId,
      userEmail: effectiveEmail,
      itemId,
      itemType: pkg ? "pack" : "per-private",
      sessions: pkg ? String(pkg.sessions) : "1",
      sessionType: pkg ? "private-60" : perPrivate!.id,
    },
    allow_promotion_codes: true,
    customer_email: session.user.email,
    success_url: `${APP_URL}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/dashboard/packages`,
  })

  return NextResponse.json({ url: checkoutSession.url })
}
