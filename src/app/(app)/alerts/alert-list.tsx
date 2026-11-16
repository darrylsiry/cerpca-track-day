"use client";

import { Bell, CalendarClock, ChevronRight, ClipboardCheck, FileSignature, GraduationCap, Megaphone, TrendingUp, UsersRound, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { toast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { markRead } from "./actions";

export type AlertRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  urgent: boolean;
  read: boolean;
  when: string;
};

const KINDS: Record<string, { label: string; icon: LucideIcon }> = {
  announcement: { label: "Announcement", icon: Megaphone },
  reminder: { label: "Reminder", icon: Bell },
  schedule: { label: "Schedule change", icon: CalendarClock },
  tech: { label: "Tech inspection", icon: ClipboardCheck },
  promotion: { label: "Promotion", icon: TrendingUp },
  assignment: { label: "Instructor pairing", icon: UsersRound },
  session: { label: "Session notes", icon: GraduationCap },
  waiver: { label: "Waivers", icon: FileSignature },
};

/** The inbox. Opening an alert marks it read and, when it points somewhere, goes there. */
export function AlertList({ rows }: { rows: AlertRow[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [readNow, markOptimistic] = useOptimistic<string[], string>([], (ids, id) => [...ids, id]);

  const open = (row: AlertRow) => {
    const goesSomewhere = row.href && row.href !== "/alerts";
    if (row.read && !goesSomewhere) return;
    start(async () => {
      if (!row.read) {
        markOptimistic(row.id);
        const result = await markRead(row.id);
        if (!result.ok) toast(result.error, "bad");
      }
      if (goesSomewhere) router.push(row.href!);
    });
  };

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
      {rows.map((row) => {
        const meta = KINDS[row.kind] ?? { label: "Alert", icon: Bell };
        const Icon = meta.icon;
        const unread = !row.read && !readNow.includes(row.id);
        const goesSomewhere = Boolean(row.href && row.href !== "/alerts");
        const interactive = unread || goesSomewhere;
        const content = (
          <>
            {row.urgent ? <span className="absolute inset-y-0 left-0 w-1.5 bg-flag-yellow" aria-hidden /> : null}
            <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-full", row.urgent ? "bg-flag-yellow text-ink" : "bg-sunk text-ink-2")}>
              <Icon className="size-[18px]" strokeWidth={2.2} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="flex items-start justify-between gap-3">
                <span className={cn("text-[17px] leading-snug", unread ? "font-bold" : "font-semibold")}>{row.title}</span>
                {unread ? <span className="mt-2 size-2.5 shrink-0 rounded-full bg-flag-red" aria-label="Unread" /> : null}
              </span>
              {row.body ? <span className={cn("mt-1 block text-[15px] leading-snug whitespace-pre-line", unread ? "text-ink" : "text-ink-2")}>{row.body}</span> : null}
              <span className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-3">
                {row.urgent ? <span className="font-bold text-warn">Urgent ·</span> : null}
                <span>{meta.label}</span>
                <span>· {row.when}</span>
              </span>
            </span>
            {goesSomewhere ? <ChevronRight className="mt-2 size-4.5 shrink-0 text-ink-3" aria-hidden /> : null}
          </>
        );
        return (
          <li key={row.id}>
            {interactive ? (
              <button type="button" onClick={() => open(row)} className="relative flex w-full items-start gap-3.5 px-4 py-4 hover:bg-paper active:bg-sunk sm:px-5">
                {content}
              </button>
            ) : (
              <div className="relative flex items-start gap-3.5 px-4 py-4 sm:px-5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
