import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native"
import { API_BASE } from "@/lib/config"
import { useState } from "react"
import { useRouter } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import { authClient } from "@/lib/auth-client"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"


export default function ForgotPasswordScreen() {
  const router = useRouter()
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!email.trim()) { setError("Please enter your email address."); return }
    setError(null)
    setLoading(true)
    try {
      const result = await authClient.requestPasswordReset({
        email: email.trim().toLowerCase(),
        redirectTo: `${API_BASE}/reset-password`,
      })
      if ((result as any)?.error) {
        setError((result as any).error.message ?? "Something went wrong. Please try again.")
      } else {
        setSent(true)
      }
    } catch (err: any) {
      setError(err?.message ?? JSON.stringify(err) ?? "Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.container}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()} activeOpacity={0.7}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.heading}>Forgot password?</Text>
          <Text style={styles.sub}>
            Enter the email address for your account and we'll send you a reset link.
          </Text>

          {sent ? (
            <View style={styles.successBox}>
              <Text style={styles.successText}>
                If an account exists for <Text style={{ fontWeight: "700" }}>{email.trim()}</Text>, you'll receive a reset link shortly. Check your spam folder if you don't see it.
              </Text>
              <TouchableOpacity style={styles.btn} onPress={() => router.back()} activeOpacity={0.8}>
                <Text style={styles.btnText}>Back to sign in</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {error && (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="you@example.com"
                  placeholderTextColor={COLORS.textMuted}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoFocus
                  value={email}
                  onChangeText={setEmail}
                  editable={!loading}
                  onSubmitEditing={handleSubmit}
                  returnKeyType="send"
                />
              </View>
              <TouchableOpacity
                style={[styles.btn, loading && styles.btnDisabled]}
                onPress={handleSubmit}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.btnText}>Send reset link</Text>
                }
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    flex: { flex: 1 },
    container: { flex: 1, padding: SPACING.lg, justifyContent: "center" },
    back: { position: "absolute", top: SPACING.lg, left: SPACING.lg },
    backText: { fontSize: 15, color: COLORS.plum, fontWeight: "600" },
    heading: { fontSize: 26, fontWeight: "700", color: COLORS.text, marginBottom: 8, fontFamily: "Anton_400Regular", textTransform: "uppercase", letterSpacing: 0.5 },
    sub: { fontSize: 14, color: COLORS.textMuted, marginBottom: SPACING.lg, lineHeight: 20 },
    errorBox: { backgroundColor: COLORS.redLight, borderRadius: RADIUS.sm, padding: SPACING.sm, marginBottom: SPACING.md },
    errorText: { fontSize: 13, color: COLORS.red, fontWeight: "500" },
    successBox: { gap: SPACING.lg },
    successText: { fontSize: 14, color: COLORS.text, lineHeight: 22 },
    field: { marginBottom: SPACING.md },
    label: { fontSize: 13, fontWeight: "600", color: COLORS.textSecondary, marginBottom: 6 },
    input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, fontSize: 15, color: COLORS.text },
    btn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: "center", marginTop: SPACING.sm },
    btnDisabled: { opacity: 0.6 },
    btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  })
}
