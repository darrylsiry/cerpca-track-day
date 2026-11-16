"use client";

import { Check, Download, FileUp, Search, UserPlus } from "lucide-react";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { ActionButton, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import {
  buttonClass,
  CarNumber,
  EmptyState,
  GroupChip,
  Notice,
  Pill,
} from "@/components/ui";
import { cn, plural } from "@/lib/cn";
import { TECH_STATUS } from "@/lib/tech-form";
import type { GroupLite } from "@/lib/types";
import type { RosterEntry } from "@/server/admin";
import { importRoster, setCheckedIn, type ImportState } from "./actions";
import { PersonForm } from "./person-form";

type Quick = "all" | "not-in" | "paperwork" | "no-sticker" | "instructors";

export function RosterTable({
  rows,
  groups,
  waiversTotal,
  dayLabels,
}: {
  rows: RosterEntry[];
  groups: GroupLite[];
  waiversTotal: number;
  dayLabels: string[];
}) {
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState("all");
  const [quick, setQuick] = useState<Quick>("all");
  const groupById = useMemo(
    () => new Map(groups.map((g) => [g.id, g])),
    [groups],
  );

  const paperworkOpen = (r: RosterEntry) =>
    r.waiversSigned < waiversTotal || r.techStatus !== "approved";
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (groupId !== "all" && r.groupId !== groupId) return false;
      if (quick === "not-in" && r.checkedIn) return false;
      if (
        quick === "paperwork" &&
        !(r.waiversSigned < waiversTotal || r.techStatus !== "approved")
      )
        return false;
      if (quick === "no-sticker" && r.sticker) return false;
      if (quick === "instructors" && !r.isInstructor) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.carNumber ?? "").toLowerCase() === needle ||
        (r.carNumber ?? "").startsWith(needle) ||
        r.car.toLowerCase().includes(needle) ||
        r.email.toLowerCase().includes(needle)
      );
    });
  }, [rows, q, groupId, quick, waiversTotal]);

  const counts = {
    "not-in": rows.filter((r) => !r.checkedIn).length,
    paperwork: rows.filter(paperworkOpen).length,
    "no-sticker": rows.filter((r) => !r.sticker).length,
    instructors: rows.filter((r) => r.isInstructor).length,
  };
  const quicks: { key: Quick; label: string; n?: number }[] = [
    { key: "all", label: "Everyone", n: rows.length },
    { key: "not-in", label: "Not checked in", n: counts["not-in"] },
    { key: "paperwork", label: "Paperwork open", n: counts.paperwork },
    { key: "no-sticker", label: "No tech sticker", n: counts["no-sticker"] },
    { key: "instructors", label: "Instructors", n: counts.instructors },
  ];
  const days = (r: RosterEntry) =>
    r.day1 && r.day2
      ? "Both"
      : r.day1
        ? (dayLabels[0]?.slice(0, 3) ?? "Day 1")
        : (dayLabels[1]?.slice(0, 3) ?? "Day 2");

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search the roster</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4.5 -translate-y-1/2 text-ink-3" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="ctl pl-10"
            placeholder="Name, car number or car"
            type="search"
          />
        </label>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="ctl w-auto"
          aria-label="Run group"
        >
          <option value="all">All run groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({rows.filter((r) => r.groupId === g.id).length})
            </option>
          ))}
        </select>
        <Sheet
          trigger={
            <>
              <UserPlus className="size-4" /> Add person
            </>
          }
          triggerClassName={buttonClass("primary")}
          title="Add to the roster"
          description="Registers someone for this event. If their email is already known, their existing record is used."
        >
          <PersonForm groups={groups} dayLabels={dayLabels} />
        </Sheet>
        <ImportSheet />
        <a
          href="/admin/roster/export"
          className={buttonClass("secondary")}
          download
        >
          <Download className="size-4" /> Export
        </a>
      </div>

      <div className="no-scrollbar -mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {quicks.map((x) => (
          <button
            key={x.key}
            type="button"
            onClick={() => setQuick(x.key)}
            aria-pressed={quick === x.key}
            className={cn(
              "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold",
              quick === x.key
                ? "border-ink bg-ink text-white"
                : "border-line-strong bg-surface text-ink-2 hover:text-ink",
            )}
          >
            {x.label}
            <span
              className={cn(
                "timing rounded-full px-1.5 text-[11px] font-bold",
                quick === x.key ? "bg-white/20" : "bg-sunk",
              )}
            >
              {x.n}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-4 mb-2 text-sm text-ink-2" aria-live="polite">
        Showing {filtered.length} of {plural(rows.length, "person", "people")}
      </p>

      {!filtered.length ? (
        <EmptyState title="Nobody matches">
          Clear the search or pick a different filter.
        </EmptyState>
      ) : (
        <>
          {/* Desktop: a real table */}
          <div className="hidden overflow-hidden rounded-[14px] border border-line bg-surface lg:block">
            <table className="w-full text-left text-[15px]">
              <thead className="border-b border-line bg-paper/60">
                <tr className="eyebrow text-[11px] text-ink-2">
                  <th className="py-2.5 pr-2 pl-4 font-bold">No.</th>
                  <th className="px-2 py-2.5 font-bold">Driver</th>
                  <th className="px-2 py-2.5 font-bold">Group</th>
                  <th className="px-2 py-2.5 font-bold">Car</th>
                  <th className="px-2 py-2.5 font-bold">Days</th>
                  <th className="px-2 py-2.5 font-bold">Waivers</th>
                  <th className="px-2 py-2.5 font-bold">Tech</th>
                  <th className="py-2.5 pr-4 pl-2 text-right font-bold">
                    Check-in
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map((r) => {
                  const tech = TECH_STATUS[r.techStatus] ?? TECH_STATUS.none;
                  return (
                    <tr key={r.regId} className="hover:bg-paper/50">
                      <td className="py-2 pr-2 pl-4">
                        <CarNumber n={r.carNumber} size="sm" />
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          href={`/admin/roster/${r.userId}`}
                          className="font-bold underline-offset-4 hover:underline"
                        >
                          {r.lastName}, {r.firstName}
                        </Link>
                        <span className="block text-[13px] text-ink-3">
                          {[
                            r.isAdmin ? "Admin" : null,
                            r.isInstructor
                              ? r.studentCount
                                ? `Instructor · ${plural(r.studentCount, "student")}`
                                : "Instructor"
                              : null,
                            r.instructorName
                              ? `with ${r.instructorName}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || r.email}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <GroupChip group={groupById.get(r.groupId)} size="sm" />
                        {/* A split group (Blue) names both halves; elsewhere only solo is worth saying. */}
                        {!r.isInstructor &&
                        (r.solo || groupById.get(r.groupId)?.split) ? (
                          <span className="ml-1.5 text-[13px] text-ink-3">
                            {r.solo ? "Solo" : "Instructed"}
                          </span>
                        ) : null}
                      </td>
                      <td className="max-w-[14rem] truncate px-2 py-2 text-ink-2">
                        {r.car}
                      </td>
                      <td className="px-2 py-2 text-ink-2">{days(r)}</td>
                      <td className="px-2 py-2">
                        <Pill
                          tone={
                            r.waiversSigned >= waiversTotal ? "good" : "warn"
                          }
                        >
                          <span className="timing">
                            {r.waiversSigned}/{waiversTotal}
                          </span>
                        </Pill>
                      </td>
                      <td className="px-2 py-2">
                        {r.sticker ? (
                          <Pill tone="good">
                            <Check className="size-3.5" strokeWidth={3} />{" "}
                            <span className="timing">{r.sticker}</span>
                          </Pill>
                        ) : (
                          <Pill tone={tech.tone}>{tech.label}</Pill>
                        )}
                      </td>
                      <td className="py-2 pr-4 pl-2 text-right">
                        <CheckInButton row={r} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones and tablets: stacked rows */}
          <ul className="space-y-2 lg:hidden">
            {filtered.map((r) => {
              const tech = TECH_STATUS[r.techStatus] ?? TECH_STATUS.none;
              return (
                <li
                  key={r.regId}
                  className="rounded-[14px] border border-line bg-surface"
                >
                  <Link
                    href={`/admin/roster/${r.userId}`}
                    className="flex items-center gap-3 px-4 pt-3 pb-2"
                  >
                    <CarNumber n={r.carNumber} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{r.name}</span>
                      <span className="block truncate text-sm text-ink-2">
                        {r.car || r.email}
                      </span>
                    </span>
                    <GroupChip group={groupById.get(r.groupId)} />
                  </Link>
                  <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2">
                    <span className="flex min-w-0 flex-wrap gap-1.5">
                      <Pill
                        tone={r.waiversSigned >= waiversTotal ? "good" : "warn"}
                      >
                        Waivers{" "}
                        <span className="timing">
                          {r.waiversSigned}/{waiversTotal}
                        </span>
                      </Pill>
                      {r.sticker ? (
                        <Pill tone="good">
                          <Check className="size-3.5" strokeWidth={3} />{" "}
                          <span className="timing">{r.sticker}</span>
                        </Pill>
                      ) : (
                        <Pill tone={tech.tone}>{tech.label}</Pill>
                      )}
                    </span>
                    <CheckInButton row={r} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function CheckInButton({ row }: { row: RosterEntry }) {
  return row.checkedIn ? (
    <ActionButton
      action={setCheckedIn.bind(null, row.regId, false)}
      variant="ghost"
      size="sm"
      className="text-good"
      successMessage={false}
      aria-label={`Undo check-in for ${row.name}`}
    >
      <Check className="size-4" strokeWidth={3} /> In
    </ActionButton>
  ) : (
    <ActionButton
      action={setCheckedIn.bind(null, row.regId, true)}
      variant="secondary"
      size="sm"
      successMessage={`${row.firstName} checked in`}
    >
      Check in
    </ActionButton>
  );
}

const FIELD_LABEL: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  name: "Name",
  email: "Email",
  phone: "Phone",
  address1: "Address",
  city: "City",
  state: "State",
  zip: "ZIP",
  emergencyName: "Emergency contact",
  emergencyPhone: "Emergency phone",
  pcaMemberNumber: "PCA member number",
  tshirtSize: "T-shirt size",
  group: "Run group",
  carNumber: "Car number",
  vehicle: "Car (combined)",
  year: "Year",
  make: "Make",
  model: "Model",
  color: "Color",
  instructor: "Instructor",
  status: "Status",
  externalId: "Registration ID",
};

function ImportSheet() {
  const [state, action] = useActionState<ImportState, FormData>(importRoster, {
    step: "choose",
  });
  // Read the file in the browser and post its text, so preview and import use the same content
  // without asking for the file twice.
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const ready =
    state.step === "preview"
      ? state.preview.rows.filter(
          (r) => r.email && r.groupId && r.status !== "cancelled",
        ).length
      : 0;
  return (
    <Sheet
      wide
      trigger={
        <>
          <FileUp className="size-4" /> Import
        </>
      }
      triggerClassName={buttonClass("secondary")}
      title="Import registrations"
      description="Bring the roster over from ClubRegistration.net: in Report Builder, export the event's registrants and choose that file here. A CSV from any other source works too."
    >
      {state.step === "done" ? (
        <Notice tone="good" title="Import finished">
          {plural(state.created, "person", "people")} added, {state.updated}{" "}
          updated{state.skipped ? `, ${state.skipped} skipped` : ""}. Close this
          panel to see the roster.
        </Notice>
      ) : (
        <form action={action} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold">
              Export file (.csv or .xls)
            </span>
            <input
              type="file"
              accept=".csv,.xls,.txt,.html,.htm,text/csv"
              className="ctl file:mr-3 file:rounded-md file:border-0 file:bg-sunk file:px-3 file:py-1.5 file:text-sm file:font-semibold"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setFileName(file.name);
                setContent(await file.text());
              }}
            />
          </label>
          <input type="hidden" name="content" value={content} />
          {fileName ? (
            <p className="text-sm text-ink-2">
              Selected: <strong className="text-ink">{fileName}</strong>
            </p>
          ) : null}
          {state.error ? <Notice tone="bad">{state.error}</Notice> : null}

          {state.step === "preview" ? (
            <div className="space-y-3">
              <Notice
                tone={state.preview.problems.length ? "warn" : "good"}
                title={`${plural(state.preview.rows.length, "row")} read, ${ready} ready to import`}
              >
                {state.preview.problems.length ? (
                  <ul className="mt-1 list-disc pl-5">
                    {state.preview.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                ) : (
                  "Existing people are matched by email. Details they have edited in the app are kept."
                )}
              </Notice>
              <div>
                <p className="eyebrow mb-1.5 text-ink-2">Columns recognised</p>
                <ul className="flex flex-wrap gap-1.5 text-sm">
                  {Object.entries(state.preview.mapping).map(
                    ([field, header]) => (
                      <li
                        key={field}
                        className="rounded-full bg-good-soft px-2.5 py-0.5 font-semibold text-good"
                      >
                        {FIELD_LABEL[field] ?? field}{" "}
                        <span className="font-normal text-ink-2">
                          from “{header}”
                        </span>
                      </li>
                    ),
                  )}
                </ul>
                {state.preview.unmapped.length ? (
                  <p className="mt-2 text-sm text-ink-2">
                    Ignored: {state.preview.unmapped.join(", ")}
                  </p>
                ) : null}
              </div>
              <div className="overflow-x-auto rounded-[10px] border border-line">
                <table className="w-full text-left text-sm">
                  <thead className="bg-paper/60 text-[11px] text-ink-2 uppercase">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">Group</th>
                      <th className="px-3 py-2">No.</th>
                      <th className="px-3 py-2">Car</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {state.preview.rows.slice(0, 6).map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 font-semibold whitespace-nowrap">
                          {r.firstName} {r.lastName}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.email || <span className="text-bad">Missing</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.groupId ? (
                            r.groupLabel
                          ) : (
                            <span className="text-bad">
                              {r.groupLabel || "Missing"}
                            </span>
                          )}
                        </td>
                        <td className="timing px-3 py-1.5">{r.carNumber}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {[r.year, r.make, r.model].filter(Boolean).join(" ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <SubmitButton
                name="intent"
                value="commit"
                className="w-full"
                pendingLabel="Importing…"
                disabled={!ready}
              >
                Import {plural(ready, "person", "people")}
              </SubmitButton>
            </div>
          ) : (
            <SubmitButton
              variant="secondary"
              className="w-full"
              pendingLabel="Reading…"
              disabled={!content}
            >
              Preview import
            </SubmitButton>
          )}
        </form>
      )}
    </Sheet>
  );
}
