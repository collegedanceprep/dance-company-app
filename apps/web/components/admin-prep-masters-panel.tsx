"use client"

import { useState, useTransition, useRef, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { updatePrepMaster, addPrepMaster, deletePrepMaster } from "@/app/actions/admin"
import type { AdminWorker, AdminBooking } from "@/lib/airtable"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ArrowLeft, Users, DollarSign, Phone, Mail, Home, CalendarDays, ChevronDown, ChevronUp, PlusCircle, X, GraduationCap, Trash2, Send } from "lucide-react"
import { getUniversityColor } from "@/lib/university-colors"
import { BookingFilterBar, applyFilters, type SortDir } from "@/components/booking-filter-bar"
import { PER_PRIVATE, PACKAGES, sessionRevenue, SESSION_DURATION_FRACTION } from "@/lib/packages"
import { LocalTime } from "@/components/local-time"

const UNIVERSITIES = [
  "Alabama","Arizona","ASU","Boise","Cincinnati","Coastal Carolina","CSU","CU Boulder",
  "ECU","Florida","FSU","GCU","Indiana","Iowa State","Kansas State","Kansas University",
  "Kentucky","Louisville","LSU Tiger Girls","Mississippi State","NC State","Ole Miss",
  "Ohio State Club Team","Oklahoma","Oregon","Penn State","Pitt","Purdue","Samford",
  "Sam Houston State","SDSU","South Carolina","TCU","Tennessee","Texas State","U Miami",
  "UCLA","UCSB","UK","UNLV","Utah","Vanderbilt","Virginia Tech","Washington",
  "Western Michigan","Wisconsin","WVU","Wichita State",
]

function isSessionPast(b: { utcDatetime?: string | null; date?: string | null }): boolean {
  const t = b.utcDatetime ? new Date(b.utcDatetime).getTime() : b.date ? new Date(b.date).getTime() : 0
  return t > 0 && t <= Date.now()
}

// Built directly from the real per-duration prices, plus Pack hour, so this
// list can never drift out of sync with actual pricing or omit a duration.
const PRICE_POINTS = [
  { sessionType: "pack-hour", label: "Pack hour", revenue: PACKAGES[0].perSession },
  ...PER_PRIVATE.map((p) => ({
    sessionType: p.id,
    label: `${p.minutes} min`,
    revenue: p.price,
  })),
]

function formatMoney(n: number) { return `$${n.toFixed(2)}` }

type Props = {
  workers: AdminWorker[]
  bookings: AdminBooking[]
  query: string
}

export function AdminPrepMastersPanel({ workers, bookings, query }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selected, setSelected] = useState<AdminWorker | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [localWorkers, setLocalWorkers] = useState<AdminWorker[]>(workers)
  const [isBulkInviting, setIsBulkInviting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<"all" | "joined" | "pending">("all")

  // Deep link from elsewhere in admin (e.g. tapping a name in the Revenue
  // sheet) — jump straight into that PrepMaster's profile.
  useEffect(() => {
    const workerId = searchParams.get("worker")
    if (!workerId) return
    const match = localWorkers.find((w) => w.id === workerId)
    if (!match) return
    setSelected(match)
    const params = new URLSearchParams(searchParams.toString())
    params.delete("worker")
    router.replace(`?${params.toString()}`, { scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const uninvited = localWorkers.filter((w) => w.inviteStatus !== "accepted" && w.email)

  async function handleBulkInvite() {
    if (uninvited.length === 0) { toast.info("All PrepMasters have already joined."); return }
    setIsBulkInviting(true)
    const results = await Promise.allSettled(
      uninvited.map((w) =>
        fetch("/api/admin/prep-masters/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: w.email, name: w.name }),
        }).then((r) => r.json())
      )
    )
    const sent = results.filter((r) => r.status === "fulfilled" && (r.value as any).ok).length
    const failed = results.length - sent
    setIsBulkInviting(false)
    if (sent > 0) toast.success(`Invite${sent === 1 ? "" : "s"} sent to ${sent} PrepMaster${sent === 1 ? "" : "s"}.`)
    if (failed > 0) toast.error(`${failed} invite${failed === 1 ? "" : "s"} failed to send.`)
  }

  const filtered = localWorkers
    .filter((w) => !query.trim() || w.name.toLowerCase().includes(query.toLowerCase()))
    .filter((w) => {
      if (statusFilter === "joined") return w.inviteStatus === "accepted"
      if (statusFilter === "pending") return w.inviteStatus !== "accepted"
      return true
    })

  if (localWorkers.length === 0 && !showAddForm) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Users className="size-10 text-muted-foreground" />
          <p className="font-medium">No PrepMasters found</p>
          <p className="text-sm text-muted-foreground">
            Add PrepMasters to the Workers table in Airtable to manage them here.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (selected) {
    return (
      <PrepMasterProfile
        worker={selected}
        bookings={bookings.filter((b) => b.prepMasterName === selected.name)}
        onBack={() => setSelected(null)}
        onSaved={(updated) => setSelected(updated)}
        onDeleted={(id) => { setLocalWorkers((prev) => prev.filter((w) => w.id !== id)); setSelected(null) }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(["all", "joined", "pending"] as const).map((f) => {
            const count = f === "all"
              ? localWorkers.length
              : f === "joined"
                ? localWorkers.filter((w) => w.inviteStatus === "accepted").length
                : localWorkers.filter((w) => w.inviteStatus !== "accepted").length
            return (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  statusFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {f === "all" ? "All" : f === "joined" ? "Joined" : "Pending"} ({count})
              </button>
            )
          })}
        </div>
        <div className="flex gap-2">
          {uninvited.length > 0 && (
            <Button size="sm" variant="outline" onClick={handleBulkInvite} disabled={isBulkInviting}>
              <Send className="mr-1.5 size-3.5" />
              {isBulkInviting ? "Sending…" : `Send ${uninvited.length} pending invite${uninvited.length === 1 ? "" : "s"}`}
            </Button>
          )}
          <Button size="sm" onClick={() => setShowAddForm((v) => !v)} variant={showAddForm ? "outline" : "default"}>
            {showAddForm ? <><X className="mr-1.5 size-3.5" />Cancel</> : <><PlusCircle className="mr-1.5 size-3.5" />Add PrepMaster</>}
          </Button>
        </div>
      </div>

      {showAddForm && (
        <AddPrepMasterForm
          onSuccess={(worker) => {
            setLocalWorkers((prev) => [worker, ...prev])
            setShowAddForm(false)
          }}
        />
      )}

      {filtered.length === 0 && !showAddForm && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {query ? <>No PrepMasters match &ldquo;{query}&rdquo;.</> : "No PrepMasters yet."}
        </p>
      )}
      {filtered.map((worker) => {
        const sessionCount = bookings.filter(
          (b) => b.prepMasterName === worker.name && b.status.toLowerCase() !== "cancelled",
        ).length
        return (
          <Card
            key={worker.id}
            className="cursor-pointer transition-colors hover:border-primary/40"
            onClick={() => setSelected(worker)}
          >
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-1.5 text-base">
                    <span className="truncate">{worker.name}</span>
                    {worker.active && (
                      <span className="inline-block size-2 shrink-0 rounded-full bg-green-500" title="Active" />
                    )}
                  </CardTitle>
                  <CardDescription className="truncate">{worker.email}</CardDescription>
                  {worker.university ? (() => {
                    const { bg, text } = getUniversityColor(worker.university)
                    return (
                      <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none" style={{ backgroundColor: bg, color: text }}>
                        {worker.university}
                      </span>
                    )
                  })() : null}
                </div>
                <div className="flex flex-wrap shrink-0 items-center justify-end gap-3">
                  <div className="text-right">
                    <p className="text-sm font-semibold">${worker.hourlyRate.toFixed(2)}/session</p>
                    <p className="text-xs text-muted-foreground">{sessionCount} session{sessionCount === 1 ? "" : "s"}</p>
                  </div>
                  {!worker.active && (
                    <Badge variant="outline" className="border-gray-200 bg-gray-100 text-gray-500">
                      Inactive
                    </Badge>
                  )}
                  <Badge variant="outline" className={
                    worker.inviteStatus === "accepted"
                      ? "border-blue-300 bg-blue-100 text-blue-700"
                      : worker.inviteStatus === "revoked"
                        ? "border-red-200 bg-red-50 text-red-500"
                        : "border-amber-300 bg-amber-100 text-amber-700"
                  }>
                    {worker.inviteStatus === "accepted" ? "Joined" : worker.inviteStatus === "revoked" ? "Revoked" : "Pending"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
          </Card>
        )
      })}
    </div>
  )
}

function UniversityDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const chipProps = value ? getUniversityColor(value) : null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {chipProps ? (
          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ backgroundColor: chipProps.bg, color: chipProps.text }}>
            {value}
          </span>
        ) : (
          <span className="text-muted-foreground">— None —</span>
        )}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-input bg-background p-2 shadow-md">
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false) }}
            className="mb-1.5 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
          >
            — None —
          </button>
          <div className="flex flex-wrap gap-1.5">
            {UNIVERSITIES.map((u) => {
              const { bg, text } = getUniversityColor(u)
              const isSelected = value === u
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => { onChange(u); setOpen(false) }}
                  className="rounded-full px-2.5 py-1 text-xs font-semibold transition-opacity"
                  style={{
                    backgroundColor: bg,
                    color: text,
                    opacity: isSelected ? 1 : 0.5,
                    outline: isSelected ? `2px solid ${text}` : "none",
                    outlineOffset: "1px",
                  }}
                >
                  {u}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  icon,
  value,
  type = "text",
  onChange,
}: {
  label: string
  icon: React.ReactNode
  value: string
  type?: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  )
}

function PrepMasterProfile({
  worker,
  bookings,
  onBack,
  onSaved,
  onDeleted,
}: {
  worker: AdminWorker
  bookings: AdminBooking[]
  onBack: () => void
  onSaved: (w: AdminWorker) => void
  onDeleted: (id: string) => void
}) {
  const [name, setName] = useState(worker.name)
  const [email, setEmail] = useState(worker.email)
  const [phone, setPhone] = useState(worker.phone)
  const [university, setUniversity] = useState(worker.university)
  const [address, setAddress] = useState(worker.address)
  const [hourlyRate, setHourlyRate] = useState(String(worker.hourlyRate))
  const [active, setActive] = useState(worker.active)
  const [isPending, startTransition] = useTransition()
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSendingInvite, setIsSendingInvite] = useState(false)
  const [infoOpen, setInfoOpen] = useState(true)
  const [historyOpen, setHistoryOpen] = useState(true)

  const completedBookings = bookings.filter((b) => b.status.toLowerCase() !== "cancelled" && isSessionPast(b))

  async function handleSendInvite() {
    const targetEmail = email.trim()
    const targetName = name.trim()
    if (!targetEmail) { toast.error("This PrepMaster has no email address."); return }
    setIsSendingInvite(true)
    try {
      const res = await fetch("/api/admin/prep-masters/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: targetEmail, name: targetName }),
      })
      const data = await res.json()
      if (!res.ok) toast.error(data.error ?? "Failed to send invite.")
      else if (data.emailError) toast.error(`Invite created but email failed: ${data.emailError}`)
      else toast.success(`Invite sent to ${targetEmail}`)
    } catch {
      toast.error("Failed to send invite.")
    } finally {
      setIsSendingInvite(false)
    }
  }

  function handleDelete() {
    if (!window.confirm(`Permanently delete ${worker.name}? This removes them from Airtable and their login account. This cannot be undone.`)) return
    setIsDeleting(true)
    startTransition(async () => {
      const result = await deletePrepMaster(worker.id, worker.email)
      setIsDeleting(false)
      if (result.ok) { toast.success(`${worker.name} has been deleted.`); onDeleted(worker.id) }
      else toast.error(result.error)
    })
  }

  function handleSave() {
    startTransition(async () => {
      const rate = parseFloat(hourlyRate)
      if (Number.isNaN(rate) || rate < 0) {
        toast.error("Hourly rate must be a valid number.")
        return
      }
      const result = await updatePrepMaster(worker.id, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        university: university.trim(),
        hourlyRate: rate,
        active,
      })
      if (result.ok) {
        toast.success("PrepMaster updated.")
        onSaved({ ...worker, name: name.trim(), email: email.trim(), phone: phone.trim(), address: address.trim(), university: university.trim(), hourlyRate: rate, active })
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="size-4" />
          All PrepMasters
        </Button>
      </div>

      <Card>
        <CardHeader className="cursor-pointer" onClick={() => setInfoOpen((v) => !v)}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>{worker.name}</CardTitle>
              <CardDescription>Edit PrepMaster profile, pay rate, and status</CardDescription>
              {worker.university && (() => {
                const { bg, text } = getUniversityColor(worker.university)
                return (
                  <span className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none" style={{ backgroundColor: bg, color: text }}>
                    {worker.university}
                  </span>
                )
              })()}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className={active ? "border-green-300 bg-green-100 text-green-700" : "border-gray-200 bg-gray-100 text-gray-500"}>{active ? "Active" : "Inactive"}</Badge>
              {infoOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
        {infoOpen && (
          <CardContent className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" icon={<Users className="size-3.5" />} value={name} onChange={setName} />
              <Field label="Email" icon={<Mail className="size-3.5" />} value={email} onChange={setEmail} type="email" />
              <Field label="Phone" icon={<Phone className="size-3.5" />} value={phone} onChange={setPhone} type="tel" />
              <Field label="Address" icon={<Home className="size-3.5" />} value={address} onChange={setAddress} />
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <GraduationCap className="size-3.5" />
                  University
                </label>
                <UniversityDropdown value={university} onChange={setUniversity} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <DollarSign className="size-3.5" />
                  Pay rate per session ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-lg border p-3">
              <input
                id="active-toggle"
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
                className="size-4 rounded border-input accent-primary"
              />
              <label htmlFor="active-toggle" className="text-sm font-medium cursor-pointer">
                Active — visible to dancers for booking
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <Button disabled={isPending || isDeleting} onClick={handleSave}>
                  {isPending ? "Saving…" : "Save changes"}
                </Button>
                <Button variant="ghost" onClick={onBack} disabled={isPending || isDeleting}>Cancel</Button>
                <Button variant="outline" size="sm" onClick={handleSendInvite} disabled={isSendingInvite || isPending || isDeleting}>
                  <Send className="mr-1.5 size-3.5" />
                  {isSendingInvite ? "Sending…" : worker.inviteStatus === "accepted" ? "Resend invite" : "Send invite"}
                </Button>
              </div>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isPending || isDeleting}>
                <Trash2 className="mr-1.5 size-3.5" />
                {isDeleting ? "Deleting…" : "Delete PrepMaster"}
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Payroll summary */}
      {bookings.length > 0 && (() => {
        const payRatePerHour = worker.hourlyRate
        const totalPay = completedBookings.reduce((sum, b) => {
          const fraction = SESSION_DURATION_FRACTION[b.sessionType ?? ""] ?? 1
          return sum + payRatePerHour * fraction
        }, 0)
        const totalRevenue = completedBookings.reduce((sum, b) => sum + sessionRevenue(b.sessionType), 0)
        const margin = totalRevenue - totalPay
        return (
          <div className="flex flex-col gap-3">
            <h3 className="flex items-center gap-2 font-heading text-base font-semibold">
              <DollarSign className="size-4 text-muted-foreground" />
              Payroll
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Pay rate / hr" value={formatMoney(payRatePerHour)} />
              <StatTile label="Total sessions" value={String(completedBookings.length)} />
              <StatTile label="Total pay owed" value={formatMoney(totalPay)} highlight />
              <StatTile label="Revenue" value={formatMoney(totalRevenue)} sub={`Margin ${formatMoney(margin)}`} />
            </div>
            <div className="rounded-lg border p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Margin by session type</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
                {PRICE_POINTS.map(({ sessionType, label, revenue }) => {
                  const fraction = SESSION_DURATION_FRACTION[sessionType] ?? 1
                  const m = revenue - payRatePerHour * fraction
                  return (
                    <div key={label} className="flex flex-col">
                      <span className="text-[11px] text-muted-foreground">{label}</span>
                      <span className="text-sm font-semibold">
                        {formatMoney(revenue)}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">charged</span>
                      </span>
                      <span className={`text-xs font-medium ${m < 0 ? "text-destructive" : "text-green-600"}`}>
                        {m < 0 ? "−" : "+"}{formatMoney(Math.abs(m))} margin
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Booking history */}
      <div className="flex flex-col gap-3">
        <button
          className="flex items-center justify-between gap-2 text-left"
          onClick={() => setHistoryOpen((v) => !v)}
        >
          <h3 className="flex items-center gap-2 font-heading text-base font-semibold">
            <CalendarDays className="size-4 text-muted-foreground" />
            Booking history ({bookings.length})
          </h3>
          {historyOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </button>
        {historyOpen && (
          bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bookings yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              <BookingHistoryList bookings={bookings} />
            </div>
          )
        )}
      </div>
    </div>
  )
}

function BookingHistoryList({ bookings }: { bookings: AdminBooking[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [monthKey, setMonthKey] = useState("")
  const [sort, setSort] = useState<SortDir>("desc")

  const visible = applyFilters(bookings, monthKey, sort)

  return (
    <div className="flex flex-col gap-2">
      <BookingFilterBar
        bookings={bookings}
        monthKey={monthKey}
        sort={sort}
        onMonthChange={setMonthKey}
        onSortChange={setSort}
      />
      {visible.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">No bookings match the selected filter.</p>
      )}
    <ul className="flex flex-col gap-1.5">
      {visible.map((b) => {
        const isCancelled = b.status.toLowerCase().startsWith("cancelled")
        const isOpen = expanded === b.id
        const statusVariant =
          b.status.toLowerCase() === "confirmed"
            ? "default"
            : isCancelled
              ? "destructive"
              : "secondary"

        return (
          <li key={b.id} className="rounded-md border text-sm overflow-hidden">
            <button
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
              onClick={() => setExpanded(isOpen ? null : b.id)}
            >
              <div className="min-w-0">
                <span className="font-medium">{b.dancerName || b.clientEmail || "Client"}</span>
                <span className="ml-2 text-muted-foreground">
                  {b.date}{b.time ? <> · <LocalTime slot={b.time} dateIso={b.date} utcDatetime={b.utcDatetime} /></> : ""}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={statusVariant} className="capitalize">{b.status}</Badge>
                {isOpen ? <ChevronUp className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
              </div>
            </button>

            {isOpen && (
              <div className="border-t bg-muted/30 px-3 py-3 flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground">Dancer</span>
                    <p className="font-medium">{b.dancerName || "—"}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Email</span>
                    <p className="font-medium break-all">{b.clientEmail || "—"}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Date</span>
                    <p className="font-medium">{b.date || "—"}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Time</span>
                    <p className="font-medium">{b.time ? <LocalTime slot={b.time} dateIso={b.date} utcDatetime={b.utcDatetime} /> : "—"}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Status</span>
                    <p className="font-medium capitalize">{b.status}</p>
                  </div>
                </div>
                {b.notes && (
                  <div className="mt-1 rounded-md bg-background border px-3 py-2">
                    <span className="text-xs text-muted-foreground">Notes</span>
                    <p className="mt-0.5 text-sm">{b.notes}</p>
                  </div>
                )}
                {!b.notes && (
                  <p className="text-xs text-muted-foreground italic">No notes on this booking.</p>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
    </div>
  )
}

function StatTile({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-primary/30 bg-primary/5" : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-bold ${highlight ? "text-primary" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function AddPrepMasterForm({ onSuccess }: { onSuccess: (worker: AdminWorker) => void }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [hourlyRate, setHourlyRate] = useState("")
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await addPrepMaster({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        hourlyRate: parseFloat(hourlyRate) || 0,
      })
      if (result.ok) {
        toast.success(`${name.trim()} has been added as a PrepMaster.`)
        onSuccess(result.worker)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PlusCircle className="size-4 text-primary" />
          Add new PrepMaster
        </CardTitle>
        <CardDescription>
          Creates a profile in Airtable and grants sign-in access. They&apos;ll see their portal when they log in with this email.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pm-name">Full name <span className="text-destructive">*</span></Label>
              <Input id="pm-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pm-email">Email <span className="text-destructive">*</span></Label>
              <Input id="pm-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pm-phone">Phone</Label>
              <Input id="pm-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 000-0000" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pm-rate">Pay rate per session ($)</Label>
              <Input id="pm-rate" type="number" min="0" step="0.01" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add PrepMaster"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
