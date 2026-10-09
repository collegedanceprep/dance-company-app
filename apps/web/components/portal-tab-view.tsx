"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import type { PrepMasterBooking } from "@/lib/airtable"
import { AppointmentCard } from "@/components/appointment-card"
import { PreviousSessionsPanel } from "@/components/previous-sessions-panel"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ChevronLeft, ChevronRight, CalendarDays, List, ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import { LocalTime } from "@/components/local-time"

// Groups bookings by calendar date (ascending) with each day's sessions
// sorted earliest-to-latest by real UTC time.
function groupByDay(bookings: PrepMasterBooking[]): [string, PrepMasterBooking[]][] {
  const byDate = new Map<string, PrepMasterBooking[]>()
  for (const b of bookings) {
    const key = b.date || "Unknown date"
    if (!byDate.has(key)) byDate.set(key, [])
    byDate.get(key)!.push(b)
  }
  const timeMs = (b: PrepMasterBooking) => b.utcDatetime ? new Date(b.utcDatetime).getTime() : 0
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => [date, [...items].sort((a, b) => timeMs(a) - timeMs(b))])
}

function formatDayHeading(dateStr: string): string {
  if (!dateStr || dateStr === "Unknown date") return "Unknown date"
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}

function DayGroup({ date, count, children }: { date: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between gap-2 text-left"
      >
        <span className="text-sm font-bold">
          {formatDayHeading(date)} <span className="font-normal text-muted-foreground">({count})</span>
        </span>
        {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>
      {open && <div className="flex flex-col gap-3">{children}</div>}
    </div>
  )
}

type CalEvent = {
  id: string; title: string; start: string | null; end: string | null
  allDay: boolean; location: string | null
}
type ViewMode = "month" | "week" | "day"

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"]
const DAY_ABBR = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
const DAY_LETTER = ["S","M","T","W","T","F","S"]
const START_HOUR = 7
const END_HOUR = 22
const HOUR_HEIGHT = 60
const TIME_COL_W = 48

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`
}

function buildMonthCells(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month+1, 0).getDate()
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7
  return Array.from({ length: totalCells }, (_, i) => new Date(year, month, i - firstDay + 1))
}

function buildWeekDates(isoDate: string): Date[] {
  const d = new Date(`${isoDate}T00:00:00`)
  const sun = new Date(d); sun.setDate(d.getDate() - d.getDay())
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(sun); x.setDate(sun.getDate() + i); return x })
}

function parseBookingHM(time: string): { hour: number; minute: number } | null {
  const m = time.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return null
  let h = parseInt(m[1], 10); const min = parseInt(m[2], 10); const mer = m[3].toUpperCase()
  if (mer === "PM" && h !== 12) h += 12
  if (mer === "AM" && h === 12) h = 0
  return { hour: h, minute: min }
}

function parseEventHM(iso: string) {
  const d = new Date(iso); return { hour: d.getHours(), minute: d.getMinutes() }
}

function fmtHour(h: number): string {
  if (h === 12) return "12 PM"; if (h === 0) return "12 AM"
  return h > 12 ? `${h-12} PM` : `${h} AM`
}

function fmtEventTime(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
}

function bookingStatusStyle(status: string) {
  const s = status.toLowerCase()
  if (s === "pending") return { border: "border-amber-400", bg: "bg-amber-50 dark:bg-amber-900/20", text: "text-amber-700 dark:text-amber-300" }
  if (s === "confirmed") return { border: "border-primary", bg: "bg-primary/10", text: "text-primary" }
  return { border: "border-muted-foreground/40", bg: "bg-muted/30", text: "text-muted-foreground" }
}

function isActiveBooking(b: PrepMasterBooking) {
  const s = b.status.toLowerCase()
  return !s.startsWith("cancelled") && s !== "declined"
}

// ─── Day Timeline ─────────────────────────────────────────────────────────────

function DayTimeline({
  dateIso, bookings, calEvents, todayIso, onBookingClick,
}: {
  dateIso: string; bookings: PrepMasterBooking[]; calEvents: CalEvent[]
  todayIso: string; onBookingClick: (b: PrepMasterBooking) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const now = new Date()
  const isToday = dateIso === todayIso

  useEffect(() => {
    const target = isToday ? Math.max(0, (now.getHours() - 1 - START_HOUR) * HOUR_HEIGHT) : (8 - START_HOUR) * HOUR_HEIGHT
    scrollRef.current?.scrollTo({ top: target, behavior: "instant" })
  }, [dateIso])

  const totalH = (END_HOUR - START_HOUR) * HOUR_HEIGHT
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

  const blocks = useMemo(() => {
    type Block = { key: string; top: number; height: number; label: string; sub: string | null; isCDP: boolean; booking?: PrepMasterBooking; status?: string }
    const res: Block[] = []
    for (const b of bookings) {
      if (b.date !== dateIso || !isActiveBooking(b)) continue
      const hm = parseBookingHM(b.time)
      if (!hm) continue
      const top = (hm.hour - START_HOUR + hm.minute / 60) * HOUR_HEIGHT
      res.push({ key: `b-${b.id}`, top, height: HOUR_HEIGHT, label: b.dancerName || "Member", sub: b.time, isCDP: true, booking: b, status: b.status })
    }
    for (const e of calEvents) {
      if (!e.start || e.allDay) continue
      const startDate = toIso(new Date(e.start))
      if (startDate !== dateIso) continue
      const hm = parseEventHM(e.start)
      const top = (hm.hour - START_HOUR + hm.minute / 60) * HOUR_HEIGHT
      let height = HOUR_HEIGHT
      if (e.end) {
        const ehm = parseEventHM(e.end)
        height = Math.max(24, (ehm.hour - hm.hour + (ehm.minute - hm.minute) / 60) * HOUR_HEIGHT)
      }
      res.push({ key: `e-${e.id}`, top, height, label: e.title, sub: fmtEventTime(e.start), isCDP: false })
    }
    return res
  }, [bookings, calEvents, dateIso])

  const currentTop = isToday ? (now.getHours() - START_HOUR + now.getMinutes() / 60) * HOUR_HEIGHT : null

  return (
    <div ref={scrollRef} className="overflow-y-auto rounded-lg border border-border" style={{ height: 480 }}>
      <div style={{ display: "flex", paddingBottom: 24 }}>
        <div style={{ width: TIME_COL_W, flexShrink: 0, paddingLeft: 4 }}>
          {hours.map((h) => (
            <div key={h} style={{ height: HOUR_HEIGHT, paddingTop: 4 }}>
              <span className="text-[10px] text-muted-foreground">{fmtHour(h)}</span>
            </div>
          ))}
        </div>
        <div className="relative flex-1 border-l border-border" style={{ height: totalH }}>
          {hours.map((h, i) => (
            <div key={h} className="absolute left-0 right-0 border-t border-border/40" style={{ top: i * HOUR_HEIGHT }} />
          ))}
          {currentTop !== null && currentTop >= 0 && currentTop <= totalH && (
            <div className="absolute left-0 right-0 z-10 flex items-center" style={{ top: currentTop }}>
              <div className="size-2 rounded-full bg-primary -ml-1 shrink-0" />
              <div className="flex-1 border-t-2 border-primary" />
            </div>
          )}
          {blocks.map((block) => {
            const style = block.isCDP && block.status ? bookingStatusStyle(block.status) : null
            return (
              <div
                key={block.key}
                onClick={() => block.booking && onBookingClick(block.booking)}
                className={cn(
                  "absolute left-1 right-1 rounded overflow-hidden border-l-[3px] px-1.5 py-1",
                  block.isCDP && style
                    ? `${style.border} ${style.bg} cursor-pointer hover:brightness-95`
                    : "bg-muted/40 border-muted-foreground/30"
                )}
                style={{ top: block.top + 1, height: Math.max(22, block.height - 2) }}
              >
                <p className={cn("text-[11px] font-semibold leading-tight truncate", block.isCDP && style ? style.text : "text-muted-foreground")}>
                  {block.label}
                </p>
                {block.height > 32 && block.sub && (
                  <p className="text-[10px] text-muted-foreground/80 mt-0.5 truncate">{block.sub}</p>
                )}
                {block.isCDP && block.status && block.height > 46 && (
                  <p className={cn("text-[10px] font-medium mt-0.5 capitalize truncate", style?.text)}>
                    {block.status}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Week View (condensed per-day list) ───────────────────────────────────────

function WeekView({
  weekDates, bookings, calEvents, todayIso, onBookingClick,
}: {
  weekDates: Date[]; bookings: PrepMasterBooking[]; calEvents: CalEvent[]
  todayIso: string; onBookingClick: (b: PrepMasterBooking) => void
}) {
  return (
    <div className="grid grid-cols-7 gap-px border border-border rounded-lg overflow-hidden">
      {weekDates.map((d) => {
        const iso = toIso(d)
        const isToday = iso === todayIso
        const dayBookings = bookings.filter((b) => b.date === iso && isActiveBooking(b))
        const dayEvents = calEvents.filter((e) => {
          if (!e.start) return false
          return (e.start.length === 10 ? e.start : toIso(new Date(e.start))) === iso
        })
        return (
          <div key={iso} className={cn("flex flex-col bg-card min-h-[160px]", isToday && "bg-primary/5")}>
            <div className={cn("px-1.5 py-1 text-center border-b border-border", isToday ? "bg-primary text-primary-foreground" : "bg-muted/50")}>
              <p className="text-[10px] font-semibold uppercase">{DAY_ABBR[d.getDay()]}</p>
              <p className="text-sm font-bold">{d.getDate()}</p>
            </div>
            <div className="flex flex-col gap-1 p-1 overflow-hidden">
              {dayBookings.map((b) => {
                const style = bookingStatusStyle(b.status)
                return (
                  <button key={b.id} onClick={() => onBookingClick(b)}
                    className={cn("w-full text-left rounded border-l-2 px-1 py-0.5 text-[10px] truncate", style.border, style.bg, style.text)}>
                    {b.time ? <LocalTime slot={b.time} dateIso={b.date} utcDatetime={b.utcDatetime} className="shrink-0" /> : ""} {b.dancerName || "Member"}
                  </button>
                )
              })}
              {dayEvents.map((e) => (
                <div key={e.id} className="rounded border-l-2 border-muted-foreground/40 bg-muted/30 px-1 py-0.5 text-[10px] text-muted-foreground truncate">
                  {e.allDay ? "All day" : fmtEventTime(e.start)} {e.title}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Week Day Strip (for Day view navigation) ─────────────────────────────────

function WeekStrip({
  weekDates, selectedDate, todayIso, bookingsByDate, eventsByDate, onSelect,
}: {
  weekDates: Date[]; selectedDate: string; todayIso: string
  bookingsByDate: Record<string, PrepMasterBooking[]>; eventsByDate: Record<string, CalEvent[]>
  onSelect: (iso: string) => void
}) {
  return (
    <div className="grid grid-cols-7 gap-px rounded-lg border border-border overflow-hidden mb-4">
      {weekDates.map((d) => {
        const iso = toIso(d)
        const isSelected = iso === selectedDate
        const isToday = iso === todayIso
        const hasBooking = (bookingsByDate[iso]?.filter(isActiveBooking).length ?? 0) > 0
        const hasEvent = (eventsByDate[iso]?.length ?? 0) > 0
        return (
          <button key={iso} onClick={() => onSelect(iso)}
            className={cn("flex flex-col items-center gap-1 py-2 transition-colors",
              isSelected ? "bg-primary text-primary-foreground" : isToday ? "bg-primary/10" : "bg-card hover:bg-muted"
            )}>
            <span className={cn("text-[10px] font-semibold uppercase", isSelected ? "text-primary-foreground/70" : isToday ? "text-primary" : "text-muted-foreground")}>
              {DAY_ABBR[d.getDay()]}
            </span>
            <span className={cn("text-base font-bold", isSelected ? "text-primary-foreground" : isToday ? "text-primary" : "")}>{d.getDate()}</span>
            <div className="flex gap-0.5">
              {hasBooking && <div className={cn("size-1.5 rounded-full", isSelected ? "bg-primary-foreground" : "bg-primary")} />}
              {hasEvent && <div className={cn("size-1.5 rounded-full", isSelected ? "bg-primary-foreground/60" : "bg-muted-foreground")} />}
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ─── Month Grid ───────────────────────────────────────────────────────────────

function MonthGrid({
  viewMonth, selectedDate, todayIso, bookingsByDate, eventsByDate, onSelectDay,
}: {
  viewMonth: Date; selectedDate: string; todayIso: string
  bookingsByDate: Record<string, PrepMasterBooking[]>; eventsByDate: Record<string, CalEvent[]>
  onSelectDay: (iso: string) => void
}) {
  const cells = buildMonthCells(viewMonth.getFullYear(), viewMonth.getMonth())
  const curMonth = viewMonth.getMonth()

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Day labels */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/50">
        {DAY_LETTER.map((l, i) => (
          <div key={i} className={cn("text-center text-[11px] font-semibold text-muted-foreground py-2", i < 6 && "border-r border-border")}>{l}</div>
        ))}
      </div>
      {/* Cells */}
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const iso = toIso(d)
          const isCurrentMonth = d.getMonth() === curMonth
          const isSelected = iso === selectedDate
          const isToday = iso === todayIso
          const activeBookings = (bookingsByDate[iso] ?? []).filter(isActiveBooking)
          const hasBooking = activeBookings.length > 0
          const hasEvent = (eventsByDate[iso]?.length ?? 0) > 0
          const col = i % 7
          const isLastInRow = col === 6
          const totalRows = cells.length / 7
          const row = Math.floor(i / 7)
          const isLastRow = row === totalRows - 1

          return (
            <button key={i} onClick={() => onSelectDay(iso)}
              className={cn(
                "flex flex-col items-start p-1.5 min-h-[72px] transition-colors text-left",
                !isLastInRow && "border-r border-border",
                !isLastRow && "border-b border-border",
                isSelected ? "bg-primary/10 ring-inset ring-1 ring-primary" : isToday ? "bg-primary/5" : "hover:bg-muted/50",
                !isCurrentMonth && "opacity-40"
              )}>
              <span className={cn(
                "inline-flex size-6 items-center justify-center rounded-full text-xs font-medium mb-1",
                isSelected ? "bg-primary text-primary-foreground" :
                isToday ? "bg-primary/20 text-primary font-bold" : ""
              )}>{d.getDate()}</span>
              <div className="flex flex-col gap-0.5 w-full overflow-hidden">
                {activeBookings.slice(0, 2).map((b) => {
                  const style = bookingStatusStyle(b.status)
                  return (
                    <div key={b.id} className={cn("rounded-sm px-1 text-[9px] font-medium truncate border-l-2", style.border, style.bg, style.text)}>
                      {b.dancerName || "Member"}
                    </div>
                  )
                })}
                {(eventsByDate[iso] ?? []).slice(0, 2).map((e) => (
                  <div key={e.id} className="rounded-sm px-1 text-[9px] text-muted-foreground bg-muted/60 truncate border-l-2 border-muted-foreground/30">
                    {e.title}
                  </div>
                ))}
                {(eventsByDate[iso]?.length ?? 0) > 2 && (
                  <p className="text-[9px] text-muted-foreground px-1">+{(eventsByDate[iso]?.length ?? 0) - 2} more</p>
                )}
                {activeBookings.length > 2 && (
                  <p className="text-[9px] text-muted-foreground px-1">+{activeBookings.length - 2} more</p>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function PortalTabView({
  upcoming, completed, cancelled, declined, pendingCount, calendarConnected,
}: {
  upcoming: PrepMasterBooking[]
  completed: PrepMasterBooking[]
  cancelled: PrepMasterBooking[]
  declined: PrepMasterBooking[]
  pendingCount: number
  calendarConnected: boolean
}) {
  const todayIso = toIso(new Date())
  const [tab, setTab] = useState<"list" | "calendar">("list")
  const [view, setView] = useState<ViewMode>("month")
  const [selectedDate, setSelectedDate] = useState(todayIso)
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [calEvents, setCalEvents] = useState<CalEvent[]>([])
  const [calLoading, setCalLoading] = useState(false)
  const [sheetBooking, setSheetBooking] = useState<PrepMasterBooking | null>(null)

  // Only active bookings on calendar
  const activeBookings = useMemo(() => [...upcoming, ...completed], [upcoming, completed])

  useEffect(() => {
    if (tab !== "calendar" || !calendarConnected) return
    setCalLoading(true)
    const rangeStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1)
    const rangeEnd = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 2, 1)
    fetch(`/api/portal/calendar-events?timeMin=${rangeStart.toISOString()}&timeMax=${rangeEnd.toISOString()}`)
      .then((r) => r.json())
      .then((d) => { if (d.events) setCalEvents(d.events) })
      .catch(() => {})
      .finally(() => setCalLoading(false))
  }, [tab, calendarConnected, viewMonth])

  const bookingsByDate = useMemo(() => {
    const map: Record<string, PrepMasterBooking[]> = {}
    for (const b of activeBookings) {
      if (!b.date) continue
      if (!map[b.date]) map[b.date] = []
      map[b.date].push(b)
    }
    return map
  }, [activeBookings])

  const eventsByDate = useMemo(() => {
    const map: Record<string, CalEvent[]> = {}
    for (const e of calEvents) {
      if (!e.start) continue
      const iso = e.start.length === 10 ? e.start : toIso(new Date(e.start))
      if (!map[iso]) map[iso] = []
      map[iso].push(e)
    }
    return map
  }, [calEvents])

  const weekDates = useMemo(() => buildWeekDates(selectedDate), [selectedDate])

  function prevPeriod() {
    if (view === "month") {
      setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
    } else if (view === "week") {
      const d = new Date(`${selectedDate}T00:00:00`); d.setDate(d.getDate() - 7); setSelectedDate(toIso(d))
    } else {
      const d = new Date(`${selectedDate}T00:00:00`); d.setDate(d.getDate() - 1); setSelectedDate(toIso(d))
    }
  }

  function nextPeriod() {
    if (view === "month") {
      setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
    } else if (view === "week") {
      const d = new Date(`${selectedDate}T00:00:00`); d.setDate(d.getDate() + 7); setSelectedDate(toIso(d))
    } else {
      const d = new Date(`${selectedDate}T00:00:00`); d.setDate(d.getDate() + 1); setSelectedDate(toIso(d))
    }
  }

  const navLabel = useMemo(() => {
    if (view === "month") return `${MONTH_NAMES[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`
    if (view === "week") {
      const start = weekDates[0]; const end = weekDates[6]
      if (start.getMonth() === end.getMonth())
        return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`
      return `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`
    }
    return new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  }, [view, viewMonth, selectedDate, weekDates])

  return (
    <>
      {/* Tab bar */}
      <div className="flex items-center gap-1 self-start rounded-lg border border-border bg-muted p-1">
        <button onClick={() => setTab("list")}
          className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}>
          <List className="size-4" /> List
        </button>
        <button onClick={() => setTab("calendar")}
          className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            tab === "calendar" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}>
          <CalendarDays className="size-4" /> Calendar
        </button>
      </div>

      {/* ── List tab ── */}
      {tab === "list" && (
        <>
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <h2 className="font-heading text-xl font-semibold">Upcoming sessions</h2>
              {pendingCount > 0 && (
                <Badge variant="destructive" className="rounded-full">{pendingCount} pending</Badge>
              )}
            </div>
            {upcoming.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-muted-foreground">No upcoming sessions booked yet.</CardContent></Card>
            ) : (
              <div className="flex flex-col gap-4">
                {groupByDay(upcoming).map(([date, items]) => (
                  <DayGroup key={date} date={date} count={items.length}>
                    {items.map((b) => <AppointmentCard key={b.id} booking={b} />)}
                  </DayGroup>
                ))}
              </div>
            )}
          </section>
          <PreviousSessionsPanel completed={completed} cancelled={cancelled} declined={declined} />
        </>
      )}

      {/* ── Calendar tab ── */}
      {tab === "calendar" && (
        <Card>
          <CardContent className="p-4 sm:p-6">
            {/* Controls */}
            <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
              <div className="flex rounded-md border border-border overflow-hidden text-sm">
                {(["month","week","day"] as ViewMode[]).map((v) => (
                  <button key={v} onClick={() => setView(v)}
                    className={cn("px-3 py-1.5 font-medium capitalize transition-colors",
                      view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    )}>{v}</button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={prevPeriod} className="rounded-md p-1.5 hover:bg-muted transition-colors">
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-sm font-semibold min-w-[180px] text-center">{navLabel}</span>
                <button onClick={nextPeriod} className="rounded-md p-1.5 hover:bg-muted transition-colors">
                  <ChevronRight className="size-4" />
                </button>
                <button
                  onClick={() => { setSelectedDate(todayIso); setViewMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) }}
                  className="ml-1 text-xs font-medium px-2 py-1 rounded border border-border hover:bg-muted transition-colors">
                  Today
                </button>
              </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-primary/60 border-l-2 border-primary" /> Confirmed</span>
              <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-amber-100 dark:bg-amber-900/30 border-l-2 border-amber-400" /> Pending</span>
              {calendarConnected && <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm bg-muted/60 border-l-2 border-muted-foreground/40" /> Google Calendar</span>}
              {!calendarConnected && <span className="italic">Connect Google Calendar to see external events</span>}
            </div>

            {view === "month" && (
              <MonthGrid
                viewMonth={viewMonth} selectedDate={selectedDate} todayIso={todayIso}
                bookingsByDate={bookingsByDate} eventsByDate={eventsByDate}
                onSelectDay={(iso) => { setSelectedDate(iso); setView("day") }}
              />
            )}

            {view === "week" && (
              <WeekView
                weekDates={weekDates} bookings={activeBookings} calEvents={calEvents}
                todayIso={todayIso} onBookingClick={setSheetBooking}
              />
            )}

            {view === "day" && (
              <div>
                <WeekStrip
                  weekDates={weekDates} selectedDate={selectedDate} todayIso={todayIso}
                  bookingsByDate={bookingsByDate} eventsByDate={eventsByDate}
                  onSelect={setSelectedDate}
                />
                <DayTimeline
                  dateIso={selectedDate} bookings={activeBookings} calEvents={calEvents}
                  todayIso={todayIso} onBookingClick={setSheetBooking}
                />
              </div>
            )}

            {calLoading && <p className="text-xs text-muted-foreground mt-3 text-center">Loading calendar events…</p>}
          </CardContent>
        </Card>
      )}

      {/* Booking detail sheet */}
      <Sheet open={!!sheetBooking} onOpenChange={(open) => { if (!open) setSheetBooking(null) }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>Session details</SheetTitle></SheetHeader>
          {sheetBooking && <div className="mt-4"><AppointmentCard booking={sheetBooking} /></div>}
        </SheetContent>
      </Sheet>
    </>
  )
}
