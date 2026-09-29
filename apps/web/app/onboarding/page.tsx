export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { getOrCreateProfile } from "@/app/actions/profile"
import { OnboardingForm } from "@/components/onboarding-form"
import { BrandLogo } from "@/components/brand-logo"
import QRCode from "qrcode"
import Image from "next/image"

const APP_STORE_URL = "https://apps.apple.com/app/cdp-booking/id6784838378"

export default async function OnboardingPage() {
  const profile = await getOrCreateProfile()
  // Parent accounts have no dancer profile to fill in — skip straight to the dashboard
  if (profile.isParentView) {
    redirect("/dashboard")
  }
  // If they've already filled in any profile detail, skip onboarding
  if (!profile.isNewProfile && (profile.phone || profile.goals || profile.parentEmail)) {
    redirect("/dashboard")
  }

  const qrDataUrl = await QRCode.toDataURL(APP_STORE_URL, {
    width: 160,
    margin: 1,
    color: { dark: "#e91e8c", light: "#00000000" },
  })

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-md flex flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandLogo />
          <div>
            <h1 className="font-heading text-2xl font-semibold mt-4">
              Welcome, {profile.name.split(" ")[0]}!
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Let's set up your profile. Everything here is optional — you can update it any time.
            </p>
          </div>
        </div>

        {/* App Store banner */}
        <div className="rounded-xl border bg-card p-4 flex items-center gap-4">
          <Image src={qrDataUrl} alt="QR code to download the CDP app" width={72} height={72} className="shrink-0" />
          <div className="flex flex-col gap-1 min-w-0">
            <p className="text-sm font-semibold leading-tight">Prefer the app?</p>
            <p className="text-xs text-muted-foreground leading-snug">
              Scan the QR code or tap the link below to download the CDP app on your iPhone — book sessions, view your plan, and get notified instantly.
            </p>
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-primary mt-1 hover:underline"
            >
              Download on the App Store →
            </a>
          </div>
        </div>

        <OnboardingForm recordId={profile.recordId} />
      </div>
    </main>
  )
}
