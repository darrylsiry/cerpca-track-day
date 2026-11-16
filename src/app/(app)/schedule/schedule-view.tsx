"use client";

import { ArrowDown } from "lucide-react";
import { useCallback, useState, type CSSProperties } from "react";
import { useTrackNow } from "@/components/clock";
import { GroupBar, ItemGroups, KIND, KindIcon } from "@/components/schedule-bits";
import { Pill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dayItems, liveBoard, myDay, phaseOf, relevance, secondsUntil, studentsIn, type ScheduleLens } from "@/lib/schedule";
import { clock, clockParts, countdown, dayLong, duration, monthDay, weekday, weekdayShort, type ZonedNow } from "@/lib/time";
import type { GroupLite, ScheduleEntry } from "@/lib/types";

type Props = {
  items: ScheduleEntry[];
  groups: GroupLite[];
  days: string[];
  lens: ScheduleLens;
  registered: boolean;
  initialDay: string | null;
  initialShow: string | null;
};

/** "all" | "mine" | "classroom" | a run group id */
type Show = string;

export function ScheduleView({ items, groups, days, lens, registered, initialDay, initialShow }: Props) {
  const now = useTrackNow();
  const [day, setDay] = useState(() => initialDay ?? (days.includes(now.day) ? now.day : (days.find((d) => d > now.day) ?? days[0])));
  const [show, setShow] = useState<Show>(() => {
    const valid = initialShow === "all" || initialShow === "classroom" || (initialShow === "mine" && registered) || groups.some((g) => g.id === initialShow);
    return valid && initialShow ? initialShow : "all";
  });

  const board = liveBoard(items, days, now);
  const mine = registered ? myDay(items, board.day, lens, now) : null;
  const myNext = mine?.upcoming[0] ?? null;
  const groupOf = (item: ScheduleEntry | null) => (item ? (groups.find((g) => g.id === item.groupIds[0]) ?? null) : null);
  const onTrackGroup = groupOf(board.onTrack);

  const remember = useCallback((nextDay: string, nextShow: Show) => {
    const q = new URLSearchParams({ day: nextDay });
    if (nextShow !== "all") q.set("show", nextShow);
    window.history.replaceState(null, "", `?${q}`);
  }, []);
  const chooseDay = (d: string) => {
    setDay(d);
    remember(d, show);
  };
  const chooseShow = (s: Show) => {
    setShow(s);
    remember(day, s);
  };

  const matches = (item: ScheduleEntry) => {
    if (show === "all") return true;
    if (show === "mine") return relevance(item, lens) !== null;
    if (show === "classroom") return item.kind === "classroom";
    return item.groupIds.includes(show) || item.audience === "all";
  };

  const jumpToNow = () => {
    if (day !== now.day) chooseDay(now.day);
    // Wait a frame so today's list is on screen before scrolling to it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const rows = [...document.querySelectorAll<HTMLElement>("[data-phase='now'], [data-phase='next']")].filter((el) => el.offsetParent !== null);
        (rows.find((el) => el.dataset.phase === "now") ?? rows[0])?.scrollIntoView({ behavior: "smooth", block: "center" });
      }),
    );
  };

  const filters: { key: Show; label: string; group?: GroupLite }[] = [
    { key: "all", label: "Everyone" },
    ...(registered ? [{ key: "mine", label: "Mine only" }] : []),
    ...groups.map((g) => ({ key: g.id, label: g.name, group: g })),
    { key: "classroom", label: "Classroom" },
  ];

  return (
    <div>
      {/* ── Right now ── */}
      {board.isToday ? (
        <section aria-label="Right now" className="mb-4 grid gap-2 sm:grid-cols-3 sm:gap-3">
          <div
            className="flex items-center justify-between gap-3 rounded-[14px] border border-ink/20 px-4 py-3 sm:block"
            style={board.onTrack ? { background: onTrackGroup?.color ?? "var(--color-ink)", color: onTrackGroup?.textColor ?? "#fff" } : { background: "var(--color-ink)", color: "#fff" }}
          >
            <div className="min-w-0">
              <p className="eyebrow flex items-center gap-1.5 text-[11px] opacity-85">
                {board.onTrack ? <span className="animate-pulse-dot size-2 rounded-full bg-current" aria-hidden /> : null}
                {board.onTrack ? "On track now" : board.state === "done" ? "Day complete" : board.state === "before" ? "Before the first session" : "Track is clear"}
              </p>
              <p className="board mt-1 truncate text-[1.75rem] sm:text-[2rem]">{board.onTrack?.title ?? (board.state === "done" ? "Track is cold" : (board.alsoNow[0]?.title ?? "Between sessions"))}</p>
            </div>
            {board.onTrack ? (
              <p className="timing shrink-0 text-right text-[15px] font-bold sm:mt-1 sm:text-left" suppressHydrationWarning>
                {countdown(secondsUntil(board.onTrack.endMin, now))} left
              </p>
            ) : board.alsoNow[0] ? (
              <p className="timing shrink-0 text-[15px] font-semibold opacity-85 sm:mt-1">until {clock(board.alsoNow[0].endMin)}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-[14px] border border-line bg-surface px-4 py-3 sm:block">
            <div className="min-w-0">
              <p className="eyebrow text-[11px] text-ink-2">Next on track</p>
              {board.nextTrack ? (
                <p className="mt-1 flex min-w-0 items-center gap-2">
                  <span className="board truncate text-[1.75rem] sm:text-[2rem]">{board.nextTrack.title}</span>
                </p>
              ) : (
                <p className="mt-1 text-[15px] font-semibold text-ink-2">No more sessions today</p>
              )}
            </div>
            {board.nextTrack ? (
              <p className="timing shrink-0 text-right text-[15px] font-bold sm:mt-1 sm:text-left" suppressHydrationWarning>
                {clock(board.nextTrack.startMin)} · in {countdown(secondsUntil(board.nextTrack.startMin, now))}
              </p>
            ) : null}
          </div>

          {registered ? (
            <div className="flex items-stretch overflow-hidden rounded-[14px] border border-line bg-surface">
              <span className="wristband w-2 shrink-0 border-r border-ink/15" aria-hidden />
              <div className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 sm:block">
                <div className="min-w-0">
                  <p className="eyebrow text-[11px] text-ink-2">{mine?.current.length ? "You, right now" : "Your next"}</p>
                  {mine?.current.length ? (
                    <p className="board mt-1 truncate text-[1.75rem] sm:text-[2rem]">{mine.current[0].item.title}</p>
                  ) : myNext ? (
                    <p className="board mt-1 truncate text-[1.75rem] sm:text-[2rem]">{myNext.item.title}</p>
                  ) : (
                    <p className="mt-1 text-[15px] font-semibold text-ink-2">Nothing more today</p>
                  )}
                </div>
                {mine?.current.length ? (
                  <p className="timing shrink-0 text-right text-[15px] font-bold sm:mt-1 sm:text-left">until {clock(mine.current[0].item.endMin)}</p>
                ) : myNext ? (
                  <p className="timing shrink-0 text-right text-[15px] font-bold sm:mt-1 sm:text-left" suppressHydrationWarning>
                    {clock(myNext.item.startMin)} · in {countdown(secondsUntil(myNext.item.startMin, now))}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="mb-4 rounded-[12px] bg-sunk px-4 py-3 text-[15px] text-ink-2">
          {now.day < days[0] ? (
            <>
              The event starts <strong className="text-ink">{dayLong(days[0])}</strong>.{mine?.upcoming[0] ? ` Your first item: ${mine.upcoming[0].item.title} at ${clock(mine.upcoming[0].item.startMin)}.` : ""}
            </>
          ) : (
            "This event has finished. The schedule below is how the weekend ran."
          )}
        </p>
      )}

      {/* ── Filters ── */}
      <div className="no-scrollbar -mx-4 mb-3 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div role="group" aria-label="Show" className="flex w-max gap-1.5">
          {filters.map((f) => {
            const active = show === f.key;
            return (
              <button
                key={f.key}
                type="button"
                aria-pressed={active}
                onClick={() => chooseShow(f.key)}
                className={cn(
                  "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold whitespace-nowrap transition-colors",
                  active ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink hover:border-ink",
                )}
              >
                {f.group ? <span className="size-3 rounded-full border border-ink/40" style={{ background: f.group.color }} aria-hidden /> : null}
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Day switcher (phones) ── */}
      <div className="mb-3 flex items-center gap-2 lg:hidden">
        <div role="group" aria-label="Day" className="grid flex-1 gap-1 rounded-[12px] border border-line bg-surface p-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={d === day}
              onClick={() => chooseDay(d)}
              className={cn("flex h-11 items-center justify-center gap-1.5 rounded-[9px] text-[15px] font-bold", d === day ? "bg-ink text-white" : "text-ink-2")}
            >
              {days.length > 3 ? weekdayShort(d) : weekday(d)}
              {d === now.day ? <span className={cn("size-1.5 rounded-full", d === day ? "bg-white" : "bg-flag-red")} aria-label="today" /> : null}
            </button>
          ))}
        </div>
      </div>

      {board.isToday ? (
        <button type="button" onClick={jumpToNow} className="mb-3 inline-flex h-10 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 text-sm font-semibold hover:border-ink">
          <ArrowDown className="size-4" aria-hidden /> Jump to now
        </button>
      ) : null}

      {/* ── The schedule: one day on phones, the whole weekend side by side on desktop ── */}
      <div className={cn("grid gap-5", days.length > 1 && "lg:grid-cols-2")}>
        {days.map((d) => {
          const list = dayItems(items, d).filter(matches);
          return (
            <section key={d} aria-label={dayLong(d)} className={cn("overflow-hidden rounded-[14px] border border-line bg-surface", d !== day && "hidden lg:block")}>
              <header className="flex items-end justify-between gap-3 border-b border-line px-4 pt-4 pb-3 sm:px-5">
                <h2 className="board text-[1.9rem]">{weekday(d)}</h2>
                <p className="flex items-center gap-2 pb-0.5 text-sm font-semibold text-ink-2">
                  {d === now.day ? <Pill tone="good">Today</Pill> : null}
                  {monthDay(d)}
                </p>
              </header>
              {list.length ? (
                <ol>
                  {list.map((item) => (
                    <Row key={item.id} item={item} now={now} groups={groups} why={relevance(item, lens)} studentLabel={studentsIn(item, lens)} />
                  ))}
                </ol>
              ) : (
                <p className="px-5 py-8 text-center text-[15px] text-ink-2">Nothing matches this filter on {weekday(d)}.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Row({ item, now, groups, why, studentLabel }: { item: ScheduleEntry; now: ZonedNow; groups: GroupLite[]; why: "mine" | "student" | null; studentLabel: string }) {
  const phase = item.cancelled ? (item.day < now.day || (item.day === now.day && now.minutes >= item.endMin) ? "past" : "next") : phaseOf(item, now);
  const live = phase === "now" && !item.cancelled;
  const start = clockParts(item.startMin);
  // A light wash of the viewer's own run-group colour marks their rows.
  const tint: CSSProperties | undefined = why && !live ? { background: "color-mix(in srgb, var(--group) 9%, transparent)" } : undefined;

  return (
    <li
      data-phase={item.cancelled ? undefined : phase}
      style={tint}
      className={cn("relative flex items-stretch gap-3 border-b border-line px-3 py-3 last:border-b-0 sm:px-4", live && "bg-paper", (phase === "past" || item.cancelled) && "opacity-55")}
    >
      {live ? <span className="absolute inset-y-0 left-0 w-1 bg-ink" aria-hidden /> : null}
      <div className="w-[4.5rem] shrink-0 text-right">
        <p className={cn("timing text-[16px] leading-tight font-bold", item.cancelled && "line-through")}>
          {start.time}
          <span className="ml-0.5 text-[11px] font-semibold text-ink-2">{start.period}</span>
        </p>
        <p className="timing mt-0.5 text-[12px] text-ink-3">{duration(item.endMin - item.startMin)}</p>
      </div>
      <GroupBar item={item} groups={groups} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-[17px] leading-snug font-bold", item.cancelled && "line-through")}>{item.title}</span>
          {item.cancelled ? <Pill tone="bad">Cancelled</Pill> : null}
          {live ? <Pill tone="good">Now</Pill> : null}
          {why && !item.cancelled ? (
            <span className="wristband inline-flex h-5 items-center rounded-full border border-ink/25 px-2 text-[11px] font-bold tracking-wide uppercase">{why === "student" ? `With ${studentLabel}` : "You"}</span>
          ) : null}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-ink-2">
          <KindIcon kind={item.kind} className="size-3.5" />
          <span>{KIND[item.kind]?.label ?? "Info"}</span>
          {item.location ? <span>· {item.location}</span> : null}
          <span className="timing">· until {clock(item.endMin)}</span>
          {item.groupIds.length > 1 || Object.keys(item.groupParts).length ? <ItemGroups item={item} groups={groups} /> : null}
        </p>
        {item.note ? <p className="mt-1 text-sm text-ink-2">{item.note}</p> : null}
      </div>
      {live ? (
        <p className="timing shrink-0 self-center text-right text-[13px] font-bold" suppressHydrationWarning>
          {countdown(secondsUntil(item.endMin, now))}
          <span className="block text-[11px] font-semibold text-ink-2">left</span>
        </p>
      ) : null}
    </li>
  );
}
