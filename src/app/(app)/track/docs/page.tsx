import { ArrowUpRight, FileText } from "lucide-react";
import type { Metadata } from "next";
import { screen } from "@/components/shell/skeleton";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { getViewer } from "@/server/auth";
import { NoTrack, TrackTabs } from "../shared";

export const metadata: Metadata = { title: "Documents" };

const fileType = (href: string) => (/\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(href)?.[1] ?? "file").toUpperCase();

export default screen(async function DocsPage() {
  const v = await getViewer();
  const track = v.track;
  if (!track) return <NoTrack />;
  const g = track.guide;

  return (
    <>
      <PageHeader title="Documents" lede="The original handouts, to open or save to your phone, and the terms your instructor will use." />
      <TrackTabs current="docs" />

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start lg:gap-6">
        <section>
          <h2 className="eyebrow mb-2.5 text-ink-2">Handouts</h2>
          {g.documents.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
              {g.documents.map((d) => (
                <li key={d.href}>
                  <a href={d.href} target="_blank" rel="noreferrer" className="flex items-center gap-3.5 px-4 py-3.5 hover:bg-paper active:bg-sunk sm:px-5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-sunk">
                      <FileText className="size-5" strokeWidth={2.2} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block leading-snug font-bold">{d.title}</span>
                      <span className="block text-sm text-ink-2">{d.description}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-0.5">
                      <ArrowUpRight className="size-4.5 text-ink-3" aria-hidden />
                      <span className="timing text-[12px] text-ink-3">
                        {fileType(d.href)} · {d.size}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No documents on file">Handouts for this track have not been added yet.</EmptyState>
          )}
        </section>

        <section>
          <h2 className="eyebrow mb-2.5 text-ink-2">Glossary</h2>
          {g.glossary.length ? (
            <Card>
              <dl className="divide-y divide-line">
                {g.glossary.map((t) => (
                  <div key={t.term} className="px-4 py-3.5 sm:px-5">
                    <dt className="font-bold">{t.term}</dt>
                    <dd className="mt-0.5 text-[15px] leading-relaxed text-ink-2">{t.def}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          ) : (
            <EmptyState title="No glossary on file">Ask your instructor about any term you are unsure of.</EmptyState>
          )}
        </section>
      </div>
    </>
  );
});
