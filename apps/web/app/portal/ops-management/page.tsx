import { redirect } from "next/navigation"
import { getSessionUserWithRole, isOpsManagementEmail } from "@/lib/roles"
import {
  getPrepMasters,
  getMonthBookingsForTeam,
  isAirtableConfigured,
} from "@/lib/airtable"
import { MyPrepMastersView } from "@/components/my-prep-masters-view"
import { AirtableSetupNotice } from "@/components/airtable-setup-notice"

export default async function OpsManagementPage() {
  const user = await getSessionUserWithRole()
  if (!user) redirect("/")

  const isAdmin = user.role === "admin"
  const isOps = isOpsManagementEmail(user.email)
  if (!isAdmin && !isOps) redirect("/portal")

  if (!isAirtableConfigured()) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Ops Management</h1>
        <AirtableSetupNotice />
      </div>
    )
  }

  const now = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth() + 1

  const allPMs = await getPrepMasters()
  const summaries = allPMs.length
    ? await getMonthBookingsForTeam(allPMs.map((pm) => pm.name), year, month)
    : []
  const pmMap = new Map(allPMs.map((pm) => [pm.name, pm]))
  const initialTeam = summaries.map((s) => ({
    pm: pmMap.get(s.pm.name) ?? s.pm,
    bookings: s.bookings,
  }))

  return (
    <MyPrepMastersView
      initialTeam={initialTeam}
      initialYear={year}
      initialMonth={month}
      isAdmin={false}
      allRDs={[]}
      initialRdName=""
      title="Ops Management"
      subtitle={(count) => `${count} PrepMaster${count !== 1 ? "s" : ""} company-wide`}
      apiEndpoint="/api/portal/ops-management"
    />
  )
}
