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

        {shownPlans.map((plan) => {
          const status = planDisplayStatus(plan)
          const isActive = status === "Active"
          const activeSingleCount = activePlans.filter((p) => p.sessions === 1).length
          const displayCount = !isActive
            ? plan.sessions
            : plan.sessions === 1
              ? Math.max(0, credits)
              : Math.max(0, credits - activeSingleCount)
          const expiryDate = plan.expiresAt
            ? new Date(plan.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
            : null
          return (
            <div key={plan.id} className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-medium">
                  <Package className="size-3.5 shrink-0 text-primary" />
                  {plan.planName}
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
        })}
      </CardContent>
    </Card>
  )
}
