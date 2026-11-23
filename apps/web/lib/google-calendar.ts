import { db } from "@/lib/db"
import { googleCalendarToken } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3"

import { createHmac, timingSafeEqual } from "crypto"

// The OAuth state carries the user id. It is signed (and expires) so the callback can trust it
// even when the browser that finishes the flow has no session cookie (the mobile in-app browser).
function signState(payload: string): string {
  const exp = Date.now() + 15 * 60_000
  const body = `${payload}:${exp}`
  const sig = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(body).digest("hex").slice(0, 32)
  return `${body}:${sig}`
}

/** Returns the unsigned payload ("userId:source:role") if the signature is valid and unexpired. */
export function verifyState(raw: string): string | null {
  const i = raw.lastIndexOf(":")
  const j = raw.lastIndexOf(":", i - 1)
  if (i < 0 || j < 0) return null
  const payload = raw.slice(0, j)
  const exp = Number(raw.slice(j + 1, i))
  const sig = raw.slice(i + 1)
  if (!Number.isFinite(exp) || exp < Date.now()) return null
  const expect = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(`${payload}:${exp}`).digest("hex").slice(0, 32)
  if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null
  return payload
}

export function getCalendarAuthUrl(state: string, source?: "mobile") {
  const stateParam = signState(source ? `${state}:${source}` : state)
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback/google-calendar`,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy",
    access_type: "offline",
    prompt: "consent",
    state: stateParam,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

async function refreshAccessToken(userId: string, refreshToken: string) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  if (!res.ok) throw new Error("Failed to refresh Google token")
  const data = await res.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000)
  await db
    .update(googleCalendarToken)
    .set({ accessToken: data.access_token, expiresAt, updatedAt: new Date() })
    .where(eq(googleCalendarToken.userId, userId))
  return data.access_token as string
}

async function getAccessToken(userId: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(googleCalendarToken)
    .where(eq(googleCalendarToken.userId, userId))
  if (!row) return null
  if (row.expiresAt > new Date()) return row.accessToken
  if (!row.refreshToken) return null
  return refreshAccessToken(userId, row.refreshToken)
}

export async function isCalendarConnected(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: googleCalendarToken.id })
    .from(googleCalendarToken)
    .where(eq(googleCalendarToken.userId, userId))
  return !!row
}

export async function saveCalendarTokens(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000)
  const id = crypto.randomUUID()
  await db
    .insert(googleCalendarToken)
    .values({ id, userId, accessToken, refreshToken, expiresAt })
    .onConflictDoUpdate({
      target: googleCalendarToken.userId,
      set: { accessToken, refreshToken, expiresAt, updatedAt: new Date() },
    })
}

export async function disconnectCalendar(userId: string) {
  await db.delete(googleCalendarToken).where(eq(googleCalendarToken.userId, userId))
}

const SESSION_DURATION: Record<string, number> = {
  "private-30": 30,
  "private-45": 45,
  "private-60": 60,
  "private-90": 90,
  "pack-hour": 60,
}

// Formats a UTC timestamp as an Airtable-style slot string ("10:00 AM", "1:30 PM")
// in the given timezone. Uses formatToParts to avoid the narrow no-break space
// (U+202F) that toLocaleTimeString inserts between digits and AM/PM in Node 18+.
function formatSlotInTz(utcMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(utcMs))
  const hour = parts.find((p) => p.type === "hour")?.value ?? "12"
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00"
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "AM").toUpperCase()
  return `${hour}:${minute} ${period}`
}

// Converts busy windows from Google (UTC ISO strings) to Airtable-style time slot strings
// ("9:00 AM", "1:30 PM", etc.) in the PrepMaster's local timezone.
// Slots are 30-min aligned; a slot is blocked if it overlaps the busy window by any amount.
function busyWindowsToSlots(
  busy: { start: string; end: string }[],
  dateIso: string,
  timezone: string,
): string[] {
  const blocked = new Set<string>()
  // UTC ms for the start of this date — used as anchor; we walk ±24h to cover all tz offsets
  const dayUtcMs = new Date(`${dateIso}T00:00:00Z`).getTime()

  for (const window of busy) {
    const windowStart = new Date(window.start).getTime()
    const windowEnd = new Date(window.end).getTime()
    // Walk every 15-min UTC increment across the full ±24h window around this date
    // (15-min steps so we catch :00, :15, :30, :45 slots — PMs can have any granularity)
    for (let offsetMin = -24 * 60; offsetMin < 48 * 60; offsetMin += 15) {
      const slotStartMs = dayUtcMs + offsetMin * 60_000
      // Block only slots whose start falls inside the busy window.
      // Overlap-based blocking (slotEnd > windowStart) caused slots before the
      // window to be blocked because a 60-min session would run into it.
      if (slotStartMs < windowStart || slotStartMs >= windowEnd) continue
      // Check if this UTC instant falls on the correct local date
      const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date(slotStartMs))
      if (localDate !== dateIso) continue
      blocked.add(formatSlotInTz(slotStartMs, timezone))
    }
  }
  return [...blocked]
}

/**
 * Returns time slots (in "H:MM AM/PM" format matching Airtable Time values) that are
 * blocked by existing Google Calendar events for the given user on a specific date.
 * Uses the freebusy API. Returns [] if calendar is not connected or the call fails.
 */
export async function getCalendarBusySlots(
  userId: string,
  dateIso: string,
  slotDurationMin = 60,
  timezone = "America/New_York",
): Promise<string[]> {
  const accessToken = await getAccessToken(userId)
  if (!accessToken) return []

  const timeMin = new Date(`${dateIso}T00:00:00Z`).toISOString()
  const timeMax = new Date(`${dateIso}T23:59:59Z`).toISOString()

  const res = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: "primary" }] }),
  })
  if (!res.ok) return []

  const data = await res.json() as { calendars?: { primary?: { busy?: { start: string; end: string }[] } } }
  return busyWindowsToSlots(data.calendars?.primary?.busy ?? [], dateIso, timezone)
}

/**
 * Fetches busy slots for a date range in a single freebusy API call.
 * Returns a map of { [dateIso]: string[] } for every date that has blocked slots.
 * Much more efficient than calling getCalendarBusySlots per day.
 */
export async function getCalendarBusyRange(
  userId: string,
  startIso: string,
  endIso: string,
  slotDurationMin = 60,
  timezone = "America/New_York",
): Promise<Record<string, string[]>> {
  const accessToken = await getAccessToken(userId)
  if (!accessToken) return {}

  const timeMin = new Date(`${startIso}T00:00:00Z`).toISOString()
  const timeMax = new Date(`${endIso}T23:59:59Z`).toISOString()

  const res = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: "primary" }] }),
  })
  if (!res.ok) return {}

  const data = await res.json() as { calendars?: { primary?: { busy?: { start: string; end: string }[] } } }
  const busy = data.calendars?.primary?.busy ?? []
  if (busy.length === 0) return {}

  // Group busy windows by date (in the PM's local timezone), then convert to slot strings.
  // A window that spans midnight local time needs to appear on both dates.
  const byDate: Record<string, { start: string; end: string }[]> = {}
  for (const window of busy) {
    const windowEndMs = new Date(window.end).getTime()
    const cur = new Date(window.start)
    cur.setUTCHours(0, 0, 0, 0)
    while (cur.getTime() < windowEndMs) {
      const utcDateIso = cur.toISOString().slice(0, 10)
      // Check the local date on both sides of UTC midnight to handle timezone offsets
      const localDates = new Set([
        utcDateIso,
        new Date(cur.getTime() - 14 * 3600_000).toLocaleDateString("en-CA", { timeZone: timezone }),
        new Date(cur.getTime() + 14 * 3600_000).toLocaleDateString("en-CA", { timeZone: timezone }),
      ])
      for (const dateIso of localDates) {
        if (!byDate[dateIso]) byDate[dateIso] = []
        if (!byDate[dateIso].includes(window)) byDate[dateIso].push(window)
      }
      cur.setUTCDate(cur.getUTCDate() + 1)
    }
  }

  const result: Record<string, string[]> = {}
  for (const [dateIso, windows] of Object.entries(byDate)) {
    const slots = busyWindowsToSlots(windows, dateIso, timezone)
    if (slots.length > 0) result[dateIso] = slots
  }
  return result
}

// Parses Airtable's "H:MM AM/PM" time format into 24-hour hours/minutes.
function parseAirtableTime(timeStr: string): { hours: number; minutes: number } {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return { hours: 0, minutes: 0 }
  let hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const period = match[3].toUpperCase()
  if (period === "AM") {
    if (hours === 12) hours = 0
  } else {
    if (hours !== 12) hours += 12
  }
  return { hours, minutes }
}

// Builds Google Calendar API start/end datetime objects from an Airtable date+time.
// Uses local datetime strings + timezone so Google handles the UTC conversion correctly.
function buildEventTimes(date: string, time: string, timezone: string, durationMin: number) {
  const pad = (n: number) => String(n).padStart(2, "0")
  const { hours, minutes } = parseAirtableTime(time)
  const startLocalDt = `${date}T${pad(hours)}:${pad(minutes)}:00`
  const endTotalMin = hours * 60 + minutes + durationMin
  const endH = Math.floor(endTotalMin / 60) % 24
  const endM = endTotalMin % 60
  const endDate = endTotalMin >= 24 * 60
    ? (() => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
    : date
  const endLocalDt = `${endDate}T${pad(endH)}:${pad(endM)}:00`
  return {
    start: { dateTime: startLocalDt, timeZone: timezone },
    end: { dateTime: endLocalDt, timeZone: timezone },
  }
}

export async function createCalendarEvent(
  userId: string,
  {
    dancerName,
    prepMasterName,
    date,
    time,
    notes,
    sessionType,
    timezone = "America/New_York",
  }: { dancerName: string; prepMasterName?: string; date: string; time: string; notes?: string; sessionType?: string; timezone?: string },
): Promise<string | null> {
  const accessToken = await getAccessToken(userId)
  if (!accessToken) return null

  const durationMin = SESSION_DURATION[sessionType ?? "pack-hour"] ?? 60
  const summary = `CDP: ${durationMin}min Session - ${dancerName}${prepMasterName ? ` (PM: ${prepMasterName})` : ""}`

  const event = {
    summary,
    description: notes ? `Notes: ${notes}` : "College Dance Prep private session",
    ...buildEventTimes(date, time, timezone, durationMin),
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  }

  const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events?conferenceDataVersion=1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  })

  if (!res.ok) {
    console.error("Google Calendar event creation failed:", await res.text())
    return null
  }
  const data = await res.json() as { id?: string }
  return data.id ?? null
}

export async function updateCalendarEvent(
  userId: string,
  eventId: string,
  {
    dancerName,
    prepMasterName,
    date,
    time,
    notes,
    sessionType,
    timezone = "America/New_York",
  }: { dancerName: string; prepMasterName?: string; date: string; time: string; notes?: string; sessionType?: string; timezone?: string },
): Promise<void> {
  const accessToken = await getAccessToken(userId)
  if (!accessToken) return

  const durationMin = SESSION_DURATION[sessionType ?? "pack-hour"] ?? 60
  const summary = `CDP: ${durationMin}min Session - ${dancerName}${prepMasterName ? ` (PM: ${prepMasterName})` : ""}`

  const event = {
    summary,
    description: notes ? `Notes: ${notes}` : "College Dance Prep private session",
    ...buildEventTimes(date, time, timezone, durationMin),
    // Preserve existing Meet link on reschedule; Google keeps the same room
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  }

  const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${eventId}?conferenceDataVersion=1`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  })
  if (!res.ok) {
    console.error("Google Calendar event update failed:", await res.text())
  }
}

export async function deleteCalendarEvent(userId: string, eventId: string): Promise<void> {
  const accessToken = await getAccessToken(userId)
  if (!accessToken) return

  const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok && res.status !== 410) {
    // 410 Gone = already deleted, that's fine
    console.error("Google Calendar event deletion failed:", res.status)
  }
}
