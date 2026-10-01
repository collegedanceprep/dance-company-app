"use client"

import { useState, useTransition, useMemo } from "react"
import { toast } from "sonner"
import { createBookingAsAdmin, getAdminAvailableSlots } from "@/app/actions/admin"
import type { AdminMember, AdminWorker } from "@/lib/airtable"
import { PER_PRIVATE } from "@/lib/packages"
import type { SessionType } from "@/lib/session-types"
import { getUniversityColor } from "@/lib/university-colors"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Search, CalendarPlus, Check, Ticket } from "lucide-react"

const PACK_COST: Record<string, number> = { "private-30": 0.5, "private-45": 0.75, "private-60": 1, "private-90": 1.5 }

const SINGLE_CREDIT_COLORS: Record<string, string> = {
  "90": "border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  "60": "border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  "45": "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "30": "border-purple-300 bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
}

function UniversityChip({ university }: { university: string }) {
  if (!university) return null
  const { bg, text } = getUniversityColor(university)
  return (
    <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none" style={{ backgroundColor: bg, color: text }}>
      {university}
    </span>
  )
}

function MemberCreditChips({ member }: { member: AdminMember }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant="outline" className="gap-1 border-transparent" style={{ backgroundColor: "var(--tile-confirmed-bg)", color: "var(--tile-confirmed-text)" }} title="Pack credits (fractional)">
        <Ticket className="size-3" />
        {member.creditsRemaining}
      </Badge>
      {(["90", "60", "45", "30"] as const).map((min) => {
        const count = member.singleCredits?.[min] ?? 0
        if (!count) return null
        return (
          <Badge key={min} variant="outline" className={`gap-1 ${SINGLE_CREDIT_COLORS[min]}`} title={`${count} × ${min}-min single session credit${count !== 1 ? "s" : ""}`}>
            <Ticket className="size-3" />
            {count > 1 ? `${count} × ` : ""}{min} min
          </Badge>
        )
      })}
    </div>
  )
}

type Props = {
  members: AdminMember[]
  workers: AdminWorker[]
}

export function AdminBookSessionPanel({ members, workers }: Props) {
  const [isPending, startTransition] = useTransition()

  const [memberQuery, setMemberQuery] = useState("")
  const [selectedMember, setSelectedMember] = useState<AdminMember | null>(null)

  const [workerQuery, setWorkerQuery] = useState("")
  const [selectedWorker, setSelectedWorker] = useState<AdminWorker | null>(null)

  const [sessionType, setSessionType] = useState<SessionType>("private-60")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [notes, setNotes] = useState("")
  const [slots, setSlots] = useState<string[]>([])
  const [slotsLoading, setSlotsLoading] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  const activeWorkers = useMemo(() => workers.filter((w) => w.active), [workers])

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase()
    if (!q) return []
    return members.filter((m) => m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)).slice(0, 8)
  }, [memberQuery, members])

  const filteredWorkers = useMemo(() => {
    const q = workerQuery.trim().toLowerCase()
    if (!q) return activeWorkers.slice(0, 8)
    return activeWorkers.filter((w) => w.name.toLowerCase().includes(q) || w.email.toLowerCase().includes(q)).slice(0, 8)
  }, [workerQuery, activeWorkers])

  function pickMember(m: AdminMember) {
    setSelectedMember(m)
    setMemberQuery(m.name)
    // If the currently selected duration isn't affordable for this member,
    // jump to the first one that is — mirrors the member's own booking
    // screen locking duration to whatever credit they're actually using.
    if (!canAffordType(m, sessionType)) {
      const firstAffordable = PER_PRIVATE.find((p) => canAffordType(m, p.id as SessionType))
      if (firstAffordable) setSessionType(firstAffordable.id as SessionType)
    }
  }

  function pickWorker(w: AdminWorker) {
    setSelectedWorker(w)
    setWorkerQuery(w.name)
    if (date) loadSlots(w.id, date)
  }

  async function loadSlots(workerId: string, forDate: string) {
    setSlotsLoading(true)
    setTime("")
    try {
      const result = await getAdminAvailableSlots(workerId, forDate)
      setSlots(result)
    } finally {
      setSlotsLoading(false)
    }
  }

  function handleDateChange(v: string) {
    setDate(v)
    setSlots([])
    setTime("")
    if (selectedWorker && v) loadSlots(selectedWorker.id, v)
  }

  function singleCreditsFor(member: AdminMember | null, type: SessionType): number {
    const key = type.replace("private-", "") as "30" | "45" | "60" | "90"
    return member?.singleCredits?.[key] ?? 0
  }
  function canAffordType(member: AdminMember | null, type: SessionType): boolean {
    if (!member) return true
    const hasSingle = singleCreditsFor(member, type) >= 1
    const hasPack = (member.creditsRemaining ?? 0) >= (PACK_COST[type] ?? 1)
    return hasSingle || hasPack
  }

  const singleCreditKey = sessionType.replace("private-", "") as "30" | "45" | "60" | "90"
  const hasSingleCredit = singleCreditsFor(selectedMember, sessionType) >= 1
  const hasEnoughCredit = canAffordType(selectedMember, sessionType)

  const canSubmit = selectedMember && selectedWorker && date && time && !isPending

  function handleSubmit() {
    if (!selectedMember || !selectedWorker || !date || !time) return
    setSuccess(null)
    startTransition(async () => {
      const result = await createBookingAsAdmin({
        memberUserId: selectedMember.userId,
        memberEmail: selectedMember.email,
        prepMasterId: selectedWorker.id,
        date,
        time,
        sessionType,
        notes: notes || undefined,
      })
      if (result.ok) {
        toast.success("Session booked and confirmed.")
        setSuccess(`Booked ${selectedMember.name} with ${selectedWorker.name} on ${date} at ${time}.`)
        setSelectedMember(null); setMemberQuery("")
        setSelectedWorker(null); setWorkerQuery("")
        setDate(""); setTime(""); setNotes(""); setSlots([])
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarPlus className="size-4 text-primary" />
          Book a session
        </CardTitle>
        <CardDescription>
          Creates a session on behalf of a member with any PrepMaster. Goes straight to Confirmed —
          no pending approval step — and checks credit the same way a member's own booking would.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Member</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8"
                placeholder="Search by name or email…"
                value={memberQuery}
                onChange={(e) => { setMemberQuery(e.target.value); setSelectedMember(null) }}
              />
            </div>
            {!selectedMember && filteredMembers.length > 0 && (
              <div className="rounded-md border bg-card divide-y overflow-hidden">
                {filteredMembers.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => pickMember(m)}
                    className="flex w-full flex-col items-start gap-1.5 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
                  >
                    <span className="truncate">{m.name} <span className="text-muted-foreground">· {m.email}</span></span>
                    <MemberCreditChips member={m} />
                  </button>
                ))}
              </div>
            )}
            {selectedMember && (
              <div className="flex flex-col gap-1.5">
                <p className="flex items-center gap-1.5 text-xs text-green-600"><Check className="size-3.5" /> {selectedMember.name} selected</p>
                <MemberCreditChips member={selectedMember} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>PrepMaster</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-8"
                placeholder="Search by name or email…"
                value={workerQuery}
                onChange={(e) => { setWorkerQuery(e.target.value); setSelectedWorker(null) }}
                onFocus={() => setWorkerQuery((q) => q)}
              />
            </div>
            {!selectedWorker && filteredWorkers.length > 0 && (
              <div className="rounded-md border bg-card divide-y overflow-hidden">
                {filteredWorkers.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => pickWorker(w)}
                    className="flex w-full flex-col items-start gap-1 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
                  >
                    <span className="truncate">{w.name} <span className="text-muted-foreground">· {w.email}</span></span>
                    <UniversityChip university={w.university} />
                  </button>
                ))}
              </div>
            )}
            {selectedWorker && (
              <div className="flex flex-col gap-1.5">
                <p className="flex items-center gap-1.5 text-xs text-green-600"><Check className="size-3.5" /> {selectedWorker.name} selected</p>
                <UniversityChip university={selectedWorker.university} />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Session length</Label>
          <div className="flex flex-wrap gap-2">
            {PER_PRIVATE.map((p) => {
              const affordable = canAffordType(selectedMember, p.id as SessionType)
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={!affordable}
                  onClick={() => setSessionType(p.id as SessionType)}
                  title={!affordable && selectedMember ? `${selectedMember.name} doesn't have credit for a ${p.minutes}-min session.` : undefined}
                  className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                    sessionType === p.id
                      ? "border-primary bg-primary/10 text-primary"
                      : !affordable
                        ? "cursor-not-allowed opacity-40"
                        : "hover:bg-muted"
                  }`}
                >
                  {p.minutes} min
                </button>
              )
            })}
          </div>
          {selectedMember && (
            <p className={`text-xs ${hasEnoughCredit ? "text-muted-foreground" : "text-destructive"}`}>
              {hasEnoughCredit
                ? hasSingleCredit
                  ? `Uses 1 of ${selectedMember.name}'s ${singleCreditKey}-min single credits.`
                  : `Uses a pack credit (${selectedMember.creditsRemaining} remaining).`
                : `${selectedMember.name} doesn't have enough credit for a ${singleCreditKey}-min session.`}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-book-date">Date</Label>
            <Input id="admin-book-date" type="date" value={date} onChange={(e) => handleDateChange(e.target.value)} disabled={!selectedWorker} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Time</Label>
            {slotsLoading ? (
              <p className="text-sm text-muted-foreground py-2">Loading open slots…</p>
            ) : !date || !selectedWorker ? (
              <p className="text-sm text-muted-foreground py-2">Pick a PrepMaster and date first.</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2">No open slots that day.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                {slots.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTime(s)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                      time === s ? "border-primary bg-primary/10 text-primary" : "hover:bg-muted"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-book-notes">Notes (optional)</Label>
          <Input id="admin-book-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the PrepMaster should know" />
        </div>

        {success && <p className="text-sm text-green-600">{success}</p>}

        <Button onClick={handleSubmit} disabled={!canSubmit} className="self-start">
          {isPending ? "Booking…" : "Book session"}
        </Button>
      </CardContent>
    </Card>
  )
}
