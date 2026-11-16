"use client";

import { ActionButton, ActionForm, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { Field } from "@/components/ui";
import { requestRideAlong, withdrawRideAlong } from "./actions";

/** A solo driver asks for an instructor in the right seat. */
export function AskForInstructorSheet() {
  return (
    <Sheet
      trigger="Ask for an instructor"
      title="Ask for an instructor"
      description="The administrators pair you with an instructor who is free during your sessions. You stay in your run group."
    >
      <ActionForm action={requestRideAlong} className="space-y-4">
        <Field label="What would you like to work on?" optional hint="Your instructor sees this before you meet.">
          <textarea name="note" className="ctl min-h-24" maxLength={500} placeholder="e.g. Braking into Turn 1, and a second opinion on my line through 4 and 5." />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Sending…">
          Send request
        </SubmitButton>
      </ActionForm>
    </Sheet>
  );
}

export function WithdrawRideAlongButton({ paired }: { paired: boolean }) {
  return (
    <ActionButton
      action={withdrawRideAlong}
      variant="ghost"
      size="sm"
      className="-ml-3 text-ink-2"
      confirm={paired ? "Withdraw your request? Your instructor will be told you no longer need a ride-along." : undefined}
    >
      Withdraw request
    </ActionButton>
  );
}
