import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { eq } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { user as userTable } from "@/lib/db/schema"

export default async function ParentSignUpCompletePage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect("/parent-signup")

  await db
    .update(userTable)
    .set({ isParentAccount: true, status: "active" })
    .where(eq(userTable.id, session.user.id))

  redirect("/dashboard")
}
