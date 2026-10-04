import "server-only"

// Airtable backend client — single base ("CDP Payroll", AIRTABLE_BASE_ID).
//  - Workers  -> PrepMaster roster. Holds "Hourly Rate", which is NEVER
//                returned to the app (not to dancers, not to PrepMasters).
//  - Members  -> dancer / client profiles.
//  - Bookings -> session reservations. Contains NO pricing.
// Auth (users/sessions) lives in Neon via Better Auth.

const AIRTABLE_API_URL = "https://api.airtable.com/v0"
const BASE_ID = process.env.AIRTABLE_BASE_ID
const API_KEY = process.env.AIRTABLE_API_KEY

export const TABLES = {
  workers: "Workers",
  clients: "Members",
  bookings: "Bookings",
  plans: "Plans",
} as const

/** Whether Airtable is configured. UI shows a setup notice when false. */
export function isAirtableConfigured() {
  return Boolean(BASE_ID && API_KEY)
}

// --- Record types ------------------------------------------------------------

export type AirtableRecord<T> = {
  id: string
  createdTime: string
  fields: T
}

// NOTE: "Hourly Rate" is part of this type for internal/admin use only. It must
// NEVER be surfaced to the UI — toPrepMaster() deliberately omits it.
export type WorkerFields = {
  "Full Name"?: string
  "Worker ID"?: string
  Email?: string
  Phone?: string
  Region?: string
  University?: string
  Address?: string
  "Role"?: string
  "Reports to"?: string
  "Hourly Rate"?: number
  Active?: boolean
}

export type ClientFields = {
  Name?: string
  Email?: string
  "User ID"?: string
  Phone?: string
  Goals?: string
  "Credits Remaining"?: number
  "Single Credits 30"?: number
  "Single Credits 45"?: number
  "Single Credits 60"?: number
  "Single Credits 90"?: number
  "Parent Email"?: string
}

export type { SessionType } from "@/lib/session-types"
export { SESSION_TYPE_LABELS } from "@/lib/session-types"
import type { SessionType } from "@/lib/session-types"
import { etToUtcIso } from "@/lib/utils"

export type BookingFields = {
  Name?: string
  "Client Email"?: string
  "User ID"?: string
  "Prep Master Name"?: string
  Date?: string
  Time?: string
  Status?: string
  Notes?: string
  "Prep Master Notes"?: string
  "Cancellation Reason"?: string
  "Decline Reason"?: string
  "Session Type"?: string
  "UTC Datetime"?: string
  "Is Reschedule"?: boolean
  "Original Date"?: string
  "Original Time"?: string
  "Original UTC Datetime"?: string
  "Payable to PrepMaster"?: boolean
  "Single Credit Used"?: boolean
  "Booked By"?: "member" | "prep_master" | "admin"
}

export type PlanFields = {
  "User ID"?: string
  "Member Email"?: string
  "Plan Name"?: string
  Sessions?: number
  "Price Paid"?: number
  "Purchased At"?: string
  "Expires At"?: string
  Status?: string
  Source?: string
  "Stripe Session ID"?: string
}

export type MemberPlan = {
  id: string
  userId: string
  planName: string
  sessions: number
  pricePaid: number
  purchasedAt: string
  expiresAt: string
  status: string
  source?: "stripe" | "admin"
}


// --- Low-level fetch helpers -------------------------------------------------

type ListOptions = {
  filterByFormula?: string
  maxRecords?: number
  sort?: { field: string; direction?: "asc" | "desc" }[]
  revalidate?: number
  tags?: string[]
}

async function airtableFetch(
  path: string,
  init?: RequestInit & { revalidate?: number; tags?: string[] },
) {
  if (!BASE_ID || !API_KEY) {
    throw new Error(
      "Airtable is not configured. Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID.",
    )
  }
  const { revalidate, tags, ...rest } = init ?? {} as RequestInit & { revalidate?: number; tags?: string[] }
  const cacheOpt =
    revalidate === 0
      ? { cache: "no-store" as const }
      : revalidate !== undefined || tags?.length
        ? { next: { ...(revalidate !== undefined ? { revalidate } : {}), ...(tags?.length ? { tags } : {}) } }
        : {}
  const doFetch = () =>
    fetch(`${AIRTABLE_API_URL}/${BASE_ID}/${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        ...(rest.headers ?? {}),
      },
      ...cacheOpt,
    })

  let res: Response | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Airtable request timed out after 15s")), 15000),
    )
    res = await Promise.race([doFetch(), timeout])
    if (res.status !== 429) break
    // Back off before retrying: 300ms, 900ms
    await new Promise((r) => setTimeout(r, 300 * Math.pow(3, attempt)))
  }
  if (!res!.ok) {
    throw new Error(`Airtable request failed (${res!.status}): ${await res!.text()}`)
  }
  return res!.json()
}

async function list<T>(table: string, options: ListOptions = {}): Promise<AirtableRecord<T>[]> {
  const baseParams = new URLSearchParams()
  if (options.filterByFormula) baseParams.set("filterByFormula", options.filterByFormula)
  if (options.maxRecords) baseParams.set("maxRecords", String(options.maxRecords))
  options.sort?.forEach((s, i) => {
    baseParams.set(`sort[${i}][field]`, s.field)
    if (s.direction) baseParams.set(`sort[${i}][direction]`, s.direction)
  })

  const all: AirtableRecord<T>[] = []
  let offset: string | undefined

  do {
    const params = new URLSearchParams(baseParams)
    if (offset) params.set("offset", offset)
    const query = params.toString()
    const data = await airtableFetch(
      `${encodeURIComponent(table)}${query ? `?${query}` : ""}`,
      { method: "GET", revalidate: options.revalidate ?? 15, ...(options.tags ? { tags: options.tags } : {}) },
    )
    all.push(...(data.records ?? []))
    offset = data.offset
    // Respect maxRecords cap across pages
    if (options.maxRecords && all.length >= options.maxRecords) break
  } while (offset)

  return options.maxRecords ? all.slice(0, options.maxRecords) : all
}

async function create<T>(table: string, fields: Partial<T>): Promise<AirtableRecord<T>> {
  // typecast lets Airtable create new single-select options (e.g. Status) on write.
  return airtableFetch(encodeURIComponent(table), {
    method: "POST",
    body: JSON.stringify({ fields, typecast: true }),
  })
}

async function update<T>(
  table: string,
  id: string,
  fields: Partial<T>,
): Promise<AirtableRecord<T>> {
  return airtableFetch(`${encodeURIComponent(table)}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields, typecast: true }),
  })
}

async function get<T>(table: string, id: string): Promise<AirtableRecord<T>> {
  return airtableFetch(`${encodeURIComponent(table)}/${id}`, {
    method: "GET",
    revalidate: 30,
  })
}

async function destroy(table: string, id: string): Promise<void> {
  await airtableFetch(`${encodeURIComponent(table)}/${id}`, { method: "DELETE" })
}

// Exposed so server actions can read/write the app tables directly.
export const appBase = { list, create, update, get, destroy }

// --- PrepMasters (from the Workers table) -----------------------------------

// What the app exposes for a PrepMaster. Deliberately omits Hourly Rate and
// every other payroll/sensitive field.
export type PrepMaster = {
  id: string
  name: string
  email: string
  phone: string
  region: string
  university: string
  address: string
  workerRole: string
  reportsTo: string
}

function toPrepMaster(r: AirtableRecord<WorkerFields>): PrepMaster {
  return {
    id: r.id,
    name: r.fields["Full Name"] ?? "Unnamed PrepMaster",
    email: r.fields.Email ?? "",
    phone: r.fields.Phone ?? "",
    region: r.fields.Region ?? "",
    university: r.fields.University ?? "",
    address: r.fields.Address ?? "",
    workerRole: r.fields["Role"] ?? "PrepMaster",
    reportsTo: r.fields["Reports to"] ?? "",
    // Hourly Rate is intentionally NOT included here.
  }
}

export async function getPrepMasters(): Promise<PrepMaster[]> {
  const records = await list<WorkerFields>(TABLES.workers, {
    sort: [{ field: "Full Name", direction: "asc" }],
    revalidate: 30,
  })
  return records.filter((r) => r.fields.Active !== false).map(toPrepMaster)
}

export async function getPrepMaster(id: string): Promise<PrepMaster | null> {
  try {
    return toPrepMaster(await get<WorkerFields>(TABLES.workers, id))
  } catch {
    return null
  }
}

export async function getPrepMasterPhone(id: string): Promise<string | null> {
  try {
    const record = await get<WorkerFields>(TABLES.workers, id)
    return record.fields.Phone ?? null
  } catch {
    return null
  }
}

export async function getPrepMasterByEmail(email: string): Promise<PrepMaster | null> {
  const safe = email.trim().toLowerCase().replace(/'/g, "\\'")
  const records = await list<WorkerFields>(TABLES.workers, {
    filterByFormula: `LOWER({Email}) = '${safe}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  return records[0] ? toPrepMaster(records[0]) : null
}

// --- Prep master portal: bookings + dancer contact (NO pricing) --------------

export type PrepMasterBooking = {
  id: string
  date: string
  time: string
  utcDatetime: string | null
  status: string
  notes: string
  prepMasterNotes: string
  declineReason: string
  cancellationReason: string
  dancerName: string
  dancerEmail: string
  dancerPhone: string
  userId: string
  sessionType: string | null
  isReschedulePending: boolean
}

export async function getBookingsForPrepMaster(
  prepMasterName: string,
): Promise<PrepMasterBooking[]> {
  const safeName = prepMasterName.replace(/'/g, "\\'")
  const records = await list<BookingFields>(TABLES.bookings, {
    filterByFormula: `{Prep Master Name} = '${safeName}'`,
    sort: [{ field: "Date", direction: "asc" }],
  })

  const userIds = Array.from(
    new Set(records.map((r) => r.fields["User ID"]).filter(Boolean) as string[]),
  )
  const clientMap = await getClientsByUserIds(userIds)

  return records.map((r) => {
    const uid = r.fields["User ID"] ?? ""
    const client = clientMap.get(uid)
    return {
      id: r.id,
      date: r.fields.Date ?? "",
      time: r.fields.Time ?? "",
      utcDatetime: r.fields["UTC Datetime"] ?? null,
      status: r.fields.Status ?? "Pending",
      notes: r.fields.Notes ?? "",
      prepMasterNotes: r.fields["Prep Master Notes"] ?? "",
      declineReason: r.fields["Decline Reason"] ?? "",
      cancellationReason: r.fields["Cancellation Reason"] ?? "",
      dancerName: client?.name ?? "",
      dancerEmail: client?.email ?? r.fields["Client Email"] ?? "",
      dancerPhone: client?.phone ?? "",
      userId: uid,
      sessionType: (r.fields["Session Type"] as string) ?? null,
      isReschedulePending: !!(r.fields["Is Reschedule"] && (r.fields.Status ?? "").toLowerCase() === "pending"),
    }
  })
}

export type Booking = {
  id: string
  prepMasterName: string
  date: string
  time: string
  utcDatetime: string | null
  status: string
  notes: string
  prepMasterNotes: string
  sessionType: string | null
}

export async function getBookingsForUserId(userId: string): Promise<Booking[]> {
  const safeId = userId.replace(/'/g, "\\'")
  const records = await list<BookingFields>(TABLES.bookings, {
    filterByFormula: `{User ID} = '${safeId}'`,
    sort: [{ field: "Date", direction: "desc" }],
    revalidate: 0,
  })
  return records.map((r) => ({
    id: r.id,
    prepMasterName: r.fields["Prep Master Name"] ?? "",
    date: r.fields.Date ?? "",
    time: r.fields.Time ?? "",
    utcDatetime: r.fields["UTC Datetime"] ?? null,
    status: r.fields.Status ?? "Pending",
    notes: r.fields.Notes ?? "",
    prepMasterNotes: r.fields["Prep Master Notes"] ?? "",
    sessionType: (r.fields["Session Type"] as string) ?? null,
  }))
}

/**
 * Returns the booked time slots (display strings, e.g. "3:00 PM") for a prep
 * master on a specific date. Used to hide already-taken slots when booking.
 * Cancelled bookings are excluded so their slots free up again.
 */
export async function getBookedSlots(
  prepMasterName: string,
  dateIso: string,
): Promise<string[]> {
  const safeName = prepMasterName.replace(/'/g, "\\'")
  const safeDate = dateIso.replace(/'/g, "\\'")
  const records = await list<BookingFields>(TABLES.bookings, {
    filterByFormula: `AND({Prep Master Name} = '${safeName}', {Date} = '${safeDate}')`,
    revalidate: 5,
  })
  return records
    .filter((r) => {
      const s = (r.fields.Status ?? "").toLowerCase()
      return !s.startsWith("cancelled") && s !== "declined"
    })
    .map((r) => (r.fields.Time ?? "").trim())
    .filter(Boolean)
}

/**
 * Returns a map of date (YYYY-MM-DD) -> booked time slots for a PrepMaster,
 * across all their bookings. Used to grey out taken slots in the booking flow.
 */
export async function getUpcomingBookedSlots(
  prepMasterName: string,
): Promise<Record<string, string[]>> {
  const safeName = prepMasterName.replace(/'/g, "\\'")
  const records = await list<BookingFields>(TABLES.bookings, {
    filterByFormula: `{Prep Master Name} = '${safeName}'`,
    revalidate: 5,
  })
  const map: Record<string, string[]> = {}
  for (const r of records) {
    const s = (r.fields.Status ?? "").toLowerCase()
    if (s.startsWith("cancelled") || s === "declined") continue
    const date = r.fields.Date
    const time = r.fields.Time
    if (!date || !time) continue
    ;(map[date] ??= []).push(time)
  }
  return map
}

// --- Member plans ------------------------------------------------------------

export async function getPlansForUser(userId: string, fallbackEmail?: string): Promise<MemberPlan[]> {
  const safeId = userId.replace(/'/g, "\\'")
  let records = await list<PlanFields>(TABLES.plans, {
    filterByFormula: `{User ID} = '${safeId}'`,
    sort: [{ field: "Purchased At", direction: "desc" }],
    revalidate: 0,
  })

  // If no plans found by userId, try by email (handles userId mismatch from re-registration)
  if (records.length === 0 && fallbackEmail) {
    const safeEmail = fallbackEmail.trim().toLowerCase().replace(/'/g, "\\'")
    records = await list<PlanFields>(TABLES.plans, {
      filterByFormula: `LOWER({Member Email}) = '${safeEmail}'`,
      sort: [{ field: "Purchased At", direction: "desc" }],
      revalidate: 0,
    })
    // Patch the userId on any found records so future lookups work
    if (records.length > 0) {
      await Promise.all(
        records
          .filter((r) => r.fields["User ID"] !== userId)
          .map((r) => update<PlanFields>(TABLES.plans, r.id, { "User ID": userId }))
      )
    }
  }

  return records.map((r) => ({
    id: r.id,
    userId: r.fields["User ID"] ?? "",
    planName: r.fields["Plan Name"] ?? "",
    sessions: r.fields.Sessions ?? 0,
    pricePaid: r.fields["Price Paid"] ?? 0,
    purchasedAt: r.fields["Purchased At"] ?? "",
    expiresAt: r.fields["Expires At"] ?? "",
    status: r.fields.Status ?? "Active",
    source: (r.fields.Source as "stripe" | "admin" | undefined) ?? undefined,
  }))
}

export async function adminGetAllPlans(): Promise<MemberPlan[]> {
  const records = await list<PlanFields>(TABLES.plans, {
    sort: [{ field: "Purchased At", direction: "desc" }],
    revalidate: 0,
  })
  return records.map((r) => ({
    id: r.id,
    userId: r.fields["User ID"] ?? "",
    planName: r.fields["Plan Name"] ?? "",
    sessions: r.fields.Sessions ?? 0,
    pricePaid: r.fields["Price Paid"] ?? 0,
    purchasedAt: r.fields["Purchased At"] ?? "",
    expiresAt: r.fields["Expires At"] ?? "",
    status: r.fields.Status ?? "Active",
    source: (r.fields.Source as "stripe" | "admin" | undefined) ?? undefined,
  }))
}

export async function getActivePlanForUser(userId: string): Promise<{ id: string } | null> {
  const safeId = userId.replace(/'/g, "\\'")
  const records = await list<PlanFields>(TABLES.plans, {
    filterByFormula: `AND({User ID} = '${safeId}', {Status} = 'Active')`,
    sort: [{ field: "Purchased At", direction: "desc" }],
    maxRecords: 1,
    revalidate: 0,
  })
  return records[0] ? { id: records[0].id } : null
}

export async function getMostRecentInactivePlanForUser(userId: string): Promise<{ id: string } | null> {
  const safeId = userId.replace(/'/g, "\\'")
  const records = await list<PlanFields>(TABLES.plans, {
    filterByFormula: `AND({User ID} = '${safeId}', OR({Status} = 'Used', {Status} = 'Inactive'))`,
    sort: [{ field: "Purchased At", direction: "desc" }],
    maxRecords: 1,
    revalidate: 0,
  })
  return records[0] ? { id: records[0].id } : null
}

export async function setPlanStatus(planId: string, status: string): Promise<void> {
  await update<PlanFields>(TABLES.plans, planId, { Status: status })
}

export async function createMemberPlan(fields: {
  userId: string
  memberEmail: string
  planName: string
  sessions: number
  pricePaid: number
  expiryDays?: number
  source?: "stripe" | "admin"
  stripeSessionId?: string
}): Promise<MemberPlan> {
  const purchasedAt = new Date()
  const expiresAt = fields.expiryDays != null ? new Date(purchasedAt) : null
  if (expiresAt && fields.expiryDays != null) {
    expiresAt.setDate(expiresAt.getDate() + fields.expiryDays)
  }
  const record = await create<PlanFields>(TABLES.plans, {
    "User ID": fields.userId,
    "Member Email": fields.memberEmail,
    "Plan Name": fields.planName,
    Sessions: fields.sessions,
    "Price Paid": fields.pricePaid,
    "Purchased At": purchasedAt.toISOString(),
    ...(expiresAt ? { "Expires At": expiresAt.toISOString() } : {}),
    Status: "Active",
    ...(fields.source ? { Source: fields.source } : {}),
    ...(fields.stripeSessionId ? { "Stripe Session ID": fields.stripeSessionId } : {}),
  })
  return {
    id: record.id,
    userId: record.fields["User ID"] ?? "",
    planName: record.fields["Plan Name"] ?? "",
    sessions: record.fields.Sessions ?? 0,
    pricePaid: record.fields["Price Paid"] ?? 0,
    purchasedAt: record.fields["Purchased At"] ?? "",
    expiresAt: record.fields["Expires At"] ?? "",
    status: record.fields.Status ?? "Active",
    source: (record.fields.Source as "stripe" | "admin" | undefined) ?? undefined,
  }
}

// --- Admin-only helpers (never call from dancer/PrepMaster code paths) ------

export type SingleCreditsByType = {
  "30": number
  "45": number
  "60": number
  "90": number
}

export type AdminMember = {
  id: string
  name: string
  email: string
  userId: string
  phone: string
  goals: string
  creditsRemaining: number
  singleCredits: SingleCreditsByType
  parentEmail: string
  accountStatus?: "pending" | "active"
}

export type AdminWorker = {
  id: string
  name: string
  email: string
  region: string
  university: string
  phone: string
  address: string
  hourlyRate: number
  active: boolean
  inviteStatus?: "pending" | "accepted" | "revoked" | null
}

export type AdminBooking = {
  id: string
  clientEmail: string
  dancerName: string
  userId: string
  prepMasterName: string
  date: string
  time: string
  utcDatetime: string | null
  status: string
  notes: string
  sessionType: SessionType | null
  singleCreditUsed?: boolean
  cancellationReason: string
  declineReason: string
  bookedBy: "member" | "prep_master" | "admin" | null
}

export async function adminGetAllMembers(): Promise<AdminMember[]> {
  const records = await list<ClientFields>(TABLES.clients, {
    sort: [{ field: "Name", direction: "asc" }],
    revalidate: 0,
  })
  return records
    .filter((r) => !!r.fields["User ID"])
    .map((r) => ({
      id: r.id,
      name: r.fields.Name ?? "",
      email: r.fields.Email ?? "",
      userId: r.fields["User ID"] ?? "",
      phone: r.fields.Phone ?? "",
      goals: r.fields.Goals ?? "",
      creditsRemaining: r.fields["Credits Remaining"] ?? 0,
      singleCredits: {
        "30": r.fields["Single Credits 30"] ?? 0,
        "45": r.fields["Single Credits 45"] ?? 0,
        "60": r.fields["Single Credits 60"] ?? 0,
        "90": r.fields["Single Credits 90"] ?? 0,
      },
      parentEmail: r.fields["Parent Email"] ?? "",
    }))
}

export async function adminUpdateMemberParentEmail(recordId: string, parentEmail: string) {
  await update<ClientFields>(TABLES.clients, recordId, { "Parent Email": parentEmail || undefined })
}

export async function getParentEmailForMember(userId: string): Promise<string | null> {
  try {
    const safe = userId.replace(/'/g, "\\'")
    const records = await list<ClientFields>(TABLES.clients, {
      filterByFormula: `{User ID} = '${safe}'`,
      maxRecords: 1,
    })
    return records[0]?.fields?.["Parent Email"] ?? null
  } catch {
    return null
  }
}

export async function adminGetAllBookings(): Promise<AdminBooking[]> {
  const records = await list<BookingFields>(TABLES.bookings, {
    sort: [{ field: "Date", direction: "desc" }],
    revalidate: 0,
  })
  const userIds = Array.from(
    new Set(records.map((r) => r.fields["User ID"]).filter(Boolean) as string[]),
  )
  const clientMap = await getClientsByUserIds(userIds)

  // For bookings whose userId didn't resolve to a client record, look up by email
  const unmatchedEmails = Array.from(
    new Set(
      records
        .filter((r) => {
          const uid = r.fields["User ID"] ?? ""
          return !clientMap.has(uid) && !!r.fields["Client Email"]
        })
        .map((r) => r.fields["Client Email"] as string),
    ),
  )
  const emailClientMap = await getClientsByEmails(unmatchedEmails)

  return records.map((r) => {
    const uid = r.fields["User ID"] ?? ""
    const email = r.fields["Client Email"] ?? ""
    const client = clientMap.get(uid) ?? emailClientMap.get(email.toLowerCase())
    return {
      id: r.id,
      clientEmail: email,
      dancerName: client?.name ?? "",
      userId: uid,
      prepMasterName: r.fields["Prep Master Name"] ?? "",
      date: r.fields.Date ?? "",
      time: r.fields.Time ?? "",
      utcDatetime: r.fields["UTC Datetime"] ?? null,
      status: r.fields.Status ?? "Pending",
      notes: r.fields.Notes ?? "",
      sessionType: (r.fields["Session Type"] as SessionType) ?? null,
      singleCreditUsed: r.fields["Single Credit Used"] === true,
      cancellationReason: r.fields["Cancellation Reason"] ?? "",
      declineReason: r.fields["Decline Reason"] ?? "",
      bookedBy: r.fields["Booked By"] ?? null,
    }
  })
}

export async function adminCreateWorker(fields: {
  name: string
  email: string
  phone?: string
  region?: string
  address?: string
  hourlyRate?: number
}): Promise<AdminWorker> {
  const record = await create<WorkerFields>(TABLES.workers, {
    "Full Name": fields.name,
    Email: fields.email,
    Phone: fields.phone ?? "",
    ...(fields.region ? { Region: fields.region } : {}),
    Address: fields.address ?? "",
    "Hourly Rate": fields.hourlyRate ?? 0,
    Active: true,
  })
  return {
    id: record.id,
    name: record.fields["Full Name"] ?? "",
    email: record.fields.Email ?? "",
    region: record.fields.Region ?? "",
    phone: record.fields.Phone ?? "",
    address: record.fields.Address ?? "",
    hourlyRate: record.fields["Hourly Rate"] ?? 0,
    active: record.fields.Active !== false,
    university: record.fields.University ?? "",
  }
}

export async function adminGetAllWorkers(): Promise<AdminWorker[]> {
  const records = await list<WorkerFields>(TABLES.workers, {
    sort: [{ field: "Full Name", direction: "asc" }],
    revalidate: 0,
  })
  return records.map((r) => ({
    id: r.id,
    name: r.fields["Full Name"] ?? "",
    email: r.fields.Email ?? "",
    region: r.fields.Region ?? "",
    university: r.fields.University ?? "",
    phone: r.fields.Phone ?? "",
    address: r.fields.Address ?? "",
    hourlyRate: r.fields["Hourly Rate"] ?? 0,
    active: r.fields.Active !== false,
  }))
}

export async function adminUpdateWorker(
  workerId: string,
  fields: {
    name?: string
    email?: string
    phone?: string
    region?: string
    address?: string
    university?: string
    hourlyRate?: number
    active?: boolean
  },
): Promise<void> {
  const patch: Partial<WorkerFields> = {}
  if (fields.name !== undefined) patch["Full Name"] = fields.name
  if (fields.email !== undefined) patch.Email = fields.email
  if (fields.phone !== undefined) patch.Phone = fields.phone
  if (fields.region !== undefined) patch.Region = fields.region
  if (fields.address !== undefined) patch.Address = fields.address
  if (fields.university !== undefined) patch.University = fields.university
  if (fields.hourlyRate !== undefined) patch["Hourly Rate"] = fields.hourlyRate
  if (fields.active !== undefined) patch.Active = fields.active
  await update<WorkerFields>(TABLES.workers, workerId, patch)
}

export async function adminDeleteWorker(workerId: string): Promise<void> {
  await destroy(TABLES.workers, workerId)
}

export async function adminAddCredits(
  memberId: string,
  currentCredits: number,
  creditsToAdd: number,
): Promise<void> {
  await update<ClientFields>(TABLES.clients, memberId, {
    "Credits Remaining": currentCredits + creditsToAdd,
  })
}

export const SINGLE_CREDIT_FIELD: Record<string, keyof ClientFields> = {
  "private-30": "Single Credits 30",
  "private-45": "Single Credits 45",
  "private-60": "Single Credits 60",
  "private-90": "Single Credits 90",
}

export const SESSION_CREDIT_COST: Record<string, number> = {
  "pack-hour": 1, "private-60": 1, "private-45": 0.75, "private-30": 0.5, "private-90": 1.5,
}

/** Refund a credit to whichever pool (single or pack) the booking originally charged. */
export async function refundBookingCredit(
  clientId: string,
  clientFields: ClientFields,
  sessionType: string,
  usedSingleCredit: boolean,
  userId?: string,
): Promise<void> {
  if (usedSingleCredit) {
    const field = SINGLE_CREDIT_FIELD[sessionType]
    if (!field) {
      console.error(`[refundBookingCredit] ERROR: usedSingleCredit=true but sessionType="${sessionType}" has no single-credit field — no refund issued. clientId=${clientId}`)
      return
    }
    const current = (clientFields[field] as number | undefined) ?? 0
    console.log(`[refundBookingCredit] Single credit refund: clientId=${clientId} field="${field}" ${current} → ${current + 1}`)
    await update<ClientFields>(TABLES.clients, clientId, { [field]: current + 1 } as Partial<ClientFields>)
    if (userId) {
      const minLabel = sessionType.replace("private-", "")
      const plans = await getPlansForUser(userId)
      const isSpentSingle = (p: { status: string; sessions: number }) =>
        (p.status === "Used" || p.status === "Inactive") && p.sessions === 1
      const usedPlan = plans.find((p) => isSpentSingle(p) && p.planName.toLowerCase().includes(minLabel))
        ?? (minLabel ? undefined : plans.find(isSpentSingle))
      if (usedPlan) {
        console.log(`[refundBookingCredit] Reactivating single plan: planId=${usedPlan.id} "${usedPlan.planName}"`)
        await setPlanStatus(usedPlan.id, "Active").catch((e) => console.error(`[refundBookingCredit] Failed to reactivate plan ${usedPlan.id}:`, e))
      } else {
        console.warn(`[refundBookingCredit] No Used/Inactive single-session plan found for userId=${userId} sessionType=${sessionType}`)
      }
    }
    return
  }
  const creditRefund = SESSION_CREDIT_COST[sessionType] ?? 1
  const current = clientFields["Credits Remaining"] ?? 0
  const newTotal = Math.round((current + creditRefund) * 100) / 100
  console.log(`[refundBookingCredit] Pack credit refund: clientId=${clientId} sessionType=${sessionType} ${current} → ${newTotal} (+${creditRefund})`)
  await update<ClientFields>(TABLES.clients, clientId, {
    "Credits Remaining": newTotal,
  })
}

export async function adminAddSingleSessionCredits(
  memberId: string,
  sessionType: string,
  current: number,
): Promise<void> {
  const field = SINGLE_CREDIT_FIELD[sessionType]
  if (!field) throw new Error(`Unknown session type: ${sessionType}`)
  await update<ClientFields>(TABLES.clients, memberId, { [field]: current + 1 } as Partial<ClientFields>)
}

export async function adminCreateMember(fields: {
  name: string
  email: string
  phone?: string
  goals?: string
  creditsRemaining?: number
}): Promise<AdminMember> {
  const safeEmail = fields.email.trim().toLowerCase().replace(/'/g, "\\'")
  const existing = await list<ClientFields>(TABLES.clients, {
    filterByFormula: `LOWER({Email}) = '${safeEmail}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  if (existing.length > 0) {
    const r = existing[0]
    return {
      id: r.id,
      name: r.fields.Name ?? "",
      email: r.fields.Email ?? "",
      userId: r.fields["User ID"] ?? "",
      phone: r.fields.Phone ?? "",
      goals: r.fields.Goals ?? "",
      creditsRemaining: r.fields["Credits Remaining"] ?? 0,
      singleCredits: { "30": r.fields["Single Credits 30"] ?? 0, "45": r.fields["Single Credits 45"] ?? 0, "60": r.fields["Single Credits 60"] ?? 0, "90": r.fields["Single Credits 90"] ?? 0 },
      parentEmail: r.fields["Parent Email"] ?? "",
    }
  }
  const record = await create<ClientFields>(TABLES.clients, {
    Name: fields.name,
    Email: fields.email,
    Phone: fields.phone ?? "",
    Goals: fields.goals ?? "",
    "Credits Remaining": fields.creditsRemaining ?? 0,
  })
  return {
    id: record.id,
    name: record.fields.Name ?? "",
    email: record.fields.Email ?? "",
    userId: record.fields["User ID"] ?? "",
    phone: record.fields.Phone ?? "",
    goals: record.fields.Goals ?? "",
    creditsRemaining: record.fields["Credits Remaining"] ?? 0,
    singleCredits: { "30": 0, "45": 0, "60": 0, "90": 0 },
    parentEmail: record.fields["Parent Email"] ?? "",
  }
}

// Above this many ids, an OR(...) filterByFormula grows long enough to blow
// past Airtable's request-URL length limit (seen in production as a 414
// "Request-URI Too Large" once total booking volume grew — every booking's
// User ID was going into the formula). Past the threshold, it's cheaper and
// always safe to just pull the whole table and match in memory instead.
const FILTER_ID_THRESHOLD = 50

async function getClientsByUserIds(
  userIds: string[],
): Promise<Map<string, { name: string; email: string; phone: string }>> {
  const map = new Map<string, { name: string; email: string; phone: string }>()
  if (userIds.length === 0) return map

  const records = userIds.length > FILTER_ID_THRESHOLD
    ? await list<ClientFields>(TABLES.clients, {})
    : await list<ClientFields>(TABLES.clients, {
        filterByFormula: `OR(${userIds.map((id) => `{User ID} = '${id.replace(/'/g, "\\'")}'`).join(", ")})`,
      })

  for (const r of records) {
    const uid = r.fields["User ID"]
    if (!uid) continue
    map.set(uid, {
      name: r.fields.Name ?? "",
      email: r.fields.Email ?? "",
      phone: r.fields.Phone ?? "",
    })
  }
  return map
}

async function getClientsByEmails(
  emails: string[],
): Promise<Map<string, { name: string; email: string; phone: string }>> {
  const map = new Map<string, { name: string; email: string; phone: string }>()
  if (emails.length === 0) return map

  const records = emails.length > FILTER_ID_THRESHOLD
    ? await list<ClientFields>(TABLES.clients, {})
    : await list<ClientFields>(TABLES.clients, {
        filterByFormula: `OR(${emails.map((e) => `{Email} = '${e.replace(/'/g, "\\'")}'`).join(", ")})`,
      })

  for (const r of records) {
    const em = r.fields.Email
    if (!em) continue
    map.set(em.toLowerCase(), {
      name: r.fields.Name ?? "",
      email: em,
      phone: r.fields.Phone ?? "",
    })
  }
  return map
}

// --- Regional Director: team view -------------------------------------------

/** Returns all active PrepMasters whose "Reports to" field matches rdName. */
export async function getTeamForRD(rdName: string): Promise<PrepMaster[]> {
  const safe = rdName.replace(/'/g, "\\'")
  const records = await list<WorkerFields>(TABLES.workers, {
    filterByFormula: `AND({Reports to} = '${safe}', {Active} = TRUE())`,
    sort: [{ field: "Full Name", direction: "asc" }],
    revalidate: 60,
  })
  return records.map(toPrepMaster)
}

export type TeamBookingSummary = {
  pm: PrepMaster
  bookings: PrepMasterBooking[]
}

/**
 * For a list of PrepMaster names, fetch all bookings in a given month in one
 * Airtable call, then group the results by PM name.
 */
export async function getMonthBookingsForTeam(
  pmNames: string[],
  year: number,
  month: number,
): Promise<TeamBookingSummary[]> {
  if (pmNames.length === 0) return []

  const pad = (n: number) => String(n).padStart(2, "0")
  const startDate = `${year}-${pad(month)}-01`
  // Last day of the month
  const lastDay = new Date(year, month, 0).getDate()
  const endDate = `${year}-${pad(month)}-${pad(lastDay)}`

  const nameClauses = pmNames
    .map((n) => `{Prep Master Name} = '${n.replace(/'/g, "\\'")}'`)
    .join(", ")

  const records = await list<BookingFields>(TABLES.bookings, {
    filterByFormula: `AND(OR(${nameClauses}), {Date} >= '${startDate}', {Date} <= '${endDate}')`,
    sort: [{ field: "Date", direction: "asc" }],
    revalidate: 0,
  })

  // Bookings only store the dancer's User ID / email — the display name
  // lives on the Members record, so it has to be looked up separately
  // (matches getBookingsForPrepMaster above).
  const userIds = Array.from(
    new Set(records.map((r) => r.fields["User ID"]).filter(Boolean) as string[]),
  )
  const clientMap = await getClientsByUserIds(userIds)

  const grouped = new Map<string, PrepMasterBooking[]>()
  for (const name of pmNames) grouped.set(name, [])

  for (const r of records) {
    const pmName = r.fields["Prep Master Name"] ?? ""
    if (!grouped.has(pmName)) continue
    const status = r.fields.Status ?? "pending"
    const statusLc = status.toLowerCase()
    // Only include pending, confirmed, completed, cancelled
    if (!["pending", "confirmed", "completed"].includes(statusLc) && !statusLc.startsWith("cancel")) continue
    const uid = r.fields["User ID"] ?? ""
    const client = clientMap.get(uid)
    // "Completed" isn't its own Airtable status — a Confirmed booking whose
    // date has already passed is what "completed" means everywhere else in
    // the app (see isSessionPast in admin-overview-panel.tsx). Without this,
    // past-dated confirmed sessions stay stuck showing "Confirmed" forever.
    // A bare Date with no stored UTC Datetime must NOT be parsed as-is —
    // `new Date("2026-10-01")` means midnight UTC, which is already hours
    // in the past by US evening time even though the real session (e.g.
    // 5:30 AM local) hasn't happened yet. Combine Date + Time properly
    // instead of treating the date alone as a UTC instant.
    const fallbackIso = !r.fields["UTC Datetime"] && r.fields.Date && r.fields.Time
      ? etToUtcIso(r.fields.Date, r.fields.Time)
      : null
    const sessionMs = r.fields["UTC Datetime"]
      ? new Date(r.fields["UTC Datetime"]).getTime()
      : fallbackIso ? new Date(fallbackIso).getTime() : 0
    const isPast = sessionMs > 0 && sessionMs <= Date.now()
    const derivedStatus = statusLc.startsWith("cancel")
      ? "canceled"
      : statusLc === "confirmed" && isPast
        ? "completed"
        : statusLc
    grouped.get(pmName)!.push({
      id: r.id,
      date: r.fields.Date ?? "",
      time: r.fields.Time ?? "",
      utcDatetime: r.fields["UTC Datetime"] ?? null,
      status: derivedStatus,
      notes: r.fields.Notes ?? "",
      prepMasterNotes: r.fields["Prep Master Notes"] ?? "",
      declineReason: r.fields["Decline Reason"] ?? "",
      cancellationReason: r.fields["Cancellation Reason"] ?? "",
      dancerName: client?.name ?? "",
      dancerEmail: r.fields["Client Email"] ?? "",
      dancerPhone: "",
      userId: uid,
      sessionType: r.fields["Session Type"] ?? null,
      isReschedulePending: r.fields["Is Reschedule"] ?? false,
    })
  }

  return pmNames.map((name) => ({
    pm: { id: name, name, email: "", phone: "", region: "", university: "", address: "", workerRole: "PrepMaster", reportsTo: "" },
    bookings: grouped.get(name) ?? [],
  }))
}

export async function getAllRegionalDirectors(): Promise<PrepMaster[]> {
  const records = await list<WorkerFields>(TABLES.workers, {
    filterByFormula: `AND({Role} = 'Regional Director', {Active} = TRUE())`,
    sort: [{ field: "Full Name", direction: "asc" }],
    revalidate: 300,
  })
  return records.map(toPrepMaster)
}
