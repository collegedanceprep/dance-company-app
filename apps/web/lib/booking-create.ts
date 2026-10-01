import "server-only"
import {
  TABLES, appBase,
  getPrepMaster,
  getActivePlanForUser,
  setPlanStatus,
  getPlansForUser,
  getBookedSlots,
  getParentEmailForMember,
  type BookingFields,
  type ClientFields,
} from "@/lib/airtable"
import { getAvailabilityForEmail } from "@/app/actions/availability"
import { slotsForDate } from "@/lib/availability"
import { createNotification } from "@/app/actions/notifications"
import { sendEmail, bookingConfirmedByPmEmail } from "@/lib/email"
import { fmtDate, fmtTime, etToUtcIso, fmtTimeForNotif, fmtEmailTime, COMPANY_TZ } from "@/lib/utils"
import { db } from "@/lib/db"
import { user as userTable, bookingAttemptLock, calendarEventLink } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { createCalendarEvent, getCalendarBusySlots } from "@/lib/google-calendar"
import type { SessionType } from "@/lib/session-types"

const CREDIT_COST: Record<string, number> = {
  "pack-hour": 1, "private-60": 1, "private-45": 0.75, "private-30": 0.5, "private-90": 1.5,
}
const SINGLE_CREDIT_FIELDS: Record<string, keyof ClientFields> = {
  "private-30": "Single Credits 30", "private-45": "Single Credits 45",
  "private-60": "Single Credits 60", "private-90": "Single Credits 90",
}
const SINGLE_CREDIT_KEY: Record<string, "30" | "45" | "60" | "90"> = {
  "private-30": "30", "private-45": "45", "private-60": "60", "private-90": "90",
}

type CreateConfirmedBookingInput = {
  memberUserId: string
  memberEmail: string
  prepMasterId: string
  date: string
  time: string
  sessionType?: SessionType
  notes?: string
}

type Result = { ok: true; id: string } | { ok: false; error: string }

/**
 * Creates a booking that goes straight to Confirmed — skipping the
 * pending-PM-approval step entirely — used by both "PrepMaster books a past
 * client" and "admin books on behalf of any member." Runs the exact same
 * credit check, availability check, double-booking check, calendar-conflict
 * check, and booking-attempt lock as a member's own self-booking, so neither
 * caller can create a booking with weaker guardrails than a real member
 * booking themselves would go through.
 */
export async function createConfirmedBooking(input: CreateConfirmedBookingInput): Promise<Result> {
  const { memberUserId, memberEmail, prepMasterId, date, time, sessionType, notes } = input

  const safeId = memberUserId.replace(/'/g, "\\'")
  const clientRecs = await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `{User ID} = '${safeId}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  const clientRecord = clientRecs[0]
  if (!clientRecord) return { ok: false, error: "NO_CREDITS" }

  const fields = clientRecord.fields
  const singleCredits = {
    "30": fields["Single Credits 30"] ?? 0,
    "45": fields["Single Credits 45"] ?? 0,
    "60": fields["Single Credits 60"] ?? 0,
    "90": fields["Single Credits 90"] ?? 0,
  }
  const creditsRemaining = fields["Credits Remaining"] ?? 0
  const dancerName = fields.Name || memberEmail

  const singleField = SINGLE_CREDIT_FIELDS[sessionType ?? ""]
  const singleCreditKey = SINGLE_CREDIT_KEY[sessionType ?? ""]
  const singleCreditsForType = (singleField && singleCreditKey) ? (singleCredits[singleCreditKey] ?? 0) : 0
  const useSingleCredit = singleCreditsForType >= 1
  const creditCost = useSingleCredit ? 1 : (CREDIT_COST[sessionType ?? "private-60"] ?? 1)
  const credits = useSingleCredit ? singleCreditsForType : creditsRemaining
  if (credits < creditCost) return { ok: false, error: "NO_CREDITS" }

  const prepMaster = await getPrepMaster(prepMasterId)
  if (!prepMaster) return { ok: false, error: "This PrepMaster is no longer available." }

  const week = await getAvailabilityForEmail(prepMaster.email)
  const openSlots = slotsForDate(date, week)
  if (!openSlots.includes(time)) {
    return { ok: false, error: "That time is outside this PrepMaster's availability." }
  }

  const booked = await getBookedSlots(prepMaster.name, date)
  if (booked.includes(time)) {
    return { ok: false, error: "That time was just booked. Please choose another slot." }
  }

  const [pmUserRow] = await db.select({ id: userTable.id, timezone: userTable.timezone }).from(userTable).where(eq(userTable.email, prepMaster.email))
  const pmTimezone = pmUserRow?.timezone ?? COMPANY_TZ
  if (pmUserRow) {
    const busySlots = await getCalendarBusySlots(pmUserRow.id, date, 60, pmTimezone)
    if (busySlots.includes(time)) {
      return { ok: false, error: "That time is no longer available. Please choose another slot." }
    }
  }

  const serverUtcDatetime = etToUtcIso(date, time, pmTimezone)

  const lockId = crypto.randomUUID()
  try {
    await db.insert(bookingAttemptLock).values({ id: lockId, userId: memberUserId, date, time })
  } catch {
    return { ok: false, error: "A booking for that time is already in progress. Please try again." }
  }

  const newCredits = Math.round((credits - creditCost) * 100) / 100
  if (useSingleCredit && singleField) {
    await appBase.update<ClientFields>(TABLES.clients, clientRecord.id, { [singleField]: newCredits } as Partial<ClientFields>)
  } else {
    await appBase.update<ClientFields>(TABLES.clients, clientRecord.id, { "Credits Remaining": newCredits })
  }

  let record: Awaited<ReturnType<typeof appBase.create<BookingFields>>>
  try {
    record = await appBase.create<BookingFields>(TABLES.bookings, {
      "User ID": memberUserId,
      "Client Email": memberEmail,
      "Prep Master Name": prepMaster.name,
      Date: date,
      Time: time,
      ...(serverUtcDatetime ? { "UTC Datetime": serverUtcDatetime } : {}),
      Status: "Confirmed",
      Notes: notes ?? "",
      "Session Type": sessionType ?? "private-60",
      ...(useSingleCredit ? { "Single Credit Used": true } : {}),
    })
  } catch {
    if (useSingleCredit && singleField) {
      await appBase.update<ClientFields>(TABLES.clients, clientRecord.id, { [singleField]: singleCreditsForType } as Partial<ClientFields>).catch(() => {})
    } else {
      await appBase.update<ClientFields>(TABLES.clients, clientRecord.id, { "Credits Remaining": creditsRemaining }).catch(() => {})
    }
    await db.delete(bookingAttemptLock).where(eq(bookingAttemptLock.id, lockId)).catch(() => {})
    return { ok: false, error: "Failed to create booking. Your credit has been refunded." }
  }

  if (useSingleCredit && newCredits === 0) {
    const minLabel = sessionType?.replace("private-", "") ?? ""
    const userPlans = await getPlansForUser(memberUserId)
    const matchingPlan = userPlans.find((p) => p.status === "Active" && p.sessions === 1 && p.planName.toLowerCase().includes(minLabel))
      ?? userPlans.find((p) => p.status === "Active" && p.sessions === 1)
    if (matchingPlan) await setPlanStatus(matchingPlan.id, "Used")
  } else if (!useSingleCredit && newCredits <= 0) {
    const planToMark = await getActivePlanForUser(memberUserId)
    if (planToMark) await setPlanStatus(planToMark.id, "Used")
  }

  const [memberRow] = await db.select({ timezone: userTable.timezone }).from(userTable).where(eq(userTable.id, memberUserId)).limit(1)
  const memberTz = memberRow?.timezone ?? null
  const timeDisplay = serverUtcDatetime ? fmtTimeForNotif(serverUtcDatetime, pmTimezone, memberTz) : fmtTime(time)

  createNotification({
    userId: memberUserId,
    type: "booking_confirmed",
    title: "Session booked",
    body: `Your session with ${prepMaster.name} on ${fmtDate(date)} at ${timeDisplay} is confirmed.`,
    bookingId: record.id,
    pushData: { route: "/member/bookings" },
  }).catch(() => {})

  if (memberEmail) {
    const parentCC = await getParentEmailForMember(memberUserId).catch(() => null)
    const { subject, html } = bookingConfirmedByPmEmail({
      dancerName,
      prepMasterName: prepMaster.name,
      date,
      time: fmtEmailTime(time, pmTimezone, serverUtcDatetime, memberTz),
    })
    sendEmail({ to: memberEmail, cc: parentCC ?? undefined, subject, html }).catch(() => {})
  }

  ;(async () => {
    const eventArgs = { dancerName, prepMasterName: prepMaster.name, date, time, notes, sessionType: sessionType ?? "private-60", timezone: pmTimezone }
    const [pmEventId, memberEventId] = await Promise.all([
      pmUserRow ? createCalendarEvent(pmUserRow.id, eventArgs) : Promise.resolve(null),
      createCalendarEvent(memberUserId, eventArgs),
    ])
    const links: { id: string; bookingId: string; userId: string; gcalEventId: string }[] = []
    if (pmUserRow && pmEventId) links.push({ id: crypto.randomUUID(), bookingId: record.id, userId: pmUserRow.id, gcalEventId: pmEventId })
    if (memberEventId) links.push({ id: crypto.randomUUID(), bookingId: record.id, userId: memberUserId, gcalEventId: memberEventId })
    if (links.length > 0) await db.insert(calendarEventLink).values(links).onConflictDoNothing().catch(() => {})
  })().catch(() => {})

  await db.delete(bookingAttemptLock).where(eq(bookingAttemptLock.id, lockId)).catch(() => {})

  return { ok: true, id: record.id }
}
