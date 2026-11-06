import { redirect } from "next/navigation"
import { getSessionUserWithRole, isSchedulerEmail } from "@/lib/roles"
import { getSchedulerBookingData } from "@/app/actions/admin"
import { isAirtableConfigured } from "@/lib/airtable"
import { AdminBookSessionPanel } from "@/components/admin-book-session-panel"
import { AirtableSetupNotice } from "@/components/airtable-setup-notice"

export default async function BookForDancersPage() {
  const user = await getSessionUserWithRole()
  if (!user) redirect("/")
  if (user.role !== "admin" && !isSchedulerEmail(user.email)) redirect("/portal")

  if (!isAirtableConfigured()) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Book for dancers</h1>
        <AirtableSetupNotice />
      </div>
    )
  }

  const { members, workers } = await getSchedulerBookingData()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Book for dancers</h1>
        <p className="mt-1 text-sm text-muted-foreground">Book a session for any dancer with any PrepMaster.</p>
      </div>
      <AdminBookSessionPanel members={members} workers={workers} />
    </div>
  )
}
