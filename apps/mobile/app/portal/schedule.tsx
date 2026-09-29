import { useEffect, useState, useCallback, useMemo } from "react"
import { API_BASE } from "@/lib/config"
import {
  View, Text, StyleSheet, ScrollView, Switch, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Check, ChevronDown, ChevronLeft, ChevronRight, CalendarPlus } from "lucide-react-native"
import { authClient } from "@/lib/auth-client"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"
import { TimeWheelPicker, generate15MinSlots } from "@/components/TimeWheelPicker"

type Client = { userId: string; name: string; email: string }

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}


const WEEKDAYS = [
  { value: 0, label: "Sunday" }, { value: 1, label: "Monday" }, { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" }, { value: 4, label: "Thursday" }, { value: 5, label: "Friday" }, { value: 6, label: "Saturday" },
]

type DayAvailability = { dayOfWeek: number; enabled: boolean; startTime: string; endTime: string }

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

function TimePickerRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const COLORS = useColors()
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`)
  const [open, setOpen] = useState(false)
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{label}</Text>
      <TouchableOpacity style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 8, backgroundColor: COLORS.background }} onPress={() => setOpen((v) => !v)} activeOpacity={0.8}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text }}>{to12Hour(value)}</Text>
      </TouchableOpacity>
      {open && (
        <View style={{ position: "absolute", top: 56, left: 0, right: 0, zIndex: 100, backgroundColor: COLORS.surface, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, elevation: 8 }}>
          <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
            {hours.map((h) => (
              <TouchableOpacity key={h} style={{ paddingHorizontal: SPACING.md, paddingVertical: 10, backgroundColor: h === value ? COLORS.primaryLight : undefined }} onPress={() => { onChange(h); setOpen(false) }} activeOpacity={0.7}>
                <Text style={{ fontSize: 14, color: h === value ? COLORS.primary : COLORS.text, fontWeight: h === value ? "700" : "400" }}>{to12Hour(h)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

export default function PortalScheduleScreen() {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [week, setWeek] = useState<DayAvailability[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [availExpanded, setAvailExpanded] = useState(false)
  const [showBook, setShowBook] = useState(false)
  const [clients, setClients] = useState<Client[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [selectedDate, setSelectedDate] = useState(toIso(new Date()))
  const [selectedTime, setSelectedTime] = useState("")
  const [selectedDuration, setSelectedDuration] = useState<"private-30" | "private-45" | "private-60" | "private-90">("private-60")
  const [bookNotes, setBookNotes] = useState("")
  const [booking, setBooking] = useState(false)
  const [calBusy, setCalBusy] = useState<Record<string, string[]>>({})
  const [weekOffset, setWeekOffset] = useState(0)

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() + weekOffset * 7 + i); return d
    })
  }, [weekOffset])

  const weekLabel = useMemo(() => {
    const start = weekDays[0]; const end = weekDays[6]
    const sameMonth = start.getMonth() === end.getMonth()
    if (sameMonth) return `${start.toLocaleDateString("en-US", { month: "long" })} ${start.getDate()}–${end.getDate()}`
    return `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
  }, [weekDays])

  useEffect(() => {
    const visible = new Set(weekDays.map(toIso))
    if (!visible.has(selectedDate)) { setSelectedDate(toIso(weekDays[0])); setSelectedTime("") }
  }, [weekOffset])

  const load = useCallback(async () => {
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/portal/availability`)
      if (error || !data) throw new Error("Failed to load")
      const d = data as { week: DayAvailability[]; calBusy?: Record<string, string[]> }
      setWeek(d.week)
      setCalBusy(d.calBusy ?? {})
    } catch { Alert.alert("Error", "Could not load availability.") }
  }, [])

  const loadClients = useCallback(async () => {
    setClientsLoading(true)
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/portal/book`)
      if (error || !data) throw new Error("Failed")
      setClients((data as { clients: Client[] }).clients)
    } catch { Alert.alert("Error", "Could not load past clients.") }
    finally { setClientsLoading(false) }
  }, [])

  function openBooking() { if (!showBook) { setShowBook(true); loadClients() } else { setShowBook(false) } }

  const CREDIT_COST: Record<string, number> = { "private-30": 0.5, "private-45": 0.75, "private-60": 1, "private-90": 1.5 }
  const DURATION_OPTIONS = [
    { value: "private-30" as const, label: "30 min", credits: "0.5 credits" },
    { value: "private-45" as const, label: "45 min", credits: "0.75 credits" },
    { value: "private-60" as const, label: "60 min", credits: "1 credit" },
    { value: "private-90" as const, label: "90 min", credits: "1.5 credits" },
  ]

  async function handleBook() {
    if (!selectedClient || !selectedDate || !selectedTime) { Alert.alert("Missing fields", "Please select a client, date, and time."); return }
    setBooking(true)
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/portal/book`, {
        method: "POST",
        body: JSON.stringify({ dancerEmail: selectedClient.email, date: selectedDate, time: selectedTime, notes: bookNotes, sessionType: selectedDuration }),
        headers: { "Content-Type": "application/json" },
      })
      if (error) throw new Error((error as any)?.message ?? "Failed")
      const res = data as { ok: boolean; error?: string }
      if (!res.ok) throw new Error(res.error ?? "Failed")
      const creditUsed = CREDIT_COST[selectedDuration]
      Alert.alert("Booked!", `Session with ${selectedClient.name} on ${selectedDate} at ${selectedTime} has been created. ${creditUsed} credit${creditUsed === 1 ? "" : "s"} deducted.`)
      setShowBook(false); setSelectedClient(null); setSelectedTime(""); setBookNotes(""); setSelectedDuration("private-60")
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not create booking.") }
    finally { setBooking(false) }
  }

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  function updateDay(dayOfWeek: number, patch: Partial<DayAvailability>) {
    setWeek((prev) => prev.map((d) => d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d))
  }

  async function handleSave() {
    const invalid = week.find((d) => d.enabled && d.endTime <= d.startTime)
    if (invalid) {
      const label = WEEKDAYS.find((w) => w.value === invalid.dayOfWeek)?.label
      Alert.alert("Invalid time range", `${label}'s end time must be after its start time.`)
      return
    }
    setSaving(true)
    try {
      const { data, error } = await authClient.$fetch(`${API_BASE}/api/portal/availability`, {
        method: "POST", body: JSON.stringify({ week }), headers: { "Content-Type": "application/json" },
      })
      if (error) throw new Error((error as any)?.message ?? "Failed")
      const res = data as { ok: boolean; error?: string }
      if (!res.ok) throw new Error(res.error ?? "Failed")
      Alert.alert("Saved", "Dancers can now book within these hours.")
    } catch (e) { Alert.alert("Error", e instanceof Error ? e.message : "Could not save availability.") }
    finally { setSaving(false) }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Schedule</Text>
          <Text style={styles.pageSub}>Your calendar and booking availability.</Text>
        </View>

        {/* Book a session */}
        <TouchableOpacity style={styles.bookCard} onPress={openBooking} activeOpacity={0.7}>
          <CalendarPlus size={18} color={COLORS.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bookCardTitle}>Schedule for a past client</Text>
            <Text style={styles.bookCardSub}>Create a confirmed session with a member you've previously worked with.</Text>
          </View>
          <View style={{ transform: [{ rotate: showBook ? "180deg" : "0deg" }] }}>
            <ChevronDown size={18} color={COLORS.textMuted} />
          </View>
        </TouchableOpacity>
        {showBook && (
          <View style={styles.bookForm}>
            <Text style={styles.bookFormTitle}>New session</Text>
            <Text style={styles.fieldLabel}>Client</Text>
            {clientsLoading ? <ActivityIndicator size="small" color={COLORS.primary} /> : clients.length === 0 ? (
              <Text style={styles.emptyText}>No past clients found.</Text>
            ) : (
              <View style={styles.chipWrap}>
                {clients.map((c) => (
                  <TouchableOpacity key={c.userId} style={[styles.chip, selectedClient?.userId === c.userId && styles.chipSelected]} onPress={() => setSelectedClient(c)} activeOpacity={0.7}>
                    <Text style={[styles.chipText, selectedClient?.userId === c.userId && { color: COLORS.primary }]}>{c.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <Text style={styles.fieldLabel}>Date</Text>
            <View style={styles.weekNav}>
              <TouchableOpacity style={[styles.weekNavBtn, weekOffset === 0 && { opacity: 0.3 }]} onPress={() => setWeekOffset((w) => w - 1)} disabled={weekOffset === 0} activeOpacity={0.7}>
                <ChevronLeft size={16} color={COLORS.text} />
              </TouchableOpacity>
              <Text style={styles.weekLabel}>{weekLabel}</Text>
              <TouchableOpacity style={styles.weekNavBtn} onPress={() => setWeekOffset((w) => w + 1)} activeOpacity={0.7}>
                <ChevronRight size={16} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <View style={styles.dateRow}>
              {weekDays.map((d) => {
                const iso = toIso(d)
                const isSelected = selectedDate === iso
                const isPast = d < new Date(new Date().toDateString())
                return (
                  <TouchableOpacity key={iso} style={[styles.dateChip, isSelected && styles.dateChipSelected, isPast && { opacity: 0.35 }]} onPress={() => { if (!isPast) { setSelectedDate(iso); setSelectedTime("") } }} disabled={isPast} activeOpacity={0.7}>
                    <Text style={[styles.dateChipDay, isSelected && { color: COLORS.primary }]}>{d.toLocaleDateString("en-US", { weekday: "short" })}</Text>
                    <Text style={[styles.dateChipNum, isSelected && { color: COLORS.primary }]}>{d.getDate()}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
            <Text style={styles.fieldLabel}>Time</Text>
            {(() => {
              const slots = slotsForDate(selectedDate, week).filter((t) => {
                const isToday = selectedDate === toIso(new Date())
                if (isToday) {
                  const [timePart, period] = t.split(" ")
                  let h = Number(timePart.split(":")[0])
                  if (period === "PM" && h !== 12) h += 12
                  else if (period === "AM" && h === 12) h = 0
                  if (h <= new Date().getHours()) return false
                }
                return !(calBusy[selectedDate] ?? []).includes(t)
              })
              if (slots.length === 0) return <Text style={styles.emptyText}>No available times for this day.</Text>
              const value = selectedTime && slots.includes(selectedTime) ? selectedTime : slots[0]
              if (value !== selectedTime) setSelectedTime(value)
              return <TimeWheelPicker slots={slots} value={value} onChange={setSelectedTime} />
            })()}
            <Text style={styles.fieldLabel}>Session Length</Text>
            <View style={styles.chipWrap}>
              {DURATION_OPTIONS.map((d) => (
                <TouchableOpacity key={d.value} style={[styles.chip, selectedDuration === d.value && styles.chipSelected]} onPress={() => setSelectedDuration(d.value)} activeOpacity={0.7}>
                  <Text style={[styles.chipText, selectedDuration === d.value && { color: COLORS.primary }]}>{d.label}</Text>
                  <Text style={{ fontSize: 10, color: selectedDuration === d.value ? COLORS.primary : COLORS.textMuted, marginTop: 1 }}>{d.credits}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.bookActions}>
              <TouchableOpacity style={[styles.bookBtn, booking && { opacity: 0.6 }]} onPress={handleBook} disabled={booking} activeOpacity={0.8}>
                {booking ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.bookBtnText}>Confirm booking</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBookBtn} onPress={() => setShowBook(false)} activeOpacity={0.8}>
                <Text style={styles.cancelBookBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Collapsible availability */}
        <View style={styles.card}>
          <TouchableOpacity style={styles.collapseHeader} onPress={() => setAvailExpanded((v) => !v)} activeOpacity={0.7}>
            <Text style={styles.collapseTitle}>Edit Booking Availability</Text>
            <View style={{ transform: [{ rotate: availExpanded ? "180deg" : "0deg" }] }}>
              <ChevronDown size={18} color={COLORS.textMuted} />
            </View>
          </TouchableOpacity>
          {availExpanded && (
            <>
              {week.map((day, idx) => {
                const label = WEEKDAYS.find((w) => w.value === day.dayOfWeek)?.label ?? ""
                const isLast = idx === week.length - 1
                return (
                  <View key={day.dayOfWeek} style={[styles.dayRow, !isLast && styles.dayRowBorder]}>
                    <View style={styles.dayLeft}>
                      <Switch value={day.enabled} onValueChange={(v) => updateDay(day.dayOfWeek, { enabled: v })} trackColor={{ false: COLORS.border, true: COLORS.primary }} thumbColor="#fff" />
                      <Text style={[styles.dayLabel, !day.enabled && { color: COLORS.textMuted }]}>{label}</Text>
                    </View>
                    {day.enabled ? (
                      <View style={{ flexDirection: "row", gap: SPACING.sm, marginTop: 4 }}>
                        <TimePickerRow label="From" value={day.startTime} onChange={(v) => updateDay(day.dayOfWeek, { startTime: v })} />
                        <TimePickerRow label="To" value={day.endTime} onChange={(v) => updateDay(day.dayOfWeek, { endTime: v })} />
                      </View>
                    ) : (
                      <Text style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>Unavailable</Text>
                    )}
                  </View>
                )
              })}
              <View style={styles.saveRow}>
                <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving} activeOpacity={0.8}>
                  {saving ? <ActivityIndicator size="small" color="#fff" /> : <><Check size={16} color="#fff" /><Text style={styles.saveBtnText}>Save availability</Text></>}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    scroll: { padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xl },
    pageHeader: { gap: 4 },
    pageTitle: { fontSize: 26, fontWeight: "700", color: COLORS.text, fontFamily: "Sora_700Bold" },
    pageSub: { fontSize: 13, color: COLORS.textMuted },
    card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
    collapseHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: SPACING.md },
    collapseTitle: { fontSize: 15, fontWeight: "700", color: COLORS.text },
    dayRow: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, gap: SPACING.sm },
    dayRowBorder: { borderTopWidth: 1, borderTopColor: COLORS.border },
    dayLeft: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
    dayLabel: { fontSize: 15, fontWeight: "600", color: COLORS.text, width: 90 },
    saveRow: { padding: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border },
    saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingVertical: 12, paddingHorizontal: SPACING.md },
    saveBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
    bookCard: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
    bookCardTitle: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    bookCardSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
    bookForm: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.sm },
    bookFormTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text },
    fieldLabel: { fontSize: 11, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    emptyText: { fontSize: 13, color: COLORS.textMuted },
    chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
    chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background },
    chipSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
    chipText: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    weekNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
    weekNavBtn: { padding: 6 },
    weekLabel: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    dateRow: { flexDirection: "row", gap: 6 },
    dateChip: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background },
    dateChipSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
    dateChipDay: { fontSize: 9, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase" },
    dateChipNum: { fontSize: 16, fontWeight: "700", color: COLORS.text },
    bookActions: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.sm },
    bookBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingVertical: 12, alignItems: "center" },
    bookBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
    cancelBookBtn: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, paddingVertical: 12, paddingHorizontal: SPACING.md, alignItems: "center" },
    cancelBookBtnText: { fontSize: 15, fontWeight: "600", color: COLORS.textMuted },
  })
}
