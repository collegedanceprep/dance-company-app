"use client"

import { useEffect } from "react"

/**
 * Syncs the viewer's real browser timezone to their account, mirroring the
 * mobile app's syncTimezone pattern. Without this, web-only accounts never
 * get a timezone stored at all, so notification/email time labels fall back
 * to showing whoever's timezone happens to be used as the "sender" (often
 * the PrepMaster's) instead of the viewer's own — e.g. an Arizona family
 * (MST, no DST) seeing times labeled MDT because their account's timezone
 * was simply never captured.
 */
export function TimezoneSync() {
  useEffect(() => {
    const syncTimezone = () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        if (!tz) return
        fetch("/api/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ timezone: tz }),
        }).catch(() => {})
      } catch {
        // Intl unsupported or blocked — nothing to sync
      }
    }
    syncTimezone()
    // Re-sync when the tab regains focus (handles travel/DST changes)
    const onVisible = () => {
      if (document.visibilityState === "visible") syncTimezone()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [])

  return null
}
