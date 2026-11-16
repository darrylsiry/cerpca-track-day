"use client";

import { Clock3 } from "lucide-react";
import { clearDemoClock, setDemoClock } from "@/app/(app)/actions";
import { clock, toTimeInput, weekday } from "@/lib/time";
import { useTrackNow } from "../clock";
import { ActionButton, ActionForm, SubmitButton } from "../form";
import { Sheet } from "../sheet";
import { Field } from "../ui";

const PRESETS: { label: string; dayIndex: number; time: string }[] = [
  { label: "Sat 7:20 · before the first session", dayIndex: 0, time: "07:20" },
  { label: "Sat 8:20 · White on track", dayIndex: 0, time: "08:20" },
  { label: "Sat 9:58 · Green grids next", dayIndex: 0, time: "09:58" },
  { label: "Sat 12:20 · lunch", dayIndex: 0, time: "12:20" },
  { label: "Sun 3:15 · combined sessions", dayIndex: 1, time: "15:15" },
];

/** Demo-mode strip: shows the app's clock and lets you move it around the weekend. */
export function DemoClockBar({ days, simulated }: { days: string[]; simulated: boolean }) {
  const now = useTrackNow();
  return (
    <div className="no-print flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-1.5 text-[13px] sm:px-6 lg:px-8">
      <p className="flex min-w-0 items-center gap-2 text-ink-2">
        <span className="eyebrow rounded bg-ink px-1.5 py-0.5 text-[10px] text-white">Demo</span>
        <Clock3 className="size-3.5 shrink-0" />
        <span className="truncate">
          <span className="timing font-semibold text-ink" suppressHydrationWarning>
            {weekday(now.day).slice(0, 3)} {clock(now.minutes)}
          </span>{" "}
          {simulated ? "simulated" : "real time"}
        </span>
      </p>
      <div className="flex shrink-0 items-center gap-1">
        {simulated ? (
          <ActionButton action={clearDemoClock} variant="ghost" size="sm" className="h-7 px-2 text-[13px]" successMessage={false}>
            Real time
          </ActionButton>
        ) : null}
        <Sheet
          trigger="Set clock"
          triggerClassName="h-7 rounded-md px-2 text-[13px] font-semibold underline underline-offset-4 hover:bg-sunk"
          title="Simulated clock"
          description="Demo mode only. Move the app's clock to any moment of the weekend to see what drivers would see then. Reminders still follow real time."
        >
          <div className="space-y-2">
            {PRESETS.filter((p) => days[p.dayIndex]).map((p) => (
              <ActionForm key={p.label} action={setDemoClock} quiet>
                <input type="hidden" name="day" value={days[p.dayIndex]} />
                <input type="hidden" name="time" value={p.time} />
                <SubmitButton variant="secondary" className="w-full justify-start">
                  {p.label}
                </SubmitButton>
              </ActionForm>
            ))}
          </div>
          <ActionForm action={setDemoClock} quiet className="mt-5 border-t border-line pt-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Day">
                <select name="day" className="ctl" defaultValue={days.includes(now.day) ? now.day : days[0]}>
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {weekday(d)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Time">
                <input type="time" name="time" className="ctl" defaultValue={toTimeInput(now.minutes)} required />
              </Field>
            </div>
            <SubmitButton className="mt-4 w-full">Set clock</SubmitButton>
          </ActionForm>
        </Sheet>
      </div>
    </div>
  );
}
