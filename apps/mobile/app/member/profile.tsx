import { useEffect, useState, useCallback } from "react"
import { API_BASE } from "@/lib/config"
import { AuthImage } from "@/components/AuthImage"
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Image, ActionSheetIOS,
} from "react-native"
import * as ImagePicker from "expo-image-picker"
import { ImageManipulator, SaveFormat } from "expo-image-manipulator"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router"
import { Camera, Link, Sun, Moon, Smartphone, CalendarCheck, CalendarX, LayoutDashboard, Users, ShieldCheck, X } from "lucide-react-native"
import Svg, { Path } from "react-native-svg"
import * as SecureStore from "expo-secure-store"
import * as WebBrowser from "expo-web-browser"
import { authClient, signOut, useSession } from "@/lib/auth-client"
import { SPACING, RADIUS, initials } from "@/constants/theme"
import { useTheme } from "@/lib/theme-context"
import type { ThemePreference } from "@/lib/theme-context"


type Profile = { recordId: string; name: string; email: string; phone: string; goals: string; creditsRemaining: number; parentEmail?: string; isParentView?: boolean; photoUrl?: string | null }

export default function MemberProfileScreen() {
  const { data: session } = useSession()
  const router = useRouter()
  const { colors: COLORS, theme, setTheme } = useTheme()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)

  function formatPhone(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 10)
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  const [goals, setGoals] = useState("")
  const [parentEmail, setParentEmail] = useState("")
  const [dirty, setDirty] = useState(false)
  const [googleLinking, setGoogleLinking] = useState(false)
  const [isGoogleLinked, setIsGoogleLinked] = useState(false)
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [actualRole, setActualRole] = useState<string | null>(null)
  const [nudgeDismissed, setNudgeDismissed] = useState(true) // default true to avoid flash
  const params = useLocalSearchParams<{ calendar?: string }>()

  useEffect(() => {
    SecureStore.getItemAsync("member-google-nudge-dismissed").then((v) => {
      setNudgeDismissed(v === "1")
    }).catch(() => { setNudgeDismissed(false) })
  }, [])

  function dismissNudge() {
    SecureStore.setItemAsync("member-google-nudge-dismissed", "1").catch(() => {})
    setNudgeDismissed(true)
  }

  const load = useCallback(async () => {
    try {
      const [dashResult, accountsResult, meResult, calResult] = await Promise.all([
        authClient.$fetch(`${API_BASE}/api/member/dashboard`),
        authClient.$fetch(`${API_BASE}/api/auth/list-accounts`),
        authClient.$fetch(`${API_BASE}/api/me`),
        authClient.$fetch(`${API_BASE}/api/member/calendar-events`),
      ])
      if (dashResult.error || !dashResult.data) throw new Error((dashResult.error as any)?.statusText ?? "Failed to load")
      const p = (dashResult.data as any).profile as Profile
      setProfile(p); setName(p.name); setPhotoUrl(p.photoUrl ?? null); setPhone(formatPhone(p.phone ?? "")); setGoals(p.goals); setParentEmail(p.parentEmail ?? ""); setError(null)
      const accounts = accountsResult.data ?? []
      setIsGoogleLinked(accounts.some((a: any) => a.providerId === "google"))
      if (!meResult.error && meResult.data) setActualRole((meResult.data as any).role ?? null)
      if (!calResult.error && calResult.data) setCalendarConnected((calResult.data as any).connected === true)
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong.") }
  }, [])

  useEffect(() => {
    if (params.calendar === "connected") { setCalendarConnected(true) }
  }, [params.calendar])

  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  const refreshConnectedState = useCallback(() => {
    authClient.$fetch(`${API_BASE}/api/auth/list-accounts`).then(({ data }) => {
      const accounts = (data as any) ?? []
      setIsGoogleLinked(Array.isArray(accounts) && accounts.some((a: any) => a.providerId === "google"))
    }).catch(() => {})
    authClient.$fetch(`${API_BASE}/api/member/calendar-events`).then(({ data }) => {
      if (data) setCalendarConnected((data as any).connected === true)
    }).catch(() => {})
  }, [])

  // Re-check when screen regains focus (e.g. after OAuth browser closes)
  useFocusEffect(refreshConnectedState)

  async function handleSave() {
    if (!profile) return
    setSaving(true)
    try {
      const { error: err } = await authClient.$fetch(`${API_BASE}/api/member/profile`, {
        method: "PATCH",
        body: JSON.stringify({ recordId: profile.recordId, name, phone, goals, parentEmail: parentEmail.trim() || null }),
        headers: { "Content-Type": "application/json" },
      })
      if (err) throw new Error((err as any)?.statusText ?? "Failed to save")
      setDirty(false)
      Alert.alert("Saved", "Your profile has been updated.")
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Failed to save profile.") }
    finally { setSaving(false) }
  }

  async function uploadPhoto(source: "library" | "camera") {
    const perm = source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert("Permission needed", source === "camera" ? "Allow camera access in Settings to take a photo." : "Allow photo access in Settings to choose a photo.")
      return
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 }
    const picked = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts)
    if (picked.canceled || !picked.assets?.[0]) return
    setPhotoBusy(true)
    try {
      // Shrink to 512px wide JPEG before upload so photos stay small.
      const ref = await ImageManipulator.manipulate(picked.assets[0].uri).resize({ width: 512 }).renderAsync()
      const out = await ref.saveAsync({ compress: 0.8, format: SaveFormat.JPEG, base64: true })
      const { data, error: err } = await authClient.$fetch(`${API_BASE}/api/member/photo`, {
        method: "POST",
        body: { mime: "image/jpeg", base64: out.base64 },
      })
      if (err) throw new Error((err as any)?.message ?? (err as any)?.statusText ?? "Upload failed")
      setPhotoUrl((data as any)?.photoUrl ?? null)
    } catch (e) {
      Alert.alert("Couldn't update photo", e instanceof Error ? e.message : "Please try again.")
    } finally {
      setPhotoBusy(false)
    }
  }

  async function removePhoto() {
    setPhotoBusy(true)
    try {
      const { error: err } = await authClient.$fetch(`${API_BASE}/api/member/photo`, { method: "DELETE" })
      if (err) throw new Error("Remove failed")
      setPhotoUrl(null)
    } catch {
      Alert.alert("Couldn't remove photo", "Please try again.")
    } finally {
      setPhotoBusy(false)
    }
  }

  function handlePhotoPress() {
    const options = ["Take Photo", "Choose from Library", ...(photoUrl ? ["Remove Photo"] : []), "Cancel"]
    const run = (i: number) => {
      if (options[i] === "Take Photo") uploadPhoto("camera")
      else if (options[i] === "Choose from Library") uploadPhoto("library")
      else if (options[i] === "Remove Photo") removePhoto()
    }
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: photoUrl ? options.indexOf("Remove Photo") : undefined },
        run,
      )
    } else {
      Alert.alert("Profile photo", undefined, options.map((o, i) => ({ text: o, style: o === "Cancel" ? "cancel" : o === "Remove Photo" ? "destructive" : "default", onPress: () => run(i) })))
    }
  }

  async function handleConnectCalendar() {
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/google-calendar/url?for=member`)
      if (error || !(data as any)?.url) throw new Error("Could not get calendar auth URL")
      const result = await WebBrowser.openAuthSessionAsync((data as any).url, "cdp://member/profile")
      if (result.type === "success") {
        const connected = result.url?.includes("calendar=connected")
        if (connected) setCalendarConnected(true)
        else Alert.alert("Error", "Could not connect Google Calendar. Please try again.")
      }
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not connect Google Calendar.") }
  }

  async function handleDisconnectCalendar() {
    Alert.alert("Disconnect Google Calendar", "Are you sure you want to disconnect Google Calendar?", [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: async () => {
        const { error } = await authClient.$fetch(`${API_BASE}/api/google-calendar`, { method: "DELETE" })
        if (error) {
          Alert.alert("Error", "Could not disconnect Google Calendar. Please try again.")
          return
        }
        setCalendarConnected(false)
      }},
    ])
  }

  async function handleConnectGoogle() {
    setGoogleLinking(true)
    try {
      await authClient.linkSocial({ provider: "google", callbackURL: "cdp://member/profile" })
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not connect Google account.") }
    finally {
      setGoogleLinking(false)
      refreshConnectedState()
    }
  }

  async function handleSignOut() { await signOut(); router.replace("/(auth)/sign-in") }

  function handleDeleteAccount() {
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account and all associated data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: async () => {
            try {
              await authClient.$fetch(`${API_BASE}/api/member/delete-account`, { method: "DELETE" })
              await signOut()
              router.replace("/(auth)/sign-in")
            } catch {
              Alert.alert("Error", "Failed to delete account. Please try again.")
            }
          },
        },
      ],
    )
  }

  const styles = makeStyles(COLORS)

  const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: any }[] = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "dark", label: "Dark", Icon: Moon },
    { value: "system", label: "System", Icon: Smartphone },
  ]

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Profile</Text>
            <TouchableOpacity onPress={handleDeleteAccount} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.deleteTiny}>Delete Account</Text>
            </TouchableOpacity>
          </View>
          {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

          <View style={styles.avatarWrap}>
            {(() => {
              // Only dancers (and parents managing them) can set a photo; admins previewing don't.
              const canEditPhoto = actualRole === null || actualRole === "dancer"
              const Avatar = (
                <View>
                  {photoUrl ? (
                    <AuthImage path={photoUrl} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials(name || session?.user?.name || "?")}</Text>
                    </View>
                  )}
                  {canEditPhoto && (
                    <View style={styles.avatarBadge}>
                      {photoBusy ? <ActivityIndicator size="small" color="#ffffff" /> : <Camera size={14} color="#ffffff" />}
                    </View>
                  )}
                </View>
              )
              return canEditPhoto ? (
                <TouchableOpacity onPress={handlePhotoPress} disabled={photoBusy} activeOpacity={0.8} accessibilityLabel="Change profile photo">{Avatar}</TouchableOpacity>
              ) : Avatar
            })()}
            <Text style={styles.avatarName}>{name || session?.user?.name || ""}</Text>
            {profile?.isParentView && (
              <View style={styles.parentBadge}>
                <Users size={12} color={COLORS.accent} />
                <Text style={styles.parentBadgeText}>Parent / Guardian View</Text>
              </View>
            )}
          </View>

          {!isGoogleLinked && !nudgeDismissed && !profile?.isParentView && (
            <View style={styles.nudgeBanner}>
              <View style={styles.nudgeGIcon}>
                <Svg viewBox="0 0 24 24" width={20} height={20}>
                  <Path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <Path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <Path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <Path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </Svg>
              </View>
              <View style={styles.nudgeText}>
                <Text style={styles.nudgeTitle}>Sign in faster with Google</Text>
                <Text style={styles.nudgeSub}>Link your Google account to skip the password next time.</Text>
              </View>
              <TouchableOpacity style={styles.nudgeBtn} onPress={handleConnectGoogle} disabled={googleLinking} activeOpacity={0.8}>
                {googleLinking
                  ? <ActivityIndicator size="small" color={COLORS.primary} />
                  : <Text style={styles.nudgeBtnText}>Link</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.nudgeDismiss} onPress={dismissNudge} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <X size={14} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>
          )}

          {(actualRole === "admin" || actualRole === "prep_master") && (
            <>
              <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Switch view</Text></View>
              <View style={styles.card}>
                {actualRole === "admin" && (
                  <>
                    <TouchableOpacity style={styles.switchRow} onPress={() => router.replace("/admin" as any)} activeOpacity={0.7}>
                      <LayoutDashboard size={18} color={COLORS.accent} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.switchLabel}>Admin view</Text>
                        <Text style={styles.switchSub}>Manage members and bookings</Text>
                      </View>
                    </TouchableOpacity>
                    <View style={styles.divider} />
                  </>
                )}
                <TouchableOpacity style={styles.switchRow} onPress={() => router.replace("/portal" as any)} activeOpacity={0.7}>
                  <ShieldCheck size={18} color={COLORS.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchLabel}>PrepMaster View</Text>
                    <Text style={styles.switchSub}>See the app as a Prep Master</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </>
          )}

          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Email</Text>
              <Text style={[styles.fieldInput, { color: COLORS.textSecondary }]} selectable>{profile?.email ?? session?.user?.email ?? ""}</Text>
            </View>
            <View style={styles.divider} />
            <Field label="Phone" value={phone} onChangeText={(v) => { setPhone(formatPhone(v)); setDirty(true) }} keyboardType="phone-pad" COLORS={COLORS} styles={styles} />
            <View style={styles.divider} />
            <Field label="Goals" value={goals} onChangeText={(v) => { setGoals(v); setDirty(true) }} multiline placeholder="e.g. Improve turns, prepare for audition…" COLORS={COLORS} styles={styles} />
            <View style={styles.divider} />
            <Field label="Parent Email" value={parentEmail} onChangeText={(v) => { setParentEmail(v); setDirty(true) }} keyboardType="email-address" placeholder="parent@example.com" COLORS={COLORS} styles={styles} />
          </View>
          {!!parentEmail && <Text style={[styles.avatarEmail, { marginTop: -8, fontSize: 11 }]}>Parent can sign in to view this account.</Text>}

          {dirty && (
            <TouchableOpacity style={[styles.btn, saving && styles.btnDisabled]} onPress={handleSave} disabled={saving} activeOpacity={0.8}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.btnText}>Save changes</Text>}
            </TouchableOpacity>
          )}

          {/* Appearance */}
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Appearance</Text></View>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map(({ value, label, Icon }) => {
              const active = theme === value
              return (
                <TouchableOpacity key={value} style={[styles.themeBtn, active && styles.themeBtnActive]} onPress={() => setTheme(value)} activeOpacity={0.7}>
                  <Icon size={16} color={active ? COLORS.primary : COLORS.textMuted} />
                  <Text style={[styles.themeBtnText, active && { color: COLORS.plum }]}>{label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>

          {/* Connected accounts */}
          <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Connected accounts</Text></View>
          <View style={styles.connectedRow}>
            <View style={styles.connectedItem}>
              <View style={[styles.dot, isGoogleLinked ? styles.dotOn : styles.dotOff]} />
              {isGoogleLinked ? (
                <Text style={styles.connectedLabel}>Google Auth</Text>
              ) : (
                <TouchableOpacity onPress={handleConnectGoogle} disabled={googleLinking} activeOpacity={0.7}>
                  {googleLinking
                    ? <ActivityIndicator size="small" color={COLORS.textMuted} style={{ marginLeft: 2 }} />
                    : <Text style={[styles.connectedLabel, styles.connectedAction]}>Google Auth</Text>}
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.connectedItem}>
              <View style={[styles.dot, calendarConnected ? styles.dotOn : styles.dotOff]} />
              {isGoogleLinked ? (
                <TouchableOpacity onPress={calendarConnected ? handleDisconnectCalendar : handleConnectCalendar} activeOpacity={0.7}>
                  <Text style={[styles.connectedLabel, !calendarConnected && styles.connectedAction]}>
                    Google Calendar
                  </Text>
                </TouchableOpacity>
              ) : (
                <Text style={[styles.connectedLabel, { color: COLORS.textMuted }]}>Google Calendar</Text>
              )}
            </View>
          </View>

          {profile?.isParentView && (
            <TouchableOpacity
              style={[styles.signOutBtn, { marginBottom: 0, borderColor: COLORS.plum }]}
              onPress={() => router.replace("/(auth)/child-picker")}
              activeOpacity={0.8}
            >
              <Text style={[styles.signOutText, { color: COLORS.plum }]}>Switch child</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Field({ label, value, onChangeText, multiline, placeholder, keyboardType, COLORS, styles }: {
  label: string; value: string; onChangeText: (v: string) => void
  multiline?: boolean; placeholder?: string; keyboardType?: "default" | "phone-pad" | "email-address"
  COLORS: any; styles: any
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, multiline && styles.fieldInputMulti]}
        value={value} onChangeText={onChangeText} multiline={multiline}
        placeholder={placeholder ?? ""} placeholderTextColor={COLORS.textMuted}
        keyboardType={keyboardType ?? "default"} autoCorrect={false}
      />
    </View>
  )
}

function makeStyles(COLORS: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    scroll: { padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xl },
    title: { fontSize: 26, fontWeight: "700", color: COLORS.text, fontFamily: "Anton_400Regular", textTransform: "uppercase", letterSpacing: 0.5 },
    errorBox: { backgroundColor: COLORS.redLight, borderRadius: RADIUS.sm, padding: SPACING.sm },
    errorText: { fontSize: 13, color: COLORS.red },
    avatarWrap: { alignItems: "center", gap: SPACING.sm, paddingVertical: SPACING.sm },
    avatarBadge: { position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.primary, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: COLORS.background },
    avatarName: { fontSize: 20, fontWeight: "800", color: COLORS.text, textAlign: "center" },
    avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: COLORS.pinkLight, justifyContent: "center", alignItems: "center" },
    avatarText: { fontSize: 30, fontWeight: "700", color: COLORS.primary },
    avatarEmail: { fontSize: 13, color: COLORS.textMuted },
    parentBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.primaryLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full },
    parentBadgeText: { fontSize: 12, fontWeight: "700", color: COLORS.plum },
    card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
    field: { padding: SPACING.md },
    fieldLabel: { fontSize: 12, fontWeight: "600", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
    fieldInput: { fontSize: 15, color: COLORS.text },
    fieldInputMulti: { minHeight: 72, textAlignVertical: "top" },
    divider: { height: 1, backgroundColor: COLORS.border },
    btn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: "center" },
    btnDisabled: { opacity: 0.6 },
    btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
    sectionHeader: { marginTop: SPACING.sm },
    sectionTitle: { fontSize: 13, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
    themeRow: { flexDirection: "row", gap: SPACING.sm },
    themeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
    themeBtnActive: { borderColor: COLORS.plum, backgroundColor: COLORS.primaryLight },
    themeBtnText: { fontSize: 13, fontWeight: "600", color: COLORS.textMuted },
    connectedRow: { flexDirection: "row", gap: SPACING.lg },
    connectedItem: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    dotOn: { backgroundColor: COLORS.green },
    dotOff: { backgroundColor: COLORS.border },
    connectedLabel: { fontSize: 13, color: COLORS.text, fontWeight: "500" },
    connectedAction: { color: COLORS.textMuted },
    switchRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.md },
    switchRowLabel: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    switchRowSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
    switchLabel: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    switchSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
    signOutBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, alignItems: "center" },
    signOutText: { fontSize: 15, fontWeight: "600", color: COLORS.textSecondary },
    titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    deleteTiny: { fontSize: 12, color: COLORS.red, fontWeight: "500" },
    nudgeBanner: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: "rgba(245,158,11,0.25)", backgroundColor: "rgba(245,158,11,0.07)", padding: SPACING.sm, paddingRight: 36 },
    nudgeGIcon: { width: 36, height: 36, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    nudgeText: { flex: 1 },
    nudgeTitle: { fontSize: 13, fontWeight: "700", color: COLORS.text },
    nudgeSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
    nudgeBtn: { borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, paddingHorizontal: 10, paddingVertical: 6, flexShrink: 0 },
    nudgeBtnText: { fontSize: 12, fontWeight: "700", color: COLORS.text },
    nudgeDismiss: { position: "absolute", right: 10, top: 10 },
  })
}
