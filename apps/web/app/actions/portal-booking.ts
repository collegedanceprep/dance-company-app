"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import {
  getPrepMasterByEmail,
  getBookingsForPrepMaster,
} from "@/lib/airtable"
import { createConfirmedBooking } from "@/lib/booking-create"
import { db } from "@/lib/db"
import { user as userTable } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

async function getSessionUser() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error("Unauthorized")
  return session.user
}

export type PastClient = {
  userId: string
  name: string
  email: string
}

/** Returns the unique past clients of the logged-in PrepMaster. */
export async function getPastClients(): Promise<PastClient[]> {
  const sessionUser = await getSessionUser()
  const prepMaster = await getPrepMasterByEmail(sessionUser.email)
  if (!prepMaster) throw new Error("No PrepMaster record found for this account.")

  const bookings = await getBookingsForPrepMaster(prepMaster.name)
  const seen = new Set<string>()
  const clients: PastClient[] = []
  for (const b of bookings) {
    const key = b.dancerEmail || b.userId
    if (!key || seen.has(key)) continue
    seen.add(key)
    clients.push({
      userId: b.userId,
      name: b.dancerName || b.dancerEmail,
      email: b.dancerEmail,
    })
  }
  return clients.sort((a, b) => a.name.localeCompare(b.name))
}

export async function createBookingAsPrepMaster(input: {
  dancerEmail: string
  date: string
  time: string
  notes?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sessionUser = await getSessionUser()
    const prepMaster = await getPrepMasterByEmail(sessionUser.email)
    if (!prepMaster) return { ok: false, error: "No PrepMaster record found for this account." }

    // Verify this dancer has a prior booking with this PrepMaster
    const history = await getBookingsForPrepMaster(prepMaster.name)
    const knownEmails = new Set(history.map((b) => b.dancerEmail.toLowerCase()))
    if (!knownEmails.has(input.dancerEmail.toLowerCase())) {
      return { ok: false, error: "You can only book sessions for members you have previously worked with." }
    }

    const [dancerRows] = await Promise.all([
      db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, input.dancerEmail.toLowerCase())).limit(1),
    ])
    const dancer = dancerRows[0]
    if (!dancer?.id) {
      return { ok: false, error: "Could not find this member's account." }
    }

    const result = await createConfirmedBooking({
      memberUserId: dancer.id,
      memberEmail: input.dancerEmail,
      prepMasterId: prepMaster.id,
      date: input.date,
      time: input.time,
      sessionType: "private-60",
      notes: input.notes,
      bookedBy: "prep_master",
    })

    if (!result.ok) {
      const friendly = result.error === "NO_CREDITS" ? "This member doesn't have enough credit for a 60-minute session." : result.error
      return { ok: false, error: friendly }
    }

    revalidatePath("/portal")
    revalidatePath("/portal/book")
    const { revalidateTag } = await import("next/cache")
    revalidateTag(`member-${dancer.id}`)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create booking." }
  }
}
