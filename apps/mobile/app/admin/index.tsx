import React from "react"
import { ScrollView, View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, RefreshControl, ActivityIndicator } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useState, useCallback } from "react"
import { useRouter } from "expo-router"
import { CalendarDays, DollarSign, TrendingUp, Activity, Award, Users, X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, CheckCircle, Clock, XCircle, AlertCircle } from "lucide-react-native"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"
import { useAdmin } from "@/lib/admin-context"
import type { AdminBooking } from "@/lib/admin-types"
import { formatTime } from "@/components/BookingDetailModal"
import { fallbackUtcMs } from "@/lib/time-utils"
import { sessionRevenue, SESSION_DURATION_FRACTION } from "@cdp/core"
function fmtMoney(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
function monthLabelFromKey(key: string) {
  const [year, month] = key.split("-")
  return new Date(Number(year), Number(month) - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
}

function BookingItem({ booking: b }: { booking: AdminBooking }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [expanded, setExpanded] = useState(false)
  const s = b.status.toLowerCase()
  const isPast = b.utcDatetime
    ? new Date(b.utcDatetime) <= new Date()
    : b.date && b.time ? fallbackUtcMs(b.date, b.time) <= Date.now() : b.date ? new Date(b.date) <= new Date() : false
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

function CollapsibleGroup({ label, count, color, icon, children, defaultOpen = true, small = false }: { label: string; count: number; color: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; small?: boolean }) {
  const COLORS = useColors()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <TouchableOpacity
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: small ? 6 : 8, paddingHorizontal: small ? 8 : 4, marginLeft: small ? SPACING.sm : 0 }}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {icon}
          <Text style={{ fontSize: small ? 12 : 11, fontWeight: small ? "600" : "700", color, textTransform: small ? "none" : "uppercase", letterSpacing: small ? 0 : 0.6 }}>
            {label} <Text style={{ fontWeight: "400", color: COLORS.textMuted }}>({count})</Text>
          </Text>
        </View>
        {open ? <ChevronUp size={14} color={COLORS.textMuted} /> : <ChevronDown size={14} color={COLORS.textMuted} />}
      </TouchableOpacity>
      {open && <View style={{ gap: SPACING.sm }}>{children}</View>}
    </View>
  )
}

function GroupedBookings({ bookings, statusFilter, onClearFilter }: { bookings: AdminBooking[]; statusFilter?: string | null; onClearFilter?: () => void }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)

  function isPast(b: AdminBooking): boolean {
    const t = b.utcDatetime
      ? new Date(b.utcDatetime).getTime()
      : b.date && b.time ? fallbackUtcMs(b.date, b.time) : b.date ? new Date(b.date).getTime() : 0
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
    }).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")),
  }))
    .filter((g) => g.items.length > 0)
    .filter((g) => !statusFilter || g.key === statusFilter)

  if (groups.length === 0 && !statusFilter) return null
  return (
    <View style={{ padding: SPACING.md, gap: 2 }}>
      {statusFilter && (
        <TouchableOpacity onPress={onClearFilter} style={{ marginBottom: 8 }}>
          <Text style={styles.footnote}>Showing only {statusFilter}. Tap to clear filter.</Text>
        </TouchableOpacity>
      )}
      {groups.length === 0 ? (
        <Text style={styles.empty}>No {statusFilter} bookings this month.</Text>
      ) : groups.map((g) => {
        const byDate = new Map<string, AdminBooking[]>()
        for (const b of g.items) {
          const key = b.date ?? "Unknown date"
          if (!byDate.has(key)) byDate.set(key, [])
          byDate.get(key)!.push(b)
        }
        const dateGroups = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b))
        return (
          <CollapsibleGroup key={g.key} label={g.label} count={g.items.length} color={g.color} icon={g.icon}>
            {dateGroups.map(([date, items]) => (
              <CollapsibleGroup
                key={date}
                label={date === "Unknown date" ? date : new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                count={items.length}
                color={COLORS.textMuted}
                icon={null}
                defaultOpen={false}
                small
              >
                {items.map((b) => <BookingItem key={b.id} booking={b} />)}
              </CollapsibleGroup>
            ))}
          </CollapsibleGroup>
        )
      })}
    </View>
  )
}

function MomChange({ current, previous }: { current: number; previous: number }) {
  const COLORS = useColors()
  if (previous === 0) {
    if (current === 0) return <Text style={{ fontSize: 11, color: COLORS.textMuted }}>—</Text>
    return <Text style={{ fontSize: 11, fontWeight: "600", color: COLORS.green }}>New</Text>
  }
  const pct = ((current - previous) / previous) * 100
  const rounded = Math.round(pct)
  if (rounded === 0) return <Text style={{ fontSize: 11, color: COLORS.textMuted }}>Flat</Text>
  const up = rounded > 0
  return (
    <Text style={{ fontSize: 11, fontWeight: "600", color: up ? COLORS.green : COLORS.red }}>
      {up ? "+" : ""}{rounded}% {up ? "↑" : "↓"}
    </Text>
  )
}

function RosterRow({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  return (
    <View style={styles.rosterRow}>
      <View style={styles.rosterLabelRow}>
        {icon}
        <Text style={styles.rosterLabel}>{label}</Text>
      </View>
      <Text style={styles.rosterValue}>{value}</Text>
    </View>
  )
}

export default function AdminOverviewScreen() {
  const { data, loading, error, refresh } = useAdmin()
  const router = useRouter()
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [bookingsModalOpen, setBookingsModalOpen] = useState(false)
  const [bookingsStatusFilter, setBookingsStatusFilter] = useState<string | null>(null)
  const [revenueModalOpen, setRevenueModalOpen] = useState(false)
  const [marginModalOpen, setMarginModalOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [monthOffset, setMonthOffset] = useState(0)
  const [compareMonthKey, setCompareMonthKey] = useState<string | null>(null)
  const [comparePickerOpen, setComparePickerOpen] = useState(false)

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
  function isSessionPast(b: { utcDatetime?: string | null; date?: string | null; time?: string | null }): boolean {
    const t = b.utcDatetime
      ? new Date(b.utcDatetime).getTime()
      : b.date && b.time ? fallbackUtcMs(b.date, b.time) : b.date ? new Date(b.date).getTime() : 0
    return t > 0 && t <= Date.now()
  }
  const thisMonth = bookings.filter((b) => b.date?.startsWith(monthPrefix(monthOffset)))
  const pending = thisMonth.filter((b) => b.status?.toLowerCase() === "pending")
  const confirmed = thisMonth.filter((b) => b.status?.toLowerCase() === "confirmed" && !isSessionPast(b))
  // Includes late cancels on purpose — they still bill, so revenue/payOwed
  // below need them counted here. Matches apps/web/components/admin-overview-panel.tsx.
  const completed = thisMonth.filter((b) => { const s = b.status?.toLowerCase() ?? ""; return s !== "cancelled" && isSessionPast(b) })
  const cancelled = thisMonth.filter((b) => b.status?.toLowerCase().startsWith("cancelled"))
  const revenue = completed.reduce((sum, b) => sum + sessionRevenue(b.sessionType), 0)
  const allCompleted = bookings.filter((b) => { const s = b.status?.toLowerCase() ?? ""; return s !== "cancelled" && isSessionPast(b) })
  const allRevenue = allCompleted.reduce((sum, b) => sum + sessionRevenue(b.sessionType), 0)
  const firstBookingDate = bookings.reduce((min: string, b) => (b.date && (!min || b.date < min) ? b.date : min), "")
  const firstBookingLabel = firstBookingDate
    ? new Date(`${firstBookingDate}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : ""
  const workerRateMap = new Map(workers.map((w) => [w.name, w.hourlyRate]))
  const payOwedThisMonth = completed.reduce((sum, b) => {
    const rate = workerRateMap.get(b.prepMasterName) ?? 0
    const fraction = SESSION_DURATION_FRACTION[b.sessionType ?? ""] ?? 1
    return sum + rate * fraction
  }, 0)
  const margin = revenue - payOwedThisMonth
  const monthKey = monthPrefix(monthOffset)
  const defaultCompareKey = monthPrefix(monthOffset - 1)
  const compareKey = compareMonthKey ?? defaultCompareKey
  const compareMonth = bookings.filter((b) => b.date?.startsWith(compareKey))
  const compareMonthCompleted = compareMonth.filter((b) => { const s = b.status?.toLowerCase() ?? ""; return s !== "cancelled" && isSessionPast(b) })
  const compareMonthRevenue = compareMonthCompleted.reduce((sum, b) => sum + sessionRevenue(b.sessionType), 0)
  const availableCompareMonths = Array.from(
    new Set(bookings.map((b) => b.date?.slice(0, 7)).filter((k): k is string => !!k && k !== monthKey))
  ).sort((a, b) => (a > b ? -1 : 1))
  if (!availableCompareMonths.includes(defaultCompareKey)) availableCompareMonths.unshift(defaultCompareKey)
  const pmCounts: Record<string, number> = {}
  completed.forEach((b) => { if (b.prepMasterName) pmCounts[b.prepMasterName] = (pmCounts[b.prepMasterName] ?? 0) + 1 })
  const topPMs = Object.entries(pmCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)

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
        </View>
        {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
        <View style={styles.bookingsCard}>
          <View style={styles.bookingsCardHeader}>
            <View style={[styles.kpiHeader, { flexShrink: 1, marginBottom: 0 }]}><CalendarDays size={17} color={COLORS.primary} /><Text style={[styles.kpiLabel, { color: COLORS.text, fontWeight: "700", fontSize: 16 }]} numberOfLines={1}>Bookings this month</Text></View>
            <Text style={styles.bookingsTotal} numberOfLines={1}>{thisMonth.length}</Text>
          </View>
          <View style={styles.statGrid}>
            {[
              { key: "pending", label: "Pending", value: pending.length, bg: COLORS.amberLight, fg: COLORS.amber },
              { key: "confirmed", label: "Confirmed", value: confirmed.length, bg: COLORS.primaryLight, fg: COLORS.primary },
              { key: "completed", label: "Completed", value: completed.length, bg: COLORS.greenLight, fg: COLORS.green },
              { key: "cancelled", label: "Cancelled", value: cancelled.length, bg: COLORS.redLight, fg: COLORS.red },
            ].map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[styles.statTile, { backgroundColor: t.bg, borderWidth: 1, borderColor: t.fg }]}
                onPress={() => { setBookingsStatusFilter(t.key); setBookingsModalOpen(true) }}
                activeOpacity={0.7}
              >
                <Text style={[styles.statTileValue, { color: t.fg }]}>{t.value}</Text>
                <Text style={[styles.statTileLabel, { color: t.fg }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.grid}>
          <TouchableOpacity style={[styles.kpiCardThird, styles.kpiCardClickable, { borderColor: "#bbf7d0" }]} onPress={() => setRevenueModalOpen(true)} activeOpacity={0.7}>
            <View style={styles.kpiHeader}><DollarSign size={14} color={COLORS.green} /><Text style={styles.kpiLabel}>Gross revenue</Text></View>
            <Text style={[styles.kpiValue, { color: COLORS.green }]}>${fmtMoney(revenue)}</Text>
            <Text style={styles.kpiSub}>{completed.length} completed sessions</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.kpiCardThird, styles.kpiCardClickable, { borderColor: COLORS.primary }]} onPress={() => setMarginModalOpen(true)} activeOpacity={0.7}>
            <View style={styles.kpiHeader}><TrendingUp size={14} color={COLORS.primary} /><Text style={styles.kpiLabel}>Margin</Text></View>
            <Text style={[styles.kpiValue, { color: COLORS.green }]}>${fmtMoney(margin)}</Text>
            <Text style={styles.kpiSub}>Owed ${fmtMoney(payOwedThisMonth)}</Text>
          </TouchableOpacity>
          <View style={[styles.kpiCardThird, { borderColor: "#ffffff" }]}>
            <View style={styles.kpiHeader}><Activity size={14} color="#ffffff" /><Text style={styles.kpiLabel}>All-time*</Text></View>
            <Text style={styles.kpiValue}>${fmtMoney(allRevenue)}</Text>
            <Text style={styles.kpiSub}>{allCompleted.length} completed</Text>
          </View>
        </View>
        {firstBookingLabel && (
          <Text style={styles.footnote}>*As of {firstBookingLabel}, the earliest booking on record.</Text>
        )}
        <View style={styles.card}>
          <View style={styles.cardHeader}><Award size={16} color={COLORS.primary} /><Text style={styles.cardTitle}>Top PrepMasters this month*</Text></View>
          {topPMs.length === 0 ? <Text style={styles.empty}>No completed sessions yet this month.</Text> : topPMs.map(([name, count], i) => {
            const worker = workers.find((w) => w.name === name)
            const Row = (
              <View style={styles.rosterRow}>
                <Text style={styles.rosterLabel}>#{i + 1} {name}</Text>
                <Text style={styles.rosterValue}>{count} session{count !== 1 ? "s" : ""}</Text>
              </View>
            )
            return worker ? (
              <TouchableOpacity key={name} onPress={() => router.push(`/admin/prep-masters?worker=${worker.id}`)} activeOpacity={0.6}>
                {Row}
              </TouchableOpacity>
            ) : (
              <View key={name}>{Row}</View>
            )
          })}
          <Text style={styles.footnote}>*All sessions shown are completed sessions.</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.cardHeader}><Users size={16} color={COLORS.primary} /><Text style={styles.cardTitle}>Roster snapshot</Text></View>
          <RosterRow label="Total members" value={members.length} icon={<Users size={14} color={COLORS.textSecondary} />} />
          <RosterRow label="Active PrepMasters" value={workers.filter((w) => w.active).length} icon={<CheckCircle size={14} color={COLORS.textSecondary} />} />
          <RosterRow label="Inactive PrepMasters" value={workers.filter((w) => !w.active).length} icon={<XCircle size={14} color={COLORS.textSecondary} />} />
          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>ALL-TIME BOOKINGS BY STATUS</Text>
          <RosterRow label="Completed" value={allCompleted.length} icon={<CheckCircle size={14} color={COLORS.textSecondary} />} />
          <RosterRow label="Cancelled" value={bookings.filter((b) => b.status?.toLowerCase().startsWith("cancelled")).length} icon={<XCircle size={14} color={COLORS.textSecondary} />} />
          <RosterRow label="Pending" value={bookings.filter((b) => b.status?.toLowerCase() === "pending").length} icon={<AlertCircle size={14} color={COLORS.textSecondary} />} />
          <View style={styles.divider} />
          <View style={styles.compareHeaderRow}>
            <Text style={styles.sectionLabel}>COMPARE TO</Text>
            <TouchableOpacity style={styles.compareButton} onPress={() => setComparePickerOpen(true)}>
              <Text style={styles.compareButtonText}>{monthLabelFromKey(compareKey)}</Text>
              <ChevronDown size={14} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.rosterRow}>
            <View style={styles.rosterLabelRow}><CalendarDays size={14} color={COLORS.textSecondary} /><Text style={styles.rosterLabel}>Bookings</Text></View>
            <View style={styles.compareValueRow}>
              <Text style={styles.rosterValue}>{thisMonth.length}</Text>
              <Text style={styles.compareVs}>vs {compareMonth.length}</Text>
              <MomChange current={thisMonth.length} previous={compareMonth.length} />
            </View>
          </View>
          <View style={styles.rosterRow}>
            <View style={styles.rosterLabelRow}><DollarSign size={14} color={COLORS.textSecondary} /><Text style={styles.rosterLabel}>Revenue</Text></View>
            <View style={styles.compareValueRow}>
              <Text style={styles.rosterValue}>${fmtMoney(revenue)}</Text>
              <Text style={styles.compareVs}>vs ${fmtMoney(compareMonthRevenue)}</Text>
              <MomChange current={revenue} previous={compareMonthRevenue} />
            </View>
          </View>
          <View style={styles.rosterRow}>
            <View style={styles.rosterLabelRow}><CheckCircle size={14} color={COLORS.textSecondary} /><Text style={styles.rosterLabel}>Completed sessions</Text></View>
            <View style={styles.compareValueRow}>
              <Text style={styles.rosterValue}>{completed.length}</Text>
              <Text style={styles.compareVs}>vs {compareMonthCompleted.length}</Text>
              <MomChange current={completed.length} previous={compareMonthCompleted.length} />
            </View>
          </View>
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
                  <Text style={styles.revenueTotalValue}>${fmtMoney(revenue)}</Text>
                </View>
              )}
              renderItem={({ item: b }) => {
                const amt = sessionRevenue(b.sessionType)
                const sessionLabel = b.sessionType === "private-30" ? "30 min" : b.sessionType === "private-45" ? "45 min" : "60 min"
                const isLateCancelled = b.status?.toLowerCase() === "cancelled (late)"
                return (
                  <View style={styles.revenueRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bookingName}>{b.dancerName || b.clientEmail || "Client"}</Text>
                      <Text style={styles.bookingSub}>{b.prepMasterName}{b.date ? ` · ${b.date}` : ""}{b.time ? ` · ${formatTime(b.time, b.utcDatetime)}` : ""} · {sessionLabel}</Text>
                    </View>
                    <View style={styles.revenueRowRight}>
                      {isLateCancelled && (
                        <View style={styles.lateCancelBadge}>
                          <Text style={styles.lateCancelBadgeText}>Late cancel</Text>
                        </View>
                      )}
                      <Text style={styles.revenueAmt}>${fmtMoney(amt)}</Text>
                    </View>
                  </View>
                )
              }}
            />
          )}
        </SafeAreaView>
      </Modal>
      <Modal visible={marginModalOpen} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.safe} edges={["top"]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Margin — {monthLabel(monthOffset)}</Text>
            <TouchableOpacity onPress={() => setMarginModalOpen(false)} hitSlop={8}><X size={22} color={COLORS.text} /></TouchableOpacity>
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
                  <Text style={styles.revenueTotalLabel}>Total owed</Text>
                  <Text style={styles.revenueTotalValue}>${fmtMoney(payOwedThisMonth)}</Text>
                </View>
              )}
              renderItem={({ item: b }) => {
                const rate = workerRateMap.get(b.prepMasterName) ?? 0
                const owed = rate * (SESSION_DURATION_FRACTION[b.sessionType ?? ""] ?? 1)
                const sessionLabel = b.sessionType === "private-30" ? "30 min" : b.sessionType === "private-45" ? "45 min" : b.sessionType === "private-90" ? "90 min" : "60 min"
                const isLateCancelled = b.status?.toLowerCase() === "cancelled (late)"
                return (
                  <View style={styles.revenueRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bookingName}>{b.prepMasterName || "PrepMaster"}</Text>
                      <Text style={styles.bookingSub}>{b.dancerName || b.clientEmail || "Client"}{b.date ? ` · ${b.date}` : ""}{b.time ? ` · ${formatTime(b.time, b.utcDatetime)}` : ""} · {sessionLabel}</Text>
                    </View>
                    <View style={styles.revenueRowRight}>
                      {isLateCancelled && (
                        <View style={styles.lateCancelBadge}>
                          <Text style={styles.lateCancelBadgeText}>Late cancel</Text>
                        </View>
                      )}
                      <Text style={styles.revenueAmt}>${owed.toFixed(2)}</Text>
                    </View>
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
            <TouchableOpacity onPress={() => { setBookingsModalOpen(false); setBookingsStatusFilter(null) }} hitSlop={8}><X size={22} color={COLORS.text} /></TouchableOpacity>
          </View>
          {thisMonth.length === 0 ? (
            <Text style={[styles.empty, { padding: SPACING.md }]}>No bookings this month yet.</Text>
          ) : (
            <ScrollView><GroupedBookings bookings={thisMonth} statusFilter={bookingsStatusFilter} onClearFilter={() => setBookingsStatusFilter(null)} /></ScrollView>
          )}
        </SafeAreaView>
      </Modal>
      <Modal visible={comparePickerOpen} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.safe} edges={["top"]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Compare to</Text>
            <TouchableOpacity onPress={() => setComparePickerOpen(false)} hitSlop={8}><X size={22} color={COLORS.text} /></TouchableOpacity>
          </View>
          <FlatList
            data={availableCompareMonths}
            keyExtractor={(k) => k}
            contentContainerStyle={{ padding: SPACING.md, gap: SPACING.xs }}
            renderItem={({ item: k }) => (
              <TouchableOpacity
                style={[styles.compareOption, k === compareKey && { borderColor: COLORS.primary }]}
                onPress={() => { setCompareMonthKey(k); setComparePickerOpen(false) }}
              >
                <Text style={[styles.compareOptionText, k === compareKey && { color: COLORS.primary, fontWeight: "700" }]}>{monthLabelFromKey(k)}</Text>
              </TouchableOpacity>
            )}
          />
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
    errorBox: { backgroundColor: COLORS.redLight, borderRadius: RADIUS.sm, padding: SPACING.sm },
    errorText: { fontSize: 13, color: COLORS.red },
    grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
    kpiCardThird: { flex: 1, minWidth: 0, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.sm },
    kpiCardClickable: { borderColor: COLORS.primary + "40" },
    kpiHeader: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
    kpiLabel: { fontSize: 11, color: COLORS.textMuted, fontWeight: "500", flex: 1 },
    kpiValue: { fontSize: 16, fontWeight: "700", color: COLORS.text, marginBottom: 2 },
    kpiSub: { fontSize: 10, color: COLORS.textMuted },
    bookingsCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 2, borderColor: COLORS.border, padding: SPACING.md, marginBottom: SPACING.sm },
    bookingsCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
    bookingsTotal: { fontSize: 20, lineHeight: 24, fontWeight: "700", color: COLORS.text },
    statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    statTile: { flexBasis: "47%", flexGrow: 1, borderRadius: RADIUS.sm, paddingVertical: 10, alignItems: "center" },
    statTileValue: { fontSize: 18, fontWeight: "700" },
    statTileLabel: { fontSize: 9, fontWeight: "600", letterSpacing: 0.3, textTransform: "uppercase", marginTop: 2 },
    card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.sm },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    cardTitle: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    empty: { fontSize: 13, color: COLORS.textMuted },
    divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 4 },
    sectionLabel: { fontSize: 10, fontWeight: "700", color: COLORS.textMuted, letterSpacing: 0.8, textTransform: "uppercase" },
    rosterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    rosterLabelRow: { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
    rosterLabel: { fontSize: 13, color: COLORS.textSecondary },
    compareHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: SPACING.xs },
    compareButton: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 4 },
    compareButtonText: { fontSize: 12, fontWeight: "600", color: COLORS.text },
    compareValueRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    compareVs: { fontSize: 11, color: COLORS.textMuted },
    compareOption: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm },
    compareOptionText: { fontSize: 14, color: COLORS.text },
    rosterValue: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    footnote: { fontSize: 10, color: COLORS.textMuted, marginTop: SPACING.xs },
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
    revenueRowRight: { flexDirection: "row", alignItems: "center", gap: SPACING.xs },
    lateCancelBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full, backgroundColor: "#fef3c7", borderWidth: 1, borderColor: "#fcd34d" },
    lateCancelBadgeText: { fontSize: 11, fontWeight: "600", color: "#b45309" },
    revenueAmt: { fontSize: 15, fontWeight: "700", color: COLORS.green },
    revenueTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.md, marginTop: SPACING.sm },
    revenueTotalLabel: { fontSize: 14, fontWeight: "600", color: COLORS.text },
    revenueTotalValue: { fontSize: 16, fontWeight: "700", color: COLORS.green },
  })
}
