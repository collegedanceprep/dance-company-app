import { TABLES, appBase, getPlansForUser, type ClientFields } from "@/lib/airtable"
import { db } from "@/lib/db"
import { parentActiveChild, user as userTable } from "@/lib/db/schema"
import { eq } from "drizzle-orm"

export type ClientProfile = {
  recordId: string
  name: string
  email: string
  phone: string
  goals: string
  creditsRemaining: number
  singleCredits: { "30": number; "45": number; "60": number; "90": number }
  parentEmail: string
  effectiveUserId: string
  isParentView: boolean
  isNewProfile: boolean
}

async function findClientRecord(userId: string) {
  const safeId = userId.replace(/'/g, "\\'")
  const records = await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `{User ID} = '${safeId}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  return records[0] ?? null
}

async function findClientByEmail(email: string) {
  const safe = email.trim().toLowerCase().replace(/'/g, "\\'")
  const records = await appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `LOWER({Email}) = '${safe}'`,
    maxRecords: 1,
    revalidate: 0,
  })
  return records[0] ?? null
}

async function findClientsByParentEmail(parentEmail: string) {
  const safe = parentEmail.trim().toLowerCase().replace(/'/g, "\\'")
  return appBase.list<ClientFields>(TABLES.clients, {
    filterByFormula: `LOWER({Parent Email}) = '${safe}'`,
    revalidate: 0,
  })
}

export async function resolveClientProfile(
  user: { id: string; email: string; name: string },
  noCreate = false,
): Promise<ClientProfile> {
  let record = await findClientRecord(user.id)

  if (!record) {
    const byEmail = await findClientByEmail(user.email ?? "")
    if (byEmail) {
      // Always claim the record for this user — update the User ID if it's missing or stale
      if (byEmail.fields["User ID"] !== user.id) {
        record = await appBase.update<ClientFields>(TABLES.clients, byEmail.id, {
          "User ID": user.id,
          Name: byEmail.fields.Name || user.name,
        })
      } else {
        record = byEmail
      }
    }
  }

  if (!record) {
    const children = await findClientsByParentEmail(user.email ?? "")
    if (children.length > 0) {
      // Pick the active child — fall back to first if no selection stored
      let chosen = children[0]
      if (children.length > 1) {
        const [sel] = await db.select().from(parentActiveChild).where(eq(parentActiveChild.parentUserId, user.id)).limit(1)
        if (sel) {
          const match = children.find((c) => c.fields["User ID"] === sel.childUserId)
          if (match) chosen = match
        }
      }
      return {
        recordId: chosen.id,
        name: chosen.fields.Name ?? "",
        email: chosen.fields.Email ?? "",
        phone: chosen.fields.Phone ?? "",
        goals: chosen.fields.Goals ?? "",
        creditsRemaining: chosen.fields["Credits Remaining"] ?? 0,
        singleCredits: {
          "30": chosen.fields["Single Credits 30"] ?? 0,
          "45": chosen.fields["Single Credits 45"] ?? 0,
          "60": chosen.fields["Single Credits 60"] ?? 0,
          "90": chosen.fields["Single Credits 90"] ?? 0,
        },
        parentEmail: chosen.fields["Parent Email"] ?? user.email,
        effectiveUserId: chosen.fields["User ID"] ?? "",
        isParentView: true,
        isNewProfile: false,
      }
    }
  }

  // Parent detection — runs regardless of noCreate so that the booking route
  // (which passes noCreate=true) can still find a parent's child record.
  // Only the actual record CREATION below is gated on noCreate.
  if (!record) {
    const [userRow] = await db
      .select({ isParentAccount: userTable.isParentAccount })
      .from(userTable)
      .where(eq(userTable.id, user.id))
      .limit(1)
    if (userRow?.isParentAccount) {
      const lateChildren = await findClientsByParentEmail(user.email ?? "")
      if (lateChildren.length > 0) {
        let chosen = lateChildren[0]
        if (lateChildren.length > 1) {
          const [sel] = await db.select().from(parentActiveChild).where(eq(parentActiveChild.parentUserId, user.id)).limit(1)
          if (sel) {
            const match = lateChildren.find((c) => c.fields["User ID"] === sel.childUserId)
            if (match) chosen = match
          }
        }
        return {
          recordId: chosen.id,
          name: chosen.fields.Name ?? "",
          email: chosen.fields.Email ?? "",
          phone: chosen.fields.Phone ?? "",
          goals: chosen.fields.Goals ?? "",
          creditsRemaining: chosen.fields["Credits Remaining"] ?? 0,
          singleCredits: {
            "30": chosen.fields["Single Credits 30"] ?? 0,
            "45": chosen.fields["Single Credits 45"] ?? 0,
            "60": chosen.fields["Single Credits 60"] ?? 0,
            "90": chosen.fields["Single Credits 90"] ?? 0,
          },
          parentEmail: chosen.fields["Parent Email"] ?? user.email,
          effectiveUserId: chosen.fields["User ID"] ?? "",
          isParentView: true,
          isNewProfile: false,
        }
      }
      // isParentAccount=true but no child linked yet — return empty so the
      // dashboard shows the "no dancer linked" state and booking fails
      // gracefully, instead of ever creating a dancer Airtable record.
      return {
        recordId: "",
        name: user.name,
        email: user.email,
        phone: "",
        goals: "",
        creditsRemaining: 0,
        singleCredits: { "30": 0, "45": 0, "60": 0, "90": 0 },
        parentEmail: user.email,
        effectiveUserId: "",
        isParentView: true,
        isNewProfile: false,
      }
    }
  }

  // Late parent check — catches parents who aren't flagged isParentAccount
  // but whose child set {Parent Email} after the parent first signed up.
  if (!record) {
    const lateChildren = await findClientsByParentEmail(user.email ?? "")
    if (lateChildren.length > 0) {
      let chosen = lateChildren[0]
      if (lateChildren.length > 1) {
        const [sel] = await db.select().from(parentActiveChild).where(eq(parentActiveChild.parentUserId, user.id)).limit(1)
        if (sel) {
          const match = lateChildren.find((c) => c.fields["User ID"] === sel.childUserId)
          if (match) chosen = match
        }
      }
      return {
        recordId: chosen.id,
        name: chosen.fields.Name ?? "",
        email: chosen.fields.Email ?? "",
        phone: chosen.fields.Phone ?? "",
        goals: chosen.fields.Goals ?? "",
        creditsRemaining: chosen.fields["Credits Remaining"] ?? 0,
        singleCredits: {
          "30": chosen.fields["Single Credits 30"] ?? 0,
          "45": chosen.fields["Single Credits 45"] ?? 0,
          "60": chosen.fields["Single Credits 60"] ?? 0,
          "90": chosen.fields["Single Credits 90"] ?? 0,
        },
        parentEmail: chosen.fields["Parent Email"] ?? user.email,
        effectiveUserId: chosen.fields["User ID"] ?? "",
        isParentView: true,
        isNewProfile: false,
      }
    }
  }

  let isNewProfile = false
  if (!record && !noCreate) {
    record = await appBase.create<ClientFields>(TABLES.clients, {
      Name: user.name,
      Email: user.email,
      "User ID": user.id,
      "Credits Remaining": 0,
    })
    isNewProfile = true
  }

  return {
    recordId: record?.id ?? "",
    name: record?.fields.Name ?? user.name,
    email: record?.fields.Email ?? user.email,
    phone: record?.fields.Phone ?? "",
    goals: record?.fields.Goals ?? "",
    creditsRemaining: record?.fields["Credits Remaining"] ?? 0,
    singleCredits: {
      "30": record?.fields["Single Credits 30"] ?? 0,
      "45": record?.fields["Single Credits 45"] ?? 0,
      "60": record?.fields["Single Credits 60"] ?? 0,
      "90": record?.fields["Single Credits 90"] ?? 0,
    },
    parentEmail: record?.fields["Parent Email"] ?? "",
    effectiveUserId: record?.fields["User ID"] ?? user.id,
    isParentView: false,
    isNewProfile,
  }
}

export { getPlansForUser }
