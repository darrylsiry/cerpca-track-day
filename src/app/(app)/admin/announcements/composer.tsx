"use client";

import { Send } from "lucide-react";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Card, CheckRow, Field } from "@/components/ui";
import { cn, plural } from "@/lib/cn";
import type { GroupLite } from "@/lib/types";
import { sendAnnouncement } from "./actions";

type Counts = {
  all: number;
  instructors: number;
  students: number;
  admins: number;
  byGroup: Record<string, number>;
};

export function Composer({
  groups,
  counts,
  channels,
}: {
  groups: GroupLite[];
  counts: Counts;
  channels: { email: boolean; sms: boolean; push: boolean };
}) {
  const [audience, setAudience] = useState("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [key, setKey] = useState(0);
  const recipients =
    audience === "groups"
      ? picked.reduce((n, g) => n + (counts.byGroup[g] ?? 0), 0)
      : (counts[audience as "all" | "instructors" | "students" | "admins"] ??
        0);

  const audiences = [
    { value: "all", label: "Everyone", n: counts.all },
    { value: "groups", label: "Run groups" },
    { value: "instructors", label: "Instructors", n: counts.instructors },
    {
      value: "students",
      label: "Students with an instructor",
      n: counts.students,
    },
    { value: "admins", label: "Administrators", n: counts.admins },
  ];

  return (
    <Card className="px-4 py-4 sm:px-5 sm:py-5">
      <ActionForm
        key={key}
        action={sendAnnouncement}
        closeOnSuccess={false}
        onSuccess={() => {
          setPicked([]);
          setAudience("all");
          setKey((k) => k + 1);
        }}
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Send this to ${plural(recipients, "person", "people")}?`,
            )
          )
            e.preventDefault();
        }}
        className="space-y-4"
      >
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">
            Who it is for
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {audiences.map((a) => (
              <label
                key={a.value}
                className={cn(
                  "flex h-10 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold select-none",
                  audience === a.value
                    ? "border-ink bg-ink text-white"
                    : "border-line-strong bg-surface text-ink-2",
                )}
              >
                <input
                  type="radio"
                  name="audience"
                  value={a.value}
                  checked={audience === a.value}
                  onChange={() => setAudience(a.value)}
                  className="sr-only"
                />
                {a.label}
                {a.n !== undefined ? (
                  <span
                    className={cn(
                      "timing rounded-full px-1.5 text-[11px]",
                      audience === a.value ? "bg-white/20" : "bg-sunk",
                    )}
                  >
                    {a.n}
                  </span>
                ) : null}
              </label>
            ))}
          </div>
          {audience === "groups" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {groups.map((g) => {
                const on = picked.includes(g.id);
                return (
                  <label
                    key={g.id}
                    style={
                      on
                        ? { background: g.color, color: g.textColor }
                        : undefined
                    }
                    className={cn(
                      "flex h-11 cursor-pointer items-center gap-2 rounded-[10px] border-2 px-4 font-display text-lg font-extrabold tracking-wide uppercase select-none",
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
                    <span className="timing text-xs font-bold opacity-75">
                      {counts.byGroup[g.id] ?? 0}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}
        </fieldset>

        <Field label="Title">
          <input
            name="title"
            className="ctl"
            required
            maxLength={80}
            placeholder="e.g. Lunch moved to 12:15"
          />
        </Field>
        <Field label="Message">
          <textarea
            name="body"
            className="ctl min-h-28"
            required
            maxLength={600}
            placeholder="Say what is happening and what people need to do."
          />
        </Field>

        <fieldset>
          <legend className="mb-1 text-sm font-semibold">How to send it</legend>
          <p className="mb-1.5 text-[13px] text-ink-2">
            Always appears in the app. People only get email, texts or push if
            they left those turned on in their profile.
          </p>
          <div className="grid gap-x-6 sm:grid-cols-3">
            <CheckRow name="push" defaultChecked>
              Push notification
              {channels.push ? "" : " (not configured: logged only)"}
            </CheckRow>
            <CheckRow name="sms">
              Text message{channels.sms ? "" : " (not configured: logged only)"}
            </CheckRow>
            <CheckRow name="email">
              Email{channels.email ? "" : " (not configured: logged only)"}
            </CheckRow>
          </div>
        </fieldset>

        <CheckRow name="urgent">
          <strong>Urgent.</strong> Highlighted in yellow at the top of
          everyone&apos;s Now screen.
        </CheckRow>

        <SubmitButton
          className="w-full sm:w-auto"
          pendingLabel="Sending…"
          disabled={!recipients}
        >
          <Send className="size-4" /> Send to{" "}
          {plural(recipients, "person", "people")}
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}
