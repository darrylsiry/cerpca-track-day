import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { screen } from "@/components/shell/skeleton";
import {
  ButtonLink,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  Pill,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  dueState,
  INCIDENT_CRITERIA,
  INCIDENT_RULE,
  INCIDENT_STATUS,
} from "@/lib/incident";
import {
  clock,
  dateOnly,
  dayLong,
  fromTimeInput,
  monthDay,
  weekdayShort,
} from "@/lib/time";
import { requireAdmin } from "@/server/auth";
import { listIncidents } from "@/server/incidents";

export const metadata: Metadata = { title: "Incidents" };

const toneText = {
  neutral: "text-ink-2",
  warn: "text-warn",
  bad: "text-bad",
} as const;

export default screen(async function IncidentsPage() {
  const v = await requireAdmin();
  const rows = await listIncidents(v.org.id);
  const today = v.now.day;
  const open = rows.filter((r) => r.incident.status !== "sent");

  // Newest first, grouped under the event each one was filed for.
  const groups: { eventId: string; eventName: string; items: typeof rows }[] =
    [];
  for (const row of rows) {
    let group = groups.find((g) => g.eventId === row.incident.eventId);
    if (!group)
      groups.push(
        (group = {
          eventId: row.incident.eventId,
          eventName: row.eventName,
          items: [],
        }),
      );
    group.items.push(row);
  }

  return (
    <>
      <PageHeader
        title="Incidents"
        lede="The PCA Incident Report for anything that meets the national reporting criteria: filled in here, printed or saved as a PDF, then emailed to PCA."
        actions={
          <ButtonLink href="/admin/incidents/new">
            <Plus className="size-4" /> Report an incident
          </ButtonLink>
        }
      />

      <Notice
        tone={open.length ? "warn" : "info"}
        title={
          open.length
            ? `${open.length} report${open.length === 1 ? "" : "s"} not yet sent to PCA`
            : "When reports are due"
        }
      >
        {INCIDENT_RULE}
      </Notice>

      <details className="mt-3 rounded-[14px] border border-line bg-surface">
        <summary className="flex min-h-12 cursor-pointer items-center px-4 text-[15px] font-semibold sm:px-5">
          When PCA requires a report
        </summary>
        <ul className="space-y-3 border-t border-line px-4 py-4 sm:px-5">
          {INCIDENT_CRITERIA.map((c) => (
            <li key={c.key}>
              <p className="text-[15px] font-semibold">{c.label}</p>
              <p className="text-sm text-ink-2">{c.help}</p>
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-6 space-y-6">
        {!rows.length ? (
          <EmptyState
            title="No incidents on record"
            action={
              <ButtonLink href="/admin/incidents/new">
                Report an incident
              </ButtonLink>
            }
          >
            If something happens that meets the criteria above, start the report
            here while the details are fresh. You can save it as a draft and
            finish it later.
          </EmptyState>
        ) : null}

        {groups.map((group) => (
          <section key={group.eventId}>
            <h2 className="eyebrow mb-2.5 text-ink-2">
              {group.eventName}
              {group.eventId === v.event?.id ? " · event in focus" : ""}
            </h2>
            <Card>
              <ul className="divide-y divide-line">
                {group.items.map(({ incident: i }) => {
                  const status =
                    INCIDENT_STATUS[i.status] ?? INCIDENT_STATUS.draft;
                  const due =
                    i.status === "sent" ? null : dueState(i.dueOn, today);
                  const time = i.occurredTime
                    ? fromTimeInput(i.occurredTime)
                    : null;
                  return (
                    <li key={i.id}>
                      <Link
                        href={`/admin/incidents/${i.id}`}
                        className="flex items-start gap-3 px-4 py-3.5 hover:bg-paper sm:px-5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-base font-bold">
                              {i.driverName || "Driver not recorded"}
                            </span>
                            <Pill tone={status.tone}>{status.label}</Pill>
                            {i.hasInjury ? (
                              <Pill tone="bad">Bodily injury</Pill>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-sm text-ink-2">
                            {weekdayShort(i.occurredOn)}{" "}
                            {monthDay(i.occurredOn)}
                            {time !== null ? ` · ${clock(time)}` : ""}
                            {i.location ? ` · ${i.location}` : ""}
                          </p>
                          {i.summary ? (
                            <p className="mt-1 line-clamp-2 text-[15px]">
                              {i.summary}
                            </p>
                          ) : null}
                          <p
                            className={cn(
                              "mt-1.5 text-[13px] font-semibold",
                              due ? toneText[due.tone] : "text-good",
                            )}
                          >
                            {due
                              ? `${due.label} · ${dayLong(i.dueOn)}`
                              : `Sent to PCA ${dateOnly(i.sentAt, v.tz)}`}
                          </p>
                        </div>
                        <ChevronRight className="mt-1 size-4 shrink-0 text-ink-3" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    </>
  );
});
