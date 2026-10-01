import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { isAdminEmail } from "@/lib/roles"
import { appBase, TABLES, type ClientFields, getActivePlanForUser, setPlanStatus, createMemberPlan } from "@/lib/airtable"

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdminEmail(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { memberId, newCredits } = await req.json()
  if (typeof memberId !== "string" || !memberId) return NextResponse.json({ error: "Invalid memberId." }, { status: 400 })
  if (typeof newCredits !== "number" || newCredits < 0 || newCredits > 9999) {
    return NextResponse.json({ error: "Invalid credit amount." }, { status: 400 })
  }
  // Verify the record exists in the Clients table before writing
  const records = await appBase.list<ClientFields>(TABLES.clients, { filterByFormula: `RECORD_ID() = '${memberId}'`, maxRecords: 1, revalidate: 0 })
  const member = records[0]
  if (!member) return NextResponse.json({ error: "Member not found." }, { status: 404 })

  // If this is a manual increase, log it as a Plan record (same pattern as
  // the web admin panel's adminAssignPlan) so it shows up in Plan history
  // and correctly flips to "Used" once the booking flow drains the pool to
  // 0 — instead of being an invisible, untraceable credit.
  const currentCredits = member.fields["Credits Remaining"] ?? 0
  const delta = newCredits - currentCredits
  const userId = member.fields["User ID"]
  const memberEmail = member.fields.Email
  if (delta > 0 && userId && memberEmail) {
    const existingActive = await getActivePlanForUser(userId)
    if (existingActive) await setPlanStatus(existingActive.id, "Inactive")
    await createMemberPlan({
      userId,
      memberEmail,
      planName: "Admin-issued credit",
      sessions: delta,
      pricePaid: 0,
      source: "admin",
    })
  }

  await appBase.update<ClientFields>(TABLES.clients, memberId, { "Credits Remaining": newCredits })
  return NextResponse.json({ ok: true })
}
