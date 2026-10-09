import { useEffect, useState, useCallback, useRef } from "react"
import { API_BASE } from "@/lib/config"
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter, useFocusEffect } from "expo-router"
import { Ticket, Package, CalendarClock, ChevronRight, CalendarPlus } from "lucide-react-native"
import { authClient, useSession } from "@/lib/auth-client"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"
import { BookingDetailModal, formatDate, formatTime, type Booking } from "@/components/BookingDetailModal"


type MemberPlan = {
  id: string; userId: string; planName: string; sessions: number
  pricePaid: number; purchasedAt: string; expiresAt: string; status: string
}
type DashboardData = {
  profile: { name: string; creditsRemaining: number; isParentView?: boolean }
  plans: MemberPlan[]; upcoming: Booking[]; past: Booking[]; cancelled: Booking[]
}

function planDisplayStatus(plan: MemberPlan): string {
  if (plan.status === "Active" && plan.expiresAt && new Date(plan.expiresAt) < new Date()) return "Inactive"
  return plan.status
}

function CreditsCard({ plans, credits }: { plans: MemberPlan[]; credits: number }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const activePlans = plans.filter((p) => planDisplayStatus(p) === "Active")
  const historyPlans = plans.filter((p) => planDisplayStatus(p) !== "Active")
  const hasHistory = historyPlans.length > 0
  const isEmpty = credits === 0 && plans.length === 0
  const [view, setView] = useState<"active" | "history">("active")
  // Switch to history only if there are no active plans and history exists
  useEffect(() => {
    if (activePlans.length === 0 && historyPlans.length > 0) setView("history")
    else if (activePlans.length > 0) setView("active")
  }, [activePlans.length, historyPlans.length])
  const shownPlans = view === "active" ? activePlans : historyPlans

  return (
    <View style={[styles.card, { gap: SPACING.sm }]}>
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardHeaderLeft}>
          <Ticket size={16} color={COLORS.primary} />
          <Text style={styles.cardHeaderTitle}>Session credits</Text>
        </View>
        {hasHistory && (
          <View style={styles.toggle}>
            <TouchableOpacity style={[styles.toggleBtn, view === "active" && styles.toggleBtnActive]} onPress={() => setView("active")} activeOpacity={0.7}>
              <Text style={[styles.toggleText, view === "active" && styles.toggleTextActive]}>Active</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toggleBtn, view === "history" && styles.toggleBtnActive]} onPress={() => setView("history")} activeOpacity={0.7}>
              <Text style={[styles.toggleText, view === "history" && styles.toggleTextActive]}>History</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {isEmpty ? (
        <Text style={styles.emptyText}>Purchase a package to start booking.</Text>
      ) : shownPlans.length === 0 && view === "active" && credits > 0 ? (
        <View style={styles.planItem}>
          <View style={styles.planRow}>
            <Package size={13} color={COLORS.primary} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.planName}>Session credits<Text style={styles.planCredits}>{"  "}{credits} {credits === 1 ? "credit" : "credits"} remaining</Text></Text>
            </View>
            <View style={[styles.planBadge, { backgroundColor: COLORS.greenLight }]}>
              <Text style={[styles.planBadgeText, { color: COLORS.green }]}>Active</Text>
            </View>
          </View>
        </View>
      ) : shownPlans.length === 0 ? (
        <Text style={styles.emptyText}>{view === "active" ? "No active credits." : "No used credits yet."}</Text>
      ) : (
        shownPlans.map((plan) => {
          const status = planDisplayStatus(plan)
          const isActive = status === "Active"
          const displayCount = !isActive ? plan.sessions : plan.sessions === 1 ? 1 : Math.max(0, credits)
          const expiryDate = plan.expiresAt ? new Date(plan.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null
          const statusBg = isActive ? COLORS.greenLight : COLORS.amberLight
          const statusFg = isActive ? COLORS.green : COLORS.amber
          return (
            <View key={plan.id} style={styles.planItem}>
              <View style={styles.planRow}>
                <Package size={13} color={COLORS.primary} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.planName}>
                    {plan.planName}
                    {isActive && <Text style={styles.planCredits}>{"  "}{displayCount} {displayCount === 1 ? "credit" : "credits"} remaining</Text>}
                  </Text>
                  {expiryDate && <Text style={styles.planExpiry}>Expires {expiryDate}</Text>}
                </View>
                <View style={[styles.planBadge, { backgroundColor: statusBg }]}>
                  <Text style={[styles.planBadgeText, { color: statusFg }]}>{status}</Text>
                </View>
              </View>
            </View>
          )
        })
      )}
    </View>
  )
}


function fmtSessionType(s: string | null | undefined): string {
  if (!s) return ""
  const map: Record<string, string> = { "private-60": "60 min", "private-45": "45 min", "private-30": "30 min", "pack-hour": "60 min" }
  return map[s] ?? s
}

function BookingCard({ booking, dimmed, onPress }: { booking: Booking; dimmed?: boolean; onPress?: () => void }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const s = booking.status.toLowerCase()
  const sc = s === "confirmed" ? { bg: COLORS.primaryLight, text: COLORS.primary }
    : s === "declined" ? { bg: COLORS.amberLight, text: COLORS.amber }
    : s.startsWith("cancelled") ? { bg: COLORS.redLight, text: COLORS.red }
    : { bg: COLORS.grayLight, text: COLORS.textMuted }
  const content = (
    <View style={[styles.bookingCard, dimmed && { opacity: 0.65 }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.bookingCoach}>{booking.prepMasterName || "PrepMaster"}</Text>
        <Text style={styles.bookingDate}>{formatDate(booking.date)}{booking.time ? ` · ${formatTime(booking.time, booking.utcDatetime)}` : ""}</Text>
        {booking.sessionType ? <Text style={styles.bookingType}>{fmtSessionType(booking.sessionType)}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
          <Text style={[styles.statusText, { color: sc.text }]}>{booking.status}</Text>
        </View>
        {onPress && <ChevronRight size={14} color={COLORS.textMuted} />}
      </View>
    </View>
  )
  if (onPress) {
    return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>
  }
  return content
}

export default function MemberHomeScreen() {
  const { data: session } = useSession()
  const router = useRouter()
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [cancelledExpanded, setCancelledExpanded] = useState(false)
  const firstName = (data?.profile.name ?? session?.user?.name)?.split(" ")[0] ?? "Dancer"
  const isParentView = data?.profile.isParentView ?? false

  const load = useCallback(async (retrying = false) => {
    try {
      const { data: result, error: err } = await authClient.$fetch(`${API_BASE}/api/member/dashboard`)
      if (err || !result) {
        // Right after switching views (e.g. admin → member preview via
        // router.replace), the auth cookie can lag a beat behind this
        // screen's mount, producing a transient 401 even though the user
        // really is signed in. Retry once after a short delay before
        // surfacing an error.
        if ((err as any)?.status === 401 && !retrying) {
          await new Promise((r) => setTimeout(r, 400))
          return load(true)
        }
        throw new Error((err as any)?.statusText ?? "Failed to load")
      }
      setData(result as DashboardData); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong.") }
  }, [])

  const initialLoad = useRef(true)
  useEffect(() => { load().finally(() => setLoading(false)) }, [load])
  // Refresh credits/bookings whenever screen comes back into focus
  useFocusEffect(useCallback(() => {
    if (initialLoad.current) { initialLoad.current = false; return }
    load()
  }, [load]))
  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false) }, [load])

  function handleCancelled(id: string) {
    setData((prev) => {
      if (!prev) return prev
      const cancel = (b: Booking) => b.id === id ? { ...b, status: "Cancelled" } : b
      return {
        ...prev,
        upcoming: prev.upcoming.filter((b) => b.id !== id),
        cancelled: [{ ...prev.upcoming.find((b) => b.id === id)!, status: "Cancelled" }, ...prev.cancelled].filter(Boolean),
      }
    })
  }

  function handleRescheduled(id: string, date: string, time: string) {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        upcoming: prev.upcoming.map((b) => b.id === id ? { ...b, date, time, status: "Pending" } : b),
      }
    })
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      </SafeAreaView>
    )
  }

  const plans = data?.plans ?? []
  const credits = data?.profile.creditsRemaining ?? 0
  const upcoming = data?.upcoming ?? []
  const past = data?.past ?? []
  const cancelled = data?.cancelled ?? []

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}>
        <View style={styles.header}>
          <Text style={styles.greeting}>{isParentView ? `Welcome to ${firstName}'s account!` : `Welcome, ${firstName}!`}</Text>
          <Text style={styles.greetingSub}>{isParentView ? `Here's ${firstName}'s training overview.` : "Here's your training overview."}</Text>
        </View>
        {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}
        <CreditsCard plans={plans} credits={credits} />
        <TouchableOpacity style={styles.bookCta} onPress={() => router.push("/member/book" as any)} activeOpacity={0.7}>
          <View style={styles.bookCtaLeft}>
            <CalendarPlus size={18} color={COLORS.primary} />
            <View>
              <Text style={styles.bookCtaTitle}>Ready to train?</Text>
              <Text style={styles.bookCtaSub}>Browse PrepMasters and book your next session.</Text>
            </View>
          </View>
          <View style={styles.bookCtaBtn}><Text style={styles.bookCtaBtnText}>Book</Text></View>
        </TouchableOpacity>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upcoming sessions</Text>
          {upcoming.length === 0 ? (
            <View style={styles.emptyCard}>
              <CalendarClock size={32} color={COLORS.textMuted} />
              <Text style={styles.emptyTitle}>No upcoming sessions</Text>
              <Text style={styles.emptySub}>Book a private session with a PrepMaster to get started.</Text>
            </View>
          ) : upcoming.map((b) => (
            <BookingCard key={b.id} booking={b} onPress={() => setSelectedBooking(b)} />
          ))}
        </View>
        {past.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionTitle, { color: COLORS.textMuted }]}>Past sessions</Text>
              <TouchableOpacity onPress={() => router.push("/member/bookings" as any)} style={styles.seeAll}>
                <Text style={styles.seeAllText}>See all</Text>
                <ChevronRight size={14} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
            {past.slice(0, 3).map((b) => <BookingCard key={b.id} booking={b} dimmed />)}
          </View>
        )}
        {cancelled.length > 0 && (
          <View style={styles.section}>
            <TouchableOpacity style={styles.sectionRow} onPress={() => setCancelledExpanded((v) => !v)} activeOpacity={0.7}>
              <Text style={[styles.sectionTitle, { color: COLORS.textMuted }]}>Cancelled sessions ({cancelled.length})</Text>
              <ChevronRight size={16} color={COLORS.textMuted} style={{ transform: [{ rotate: cancelledExpanded ? "90deg" : "0deg" }] }} />
            </TouchableOpacity>
            {cancelledExpanded && cancelled.map((b) => <BookingCard key={b.id} booking={b} dimmed />)}
          </View>
        )}
      </ScrollView>
      <BookingDetailModal
        booking={selectedBooking}
        onClose={() => setSelectedBooking(null)}
        onCancelled={handleCancelled}
        onRescheduled={handleRescheduled}
        onRefresh={load}
      />
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    scroll: { padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xl },
    header: { gap: 4 },
    greeting: { fontSize: 26, fontWeight: "700", color: COLORS.text, fontFamily: "Sora_700Bold" },
    greetingSub: { fontSize: 14, color: COLORS.textMuted },
    errorBox: { backgroundColor: COLORS.redLight, borderRadius: RADIUS.sm, padding: SPACING.sm },
    errorText: { fontSize: 13, color: COLORS.red },
    card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.sm },
    cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    cardHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
    cardHeaderTitle: { fontSize: 15, fontWeight: "700", color: COLORS.text },
    toggle: { flexDirection: "row", backgroundColor: COLORS.grayLight, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, padding: 3 },
    toggleBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: RADIUS.sm - 2 },
    toggleBtnActive: { backgroundColor: COLORS.background, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
    toggleText: { fontSize: 13, fontWeight: "600", color: COLORS.textMuted },
    toggleTextActive: { color: COLORS.text },
    emptyText: { fontSize: 14, color: COLORS.textMuted },
    planItem: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.md, backgroundColor: COLORS.background },
    planRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    planName: { fontSize: 15, fontWeight: "600", color: COLORS.text, flex: 1 },
    planCredits: { fontSize: 14, fontWeight: "400", color: COLORS.textMuted },
    planExpiry: { fontSize: 12, color: COLORS.textMuted, marginTop: 3 },
    planBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.full },
    planBadgeText: { fontSize: 12, fontWeight: "600" },
    bookCta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.sm },
    bookCtaLeft: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, flex: 1 },
    bookCtaTitle: { fontSize: 14, fontWeight: "600", color: COLORS.text },
    bookCtaSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
    bookCtaBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: RADIUS.full },
    bookCtaBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },
    section: { gap: SPACING.sm },
    sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    sectionTitle: { fontSize: 17, fontWeight: "700", color: COLORS.text, fontFamily: "Sora_600SemiBold" },
    seeAll: { flexDirection: "row", alignItems: "center", gap: 2 },
    seeAllText: { fontSize: 13, color: COLORS.primary, fontWeight: "600" },
    emptyCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.xl, alignItems: "center", gap: SPACING.sm },
    emptyTitle: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    emptySub: { fontSize: 13, color: COLORS.textMuted, textAlign: "center" },
    bookingCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
    bookingCoach: { fontSize: 14, fontWeight: "600", color: COLORS.text },
    bookingDate: { fontSize: 12, color: COLORS.textMuted },
    bookingType: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
    statusText: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
    statusDot: { width: 8, height: 8, borderRadius: 4 },
  })
}
