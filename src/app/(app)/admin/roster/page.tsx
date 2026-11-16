import type { Metadata } from "next";
import { screen } from "@/components/shell/skeleton";
import { EmptyState, PageHeader } from "@/components/ui";
import { weekday } from "@/lib/time";
import { getRosterView } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { eventDays, groupLite } from "@/server/queries";
import { RosterTable } from "./roster-table";

export const metadata: Metadata = { title: "Roster" };

export default screen(async function RosterPage() {
  const v = await requireAdmin();
  if (!v.event)
    return (
      <EmptyState title="No event yet">
        Create an event first, then add or import its roster.
      </EmptyState>
    );
  const { rows, waiversTotal } = await getRosterView(v.event.id, v.org.id);
  return (
    <>
      <PageHeader
        title="Roster"
        lede={`Everyone registered for ${v.event.name}: contact details, car, run group, paperwork and check-in.`}
      />
      <RosterTable
        rows={rows}
        groups={v.groups.map(groupLite)}
        waiversTotal={waiversTotal}
        dayLabels={eventDays(v.event).map(weekday)}
      />
    </>
  );
});
