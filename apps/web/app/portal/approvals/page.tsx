import { redirect } from "next/navigation"
import { getSessionUserWithRole, isApproverEmail } from "@/lib/roles"
import { AdminApprovalsPanel } from "@/components/admin-approvals-panel"

export default async function PortalApprovalsPage() {
  const user = await getSessionUserWithRole()
  if (!user) redirect("/")
  if (user.role !== "admin" && !isApproverEmail(user.email)) redirect("/portal")

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Approvals</h1>
        <p className="mt-1 text-sm text-muted-foreground">Approve or deny new dancer and parent signups.</p>
      </div>
      <AdminApprovalsPanel canDelete={user.role === "admin"} />
    </div>
  )
}
