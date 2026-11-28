import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, TextInput, Modal, FlatList, Keyboard,
} from "react-native"
import { API_BASE } from "@/lib/config"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter, useFocusEffect } from "expo-router"
import { Users, LogOut, ShieldCheck, Sun, Moon, Smartphone, CalendarCheck, CalendarX, Link, LayoutDashboard, X } from "lucide-react-native"
import Svg, { Path } from "react-native-svg"
import * as WebBrowser from "expo-web-browser"
import { authClient, signOut, useSession } from "@/lib/auth-client"
import { SPACING, RADIUS, initials } from "@/constants/theme"
import { useTheme } from "@/lib/theme-context"
import type { ThemePreference } from "@/lib/theme-context"
import { useState, useCallback, useEffect } from "react"
import * as SecureStore from "expo-secure-store"
import { getUniversityColor } from "@/lib/university-colors"


const UNIVERSITIES = [
  "Alabama","Arizona","ASU","Boise","Cincinnati","Coastal Carolina","CSU","CU Boulder",
  "ECU","Florida","FSU","GCU","Indiana","Iowa State","Kansas State","Kansas University",
  "Kentucky","Louisville","LSU Tiger Girls","Mississippi State","NC State","Ole Miss",
  "Ohio State Club Team","Oklahoma","Oregon","Penn State","Pitt","Purdue","Samford",
  "Sam Houston State","SDSU","South Carolina","TCU","Tennessee","Texas State","U Miami",
  "UCLA","UCSB","UK","UNLV","Utah","Vanderbilt","Virginia Tech","Washington",
  "Western Michigan","Wisconsin","WVU","Wichita State",
]

export default function PortalProfileScreen() {
  const { data: session } = useSession()
  const router = useRouter()
  const { colors: COLORS, theme, setTheme } = useTheme()
  const name = session?.user?.name ?? ""
  const email = session?.user?.email ?? ""
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [isGoogleLinked, setIsGoogleLinked] = useState(false)
  const [googleLinking, setGoogleLinking] = useState(false)
  const [actualRole, setActualRole] = useState<string | null>(null)
  const [workerRole, setWorkerRole] = useState("PrepMaster")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [university, setUniversity] = useState("")
  const [pendingUniversity, setPendingUniversity] = useState("")
  const [dirty, setDirty] = useState({ phone: false, address: false, university: false })
  const [saving, setSaving] = useState(false)
  const [uniPickerOpen, setUniPickerOpen] = useState(false)
  const [nudgeDismissed, setNudgeDismissed] = useState(true) // default true to avoid flash

  useEffect(() => {
    SecureStore.getItemAsync("pm-google-nudge-dismissed").then((v) => {
      setNudgeDismissed(v === "1")
    }).catch(() => { setNudgeDismissed(false) })
  }, [])

  function dismissNudge() {
    SecureStore.setItemAsync("pm-google-nudge-dismissed", "1").catch(() => {})
    setNudgeDismissed(true)
  }

  const loadConnectedState = useCallback(() => {
    authClient.$fetch(`${API_BASE}/api/portal/calendar-events`).then(({ data }) => {
      setCalendarConnected(!!(data as any)?.connected)
    }).catch(() => {})
    authClient.$fetch(`${API_BASE}/api/auth/list-accounts`).then(({ data }) => {
      const accounts = (data as any) ?? []
      setIsGoogleLinked(Array.isArray(accounts) && accounts.some((a: any) => a.providerId === "google"))
    }).catch(() => {})
    authClient.$fetch(`${API_BASE}/api/me`).then(({ data }) => {
      if (data) setActualRole((data as any).role ?? null)
    }).catch(() => {})
    authClient.$fetch(`${API_BASE}/api/portal/dashboard`).then(({ data }) => {
      const pm = (data as any)?.prepMaster
      setPhone(formatPhone(pm?.phone ?? ""))
      setAddress(pm?.address ?? "")
      setUniversity(pm?.university ?? "")
      setPendingUniversity(pm?.university ?? "")
      setWorkerRole(pm?.workerRole ?? "PrepMaster")
      setDirty({ phone: false, address: false, university: false })
    }).catch(() => {})
  }, [])

  // Re-check on every focus so the UI updates after returning from OAuth browser
  useFocusEffect(loadConnectedState)

  async function handleConnectGoogle() {
    setGoogleLinking(true)
    try {
      await authClient.linkSocial({ provider: "google", callbackURL: "cdp://portal/profile" })
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not connect Google account.") }
    finally {
      setGoogleLinking(false)
      loadConnectedState()
    }
  }

  async function handleConnectCalendar() {
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/google-calendar/url?for=portal`)
      if (error || !(data as any)?.url) throw new Error("Could not get calendar auth URL")
      const result = await WebBrowser.openAuthSessionAsync((data as any).url, "cdp://portal/profile")
      if (result.type === "success") loadConnectedState()
      else Alert.alert("Error", "Could not connect Google Calendar. Please try again.")
    } catch (e) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not connect Google Calendar.")
    }
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

  async function saveField(fields: Record<string, string>) {
    setSaving(true)
    try {
      await authClient.$fetch(`${API_BASE}/api/portal/profile`, {
        method: "PATCH",
        body: JSON.stringify(fields),
        headers: { "Content-Type": "application/json" },
      })
    } catch {
      Alert.alert("Error", "Could not save. Please try again.")
      throw new Error("save failed")
    } finally {
      setSaving(false)
    }
  }

  function formatPhone(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 10)
    if (digits.length < 4) return digits
    if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }

  async function handleSavePhone() {
    Keyboard.dismiss()
    try {
      await saveField({ phone })
      setDirty(d => ({ ...d, phone: false }))
    } catch {}
  }

  async function handleSaveAddress() {
    Keyboard.dismiss()
    try {
      await saveField({ address })
      setDirty(d => ({ ...d, address: false }))
    } catch {}
  }

  function handleSelectUniversity(v: string) {
    setUniPickerOpen(false)
    if (v === university) return
    Alert.alert(
      "Switch University",
      `Are you sure you want to change your university to "${v}"?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Save", onPress: async () => {
          setPendingUniversity(v)
          try {
            await saveField({ university: v })
            setUniversity(v)
            setPendingUniversity(v)
          } catch {
            setPendingUniversity(university)
          }
        }},
      ],
    )
  }

  async function handleSignOut() {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: async () => { await signOut(); router.replace("/(auth)/sign-in") } },
    ])
  }

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

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.titleRow}>
          <View />
          <TouchableOpacity onPress={handleDeleteAccount} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.deleteTiny}>Delete Account</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(name)}</Text></View>
          <Text style={styles.avatarName}>{name}</Text>
          <Text style={styles.avatarEmail}>{email}</Text>
          <View style={styles.roleBadge}>
            <ShieldCheck size={12} color={COLORS.accent} />
            <Text style={styles.roleBadgeText}>{workerRole}</Text>
          </View>
        </View>

        {!isGoogleLinked && !nudgeDismissed && (
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

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>My Info</Text></View>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput
              style={styles.fieldInput}
              value={phone}
              onChangeText={(v) => { setPhone(formatPhone(v)); setDirty(d => ({ ...d, phone: true })) }}
              placeholder="Add phone number"
              placeholderTextColor={COLORS.textMuted}
              keyboardType="phone-pad"
            />
            {dirty.phone && (
              <TouchableOpacity style={styles.fieldSaveBtn} onPress={handleSavePhone} disabled={saving} activeOpacity={0.8}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.fieldSaveText}>Save</Text>}
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.fieldRow} onPress={() => setUniPickerOpen(true)} activeOpacity={0.7}>
            <Text style={styles.fieldLabel}>University</Text>
            {university ? (() => {
              const uc = getUniversityColor(university)
              return (
                <View style={[styles.uniChip, { backgroundColor: uc.bg }]}>
                  <Text style={[styles.uniChipText, { color: uc.text }]}>{university}</Text>
                </View>
              )
            })() : (
              <Text style={[styles.fieldInput, { color: COLORS.textMuted }]}>Select university</Text>
            )}
          </TouchableOpacity>
          <View style={styles.divider} />
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Address</Text>
            <TextInput
              style={styles.fieldInput}
              value={address}
              onChangeText={(v) => { setAddress(v); setDirty(d => ({ ...d, address: true })) }}
              placeholder="Add address"
              placeholderTextColor={COLORS.textMuted}
            />
            {dirty.address && (
              <TouchableOpacity style={styles.fieldSaveBtn} onPress={handleSaveAddress} disabled={saving} activeOpacity={0.8}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.fieldSaveText}>Save</Text>}
              </TouchableOpacity>
            )}
          </View>
        </View>

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
              <View style={{ height: 1, backgroundColor: COLORS.border, marginHorizontal: SPACING.md }} />
            </>
          )}
          <TouchableOpacity style={styles.switchRow} onPress={() => router.replace("/member" as any)} activeOpacity={0.7}>
            <Users size={18} color={COLORS.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>Member view</Text>
              <Text style={styles.switchSub}>View your own bookings and credits</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Connected Accounts</Text></View>
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

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.8}>
          <LogOut size={16} color={COLORS.textSecondary} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={uniPickerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setUniPickerOpen(false)}>
        <SafeAreaView style={styles.modalSafe} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select University</Text>
            <TouchableOpacity onPress={() => setUniPickerOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.modalCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <FlatList
            data={UNIVERSITIES}
            keyExtractor={(item) => item}
            contentContainerStyle={styles.modalList}
            renderItem={({ item }) => {
              const uc = getUniversityColor(item)
              const selected = item === university
              return (
                <TouchableOpacity
                  style={[styles.uniOption, selected && styles.uniOptionSelected]}
                  onPress={() => handleSelectUniversity(item)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.uniChip, { backgroundColor: uc.bg }]}>
                    <Text style={[styles.uniChipText, { color: uc.text }]}>{item}</Text>
                  </View>
                  {selected && <Text style={styles.uniCheckmark}>✓</Text>}
                </TouchableOpacity>
              )
            }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    scroll: { padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xl },
    avatarWrap: { alignItems: "center", gap: 6, paddingVertical: SPACING.sm },
    avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: COLORS.pinkLight, justifyContent: "center", alignItems: "center" },
    avatarText: { fontSize: 32, fontWeight: "700", color: COLORS.primary },
    avatarName: { fontSize: 20, fontWeight: "700", color: COLORS.text },
    avatarEmail: { fontSize: 13, color: COLORS.textMuted },
    roleBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.primaryLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full },
    roleBadgeText: { fontSize: 12, fontWeight: "700", color: COLORS.plum },
    sectionHeader: { marginTop: SPACING.sm },
    sectionTitle: { fontSize: 13, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6 },
    card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
    switchRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.md },
    switchLabel: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    switchSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
    themeRow: { flexDirection: "row", gap: SPACING.sm },
    themeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
    themeBtnActive: { borderColor: COLORS.plum, backgroundColor: COLORS.primaryLight },
    themeBtnText: { fontSize: 13, fontWeight: "600", color: COLORS.textMuted },
    accountRowLinked: { backgroundColor: COLORS.greenLight },
    connectedRow: { flexDirection: "row", gap: SPACING.lg },
    connectedItem: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    dotOn: { backgroundColor: COLORS.green },
    dotOff: { backgroundColor: COLORS.border },
    connectedLabel: { fontSize: 13, color: COLORS.text, fontWeight: "500" },
    connectedAction: { color: COLORS.textMuted },
    signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, marginTop: SPACING.sm },
    signOutText: { fontSize: 15, fontWeight: "600", color: COLORS.textSecondary },
    titleRow: { flexDirection: "row", justifyContent: "flex-end" },
    deleteTiny: { fontSize: 12, color: COLORS.red, fontWeight: "500" },
    divider: { height: 1, backgroundColor: COLORS.border, marginHorizontal: SPACING.md },
    fieldRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: 12 },
    fieldLabel: { fontSize: 13, fontWeight: "600", color: COLORS.textMuted, width: 80 },
    fieldInput: { flex: 1, fontSize: 14, color: COLORS.text },
    fieldSaveBtn: { backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 6 },
    fieldSaveText: { fontSize: 13, fontWeight: "600", color: "#fff" },
    uniChip: { borderRadius: RADIUS.full, paddingHorizontal: 10, paddingVertical: 4 },
    uniChipText: { fontSize: 13, fontWeight: "600" },
    modalSafe: { flex: 1, backgroundColor: COLORS.background },
    modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
    modalTitle: { fontSize: 17, fontWeight: "700", color: COLORS.text },
    modalCancel: { fontSize: 15, color: COLORS.plum },
    modalList: { padding: SPACING.md, gap: SPACING.sm },
    uniOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.sm },
    uniOptionSelected: { backgroundColor: COLORS.primaryLight },
    uniCheckmark: { fontSize: 16, color: COLORS.plum, fontWeight: "700" },
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
