import type { GroupPart, ScheduleEntry } from "./types";
import { clock, weekday, type ZonedNow } from "./time";

/**
 * Whether a driver is in a schedule item's run groups. A group can be limited
 * to its instructed or solo half ("Blue Solo and White"), so a driver's solo
 * status decides it as well as their group.
 */
export function inItem(item: Pick<ScheduleEntry, "groupIds" | "groupParts">, groupId: string | null, solo: boolean): boolean {
  if (!groupId || !item.groupIds.includes(groupId)) return false;
  const part = item.groupParts[groupId];
  return !part || (part === "solo") === solo;
}

export const PART_LABEL: Record<GroupPart, string> = { instructed: "Instructed", solo: "Solo" };

/** "Blue Solo", "Blue Instructed", or just "Blue". */
export const partName = (name: string, part?: GroupPart | null) => (part ? `${name} ${PART_LABEL[part]}` : name);

/** How a driver's place in their run group reads on its own: "Blue (Solo)", "Blue (Instructed)", "White". */
export const drivingGroupName = (group: { name: string; split: boolean }, solo: boolean) => (group.split ? `${group.name} (${solo ? "Solo" : "Instructed"})` : group.name);

/** Why a schedule item matters to the person looking at it. */
export type Relevance = "mine" | "student" | null;

export type ScheduleLens = {
  /** The viewer's own run group at this event. */
  groupId: string | null;
  /** Signed off to drive solo: decides which half of a split group's sessions are theirs. */
  solo: boolean;
  /** Instructing at this event: instructor meetings apply. */
  instructing: boolean;
  /** The viewer's assigned students. */
  students: { groupId: string; solo: boolean; firstName: string }[];
  /** Which event days the viewer attends (all, when not registered). */
  days?: string[];
};

/**
 * A cancelled item matters to nobody, unless `includeCancelled` is set: screens
 * that list a person's day use it to show the session as off instead of hiding it.
 */
export function relevance(item: ScheduleEntry, lens: ScheduleLens, opts: { includeCancelled?: boolean } = {}): Relevance {
  if (item.cancelled && !opts.includeCancelled) return null;
  if (lens.days && !lens.days.includes(item.day)) return null;
  if (item.audience === "all") return "mine";
  if (item.audience === "instructors") return lens.instructing ? "mine" : null;
  if (item.audience === "groups") {
    if (inItem(item, lens.groupId, lens.solo)) return "mine";
    if (item.kind === "track" && lens.students.some((st) => inItem(item, st.groupId, st.solo))) return "student";
  }
  return null;
}

/** First names of the viewer's students who are in an item, for "With Owen and Tessa". */
export function studentsIn(item: ScheduleEntry, lens: ScheduleLens): string {
  const names = lens.students.filter((st) => inItem(item, st.groupId, st.solo)).map((st) => st.firstName);
  if (!names.length) return "your student";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const kindOrder: Record<string, number> = { track: 0, classroom: 1, meeting: 2, break: 3, other: 4 };

export function sortItems(items: ScheduleEntry[]): ScheduleEntry[] {
  return [...items].sort((a, b) => a.day.localeCompare(b.day) || a.startMin - b.startMin || (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9));
}

export const dayItems = (items: ScheduleEntry[], day: string) => items.filter((i) => i.day === day);

export type ItemPhase = "past" | "now" | "next";
export function phaseOf(item: ScheduleEntry, now: ZonedNow): ItemPhase {
  if (item.day < now.day) return "past";
  if (item.day > now.day) return "next";
  if (now.minutes >= item.endMin) return "past";
  if (now.minutes >= item.startMin) return "now";
  return "next";
}

export const secondsUntil = (minutes: number, now: ZonedNow) => minutes * 60 - (now.minutes * 60 + now.seconds);

export type LiveBoard = {
  /** "before": first session hasn't started · "live" · "done": last item finished · "off": not an event day */
  state: "off" | "before" | "live" | "done";
  /** The event day in focus: today when it is an event day, otherwise the next (or last) one. */
  day: string;
  isToday: boolean;
  onTrack: ScheduleEntry | null;
  nextTrack: ScheduleEntry | null;
  /** Everything else running right now: classroom, meetings, lunch. */
  alsoNow: ScheduleEntry[];
  /** 0–1 through the on-track session. */
  progress: number;
};

export function liveBoard(items: ScheduleEntry[], eventDays: string[], now: ZonedNow): LiveBoard {
  const isToday = eventDays.includes(now.day);
  const day = isToday ? now.day : (eventDays.find((d) => d > now.day) ?? eventDays[eventDays.length - 1] ?? now.day);
  const today = dayItems(items, day).filter((i) => !i.cancelled);
  const track = today.filter((i) => i.kind === "track");
  if (!isToday) {
    return { state: "off", day, isToday, onTrack: null, nextTrack: track[0] ?? null, alsoNow: [], progress: 0 };
  }
  const onTrack = [...track].reverse().find((i) => i.startMin <= now.minutes && now.minutes < i.endMin) ?? null;
  const nextTrack = track.find((i) => i.startMin > now.minutes) ?? null;
  const alsoNow = today.filter((i) => i.kind !== "track" && i.startMin <= now.minutes && now.minutes < i.endMin);
  const first = today[0];
  const last = today.reduce((m, i) => Math.max(m, i.endMin), 0);
  const state = !first || now.minutes >= last ? "done" : now.minutes < first.startMin ? "before" : "live";
  const progress = onTrack ? Math.min(1, Math.max(0, (now.minutes * 60 + now.seconds - onTrack.startMin * 60) / ((onTrack.endMin - onTrack.startMin) * 60))) : 0;
  return { state, day, isToday, onTrack, nextTrack, alsoNow, progress };
}

/** "moved from 10:10 AM" (with the day when that changed too), or null when the item is where it started. */
export function movedFrom(item: Pick<ScheduleEntry, "day" | "startMin" | "movedFromDay" | "movedFromMin">): string | null {
  if (item.movedFromMin === null || item.movedFromMin === undefined) return null;
  const otherDay = item.movedFromDay && item.movedFromDay !== item.day ? item.movedFromDay : null;
  if (!otherDay && item.movedFromMin === item.startMin) return null;
  return `moved from ${otherDay ? `${weekday(otherDay)} ` : ""}${clock(item.movedFromMin)}`;
}

/**
 * The viewer's own items on a day. `all` keeps cancelled items so they can be
 * shown as off; `current`, `upcoming` and `nextTrack` skip them; `cancelledAhead`
 * lists the ones that have not passed yet, so "your next" can say what it skipped.
 */
export function myDay(items: ScheduleEntry[], day: string, lens: ScheduleLens, now: ZonedNow) {
  const mine = dayItems(items, day)
    .map((item) => ({ item, why: relevance(item, lens, { includeCancelled: true }) }))
    .filter((x): x is { item: ScheduleEntry; why: "mine" | "student" } => x.why !== null);
  const running = mine.filter((x) => !x.item.cancelled);
  const isToday = day === now.day;
  const current = isToday ? running.filter((x) => x.item.startMin <= now.minutes && now.minutes < x.item.endMin) : [];
  const upcoming = running.filter((x) => (isToday ? x.item.startMin > now.minutes : day > now.day));
  const nextTrack = upcoming.find((x) => x.item.kind === "track" && x.why === "mine") ?? null;
  const cancelledAhead = mine.filter((x) => x.item.cancelled && (isToday ? x.item.endMin > now.minutes : day > now.day));
  return { all: mine, current, upcoming, nextTrack, cancelledAhead };
}
