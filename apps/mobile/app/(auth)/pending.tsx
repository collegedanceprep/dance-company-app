import { View, Text, StyleSheet, TouchableOpacity } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Clock } from "lucide-react-native"
import { signOut } from "@/lib/auth-client"
import { useRouter } from "expo-router"
import { useColors } from "@/lib/theme-context"
import { SPACING, RADIUS } from "@/constants/theme"

export default function PendingScreen() {
  const COLORS = useColors()
  const router = useRouter()
  const styles = makeStyles(COLORS)

  async function handleSignOut() {
    await signOut()
    router.replace("/(auth)/sign-in")
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <View style={styles.iconWrap}>
          <Clock size={40} color={COLORS.accent} />
        </View>
        <Text style={styles.title}>Pending Approval</Text>
        <Text style={styles.body}>
          Your account is under review. An admin will approve your account shortly.
          You'll receive a notification once you're approved.
        </Text>
        <Text style={styles.contact}>Questions? Email collegedanceprep@gmail.com</Text>
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: any) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    container: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.lg },
    iconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.primaryLight, alignItems: "center", justifyContent: "center" },
    title: { fontSize: 24, fontWeight: "700", color: COLORS.text, textAlign: "center" },
    body: { fontSize: 15, color: COLORS.textMuted, textAlign: "center", lineHeight: 22 },
    contact: { fontSize: 13, color: COLORS.textMuted, textAlign: "center" },
    signOutBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, marginTop: SPACING.md },
    signOutText: { fontSize: 14, fontWeight: "600", color: COLORS.textSecondary },
  })
}
