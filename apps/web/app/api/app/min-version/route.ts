import { NextResponse } from "next/server"

// GET /api/app/min-version
// Returns the minimum required app version. Bump MIN_APP_VERSION in Vercel
// env vars to force all users below that version to update before continuing.
export async function GET() {
  return NextResponse.json(
    {
      minVersion: process.env.MIN_APP_VERSION ?? "1.0.0",
      appStoreUrl: "https://apps.apple.com/app/id6744042829",
    },
    {
      headers: {
        // Cache for 5 minutes so the app isn't hitting this on every render
        "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
      },
    }
  )
}
