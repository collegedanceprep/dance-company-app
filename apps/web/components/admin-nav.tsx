"use client"

import { useRouter, useSearchParams } from "next/navigation"

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
  { id: "prep-masters", label: "PrepMasters" },
  { id: "book", label: "Book Session" },
  { id: "approvals", label: "Approvals" },
] as const

type TabId = (typeof TABS)[number]["id"]

export function AdminNav() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const active = (searchParams.get("tab") as TabId) ?? "overview"

  function switchTab(id: TabId) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", id)
    router.replace(`?${params.toString()}`, { scroll: false })
  }

  return (
    <nav className="flex items-center gap-0.5 border-b overflow-x-auto scrollbar-none">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => switchTab(tab.id)}
          className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
            active === tab.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
