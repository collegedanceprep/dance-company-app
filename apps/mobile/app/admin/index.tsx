import React from "react"
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, RefreshControl, ActivityIndicator } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useState, useCallback } from "react"
import { CalendarDays, DollarSign, TrendingUp, Activity, Award, Users, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, CheckCircle, Clock, XCircle, AlertCircle } from "lucide-react-native"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"
import { useAdmin } from "@/lib/admin-context"
import type { AdminBooking } from "@/lib/admin-types"
import { formatTime } from "@/components/BookingDetailModal"

const SINGLE_HOUR_PRICE = 115
const SESSION_REVENUE_FRACTION: Record<string, number> = {
  "private-30": 0.5, "private-45": 0.75, "private-60": 1, "pack-hour": 1, "private-90": 1.5,
}
const SESSION_DURATION_FRACTION: Record<string, number> = {
  "private-30": 0.5, "private-45": 0.75, "private-60": 1, "pack-hour": 1, "private-90": 1.5,
}
function sessionRevenue(sessionType: string | null) {
  return SINGLE_HOUR_PRICE * (SESSION_REVENUE_FRACTION[sessionType ?? ""] ?? 1)
}
function monthLabel(offset: number) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" })
}
function monthPrefix(offset: number) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return d.toISOString().slice(0, 7)
}

function BookingItem({ booking: b }: { booking: AdminBooking }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [expanded, setExpanded] = useState(false)
  const s = b.status.toLowerCase()
  const isPast = b.utcDatetime ? new Date(b.utcDatetime) <= new Date() : b.date ? new Date(b.date) <= new Date() : false
  const effectiveStatus = s === "confirmed" && isPast ? "Completed" : (b.status ?? s)
  const esl = effectiveStatus.toLowerCase()
  const bg =
    esl === "confirmed" ? COLORS.primaryLight
    : esl === "completed" ? COLORS.grayLight
    : effectiveStatus === "pending" ? COLORS.amberLight ?? "#fef3c7"
    : effectiveStatus === "declined" ? COLORS.amberLight ?? "#fef3c7"
    : s.startsWith("cancelled") ? COLORS.redLight
    : COLORS.grayLight
  const badgeColor =
    esl === "confirmed" ? COLORS.primary
    : esl === "completed" ? COLORS.textMuted
    : esl === "pending" ? COLORS.amber
    : esl === "declined" ? COLORS.amber
    : s.startsWith("cancelled") ? COLORS.red
    : COLORS.textMuted
  const isCancelled = s.startsWith("cancelled")
  const hasNotes = !!b.notes?.trim()
  const cancellationReason = isCancelled ? b.cancellationReason?.trim() || null : null
  return (
    <View style={styles.bookingCard}>
      <TouchableOpacity style={styles.bookingRow} onPress={() => setExpanded((v) => !v)} activeOpacity={0.7}>
        <View style={{ flex: 1 }}>
          <Text style={styles.bookingName}>{b.dancerName || b.clientEmail || "Client"}</Text>
          <Text style={styles.bookingSub}>{b.prepMasterName} · {b.date}{b.time ? ` · ${formatTime(b.time, b.utcDatetime)}` : ""}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: bg }]}><Text style={[styles.badgeText, { color: badgeColor }]}>{effectiveStatus}</Text></View>
        {expanded ? <ChevronUp size={14} color={COLORS.textMuted} /> : <ChevronDown size={14} color={COLORS.textMuted} />}
      </TouchableOpacity>
      {expanded && (
        <View style={styles.bookingNotes}>
          {isCancelled && (
            <>
              <Text style={styles.notesLabel}>CANCELLATION REASON</Text>
              <Text style={styles.notesText}>{cancellationReason || "No reason provided."}</Text>
            </>
          )}
          {!isCancelled && (
            <>
              <Text style={styles.notesLabel}>NOTES</Text>
              <Text style={styles.notesText}>{hasNotes ? b.notes!.trim() : "No notes for this booking."}</Text>
            </>
          )}
        </View>
      )}
    </View>
  )
}

type StatusGroup = { key: string; label: string; color: string; icon: React.ReactNode }

function CollapsibleGroup({ label, count, color, icon, children }: { label: string; count: number; color: string; icon: React.ReactNode; children: React.ReactNode }) {
  const COLORS = useColors()
  const [open, setOpen] = useState(true)
  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <TouchableOpacity
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, paddingHorizontal: 4 }}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {icon}
          <Text style={{ fontSize: 11, fontWeight: "700", color, textTransform: "uppercase", letterSpacing: 0.6 }}>
            {label} <Text style={{ fontWeight: "400", color: COLORS.textMuted }}>({count})</Text>
          </Text>
        </View>
        {open ? <ChevronUp size={14} color={COLORS.textMuted} /> : <ChevronDown size={14} color={COLORS.textMuted} />}
      </TouchableOpacity>
      {open && <View style={{ gap: SPACING.sm }}>{children}</View>}
    </View>
  )
}

function GroupedBookings({ bookings }: { bookings: AdminBooking[] }) {
  const COLORS = useColors()

  function isPast(b: AdminBooking): boolean {
    const t = b.utcDatetime ? new Date(b.utcDatetime).getTime() : b.date ? new Date(b.date).getTime() : 0
    return t > 0 && t <= Date.now()
  }

  function effectiveStatus(b: AdminBooking): string {
    const s = b.status?.toLowerCase() ?? ""
    if (s === "confirmed" && isPast(b)) return "Completed"
    return b.status ?? s
  }

  const STATUS_GROUPS: StatusGroup[] = [
    { key: "confirmed", label: "Confirmed", color: COLORS.primary, icon: <Clock size={13} color={COLORS.primary} /> },
    { key: "pending",   label: "Pending",   color: COLORS.amber,   icon: <AlertCircle size={13} color={COLORS.amber} /> },
    { key: "completed", label: "Completed", color: COLORS.green ?? "#22c55e", icon: <CheckCircle size={13} color={COLORS.green ?? "#22c55e"} /> },
    { key: "cancelled", label: "Cancelled", color: COLORS.red,     icon: <XCircle size={13} color={COLORS.red} /> },
    { key: "declined",  label: "Declined",  color: COLORS.red,     icon: <XCircle size={13} color={COLORS.red} /> },
    { key: "other",     label: "Other",     color: COLORS.textMuted, icon: null },
  ]

  const groups = STATUS_GROUPS.map((g) => ({
    ...g,
    items: bookings.filter((b) => {
      const es = effectiveStatus(b)
      const esl = es.toLowerCase()
      if (g.key === "cancelled") return esl.startsWith("cancelled")
      if (g.key === "other") return !STATUS_GROUPS.slice(0, -1).some((sg) => sg.key === "cancelled" ? esl.startsWith("cancelled") : esl === sg.key)
      return esl === g.key
    }),
  })).filter((g) => g.items.length > 0)

  if (groups.length === 0) return null
  return (
    <View style={{ padding: SPACING.md, gap: 2 }}>
      {groups.map((g) => (
        <CollapsibleGroup key={g.key} label={g.label} count={g.items.length} color={g.color} icon={g.icon}>
          {g.items.map((b) => <BookingItem key={b.id} booking={b} />)}
        </CollapsibleGroup>
      ))}
    </View>
  )
}

function RosterRow({ label, value }: { label: string; value: number }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  return (
    <View style={styles.rosterRow}>
      <Text style={styles.rosterLabel}>{label}</Text>
      <Text style={styles.rosterValue}>{value}</Text>
    </View>
  )
}

export default function AdminOverviewScreen() {
  const { data, loading, error, refresh } = useAdmin()
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [bookingsModalOpen, setBookingsModalOpen] = useState(false)
  const [revenueModalOpen, setRevenueModalOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [monthOffset, setMonthOffset] = useState(0)

  const onRefresh = useCallback(async () => { setRefreshing(true); await refresh(); setRefreshing(false) }, [refresh])

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      </SafeAreaView>
    )
  }

  const bookings = data?.bookings ?? []
  const workers = data?.workers ?? []
  const members = data?.members ?? []
  function isSessionPast(b: { utcDatetime?: string | null; date?: string | null }): boolean {
    const t = b.utcDatetime ? new Date(b.utcDatetime).getTime() : b.date ? new Date(b.date).getTime() : 0
    return t > 0 && t <= Date.now()
  }
  const thisMonth = bookings.filter((b) => b.date?.startsWith(monthPrefix(monthOffset)))
  const confirmed = thisMonth.filter((b) => b.status?.toLowerCase() === "confirmed" && !isSessionPast(b))
  const completed = thisMonth.filter((b) => { const s = b.status?.toLowerCase() ?? ""; return (s === "completed" || s === "confirmed") && isSessionPast(b) })
  const cancelled = thisMonth.filter((b) => b.status?.toLowerCase().startsWith("cancelled"))
  const revenue = completed.reduce((sum, b) => sum + sessionRevenue(b.sessionType), 0)
  const allCompleted = bookings.filter((b) => { const s = b.status?.toLowerCase() ?? ""; return (s === "completed" || s === "confirmed") && isSessionPast(b) })
  const allRevenue = allCompleted.reduce((sum, b) => sum + sessionRevenue(b.sessionType), 0)
  const workerRateMap = new Map(workers.map((w) => [w.name, w.hourlyRate]))
  const payOwedThisMonth = completed.reduce((sum, b) => {
    const rate = workerRateMap.get(b.prepMasterName) ?? 0
    const fraction = SESSION_DURATION_FRACTION[b.sessionType ?? ""] ?? 1
    return sum + rate * fraction
  }, 0)
  const margin = revenue - payOwedThisMonth
  const pmCounts: Record<string, number> = {}
  completed.forEach((b) => { if (b.prepMasterName) pmCounts[b.prepMasterName] = (pmCounts[b.prepMasterName] ?? 0) + 1 })
  const topPMs = Object.entries(pmCounts).sort((a, b) => b[1] - a[1]).slice(0, 3)

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}>
        <View style={styles.header}>
          <View>
            <View style={styles.monthNav}>
              <TouchableOpacity onPress={() => setMonthOffset((o) => o - 1)} hitSlop={8} style={styles.monthNavBtn}>
                <ChevronLeft size={20} color={COLORS.primary} />
              </TouchableOpacity>
              <Text style={styles.month}>{monthLabel(monthOffset)}</Text>
              <TouchableOpacity onPress={() => setMonthOffset((o) => o + 1)} hitSlop={8} style={styles.monthNavBtn}>
                <ChevronRight size={20} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.subtitle, { marginLeft: 4 }]}>Company performance snapshot</Text>
          </View>
          <View style={styles.liveBadge}><Text style={styles.liveText}>Live</Text></View>
        </View>
        {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
        <View style={styles.grid}>
          <TouchableOpacity style={[styles.kpiCard, styles.kpiCardClickable]} onPress={() => setBookingsModalOpen(true)} activeOpacity={0.7}>
            <View style={styles.kpiHeader}><CalendarDays size={14} color={COLORS.primary} /><Text style={styles.kpiLabel}>Bookings this month</Text></View>
            <Text style={styles.kpiValue}>{thisMonth.length}</Text>
            <Text style={styles.kpiSub}>{confirmed.length} confirmed · {completed.length} completed · {cancelled.length} cancelled</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.kpiCard, styles.kpiCardClickable, { borderColor: "#bbf7d0" }]} onPress={() => setRevenueModalOpen(true)} activeOpacity={0.7}>
            <View style={styles.kpiHeader}><DollarSign size={14} color={COLORS.green} /><Text style={styles.kpiLabel}>Revenue this month</Text></View>
            <Text style={[styles.kpiValue, { color: COLORS.green }]}>${revenue.toLocaleString()}</Text>
            <Text style={styles.kpiSub}>{completed.length} completed sessions</Text>
          </TouchableOpacity>
          <View style={[styles.kpiCard, { borderColor: "#bbf7d0" }]}>
            <View style={styles.kpiHeader}><TrendingUp size={14} color={COLORS.primary} /><Text style={styles.kpiLabel}>Margin this month</Text></View>
            <Text style={[styles.kpiValue, { color: COLORS.green }]}>${margin.toLocaleString()}</Text>
            <Text style={styles.kpiSub}>Pay owed: ${payOwedThisMonth.toLocaleString()}</Text>
          </View>
          <View style={styles.kpiCard}>
            <View style={styles.kpiHeader}><Activity size={14} color={COLORS.textMuted} /><Text style={styles.kpiLabel}>All-time revenue</Text></View>
            <Text style={styles.kpiValue}>${allRevenue.toLocaleString()}</Text>
            <Text style={styles.kpiSub}>{allCompleted.length} total sessions</Text>
          </View>
        </View>
        <View style={styles.card}>
          <View style={styles.cardHeader}><Award size={16} color={COLORS.primary} /><Text style={styles.cardTitle}>Top PrepMasters this month</Text></View>
          {topPMs.length === 0 ? <Text style={styles.empty}>No completed sessions yet this month.</Text> : topPMs.map(([name, count], i) => (
            <View key={name} style={styles.rosterRow}>
              <Text style={styles.rosterLabel}>#{i + 1} {name}</Text>
              <Text style={styles.rosterValue}>{count} session{count !== 1 ? "s" : ""}</Text>
            </View>
          ))}
        </View>
        <View style={styles.card}>
          <View style={styles.cardHeader}><Users size={16} color={COLORS.primary} /><Text style={styles.cardTitle}>Roster snapshot</Text></View>
          <RosterRow label="Total members" value={members.length} />
          <RosterRow label="Active PrepMasters" value={workers.filter((w) => w.active).length} />
          <RosterRow label="Inactive PrepMasters" value={workers.filter((w) => !w.active).length} />
          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>ALL-TIME BOOKINGS BY STATUS</Text>
          <RosterRow label="Completed" value={allCompleted.length} />
          <RosterRow label="Cancelled" value={bookings.filter((b) => b.status?.toLowerCase().startsWith("cancelled")).length} />
          <RosterRow label="Pending" value={bookings.filter((b) => b.status?.toLowerCase() === "pending").length} />
        </View>
      </ScrollView>
      <Modal visible={revenueModalOpen} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.safe} edges={["top"]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Revenue — {monthLabel(monthOffset)}</Text>
            <TouchableOpacity onPress={() => setRevenueModalOpen(false)} hitSlop={8}><X size={22} color={COLORS.text} /></TouchableOpacity>
          </View>
          {completed.length === 0 ? (
            <Text style={[styles.empty, { padding: SPACING.md }]}>No billable sessions this month.</Text>
          ) : (
            <FlatList
              data={[...completed].sort((a, b) => (b.date > a.date ? 1 : -1))}
              keyExtractor={(b) => b.id}
              contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm }}
              ListFooterComponent={() => (
                <View style={styles.revenueTotal}>
                  <Text style={styles.revenueTotalLabel}>Total</Text>
                  <Text style={styles.revenueTotalValue}>${revenue.toLocaleString()}</Text>
                </View>
              )}
              renderItem={({ item: b }) => {
                const amt = sessionRevenue(b.sessionType)
                const sessionLabel = b.sessionType === "private-30" ? "30 min" : b.sessionType === "private-45" ? "45 min" : "60 min"
                return (
                  <View style={styles.revenueRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bookingName}>{b.dancerName || b.clientEmail || "Client"}</Text>
                      <Text style={styles.bookingSub}>{b.prepMasterName}{b.date ? ` · ${b.date}` : ""}{b.time ? ` · ${formatTime(b.time, b.utcDatetime)}` : ""} · {sessionLabel}</Text>
                    </View>
                    <Text style={styles.revenueAmt}>${amt}</Text>
                  </View>
                )
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
      <Modal visible={bookingsModalOpen} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.safe} edges={["top"]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Bookings — {monthLabel(monthOffset)}</Text>
            <TouchableOpacity onPress={() => setBookingsModalOpen(false)} hitSlop={8}><X size={22} color={COLORS.text} /></TouchableOpacity>
          </View>
          {thisMonth.length === 0 ? (
            <Text style={[styles.empty, { padding: SPACING.md }]}>No bookings this month yet.</Text>
          ) : (
            <ScrollView><GroupedBookings bookings={thisMonth} /></ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    scroll: { padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xl },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    monthNav: { flexDirection: "row", alignItems: "center", gap: 4 },
    monthNavBtn: { padding: 4 },
    month: { fontSize: 22, fontWeight: "700", color: COLORS.text, fontFamily: "Sora_700Bold" },
    subtitle: { fontSize: 13, color: COLORS.textMuted, marginTop: 2 },
    liveBadge: { backgroundColor: COLORS.greenLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full },
    liveText: { fontSize: 12, fontWeight: "600", color: COLORS.green },
    errorBox: { backgroundColor: COLORS.redLight, borderRadius: RADIUS.sm, padding: SPACING.sm },
    errorText: { fontSize: 13, color: COLORS.red },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
    kpiCard: { width: "48%", backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
    kpiCardClickable: { borderColor: COLORS.primary + "40" },
    kpiHeader: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
    kpiLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: "500", flex: 1 },
    kpiValue: { fontSize: 26, fontWeight: "700", color: COLORS.text, marginBottom: 2 },
    kpiSub: { fontSize: 11, color: COLORS.textMuted },
    card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.sm },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    cardTitle: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    empty: { fontSize: 13, color: COLORS.textMuted },
    divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 4 },
    sectionLabel: { fontSize: 10, fontWeight: "700", color: COLORS.textMuted, letterSpacing: 0.8, textTransform: "uppercase" },
    rosterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    rosterLabel: { fontSize: 13, color: COLORS.textSecondary },
    rosterValue: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
    modalTitle: { fontSize: 17, fontWeight: "600", color: COLORS.text },
    bookingCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
    bookingRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.sm },
    bookingNotes: { borderTopWidth: 1, borderTopColor: COLORS.border, padding: SPACING.sm, backgroundColor: COLORS.background },
    notesLabel: { fontSize: 10, fontWeight: "700", color: COLORS.textMuted, letterSpacing: 0.8, marginBottom: 4 },
    notesText: { fontSize: 13, color: COLORS.text },
    bookingName: { fontSize: 14, fontWeight: "600", color: COLORS.text },
    bookingSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
    badgeText: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
    revenueRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.sm },
    revenueAmt: { fontSize: 15, fontWeight: "700", color: COLORS.green },
    revenueTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.md, marginTop: SPACING.sm },
    revenueTotalLabel: { fontSize: 14, fontWeight: "600", color: COLORS.text },
    revenueTotalValue: { fontSize: 16, fontWeight: "700", color: COLORS.green },
  })
}
