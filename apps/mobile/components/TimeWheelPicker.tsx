import { useRef, useEffect, useCallback } from "react"
import { View, Text, ScrollView, StyleSheet } from "react-native"
import { useColors } from "@/lib/theme-context"

const ITEM_HEIGHT = 48
const VISIBLE_ITEMS = 5 // must be odd
const PADDING_ITEMS = Math.floor(VISIBLE_ITEMS / 2)

interface Props {
  slots: string[]        // available time strings e.g. ["9:00 AM", "9:15 AM", ...]
  value: string          // currently selected slot
  onChange: (slot: string) => void
  disabled?: boolean
}

export function TimeWheelPicker({ slots, value, onChange, disabled }: Props) {
  const COLORS = useColors()
  const ref = useRef<ScrollView>(null)
  const isScrolling = useRef(false)

  // Pad top and bottom so selected item centres in the wheel
  const padded = [
    ...Array(PADDING_ITEMS).fill(""),
    ...slots,
    ...Array(PADDING_ITEMS).fill(""),
  ]

  const selectedIndex = slots.indexOf(value)

  // Scroll to the selected value whenever it changes externally
  useEffect(() => {
    if (selectedIndex < 0) return
    const y = selectedIndex * ITEM_HEIGHT
    // Small delay to let layout settle before scrolling
    const t = setTimeout(() => {
      ref.current?.scrollTo({ y, animated: false })
    }, 50)
    return () => clearTimeout(t)
  }, [selectedIndex, slots.length])

  const snapToNearest = useCallback((offsetY: number) => {
    const idx = Math.round(offsetY / ITEM_HEIGHT)
    const clamped = Math.max(0, Math.min(idx, slots.length - 1))
    const slot = slots[clamped]
    if (slot && slot !== value) onChange(slot)
    // Snap scroll position cleanly
    ref.current?.scrollTo({ y: clamped * ITEM_HEIGHT, animated: true })
  }, [slots, value, onChange])

  const PICKER_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS

  return (
    <View style={[styles.container, { height: PICKER_HEIGHT }]} pointerEvents={disabled ? "none" : "auto"}>
      {/* Selection highlight band */}
      <View
        style={[
          styles.highlight,
          {
            top: ITEM_HEIGHT * PADDING_ITEMS,
            height: ITEM_HEIGHT,
            borderColor: COLORS.plum,
            backgroundColor: (COLORS as any).primaryLight ?? `${COLORS.primary}18`,
          },
        ]}
        pointerEvents="none"
      />

      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScrollBeginDrag={() => { isScrolling.current = true }}
        onMomentumScrollEnd={(e) => {
          isScrolling.current = false
          snapToNearest(e.nativeEvent.contentOffset.y)
        }}
        onScrollEndDrag={(e) => {
          // Fires when user lifts finger without momentum (slow drag)
          if (!isScrolling.current) return
          snapToNearest(e.nativeEvent.contentOffset.y)
        }}
        contentContainerStyle={{ paddingVertical: 0 }}
      >
        {padded.map((slot, i) => {
          const isSelected = slot === value
          const isEmpty = slot === ""
          return (
            <View key={`${slot}-${i}`} style={styles.item}>
              <Text
                style={[
                  styles.itemText,
                  { color: isEmpty ? "transparent" : isSelected ? COLORS.text : COLORS.textMuted },
                  isSelected && styles.itemTextSelected,
                ]}
              >
                {slot || " "}
              </Text>
            </View>
          )
        })}
      </ScrollView>

      {/* Fade mask top */}
      <View style={[styles.mask, styles.maskTop, { backgroundColor: COLORS.background }]} pointerEvents="none" />
      {/* Fade mask bottom */}
      <View style={[styles.mask, styles.maskBottom, { backgroundColor: COLORS.background }]} pointerEvents="none" />
    </View>
  )
}

/** Generates 15-minute time slots between startTime and endTime ("HH:MM" 24h strings). */
export function generate15MinSlots(startTime: string, endTime: string): string[] {
  const [startH, startM = 0] = startTime.split(":").map(Number)
  const [endH, endM = 0] = endTime.split(":").map(Number)
  const startMins = startH * 60 + startM
  const endMins = endH * 60 + endM
  const slots: string[] = []
  for (let m = startMins; m < endMins; m += 15) {
    const h = Math.floor(m / 60)
    const min = m % 60
    const period = h >= 12 ? "PM" : "AM"
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    slots.push(`${h12}:${String(min).padStart(2, "0")} ${period}`)
  }
  return slots
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    overflow: "hidden",
    position: "relative",
  },
  highlight: {
    position: "absolute",
    left: 0,
    right: 0,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderRadius: 8,
  },
  item: {
    height: ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  itemText: {
    fontSize: 17,
    fontWeight: "500",
  },
  itemTextSelected: {
    fontSize: 20,
    fontWeight: "700",
  },
  mask: {
    position: "absolute",
    left: 0,
    right: 0,
    height: ITEM_HEIGHT * PADDING_ITEMS,
    zIndex: 2,
    opacity: 0.85,
  },
  maskTop: { top: 0 },
  maskBottom: { bottom: 0 },
})
