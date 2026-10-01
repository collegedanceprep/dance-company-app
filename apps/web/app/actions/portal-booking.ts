"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import {
  TABLES,
  appBase,
  getPrepMasterByEmail,
  getBookingsForPrepMaster,
  getBookedSlots,
  type BookingFields,
} from "@/lib/airtable"
import { getAvailabilityForEmail } from "@/app/actions/availability"
import { slotsForDate } from "@/lib/availability"
import { createNotification } from "@/app/actions/notifications"
import { fmtDate, fmtTime, etToUtcIso, fmtTimeForNotif, COMPANY_TZ } from "@/lib/utils"
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

    // Validate the slot is within the PrepMaster's availability
    const week = await getAvailabilityForEmail(prepMaster.email)
    const openSlots = slotsForDate(input.date, week)
    if (openSlots.length > 0 && !openSlots.includes(input.time)) {
      return { ok: false, error: "That time is outside your availability for that day." }
    }

    // Check the slot isn't already taken
    const booked = await getBookedSlots(prepMaster.name, input.date)
    if (booked.includes(input.time)) {
      return { ok: false, error: "That time slot is already booked." }
    }

    // Look up the dancer's userId for the notification, and the PrepMaster's
    // own timezone — the Time string the PM enters is in THEIR local time,
    // not the company's, matching app/api/portal/book/route.ts's pmTimezone
    // pattern.
    const [dancerRows, pmRows] = await Promise.all([
      db.select({ id: userTable.id, name: userTable.name, timezone: userTable.timezone })
        .from(userTable).where(eq(userTable.email, input.dancerEmail.toLowerCase())).limit(1),
      db.select({ timezone: userTable.timezone })
        .from(userTable).where(eq(userTable.email, sessionUser.email.toLowerCase())).limit(1),
    ])
    const dancer = dancerRows[0]
    const pmTimezone = pmRows[0]?.timezone ?? COMPANY_TZ

    // Without this, the record has no exact UTC instant to compare against
    // "now" — downstream status-derivation (past confirmed → completed) had
    // to fall back to treating the bare date as midnight UTC, which could
    // wrongly mark a session "completed" many hours before it actually
    // happens. Compute it up front so it's saved on the record itself, not
    // just used for the notification text afterward.
    const utcPortalBook = etToUtcIso(input.date, input.time, pmTimezone)

    await appBase.create<BookingFields>(TABLES.bookings, {
      "Client Email": input.dancerEmail,
      "User ID": dancer?.id ?? "",
      "Prep Master Name": prepMaster.name,
      Date: input.date,
      Time: input.time,
      Status: "Confirmed",
      Notes: input.notes ?? "",
      "Session Type": "private-60",
      ...(utcPortalBook ? { "UTC Datetime": utcPortalBook } : {}),
    })

    if (dancer?.id) {
      const portalBookLabel = utcPortalBook ? fmtTimeForNotif(utcPortalBook, pmTimezone, dancer.timezone ?? null) : fmtTime(input.time)
      createNotification({
        userId: dancer.id,
        type: "booking_confirmed",
        title: "Session booked",
        body: `${prepMaster.name} has booked a session with you on ${fmtDate(input.date)} at ${portalBookLabel}.`,
        pushData: { route: "/member/bookings" },
      }).catch(() => {})
    }

    revalidatePath("/portal")
    revalidatePath("/portal/book")
    if (dancer?.id) {
      const { revalidateTag } = await import("next/cache")
      revalidateTag(`member-${dancer.id}`)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to create booking." }
  }
}
