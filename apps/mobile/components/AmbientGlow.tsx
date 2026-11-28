import { useEffect, useRef } from "react"
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from "react-native"
import Svg, { Defs, RadialGradient, Stop, Circle } from "react-native-svg"
import { useTheme } from "@/lib/theme-context"

/**
 * Slow-drifting pink and cyan glows (the website's colors) for auth screens.
 * Purely decorative: sits behind content and ignores touches.
 */
function Blob({ color, size, opacity }: { color: string; size: number; opacity: number }) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={`g${color}`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#g${color})`} />
    </Svg>
  )
}

function useDrift(duration: number) {
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [t, duration])
  return t
}

export function AmbientGlow() {
  const { width, height } = useWindowDimensions()
  const { isDark } = useTheme()
  const size = Math.max(width, height) * 0.9
  const a = useDrift(9000)
  const b = useDrift(12000)
  const strength = isDark ? 0.28 : 0.18

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={{
          position: "absolute",
          top: -size * 0.35,
          left: -size * 0.4,
          transform: [
            { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, width * 0.25] }) },
            { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.08] }) },
          ],
        }}
      >
        <Blob color="#f21890" size={size} opacity={strength} />
      </Animated.View>
      <Animated.View
        style={{
          position: "absolute",
          bottom: -size * 0.4,
          right: -size * 0.45,
          transform: [
            { translateX: b.interpolate({ inputRange: [0, 1], outputRange: [0, -width * 0.2] }) },
            { translateY: b.interpolate({ inputRange: [0, 1], outputRange: [0, -height * 0.1] }) },
          ],
        }}
      >
        <Blob color="#0dc4e0" size={size} opacity={strength * 0.8} />
      </Animated.View>
    </View>
  )
}
