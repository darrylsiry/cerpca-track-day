"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "@/components/toast";
import { cn } from "@/lib/cn";
import { assignInstructor } from "./actions";

export type InstructorOption = {
  id: string;
  name: string;
  load: number;
  clash: boolean;
};

/** Picking a name pairs the student straight away; both people get an alert. */
export function AssignSelect({
  studentId,
  studentName,
  value,
  options,
}: {
  studentId: string;
  studentName: string;
  value: string;
  options: InstructorOption[];
}) {
  const [optimistic, setOptimistic] = useOptimistic(value);
  const [pending, start] = useTransition();
  return (
    <select
      aria-label={`Instructor for ${studentName}`}
      value={optimistic}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        start(async () => {
          setOptimistic(next);
          const res = await assignInstructor(studentId, next);
          if (!res.ok) toast(res.error, "bad");
          else toast(res.message ?? "Saved");
        });
      }}
      className={cn(
        "ctl min-h-10 py-1.5 text-[15px]",
        !optimistic && "border-warn bg-warn-soft font-semibold",
      )}
    >
      <option value="">No instructor</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name} ·{" "}
          {o.load === 0
            ? "free"
            : `${o.load} student${o.load === 1 ? "" : "s"}`}
          {o.clash ? " · same group clash" : ""}
        </option>
      ))}
    </select>
  );
}
