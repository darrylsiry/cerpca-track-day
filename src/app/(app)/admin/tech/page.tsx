import { ChevronRight, ClipboardCheck, Store } from "lucide-react";
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
  PageHeader,
  Pill,
  Segmented,
  Stat,
} from "@/components/ui";
import type { TechInspection } from "@/db/schema";
import { fullName, plural, vehicleLabel } from "@/lib/cn";
import { TECH_STATUS, type TechFlag } from "@/lib/tech-form";
import { dateTime } from "@/lib/time";
import { requireAdmin } from "@/server/auth";
import { getRoster, type RosterRow } from "@/server/queries";
import { carLabel, flagsFor, listInspections, listShops } from "@/server/tech";
import { remindAllWaiting, remindDriver } from "./actions";

export const metadata: Metadata = { title: "Tech inspection" };

type Tab = "review" | "waiting" | "changes" | "approved";
const tabOf = (status: string): Tab =>
  status === "submitted"
    ? "review"
    : status === "changes_requested"
      ? "changes"
      : status === "approved"
        ? "approved"
        : "waiting";

type Row = {
  person: RosterRow;
  insp: TechInspection | null;
  status: string;
  flags: TechFlag[];
};

function waitingDetail(row: Row, tz: string) {
  const i = row.insp;
  if (!i || row.status === "none") return "Has not started";
  if (row.status === "draft") return "Car details saved, not sent to a shop";
  if (row.status === "with_shop")
    return `Waiting on ${i.shopName ?? "the shop"}${i.mechanicInvitedAt ? ` since ${dateTime(i.mechanicInvitedAt, tz)}` : ""}`;
  return `${i.method === "paper" ? "Paper form uploaded" : "Shop signed"}, driver has not signed`;
}

function FlagPill({ flags }: { flags: TechFlag[] }) {
  if (!flags.length) return null;
  const blocking = flags.filter((f) => f.level === "block").length;
  return (
    <Pill tone={blocking ? "bad" : "warn"}>{plural(flags.length, "flag")}</Pill>
  );
}

export default screen(async function AdminTechPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const v = await requireAdmin();
  const header = (actions?: React.ReactNode) => (
    <PageHeader
      title="Tech inspection"
      lede="Review shop inspections well before the event, then issue stickers at the track. A car needs both to go on track."
      actions={actions}
    />
  );
  if (!v.event) {
    return (
      <>
        {header()}
        <EmptyState title="No event to inspect for">
          Create or publish an event and its tech forms will collect here.
        </EmptyState>
      </>
    );
  }
  const event = v.event;
  const sp = await searchParams;
  const [roster, inspections, shops] = await Promise.all([
    getRoster(event.id),
    listInspections(event.id),
    listShops(v.org.id),
  ]);
  const byUser = new Map(inspections.map((i) => [i.userId, i]));
  const rows: Row[] = roster.map((person) => {
    const insp = byUser.get(person.user.id) ?? null;
    return {
      person,
      insp,
      status: insp?.status ?? "none",
      flags: insp ? flagsFor(insp, event, v.org, shops) : [],
    };
  });

  const inTab = (t: Tab) => rows.filter((r) => tabOf(r.status) === t);
  const counts = {
    review: inTab("review").length,
    waiting: inTab("waiting").length,
    changes: inTab("changes").length,
    approved: inTab("approved").length,
  };
  const tab: Tab =
    (["review", "waiting", "changes", "approved"] as const).find(
      (t) => t === sp.tab,
    ) ?? (counts.review ? "review" : "waiting");
  const list = inTab(tab).sort((a, b) =>
    tab === "review"
      ? (a.insp?.submittedAt?.getTime() ?? 0) -
        (b.insp?.submittedAt?.getTime() ?? 0)
      : a.person.user.lastName.localeCompare(b.person.user.lastName),
  );
  const stickers = rows.filter((r) => r.insp?.stickerIssuedAt).length;

  return (
    <>
      {header(
        <>
          <ButtonLink href="/admin/tech/shops" variant="secondary">
            <Store className="size-4" /> Shops
          </ButtonLink>
          <ButtonLink href="/admin/tech/grid">
            <ClipboardCheck className="size-4" /> Grid tech
          </ButtonLink>
        </>,
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="To review"
          value={counts.review}
          tone={counts.review ? "warn" : undefined}
          href="/admin/tech?tab=review"
        />
        <Stat
          label="Not submitted"
          value={counts.waiting}
          sub={counts.changes ? `plus ${counts.changes} sent back` : undefined}
          href="/admin/tech?tab=waiting"
        />
        <Stat
          label="Approved"
          value={`${counts.approved}/${rows.length}`}
          href="/admin/tech?tab=approved"
        />
        <Stat
          label="Stickers issued"
          value={`${stickers}/${rows.length}`}
          href="/admin/tech/grid"
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Tech forms by status"
          current={tab}
          items={[
            {
              key: "review",
              href: "/admin/tech?tab=review",
              label: "Needs review",
              count: counts.review,
            },
            {
              key: "waiting",
              href: "/admin/tech?tab=waiting",
              label: "Waiting",
              count: counts.waiting,
            },
            {
              key: "changes",
              href: "/admin/tech?tab=changes",
              label: "Changes requested",
              count: counts.changes,
            },
            {
              key: "approved",
              href: "/admin/tech?tab=approved",
              label: "Approved",
              count: counts.approved,
            },
          ]}
        />
        {tab === "waiting" && list.length ? (
          <ActionButton
            action={remindAllWaiting}
            confirm={`Send a reminder to all ${list.length} drivers who have not submitted? Each gets an alert, an email and a push notification.`}
          >
            Remind all {list.length}
          </ActionButton>
        ) : null}
      </div>

      {list.length === 0 ? (
        <EmptyState
          title={
            tab === "review"
              ? "Nothing waiting for review"
              : tab === "waiting"
                ? "Everyone has submitted"
                : tab === "changes"
                  ? "No forms are out for changes"
                  : "No forms approved yet"
          }
        >
          {tab === "review"
            ? "New submissions appear here, oldest first, and you get an alert for each one."
            : undefined}
        </EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {list.map((row) => {
              const { person, insp } = row;
              const car = insp ? carLabel(insp) : vehicleLabel(person.vehicle);
              const number = insp?.carNumber ?? person.reg.carNumber;
              const detail =
                tab === "waiting"
                  ? waitingDetail(row, v.tz)
                  : tab === "review"
                    ? `${insp?.method === "paper" ? "Paper form" : (insp?.shopName ?? "Shop")}${insp?.submittedAt ? ` · submitted ${dateTime(insp.submittedAt, v.tz)}` : ""}`
                    : tab === "changes"
                      ? (insp?.reviewNote ?? "")
                      : insp?.method === "paper"
                        ? "Paper form"
                        : (insp?.shopName ?? "");
              const main = (
                <>
                  <CarNumber n={number} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-bold">
                        {fullName(person.user)}
                      </span>
                      <GroupChip group={person.group} size="sm" />
                    </span>
                    <span className="block truncate text-sm text-ink-2">
                      {[car, detail].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                </>
              );
              return (
                <li
                  key={person.user.id}
                  className="flex items-center gap-2 pr-3 sm:pr-4"
                >
                  {insp ? (
                    <Link
                      href={`/admin/tech/${insp.id}`}
                      className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 hover:bg-paper sm:pl-5"
                    >
                      {main}
                      <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
                        <FlagPill flags={row.flags} />
                        {tab === "approved" ? (
                          insp.stickerIssuedAt ? (
                            <Pill tone="good">
                              Sticker {insp.stickerNumber}
                            </Pill>
                          ) : (
                            <Pill>No sticker yet</Pill>
                          )
                        ) : tab === "waiting" ? (
                          <Pill tone={TECH_STATUS[row.status]?.tone}>
                            {row.status === "with_shop"
                              ? "With shop"
                              : row.status === "shop_signed"
                                ? "Driver to sign"
                                : "Draft"}
                          </Pill>
                        ) : null}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-ink-3" />
                    </Link>
                  ) : (
                    <div className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 sm:pl-5">
                      {main}
                      <Pill>Not started</Pill>
                    </div>
                  )}
                  {tab === "waiting" ? (
                    <ActionButton
                      action={remindDriver.bind(null, person.user.id)}
                      size="sm"
                      aria-label={`Remind ${fullName(person.user)}`}
                    >
                      Remind
                    </ActionButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
});
