import { Check, ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/form";
import { screen } from "@/components/shell/skeleton";
import {
  ButtonLink,
  Card,
  CarNumber,
  EmptyState,
  GroupChip,
  Notice,
  PageHeader,
  Pill,
} from "@/components/ui";
import { cn, fullName, vehicleLabel } from "@/lib/cn";
import { GRID_TECH_ITEMS, TECH_STATUS } from "@/lib/tech-form";
import { dateTime } from "@/lib/time";
import { requireAdmin } from "@/server/auth";
import { getRoster } from "@/server/queries";
import { carLabel, listInspections } from "@/server/tech";
import { acceptPaperAtTrack, revokeSticker, saveGridTech } from "../actions";
import { GridForm, GridList, type GridCar } from "./grid-client";

export const metadata: Metadata = { title: "Grid tech" };

const numeric = (n: string | null) => {
  const v = Number((n ?? "").replace(/\D/g, ""));
  return Number.isFinite(v) && n ? v : Number.MAX_SAFE_INTEGER;
};

export default screen(async function GridTechPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>;
}) {
  const v = await requireAdmin();
  if (!v.event) {
    return (
      <>
        <PageHeader
          title="Grid tech"
          back={{ href: "/admin/tech", label: "Tech inspection" }}
        />
        <EmptyState title="No event to run grid tech for">
          Create or publish an event first.
        </EmptyState>
      </>
    );
  }
  const event = v.event;
  const { u } = await searchParams;
  const [roster, inspections] = await Promise.all([
    getRoster(event.id),
    listInspections(event.id),
  ]);
  const byUser = new Map(inspections.map((i) => [i.userId, i]));

  const cars: GridCar[] = roster
    .map((r) => {
      const insp = byUser.get(r.user.id);
      return {
        userId: r.user.id,
        name: fullName(r.user),
        carNumber: insp?.carNumber ?? r.reg.carNumber,
        car: insp ? carLabel(insp) : vehicleLabel(r.vehicle),
        group: {
          name: r.group.name,
          color: r.group.color,
          textColor: r.group.textColor,
        },
        approved: insp?.status === "approved",
        sticker: insp?.stickerIssuedAt
          ? (insp.stickerNumber ?? "Issued")
          : null,
      };
    })
    .sort(
      (a, b) =>
        numeric(a.carNumber) - numeric(b.carNumber) ||
        a.name.localeCompare(b.name),
    );

  const person = u ? (roster.find((r) => r.user.id === u) ?? null) : null;
  const insp = person ? (byUser.get(person.user.id) ?? null) : null;
  const issued = cars.filter((c) => c.sticker).length;
  const ready = cars.filter((c) => c.approved && !c.sticker).length;
  const status = TECH_STATUS[insp?.status ?? "none"];
  const gridBy = insp?.gridTechById
    ? (roster.find((r) => r.user.id === insp.gridTechById)?.user ?? null)
    : null;

  return (
    <>
      <PageHeader
        back={{ href: "/admin/tech", label: "Tech inspection" }}
        title="Grid tech"
        lede={
          <>
            <span className="timing font-semibold text-ink">
              {issued} of {cars.length}
            </span>{" "}
            stickers issued{ready ? `, ${ready} more ready` : ""}. Find the car,
            run the ten checks, issue the sticker.
          </>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        {/* On a phone the list and the checklist take turns; on a desktop they sit side by side. */}
        <div className={cn("min-w-0", person && "hidden lg:block")}>
          <GridList cars={cars} selected={person?.user.id ?? null} />
        </div>

        <div className={cn("min-w-0", !person && "hidden lg:block")}>
          {!person ? (
            <EmptyState title="Pick a car">
              Search by the number on the door, or the driver&apos;s name, and
              its grid checklist opens here.
            </EmptyState>
          ) : (
            <div className="space-y-4">
              <Link
                href="/admin/tech/grid"
                className="inline-flex h-11 items-center gap-1 rounded-[10px] pr-3 text-[15px] font-semibold text-ink-2 hover:text-ink lg:hidden"
              >
                <ChevronLeft className="size-4.5" /> All cars
              </Link>

              <Card className="px-4 py-4 sm:px-5">
                <div className="flex items-center gap-3.5">
                  <CarNumber
                    n={insp?.carNumber ?? person.reg.carNumber ?? "?"}
                    size="lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xl leading-tight font-bold">
                      {fullName(person.user)}
                    </p>
                    <p className="truncate text-[15px] text-ink-2">
                      {insp ? carLabel(insp) : vehicleLabel(person.vehicle)}
                    </p>
                  </div>
                  <GroupChip group={person.group} size="lg" />
                </div>
              </Card>

              {insp?.stickerIssuedAt ? (
                <>
                  <div className="rounded-[14px] bg-good px-5 py-5 text-white">
                    <p className="eyebrow text-white/80">
                      Cleared to go on track
                    </p>
                    <p className="board mt-2 text-[3.2rem]">
                      {insp.stickerNumber}
                    </p>
                    <p className="mt-2 text-[15px] text-white/90">
                      Sticker issued {dateTime(insp.stickerIssuedAt, v.tz)}
                      {gridBy ? ` by ${fullName(gridBy)}` : ""}.
                    </p>
                  </div>
                  <Card>
                    <ul className="divide-y divide-line">
                      {GRID_TECH_ITEMS.map((g) => (
                        <li
                          key={g.key}
                          className="flex items-center gap-3 px-4 py-2.5 text-[15px] sm:px-5"
                        >
                          <Check
                            className={cn(
                              "size-4.5 shrink-0",
                              insp.gridTech?.items[g.key]
                                ? "text-good"
                                : "text-line-strong",
                            )}
                            strokeWidth={3}
                          />
                          {g.label}
                        </li>
                      ))}
                    </ul>
                    {insp.gridTech?.notes ? (
                      <p className="border-t border-line px-4 py-3 text-[15px] sm:px-5">
                        Note: {insp.gridTech.notes}
                      </p>
                    ) : null}
                  </Card>
                  <ActionButton
                    action={revokeSticker.bind(null, person.user.id)}
                    variant="danger"
                    confirm={`Revoke sticker ${insp.stickerNumber ?? ""}? ${person.user.firstName} is told their car is no longer cleared, and you should remove the sticker from the car.`}
                  >
                    Revoke sticker
                  </ActionButton>
                </>
              ) : (
                <>
                  {insp?.status === "approved" ? (
                    <Notice tone="good" title="Paperwork approved">
                      {insp.method === "paper"
                        ? "Paper form"
                        : `Shop inspection by ${insp.shopName ?? "the shop"}`}
                      {insp.reviewedAt
                        ? `, approved ${dateTime(insp.reviewedAt, v.tz)}`
                        : ""}
                      .
                    </Notice>
                  ) : (
                    <div className="rounded-[14px] bg-warn-soft px-4 py-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-bold text-warn">
                          Paperwork is not approved
                        </p>
                        <Pill tone={status.tone}>{status.label}</Pill>
                      </div>
                      <p className="mt-1 text-[15px]">
                        {insp?.status === "submitted"
                          ? "Their form is submitted and waiting for review. Review it now, or check the stamped paper form in person."
                          : insp?.status === "changes_requested"
                            ? `The form was sent back: ${insp.reviewNote ?? ""}`
                            : "No approved shop inspection is on file. If the driver has the stamped paper form with them, check it now."}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {insp && insp.status !== "draft" ? (
                          <ButtonLink
                            href={`/admin/tech/${insp.id}`}
                            variant="secondary"
                          >
                            Open their form
                          </ButtonLink>
                        ) : null}
                        <ActionButton
                          action={acceptPaperAtTrack.bind(null, person.user.id)}
                          confirm={`Confirm that you have checked ${person.user.firstName}'s completed, stamped paper tech form in person? This approves their paperwork.`}
                        >
                          Paper form checked in person
                        </ActionButton>
                      </div>
                    </div>
                  )}
                  <GridForm
                    key={person.user.id}
                    action={saveGridTech.bind(null, person.user.id)}
                    initial={insp?.gridTech?.items ?? {}}
                    initialNotes={insp?.gridTech?.notes ?? ""}
                    approved={insp?.status === "approved"}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
});
