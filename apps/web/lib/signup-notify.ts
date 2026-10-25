import "server-only"
import { db } from "@/lib/db"
import { user as userTable, signupNotified } from "@/lib/db/schema"
import { and, eq, gt, inArray, isNull, lt } from "drizzle-orm"
import { sendEmail, newMemberPendingEmail, signupReceivedEmail } from "@/lib/email"
import { sendPushToUser } from "@/lib/push"

const FRESH_SIGNUP_MS = 24 * 60 * 60 * 1000

/**
 * Alerts admins (email + push) that a new member is awaiting approval, and
 * sends the member their "we got your sign-up" email. Sends at most once per
 * user. Returns false when it deliberately did nothing.
 *
 * Apple sign-in delivers the user's name in a separate request that can land
 * many seconds after the account row is created, so this is called from the
 * create hook (name already known), the user-update hook (name just arrived)
 * and a sweep cron (name never arrived — allowBlankName).
 */
export async function notifyAdminsOfSignup(userId: string, opts?: { allowBlankName?: boolean }): Promise<boolean> {
  const [u] = await db
    .select({ name: userTable.name, email: userTable.email, status: userTable.status, createdAt: userTable.createdAt })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1)
  if (!u || u.status !== "pending") return false
  if (Date.now() - new Date(u.createdAt).getTime() > FRESH_SIGNUP_MS) return false

  const name = u.name?.trim()
  if (!name && !opts?.allowBlankName) return false

  const claimed = await db.insert(signupNotified).values({ userId }).onConflictDoNothing().returning({ userId: signupNotified.userId })
  if (claimed.length === 0) return false

  const memberName = name || u.email

  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
  const admins = adminEmails.length > 0
    ? await db.select({ id: userTable.id, email: userTable.email }).from(userTable).where(inArray(userTable.email, adminEmails))
    : []

  const appUrl = process.env.BETTER_AUTH_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "https://app.collegedanceprep.com")

  const { subject, html } = newMemberPendingEmail({ memberName, memberEmail: u.email, reviewUrl: `${appUrl}/admin` })
  const signupEmail = signupReceivedEmail({ memberName })
  await Promise.allSettled([
    sendEmail({ to: u.email, subject: signupEmail.subject, html: signupEmail.html }),
    ...admins.map((admin) => sendEmail({ to: admin.email, subject, html })),
    ...admins.map((admin) =>
      sendPushToUser(admin.id, {
        title: "New member request",
        body: `${memberName} signed up and is awaiting approval.`,
        data: { route: "/admin" },
      })
    ),
  ])
  return true
}

export async function pendingSignupsAwaitingAlert(olderThanMs: number, newerThanMs: number): Promise<string[]> {
  const now = Date.now()
  const rows = await db
    .select({ id: userTable.id })
    .from(userTable)
    .leftJoin(signupNotified, eq(signupNotified.userId, userTable.id))
    .where(and(
      eq(userTable.status, "pending"),
      isNull(signupNotified.userId),
      gt(userTable.createdAt, new Date(now - newerThanMs)),
      lt(userTable.createdAt, new Date(now - olderThanMs)),
    ))
  return rows.map((r) => r.id)
}
