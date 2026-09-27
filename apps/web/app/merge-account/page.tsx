"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BrandLogo } from "@/components/brand-logo"
import { Loader2, GitMerge } from "lucide-react"

export default function MergeAccountPage() {
  const router = useRouter()
  const params = useSearchParams()
  const fromId = params.get("from") ?? ""

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!fromId) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm text-center">
          <BrandLogo />
          <p className="mt-6 text-muted-foreground text-sm">Invalid or expired merge link.</p>
        </div>
      </main>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      // Sign in with existing account credentials
      const { error: signInError } = await authClient.signIn.email({ email, password })
      if (signInError) throw new Error("Couldn't sign in with those credentials. Please double-check your email and password.")

      // Merge the Apple relay account into this one
      const res = await fetch("/api/account/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Merge failed.")

      router.push("/dashboard?merged=1")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandLogo />
          <div>
            <div className="flex items-center justify-center gap-2 mt-4">
              <GitMerge className="size-5 text-muted-foreground" />
              <h1 className="font-heading text-2xl font-semibold">Link your accounts</h1>
            </div>
            <p className="text-muted-foreground mt-2 text-sm">
              Sign in with your existing account to link it with your Apple Sign-In.
              You'll be able to use either method going forward.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" size="lg" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            Link accounts
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Not you? <a href="/dashboard" className="underline underline-offset-2">Go to your dashboard</a>
        </p>
      </div>
    </main>
  )
}
