"use client"

import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"

export function AppleSignInButton({
  callbackURL = "/dashboard",
  errorCallbackURL = "/?error=account_not_linked",
  className,
}: {
  callbackURL?: string
  errorCallbackURL?: string
  className?: string
}) {
  const [loading, setLoading] = useState(false)

  async function handleSignIn() {
    setLoading(true)
    try {
      await authClient.signIn.social({
        provider: "apple",
        callbackURL,
        errorCallbackURL,
      })
    } catch {
      setLoading(false)
    }
  }

  return (
    <Button
      type="button"
      size="lg"
      onClick={handleSignIn}
      disabled={loading}
      className={className}
    >
      {loading ? (
        <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      ) : (
        <AppleIcon className="size-5" />
      )}
      Continue with Apple
    </Button>
  )
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 814 1000" aria-hidden="true" fill="currentColor">
      <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105.5-37.3-140.4-86.8C70.3 728.4 50 580.4 50 539.8c0-238.8 156.5-365.1 310.7-365.1 81.9 0 149.8 54.7 200.6 54.7 48.5 0 123.1-57.8 215.9-57.8 34.8 0 127.8 3.2 195.8 95.2zm-31.5-160.5c-37.1-44.9-93-79-147.5-79-6.4 0-12.8.6-19.2 1.3-52.5 5.8-106.3 43.5-142.5 88.4-32.7 40.2-60.3 102.2-60.3 167.8 0 7.1.6 14.2 1.3 20.5 3.2.6 8.4 1.3 13.5 1.3 51.8 0 108.2-35.3 141.9-79 36.3-47.5 62.3-110.1 62.3-177.1 0-7-1-13.9-1.3-20.5-3.2-.7-6.5-1.3-9.9-1.3z" />
    </svg>
  )
}
