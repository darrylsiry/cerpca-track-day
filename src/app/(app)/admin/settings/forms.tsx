"use client";

import { Pencil } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { Field } from "@/components/ui";
import type { OrgSettings } from "@/lib/types";
import { saveGroup, saveRegionSettings } from "./actions";

export type GroupValues = {
  id: string;
  name: string;
  summary: string;
  description: string;
  color: string;
  textColor: string;
  instructorPolicy: string;
  passingKey: string | null;
};

export function GroupSheet({
  group,
  sheets,
}: {
  group: GroupValues;
  sheets: { key: string; title: string }[];
}) {
  return (
    <Sheet
      trigger={<Pencil className="size-4" />}
      triggerLabel={`Edit ${group.name}`}
      triggerClassName="grid size-10 shrink-0 place-items-center rounded-[10px] hover:bg-sunk"
      title={`${group.name} run group`}
    >
      <ActionForm action={saveGroup} className="space-y-4">
        <input type="hidden" name="id" value={group.id} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input
              name="name"
              className="ctl"
              required
              defaultValue={group.name}
            />
          </Field>
          <Field label="Level" hint="One or two words.">
            <input
              name="summary"
              className="ctl"
              defaultValue={group.summary}
            />
          </Field>
        </div>
        <Field
          label="Who belongs here"
          hint="Shown to drivers on their profile."
        >
          <textarea
            name="description"
            className="ctl min-h-24"
            defaultValue={group.description}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Colour">
            <input
              type="color"
              name="color"
              className="ctl h-11 p-1"
              defaultValue={group.color}
            />
          </Field>
          <Field label="Text on that colour">
            <input
              type="color"
              name="textColor"
              className="ctl h-11 p-1"
              defaultValue={group.textColor}
            />
          </Field>
        </div>
        <Field
          label="Instructors"
          hint="A group that is instructed until solo has an Instructed and a Solo half, and a schedule slot can be for either."
        >
          <select
            name="instructorPolicy"
            className="ctl"
            defaultValue={group.instructorPolicy}
          >
            <option value="required">Always instructed</option>
            <option value="optional">
              Instructed until signed off solo (two halves)
            </option>
            <option value="none">Solo by default; instructor on request</option>
          </select>
        </Field>
        <Field
          label="Passing-zone sheet"
          hint="Which sheet from the track guide this group follows."
        >
          <select
            name="passingKey"
            className="ctl"
            defaultValue={group.passingKey ?? ""}
          >
            <option value="">None on file</option>
            {sheets.map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
              </option>
            ))}
          </select>
        </Field>
        <SubmitButton className="w-full">Save run group</SubmitButton>
      </ActionForm>
    </Sheet>
  );
}

export function RegionForm({
  org,
  settings,
}: {
  org: { name: string; shortName: string; website: string | null };
  settings: OrgSettings;
}) {
  // Always offer two spare rows so a recipient can be added without extra UI.
  const recipients = [
    ...settings.incidentRecipients,
    { role: "", email: "" },
    { role: "", email: "" },
  ];
  return (
    <ActionForm
      action={saveRegionSettings}
      closeOnSuccess={false}
      className="space-y-8"
    >
      <fieldset className="space-y-3">
        <legend className="eyebrow mb-1 text-ink-2">Region</legend>
        <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
          <Field label="Name">
            <input name="orgName" className="ctl" defaultValue={org.name} />
          </Field>
          <Field label="Short name">
            <input
              name="orgShort"
              className="ctl"
              defaultValue={org.shortName}
            />
          </Field>
        </div>
        <Field label="Website" optional>
          <input
            name="website"
            type="url"
            className="ctl"
            defaultValue={org.website ?? ""}
          />
        </Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-1 text-ink-2">Event chair</legend>
        <p className="text-sm text-ink-2">Prefilled on incident reports.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name">
            <input
              name="chairName"
              className="ctl"
              defaultValue={settings.eventChair?.name ?? ""}
            />
          </Field>
          <Field label="Phone">
            <input
              name="chairPhone"
              type="tel"
              className="ctl"
              defaultValue={settings.eventChair?.phone ?? ""}
            />
          </Field>
          <Field label="Email">
            <input
              name="chairEmail"
              type="email"
              className="ctl"
              defaultValue={settings.eventChair?.email ?? ""}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-1 text-ink-2">
          Incident report recipients
        </legend>
        <p className="text-sm text-ink-2">
          Who a PCA incident report is sent to. Confirm this list against the
          current Region Procedures Manual and your zone; the app never emails
          them on its own.
        </p>
        <div className="space-y-2">
          {recipients.map((r, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1.1fr_1fr_1.3fr]">
              <input
                name="recipientRole"
                className="ctl"
                defaultValue={r.role}
                placeholder="Role, e.g. Zone Representative"
                aria-label={`Recipient ${i + 1} role`}
              />
              <input
                name="recipientName"
                className="ctl"
                defaultValue={r.name ?? ""}
                placeholder="Name (optional)"
                aria-label={`Recipient ${i + 1} name`}
              />
              <input
                name="recipientEmail"
                type="email"
                className="ctl"
                defaultValue={r.email}
                placeholder="Email"
                aria-label={`Recipient ${i + 1} email`}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-1 text-ink-2">
          Tech inspection window
        </legend>
        <p className="text-sm text-ink-2">
          The shop inspection should happen inside this window before the first
          day. Forms outside it are flagged for the reviewer.
        </p>
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label="No earlier than (days before)">
            <input
              name="earliestDays"
              className="ctl timing"
              inputMode="numeric"
              defaultValue={settings.techWindow.earliestDays}
            />
          </Field>
          <Field label="No later than (days before)">
            <input
              name="latestDays"
              className="ctl timing"
              inputMode="numeric"
              defaultValue={settings.techWindow.latestDays}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-1 text-ink-2">Session reminders</legend>
        <Field
          label="Minutes before a session"
          hint="Each driver is alerted this many minutes before their run group's sessions and classes."
          className="max-w-md"
        >
          <input
            name="reminderOffsets"
            className="ctl timing"
            defaultValue={settings.reminderOffsets.join(", ")}
          />
        </Field>
      </fieldset>

      <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
    </ActionForm>
  );
}
