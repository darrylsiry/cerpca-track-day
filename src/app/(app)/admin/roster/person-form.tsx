"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { CheckRow, Field } from "@/components/ui";
import type { GroupLite } from "@/lib/types";
import { savePerson } from "./actions";

export type PersonValues = {
  userId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  pcaMemberNumber?: string | null;
  tshirtSize?: string | null;
  experience?: string | null;
  groupId?: string;
  year?: number | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  carNumber?: string | null;
  days?: "both" | "day1" | "day2";
  isInstructor?: boolean;
  solo?: boolean;
  status?: string;
};

const SHIRTS = ["", "XS", "S", "M", "L", "XL", "2XL", "3XL"];

export function PersonForm({
  groups,
  dayLabels,
  values = {},
}: {
  groups: GroupLite[];
  dayLabels: string[];
  values?: PersonValues;
}) {
  const v = values;
  const editing = Boolean(v.userId);
  return (
    <ActionForm action={savePerson} className="space-y-6">
      {v.userId ? <input type="hidden" name="userId" value={v.userId} /> : null}

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-1 text-ink-2">Person</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input
              name="firstName"
              className="ctl"
              required
              defaultValue={v.firstName ?? ""}
              autoComplete="off"
            />
          </Field>
          <Field label="Last name">
            <input
              name="lastName"
              className="ctl"
              required
              defaultValue={v.lastName ?? ""}
              autoComplete="off"
            />
          </Field>
        </div>
        <Field label="Email" hint="They sign in with this address.">
          <input
            name="email"
            type="email"
            className="ctl"
            required
            defaultValue={v.email ?? ""}
            autoComplete="off"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mobile phone" optional>
            <input
              name="phone"
              type="tel"
              className="ctl"
              defaultValue={v.phone ?? ""}
              autoComplete="off"
            />
          </Field>
          <Field label="T-shirt size" optional>
            <select
              name="tshirtSize"
              className="ctl"
              defaultValue={v.tshirtSize ?? ""}
            >
              {SHIRTS.map((x) => (
                <option key={x} value={x}>
                  {x || "Not chosen"}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Street address" optional>
          <input
            name="address1"
            className="ctl"
            defaultValue={v.address1 ?? ""}
            autoComplete="off"
          />
        </Field>
        <div className="grid grid-cols-[1fr_5rem_6.5rem] gap-3">
          <Field label="City" optional>
            <input
              name="city"
              className="ctl"
              defaultValue={v.city ?? ""}
              autoComplete="off"
            />
          </Field>
          <Field label="State">
            <input
              name="state"
              className="ctl"
              maxLength={2}
              defaultValue={v.state ?? ""}
              autoComplete="off"
            />
          </Field>
          <Field label="ZIP">
            <input
              name="zip"
              className="ctl"
              inputMode="numeric"
              defaultValue={v.zip ?? ""}
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Emergency contact" optional>
            <input
              name="emergencyName"
              className="ctl"
              defaultValue={v.emergencyName ?? ""}
              autoComplete="off"
            />
          </Field>
          <Field label="Their phone" optional>
            <input
              name="emergencyPhone"
              type="tel"
              className="ctl"
              defaultValue={v.emergencyPhone ?? ""}
              autoComplete="off"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="PCA member number" optional>
            <input
              name="pcaMemberNumber"
              className="ctl"
              defaultValue={v.pcaMemberNumber ?? ""}
              autoComplete="off"
            />
          </Field>
          <Field label="Experience" optional>
            <input
              name="experience"
              className="ctl"
              placeholder="e.g. 4 track days"
              defaultValue={v.experience ?? ""}
              autoComplete="off"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-1 text-ink-2">This event</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Run group">
            <select
              name="groupId"
              className="ctl"
              required
              defaultValue={v.groupId ?? groups[0]?.id}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Attending">
            <select name="days" className="ctl" defaultValue={v.days ?? "both"}>
              <option value="both">Both days</option>
              <option value="day1">{dayLabels[0] ?? "Day 1"} only</option>
              <option value="day2">{dayLabels[1] ?? "Day 2"} only</option>
            </select>
          </Field>
        </div>
        {editing ? (
          <Field label="Registration status">
            <select
              name="status"
              className="ctl"
              defaultValue={v.status ?? "confirmed"}
            >
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
              <option value="waitlist">Wait list</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
        ) : null}
        <CheckRow name="solo" defaultChecked={v.solo}>
          Signed off to drive solo
        </CheckRow>
        <CheckRow name="isInstructor" defaultChecked={v.isInstructor}>
          Instructing at this event
        </CheckRow>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="eyebrow mb-1 text-ink-2">Car</legend>
        <div className="grid grid-cols-[5.5rem_1fr] gap-3">
          <Field label="Year">
            <input
              name="year"
              className="ctl"
              inputMode="numeric"
              maxLength={4}
              defaultValue={v.year ?? ""}
              autoComplete="off"
            />
          </Field>
          <Field label="Make">
            <input
              name="make"
              className="ctl"
              defaultValue={v.make ?? ""}
              placeholder="Porsche"
              autoComplete="off"
            />
          </Field>
        </div>
        <Field label="Model">
          <input
            name="model"
            className="ctl"
            defaultValue={v.model ?? ""}
            autoComplete="off"
          />
        </Field>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Color" optional>
            <input
              name="color"
              className="ctl"
              defaultValue={v.color ?? ""}
              autoComplete="off"
            />
          </Field>
          <Field label="Car number">
            <input
              name="carNumber"
              className="ctl timing"
              maxLength={4}
              defaultValue={v.carNumber ?? ""}
              autoComplete="off"
            />
          </Field>
        </div>
      </fieldset>

      <SubmitButton className="w-full" pendingLabel="Saving…">
        {editing ? "Save changes" : "Add to roster"}
      </SubmitButton>
    </ActionForm>
  );
}
