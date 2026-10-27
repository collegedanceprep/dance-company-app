import { useEffect, useState } from "react"
import { API_BASE } from "@/lib/config"
import { View, ActivityIndicator, Text, TouchableOpacity } from "react-native"
import { useRouter } from "expo-router"
import { authClient, useSession } from "@/lib/auth-client"
import { useColors } from "@/lib/theme-context"
import * as SecureStore from "expo-secure-store"

const PRIMER_KEY = "notify_primer_seen"

export default function Index() {
  const { data: session, isPending } = useSession()
  const router = useRouter()
  const COLORS = useColors()
  const [loadFailed, setLoadFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (isPending) return
    setLoadFailed(false)

    if (!session?.user) {
      router.replace("/(auth)/sign-in")
      return
    }

    authClient.$fetch("https://app.collegedanceprep.com/api/me")
      .then(async ({ data, error }) => {
        // Only a real "not signed in" answer goes to sign-in. A server or network
        // failure must not: sign-in bounces anyone with a saved session straight
        // back here, which looped forever (and hammered /api/me) during outages.
        const httpStatus = (error as { status?: number } | null)?.status
        if (httpStatus === 401 || httpStatus === 403) { router.replace("/(auth)/sign-in"); return }
        if (error || !data) { setLoadFailed(true); return }
        const role: string = (data as any).role ?? "dancer"
        const status: string = (data as any).status ?? "active"
        const userId = (data as any).id
        const isParent: boolean = (data as any).isParent || (data as any).isParentAccount

        if (status === "denied") { router.replace("/(auth)/denied"); return }

        // For dancers who haven't completed onboarding, show it first regardless of
        // pending status — welcome.tsx routes them to pending after they save/skip.
        if (role === "dancer" && userId && !isParent) {
          const seen = await SecureStore.getItemAsync(`welcome_seen_${userId}`)
          if (!seen) {
            await SecureStore.setItemAsync(`welcome_seen_${userId}`, "1")
            router.replace("/(auth)/welcome")
            return
          }
        }

        if (status === "pending") { router.replace("/(auth)/pending"); return }
        const primerSeen = await SecureStore.getItemAsync(PRIMER_KEY)
        if (!primerSeen) { router.replace("/(auth)/notify-primer"); return }
        if (role === "admin") { router.replace("/admin"); return }
        if (role === "prep_master") { router.replace("/portal"); return }
        if (role === "dancer" && userId) {
          if (isParent) {
            router.replace("/(auth)/child-picker")
            return
          }
        }
        router.replace("/member")
      })
      .catch(() => setLoadFailed(true))
  }, [session, isPending, attempt])

  if (loadFailed) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.background, padding: 32, gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: COLORS.text, textAlign: "center" }}>
          Can't reach College Dance Prep
        </Text>
        <Text style={{ fontSize: 14, color: COLORS.textMuted, textAlign: "center" }}>
          Check your connection and try again. If it keeps happening, we're likely having a temporary issue.
        </Text>
        <TouchableOpacity
          onPress={() => setAttempt((n) => n + 1)}
          activeOpacity={0.8}
          style={{ backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, marginTop: 8 }}
        >
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 15 }}>Try again</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.background }}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  )
}
