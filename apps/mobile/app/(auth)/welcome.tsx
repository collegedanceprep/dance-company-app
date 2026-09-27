import { useState, useEffect, useCallback } from "react"
import { API_BASE } from "@/lib/config"
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter } from "expo-router"
import { authClient } from "@/lib/auth-client"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"


export default function WelcomeScreen() {
  const router = useRouter()
  const COLORS = useColors()
  const styles = makeStyles(COLORS)

  const [recordId, setRecordId] = useState<string | null>(null)
  const [fullName, setFullName] = useState("")
  const [phone, setPhone] = useState("")
  const [goals, setGoals] = useState("")
  const [parentEmail, setParentEmail] = useState("")
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)

  // Fetch profile on mount — this triggers getOrCreateProfile() and gives us the recordId
  const loadProfile = useCallback(async () => {
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/member/dashboard`)
      if (error || !data) throw new Error()
      const profile = (data as any).profile
      setRecordId(profile.recordId)
      setFullName(profile.name ?? "")
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => { loadProfile() }, [loadProfile])

  async function handleSave() {
    if (!recordId) { Alert.alert("Error", "Profile not loaded. Please try again."); return }
    setSaving(true)
    try {
      const { error } = await authClient.$fetch(`${API_BASE}/api/member/profile`, {
        method: "PATCH",
        body: JSON.stringify({
          recordId,
          name: fullName.trim() || undefined,
          phone: phone.trim(),
          goals: goals.trim(),
          parentEmail: parentEmail.trim() || null,
        }),
        headers: { "Content-Type": "application/json" },
      })
      if (error) throw new Error()
    } catch {
      // Non-fatal — still proceed to the app
    } finally {
      setSaving(false)
      router.replace("/(auth)/pending")
    }
  }

  function handleSkip() {
    router.replace("/(auth)/pending")
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.topSection}>
            <Text style={styles.logo}>CDP</Text>
            <Text style={styles.logoSub}>College Dance Prep</Text>
            <Text style={styles.heading}>
              {fullName ? `Welcome, ${fullName.split(" ")[0]}!` : "Welcome!"}
            </Text>
            <Text style={styles.sub}>
              Complete your profile to get started. Everything here is optional — you can always update it later.
            </Text>
          </View>

          {loadError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>Couldn't load your profile. You can still continue.</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Full name</Text>
            <TextInput
              style={styles.input}
              placeholder="First and last name"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="words"
              value={fullName}
              onChangeText={setFullName}
              editable={!saving}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Phone number</Text>
            <TextInput
              style={styles.input}
              placeholder="(555) 123-4567"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="phone-pad"
              value={phone}
              onChangeText={setPhone}
              editable={!saving}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Training goals</Text>
            <TextInput
              style={[styles.input, styles.inputMulti]}
              placeholder="e.g. Improve turns, prepare for college auditions…"
              placeholderTextColor={COLORS.textMuted}
              multiline
              numberOfLines={3}
              value={goals}
              onChangeText={setGoals}
              editable={!saving}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Parent email <Text style={styles.labelOptional}>(optional)</Text></Text>
            <TextInput
              style={styles.input}
              placeholder="parent@example.com"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              value={parentEmail}
              onChangeText={setParentEmail}
              editable={!saving}
            />
            <Text style={styles.hint}>
              If a parent manages your bookings, add their email. They can sign in and view your account.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.btn, (!recordId || saving) && styles.btnDisabled]}
            onPress={handleSave}
            disabled={!recordId || saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>Get started</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} disabled={saving} activeOpacity={0.7}>
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    flex: { flex: 1 },
    container: { padding: SPACING.lg, flexGrow: 1, paddingBottom: SPACING.xl },
    topSection: { alignItems: "center", marginBottom: SPACING.xl, paddingTop: SPACING.lg },
    logo: { fontSize: 40, fontWeight: "800", color: COLORS.primary, letterSpacing: 2 },
    logoSub: { fontSize: 13, color: COLORS.textMuted, fontWeight: "500", marginTop: 4, marginBottom: SPACING.lg },
    heading: { fontSize: 26, fontWeight: "700", color: COLORS.text, marginBottom: 6, textAlign: "center", fontFamily: "Sora_700Bold" },
    sub: { fontSize: 14, color: COLORS.textMuted, textAlign: "center", lineHeight: 20 },
    errorBox: { backgroundColor: COLORS.amberLight, borderRadius: RADIUS.sm, padding: SPACING.sm, marginBottom: SPACING.md },
    errorText: { fontSize: 13, color: COLORS.amber },
    field: { marginBottom: SPACING.md },
    label: { fontSize: 13, fontWeight: "600", color: COLORS.textSecondary, marginBottom: 6 },
    labelOptional: { fontSize: 13, fontWeight: "400", color: COLORS.textMuted },
    input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, fontSize: 15, color: COLORS.text },
    inputMulti: { minHeight: 80, textAlignVertical: "top" },
    hint: { fontSize: 12, color: COLORS.textMuted, marginTop: 6, lineHeight: 17 },
    btn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: "center", marginTop: SPACING.sm },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
    skipBtn: { alignItems: "center", padding: SPACING.md, marginTop: 4 },
    skipText: { fontSize: 14, color: COLORS.textMuted, fontWeight: "500" },
  })
}
