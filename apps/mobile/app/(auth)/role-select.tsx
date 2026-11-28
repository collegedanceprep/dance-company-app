import { AmbientGlow } from "@/components/AmbientGlow"
import { View, Text, TouchableOpacity, StyleSheet } from "react-native"
import { useRouter } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { Users, ShieldCheck } from "lucide-react-native"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"

export default function RoleSelectScreen() {
  const router = useRouter()
  const COLORS = useColors()
  const styles = makeStyles(COLORS)

  return (
    <SafeAreaView style={styles.safe}>
      <AmbientGlow />
      <View style={styles.container}>
        <View style={styles.logoWrap}>
          <Text style={styles.logo}>CDP</Text>
          <Text style={styles.logoSub}>College Dance Prep</Text>
        </View>

        <Text style={styles.heading}>How are you using CDP?</Text>
        <Text style={styles.sub}>Select your role to continue.</Text>

        <TouchableOpacity style={styles.card} onPress={() => router.replace("/member")} activeOpacity={0.8}>
          <View style={[styles.iconWrap, { backgroundColor: COLORS.primaryLight }]}>
            <Users size={28} color={COLORS.accent} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>I'm a Member</Text>
            <Text style={styles.cardSub}>Book sessions and track your progress</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => router.replace("/(auth)/verify-prep-master" as any)} activeOpacity={0.8}>
          <View style={[styles.iconWrap, { backgroundColor: COLORS.primaryLight }]}>
            <ShieldCheck size={28} color={COLORS.accent} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardTitle}>I'm a PrepMaster</Text>
            <Text style={styles.cardSub}>Verify your identity to access the portal</Text>
          </View>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    container: { flex: 1, padding: SPACING.lg, justifyContent: "center", gap: SPACING.md },
    logoWrap: { alignItems: "center", marginBottom: SPACING.xl },
    logo: { fontSize: 40, fontWeight: "800", color: COLORS.primary, letterSpacing: 2 },
    logoSub: { fontSize: 13, color: COLORS.textMuted, fontWeight: "500", marginTop: 4 },
    heading: { fontSize: 24, fontWeight: "700", color: COLORS.text },
    sub: { fontSize: 14, color: COLORS.textMuted, marginBottom: SPACING.sm },
    card: { flexDirection: "row", alignItems: "center", gap: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md },
    iconWrap: { width: 52, height: 52, borderRadius: RADIUS.sm, justifyContent: "center", alignItems: "center" },
    cardText: { flex: 1, gap: 4 },
    cardTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text },
    cardSub: { fontSize: 13, color: COLORS.textMuted },
  })
}
