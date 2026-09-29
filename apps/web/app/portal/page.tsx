import { redirect } from "next/navigation"
import {
  getPrepMasterByEmail,
  isAirtableConfigured,
  getBookingsForPrepMaster,
} from "@/lib/airtable"
import { getSessionUserWithRole, isOpsManagementEmail } from "@/lib/roles"
import { isCalendarConnected } from "@/lib/google-calendar"
import { AirtableSetupNotice } from "@/components/airtable-setup-notice"
import { GoogleCalendarButton } from "@/components/google-calendar-button"
import { PortalTabView } from "@/components/portal-tab-view"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

export default async function PortalPage() {
  const user = await getSessionUserWithRole()
  const firstName = user?.name?.split(" ")[0] ?? "there"

  // Ops-only users (not admin, not a PrepMaster) have no schedule of their
  // own — send them straight to the Ops Management tab.
  if (user && user.role !== "admin" && user.role !== "prep_master" && isOpsManagementEmail(user.email)) {
    redirect("/portal/ops-management")
  }

  // Silently remove any stale Airtable Members record for this PrepMaster
  // so it never gets a User ID stamped on it and spills into the Members panel.
  if (user && isAirtableConfigured()) {
    const { appBase, TABLES } = await import("@/lib/airtable")
    const safe = user.email.replace(/'/g, "\\'")
    appBase.list(TABLES.clients, {
      filterByFormula: `LOWER({Email}) = '${safe}'`,
      maxRecords: 1,
      revalidate: 0,
    }).then((records) => {
      if (records[0]) appBase.destroy(TABLES.clients, records[0].id).catch(() => {})
    }).catch(() => {})
  }

  if (!isAirtableConfigured()) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Welcome, {firstName}</h1>
        <AirtableSetupNotice />
      </div>
    )
  }

  const prepMaster = user ? await getPrepMasterByEmail(user.email) : null

  if (!prepMaster) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Welcome, {firstName}</h1>
        <Card className="border-accent/50">
          <CardHeader>
            <CardTitle className="text-lg">Your staff record isn&apos;t linked yet</CardTitle>
            <CardDescription>
              We couldn&apos;t find a Workers record in Airtable with the email{" "}
              <span className="font-medium">{user?.email}</span>. Ask your admin to add a row in
              the Workers table (marked Active) using this exact email, then refresh.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const [bookings, calendarConnected] = await Promise.all([
    getBookingsForPrepMaster(prepMaster.name),
    user ? isCalendarConnected(user.id) : Promise.resolve(false),
  ])
  const today = startOfToday()
  const statusLc = (b: { status: string }) => b.status.toLowerCase()
  const isPast = (b: { date: string }) => b.date && new Date(`${b.date}T00:00:00`) < today
  const isActive = (b: { status: string }) =>
    !statusLc(b).startsWith("cancelled") && statusLc(b) !== "declined"

  const upcoming = bookings.filter((b) => isActive(b) && (!b.date || !isPast(b)))
  const completed = bookings.filter((b) => isActive(b) && isPast(b))
  const cancelled = bookings.filter((b) => statusLc(b).startsWith("cancelled"))
  const declined = bookings.filter((b) => statusLc(b) === "declined")

  const pendingCount = upcoming.filter((b) => statusLc(b) === "pending").length

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Welcome, {firstName}</h1>
          <p className="mt-1 text-muted-foreground">
            Here are your private sessions. Confirm or decline any pending requests.
          </p>
        </div>
        <GoogleCalendarButton connected={calendarConnected} />
      </div>

      <PortalTabView
        upcoming={upcoming}
        completed={completed}
        cancelled={cancelled}
        declined={declined}
        pendingCount={pendingCount}
        calendarConnected={calendarConnected}
      />
    </div>
  )
}
