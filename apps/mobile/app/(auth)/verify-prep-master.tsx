import { AmbientGlow } from "@/components/AmbientGlow"
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from "react-native"
import { API_BASE } from "@/lib/config"
import { useState } from "react"
import { useRouter } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { ShieldCheck, ArrowLeft } from "lucide-react-native"
import { authClient } from "@/lib/auth-client"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"


type State = "form" | "success" | "failed"

export default function VerifyPrepMasterScreen() {
  const router = useRouter()
  const COLORS = useColors()
  const styles = makeStyles(COLORS)

  const [name, setName] = useState("")
  const [university, setUniversity] = useState("")
  const [loading, setLoading] = useState(false)
  const [state, setState] = useState<State>("form")
  const [verifiedName, setVerifiedName] = useState("")

  async function handleVerify() {
    if (!name.trim() || !university.trim()) return
    setLoading(true)
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/auth/verify-prep-master`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), university: university.trim() }),
        headers: { "Content-Type": "application/json" },
      })
      if (error) { setState("failed"); return }
      const res = data as { verified: boolean; prepMasterName?: string }
      if (res.verified) {
        setVerifiedName(res.prepMasterName ?? name.trim())
        setState("success")
      } else {
        setState("failed")
      }
    } catch {
      setState("failed")
    } finally {
      setLoading(false)
    }
  }

  if (state === "success") {
    return (
      <SafeAreaView style={styles.safe}>
      <AmbientGlow />
        <View style={styles.centerContainer}>
          <View style={[styles.iconWrap, { backgroundColor: COLORS.primaryLight }]}>
            <ShieldCheck size={40} color={COLORS.accent} />
          </View>
          <Text style={styles.successTitle}>Verified!</Text>
          <Text style={styles.successSub}>Welcome, {verifiedName}. You've been granted PrepMaster access.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.replace("/portal")} activeOpacity={0.8}>
            <Text style={styles.btnText}>Go to Portal</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  if (state === "failed") {
    return (
      <SafeAreaView style={styles.safe}>
      <AmbientGlow />
        <View style={styles.centerContainer}>
          <Text style={styles.failTitle}>Verification Failed</Text>
          <Text style={styles.failSub}>
            We couldn't match your name and university to a CDP PrepMaster on file. Please double-check your details or contact CDP admin to get set up.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={() => setState("form")} activeOpacity={0.8}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/member")} activeOpacity={0.8}>
            <Text style={styles.secondaryBtnText}>Continue as member instead</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe}>
      <AmbientGlow />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
            <ArrowLeft size={20} color={COLORS.textMuted} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.logoWrap}>
            <Text style={styles.logo}>CDP</Text>
          </View>

          <Text style={styles.heading}>PrepMaster Verification</Text>
          <Text style={styles.sub}>
            Enter your full name and university exactly as they appear in our records.
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Jane Smith"
              placeholderTextColor={COLORS.textMuted}
              value={name}
              onChangeText={setName}
              autoCorrect={false}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>University</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. University of Southern California"
              placeholderTextColor={COLORS.textMuted}
              value={university}
              onChangeText={setUniversity}
              autoCorrect={false}
              autoCapitalize="words"
            />
          </View>

          <TouchableOpacity
            style={[styles.btn, (!name.trim() || !university.trim() || loading) && styles.btnDisabled]}
            onPress={handleVerify}
            disabled={!name.trim() || !university.trim() || loading}
            activeOpacity={0.8}
          >
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>Verify Identity</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/member")} activeOpacity={0.8}>
            <Text style={styles.secondaryBtnText}>I'm a member, not a PrepMaster</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    container: { padding: SPACING.lg, gap: SPACING.md, flexGrow: 1, justifyContent: "center" },
    centerContainer: { flex: 1, padding: SPACING.lg, justifyContent: "center", alignItems: "center", gap: SPACING.md },
    backBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: SPACING.md },
    backText: { fontSize: 14, color: COLORS.textMuted },
    logoWrap: { alignItems: "center", marginBottom: SPACING.md },
    logo: { fontSize: 40, fontWeight: "800", color: COLORS.primary, letterSpacing: 2 },
    heading: { fontSize: 24, fontWeight: "700", color: COLORS.text },
    sub: { fontSize: 14, color: COLORS.textMuted, lineHeight: 20 },
    field: { gap: 6 },
    label: { fontSize: 13, fontWeight: "600", color: COLORS.textSecondary },
    input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, fontSize: 15, color: COLORS.text },
    btn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: "center" },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
    secondaryBtn: { alignItems: "center", padding: SPACING.sm },
    secondaryBtnText: { fontSize: 14, color: COLORS.textMuted },
    iconWrap: { width: 72, height: 72, borderRadius: 36, justifyContent: "center", alignItems: "center" },
    successTitle: { fontSize: 26, fontWeight: "700", color: COLORS.text },
    successSub: { fontSize: 15, color: COLORS.textMuted, textAlign: "center", lineHeight: 22 },
    failTitle: { fontSize: 24, fontWeight: "700", color: COLORS.text },
    failSub: { fontSize: 14, color: COLORS.textMuted, textAlign: "center", lineHeight: 21 },
  })
}
