export type SingleCreditsByType = { "30": number; "45": number; "60": number; "90": number }

export type AdminMember = {
  id: string
  name: string
  email: string
  userId: string
  phone: string
  goals: string
  creditsRemaining: number
  singleCredits: SingleCreditsByType
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
  utcDatetime?: string | null
  status: string
  notes: string
  cancellationReason?: string | null
  sessionType: string | null
  singleCreditUsed?: boolean
  bookedBy?: "member" | "prep_master" | "admin" | null
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

export type DancePackage = {
  id: string
  name: string
  sessions: number
  price: number
  perSession: number
  savings: number
  expiryDays: number
  highlight?: boolean
  features: string[]
}

export type AdminDashboard = {
  members: AdminMember[]
  workers: AdminWorker[]
  bookings: AdminBooking[]
  plans: MemberPlan[]
  packages: DancePackage[]
}
