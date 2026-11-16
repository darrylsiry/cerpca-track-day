import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { screen } from "@/components/shell/skeleton";
import { ButtonLink, EmptyState, Notice } from "@/components/ui";
import { cn } from "@/lib/cn";
import { INCIDENT_STATUS } from "@/lib/incident";
import { clock, dateOnly, dayFull, fromTimeInput } from "@/lib/time";
import type { IncidentParty, YesNo } from "@/lib/types";
import { requireAdmin } from "@/server/auth";
import { getIncident, normalizeIncidentData } from "@/server/incidents";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Incident report: print" };

/* The printed report follows the PCA "Incident Report – Driving Event" form: same items, same order, three pages. */

function Sheet({ children, last }: { children: ReactNode; last?: boolean }) {
  return (
    <section
      className={cn(
        "rounded-md border border-line bg-white px-6 py-7 text-black sm:px-10 sm:py-9 print:rounded-none print:border-0 print:p-0",
        !last && "print:break-after-page",
      )}
    >
      {children}
    </section>
  );
}

function Line({
  label,
  value,
  className,
}: {
  label: string;
  value?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-end gap-2", className)}>
      <span className="shrink-0">{label}</span>
      <span className="min-h-[1.45em] min-w-0 flex-1 border-b border-black/70 px-1 font-semibold break-words">
        {value}
      </span>
    </div>
  );
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span
      className="inline-grid size-[0.95em] translate-y-[0.1em] place-items-center border border-black text-[0.8em] leading-none font-bold"
      aria-hidden
    >
      {checked ? "✕" : ""}
    </span>
  );
}

function YesNoBoxes({
  label,
  value,
  className,
}: {
  label: string;
  value: YesNo;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-flex flex-wrap items-baseline gap-x-3", className)}
    >
      <span>{label}</span>
      <span className="inline-flex items-baseline gap-1.5">
        <Box checked={value === "yes"} /> Yes
      </span>
      <span className="inline-flex items-baseline gap-1.5">
        <Box checked={value === "no"} /> No
      </span>
      <span className="sr-only">
        {value ? `Answer: ${value}` : "Not answered"}
      </span>
    </span>
  );
}

function Item({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="w-6 shrink-0 font-semibold">{n}.</span>
      <div className="min-w-0 flex-1 space-y-2">{children}</div>
    </div>
  );
}

function Contact({ p }: { p: IncidentParty }) {
  return (
    <>
      <Line label="Address:" value={p.address} />
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 print:grid-cols-2">
        <Line label="Telephone:" value={p.phone} />
        <Line label="E-mail:" value={p.email} />
      </div>
    </>
  );
}

function Prose({ text, minLines }: { text: string; minLines: number }) {
  return (
    <p
      className="border border-black/40 px-2.5 py-2 font-semibold break-words whitespace-pre-line"
      style={{ minHeight: `${minLines * 1.45}em` }}
    >
      {text}
    </p>
  );
}

export default screen(async function IncidentPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const v = await requireAdmin();
  const { id } = await params;
  const found = await getIncident(v.org.id, id);
  if (!found) {
    return (
      <EmptyState
        title="That report was not found"
        action={
          <ButtonLink href="/admin/incidents">Back to incidents</ButtonLink>
        }
      >
        It may have been deleted while it was still a draft.
      </EmptyState>
    );
  }
  const { incident: i, track } = found;
  const d = normalizeIncidentData(i.data);
  const tz = track?.timezone ?? v.tz;
  const time = i.occurredTime ? fromTimeInput(i.occurredTime) : null;
  const status = INCIDENT_STATUS[i.status] ?? INCIDENT_STATUS.draft;
  const recipients = v.org.settings.incidentRecipients ?? [];

  return (
    <div className="mx-auto max-w-[8.5in]">
      <style>{`@page { size: letter; margin: 0.6in; }`}</style>

      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/admin/incidents/${i.id}`}
          className="inline-flex h-11 items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink"
        >
          <span aria-hidden>←</span> Back to the report
        </Link>
        <PrintButton />
      </div>
      {i.status === "draft" ? (
        <Notice
          tone="warn"
          title="This report is still a draft"
          className="no-print mb-4"
        >
          Mark it final before you send it to PCA. The printout is watermarked
          as a draft until then.
        </Notice>
      ) : (
        <Notice tone="info" className="no-print mb-4">
          In the print dialog choose “Save as PDF”, then attach the file and the
          signed waivers to your email to PCA.
        </Notice>
      )}

      <article className="space-y-5 text-[13px] leading-snug print:space-y-0 print:text-[11.5pt]">
        {/* ── Page 1 ── */}
        <Sheet>
          <header className="text-center">
            <h1 className="text-xl font-bold">
              Incident Report – Driving Event
            </h1>
            <p className="text-xs">Version January 2017</p>
            {i.status === "draft" ? (
              <p className="mt-1 text-sm font-bold tracking-[0.3em] uppercase">
                Draft · not for submission
              </p>
            ) : null}
          </header>
          <p className="mt-4 italic">
            Complete all pages of this report for all incidents involving car
            damage or personal injury. In the case of a multiple car incident,
            complete one report per car.
          </p>

          <div className="mt-5 space-y-5">
            <Item n={1}>
              <Line label="PCA Region:" value={d.region} />
              <Line label="Name of Event Chair:" value={d.eventChair} />
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 print:grid-cols-2">
                <Line label="Telephone:" value={d.chairPhone} />
                <Line label="E-mail:" value={d.chairEmail} />
              </div>
              <Line
                label="Location (specific street, city/town, state):"
                value={d.locationAddress}
              />
              <Line label="Type of Event:" value={d.eventType} />
              <Line
                label="Date of Incident:"
                value={`${dayFull(i.occurredOn)}${time !== null ? `, ${clock(time)}` : ""}${i.location ? ` · ${i.location}` : ""}`}
              />
            </Item>

            <Item n={2}>
              <Line label="Name of Driver:" value={d.driver.name} />
              <Contact p={d.driver} />
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <YesNoBoxes label="Any injuries?" value={d.driver.injuries} />
                <Line
                  label="Who determined:"
                  value={d.driver.determinedBy}
                  className="min-w-[14rem] flex-1"
                />
              </div>
              <YesNoBoxes
                label="Was driver a signed-in entrant?"
                value={d.driver.signedIn}
              />
              <Line
                label="If no, please explain?"
                value={d.driver.notSignedInExplain}
              />
            </Item>

            <Item n={3}>
              <YesNoBoxes
                label="Was there a passenger in the vehicle?"
                value={d.passenger.present}
              />
              <Line
                label="If yes, Name of Passenger:"
                value={d.passenger.name}
              />
              <Contact p={d.passenger} />
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <YesNoBoxes
                  label="Any injuries?"
                  value={
                    d.passenger.present === "yes" ? d.passenger.injuries : ""
                  }
                />
                <Line
                  label="Who determined:"
                  value={d.passenger.determinedBy}
                  className="min-w-[14rem] flex-1"
                />
              </div>
              <YesNoBoxes
                label="Was passenger a signed-in entrant?"
                value={
                  d.passenger.present === "yes" ? d.passenger.signedIn : ""
                }
              />
              <Line
                label="If no, please explain?"
                value={d.passenger.notSignedInExplain}
              />
            </Item>

            <Item n={4}>
              <YesNoBoxes
                label="Was there injury to any other party?"
                value={d.other.present}
              />
              <Line
                label="If yes, Name of Injured Party:"
                value={d.other.name}
              />
              <Contact p={d.other} />
              <Line
                label="Who determined injury:"
                value={d.other.determinedBy}
              />
              <YesNoBoxes
                label="Was injured party a signed in entrant?"
                value={d.other.present === "yes" ? d.other.signedIn : ""}
              />
              <Line
                label="If yes, in what role? (i.e. photographer, caterer, etc)"
                value={d.other.role}
                className="pl-4"
              />
              <Line
                label="If no, please explain?"
                value={d.other.notSignedInExplain}
                className="pl-4"
              />
            </Item>

            <Item n={5}>
              <p>
                Attach a photocopy of the signed waiver for all parties named in
                this report with name and signature highlighted.{" "}
                <span className="inline-flex items-baseline gap-1.5 font-semibold">
                  <Box checked={d.waiversAttached} /> Attached
                </span>
              </p>
            </Item>
          </div>
        </Sheet>

        {/* ── Page 2 ── */}
        <Sheet>
          <h2 className="font-bold">Incident Report (page 2)</h2>
          <div className="mt-5 space-y-5">
            <Item n={6}>
              <p>
                Describe automobile(s) involved, including make, year, model,
                color, body style:
              </p>
              <Prose text={d.vehicles} minLines={3} />
            </Item>
            <Item n={7}>
              <p>
                Describe the incident, including the nature of any injuries,
                damage to car, and/or property damage.
              </p>
              <Prose text={d.description} minLines={7} />
            </Item>
            <Item n={8}>
              <p>
                If injuries required transport, please provide the following for
                each party:
              </p>
              <Line
                label="Name of person transported:"
                value={d.transport.name}
              />
              <Line label="Name of Hospital:" value={d.transport.hospital} />
              <Line
                label="Address (city/state/zip):"
                value={d.transport.address}
              />
              <Line label="Telephone:" value={d.transport.phone} />
              <p className="flex flex-wrap items-baseline gap-x-5">
                <span>Check one:</span>
                <span className="inline-flex items-baseline gap-1.5">
                  <Box checked={d.transport.disposition === "outpatient"} />{" "}
                  Outpatient emergency room
                </span>
                <span className="inline-flex items-baseline gap-1.5">
                  <Box checked={d.transport.disposition === "admitted"} />{" "}
                  Admitted
                </span>
              </p>
            </Item>
            <Item n={9}>
              <p>Sketch of Incident</p>
              <div className="grid min-h-[2.6in] place-items-center border border-black/70 p-1">
                {i.sketch ? (
                  // eslint-disable-next-line @next/next/no-img-element -- stored data URL
                  <img
                    src={i.sketch}
                    alt="Sketch of the incident drawn over the circuit"
                    className="max-h-[3.4in] w-full object-contain"
                  />
                ) : (
                  <span className="text-black/50">No sketch was drawn</span>
                )}
              </div>
            </Item>
          </div>
        </Sheet>

        {/* ── Page 3 ── */}
        <Sheet last>
          <h2 className="font-bold">Incident Report (page 3)</h2>
          <div className="mt-5 space-y-5">
            <Item n={10}>
              <p>Additional comments:</p>
              <Prose text={d.comments} minLines={5} />
            </Item>
            <Item n={11}>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[1.4fr_1fr] print:grid-cols-[1.4fr_1fr]">
                <Line label="Report prepared by:" value={d.preparedBy.name} />
                <Line label="Title:" value={d.preparedBy.title} />
              </div>
              <div className="flex items-end gap-2">
                <span className="shrink-0">Signature:</span>
                <span className="flex min-h-[3.4rem] flex-1 items-end border-b border-black/70 px-1">
                  {d.preparedBy.signature ? (
                    // eslint-disable-next-line @next/next/no-img-element -- stored data URL
                    <img
                      src={d.preparedBy.signature}
                      alt={`Signature of ${d.preparedBy.name}`}
                      className="h-14 w-auto object-contain"
                    />
                  ) : null}
                </span>
                {d.preparedBy.signedAt ? (
                  <span className="shrink-0 text-xs">
                    Signed {dateOnly(d.preparedBy.signedAt, tz)}
                  </span>
                ) : null}
              </div>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 print:grid-cols-2">
                <Line label="Telephone (W):" value={d.preparedBy.phoneWork} />
                <Line label="Telephone (H):" value={d.preparedBy.phoneHome} />
                <Line label="Fax:" value={d.preparedBy.fax} />
                <Line label="E-mail:" value={d.preparedBy.email} />
              </div>
            </Item>
          </div>

          <div className="mt-8">
            <p>Please send to all individuals listed below:</p>
            <table className="mt-3 w-full border-collapse text-left">
              <tbody>
                {recipients.map((r) => (
                  <tr key={`${r.role}-${r.email}`} className="align-top">
                    <th scope="row" className="w-[42%] py-1.5 pr-4 font-bold">
                      {r.role}
                    </th>
                    <td className="w-[22%] py-1.5 pr-4 font-bold">
                      {r.name ?? ""}
                    </td>
                    <td className="py-1.5">
                      <span className="font-bold">Email:</span>{" "}
                      {r.email || "address to be confirmed"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-8 border-t border-black/30 pt-2 text-[0.85em] text-black/60">
            {status.label}
            {i.sentAt ? ` ${dateOnly(i.sentAt, tz)}` : ""} · Report due at PCA
            by {dayFull(i.dueOn)} · Prepared with Track Day for{" "}
            {v.org.shortName}
          </p>
        </Sheet>
      </article>
    </div>
  );
});
