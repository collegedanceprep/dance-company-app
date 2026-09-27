import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import { isAdminEmail } from "@/lib/roles"
import {
  adminAddCredits,
  adminAddSingleSessionCredits,
  createMemberPlan,
  getActivePlanForUser,
  setPlanStatus,
  appBase,
  TABLES,
  type ClientFields,
} from "@/lib/airtable"
import { PACKAGES } from "@/lib/packages"

const SINGLE_SESSION_PLANS: Record<string, { name: string; price: number; sessionType: string }> = {
  "90 min": { name: "90-Min Single", price: 169, sessionType: "private-90" },
  "60 min": { name: "60-Min Single", price: 119, sessionType: "private-60" },
  "45 min": { name: "45-Min Single", price: 89,  sessionType: "private-45" },
  "30 min": { name: "30-Min Single", price: 65,  sessionType: "private-30" },
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdminEmail(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const body = await req.json()
  const { memberId, userId, email, packageId, label } = body

  if (typeof memberId !== "string" || !memberId) return NextResponse.json({ error: "Invalid memberId." }, { status: 400 })

  // Verify the memberId points to a real Clients record before any write
  const memberRecords = await appBase.list(TABLES.clients, { filterByFormula: `RECORD_ID() = '${memberId}'`, maxRecords: 1, revalidate: 0 })
  if (!memberRecords[0]) return NextResponse.json({ error: "Member not found." }, { status: 404 })
  // currentCredits must come from the verified record, never from the client
  const currentCredits = (memberRecords[0].fields as any)["Credits Remaining"] ?? 0

  if (label) {
    // Add single session — writes to the per-type field, not pack credits
    const sessionPlan = SINGLE_SESSION_PLANS[label]
    if (!sessionPlan) return NextResponse.json({ error: "Invalid session label." }, { status: 400 })
    const plan = await createMemberPlan({
      userId,
      memberEmail: email,
      planName: sessionPlan.name,
      sessions: 1,
      pricePaid: sessionPlan.price,
    })
    const currentSingle = (memberRecords[0].fields as ClientFields)[
      ({ "private-30": "Single Credits 30", "private-45": "Single Credits 45", "private-60": "Single Credits 60", "private-90": "Single Credits 90" } as Record<string, keyof ClientFields>)[sessionPlan.sessionType]
    ] as number | undefined ?? 0
    await adminAddSingleSessionCredits(memberId, sessionPlan.sessionType, currentSingle)
    return NextResponse.json({ plan })
  }

  if (packageId) {
    // Assign package plan
    const pkg = PACKAGES.find((p) => p.id === packageId)
    if (!pkg) return NextResponse.json({ error: "Invalid package." }, { status: 400 })
    const existingActive = await getActivePlanForUser(userId)
    if (existingActive) await setPlanStatus(existingActive.id, "Inactive")
    const plan = await createMemberPlan({
      userId,
      memberEmail: email,
      planName: pkg.name,
      sessions: pkg.sessions,
      pricePaid: pkg.price,
      expiryDays: pkg.expiryDays,
    })
    await adminAddCredits(memberId, currentCredits, pkg.sessions)
    return NextResponse.json({ plan })
  }

  return NextResponse.json({ error: "Must provide packageId or label." }, { status: 400 })
}

export async function DELETE(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdminEmail(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { planId, memberId, planSessions } = await req.json()
  if (typeof planId !== "string" || !planId) return NextResponse.json({ error: "Invalid planId." }, { status: 400 })
  if (typeof memberId !== "string" || !memberId) return NextResponse.json({ error: "Invalid memberId." }, { status: 400 })

  // Verify both records exist before writing
  const [planRecords, clientRecords] = await Promise.all([
    appBase.list(TABLES.plans, { filterByFormula: `RECORD_ID() = '${planId}'`, maxRecords: 1, revalidate: 0 }),
    appBase.list(TABLES.clients, { filterByFormula: `RECORD_ID() = '${memberId}'`, maxRecords: 1, revalidate: 0 }),
  ])
  if (!planRecords[0]) return NextResponse.json({ error: "Plan not found." }, { status: 404 })
  if (!clientRecords[0]) return NextResponse.json({ error: "Member not found." }, { status: 404 })

  const planFields = planRecords[0].fields as any
  const planSessionsFromRecord = planFields["Sessions"] ?? 0
  const planName: string = planFields["Plan Name"] ?? ""
  await appBase.destroy(TABLES.plans, planId)

  // Detect single-session plans by their name pattern and deduct from the correct field
  const singleMinMatch = planName.match(/^(\d+)-Min Single/i)
  if (singleMinMatch) {
    const minKey = singleMinMatch[1]
    const fieldMap: Record<string, string> = { "30": "Single Credits 30", "45": "Single Credits 45", "60": "Single Credits 60", "90": "Single Credits 90" }
    const field = fieldMap[minKey]
    if (field) {
      const current = (clientRecords[0].fields as any)[field] ?? 0
      const newVal = Math.max(0, current - 1)
      await appBase.update(TABLES.clients, memberId, { [field]: newVal })
      return NextResponse.json({ ok: true })
    }
  }

  const currentCredits = (clientRecords[0].fields as any)["Credits Remaining"] ?? 0
  const newCredits = Math.max(0, currentCredits - planSessionsFromRecord)
  await appBase.update(TABLES.clients, memberId, { "Credits Remaining": newCredits })
  return NextResponse.json({ ok: true, newCredits })
}
