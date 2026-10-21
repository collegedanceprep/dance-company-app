import { NextResponse } from "next/server"
import { headers } from "next/headers"
import { randomUUID } from "crypto"
import { auth } from "@/lib/auth"
import { isAdminEmail } from "@/lib/roles"
import { db } from "@/lib/db"
import { user as userTable, creditAdjustment } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { appBase, TABLES, type ClientFields, type BookingFields, type PlanFields } from "@/lib/airtable"

// POST /api/admin/members/convert-to-parent
//
// Fixes the recurring "parent accidentally signed up as a dancer" case:
// a parent signs in (often via Sign in with Apple), gets treated as a new
// dancer, and ends up with their own Airtable Members record and possibly
// real purchases/bookings — instead of being linked as a parent to their
// actual dancer's account. This reassigns everything meaningful on the
// parent's phantom dancer record over to the real child, links the parent
// properly, and removes the phantom record — without ever deleting history,
// since bookings/plans are reassigned, not destroyed.
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!isAdminEmail(session.user.email)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { phantomMemberId, phantomUserId, phantomEmail, childEmail } = await req.json()
  if (!phantomMemberId || !phantomUserId || !phantomEmail || !childEmail) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 })
  }

  const safeChildEmail = String(childEmail).trim().toLowerCase().replace(/'/g, "\\'")
  const safePhantomEmail = String(phantomEmail).trim().toLowerCase()
  if (safeChildEmail === safePhantomEmail) {
    return NextResponse.json({ error: "The child's email must be different from the parent's own email." }, { status: 400 })
  }

  const childRecords = await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `LOWER(TRIM({Email})) = '${safeChildEmail}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  const child = childRecords[0]
  if (!child) return NextResponse.json({ error: "No dancer found with that email." }, { status: 404 })
  const childUserId = child.fields["User ID"] ?? ""
  const childEmailActual = child.fields.Email ?? childEmail

  const phantomRecords = await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `RECORD_ID() = '${phantomMemberId}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  const phantom = phantomRecords[0]

  // Reassign bookings so PrepMasters see the real dancer's name going forward.
  const safePhantomUserId = String(phantomUserId).replace(/'/g, "\\'")
  const phantomBookings = await appBase.list<BookingFields>(TABLES.bookings, {
    filterByFormula: `{User ID} = '${safePhantomUserId}'`,
    revalidate: 0,
  })
  for (const b of phantomBookings) {
    await appBase.update<BookingFields>(TABLES.bookings, b.id, {
      "User ID": childUserId,
      "Client Email": childEmailActual,
    })
  }

  // Reassign plan history the same way, so the credit trail stays coherent.
  const phantomPlans = await appBase.list<PlanFields>(TABLES.plans, {
    filterByFormula: `{User ID} = '${safePhantomUserId}'`,
    revalidate: 0,
  })
  for (const p of phantomPlans) {
    await appBase.update<PlanFields>(TABLES.plans, p.id, {
      "User ID": childUserId,
      "Member Email": childEmailActual,
    })
  }

  // Move any leftover credits sitting on the phantom record onto the child.
  let creditAdjustmentRecord = null as null | {
    id: string; memberRecordId: string; adminEmail: string; previousCredits: number; newCredits: number; createdAt: string
  }
  if (phantom) {
    const phantomPack = phantom.fields["Credits Remaining"] ?? 0
    const phantomSingle30 = phantom.fields["Single Credits 30"] ?? 0
    const phantomSingle45 = phantom.fields["Single Credits 45"] ?? 0
    const phantomSingle60 = phantom.fields["Single Credits 60"] ?? 0
    const phantomSingle90 = phantom.fields["Single Credits 90"] ?? 0

    if (phantomPack > 0 || phantomSingle30 > 0 || phantomSingle45 > 0 || phantomSingle60 > 0 || phantomSingle90 > 0) {
      const childPack = child.fields["Credits Remaining"] ?? 0
      const newPack = childPack + phantomPack
      await appBase.update<ClientFields>(TABLES.clients, child.id, {
        "Credits Remaining": newPack,
        "Single Credits 30": (child.fields["Single Credits 30"] ?? 0) + phantomSingle30,
        "Single Credits 45": (child.fields["Single Credits 45"] ?? 0) + phantomSingle45,
        "Single Credits 60": (child.fields["Single Credits 60"] ?? 0) + phantomSingle60,
        "Single Credits 90": (child.fields["Single Credits 90"] ?? 0) + phantomSingle90,
      })

      if (phantomPack > 0) {
        const id = randomUUID()
        const createdAt = new Date()
        await db.insert(creditAdjustment).values({
          id,
          memberRecordId: child.id,
          userId: childUserId,
          memberEmail: childEmailActual,
          adminEmail: session.user.email,
          previousCredits: childPack,
          newCredits: newPack,
          createdAt,
        })
        creditAdjustmentRecord = {
          id, memberRecordId: child.id, adminEmail: session.user.email,
          previousCredits: childPack, newCredits: newPack, createdAt: createdAt.toISOString(),
        }
      }
    }

    // Nothing meaningful should remain on the phantom record now that its
    // bookings, plans, and credits have all been moved — remove it so the
    // parent no longer shows up anywhere as a dancer.
    await appBase.destroy(TABLES.clients, phantom.id)
  }

  // Link the parent to this child for future purchases/bookings.
  await appBase.update<ClientFields>(TABLES.clients, child.id, { "Parent Email": phantomEmail })

  // Flag the parent's own login as a parent account — same effect as the
  // self-service "Signing up as a parent" flow, just triggered by an admin.
  await db.update(userTable).set({ isParentAccount: true, status: "active" }).where(eq(userTable.id, phantomUserId))

  return NextResponse.json({
    ok: true,
    childName: child.fields.Name ?? childEmail,
    bookingsMoved: phantomBookings.length,
    plansMoved: phantomPlans.length,
    adjustment: creditAdjustmentRecord,
  })
}
