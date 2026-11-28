import { View, Text, StyleSheet, TouchableOpacity } from "react-native"
import { API_BASE } from "@/lib/config"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter } from "expo-router"
import { Bell } from "lucide-react-native"
import * as SecureStore from "expo-secure-store"
import { useColors } from "@/lib/theme-context"
import { registerForPushNotifications } from "@/lib/push-notifications"
import { authClient } from "@/lib/auth-client"

const PRIMER_KEY = "notify_primer_seen"

async function getDestination(): Promise<"/(auth)/sign-in" | "/admin" | "/portal" | "/member"> {
  try {
    const { data } = await authClient.$fetch(`${API_BASE}/api/me`)
    const role = (data as any)?.role ?? "dancer"
    if (role === "admin") return "/admin"
    if (role === "prep_master") return "/portal"
    return "/member"
  } catch {
    return "/(auth)/sign-in"
  }
}

export default function NotifyPrimerScreen() {
  const COLORS = useColors()
  const router = useRouter()
  const s = styles(COLORS)

  async function handleEnable() {
    await SecureStore.setItemAsync(PRIMER_KEY, "1")
    try {
      await registerForPushNotifications()
    } catch {
      // Permission denied or error — continue anyway
    }
    const dest = await getDestination()
    router.replace(dest)
  }

  async function handleSkip() {
    await SecureStore.setItemAsync(PRIMER_KEY, "1")
    const dest = await getDestination()
    router.replace(dest)
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <View style={s.iconWrap}>
          <Bell size={48} color={COLORS.accent} />
        </View>

        <Text style={s.title}>Don't miss a thing</Text>
        <Text style={s.body}>
          We'll need your permission to send you notifications. On the next screen, tap <Text style={{ fontWeight: "700", color: COLORS.text }}>"Allow"</Text> — this is how you'll know when bookings are confirmed, updated, or cancelled.
        </Text>
        <Text style={s.warning}>
          ⚠️ If you tap "Don't Allow," you won't receive any booking updates.
        </Text>

        <TouchableOpacity style={s.primaryBtn} onPress={handleEnable} activeOpacity={0.8}>
          <Text style={s.primaryBtnText}>Continue</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
          <Text style={s.skipText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

const styles = (C: ReturnType<typeof useColors>) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: C.background },
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 36,
      gap: 16,
    },
    iconWrap: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: C.primaryLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 8,
    },
    title: {
      fontSize: 26,
      fontWeight: "700",
      color: C.text,
      textAlign: "center",
    },
    body: {
      fontSize: 15,
      color: C.textMuted,
      textAlign: "center",
      lineHeight: 22,
    },
    warning: {
      fontSize: 13,
      color: C.amber,
      textAlign: "center",
      lineHeight: 20,
      marginBottom: 8,
    },
    primaryBtn: {
      width: "100%",
      backgroundColor: C.primary,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: "center",
    },
    primaryBtnText: {
      color: "#fff",
      fontSize: 16,
      fontWeight: "700",
    },
    skipBtn: {
      paddingVertical: 12,
    },
    skipText: {
      color: C.textMuted,
      fontSize: 15,
    },
  })
