import { AmbientGlow } from "@/components/ambient-glow"
import Image from "next/image"
import { redirect } from "next/navigation"
import { BrandLogo } from "@/components/brand-logo"
import { AuthForm } from "@/components/auth-form"
import { CalendarCheck, Sparkles, Trophy } from "lucide-react"
import { getSessionUserWithRole, homePathForRole } from "@/lib/roles"

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const user = await getSessionUserWithRole()
  if (user) redirect(homePathForRole(user.role))

  const { error } = await searchParams

  return (
    <main className="relative isolate min-h-screen">
      <AmbientGlow />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <BrandLogo />
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-6 lg:grid-cols-2 lg:gap-12 lg:pt-12">
        <div className="flex flex-col gap-6">
          <span className="inline-flex w-fit items-center gap-2 rounded-full bg-secondary px-3 py-1 text-sm font-medium text-secondary-foreground">
            <Sparkles className="size-4 text-primary" />
            1-1 training designed specifically for the teams you are auditioning for
          </span>
          <h1 className="text-balance font-heading text-4xl font-light leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Get Prepared. Make The Team.
          </h1>
          <p className="max-w-md text-pretty text-lg leading-relaxed text-muted-foreground">
            College Dance Prep is the #1 trusted choice for dancers serious
            about making their team. Pick your PrepMaster, choose a date, and
            join the 1,000+ dancers who have{" "}
            <span className="font-medium text-foreground">#MadeTheTeam</span>
          </p>

          <div className="rounded-2xl border bg-card p-5 shadow-sm">
            <AuthForm initialError={
              error === "account_not_linked"
                ? "This Google account is already linked to an email/password account. Please sign in with your email and password instead."
                : error === "auth_error"
                  ? "Something went wrong during sign-in. Please try again."
                  : undefined
            } />
          </div>

          <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-3 text-sm">
            <li className="flex items-center gap-2">
              <CalendarCheck className="size-4 text-primary" />
              Flexible scheduling
            </li>
            <li className="flex items-center gap-2">
              <Trophy className="size-4 text-primary" />
              Vetted PrepMasters
            </li>
            <li className="flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Session packages
            </li>
          </ul>
        </div>

        <div className="relative aspect-[4/5] overflow-hidden rounded-3xl border bg-muted shadow-sm lg:aspect-[4/5]">
          <Image
            src="/images/hero-dancer.png"
            alt="A contemporary dancer mid-leap in a sunlit studio"
            fill
            priority
            className="object-cover"
            sizes="(min-width: 1024px) 40vw, 100vw"
          />
        </div>
      </section>
    </main>
  )
}
