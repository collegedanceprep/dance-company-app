import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { resolveClientProfile } from "@/lib/profile-core"
import { TABLES, appBase, type ClientFields } from "@/lib/airtable"

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const user = session.user

  // Raw Airtable record
  const safeId = user.id.replace(/'/g, "\\'")
  const rawRecords = await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `{User ID} = '${safeId}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  const rawRecord = rawRecords[0] ?? null

  // Resolved profile (what the booking route sees)
  const profile = await resolveClientProfile({ id: user.id, email: user.email, name: user.name ?? "" }, true)

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    rawRecordId: rawRecord?.id ?? null,
    rawFields: rawRecord ? {
      "User ID": rawRecord.fields["User ID"],
      "Credits Remaining": rawRecord.fields["Credits Remaining"],
      "Single Credits 30": rawRecord.fields["Single Credits 30"],
      "Single Credits 45": rawRecord.fields["Single Credits 45"],
      "Single Credits 60": rawRecord.fields["Single Credits 60"],
      "Single Credits 90": rawRecord.fields["Single Credits 90"],
    } : null,
    resolvedProfile: {
      recordId: profile.recordId,
      creditsRemaining: profile.creditsRemaining,
      singleCredits: profile.singleCredits,
      isParentView: profile.isParentView,
      effectiveUserId: profile.effectiveUserId,
    },
  })
}
