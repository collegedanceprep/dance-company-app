"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import type { AdminMember, AdminBooking, AdminWorker, MemberPlan } from "@/lib/airtable"
import type { CreditAdjustmentRecord } from "@/app/actions/admin"
import type { DancePackage } from "@/lib/packages"
import { AdminMembersPanel } from "@/components/admin-members-panel"
import { AdminPrepMastersPanel } from "@/components/admin-prep-masters-panel"
import { AdminOverviewPanel } from "@/components/admin-overview-panel"
import { AdminApprovalsPanel } from "@/components/admin-approvals-panel"
import { AdminBookSessionPanel } from "@/components/admin-book-session-panel"
import { Search } from "lucide-react"

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

export function AdminTabs({ members, bookings, workers, plans, packages, creditAdjustments }: Props) {
  const searchParams = useSearchParams()
  const active = (searchParams.get("tab") as TabId) ?? "overview"
  const [queries, setQueries] = useState<Partial<Record<TabId, string>>>({})

  const query = queries[active] ?? ""
  const setQuery = (v: string) => setQueries((prev) => ({ ...prev, [active]: v }))

  return (
    <div className="flex flex-col gap-6">
      {SEARCHABLE_TABS.has(active) && (
        <div className="flex items-center justify-end gap-2">
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
        <AdminMembersPanel members={members} bookings={bookings} plans={plans} packages={packages} query={query} creditAdjustments={creditAdjustments} />
      )}
      {active === "prep-masters" && (
        <AdminPrepMastersPanel workers={workers} bookings={bookings} query={query} />
      )}
      {active === "book" && <AdminBookSessionPanel members={members} workers={workers} />}
      {active === "approvals" && <AdminApprovalsPanel />}
    </div>
  )
}
