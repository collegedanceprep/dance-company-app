"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import type { AdminMember, AdminBooking, AdminWorker, MemberPlan } from "@/lib/airtable"
import { SINGLE_HOUR_PRICE } from "@/lib/packages"

// Revenue = $115/hr × duration fraction, regardless of pack or single
const SESSION_REVENUE_FRACTION: Record<string, number> = {
  "private-30": 0.5,
  "private-45": 0.75,
  "private-60": 1,
  "pack-hour": 1,
  "private-90": 1.5,
}

function sessionRevenue(booking: AdminBooking) {
  const fraction = SESSION_REVENUE_FRACTION[booking.sessionType ?? ""] ?? 1
  return SINGLE_HOUR_PRICE * fraction
}
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { BookingFilterBar, applyFilters, type SortDir } from "@/components/booking-filter-bar"
import { TrendingUp, DollarSign, CalendarDays, Users, Award, Activity, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search, Clock, CheckCircle, XCircle, AlertCircle } from "lucide-react"
import { LocalTime } from "@/components/local-time"

type Props = {
  members: AdminMember[]
  bookings: AdminBooking[]
  workers: AdminWorker[]
  plans: MemberPlan[]
}

const COMPANY_TZ = process.env.NEXT_PUBLIC_COMPANY_TIMEZONE ?? "America/New_York"

// A bare Date with no stored UTC Datetime must NOT be parsed as-is —
// `new Date("2026-10-01")` means midnight UTC, which is already hours in
// the past by US evening time even though the real session (e.g. 5:30 AM
// local) hasn't happened yet. Combine Date + Time in the company timezone
// instead of treating the date alone as a UTC instant.
function fallbackUtcMs(date: string, timeStr: string): number {
  const match = timeStr.match(/(\d+)(?::(\d+))?\s*(AM|PM)/i)
  if (!match) return 0
  let h = parseInt(match[1])
  const m = match[2] ? parseInt(match[2]) : 0
  if (match[3].toUpperCase() === "PM" && h !== 12) h += 12
  if (match[3].toUpperCase() === "AM" && h === 12) h = 0
  const [year, mo, day] = date.split("-").map(Number)
  const seed = new Date(Date.UTC(year, mo - 1, day, h + 5, m))
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: COMPANY_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(seed)
  const etH = parseInt(parts.find((p) => p.type === "hour")!.value)
  const etM = parseInt(parts.find((p) => p.type === "minute")!.value)
  const diffMs = ((etH * 60 + etM) - (h * 60 + m)) * 60_000
  return seed.getTime() - diffMs
}

function isSessionPast(b: { utcDatetime?: string | null; date?: string | null; time?: string | null }): boolean {
  const t = b.utcDatetime
    ? new Date(b.utcDatetime).getTime()
    : b.date && b.time ? fallbackUtcMs(b.date, b.time) : b.date ? new Date(b.date).getTime() : 0
  return t > 0 && t <= Date.now()
}

function monthKeyFromOffset(offset: number) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

function monthLabel(key: string) {
  const [year, month] = key.split("-")
  return new Date(Number(year), Number(month) - 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  })
}

export function AdminOverviewPanel({ members, bookings, workers }: Props) {
  const router = useRouter()
  const workerIdByName = new Map(workers.map((w) => [w.name, w.id]))
  const [sheetOpen, setSheetOpen] = useState(false)
  const [revenueSheetOpen, setRevenueSheetOpen] = useState(false)
  const [sheetSort, setSheetSort] = useState<SortDir>("asc")
  const [sheetSearch, setSheetSearch] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [monthOffset, setMonthOffset] = useState(0)

  const monthKey = monthKeyFromOffset(monthOffset)
  const [sheetMonth, setSheetMonth] = useState(monthKey)
  const thisMonth = bookings.filter((b) => b.date?.startsWith(monthKey))
  const confirmed = thisMonth.filter((b) => b.status.toLowerCase() === "confirmed" && !isSessionPast(b))
  // Includes late cancels on purpose — they still bill, so revenue/payOwed below
  // need them in "completed." The KPI breakdown below uses its own mutually
  // exclusive counts instead, so a late cancel isn't shown in both buckets.
  const completed = thisMonth.filter((b) => b.status.toLowerCase() !== "cancelled" && isSessionPast(b))
  const cancelled = thisMonth.filter((b) => b.status.toLowerCase().startsWith("cancelled"))

  // Mutually exclusive status counts for the "Bookings this month" breakdown —
  // each booking lands in exactly one bucket so the sub-counts always sum to
  // thisMonth.length. (The financial `completed` above deliberately overlaps
  // with late cancels; this doesn't.)
  const pendingCount = thisMonth.filter((b) => b.status.toLowerCase() === "pending").length
  const confirmedCount = confirmed.length
  const completedCount = thisMonth.filter((b) => b.status.toLowerCase() === "confirmed" && isSessionPast(b)).length
  const cancelledCount = cancelled.length
  const declinedCount = thisMonth.filter((b) => b.status.toLowerCase() === "declined").length

  // Revenue = sum of per-session price based on session type
  const revenue = completed.reduce((sum, b) => sum + sessionRevenue(b), 0)

  // Pay owed = PrepMaster's hourly rate × session duration fraction
  const SESSION_DURATION: Record<string, number> = {
    "private-30": 0.5,
    "private-45": 0.75,
    "private-60": 1,
    "pack-hour": 1,
    "private-90": 1.5,
  }
  const workerRateMap = new Map(workers.map((w) => [w.name, w.hourlyRate]))
  const payOwed = completed.reduce((sum, b) => {
    const rate = workerRateMap.get(b.prepMasterName) ?? 0
    const fraction = SESSION_DURATION[b.sessionType ?? ""] ?? 1
    return sum + rate * fraction
  }, 0)
  const margin = revenue - payOwed

  // All-time totals
  const allCompleted = bookings.filter((b) => b.status.toLowerCase() !== "cancelled" && isSessionPast(b))
  const allRevenue = allCompleted.reduce((sum, b) => sum + sessionRevenue(b), 0)

  // Top PrepMasters this month by completed booking count
  const pmCounts = new Map<string, number>()
  for (const b of completed) {
    if (b.prepMasterName) pmCounts.set(b.prepMasterName, (pmCounts.get(b.prepMasterName) ?? 0) + 1)
  }
  const topPMs = Array.from(pmCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  // Active members (have at least 1 credit or have booked)
  const activeMembers = members.length
  const activePMs = workers.filter((w) => w.active).length

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setMonthOffset((o) => o - 1); setSheetMonth(monthKeyFromOffset(monthOffset - 1)) }}
              className="rounded p-1 hover:bg-muted transition-colors"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4 text-muted-foreground" />
            </button>
            <h2 className="font-heading text-xl font-bold tracking-tight">{monthLabel(monthKey)}</h2>
            <button
              onClick={() => { setMonthOffset((o) => o + 1); setSheetMonth(monthKeyFromOffset(monthOffset + 1)) }}
              className="rounded p-1 hover:bg-muted transition-colors"
              aria-label="Next month"
            >
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground">Company performance snapshot</p>
        </div>
        <Badge variant="outline" className="border-green-300 bg-green-100 text-green-700">Live</Badge>
      </div>

      {/* This month KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<CalendarDays className="size-4 text-primary" />}
          label="Bookings this month"
          value={String(thisMonth.length)}
          sub={`${pendingCount} pending · ${confirmedCount} confirmed · ${completedCount} completed · ${cancelledCount} cancelled${declinedCount > 0 ? ` · ${declinedCount} declined` : ""}`}
          onClick={() => setSheetOpen(true)}
        />
        <KpiCard
          icon={<DollarSign className="size-4 text-green-600" />}
          label="Revenue this month"
          value={`$${revenue.toLocaleString()}`}
          sub={`${completed.length} sessions · incl. late cancels`}
          highlight="green"
          onClick={() => setRevenueSheetOpen(true)}
        />
        <KpiCard
          icon={<TrendingUp className="size-4 text-primary" />}
          label="Margin this month"
          value={`$${margin.toLocaleString()}`}
          sub={`Pay owed: $${payOwed.toLocaleString()}`}
          highlight={margin >= 0 ? "green" : "red"}
        />
        <KpiCard
          icon={<Activity className="size-4 text-muted-foreground" />}
          label="All-time revenue"
          value={`$${allRevenue.toLocaleString()}`}
          sub={`${allCompleted.length} total sessions`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top PrepMasters this month */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Award className="size-4 text-primary" />
              Top PrepMasters this month
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topPMs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No completed sessions yet this month.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {topPMs.map(([name, count], i) => {
                  const worker = workers.find((w) => w.name === name)
                  const pay = count * (worker?.hourlyRate ?? 0)
                  return (
                    <li
                      key={name}
                      className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm ${worker ? "cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/40" : ""}`}
                      onClick={worker ? () => router.push(`/admin?tab=prep-masters&worker=${worker.id}`) : undefined}
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                          {i + 1}
                        </span>
                        <div>
                          <p className="font-medium">{name}</p>
                          {worker?.region && <p className="text-xs text-muted-foreground">{worker.region}</p>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{count} session{count !== 1 ? "s" : ""}</p>
                        <p className="text-xs text-muted-foreground">${pay.toLocaleString()} pay</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Roster snapshot */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4 text-primary" />
              Roster snapshot
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <RosterRow label="Total members" value={activeMembers} />
            <RosterRow label="Active PrepMasters" value={activePMs} />
            <RosterRow label="Inactive PrepMasters" value={workers.filter((w) => !w.active).length} />
            <div className="mt-2 border-t pt-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">All-time bookings by status</p>
              <div className="flex flex-col gap-1.5">
                <RosterRow label="Completed" value={allCompleted.length} />
                <RosterRow label="Cancelled" value={bookings.filter((b) => b.status.toLowerCase().startsWith("cancelled")).length} />
                <RosterRow label="Pending" value={bookings.filter((b) => b.status.toLowerCase() === "pending").length} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Revenue sheet */}
      <Sheet open={revenueSheetOpen} onOpenChange={setRevenueSheetOpen}>
        <SheetContent className="w-full sm:max-w-lg flex flex-col overflow-hidden">
          <SheetHeader className="mb-3 shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <DollarSign className="size-4 text-green-600" />
              Revenue — {monthLabel(monthKey)}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
            {completed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No billable sessions this month.</p>
            ) : (
              <>
                <ul className="flex flex-col gap-1.5">
                  {completed.sort((a, b) => (b.date > a.date ? 1 : -1)).map((b) => {
                    const amt = sessionRevenue(b)
                    const isLateCancelled = b.status.toLowerCase() === "cancelled (late)"
                    const sessionLabel = b.sessionType === "private-30" ? "30 min" : b.sessionType === "private-45" ? "45 min" : b.sessionType === "private-90" ? "90 min" : b.sessionType === "pack-hour" ? "Pack (60 min)" : "60 min"
                    const workerId = workerIdByName.get(b.prepMasterName)
                    return (
                      <li
                        key={b.id}
                        className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm ${workerId ? "cursor-pointer transition-colors hover:border-primary/40 hover:bg-muted/40" : ""}`}
                        onClick={workerId ? () => { setRevenueSheetOpen(false); router.push(`/admin?tab=prep-masters&worker=${workerId}`) } : undefined}
                      >
                        <div className="min-w-0">
                          <p className="font-medium truncate">{b.dancerName || b.clientEmail || "Client"}</p>
                          <p className="text-xs text-muted-foreground">
                            {b.prepMasterName}{b.date ? ` · ${b.date}` : ""}{b.time ? <> · <LocalTime slot={b.time} dateIso={b.date} utcDatetime={b.utcDatetime} /></> : ""} · {sessionLabel}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isLateCancelled && (
                            <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-700 text-xs">Late cancel</Badge>
                          )}
                          <span className="font-semibold text-green-700">${amt}</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <div className="border-t pt-3 flex items-center justify-between text-sm font-semibold">
                  <span>Total</span>
                  <span className="text-green-700">${revenue.toLocaleString()}</span>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Bookings sheet */}
      <Sheet open={sheetOpen} onOpenChange={(v) => { setSheetOpen(v); if (!v) setSheetSearch("") }}>
        <SheetContent className="w-full sm:max-w-lg flex flex-col overflow-hidden">
          <SheetHeader className="mb-3 shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <CalendarDays className="size-4 text-primary" />
              Bookings
            </SheetTitle>
          </SheetHeader>
          <div className="shrink-0 mb-3 flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search member or PrepMaster…"
                value={sheetSearch}
                onChange={(e) => setSheetSearch(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <BookingFilterBar
              bookings={bookings}
              monthKey={sheetMonth}
              sort={sheetSort}
              onMonthChange={setSheetMonth}
              onSortChange={setSheetSort}
            />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {(() => {
              const q = sheetSearch.trim().toLowerCase()
              const filtered = applyFilters(bookings, sheetMonth, sheetSort).filter((b) =>
                !q ||
                (b.dancerName || b.clientEmail || "").toLowerCase().includes(q) ||
                (b.prepMasterName || "").toLowerCase().includes(q)
              )
              if (filtered.length === 0) {
                return <p className="text-sm text-muted-foreground">No bookings for this period.</p>
              }

              function isPast(b: AdminBooking) {
                const t = b.utcDatetime ? new Date(b.utcDatetime).getTime() : b.date ? new Date(b.date).getTime() : 0
                return t > 0 && t <= Date.now()
              }
              function effectiveStatus(b: AdminBooking) {
                const s = b.status.toLowerCase()
                if (s === "confirmed" && isPast(b)) return "completed"
                return s
              }

              const STATUS_GROUPS = [
                { key: "confirmed",  label: "Confirmed",  icon: <Clock className="size-3.5 text-primary" />,                        labelClass: "text-primary" },
                { key: "pending",    label: "Pending",    icon: <AlertCircle className="size-3.5 text-amber-500" />,                 labelClass: "text-amber-500" },
                { key: "completed",  label: "Completed",  icon: <CheckCircle className="size-3.5 text-emerald-500" />,               labelClass: "text-emerald-500" },
                { key: "cancelled",  label: "Cancelled",  icon: <XCircle className="size-3.5 text-destructive" />,                   labelClass: "text-destructive" },
                { key: "declined",   label: "Declined",   icon: <XCircle className="size-3.5 text-destructive" />,                   labelClass: "text-destructive" },
                { key: "other",      label: "Other",      icon: null,                                                                labelClass: "text-muted-foreground" },
              ]

              const groups = STATUS_GROUPS.map((g) => ({
                ...g,
                items: filtered.filter((b) => {
                  const es = effectiveStatus(b)
                  if (g.key === "cancelled") return es.startsWith("cancelled")
                  if (g.key === "other") return !STATUS_GROUPS.slice(0, -1).some((sg) => sg.key === "cancelled" ? es.startsWith("cancelled") : es === sg.key)
                  return es === g.key
                }),
              })).filter((g) => g.items.length > 0)

              return (
                <div className="flex flex-col gap-3">
                  {groups.map((g) => (
                    <GroupSection key={g.key} label={g.label} count={g.items.length} icon={g.icon} labelClass={g.labelClass}>
                      <ul className="flex flex-col gap-1.5">
                        {g.items.map((b) => {
                          const es = effectiveStatus(b)
                          const isCancelled = es.startsWith("cancelled")
                          const isExpanded = expandedId === b.id
                          const badgeVariant = es === "confirmed" ? "default" : isCancelled || es === "declined" ? "destructive" : "secondary"
                          return (
                            <li key={b.id} className="rounded-md border text-sm overflow-hidden">
                              <button
                                onClick={() => setExpandedId(isExpanded ? null : b.id)}
                                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                              >
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{b.dancerName || b.clientEmail || "Client"}</p>
                                  <p className="text-xs text-muted-foreground">{b.prepMasterName}{b.date ? ` · ${b.date}` : ""}{b.time ? <> · <LocalTime slot={b.time} dateIso={b.date} utcDatetime={b.utcDatetime} /></> : ""}</p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge variant={badgeVariant} className="capitalize">{es}</Badge>
                                  {isExpanded ? <ChevronUp className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
                                </div>
                              </button>
                              {isExpanded && (
                                <div className="border-t bg-muted/30 px-3 py-2.5 flex flex-col gap-2">
                                  {isCancelled ? (
                                    <>
                                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cancellation Reason</p>
                                      <p className="text-sm">{b.cancellationReason?.trim() || <span className="italic text-muted-foreground">No reason provided.</span>}</p>
                                    </>
                                  ) : (
                                    <>
                                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notes</p>
                                      <p className="text-sm">{b.notes?.trim() || <span className="italic text-muted-foreground">No notes for this booking.</span>}</p>
                                    </>
                                  )}
                                </div>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </GroupSection>
                  ))}
                </div>
              )
            })()}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function KpiCard({
  icon, label, value, sub, highlight, onClick,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  highlight?: "green" | "red"
  onClick?: () => void
}) {
  const baseClass = highlight === "green" ? "border-green-500/30" : highlight === "red" ? "border-red-500/30" : ""
  const inner = (
    <>
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`font-heading text-2xl font-bold ${highlight === "green" ? "text-green-700" : highlight === "red" ? "text-red-600" : ""}`}>
          {value}
        </p>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </>
  )

  if (onClick) {
    return (
      <button onClick={onClick} className={`text-left w-full rounded-xl transition-shadow hover:shadow-md hover:ring-2 hover:ring-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
        <Card className={`${baseClass} pointer-events-none`}>{inner}</Card>
      </button>
    )
  }

  return <Card className={baseClass}>{inner}</Card>
}

function GroupSection({ label, count, icon, labelClass, children }: { label: string; count: number; icon: React.ReactNode; labelClass: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-1.5 px-0.5 mb-1.5"
      >
        <div className="flex items-center gap-1.5">
          {icon}
          <span className={`text-xs font-bold uppercase tracking-wide ${labelClass}`}>
            {label} <span className="font-normal text-muted-foreground">({count})</span>
          </span>
        </div>
        {open ? <ChevronUp className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
      </button>
      {open && children}
    </div>
  )
}

function RosterRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}
