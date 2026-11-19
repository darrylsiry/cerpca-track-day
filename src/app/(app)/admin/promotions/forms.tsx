"use client";

import { Check, TrendingUp, X } from "lucide-react";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { buttonClass, CheckRow, Field } from "@/components/ui";
import type { GroupLite } from "@/lib/types";
import { decidePromotion, promoteDirect } from "./actions";

export function DecideSheet({
  id,
  driver,
  what,
  approve,
  eventName,
}: {
  id: string;
  driver: string;
  what: string;
  approve: boolean;
  eventName: string | null;
}) {
  return (
    <Sheet
      trigger={
        approve ? (
          <>
            <Check className="size-4" strokeWidth={3} /> Approve
          </>
        ) : (
          <>
            <X className="size-4" strokeWidth={3} /> Decline
          </>
        )
      }
      triggerClassName={buttonClass(approve ? "primary" : "secondary")}
      title={approve ? "Approve" : "Decline"}
      description={`${driver}: ${what}.`}
    >
      <ActionForm action={decidePromotion} className="space-y-4">
        <input type="hidden" name="id" value={id} />
        <input
          type="hidden"
          name="decision"
          value={approve ? "approve" : "decline"}
        />
        <Field
          label={approve ? "Note" : "Reason"}
          optional={approve}
          hint={
            approve
              ? "Goes to the driver and the instructor, and into the driver's file."
              : "Goes to the instructor and into the driver's file. The driver is not notified of a decline."
          }
        >
          <textarea name="note" className="ctl min-h-24" required={!approve} />
        </Field>
        {approve ? (
          <CheckRow name="applyNow">
            <strong>Apply at {eventName ?? "the current event"} now.</strong>{" "}
            Otherwise it takes effect from the driver&apos;s next event.
          </CheckRow>
        ) : null}
        <SubmitButton
          variant={approve ? "primary" : "danger"}
          className="w-full"
          pendingLabel="Saving…"
        >
          {approve ? "Sign off" : "Decline recommendation"}
        </SubmitButton>
      </ActionForm>
    </Sheet>
  );
}

export function PromoteSheet({
  drivers,
  groups,
  eventName,
}: {
  drivers: {
    id: string;
    name: string;
    groupId: string | null;
    solo: boolean;
  }[];
  groups: GroupLite[];
  eventName: string | null;
}) {
  const [userId, setUserId] = useState("");
  const [kind, setKind] = useState("group");
  const driver = drivers.find((d) => d.id === userId);
  const current = groups.find((g) => g.id === driver?.groupId);
  return (
    <Sheet
      trigger={
        <>
          <TrendingUp className="size-4" /> Change a driver&apos;s group
        </>
      }
      title="Change a driver's group"
      description="For changes you are making yourself, without an instructor's recommendation. It is recorded in the driver's history with your name."
    >
      <ActionForm action={promoteDirect} className="space-y-4">
        <Field label="Driver">
          <select
            name="userId"
            className="ctl"
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="" disabled>
              Choose a driver
            </option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Change">
          <select
            name="kind"
            className="ctl"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="group">Move to another run group</option>
            {/* Nothing to sign off for a driver who is already solo, or whose group is solo by default. */}
            <option value="solo" disabled={driver?.solo || current?.instructorPolicy === "none"}>
              Sign off to drive solo
            </option>
          </select>
        </Field>
        {kind === "group" ? (
          <Field
            label="New run group"
            hint={current ? `Currently ${current.name}.` : undefined}
          >
            <select name="toGroupId" className="ctl" required defaultValue="">
              <option value="" disabled>
                Choose a run group
              </option>
              {groups
                .filter((g) => g.id !== driver?.groupId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </Field>
        ) : null}
        <Field label="Reason">
          <textarea
            name="rationale"
            className="ctl min-h-24"
            required
            minLength={20}
          />
        </Field>
        <CheckRow name="applyNow">
          <strong>Apply at {eventName ?? "the current event"} now.</strong>{" "}
          Otherwise it takes effect from their next event.
        </CheckRow>
        <SubmitButton className="w-full" pendingLabel="Saving…">
          Record the change
        </SubmitButton>
      </ActionForm>
    </Sheet>
  );
}
