import { ArrowRight, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { screen } from "@/components/shell/skeleton";
import { TrackMap, type Segment } from "@/components/track-map";
import { Card, EmptyState, GroupChip, Notice, PageHeader, Segmented } from "@/components/ui";
import { ZoomImage } from "@/components/zoom-image";
import { getViewer } from "@/server/auth";
import { badgeSpot, midFraction, pathPoints } from "../geometry";
import { NoTrack, TrackTabs } from "../shared";

export const metadata: Metadata = { title: "Passing zones" };

export default screen(async function PassingPage({ searchParams }: { searchParams: Promise<{ sheet?: string }> }) {
  const v = await getViewer();
  const { sheet: wanted } = await searchParams;
  const track = v.track;
  if (!track) return <NoTrack />;
  const g = track.guide;

  const groupsFor = (keys: string[]) => v.groups.filter((gr) => keys.includes(gr.key));
  const labelFor = (keys: string[], fallback: string) => {
    const names = groupsFor(keys).map((gr) => gr.name);
    return names.length ? names.join(" and ") : fallback;
  };
  const mine = g.passing.find((p) => p.key === v.group?.passingKey) ?? null;
  const sheet = g.passing.find((p) => p.key === wanted) ?? mine ?? g.passing[0] ?? null;

  const header = <PageHeader title="Passing zones" lede="Where your run group may pass, and how." />;

  if (!sheet) {
    return (
      <>
        {header}
        <TrackTabs current="passing" />
        <EmptyState title="No passing-zone sheets on file">Passing rules for this track are covered at the drivers meeting.</EmptyState>
      </>
    );
  }

  const zones = g.shape.zones[sheet.key] ?? [];
  const points = pathPoints(g.shape.d);
  const segments: Segment[] = zones.map((z) => ({ start: z.start, end: z.end, color: "var(--color-flag-red)", width: 16, key: z.n }));

  return (
    <>
      {header}
      <TrackTabs current="passing" />

      {v.group && !mine ? (
        <Notice tone="warn" title={`No passing-zone sheet on file for the ${v.group.name} run group`} className="mb-4">
          Passing rules for {v.group.name} are covered at the drivers meeting. The sheets below are for other run groups and do not apply to you.
        </Notice>
      ) : null}

      {g.passing.length > 1 ? (
        <Segmented
          label="Run group sheets"
          current={sheet.key}
          items={g.passing.map((p) => ({ key: p.key, href: `/track/passing?sheet=${p.key}`, label: labelFor(p.groupKeys, p.title) }))}
          className="mb-4"
        />
      ) : null}

      {mine && sheet.key !== mine.key ? (
        <Notice tone="info" className="mb-4">
          This sheet is for {labelFor(sheet.groupKeys, sheet.title)}. Your run group, {v.group?.name}, uses a different one.{" "}
          <Link href={`/track/passing?sheet=${mine.key}`} className="inline-flex items-center gap-1 font-semibold underline underline-offset-4">
            Open your sheet <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </Notice>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="space-y-4">
          {/* The rule, stated once, big. */}
          <section className="rounded-[18px] bg-ink px-5 py-5 text-white sm:px-7 sm:py-6">
            <div className="flex flex-wrap items-center gap-2">
              {groupsFor(sheet.groupKeys).map((gr) => (
                <GroupChip key={gr.id} group={gr} size="lg" />
              ))}
              {mine?.key === sheet.key ? <span className="inline-flex h-7 items-center rounded-full bg-white/15 px-3 text-[13px] font-semibold">Your run group</span> : null}
            </div>
            <p className="eyebrow mt-4 text-white/70">{sheet.headline}</p>
            <p className="mt-1.5 text-[1.6rem] leading-[1.15] font-bold sm:text-[2rem]">{sheet.rule}</p>
          </section>

          <Card className="px-2 pt-3 pb-3 sm:px-5 sm:pt-5">
            <TrackMap shape={g.shape} segments={segments} label={`${track.name} with the ${labelFor(sheet.groupKeys, sheet.title)} passing zones marked in red`}>
              {zones.map((z) => {
                const [bx, by] = badgeSpot(g.shape, points, midFraction(z.start, z.end));
                return (
                  <g key={z.n} aria-hidden>
                    <rect x={bx - 15} y={by - 15} width={30} height={30} rx={7} fill="var(--color-flag-red)" />
                    <text x={bx} y={by} textAnchor="middle" dominantBaseline="central" fontFamily="var(--font-display)" fontWeight={800} fontSize={24} fill="#fff">
                      {z.n}
                    </text>
                  </g>
                );
              })}
            </TrackMap>
            <p className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px] text-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-6 rounded-full bg-flag-red" aria-hidden /> Passing zone
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="timing inline-grid size-4.5 place-items-center rounded-full border-2 border-ink text-[10px] font-bold" aria-hidden>
                  1
                </span>
                Turn number
              </span>
            </p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <h2 className="eyebrow px-4 pt-4 text-ink-2 sm:px-5">The zones</h2>
            <ol className="mt-1 divide-y divide-line">
              {sheet.zones.map((z) => (
                <li key={z.n} className="flex gap-3.5 px-4 py-3.5 sm:px-5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-flag-red font-display text-2xl leading-none font-extrabold text-white" aria-label={`Zone ${z.n}`}>
                    {z.n}
                  </span>
                  <div className="min-w-0 flex-1">
                    <dl className="space-y-1 text-[16px] leading-snug">
                      <div className="flex gap-2">
                        <dt className="eyebrow w-12 shrink-0 pt-1 text-[11px] text-ink-2">Starts</dt>
                        <dd className="font-semibold">{z.from}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="eyebrow w-12 shrink-0 pt-1 text-[11px] text-ink-2">Ends</dt>
                        <dd className="font-semibold">{z.to}</dd>
                      </div>
                    </dl>
                    {z.note ? <p className="mt-2 rounded-[8px] bg-warn-soft px-3 py-2 text-[15px] font-semibold text-ink">{z.note}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="px-4 py-4 sm:px-5">
            <h2 className="eyebrow mb-3 text-ink-2">The official sheet</h2>
            {/* Size is a layout hint; the image's own proportions decide the final height. */}
            <ZoomImage src={sheet.image} alt={`${sheet.title}: official passing-zone sheet`} width={1600} height={1180} sizes="(min-width: 1024px) 420px, 100vw" />
            <a href={sheet.pdf} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-11 items-center gap-2 rounded-[10px] border border-line-strong px-4 text-[15px] font-semibold hover:bg-sunk">
              <FileText className="size-4" aria-hidden /> Open the PDF
            </a>
          </Card>
        </div>
      </div>
    </>
  );
});
