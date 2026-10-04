"use client"

import { useState, useEffect, useCallback } from "react"
import { Check, X, Clock, UserX, ChevronDown, ChevronUp } from "lucide-react"

type PendingUser = {
  id: string
  name: string
  email: string
  status: string
  createdAt: string
  accountType: "prepmaster" | "member"
}

export function AdminApprovalsPanel() {
  const [users, setUsers] = useState<PendingUser[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState<string | null>(null)
  const [deniedOpen, setDeniedOpen] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/pending-users")
    const data = await res.json()
    setUsers(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAction(id: string, status: "active" | "denied") {
    setActing(id)
    await fetch(`/api/admin/users/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    setUsers((prev) => prev.filter((u) => u.id !== id))
    setActing(null)
  }

  const pending = users.filter((u) => u.status === "pending")
  const denied = users.filter((u) => u.status === "denied")

  if (loading) {
    return <div className="text-muted-foreground text-sm py-8 text-center">Loading…</div>
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Pending */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-500" />
          <h2 className="font-semibold text-foreground">Pending Approval ({pending.length})</h2>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pending accounts.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border bg-card overflow-hidden">
            {pending.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground truncate">{u.name}</p>
                    {u.accountType === "prepmaster" ? (
                      <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">PrepMaster</span>
                    ) : (
                      <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">Member</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{u.email}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Signed up {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => handleAction(u.id, "denied")}
                    disabled={acting === u.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-destructive/30 text-destructive text-sm font-medium hover:bg-destructive/5 disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" /> Deny
                  </button>
                  <button
                    onClick={() => handleAction(u.id, "active")}
                    disabled={acting === u.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    <Check className="w-3.5 h-3.5" /> Approve
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Denied */}
      {denied.length > 0 && (
        <section className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setDeniedOpen((v) => !v)}
            className="flex items-center gap-2 text-left"
          >
            <UserX className="w-4 h-4 text-destructive" />
            <h2 className="font-semibold text-foreground">Denied ({denied.length})</h2>
            {deniedOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </button>
          {deniedOpen && (
          <div className="divide-y divide-border rounded-lg border bg-card overflow-hidden">
            {denied.map((u) => (
              <div key={u.id} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground truncate">{u.name}</p>
                    {u.accountType === "prepmaster" ? (
                      <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">PrepMaster</span>
                    ) : (
                      <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">Member</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{u.email}</p>
                </div>
                <button
                  onClick={() => handleAction(u.id, "active")}
                  disabled={acting === u.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" /> Approve
                </button>
              </div>
            ))}
          </div>
          )}
        </section>
      )}
    </div>
  )
}
