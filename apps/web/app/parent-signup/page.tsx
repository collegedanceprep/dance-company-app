import { redirect } from "next/navigation"
import { BrandLogo } from "@/components/brand-logo"
import { ParentSelfSignUpForm } from "@/components/parent-self-sign-up-form"
import { getSessionUserWithRole, homePathForRole } from "@/lib/roles"

export default async function ParentSignUpPage() {
  const user = await getSessionUserWithRole()
  if (user) redirect(homePathForRole(user.role))

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <BrandLogo />
        </div>
        <div className="rounded-2xl border bg-card p-8 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">Parent sign-up</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Create an account to view your child&apos;s sessions and credits.
            </p>
          </div>
          <ParentSelfSignUpForm />
        </div>
      </div>
    </main>
  )
}
