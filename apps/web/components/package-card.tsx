"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatPrice, PACK_PROMO, promoBonusCredits, type DancePackage } from "@/lib/packages"
import { Check, Gift } from "lucide-react"
import { useState } from "react"
import { createCheckoutSession } from "@/app/actions/checkout"

export function PackageCard({ pkg }: { pkg: DancePackage }) {
  const [loading, setLoading] = useState(false)

  async function handlePurchase() {
    setLoading(true)
    await createCheckoutSession(pkg.id)
    setLoading(false)
  }

  return (
    <Card
      className={
        pkg.highlight
          ? "relative flex flex-col overflow-visible border-primary p-6 shadow-lg ring-1 ring-primary"
          : "relative flex flex-col overflow-visible p-6"
      }
    >
      {pkg.highlight ? (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
          Most popular
        </Badge>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-xl font-bold">{pkg.name}</h2>
        <Badge className="shrink-0 bg-primary/15 text-primary hover:bg-primary/20 text-sm px-3 py-1">
          Save {formatPrice(pkg.savings)}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">Hourly privates</p>
      {promoBonusCredits(pkg.id) > 0 ? (
        <div className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-400/20 dark:text-amber-200">
          <Gift className="size-3.5" />
          {PACK_PROMO.label}: +{promoBonusCredits(pkg.id)} free through {PACK_PROMO.endLabel}
        </div>
      ) : null}

      <div className="mt-4 flex items-end gap-1">
        <span className="font-heading text-4xl font-bold tracking-tight">
          {formatPrice(pkg.price)}
        </span>
        <span className="mb-1 text-sm text-muted-foreground">
          / {pkg.sessions} hours
        </span>
      </div>

      <ul className="mt-6 flex flex-1 flex-col gap-3">
        {pkg.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" />
            <span className="leading-relaxed">{feature}</span>
          </li>
        ))}
      </ul>

      <Button
        onClick={handlePurchase}
        disabled={loading}
        variant={pkg.highlight ? "default" : "outline"}
        className="mt-6 w-full"
      >
        {loading ? "Redirecting…" : `Get ${pkg.name}`}
      </Button>
    </Card>
  )
}
