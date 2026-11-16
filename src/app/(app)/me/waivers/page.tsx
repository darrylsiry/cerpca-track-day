import { Check, ChevronRight, PenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { screen } from "@/components/shell/skeleton";
import { Card, EmptyState, Notice, PageHeader, Pill } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dateOnly, dateRange } from "@/lib/time";
import { getViewer } from "@/server/auth";
import { activeTemplates, isCurrent, signaturesFor } from "@/server/waivers";

export const metadata: Metadata = { title: "Waivers" };

export default screen(async function MyWaiversPage() {
  const v = await getViewer();
  if (!v.event) {
    return (
      <>
        <PageHeader title="Waivers" />
        <EmptyState title="Nothing to sign yet">Waivers are signed once per event. When the region publishes its next track day, the documents will be listed here.</EmptyState>
      </>
    );
  }
  const [templates, signatures] = await Promise.all([activeTemplates(v.org.id), signaturesFor(v.event.id, v.user.id)]);
  const required = templates.filter((t) => t.required);
  const signedRequired = required.filter((t) => isCurrent(t, signatures.get(t.id))).length;
  const allDone = required.length > 0 && signedRequired === required.length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Waivers"
        lede={`For ${v.event.name}, ${dateRange(v.event.startDate, v.event.endDate)}. Sign each document once per event. Doing it here before you arrive saves a queue at registration.`}
      />

      {!v.registration ? (
        <Notice tone="info" title="You are not on the roster for this event" className="mb-4">
          You can still read and sign these, so they are on file if you are added later or attend as a guest.
        </Notice>
      ) : null}

      {templates.length ? (
        <>
          <div className={cn("mb-4 flex items-center gap-3 rounded-[14px] border px-4 py-3.5", allDone ? "border-good/30 bg-good-soft" : "border-line bg-surface")}>
            <p className="board text-[2.2rem]">
              {signedRequired}/{required.length}
            </p>
            <div className="min-w-0">
              <p className="font-bold">{allDone ? "All required waivers are signed" : "Required waivers signed"}</p>
              <p className="text-sm text-ink-2">{allDone ? "Nothing more to do here." : "It takes about two minutes."}</p>
            </div>
          </div>

          <Card>
            <ul className="divide-y divide-line">
              {templates.map((t) => {
                const sig = signatures.get(t.id);
                const current = isCurrent(t, sig);
                const updated = Boolean(sig && !current);
                return (
                  <li key={t.id}>
                    <Link href={`/me/waivers/${t.id}`} className="flex items-center gap-3 px-4 py-4 hover:bg-paper sm:px-5">
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", current ? "bg-good text-white" : "bg-warn-soft text-warn")}>
                        {current ? <Check className="size-5" strokeWidth={3} /> : <PenLine className="size-4.5" strokeWidth={2.5} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-base font-bold">{t.title}</span>
                          {!t.required ? <Pill>Optional</Pill> : null}
                        </span>
                        {t.summary ? <span className="mt-0.5 block text-sm text-ink-2">{t.summary}</span> : null}
                        <span className={cn("mt-1 block text-sm font-semibold", current ? "text-good" : "text-warn")}>
                          {current && sig ? `Signed on ${dateOnly(sig.signedAt, v.tz)}` : updated ? "Updated since you signed. Sign it again." : "Needs your signature"}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-ink-3" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      ) : (
        <EmptyState title="No waivers have been set up for this event">The region has not published any documents to sign. Check back closer to the event.</EmptyState>
      )}
    </div>
  );
});
