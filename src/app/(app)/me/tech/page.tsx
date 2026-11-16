import { eq } from "drizzle-orm";
import { Check, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Sheet } from "@/components/sheet";
import { screen } from "@/components/shell/skeleton";
import { buttonClass, CarNumber, DefList, EmptyState, Notice, PageHeader, Pill, type Tone } from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { cn, fullName } from "@/lib/cn";
import { GRID_TECH_ITEMS, TECH_ITEMS } from "@/lib/tech-form";
import { dateTime, dayFull, daysBetween, monthDay, zoned } from "@/lib/time";
import { getViewer } from "@/server/auth";
import { isPdf } from "@/server/storage";
import { carLabel, flagsFor, getInspection, inspectionWindow, listShops, sealCode, shopVerified } from "@/server/tech";
import { FlagList, InspectionView, ShopBadge } from "../../admin/tech/_components/inspection-view";
import { CarForm, ShopStep, SignForm, type CarDefaults } from "./steps";

export const metadata: Metadata = { title: "Tech inspection" };

type StepState = "done" | "current" | "todo" | "attention";

/** 28 → "4 weeks", 10 → "10 days" */
const span = (days: number) => (days % 7 === 0 ? `${days / 7} week${days === 7 ? "" : "s"}` : `${days} days`);

function Step({ n, title, state, status, children }: { n: number; title: string; state: StepState; status?: { label: string; tone: Tone }; children?: ReactNode }) {
  return (
    <li className={cn("rounded-[14px] border bg-surface", state === "current" ? "border-ink" : state === "attention" ? "border-bad" : "border-line")}>
      <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full font-display text-lg font-extrabold",
            state === "done" && "bg-good text-white",
            state === "current" && "bg-ink text-white",
            state === "attention" && "bg-bad text-white",
            state === "todo" && "bg-sunk text-ink-3",
          )}
          aria-hidden
        >
          {state === "done" ? <Check className="size-4.5" strokeWidth={3} /> : state === "attention" ? <CircleAlert className="size-4.5" /> : n}
        </span>
        <h2 className={cn("min-w-0 flex-1 text-[17px] leading-tight font-bold", state === "todo" && "text-ink-2")}>
          <span className="sr-only">Step {n}: </span>
          {title}
        </h2>
        {status ? <Pill tone={status.tone}>{status.label}</Pill> : null}
      </div>
      {children ? <div className="border-t border-line px-4 py-4 sm:px-5">{children}</div> : null}
    </li>
  );
}

export default screen(async function MyTechPage() {
  const v = await getViewer();
  const header = (
    <PageHeader
      title="Tech inspection"
      lede="Every car needs two checks before it goes on track: a shop inspection in the weeks before the event, and grid tech at the track, where you get your sticker."
    />
  );
  if (!v.event) {
    return (
      <>
        {header}
        <EmptyState title="No event is scheduled yet">When the region publishes its next track day, your tech form for it will start here.</EmptyState>
      </>
    );
  }
  if (!v.registration) {
    return (
      <>
        {header}
        <EmptyState title="You are not on the roster for this event">
          Tech forms are tied to a registration. Once you are registered for {v.event.name}, come back here to start yours.
        </EmptyState>
      </>
    );
  }

  const db = await getDb();
  const event = v.event;
  const [insp, shops, vehicleRows] = await Promise.all([
    getInspection(event.id, v.user.id),
    listShops(v.org.id),
    v.registration.vehicleId ? db.select().from(s.vehicles).where(eq(s.vehicles.id, v.registration.vehicleId)).limit(1) : Promise.resolve([]),
  ]);
  const vehicle = vehicleRows[0] ?? null;
  const status = insp?.status ?? "none";
  const win = inspectionWindow(event, v.org);
  const flags = insp ? flagsFor(insp, event, v.org, shops) : [];
  const verified = insp ? shopVerified(insp, shops) : null;
  const paperFormHref = v.track?.guide.documents.find((d) => /tech/i.test(d.title))?.href ?? null;
  const today = v.now.day;
  const paper = insp?.method === "paper";

  const defaults: CarDefaults = {
    year: String(insp?.vehicleYear ?? vehicle?.year ?? ""),
    make: insp?.vehicleMake ?? vehicle?.make ?? "",
    model: insp?.vehicleModel ?? vehicle?.model ?? "",
    color: insp?.vehicleColor ?? vehicle?.color ?? "",
    carNumber: insp?.carNumber ?? v.registration.carNumber ?? vehicle?.carNumber ?? "",
    emergency1: insp?.emergency1 ?? [v.user.emergencyName, v.user.emergencyPhone].filter(Boolean).join(", "),
    driver2Name: insp?.driver2Name ?? "",
    emergency2: insp?.emergency2 ?? "",
  };

  const locked = status === "submitted" || status === "approved";
  const failed = insp && !paper ? TECH_ITEMS.filter((it) => insp.form.items[it.key] === "fail").length : 0;
  const missing = insp && !paper ? TECH_ITEMS.filter((it) => !insp.form.items[it.key]).length : 0;
  // The shop's part is on file and the form is the driver's to sign: first time round, or again after the reviewer sent it back.
  const shopOnFile = Boolean(insp && (paper ? insp.paperFile : insp.mechanicSignedAt));
  const signable = (status === "shop_signed" || status === "changes_requested") && shopOnFile;
  const cannotSign = signable && (failed > 0 || missing > 0);
  const sticker = Boolean(insp?.stickerIssuedAt);

  // Where the window stands today.
  const toOpen = daysBetween(today, win.earliest);
  const toClose = daysBetween(today, win.latest);
  const windowNote =
    toOpen > 0
      ? `Opens in ${toOpen} day${toOpen === 1 ? "" : "s"}. An inspection done earlier than that is too old by the event.`
      : toClose >= 0
        ? `Open now. ${toClose === 0 ? "Today is the last day." : `${toClose} day${toClose === 1 ? "" : "s"} left.`}`
        : "This window has passed. Get the car inspected as soon as you can; the tech team decides whether a late inspection is accepted.";

  const s1: StepState = status === "none" ? "current" : "done";
  const s2: StepState = status === "none" ? "todo" : status === "draft" || status === "with_shop" || (status === "changes_requested" && !shopOnFile) ? "current" : "done";
  const s3: StepState = signable ? (cannotSign ? "attention" : "current") : locked ? "done" : "todo";
  const s4: StepState = status === "submitted" ? "current" : status === "approved" ? "done" : status === "changes_requested" ? "attention" : "todo";
  const s5: StepState = sticker ? "done" : status === "approved" ? "current" : "todo";

  return (
    <div className="mx-auto max-w-3xl">
      {header}

      {sticker ? (
        <Notice tone="good" title="You are cleared to drive" className="mb-4">
          Tech sticker <span className="timing font-bold">{insp!.stickerNumber}</span> is on your car.
        </Notice>
      ) : status === "changes_requested" ? (
        <Notice tone="bad" title="The tech team sent your form back" className="mb-4">
          {insp!.reviewNote}
        </Notice>
      ) : null}

      {!locked ? (
        <div className="mb-4 rounded-[14px] border border-line bg-surface px-4 py-3.5 sm:px-5">
          <p className="eyebrow text-ink-2">Shop inspection window</p>
          <p className="board mt-1.5 text-[1.7rem]">
            {monthDay(win.earliest)} to {monthDay(win.latest)}
          </p>
          <p className="mt-1.5 text-[15px] text-ink-2">
            No earlier than {span(v.org.settings.techWindow.earliestDays)} and no later than {span(v.org.settings.techWindow.latestDays)} before {dayFull(event.startDate)}. {windowNote}
          </p>
        </div>
      ) : null}

      <ol className="space-y-3">
        <Step n={1} title="Your car and emergency contact" state={s1}>
          {status === "none" ? (
            <CarForm defaults={defaults} carLocked={false} submitLabel="Save and continue" />
          ) : (
            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg leading-tight font-bold">{carLabel(insp!)}</p>
                  {insp!.vehicleColor ? <p className="text-sm text-ink-2">{insp!.vehicleColor}</p> : null}
                </div>
                <CarNumber n={insp!.carNumber} />
              </div>
              <DefList
                className="mt-2"
                rows={[
                  ["Emergency contact", insp!.emergency1],
                  ...(insp!.driver2Name ? ([["Second driver", insp!.driver2Name], ["Their emergency contact", insp!.emergency2]] as [string, string | null][]) : []),
                ]}
              />
              {!locked ? (
                <div className="mt-3">
                  <Sheet trigger="Edit" triggerClassName={buttonClass("secondary", "sm")} title="Your car and emergency contact">
                    <CarForm defaults={defaults} carLocked={status !== "draft"} submitLabel="Save" />
                  </Sheet>
                </div>
              ) : null}
            </div>
          )}
        </Step>

        <Step
          n={2}
          title="Shop inspection"
          state={s2}
          status={
            status === "with_shop"
              ? { label: "Waiting on shop", tone: "info" }
              : s2 === "done"
                  ? { label: paper ? "Paper form uploaded" : "Shop signed", tone: "good" }
                  : undefined
          }
        >
          {status === "none" ? null : (
            <div className="space-y-4">
              {insp && (s2 === "done" || status === "changes_requested") ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[15px]">
                  {paper ? (
                    <>
                      <span>
                        Paper form from <strong>{insp.shopName}</strong>
                        {insp.inspectionDate ? `, inspected ${dayFull(insp.inspectionDate)}` : ""}.
                      </span>
                      {insp.paperFile ? (
                        <a href={insp.paperFile} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">
                          {isPdf(insp.paperFile) ? "Open the PDF" : "Open the photo"}
                        </a>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span>
                        <strong>{insp.mechanicName ?? "The technician"}</strong> at <strong>{insp.shopName}</strong> signed {insp.mechanicSignedAt ? dateTime(insp.mechanicSignedAt, v.tz) : ""}.
                      </span>
                      <ShopBadge verified={verified} />
                    </>
                  )}
                </div>
              ) : null}
              {!locked ? (
                <ShopStep
                  status={status}
                  method={insp?.method ?? "online"}
                  shops={shops.filter((x) => x.verified && x.email).map((x) => ({ id: x.id, name: x.name, city: x.city, contactName: x.contactName }))}
                  current={{
                    shopId: insp?.shopId ?? null,
                    shopName: insp?.shopName ?? null,
                    shopEmail: insp?.shopEmail ?? null,
                    shopPhone: insp?.shopPhone ?? null,
                    mechanicName: insp?.mechanicName ?? null,
                    invitedAt: insp?.mechanicInvitedAt ? dateTime(insp.mechanicInvitedAt, v.tz) : null,
                    expires: insp?.mechanicTokenExpires ? dayFull(zoned(insp.mechanicTokenExpires, v.tz).day) : null,
                    expired: Boolean(insp?.mechanicTokenExpires && insp.mechanicTokenExpires.getTime() < v.nowMs),
                  }}
                  today={today}
                  paperFormHref={paperFormHref}
                />
              ) : null}
            </div>
          )}
        </Step>

        <Step n={3} title="Review and sign" state={s3} status={locked ? { label: "Signed", tone: "good" } : cannotSign ? { label: "Can't submit yet", tone: "bad" } : undefined}>
          {insp && signable ? (
            <div className="space-y-5">
              {status === "changes_requested" ? (
                <Notice tone="neutral">
                  If the fix needed your shop, redo step 2 first. If it did not (a missing contact, for example), make the change and sign again below to resubmit.
                </Notice>
              ) : null}
              <p className="text-[15px] text-ink-2">
                {paper
                  ? "Check that your upload is the complete, stamped form. Then sign the driver's certification to send it to the tech team."
                  : "This is what your shop recorded. Read it through, then sign the driver's certification to send it to the tech team."}
              </p>
              {flags.length ? (
                <div>
                  <p className="eyebrow mb-2 text-ink-2">Checked automatically against the rules on the form</p>
                  <FlagList flags={flags} />
                </div>
              ) : null}
              {cannotSign ? (
                <Notice tone="bad" title={failed ? `The shop marked ${failed === 1 ? "one item" : `${failed} items`} as failed` : "The checklist is not complete"}>
                  {failed
                    ? "A car with a failed item can't be approved. Have it fixed, then use \"Send it back to the shop\" in step 2 so they can update the form."
                    : "Use \"Send it back to the shop\" in step 2 so they can finish it."}
                </Notice>
              ) : null}
              <InspectionView insp={insp} driverName={fullName(v.user)} verified={verified} eventStart={event.startDate} tz={v.tz} />
              {!cannotSign ? (
                <div className="rounded-[12px] border border-ink p-4">
                  <h3 className="mb-3 text-base font-bold">Driver&apos;s certification</h3>
                  <SignForm defaultName={fullName(v.user)} />
                </div>
              ) : null}
            </div>
          ) : insp && locked ? (
            <div className="space-y-3">
              <p className="text-[15px]">
                Signed by {insp.driverSignedName} {insp.driverSignedAt ? dateTime(insp.driverSignedAt, v.tz) : ""}.
                {insp.sealHash ? (
                  <>
                    {" "}
                    Shop verification code <span className="timing font-bold">{sealCode(insp.sealHash)}</span>.
                  </>
                ) : null}
              </p>
              <details className="group">
                <summary className={cn(buttonClass("secondary", "sm"), "cursor-pointer list-none")}>
                  <span className="group-open:hidden">Show the full form</span>
                  <span className="hidden group-open:inline">Hide the full form</span>
                </summary>
                <div className="mt-4">
                  <InspectionView insp={insp} driverName={fullName(v.user)} verified={verified} eventStart={event.startDate} tz={v.tz} />
                </div>
              </details>
            </div>
          ) : null}
        </Step>

        <Step
          n={4}
          title="Tech team review"
          state={s4}
          status={
            status === "submitted"
              ? { label: "In review", tone: "warn" }
              : status === "approved"
                ? { label: "Approved", tone: "good" }
                : status === "changes_requested"
                  ? { label: "Changes requested", tone: "bad" }
                  : undefined
          }
        >
          {status === "submitted" ? (
            <p className="text-[15px] text-ink-2">
              Submitted {insp!.submittedAt ? dateTime(insp!.submittedAt, v.tz) : ""}. The Chief Tech Inspector reviews forms before the event, and you will get an alert here as soon as yours is
              approved or sent back.
            </p>
          ) : status === "approved" ? (
            <p className="text-[15px] text-ink-2">Approved {insp!.reviewedAt ? dateTime(insp!.reviewedAt, v.tz) : ""}. Your paperwork is done.</p>
          ) : status === "changes_requested" ? (
            <div className="space-y-2 text-[15px]">
              <p className="font-bold">What the reviewer said</p>
              <p>{insp!.reviewNote}</p>
              <p className="text-ink-2">
                {paper
                  ? "Fix the issue. If the form itself was the problem, replace the upload in step 2. Then sign again in step 3 to resubmit."
                  : "Fix the issue. If it needs your shop, send the form back to them from step 2 so they can update it. Then sign again in step 3 to resubmit."}
              </p>
            </div>
          ) : null}
        </Step>

        <Step
          n={5}
          title="Grid tech at the track"
          state={s5}
          status={sticker ? { label: `Sticker ${insp!.stickerNumber ?? "issued"}`, tone: "good" } : undefined}
        >
          {sticker ? (
            <p className="text-[15px] text-ink-2">
              Sticker <span className="timing font-bold text-ink">{insp!.stickerNumber}</span> issued {dateTime(insp!.stickerIssuedAt, v.tz)}. Keep it on the windshield for the whole event.
            </p>
          ) : (
            <div className="text-[15px]">
              <p className="text-ink-2">
                Bring the car to the tech shed with your <strong className="text-ink">helmet</strong> and your <strong className="text-ink">car numbers on</strong>. Tech personnel check the items
                below and put the sticker on your car. A car without a sticker does not go on track.
              </p>
              <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {GRID_TECH_ITEMS.map((g) => (
                  <li key={g.key} className="flex items-start gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-ink-3" aria-hidden />
                    {g.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Step>
      </ol>

      {paperFormHref ? (
        <p className="mt-5 text-sm text-ink-2">
          Prefer paper?{" "}
          <a href={paperFormHref} target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-4">
            Download the {v.org.shortName} tech inspection form
          </a>
          , have your shop complete and stamp it, then upload it in step 2.
        </p>
      ) : null}
    </div>
  );
});
