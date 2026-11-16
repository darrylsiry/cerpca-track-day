import { FileText } from "lucide-react";
import type { Metadata } from "next";
import { FlagIcon } from "@/components/flag-icon";
import { screen } from "@/components/shell/skeleton";
import { EmptyState, PageHeader, Pill } from "@/components/ui";
import { getViewer } from "@/server/auth";
import { findDocument, NoTrack, TrackTabs } from "../shared";

export const metadata: Metadata = { title: "Flags" };

export default screen(async function FlagsPage() {
  const v = await getViewer();
  const track = v.track;
  if (!track) return <NoTrack />;
  const g = track.guide;
  const pdf = findDocument(g.documents, /flag/i);

  return (
    <>
      <PageHeader
        title="Flags"
        lede="What each flag means and what to do when you see it."
        actions={
          pdf ? (
            <a href={pdf.href} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-line-strong bg-surface px-4 text-[15px] font-semibold hover:bg-sunk">
              <FileText className="size-4" aria-hidden /> Flag card PDF
            </a>
          ) : undefined
        }
      />
      <TrackTabs current="flags" />

      {g.flags.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {g.flags.map((flag) => (
            <li key={flag.key} className="flex gap-4 rounded-[14px] border border-line bg-surface px-4 py-4 sm:gap-5 sm:px-5">
              <FlagIcon flag={flag} className="mt-0.5 w-[5.5rem] sm:w-28" />
              <div className="min-w-0 flex-1">
                <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="board text-[1.65rem]">{flag.name}</span>
                  {flag.qualifier ? <Pill>{flag.qualifier}</Pill> : null}
                </h2>
                <ul className="mt-2 space-y-1.5">
                  {flag.meanings.map((m, i) => (
                    <li key={i} className="flex gap-2 text-[16px] leading-snug">
                      <span className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-ink" aria-hidden />
                      <span className={/^no\b|do not/i.test(m) ? "font-bold" : undefined}>{m}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No flag card on file">Flags for this track are explained at the drivers meeting.</EmptyState>
      )}
    </>
  );
});
