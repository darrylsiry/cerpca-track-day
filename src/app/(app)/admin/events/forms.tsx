"use client";

import { Pencil, Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { buttonClass, Field } from "@/components/ui";
import { saveEvent } from "./actions";

export type EventValues = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  description: string | null;
  registrationUrl: string | null;
};

function EventForm({
  event,
  tracks,
  others,
}: {
  event?: EventValues;
  tracks: { id: string; name: string }[];
  others: { id: string; name: string }[];
}) {
  return (
    <ActionForm action={saveEvent} className="space-y-4">
      {event ? <input type="hidden" name="id" value={event.id} /> : null}
      <Field label="Name">
        <input
          name="name"
          className="ctl"
          required
          defaultValue={event?.name ?? ""}
          placeholder="e.g. Spring Driver Education"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First day">
          <input
            type="date"
            name="startDate"
            className="ctl"
            required
            defaultValue={event?.startDate ?? ""}
          />
        </Field>
        <Field label="Last day">
          <input
            type="date"
            name="endDate"
            className="ctl"
            required
            defaultValue={event?.endDate ?? ""}
          />
        </Field>
      </div>
      {!event ? (
        <>
          <Field label="Track">
            <select
              name="trackId"
              className="ctl"
              required
              defaultValue={tracks[0]?.id}
            >
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start from another event's schedule" optional>
            <select
              name="copyFromEventId"
              className="ctl"
              defaultValue={others[0]?.id ?? ""}
            >
              <option value="">Start with an empty schedule</option>
              {others.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}
      <Field
        label="Status"
        hint="Drivers only see published events. Mark an event completed once it is over to keep it as history."
      >
        <select
          name="status"
          className="ctl"
          defaultValue={event?.status ?? "draft"}
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="completed">Completed</option>
        </select>
      </Field>
      <Field
        label="Registration link"
        optional
        hint="Where people sign up and pay, e.g. the event's page on ClubRegistration.net."
      >
        <input
          name="registrationUrl"
          type="url"
          className="ctl"
          defaultValue={event?.registrationUrl ?? ""}
          placeholder="https://clubregistration.net/…"
        />
      </Field>
      <Field label="Description" optional>
        <textarea
          name="description"
          className="ctl min-h-20"
          defaultValue={event?.description ?? ""}
        />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Saving…">
        {event ? "Save event" : "Create event"}
      </SubmitButton>
    </ActionForm>
  );
}

export function NewEventSheet(props: {
  tracks: { id: string; name: string }[];
  others: { id: string; name: string }[];
}) {
  return (
    <Sheet
      trigger={
        <>
          <Plus className="size-4" /> New event
        </>
      }
      triggerClassName={buttonClass("primary")}
      title="New event"
      description="Creates a draft. Build the schedule and roster, then publish it."
    >
      <EventForm {...props} />
    </Sheet>
  );
}

export function EditEventSheet(props: {
  event: EventValues;
  tracks: { id: string; name: string }[];
  others: { id: string; name: string }[];
}) {
  return (
    <Sheet
      trigger={
        <>
          <Pencil className="size-4" /> Edit
        </>
      }
      triggerClassName={buttonClass("secondary", "sm")}
      title="Edit event"
    >
      <EventForm {...props} />
    </Sheet>
  );
}
