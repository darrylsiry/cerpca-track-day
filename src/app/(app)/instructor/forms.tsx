"use client";

import { ClipboardPen, Lock, TrendingUp } from "lucide-react";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { buttonClass, Field, Notice } from "@/components/ui";
import { cn } from "@/lib/cn";
import { addPrivateNote, logSession, recommendPromotion } from "./actions";

export const FOCUS_AREAS = [
  "Vision",
  "Braking",
  "Turn-in",
  "Line",
  "Throttle",
  "Smooth inputs",
  "Mirrors",
  "Passing signals",
  "Flags",
  "Car control",
  "Consistency",
];

export type SessionOption = { id: string; label: string; past: boolean };

export function LogSessionSheet({
  studentId,
  studentName,
  sessions,
  defaultSessionId,
  compact,
}: {
  studentId: string;
  studentName: string;
  sessions: SessionOption[];
  defaultSessionId: string | null;
  compact?: boolean;
}) {
  const [focus, setFocus] = useState<string[]>([]);
  return (
    <Sheet
      trigger={
        <>
          <ClipboardPen className="size-4" /> Log a session
        </>
      }
      triggerClassName={buttonClass("primary", compact ? "sm" : "md")}
      title="Log a session"
      description={`Notes from a session with ${studentName}.`}
    >
      <ActionForm action={logSession} className="space-y-4">
        <input type="hidden" name="studentId" value={studentId} />
        <Field label="Session">
          <select
            name="scheduleItemId"
            className="ctl"
            defaultValue={defaultSessionId ?? ""}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {s.past ? "" : " (upcoming)"}
              </option>
            ))}
            <option value="">Other / not on the schedule</option>
          </select>
        </Field>
        <Field
          label={`Notes for ${studentName.split(" ")[0]}`}
          hint="Your student and the administrators can read this."
        >
          <textarea
            name="sharedNotes"
            className="ctl min-h-32"
            required
            placeholder="What went well, and what to work on next time out."
          />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">
            What you worked on
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {FOCUS_AREAS.map((f) => {
              const on = focus.includes(f);
              return (
                <label
                  key={f}
                  className={cn(
                    "flex h-9 cursor-pointer items-center rounded-full border px-3 text-sm font-semibold select-none",
                    on
                      ? "border-ink bg-ink text-white"
                      : "border-line-strong bg-surface text-ink-2",
                  )}
                >
                  <input
                    type="checkbox"
                    name="focus"
                    value={f}
                    checked={on}
                    onChange={() =>
                      setFocus((cur) =>
                        on ? cur.filter((x) => x !== f) : [...cur, f],
                      )
                    }
                    className="sr-only"
                  />
                  {f}
                </label>
              );
            })}
          </div>
        </fieldset>
        <Field
          optional
          label={
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3.5" /> Private note for administrators
            </span>
          }
          hint="Your student never sees this."
        >
          <textarea name="privateNotes" className="ctl min-h-20" />
        </Field>
        <SubmitButton className="w-full" pendingLabel="Saving…">
          Save session
        </SubmitButton>
      </ActionForm>
    </Sheet>
  );
}

export function PrivateNoteSheet({
  studentId,
  studentName,
  compact,
}: {
  studentId: string;
  studentName: string;
  compact?: boolean;
}) {
  return (
    <Sheet
      trigger={
        <>
          <Lock className="size-4" /> Private note
        </>
      }
      triggerClassName={buttonClass("secondary", compact ? "sm" : "md")}
      title="Private note"
      description={`About ${studentName}. Only administrators and you can read it.`}
    >
      <ActionForm action={addPrivateNote} className="space-y-4">
        <input type="hidden" name="studentId" value={studentId} />
        <Field label="Note">
          <textarea
            name="body"
            className="ctl min-h-32"
            required
            placeholder="Anything the Chief Driving Instructor should know that doesn't belong in the session notes."
          />
        </Field>
        <SubmitButton className="w-full">Save note</SubmitButton>
      </ActionForm>
    </Sheet>
  );
}

export function RecommendSheet({
  studentId,
  studentName,
  groupName,
  nextGroupName,
  canSolo,
  pending,
  compact,
}: {
  studentId: string;
  studentName: string;
  groupName: string;
  nextGroupName: string | null;
  canSolo: boolean;
  pending: boolean;
  compact?: boolean;
}) {
  const options = [
    ...(nextGroupName
      ? [
          {
            value: "group",
            label: `Promote to ${nextGroupName}`,
            detail: `Move up from ${groupName}.`,
          },
        ]
      : []),
    ...(canSolo
      ? [
          {
            value: "solo",
            label: "Sign off to drive solo",
            detail: `Stay in ${groupName}, without an instructor in the car.`,
          },
        ]
      : []),
  ];
  const [kind, setKind] = useState(options[0]?.value ?? "group");
  return (
    <Sheet
      trigger={
        <>
          <TrendingUp className="size-4" /> Recommend
        </>
      }
      triggerClassName={buttonClass("secondary", compact ? "sm" : "md")}
      title="Recommend for promotion"
      description={`${studentName} is in ${groupName}. An administrator signs off before anything changes.`}
    >
      {pending ? (
        <Notice
          tone="info"
          title="A recommendation is already waiting for sign-off"
        >
          You will get an alert when the Chief Driving Instructor decides.
        </Notice>
      ) : !options.length ? (
        <Notice tone="neutral">
          There is nothing to recommend: {studentName.split(" ")[0]} already
          drives solo in the highest student group.
        </Notice>
      ) : (
        <ActionForm action={recommendPromotion} className="space-y-4">
          <input type="hidden" name="studentId" value={studentId} />
          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-semibold">
              Recommendation
            </legend>
            {options.map((o) => (
              <label
                key={o.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[12px] border px-4 py-3",
                  kind === o.value ? "border-ink bg-paper" : "border-line",
                )}
              >
                <input
                  type="radio"
                  name="kind"
                  value={o.value}
                  checked={kind === o.value}
                  onChange={() => setKind(o.value)}
                  className="check mt-0.5"
                />
                <span>
                  <span className="block font-bold">{o.label}</span>
                  <span className="block text-sm text-ink-2">{o.detail}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field
            label="Your rationale"
            hint="Required. Say what you saw: consistency, awareness of traffic, point-bys, how they handle mistakes."
          >
            <textarea
              name="rationale"
              className="ctl min-h-36"
              required
              minLength={40}
            />
          </Field>
          <SubmitButton className="w-full" pendingLabel="Sending…">
            Send for sign-off
          </SubmitButton>
        </ActionForm>
      )}
    </Sheet>
  );
}
