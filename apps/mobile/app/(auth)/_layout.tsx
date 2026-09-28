import { Stack } from "expo-router"

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="parent-sign-up" />
      <Stack.Screen name="pending" />
      <Stack.Screen name="denied" />
      <Stack.Screen name="child-picker" />
    </Stack>
  )
}
