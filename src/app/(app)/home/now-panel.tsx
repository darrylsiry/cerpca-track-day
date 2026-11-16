"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { useTrackNow } from "@/components/clock";
import { GroupBar, ItemGroups, KIND, KindIcon } from "@/components/schedule-bits";
import { cn } from "@/lib/cn";
import { liveBoard, myDay, phaseOf, secondsUntil, studentsIn, type ScheduleLens } from "@/lib/schedule";
import { clock, clockRange, countdown, dayLong, daysBetween, weekday } from "@/lib/time";
import type { GroupLite, ScheduleEntry } from "@/lib/types";

type Props = {
  items: ScheduleEntry[];
  groups: GroupLite[];
  days: string[];
  lens: ScheduleLens;
  registered: boolean;
  gridPlace: string;
};

/** Scale the pit-board title to its length so "RED" is huge and "GREEN ORIENTATION LAPS" still fits. */
function titleSize(title: string) {
  if (title.length <= 6) return "text-[5rem] sm:text-[7rem]";
  if (title.length <= 10) return "text-[3.6rem] sm:text-[5.2rem]";
  if (title.length <= 16) return "text-[2.7rem] sm:text-[3.8rem]";
  return "text-[2.1rem] sm:text-[3rem]";
}

export function NowPanel({ items, groups, days, lens, registered, gridPlace }: Props) {
  const now = useTrackNow();
  const board = liveBoard(items, days, now);
  const mine = myDay(items, board.day, lens, now);
  const groupOf = (item: ScheduleEntry | null) => (item ? (groups.find((g) => g.id === item.groupIds[0]) ?? null) : null);

  const onTrackGroup = groupOf(board.onTrack);
  const panelStyle: CSSProperties = board.onTrack
    ? { background: onTrackGroup?.color ?? "var(--color-ink)", color: onTrackGroup?.textColor ?? "#fff" }
    : { background: "var(--color-ink)", color: "#fff" };

  const withStudent = (item: ScheduleEntry) => studentsIn(item, lens);

  const nextForMe = mine.upcoming[0] ?? null;
  const nowForMe = mine.current;
  const secsToNext = nextForMe ? secondsUntil(nextForMe.item.startMin, now) : 0;
  const gridCall = Boolean(nextForMe && board.isToday && nextForMe.item.kind === "track" && secsToNext <= 15 * 60);

  return (
    <div className="space-y-4">
      {/* ── The board: who has the track ── */}
      <section style={panelStyle} className="overflow-hidden rounded-[18px] border border-ink/20" aria-live="off">
        <div className="px-5 pt-4 pb-5 sm:px-7 sm:pt-5 sm:pb-6">
          {board.onTrack ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow flex items-center gap-2">
                  <span className="animate-pulse-dot size-2.5 rounded-full bg-current" aria-hidden />
                  On track now
                </p>
                <p className="timing text-sm font-semibold opacity-85">{clockRange(board.onTrack.startMin, board.onTrack.endMin)}</p>
              </div>
              <div className="mt-3 flex flex-col gap-x-4 gap-y-2 sm:flex-row sm:items-end sm:justify-between">
                <h2 className={cn("board min-w-0", titleSize(board.onTrack.title))}>{board.onTrack.title}</h2>
                <div className="flex shrink-0 items-baseline gap-2.5 sm:block sm:pb-1 sm:text-right">
                  <p className="timing text-[2.6rem] leading-none font-bold sm:text-[3.4rem]" suppressHydrationWarning>
                    {countdown(secondsUntil(board.onTrack.endMin, now))}
                  </p>
                  <p className="eyebrow opacity-80 sm:mt-1.5">left in session</p>
                </div>
              </div>
              <div className="kerb mt-4" style={{ "--p": board.progress } as CSSProperties} role="progressbar" aria-label="Session progress" aria-valuenow={Math.round(board.progress * 100)} aria-valuemin={0} aria-valuemax={100} />
              {board.onTrack.note ? <p className="mt-3 text-sm opacity-90">{board.onTrack.note}</p> : null}
            </>
          ) : board.state === "off" ? (
            <>
              <p className="eyebrow opacity-75">{board.day < now.day ? "Event finished" : "Next up at the track"}</p>
              <h2 className="board mt-3 text-[3.4rem] sm:text-[5rem]">{weekday(board.day)}</h2>
              <p className="mt-2 text-base font-semibold opacity-90">
                {dayLong(board.day)}
                {board.day > now.day ? ` · in ${daysBetween(now.day, board.day)} day${daysBetween(now.day, board.day) === 1 ? "" : "s"}` : ""}
              </p>
              {board.nextTrack && board.day > now.day ? (
                <p className="mt-4 text-sm opacity-85">
                  First on track: {board.nextTrack.title} at <span className="timing font-semibold">{clock(board.nextTrack.startMin)}</span>
                </p>
              ) : null}
            </>
          ) : board.state === "done" ? (
            <>
              <p className="eyebrow opacity-75">Day complete</p>
              <h2 className="board mt-3 text-[3.4rem] sm:text-[5rem]">Track is cold</h2>
              <div className="checkered mt-4 h-4 opacity-90" aria-hidden />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow opacity-75">{board.state === "before" ? "Before the first session" : "Track is clear"}</p>
                {board.alsoNow[0] ? <p className="timing text-sm font-semibold opacity-85">until {clock(board.alsoNow[0].endMin)}</p> : null}
              </div>
              <h2 className={cn("board mt-3", titleSize(board.alsoNow[0]?.title ?? "Between sessions"))}>{board.alsoNow[0]?.title ?? "Between sessions"}</h2>
              {board.alsoNow[0]?.note ? <p className="mt-3 text-sm opacity-90">{board.alsoNow[0].note}</p> : null}
            </>
          )}
        </div>
        {board.isToday && board.nextTrack ? (
          <div className="flex items-center justify-between gap-3 border-t border-current/20 bg-black/10 px-5 py-3 sm:px-7">
            <p className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold">
              <span className="eyebrow shrink-0 opacity-80">Next</span>
              <ItemGroups item={board.nextTrack} groups={groups} size="md" />
              {!board.nextTrack.groupIds.length ? <span className="truncate">{board.nextTrack.title}</span> : null}
            </p>
            <p className="timing shrink-0 text-[15px] font-semibold" suppressHydrationWarning>
              {clock(board.nextTrack.startMin)} · in {countdown(secondsUntil(board.nextTrack.startMin, now))}
            </p>
          </div>
        ) : null}
      </section>

      {/* ── You ── */}
      {registered ? (
        <section className="overflow-hidden rounded-[18px] border border-line bg-surface">
          <div className="flex">
            <span className="wristband w-2 shrink-0 border-r border-ink/15" aria-hidden />
            <div className="min-w-0 flex-1 px-4 py-4 sm:px-6">
              <p className="eyebrow text-ink-2">You</p>

              {nowForMe.map(({ item, why }) => (
                <div key={item.id} className="mt-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-lg leading-snug font-bold">
                      {item.kind === "track" ? (why === "student" ? `On track with ${withStudent(item)}` : "You are on track") : item.title}
                    </p>
                    <p className="text-sm text-ink-2">
                      {item.kind === "track" ? item.title : (KIND[item.kind]?.label ?? "Now")}
                      {item.location ? ` · ${item.location}` : ""} · until <span className="timing">{clock(item.endMin)}</span>
                    </p>
                  </div>
                  <span className="rounded-full bg-good-soft px-2.5 py-1 text-[13px] font-bold text-good">Now</span>
                </div>
              ))}

              {nextForMe ? (
                <div className={cn("mt-3 rounded-[12px] px-4 py-3", gridCall ? "bg-flag-yellow text-ink" : "bg-paper")}>
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <p className="eyebrow text-[11px] opacity-75">
                        {gridCall ? (nextForMe.why === "student" ? "Meet your student at the grid" : "Head to the grid") : board.isToday ? "Your next" : `Your first on ${weekday(board.day)}`}
                      </p>
                      <p className="board mt-1 text-[1.9rem] sm:text-[2.2rem]">{nextForMe.item.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                        <KindIcon kind={nextForMe.item.kind} />
                        <span className="timing">{clockRange(nextForMe.item.startMin, nextForMe.item.endMin)}</span>
                        {nextForMe.why === "student" ? <span>· with {withStudent(nextForMe.item)}</span> : null}
                        {nextForMe.item.location ? <span>· {nextForMe.item.location}</span> : nextForMe.item.kind === "track" ? <span>· {gridPlace}</span> : null}
                      </p>
                    </div>
                    {board.isToday ? (
                      <div className="shrink-0 text-right">
                        <p className="timing text-[1.9rem] leading-none font-bold sm:text-[2.3rem]" suppressHydrationWarning>
                          {countdown(secsToNext)}
                        </p>
                        <p className="eyebrow mt-1 text-[11px] opacity-75">to go</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : !nowForMe.length ? (
                <p className="mt-2 text-[15px] text-ink-2">{mine.all.length ? "Nothing more on your schedule today." : "Nothing on your schedule this day."}</p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* ── Your day ── */}
      {registered && mine.all.length ? (
        <section className="rounded-[18px] border border-line bg-surface">
          <div className="flex items-center justify-between px-4 pt-4 sm:px-6">
            <h2 className="eyebrow text-ink-2">Your {weekday(board.day)}</h2>
            <Link href={`/schedule?day=${board.day}`} className="inline-flex items-center gap-1 text-sm font-semibold underline-offset-4 hover:underline">
              Full schedule <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <ol className="px-2 pt-1 pb-2 sm:px-4">
            {mine.all.map(({ item, why }) => {
              const phase = phaseOf(item, now);
              return (
                <li key={item.id} className={cn("flex items-stretch gap-3 rounded-[10px] px-2 py-2.5", phase === "now" && "bg-paper", phase === "past" && "opacity-50")}>
                  <span className="timing w-[4.6rem] shrink-0 pt-px text-right text-[15px] font-semibold">{clock(item.startMin)}</span>
                  <GroupBar item={item} groups={groups} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 text-[15px] leading-snug font-bold">
                      {item.title}
                      {phase === "now" ? <span className="rounded-full bg-good-soft px-2 py-0.5 text-[11px] font-bold text-good">Now</span> : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-2">
                      <KindIcon kind={item.kind} className="size-3.5" />
                      {why === "student" ? `With ${withStudent(item)}` : (KIND[item.kind]?.label ?? "")}
                      {item.location ? ` · ${item.location}` : ""}
                      <span className="timing">· to {clock(item.endMin)}</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
