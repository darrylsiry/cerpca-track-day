import { ChevronRight, FileText, Flag, Map, MapPin, Milestone, ScrollText, Signpost, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { screen } from "@/components/shell/skeleton";
import { Card, PageHeader } from "@/components/ui";
import { plural } from "@/lib/cn";
import { getViewer } from "@/server/auth";
import { HubMap } from "./hub-map";
import { NoTrack, TrackTabs } from "./shared";

export const metadata: Metadata = { title: "Track guide" };

export default screen(async function TrackPage() {
  const v = await getViewer();
  const track = v.track;
  if (!track) return <NoTrack />;
  const g = track.guide;
  const mySheet = g.passing.find((p) => p.key === v.group?.passingKey);
  const ruleCount = g.rules.reduce((n, sec) => n + sec.items.length, 0);
  const address = [track.address, [track.city, track.state].filter(Boolean).join(", "), track.zip].filter(Boolean).join(" ");

  const entries: { href: string; icon: LucideIcon; title: string; detail: string }[] = [
    {
      href: "/track/turns",
      icon: Milestone,
      title: "Turn by turn",
      detail: `All ${plural(g.turns.length, "turn")}, one at a time: where to brake, turn in and apex.`,
    },
    {
      href: "/track/passing",
      icon: Signpost,
      title: "Passing zones",
      detail: mySheet
        ? `${v.group?.name}: ${mySheet.headline.toLowerCase()}. ${mySheet.rule}`
        : v.group
          ? `No sheet on file for ${v.group.name}. See the zones for the other run groups.`
          : "Where each run group may pass, and on which side.",
    },
    { href: "/track/flags", icon: Flag, title: "Flags", detail: `${plural(g.flags.length, "flag")} and what to do when you see each one.` },
    { href: "/track/rules", icon: ScrollText, title: "Track rules", detail: `${plural(ruleCount, "rule")} from the track, in ${plural(g.rules.length, "section")}.` },
    { href: "/track/maps", icon: Map, title: "Maps", detail: `${plural(g.maps.length, "map")} of the grounds, and where to find things in the paddock.` },
    {
      href: "/track/docs",
      icon: FileText,
      title: "Documents and glossary",
      detail: `${plural(g.documents.length, "document")} to open or save, and ${plural(g.glossary.length, "term")} your instructor will use.`,
    },
  ];

  return (
    <>
      <PageHeader title={track.shortName} lede={g.overview} />
      <TrackTabs current="overview" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-6">
        <Card className="px-2 pt-3 pb-4 sm:px-5 sm:pt-5">
          <HubMap shape={g.shape} label={`Map of ${track.name} with numbered turns`} />
          <p className="mt-1 text-center text-sm text-ink-2">Tap a turn number to study that turn.</p>
        </Card>

        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3">
            {g.facts.map((f) => (
              <div key={f.label} className="rounded-[14px] border border-line bg-surface px-4 py-3">
                <dt className="eyebrow text-[11px] text-ink-2">{f.label}</dt>
                <dd className="board mt-1.5 text-[1.7rem]">{f.value}</dd>
              </div>
            ))}
          </dl>
          {address ? (
            <Card className="flex items-start gap-3 px-4 py-3.5">
              <MapPin className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-bold">{track.name}</p>
                <p className="text-[15px] text-ink-2">{address}</p>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${track.name} ${address}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex h-9 items-center text-[15px] font-semibold underline underline-offset-4"
                >
                  Get directions
                </a>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <h2 className="eyebrow mt-7 mb-2.5 text-ink-2">In this guide</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((e) => {
          const Icon = e.icon;
          return (
            <li key={e.href}>
              <Link href={e.href} className="flex h-full items-start gap-3.5 rounded-[14px] border border-line bg-surface px-4 py-4 transition-colors hover:border-ink active:bg-paper">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunk">
                  <Icon className="size-5" strokeWidth={2.2} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px] leading-snug font-bold">{e.title}</span>
                  <span className="mt-0.5 block text-[15px] text-ink-2">{e.detail}</span>
                </span>
                <ChevronRight className="mt-2.5 size-4.5 shrink-0 text-ink-3" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
});
