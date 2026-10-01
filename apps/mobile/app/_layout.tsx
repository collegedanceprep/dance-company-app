import { useEffect, useRef, useState } from "react"
import { API_BASE } from "@/lib/config"
import { AppState } from "react-native"
import { ForceUpdateModal } from "@/components/ForceUpdateModal"
import Constants from "expo-constants"
import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import * as WebBrowser from "expo-web-browser"
import * as SplashScreen from "expo-splash-screen"
import { useFonts } from "expo-font"
import {
  Sora_400Regular,
  Sora_500Medium,
  Sora_600SemiBold,
  Sora_700Bold,
} from "@expo-google-fonts/sora"
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
} from "@expo-google-fonts/geist"
import {
  registerForPushNotifications,
  registerNotificationCategories,
  addNotificationResponseListener,
  handleNotificationResponse,
} from "@/lib/push-notifications"
import { useRouter, usePathname } from "expo-router"
import { useSession, authClient } from "@/lib/auth-client"
import { ThemeProvider, useTheme } from "@/lib/theme-context"

WebBrowser.maybeCompleteAuthSession()
SplashScreen.preventAutoHideAsync()

function semverLt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0, nb = pb[i] ?? 0
    if (na < nb) return true
    if (na > nb) return false
  }
  return false
}

const VERSION_CHECK_MIN_INTERVAL_MS = 15_000

function RootLayoutInner() {
  const { data: session } = useSession()
  const { isDark } = useTheme()
  const router = useRouter()
  const pathname = usePathname()
  const listenerRef = useRef<{ remove: () => void } | null>(null)
  const lastCheckedRef = useRef(0)
  const [updateRequired, setUpdateRequired] = useState(false)
  const [appStoreUrl, setAppStoreUrl] = useState("https://apps.apple.com/app/college-dance-prep/id6784838378")

  const checkVersion = useRef((force = false) => {
    const now = Date.now()
    if (!force && now - lastCheckedRef.current < VERSION_CHECK_MIN_INTERVAL_MS) return
    lastCheckedRef.current = now
    const installedVersion: string = Constants.expoConfig?.version ?? "0.0.0"
    fetch(`${API_BASE}/api/app/min-version`)
      .then((r) => r.json())
      .then(({ minVersion, appStoreUrl: url }) => {
        if (url) setAppStoreUrl(url)
        if (semverLt(installedVersion, minVersion)) setUpdateRequired(true)
      })
      .catch(() => {})
  }).current

  useEffect(() => {
    checkVersion(true)
    // Re-check whenever the app returns to the foreground — most people
    // background the app instead of fully quitting it, so a cold-start-only
    // check could leave them on a blocked version for a long time.
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkVersion()
    })
    return () => sub.remove()
  }, [])

  // Also re-check on every screen navigation, not just foreground/background
  // transitions — someone who never backgrounds the app (just taps around)
  // used to never get re-checked at all. Throttled so rapid navigation
  // doesn't hammer the endpoint.
  useEffect(() => {
    checkVersion()
  }, [pathname])

  useEffect(() => {
    registerNotificationCategories()
  }, [])

  useEffect(() => {
    if (!session?.user) return
    registerForPushNotifications().catch(() => {})
    // Sync device timezone to server so notifications can show both timezones
    const syncTimezone = () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz) authClient.$fetch(`${API_BASE}/api/me`, { method: "PATCH", body: JSON.stringify({ timezone: tz }) }).catch(() => {})
    }
    syncTimezone()
    // Re-sync whenever the app returns to the foreground (handles travel/DST changes)
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") syncTimezone()
    })
    return () => sub.remove()
  }, [session?.user?.id])

  useEffect(() => {
    listenerRef.current = addNotificationResponseListener((response) =>
      handleNotificationResponse(response, (route) => router.push(route as any))
    )
    return () => listenerRef.current?.remove()
  }, [])

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="member" />
        <Stack.Screen name="portal" />
      </Stack>
      <ForceUpdateModal visible={updateRequired} appStoreUrl={appStoreUrl} />
    </>
  )
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Sora_400Regular,
    Sora_500Medium,
    Sora_600SemiBold,
    Sora_700Bold,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
  })

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync()
  }, [fontsLoaded])

  if (!fontsLoaded) return null

  return (
    <ThemeProvider>
      <RootLayoutInner />
    </ThemeProvider>
  )
}
