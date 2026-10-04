import { db } from "@/lib/db"
import { pushToken } from "@/lib/db/schema"
import { eq, inArray } from "drizzle-orm"

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

export type PushPayload = {
  title: string
  body: string
  data?: Record<string, unknown>
  categoryIdentifier?: string
}

/** Sends a push notification to every registered device for a user. Fire-and-forget safe. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const tokens = await db
    .select({ token: pushToken.token })
    .from(pushToken)
    .where(eq(pushToken.userId, userId))

  if (tokens.length === 0) return

  const messages = tokens.map(({ token }) => ({
    to: token,
    sound: "default" as const,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    categoryIdentifier: payload.categoryIdentifier,
  }))

  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(messages),
  })

  if (!res.ok) {
    console.error("[sendPushToUser] Expo push request failed:", res.status, await res.text().catch(() => ""))
    return
  }

  // Expo returns one ticket per message, same order as sent. A ticket with
  // status "error" never reaches the device — in particular
  // DeviceNotRegistered means the token is permanently dead (app
  // uninstalled, etc.) and must be removed or every future notification to
  // this user keeps silently failing on it forever.
  const body = await res.json().catch(() => null) as { data?: Array<{ status: string; message?: string; details?: { error?: string } }> } | null
  const tickets = body?.data ?? []
  const deadTokens: string[] = []
  tickets.forEach((ticket, i) => {
    if (ticket.status !== "error") return
    console.error("[sendPushToUser] Expo ticket error:", ticket.details?.error, ticket.message, "token:", tokens[i]?.token)
    if (ticket.details?.error === "DeviceNotRegistered") deadTokens.push(tokens[i].token)
  })
  if (deadTokens.length > 0) {
    await db.delete(pushToken).where(inArray(pushToken.token, deadTokens)).catch(() => {})
  }
}
