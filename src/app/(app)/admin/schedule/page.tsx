import type { Metadata } from "next";
import { ActionButton } from "@/components/form";
import {
  GroupBar,
  ItemGroups,
  KIND,
  KindIcon,
} from "@/components/schedule-bits";
import { screen } from "@/components/shell/skeleton";
import {
  EmptyState,
  Notice,
  PageHeader,
  Pill,
  Segmented,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { dayItems, phaseOf } from "@/lib/schedule";
import { clock, dateRange, monthDay, toTimeInput, weekday } from "@/lib/time";
import { orgEvents } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { eventDays, getSchedule, groupLite } from "@/server/queries";
import { setCancelled } from "./actions";
import { AddItemSheet, CopySheet, EditItemSheet, ShiftSheet } from "./forms";

export const metadata: Metadata = { title: "Schedule editor" };

const AUDIENCE: Record<string, string> = {
  all: "Every driver",
  instructors: "Instructors",
  none: "No reminders",
  groups: "",
};

export default screen(async function AdminSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const sp = await searchParams;
  const v = await requireAdmin();
  if (!v.event)
    return (
      <EmptyState title="No event yet">
        Create an event first, then build its schedule.
      </EmptyState>
    );
  const days = eventDays(v.event);
  const day =
    sp.day && days.includes(sp.day)
      ? sp.day
      : days.includes(v.now.day)
        ? v.now.day
        : days[0];
  const [items, events] = await Promise.all([
    getSchedule(v.event.id),
    orgEvents(v.org.id),
  ]);
  const groups = v.groups.map(groupLite);
  const today = dayItems(items, day);
  const published = v.event.status === "published";
  const others = events.filter((e) => e.id !== v.event!.id).reverse();

  return (
    <>
      <PageHeader
        title="Schedule editor"
        lede="Changes reach every open app within about 20 seconds. Reminders go out 15, 10 and 5 minutes before each session to the run groups in it."
        actions={
          <>
            <AddItemSheet
              days={days}
              day={day}
              groups={groups}
              published={published}
            />
            <ShiftSheet
              days={days}
              day={day}
              nowTime={
                days.includes(v.now.day) ? toTimeInput(v.now.minutes) : "08:00"
              }
            />
            <CopySheet
              events={others.map((e) => ({
                id: e.id,
                name: e.name,
                dates: dateRange(e.startDate, e.endDate),
              }))}
              hasItems={items.length > 0}
            />
          </>
        }
      />

      {!published ? (
        <Notice
          tone="warn"
          className="mb-4"
          title={
            v.event.status === "draft"
              ? "This event is a draft"
              : "This event is finished"
          }
        >
          {v.event.status === "draft"
            ? "Drivers cannot see it until you publish the event under Events and history."
            : "You are editing the record of a past event."}
        </Notice>
      ) : null}

      <Segmented
        label="Day"
        current={day}
        items={days.map((d) => ({
          key: d,
          href: `/admin/schedule?day=${d}`,
          label: `${weekday(d)} ${monthDay(d)}`,
          count: dayItems(items, d).length,
        }))}
      />

      {!today.length ? (
        <div className="mt-4">
          <EmptyState title={`Nothing scheduled for ${weekday(day)}`}>
            Add items one at a time, or copy the schedule from an earlier event.
          </EmptyState>
        </div>
      ) : (
        <ol className="mt-4 divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
          {today.map((item) => {
            const phase = phaseOf(item, v.now);
            return (
              <li
                key={item.id}
                className={cn(
                  // On a phone the actions drop to their own line so the title keeps its width.
                  "flex flex-wrap items-stretch gap-x-3 px-3 py-2.5 sm:flex-nowrap sm:px-4",
                  phase === "now" && !item.cancelled && "bg-good-soft/50",
                  item.cancelled && "bg-paper",
                )}
              >
                <div
                  className={cn(
                    "timing w-24 shrink-0 pt-0.5 text-right text-[15px] leading-tight font-semibold whitespace-nowrap",
                    (phase === "past" || item.cancelled) && "text-ink-3",
                  )}
                >
                  {clock(item.startMin)}
                  <span className="block text-[13px] font-normal text-ink-3">
                    to {clock(item.endMin)}
                  </span>
                </div>
                <GroupBar item={item} groups={groups} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        "font-bold",
                        item.cancelled && "text-ink-3 line-through",
                      )}
                    >
                      {item.title}
                    </span>
                    <ItemGroups item={item} groups={groups} />
                    {item.cancelled ? (
                      <Pill tone="bad">Cancelled</Pill>
                    ) : phase === "now" ? (
                      <Pill tone="good">Now</Pill>
                    ) : null}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-ink-2">
                    <KindIcon kind={item.kind} className="size-3.5" />
                    {KIND[item.kind]?.label}
                    {AUDIENCE[item.audience]
                      ? ` · ${AUDIENCE[item.audience]}`
                      : ""}
                    {item.location ? ` · ${item.location}` : ""}
                  </p>
                  {item.note ? (
                    <p className="mt-0.5 text-[13px] text-ink-3">{item.note}</p>
                  ) : null}
                </div>
                <div className="flex w-full shrink-0 items-center justify-end gap-0.5 sm:w-auto">
                  <ActionButton
                    action={setCancelled.bind(null, item.id, !item.cancelled)}
                    confirm={
                      item.cancelled
                        ? undefined
                        : `Cancel “${item.title}” at ${clock(item.startMin)}? Everyone in it is alerted straight away.`
                    }
                    variant="ghost"
                    size="sm"
                    successMessage={false}
                    className="text-ink-2"
                  >
                    {item.cancelled ? "Restore" : "Cancel"}
                  </ActionButton>
                  <EditItemSheet
                    item={item}
                    days={days}
                    day={day}
                    groups={groups}
                    published={published}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
});
