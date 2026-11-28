/** Slow-drifting pink and cyan glows behind signed-out pages (matches the mobile app). */
export function AmbientGlow() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="cdp-glow cdp-glow-a" />
      <div className="cdp-glow cdp-glow-b" />
    </div>
  )
}
