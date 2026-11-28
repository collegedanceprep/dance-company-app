import React, { useCallback, useRef, useState } from "react"
import { API_BASE } from "@/lib/config"
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Animated, PanResponder,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useFocusEffect, useRouter } from "expo-router"
import { Inbox as InboxIcon2, CheckCheck, CalendarDays, CalendarX, CalendarClock, Package, ShieldCheck, Info, MailOpen, Mail } from "lucide-react-native"
import { authClient } from "@/lib/auth-client"
import { useTheme } from "@/lib/theme-context"
import { SPACING, RADIUS } from "@/constants/theme"

const SWIPE_THRESHOLD = 72

type Filter = "all" | "unread"

type Notif = {
  id: string
  type: string
  title: string
  body: string
  read: boolean
  bookingId: string | null
  createdAt: string
}

function typeIcon(type: string) {
  const size = 16
  if (type === "booking_confirmed") return { icon: <CalendarDays size={size} color="#16a34a" />, bg: "#dcfce7" }
  if (type === "booking_cancelled") return { icon: <CalendarX size={size} color="#ef4444" />, bg: "#fee2e2" }
  if (type === "booking_updated")   return { icon: <CalendarClock size={size} color="#f472b6" />, bg: null }
  if (type.startsWith("booking"))   return { icon: <CalendarClock size={size} color="#f472b6" />, bg: null }
  if (type.startsWith("account"))   return { icon: <ShieldCheck size={size} color="#f472b6" />, bg: null }
  if (type.startsWith("plan") || type.startsWith("credit")) return { icon: <Package size={size} color="#f472b6" />, bg: null }
  return { icon: <Info size={size} color="#f472b6" />, bg: null }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function SwipeableRow({
  item,
  onToggleRead,
  onNavigate,
  COLORS,
  styles,
}: {
  item: Notif
  onToggleRead: (item: Notif) => void
  onNavigate: (item: Notif) => void
  COLORS: ReturnType<typeof import("@/lib/theme-context").useTheme>["colors"]
  styles: ReturnType<typeof makeStyles>
}) {
  const translateX = useRef(new Animated.Value(0)).current
  const isOpen = useRef(false)
  // Keep latest callbacks in refs so stale PanResponder closure always calls current version
  const snapOpenRef = useRef<() => void>(() => {})
  const snapClosedRef = useRef<() => void>(() => {})
  const handleActionRef = useRef<() => void>(() => {})

  snapOpenRef.current = () => {
    isOpen.current = true
    Animated.spring(translateX, { toValue: 120, useNativeDriver: true, bounciness: 4 }).start()
  }
  snapClosedRef.current = () => {
    isOpen.current = false
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start()
  }
  handleActionRef.current = () => {
    snapClosedRef.current()
    setTimeout(() => onToggleRead(item), 200)
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        if (g.dx > 0) translateX.setValue(Math.min(g.dx, 140))
        else if (isOpen.current) translateX.setValue(Math.max(0, 120 + g.dx))
      },
      onPanResponderRelease: (_, g) => {
        if (isOpen.current) {
          g.dx < -20 ? snapClosedRef.current() : snapOpenRef.current()
        } else {
          g.dx > SWIPE_THRESHOLD ? snapOpenRef.current() : snapClosedRef.current()
        }
      },
    })
  ).current

  const actionBg = item.read ? COLORS.primary : "#22c55e"

  return (
    <View style={{ overflow: "hidden" }}>
      <TouchableOpacity
        style={[styles.swipeAction, { backgroundColor: actionBg }]}
        onPress={() => handleActionRef.current()}
        activeOpacity={0.8}
      >
        {item.read ? <Mail size={20} color="#fff" /> : <MailOpen size={20} color="#fff" />}
        <Text style={styles.swipeActionText}>{item.read ? "Mark unread" : "Mark read"}</Text>
      </TouchableOpacity>

      <Animated.View
        style={[styles.row, !item.read && styles.rowUnread, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}
          activeOpacity={0.7}
          onPress={() => { if (item.bookingId) onNavigate(item); else if (!item.read) onToggleRead(item) }}
        >
          {(() => {
            const { icon, bg } = typeIcon(item.type)
            const iconBg = item.read ? COLORS.surface : (bg ?? (("primaryLight" in COLORS ? (COLORS as Record<string, string>).primaryLight : undefined) ?? COLORS.surface))
            return <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>{icon}</View>
          })()}
          <View style={styles.rowBody}>
            <View style={styles.rowTop}>
              <Text style={[styles.rowTitle, !item.read && styles.rowTitleUnread]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.rowTime}>{timeAgo(item.createdAt)}</Text>
            </View>
            <Text style={styles.rowBodyText} numberOfLines={2}>{item.body}</Text>
          </View>
          {!item.read && <View style={styles.unreadDot} />}
        </TouchableOpacity>
      </Animated.View>
    </View>
  )
}

export default function InboxScreen() {
  const router = useRouter()
  const { colors: COLORS } = useTheme()
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [fetchError, setFetchError] = useState(false)
  const [filter, setFilter] = useState<Filter>("unread")
  const styles = makeStyles(COLORS)

  const load = useCallback(async () => {
    setFetchError(false)
    const { data, error } = await authClient.$fetch(`${API_BASE}/api/notifications`)
    if (error || !data) { setFetchError(true); return }
    setNotifs((data as { notifications?: Notif[] }).notifications ?? [])
  }, [])

  useFocusEffect(useCallback(() => {
    load().finally(() => setLoading(false))
  }, [load]))

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  async function toggleRead(item: Notif) {
    const newRead = !item.read
    setNotifs((prev) => prev.map((n) => n.id === item.id ? { ...n, read: newRead } : n))
    await authClient.$fetch(`${API_BASE}/api/notifications`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, read: newRead }),
    })
  }

  async function navigateToBooking(item: Notif) {
    if (!item.bookingId) return
    // Mark as read first
    if (!item.read) {
      setNotifs((prev) => prev.map((n) => n.id === item.id ? { ...n, read: true } : n))
      authClient.$fetch(`${API_BASE}/api/notifications`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, read: true }),
      }).catch(() => {})
    }
    router.push({ pathname: "/member/bookings", params: { openBookingId: item.bookingId } })
  }

  async function markAllRead() {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })))
    await authClient.$fetch(`${API_BASE}/api/notifications`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
  }

  const unreadCount = notifs.filter((n) => !n.read).length
  const displayed = filter === "unread" ? notifs.filter((n) => !n.read) : notifs

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator color={COLORS.accent} /></View>
      </SafeAreaView>
    )
  }

  if (fetchError) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Couldn't load notifications</Text>
          <Text style={[styles.emptySub, { marginTop: 8 }]}>Check your connection and try again.</Text>
          <TouchableOpacity
            style={[styles.retryBtn]}
            onPress={() => { setLoading(true); load().finally(() => setLoading(false)) }}
            activeOpacity={0.8}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Inbox</Text>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllRead} style={styles.markAllBtn} activeOpacity={0.7}>
            <CheckCheck size={15} color={COLORS.accent} />
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter pills */}
      <View style={styles.filterRow}>
        {(["unread", "all"] as Filter[]).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.pill, filter === f && { backgroundColor: COLORS.primary }]}
            onPress={() => setFilter(f)}
            activeOpacity={0.7}
          >
            <Text style={[styles.pillText, filter === f && styles.pillTextActive]}>
              {f === "all" ? "All" : `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={displayed}
        keyExtractor={(n) => n.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        contentContainerStyle={displayed.length === 0 ? styles.emptyContainer : styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <InboxIcon2 size={40} color={COLORS.textMuted} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>
              {filter === "unread" ? "No unread notifications" : "No notifications yet"}
            </Text>
            <Text style={styles.emptySub}>
              {filter === "unread"
                ? "You're all caught up."
                : "You'll see booking updates and account activity here."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <SwipeableRow
            item={item}
            onToggleRead={toggleRead}
            onNavigate={navigateToBooking}
            COLORS={COLORS}
            styles={styles}
          />
        )}
      />
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof import("@/lib/theme-context").useTheme>["colors"]) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: SPACING.md,
      paddingTop: SPACING.sm,
      paddingBottom: SPACING.sm,
    },
    title: { fontSize: 26, fontWeight: "700", color: COLORS.text, fontFamily: "Anton_400Regular", textTransform: "uppercase", letterSpacing: 0.5 },
    markAllBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
    markAllText: { fontSize: 13, color: COLORS.plum, fontWeight: "600" },
    filterRow: {
      flexDirection: "row",
      gap: SPACING.xs ?? 6,
      paddingHorizontal: SPACING.md,
      paddingBottom: SPACING.sm,
    },
    pill: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: RADIUS.full ?? 999,
      backgroundColor: COLORS.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: COLORS.border,
    },
    pillText: { fontSize: 13, fontWeight: "600", color: COLORS.textMuted },
    pillTextActive: { color: "#fff" },
    list: { paddingBottom: SPACING.xl },
    emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
    emptyBox: { alignItems: "center", gap: SPACING.sm, paddingHorizontal: SPACING.lg },
    emptyTitle: { fontSize: 16, fontWeight: "600", color: COLORS.text, textAlign: "center" },
    emptySub: { fontSize: 14, color: COLORS.textMuted, textAlign: "center", lineHeight: 20 },
    retryBtn: { marginTop: 16, backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
    retryBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: COLORS.border },
    swipeAction: {
      position: "absolute",
      top: 0, bottom: 0, left: 0,
      width: 120,
      flexDirection: "row",
      alignItems: "center",
      paddingLeft: 20,
      gap: 8,
    },
    swipeActionText: { color: "#fff", fontSize: 13, fontWeight: "600" },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingHorizontal: SPACING.md,
      paddingVertical: SPACING.md,
      gap: SPACING.sm,
      backgroundColor: COLORS.background,
    },
    rowUnread: { backgroundColor: COLORS.surface },
    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: RADIUS.sm,
      alignItems: "center",
      justifyContent: "center",
      flexShrink: 0,
    },
    rowBody: { flex: 1, gap: 3 },
    rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    rowTitle: { fontSize: 14, fontWeight: "500", color: COLORS.textMuted, flex: 1 },
    rowTitleUnread: { fontWeight: "700", color: COLORS.text },
    rowTime: { fontSize: 11, color: COLORS.textMuted, flexShrink: 0 },
    rowBodyText: { fontSize: 13, color: COLORS.textMuted, lineHeight: 18 },
    unreadDot: {
      width: 8, height: 8, borderRadius: 4,
      backgroundColor: COLORS.primary,
      marginTop: 5, flexShrink: 0,
    },
  })
}
