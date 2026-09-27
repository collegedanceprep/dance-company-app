import { useState, useCallback, useEffect } from "react"
import { API_BASE } from "@/lib/config"
import {
  View, Text, StyleSheet, SectionList, TextInput, TouchableOpacity,
  Modal, ScrollView, RefreshControl, ActivityIndicator, Alert,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Search, ChevronDown, ChevronUp, Plus, X, Ticket, Package, Trash2, CalendarDays, Check, UserX } from "lucide-react-native"
import { SPACING, RADIUS, initials } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"
import { useAdmin } from "@/lib/admin-context"
import { authClient } from "@/lib/auth-client"
import { formatTime } from "@/components/BookingDetailModal"
import type { AdminMember, AdminBooking, MemberPlan, DancePackage } from "@/lib/admin-types"

const API = "https://app.collegedanceprep.com"


function lastNameKey(name: string): string {
  const parts = name.trim().split(/\s+/)
  return (parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? "").toLowerCase()
}

function planDisplayStatus(plan: MemberPlan): string {
  if (plan.status === "Active" && plan.expiresAt && new Date(plan.expiresAt) < new Date()) return "Inactive"
  return plan.status
}

function memberStatusLabel(
  member: AdminMember, memberPlans: MemberPlan[], memberBookings: AdminBooking[],
): "Active" | "Inactive" | "Lead" {
  const activePlan = memberPlans.find((p) => planDisplayStatus(p) === "Active")
  const totalSingle = Object.values(member.singleCredits ?? {}).reduce((s, v) => s + (v ?? 0), 0)
  if (member.creditsRemaining > 0 || totalSingle > 0 || activePlan) return "Active"
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000
  const recentBooking = memberBookings.some((b) => b.status.toLowerCase() !== "cancelled" && new Date(b.date).getTime() >= oneYearAgo)
  const recentPlan = memberPlans.some((p) => new Date(p.purchasedAt).getTime() >= oneYearAgo)
  if (recentBooking || recentPlan) return "Active"
  if (memberBookings.length === 0 && memberPlans.length === 0) return "Lead"
  return "Inactive"
}

function memberStatusInfo(label: "Active" | "Inactive" | "Lead", COLORS: ReturnType<typeof useColors>) {
  if (label === "Active") return { label, bg: COLORS.greenLight, fg: COLORS.green }
  if (label === "Lead") return { label, bg: "#dbeafe", fg: "#1d4ed8" }
  return { label, bg: COLORS.grayLight, fg: COLORS.textMuted }
}

type SectionItem = { kind: "member"; member: AdminMember }

export default function AdminMembersScreen() {
  const { data, loading, refresh } = useAdmin()
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({ Lead: true, Inactive: true })
  const [refreshing, setRefreshing] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [localMembers, setLocalMembers] = useState<AdminMember[] | null>(null)
  const [localPlans, setLocalPlans] = useState<MemberPlan[] | null>(null)
  const [localCredits, setLocalCredits] = useState<Record<string, number>>({})
  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await refresh()
    setLocalMembers(null); setLocalPlans(null); setLocalCredits({})
    setRefreshing(false)
  }, [refresh])

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      </SafeAreaView>
    )
  }

  const members = localMembers ?? data?.members ?? []
  const bookings = data?.bookings ?? []
  const plans = localPlans ?? data?.plans ?? []
  const packages = data?.packages ?? []

  const q = query.trim().toLowerCase()

  function memberBookings(m: AdminMember) { return bookings.filter((b) => b.userId === m.userId || b.clientEmail.toLowerCase() === m.email.toLowerCase()) }
  function memberPlans(m: AdminMember) { return plans.filter((p) => p.userId === m.userId) }
  function creditsFor(m: AdminMember) { return localCredits[m.id] ?? m.creditsRemaining }

  // Group members by status
  const grouped: Record<"Active" | "Inactive" | "Lead", AdminMember[]> = { Active: [], Inactive: [], Lead: [] }
  for (const m of members) {
    if (q && !m.name.toLowerCase().includes(q) && !m.email.toLowerCase().includes(q)) continue
    const credits = creditsFor(m)
    const label = memberStatusLabel({ ...m, creditsRemaining: credits }, memberPlans(m), memberBookings(m))
    grouped[label].push(m)
  }

  // Sort each group by last name
  const byLastName = (a: AdminMember, b: AdminMember) => lastNameKey(a.name || a.email).localeCompare(lastNameKey(b.name || b.email))

  const sections: { title: string; icon: "active" | "inactive" | "lead"; collapsed?: boolean; onToggle?: () => void; data: SectionItem[] }[] = []

  for (const label of ["Active", "Lead", "Inactive"] as const) {
    const sorted = [...grouped[label]].sort(byLastName)
    if (sorted.length > 0) {
      const collapsed = !!collapsedSections[label]
      sections.push({
        title: `${label === "Lead" ? "Leads" : label} (${sorted.length})`,
        icon: label.toLowerCase() as "active" | "inactive" | "lead",
        collapsed,
        onToggle: () => setCollapsedSections((prev) => ({ ...prev, [label]: !prev[label] })),
        data: collapsed ? [] : sorted.map((m) => ({ kind: "member" as const, member: m })),
      })
    }
  }

  const totalMembers = members.length
  const isEmpty = sections.length === 0

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.toolbar}>
        <View style={[styles.searchRow, { flex: 1 }]}>
          <Search size={16} color={COLORS.textMuted} style={{ marginRight: 6 }} />
          <TextInput
            style={styles.searchInput} placeholder="Search members…" placeholderTextColor={COLORS.textMuted}
            value={query} onChangeText={setQuery} autoCorrect={false} clearButtonMode="while-editing"
          />
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddForm(true)} activeOpacity={0.7}>
          <Plus size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.kind === "pending" ? item.user.id : item.member.id}
        contentContainerStyle={[styles.list, isEmpty && { flex: 1 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <SectionHeader title={section.title} icon={section.icon} collapsed={section.collapsed} onToggle={section.onToggle} COLORS={COLORS} styles={styles} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        SectionSeparatorComponent={() => <View style={{ height: SPACING.sm }} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.empty}>{totalMembers === 0 ? "No members yet." : "No members match your search."}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const m = item.member
          const mPlans = memberPlans(m); const mBookings = memberBookings(m)
          const credits = creditsFor(m)
          const label = memberStatusLabel({ ...m, creditsRemaining: credits }, mPlans, mBookings)
          const statusInfo = memberStatusInfo(label, COLORS)
          const isOpen = expanded === m.id
          return (
            <MemberCard
              member={m} credits={credits} plans={mPlans} bookings={mBookings} packages={packages}
              statusInfo={statusInfo} isOpen={isOpen} onToggle={() => setExpanded(isOpen ? null : m.id)}
              onCreditsChange={(id, val) => setLocalCredits((prev) => ({ ...prev, [id]: val }))}
              onPlanAdded={(plan, creditsAdded) => { setLocalPlans((prev) => [plan, ...(prev ?? plans)]); setLocalCredits((prev) => ({ ...prev, [m.id]: credits + creditsAdded })) }}
              onPlanRemoved={(planId, deducted) => { setLocalPlans((prev) => (prev ?? plans).filter((p) => p.id !== planId)); setLocalCredits((prev) => ({ ...prev, [m.id]: Math.max(0, credits - deducted) })) }}
            />
          )
        }}
      />

      <Modal visible={showAddForm} animationType="slide" presentationStyle="pageSheet">
        <AddMemberForm onClose={() => setShowAddForm(false)} onSuccess={(member) => { setLocalMembers([member, ...members]); setShowAddForm(false) }} />
      </Modal>
    </SafeAreaView>
  )
}

function SectionHeader({ title, icon, collapsed, onToggle, COLORS, styles }: {
  title: string; icon: string; collapsed?: boolean; onToggle?: () => void
  COLORS: ReturnType<typeof useColors>; styles: ReturnType<typeof makeStyles>
}) {
  const iconEl = icon === "active"
    ? <Check size={14} color={COLORS.green} />
    : icon === "lead"
    ? <UserX size={14} color="#1d4ed8" />
    : <UserX size={14} color={COLORS.textMuted} />

  const inner = (
    <View style={styles.sectionHeaderRow}>
      {iconEl}
      <Text style={[styles.sectionHeaderText, { flex: 1 }]}>{title}</Text>
      {onToggle && (collapsed ? <ChevronDown size={14} color={COLORS.textMuted} /> : <ChevronUp size={14} color={COLORS.textMuted} />)}
    </View>
  )

  if (onToggle) {
    return <TouchableOpacity onPress={onToggle} activeOpacity={0.7}>{inner}</TouchableOpacity>
  }
  return inner
}


type MemberCardProps = {
  member: AdminMember; credits: number; plans: MemberPlan[]; bookings: AdminBooking[]
  packages: DancePackage[]; statusInfo: { label: string; bg: string; fg: string }
  isOpen: boolean; onToggle: () => void
  onCreditsChange: (id: string, val: number) => void
  onPlanAdded: (plan: MemberPlan, creditsAdded: number) => void
  onPlanRemoved: (planId: string, deducted: number) => void
}

function MemberCard({ member: m, credits, plans, bookings, packages, statusInfo, isOpen, onToggle, onCreditsChange, onPlanAdded, onPlanRemoved }: MemberCardProps) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [selectedPkg, setSelectedPkg] = useState("")
  const [pkgPickerOpen, setPkgPickerOpen] = useState(false)
  const [editCredits, setEditCredits] = useState("")
  const [saving, setSaving] = useState(false)
  const [bookingsExpanded, setBookingsExpanded] = useState(false)

  function addSingleSession(label: string) {
    Alert.alert(
      "Add single session",
      `Add 1 × ${label} single session credit to ${m.name || m.email}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Add session",
          onPress: async () => {
            setSaving(true)
            const { data, error } = await authClient.$fetch(`${API}/api/admin/members/plans`, {
              method: "POST", body: JSON.stringify({ memberId: m.id, userId: m.userId, email: m.email, currentCredits: credits, label }), headers: { "Content-Type": "application/json" },
            })
            setSaving(false)
            if (error || !data) { Alert.alert("Error", "Failed to add session."); return }
            onPlanAdded((data as any).plan, 0) // single credits are per-type; pack credits unchanged
          },
        },
      ],
    )
  }

  async function assignPackage() {
    if (!selectedPkg) return
    const pkg = packages.find((p) => p.id === selectedPkg); if (!pkg) return
    setSaving(true)
    const { data, error } = await authClient.$fetch(`${API}/api/admin/members/plans`, {
      method: "POST", body: JSON.stringify({ memberId: m.id, userId: m.userId, email: m.email, currentCredits: credits, packageId: selectedPkg }), headers: { "Content-Type": "application/json" },
    })
    setSaving(false)
    if (error || !data) { Alert.alert("Error", "Failed to assign plan."); return }
    setSelectedPkg(""); setPkgPickerOpen(false); onPlanAdded((data as any).plan, pkg.sessions)
  }

  async function removePlan(plan: MemberPlan) {
    Alert.alert("Remove Plan", `Remove "${plan.planName}" from ${m.name || m.email}? This will deduct ${plan.sessions} credits.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        setSaving(true)
        const { error } = await authClient.$fetch(`${API}/api/admin/members/plans`, {
          method: "DELETE", body: JSON.stringify({ planId: plan.id, memberId: m.id, planSessions: plan.sessions, currentCredits: credits }), headers: { "Content-Type": "application/json" },
        })
        setSaving(false)
        if (error) { Alert.alert("Error", "Failed to remove plan."); return }
        onPlanRemoved(plan.id, plan.sessions)
      }},
    ])
  }

  async function setCredits() {
    const val = parseInt(editCredits, 10)
    if (Number.isNaN(val) || val < 0) { Alert.alert("Error", "Enter a valid number."); return }
    setSaving(true)
    const { error } = await authClient.$fetch(`${API}/api/admin/members/credits`, {
      method: "POST", body: JSON.stringify({ memberId: m.id, newCredits: val }), headers: { "Content-Type": "application/json" },
    })
    setSaving(false)
    if (error) { Alert.alert("Error", "Failed to set credits."); return }
    onCreditsChange(m.id, val); setEditCredits("")
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.cardHeader} onPress={onToggle} activeOpacity={0.7}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(m.name || m.email || "?")}</Text></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.name} numberOfLines={1}>{m.name || "(no name)"}</Text>
          <Text style={styles.email} numberOfLines={1}>{m.email}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: statusInfo.bg }]}><Text style={[styles.badgeText, { color: statusInfo.fg }]}>{statusInfo.label}</Text></View>
        <View style={[styles.badge, { backgroundColor: COLORS.primaryLight, flexDirection: "row", gap: 3 }]}>
          <Ticket size={10} color={COLORS.primary} />
          <Text style={[styles.badgeText, { color: COLORS.primary }]}>{credits}</Text>
        </View>
        {(["90", "60", "45", "30"] as const).map((min) => {
          const count = (m.singleCredits as Record<string, number>)?.[min] ?? 0
          if (!count) return null
          const bg = min === "90" ? "#fff7ed" : min === "60" ? "#eff6ff" : min === "45" ? "#fffbeb" : "#faf5ff"
          const fg = min === "90" ? "#c2410c" : min === "60" ? "#1d4ed8" : min === "45" ? "#b45309" : "#7e22ce"
          return (
            <View key={min} style={[styles.badge, { backgroundColor: bg, flexDirection: "row", gap: 3 }]}>
              <Ticket size={10} color={fg} />
              <Text style={[styles.badgeText, { color: fg }]}>{count > 1 ? `${count} × ` : ""}{min} min</Text>
            </View>
          )
        })}
        {isOpen ? <ChevronUp size={16} color={COLORS.textMuted} /> : <ChevronDown size={16} color={COLORS.textMuted} />}
      </TouchableOpacity>

      {isOpen && (
        <View style={styles.expanded}>
          <View style={styles.divider} />
          {(m.phone || m.goals) ? (
            <View style={styles.section}>
              {m.phone ? <InfoRow label="Phone" value={formatPhone(m.phone)} /> : null}
              {m.goals ? <InfoRow label="Goals" value={m.goals} /> : null}
            </View>
          ) : null}
          <View style={styles.section}>
            <View style={styles.sectionHeader}><Package size={14} color={COLORS.textMuted} /><Text style={styles.sectionTitle}>Assign a plan</Text></View>
            <TouchableOpacity style={styles.picker} onPress={() => setPkgPickerOpen(true)} activeOpacity={0.7}>
              <Text style={{ color: selectedPkg ? COLORS.text : COLORS.textMuted, fontSize: 14, flex: 1 }}>
                {selectedPkg ? packages.find((p) => p.id === selectedPkg)?.name ?? "Select package…" : "Select package…"}
              </Text>
              <ChevronDown size={14} color={COLORS.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnPrimary, (!selectedPkg || saving) && styles.btnDisabled]} onPress={assignPackage} disabled={!selectedPkg || saving} activeOpacity={0.7}>
              <Text style={styles.btnPrimaryText}>{saving ? "Saving…" : "Assign"}</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>Assigning a plan adds its sessions as credits to the member's account.</Text>
          </View>
          {plans.length > 0 && (
            <GroupedPlanHistory plans={plans} credits={credits} saving={saving} onRemove={removePlan} COLORS={COLORS} styles={styles} />
          )}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Add single session</Text>
            <View style={styles.btnRow}>
              {(["90 min", "60 min", "45 min", "30 min"] as const).map((label) => (
                <TouchableOpacity key={label} style={styles.btnOutline} onPress={() => addSingleSession(label)} disabled={saving} activeOpacity={0.7}>
                  <Plus size={12} color={COLORS.primary} />
                  <Text style={styles.btnOutlineText}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Set credit balance</Text>
            <View style={styles.inputRow}>
              <TextInput style={styles.numberInput} keyboardType="number-pad" placeholder={String(credits)} placeholderTextColor={COLORS.textMuted} value={editCredits} onChangeText={setEditCredits} />
              <TouchableOpacity style={[styles.btnOutline, (!editCredits || saving) && styles.btnDisabled]} onPress={setCredits} disabled={!editCredits || saving} activeOpacity={0.7}>
                <Text style={styles.btnOutlineText}>Save</Text>
              </TouchableOpacity>
              <Text style={styles.hint}>Current: {credits}</Text>
            </View>
          </View>
          <View style={styles.section}>
            <TouchableOpacity style={styles.collapseRow} onPress={() => setBookingsExpanded((v) => !v)} activeOpacity={0.7}>
              <CalendarDays size={14} color={COLORS.textMuted} />
              <Text style={styles.sectionTitle}>Booking history ({bookings.length})</Text>
              {bookingsExpanded ? <ChevronUp size={14} color={COLORS.textMuted} /> : <ChevronDown size={14} color={COLORS.textMuted} />}
            </TouchableOpacity>
            {bookingsExpanded && (
              bookings.length === 0 ? <Text style={styles.hint}>No bookings yet.</Text> : bookings.map((b) => {
                const sl = (b.status ?? "").toLowerCase()
                const isPastBooking = b.utcDatetime ? new Date(b.utcDatetime) <= new Date() : b.date ? new Date(b.date) <= new Date() : false
                const displayStatus = sl === "confirmed" && isPastBooking ? "Completed" : (b.status ?? sl)
                const dsl = displayStatus.toLowerCase()
                const bg = dsl === "confirmed" ? COLORS.primaryLight : dsl === "completed" ? COLORS.grayLight : dsl.startsWith("cancelled") ? COLORS.redLight : COLORS.grayLight
                const fg = dsl === "confirmed" ? COLORS.primary : dsl === "completed" ? COLORS.textMuted : dsl.startsWith("cancelled") ? COLORS.red : COLORS.textMuted
                return (
                  <View key={b.id} style={styles.bookingItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bookingName}>{b.prepMasterName || "PrepMaster"}</Text>
                      <Text style={styles.bookingMeta}>{b.date}{b.time ? ` · ${formatTime(b.time)}` : ""}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: bg }]}><Text style={[styles.badgeText, { color: fg }]}>{displayStatus}</Text></View>
                  </View>
                )
              })
            )}
          </View>
        </View>
      )}

      <Modal visible={pkgPickerOpen} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} onPress={() => setPkgPickerOpen(false)} activeOpacity={1}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Select Package</Text>
            {packages.map((pkg) => (
              <TouchableOpacity key={pkg.id} style={[styles.sheetOption, selectedPkg === pkg.id && { backgroundColor: COLORS.primaryLight }]} onPress={() => { setSelectedPkg(pkg.id); setPkgPickerOpen(false) }} activeOpacity={0.7}>
                <Text style={[styles.sheetOptionText, selectedPkg === pkg.id && { color: COLORS.primary }]}>{pkg.name} — {pkg.sessions} sessions (${pkg.price})</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  )
}

const PLAN_STATUS_ORDER = ["Active", "Expired", "Used"] as const

function GroupedPlanHistory({ plans, credits, saving, onRemove, COLORS, styles }: {
  plans: MemberPlan[]; credits: number; saving: boolean
  onRemove: (plan: MemberPlan) => void
  COLORS: ReturnType<typeof useColors>; styles: ReturnType<typeof makeStyles>
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ Used: true })
  const activeSingleCount = plans.filter((p) => planDisplayStatus(p) === "Active" && p.sessions === 1).length

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Plan history ({plans.length})</Text>
      {PLAN_STATUS_ORDER.map((group) => {
        const groupPlans = plans.filter((p) => planDisplayStatus(p) === group)
        if (groupPlans.length === 0) return null
        const isCollapsed = collapsed[group] ?? false
        return (
          <View key={group}>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 }}
              onPress={() => setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }))}
              activeOpacity={0.7}
            >
              {isCollapsed ? <ChevronDown size={12} color={COLORS.textMuted} /> : <ChevronUp size={12} color={COLORS.textMuted} />}
              <Text style={{ fontSize: 11, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {group} ({groupPlans.length})
              </Text>
            </TouchableOpacity>
            {!isCollapsed && groupPlans.map((plan) => {
              const s = planDisplayStatus(plan)
              const purchaseDate = plan.purchasedAt ? new Date(plan.purchasedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null
              const expiryDate = plan.expiresAt ? new Date(plan.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null
              const planStatusBg = s === "Active" ? COLORS.greenLight : s === "Used" ? COLORS.amberLight : COLORS.grayLight
              const planStatusFg = s === "Active" ? COLORS.green : s === "Used" ? COLORS.amber : COLORS.textMuted
              const displayCount = s !== "Active" ? plan.sessions : plan.sessions === 1 ? 1 : Math.max(0, credits - activeSingleCount)
              return (
                <View key={plan.id} style={[styles.planItem, { marginBottom: 6 }]}>
                  <View style={styles.planRow}>
                    <Package size={12} color={COLORS.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.planName}>{plan.planName}</Text>
                      <Text style={styles.planMeta}>{displayCount} {displayCount === 1 ? "credit" : "credits"} · ${plan.pricePaid}{purchaseDate ? ` · ${purchaseDate}` : ""}</Text>
                      {expiryDate ? <Text style={styles.planMeta}>Expires {expiryDate}</Text> : null}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <View style={[styles.badge, { backgroundColor: planStatusBg }]}><Text style={[styles.badgeText, { color: planStatusFg }]}>{s}</Text></View>
                      {s !== "Used" && <TouchableOpacity onPress={() => onRemove(plan)} disabled={saving} hitSlop={8}><Trash2 size={14} color={COLORS.textMuted} /></TouchableOpacity>}
                    </View>
                  </View>
                </View>
              )
            })}
          </View>
        )
      })}
    </View>
  )
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  const d = digits.startsWith("1") && digits.length === 11 ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return raw
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function AddMemberForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: (m: AdminMember) => void }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [name, setName] = useState(""); const [email, setEmail] = useState("")
  const [phone, setPhone] = useState(""); const [goals, setGoals] = useState("")
  const [credits, setCredits] = useState("0"); const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim()) { Alert.alert("Error", "Name is required."); return }
    if (!email.trim()) { Alert.alert("Error", "Email is required."); return }
    setSaving(true)
    const { data, error } = await authClient.$fetch(`${API}/api/admin/members`, {
      method: "POST", body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim(), goals: goals.trim(), creditsRemaining: parseInt(credits, 10) || 0 }), headers: { "Content-Type": "application/json" },
    })
    setSaving(false)
    if (error || !data) { Alert.alert("Error", "Failed to create member."); return }
    onSuccess((data as any).member)
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>Add New Member</Text>
        <TouchableOpacity onPress={onClose} hitSlop={8}><X size={22} color={COLORS.text} /></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.formBody}>
        <Text style={styles.formHint}>Creates a member record in Airtable. They'll be linked automatically when they sign in with the same email.</Text>
        <FormField label="Full name *" value={name} onChangeText={setName} placeholder="Jane Doe" />
        <FormField label="Email *" value={email} onChangeText={setEmail} placeholder="jane@example.com" keyboardType="email-address" />
        <FormField label="Phone" value={phone} onChangeText={setPhone} placeholder="(555) 000-0000" keyboardType="phone-pad" />
        <FormField label="Goals" value={goals} onChangeText={setGoals} placeholder="e.g. Improve turns, prepare for auditions…" />
        <FormField label="Starting credits" value={credits} onChangeText={setCredits} placeholder="0" keyboardType="number-pad" />
        <TouchableOpacity style={[styles.btnPrimary, saving && styles.btnDisabled]} onPress={submit} disabled={saving} activeOpacity={0.7}>
          <Text style={styles.btnPrimaryText}>{saving ? "Adding…" : "Add Member"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

function FormField({ label, value, onChangeText, placeholder, keyboardType }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: any
}) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput style={styles.formInput} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={COLORS.textMuted} keyboardType={keyboardType} autoCapitalize="none" />
    </View>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    toolbar: { flexDirection: "row", gap: SPACING.sm, margin: SPACING.md, alignItems: "center" },
    searchRow: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.sm },
    searchInput: { flex: 1, height: 40, fontSize: 14, color: COLORS.text },
    addBtn: { backgroundColor: COLORS.primary, width: 40, height: 40, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
    list: { paddingHorizontal: SPACING.md, paddingBottom: 80 },
    separator: { height: SPACING.sm },
    emptyWrap: { flex: 1, justifyContent: "center", alignItems: "center" },
    empty: { fontSize: 14, color: COLORS.textMuted, textAlign: "center", marginTop: SPACING.xl },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: SPACING.sm, paddingTop: SPACING.md },
    sectionHeaderText: { fontSize: 12, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
    card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, overflow: "hidden" },
    pendingCardInner: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.md },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.md },
    avatar: { width: 36, height: 36, borderRadius: RADIUS.full, backgroundColor: COLORS.primaryLight, alignItems: "center", justifyContent: "center" },
    avatarText: { fontSize: 13, fontWeight: "700", color: COLORS.primary },
    name: { fontSize: 14, fontWeight: "600", color: COLORS.text },
    email: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full, alignItems: "center" },
    badgeText: { fontSize: 11, fontWeight: "600" },
    approvalBtns: { flexDirection: "column", gap: 6 },
    denyBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: COLORS.redLight, borderRadius: RADIUS.sm, paddingVertical: 5, paddingHorizontal: 10 },
    approveBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingVertical: 5, paddingHorizontal: 10 },
    approvalBtnText: { fontSize: 12, fontWeight: "600" },
    expanded: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.md },
    divider: { height: 1, backgroundColor: COLORS.border, marginBottom: SPACING.md },
    section: { marginBottom: SPACING.md, gap: 6 },
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
    sectionTitle: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
    infoLabel: { fontSize: 13, color: COLORS.textMuted },
    infoValue: { fontSize: 13, color: COLORS.text, fontWeight: "500", flex: 1, textAlign: "right" },
    picker: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm, backgroundColor: COLORS.background },
    btnPrimary: { backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingVertical: 10, alignItems: "center" },
    btnPrimaryText: { color: "#fff", fontWeight: "600", fontSize: 14 },
    btnDisabled: { opacity: 0.4 },
    hint: { fontSize: 11, color: COLORS.textMuted },
    planItem: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm, backgroundColor: COLORS.background },
    planRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
    planName: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    planMeta: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
    btnRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    btnOutline: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, paddingVertical: 7, paddingHorizontal: 12 },
    btnOutlineText: { fontSize: 13, color: COLORS.primary, fontWeight: "500" },
    inputRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
    numberInput: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm, width: 80, fontSize: 14, color: COLORS.text, backgroundColor: COLORS.background },
    collapseRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    bookingItem: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm, backgroundColor: COLORS.background },
    bookingName: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    bookingMeta: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
    overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet: { backgroundColor: COLORS.background, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg, padding: SPACING.md, paddingBottom: 40 },
    sheetTitle: { fontSize: 16, fontWeight: "700", color: COLORS.text, marginBottom: SPACING.md },
    sheetOption: { paddingVertical: 12, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.sm },
    sheetOptionText: { fontSize: 14, color: COLORS.text },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
    modalTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text, fontFamily: "Sora_600SemiBold" },
    formBody: { padding: SPACING.md, gap: SPACING.md },
    formHint: { fontSize: 13, color: COLORS.textMuted },
    formField: { gap: 4 },
    formLabel: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    formInput: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm, fontSize: 14, color: COLORS.text, backgroundColor: COLORS.background },
  })
}
