import { redirect } from "next/navigation"
import { getSessionUserWithRole } from "@/lib/roles"
import {
  getPrepMasterByEmail,
  getTeamForRD,
  getMonthBookingsForTeam,
  getAllRegionalDirectors,
  isAirtableConfigured,
} from "@/lib/airtable"
import { MyPrepMastersView } from "@/components/my-prep-masters-view"
import { AirtableSetupNotice } from "@/components/airtable-setup-notice"

export default async function MyPrepMastersPage() {
  const user = await getSessionUserWithRole()
  if (!user) redirect("/")

  const isAdmin = user.role === "admin"

  if (!isAirtableConfigured()) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-heading text-3xl font-bold tracking-tight">My PrepMasters</h1>
        <AirtableSetupNotice />
      </div>
    )
  }

  const worker = await getPrepMasterByEmail(user.email)

  // Admins and Regional Directors can access this page
  const isRD = worker?.workerRole === "Regional Director"
  if (!isAdmin && !isRD) redirect("/portal")

  const now = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth() + 1

  if (isAdmin) {
    // Admins see all RDs and can toggle between them
    const allRDs = await getAllRegionalDirectors()
    // Default to first RD for initial render
    const firstRD = allRDs[0]
    const team = firstRD ? await getTeamForRD(firstRD.name) : []
    const summaries = team.length
      ? await getMonthBookingsForTeam(team.map((pm) => pm.name), year, month)
      : []
    const pmMap = new Map(team.map((pm) => [pm.name, pm]))
    const initialTeam = summaries.map((s) => ({
      pm: pmMap.get(s.pm.name) ?? s.pm,
      bookings: s.bookings,
    }))

    return (
      <MyPrepMastersView
        initialTeam={initialTeam}
        initialYear={year}
        initialMonth={month}
        isAdmin={true}
        allRDs={allRDs.map((rd) => rd.name)}
        initialRdName={firstRD?.name ?? ""}
        canDeactivate
      />
    )
  }

  // Regional Director: show their own team
  const team = await getTeamForRD(worker!.name)
  const summaries = await getMonthBookingsForTeam(team.map((pm) => pm.name), year, month)
  const pmMap = new Map(team.map((pm) => [pm.name, pm]))
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
      initialRdName={worker!.name}
      canDeactivate
    />
  )
}
