import { useEffect, useState, useCallback, useMemo } from "react"
import { API_BASE } from "@/lib/config"
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, Alert, KeyboardAvoidingView, Platform,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter } from "expo-router"
import { ChevronLeft, ChevronRight, Check, Users, CalendarOff } from "lucide-react-native"
import { authClient, useSession } from "@/lib/auth-client"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"
import { getUniversityColor } from "@/lib/university-colors"
import { TimeWheelPicker, generate15MinSlots } from "@/components/TimeWheelPicker"


type Coach = { id: string; name: string; email: string; university: string; region: string; hasAvailability: boolean }
type DayAvailability = { dayOfWeek: number; enabled: boolean; startTime: string; endTime: string }
type MemberPlan = { id: string; planName: string; sessions: number; status: string; expiresAt: string }
type CoachDetail = { coach: Coach; week: DayAvailability[]; bookedSlots: Record<string, string[]>; pmTimezone: string }

function toIso(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }
function weekStart(date: Date): Date { const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay()); return d }
function buildWeekDays(sunday: Date): Date[] { return Array.from({ length: 7 }, (_, i) => { const d = new Date(sunday); d.setDate(sunday.getDate() + i); return d }) }
function getTZAbbr(): string {
  try {
    return Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? ""
  } catch { return "" }
}

// Convert "YYYY-MM-DD" + "3:00 PM" (in the device's local timezone) to a UTC ISO string
function toUtcDatetime(dateIso: string, time12h: string): string {
  const match = time12h.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return ""
  let hour = parseInt(match[1], 10)
  const minute = parseInt(match[2], 10)
  const period = match[3].toUpperCase()
  if (period === "PM" && hour !== 12) hour += 12
  if (period === "AM" && hour === 12) hour = 0
  const local = new Date(`${dateIso}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`)
  return local.toISOString()
}

function to12Hour(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":")
  let h = Number(hStr); const m = mStr ?? "00"
  const period = h >= 12 ? "PM" : "AM"
  if (h === 0) h = 12; else if (h > 12) h -= 12
  return `${h}:${m} ${period}`
}
function slotsForDate(dateIso: string, week: DayAvailability[]): string[] {
  const day = new Date(`${dateIso}T00:00:00`).getDay()
  const config = week.find((w) => w.dayOfWeek === day)
  if (!config || !config.enabled) return []
  return generate15MinSlots(config.startTime, config.endTime)
}

/**
 * Convert a PM-timezone slot string (e.g. "9:00 AM") to the device's local
 * time string for display. Returns the raw slot string as a fallback.
 */
function pmSlotToLocal(dateIso: string, pmSlot: string, pmTimezone: string): string {
  try {
    const match = pmSlot.match(/(\d+)(?::(\d+))?\s*(AM|PM)/i)
    if (!match) return pmSlot
    let h = parseInt(match[1])
    const m = match[2] ? parseInt(match[2]) : 0
    if (match[3].toUpperCase() === "PM" && h !== 12) h += 12
    if (match[3].toUpperCase() === "AM" && h === 12) h = 0
    const [year, mo, day] = dateIso.split("-").map(Number)
    // Seed: treat h:m as UTC, then check what pmTimezone reads it as
    const seed = new Date(Date.UTC(year, mo - 1, day, h, m))
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: pmTimezone,
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(seed)
    const pmH = parseInt(parts.find((p) => p.type === "hour")!.value)
    const pmM = parseInt(parts.find((p) => p.type === "minute")!.value)
    // Shift seed so that pmTimezone reads the target h:m, giving us the correct UTC
    const utcDate = new Date(seed.getTime() + ((h - pmH) * 60 + (m - pmM)) * 60_000)
    return utcDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
  } catch {
    return pmSlot
  }
}
function planDisplayStatus(plan: MemberPlan): string {
  if (plan.status === "Active" && plan.expiresAt && new Date(plan.expiresAt) < new Date()) return "Inactive"
  return plan.status
}
function planSessionType(planName: string): string {
  if (planName.includes("30")) return "private-30"
  if (planName.includes("45")) return "private-45"
  if (planName.includes("60")) return "private-60"
  return "private-60"
}

function CoachStep({ coaches, onSelect }: { coaches: Coach[]; onSelect: (c: Coach) => void }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return coaches
    return coaches.filter((c) => c.name.toLowerCase().includes(q) || (c.university ?? "").toLowerCase().includes(q))
  }, [coaches, query])

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchRow}>
        <TextInput style={styles.searchInput} placeholder="Search by name or university…" placeholderTextColor={COLORS.textMuted} value={query} onChangeText={setQuery} autoCorrect={false} />
      </View>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xl }} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.emptyBox}>
            <Users size={32} color={COLORS.textMuted} />
            <Text style={styles.emptyTitle}>No PrepMasters found</Text>
          </View>
        ) : (
          filtered.map((coach) => {
            const uniColors = coach.university ? getUniversityColor(coach.university) : null
            return (
              <TouchableOpacity key={coach.id} style={styles.coachCard} onPress={() => onSelect(coach)} activeOpacity={0.7}>
                <View style={styles.coachAvatar}>
                  <Text style={styles.coachAvatarText}>{coach.name.trim().split(/\s+/).filter(Boolean).map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.coachName}>{coach.name}</Text>
                  {coach.university ? (
                    <View style={[styles.uniChip, uniColors ? { backgroundColor: uniColors.bg } : {}]}>
                      <Text style={[styles.uniChipText, uniColors ? { color: uniColors.text } : {}]}>{coach.university}</Text>
                    </View>
                  ) : null}
                </View>
                {!coach.hasAvailability ? (
                  <View style={styles.unavailBadge}><Text style={styles.unavailText}>No availability</Text></View>
                ) : <ChevronRight size={18} color={COLORS.textMuted} />}
              </TouchableOpacity>
            )
          })
        )}
      </ScrollView>
    </View>
  )
}

function BookingStep({
  detail, plans, credits, onBack, onConfirm, confirming,
}: {
  detail: CoachDetail; plans: MemberPlan[]; credits: number; onBack: () => void
  onConfirm: (args: { date: string; time: string; notes: string; planId?: string; planSessions?: number; sessionType?: string }) => void
  confirming: boolean
}) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [selectedDuration, setSelectedDuration] = useState<"private-30" | "private-45" | "private-60" | "private-90" | null>(null)
  const activePlans = useMemo(() => plans.filter((p) => planDisplayStatus(p) === "Active"), [plans])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(activePlans.length === 1 ? activePlans[0].id : null)
  const showPlanPicker = activePlans.length > 1
  const effectivePlan = activePlans.find((p) => p.id === selectedPlanId) ?? (activePlans.length === 1 ? activePlans[0] : null)

  // A single-session credit (e.g. "Single 30min") can only pay for that exact
  // length — lock the session length to match it so the two can never get out
  // of sync. Mirrors the web booking flow's lockedDuration behavior.
  const lockedDuration = useMemo<"private-30" | "private-45" | "private-60" | "private-90" | null>(() => {
    if (!effectivePlan) return null
    const st = planSessionType(effectivePlan.planName) as "private-30" | "private-45" | "private-60" | "private-90"
    if (st === "private-60") return null
    return st
  }, [effectivePlan])
  const activeDuration = lockedDuration ?? selectedDuration

  const CREDIT_COST: Record<string, number> = { "private-30": 0.5, "private-45": 0.75, "private-60": 1, "private-90": 1.5 }
  const creditCost = activeDuration ? (CREDIT_COST[activeDuration] ?? 1) : 1

  const DURATIONS: { value: "private-30" | "private-45" | "private-60" | "private-90"; label: string }[] = [
    { value: "private-30", label: "30 min" },
    { value: "private-45", label: "45 min" },
    { value: "private-60", label: "60 min" },
    { value: "private-90", label: "90 min" },
  ]

  const currentSunday = useMemo(() => { const s = weekStart(today); s.setDate(s.getDate() + weekOffset * 7); return s }, [today, weekOffset])
  const weekDays = useMemo(() => buildWeekDays(currentSunday), [currentSunday])
  const weekLabel = useMemo(() => {
    const start = weekDays[0]; const end = weekDays[6]
    const sameMonth = start.getMonth() === end.getMonth()
    if (sameMonth) return `${start.toLocaleDateString("en-US", { month: "long" })} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
  }, [weekDays])

  const weekSlots = useMemo(() => {
    const now = new Date()
    const nowMs = now.getTime()
    const todayIso = toIso(now)
    const pmTimezone = detail.pmTimezone ?? "America/New_York"
    return weekDays.map((d) => {
      const iso = toIso(d); const isPast = d < today
      let pmSlots = isPast ? [] : slotsForDate(iso, detail.week)
      if (!isPast && iso === todayIso) {
        // Filter past slots using UTC comparison — correct regardless of dancer timezone
        pmSlots = pmSlots.filter((slot) => {
          const local = pmSlotToLocal(iso, slot, pmTimezone)
          // Reconstruct the UTC ms for this slot so we can compare to now
          try {
            const match = slot.match(/(\d+)(?::(\d+))?\s*(AM|PM)/i)
            if (!match) return false
            let h = parseInt(match[1]); const m = match[2] ? parseInt(match[2]) : 0
            if (match[3].toUpperCase() === "PM" && h !== 12) h += 12
            if (match[3].toUpperCase() === "AM" && h === 12) h = 0
            const [year, mo, day] = iso.split("-").map(Number)
            const seed = new Date(Date.UTC(year, mo - 1, day, h, m))
            const parts = new Intl.DateTimeFormat("en-US", { timeZone: pmTimezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(seed)
            const pmH = parseInt(parts.find((p) => p.type === "hour")!.value)
            const pmM = parseInt(parts.find((p) => p.type === "minute")!.value)
            const slotUtcMs = seed.getTime() + ((h - pmH) * 60 + (m - pmM)) * 60_000
            return slotUtcMs > nowMs
          } catch { return true }
        })
      }
      const taken = new Set(detail.bookedSlots[iso] ?? [])
      // Build local-display labels and a reverse map back to PM-timezone slot strings
      const localLabels = pmSlots.map((s) => pmSlotToLocal(iso, s, pmTimezone))
      const localToPmSlot = new Map(localLabels.map((l, i) => [l, pmSlots[i]]))
      return { date: d, iso, pmSlots, localLabels, localToPmSlot, taken, isPast }
    })
  }, [weekDays, detail.week, detail.bookedSlots, detail.pmTimezone, today])

  const noStructuredCredits = activePlans.length === 0 && credits > 0
  const canConfirm = selectedDate && selectedTime && activeDuration && (effectivePlan || noStructuredCredits) && !confirming

  function handleConfirm() {
    if (!selectedDate || !selectedTime || !activeDuration) return
    onConfirm({ date: selectedDate, time: selectedTime, notes, planId: effectivePlan?.id, planSessions: effectivePlan?.sessions, sessionType: activeDuration })
  }

  const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
  const tzAbbr = useMemo(() => getTZAbbr(), [])
  const selectedDaySlots = useMemo(() => weekSlots.find((w) => w.iso === selectedDate) ?? null, [weekSlots, selectedDate])

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.bookingScroll} showsVerticalScrollIndicator={false}>
        {showPlanPicker && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>1. Choose your credit</Text>
            <View style={{ gap: SPACING.xs }}>
              {activePlans.map((plan) => {
                const active = selectedPlanId === plan.id
                const activeSingleCount = activePlans.filter((p) => p.sessions === 1).length
                const displayCount = plan.sessions === 1 ? 1 : Math.max(0, credits - activeSingleCount)
                return (
                  <TouchableOpacity key={plan.id} style={[styles.planOption, active && styles.planOptionActive]} onPress={() => setSelectedPlanId(plan.id)} activeOpacity={0.7}>
                    <Text style={[styles.planOptionName, active && { color: COLORS.primary }]}>{plan.planName}</Text>
                    <Text style={styles.planOptionSub}>{displayCount} {displayCount === 1 ? "credit" : "credits"} remaining</Text>
                    {active && <Check size={16} color={COLORS.primary} style={{ marginLeft: "auto" }} />}
                  </TouchableOpacity>
                )
              })}
            </View>
          </View>
        )}
        {noStructuredCredits && (
          <View style={styles.creditBanner}>
            <Text style={styles.creditBannerText}>You have <Text style={{ fontWeight: "700" }}>{credits}</Text> {credits === 1 ? "credit" : "credits"}. This booking uses <Text style={{ fontWeight: "700" }}>{creditCost}</Text> {creditCost === 1 ? "credit" : "credits"}.</Text>
          </View>
        )}
        {!showPlanPicker && !noStructuredCredits && effectivePlan && (
          <View style={styles.creditBanner}>
            <Text style={styles.creditBannerText}>Using <Text style={{ fontWeight: "700" }}>{effectivePlan.planName}</Text>. This booking uses <Text style={{ fontWeight: "700" }}>{creditCost}</Text> {creditCost === 1 ? "credit" : "credits"}.</Text>
          </View>
        )}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{showPlanPicker ? "2" : "1"}. Pick a date &amp; time</Text>
          <View style={styles.weekNav}>
            <TouchableOpacity style={[styles.weekNavBtn, weekOffset === 0 && { opacity: 0.3 }]} onPress={() => setWeekOffset((w) => w - 1)} disabled={weekOffset === 0}>
              <ChevronLeft size={18} color={COLORS.text} />
            </TouchableOpacity>
            <Text style={styles.weekLabel}>{weekLabel}</Text>
            <TouchableOpacity style={styles.weekNavBtn} onPress={() => setWeekOffset((w) => w + 1)}>
              <ChevronRight size={18} color={COLORS.text} />
            </TouchableOpacity>
          </View>
          {/* Date strip */}
          <View style={styles.dateStrip}>
            {weekSlots.map(({ date, iso, localLabels, isPast }) => {
              const isSelected = selectedDate === iso
              const hasSlots = localLabels.length > 0 && !isPast
              return (
                <TouchableOpacity
                  key={iso}
                  style={[styles.datePill, isSelected && styles.datePillSelected, !hasSlots && styles.datePillDisabled]}
                  onPress={() => { if (hasSlots) { setSelectedDate(iso); setSelectedTime(null) } }}
                  disabled={!hasSlots}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.datePillDay, isSelected && { color: "#fff" }, !hasSlots && { color: COLORS.textMuted }]}>{DAY_LABELS[date.getDay()]}</Text>
                  <Text style={[styles.datePillNum, isSelected && { color: "#fff" }, !hasSlots && { color: COLORS.textMuted }]}>{date.getDate()}</Text>
                  {hasSlots && !isSelected && <View style={styles.datePillDot} />}
                </TouchableOpacity>
              )
            })}
          </View>
          {/* Time slots for selected date */}
          {selectedDate && selectedDaySlots ? (
            <View style={styles.timeSection}>
              <Text style={styles.timeSectionLabel}>
                {new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                {tzAbbr ? <Text style={styles.tzLabel}> · {tzAbbr}</Text> : null}
              </Text>
              {selectedDaySlots.localLabels.length === 0 ? (
                <Text style={[styles.noDateText, { marginTop: SPACING.sm }]}>No available times this day.</Text>
              ) : (
                <>
                  <Text style={styles.tzNote}>
                    Times shown in your local timezone{tzAbbr ? ` (${tzAbbr})` : ""}.
                    {detail.pmTimezone ? " Your PrepMaster may be in a different timezone." : ""}
                  </Text>
                  <TimeWheelPicker
                    slots={selectedDaySlots.localLabels.filter((label) => {
                      const pmSlot = selectedDaySlots.localToPmSlot.get(label) ?? label
                      return !selectedDaySlots.taken.has(pmSlot)
                    })}
                    value={selectedTime
                      ? (Array.from(selectedDaySlots.localToPmSlot.entries()).find(([, pm]) => pm === selectedTime)?.[0] ?? selectedTime)
                      : null}
                    onChange={(localLabel) => {
                      const pmSlot = selectedDaySlots.localToPmSlot.get(localLabel) ?? localLabel
                      setSelectedTime(pmSlot)
                    }}
                  />
                </>
              )}
            </View>
          ) : (
            <View style={styles.noDateSelected}>
              <Text style={styles.noDateText}>Select a date above to see available times.</Text>
            </View>
          )}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{showPlanPicker ? "3" : "2"}. Session length</Text>
          {lockedDuration && (
            <Text style={styles.lockedDurationNote}>
              Locked to {DURATIONS.find((d) => d.value === lockedDuration)?.label} to match your selected credit.
            </Text>
          )}
          <View style={{ flexDirection: "row", gap: SPACING.sm }}>
            {DURATIONS.map((d) => (
              <TouchableOpacity
                key={d.value}
                style={[styles.durationBtn, activeDuration === d.value && styles.durationBtnActive, lockedDuration && d.value !== lockedDuration && styles.durationBtnDisabled]}
                onPress={() => { if (!lockedDuration) setSelectedDuration(d.value) }}
                disabled={!!lockedDuration}
                activeOpacity={lockedDuration ? 1 : 0.7}
              >
                <Text style={[styles.durationBtnText, activeDuration === d.value && { color: COLORS.primary }]}>{d.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{showPlanPicker ? "4" : "3"}. Anything we should know?</Text>
          <TextInput style={styles.notesInput} placeholder="Goals for the session, focus areas, choreography you're working on…" placeholderTextColor={COLORS.textMuted} value={notes} onChangeText={setNotes} multiline numberOfLines={3} textAlignVertical="top" />
        </View>
        <View style={styles.confirmBar}>
          {selectedDate && selectedTime ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.confirmDate}>{new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · {selectedDaySlots ? (Array.from(selectedDaySlots.localToPmSlot.entries()).find(([, pm]) => pm === selectedTime)?.[0] ?? selectedTime) : selectedTime}{activeDuration ? ` · ${DURATIONS.find((d) => d.value === activeDuration)?.label}` : ""}</Text>
              <Text style={styles.confirmWith}>with {detail.coach.name}</Text>
            </View>
          ) : <Text style={[styles.confirmWith, { flex: 1 }]}>Select a date, time, and length to continue.</Text>}
          <TouchableOpacity style={[styles.confirmBtn, !canConfirm && { opacity: 0.4 }]} onPress={handleConfirm} disabled={!canConfirm} activeOpacity={0.8}>
            {confirming ? <ActivityIndicator size="small" color="#fff" /> : <><Check size={16} color="#fff" /><Text style={styles.confirmBtnText}>Confirm</Text></>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

type Step = "coaches" | "booking"

export default function BookScreen() {
  const router = useRouter()
  const { data: session } = useSession()
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [step, setStep] = useState<Step>("coaches")
  const [coaches, setCoaches] = useState<Coach[]>([])
  const [coachesLoading, setCoachesLoading] = useState(true)
  const [selectedCoach, setSelectedCoach] = useState<Coach | null>(null)
  const [detail, setDetail] = useState<CoachDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [plans, setPlans] = useState<MemberPlan[]>([])
  const [credits, setCredits] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [isParentView, setIsParentView] = useState(false)
  const [childFirstName, setChildFirstName] = useState("")

  const loadCoaches = useCallback(async () => {
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/booking/coaches`)
      if (error || !data) throw new Error("Failed to load coaches")
      setCoaches((data as { coaches: Coach[] }).coaches)
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not load PrepMasters.") }
    finally { setCoachesLoading(false) }
  }, [])

  const loadDashboard = useCallback(async () => {
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/member/dashboard`)
      if (error || !data) return
      const d = data as { profile: { creditsRemaining: number; isParentView?: boolean; name?: string }; plans: MemberPlan[] }
      setCredits(d.profile.creditsRemaining)
      setPlans(d.plans)
      setIsParentView(d.profile.isParentView ?? false)
      setChildFirstName((d.profile.isParentView && d.profile.name) ? d.profile.name.split(" ")[0] : "")
    } catch {}
  }, [])

  useEffect(() => { loadCoaches(); loadDashboard() }, [loadCoaches, loadDashboard])

  const handleSelectCoach = useCallback(async (coach: Coach) => {
    const activePlans = plans.filter((p) => planDisplayStatus(p) === "Active")
    if (activePlans.length === 0 && credits < 1) {
      Alert.alert("No credits", "You need at least 1 credit to book a session.", [
        { text: "View Plans", onPress: () => router.push("/member/plans" as any) },
        { text: "Cancel", style: "cancel" },
      ])
      return
    }
    setSelectedCoach(coach); setDetailLoading(true)
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/booking/coaches/${coach.id}`)
      if (error || !data) throw new Error((data as any)?.error ?? "Failed to load availability")
      setDetail(data as CoachDetail); setStep("booking")
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not load availability.") }
    finally { setDetailLoading(false) }
  }, [plans, credits, router])

  const CREDIT_COST: Record<string, number> = {
    "pack-hour": 1, "private-60": 1, "private-45": 0.75, "private-30": 0.5, "private-90": 1.5,
  }

  const handleConfirm = useCallback(async (args: {
    date: string; time: string; notes: string; planId?: string; planSessions?: number; sessionType?: string
  }) => {
    if (!selectedCoach) return
    const creditCost = CREDIT_COST[args.sessionType ?? "private-60"] ?? 1
    setConfirming(true)
    try {
      const utcDatetime = toUtcDatetime(args.date, args.time)
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/booking/create`, {
        method: "POST",
        body: JSON.stringify({ prepMasterId: selectedCoach.id, prepMasterName: selectedCoach.name, date: args.date, time: args.time, utcDatetime: utcDatetime || undefined, notes: args.notes, planId: args.planId, planSessions: args.planSessions, sessionType: args.sessionType }),
        headers: { "Content-Type": "application/json" },
      })
      if (error) throw new Error((error as any)?.message ?? "Failed to book")
      const result = data as { ok: boolean; id?: string; error?: string; creditCost?: number; newCredits?: number }
      if (!result.ok) {
        if (result.error === "NO_CREDITS") {
          Alert.alert("No credits", "Purchase a package to book a session.", [{ text: "View Plans", onPress: () => router.push("/member/plans" as any) }, { text: "Cancel", style: "cancel" }])
        } else { Alert.alert("Could not book", result.error ?? "Please try again.") }
        return
      }
      // Instantly update displayed credit count
      const used = result.creditCost ?? creditCost
      setCredits((prev) => Math.round((prev - used) * 100) / 100)
      const creditLabel = used === 1 ? "1 credit" : `${used} credits`
      Alert.alert("Session requested!", `Your request with ${selectedCoach.name} on ${args.date} at ${args.time} has been sent. ${creditLabel} used.`, [{ text: "Done", onPress: () => router.back() }])
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not create booking.") }
    finally { setConfirming(false) }
  }, [selectedCoach, credits, router])

  const title = step === "coaches" ? "Choose a PrepMaster" : selectedCoach?.name ?? "Book a Session"

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => { if (step === "booking") { setStep("coaches"); setDetail(null) } else router.back() }}>
          <ChevronLeft size={22} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 36 }} />
      </View>
      {isParentView && childFirstName ? (
        <View style={styles.parentBanner}>
          <Users size={14} color={COLORS.primary} />
          <Text style={styles.parentBannerText}>Booking for {childFirstName}</Text>
        </View>
      ) : null}
      {coachesLoading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : step === "coaches" ? (
        <>
          {detailLoading && <View style={styles.loadingOverlay}><ActivityIndicator size="large" color={COLORS.primary} /></View>}
          <CoachStep coaches={coaches} onSelect={handleSelectCoach} />
        </>
      ) : detail ? (
        <BookingStep detail={detail} plans={plans} credits={credits} onBack={() => { setStep("coaches"); setDetail(null) }} onConfirm={handleConfirm} confirming={confirming} />
      ) : null}
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
    backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
    headerTitle: { fontSize: 17, fontWeight: "700", color: COLORS.text, flex: 1, textAlign: "center" },
    loadingOverlay: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.15)", justifyContent: "center", alignItems: "center", zIndex: 10 },
    parentBanner: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.primaryLight, paddingHorizontal: SPACING.md, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
    parentBannerText: { fontSize: 13, fontWeight: "600", color: COLORS.primary },
    searchRow: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border },
    searchInput: { backgroundColor: COLORS.surface, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.md, paddingVertical: 9, fontSize: 14, color: COLORS.text },
    coachCard: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
    coachAvatar: { width: 44, height: 44, borderRadius: RADIUS.full, backgroundColor: COLORS.primaryLight, alignItems: "center", justifyContent: "center" },
    coachAvatarText: { fontSize: 16, fontWeight: "700", color: COLORS.primary },
    coachName: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    uniChip: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full, backgroundColor: COLORS.grayLight },
    uniChipText: { fontSize: 11, fontWeight: "600", color: COLORS.textMuted },
    unavailBadge: { backgroundColor: COLORS.grayLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
    unavailText: { fontSize: 11, color: COLORS.textMuted, fontWeight: "600" },
    emptyBox: { alignItems: "center", gap: SPACING.sm, paddingTop: SPACING.xl },
    emptyTitle: { fontSize: 15, fontWeight: "600", color: COLORS.textMuted },
    bookingScroll: { padding: SPACING.md, gap: SPACING.lg, paddingBottom: 120 },
    section: { gap: SPACING.sm },
    sectionLabel: { fontSize: 15, fontWeight: "700", color: COLORS.text },
    planOption: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm, backgroundColor: COLORS.surface },
    planOptionActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
    planOptionName: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    planOptionSub: { fontSize: 12, color: COLORS.textMuted },
    creditBanner: { backgroundColor: COLORS.primaryLight, borderRadius: RADIUS.sm, padding: SPACING.sm },
    creditBannerText: { fontSize: 13, color: COLORS.primary },
    weekNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    weekNavBtn: { width: 32, height: 32, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface },
    weekLabel: { fontSize: 13, fontWeight: "600", color: COLORS.textMuted },
    dateStrip: { flexDirection: "row", gap: 6 },
    datePill: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, gap: 2 },
    datePillSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
    datePillDisabled: { opacity: 0.4 },
    datePillDay: { fontSize: 10, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase" },
    datePillNum: { fontSize: 16, fontWeight: "700", color: COLORS.text },
    datePillDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.primary, marginTop: 1 },
    timeSection: { gap: SPACING.sm, marginTop: SPACING.xs },
    timeSectionLabel: { fontSize: 13, fontWeight: "600", color: COLORS.textSecondary },
    tzLabel: { fontSize: 12, fontWeight: "400", color: COLORS.textMuted },
    tzNote: { fontSize: 11, color: COLORS.textMuted, fontStyle: "italic", marginTop: 4, marginBottom: 2, textAlign: "center" },
    timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    timeBtn: { width: "30%", alignItems: "center", paddingVertical: 11, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
    timeBtnSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
    timeBtnTaken: { opacity: 0.35 },
    timeBtnText: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    noDateSelected: { paddingVertical: SPACING.lg, alignItems: "center" },
    noDateText: { fontSize: 13, color: COLORS.textMuted },
    notesInput: { backgroundColor: COLORS.surface, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.sm, fontSize: 14, color: COLORS.text, minHeight: 80 },
    confirmBar: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
    confirmDate: { fontSize: 14, fontWeight: "600", color: COLORS.text },
    confirmWith: { fontSize: 12, color: COLORS.textMuted },
    confirmBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: RADIUS.full },
    confirmBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },
    durationBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
    durationBtnActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
    durationBtnDisabled: { opacity: 0.4 },
    durationBtnText: { fontSize: 14, fontWeight: "700", color: COLORS.text },
    lockedDurationNote: { fontSize: 12, color: COLORS.textMuted, marginTop: -4, marginBottom: 2 },
  })
}
