import { APP_VERSION } from "@/lib/version"

// Shown on every page, for every role — a plain, always-visible build
// identifier so support can ask "what version are you on?" and know
// immediately whether someone is on a stale deploy.
export function VersionBadge() {
  return (
    <div className="fixed bottom-1 right-1.5 z-50 select-none text-[10px] leading-none text-muted-foreground/40">
      {APP_VERSION}
    </div>
  )
}
