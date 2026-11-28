import Svg, { Circle, Path, Text as SvgText } from "react-native-svg"

const MEDALS = [
  { face: "#e6b422", rim: "#a67c00", ribbon: ["#2f6fd6", "#d63a5a"] }, // gold
  { face: "#c9ccd1", rim: "#8a8f97", ribbon: ["#2f6fd6", "#d63a5a"] }, // silver
  { face: "#cd7f3a", rim: "#8c4f1c", ribbon: ["#2f6fd6", "#d63a5a"] }, // bronze
]

/** A small ribboned medal for 1st–3rd place. */
export function RankMedal({ rank, size = 30 }: { rank: 1 | 2 | 3; size?: number }) {
  const m = MEDALS[rank - 1]
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 32 40">
      {/* ribbon tails */}
      <Path d="M8 0 L15 0 L19 16 L12 16 Z" fill={m.ribbon[0]} />
      <Path d="M24 0 L17 0 L13 16 L20 16 Z" fill={m.ribbon[1]} />
      {/* medal */}
      <Circle cx="16" cy="26" r="12" fill={m.rim} />
      <Circle cx="16" cy="26" r="9.5" fill={m.face} />
      <SvgText x="16" y="30.5" fontSize="12" fontWeight="800" fill="#ffffff" textAnchor="middle">{rank}</SvgText>
    </Svg>
  )
}
