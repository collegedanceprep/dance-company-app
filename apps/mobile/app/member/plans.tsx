import { useState } from "react"
import { API_BASE } from "@/lib/config"
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking, Alert } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Check, Clock, Gift } from "lucide-react-native"
import { SPACING, RADIUS } from "@/constants/theme"
import { authClient } from "@/lib/auth-client"
import { PACKAGES, PER_PRIVATE, PACK_PROMO, promoBonusCredits } from "@cdp/core"
import { useColors } from "@/lib/theme-context"


async function startCheckout(itemId: string, setLoading: (id: string | null) => void) {
  setLoading(itemId)
  try {
    const { data, error } = await authClient.$fetch(`${API_BASE}/api/checkout`, {
      method: "POST", body: JSON.stringify({ itemId }), headers: { "Content-Type": "application/json" },
    })
    if (error) throw new Error((error as any)?.message ?? JSON.stringify(error))
    const url = (data as any)?.url
    if (!url) throw new Error("No checkout URL returned.")
    await Linking.openURL(url)
  } catch (e) { Alert.alert("Checkout error", e instanceof Error ? e.message : "Could not open checkout. Please try again.") }
  setLoading(null)
}

export default function MemberPlansScreen() {
  const [loading, setLoading] = useState<string | null>(null)
  const COLORS = useColors()
  const styles = makeStyles(COLORS)

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Your Training, Your Choice!</Text>
          <Text style={styles.subtitle}>Every session is a full hour, one-on-one with the PrepMaster of your choice.{" "}<Text style={styles.subtitleAccent}>Book more, save more.</Text></Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Packages</Text>
          <Text style={styles.sectionSub}>Hourly privates — the more you commit, the more you save.</Text>
          <View style={styles.packageGrid}>
            {PACKAGES.map((pkg) => {
              const isHighlight = !!pkg.highlight
              const isLoading = loading === pkg.id
              return (
                <View key={pkg.id} style={[styles.packageCard, isHighlight && styles.packageCardHighlight]}>
                  {isHighlight && <View style={styles.popularBadge}><Text style={styles.popularText}>Most popular</Text></View>}
                  <View style={styles.packageTop}>
                    <Text style={styles.packageName}>{pkg.name}</Text>
                    <View style={styles.savingsBadge}><Text style={styles.savingsText}>Save ${pkg.savings}</Text></View>
                  </View>
                  <Text style={styles.packageType}>Hourly privates</Text>
                  {promoBonusCredits(pkg.id) > 0 && (
                    <View style={styles.promoSticker}>
                      <Gift size={13} color="#78350F" />
                      <Text style={styles.promoText}>{PACK_PROMO.label}: +{promoBonusCredits(pkg.id)} free through {PACK_PROMO.endLabel}</Text>
                    </View>
                  )}
                  <View style={styles.priceRow}>
                    <Text style={styles.price}>${pkg.price}</Text>
                    <Text style={styles.pricePer}>/ {pkg.sessions} hours</Text>
                  </View>
                  <View style={styles.features}>
                    {pkg.features.map((f) => (
                      <View key={f} style={styles.featureRow}>
                        <Check size={14} color={COLORS.primary} />
                        <Text style={styles.featureText}>{f}</Text>
                      </View>
                    ))}
                  </View>
                  <TouchableOpacity
                    style={[styles.btn, isHighlight ? styles.btnPrimary : styles.btnOutline, isLoading && styles.btnDisabled]}
                    onPress={() => startCheckout(pkg.id, setLoading)} disabled={!!loading} activeOpacity={0.7}
                  >
                    {isLoading ? <ActivityIndicator size="small" color={isHighlight ? "#fff" : COLORS.primary} /> : <Text style={[styles.btnText, isHighlight ? styles.btnTextPrimary : styles.btnTextOutline]}>Get {pkg.name}</Text>}
                  </TouchableOpacity>
                </View>
              )
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Per Private</Text>
          <Text style={styles.sectionSub}>Prefer to pay as you go? Book a single private session.</Text>
          {PER_PRIVATE.map((s) => {
            const isLoading = loading === s.id
            return (
              <View key={s.id} style={styles.perPrivateCard}>
                <View style={styles.clockIcon}><Clock size={20} color={COLORS.textSecondary} /></View>
                <View style={styles.perPrivateInfo}>
                  <Text style={styles.perPrivateName}>{s.name}</Text>
                  <Text style={styles.perPrivateSub} numberOfLines={1}>{s.minutes}-minute private session</Text>
                </View>
                <Text style={styles.perPrivatePrice}>${s.price}</Text>
                <TouchableOpacity style={[styles.btn, styles.btnOutline, styles.btnSm, isLoading && styles.btnDisabled]} onPress={() => startCheckout(s.id, setLoading)} disabled={!!loading} activeOpacity={0.7}>
                  {isLoading ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={styles.btnTextOutline}>Book single</Text>}
                </TouchableOpacity>
              </View>
            )
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(COLORS: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: COLORS.background },
    scroll: { padding: SPACING.md, gap: SPACING.lg, paddingBottom: SPACING.xl },
    header: { gap: SPACING.sm, alignItems: "center", paddingTop: SPACING.sm },
    title: { fontSize: 24, fontWeight: "700", color: COLORS.text, textAlign: "center", fontFamily: "Sora_700Bold" },
    subtitle: { fontSize: 13, fontWeight: "700", color: COLORS.text, textAlign: "center", lineHeight: 20 },
    subtitleAccent: { fontSize: 13, fontWeight: "700", color: COLORS.primary },
    section: { gap: SPACING.sm },
    sectionTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text, fontFamily: "Sora_600SemiBold" },
    sectionSub: { fontSize: 13, color: COLORS.textMuted },
    packageGrid: { gap: SPACING.md },
    packageCard: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.sm },
    packageCardHighlight: { borderColor: COLORS.primary, borderWidth: 2 },
    popularBadge: { alignSelf: "center", backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 4, borderRadius: RADIUS.full, marginBottom: 2 },
    popularText: { fontSize: 11, fontWeight: "700", color: "#fff" },
    packageTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    packageName: { fontSize: 18, fontWeight: "700", color: COLORS.text, fontFamily: "Sora_600SemiBold" },
    promoSticker: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "#FEF3C7", paddingHorizontal: 12, paddingVertical: 5, borderRadius: RADIUS.full, marginTop: 8 },
    promoText: { color: "#78350F", fontSize: 12, fontWeight: "700" },
    savingsBadge: { backgroundColor: COLORS.primary + "22", paddingHorizontal: 18, paddingVertical: 9, borderRadius: RADIUS.full },
    savingsText: { fontSize: 17, fontWeight: "700", color: COLORS.primary },
    packageType: { fontSize: 12, color: COLORS.textMuted },
    priceRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, marginTop: 4 },
    price: { fontSize: 36, fontWeight: "800", color: COLORS.text },
    pricePer: { fontSize: 13, color: COLORS.textMuted, marginBottom: 6 },
    features: { gap: 8, marginTop: 4 },
    featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    featureText: { fontSize: 13, color: COLORS.text, flex: 1, lineHeight: 18 },
    btn: { borderRadius: RADIUS.sm, paddingVertical: 11, alignItems: "center", justifyContent: "center", marginTop: SPACING.sm },
    btnPrimary: { backgroundColor: COLORS.primary },
    btnOutline: { borderWidth: 1, borderColor: COLORS.border },
    btnSm: { paddingVertical: 7, paddingHorizontal: 14, marginTop: 0 },
    btnDisabled: { opacity: 0.5 },
    btnText: { fontSize: 14, fontWeight: "600" },
    btnTextPrimary: { color: "#fff" },
    btnTextOutline: { color: COLORS.text, fontSize: 13, fontWeight: "600" },
    perPrivateCard: { flexDirection: "row", alignItems: "center", backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, gap: SPACING.sm },
    clockIcon: { width: 40, height: 40, borderRadius: RADIUS.full, backgroundColor: COLORS.grayLight, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    perPrivateInfo: { flex: 1, minWidth: 0 },
    perPrivateName: { fontSize: 15, fontWeight: "700", color: COLORS.text },
    perPrivateSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1 },
    perPrivatePrice: { fontSize: 20, fontWeight: "700", color: COLORS.text, flexShrink: 0 },
  })
}
