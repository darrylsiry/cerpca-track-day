"use client";

import { Check, LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "@/components/toast";
import {
  buttonClass,
  CarNumber,
  Field,
  GroupChip,
  Notice,
  Pill,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { GRID_TECH_ITEMS } from "@/lib/tech-form";
import type { ActionResult, GroupLite } from "@/lib/types";

export type GridCar = {
  userId: string;
  name: string;
  carNumber: string | null;
  car: string;
  group: Pick<GroupLite, "name" | "color" | "textColor">;
  approved: boolean;
  sticker: string | null;
};

/** Find a car by number or driver name. Filters as you type; no round trip. */
export function GridList({
  cars,
  selected,
}: {
  cars: GridCar[];
  selected: string | null;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? cars.filter(
        (c) =>
          (c.carNumber ?? "").toLowerCase().startsWith(needle) ||
          c.name.toLowerCase().includes(needle),
      )
    : cars;
  return (
    <div>
      <label className="relative block">
        <span className="sr-only">Find a car by number or driver name</span>
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-3"
          aria-hidden
        />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Car number or name"
          className="ctl h-13 pl-11 text-lg"
        />
      </label>
      <p className="mt-2 mb-1 text-[13px] text-ink-2" aria-live="polite">
        {needle
          ? `${shown.length} of ${cars.length} cars`
          : `${cars.length} cars, by number`}
      </p>
      {shown.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
          {shown.map((c) => (
            <li key={c.userId}>
              <Link
                href={`/admin/tech/grid?u=${c.userId}`}
                scroll
                aria-current={selected === c.userId ? "true" : undefined}
                className={cn(
                  "flex min-h-16 items-center gap-3 px-3.5 py-2.5",
                  selected === c.userId
                    ? "bg-ink text-white"
                    : "hover:bg-paper active:bg-sunk",
                )}
              >
                <CarNumber n={c.carNumber ?? "?"} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-bold">{c.name}</span>
                    <GroupChip group={c.group} size="sm" />
                  </span>
                  <span
                    className={cn(
                      "block truncate text-sm",
                      selected === c.userId ? "text-white/75" : "text-ink-2",
                    )}
                  >
                    {c.car}
                  </span>
                </span>
                {c.sticker ? (
                  <Pill tone="good">
                    <Check className="size-3.5" strokeWidth={3} /> {c.sticker}
                  </Pill>
                ) : c.approved ? (
                  <Pill tone="info">Ready</Pill>
                ) : (
                  <Pill tone="warn">Paperwork</Pill>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-[14px] border border-dashed border-line-strong px-4 py-6 text-center text-[15px] text-ink-2">
          No car matches &quot;{q}&quot;. Check the number, or search by last
          name.
        </p>
      )}
    </div>
  );
}

/** The 10-point grid check. Big rows for gloved thumbs; the sticker button explains itself when it can't be used. */
export function GridForm({
  action,
  initial,
  initialNotes,
  approved,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  initial: Record<string, boolean>;
  initialNotes: string;
  approved: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [items, setItems] = useState<Record<string, boolean>>(initial);
  const [notes, setNotes] = useState(initialNotes);
  const handled = useRef<ActionResult | null>(null);

  useEffect(() => {
    if (!state || handled.current === state) return;
    handled.current = state;
    if (state.ok) toast(state.message ?? "Saved");
  }, [state]);

  const open = GRID_TECH_ITEMS.filter((g) => !items[g.key]);
  const canIssue = approved && open.length === 0;
  const reason = !approved
    ? "Paperwork is not approved yet."
    : open.length
      ? `${open.length} of ${GRID_TECH_ITEMS.length} still to check.`
      : "";

  return (
    <form action={formAction}>
      <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
        {GRID_TECH_ITEMS.map((g, i) => (
          <li key={g.key}>
            <label
              className={cn(
                "flex min-h-14 cursor-pointer items-center gap-3.5 px-4 py-2.5 text-base font-semibold select-none",
                items[g.key] && "bg-good-soft",
              )}
            >
              <input
                type="checkbox"
                name={`g_${g.key}`}
                className="check size-7"
                checked={Boolean(items[g.key])}
                onChange={(e) =>
                  setItems((cur) => ({ ...cur, [g.key]: e.target.checked }))
                }
              />
              <span className="min-w-0 flex-1">
                <span className="timing mr-1.5 text-ink-3">{i + 1}.</span>
                {g.label}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="h-9 rounded-md px-2 text-sm font-semibold text-ink-2 underline underline-offset-4 hover:bg-sunk"
          onClick={() =>
            setItems(
              open.length
                ? Object.fromEntries(GRID_TECH_ITEMS.map((g) => [g.key, true]))
                : {},
            )
          }
        >
          {open.length ? "Check all 10" : "Uncheck all"}
        </button>
      </div>
      <Field label="Notes" optional className="mt-1">
        <textarea
          name="notes"
          className="ctl min-h-20"
          maxLength={1000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything the driver was told to fix or watch"
        />
      </Field>
      {state && !state.ok ? (
        <Notice tone="bad" className="mt-3">
          {state.error}
        </Notice>
      ) : null}
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
        <button
          type="submit"
          name="intent"
          value="issue"
          disabled={pending || !canIssue}
          className={buttonClass("primary", "lg", "w-full")}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
          ) : null}
          Issue sticker
        </button>
        <button
          type="submit"
          name="intent"
          value="save"
          disabled={pending}
          className={buttonClass("secondary", "lg")}
        >
          Save checklist
        </button>
      </div>
      {reason ? (
        <p className="mt-2 text-[15px] font-semibold text-warn">
          {reason} The sticker can be issued once that is done.
        </p>
      ) : null}
    </form>
  );
}
