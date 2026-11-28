import { AmbientGlow } from "@/components/ambient-glow"
import { redirect } from "next/navigation"
import { BrandLogo } from "@/components/brand-logo"
import { ParentSignUpForm } from "@/components/parent-sign-up-form"
import { getSessionUserWithRole, homePathForRole } from "@/lib/roles"

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; child?: string }>
}) {
  const user = await getSessionUserWithRole()
  if (user) redirect(homePathForRole(user.role))

  const { email = "", child = "" } = await searchParams

  return (
    <main className="relative isolate min-h-screen flex flex-col items-center justify-center px-5 py-12">
      <AmbientGlow />
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <BrandLogo />
        </div>
        <div className="rounded-2xl border bg-card p-8 shadow-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight">
              {child ? `You're invited to view ${child}'s account` : "Parent access invited"}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Create a password for <strong>{email || "your email"}</strong> to get started.
              Your account will automatically be linked to your child&apos;s profile.
            </p>
          </div>
          <ParentSignUpForm email={email} />
        </div>
      </div>
    </main>
  )
}
