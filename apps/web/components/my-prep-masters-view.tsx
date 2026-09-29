"use client"

import { useState, useCallback } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Users, Search, X } from "lucide-react"
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
}: Props) {
  const [team, setTeam] = useState<TeamEntry[]>(initialTeam)
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)
  const [loading, setLoading] = useState(false)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [selectedRD, setSelectedRD] = useState(initialRdName)
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "confirmed" | "completed" | "canceled">("all")
  const [search, setSearch] = useState("")

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

      {/* Search by name */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by PrepMaster name…"
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

      {/* PrepMaster list */}
      {loading ? (
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
