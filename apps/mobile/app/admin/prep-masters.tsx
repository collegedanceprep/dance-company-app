import React, { useState, useCallback, useEffect } from "react"
import { useLocalSearchParams, useRouter } from "expo-router"
import { API_BASE } from "@/lib/config"
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Modal, ScrollView, RefreshControl, ActivityIndicator, Alert, Switch, FlatList,
} from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import {
  Search, ChevronDown, ChevronUp, Plus, X, ArrowLeft,
  DollarSign, CalendarDays, User, Mail, Phone, Home, ChevronRight, GraduationCap,
} from "lucide-react-native"
import { SPACING, RADIUS, initials } from "@/constants/theme"
import { useColors } from "@/lib/theme-context"
import { formatTime } from "@/components/BookingDetailModal"
import { useAdmin } from "@/lib/admin-context"
import { authClient } from "@/lib/auth-client"
import { getUniversityColor } from "@/lib/university-colors"
import type { AdminWorker, AdminBooking } from "@/lib/admin-types"
import { PER_PRIVATE, sessionRevenue, SESSION_DURATION_FRACTION } from "@cdp/core"
import { fallbackUtcMs } from "@/lib/time-utils"

const API = "https://app.collegedanceprep.com"

const UNIVERSITIES = [
  "Alabama","Arizona","ASU","Boise","Cincinnati","Coastal Carolina","CSU","CU Boulder",
  "ECU","Florida","FSU","GCU","Indiana","Iowa State","Kansas State","Kansas University",
  "Kentucky","Louisville","LSU Tiger Girls","Mississippi State","NC State","Ole Miss",
  "Ohio State Club Team","Oklahoma","Oregon","Penn State","Pitt","Purdue","Samford",
  "Sam Houston State","SDSU","South Carolina","TCU","Tennessee","Texas State","U Miami",
  "UCLA","UCSB","UK","UNLV","Utah","Vanderbilt","Virginia Tech","Washington",
  "Western Michigan","Wisconsin","WVU","Wichita State",
]
// Built directly from the real per-duration prices, plus Pack hour, so this
// list can never drift out of sync with actual pricing or omit a duration.
// Pack hour intentionally excluded — sessions are booked by duration now.
const PRICE_POINTS = PER_PRIVATE.map((p) => ({
  sessionType: p.id,
  label: `${p.minutes} min per-private`,
  revenue: p.price,
}))

function fmt(n: number) { return `$${n.toFixed(2)}` }

function formatSessionType(t: string): string {
  const map: Record<string, string> = {
    "pack-hour": "Pack hour",
    "private-30": "30 min per-private",
    "private-45": "45 min per-private",
    "private-60": "60 min per-private",
    "private-90": "90 min per-private",
  }
  return map[t] ?? t
}

function isBookingPast(b: AdminBooking): boolean {
  const t = b.utcDatetime
    ? new Date(b.utcDatetime).getTime()
    : b.date && b.time ? fallbackUtcMs(b.date, b.time) : b.date ? new Date(b.date).getTime() : 0
  return t > 0 && t <= Date.now()
}

function effectiveBookingStatus(b: AdminBooking): string {
  const s = b.status?.toLowerCase() ?? ""
  if (s === "confirmed" && isBookingPast(b)) return "completed"
  return s
}

const HISTORY_STATUS_GROUPS = [
  { key: "pending", label: "Pending" },
  { key: "confirmed", label: "Confirmed" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "other", label: "Other" },
]

export default function AdminPrepMastersScreen() {
  const { data, loading, refresh } = useAdmin()
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const router = useRouter()
  const { worker: workerParam } = useLocalSearchParams<{ worker?: string }>()
  const [query, setQuery] = useState("")
  const [uniFilter, setUniFilter] = useState("")
  const [selected, setSelected] = useState<AdminWorker | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [localWorkers, setLocalWorkers] = useState<AdminWorker[] | null>(null)

  const onRefresh = useCallback(async () => { setRefreshing(true); await refresh(); setLocalWorkers(null); setRefreshing(false) }, [refresh])

  // Auto-select the PrepMaster passed via ?worker=<id> (e.g. tapping a name
  // in "Top PrepMasters this month" on the Overview tab), then clear the
  // param so it doesn't re-trigger on a later refresh.
  useEffect(() => {
    if (!workerParam || !data?.workers) return
    const match = data.workers.find((w) => w.id === workerParam)
    if (match) {
      setSelected(match)
      router.setParams({ worker: undefined })
    }
  }, [workerParam, data?.workers])

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      </SafeAreaView>
    )
  }

  const workers = localWorkers ?? data?.workers ?? []
  const bookings = data?.bookings ?? []
  const universities = Array.from(new Set(workers.map((w) => w.university).filter(Boolean))).sort()
  const filtered = workers.filter((w) => {
    const q = query.toLowerCase().trim()
    const matchesQuery = !q || w.name.toLowerCase().includes(q) || w.email.toLowerCase().includes(q) || (w.university ?? "").toLowerCase().includes(q)
    const matchesUni = !uniFilter || w.university === uniFilter
    return matchesQuery && matchesUni
  })

  if (selected) {
    return (
      <PrepMasterProfile
        worker={selected}
        bookings={bookings.filter((b) => b.prepMasterName === selected.name)}
        onBack={() => setSelected(null)}
        onSaved={(updated) => { setSelected(updated); setLocalWorkers((prev) => (prev ?? workers).map((w) => w.id === updated.id ? updated : w)) }}
        onDeleted={() => { setSelected(null); setLocalWorkers((prev) => (prev ?? workers).filter((w) => w.id !== selected.id)) }}
      />
    )
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.toolbar}>
        <View style={[styles.searchRow, { flex: 1 }]}>
          <Search size={16} color={COLORS.textMuted} style={{ marginRight: 6 }} />
          <TextInput style={styles.searchInput} placeholder="Search PrepMasters…" placeholderTextColor={COLORS.textMuted} value={query} onChangeText={setQuery} autoCorrect={false} clearButtonMode="while-editing" />
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddForm(true)} activeOpacity={0.7}><Plus size={18} color="#fff" /></TouchableOpacity>
      </View>
      {universities.length > 0 && (
        <View style={styles.uniFilterWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.uniFilterRow}>
            <TouchableOpacity style={[styles.uniFilterChip, !uniFilter && styles.uniFilterChipActive]} onPress={() => setUniFilter("")} activeOpacity={0.7}>
              <Text style={[styles.uniFilterChipText, !uniFilter && { color: COLORS.primary }]}>All</Text>
            </TouchableOpacity>
            {universities.map((uni) => {
              const { bg, text } = getUniversityColor(uni)
              const isActive = uniFilter === uni
              return (
                <TouchableOpacity key={uni} style={[styles.uniFilterChip, isActive && { backgroundColor: bg, borderColor: bg }]} onPress={() => setUniFilter(isActive ? "" : uni)} activeOpacity={0.7}>
                  <Text style={[styles.uniFilterChipText, isActive && { color: text }]}>{uni}</Text>
                </TouchableOpacity>
              )
            })}
          </ScrollView>
        </View>
      )}
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        contentContainerStyle={{ paddingBottom: 100, paddingTop: SPACING.xs }}
      >
        {filtered.length === 0 ? (
          <Text style={styles.empty}>{workers.length === 0 ? "No PrepMasters yet." : "No PrepMasters match your search."}</Text>
        ) : (
          <>
            {[{ label: "Active", items: filtered.filter((w) => w.active), defaultOpen: true },
              { label: "Inactive", items: filtered.filter((w) => !w.active), defaultOpen: false }]
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <PMCollapsibleGroup key={g.label} label={g.label} count={g.items.length} defaultOpen={g.defaultOpen}>
                  {g.items.map((w) => {
                    const sessionCount = bookings.filter((b) => b.prepMasterName === w.name && b.status.toLowerCase() !== "cancelled").length
                    return (
                      <TouchableOpacity key={w.id} style={styles.card} onPress={() => setSelected(w)} activeOpacity={0.7}>
                        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(w.name || "?")}</Text></View>
                        <View style={{ flex: 1, gap: 4, minWidth: 0, overflow: "hidden" }}>
                          <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">{w.name}</Text>
                          {w.university ? (
                            <View style={[styles.uniChip, { backgroundColor: getUniversityColor(w.university).bg }]}>
                              <Text style={[styles.uniChipText, { color: getUniversityColor(w.university).text }]} numberOfLines={1}>{w.university}</Text>
                            </View>
                          ) : w.region ? <Text style={styles.sub} numberOfLines={1}>{w.region}</Text> : null}
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                          <Text style={styles.sub}>{sessionCount} session{sessionCount !== 1 ? "s" : ""}</Text>
                          <View style={{ flexDirection: "row", gap: 4 }}>
                            <View style={[styles.badge, {
                              backgroundColor: w.inviteStatus === "accepted" ? COLORS.primaryLight : w.inviteStatus === "revoked" ? COLORS.redLight : COLORS.amberLight,
                            }]}>
                              <Text style={[styles.badgeText, {
                                color: w.inviteStatus === "accepted" ? COLORS.primary : w.inviteStatus === "revoked" ? COLORS.red : COLORS.amber,
                              }]}>{w.inviteStatus === "accepted" ? "Joined" : w.inviteStatus === "revoked" ? "Revoked" : "Pending"}</Text>
                            </View>
                            <View style={[styles.badge, { backgroundColor: w.active ? COLORS.greenLight : COLORS.grayLight }]}>
                              <Text style={[styles.badgeText, { color: w.active ? COLORS.green : COLORS.textMuted }]}>{w.active ? "Active" : "Inactive"}</Text>
                            </View>
                          </View>
                        </View>
                        <ChevronRight size={16} color={COLORS.textMuted} />
                      </TouchableOpacity>
                    )
                  })}
                </PMCollapsibleGroup>
              ))}
          </>
        )}
      </ScrollView>
      <Modal visible={showAddForm} animationType="slide" presentationStyle="pageSheet">
        <AddPrepMasterForm onClose={() => setShowAddForm(false)} onSuccess={(worker) => { setLocalWorkers([worker, ...workers]); setShowAddForm(false) }} />
      </Modal>
    </SafeAreaView>
  )
}

function PMCollapsibleGroup({ label, count, defaultOpen, children }: { label: string; count: number; defaultOpen: boolean; children: React.ReactNode }) {
  const COLORS = useColors()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <View style={{ marginBottom: SPACING.sm }}>
      <TouchableOpacity
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: SPACING.md }}
        onPress={() => setOpen((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={{ fontSize: 11, fontWeight: "700", color: COLORS.textMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>
          {label} <Text style={{ fontWeight: "400" }}>({count})</Text>
        </Text>
        {open ? <ChevronUp size={14} color={COLORS.textMuted} /> : <ChevronDown size={14} color={COLORS.textMuted} />}
      </TouchableOpacity>
      {open && <View style={{ paddingHorizontal: SPACING.md, gap: SPACING.sm }}>{children}</View>}
    </View>
  )
}

function PrepMasterProfile({ worker, bookings, onBack, onSaved, onDeleted }: {
  worker: AdminWorker; bookings: AdminBooking[]; onBack: () => void; onSaved: (w: AdminWorker) => void; onDeleted: () => void
}) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [name, setName] = useState(worker.name); const [email, setEmail] = useState(worker.email)
  const [phone, setPhone] = useState(worker.phone); const [address, setAddress] = useState(worker.address)
  const [university, setUniversity] = useState(worker.university ?? "")
  const [uniPickerOpen, setUniPickerOpen] = useState(false)
  const [hourlyRate, setHourlyRate] = useState(String(worker.hourlyRate))
  const [active, setActive] = useState(worker.active)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false); const [historyOpen, setHistoryOpen] = useState(false)
  const [filterMonth, setFilterMonth] = useState(""); const [expandedBooking, setExpandedBooking] = useState<string | null>(null)

  const completed = bookings.filter((b) => b.status.toLowerCase() !== "cancelled")
  const payPerSession = worker.hourlyRate
  const totalPay = completed.reduce((sum, b) => sum + payPerSession * (SESSION_DURATION_FRACTION[b.sessionType ?? ""] ?? 1), 0)
  const totalRevenue = completed.reduce((sum, b) => sum + sessionRevenue(b.sessionType), 0)
  const margin = totalRevenue - totalPay
  const months = Array.from(new Set(bookings.map((b) => b.date?.slice(0, 7)).filter(Boolean))).sort().reverse()
  const filteredBookings = (filterMonth ? bookings.filter((b) => b.date?.startsWith(filterMonth)) : bookings)
    .slice()
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
  const historyGroups = HISTORY_STATUS_GROUPS.map((g) => ({
    ...g,
    items: filteredBookings.filter((b) => {
      const es = effectiveBookingStatus(b)
      if (g.key === "cancelled") return es.startsWith("cancelled")
      if (g.key === "other") return !HISTORY_STATUS_GROUPS.slice(0, -1).some((sg) => sg.key === "cancelled" ? es.startsWith("cancelled") : es === sg.key)
      return es === g.key
    }),
  })).filter((g) => g.items.length > 0)

  function handleDelete() {
    Alert.alert(
      "Delete PrepMaster",
      `Permanently delete ${worker.name}? This removes them from Airtable and their login account. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
          setDeleting(true)
          const { data, error } = await authClient.$fetch(`${API}/api/admin/workers/${worker.id}`, {
            method: "DELETE",
            body: JSON.stringify({ email: worker.email }),
            headers: { "Content-Type": "application/json" },
          })
          setDeleting(false)
          if (error) { Alert.alert("Error", "Failed to delete PrepMaster."); return }
          onDeleted()
        }},
      ],
    )
  }

  async function handleSave() {
    const rate = parseFloat(hourlyRate)
    if (Number.isNaN(rate) || rate < 0) { Alert.alert("Error", "Pay rate must be a valid number."); return }
    setSaving(true)
    const { error } = await authClient.$fetch(`${API}/api/admin/workers/${worker.id}`, {
      method: "PATCH", body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim(), address: address.trim(), university: university.trim(), hourlyRate: rate, active }), headers: { "Content-Type": "application/json" },
    })
    setSaving(false)
    if (error) { Alert.alert("Error", "Failed to update PrepMaster."); return }
    onSaved({ ...worker, name: name.trim(), email: email.trim(), phone: phone.trim(), address: address.trim(), university: university.trim(), hourlyRate: rate, active })
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.profileBody}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
            <ArrowLeft size={16} color={COLORS.primary} /><Text style={styles.backText}>All PrepMasters</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleDelete} disabled={deleting} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.deleteTiny}>{deleting ? "Deleting…" : "Delete PrepMaster"}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.section}>
          <TouchableOpacity style={styles.profileCardHeader} onPress={() => setInfoOpen((v) => !v)} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{worker.name}</Text>
              <Text style={styles.sub}>Edit profile, pay rate, and status</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: active ? COLORS.greenLight : COLORS.grayLight }]}>
              <Text style={[styles.badgeText, { color: active ? COLORS.green : COLORS.textMuted }]}>{active ? "Active" : "Inactive"}</Text>
            </View>
            {infoOpen ? <ChevronUp size={16} color={COLORS.textMuted} /> : <ChevronDown size={16} color={COLORS.textMuted} />}
          </TouchableOpacity>
          {infoOpen && (
            <View style={styles.editFields}>
              <EditField label="Full name" icon={<User size={13} color={COLORS.textMuted} />} value={name} onChange={setName} />
              <EditField label="Email" icon={<Mail size={13} color={COLORS.textMuted} />} value={email} onChange={setEmail} keyboardType="email-address" />
              <EditField label="Phone" icon={<Phone size={13} color={COLORS.textMuted} />} value={phone} onChange={setPhone} keyboardType="phone-pad" />
              <EditField label="Address" icon={<Home size={13} color={COLORS.textMuted} />} value={address} onChange={setAddress} />
              <View style={styles.editField}>
                <View style={styles.editFieldLabel}><GraduationCap size={13} color={COLORS.textMuted} /><Text style={styles.editFieldLabelText}>University</Text></View>
                <TouchableOpacity style={[styles.formInput, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]} onPress={() => setUniPickerOpen(true)} activeOpacity={0.7}>
                  {university ? (() => {
                    const uc = getUniversityColor(university)
                    return <View style={[styles.uniChip, { backgroundColor: uc.bg }]}><Text style={[styles.uniChipText, { color: uc.text }]}>{university}</Text></View>
                  })() : <Text style={{ fontSize: 14, color: COLORS.textMuted }}>Select university</Text>}
                  <ChevronDown size={14} color={COLORS.textMuted} />
                </TouchableOpacity>
              </View>
              <EditField label="Pay rate per session ($)" icon={<DollarSign size={13} color={COLORS.textMuted} />} value={hourlyRate} onChange={setHourlyRate} keyboardType="decimal-pad" />
              <View style={styles.activeRow}>
                <Text style={styles.activeLabel}>Active — visible to dancers for booking</Text>
                <Switch value={active} onValueChange={setActive} trackColor={{ true: COLORS.primary }} />
              </View>
              <TouchableOpacity style={[styles.btnPrimary, saving && styles.btnDisabled]} onPress={handleSave} disabled={saving || deleting} activeOpacity={0.7}>
                <Text style={styles.btnPrimaryText}>{saving ? "Saving…" : "Save changes"}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        {bookings.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}><DollarSign size={14} color={COLORS.textMuted} /><Text style={styles.sectionTitle}>Payroll</Text></View>
            <View style={styles.statGrid}>
              <StatTile label="Pay rate / session" value={fmt(payPerSession)} />
              <StatTile label="Total sessions" value={String(completed.length)} />
              <StatTile label="Total pay owed" value={fmt(totalPay)} highlight />
              <StatTile label="Gross revenue" value={fmt(totalRevenue)} sub={`Margin ${fmt(margin)}`} />
            </View>
            <View style={styles.priceBreakdown}>
              <Text style={styles.breakdownTitle}>MARGIN BY SESSION TYPE</Text>
              <View style={styles.priceGrid}>
                {PRICE_POINTS.map(({ sessionType, label, revenue }) => {
                  const m = revenue - payPerSession * (SESSION_DURATION_FRACTION[sessionType] ?? 1)
                  return (
                    <View key={label} style={styles.pricePoint}>
                      <Text style={styles.pricePointLabel}>{label}</Text>
                      <Text style={styles.pricePointRevenue}>{fmt(revenue)} <Text style={styles.pricePointSub}>charged</Text></Text>
                      <Text style={[styles.pricePointMargin, { color: m < 0 ? COLORS.red : COLORS.green }]}>{m < 0 ? "−" : "+"}{fmt(Math.abs(m))} margin</Text>
                    </View>
                  )
                })}
              </View>
            </View>
          </View>
        )}
        <View style={styles.section}>
          <TouchableOpacity style={styles.collapseRow} onPress={() => setHistoryOpen((v) => !v)} activeOpacity={0.7}>
            <CalendarDays size={14} color={COLORS.textMuted} />
            <Text style={styles.sectionTitle}>Booking history ({bookings.length})</Text>
            {historyOpen ? <ChevronUp size={14} color={COLORS.textMuted} /> : <ChevronDown size={14} color={COLORS.textMuted} />}
          </TouchableOpacity>
          {historyOpen && (
            <>
              {months.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <TouchableOpacity style={[styles.filterChip, !filterMonth && styles.filterChipActive]} onPress={() => setFilterMonth("")} activeOpacity={0.7}>
                    <Text style={[styles.filterChipText, !filterMonth && { color: COLORS.primary }]}>All</Text>
                  </TouchableOpacity>
                  {months.map((m) => (
                    <TouchableOpacity key={m} style={[styles.filterChip, filterMonth === m && styles.filterChipActive]} onPress={() => setFilterMonth(m)} activeOpacity={0.7}>
                      <Text style={[styles.filterChipText, filterMonth === m && { color: COLORS.primary }]}>{new Date(m + "-01T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              {historyGroups.length === 0 ? <Text style={styles.empty}>No bookings match the selected filter.</Text> : historyGroups.map((g) => (
                <View key={g.key} style={{ marginBottom: SPACING.sm }}>
                  <Text style={styles.historyGroupLabel}>{g.label} ({g.items.length})</Text>
                  {g.items.map((b) => {
                    const isOpen = expandedBooking === b.id
                    const es = effectiveBookingStatus(b)
                    const bg = es === "confirmed" ? COLORS.primaryLight : es.startsWith("cancelled") ? COLORS.redLight : COLORS.grayLight
                    const fg = es === "confirmed" ? COLORS.primary : es.startsWith("cancelled") ? COLORS.red : COLORS.textMuted
                    return (
                      <View key={b.id} style={styles.bookingCard}>
                        <TouchableOpacity style={styles.bookingRow} onPress={() => setExpandedBooking(isOpen ? null : b.id)} activeOpacity={0.7}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.bookingName}>{b.dancerName || b.clientEmail || "Client"}</Text>
                            <Text style={styles.bookingMeta}>{b.date}{b.time ? ` · ${formatTime(b.time)}` : ""}</Text>
                            {b.sessionType ? <Text style={styles.bookingSessionType}>{formatSessionType(b.sessionType)}</Text> : null}
                          </View>
                          <View style={[styles.badge, { backgroundColor: bg }]}><Text style={[styles.badgeText, { color: fg }]}>{es}</Text></View>
                          {isOpen ? <ChevronUp size={12} color={COLORS.textMuted} /> : <ChevronDown size={12} color={COLORS.textMuted} />}
                        </TouchableOpacity>
                        {isOpen && (
                          <View style={styles.bookingDetail}>
                            <DetailGrid b={b} />
                            {b.notes ? (
                              <View style={styles.notesBox}>
                                <Text style={styles.notesLabel}>Notes</Text>
                                <Text style={styles.notesText}>{b.notes}</Text>
                              </View>
                            ) : <Text style={styles.noNotes}>No notes on this booking.</Text>}
                          </View>
                        )}
                      </View>
                    )
                  })}
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>

      <Modal visible={uniPickerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setUniPickerOpen(false)}>
        <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select University</Text>
            <TouchableOpacity onPress={() => setUniPickerOpen(false)} hitSlop={8}><X size={22} color={COLORS.text} /></TouchableOpacity>
          </View>
          <FlatList
            data={UNIVERSITIES}
            keyExtractor={(item) => item}
            contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm }}
            renderItem={({ item }) => {
              const uc = getUniversityColor(item)
              const selected = item === university
              return (
                <TouchableOpacity
                  style={[{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.sm }, selected && { backgroundColor: COLORS.primaryLight }]}
                  onPress={() => { setUniversity(item); setUniPickerOpen(false) }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.uniChip, { backgroundColor: uc.bg }]}><Text style={[styles.uniChipText, { color: uc.text, fontSize: 13 }]}>{item}</Text></View>
                  {selected && <Text style={{ fontSize: 16, color: COLORS.primary, fontWeight: "700" }}>✓</Text>}
                </TouchableOpacity>
              )
            }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

function DetailGrid({ b }: { b: AdminBooking }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)

  const timezone = b.utcDatetime
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : null

  const localTime = b.utcDatetime
    ? new Date(b.utcDatetime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    : null

  const cells: [string, string][] = [
    ["Dancer", b.dancerName || "—"],
    ["Email", b.clientEmail || "—"],
    ["Date", b.date || "—"],
    ["Time", b.time ? formatTime(b.time) : "—"],
    ["Session type", b.sessionType ? formatSessionType(b.sessionType) : "—"],
    ["Status", b.status],
    ...(localTime ? [["Local time", localTime] as [string, string]] : []),
    ...(timezone ? [["Timezone", timezone] as [string, string]] : []),
  ]

  return (
    <View style={styles.detailGrid}>
      {cells.map(([label, value]) => (
        <View key={label} style={styles.detailCell}>
          <Text style={styles.detailCellLabel}>{label}</Text>
          <Text style={styles.detailCellValue}>{value}</Text>
        </View>
      ))}
    </View>
  )
}

function EditField({ label, icon, value, onChange, keyboardType }: { label: string; icon: React.ReactNode; value: string; onChange: (v: string) => void; keyboardType?: any }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  return (
    <View style={styles.editField}>
      <View style={styles.editFieldLabel}>{icon}<Text style={styles.editFieldLabelText}>{label}</Text></View>
      <TextInput style={styles.formInput} value={value} onChangeText={onChange} keyboardType={keyboardType} autoCapitalize="none" placeholderTextColor={COLORS.textMuted} />
    </View>
  )
}

function StatTile({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  return (
    <View style={[styles.statTile, highlight && { borderColor: COLORS.primary + "40", backgroundColor: COLORS.primaryLight }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, highlight && { color: COLORS.primary }]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  )
}

function AddPrepMasterForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: (w: AdminWorker) => void }) {
  const COLORS = useColors()
  const styles = makeStyles(COLORS)
  const [name, setName] = useState(""); const [email, setEmail] = useState("")
  const [phone, setPhone] = useState(""); const [hourlyRate, setHourlyRate] = useState("")
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim()) { Alert.alert("Error", "Name is required."); return }
    if (!email.trim()) { Alert.alert("Error", "Email is required."); return }
    setSaving(true)
    const { data, error } = await authClient.$fetch(`${API}/api/admin/workers`, {
      method: "POST", body: JSON.stringify({ name: name.trim(), email: email.trim(), phone: phone.trim(), hourlyRate: parseFloat(hourlyRate) || 0 }), headers: { "Content-Type": "application/json" },
    })
    setSaving(false)
    if (error || !data) { Alert.alert("Error", "Failed to add PrepMaster."); return }
    onSuccess((data as any).worker)
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>Add PrepMaster</Text>
        <TouchableOpacity onPress={onClose} hitSlop={8}><X size={22} color={COLORS.text} /></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.formBody}>
        <Text style={styles.formHint}>Creates a profile in Airtable and grants sign-in access. They'll see their portal when they log in with this email.</Text>
        <FormField label="Full name *" value={name} onChangeText={setName} placeholder="Jane Doe" />
        <FormField label="Email *" value={email} onChangeText={setEmail} placeholder="jane@example.com" keyboardType="email-address" />
        <FormField label="Phone" value={phone} onChangeText={setPhone} placeholder="(555) 000-0000" keyboardType="phone-pad" />
        <FormField label="Pay rate per session ($)" value={hourlyRate} onChangeText={setHourlyRate} placeholder="0.00" keyboardType="decimal-pad" />
        <TouchableOpacity style={[styles.btnPrimary, saving && styles.btnDisabled]} onPress={submit} disabled={saving} activeOpacity={0.7}>
          <Text style={styles.btnPrimaryText}>{saving ? "Adding…" : "Add PrepMaster"}</Text>
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
    <View style={styles.formFieldWrap}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput style={styles.formInput} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={COLORS.textMuted} keyboardType={keyboardType} autoCapitalize="none" />
    </View>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    toolbar: { flexDirection: "row", gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingTop: SPACING.sm, paddingBottom: SPACING.xs, alignItems: "center", backgroundColor: COLORS.background },
    searchRow: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: SPACING.sm },
    searchInput: { flex: 1, height: 40, fontSize: 14, color: COLORS.text },
    addBtn: { backgroundColor: COLORS.primary, width: 40, height: 40, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
    list: { paddingHorizontal: SPACING.md, paddingBottom: 100, paddingTop: SPACING.xs },
    empty: { fontSize: 14, color: COLORS.textMuted, textAlign: "center", marginTop: SPACING.xl },
    card: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md },
    avatar: { width: 40, height: 40, borderRadius: RADIUS.full, backgroundColor: COLORS.primaryLight, alignItems: "center", justifyContent: "center" },
    avatarText: { fontSize: 14, fontWeight: "700", color: COLORS.primary },
    name: { fontSize: 15, fontWeight: "600", color: COLORS.text },
    sub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
    badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.full },
    badgeText: { fontSize: 11, fontWeight: "600" },
    profileBody: { padding: SPACING.md, gap: SPACING.md, paddingBottom: 80 },
    backBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 4 },
    backText: { fontSize: 14, fontWeight: "500", color: COLORS.primary },
    section: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, padding: SPACING.md, gap: SPACING.sm },
    profileCardHeader: { flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm },
    profileName: { fontSize: 18, fontWeight: "700", color: COLORS.text, fontFamily: "Sora_600SemiBold" },
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
    sectionTitle: { fontSize: 14, fontWeight: "600", color: COLORS.text, flex: 1 },
    historyGroupLabel: { fontSize: 10, fontWeight: "700", color: COLORS.textMuted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6 },
    collapseRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    editFields: { gap: SPACING.sm, marginTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: SPACING.sm },
    editField: { gap: 4 },
    editFieldLabel: { flexDirection: "row", alignItems: "center", gap: 4 },
    editFieldLabelText: { fontSize: 11, fontWeight: "600", color: COLORS.textMuted },
    formInput: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm, fontSize: 14, color: COLORS.text, backgroundColor: COLORS.background },
    activeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm },
    activeLabel: { fontSize: 14, fontWeight: "500", color: COLORS.text, flex: 1 },
    btnPrimary: { backgroundColor: COLORS.primary, borderRadius: RADIUS.sm, paddingVertical: 10, alignItems: "center" },
    btnPrimaryText: { color: "#fff", fontWeight: "600", fontSize: 14 },
    deleteTiny: { fontSize: 12, color: COLORS.red, fontWeight: "500" },
    btnDisabled: { opacity: 0.4 },
    statGrid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
    statTile: { flex: 1, minWidth: "45%", borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm, backgroundColor: COLORS.background },
    statLabel: { fontSize: 11, color: COLORS.textMuted },
    statValue: { fontSize: 18, fontWeight: "700", color: COLORS.text, marginTop: 2 },
    statSub: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
    priceBreakdown: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm, backgroundColor: COLORS.background },
    breakdownTitle: { fontSize: 10, fontWeight: "700", color: COLORS.textMuted, letterSpacing: 0.8, marginBottom: SPACING.sm },
    priceGrid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.md },
    pricePoint: { flex: 1, minWidth: "40%" },
    pricePointLabel: { fontSize: 11, color: COLORS.textMuted },
    pricePointRevenue: { fontSize: 14, fontWeight: "600", color: COLORS.text, marginTop: 1 },
    pricePointSub: { fontSize: 11, fontWeight: "400", color: COLORS.textMuted },
    pricePointMargin: { fontSize: 12, fontWeight: "500", marginTop: 1 },
    filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, marginRight: 6, backgroundColor: COLORS.background },
    filterChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
    filterChipText: { fontSize: 12, fontWeight: "500", color: COLORS.textMuted },
    uniChip: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.full },
    uniChipText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },
    uniFilterWrap: { height: 44, flexShrink: 0, backgroundColor: COLORS.background },
    uniFilterRow: { paddingHorizontal: SPACING.md, alignItems: "center", height: 44 },
    uniFilterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: RADIUS.full, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background, marginRight: 6 },
    uniFilterChipActive: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
    uniFilterChipText: { fontSize: 12, fontWeight: "600", color: COLORS.textMuted },
    bookingCard: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, overflow: "hidden", marginBottom: 6, backgroundColor: COLORS.background },
    bookingRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.sm },
    bookingName: { fontSize: 13, fontWeight: "600", color: COLORS.text },
    bookingMeta: { fontSize: 11, color: COLORS.textMuted, marginTop: 1 },
    bookingSessionType: { fontSize: 11, color: COLORS.primary, marginTop: 2, fontWeight: "500" },
    bookingDetail: { borderTopWidth: 1, borderTopColor: COLORS.border, padding: SPACING.sm, gap: SPACING.sm, backgroundColor: COLORS.surface },
    detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
    detailCell: { flex: 1, minWidth: "40%" },
    detailCellLabel: { fontSize: 10, color: COLORS.textMuted },
    detailCellValue: { fontSize: 13, fontWeight: "500", color: COLORS.text, marginTop: 1 },
    notesBox: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, padding: SPACING.sm, backgroundColor: COLORS.background },
    notesLabel: { fontSize: 10, color: COLORS.textMuted },
    notesText: { fontSize: 13, color: COLORS.text, marginTop: 2 },
    noNotes: { fontSize: 11, color: COLORS.textMuted, fontStyle: "italic" },
    modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: SPACING.md, borderBottomWidth: 1, borderBottomColor: COLORS.border },
    modalTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text, fontFamily: "Sora_600SemiBold" },
    formBody: { padding: SPACING.md, gap: SPACING.md },
    formHint: { fontSize: 13, color: COLORS.textMuted },
    formFieldWrap: { gap: 4 },
    formLabel: { fontSize: 13, fontWeight: "600", color: COLORS.text },
  })
}
