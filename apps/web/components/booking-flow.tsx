"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createBooking } from "@/app/actions/booking"
import { slotsForDate, type DayAvailability } from "@/lib/availability"
import { planDisplayStatus } from "@/lib/plan-utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Check, ChevronLeft, ChevronRight, Loader2, Package, Ticket } from "lucide-react"
import { slotToLocalTime, localTimezoneAbbr, userIsInDifferentTimezone, COMPANY_TIMEZONE } from "@/lib/time"
import type { MemberPlan } from "@/lib/airtable"

type CreditOption = { plan: MemberPlan }


function toIso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// Returns the Sunday that starts the week containing `date`.
function weekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

// Builds the 7 calendar days for a week starting on `sunday`.
function buildWeekDays(sunday: Date) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + i)
    return d
  })
}

export function BookingFlow({
  prepMasterId,
  prepMasterName,
  prepMasterTimezone,
  week,
  bookedSlots,
  credits,
  plans,
}: {
  prepMasterId: string
  prepMasterName: string
  prepMasterTimezone: string
  week: DayAvailability[]
  bookedSlots: Record<string, string[]>
  credits: number
  plans: MemberPlan[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const tzAbbr = typeof window !== "undefined" && userIsInDifferentTimezone(prepMasterTimezone) ? localTimezoneAbbr() : ""
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [selectedOption, setSelectedOption] = useState<CreditOption | null>(null)
  const [selectedDuration, setSelectedDuration] = useState<"private-30" | "private-45" | "private-60" | "private-90" | null>(null)

  const DURATIONS: { value: "private-30" | "private-45" | "private-60" | "private-90"; label: string }[] = [
    { value: "private-30", label: "30 min" },
    { value: "private-45", label: "45 min" },
    { value: "private-60", label: "60 min" },
    { value: "private-90", label: "90 min" },
  ]

  // Build credit options — every active plan is a selectable option
  const creditOptions = useMemo<CreditOption[]>(() => {
    return plans
      .filter((p) => planDisplayStatus(p) === "Active")
      .map((plan) => ({ plan }))
  }, [plans])

  const effectiveOption = selectedOption ?? (creditOptions.length === 1 ? creditOptions[0] : null)
  const showCreditStep = creditOptions.length > 1
  const noStructuredCredits = creditOptions.length === 0 && credits > 0

  // Week navigation
  const currentSunday = useMemo(() => {
    const s = weekStart(today)
    s.setDate(s.getDate() + weekOffset * 7)
    return s
  }, [today, weekOffset])

  const weekDays = useMemo(() => buildWeekDays(currentSunday), [currentSunday])

  const weekLabel = useMemo(() => {
    const start = weekDays[0]
    const end = weekDays[6]
    const sameMonth = start.getMonth() === end.getMonth()
    const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-US", opts)
    if (sameMonth) {
      return `${fmt(start, { month: "long" })} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`
    }
    return `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, { month: "short", day: "numeric", year: "numeric" })}`
  }, [weekDays])

  // Slots per day in the current week
  const weekSlots = useMemo(() => {
    return weekDays.map((d) => {
      const iso = toIso(d)
      const isPast = d < today
      const slots = isPast ? [] : slotsForDate(iso, week)
      const taken = new Set(bookedSlots[iso] ?? [])
      return { date: d, iso, slots, taken, isPast }
    })
  }, [weekDays, week, bookedSlots, today])

  const canGoBack = weekOffset > 0

  function planSessionType(planName: string): import("@/lib/session-types").SessionType {
    if (planName.includes("30")) return "private-30"
    if (planName.includes("45")) return "private-45"
    if (planName.includes("60")) return "private-60"
    if (planName.includes("90")) return "private-90"
    return "private-60"
  }

  // If the active plan is a single per-private session, lock duration to that length
  const lockedDuration = useMemo<"private-30" | "private-45" | "private-60" | "private-90" | null>(() => {
    const plan = effectiveOption?.plan
    if (!plan) return null
    const st = planSessionType(plan.planName)
    if (st === "private-60") return null
    return st as "private-30" | "private-45" | "private-60" | "private-90"
  }, [effectiveOption])

  const activeDuration = lockedDuration ?? selectedDuration

  const canSubmit = selectedDate && selectedTime && activeDuration && (effectiveOption || noStructuredCredits) && !isPending

  function selectSlot(iso: string, slot: string) {
    setSelectedDate(iso)
    setSelectedTime(slot)
  }

  function handleConfirm() {
    if (!selectedDate || !selectedTime) return
    startTransition(async () => {
      const plan = effectiveOption?.plan
      const result = await createBooking({
        prepMasterId,
        prepMasterName,
        date: selectedDate,
        time: selectedTime,
        notes,
        planId: plan?.id,
        planSessions: plan?.sessions,
        sessionType: activeDuration ?? (plan ? planSessionType(plan.planName) : "private-60"),
      })
      if (result.ok) {
        toast.success("Session booked!", {
          description: `Your request with ${prepMasterName} has been sent. 1 credit used.`,
        })
        // Give the toast a moment to actually render before navigating away —
        // an immediate push/refresh can unmount it before it's ever visible,
        // especially on mobile web, making a successful booking look like it
        // silently failed.
        setTimeout(() => {
          router.push("/dashboard")
          router.refresh()
        }, 1200)
      } else if (result.error === "NO_CREDITS") {
        toast.error("Out of credits", { description: "Purchase a package to book more sessions." })
        setTimeout(() => router.push("/dashboard/packages"), 1200)
      } else {
        toast.error("Couldn't book session", { description: result.error })
        router.refresh()
      }
    })
  }

  let stepOffset = showCreditStep ? 1 : 0

  return (
    <div className="flex flex-col gap-6">
      {/* Credit selector — only shown when member has multiple active plans to choose from */}
      {showCreditStep && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <StepBadge n={1} done={!!effectiveOption} />
            <h2 className="font-heading text-lg font-bold tracking-tight">Choose your credit</h2>
          </div>
          <div className="flex flex-col gap-2">
            {creditOptions.map((opt) => {
              const active = effectiveOption?.plan.id === opt.plan.id
              const expiryDate = opt.plan.expiresAt
                ? new Date(opt.plan.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : null
              const activeSingleCount = creditOptions.filter((o) => o.plan.sessions === 1).length
              const displayCount = opt.plan.sessions === 1
                ? 1
                : Math.max(0, credits - activeSingleCount)
              return (
                <button
                  key={opt.plan.id}
                  type="button"
                  onClick={() => setSelectedOption(opt)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                    active ? "border-primary bg-primary/5" : "bg-card hover:border-primary/50",
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <Package className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    <span>
                      <span className="font-medium">{opt.plan.planName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {displayCount} {displayCount === 1 ? "credit" : "credits"} remaining
                        {expiryDate && ` · Expires ${expiryDate}`}
                      </span>
                    </span>
                  </span>
                  {active && <Check className="size-4 shrink-0 text-primary" />}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* Single-option banner */}
      {noStructuredCredits && (
        <div className="flex items-center gap-2 rounded-lg bg-accent/40 px-4 py-2.5 text-sm">
          <Ticket className="size-4 text-primary" />
          <span>
            You have <span className="font-semibold">{credits}</span>{" "}
            {credits === 1 ? "credit" : "credits"}. This booking uses 1.
          </span>
        </div>
      )}

      {!showCreditStep && !noStructuredCredits && effectiveOption && (
        <div className="flex items-center gap-2 rounded-lg bg-accent/40 px-4 py-2.5 text-sm">
          <Package className="size-4 text-primary" />
          <span>
            Using <span className="font-semibold">{effectiveOption.plan.planName}</span>. This booking uses 1 credit.
          </span>
        </div>
      )}

      {/* Week calendar — full-bleed on mobile to match app layout */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <StepBadge n={1 + stepOffset} done={!!(selectedDate && selectedTime)} />
          <h2 className="font-heading text-lg font-bold tracking-tight">
            Pick a date &amp; time
            {tzAbbr && <span className="ml-2 text-sm font-normal text-muted-foreground">{tzAbbr}</span>}
          </h2>
        </div>

        {/* Week nav */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            disabled={!canGoBack}
            className="grid size-8 place-items-center rounded-md border bg-card transition-colors hover:border-primary/50 disabled:pointer-events-none disabled:opacity-30"
            aria-label="Previous week"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-sm font-medium text-muted-foreground">{weekLabel}</span>
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w + 1)}
            className="grid size-8 place-items-center rounded-md border bg-card transition-colors hover:border-primary/50"
            aria-label="Next week"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* Calendar grid — negative margin so it goes full-bleed on mobile */}
        {/* Single scroll container so header and slots share the same grid — no scrollbar misalignment */}
        <div className="-mx-5 sm:mx-0 overflow-hidden rounded-none sm:rounded-xl border-y sm:border bg-card">
          <div className="h-[52vh] overflow-y-scroll overscroll-contain">
            <div className="grid grid-cols-7">
              {/* Sticky day headers rendered as first row inside the same grid */}
              {weekSlots.map(({ date, iso, isPast, slots }) => {
                const isSelected = selectedDate === iso
                const hasSlots = slots.length > 0
                const isToday = toIso(date) === toIso(today)
                return (
                  <div
                    key={`hdr-${iso}`}
                    className={cn(
                      "sticky top-0 z-10 flex flex-col items-center py-2.5 border-r border-b last:border-r-0 select-none bg-card/95 backdrop-blur-sm",
                      isPast || !hasSlots ? "opacity-35" : "",
                      isSelected ? "bg-primary/10" : "",
                    )}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {date.toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 flex size-7 items-center justify-center rounded-full font-heading text-sm font-bold leading-none",
                        isToday && !isSelected ? "ring-1 ring-primary text-primary" : "",
                        isSelected ? "bg-primary text-primary-foreground" : "text-foreground",
                      )}
                    >
                      {date.getDate()}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Slot rows — separate grid that shares the same container width */}
            <div className="grid grid-cols-7">
              {weekSlots.map(({ date, iso, slots, taken, isPast }) => {
                const isColSelected = selectedDate === iso
                const hasSlots = slots.length > 0
                return (
                  <div
                    key={iso}
                    className={cn(
                      "flex flex-col border-r last:border-r-0",
                      isPast || !hasSlots ? "opacity-35 pointer-events-none" : "",
                      isColSelected ? "bg-primary/5" : "",
                    )}
                  >
                    {slots.length === 0 ? (
                      <div className="flex flex-1 items-start justify-center pt-6 text-[11px] text-muted-foreground">—</div>
                    ) : (
                      slots.map((slot) => {
                        const isTaken = taken.has(slot)
                        const isSlotSelected = isColSelected && selectedTime === slot
                        const displaySlot = slotToLocalTime(slot, iso, prepMasterTimezone)
                        // Split "7:00 AM" → ["7:00", "AM"]
                        const [timePart, ampm] = displaySlot.split(" ")
                        return (
                          <button
                            key={slot}
                            type="button"
                            disabled={isTaken || isPast}
                            onClick={() => selectSlot(iso, slot)}
                            className={cn(
                              "flex flex-col items-center justify-center py-2.5 text-center transition-colors border-b last:border-b-0 touch-manipulation",
                              "disabled:cursor-not-allowed",
                              isSlotSelected
                                ? "bg-primary text-primary-foreground"
                                : isTaken
                                ? "opacity-30 cursor-not-allowed"
                                : "hover:bg-primary/10 active:bg-primary/20",
                            )}
                          >
                            <span className={cn("text-[11px] font-semibold leading-none", isSlotSelected ? "text-primary-foreground" : "text-foreground")}>
                              {timePart}
                            </span>
                            <span className={cn("text-[10px] leading-none mt-0.5", isSlotSelected ? "text-primary-foreground/80" : "text-muted-foreground")}>
                              {ampm}
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Session duration */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <StepBadge n={2 + stepOffset} done={!!activeDuration} />
          <h2 className="font-heading text-lg font-bold tracking-tight">Session length</h2>
        </div>
        <div className="flex gap-2">
          {DURATIONS.map((d) => {
            const isLocked = !!lockedDuration
            const isSelected = activeDuration === d.value
            const isDisabled = isLocked && d.value !== lockedDuration
            return (
              <button
                key={d.value}
                type="button"
                onClick={() => !isLocked && setSelectedDuration(d.value)}
                disabled={isDisabled}
                className={cn(
                  "flex flex-1 flex-col items-center rounded-lg border px-3 py-3 text-sm transition-colors",
                  isSelected ? "border-primary bg-primary/5" : "bg-card hover:border-primary/50",
                  isDisabled && "opacity-25 cursor-not-allowed pointer-events-none hover:border-border",
                )}
              >
                <span className={cn("font-bold text-base", isSelected ? "text-primary" : isDisabled ? "line-through text-muted-foreground" : "text-foreground")}>{d.label}</span>
              </button>
            )
          })}
        </div>
        {lockedDuration && (
          <p className="text-xs text-muted-foreground">Duration is fixed for this session type.</p>
        )}
      </section>

      {/* Notes */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <StepBadge n={3 + stepOffset} done={false} />
          <h2 className="font-heading text-lg font-bold tracking-tight">Anything we should know?</h2>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="notes" className="sr-only">Session notes</Label>
          <Textarea
            id="notes"
            placeholder="Goals for the session, focus areas, choreography you're working on…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />
        </div>
      </section>

      {/* Sticky confirm bar */}
      <Card className="sticky bottom-4">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            {selectedDate && selectedTime ? (
              <p className="font-medium">
                {new Date(`${selectedDate}T00:00:00`).toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}{" "}
                · {selectedTime}
                {activeDuration && ` · ${DURATIONS.find((d) => d.value === activeDuration)?.label}`}
              </p>
            ) : (
              <p className="text-muted-foreground">Select a date, time, and session length to continue.</p>
            )}
            <p className="text-muted-foreground">with {prepMasterName}</p>
          </div>
          <Button size="lg" disabled={!canSubmit} onClick={handleConfirm} className="sm:w-auto">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Confirm booking
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      className={cn(
        "grid size-6 place-items-center rounded-full text-xs font-bold",
        done ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
      )}
      aria-hidden="true"
    >
      {done ? <Check className="size-3.5" /> : n}
    </span>
  )
}
