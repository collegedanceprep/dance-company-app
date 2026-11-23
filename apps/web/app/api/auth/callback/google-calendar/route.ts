import { NextRequest, NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { saveCalendarTokens, verifyState } from "@/lib/google-calendar"

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get("code")
  const rawState = searchParams.get("state") ?? ""
  const signedPayload = verifyState(rawState)
  const [userId, source, role] = (signedPayload ?? rawState).split(":")
  const isMobile = source === "mobile"
  const mobileRole = role ?? "portal"
  const webReturn = role === "member" ? "/dashboard" : "/portal"

  if (searchParams.get("error")) console.error("Calendar consent returned error:", searchParams.get("error"))
  if (!code || !userId || !signedPayload) {
    if (isMobile) return NextResponse.redirect(`cdp://${mobileRole}/profile?calendar=error`)
    return NextResponse.redirect(new URL(`${webReturn}?calendar=error`, req.url))
  }

  // The state is signed by us, so it can't be forged for another user. The web flow additionally
  // requires the browser session to match (blocks login-CSRF). Mobile can't: its in-app browser
  // often has no session cookie, which made connecting fail for app-only users.
  if (!isMobile) {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user || session.user.id !== userId) {
      return NextResponse.redirect(new URL(`${webReturn}?calendar=error`, req.url))
    }
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/google-calendar`,
      grant_type: "authorization_code",
    }),
  })

  if (!res.ok) {
    console.error("Token exchange failed:", await res.text())
    if (isMobile) return NextResponse.redirect(`cdp://${mobileRole}/profile?calendar=error`)
    return NextResponse.redirect(new URL(`${webReturn}?calendar=error`, req.url))
  }

  const data = await res.json()
  await saveCalendarTokens(userId, data.access_token, data.refresh_token, data.expires_in)

  if (isMobile) return NextResponse.redirect(`cdp://${mobileRole}/profile?calendar=connected`)
  return NextResponse.redirect(new URL(`${webReturn}?calendar=connected`, req.url))
}
