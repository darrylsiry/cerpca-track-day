import { eq } from "drizzle-orm";
import { CircleCheck, Clock3, LinkIcon } from "lucide-react";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { screen } from "@/components/shell/skeleton";
import { Card, CarNumber, DefList } from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { fullName } from "@/lib/cn";
import { TECH_ITEMS } from "@/lib/tech-form";
import { dateRange, dateTime, dayFull, monthDay, zoned } from "@/lib/time";
import { carLabel, inspectionWindow, sealCode } from "@/server/tech";
import { sha256 } from "@/server/util";
import { submitShopInspection } from "./actions";
import { ShopForm } from "./shop-form";

function Message({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card className="px-5 py-8 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-sunk text-ink-2">{icon}</div>
      <h1 className="board mt-4 text-[1.9rem]">{title}</h1>
      <div className="mx-auto mt-2 max-w-[44ch] text-[15px] text-ink-2">{children}</div>
    </Card>
  );
}

export default screen(async function ShopInspectionPage({ params }: { params: Promise<{ token: string }> }) {
  // Nothing here can be prerendered: the link is a one-time credential checked against the clock.
  await connection();
  const { token } = await params;
  const db = await getDb();
  const [row] = await db
    .select({ insp: s.techInspections, driver: s.users, event: s.events, org: s.organizations, track: s.tracks })
    .from(s.techInspections)
    .innerJoin(s.users, eq(s.users.id, s.techInspections.userId))
    .innerJoin(s.events, eq(s.events.id, s.techInspections.eventId))
    .innerJoin(s.organizations, eq(s.organizations.id, s.events.orgId))
    .innerJoin(s.tracks, eq(s.tracks.id, s.events.trackId))
    .where(eq(s.techInspections.mechanicTokenHash, sha256(token)))
    .limit(1);

  if (!row) {
    return (
      <Message icon={<LinkIcon className="size-6" />} title="This link is not valid">
        It may have been replaced by a newer one, or the driver cancelled the request. Ask the driver to send you a new link from their Track Day app.
      </Message>
    );
  }
  const { insp, driver, event, org, track } = row;
  const tz = track.timezone;
  const car = carLabel(insp) || "Car";

  // Already signed: the same link now only shows the shop its receipt.
  if (insp.mechanicSignedAt) {
    const failed = TECH_ITEMS.filter((it) => insp.form.items[it.key] === "fail").length;
    return (
      <div className="space-y-4">
        <Card className="px-5 py-7 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-good text-white">
            <CircleCheck className="size-7" />
          </div>
          <h1 className="board mt-4 text-[2.1rem]">Inspection recorded</h1>
          <p className="mx-auto mt-2 max-w-[46ch] text-[15px] text-ink-2">
            Thank you. {driver.firstName} has been notified and will sign their part before it goes to the {org.shortName} tech team. You can close this page.
          </p>
          <p className="eyebrow mt-6 text-ink-2">Verification code</p>
          <p className="timing mt-1 text-[1.9rem] font-bold tracking-wider">{sealCode(insp.sealHash)}</p>
          <p className="mx-auto mt-2 max-w-[46ch] text-[13px] text-ink-2">
            This code is a fingerprint of exactly what you signed. If the region ever calls to confirm the inspection, the code on their screen should match this one.
          </p>
        </Card>
        <Card className="px-4 py-2 sm:px-5">
          <DefList
            rows={[
              ["Car", `${car}${insp.carNumber ? `, #${insp.carNumber}` : ""}`],
              ["Driver", fullName(driver)],
              ["Signed by", `${insp.mechanicName ?? ""}, ${insp.shopName ?? ""}`],
              ["Signed", dateTime(insp.mechanicSignedAt, tz)],
              ["Result", failed ? `${failed} of ${TECH_ITEMS.length} items failed` : "All items passed or not applicable"],
            ]}
          />
        </Card>
        <p className="text-center text-[13px] text-ink-2">Need to correct something? Ask the driver to send the form back to you; they will get a fresh link.</p>
      </div>
    );
  }

  if (insp.status !== "with_shop") {
    return (
      <Message icon={<LinkIcon className="size-6" />} title="This link is not valid">
        The driver has changed how they are submitting this inspection. If they still need you to sign, ask them to send a new link.
      </Message>
    );
  }

  if (!insp.mechanicTokenExpires || insp.mechanicTokenExpires.getTime() < Date.now()) {
    return (
      <Message icon={<Clock3 className="size-6" />} title="This link has expired">
        Links work for 21 days. Ask {fullName(driver)} to send you a new one from their Track Day app, then open that link instead.
      </Message>
    );
  }

  const win = inspectionWindow(event, org);
  const today = zoned(new Date(), tz).day;

  return (
    <div className="space-y-4">
      <Card className="px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow text-ink-2">Car to inspect</p>
            <h1 className="mt-1 text-xl leading-tight font-bold">{car}</h1>
            {insp.vehicleColor ? <p className="text-[15px] text-ink-2">{insp.vehicleColor}</p> : null}
          </div>
          <CarNumber n={insp.carNumber} size="lg" />
        </div>
        <DefList
          className="mt-3 border-t border-line"
          rows={[
            ["Driver", `${fullName(driver)}${insp.driver2Name ? ` and ${insp.driver2Name}` : ""}`],
            ["Event", `${event.name}, ${dateRange(event.startDate, event.endDate)}`],
            ["Track", track.name],
            ["Region", org.name],
          ]}
        />
      </Card>

      <div className="rounded-[14px] bg-info-soft px-4 py-3.5 text-[15px] sm:px-5">
        <p className="font-bold">How this works</p>
        <p className="mt-1">
          This is the region&apos;s Driver&apos;s Education technical inspection form. Mark every item, enter the tire date codes and brake fluid date, then sign at the bottom. It takes the
          place of the paper form with your shop stamp. The inspection should be done between {monthDay(win.earliest)} and {monthDay(win.latest)}.
        </p>
        <p className="mt-1">
          This link was sent to {insp.shopName} only. It works once and expires {dayFull(zoned(insp.mechanicTokenExpires, tz).day)}.
        </p>
      </div>

      <ShopForm
        action={submitShopInspection.bind(null, token)}
        initial={insp.form}
        shopName={insp.shopName ?? "Your shop"}
        defaultMechanic={insp.mechanicName ?? ""}
        today={today}
        eventStart={event.startDate}
        windowText={`The region asks for ${monthDay(win.earliest)} to ${monthDay(win.latest)}.`}
      />
    </div>
  );
});
