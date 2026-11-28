import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from "react-native"
import { API_BASE } from "@/lib/config"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter, useFocusEffect } from "expo-router"
import { LayoutDashboard, Users, LogOut, Sun, Moon, Smartphone, Link, CalendarCheck, CalendarX } from "lucide-react-native"
import * as WebBrowser from "expo-web-browser"
import { SPACING, RADIUS, initials } from "@/constants/theme"

import { signOut, useSession, authClient } from "@/lib/auth-client"
import { useTheme } from "@/lib/theme-context"
import type { ThemePreference } from "@/lib/theme-context"
import { useState, useCallback } from "react"


export default function AdminProfileScreen() {
  const { data: session } = useSession()
  const router = useRouter()
  const { colors: COLORS, theme, setTheme } = useTheme()
  const [isGoogleLinked, setIsGoogleLinked] = useState(false)
  const [googleLinking, setGoogleLinking] = useState(false)
  const [calendarConnected, setCalendarConnected] = useState(false)
  const [freshName, setFreshName] = useState<string | null>(null)

  const loadConnectedState = useCallback(() => {
    authClient.$fetch(`${API_BASE}/api/auth/list-accounts`).then(({ data }) => {
      const accounts = (data as any) ?? []
      setIsGoogleLinked(Array.isArray(accounts) && accounts.some((a: any) => a.providerId === "google"))
    }).catch(() => {})
    authClient.$fetch(`${API_BASE}/api/portal/calendar-events`).then(({ data }) => {
      setCalendarConnected(!!(data as any)?.connected)
    }).catch(() => {})
    authClient.$fetch(`${API_BASE}/api/me`).then(({ data }) => {
      if ((data as any)?.name) setFreshName((data as any).name)
    }).catch(() => {})
  }, [])

  // Re-check on every focus so the UI updates after returning from OAuth browser
  useFocusEffect(loadConnectedState)

  async function handleConnectGoogle() {
    setGoogleLinking(true)
    try {
      await authClient.signIn.social({ provider: "google", callbackURL: "cdp://" })
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not connect Google account.") }
    finally {
      setGoogleLinking(false)
      // loadConnectedState will run via useFocusEffect when the browser closes
      loadConnectedState()
    }
  }

  async function handleConnectCalendar() {
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/google-calendar/url?for=admin`)
      if (error || !(data as any)?.url) throw new Error("Could not get calendar auth URL")
      const result = await WebBrowser.openAuthSessionAsync((data as any).url, "cdp://admin/profile")
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

  const name = freshName ?? session?.user?.name ?? ""
  const email = session?.user?.email ?? ""

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
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <View />
          <TouchableOpacity onPress={handleDeleteAccount} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.deleteTiny}>Delete Account</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(name || email || "?")}</Text></View>
          <Text style={styles.name}>{name || "(no name)"}</Text>
          <Text style={styles.email}>{email}</Text>
          <View style={styles.roleBadge}><Text style={styles.roleText}>Admin</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>SWITCH VIEW</Text>
          <TouchableOpacity style={styles.row} onPress={() => router.replace("/member")} activeOpacity={0.7}>
            <View style={styles.rowIcon}><Users size={18} color={COLORS.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Member view</Text>
              <Text style={styles.rowSub}>See the app as a member</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} onPress={() => router.replace("/portal")} activeOpacity={0.7}>
            <View style={styles.rowIcon}><LayoutDashboard size={18} color={COLORS.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>PrepMaster View</Text>
              <Text style={styles.rowSub}>See the app as a Prep Master</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View>
          <Text style={[styles.sectionLabel, { marginBottom: 8 }]}>CONNECTED ACCOUNTS</Text>
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
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>APPEARANCE</Text>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map(({ value, label, Icon }) => {
              const active = theme === value
              return (
                <TouchableOpacity
                  key={value}
                  style={[styles.themeBtn, active && styles.themeBtnActive]}
                  onPress={() => setTheme(value)}
                  activeOpacity={0.7}
                >
                  <Icon size={16} color={active ? COLORS.primary : COLORS.textMuted} />
                  <Text style={[styles.themeBtnText, active && { color: COLORS.plum }]}>{label}</Text>
                </TouchableOpacity>
              )
            })}
          </View>
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
          <LogOut size={16} color={COLORS.red} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useTheme>["colors"]) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    content: { flex: 1, padding: SPACING.md, gap: SPACING.lg },
    avatarWrap: { alignItems: "center", gap: SPACING.sm, paddingTop: SPACING.lg },
    avatar: { width: 80, height: 80, borderRadius: RADIUS.full, backgroundColor: COLORS.primaryLight, alignItems: "center", justifyContent: "center" },
    avatarText: { fontSize: 28, fontWeight: "700", color: COLORS.plum },
    name: { fontSize: 20, fontWeight: "700", color: COLORS.text, fontFamily: "Anton_400Regular", textTransform: "uppercase", letterSpacing: 0.5 },
    email: { fontSize: 14, color: COLORS.textMuted },
    roleBadge: { backgroundColor: COLORS.primaryLight, paddingHorizontal: 12, paddingVertical: 4, borderRadius: RADIUS.full },
    roleText: { fontSize: 12, fontWeight: "600", color: COLORS.plum },
    section: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border },
    sectionLabel: { fontSize: 11, fontWeight: "700", color: COLORS.textMuted, letterSpacing: 0.8, paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: 4 },
    row: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.md },
    rowIcon: { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: COLORS.primaryLight, alignItems: "center", justifyContent: "center" },
    rowTitle: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    rowSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
    divider: { height: 1, backgroundColor: COLORS.border, marginHorizontal: SPACING.md },
    themeRow: { flexDirection: "row", padding: SPACING.sm, gap: SPACING.sm },
    themeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background },
    themeBtnActive: { borderColor: COLORS.plum, backgroundColor: COLORS.primaryLight },
    themeBtnText: { fontSize: 13, fontWeight: "600", color: COLORS.textMuted },
    accountRow: { borderRadius: 0 },
    accountRowLinked: { backgroundColor: COLORS.greenLight },
    signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
    signOutText: { fontSize: 15, fontWeight: "600", color: COLORS.red },
    titleRow: { flexDirection: "row", justifyContent: "flex-end" },
    deleteTiny: { fontSize: 12, color: COLORS.red, fontWeight: "500" },
    connectedRow: { flexDirection: "row", gap: SPACING.lg },
    connectedItem: { flexDirection: "row", alignItems: "center", gap: 6 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    dotOn: { backgroundColor: COLORS.green },
    dotOff: { backgroundColor: COLORS.border },
    connectedLabel: { fontSize: 13, color: COLORS.text, fontWeight: "500" },
    connectedAction: { color: COLORS.textMuted },
  })
}
