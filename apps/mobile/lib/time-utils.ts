/** Formats a "HH:MM" or "H:MM AM/PM" time string as "3:00 PM" */
export function fmtTime(timeStr: string): string {
  if (!timeStr) return timeStr
  if (/am|pm/i.test(timeStr)) return timeStr
  const [h, m] = timeStr.split(":").map(Number)
  if (isNaN(h) || isNaN(m)) return timeStr
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`
}

/** Returns the short timezone abbreviation for the device locale, e.g. "MDT", "EST", "PDT" */
export function getTimezoneAbbr(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date())
    return parts.find((p) => p.type === "timeZoneName")?.value ?? ""
  } catch {
    return ""
  }
}

/** Formats a time string with the device timezone abbreviation, e.g. "3:00 PM MDT" */
export function fmtTimeWithTZ(timeStr: string): string {
  const t = fmtTime(timeStr)
  const tz = getTimezoneAbbr()
  return tz ? `${t} ${tz}` : t
}

const COMPANY_TZ = "America/New_York"

/**
 * Combines a "YYYY-MM-DD" date and "H:MM AM/PM" time into a real UTC instant
 * in the company's timezone, in milliseconds. Used as a fallback when a
 * booking has no stored UTC Datetime — parsing the bare date alone (e.g.
 * `new Date("2026-10-01")`) means midnight UTC, which is already hours in
 * the past by US evening time even though the real session (e.g. 5:30 AM
 * local) hasn't happened yet. Matches apps/web/lib/utils.ts's etToUtcIso.
 */
export function fallbackUtcMs(date: string, timeStr: string): number {
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

/** Formats a YYYY-MM-DD date string as "Tuesday, June 30, 2026" */
export function fmtDate(dateIso: string): string {
  if (!dateIso) return dateIso
  const d = new Date(`${dateIso}T00:00:00`)
  if (isNaN(d.getTime())) return dateIso
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
}
