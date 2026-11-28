export const LIGHT_COLORS = {
  primary: "#f21890",
  primaryLight: "#f2ecfa",
  pinkLight: "#fde4f1",
  accent: "#0a9cb8",
  accentLight: "#e3f7fa",
  plum: "#6b2a7a",
  background: "#f4f2f8",
  surface: "#ffffff",
  border: "#e0d9ea",
  text: "#14111c",
  textSecondary: "#5c566a",
  textMuted: "#999999",
  green: "#16a34a",
  greenLight: "#dcfce7",
  amber: "#d97706",
  amberLight: "#fef3c7",
  red: "#dc2626",
  redLight: "#fee2e2",
  gray: "#6b7280",
  grayLight: "#f3f4f6",
}

export const DARK_COLORS = {
  primary: "#f53fa3",
  primaryLight: "#241a33",
  pinkLight: "#3a1033",
  accent: "#0dc4e0",
  accentLight: "#0d2a30",
  plum: "#d4a5f0",
  background: "#0c0a12",
  surface: "#14111c",
  border: "#2a2433",
  text: "#f0f0f0",
  textSecondary: "#a0a0a0",
  textMuted: "#666666",
  green: "#4ade80",
  greenLight: "#052e16",
  amber: "#fbbf24",
  amberLight: "#1c1207",
  red: "#f87171",
  redLight: "#2d0a0a",
  gray: "#9ca3af",
  grayLight: "#1f1f1f",
}

export const COLORS = LIGHT_COLORS

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 999,
}

export const FONTS = {
  /** Geist — body text, matches web sans-serif */
  sans: "Geist_400Regular",
  sansMedium: "Geist_500Medium",
  sansSemiBold: "Geist_600SemiBold",
  sansBold: "Geist_700Bold",
  /** Sora — headings, matches web font-heading */
  heading: "Sora_600SemiBold",
  headingBold: "Sora_700Bold",
}
