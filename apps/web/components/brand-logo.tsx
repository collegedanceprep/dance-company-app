import { cn } from "@/lib/utils"

export function BrandLogo({
  className,
  showText = true,
}: {
  className?: string
  showText?: boolean
}) {
  return (
    <span className={cn("inline-flex flex-col leading-none", className)}>
      <span className="font-heading text-2xl font-light tracking-[0.08em] text-primary">
        CDP
      </span>
      {showText && (
        <span className="mt-1 font-heading text-[0.6rem] font-light uppercase tracking-[0.32em] text-foreground">
          College Dance Prep
        </span>
      )}
    </span>
  )
}
