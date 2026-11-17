import Link from "next/link"
import type { PrepMaster } from "@/lib/airtable"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"
import { getUniversityColor } from "@/lib/university-colors"

export function CoachCard({ coach }: { coach: PrepMaster }) {
  const initials = coach.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase()

  const { bg, text } = getUniversityColor(coach.university)

  return (
    <Card className="flex flex-row items-center gap-3 p-3">
      {coach.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coach.photoUrl}
          alt={coach.name}
          loading="lazy"
          className="size-11 shrink-0 rounded-full bg-accent object-cover"
        />
      ) : (
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent font-heading text-sm font-semibold text-primary">
          {initials}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <h3 className="truncate font-heading text-sm font-semibold tracking-tight">
          {coach.name}
        </h3>
        {coach.university ? (
          <span
            className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold leading-none"
            style={{ backgroundColor: bg, color: text }}
          >
            {coach.university}
          </span>
        ) : null}
      </div>

      <Button asChild size="sm" variant="secondary" className="shrink-0">
        <Link href={`/book/${coach.id}`} aria-label={`Book with ${coach.name}`}>
          Book
          <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    </Card>
  )
}
