import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { screen } from "@/components/shell/skeleton";
import { EmptyState, PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import { getViewer } from "@/server/auth";
import { findDocument, NoTrack, TrackTabs } from "../shared";

export const metadata: Metadata = { title: "Track rules" };

export default screen(async function RulesPage() {
  const v = await getViewer();
  const track = v.track;
  if (!track) return <NoTrack />;
  const g = track.guide;
  const pdf = findDocument(g.documents, /rule/i);
  const hasStrong = g.rules.some((sec) => sec.items.some((i) => i.strong));

  return (
    <>
      <PageHeader
        title="Track rules"
        lede={`The house rules at ${track.name}. They apply to everyone on the grounds: drivers, crew and guests.`}
        actions={
          pdf ? (
            <a href={pdf.href} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-4 text-[15px] font-semibold hover:bg-sunk">
              <FileText className="size-4" aria-hidden /> Rules sheet PDF
            </a>
          ) : undefined
        }
      />
      <TrackTabs current="rules" />

      {g.rules.length ? (
        <>
          {hasStrong ? (
            <p className="mb-4 flex items-center gap-2 text-[15px] text-ink-2">
              <span className="inline-block h-4 w-1 rounded-full bg-flag-red" aria-hidden />
              Start with the rules marked in red.
            </p>
          ) : null}
          {/* Columns on wide screens so the whole sheet can be scanned at once. */}
          <div className="gap-5 lg:columns-2">
            {g.rules.map((sec) => (
              <section key={sec.title} className="mb-5 break-inside-avoid rounded-[14px] border border-line bg-surface">
                <h2 className="board border-b border-line px-4 pt-4 pb-3 text-[1.5rem] sm:px-5">{sec.title}</h2>
                <ul className="divide-y divide-line">
                  {sec.items.map((item, i) => (
                    <li key={i} className="relative px-4 py-3 sm:px-5">
                      {item.strong ? <span className="absolute inset-y-3 left-0 w-1 rounded-r bg-flag-red" aria-hidden /> : null}
                      <p className={cn("text-[16px] leading-snug", item.strong && "font-bold")}>{item.text}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className="text-[13px] text-ink-2">Source: {g.rulesSource}</p>
        </>
      ) : (
        <EmptyState title="No rules sheet on file">The track&apos;s rules are covered at the drivers meeting.</EmptyState>
      )}
    </>
  );
});
