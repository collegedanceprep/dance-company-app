"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { CheckCircle, Smartphone, Loader2, Clock } from "lucide-react"

type State = "confirming" | "ready" | "delayed" | "error"

function PurchaseSuccessContent() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get("session_id")
  const [state, setState] = useState<State>("confirming")

  useEffect(() => {
    if (!sessionId) {
      setState("error")
      return
    }
    let cancelled = false
    fetch("/api/checkout/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then((res) => res.json())
      .then((data: { fulfilled?: boolean; paymentStatus?: string }) => {
        if (cancelled) return
        if (data.fulfilled) setState("ready")
        else if (data.paymentStatus && data.paymentStatus !== "paid") setState("delayed")
        else setState("error")
      })
      .catch(() => {
        if (!cancelled) setState("error")
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  function openApp() {
    // Try to open the native app via custom scheme. After a short delay,
    // if the app didn't open (user doesn't have it installed), do nothing.
    window.location.href = "cdp://member/plans"
  }

  if (state === "confirming") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center px-4">
        <Loader2 className="size-10 animate-spin text-primary" aria-hidden="true" />
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Confirming your purchase…</h1>
          <p className="mt-2 text-muted-foreground max-w-sm">
            Hang tight while we add your session credits — this only takes a second.
          </p>
        </div>
      </div>
    )
  }

  if (state === "delayed" || state === "error") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center px-4">
        <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
          <Clock className="size-10 text-primary" />
        </div>
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">Almost there!</h1>
          <p className="mt-2 text-muted-foreground max-w-sm">
            Your purchase is finishing up on our end — your credits will show up in just a few minutes. No need to do anything else.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
        >
          Continue to dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center px-4">
      <div className="flex size-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
        <CheckCircle className="size-10 text-green-600 dark:text-green-400" />
      </div>

      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">Purchase complete!</h1>
        <p className="mt-2 text-muted-foreground max-w-sm">
          Your session credits have been added to your account. Head back to the College Dance Prep app to book your sessions.
        </p>
      </div>

      {/* Primary CTA — open the app */}
      <button
        onClick={openApp}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
      >
        <Smartphone className="size-5" />
        Open CDP Booking App
      </button>

      <p className="text-sm text-muted-foreground">
        Don&apos;t have the app?{" "}
        <Link href="/dashboard" className="underline underline-offset-2 hover:text-foreground transition-colors">
          Continue on the web
        </Link>
      </p>
    </div>
  )
}

export default function PurchaseSuccessPage() {
  return (
    <Suspense>
      <PurchaseSuccessContent />
    </Suspense>
  )
}
