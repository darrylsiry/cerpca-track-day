import { and, eq } from "drizzle-orm";
import { CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { screen } from "@/components/shell/skeleton";
import {
  buttonClass,
  ButtonLink,
  Card,
  CarNumber,
  Field,
  GroupChip,
  Notice,
  PageHeader,
  Pill,
} from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { fullName } from "@/lib/cn";
import { TECH_STATUS } from "@/lib/tech-form";
import { dateRange, dateTime } from "@/lib/time";
import { requireAdmin } from "@/server/auth";
import {
  carLabel,
  flagsFor,
  listShops,
  sealIntact,
  shopVerified,
} from "@/server/tech";
import { FlagList, InspectionView } from "../_components/inspection-view";
import { approveInspection, remindDriver, requestChanges } from "../actions";

export const metadata: Metadata = { title: "Tech form" };

export default screen(async function AdminTechDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const v = await requireAdmin();
  const { id } = await params;
  const db = await getDb();
  const [row] = await db
    .select({ insp: s.techInspections, driver: s.users, event: s.events })
    .from(s.techInspections)
    .innerJoin(s.users, eq(s.users.id, s.techInspections.userId))
    .innerJoin(s.events, eq(s.events.id, s.techInspections.eventId))
    .where(and(eq(s.techInspections.id, id), eq(s.events.orgId, v.org.id)))
    .limit(1);
  if (!row) notFound();
  const { insp, driver, event } = row;

  const [shops, [reg], reviewerRows, gridByRows] = await Promise.all([
    listShops(v.org.id),
    db
      .select({ groupId: s.registrations.runGroupId })
      .from(s.registrations)
      .where(
        and(
          eq(s.registrations.eventId, event.id),
          eq(s.registrations.userId, driver.id),
        ),
      )
      .limit(1),
    insp.reviewedById
      ? db
          .select()
          .from(s.users)
          .where(eq(s.users.id, insp.reviewedById))
          .limit(1)
      : Promise.resolve([]),
    insp.gridTechById
      ? db
          .select()
          .from(s.users)
          .where(eq(s.users.id, insp.gridTechById))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const group = v.groups.find((g) => g.id === reg?.groupId) ?? null;
  const reviewer = reviewerRows[0] ?? null;
  const gridBy = gridByRows[0] ?? null;
  const flags = flagsFor(insp, event, v.org, shops);
  const blocking = flags.filter((f) => f.level === "block");
  const verified = shopVerified(insp, shops);
  const status = TECH_STATUS[insp.status] ?? TECH_STATUS.none;
  const reviewable = insp.status === "submitted";
  const waiting = ["draft", "with_shop", "shop_signed"].includes(insp.status);
  const suggestedNote = blocking.length
    ? `${blocking.map((f) => f.text).join(". ")}. Have this fixed and ask your shop to update the form, then resubmit.`
    : "";

  const changesSheet = (label: string) => (
    <Sheet
      trigger={label}
      triggerClassName={buttonClass("secondary", "md", "w-full")}
      title="Send the form back"
      description={`${driver.firstName} gets an alert, an email and a push notification with your note, and has to resubmit.`}
    >
      <ActionForm action={requestChanges.bind(null, insp.id)}>
        <Field
          label="What needs to change"
          hint="Be specific: what is wrong and what the driver should do about it."
        >
          <textarea
            name="note"
            required
            minLength={10}
            maxLength={2000}
            className="ctl min-h-36"
            defaultValue={suggestedNote}
          />
        </Field>
        <SubmitButton className="mt-4 w-full" pendingLabel="Sending…">
          Send back to {driver.firstName}
        </SubmitButton>
      </ActionForm>
    </Sheet>
  );

  return (
    <>
      <PageHeader
        back={{ href: "/admin/tech", label: "Tech inspection" }}
        title={fullName(driver)}
        lede={
          <span className="flex flex-wrap items-center gap-2">
            <CarNumber n={insp.carNumber} size="sm" />
            <span>{carLabel(insp)}</span>
            <GroupChip group={group} size="sm" />
            <span>
              · {event.name}, {dateRange(event.startDate, event.endDate)}
            </span>
          </span>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        {/* Decision first on a phone, alongside on a desktop. */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:order-2">
          <Card className="px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-2">
              <p className="eyebrow text-ink-2">Review</p>
              <Pill tone={status.tone}>{status.label}</Pill>
            </div>

            {flags.length ? (
              <FlagList flags={flags} className="mt-3" />
            ) : !waiting ? (
              <p className="mt-3 flex items-center gap-2 rounded-[10px] bg-good-soft px-3 py-2.5 text-[15px] font-semibold text-good">
                <CircleCheck className="size-4.5 shrink-0" />{" "}
                <span className="text-ink">
                  No flags raised by the automatic checks
                </span>
              </p>
            ) : null}

            {reviewable ? (
              <div className="mt-4 space-y-2">
                <ActionButton
                  action={approveInspection.bind(null, insp.id)}
                  variant="primary"
                  className="w-full"
                  confirm={
                    blocking.length
                      ? `This form has ${blocking.length} blocking flag${blocking.length === 1 ? "" : "s"}. Approve it anyway?`
                      : undefined
                  }
                >
                  Approve
                </ActionButton>
                {changesSheet("Request changes")}
              </div>
            ) : insp.status === "approved" ? (
              <div className="mt-3 space-y-3 text-[15px]">
                <p className="text-ink-2">
                  Approved{reviewer ? ` by ${fullName(reviewer)}` : ""}{" "}
                  {insp.reviewedAt ? dateTime(insp.reviewedAt, v.tz) : ""}.
                </p>
                {insp.reviewNote ? <p>{insp.reviewNote}</p> : null}
                {!insp.stickerIssuedAt
                  ? changesSheet("Send back for changes")
                  : null}
              </div>
            ) : insp.status === "changes_requested" ? (
              <div className="mt-3 space-y-3 text-[15px]">
                <p className="text-ink-2">
                  Sent back{reviewer ? ` by ${fullName(reviewer)}` : ""}{" "}
                  {insp.reviewedAt ? dateTime(insp.reviewedAt, v.tz) : ""}.
                  Waiting on {driver.firstName} to resubmit.
                </p>
                <Notice tone="bad">{insp.reviewNote}</Notice>
                <ActionButton
                  action={approveInspection.bind(null, insp.id)}
                  className="w-full"
                  confirm="Approve this form as it stands, without waiting for the driver to resubmit?"
                >
                  Approve as it stands
                </ActionButton>
              </div>
            ) : (
              <div className="mt-3 space-y-3 text-[15px]">
                <p className="text-ink-2">
                  {insp.status === "with_shop"
                    ? `Waiting on ${insp.shopName ?? "the shop"} to fill in and sign the checklist.`
                    : insp.status === "shop_signed"
                      ? `The shop's part is done. ${driver.firstName} still has to sign and submit.`
                      : `${driver.firstName} has saved their car details but has not sent the form to a shop.`}
                </p>
                <ActionButton
                  action={remindDriver.bind(null, driver.id)}
                  className="w-full"
                >
                  Send {driver.firstName} a reminder
                </ActionButton>
              </div>
            )}
          </Card>

          <Card className="px-4 py-4 sm:px-5">
            <p className="eyebrow text-ink-2">Grid tech</p>
            {insp.stickerIssuedAt ? (
              <p className="mt-2 text-[15px]">
                Sticker{" "}
                <span className="timing font-bold">{insp.stickerNumber}</span>{" "}
                issued {dateTime(insp.stickerIssuedAt, v.tz)}
                {gridBy ? ` by ${fullName(gridBy)}` : ""}.
              </p>
            ) : (
              <p className="mt-2 text-[15px] text-ink-2">
                No sticker yet.{" "}
                {insp.status === "approved"
                  ? "Paperwork is approved, so the car is ready for grid tech."
                  : "Paperwork has to be approved first."}
              </p>
            )}
            {insp.gridTech?.notes ? (
              <p className="mt-2 text-[15px]">
                Grid tech note: {insp.gridTech.notes}
              </p>
            ) : null}
            <ButtonLink
              href={`/admin/tech/grid?u=${driver.id}`}
              variant="secondary"
              size="sm"
              className="mt-3"
            >
              Open in grid tech
            </ButtonLink>
          </Card>

          <Card className="px-4 py-4 text-[15px] sm:px-5">
            <p className="eyebrow text-ink-2">Driver</p>
            <p className="mt-2 font-bold">{fullName(driver)}</p>
            <p className="text-ink-2">{driver.email}</p>
            {driver.phone ? (
              <a
                href={`tel:${driver.phone.replace(/[^\d+]/g, "")}`}
                className="font-semibold underline underline-offset-4"
              >
                {driver.phone}
              </a>
            ) : null}
          </Card>
        </aside>

        <div className="min-w-0 lg:order-1">
          {insp.method === "online" && !insp.mechanicSignedAt ? (
            <Notice tone="neutral" className="mb-4">
              The shop has not signed yet, so the checklist below is empty or
              unfinished.
            </Notice>
          ) : null}
          <InspectionView
            insp={insp}
            driverName={fullName(driver)}
            verified={verified}
            eventStart={event.startDate}
            tz={v.tz}
            audit
            sealOk={sealIntact(insp)}
          />
        </div>
      </div>
    </>
  );
});
