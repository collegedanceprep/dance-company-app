import { useEffect, useState } from "react"
import { Image, type ImageStyle, type StyleProp } from "react-native"
import { authClient } from "@/lib/auth-client"
import { API_BASE } from "@/lib/config"

/**
 * Image for private API paths (e.g. dancer photos). React Native's image loader doesn't
 * send the login cookie on its own, so we attach it as a header.
 */
export function AuthImage({ path, style }: { path: string; style?: StyleProp<ImageStyle> }) {
  const [cookie, setCookie] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    authClient.getCookie().then((c) => { if (alive) setCookie(c) }).catch(() => { if (alive) setCookie("") })
    return () => { alive = false }
  }, [])
  if (cookie === null) return <Image style={style} source={{ uri: undefined }} />
  return <Image style={style} source={{ uri: `${API_BASE}${path}`, headers: cookie ? { Cookie: cookie } : undefined }} />
}
