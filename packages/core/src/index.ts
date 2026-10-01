// Shared types, constants, and utilities for CDP web and mobile apps.
// No server-only imports allowed here.

// ---------------------------------------------------------------------------
// Packages & pricing
// ---------------------------------------------------------------------------

export type DancePackage = {
  id: string
  name: string
  sessions: number
  price: number
  perSession: number
  savings: number
  /** Days from purchase date before the plan expires. */
  expiryDays: number
  features: string[]
  highlight?: boolean
}

export type PerPrivate = {
  id: string
  name: string
  minutes: number
  price: number
}

export const SINGLE_HOUR_PRICE = 115

export const PACKAGES: DancePackage[] = [
  {
    id: "pack-4",
    name: "4 Pack",
    sessions: 4,
    price: 445,
    perSession: 111,
    savings: 15,
    expiryDays: 180,
    features: [
      "4 hourly private sessions",
      "Book with any Prepmaster",
      "Save $15 vs. individual sessions",
    ],
  },
  {
    id: "pack-8",
    name: "8 Pack",
    sessions: 8,
    price: 870,
    perSession: 109,
    savings: 50,
    expiryDays: 180,
    features: [
      "8 hourly private sessions",
      "Book with any Prepmaster",
      "Save $50 vs. individual sessions",
    ],
  },
  {
    id: "pack-12",
    name: "12 Pack",
    sessions: 12,
    price: 1280,
    perSession: 107,
    savings: 100,
    expiryDays: 365,
    features: [
      "12 hourly private sessions",
      "Book with any Prepmaster",
      "Save $100 vs. individual sessions",
    ],
  },
  {
    id: "pack-16",
    name: "16 Pack",
    sessions: 16,
    price: 1690,
    perSession: 106,
    savings: 150,
    expiryDays: 365,
    highlight: true,
    features: [
      "16 hourly private sessions",
      "Book with any Prepmaster",
      "Save $150 vs. individual sessions",
    ],
  },
  {
    id: "pack-20",
    name: "20 Pack",
    sessions: 20,
    price: 2100,
    perSession: 105,
    savings: 200,
    expiryDays: 365,
    features: [
      "20 hourly private sessions",
      "Book with any Prepmaster",
      "Save $200 vs. individual sessions",
    ],
  },
  {
    id: "pack-24",
    name: "24 Pack",
    sessions: 24,
    price: 2510,
    perSession: 105,
    savings: 250,
    expiryDays: 365,
    features: [
      "24 hourly private sessions",
      "Book with any Prepmaster",
      "Save $250 vs. individual sessions",
    ],
  },
]

export const PER_PRIVATE: PerPrivate[] = [
  { id: "private-30", name: "30 Minute", minutes: 30, price: 65 },
  { id: "private-45", name: "45 Minute", minutes: 45, price: 89 },
  { id: "private-60", name: "Hour", minutes: 60, price: 115 },
  { id: "private-90", name: "90 Minute", minutes: 90, price: 165 },
]

export function formatPrice(amount: number) {
  return `$${amount.toLocaleString("en-US")}`
}

// How much of a full hourly rate a session of this type/length is worth,
// used for PrepMaster pay (which scales with session duration).
export const SESSION_DURATION_FRACTION: Record<string, number> = {
  "private-30": 0.5,
  "private-45": 0.75,
  "private-60": 1,
  "private-90": 1.5,
  "pack-hour": 1,
}

/**
 * The real dollar amount a session of this type bills at — the single
 * source of truth for revenue/margin math everywhere (admin overview,
 * PrepMaster payroll, web and mobile alike). Previously several places
 * each derived their own approximation from SINGLE_HOUR_PRICE * a generic
 * duration fraction (e.g. 30-min showing $57.50 instead of the real $65
 * single-session price), or hardcoded a separate, stale price list that
 * drifted out of sync and omitted 90-minute sessions entirely.
 */
export function sessionRevenue(sessionType: string | null | undefined): number {
  if (sessionType === "pack-hour") return PACKAGES[0].perSession
  const match = PER_PRIVATE.find((p) => p.id === sessionType)
  if (match) return match.price
  return SINGLE_HOUR_PRICE
}

// ---------------------------------------------------------------------------
// Shared data types (mirrors Airtable shapes, safe to use on client/mobile)
// ---------------------------------------------------------------------------

export type MemberPlan = {
  id: string
  userId: string
  planName: string
  sessions: number
  pricePaid: number
  purchasedAt: string
  expiresAt: string
  status: string
}

export type UserRole = "admin" | "prep_master" | "dancer"

export type Booking = {
  id: string
  date: string
  time: string
  status: string
  prepMasterName: string
  notes: string
}

// ---------------------------------------------------------------------------
// Plan utilities
// ---------------------------------------------------------------------------

export function planDisplayStatus(plan: MemberPlan): string {
  if (plan.status === "Active" && plan.expiresAt && new Date(plan.expiresAt) < new Date()) {
    return "Inactive"
  }
return plan.status
}

export function planExpiryLabel(plan: MemberPlan): string {
  if (!plan.expiresAt) return ""
  const d = new Date(plan.expiresAt)
  return `Expires ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
}
