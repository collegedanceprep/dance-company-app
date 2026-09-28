"use client"
import { Suspense } from "react"
import Link from "next/link"
import { CheckCircle, Smartphone } from "lucide-react"
import { useSearchParams } from "next/navigation"

const APP_STORE_URL = "https://apps.apple.com/app/id6744042829"

function WelcomeContent() {
  const searchParams = useSearchParams()
  const isPrep = searchParams.get("role") === "prep"
  const deepLink = isPrep ? "cdp://" : "cdp://member/plans"

  function handleOpenApp() {
    // Try the deep link; if the app isn't installed the browser won't navigate
    // so after a short delay redirect to the App Store instead.
    window.location.href = deepLink
    setTimeout(() => {
      window.location.href = APP_STORE_URL
    }, 1500)
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center px-4">
      <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
        <CheckCircle className="size-10 text-primary" />
      </div>

      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          {isPrep ? "Account created!" : "You're connected."}
        </h1>
        <p className="mt-2 text-muted-foreground max-w-sm">
          {isPrep
            ? "Download the College Dance Prep app to manage your sessions and availability."
            : "Your account is now linked to your child's sessions and credits."}
        </p>
      </div>

      <button
        onClick={handleOpenApp}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
      >
        <Smartphone className="size-5" />
        {isPrep ? "Open PrepMaster App" : "Open CDP Booking App"}
      </button>

      <Link
        href={isPrep ? "/portal" : "/dashboard"}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        Continue on web
      </Link>
    </div>
  )
}

export default function WelcomePage() {
  return (
    <Suspense>
      <WelcomeContent />
    </Suspense>
  )
}
