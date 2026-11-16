"use client";

import { ArrowLeft, ArrowRight, CornerUpLeft, CornerUpRight, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { TrackMap } from "@/components/track-map";
import { Card, Notice } from "@/components/ui";
import { ZoomImage } from "@/components/zoom-image";
import { cn } from "@/lib/cn";
import type { TrackShape, TrackTurn } from "@/lib/types";

/** 0 stands for the "track entry" card that precedes Turn 1. */
const ENTRY = 0;

export function TurnExplorer({
  shape,
  turns,
  lineIntro,
  lineSource,
  trackEntry,
  initial,
  trackName,
}: {
  shape: TrackShape;
  turns: TrackTurn[];
  lineIntro: string;
  lineSource: string;
  trackEntry: string;
  initial: number;
  trackName: string;
}) {
  const [selected, setSelected] = useState(initial);
  const detailRef = useRef<HTMLDivElement>(null);
  const order = [ENTRY, ...turns.map((t) => t.n)];
  const index = Math.max(0, order.indexOf(selected));
  const prev = index > 0 ? order[index - 1] : null;
  // After the last turn the lap starts again at the first.
  const next = index < order.length - 1 ? order[index + 1] : (turns[0]?.n ?? null);

  const select = useCallback((n: number, scrollToDetail = false) => {
    setSelected(n);
    // Keep the address in step so the turn can be shared or reloaded, without a navigation.
    window.history.replaceState(null, "", n === ENTRY ? "?turn=entry" : `?turn=${n}`);
    if (scrollToDetail) detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.key === "ArrowRight" && next !== null) select(next);
      if (e.key === "ArrowLeft" && prev !== null) select(prev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, select]);

  const turn = turns.find((t) => t.n === selected) ?? null;
  const geo = turn ? shape.turns.find((t) => t.n === turn.n) : null;
  const label = (n: number) => (n === ENTRY ? "Track entry" : `Turn ${n}`);

  const about = (
    <>
      <h2 className="eyebrow text-ink-2">About this line</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink">{lineIntro}</p>
      <p className="mt-2 text-[13px] text-ink-2">Source: {lineSource}</p>
    </>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start lg:gap-6">
      {/* Map and selector */}
      <div className="lg:sticky lg:top-6">
        <Card className="px-2 pt-3 pb-2 sm:px-4 sm:pt-4">
          <TrackMap
            shape={shape}
            label={`Map of ${trackName}. ${turn ? `Turn ${turn.n} is highlighted.` : "Select a turn."}`}
            activeTurn={turn?.n ?? null}
            segments={geo ? [{ start: geo.start, end: geo.end, color: "var(--color-flag-red)", width: 16, key: geo.n }] : []}
            onTurnClick={(n) => select(n)}
          />
        </Card>

        <div role="group" aria-label="Choose a turn" className="mt-3 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
          {order.map((n) => {
            const active = n === selected;
            return (
              <button
                key={n}
                type="button"
                aria-pressed={active}
                aria-label={label(n)}
                onClick={() => select(n)}
                className={cn(
                  "grid h-12 place-items-center rounded-[10px] border font-display leading-none font-extrabold transition-colors",
                  n === ENTRY ? "text-[15px] tracking-[0.06em] uppercase" : "text-[1.7rem]",
                  active ? "border-flag-red bg-flag-red text-white" : "border-line-strong bg-surface text-ink hover:border-ink active:bg-sunk",
                )}
              >
                {n === ENTRY ? "Entry" : n}
              </button>
            );
          })}
        </div>

        <Card className="mt-4 hidden px-5 py-4 lg:block">{about}</Card>
      </div>

      {/* The selected turn */}
      <div ref={detailRef} className="scroll-mt-20 lg:scroll-mt-6">
        <Card key={selected} className="animate-rise overflow-hidden">
          {turn ? (
            <>
              <div className="px-4 pt-4 sm:px-6 sm:pt-5">
                <p className="eyebrow text-ink-2">Turn</p>
                <div className="mt-1 flex items-end gap-4">
                  <span className="board text-[6.5rem] sm:text-[8rem]">{turn.n}</span>
                  <div className="min-w-0 pb-2 sm:pb-3">
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-ink px-3 text-[13px] font-bold text-white">
                      {/^left/i.test(turn.direction) ? <CornerUpLeft className="size-4" aria-hidden /> : <CornerUpRight className="size-4" aria-hidden />}
                      {turn.direction}-hander
                    </span>
                    <p className="mt-2 text-lg leading-snug font-bold">{turn.character}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4 px-4 pt-4 pb-5 sm:px-6">
                {turn.caution ? (
                  <div className="flex gap-3 rounded-[12px] bg-flag-yellow px-4 py-3 text-ink">
                    <TriangleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={2.4} aria-hidden />
                    <p className="text-[15px] font-semibold">
                      <span className="eyebrow mb-0.5 block text-[11px]">Caution</span>
                      {turn.caution}
                    </p>
                  </div>
                ) : null}

                <section>
                  <h3 className="eyebrow text-ink-2">Through the corner</h3>
                  <ol className="mt-2.5 space-y-2.5">
                    {turn.keyPoints.map((point, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="timing mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-sunk text-[13px] font-bold">{i + 1}</span>
                        <span className="text-[17px] leading-snug">{point}</span>
                      </li>
                    ))}
                  </ol>
                </section>

                {turn.passingNote ? (
                  <Notice tone="info" title="Passing">
                    {turn.passingNote}{" "}
                    <Link href="/track/passing" className="font-semibold underline underline-offset-4">
                      See your passing zones
                    </Link>
                  </Notice>
                ) : null}

                {turn.image ? (
                  // The slides share one wide format; the size is only a layout hint and the real image sets the final height.
                  <ZoomImage src={turn.image} alt={`Turn ${turn.n}: the student line, illustrated`} width={1400} height={574} caption="From the student line presentation. Tap to enlarge." sizes="(min-width: 1024px) 560px, 100vw" />
                ) : null}

                <section>
                  <h3 className="eyebrow text-ink-2">In full</h3>
                  <p className="prose-td mt-2 text-ink">{turn.text}</p>
                </section>
              </div>
            </>
          ) : (
            <div className="px-4 pt-4 pb-5 sm:px-6 sm:pt-5">
              <p className="eyebrow text-ink-2">Before turn 1</p>
              <h2 className="board mt-2 text-[2.6rem] sm:text-[3.2rem]">Track entry</h2>
              <p className="mt-1 text-[15px] font-semibold text-ink-2">For your first lap out of the pits only.</p>
              <p className="mt-4 text-[17px] leading-relaxed">{trackEntry}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 border-t border-line bg-paper/60 p-3">
            <button
              type="button"
              disabled={prev === null}
              onClick={() => prev !== null && select(prev, true)}
              className="flex h-12 items-center justify-center gap-2 rounded-[10px] border border-line-strong bg-surface text-[15px] font-semibold hover:bg-sunk disabled:opacity-40"
            >
              <ArrowLeft className="size-4" aria-hidden /> {prev !== null ? label(prev) : "Start"}
            </button>
            <button
              type="button"
              disabled={next === null}
              onClick={() => next !== null && select(next, true)}
              className="flex h-12 items-center justify-center gap-2 rounded-[10px] bg-ink text-[15px] font-semibold text-white hover:bg-ink/88 disabled:opacity-40"
            >
              {next !== null ? label(next) : "End"} <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </Card>

        <Card className="mt-4 px-4 py-4 lg:hidden">{about}</Card>
      </div>
    </div>
  );
}
