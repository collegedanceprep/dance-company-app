import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from "react-native"
import { API_BASE } from "@/lib/config"
import { useState, useEffect } from "react"
import { useRouter, Link } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import * as WebBrowser from "expo-web-browser"
import * as Google from "expo-auth-session/providers/google"
import * as AppleAuthentication from "expo-apple-authentication"
import * as SecureStore from "expo-secure-store"

const appleAuthAvailable = !!AppleAuthentication.AppleAuthenticationButton
import { signUp, signIn, authClient } from "@/lib/auth-client"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"

WebBrowser.maybeCompleteAuthSession()

const GOOGLE_IOS_CLIENT_ID = "31400941000-8g9ud8c2pfgkb1590hb0606jg70jq152.apps.googleusercontent.com"


export default function SignUpScreen() {
  const router = useRouter()
  const COLORS = useColors()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
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
    } else if (response?.type === "dismiss" || response?.type === "cancel") {
      setGoogleLoading(false)
    }
  }, [response])

  async function handleGoogleToken(idToken: string, accessToken?: string) {
    try {
      const result = await signIn.social({ provider: "google", idToken: { token: idToken, accessToken } } as Parameters<typeof signIn.social>[0])
      if (result?.error) { setError(result.error.message ?? "Google sign-up failed."); return }

      // Sync name/image from Google token if missing
      try {
        const parts = idToken.split(".")
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
          const sessionUser = (result as any)?.data?.user
          const updates: Record<string, string> = {}
          if (payload.name && !sessionUser?.name) updates.name = payload.name
          if (payload.picture && !sessionUser?.image) updates.image = payload.picture
          if (Object.keys(updates).length > 0) {
            await authClient.$fetch(`${API_BASE}/api/auth/update-user`, {
              method: "POST",
              body: JSON.stringify(updates),
              headers: { "Content-Type": "application/json" },
            })
            await authClient.$fetch(`${API_BASE}/api/auth/get-session`)
          }
        }
      } catch {}

      await routeAfterSocialAuth()
    } catch { setError("Google sign-up failed. Please try again.") }
    finally { setGoogleLoading(false) }
  }

  async function routeAfterSocialAuth() {
    const { data: me } = await authClient.$fetch(`${API_BASE}/api/me`)
    const role = (me as any)?.role ?? "dancer"
    const status = (me as any)?.status ?? "pending"
    const userId = (me as any)?.id
    if (status === "denied") { router.replace("/(auth)/denied"); return }
    if (role === "admin") { router.replace("/admin"); return }
    if (role === "prep_master") { router.replace("/portal"); return }
    if (role === "dancer" && userId) {
      const welcomeKey = `welcome_seen_${userId}`
      const seen = await SecureStore.getItemAsync(welcomeKey)
      if (!seen) {
        await SecureStore.setItemAsync(welcomeKey, "1")
        router.replace("/(auth)/welcome")
        return
      }
    }
    if (status === "pending") router.replace("/(auth)/pending")
    else router.replace("/member")
  }

  async function handleAppleSignUp() {
    setError(null)
    setAppleLoading(true)
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })
      if (!credential.identityToken) throw new Error("No identity token from Apple.")
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean).join(" ")
      const result = await (signIn as any).social({
        provider: "apple",
        idToken: { token: credential.identityToken },
      })
      if (result?.error) { setError(result.error.message ?? "Apple sign-up failed."); return }
      if (fullName) {
        await authClient.$fetch(`${API_BASE}/api/auth/update-user`, {
          method: "POST",
          body: JSON.stringify({ name: fullName }),
          headers: { "Content-Type": "application/json" },
        }).catch(() => {})
      }
      await routeAfterSocialAuth()
    } catch (err: any) {
      if (err?.code !== "ERR_REQUEST_CANCELED") {
        setError(err?.message ?? "Apple sign-up failed. Please try again.")
      }
    } finally {
      setAppleLoading(false)
    }
  }

  function handleGoogleSignUp() { setError(null); setGoogleLoading(true); promptAsync() }

  async function handleSignUp() {
    if (!name || !email || !password) { setError("Please fill in all required fields."); return }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return }
    if (password !== confirmPassword) { setError("Passwords do not match."); return }
    setError(null); setLoading(true)
    try {
      const result = await signUp.email({ name: name.trim(), email: email.trim(), password })
      if (result.error) { setError(result.error.message ?? "Could not create account."); return }

      router.replace("/(auth)/pending")
    } catch { setError("Something went wrong. Please try again.") }
    finally { setLoading(false) }
  }

  const styles = makeStyles(COLORS)

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.logoWrap}>
            <Text style={styles.logo}>CDP</Text>
            <Text style={styles.logoSub}>College Dance Prep</Text>
          </View>
          <Text style={styles.heading}>Create account</Text>
          <Text style={styles.sub}>Join College Dance Prep</Text>
          {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}

          <TouchableOpacity style={[styles.googleBtn, googleLoading && styles.btnDisabled]} onPress={handleGoogleSignUp} disabled={googleLoading || loading || appleLoading} activeOpacity={0.8}>
            {googleLoading ? <ActivityIndicator color={COLORS.text} size="small" /> : <><Text style={styles.googleIcon}>G</Text><Text style={styles.googleBtnText}>Continue with Google</Text></>}
          </TouchableOpacity>
          {appleAuthAvailable && (
            <>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={RADIUS.sm}
                style={[styles.appleBtn, appleLoading && styles.btnDisabled]}
                onPress={handleAppleSignUp}
              />
              <Text style={styles.appleNote}>Use your real email (not "Hide My Email") so your account links correctly.</Text>
            </>
          )}

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or sign up with email</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Full name</Text>
            <TextInput style={styles.input} placeholder="Jane Smith" placeholderTextColor={COLORS.textMuted} autoCapitalize="words" value={name} onChangeText={setName} editable={!loading} />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} placeholder="you@example.com" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} editable={!loading} />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordWrap}>
              <TextInput style={styles.passwordInput} placeholder="Min. 8 characters" placeholderTextColor={COLORS.textMuted} secureTextEntry={!showPassword} value={password} onChangeText={setPassword} editable={!loading} returnKeyType="next" />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={styles.eyeBtn} activeOpacity={0.7}>
                <Text style={styles.showHideText}>{showPassword ? "Hide" : "Show"}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Confirm password</Text>
            <View style={styles.passwordWrap}>
              <TextInput style={styles.passwordInput} placeholder="Re-enter your password" placeholderTextColor={COLORS.textMuted} secureTextEntry={!showConfirmPassword} value={confirmPassword} onChangeText={setConfirmPassword} editable={!loading} returnKeyType="next" />
              <TouchableOpacity onPress={() => setShowConfirmPassword(v => !v)} style={styles.eyeBtn} activeOpacity={0.7}>
                <Text style={styles.showHideText}>{showConfirmPassword ? "Hide" : "Show"}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleSignUp} disabled={loading} activeOpacity={0.8}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>Create account</Text>}
          </TouchableOpacity>
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Link href="/(auth)/sign-in" asChild><TouchableOpacity><Text style={styles.footerLink}>Sign in</Text></TouchableOpacity></Link>
          </View>
          <View style={styles.footer}>
            <Text style={styles.footerText}>Signing up as a parent? </Text>
            <Link href="/(auth)/parent-sign-up" asChild><TouchableOpacity><Text style={styles.footerLink}>Tap here</Text></TouchableOpacity></Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    flex: { flex: 1 },
    container: { padding: SPACING.lg, justifyContent: "center", flexGrow: 1 },
    logoWrap: { alignItems: "center", marginBottom: SPACING.xl },
    logo: { fontSize: 40, fontWeight: "800", color: COLORS.primary, letterSpacing: 2 },
    logoSub: { fontSize: 13, color: COLORS.textMuted, fontWeight: "500", marginTop: 4 },
    heading: { fontSize: 26, fontWeight: "700", color: COLORS.text, marginBottom: 4, fontFamily: "Sora_700Bold" },
    sub: { fontSize: 14, color: COLORS.textMuted, marginBottom: SPACING.lg },
    errorBox: { backgroundColor: COLORS.redLight, borderRadius: RADIUS.sm, padding: SPACING.sm, marginBottom: SPACING.md },
    errorText: { fontSize: 13, color: COLORS.red, fontWeight: "500" },
    field: { marginBottom: SPACING.md },
    label: { fontSize: 13, fontWeight: "600", color: COLORS.textSecondary, marginBottom: 6 },
    labelOptional: { fontSize: 13, fontWeight: "400", color: COLORS.textMuted },
    input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, fontSize: 15, color: COLORS.text },
    passwordWrap: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm },
    passwordInput: { flex: 1, padding: SPACING.md, fontSize: 15, color: COLORS.text },
    eyeBtn: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.md },
    showHideText: { fontSize: 13, fontWeight: "600", color: COLORS.primary },
    inputMulti: { minHeight: 72, textAlignVertical: "top" },
    hint: { fontSize: 12, color: COLORS.textMuted, marginTop: 5, lineHeight: 17 },
    googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, marginBottom: SPACING.sm },
    appleBtn: { height: 50, marginBottom: 6 },
    appleNote: { fontSize: 11, color: COLORS.textMuted, textAlign: "center", marginBottom: SPACING.md, lineHeight: 16 },
    googleIcon: { fontSize: 16, fontWeight: "800", color: "#4285F4" },
    googleBtnText: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    dividerRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginBottom: SPACING.md },
    dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
    dividerText: { fontSize: 12, color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    btn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: "center", marginTop: SPACING.sm },
    btnDisabled: { opacity: 0.6 },
    btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
    footer: { flexDirection: "row", justifyContent: "center", marginTop: SPACING.lg },
    footerText: { fontSize: 14, color: COLORS.textMuted },
    footerLink: { fontSize: 14, color: COLORS.primary, fontWeight: "600" },
  })
}
