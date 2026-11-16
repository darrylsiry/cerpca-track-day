import { fullName } from "@/lib/cn";
import { dateRange } from "@/lib/time";
import type { Viewer } from "@/server/auth";
import { groupLite } from "@/server/queries";
import type { ShellProps } from "./nav";

export function shellProps(v: Viewer, unread: number, badges: ShellProps["badges"]): ShellProps {
  const roles = [v.membership.adminTitle, v.isInstructor ? "Instructor" : null].filter(Boolean);
  return {
    orgShort: v.org.shortName,
    eventName: v.event?.name ?? null,
    eventDates: v.event ? dateRange(v.event.startDate, v.event.endDate) : null,
    trackName: v.track?.shortName ?? null,
    userName: fullName(v.user),
    roleLine: roles.length ? roles.join(" · ") : v.group ? `${v.group.name} run group` : "Member",
    group: v.group ? groupLite(v.group) : null,
    carNumber: v.registration?.carNumber ?? null,
    isAdmin: v.isAdmin,
    isInstructor: v.isInstructor,
    unread,
    badges,
  };
}
