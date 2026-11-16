import { FileText, MapPin } from "lucide-react";
import type { Metadata } from "next";
import { screen } from "@/components/shell/skeleton";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ZoomImage } from "@/components/zoom-image";
import { getViewer } from "@/server/auth";
import { NoTrack, TrackTabs } from "../shared";

export const metadata: Metadata = { title: "Maps" };

export default screen(async function MapsPage() {
  const v = await getViewer();
  const track = v.track;
  if (!track) return <NoTrack />;
  const g = track.guide;

  return (
    <>
      <PageHeader title="Maps" lede={`Finding your way around ${track.name}. Tap a map to enlarge it, then pinch to zoom.`} />
      <TrackTabs current="maps" />

      {!g.maps.length && !g.places.length ? <EmptyState title="No maps on file">Ask at registration for a paper map of the grounds.</EmptyState> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="space-y-5">
          {g.maps.map((m, i) => (
            <Card key={m.key} className="px-3 py-4 sm:px-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-1 sm:px-0">
                <div className="min-w-0">
                  <h2 className="board text-[1.6rem]">{m.title}</h2>
                  <p className="mt-1 text-[15px] text-ink-2">{m.caption}</p>
                </div>
                <a href={m.pdf} target="_blank" rel="noreferrer" className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] border border-line-strong px-3 text-sm font-semibold hover:bg-sunk">
                  <FileText className="size-4" aria-hidden /> PDF
                </a>
              </div>
              <ZoomImage src={m.image} alt={m.title} width={m.width} height={m.height} priority={i === 0} sizes="(min-width: 1024px) 640px, 100vw" />
            </Card>
          ))}
        </div>

        {g.places.length ? (
          <Card className="lg:sticky lg:top-6">
            <h2 className="eyebrow px-4 pt-4 text-ink-2 sm:px-5">Where things are</h2>
            <ul className="mt-1 divide-y divide-line">
              {g.places.map((p) => (
                <li key={p.name} className="flex gap-3 px-4 py-3 sm:px-5">
                  <MapPin className="mt-0.5 size-4.5 shrink-0 text-ink-2" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-bold">{p.name}</p>
                    <p className="text-[15px] leading-snug text-ink-2">{p.where}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
});
