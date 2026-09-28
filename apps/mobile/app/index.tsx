import { useEffect } from "react"
import { API_BASE } from "@/lib/config"
import { View, ActivityIndicator } from "react-native"
import { useRouter } from "expo-router"
import { authClient, useSession } from "@/lib/auth-client"
import { useColors } from "@/lib/theme-context"
import * as SecureStore from "expo-secure-store"

const PRIMER_KEY = "notify_primer_seen"

export default function Index() {
  const { data: session, isPending } = useSession()
  const router = useRouter()
  const COLORS = useColors()

  useEffect(() => {
    if (isPending) return

    if (!session?.user) {
      router.replace("/(auth)/sign-in")
      return
    }

    authClient.$fetch("https://app.collegedanceprep.com/api/me")
      .then(async ({ data, error }) => {
        if (error || !data) { router.replace("/(auth)/sign-in"); return }
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
      .catch(() => {
        router.replace("/(auth)/sign-in")
      })
  }, [session, isPending])

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: COLORS.background }}>
      <ActivityIndicator size="large" color={COLORS.primary} />
    </View>
  )
}
