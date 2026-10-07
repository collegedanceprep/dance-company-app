import { Suspense } from "react"
import { getAdminData } from "@/app/actions/admin"
import { AdminTabs } from "@/components/admin-tabs"

export default async function AdminPage() {
  const { members, bookings, workers, plans, packages, creditAdjustments } = await getAdminData()

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Admin</h1>
        <p className="mt-1 text-muted-foreground">
          Manage member accounts, PrepMasters, and company performance.
        </p>
      </div>
      <Suspense>
        <AdminTabs
          members={members}
          bookings={bookings}
          workers={workers}
          plans={plans}
          packages={packages}
          creditAdjustments={creditAdjustments}
        />
      </Suspense>
    </div>
  )
}
