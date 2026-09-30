"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createBookingAsPrepMaster, type PastClient } from "@/app/actions/portal-booking"
import { slotsForDate, type DayAvailability } from "@/lib/availability"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

function buildAvailableDays(week: DayAvailability[]) {
  const enabledDays = new Set(week.filter((w) => w.enabled).map((w) => w.dayOfWeek))
  const days: { iso: string; label: string }[] = []
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 1; days.length < 60; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    if (enabledDays.size > 0 && !enabledDays.has(d.getDay())) continue
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    days.push({ iso, label })
    if (enabledDays.size === 0 && days.length >= 60) break
  }
  return days
}

type Props = {
  clients: PastClient[]
  availability: DayAvailability[]
}

export function PortalBookForm({ clients, availability }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dancerEmail, setDancerEmail] = useState("")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [notes, setNotes] = useState("")

  const availableDays = buildAvailableDays(availability)
  const timeSlots = date ? slotsForDate(date, availability) : []

  function handleDateChange(val: string) {
    setDate(val)
    setTime("")
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dancerEmail || !date || !time) return
    startTransition(async () => {
      const result = await createBookingAsPrepMaster({ dancerEmail, date, time, notes })
      if (result.ok) {
        toast.success("Booking created successfully.")
        setTimeout(() => router.push("/portal"), 1200)
      } else {
        toast.error(result.error)
      }
    })
  }

  if (clients.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          You don&apos;t have any past clients yet. Once members book sessions with you, they&apos;ll appear here.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New booking details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Member</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={dancerEmail}
              onChange={(e) => setDancerEmail(e.target.value)}
              required
            >
              <option value="">Select a member…</option>
              {clients.map((c) => (
                <option key={c.email} value={c.email}>
                  {c.name}{c.email && c.name !== c.email ? ` (${c.email})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Date</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              value={date}
              onChange={(e) => handleDateChange(e.target.value)}
              required
            >
              <option value="">Select a date…</option>
              {availableDays.map((d) => (
                <option key={d.iso} value={d.iso}>{d.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Time</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              disabled={!date}
              required
            >
              <option value="">Select a time…</option>
              {timeSlots.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {date && timeSlots.length === 0 && (
              <p className="text-xs text-muted-foreground">No availability set for this day. Update your availability settings.</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Notes <span className="text-muted-foreground font-normal">(optional)</span></label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any details for the member…"
            />
          </div>

          <Button type="submit" disabled={isPending || !dancerEmail || !date || !time} className="w-fit">
            {isPending ? "Creating…" : "Create booking"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
