import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { API_BASE } from "@/lib/config"
import {
  View, Text, FlatList, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity, Dimensions,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router"
import { Plus, ChevronRight, List, CalendarDays, ChevronLeft } from "lucide-react-native"
import { authClient } from "@/lib/auth-client"
import { SPACING, RADIUS } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"
import { BookingDetailModal, formatDate, formatTime, type Booking } from "@/components/BookingDetailModal"

const SCREEN_WIDTH = Dimensions.get("window").width
const HOUR_HEIGHT = 56
const START_HOUR = 6
const END_HOUR = 23
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => i + START_HOUR)
const TIME_LABEL_WIDTH = 52

type CalEvent = { id: string; title: string; start: string | null; end: string | null; allDay: boolean; location: string | null }
type CalFilter = "day" | "month"

function fmtSessionType(s: string | null | undefined): string {
  if (!s) return ""
  const map: Record<string, string> = { "private-60": "60 min", "private-45": "45 min", "private-30": "30 min", "pack-hour": "60 min" }
  return map[s] ?? s
}

function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function parseTime(iso: string): { hour: number; minute: number } {
  const d = new Date(iso)
  return { hour: d.getHours(), minute: d.getMinutes() }
}

function formatHour(h: number) {
  if (h === 0) return "12 AM"
  if (h === 12) return "12 PM"
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

function formatEventTime(iso: string | null): string {
  if (!iso || iso.length === 10) return "All day"
  const { hour, minute } = parseTime(iso)
  const period = hour >= 12 ? "PM" : "AM"
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return `${h}:${String(minute).padStart(2, "0")} ${period}`
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"]

function BookingCard({ booking, onPress }: { booking: Booking; onPress?: () => void }) {
  const COLORS = useColors()
  const s = booking.status.toLowerCase()
  const isPastConfirmed = s === "confirmed" && (
    booking.utcDatetime
      ? new Date(booking.utcDatetime) < new Date()
      : booking.date ? new Date(`${booking.date}T23:59:59`) < new Date() : false
  )
  const displayStatus = isPastConfirmed ? "completed" : s
  const sc = displayStatus === "confirmed" ? { bg: COLORS.primaryLight, text: COLORS.primary }
    : displayStatus === "completed" ? { bg: COLORS.grayLight, text: COLORS.textMuted }
    : s === "declined" ? { bg: COLORS.amberLight, text: COLORS.amber }
    : s.startsWith("cancelled") ? { bg: COLORS.redLight, text: COLORS.red }
    : { bg: COLORS.grayLight, text: COLORS.textMuted }
  const inner = (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text }}>{booking.prepMasterName || "PrepMaster"}</Text>
        <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>{formatDate(booking.date)}{booking.time ? ` · ${formatTime(booking.time, booking.utcDatetime)}` : ""}{booking.sessionType ? ` · ${fmtSessionType(booking.sessionType)}` : ""}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full, backgroundColor: sc.bg }}>
          <Text style={{ fontSize: 11, fontWeight: "600", textTransform: "capitalize", color: sc.text }}>{displayStatus}</Text>
        </View>
        {onPress && <ChevronRight size={14} color={COLORS.textMuted} />}
      </View>
    </View>
  )
  if (onPress) return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{inner}</TouchableOpacity>
  return inner
}

function SectionHeader({ title, count, expanded, onToggle }: { title: string; count: number; expanded: boolean; onToggle: () => void }) {
  const COLORS = useColors()
  return (
    <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: SPACING.sm }} onPress={onToggle} activeOpacity={0.7}>
      <Text style={{ fontSize: 13, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.8 }}>
        {title} ({count})
      </Text>
      <ChevronRight size={16} color={COLORS.textMuted} style={{ transform: [{ rotate: expanded ? "90deg" : "0deg" }] }} />
    </TouchableOpacity>
  )
}

// Hourly timeline view (used for Day and Week/selected-day)
function HourlyView({
  dateIso,
  calEvents,
  bookings,
  onBookingPress,
}: {
  dateIso: string
  calEvents: CalEvent[]
  bookings: Booking[]
  onBookingPress: (b: Booking) => void
}) {
  const COLORS = useColors()
  const scrollRef = useRef<ScrollView>(null)
  const now = new Date()
  const todayIso = toIso(now)
  const isToday = dateIso === todayIso
  const gridWidth = SCREEN_WIDTH - SPACING.md * 2 - TIME_LABEL_WIDTH
  const totalHeight = HOURS.length * HOUR_HEIGHT

  // Scroll to current time or 8 AM on mount
  useEffect(() => {
    const targetHour = isToday ? now.getHours() - 1 : 8
    const offset = Math.max(0, (targetHour - START_HOUR) * HOUR_HEIGHT - HOUR_HEIGHT)
    setTimeout(() => scrollRef.current?.scrollTo({ y: offset, animated: false }), 100)
  }, [dateIso])

  // Position events on the timeline
  type EventBlock = {
    key: string; top: number; height: number; title: string; subtitle: string | null
    isCDP: boolean; booking?: Booking; color: string
  }

  const blocks: EventBlock[] = useMemo(() => {
    const result: EventBlock[] = []
    for (const b of bookings) {
      if (!b.time && !b.utcDatetime) continue
      let hour: number, minute: number
      if (b.utcDatetime) {
        const d = new Date(b.utcDatetime)
        hour = d.getHours(); minute = d.getMinutes()
      } else {
        const [hStr, mStr] = b.time.replace(/(AM|PM)/i, "").trim().split(":")
        hour = parseInt(hStr, 10); minute = parseInt(mStr ?? "0", 10)
        if (b.time.toUpperCase().includes("PM") && hour !== 12) hour += 12
        if (b.time.toUpperCase().includes("AM") && hour === 12) hour = 0
      }
      const top = (hour - START_HOUR + minute / 60) * HOUR_HEIGHT
      result.push({ key: `b-${b.id}`, top, height: HOUR_HEIGHT, title: `Session w/ ${b.prepMasterName || "PrepMaster"}`, subtitle: b.sessionType ? fmtSessionType(b.sessionType) : null, isCDP: true, booking: b, color: COLORS.plum })
    }
    for (const e of calEvents) {
      if (!e.start || e.allDay) continue
      const { hour, minute } = parseTime(e.start)
      const top = (hour - START_HOUR + minute / 60) * HOUR_HEIGHT
      let height = HOUR_HEIGHT
      if (e.end) {
        const end = parseTime(e.end)
        height = Math.max(30, (end.hour - hour + (end.minute - minute) / 60) * HOUR_HEIGHT)
      }
      result.push({ key: `e-${e.id}`, top, height, title: e.title, subtitle: e.location, isCDP: false, color: COLORS.textMuted })
    }
    return result
  }, [bookings, calEvents, COLORS])

  const currentTimeTop = isToday ? (now.getHours() - START_HOUR + now.getMinutes() / 60) * HOUR_HEIGHT : null

  return (
    <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: SPACING.md, paddingBottom: 80 }}>
        <View style={{ flexDirection: "row" }}>
          {/* Hour labels */}
          <View style={{ width: TIME_LABEL_WIDTH }}>
            {HOURS.map((h) => (
              <View key={h} style={{ height: HOUR_HEIGHT, justifyContent: "flex-start", paddingTop: 2 }}>
                <Text style={{ fontSize: 11, color: COLORS.textMuted, textAlign: "right", paddingRight: 8 }}>{formatHour(h)}</Text>
              </View>
            ))}
          </View>

          {/* Grid + events */}
          <View style={{ flex: 1, position: "relative", height: totalHeight }}>
            {/* Hour lines */}
            {HOURS.map((h, i) => (
              <View key={h} style={{ position: "absolute", top: i * HOUR_HEIGHT, left: 0, right: 0, height: 1, backgroundColor: COLORS.border }} />
            ))}

            {/* Current time indicator */}
            {currentTimeTop !== null && currentTimeTop >= 0 && currentTimeTop <= totalHeight && (
              <View style={{ position: "absolute", top: currentTimeTop, left: 0, right: 0, flexDirection: "row", alignItems: "center", zIndex: 10 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.primary, marginLeft: -4 }} />
                <View style={{ flex: 1, height: 1.5, backgroundColor: COLORS.primary }} />
              </View>
            )}

            {/* Event blocks */}
            {blocks.map((block) => {
              const inner = (
                <View style={{
                  position: "absolute", top: block.top + 1, left: 2, right: 2,
                  height: block.height - 2, borderRadius: 5,
                  backgroundColor: block.isCDP ? COLORS.primaryLight : `${COLORS.textMuted}22`,
                  borderLeftWidth: 3, borderLeftColor: block.color,
                  padding: 4, overflow: "hidden",
                }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: block.isCDP ? COLORS.primary : COLORS.text }} numberOfLines={1}>{block.title}</Text>
                  {block.height > 36 && block.subtitle ? <Text style={{ fontSize: 10, color: COLORS.textMuted, marginTop: 1 }} numberOfLines={1}>{block.subtitle}</Text> : null}
                  {block.height > 36 ? <Text style={{ fontSize: 10, color: block.isCDP ? COLORS.primary : COLORS.textMuted, marginTop: 1 }}>{block.isCDP && block.booking ? formatTime(block.booking.time, block.booking.utcDatetime) : formatEventTime(calEvents.find(e => `e-${e.id}` === block.key)?.start ?? null)}</Text> : null}
                </View>
              )
              if (block.booking) {
                return <TouchableOpacity key={block.key} onPress={() => onBookingPress(block.booking!)} activeOpacity={0.8}>{inner}</TouchableOpacity>
              }
              return <View key={block.key}>{inner}</View>
            })}
          </View>
        </View>
      </View>
    </ScrollView>
  )
}

function CalendarView({
  events,
  upcomingBookings,
  refreshing,
  onRefresh,
  onBookingPress,
}: {
  events: CalEvent[]
  upcomingBookings: Booking[]
  refreshing: boolean
  onRefresh: () => void
  onBookingPress: (b: Booking) => void
}) {
  const COLORS = useColors()
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const todayIso = toIso(today)
  const [selectedDate, setSelectedDate] = useState(todayIso)
  const [viewMonth, setViewMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [filter, setFilter] = useState<CalFilter>("month")

  // Map ISO date → calendar events
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalEvent[]> = {}
    for (const e of events) {
      if (!e.start) continue
      const iso = e.start.length === 10 ? e.start : toIso(new Date(e.start))
      if (!map[iso]) map[iso] = []
      map[iso].push(e)
    }
    return map
  }, [events])

  // Map ISO date → upcoming bookings
  const bookingsByDate = useMemo(() => {
    const map: Record<string, Booking[]> = {}
    for (const b of upcomingBookings) {
      if (!b.date) continue
      if (!map[b.date]) map[b.date] = []
      map[b.date].push(b)
    }
    return map
  }, [upcomingBookings])

  function hasActivity(iso: string) {
    return (eventsByDate[iso]?.length ?? 0) > 0 || (bookingsByDate[iso]?.length ?? 0) > 0
  }

  // Monthly grid cells
  const monthCells = useMemo(() => {
    const year = viewMonth.getFullYear(); const month = viewMonth.getMonth()
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7
    return Array.from({ length: totalCells }, (_, i) => new Date(year, month, i - firstDay + 1))
  }, [viewMonth])

  // Week strip for week/day views
  const weekDates = useMemo(() => {
    const d = new Date(`${selectedDate}T00:00:00`)
    const sun = new Date(d); sun.setDate(d.getDate() - d.getDay())
    return Array.from({ length: 7 }, (_, i) => { const x = new Date(sun); x.setDate(sun.getDate() + i); return x })
  }, [selectedDate])

  function prevPeriod() {
    if (filter === "month") setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
    else { const d = new Date(`${selectedDate}T00:00:00`); d.setDate(d.getDate() - 1); setSelectedDate(toIso(d)) }
  }
  function nextPeriod() {
    if (filter === "month") setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
    else { const d = new Date(`${selectedDate}T00:00:00`); d.setDate(d.getDate() + 1); setSelectedDate(toIso(d)) }
  }

  // When switching to month, sync viewMonth to selectedDate's month
  function setFilterMode(f: CalFilter) {
    setSelectedDate(todayIso)
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1))
    setFilter(f)
  }

  const navLabel = useMemo(() => {
    if (filter === "month") return `${MONTH_NAMES[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`
    const d = new Date(`${selectedDate}T00:00:00`)
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
  }, [filter, viewMonth, weekDates, selectedDate])

  const selectedEvents = eventsByDate[selectedDate] ?? []
  const selectedBookings = bookingsByDate[selectedDate] ?? []

  // Week strip shown in week + day modes
  function WeekStrip() {
    return (
      <View style={{ flexDirection: "row", paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm }}>
        {weekDates.map((d) => {
          const iso = toIso(d)
          const isSelected = iso === selectedDate
          const isToday = iso === todayIso
          const activity = hasActivity(iso)
          return (
            <TouchableOpacity key={iso} style={{ flex: 1, alignItems: "center", gap: 4 }} onPress={() => setSelectedDate(iso)} activeOpacity={0.7}>
              <Text style={{ fontSize: 11, fontWeight: "600", color: isToday ? COLORS.primary : COLORS.textMuted }}>
                {["S","M","T","W","T","F","S"][d.getDay()]}
              </Text>
              <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: isSelected ? COLORS.primary : "transparent" }}>
                <Text style={{ fontSize: 15, fontWeight: isToday || isSelected ? "700" : "400", color: isSelected ? "#fff" : isToday ? COLORS.primary : COLORS.text }}>
                  {d.getDate()}
                </Text>
              </View>
              {activity && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isSelected ? COLORS.primary : COLORS.textMuted }} />}
            </TouchableOpacity>
          )
        })}
      </View>
    )
  }

  // Month grid events list (only for selected date, Apple Calendar style)
  function SelectedDayEvents() {
    const dateLabel = new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    const hasAny = selectedEvents.length > 0 || selectedBookings.length > 0
    return (
      <View style={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.md, gap: SPACING.sm }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: selectedDate === todayIso ? COLORS.primary : COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {dateLabel}
        </Text>
        {!hasAny && <Text style={{ fontSize: 13, color: COLORS.textMuted, paddingVertical: 4 }}>No events</Text>}
        {selectedBookings.map((b) => {
          const s = b.status.toLowerCase()
          const sc = s === "confirmed" ? { bg: COLORS.primaryLight, text: COLORS.primary }
            : s === "declined" ? { bg: COLORS.amberLight, text: COLORS.amber }
            : s.startsWith("cancelled") ? { bg: COLORS.redLight, text: COLORS.red }
            : { bg: COLORS.grayLight, text: COLORS.textMuted }
          return (
            <TouchableOpacity key={b.id} onPress={() => onBookingPress(b)} activeOpacity={0.8}>
              <View style={{ backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.plum, borderLeftWidth: 4, borderLeftColor: COLORS.primary, padding: SPACING.md }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text, flex: 1, marginRight: SPACING.sm }}>Session w/ {b.prepMasterName || "PrepMaster"}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full, backgroundColor: sc.bg }}>
                      <Text style={{ fontSize: 11, fontWeight: "600", textTransform: "capitalize", color: sc.text }}>{b.status}</Text>
                    </View>
                    <ChevronRight size={16} color={COLORS.accent} />
                  </View>
                </View>
                <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>{formatTime(b.time, b.utcDatetime)}{b.sessionType ? ` · ${fmtSessionType(b.sessionType)}` : ""}</Text>
              </View>
            </TouchableOpacity>
          )
        })}
        {selectedEvents.map((e) => (
          <View key={e.id} style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, borderLeftWidth: 4, borderLeftColor: COLORS.textMuted, padding: SPACING.md }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text }}>{e.title}</Text>
              <Text style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>{formatEventTime(e.start)}{e.end && !e.allDay ? ` – ${formatEventTime(e.end)}` : ""}</Text>
              {e.location ? <Text style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>{e.location}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Filter tabs */}
      <View style={{ flexDirection: "row", alignSelf: "center", marginBottom: SPACING.sm, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, overflow: "hidden" }}>
        {(["day", "month"] as CalFilter[]).map((f) => (
          <TouchableOpacity key={f} style={{ alignItems: "center", paddingVertical: 5, paddingHorizontal: SPACING.lg, backgroundColor: filter === f ? COLORS.primary : "transparent" }} onPress={() => setFilterMode(f)} activeOpacity={0.8}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: filter === f ? "#fff" : COLORS.textMuted, textTransform: "capitalize" }}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Nav header */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.md, marginBottom: SPACING.sm }}>
        <TouchableOpacity onPress={prevPeriod} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.7}>
          <ChevronLeft size={20} color={COLORS.text} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setSelectedDate(todayIso); setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1)) }} activeOpacity={0.7}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: COLORS.text }}>{navLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={nextPeriod} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.7}>
          <ChevronRight size={20} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {/* Week strip for day filter */}
      {filter === "day" && <WeekStrip />}

      {/* Month grid */}
      {filter === "month" && (
        <ScrollView showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}>
          {/* Day headers */}
          <View style={{ flexDirection: "row", paddingHorizontal: SPACING.md, marginBottom: 4 }}>
            {DAY_LABELS.map((d, i) => (
              <Text key={i} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700", color: COLORS.textMuted }}>{d}</Text>
            ))}
          </View>

          {/* Grid */}
          <View style={{ marginHorizontal: SPACING.md, borderRadius: RADIUS.md, overflow: "hidden", borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm }}>
            {Array.from({ length: monthCells.length / 7 }, (_, row) => (
              <View key={row} style={{ flexDirection: "row", borderBottomWidth: row < monthCells.length / 7 - 1 ? 1 : 0, borderColor: COLORS.border }}>
                {monthCells.slice(row * 7, row * 7 + 7).map((d, col) => {
                  const iso = toIso(d)
                  const inMonth = d.getMonth() === viewMonth.getMonth()
                  const isToday = iso === todayIso
                  const isSelected = iso === selectedDate
                  const hasCDP = (bookingsByDate[iso]?.length ?? 0) > 0
                  const hasCal = (eventsByDate[iso]?.length ?? 0) > 0
                  return (
                    <TouchableOpacity
                      key={iso}
                      style={{ flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center", backgroundColor: isSelected ? COLORS.primary : "transparent", borderRightWidth: col < 6 ? 1 : 0, borderColor: COLORS.border }}
                      onPress={() => setSelectedDate(iso)}
                      activeOpacity={0.7}
                    >
                      <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: isSelected ? COLORS.primary : isToday ? COLORS.primaryLight : "transparent" }}>
                        <Text style={{ fontSize: 14, fontWeight: isToday || isSelected ? "700" : "400", color: isSelected ? "#fff" : !inMonth ? COLORS.border : isToday ? COLORS.primary : COLORS.text }}>
                          {d.getDate()}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", gap: 2, height: 5, marginTop: 1 }}>
                        {hasCDP && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isSelected ? "rgba(255,255,255,0.9)" : COLORS.primary }} />}
                        {hasCal && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isSelected ? "rgba(255,255,255,0.6)" : COLORS.textMuted }} />}
                      </View>
                    </TouchableOpacity>
                  )
                })}
              </View>
            ))}
          </View>

          {/* Events for selected date only */}
          <SelectedDayEvents />
          <View style={{ height: 80 }} />
        </ScrollView>
      )}

      {/* Day view — hourly timeline */}
      {filter === "day" && (
        <HourlyView
          dateIso={selectedDate}
          calEvents={selectedEvents}
          bookings={selectedBookings}
          onBookingPress={onBookingPress}
        />
      )}

    </View>
  )
}

function ConnectCalendarPrompt({ onGoToProfile }: { onGoToProfile: () => void }) {
  const COLORS = useColors()
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: SPACING.xl, gap: SPACING.md }}>
      <CalendarDays size={48} color={COLORS.textMuted} />
      <Text style={{ fontSize: 16, fontWeight: "700", color: COLORS.text, textAlign: "center" }}>Connect Google Calendar</Text>
      <Text style={{ fontSize: 13, color: COLORS.textMuted, textAlign: "center", lineHeight: 20 }}>
        Link your Google Calendar in your profile to see all your events here.
      </Text>
      <TouchableOpacity style={{ backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md }} onPress={onGoToProfile} activeOpacity={0.8}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>Go to Profile</Text>
      </TouchableOpacity>
    </View>
  )
}

export default function MemberBookingsScreen() {
  const router = useRouter()
  const { openBookingId } = useLocalSearchParams<{ openBookingId?: string }>()
  const COLORS = useColors()
  const [tab, setTab] = useState<"list" | "calendar">("list")
  const [upcoming, setUpcoming] = useState<Booking[]>([])
  const [past, setPast] = useState<Booking[]>([])
  const [cancelled, setCancelled] = useState<Booking[]>([])
  const [upcomingExpanded, setUpcomingExpanded] = useState(true)
  const [pastExpanded, setPastExpanded] = useState(true)
  const [cancelledExpanded, setCancelledExpanded] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [calEvents, setCalEvents] = useState<CalEvent[]>([])
  const [calConnected, setCalConnected] = useState(false)

  const load = useCallback(async () => {
    try {
      const [bookingRes, calRes] = await Promise.all([
        authClient.$fetch(`${API_BASE}/api/member/dashboard`),
        authClient.$fetch(`${API_BASE}/api/member/calendar-events`),
      ])
      if (bookingRes.error || !bookingRes.data) throw new Error((bookingRes.error as any)?.statusText ?? "Failed to load")
      const d = bookingRes.data as { upcoming: Booking[]; past: Booking[]; cancelled: Booking[] }
      setUpcoming(d.upcoming ?? [])
      setPast(d.past ?? [])
      setCancelled(d.cancelled ?? [])
      setError(null)
      if (!calRes.error && calRes.data) {
        const cal = calRes.data as { connected: boolean; events: CalEvent[] }
        setCalConnected(cal.connected)
        setCalEvents(cal.events ?? [])
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong.") }
  }, [])

  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  // Re-fetch calendar connection status whenever this screen comes into focus
  // (e.g. after returning from the Profile screen after connecting Google Calendar)
  useFocusEffect(useCallback(() => { load() }, [load]))

  // Auto-open booking detail when navigated from inbox notification
  useEffect(() => {
    if (!openBookingId || loading) return
    const all = [...upcoming, ...past, ...cancelled]
    const target = all.find((b) => b.id === openBookingId)
    if (target) setSelectedBooking(target)
  }, [openBookingId, loading])

  const onRefresh = useCallback(async () => { setRefreshing(true); await load(); setRefreshing(false) }, [load])

  function handleCancelled(id: string) {
    const b = upcoming.find((x) => x.id === id)
    setUpcoming((prev) => prev.filter((x) => x.id !== id))
    if (b) setCancelled((prev) => [{ ...b, status: "Cancelled" }, ...prev])
    setSelectedBooking(null)
  }

  function handleRescheduled(id: string, date: string, time: string, utcDatetime?: string | null) {
    setUpcoming((prev) => prev.map((b) => b.id === id ? { ...b, date, time, utcDatetime: utcDatetime ?? b.utcDatetime, status: "Pending" } : b))
    setSelectedBooking(null)
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top"]}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      </SafeAreaView>
    )
  }

  const isEmpty = upcoming.length === 0 && past.length === 0 && cancelled.length === 0

  type ListItem =
    | { type: "header"; title: string; count: number; expanded: boolean; onToggle: () => void }
    | { type: "item"; booking: Booking; tappable: boolean }

  const allItems: ListItem[] = []
  if (upcoming.length > 0) {
    allItems.push({ type: "header", title: "Upcoming", count: upcoming.length, expanded: upcomingExpanded, onToggle: () => setUpcomingExpanded((v) => !v) })
    if (upcomingExpanded) upcoming.forEach((b) => allItems.push({ type: "item", booking: b, tappable: true }))
  }
  if (past.length > 0) {
    allItems.push({ type: "header", title: "Past", count: past.length, expanded: pastExpanded, onToggle: () => setPastExpanded((v) => !v) })
    if (pastExpanded) past.forEach((b) => allItems.push({ type: "item", booking: b, tappable: false }))
  }
  if (cancelled.length > 0) {
    allItems.push({ type: "header", title: "Cancelled", count: cancelled.length, expanded: cancelledExpanded, onToggle: () => setCancelledExpanded((v) => !v) })
    if (cancelledExpanded) cancelled.forEach((b) => allItems.push({ type: "item", booking: b, tappable: false }))
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.md, paddingTop: SPACING.md, paddingBottom: SPACING.sm }}>
        <Text style={{ fontSize: 26, fontWeight: "700", color: COLORS.text, fontFamily: "Anton_400Regular", textTransform: "uppercase", letterSpacing: 0.5 }}>My Bookings</Text>
        <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADIUS.full }} onPress={() => router.push("/member/book" as any)} activeOpacity={0.7}>
          <Plus size={16} color="#fff" />
          <Text style={{ fontSize: 13, fontWeight: "700", color: "#fff" }}>New Booking</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flexDirection: "row", marginHorizontal: SPACING.md, marginBottom: SPACING.sm, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, overflow: "hidden" }}>
        {([["list", "List", List], ["calendar", "Calendar", CalendarDays]] as const).map(([value, label, Icon]) => (
          <TouchableOpacity key={value} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, backgroundColor: tab === value ? COLORS.primary : "transparent" }} onPress={() => setTab(value)} activeOpacity={0.8}>
            <Icon size={15} color={tab === value ? "#fff" : COLORS.textMuted} />
            <Text style={{ fontSize: 13, fontWeight: "600", color: tab === value ? "#fff" : COLORS.textMuted }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? (
        <View style={{ margin: SPACING.md, backgroundColor: COLORS.redLight, borderRadius: RADIUS.sm, padding: SPACING.sm }}>
          <Text style={{ fontSize: 13, color: COLORS.red }}>{error}</Text>
        </View>
      ) : tab === "calendar" ? (
        calConnected
          ? <CalendarView events={calEvents} upcomingBookings={upcoming} refreshing={refreshing} onRefresh={onRefresh} onBookingPress={setSelectedBooking} />
          : <ConnectCalendarPrompt onGoToProfile={() => router.push("/member/profile" as any)} />
      ) : isEmpty ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: SPACING.lg, gap: SPACING.sm }}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.text }}>No bookings yet</Text>
          <Text style={{ fontSize: 13, color: COLORS.textMuted, textAlign: "center" }}>Your sessions will appear here once booked.</Text>
        </View>
      ) : (
        <FlatList
          data={allItems}
          keyExtractor={(item, i) => item.type === "item" ? item.booking.id : `header-${i}`}
          contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: SPACING.xl }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          ItemSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
          renderItem={({ item }) => {
            if (item.type === "header") return <SectionHeader title={item.title} count={item.count} expanded={item.expanded} onToggle={item.onToggle} />
            return <BookingCard booking={item.booking} onPress={item.tappable ? () => setSelectedBooking(item.booking) : undefined} />
          }}
        />
      )}

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
