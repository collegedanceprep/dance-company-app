import { betterAuth } from "better-auth"
import { expo } from "@better-auth/expo"
import { pool, db } from "@/lib/db"
import { user as userTable } from "@/lib/db/schema"
import { eq } from "drizzle-orm"
import { sendEmail, sendPasswordResetEmail, newMemberPendingEmail, signupReceivedEmail, duplicateAccountWarningEmail } from "@/lib/email"
import { sendPushToUser } from "@/lib/push"

export const auth = betterAuth({
  plugins: [expo()],
  database: pool,
  baseURL:
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.V0_RUNTIME_URL),
  // Email + password is enabled for now so the app is fully testable without
  // any external OAuth setup.
  emailAndPassword: {
    enabled: true,
    resetPasswordTokenExpiresIn: 60 * 60 * 4, // 4 hours
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail({ name: user.name, email: user.email, url })
    },
  },
  socialProviders: {
    // Apple Sign-In: verify the identity token from expo-apple-authentication
    // against Apple's JWKS. No server-side credentials needed for native-only flow.
    apple: {
      clientId: process.env.APPLE_CLIENT_ID ?? "com.collegedanceprep.app",
      clientSecret: process.env.APPLE_CLIENT_SECRET ?? "",
      verifyIdToken: async (token: string) => {
        try {
          const { createRemoteJWKSet, jwtVerify } = await import("jose")
          const JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"))
          const { payload } = await jwtVerify(token, JWKS, {
            issuer: "https://appleid.apple.com",
            audience: process.env.APPLE_CLIENT_ID ?? "com.collegedanceprep.app",
          })
          if (!payload.sub) return false
          return {
            user: {
              id: payload.sub as string,
              email: (payload.email as string | undefined) ?? "",
              name: (payload.name as string | undefined) ?? (payload.email as string | undefined) ?? "",
              emailVerified: (payload.email_verified as string | undefined) === "true",
            },
          }
        } catch {
          return false
        }
      },
    },
    // Google stays wired up but only activates once its credentials are present,
    // so it's a one-step restore later (just add GOOGLE_CLIENT_ID/SECRET).
    ...(process.env.GOOGLE_CLIENT_ID
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
            prompt: "select_account",
            // Accept ID tokens from web or native iOS/Android client IDs.
            // Google's tokeninfo endpoint validates signature, expiry, and issuer;
            // we only need to check that the audience is one we own.
            verifyIdToken: async (token: string) => {
              try {
                const res = await fetch(
                  `https://oauth2.googleapis.com/tokeninfo?id_token=${token}`,
                )
                if (!res.ok) return false
                const payload = await res.json()
                const allowedAudiences = [
                  process.env.GOOGLE_CLIENT_ID!,
                  ...(process.env.GOOGLE_IOS_CLIENT_ID
                    ? [process.env.GOOGLE_IOS_CLIENT_ID]
                    : []),
                ]
                if (!allowedAudiences.includes(payload.aud)) return false
                return {
                  user: {
                    id: payload.sub,
                    email: payload.email,
                    name: payload.name ?? payload.email,
                    image: payload.picture ?? null,
                    emailVerified: payload.email_verified === "true",
                  },
                }
              } catch {
                return false
              }
            },
          },
        }
    : {}),
  },
  onAPIError: {
    // Redirect all OAuth errors back to the homepage with ?error= so we can
    // show a human-readable message instead of a raw /api/auth/error page.
    errorURL: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.collegedanceprep.com"}/?error=auth_error`,
  },
  trustedOrigins: [
    ...(process.env.V0_RUNTIME_URL ? [process.env.V0_RUNTIME_URL] : []),
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
    ...(process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
      : []),
    // The v0 preview renders the app inside an iframe served from a
    // *.vusercontent.net host that varies per session. Trust the wildcard so
    // sign-in/sign-up work in the preview without hardcoding a single host.
    "https://*.vusercontent.net",
    // Native mobile app (Expo) — no browser origin header
    "cdp://",
    "cdp://localhost",
    // Allow local origins during development/testing.
    ...(process.env.NODE_ENV === "development"
      ? ["http://localhost:3000", `http://localhost:${process.env.PORT ?? 3000}`]
      : []),
  ],
  advanced: {
    ...(process.env.NODE_ENV === "development"
      ? {
          defaultCookieAttributes: {
            sameSite: "none" as const,
            secure: true,
          },
        }
      : {}),
    // Native apps don't send an Origin header — disable the check so the
    // Expo mobile client can reach the auth endpoints.
    disableCSRFCheck: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  accountLinking: {
    enabled: true,
    trustedProviders: ["google", "apple"],
    // Only allow linking when the Google email matches the account email exactly.
    // This prevents a PM from accidentally (or intentionally) linking a different Gmail.
    allowDifferentEmail: false,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (newUser) => {
          // Admins and PrepMasters are auto-approved; everyone else starts as pending
          const adminEmails = (process.env.ADMIN_EMAILS ?? "")
            .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
          const email = newUser.email.trim().toLowerCase()
          const isAdmin = adminEmails.includes(email)

          // Always set an explicit status immediately — never rely on the DB default
          // PrepMasters are recognized by: (1) invite table, OR (2) Airtable Workers roster.
          // Checking both means PrepMasters are auto-approved even if their invite record
          // wasn't created yet (e.g. admin hasn't visited the PrepMasters tab).
          let isPrepMaster = false
          try {
            const { prepMasterInvite } = await import("@/lib/db/schema")
            const { eq: eqOp, and, ne } = await import("drizzle-orm")
            const { getPrepMasterByEmail, isAirtableConfigured } = await import("@/lib/airtable")
            const [inviteCheck, workerCheck] = await Promise.allSettled([
              db
                .select({ status: prepMasterInvite.status })
                .from(prepMasterInvite)
                .where(and(eqOp(prepMasterInvite.email, email), ne(prepMasterInvite.status, "revoked")))
                .limit(1),
              isAirtableConfigured() ? getPrepMasterByEmail(email) : Promise.resolve(null),
            ])
            const invite = inviteCheck.status === "fulfilled" ? inviteCheck.value[0] : null
            const worker = workerCheck.status === "fulfilled" ? workerCheck.value : null
            isPrepMaster = Boolean(invite) || Boolean(worker)
            // Mark invite accepted now that they've signed up
            if (invite && invite.status === "pending") {
              await db
                .update(prepMasterInvite)
                .set({ status: "accepted", acceptedAt: new Date() })
                .where(eqOp(prepMasterInvite.email, email))
                .catch(() => {})
            }
            // Auto-create the invite record so future lookups don't need Airtable
            if (!invite && worker) {
              const { randomUUID } = await import("crypto")
              const { prepMasterInvite: pmi } = await import("@/lib/db/schema")
              await db.insert(pmi).values({
                id: randomUUID(),
                email,
                name: worker.name,
                invitedBy: "system",
                status: "pending",
              }).onConflictDoNothing()
            }
            // Clean up any stale Airtable Members record for this PrepMaster so it
            // can never get a User ID stamped on it and spill into the Members panel.
            // Admin accounts (cdprepadmin1, collegedanceprep) are exempt — they need
            // access across all portals.
            const adminOnlyEmails = ["cdprepadmin1@gmail.com", "collegedanceprep@gmail.com"]
            if (isPrepMaster && !adminOnlyEmails.includes(email) && isAirtableConfigured()) {
              try {
                const { appBase, TABLES } = await import("@/lib/airtable")
                const safe = email.replace(/'/g, "\\'")
                const existing = await appBase.list(TABLES.clients, {
                  filterByFormula: `LOWER({Email}) = '${safe}'`,
                  maxRecords: 1,
                  revalidate: 0,
                })
                if (existing[0]) await appBase.destroy(TABLES.clients, existing[0].id)
              } catch { /* non-fatal */ }
            }
          } catch { /* non-fatal */ }

          // Check if this email is a parent/guardian for an existing member —
          // parents are auto-approved, no admin review needed.
          let isParent = false
          try {
            const { isAirtableConfigured: isATConfigured, appBase, TABLES } = await import("@/lib/airtable")
            if (isATConfigured()) {
              const safe = email.replace(/'/g, "\\'")
              const children = await appBase.list(TABLES.clients, {
                filterByFormula: `LOWER({Parent Email}) = '${safe}'`,
                maxRecords: 1,
                revalidate: 0,
              })
              isParent = children.length > 0
            }
          } catch { /* non-fatal */ }

          // Auto-activate known Apple reviewer Apple IDs (stable sub values set in
          // APPLE_REVIEWER_APPLE_IDS env var). Do NOT use the relay email address as
          // the signal — any user who taps "Hide My Email" on Apple Sign-In gets a
          // relay address, so that check bypasses the approval wall for real members.
          let isAppleReviewer = false
          try {
            const reviewerSubs = (process.env.APPLE_REVIEWER_APPLE_IDS ?? "")
              .split(",").map((s) => s.trim()).filter(Boolean)
            if (reviewerSubs.length > 0 && email.endsWith("@privaterelay.appleid.com")) {
              const appleAccount = await db
                .select({ accountId: (await import("@/lib/db/schema")).account.accountId })
                .from((await import("@/lib/db/schema")).account)
                .where((await import("drizzle-orm")).and(
                  (await import("drizzle-orm")).eq((await import("@/lib/db/schema")).account.userId, newUser.id),
                  (await import("drizzle-orm")).eq((await import("@/lib/db/schema")).account.providerId, "apple"),
                ))
                .limit(1)
              isAppleReviewer = appleAccount.length > 0 && reviewerSubs.includes(appleAccount[0].accountId)
            }
          } catch { /* non-fatal */ }

          if (isAdmin || isPrepMaster || isParent || isAppleReviewer) {
            await db.update(userTable).set({ status: "active" }).where(eq(userTable.id, newUser.id))
            return
          }

          await db.update(userTable)
            .set({ status: "pending" })
            .where(eq(userTable.id, newUser.id))

          // If this is an Apple relay sign-in, check for an existing account with
          // the same name — the user may have accidentally created a duplicate by
          // tapping "Hide My Email." Send them a heads-up at the relay address,
          // which Apple forwards to their real inbox.
          if (email.endsWith("@privaterelay.appleid.com") && newUser.name) {
            try {
              const { ilike, and: andOp, ne } = await import("drizzle-orm")
              const existing = await db
                .select({ email: userTable.email, name: userTable.name })
                .from(userTable)
                .where(andOp(
                  ilike(userTable.name, newUser.name.trim()),
                  ne(userTable.id, newUser.id),
                ))
                .limit(1)
              if (existing.length > 0) {
                const appUrl = process.env.BETTER_AUTH_URL
                  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
                    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
                    : "https://app.collegedanceprep.com")
                const mergeUrl = `${appUrl}/merge-account?from=${newUser.id}`
                const warn = duplicateAccountWarningEmail({
                  memberName: newUser.name,
                  existingEmail: existing[0].email,
                  mergeUrl,
                })
                await sendEmail({ to: newUser.email, subject: warn.subject, html: warn.html }).catch(() => {})
              }
            } catch { /* non-fatal */ }
          }

          // Notify all admins via email + push
          const { inArray } = await import("drizzle-orm")
          const admins = adminEmails.length > 0
            ? await db
                .select({ id: userTable.id, email: userTable.email })
                .from(userTable)
                .where(inArray(userTable.email, adminEmails))
            : []

          // Re-fetch the user so we get the name as saved by the OAuth provider
          // (Apple writes the name in a separate step after the hook fires).
          const [freshUser] = await db
            .select({ name: userTable.name })
            .from(userTable)
            .where(eq(userTable.id, newUser.id))
            .limit(1)
          const memberName = freshUser?.name || newUser.name

          const appUrl = process.env.BETTER_AUTH_URL
            ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
              ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
              : "https://app.collegedanceprep.com")
          const reviewUrl = `${appUrl}/admin`

          const { subject, html } = newMemberPendingEmail({
            memberName,
            memberEmail: newUser.email,
            reviewUrl,
          })

          const signupEmail = signupReceivedEmail({ memberName })
          await Promise.allSettled([
            sendEmail({ to: newUser.email, subject: signupEmail.subject, html: signupEmail.html }),
            ...admins.map((admin) => sendEmail({ to: admin.email, subject, html })),
            ...admins.map((admin) =>
              sendPushToUser(admin.id, {
                title: "New member request",
                body: `${memberName} signed up and is awaiting approval.`,
                data: { route: "/admin" },
              })
            ),
          ])
        },
      },
    },
  },
})
