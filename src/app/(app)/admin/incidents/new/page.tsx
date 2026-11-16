import type { Metadata } from "next";
import { screen } from "@/components/shell/skeleton";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { INCIDENT_RULE, locationPicks } from "@/lib/incident";
import { toTimeInput } from "@/lib/time";
import { requireAdmin } from "@/server/auth";
import { incidentRoster, prefilledIncident } from "@/server/incidents";
import { eventDays } from "@/server/queries";
import { IncidentForm } from "../incident-form";

export const metadata: Metadata = { title: "Report an incident" };

export default screen(async function NewIncidentPage() {
  const v = await requireAdmin();
  if (!v.event) {
    return (
      <EmptyState
        title="There is no event to file a report under"
        action={<ButtonLink href="/admin/events">Go to events</ButtonLink>}
      >
        Incident reports belong to an event. Create or select the event first.
      </EmptyState>
    );
  }
  const roster = await incidentRoster(v.event.id);
  const days = eventDays(v.event);
  const onEventDay = days.includes(v.now.day);
  // Default to "just now" during the event, otherwise to the nearest event day.
  const occurredOn = onEventDay
    ? v.now.day
    : v.now.day > v.event.endDate
      ? v.event.endDate
      : v.event.startDate;

  return (
    <>
      <PageHeader
        title="Report an incident"
        lede={`Filed under ${v.event.name}. Capture what you know now and save it as a draft; you can finish the rest later.`}
        back={{ href: "/admin/incidents", label: "Incidents" }}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-6">
        <aside className="space-y-4 lg:order-2">
          <Card className="px-4 py-4 sm:px-5 lg:sticky lg:top-8">
            <h2 className="eyebrow text-ink-2">How this works</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px]">
              <li>
                Fill in the form. It follows the PCA paper form, item for item.
              </li>
              <li>Mark it final once nothing required is missing.</li>
              <li>
                Print it or save it as a PDF, and email it to the PCA
                recipients.
              </li>
              <li>Record it as sent, so the due date stops counting.</li>
            </ol>
            <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">
              {INCIDENT_RULE}
            </p>
          </Card>
        </aside>
        <div className="min-w-0">
          <IncidentForm
            id={null}
            status="draft"
            initial={{
              occurredOn,
              occurredTime: onEventDay ? toTimeInput(v.now.minutes) : "",
              location: "",
              criteria: [],
              driverUserId: "",
              summary: "",
              data: prefilledIncident(v, v.track),
              sketch: null,
            }}
            roster={roster}
            locations={locationPicks(v.track?.turnCount)}
            shape={v.track?.guide.shape ?? null}
            signedAtLabel={null}
          />
        </div>
      </div>
    </>
  );
});
