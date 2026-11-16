import { Printer, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { ActionButton } from "@/components/form";
import { screen } from "@/components/shell/skeleton";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  Pill,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  dueState,
  finalProblems,
  INCIDENT_STATUS,
  locationPicks,
} from "@/lib/incident";
import { dateOnly, dateTime, dayLong } from "@/lib/time";
import { requireAdmin } from "@/server/auth";
import {
  getIncident,
  incidentRoster,
  normalizeIncidentData,
} from "@/server/incidents";
import {
  deleteIncident,
  markIncidentSent,
  unmarkIncidentSent,
} from "../actions";
import { IncidentForm } from "../incident-form";
import { SendPanel } from "../send-panel";

export const metadata: Metadata = { title: "Incident report" };

const toneText = {
  neutral: "text-ink-2",
  warn: "text-warn",
  bad: "text-bad",
} as const;

export default screen(async function IncidentPage({
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
  const { incident: i, event, track } = found;
  const data = normalizeIncidentData(i.data);
  const roster = await incidentRoster(event.id);
  const status = INCIDENT_STATUS[i.status] ?? INCIDENT_STATUS.draft;
  const due = i.status === "sent" ? null : dueState(i.dueOn, v.now.day);
  const missing = finalProblems({
    occurredOn: i.occurredOn,
    location: i.location ?? "",
    data,
    signed: Boolean(data.preparedBy.signature),
  });
  const tz = track?.timezone ?? v.tz;
  const region = data.region || v.org.shortName;

  return (
    <>
      <PageHeader
        title={i.driverName || "Incident report"}
        lede={`${event.name} · ${dayLong(i.occurredOn)}${i.location ? ` · ${i.location}` : ""}`}
        back={{ href: "/admin/incidents", label: "Incidents" }}
        actions={
          <ButtonLink
            href={`/admin/incidents/${i.id}/print`}
            variant="secondary"
          >
            <Printer className="size-4" /> Print or save as PDF
          </ButtonLink>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-6">
        <aside className="space-y-4 lg:order-2">
          <div className="space-y-4 lg:sticky lg:top-8">
            <Card className="px-4 py-4 sm:px-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="eyebrow text-ink-2">Status</h2>
                <Pill tone={status.tone}>{status.label}</Pill>
              </div>
              {due ? (
                <p
                  className={cn(
                    "mt-2 text-[15px] font-bold",
                    toneText[due.tone],
                  )}
                >
                  {due.label}
                </p>
              ) : (
                <p className="mt-2 text-[15px] font-bold text-good">
                  Sent to PCA {dateOnly(i.sentAt, tz)}
                </p>
              )}
              <p className="text-sm text-ink-2">
                Due {dayLong(i.dueOn)}:{" "}
                {i.hasInjury
                  ? "the next business day, because there is bodily injury."
                  : "five business days after the incident."}
              </p>
              {i.status === "draft" ? (
                missing.length ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-sm font-semibold">
                      Before it can be marked final, add:
                    </p>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-ink-2">
                      {missing.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-3 border-t border-line pt-3 text-sm font-semibold text-good">
                    Nothing required is missing. Mark it final when you have
                    checked it over.
                  </p>
                )
              ) : null}
            </Card>

            {i.status !== "draft" ? (
              <SendPanel
                status={i.status}
                sentLabel={i.sentAt ? dateTime(i.sentAt, tz) : null}
                recipients={v.org.settings.incidentRecipients ?? []}
                subject={`PCA Incident Report: ${region}, ${event.name}, ${dayLong(i.occurredOn)}`}
                body={`Attached is the PCA Incident Report (Driving Event) for an incident at ${event.name} on ${dayLong(i.occurredOn)}, with the signed waivers for the people named in it.\n\nSubmitted by ${data.preparedBy.name || "the event chair"}${data.preparedBy.title ? `, ${data.preparedBy.title}` : ""}, ${region}.`}
                printHref={`/admin/incidents/${i.id}/print`}
                markSent={markIncidentSent.bind(null, i.id)}
                unmarkSent={unmarkIncidentSent.bind(null, i.id)}
              />
            ) : null}

            {i.status === "draft" ? (
              <ActionButton
                action={deleteIncident.bind(null, i.id)}
                variant="ghost"
                size="sm"
                className="text-bad"
                confirm="Delete this draft? It cannot be recovered."
                successMessage={false}
              >
                <Trash2 className="size-4" /> Delete this draft
              </ActionButton>
            ) : null}
          </div>
        </aside>

        <div className="min-w-0">
          <IncidentForm
            id={i.id}
            status={i.status}
            initial={{
              occurredOn: i.occurredOn,
              occurredTime: i.occurredTime ?? "",
              location: i.location ?? "",
              criteria: i.criteria,
              driverUserId: i.driverUserId ?? "",
              summary: i.summary ?? "",
              data,
              sketch: i.sketch,
            }}
            roster={roster}
            locations={locationPicks(track?.turnCount)}
            shape={track?.guide.shape ?? null}
            signedAtLabel={
              data.preparedBy.signedAt
                ? dateTime(data.preparedBy.signedAt, tz)
                : null
            }
          />
        </div>
      </div>
    </>
  );
});
