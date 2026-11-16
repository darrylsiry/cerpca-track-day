"use client";

import { UserPlus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { Field } from "@/components/ui";
import { addCheckIn } from "./actions";

/** Put a solo driver on the pairing list so an instructor can check in on them. */
export function CheckInSheet({
  drivers,
}: {
  drivers: { id: string; label: string }[];
}) {
  return (
    <Sheet
      trigger={
        <>
          <UserPlus className="size-4" /> Add a check-in
        </>
      }
      title="Add a check-in"
      description="For a solo driver you would like an instructor to ride with at this event. They join the list below; pick their instructor there."
    >
      <ActionForm action={addCheckIn} className="space-y-4">
        <Field label="Driver">
          <select name="studentId" className="ctl" required defaultValue="">
            <option value="" disabled>
              Choose a solo driver
            </option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="What should the instructor look at?"
          optional
          hint="Only administrators and the instructor see this. The driver is told an instructor will check in with them, not why."
        >
          <textarea
            name="note"
            className="ctl min-h-24"
            maxLength={500}
            placeholder="e.g. First event in White. Watch traffic awareness in the longer passing zone."
          />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Adding…">
          Add to the pairing list
        </SubmitButton>
      </ActionForm>
    </Sheet>
  );
}
