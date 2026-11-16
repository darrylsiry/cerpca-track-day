import { Clock, Flag, GraduationCap, Users, Utensils, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { partName } from "@/lib/schedule";
import type { GroupLite, ScheduleEntry } from "@/lib/types";
import { GroupChip } from "./ui";

export const KIND: Record<string, { label: string; icon: LucideIcon }> = {
  track: { label: "Track session", icon: Flag },
  classroom: { label: "Classroom", icon: GraduationCap },
  meeting: { label: "Meeting", icon: Users },
  break: { label: "Break", icon: Utensils },
  other: { label: "Info", icon: Clock },
};

export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = (KIND[kind] ?? KIND.other).icon;
  return <Icon className={cn("size-4 shrink-0", className)} strokeWidth={2.2} aria-hidden />;
}

export function ItemGroups({ item, groups, size = "sm" }: { item: ScheduleEntry; groups: GroupLite[]; size?: "sm" | "md" }) {
  const list = item.groupIds.map((id) => groups.find((g) => g.id === id)).filter((g): g is GroupLite => Boolean(g));
  if (!list.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {list.map((g) => (
        // A slot for one half of a split group says which: "Blue Solo".
        <GroupChip key={g.id} group={{ ...g, name: partName(g.name, item.groupParts[g.id]) }} size={size} />
      ))}
    </span>
  );
}

/** Solid colour bar for a schedule row: the session's run-group colour(s). */
export function GroupBar({ item, groups, className }: { item: ScheduleEntry; groups: GroupLite[]; className?: string }) {
  const list = item.groupIds.map((id) => groups.find((g) => g.id === id)).filter((g): g is GroupLite => Boolean(g));
  return (
    <span className={cn("flex w-1.5 shrink-0 flex-col overflow-hidden rounded-full", !list.length && "bg-line-strong", className)} aria-hidden>
      {list.map((g) => (
        <span key={g.id} className="flex-1 border border-ink/25" style={{ background: g.color }} />
      ))}
    </span>
  );
}
