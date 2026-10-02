"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Ticket, Package } from "lucide-react"
import { planDisplayStatus } from "@/lib/plan-utils"
import type { MemberPlan } from "@/lib/airtable"

export function CreditsCard({
  plans,
  credits,
}: {
  plans: MemberPlan[]
  credits: number
}) {
  const activePlans = plans.filter((p) => planDisplayStatus(p) === "Active")
  const usedPlans = plans.filter((p) => planDisplayStatus(p) !== "Active")

  const hasActive = activePlans.length > 0
  const hasHistory = usedPlans.length > 0
  const noStructuredCredits = activePlans.length === 0 && credits > 0
  const isEmpty = credits === 0 && plans.length === 0

  const [view, setView] = useState<"active" | "history">(hasActive ? "active" : "history")

  const shownPlans = view === "active" ? activePlans : usedPlans

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Ticket className="size-4 text-primary" />
            Session credits
          </span>
          {hasHistory && (
            <div className="flex gap-0.5 rounded-md border bg-muted p-0.5">
              <button
                onClick={() => setView("active")}
                className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${view === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Active
              </button>
              <button
                onClick={() => setView("history")}
                className={`rounded px-2.5 py-0.5 text-xs font-medium transition-colors ${view === "history" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                History
              </button>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isEmpty ? (
          <p className="text-sm text-muted-foreground">Purchase a package to start booking.</p>
        ) : shownPlans.length === 0 && !noStructuredCredits ? (
          <p className="text-sm text-muted-foreground">
            {view === "active" ? "No active credits." : "No used credits yet."}
          </p>
        ) : null}

        {noStructuredCredits && view === "active" && (
          <div className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-medium">
                <Ticket className="size-3.5 shrink-0 text-primary" />
                Session credits
                <span className="font-normal text-muted-foreground">
                  {credits} {credits === 1 ? "credit" : "credits"} remaining
                </span>
              </span>
              <Badge
                variant="outline"
                className="capitalize text-xs border-green-300 bg-green-100 text-green-700"
              >
                Active
              </Badge>
            </div>
          </div>
        )}

        {(() => {
          // Group plans by planName so duplicates show as "2× Single 30min"
          const groups = shownPlans.reduce<{ key: string; plans: typeof shownPlans }[]>((acc, plan) => {
            const existing = acc.find((g) => g.key === plan.planName)
            if (existing) { existing.plans.push(plan); return acc }
            acc.push({ key: plan.planName, plans: [plan] })
            return acc
          }, [])

          return groups.map(({ key, plans: groupPlans }) => {
            const rep = groupPlans[0]
            const status = planDisplayStatus(rep)
            const isActive = status === "Active"
            const qty = groupPlans.length
            // Pack credits ("Credits Remaining") and single-type credits
            // ("Single Credits 30/45/60/90") are entirely separate Airtable
            // fields — a pack plan's remaining count must never be reduced
            // by how many single-type plans happen to also be active.
            const displayCount = !isActive ? rep.sessions * qty : Math.max(0, credits)
            const expiryDate = rep.expiresAt
              ? new Date(rep.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : null
            return (
              <div key={key} className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    <Package className="size-3.5 shrink-0 text-primary" />
                    {qty > 1 ? <>{qty}× {rep.planName}</> : rep.planName}
                    {isActive && (
                      <span className="font-normal text-muted-foreground">
                        {displayCount} {displayCount === 1 ? "credit" : "credits"} remaining
                      </span>
                    )}
                  </span>
                  <Badge
                    variant="outline"
                    className={`capitalize text-xs ${status === "Active" ? "border-green-300 bg-green-100 text-green-700" : "border-amber-300 bg-amber-100 text-amber-700"}`}
                  >
                    {status}
                  </Badge>
                </div>
                {expiryDate && (
                  <p className="pl-5 text-xs text-muted-foreground">Expires {expiryDate}</p>
                )}
              </div>
            )
          })
        })()}
      </CardContent>
    </Card>
  )
}
