"use client";

import { Clock4, Copy, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { ActionButton, ActionForm, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { buttonClass, CheckRow, Field } from "@/components/ui";
import { cn } from "@/lib/cn";
import { toTimeInput, weekday } from "@/lib/time";
import type { GroupLite, GroupPart, ScheduleEntry } from "@/lib/types";
import { copySchedule, deleteItem, saveItem, shiftSchedule } from "./actions";

const KINDS = [
  { value: "track", label: "On track" },
  { value: "classroom", label: "Classroom" },
  { value: "meeting", label: "Meeting" },
  { value: "break", label: "Break" },
  { value: "other", label: "Information" },
];

function ItemForm({
  item,
  days,
  day,
  groups,
  published,
}: {
  item?: ScheduleEntry;
  days: string[];
  day: string;
  groups: GroupLite[];
  published: boolean;
}) {
  const [audience, setAudience] = useState(item?.audience ?? "groups");
  const [picked, setPicked] = useState<string[]>(item?.groupIds ?? []);
  const [parts, setParts] = useState<Record<string, GroupPart>>(
    item?.groupParts ?? {},
  );
  const splitPicked = groups.filter((g) => g.split && picked.includes(g.id));
  return (
    <ActionForm action={saveItem} className="space-y-4">
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <select
            name="kind"
            className="ctl"
            defaultValue={item?.kind ?? "track"}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Day">
          <select name="day" className="ctl" defaultValue={item?.day ?? day}>
            {days.map((d) => (
              <option key={d} value={d}>
                {weekday(d)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">
          <input
            type="time"
            name="start"
            className="ctl timing"
            required
            defaultValue={item ? toTimeInput(item.startMin) : ""}
          />
        </Field>
        <Field label="Ends">
          <input
            type="time"
            name="end"
            className="ctl timing"
            required
            defaultValue={item ? toTimeInput(item.endMin) : ""}
          />
        </Field>
      </div>
      <Field
        label="Who it is for"
        hint="Decides whose schedule it appears on and who gets the 15, 10 and 5 minute reminders."
      >
        <select
          name="audience"
          className="ctl"
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
        >
          <option value="groups">Run groups</option>
          <option value="all">Every driver</option>
          <option value="instructors">Instructors</option>
          <option value="none">Information only, no reminders</option>
        </select>
      </Field>
      {audience === "groups" ? (
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Run groups</legend>
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const on = picked.includes(g.id);
              return (
                <label
                  key={g.id}
                  style={
                    on ? { background: g.color, color: g.textColor } : undefined
                  }
                  className={cn(
                    "flex h-11 cursor-pointer items-center rounded-[10px] border-2 px-4 font-display text-lg font-extrabold tracking-wide uppercase select-none",
                    on
                      ? "border-ink"
                      : "border-line-strong bg-surface text-ink-2",
                  )}
                >
                  <input
                    type="checkbox"
                    name="groupIds"
                    value={g.id}
                    checked={on}
                    onChange={() =>
                      setPicked((cur) =>
                        on ? cur.filter((x) => x !== g.id) : [...cur, g.id],
                      )
                    }
                    className="sr-only"
                  />
                  {g.name}
                </label>
              );
            })}
          </div>
          {splitPicked.map((g) => (
            <label key={g.id} className="mt-3 block">
              <span className="mb-1.5 block text-sm font-semibold">
                Which {g.name} drivers
              </span>
              <select
                name={`part:${g.id}`}
                className="ctl"
                value={parts[g.id] ?? ""}
                onChange={(e) => {
                  const next = e.target.value;
                  setParts((cur) => {
                    const rest = { ...cur };
                    delete rest[g.id];
                    return next === "instructed" || next === "solo"
                      ? { ...rest, [g.id]: next }
                      : rest;
                  });
                }}
              >
                <option value="">Everyone in {g.name}</option>
                <option value="instructed">
                  {g.name} Instructed only: drivers riding with an instructor
                </option>
                <option value="solo">
                  {g.name} Solo only: drivers signed off solo
                </option>
              </select>
            </label>
          ))}
        </fieldset>
      ) : null}
      <Field
        label="Title"
        hint={
          audience === "groups"
            ? "Leave empty to use the run group names."
            : undefined
        }
        optional={audience === "groups"}
      >
        <input
          name="title"
          className="ctl"
          defaultValue={item?.title ?? ""}
          placeholder={
            audience === "groups"
              ? "e.g. Green orientation laps"
              : "e.g. Drivers meeting"
          }
        />
      </Field>
      <Field label="Location" optional>
        <input
          name="location"
          className="ctl"
          defaultValue={item?.location ?? ""}
          placeholder="e.g. Student classroom"
        />
      </Field>
      <Field label="Note" optional>
        <input name="note" className="ctl" defaultValue={item?.note ?? ""} />
      </Field>
      <CheckRow name="notify" defaultChecked={published && Boolean(item)}>
        Send an alert about this change to the people it affects
      </CheckRow>
      <div className="flex gap-2">
        <SubmitButton className="flex-1" pendingLabel="Saving…">
          {item ? "Save changes" : "Add to schedule"}
        </SubmitButton>
        {item ? (
          <ActionButton
            action={deleteItem.bind(null, item.id)}
            confirm={`Remove “${item.title}” from the schedule? Use Cancel instead if drivers should be told it is off.`}
            variant="ghost"
            className="text-bad"
          >
            Delete
          </ActionButton>
        ) : null}
      </div>
    </ActionForm>
  );
}

export function AddItemSheet(props: {
  days: string[];
  day: string;
  groups: GroupLite[];
  published: boolean;
}) {
  return (
    <Sheet
      trigger={
        <>
          <Plus className="size-4" /> Add item
        </>
      }
      triggerClassName={buttonClass("primary")}
      title="Add to the schedule"
    >
      <ItemForm {...props} />
    </Sheet>
  );
}

export function EditItemSheet(props: {
  item: ScheduleEntry;
  days: string[];
  day: string;
  groups: GroupLite[];
  published: boolean;
}) {
  return (
    <Sheet
      trigger={<Pencil className="size-4" />}
      triggerLabel={`Edit ${props.item.title}`}
      triggerClassName="grid size-10 shrink-0 place-items-center rounded-[10px] hover:bg-sunk"
      title="Edit schedule item"
    >
      <ItemForm {...props} />
    </Sheet>
  );
}

export function ShiftSheet({
  days,
  day,
  nowTime,
}: {
  days: string[];
  day: string;
  nowTime: string;
}) {
  return (
    <Sheet
      trigger={
        <>
          <Clock4 className="size-4" /> Delay or advance
        </>
      }
      title="Delay or advance the day"
      description="For weather holds, a late start or a long clean-up. Moves every item that starts at or after the time you choose."
    >
      <ActionForm action={shiftSchedule} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day">
            <select name="day" className="ctl" defaultValue={day}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {weekday(d)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Starting from">
            <input
              type="time"
              name="from"
              className="ctl timing"
              required
              defaultValue={nowTime}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Move by (minutes)">
            <input
              name="minutes"
              className="ctl timing"
              inputMode="numeric"
              required
              defaultValue="15"
            />
          </Field>
          <Field label="Direction">
            <select name="direction" className="ctl" defaultValue="later">
              <option value="later">Later</option>
              <option value="earlier">Earlier</option>
            </select>
          </Field>
        </div>
        <Field
          label="Reason"
          optional
          hint="Added to the alert, e.g. “Track is being dried after the shower.”"
        >
          <input name="reason" className="ctl" />
        </Field>
        <CheckRow name="notify" defaultChecked>
          Announce the change to everyone
        </CheckRow>
        <SubmitButton className="w-full" pendingLabel="Moving…">
          Move the schedule
        </SubmitButton>
      </ActionForm>
    </Sheet>
  );
}

export function CopySheet({
  events,
  hasItems,
}: {
  events: { id: string; name: string; dates: string }[];
  hasItems: boolean;
}) {
  return (
    <Sheet
      trigger={
        <>
          <Copy className="size-4" /> Copy from an event
        </>
      }
      title="Copy a schedule"
      description="Start from another event's schedule instead of building this one from scratch. Days line up first to first."
    >
      <ActionForm action={copySchedule} className="space-y-4">
        <Field label="Copy from">
          <select name="fromEventId" className="ctl" required defaultValue="">
            <option value="" disabled>
              Choose an event
            </option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.dates})
              </option>
            ))}
          </select>
        </Field>
        {hasItems ? (
          <CheckRow name="replace">Replace the current schedule</CheckRow>
        ) : null}
        <SubmitButton className="w-full" pendingLabel="Copying…">
          Copy schedule
        </SubmitButton>
      </ActionForm>
    </Sheet>
  );
}
