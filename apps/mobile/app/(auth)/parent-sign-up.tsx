import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from "react-native"
import { API_BASE } from "@/lib/config"
import { useState, useEffect } from "react"
import { useRouter, Link } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import * as AppleAuthentication from "expo-apple-authentication"
import * as Google from "expo-auth-session/providers/google"
import * as WebBrowser from "expo-web-browser"
import { signUp, signIn, authClient } from "@/lib/auth-client"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"

WebBrowser.maybeCompleteAuthSession()

const appleAuthAvailable = !!AppleAuthentication.AppleAuthenticationButton
const GOOGLE_IOS_CLIENT_ID = "31400941000-8g9ud8c2pfgkb1590hb0606jg70jq152.apps.googleusercontent.com"

async function markAsParent() {
  await authClient.$fetch(`${API_BASE}/api/auth/mark-parent`, { method: "POST" })
}

export default function ParentSignUpScreen() {
  const router = useRouter()
  const COLORS = useColors()
  const styles = makeStyles(COLORS)

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [, response, promptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    scopes: ["openid", "profile", "email"],
  })

  useEffect(() => {
    if (response?.type === "success") {
      const idToken = response.params?.id_token
      const accessToken = response.authentication?.accessToken
      if (idToken) handleGoogleToken(idToken, accessToken)
      else { setError("Google sign-up failed: no ID token returned."); setGoogleLoading(false) }
    } else if (response?.type === "error") {
      setError(response.error?.message ?? "Google sign-up failed.")
      setGoogleLoading(false)
    }
  }, [response])

  async function handleGoogleToken(idToken: string, accessToken?: string) {
    setGoogleLoading(true)
    setError(null)
    try {
      const { error } = await authClient.signIn.social({
        provider: "google",
        idToken: { token: idToken, accessToken },
      } as any)
      if (error) throw new Error(error.message)
      await markAsParent()
      router.replace("/(auth)/child-picker")
    } catch (e: any) {
      setError(e.message ?? "Google sign-up failed.")
    } finally {
      setGoogleLoading(false)
    }
  }

  async function handleApple() {
    setAppleLoading(true)
    setError(null)
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean).join(" ") || undefined
      const { error } = await authClient.signIn.social({
        provider: "apple",
        idToken: { token: credential.identityToken ?? "" },
        name: fullName,
      } as any)
      if (error) throw new Error(error.message)
      await markAsParent()
      router.replace("/(auth)/child-picker")
    } catch (e: any) {
      if (e.code !== "ERR_REQUEST_CANCELED") setError(e.message ?? "Apple sign-up failed.")
    } finally {
      setAppleLoading(false)
    }
  }

  async function handleSignUp() {
    if (!name.trim()) { setError("Please enter your name."); return }
    if (!email.trim()) { setError("Please enter your email."); return }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return }
    if (password !== confirmPassword) { setError("Passwords don't match."); return }
    setLoading(true)
    setError(null)
    try {
      const { error } = await signUp.email({ name: name.trim(), email: email.trim().toLowerCase(), password })
      if (error) throw new Error(error.message)
      await markAsParent()
      router.replace("/(auth)/child-picker")
    } catch (e: any) {
      setError(e.message ?? "Sign-up failed. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.topSection}>
            <Text style={styles.logo}>CDP</Text>
            <Text style={styles.logoSub}>College Dance Prep</Text>
            <Text style={styles.heading}>Parent sign-up</Text>
            <Text style={styles.sub}>
              Create an account to view your child's sessions and credits.
            </Text>
          </View>

          {appleAuthAvailable && (
            <TouchableOpacity style={styles.appleBtn} onPress={handleApple} disabled={appleLoading || loading} activeOpacity={0.85}>
              {appleLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.appleBtnText}>Continue with Apple</Text>}
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.googleBtn} onPress={() => { setGoogleLoading(true); promptAsync() }} disabled={googleLoading || loading} activeOpacity={0.85}>
            {googleLoading
              ? <ActivityIndicator color={COLORS.text} />
              : <Text style={styles.googleBtnText}>Continue with Google</Text>}
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Full name</Text>
            <TextInput style={styles.input} placeholder="First and last name" placeholderTextColor={COLORS.textMuted}
              autoCapitalize="words" value={name} onChangeText={setName} editable={!loading} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} placeholder="you@example.com" placeholderTextColor={COLORS.textMuted}
              keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} editable={!loading} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput style={styles.input} placeholder="At least 8 characters" placeholderTextColor={COLORS.textMuted}
              secureTextEntry value={password} onChangeText={setPassword} editable={!loading} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Confirm password</Text>
            <TextInput style={styles.input} placeholder="Re-enter password" placeholderTextColor={COLORS.textMuted}
              secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} editable={!loading} />
          </View>

          <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleSignUp} disabled={loading} activeOpacity={0.8}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>Create parent account</Text>}
          </TouchableOpacity>

          <Link href="/(auth)/sign-in" asChild>
            <TouchableOpacity style={styles.linkBtn} activeOpacity={0.7}>
              <Text style={styles.linkText}>Already have an account? <Text style={styles.linkAccent}>Sign in</Text></Text>
            </TouchableOpacity>
          </Link>
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
    appleBtn: { backgroundColor: COLORS.text, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: "center", marginBottom: SPACING.sm },
    appleBtnText: { color: COLORS.background, fontSize: 15, fontWeight: "600" },
    googleBtn: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: "center", marginBottom: SPACING.md },
    googleBtnText: { color: COLORS.text, fontSize: 15, fontWeight: "600" },
    dividerRow: { flexDirection: "row", alignItems: "center", marginBottom: SPACING.md },
    dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
    dividerText: { marginHorizontal: SPACING.sm, fontSize: 13, color: COLORS.textMuted },
    errorBox: { backgroundColor: COLORS.amberLight, borderRadius: RADIUS.sm, padding: SPACING.sm, marginBottom: SPACING.md },
    errorText: { fontSize: 13, color: COLORS.amber },
    field: { marginBottom: SPACING.md },
    label: { fontSize: 13, fontWeight: "600", color: COLORS.textSecondary, marginBottom: 6 },
    input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, fontSize: 15, color: COLORS.text },
    btn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: "center", marginTop: SPACING.sm },
    btnDisabled: { opacity: 0.5 },
    btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
    linkBtn: { alignItems: "center", padding: SPACING.md, marginTop: 4 },
    linkText: { fontSize: 14, color: COLORS.textMuted },
    linkAccent: { color: COLORS.primary, fontWeight: "600" },
  })
}
