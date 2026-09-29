"use client"

import { useState, useTransition, useRef } from "react"
import { toast } from "sonner"
import { addComplimentaryCredits, adminAssignPlan, createMember, adminRemovePlan, adminSetCredits, adminSetSingleCredits } from "@/app/actions/admin"
import type { AdminMember, AdminBooking, MemberPlan } from "@/lib/airtable"
import { SESSION_TYPE_LABELS } from "@/lib/session-types"
import { planDisplayStatus } from "@/lib/plan-utils"
import type { DancePackage } from "@/lib/packages"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  ChevronDown,
  ChevronUp,
  PlusCircle,
  User,
  CalendarDays,
  Ticket,
  Package,
  Trash2,
  X,
} from "lucide-react"
import { Label } from "@/components/ui/label"
import { LocalTime } from "@/components/local-time"

type Props = {
  members: AdminMember[]
  bookings: AdminBooking[]
  plans: MemberPlan[]
  packages: DancePackage[]
  query?: string
  onlyMismatches?: boolean
}

export function AdminMembersPanel({ members, bookings, plans, packages, query = "", onlyMismatches = false }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [localMembers, setLocalMembers] = useState<AdminMember[]>(members)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ active: true, leads: false, inactive: false })
  function toggleSection(key: string) { setOpenSections((prev) => ({ ...prev, [key]: !prev[key] })) }

  const queryFiltered = query.trim()
    ? localMembers.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()) || m.email.toLowerCase().includes(query.toLowerCase()))
    : localMembers

  const filtered = onlyMismatches
    ? queryFiltered.filter((m) => {
        const memberPlanList = localPlans.filter((p) => p.userId === m.userId)
        return (["30", "45", "60", "90"] as const).some((min) => {
          const stored = m.singleCredits?.[min] ?? 0
          const expected = memberPlanList.filter(
            (p) => planDisplayStatus(p) === "Active" && p.sessions === 1 && p.planName.toLowerCase().includes(min)
          ).length
          return stored !== expected
        })
      })
    : queryFiltered
    : localMembers
  const [selectedPackage, setSelectedPackage] = useState<Record<string, string>>({})
  const [localCredits, setLocalCredits] = useState<Record<string, number>>({})
  const [parentEmailEditing, setParentEmailEditing] = useState<Record<string, string>>({})
  const [parentEmailSaving, setParentEmailSaving] = useState<Record<string, boolean>>({})
  const [editingCredits, setEditingCredits] = useState<Record<string, string>>({})
  const [localPlans, setLocalPlans] = useState<MemberPlan[]>(plans)
  const [isPending, startTransition] = useTransition()
  const [mergeModal, setMergeModal] = useState<{ member: AdminMember } | null>(null)
  const [mergeTargetId, setMergeTargetId] = useState("")
  const [mergeLoading, setMergeLoading] = useState(false)

  async function handleMerge() {
    if (!mergeModal || !mergeTargetId.trim()) return
    if (!confirm(`Merge ${mergeModal.member.email} INTO the account with user ID "${mergeTargetId.trim()}"? The selected account will be deleted.`)) return
    setMergeLoading(true)
    try {
      const res = await fetch("/api/admin/members/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromId: mergeModal.member.userId, intoId: mergeTargetId.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Merge failed.")
      setLocalMembers((prev) => prev.filter((m) => m.id !== mergeModal.member.id))
      setMergeModal(null)
      setMergeTargetId("")
      toast.success(`Merged into ${data.mergedInto}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Merge failed.")
    } finally {
      setMergeLoading(false)
    }
  }

  function memberBookings(member: AdminMember) {
    return bookings.filter(
      (b) =>
        b.userId === member.userId ||
        b.clientEmail.toLowerCase() === member.email.toLowerCase(),
    )
  }

  function memberPlans(member: AdminMember) {
    return localPlans.filter((p) => p.userId === member.userId)
  }

  function creditsFor(member: AdminMember) {
    return localCredits[member.id] ?? member.creditsRemaining
  }

  function memberStatus(member: AdminMember) {
    const credits = creditsFor(member)
    const plans = memberPlans(member)
    const activePlan = plans.find((p) => planDisplayStatus(p) === "Active")
    const totalSingle = Object.values(member.singleCredits ?? {}).reduce((s, v) => s + (v ?? 0), 0)
    if (credits > 0 || totalSingle > 0 || activePlan) return "active"
    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
    const recentBooking = memberBookings(member).some(
      (b) => b.status.toLowerCase() !== "cancelled" && new Date(b.date).getTime() >= oneYearAgo,
    )
    const recentPlan = plans.some((p) => new Date(p.purchasedAt).getTime() >= oneYearAgo)
    if (recentBooking || recentPlan) return "active"
    if (memberBookings(member).length === 0 && plans.length === 0) return "lead"
    return "inactive"
  }

  function handleAddCredits(member: AdminMember, label: string) {
    if (!confirm(`Add a ${label} single session to ${member.name || member.email}?`)) return
    startTransition(async () => {
      const result = await addComplimentaryCredits(
        { id: member.id, userId: member.userId, email: member.email, creditsRemaining: creditsFor(member), singleCredits: member.singleCredits },
        label,
      )
      if (result.ok) {
        setLocalPlans((prev) => [result.plan, ...prev])
        toast.success(`Added ${label} single session to ${member.name || member.email}.`)
      } else {
        toast.error(result.error)
      }
    })
  }

  function handleSetCredits(member: AdminMember) {
    const val = parseInt(editingCredits[member.id] ?? "", 10)
    if (Number.isNaN(val) || val < 0) { toast.error("Enter a valid number."); return }
    startTransition(async () => {
      const result = await adminSetCredits(member.id, val, member.userId)
      if (result.ok) {
        setLocalCredits((prev) => ({ ...prev, [member.id]: val }))
        setEditingCredits((prev) => ({ ...prev, [member.id]: "" }))
        toast.success(`Credits updated to ${val}.`)
      } else {
        toast.error(result.error)
      }
    })
  }

  function handleRemovePlan(member: AdminMember, plan: MemberPlan) {
    if (!confirm(`Remove "${plan.planName}" from ${member.name || member.email}? This will deduct ${plan.sessions} credits.`)) return
    startTransition(async () => {
      const result = await adminRemovePlan(plan.id, member.id, plan.sessions, creditsFor(member), member.userId)
      if (result.ok) {
        setLocalPlans((prev) => prev.filter((p) => p.id !== plan.id))
        setLocalCredits((prev) => ({ ...prev, [member.id]: Math.max(0, creditsFor(member) - plan.sessions) }))
        toast.success(`Removed "${plan.planName}" from ${member.name || member.email}.`)
      } else {
        toast.error(result.error)
      }
    })
  }

  async function handleSaveParentEmail(member: AdminMember) {
    const email = (parentEmailEditing[member.id] ?? member.parentEmail ?? "").trim()
    setParentEmailSaving((prev) => ({ ...prev, [member.id]: true }))
    try {
      const res = await fetch(`/api/admin/members/${member.id}/parent`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentEmail: email, memberName: member.name }),
      })
      if (!res.ok) throw new Error("Failed")
      const json = await res.json()
      setLocalMembers((prev) => prev.map((m) => m.id === member.id ? { ...m, parentEmail: email } : m))
      setParentEmailEditing((prev) => { const n = { ...prev }; delete n[member.id]; return n })
      if (json.emailError) {
        toast.success(email ? `Parent email set to ${email}` : "Parent email cleared", { description: `Note: invite email failed — ${json.emailError}` })
      } else {
        toast.success(email ? `Parent email set and invite sent to ${email}` : "Parent email cleared")
      }
    } catch {
      toast.error("Failed to save parent email.")
    } finally {
      setParentEmailSaving((prev) => ({ ...prev, [member.id]: false }))
    }
  }

  function handleDeleteTestAccount(member: AdminMember) {
    if (!confirm(`Permanently delete ${member.email} from both the auth database and Airtable? This cannot be undone.`)) return
    startTransition(async () => {
      const res = await fetch("/api/admin/delete-user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: member.email }),
      })
      if (res.ok) {
        setLocalMembers((prev) => prev.filter((m) => m.id !== member.id))
        setExpanded(null)
        toast.success(`Auth account for ${member.email} deleted.`)
      } else {
        toast.error("Failed to delete account.")
      }
    })
  }

  function handleAssignPlan(member: AdminMember) {
    const packageId = selectedPackage[member.id]
    if (!packageId) {
      toast.error("Select a package first.")
      return
    }
    const pkg = packages.find((p) => p.id === packageId)
    if (!pkg) return

    startTransition(async () => {
      const result = await adminAssignPlan(
        { id: member.id, userId: member.userId, email: member.email, creditsRemaining: creditsFor(member) },
        packageId,
      )
      if (result.ok) {
        setLocalPlans((prev) => [result.plan, ...prev])
        setLocalCredits((prev) => ({ ...prev, [member.id]: creditsFor(member) + pkg.sessions }))
        setSelectedPackage((prev) => ({ ...prev, [member.id]: "" }))
        toast.success(`Assigned ${pkg.name} to ${member.name || member.email}.`)
      } else {
        toast.error(result.error)
      }
    })
  }

  if (members.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <User className="size-10 text-muted-foreground" />
          <p className="font-medium">No members yet</p>
          <p className="text-sm text-muted-foreground">Members will appear here once they sign up.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowAddForm((v) => !v)} variant={showAddForm ? "outline" : "default"}>
          {showAddForm ? <><X className="mr-1.5 size-3.5" />Cancel</> : <><PlusCircle className="mr-1.5 size-3.5" />Add member</>}
        </Button>
      </div>

      {showAddForm && (
        <AddMemberForm
          onSuccess={(member) => {
            setLocalMembers((prev) => [member, ...prev])
            setShowAddForm(false)
          }}
        />
      )}

      {filtered.length === 0 && !showAddForm && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {query ? <>No members match &ldquo;{query}&rdquo;.</> : "No members yet."}
        </p>
      )}
      {(["active", "leads", "inactive"] as const).map((sectionKey) => {
        const sectionMembers = filtered.filter((m) => {
          if (m.accountStatus === "pending") return false
          const s = memberStatus(m)
          if (sectionKey === "active") return s === "active"
          if (sectionKey === "leads") return s === "lead"
          return s === "inactive"
        })
        if (sectionMembers.length === 0) return null
        const sectionLabel = sectionKey === "active" ? "Active Members" : sectionKey === "leads" ? "Leads" : "Inactive"
        const isOpen = openSections[sectionKey]
        return (
          <div key={sectionKey} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => toggleSection(sectionKey)}
              className="flex items-center justify-between rounded-md px-1 py-1 text-left hover:bg-muted/50 transition-colors"
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {sectionLabel}
                <span className="text-xs font-normal text-muted-foreground">({sectionMembers.length})</span>
              </span>
              {isOpen ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
            </button>
            {isOpen && sectionMembers.map((member) => {
        const isCardOpen = expanded === member.id
        const history = memberBookings(member)
        const memberPlanList = memberPlans(member)
        const activePlan = memberPlanList.find((p) => planDisplayStatus(p) === "Active")
        const credits = creditsFor(member)
        const status = memberStatus(member)

        return (
          <Card key={member.id}>
            <CardHeader className="cursor-pointer pb-3" onClick={() => setExpanded(isCardOpen ? null : member.id)}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold">
                    {(member.name || member.email)[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-base">{member.name || "—"}</CardTitle>
                    <CardDescription className="truncate">{member.email}</CardDescription>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      status === "active"
                        ? "border-green-300 bg-green-100 text-green-700"
                        : status === "lead"
                          ? "border-blue-300 bg-blue-100 text-blue-700"
                          : "border-gray-200 bg-gray-100 text-gray-500"
                    }
                  >
                    {status === "active" ? "Active" : status === "lead" ? "Lead" : "Inactive"}
                  </Badge>

                  <Badge variant="secondary" className="gap-1" title="Pack credits (fractional)">
                    <Ticket className="size-3" />
                    {credits}
                  </Badge>
                  {(["90", "60", "45", "30"] as const).map((min) => {
                    const count = member.singleCredits?.[min] ?? 0
                    if (!count) return null
                    const color = min === "90"
                      ? "border-orange-300 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300"
                      : min === "60"
                      ? "border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                      : min === "45"
                      ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                      : "border-purple-300 bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                    return (
                      <Badge key={min} variant="outline" className={`gap-1 ${color}`} title={`${count} × ${min}-min single session credit${count !== 1 ? "s" : ""}`}>
                        <Ticket className="size-3" />
                        {count > 1 ? `${count} × ` : ""}{min} min
                      </Badge>
                    )
                  })}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={isCardOpen ? "Collapse" : "Expand"}
                    onClick={(e) => { e.stopPropagation(); setExpanded(isCardOpen ? null : member.id) }}
                  >
                    {isCardOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                  </Button>
                </div>
              </div>
            </CardHeader>

            {isCardOpen && (
              <CardContent className="flex flex-col gap-5 pt-0">
                <Separator />

                {/* Profile info */}
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  {member.phone && (
                    <div>
                      <span className="text-muted-foreground">Phone </span>
                      <span className="font-medium">{formatPhone(member.phone)}</span>
                    </div>
                  )}
                  {member.goals && (
                    <div className="sm:col-span-2">
                      <span className="text-muted-foreground">Goals </span>
                      <span className="font-medium">{member.goals}</span>
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <span className="text-muted-foreground">User ID </span>
                    <span className="font-mono text-xs select-all">{member.userId}</span>
                  </div>
                </div>

                {/* Assign a plan */}
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium flex items-center gap-1.5">
                    <Package className="size-4 text-muted-foreground" />
                    Assign a plan
                  </p>
                  <div className="flex items-center gap-2">
                    <select
                      className="flex h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={selectedPackage[member.id] ?? ""}
                      onChange={(e) =>
                        setSelectedPackage((prev) => ({ ...prev, [member.id]: e.target.value }))
                      }
                    >
                      <option value="">Select package…</option>
                      {packages.map((pkg) => (
                        <option key={pkg.id} value={pkg.id}>
                          {pkg.name} — {pkg.sessions} sessions (${pkg.price})
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={isPending || !selectedPackage[member.id]}
                      onClick={() => handleAssignPlan(member)}
                    >
                      Assign
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Assigning a plan adds its sessions as credits to the member's account.
  </p>
                </div>

                {/* Credit reconciliation warnings */}
                {(["30", "45", "60", "90"] as const).map((min) => {
                  const stored = member.singleCredits?.[min] ?? 0
                  const expected = memberPlanList.filter(
                    (p) => planDisplayStatus(p) === "Active" && p.sessions === 1 && p.planName.toLowerCase().includes(min)
                  ).length
                  if (stored === expected) return null
                  return (
                    <div key={min} className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      <span>
                        ⚠️ Credit mismatch: <strong>{min}-min single</strong> shows <strong>{stored}</strong> in Airtable but <strong>{expected}</strong> Active plan{expected !== 1 ? "s" : ""} exist.
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100 dark:text-amber-300"
                        disabled={isPending}
                        onClick={async () => {
                          const result = await adminSetSingleCredits(member.id, member.userId, min, expected)
                          if (result.ok) toast.success(`Fixed: Single Credits ${min} set to ${expected}`)
                          else toast.error(result.error)
                        }}
                      >
                        Fix ({stored} → {expected})
                      </Button>
                    </div>
                  )
                })}

                {/* Plan history + single sessions */}
                {memberPlanList.length > 0 && (
                  <PlanHistory
                    plans={memberPlanList}
                    credits={creditsFor(member)}
                    isPending={isPending}
                    onRemove={(plan) => handleRemovePlan(member, plan)}
                  />
                )}

                {/* Add single session */}
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Add single session</p>
                  <div className="flex flex-wrap gap-2">
                    {(["90 min", "60 min", "45 min", "30 min"] as const).map((label) => (
                      <Button
                        key={label}
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleAddCredits(member, label)}
                      >
                        <PlusCircle className="mr-1.5 size-4" />
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Edit credit balance */}
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Set pack credit balance</p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      placeholder={String(credits)}
                      value={editingCredits[member.id] ?? ""}
                      onChange={(e) => setEditingCredits((prev) => ({ ...prev, [member.id]: e.target.value }))}
                      className="h-8 w-24 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending || !editingCredits[member.id]}
                      onClick={() => handleSetCredits(member)}
                    >
                      Save
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      Current: {credits} pack
                      {(["90", "60", "45", "30"] as const).map((min) => {
                        const count = member.singleCredits?.[min] ?? 0
                        return count > 0 ? ` · ${count}×${min}min single` : ""
                      }).join("")}
                    </span>
                  </div>
                </div>

                {/* Parent email */}
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Parent / Guardian email</p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      autoComplete="off"
                      placeholder="parent@example.com"
                      value={parentEmailEditing[member.id] ?? member.parentEmail ?? ""}
                      onChange={(e) => setParentEmailEditing((prev) => ({ ...prev, [member.id]: e.target.value }))}
                      className="h-8 text-sm"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={parentEmailSaving[member.id]}
                      onClick={() => handleSaveParentEmail(member)}
                    >
                      {parentEmailSaving[member.id] ? "Saving…" : "Save Email"}
                    </Button>
                  </div>
                  {(member.parentEmail || parentEmailEditing[member.id]) && (
                    <p className="text-xs text-muted-foreground">
                      A parent account with this email can log in to view {member.name || "this member"}&apos;s bookings and credits.
                      {!member.parentEmail && " An invite email will be sent when you save."}
                    </p>
                  )}
                </div>

                {/* Danger zone */}
                <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-destructive">Permanent Account Deletion</p>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">Delete this user from both the auth database and Airtable so the email can be re-used for testing.</p>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => { setMergeModal({ member }); setMergeTargetId("") }}
                      >
                        Merge account
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={isPending}
                        onClick={() => handleDeleteTestAccount(member)}
                      >
                        <Trash2 className="mr-1.5 size-3.5" />
                        Delete account
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Booking history */}
                <div className="flex flex-col gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <CalendarDays className="size-4 text-muted-foreground" />
                    Booking history ({history.length})
                  </p>
                  {history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No bookings yet.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {history.map((b) => {
                        const statusVariant =
                          b.status.toLowerCase() === "confirmed"
                            ? "default"
                            : b.status.toLowerCase().startsWith("cancelled")
                              ? "destructive"
                              : "secondary"
                        return (
                          <li
                            key={b.id}
                            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                          >
                            <div className="min-w-0">
                              <span className="font-medium">{b.prepMasterName || "PrepMaster"}</span>
                              <span className="ml-2 text-muted-foreground">
                                {b.date}{b.time ? <> · <LocalTime slot={b.time} dateIso={b.date} utcDatetime={b.utcDatetime} /></> : ""}
                              </span>
                              {b.sessionType && (
                                <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none ${b.sessionType === "pack-hour" ? "bg-primary/10 text-primary" : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"}`}>
                                  {SESSION_TYPE_LABELS[b.sessionType as import("@/lib/session-types").SessionType]}
                                </span>
                              )}
                              <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none ${b.singleCreditUsed ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"}`}>
                                {b.singleCreditUsed ? "Single" : "Pack"}
                              </span>
                            </div>
                            <Badge variant={statusVariant} className="capitalize shrink-0">
                              {b.status}
                            </Badge>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}
            </div>
        )
      })}
    </div>

    {mergeModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="w-full max-w-md rounded-lg border bg-background p-6 flex flex-col gap-4 shadow-xl">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-base">Merge account</h2>
            <Button size="icon" variant="ghost" onClick={() => setMergeModal(null)}><X className="size-4" /></Button>
          </div>
          <p className="text-sm text-muted-foreground">
            This will move all sign-in methods from <strong>{mergeModal.member.email}</strong> into
            the target account, then delete this one. Enter the <strong>user ID</strong> of the account to keep.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="merge-target">Target user ID</Label>
            <Input
              id="merge-target"
              placeholder="e.g. nolIH6PudpL64HNqaOcB4BvJlgXcUgtL"
              value={mergeTargetId}
              onChange={(e) => setMergeTargetId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Find the user ID in the target member's expanded panel under their email.</p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setMergeModal(null)}>Cancel</Button>
            <Button variant="destructive" disabled={mergeLoading || !mergeTargetId.trim()} onClick={handleMerge}>
              {mergeLoading ? "Merging…" : "Merge & delete"}
            </Button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  const d = digits.startsWith("1") && digits.length === 11 ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return raw
}

const PLAN_STATUS_ORDER = ["Active", "Expired", "Used"] as const
type PlanStatusGroup = (typeof PLAN_STATUS_ORDER)[number]

function PlanHistory({ plans, credits, isPending, onRemove }: {
  plans: MemberPlan[]
  credits: number
  isPending: boolean
  onRemove: (plan: MemberPlan) => void
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({ Used: true })
  function toggleGroup(g: string) { setCollapsedGroups((prev) => ({ ...prev, [g]: !prev[g] })) }

  const activeSingleCount = plans.filter((p) => planDisplayStatus(p) === "Active" && p.sessions === 1).length
  const grouped = Object.fromEntries(
    PLAN_STATUS_ORDER.map((s) => [s, plans.filter((p) => planDisplayStatus(p) === s)])
  ) as Record<PlanStatusGroup, MemberPlan[]>

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">Plan history ({plans.length})</p>
      {PLAN_STATUS_ORDER.map((group) => {
        const groupPlans = grouped[group]
        if (groupPlans.length === 0) return null
        const isCollapsed = collapsedGroups[group] ?? false
        return (
          <div key={group} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
            >
              {isCollapsed ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
              {group} ({groupPlans.length})
            </button>
            {!isCollapsed && (
              <ul className="flex flex-col gap-1.5">
                {groupPlans.map((plan) => {
                  const purchaseDate = plan.purchasedAt
                    ? new Date(plan.purchasedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : null
                  const expiryDate = plan.expiresAt
                    ? new Date(plan.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                    : null
                  const planStatus = planDisplayStatus(plan)
                  const displayCount = planStatus !== "Active"
                    ? plan.sessions
                    : plan.sessions === 1
                      ? 1
                      : Math.max(0, credits - activeSingleCount)
                  return (
                    <li key={plan.id} className="flex flex-col gap-1 rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Package className="size-3.5 shrink-0 text-primary" />
                          <span className="font-medium">{plan.planName}</span>
                          <span className="text-muted-foreground">
                            {displayCount} {displayCount === 1 ? "credit" : "credits"} · ${plan.pricePaid}
                            {purchaseDate ? ` · ${purchaseDate}` : ""}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {plan.source === "stripe" && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 leading-none">
                              Stripe
                            </span>
                          )}
                          {plan.source === "admin" && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 leading-none">
                              Admin
                            </span>
                          )}
                          {planStatus !== "Used" && (
                            <button
                              disabled={isPending}
                              onClick={() => onRemove(plan)}
                              className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                              aria-label="Remove plan"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      {expiryDate && (
                        <p className="pl-5 text-xs text-muted-foreground">Expires {expiryDate}</p>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AddMemberForm({ onSuccess }: { onSuccess: (member: AdminMember) => void }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [goals, setGoals] = useState("")
  const [credits, setCredits] = useState("0")
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await createMember({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        goals: goals.trim(),
        creditsRemaining: Math.max(0, parseInt(credits, 10) || 0),
      })
      if (result.ok) {
        toast.success(`${name.trim() || email.trim()} has been added.`)
        onSuccess(result.member)
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <PlusCircle className="size-4 text-primary" />
          Add new member
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Creates a member record in Airtable. They&apos;ll be linked to this record automatically when they sign in with the same email.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-member-name">Full name <span className="text-destructive">*</span></Label>
              <Input id="new-member-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-member-email">Email <span className="text-destructive">*</span></Label>
              <Input id="new-member-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-member-phone">Phone</Label>
              <Input id="new-member-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 000-0000" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-member-credits">Starting credits</Label>
              <Input id="new-member-credits" type="number" min="0" value={credits} onChange={(e) => setCredits(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="new-member-goals">Goals</Label>
              <Input id="new-member-goals" value={goals} onChange={(e) => setGoals(e.target.value)} placeholder="e.g. Improve turns, prepare for auditions…" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add member"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
