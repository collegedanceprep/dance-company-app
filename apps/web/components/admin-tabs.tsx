"use client"

import { useState, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import type { AdminMember, AdminBooking, AdminWorker, MemberPlan } from "@/lib/airtable"
import type { CreditAdjustmentRecord } from "@/app/actions/admin"
import type { DancePackage } from "@/lib/packages"
import { AdminMembersPanel } from "@/components/admin-members-panel"
import { AdminPrepMastersPanel } from "@/components/admin-prep-masters-panel"
import { AdminOverviewPanel } from "@/components/admin-overview-panel"
import { AdminApprovalsPanel } from "@/components/admin-approvals-panel"
import { AdminBookSessionPanel } from "@/components/admin-book-session-panel"
import { planDisplayStatus } from "@/lib/plan-utils"
import { Search, AlertTriangle } from "lucide-react"

type TabId = "overview" | "members" | "prep-masters" | "book" | "approvals"

const SEARCHABLE_TABS = new Set<TabId>(["members", "prep-masters"])

const SEARCH_PLACEHOLDERS: Partial<Record<TabId, string>> = {
  members: "Search members…",
  "prep-masters": "Search PrepMasters…",
}

type Props = {
  members: AdminMember[]
  bookings: AdminBooking[]
  workers: AdminWorker[]
  plans: MemberPlan[]
  packages: DancePackage[]
  creditAdjustments: CreditAdjustmentRecord[]
}

function hasCreditMismatch(member: AdminMember, plans: MemberPlan[]): boolean {
  const memberPlans = plans.filter((p) => p.userId === member.userId)
  const packCredits = member.creditsRemaining ?? 0
  return (["30", "45", "60", "90"] as const).some((min) => {
    const stored = member.singleCredits?.[min] ?? 0
    const expected = memberPlans.filter(
      (p) => planDisplayStatus(p) === "Active" && p.sessions === 1 && p.planName.toLowerCase().includes(min)
    ).length
    return stored < expected && (stored + packCredits) < expected
  })
}

export function AdminTabs({ members, bookings, workers, plans, packages, creditAdjustments }: Props) {
  const searchParams = useSearchParams()
  const active = (searchParams.get("tab") as TabId) ?? "overview"
  const [queries, setQueries] = useState<Partial<Record<TabId, string>>>({})
  const [onlyMismatches, setOnlyMismatches] = useState(false)

  const query = queries[active] ?? ""
  const setQuery = (v: string) => setQueries((prev) => ({ ...prev, [active]: v }))

  const mismatchCount = useMemo(
    () => members.filter((m) => hasCreditMismatch(m, plans)).length,
    [members, plans]
  )

  return (
    <div className="flex flex-col gap-6">
      {SEARCHABLE_TABS.has(active) && (
        <div className="flex items-center justify-end gap-2">
          {active === "members" && mismatchCount > 0 && (
            <button
              onClick={() => setOnlyMismatches((v) => !v)}
              className={`flex items-center gap-1.5 rounded-md border px-3 h-9 text-sm font-medium transition-colors ${
                onlyMismatches
                  ? "border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-400"
              }`}
            >
              <AlertTriangle className="size-3.5" />
              {mismatchCount} credit mismatch{mismatchCount !== 1 ? "es" : ""}
            </button>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder={SEARCH_PLACEHOLDERS[active]}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex h-9 w-full sm:w-64 rounded-md border border-input bg-background pl-9 pr-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
        </div>
      )}

      {active === "overview" && <AdminOverviewPanel members={members} bookings={bookings} workers={workers} plans={plans} />}
      {active === "members" && (
        <AdminMembersPanel members={members} bookings={bookings} plans={plans} packages={packages} query={query} onlyMismatches={onlyMismatches} creditAdjustments={creditAdjustments} />
      )}
      {active === "prep-masters" && (
        <AdminPrepMastersPanel workers={workers} bookings={bookings} query={query} />
      )}
      {active === "book" && <AdminBookSessionPanel members={members} workers={workers} />}
      {active === "approvals" && <AdminApprovalsPanel />}
    </div>
  )
}
