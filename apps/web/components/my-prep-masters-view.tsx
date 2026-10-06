"use client"

import { useState, useCallback, useMemo } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Users, CalendarDays, Calendar, Search, X, ArrowUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PrepMaster, PrepMasterBooking } from "@/lib/airtable"
import { Badge } from "@/components/ui/badge"
import { LocalTime } from "@/components/local-time"
import { getUniversityColor } from "@/lib/university-colors"

type TeamEntry = { pm: PrepMaster; bookings: PrepMasterBooking[] }

type Props = {
  initialTeam: TeamEntry[]
  initialYear: number
  initialMonth: number
  isAdmin: boolean
  allRDs: string[]
  initialRdName: string
  title?: string
  subtitleSuffix?: string
  apiEndpoint?: string
  enableDayView?: boolean
}

const MONTHS = [
  "January","February","March","April","May",
  "June","July","August","September","October","November","December",
]

// Matches the app-wide status convention: confirmed = primary brand color,
// pending = amber (see admin-prep-masters-panel.tsx's invite-pending badge),
// completed = green, canceled = destructive/red.
const STATUS_BADGE: Record<string, { variant?: "default" | "destructive"; className?: string }> = {
  confirmed: { variant: "default" },
  pending: { className: "border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-400" },
  completed: { className: "border-green-300 bg-green-100 text-green-700 dark:border-green-700 dark:bg-green-950 dark:text-green-400" },
  canceled: { variant: "destructive" },
}

const STATUS_TEXT_CLASS: Record<string, string> = {
  confirmed: "text-primary",
  pending: "text-amber-600 dark:text-amber-400",
  completed: "text-green-600 dark:text-green-400",
  canceled: "text-destructive",
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  pending: "Pending",
  completed: "Completed",
  canceled:  "Canceled",
}

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()
}

function formatDate(dateStr: string) {
  if (!dateStr) return { day: "—", mon: "" }
  const d = new Date(`${dateStr}T00:00:00`)
  return {
    day: String(d.getDate()).padStart(2, "0"),
    mon: MONTHS[d.getMonth()].slice(0, 3),
  }
}

export function MyPrepMastersView({
  initialTeam,
  initialYear,
  initialMonth,
  isAdmin,
  allRDs,
  initialRdName,
  title = "My PrepMasters",
  subtitleSuffix = "on your team",
  apiEndpoint = "/api/portal/my-prep-masters",
  enableDayView = false,
}: Props) {
  const [team, setTeam] = useState<TeamEntry[]>(initialTeam)
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [loading, setLoading] = useState(false)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [selectedRD, setSelectedRD] = useState(initialRdName)
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "confirmed" | "completed" | "canceled">("all")
  const [search, setSearch] = useState("")
  const [view, setView] = useState<"day" | "calendar" | "prepmaster">(enableDayView ? "day" : "prepmaster")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc")
  // Days default to collapsed — this tracks the ones explicitly opened.
  const [openDays, setOpenDays] = useState<Set<string>>(new Set())
  const [calSelectedDate, setCalSelectedDate] = useState<string | null>(null)

  const fetchTeam = useCallback(async (y: number, m: number, rdName: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ year: String(y), month: String(m) })
      if (isAdmin && rdName) params.set("rdName", rdName)
      const res = await fetch(`${apiEndpoint}?${params}`)
      const data = await res.json()
      setTeam(data.team ?? [])
    } finally {
      setLoading(false)
    }
  }, [isAdmin, apiEndpoint])

  const changeMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m > 12) { m = 1; y++ }
    if (m < 1)  { m = 12; y-- }
    setMonth(m)
    setYear(y)
    setOpenIds(new Set())
    setOpenDays(new Set())
    setCalSelectedDate(null)
    fetchTeam(y, m, selectedRD)
  }

  const changeRD = (rdName: string) => {
    setSelectedRD(rdName)
    setOpenIds(new Set())
    fetchTeam(year, month, rdName)
  }

  const togglePM = (name: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const stats = team.reduce(
    (acc, { bookings }) => {
      for (const b of bookings) {
        acc.total++
        if (b.status === "pending") acc.pending++
        else if (b.status === "confirmed") acc.confirmed++
        else if (b.status === "completed") acc.completed++
        else if (b.status === "canceled") acc.canceled++
      }
      return acc
    },
    { total: 0, pending: 0, confirmed: 0, completed: 0, canceled: 0 },
  )

  // When a stat is selected, narrow each PrepMaster's bookings to that status
  // and drop anyone with no matching bookings this month.
  const statusFilteredTeam = statusFilter === "all"
    ? team
    : team
        .map((entry) => ({ ...entry, bookings: entry.bookings.filter((b) => b.status === statusFilter) }))
        .filter((entry) => entry.bookings.length > 0)

  const visibleTeam = search.trim()
    ? statusFilteredTeam.filter((entry) =>
        entry.pm.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : statusFilteredTeam

  // Flat, day-grouped view of the currently selected month: every booking
  // with its PM name attached, bucketed by date, in the chosen sort order.
  // Scoped to `statusFilteredTeam` so the existing month nav (prev/next
  // arrows) drives which month's bookings show up here too.
  type DayBooking = PrepMasterBooking & { pmName: string }
  const dayGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const flat: DayBooking[] = []
    for (const { pm, bookings } of statusFilteredTeam) {
      for (const b of bookings) {
        if (q && !pm.name.toLowerCase().includes(q) && !(b.dancerName ?? "").toLowerCase().includes(q)) continue
        flat.push({ ...b, pmName: pm.name })
      }
    }
    const dir = sortOrder === "asc" ? 1 : -1
    flat.sort((a, b) => {
      const ta = a.utcDatetime ? new Date(a.utcDatetime).getTime() : 0
      const tb = b.utcDatetime ? new Date(b.utcDatetime).getTime() : 0
      if (ta !== tb) return (ta - tb) * dir
      return (a.date || "").localeCompare(b.date || "") * dir
    })

    const dayMap = new Map<string, DayBooking[]>()
    for (const b of flat) {
      const key = b.date || "—"
      if (!dayMap.has(key)) dayMap.set(key, [])
      dayMap.get(key)!.push(b)
    }
    return Array.from(dayMap.entries()).sort(([a], [b]) => a.localeCompare(b) * dir)
  }, [statusFilteredTeam, search, sortOrder])

  const dayLookup = useMemo(() => new Map(dayGroups), [dayGroups])

  // Calendar grid for the selected month — a cell per day (plus leading/
  // trailing blanks to fill out the week rows), with each day's booking
  // count pulled from dayLookup so it matches the current status filter.
  const calendarWeeks = useMemo(() => {
    const firstOfMonth = new Date(year, month - 1, 1)
    const daysInMonth = new Date(year, month, 0).getDate()
    const leadingBlanks = firstOfMonth.getDay() // 0 = Sunday
    const pad = (n: number) => String(n).padStart(2, "0")
    const cells: { dateIso: string | null; dayNum: number | null }[] = []
    for (let i = 0; i < leadingBlanks; i++) cells.push({ dateIso: null, dayNum: null })
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ dateIso: `${year}-${pad(month)}-${pad(d)}`, dayNum: d })
    }
    while (cells.length % 7 !== 0) cells.push({ dateIso: null, dayNum: null })
    const weeks: (typeof cells)[] = []
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
    return weeks
  }, [year, month])

  function formatDayHeading(dateStr: string) {
    if (!dateStr || dateStr === "—") return "Unscheduled"
    const d = new Date(`${dateStr}T00:00:00`)
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  }

  function toggleDay(key: string) {
    setOpenDays((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-muted-foreground">
          {team.length} PrepMaster{team.length !== 1 ? "s" : ""} {subtitleSuffix}
        </p>
      </div>

      {/* Admin RD selector */}
      {isAdmin && allRDs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Regional Director
          </label>
          <select
            value={selectedRD}
            onChange={(e) => changeRD(e.target.value)}
            className="rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 max-w-xs"
          >
            {allRDs.map((rd) => (
              <option key={rd} value={rd}>{rd}</option>
            ))}
          </select>
        </div>
      )}

      {/* Month nav + stats */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{MONTHS[month - 1]} {year}</span>
          <div className="flex gap-1">
            <button
              onClick={() => changeMonth(-1)}
              className="rounded-md border p-1.5 hover:bg-muted transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => changeMonth(1)}
              className="rounded-md border p-1.5 hover:bg-muted transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-5 divide-x divide-border">
          {[
            { label: "Total",     value: stats.total,     cls: "",                              filterKey: "all" as const },
            { label: "Pending",   value: stats.pending,   cls: STATUS_TEXT_CLASS.pending,        filterKey: "pending" as const },
            { label: "Confirmed", value: stats.confirmed, cls: STATUS_TEXT_CLASS.confirmed,       filterKey: "confirmed" as const },
            { label: "Completed", value: stats.completed, cls: STATUS_TEXT_CLASS.completed,       filterKey: "completed" as const },
            { label: "Canceled",  value: stats.canceled,  cls: STATUS_TEXT_CLASS.canceled,        filterKey: "canceled" as const },
          ].map(({ label, value, cls, filterKey }) => (
            <button
              key={label}
              type="button"
              onClick={() => setStatusFilter((prev) => (prev === filterKey ? "all" : filterKey))}
              className={cn(
                "flex flex-col items-center py-1.5 rounded-md transition-colors hover:bg-muted/50",
                statusFilter === filterKey && filterKey !== "all" && "bg-muted/70 ring-1 ring-inset ring-primary/40",
              )}
            >
              <span className={cn("text-2xl font-bold tabular-nums", cls)}>
                {loading ? "—" : value}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mt-0.5">
                {label}
              </span>
            </button>
          ))}
        </div>
        {statusFilter !== "all" && (
          <p className="text-xs text-muted-foreground -mt-2">
            Showing only {STATUS_LABELS[statusFilter].toLowerCase()} bookings.{" "}
            <button type="button" onClick={() => setStatusFilter("all")} className="underline underline-offset-2 hover:text-foreground">
              Clear filter
            </button>
          </p>
        )}
      </div>

      {/* View toggle */}
      {enableDayView && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg border bg-card p-1 w-fit">
            <button
              type="button"
              onClick={() => setView("day")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                view === "day" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <CalendarDays className="size-3.5" /> By Day
            </button>
            <button
              type="button"
              onClick={() => setView("calendar")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                view === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Calendar className="size-3.5" /> Calendar
            </button>
            <button
              type="button"
              onClick={() => setView("prepmaster")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                view === "prepmaster" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Users className="size-3.5" /> By PrepMaster
            </button>
          </div>
          {view === "day" && (
            <button
              type="button"
              onClick={() => setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
              className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              <ArrowUpDown className="size-3.5" />
              {sortOrder === "asc" ? "Earliest first" : "Latest first"}
            </button>
          )}
        </div>
      )}

      {/* Search by name */}
      {view !== "calendar" && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={view === "day" ? "Search by PrepMaster or dancer name…" : "Search by PrepMaster name…"}
            className="w-full rounded-lg border bg-background py-2 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      {/* Calendar view: month grid, click a day to pop out its bookings */}
      {view === "calendar" ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className="grid grid-cols-7 border-b bg-muted/40">
              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
                <div key={d} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {calendarWeeks.flat().map((cell, i) => {
                const bookings = cell.dateIso ? dayLookup.get(cell.dateIso) ?? [] : []
                const isToday = cell.dateIso === new Date().toISOString().slice(0, 10)
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!cell.dateIso}
                    onClick={() => cell.dateIso && setCalSelectedDate(cell.dateIso)}
                    className={cn(
                      "aspect-square border-b border-r p-2 flex flex-col items-center justify-center gap-1 text-center transition-colors last:border-r-0",
                      !cell.dateIso && "bg-muted/10",
                      cell.dateIso && "hover:bg-muted/40",
                    )}
                  >
                    {cell.dayNum && (
                      <span className={cn(
                        "text-xl sm:text-2xl font-bold tabular-nums leading-none",
                        isToday && "flex items-center justify-center size-8 sm:size-9 rounded-full bg-primary text-primary-foreground text-base sm:text-lg",
                      )}>
                        {cell.dayNum}
                      </span>
                    )}
                    {bookings.length > 0 && (
                      <span className="text-[11px] sm:text-xs font-semibold text-primary tabular-nums">
                        {bookings.length} booking{bookings.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Pop-out panel for the selected day */}
          {calSelectedDate && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              onClick={() => setCalSelectedDate(null)}
            >
              <div
                className="w-full max-w-md max-h-[80vh] rounded-xl border bg-card shadow-xl overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-muted/40">
                  <p className="text-sm font-bold">{formatDayHeading(calSelectedDate)}</p>
                  <button
                    type="button"
                    onClick={() => setCalSelectedDate(null)}
                    className="rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    aria-label="Close"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="overflow-y-auto">
                  {(dayLookup.get(calSelectedDate) ?? []).length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted-foreground italic text-center">No bookings this day.</p>
                  ) : (
                    <div className="flex flex-col">
                      {(dayLookup.get(calSelectedDate) ?? []).map((bk) => (
                        <div key={bk.id} className="flex items-center gap-3 px-4 py-3 border-b last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{bk.pmName}</p>
                            <p className="text-xs text-muted-foreground truncate">{bk.dancerName || "Member"}</p>
                          </div>
                          <div className="w-24 shrink-0 text-right">
                            <LocalTime
                              slot={bk.time}
                              dateIso={bk.date}
                              utcDatetime={bk.utcDatetime}
                              className="text-xs text-muted-foreground"
                            />
                          </div>
                          <Badge
                            variant={STATUS_BADGE[bk.status]?.variant}
                            className={cn("shrink-0", STATUS_BADGE[bk.status]?.className)}
                          >
                            {STATUS_LABELS[bk.status] ?? bk.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : view === "day" ? (
        loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Loading…
          </div>
        ) : dayGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <CalendarDays className="size-10 opacity-30" />
            <p className="text-sm">
              {search.trim()
                ? `No bookings match "${search.trim()}".`
                : statusFilter === "all"
                  ? "No bookings found for this month."
                  : `No ${STATUS_LABELS[statusFilter].toLowerCase()} bookings this month.`}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {dayGroups.map(([dateKey, bookings]) => {
              const isOpen = statusFilter !== "all" || openDays.has(dateKey)
              return (
                <div key={dateKey} className="rounded-xl border bg-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleDay(dateKey)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted/40 transition-colors bg-muted/40"
                  >
                    <span className="text-sm font-bold">{formatDayHeading(dateKey)}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{bookings.length} booking{bookings.length !== 1 ? "s" : ""}</span>
                      <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="flex flex-col border-t">
                      {bookings.map((bk) => (
                        <div
                          key={bk.id}
                          className="flex items-center gap-3 px-4 py-3 border-b last:border-0"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{bk.pmName}</p>
                            <p className="text-xs text-muted-foreground truncate">{bk.dancerName || "Member"}</p>
                          </div>
                          <div className="w-28 shrink-0 text-right">
                            <LocalTime
                              slot={bk.time}
                              dateIso={bk.date}
                              utcDatetime={bk.utcDatetime}
                              className="text-xs text-muted-foreground"
                            />
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0 w-28">
                            <Badge
                              variant={STATUS_BADGE[bk.status]?.variant}
                              className={cn("shrink-0", STATUS_BADGE[bk.status]?.className)}
                            >
                              {STATUS_LABELS[bk.status] ?? bk.status}
                            </Badge>
                            {bk.isReschedulePending && (
                              <Badge className="shrink-0 border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-400">
                                Rescheduled
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      ) : loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          Loading…
        </div>
      ) : visibleTeam.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Users className="size-10 opacity-30" />
          <p className="text-sm">
            {search.trim()
              ? `No PrepMasters match "${search.trim()}".`
              : statusFilter === "all"
                ? "No PrepMasters found for this month."
                : `No ${STATUS_LABELS[statusFilter].toLowerCase()} bookings this month.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleTeam.map(({ pm, bookings }) => {
            const isOpen = statusFilter !== "all" || openIds.has(pm.name)
            const counts = bookings.reduce(
              (a, b) => { a[b.status] = (a[b.status] ?? 0) + 1; return a },
              {} as Record<string, number>,
            )

            return (
              <div
                key={pm.name}
                className={cn(
                  "rounded-xl border bg-card overflow-hidden transition-colors",
                  isOpen && "border-primary/60",
                )}
              >
                <button
                  onClick={() => togglePM(pm.name)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40 transition-colors"
                >
                  <div className="size-9 shrink-0 rounded-full bg-primary/15 text-primary font-bold text-xs flex items-center justify-center">
                    {initials(pm.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{pm.name}</p>
                    {pm.university ? (() => {
                      const { bg, text } = getUniversityColor(pm.university)
                      return (
                        <span
                          className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none"
                          style={{ backgroundColor: bg, color: text }}
                        >
                          {pm.university}
                        </span>
                      )
                    })() : (
                      <p className="text-xs text-muted-foreground">—</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {counts.pending > 0 && (
                      <Badge {...STATUS_BADGE.pending}>{counts.pending} pending</Badge>
                    )}
                    {counts.confirmed > 0 && (
                      <Badge {...STATUS_BADGE.confirmed}>{counts.confirmed} confirmed</Badge>
                    )}
                    {counts.completed > 0 && (
                      <Badge {...STATUS_BADGE.completed}>{counts.completed} completed</Badge>
                    )}
                    {counts.canceled > 0 && (
                      <Badge {...STATUS_BADGE.canceled}>{counts.canceled} canceled</Badge>
                    )}
                    {bookings.length === 0 && (
                      <span className="text-xs text-muted-foreground">No bookings</span>
                    )}
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>

                {isOpen && (
                  <div className="border-t">
                    {bookings.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted-foreground italic">
                        No bookings this month.
                      </p>
                    ) : (
                      bookings.map((bk) => {
                        const { day, mon } = formatDate(bk.date)
                        return (
                          <div
                            key={bk.id}
                            className="flex items-center gap-3 px-4 py-3 border-b last:border-0"
                          >
                            <div className="w-8 shrink-0 text-center">
                              <div className="text-base font-bold tabular-nums leading-none">{day}</div>
                              <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{mon}</div>
                            </div>
                            <div className="w-px h-8 bg-border shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{bk.dancerName || "Member"}</p>
                              <LocalTime
                                slot={bk.time}
                                dateIso={bk.date}
                                utcDatetime={bk.utcDatetime}
                                className="text-xs text-muted-foreground"
                              />
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <Badge
                                variant={STATUS_BADGE[bk.status]?.variant}
                                className={cn("shrink-0", STATUS_BADGE[bk.status]?.className)}
                              >
                                {STATUS_LABELS[bk.status] ?? bk.status}
                              </Badge>
                              {bk.isReschedulePending && (
                                <Badge className="shrink-0 border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-400">
                                  Rescheduled
                                </Badge>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
