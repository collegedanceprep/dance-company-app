"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { CalendarDays, Clock, CalendarPlus, Inbox, UserCircle, BookOpen, Users, ClipboardList } from "lucide-react"

const BASE_LINKS = [
  { href: "/portal", label: "Schedule", icon: CalendarDays },
  { href: "/portal/book", label: "Book session", icon: CalendarPlus },
  { href: "/portal/availability", label: "Availability", icon: Clock },
  { href: "/portal/inbox", label: "Inbox", icon: Inbox },
  { href: "/portal/profile", label: "Profile", icon: UserCircle },
  { href: "/portal/onboarding", label: "Onboarding", icon: BookOpen },
]

const RD_LINK = { href: "/portal/my-prep-masters", label: "My PrepMasters", icon: Users }
const OPS_LINK = { href: "/portal/ops-management", label: "Ops Management", icon: ClipboardList }

type Props = { isRD?: boolean; isOps?: boolean; opsOnly?: boolean }

export function PortalNav({ isRD, isOps, opsOnly }: Props) {
  const pathname = usePathname()
  // A person who has ops access but isn't an admin or PrepMaster only makes
  // sense of the Ops Management tab — the booking/schedule tabs are for
  // PrepMasters managing their own sessions.
  const links = opsOnly
    ? [OPS_LINK]
    : [
        BASE_LINKS[0],
        ...(isRD ? [RD_LINK] : []),
        ...(isOps ? [OPS_LINK] : []),
        ...BASE_LINKS.slice(1),
      ]

  return (
    <nav className="flex items-center gap-0.5 border-b overflow-x-auto scrollbar-none">
      {links.map((link) => {
        const active = pathname === link.href
        const Icon = link.icon
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-xs font-medium transition-colors whitespace-nowrap sm:px-3 sm:text-sm sm:gap-2",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-4 shrink-0" />
            <span className="hidden xs:inline">{link.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
