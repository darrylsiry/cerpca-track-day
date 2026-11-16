"use client";

import {
  Bell,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  FileSignature,
  Flag,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  Megaphone,
  Menu,
  Route,
  Settings,
  ShieldAlert,
  TrendingUp,
  UserRound,
  Users,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import type { GroupLite } from "@/lib/types";
import { Avatar, CarNumber, GroupChip } from "../ui";

export type ShellProps = {
  orgShort: string;
  eventName: string | null;
  eventDates: string | null;
  trackName: string | null;
  userName: string;
  roleLine: string;
  group: GroupLite | null;
  carNumber: string | null;
  isAdmin: boolean;
  isInstructor: boolean;
  unread: number;
  badges: { tech: number; promotions: number; incidents: number };
};

type Item = { href: string; label: string; icon: LucideIcon; badge?: number; exact?: boolean };

function sections(p: ShellProps): { title: string; items: Item[] }[] {
  const out: { title: string; items: Item[] }[] = [
    {
      title: "Event",
      items: [
        { href: "/home", label: "Now", icon: Gauge },
        { href: "/schedule", label: "Schedule", icon: CalendarClock },
        { href: "/track", label: "Track guide", icon: Route },
        { href: "/alerts", label: "Alerts", icon: Bell, badge: p.unread },
      ],
    },
    {
      title: "You",
      items: [
        { href: "/me", label: "Profile and car", icon: UserRound, exact: true },
        { href: "/me/tech", label: "Tech inspection", icon: Wrench },
        { href: "/me/waivers", label: "Waivers", icon: FileSignature },
      ],
    },
  ];
  if (p.isInstructor) {
    out.push({ title: "Instructing", items: [{ href: "/instructor", label: "My students", icon: GraduationCap }] });
  }
  if (p.isAdmin) {
    out.push({
      title: "Run the event",
      items: [
        { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
        { href: "/admin/roster", label: "Roster", icon: Users },
        { href: "/admin/schedule", label: "Schedule", icon: CalendarClock },
        { href: "/admin/instructors", label: "Instructor pairing", icon: UsersRound },
        { href: "/admin/tech", label: "Tech inspection", icon: ClipboardCheck, badge: p.badges.tech },
        { href: "/admin/waivers", label: "Waivers", icon: FileSignature },
        { href: "/admin/promotions", label: "Promotions", icon: TrendingUp, badge: p.badges.promotions },
        { href: "/admin/announcements", label: "Announcements", icon: Megaphone },
        { href: "/admin/incidents", label: "Incidents", icon: ShieldAlert, badge: p.badges.incidents },
        { href: "/admin/events", label: "Events and history", icon: CalendarDays },
        { href: "/admin/settings", label: "Settings", icon: Settings },
      ],
    });
  }
  return out;
}

const isActive = (pathname: string, item: Item) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));

function Badge({ n, className }: { n?: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={cn("timing grid h-5 min-w-5 place-items-center rounded-full bg-flag-red px-1.5 text-[11px] font-bold text-white", className)}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function Sidebar(p: ShellProps) {
  const pathname = usePathname();
  return (
    <aside className="no-print fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
      <div className="wristband h-1.5 shrink-0" aria-hidden />
      <div className="border-b border-line px-5 pt-4 pb-4">
        <p className="eyebrow text-ink-2">{p.orgShort} · Track Day</p>
        <p className="board mt-1.5 text-[1.45rem]">{p.eventName ?? "No event scheduled"}</p>
        {p.eventDates ? (
          <p className="mt-1.5 text-[13px] text-ink-2">
            {p.eventDates}
            {p.trackName ? ` · ${p.trackName}` : ""}
          </p>
        ) : null}
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-3">
        {sections(p).map((sec) => (
          <div key={sec.title} className="mb-4">
            <p className="eyebrow px-2 pb-1.5 text-[11px] text-ink-3">{sec.title}</p>
            <ul>
              {sec.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-10 items-center gap-3 rounded-[10px] px-2.5 text-[15px] font-semibold transition-colors",
                        active ? "bg-ink text-white" : "text-ink-2 hover:bg-sunk hover:text-ink",
                      )}
                    >
                      <Icon className="size-[18px] shrink-0" strokeWidth={2.2} />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <Badge n={item.badge} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <Link href="/me" className="flex items-center gap-3 border-t border-line px-4 py-3 hover:bg-sunk">
        <Avatar name={p.userName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold">{p.userName}</span>
          <span className="block truncate text-[13px] text-ink-2">{p.roleLine}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <GroupChip group={p.group} size="sm" />
          <CarNumber n={p.carNumber} size="sm" />
        </span>
      </Link>
    </aside>
  );
}

export function TopBar(p: ShellProps) {
  return (
    <header className="no-print sticky top-0 z-40 lg:hidden">
      <div className="wristband h-1.5" aria-hidden />
      <div className="flex h-13 items-center justify-between gap-3 border-b border-line bg-paper/92 px-4 backdrop-blur-md">
        <Link href="/home" className="min-w-0">
          <span className="eyebrow block text-[11px] text-ink-2">{p.orgShort}</span>
          <span className="block truncate text-[15px] leading-tight font-bold">{p.eventName ?? "Track Day"}</span>
        </Link>
        <Link href="/me" aria-label="Your profile" className="flex shrink-0 items-center gap-1.5">
          <GroupChip group={p.group} />
          <CarNumber n={p.carNumber} size="sm" className="h-6" />
          {!p.group && !p.carNumber ? <Avatar name={p.userName} className="size-8" /> : null}
        </Link>
      </div>
    </header>
  );
}

const TABS: Item[] = [
  { href: "/home", label: "Now", icon: Gauge },
  { href: "/schedule", label: "Schedule", icon: CalendarClock },
  { href: "/track", label: "Track", icon: Flag },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/more", label: "More", icon: Menu },
];

export function BottomNav(p: ShellProps) {
  const pathname = usePathname();
  const inMore = !TABS.slice(0, 4).some((t) => isActive(pathname, t));
  const moreBadge = p.isAdmin ? p.badges.tech + p.badges.promotions : 0;
  return (
    <nav aria-label="Main" className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto grid h-[var(--nav-h)] max-w-xl grid-cols-5">
        {TABS.map((item) => {
          const active = item.href === "/more" ? inMore : isActive(pathname, item);
          const Icon = item.icon;
          const badge = item.href === "/alerts" ? p.unread : item.href === "/more" ? moreBadge : 0;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn("relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-bold", active ? "text-ink" : "text-ink-3")}
              >
                {active ? <span className="wristband absolute inset-x-5 top-0 h-[3px] rounded-b-full border-x border-b border-ink/20" aria-hidden /> : null}
                <span className="relative">
                  <Icon className="size-6" strokeWidth={active ? 2.5 : 2} />
                  <Badge n={badge} className="absolute -top-1.5 -right-2.5 ring-2 ring-surface" />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The "More" screen on phones: everything that isn't one of the four tabs. */
export function MoreMenu(p: ShellProps) {
  return (
    <div className="space-y-6">
      {sections(p)
        .slice(1)
        .map((sec) => (
          <section key={sec.title}>
            <h2 className="eyebrow mb-2 text-ink-2">{sec.title}</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
              {sec.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link href={item.href} className="flex h-14 items-center gap-3.5 px-4 text-base font-semibold active:bg-sunk">
                      <Icon className="size-5 shrink-0 text-ink-2" strokeWidth={2.2} />
                      <span className="flex-1">{item.label}</span>
                      <Badge n={item.badge} />
                      <span aria-hidden className="text-ink-3">
                        ›
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
    </div>
  );
}
