import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native"
import { useState, useEffect } from "react"
import { useRouter, Link } from "expo-router"
import { SafeAreaView } from "react-native-safe-area-context"
import * as WebBrowser from "expo-web-browser"
import * as Google from "expo-auth-session/providers/google"
import * as AppleAuthentication from "expo-apple-authentication"
import { signIn, useSession, authClient } from "@/lib/auth-client"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"

WebBrowser.maybeCompleteAuthSession()

const GOOGLE_IOS_CLIENT_ID = "31400941000-8g9ud8c2pfgkb1590hb0606jg70jq152.apps.googleusercontent.com"
const GOOGLE_REDIRECT_URI = `com.googleusercontent.apps.31400941000-8g9ud8c2pfgkb1590hb0606jg70jq152:/oauthredirect`

// expo-apple-authentication is only available in production/standalone builds
const appleAuthAvailable = !!AppleAuthentication.AppleAuthenticationButton

export default function SignInScreen() {
  const router = useRouter()
  const COLORS = useColors()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [appleLoading, setAppleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: session } = useSession()
  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    redirectUri: GOOGLE_REDIRECT_URI,
    // Only request basic profile scopes here — calendar.events is a sensitive
    // scope that triggers Google's "unverified app" warning. Users can connect
    // Google Calendar separately via the Enable Calendar sync button in Profile.
    scopes: ["openid", "profile", "email"],
  })

  // Only auto-redirect if a session exists before the user starts signing in.
  // During active sign-in, handleSignIn/handleGoogleToken do the routing themselves.
  useEffect(() => {
    if (session?.user && !loading && !googleLoading) router.replace("/")
  }, [session?.user?.id])

  useEffect(() => {
    if (response?.type === "success") {
      const idToken = response.params?.id_token
      const accessToken = response.authentication?.accessToken
      if (idToken) handleGoogleToken(idToken, accessToken)
      else { setError("Google sign-in failed: no ID token returned."); setGoogleLoading(false) }
    } else if (response?.type === "error") {
      setError(response.error?.message ?? "Google sign-in failed.")
      setGoogleLoading(false)
    } else if (response?.type === "dismiss" || response?.type === "cancel") {
      setGoogleLoading(false)
    }
  }, [response])

  async function handleGoogleToken(idToken: string, accessToken?: string) {
    try {
      const result = await signIn.social({ provider: "google", idToken: { token: idToken, accessToken } } as Parameters<typeof signIn.social>[0])
      if (result?.error) { setError(result.error.message ?? "Google sign-in failed."); return }

      // Sync name and image from Google token if the user record is missing them
      try {
        const parts = idToken.split(".")
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")))
          const sessionUser = (result as any)?.data?.user
          const updates: Record<string, string> = {}
          if (payload.name && !sessionUser?.name) updates.name = payload.name
          if (payload.picture && !sessionUser?.image) updates.image = payload.picture
          if (Object.keys(updates).length > 0) {
            await authClient.$fetch("https://app.collegedanceprep.com/api/auth/update-user", {
              method: "POST",
              body: JSON.stringify(updates),
              headers: { "Content-Type": "application/json" },
            })
            // Refresh session so useSession picks up the new name/image
            await authClient.$fetch("https://app.collegedanceprep.com/api/auth/get-session")
          }
        }
      } catch {}

      await routeAfterAuth()
    } catch { setError("Google sign-in failed. Please try again.") }
    finally { setGoogleLoading(false) }
  }

  async function handleSignIn() {
    if (!email || !password) { setError("Please enter your email and password."); return }
    setError(null); setLoading(true)
    try {
      const result = await signIn.email({ email: email.trim(), password })
      if (result.error) { setError(result.error.message ?? "Invalid email or password."); return }
      await routeAfterAuth()
    } catch { setError("Something went wrong. Please try again.") }
    finally { setLoading(false) }
  }

  async function routeAfterAuth() {
    const { data: me } = await authClient.$fetch("https://app.collegedanceprep.com/api/me")
    const role = (me as any)?.role ?? "dancer"
    const status = (me as any)?.status ?? "active"
    if (status === "pending") router.replace("/(auth)/pending")
    else if (status === "denied") router.replace("/(auth)/denied")
    else if (role === "admin") router.replace("/admin")
    else if (role === "prep_master") router.replace("/portal")
    else router.replace("/member")
  }

  async function handleAppleSignIn() {
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
      // Build a display name from the credential (only provided on first sign-in)
      const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean).join(" ")
      const result = await (signIn as any).social({
        provider: "apple",
        idToken: { token: credential.identityToken },
      })
      if (result?.error) { setError(result.error.message ?? "Apple sign-in failed."); return }
      // Apple only gives the name on the very first sign-in — persist it if we got one
      if (fullName) {
        await authClient.$fetch("https://app.collegedanceprep.com/api/auth/update-user", {
          method: "POST",
          body: JSON.stringify({ name: fullName }),
          headers: { "Content-Type": "application/json" },
        }).catch(() => {})
      }
      await routeAfterAuth()
    } catch (err: any) {
      if (err?.code !== "ERR_REQUEST_CANCELED") {
        setError(err?.message ?? "Apple sign-in failed. Please try again.")
      }
    } finally {
      setAppleLoading(false)
    }
  }

  function handleGoogleSignIn() { setError(null); setGoogleLoading(true); promptAsync() }

  const styles = makeStyles(COLORS)

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.container}>
          <View style={styles.logoWrap}>
            <Text style={styles.logo}>CDP</Text>
            <Text style={styles.logoSub}>College Dance Prep</Text>
          </View>
          <Text style={styles.heading}>Welcome back</Text>
          <Text style={styles.sub}>Sign in to your account</Text>
          {error && <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>}
          <TouchableOpacity style={[styles.googleBtn, googleLoading && styles.btnDisabled]} onPress={handleGoogleSignIn} disabled={googleLoading || loading || appleLoading} activeOpacity={0.8}>
            {googleLoading ? <ActivityIndicator color={COLORS.text} size="small" /> : <><Text style={styles.googleIcon}>G</Text><Text style={styles.googleBtnText}>Continue with Google</Text></>}
          </TouchableOpacity>
          {appleAuthAvailable && (
            <>
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={RADIUS.sm}
                style={[styles.appleBtn, appleLoading && styles.btnDisabled]}
                onPress={handleAppleSignIn}
              />
              <Text style={styles.appleNote}>Use the same email as your existing account to sign in.</Text>
            </>
          )}
          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} placeholder="you@example.com" placeholderTextColor={COLORS.textMuted} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} editable={!loading} />
          </View>
          <View style={styles.field}>
            <View style={styles.passwordLabelRow}>
              <Text style={styles.label}>Password</Text>
              <Link href="/(auth)/forgot-password" asChild>
                <TouchableOpacity activeOpacity={0.7}>
                  <Text style={styles.forgotLink}>Forgot password?</Text>
                </TouchableOpacity>
              </Link>
            </View>
            <View style={styles.passwordWrap}>
              <TextInput style={styles.passwordInput} placeholder="••••••••" placeholderTextColor={COLORS.textMuted} secureTextEntry={!showPassword} value={password} onChangeText={setPassword} editable={!loading} onSubmitEditing={handleSignIn} returnKeyType="go" />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={styles.eyeBtn} activeOpacity={0.7}>
                <Text style={styles.showHideText}>{showPassword ? "Hide" : "Show"}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleSignIn} disabled={loading} activeOpacity={0.8}>
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>Sign in</Text>}
          </TouchableOpacity>
          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Link href="/(auth)/sign-up" asChild><TouchableOpacity><Text style={styles.footerLink}>Sign up</Text></TouchableOpacity></Link>
          </View>
          <View style={styles.footer}>
            <Text style={styles.footerText}>Signing up as a parent? </Text>
            <Link href="/(auth)/parent-sign-up" asChild><TouchableOpacity><Text style={styles.footerLink}>Tap here</Text></TouchableOpacity></Link>
          </View>
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
    logoWrap: { alignItems: "center", marginBottom: SPACING.xl },
    logo: { fontSize: 40, fontWeight: "800", color: COLORS.primary, letterSpacing: 2 },
    logoSub: { fontSize: 13, color: COLORS.textMuted, fontWeight: "500", marginTop: 4 },
    heading: { fontSize: 26, fontWeight: "700", color: COLORS.text, marginBottom: 4, fontFamily: "Sora_700Bold" },
    sub: { fontSize: 14, color: COLORS.textMuted, marginBottom: SPACING.lg },
    errorBox: { backgroundColor: COLORS.redLight, borderRadius: RADIUS.sm, padding: SPACING.sm, marginBottom: SPACING.md },
    errorText: { fontSize: 13, color: COLORS.red, fontWeight: "500" },
    googleBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, marginBottom: SPACING.sm },
    appleBtn: { height: 50, marginBottom: 6 },
    appleNote: { fontSize: 11, color: COLORS.textMuted, textAlign: "center", marginBottom: SPACING.md, lineHeight: 16 },
    googleIcon: { fontSize: 16, fontWeight: "800", color: "#4285F4" },
    googleBtnText: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    dividerRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, marginBottom: SPACING.md },
    dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
    dividerText: { fontSize: 13, color: COLORS.textMuted },
    field: { marginBottom: SPACING.md },
    label: { fontSize: 13, fontWeight: "600", color: COLORS.textSecondary, marginBottom: 6 },
    input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, fontSize: 15, color: COLORS.text },
    passwordWrap: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm },
    passwordInput: { flex: 1, padding: SPACING.md, fontSize: 15, color: COLORS.text },
    eyeBtn: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.md },
    showHideText: { fontSize: 13, fontWeight: "600", color: COLORS.primary },
    btn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: "center", marginTop: SPACING.sm },
    btnDisabled: { opacity: 0.6 },
    btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
    passwordLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
    forgotLink: { fontSize: 13, color: COLORS.primary, fontWeight: "600" },
    footer: { flexDirection: "row", justifyContent: "center", marginTop: SPACING.lg },
    footerText: { fontSize: 14, color: COLORS.textMuted },
    footerLink: { fontSize: 14, color: COLORS.primary, fontWeight: "600" },
  })
}
