import type { Metadata } from "next";
import { ClockProvider } from "@/components/clock";
import { screen } from "@/components/shell/skeleton";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { dateRange } from "@/lib/time";
import { clockProps, getViewer } from "@/server/auth";
import { eventDays, getAssignments, getSchedule, groupLite, viewerLens } from "@/server/queries";
import { ScheduleView } from "./schedule-view";

export const metadata: Metadata = { title: "Schedule" };

export default screen(async function SchedulePage({ searchParams }: { searchParams: Promise<{ day?: string; show?: string }> }) {
  const v = await getViewer();
  const sp = await searchParams;
  if (!v.event) {
    return (
      <>
        <PageHeader title="Schedule" />
        <EmptyState title="No event is scheduled yet" action={v.isAdmin ? <ButtonLink href="/admin/events">Create an event</ButtonLink> : undefined}>
          When the region publishes its next track day, the full schedule will appear here.
        </EmptyState>
      </>
    );
  }
  const event = v.event;
  const [items, assignments] = await Promise.all([getSchedule(event.id), getAssignments(event.id, v.user.id)]);
  const days = eventDays(event);
  const groups = v.groups.map(groupLite);

  return (
    <>
      <PageHeader
        title="Schedule"
        lede={`${event.name} · ${dateRange(event.startDate, event.endDate)}${v.track ? ` · ${v.track.shortName}` : ""}. Times can change during the day; this page updates on its own.`}
        actions={v.isAdmin ? <ButtonLink href="/admin/schedule" variant="secondary">Edit schedule</ButtonLink> : undefined}
      />
      {items.length ? (
        <ClockProvider {...clockProps(v)}>
          <ScheduleView
            items={items}
            groups={groups}
            days={days}
            // Instructors see their students' sessions marked too, labelled with the student's first name.
            lens={viewerLens(v, assignments.students)}
            registered={Boolean(v.registration)}
            initialDay={sp.day && days.includes(sp.day) ? sp.day : null}
            initialShow={sp.show ?? null}
          />
        </ClockProvider>
      ) : (
        <EmptyState title="The schedule has not been posted yet">You will get an alert when the organizers publish it.</EmptyState>
      )}
    </>
  );
});
