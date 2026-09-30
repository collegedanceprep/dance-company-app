export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import Link from "next/link"
import { isAirtableConfigured } from "@/lib/airtable"
import { getOrCreateProfile, getMyPlans } from "@/app/actions/profile"
import type { MemberPlan } from "@/lib/airtable"
import { getBookingsForUserId, type Booking } from "@/app/actions/booking"
import { getAvailabilityForEmail } from "@/app/actions/availability"
import { getPrepMasters } from "@/lib/airtable"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CalendarPlus, CalendarClock, AlertTriangle } from "lucide-react"
import { AirtableSetupNotice } from "@/components/airtable-setup-notice"
import { CreditsCard } from "@/components/credits-card"
import { GoogleCalendarButton } from "@/components/google-calendar-button"
import { MemberTabView } from "@/components/member-tab-view"
import { getSessionUserWithRole } from "@/lib/roles"
import { isCalendarConnected } from "@/lib/google-calendar"
import type { DayAvailability } from "@/lib/availability"
import { db } from "@/lib/db"
import { user as userTable } from "@/lib/db/schema"
import { eq, inArray } from "drizzle-orm"

export default async function DashboardPage() {
  const t0 = Date.now()
  const user = await getSessionUserWithRole()

  if (!isAirtableConfigured()) {
    return (
      <div className="flex flex-col gap-6">
        <Greeting name={user?.name?.split(" ")[0] ?? "Dancer"} isParent={false} />
        <AirtableSetupNotice />
      </div>
    )
  }

  // PrepMasters must never access the member dashboard — send them to their portal
  if (user?.role === "prep_master") redirect("/portal")

  // Admins previewing the member dashboard have no Clients record of their
  // own and shouldn't get one auto-created — that used to send them into an
  // onboarding loop every time they used "View as Member." (PrepMasters are
  // already redirected to /portal above, so only "admin" is possible here.)
  const noCreate = user?.role === "admin"
  const profileCheck = await getOrCreateProfile({ noCreate })
  // New users fill in their details first, then hit the pending wall
  if (profileCheck.isNewProfile) redirect("/onboarding")

  // Block pending/denied accounts after onboarding so their info is collected first
  if (user?.status === "pending") redirect("/pending")
  if (user?.status === "denied") redirect("/denied")

  let credits = 0
  let bookings: Booking[] = []
  let plans: MemberPlan[] = []
  let error: string | null = null
  let isParent = false
  let hasLinkedChild = true
  let displayName = user?.name?.split(" ")[0] ?? "Dancer"
  let calendarConnected = false

  const resolvedUser = user ? { id: user.id, email: user.email, name: user.name ?? "" } : undefined
  try {
    const profile = await getOrCreateProfile({ noCreate, resolvedUser })
    isParent = profile.isParentView
    hasLinkedChild = !isParent || Boolean(profile.recordId)

    if (hasLinkedChild) {
      const effectiveId = profile.effectiveUserId || user!.id
      const [myBookings, myPlans, calConn] = await Promise.all([
        getBookingsForUserId(effectiveId),
        getMyPlans(effectiveId, profile.email || user!.email),
        user ? isCalendarConnected(user.id) : Promise.resolve(false),
      ])
      credits = profile.creditsRemaining
      bookings = myBookings
      plans = myPlans
      calendarConnected = calConn
      displayName = (profile.name ?? "").split(" ")[0] || displayName
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Something went wrong."
  }

  const todayMs = new Date(new Date().toDateString()).getTime()
  function bookingMs(date: string) {
    return new Date(`${date}T00:00:00`).getTime()
  }
  function isInactive(status: string) {
    const s = status.toLowerCase()
    return s.startsWith("cancelled") || s === "declined"
  }
  const upcoming = bookings.filter((b) => {
    if (isInactive(b.status)) return false
    const ms = bookingMs(b.date)
    return !Number.isNaN(ms) && ms >= todayMs
  })
  const past = bookings
    .filter((b) => {
      if (isInactive(b.status)) return false
      const ms = bookingMs(b.date)
      return !Number.isNaN(ms) && ms < todayMs
    })
    .sort((a, b) => bookingMs(b.date) - bookingMs(a.date))
  const cancelled = bookings
    .filter((b) => isInactive(b.status))
    .sort((a, b) => bookingMs(b.date) - bookingMs(a.date))

  // Fetch availability + timezone for each unique prep master so the reschedule picker works
  const availabilityMap: Record<string, DayAvailability[]> = {}
  const timezoneMap: Record<string, string | null> = {}
  const uniquePrepMasterNames = [...new Set(upcoming.map((b) => b.prepMasterName).filter(Boolean))]
  if (uniquePrepMasterNames.length > 0) {
    try {
      const allPrepMasters = await getPrepMasters()
      const nameToEmail = Object.fromEntries(allPrepMasters.map((pm) => [pm.name, pm.email]))
      const pmEmails = uniquePrepMasterNames.map((n) => nameToEmail[n]).filter(Boolean) as string[]
      const [tzRows] = await Promise.all([
        pmEmails.length > 0
          ? db.select({ email: userTable.email, timezone: userTable.timezone }).from(userTable).where(inArray(userTable.email, pmEmails))
          : Promise.resolve([]),
      ])
      const emailToTz = Object.fromEntries(tzRows.map((r) => [r.email, r.timezone]))
      await Promise.all(
        uniquePrepMasterNames.map(async (name) => {
          const email = nameToEmail[name]
          if (!email) return
          timezoneMap[name] = emailToTz[email] ?? null
          try {
            availabilityMap[name] = await getAvailabilityForEmail(email)
          } catch {
            // non-critical
          }
        })
      )
    } catch {
      // non-critical
    }
  }

  if (isParent && !hasLinkedChild) {
    return (
      <div className="flex flex-col gap-8">
        <Greeting name={displayName} isParent={isParent} />
        <NoChildLinkedNotice parentEmail={user?.email ?? ""} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <Greeting name={displayName} isParent={isParent} />
        <GoogleCalendarButton connected={calendarConnected} />
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-3 py-5 text-sm">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-foreground">
                We couldn&apos;t reach your Airtable backend.
              </p>
              <p className="mt-1 text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <CreditsCard plans={plans} credits={credits} />

        <Card className="flex flex-col justify-between">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CalendarPlus className="size-4 text-primary" />
              Ready to train?
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Browse PrepMasters and book your next private session.
            </p>
            <Button asChild className="w-fit">
              <Link href="/dashboard/coaches">Book a session</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <MemberTabView
        upcoming={upcoming}
        past={past}
        cancelled={cancelled}
        credits={credits}
        plans={plans}
        calendarConnected={calendarConnected}
        availabilityMap={availabilityMap}
        timezoneMap={timezoneMap}
      />
    </div>
  )
}

function Greeting({ name, isParent, hasLinkedChild = true }: { name: string; isParent: boolean; hasLinkedChild?: boolean }) {
  return (
    <div>
      <h1 className="font-heading text-3xl font-bold tracking-tight">
        {isParent && hasLinkedChild ? `${name}'s account` : `Welcome, ${name}.`}
      </h1>
      <p className="mt-1 text-muted-foreground">
        {isParent
          ? hasLinkedChild
            ? `You're viewing ${name}'s sessions and credits as a parent.`
            : "You're signed in as a parent."
          : "Here's what's happening with your training."}
      </p>
    </div>
  )
}

function NoChildLinkedNotice({ parentEmail }: { parentEmail: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
          <AlertTriangle className="size-6 text-primary" />
        </div>
        <div className="max-w-sm">
          <p className="font-medium text-foreground">No dancer linked to your account yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask your dancer to sign up and enter{" "}
            <span className="font-medium text-foreground">{parentEmail}</span> in the &quot;Parent
            email&quot; field during their signup. Once they do, their sessions and credits will
            show up here automatically.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
