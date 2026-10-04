import React, { useCallback, useState } from "react"
import { API_BASE } from "@/lib/config"
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useFocusEffect } from "expo-router"
import { Check, X, Clock, UserX, ChevronDown, ChevronUp } from "lucide-react-native"
import { authClient } from "@/lib/auth-client"
import { useColors } from "@/lib/theme-context"
import { SPACING, RADIUS } from "@/constants/theme"


type PendingUser = {
  id: string
  name: string
  email: string
  status: string
  createdAt: string
  accountType: "prepmaster" | "member"
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export default function ApprovalsScreen() {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [users, setUsers] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const [deniedOpen, setDeniedOpen] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await authClient.$fetch(`${API_BASE}/api/admin/pending-users`)
    if (!error && Array.isArray(data)) setUsers(data)
  }, [])

  useFocusEffect(useCallback(() => {
    load().finally(() => setLoading(false))
  }, [load]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  async function handleAction(user: PendingUser, status: "active" | "denied") {
    const label = status === "active" ? "approve" : "deny"
    Alert.alert(
      status === "active" ? "Approve member?" : "Deny member?",
      `${user.name} (${user.email})`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: status === "active" ? "Approve" : "Deny",
          style: status === "active" ? "default" : "destructive",
          onPress: async () => {
            setActing(user.id)
            try {
              await authClient.$fetch(`${API_BASE}/api/admin/users/${user.id}/status`, {
                method: "PATCH",
                body: JSON.stringify({ status }),
              })
              setUsers((prev) => prev.filter((u) => u.id !== user.id))
            } catch {
              Alert.alert("Error", `Failed to ${label} member.`)
            } finally {
              setActing(null)
            }
          },
        },
      ]
    )
  }

  const pending = users.filter((u) => u.status === "pending")
  const denied = users.filter((u) => u.status === "denied")

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color={COLORS.primary} /></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Approvals</Text>
      </View>
      <FlatList
        data={[{ key: "content" }]}
        keyExtractor={(i) => i.key}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        contentContainerStyle={styles.content}
        renderItem={() => (
          <>
            {/* Pending section */}
            <View style={styles.sectionHeader}>
              <Clock size={15} color="#f59e0b" />
              <Text style={styles.sectionTitle}>Pending Approval ({pending.length})</Text>
            </View>

            {pending.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>No pending accounts.</Text>
              </View>
            ) : (
              <View style={styles.card}>
                {pending.map((u, i) => (
                  <View key={u.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <Text style={styles.name} numberOfLines={1}>{u.name}</Text>
                        <View style={u.accountType === "prepmaster" ? styles.chipPrepmaster : styles.chipMember}>
                          <Text style={u.accountType === "prepmaster" ? styles.chipTextPrepmaster : styles.chipTextMember}>
                            {u.accountType === "prepmaster" ? "PrepMaster" : "Member"}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.email} numberOfLines={1}>{u.email}</Text>
                      <Text style={styles.meta}>Signed up {fmtDate(u.createdAt)}</Text>
                    </View>
                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnDeny]}
                        onPress={() => handleAction(u, "denied")}
                        disabled={acting === u.id}
                        activeOpacity={0.7}
                      >
                        {acting === u.id
                          ? <ActivityIndicator size="small" color={COLORS.red ?? "#ef4444"} />
                          : <><X size={14} color={COLORS.red ?? "#ef4444"} /><Text style={[styles.btnText, { color: COLORS.red ?? "#ef4444" }]}>Deny</Text></>
                        }
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnApprove]}
                        onPress={() => handleAction(u, "active")}
                        disabled={acting === u.id}
                        activeOpacity={0.7}
                      >
                        {acting === u.id
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <><Check size={14} color="#fff" /><Text style={[styles.btnText, { color: "#fff" }]}>Approve</Text></>
                        }
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Denied section */}
            {denied.length > 0 && (
              <>
                <TouchableOpacity
                  style={[styles.sectionHeader, { marginTop: SPACING.lg }]}
                  onPress={() => setDeniedOpen((v) => !v)}
                  activeOpacity={0.7}
                >
                  <UserX size={15} color={COLORS.red ?? "#ef4444"} />
                  <Text style={styles.sectionTitle}>Denied ({denied.length})</Text>
                  {deniedOpen ? <ChevronUp size={15} color={COLORS.textMuted} /> : <ChevronDown size={15} color={COLORS.textMuted} />}
                </TouchableOpacity>
                {deniedOpen && (
                <View style={styles.card}>
                  {denied.map((u, i) => (
                    <View key={u.id} style={[styles.row, i > 0 && styles.rowBorder]}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <Text style={styles.name} numberOfLines={1}>{u.name}</Text>
                          <View style={u.accountType === "prepmaster" ? styles.chipPrepmaster : styles.chipMember}>
                            <Text style={u.accountType === "prepmaster" ? styles.chipTextPrepmaster : styles.chipTextMember}>
                              {u.accountType === "prepmaster" ? "PrepMaster" : "Member"}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.email} numberOfLines={1}>{u.email}</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.btn, styles.btnOutline]}
                        onPress={() => handleAction(u, "active")}
                        disabled={acting === u.id}
                        activeOpacity={0.7}
                      >
                        {acting === u.id
                          ? <ActivityIndicator size="small" color={COLORS.text} />
                          : <><Check size={14} color={COLORS.text} /><Text style={[styles.btnText, { color: COLORS.text }]}>Approve</Text></>
                        }
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
                )}
              </>
            )}
          </>
        )}
      />
    </SafeAreaView>
  )
}

function makeStyles(COLORS: any) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    header: {
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.sm,
      paddingBottom: SPACING.sm,
    },
    title: { fontSize: 26, fontWeight: "700", color: COLORS.text, fontFamily: "Sora_700Bold" },
    content: { padding: SPACING.md, paddingBottom: SPACING.xl },
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: SPACING.sm },
    sectionTitle: { fontSize: 14, fontWeight: "600", color: COLORS.text },
    emptyBox: {
      paddingVertical: SPACING.md,
      paddingHorizontal: SPACING.md,
      backgroundColor: COLORS.surface,
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    emptyText: { fontSize: 13, color: COLORS.textMuted },
    card: {
      borderRadius: RADIUS.md,
      borderWidth: 1,
      borderColor: COLORS.border,
      backgroundColor: COLORS.surface,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: SPACING.sm,
      padding: SPACING.md,
    },
    rowBorder: { borderTopWidth: 1, borderTopColor: COLORS.border },
    name: { fontSize: 14, fontWeight: "600", color: COLORS.text },
    email: { fontSize: 13, color: COLORS.textMuted, marginTop: 1 },
    meta: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
    actions: { flexDirection: "row", gap: 8, flexShrink: 0 },
    btn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: RADIUS.sm,
      minWidth: 70,
      justifyContent: "center",
    },
    btnDeny: { borderWidth: 1, borderColor: COLORS.red ?? "#ef4444" },
    btnApprove: { backgroundColor: COLORS.primary },
    btnOutline: { borderWidth: 1, borderColor: COLORS.border },
    btnText: { fontSize: 13, fontWeight: "600" },
    chipPrepmaster: {
      backgroundColor: "#1d4ed820",
      borderRadius: 99,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    chipTextPrepmaster: { fontSize: 11, fontWeight: "700", color: "#3b82f6" },
    chipMember: {
      backgroundColor: COLORS.border,
      borderRadius: 99,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    chipTextMember: { fontSize: 11, fontWeight: "700", color: COLORS.textMuted },
  })
}
