import { useEffect, useState } from "react"
import { API_BASE } from "@/lib/config"
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter } from "expo-router"
import { Users, ChevronRight, LogOut, AlertTriangle } from "lucide-react-native"
import { authClient, signOut, useSession } from "@/lib/auth-client"
import { useColors } from "@/lib/theme-context"
import { SPACING, RADIUS } from "@/constants/theme"


type Child = {
  userId: string
  name: string
  email: string
  creditsRemaining: number
}

export default function ChildPickerScreen() {
  const COLORS = useColors()
  const router = useRouter()
  const styles = makeStyles(COLORS)
  const { data: session } = useSession()
  const [children, setChildren] = useState<Child[]>([])
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState<string | null>(null)

  useEffect(() => {
    authClient.$fetch(`${API_BASE}/api/parent/children`)
      .then(({ data }: any) => {
        if (data?.children) {
          setChildren(data.children)
          setSelectedChildId(data.selectedChildId ?? null)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  async function selectChild(child: Child) {
    setSelecting(child.userId)
    await authClient.$fetch(`${API_BASE}/api/parent/select-child`, {
      method: "POST",
      body: JSON.stringify({ childUserId: child.userId }),
    })
    setSelecting(null)
    router.replace("/member")
  }

  async function handleSignOut() {
    await signOut()
    router.replace("/(auth)/sign-in")
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}><ActivityIndicator color={COLORS.primary} size="large" /></View>
      </SafeAreaView>
    )
  }

  if (children.length === 0) {
    const parentEmail = session?.user?.email ?? ""
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <View style={styles.iconWrap}>
            <AlertTriangle size={32} color={COLORS.primary} />
          </View>
          <Text style={styles.title}>No dancer linked to your account yet</Text>
          <Text style={styles.subtitle}>
            Ask your dancer to sign up and enter{" "}
            <Text style={{ fontWeight: "700", color: COLORS.text }}>{parentEmail}</Text> in the
            "Parent email" field during their signup. Once they do, their sessions and credits
            will show up here automatically.
          </Text>

          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
            <LogOut size={15} color={COLORS.textMuted} />
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Users size={32} color={COLORS.primary} />
        </View>
        <Text style={styles.title}>Who are you viewing?</Text>
        <Text style={styles.subtitle}>Select a dancer to view their bookings and account.</Text>

        <FlatList
          data={children}
          keyExtractor={(c) => c.userId}
          style={{ width: "100%", marginTop: SPACING.md }}
          contentContainerStyle={{ gap: SPACING.sm }}
          renderItem={({ item }) => {
            const isActive = item.userId === selectedChildId
            return (
              <TouchableOpacity
                style={[styles.card, isActive && styles.cardActive]}
                onPress={() => selectChild(item)}
                activeOpacity={0.7}
                disabled={selecting === item.userId}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, isActive && { color: COLORS.primary }]}>{item.name}</Text>
                  <Text style={styles.meta}>{item.creditsRemaining} credit{item.creditsRemaining !== 1 ? "s" : ""} remaining</Text>
                </View>
                {selecting === item.userId
                  ? <ActivityIndicator size="small" color={COLORS.primary} />
                  : <ChevronRight size={18} color={isActive ? COLORS.primary : COLORS.textMuted} />
                }
              </TouchableOpacity>
            )
          }}
        />

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
          <LogOut size={15} color={COLORS.textMuted} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: any) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    container: { flex: 1, alignItems: "center", padding: SPACING.xl, paddingTop: SPACING.xl * 2 },
    iconWrap: {
      width: 72, height: 72, borderRadius: 36,
      backgroundColor: COLORS.primaryLight,
      alignItems: "center", justifyContent: "center",
      marginBottom: SPACING.md,
    },
    title: { fontSize: 24, fontWeight: "700", color: COLORS.text, textAlign: "center", fontFamily: "Sora_700Bold" },
    subtitle: { fontSize: 14, color: COLORS.textMuted, textAlign: "center", marginTop: 6, lineHeight: 20 },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.md,
      padding: SPACING.md,
      borderRadius: RADIUS.md,
      backgroundColor: COLORS.surface,
      borderWidth: 1.5,
      borderColor: COLORS.border,
    },
    cardActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
    avatar: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: COLORS.primary,
      alignItems: "center", justifyContent: "center",
    },
    avatarText: { fontSize: 18, fontWeight: "700", color: "#fff" },
    name: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    meta: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
    signOutBtn: {
      flexDirection: "row", alignItems: "center", gap: 6,
      marginTop: "auto", paddingVertical: SPACING.sm,
    },
    signOutText: { fontSize: 14, color: COLORS.textMuted, fontWeight: "500" },
  })
}
