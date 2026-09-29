import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import Link from "next/link"
import { StaffHeader } from "@/components/staff-header"
import { PortalNav } from "@/components/portal-nav"
import { Toaster } from "@/components/ui/sonner"
import {
  getSessionUserWithRole,
  homePathForRole,
  markInviteAccepted,
  isOpsManagementEmail,
} from "@/lib/roles"
import { getPrepMasterByEmail, isAirtableConfigured } from "@/lib/airtable"
import { ShieldCheck } from "lucide-react"

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUserWithRole()
  if (!user) redirect("/")

  const isAdmin = user.role === "admin"
  const isOps = isOpsManagementEmail(user.email)

  if (!isAdmin && user.role !== "prep_master" && !isOps) redirect(homePathForRole(user.role))

  if (user.role === "prep_master") {
    await markInviteAccepted(user.email)
  }

  // Check if this user is a Regional Director or admin to show the My PrepMasters tab
  let showMyPrepMasters = isAdmin
  if (!showMyPrepMasters && isAirtableConfigured()) {
    const worker = await getPrepMasterByEmail(user.email)
    showMyPrepMasters = worker?.workerRole === "Regional Director"
  }

  return (
    <div className="min-h-screen">
      <StaffHeader
        user={{ name: user.name, email: user.email, image: user.image }}
        roleLabel={isAdmin ? "Admin" : user.role === "prep_master" ? "PrepMaster" : "Ops"}
        homeHref="/portal"
        isAdmin={isAdmin}
      />
      {isAdmin && (
        <div className="bg-primary/10 border-b border-primary/20 px-5 py-2">
          <div className="mx-auto max-w-5xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-primary font-medium">
              <ShieldCheck className="size-4" />
              Previewing as PrepMaster
            </div>
            <Link href="/admin" className="text-xs text-primary underline underline-offset-2 hover:no-underline">
              Back to Admin
            </Link>
          </div>
        </div>
      )}
      <div className="mx-auto max-w-5xl px-5 pt-4">
        <PortalNav isRD={showMyPrepMasters} isOps={isAdmin || isOps} opsOnly={!isAdmin && user.role !== "prep_master"} />
      </div>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
      <Toaster position="top-center" />
    </div>
  )
}
