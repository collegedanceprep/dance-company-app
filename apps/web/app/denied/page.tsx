"use client"

import { XCircle } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { useRouter } from "next/navigation"

export default function DeniedPage() {
  const router = useRouter()

  async function handleSignOut() {
    await authClient.signOut()
    router.push("/")
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <XCircle className="w-8 h-8 text-destructive" />
          </div>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Account Not Approved</h1>
          <p className="text-muted-foreground">
            Your account request was not approved. If you believe this is a mistake,
            please reach out and we'll look into it.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Contact us at{" "}
          <a href="mailto:collegedanceprep@gmail.com" className="text-primary underline">
            collegedanceprep@gmail.com
          </a>
        </p>
        <button type="button" onClick={handleSignOut} className="text-sm text-muted-foreground underline">
          Sign out
        </button>
      </div>
    </main>
  )
}
