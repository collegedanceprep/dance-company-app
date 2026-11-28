import React, { useEffect, useRef, useState } from "react"
import { API_BASE } from "@/lib/config"
import { Tabs, usePathname, useRouter } from "expo-router"
import { Home, Calendar, Package, CircleUserRound, Inbox } from "lucide-react-native"
import { useColors } from "@/lib/theme-context"
import { authClient } from "@/lib/auth-client"

function RoleGuard() {
  const router = useRouter()
  const checked = useRef(false)
  useEffect(() => {
    if (checked.current) return
    checked.current = true
    authClient.$fetch(`${API_BASE}/api/me`).then(({ data }: any) => {
      const role = data?.role
      if (role && role === "prep_master") router.replace("/")
    }).catch(() => { /* network error — do not redirect */ })
  }, [])
  return null
}

// Same standard tab bar as the admin and PrepMaster views.
export default function MemberLayout() {
  const COLORS = useColors()
  const pathname = usePathname()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    authClient.$fetch(`${API_BASE}/api/notifications`).then(({ data }: any) => {
      if (data?.notifications) setUnread(data.notifications.filter((n: any) => !n.read).length)
    }).catch(() => {})
  }, [pathname])

  return (
    <>
      <RoleGuard />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: COLORS.textMuted,
          tabBarStyle: { borderTopColor: COLORS.border, backgroundColor: COLORS.background },
          tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Home color={color} size={size} /> }} />
        <Tabs.Screen
          name="inbox"
          options={{
            title: "Inbox",
            tabBarIcon: ({ color, size }) => <Inbox color={color} size={size} />,
            tabBarBadge: unread > 0 ? (unread > 9 ? "9+" : unread) : undefined,
          }}
        />
        <Tabs.Screen name="bookings" options={{ title: "Bookings", tabBarIcon: ({ color, size }) => <Calendar color={color} size={size} /> }} />
        <Tabs.Screen name="plans" options={{ title: "Plans", tabBarIcon: ({ color, size }) => <Package color={color} size={size} /> }} />
        <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <CircleUserRound color={color} size={size} /> }} />
        <Tabs.Screen name="book" options={{ href: null }} />
      </Tabs>
    </>
  )
}
