import { createAuthClient } from "better-auth/react"
import { expoClient } from "@better-auth/expo/client"
import * as SecureStore from "expo-secure-store"
import { router } from "expo-router"
import { API_BASE } from "@/lib/config"

// When an API call comes back 401, check whether the login is really gone (not just the
// brief cookie lag right after switching views). If it is, clear the saved login and send
// the person to sign-in instead of leaving a raw "unauthorized" banner on screen.
let handlingExpiry = false
async function handleUnauthorized(url: string) {
  if (handlingExpiry || url.includes("/api/auth/")) return
  handlingExpiry = true
  try {
    await new Promise((r) => setTimeout(r, 600))
    const { data, error } = await authClient.getSession()
    // Only act on a definite "no session"; a network failure leaves things alone.
    if (data?.session || (error && error.status !== 401)) return
    await authClient.signOut().catch(() => {})
    router.replace("/(auth)/sign-in")
  } finally {
    handlingExpiry = false
  }
}

export const authClient = createAuthClient({
  baseURL: API_BASE,
  fetchOptions: {
    onError: (ctx) => {
      if (ctx.response?.status === 401) void handleUnauthorized(String(ctx.request?.url ?? ""))
    },
  },
  plugins: [
    expoClient({
      scheme: "cdp",
      storagePrefix: "cdp-auth",
      storage: SecureStore,
    }),
  ],
})

export const { signIn, signUp, signOut, useSession } = authClient
