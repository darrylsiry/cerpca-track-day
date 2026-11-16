import {
  BadgeCheck,
  CircleAlert,
  FileText,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { SignatureImage } from "@/components/signature-pad";
import { Card, CarNumber, DefList, Pill } from "@/components/ui";
import type { TechInspection } from "@/db/schema";
import { cn } from "@/lib/cn";
import {
  HELMET_NOTE,
  TECH_SECTIONS,
  tireCodeDate,
  type TechFlag,
} from "@/lib/tech-form";
import { dateTime, dayFull } from "@/lib/time";
import type { TechItemResult } from "@/lib/types";
import { isInlineImage, isPdf } from "@/server/storage";
import { carLabel, sealCode } from "@/server/tech";

const RESULT: Record<
  TechItemResult,
  { label: string; tone: "good" | "bad" | "neutral" }
> = {
  pass: { label: "Pass", tone: "good" },
  fail: { label: "Fail", tone: "bad" },
  na: { label: "N/A", tone: "neutral" },
};

const TIRES: { key: "lf" | "rf" | "lr" | "rr"; label: string }[] = [
  { key: "lf", label: "Left front" },
  { key: "rf", label: "Right front" },
  { key: "lr", label: "Left rear" },
  { key: "rr", label: "Right rear" },
];

/** Flags raised automatically from the rules printed on the form. */
export function FlagList({
  flags,
  className,
}: {
  flags: TechFlag[];
  className?: string;
}) {
  if (!flags.length) return null;
  return (
    <ul className={cn("space-y-2", className)}>
      {flags.map((f, i) => (
        <li
          key={i}
          className={cn(
            "flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-[15px] font-semibold",
            f.level === "block"
              ? "bg-bad-soft text-bad"
              : "bg-warn-soft text-warn",
          )}
        >
          {f.level === "block" ? (
            <CircleAlert className="mt-0.5 size-4.5 shrink-0" />
          ) : (
            <TriangleAlert className="mt-0.5 size-4.5 shrink-0" />
          )}
          <span className="text-ink">{f.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function ShopBadge({ verified }: { verified: boolean | null }) {
  if (verified === null) return <Pill tone="neutral">Paper form</Pill>;
  return verified ? (
    <Pill tone="good">
      <BadgeCheck className="size-3.5" /> Verified shop
    </Pill>
  ) : (
    <Pill tone="warn">
      <ShieldAlert className="size-3.5" /> Not verified
    </Pill>
  );
}

export function PaperPreview({
  file,
  className,
}: {
  file: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {isInlineImage(file) ? (
        <a
          href={file}
          target="_blank"
          rel="noreferrer"
          className="block overflow-hidden rounded-[10px] border border-line bg-paper"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- an access-controlled upload, not a static asset */}
          <img
            src={file}
            alt="Uploaded paper tech form"
            className="max-h-[32rem] w-full object-contain"
          />
        </a>
      ) : null}
      <a
        href={file}
        target="_blank"
        rel="noreferrer"
        className="mt-2 inline-flex h-11 items-center gap-2 rounded-[10px] border border-line-strong px-3 text-[15px] font-semibold hover:bg-sunk"
      >
        <FileText className="size-4" />{" "}
        {isPdf(file)
          ? "Open the uploaded form (PDF)"
          : "Open the uploaded form full size"}
      </a>
    </div>
  );
}

/**
 * The whole tech form, read-only: what the shop recorded, who signed and when.
 * `audit` adds the evidence only reviewers need (IP address, device, seal check).
 */
export function InspectionView({
  insp,
  driverName,
  verified,
  eventStart,
  tz,
  audit = false,
  sealOk = null,
}: {
  insp: TechInspection;
  driverName: string;
  verified: boolean | null;
  eventStart: string;
  tz: string;
  audit?: boolean;
  sealOk?: boolean | null;
}) {
  const start = new Date(`${eventStart}T12:00:00Z`).getTime();
  const paper = insp.method === "paper";
  const fluid = insp.form.brakeFluidDate
    ? new Date(`${insp.form.brakeFluidDate}T12:00:00Z`)
    : null;
  const fluidMonths = fluid
    ? Math.round((start - fluid.getTime()) / (30.44 * 86400000))
    : null;
  const hasTires = TIRES.some((t) => insp.form.tireDates[t.key]);

  return (
    <div className="space-y-4">
      <Card className="px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow text-ink-2">Car</p>
            <p className="mt-1 text-lg leading-tight font-bold">
              {carLabel(insp) || "Car not entered"}
            </p>
            {insp.vehicleColor ? (
              <p className="text-sm text-ink-2">{insp.vehicleColor}</p>
            ) : null}
          </div>
          <CarNumber n={insp.carNumber} size="lg" />
        </div>
        <DefList
          className="mt-3 border-t border-line"
          rows={[
            ["Driver", driverName],
            ["Emergency contact", insp.emergency1],
            ...(insp.driver2Name
              ? ([
                  ["Second driver", insp.driver2Name],
                  ["Their emergency contact", insp.emergency2],
                ] as [string, string | null][])
              : []),
          ]}
        />
      </Card>

      <Card className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow text-ink-2">Shop inspection</p>
          <ShopBadge verified={verified} />
        </div>
        <DefList
          className="mt-2"
          rows={[
            ["Shop", insp.shopName],
            ...(paper
              ? []
              : ([
                  ["Technician", insp.mechanicName],
                  ["Shop email", insp.shopEmail],
                  ["Shop phone", insp.shopPhone],
                ] as [string, string | null][])),
            [
              "Inspection date",
              insp.inspectionDate ? dayFull(insp.inspectionDate) : null,
            ],
          ]}
        />
        {paper && insp.paperFile ? (
          <PaperPreview file={insp.paperFile} className="mt-3" />
        ) : null}
        {paper ? (
          <p className="mt-3 text-sm text-ink-2">
            {insp.paperFile
              ? "Paper form: the checklist, shop stamp and technician signature are on the upload."
              : "Paper form checked in person. Nothing was uploaded, so there is no copy of it here."}
          </p>
        ) : null}
      </Card>

      {!paper ? (
        <>
          {TECH_SECTIONS.map((section) => (
            <Card key={section.key}>
              <p className="eyebrow px-4 pt-4 text-ink-2 sm:px-5">
                {section.title}
              </p>
              <ul className="mt-1 divide-y divide-line">
                {section.items.map((item) => {
                  const result = insp.form.items[item.key];
                  const note = insp.form.itemNotes?.[item.key];
                  return (
                    <li
                      key={item.key}
                      className="flex items-start justify-between gap-3 px-4 py-2.5 sm:px-5"
                    >
                      <div className="min-w-0">
                        <p
                          className={cn(
                            "text-[15px] font-semibold",
                            result === "fail" && "text-bad",
                          )}
                        >
                          {item.label}
                        </p>
                        {note ? (
                          <p className="mt-0.5 text-sm text-ink">
                            Technician note: {note}
                          </p>
                        ) : null}
                      </div>
                      {result ? (
                        <Pill tone={RESULT[result].tone}>
                          {RESULT[result].label}
                        </Pill>
                      ) : (
                        <Pill tone="warn">Not marked</Pill>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}

          <Card className="px-4 py-4 sm:px-5">
            <p className="eyebrow text-ink-2">Tires, brake fluid and helmet</p>
            {hasTires ? (
              <dl className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {TIRES.map((t) => {
                  const code = insp.form.tireDates[t.key];
                  const made = tireCodeDate(code);
                  const age = made
                    ? (start - made.getTime()) / (365.25 * 86400000)
                    : null;
                  const old = age !== null && age >= 5;
                  return (
                    <div
                      key={t.key}
                      className={cn(
                        "rounded-[10px] border px-3 py-2.5",
                        old ? "border-bad bg-bad-soft" : "border-line",
                      )}
                    >
                      <dt className="text-[13px] text-ink-2">{t.label}</dt>
                      <dd className="timing mt-0.5 text-lg font-bold">
                        {code || "Missing"}
                      </dd>
                      <dd
                        className={cn(
                          "text-[13px]",
                          old ? "font-bold text-bad" : "text-ink-2",
                        )}
                      >
                        {age === null
                          ? "No date code"
                          : `${age.toFixed(1)} years at the event`}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p className="mt-2 text-[15px] text-ink-2">
                No tire date codes recorded.
              </p>
            )}
            <DefList
              className="mt-3 border-t border-line"
              rows={[
                [
                  "Brake fluid changed",
                  fluid ? (
                    <span
                      className={cn(
                        fluidMonths !== null && fluidMonths > 12 && "text-bad",
                      )}
                    >
                      {dayFull(insp.form.brakeFluidDate)} ({fluidMonths} months
                      before the event)
                    </span>
                  ) : null,
                ],
                ["Helmet rating", insp.form.helmet || null],
                ...(insp.form.notes
                  ? ([["Technician notes", insp.form.notes]] as [
                      string,
                      string,
                    ][])
                  : []),
              ]}
            />
            <p className="mt-2 text-[13px] text-ink-2">{HELMET_NOTE}</p>
          </Card>
        </>
      ) : null}

      <Card className="px-4 py-4 sm:px-5">
        <p className="eyebrow text-ink-2">Signatures</p>
        <div className="mt-3 grid gap-5 sm:grid-cols-2">
          {!paper ? (
            <div>
              <p className="text-sm font-semibold text-ink-2">Technician</p>
              {insp.mechanicSignedAt ? (
                <>
                  <SignatureImage
                    src={insp.mechanicSignature}
                    alt={`Signature of ${insp.mechanicName ?? "the technician"}`}
                    className="mt-1.5"
                  />
                  <p className="mt-1.5 text-[15px] font-bold">
                    {insp.mechanicName}
                  </p>
                  <p className="text-sm text-ink-2">
                    Signed {dateTime(insp.mechanicSignedAt, tz)}
                  </p>
                  {insp.sealHash ? (
                    <p className="mt-1 text-sm text-ink-2">
                      Verification code{" "}
                      <span className="timing font-bold text-ink">
                        {sealCode(insp.sealHash)}
                      </span>
                    </p>
                  ) : null}
                  {audit ? (
                    <div className="mt-2 space-y-1 text-[13px] text-ink-2">
                      {sealOk === true ? (
                        <p className="flex items-center gap-1.5 font-semibold text-good">
                          <ShieldCheck className="size-4" /> Seal intact: the
                          record matches what the technician signed
                        </p>
                      ) : sealOk === false ? (
                        <p className="flex items-start gap-1.5 font-semibold text-bad">
                          <ShieldAlert className="mt-px size-4 shrink-0" /> Seal
                          check failed: the checklist, date or shop details
                          differ from what the technician signed
                        </p>
                      ) : null}
                      <p>
                        Signed from IP{" "}
                        <span className="timing">
                          {insp.mechanicIp ?? "not recorded"}
                        </span>
                      </p>
                      {insp.mechanicUserAgent ? (
                        <p className="break-words">
                          Device: {insp.mechanicUserAgent}
                        </p>
                      ) : null}
                      {insp.mechanicInvitedAt ? (
                        <p>
                          Link sent to the shop{" "}
                          {dateTime(insp.mechanicInvitedAt, tz)}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="mt-1 text-[15px] text-ink-2">Not signed yet.</p>
              )}
            </div>
          ) : null}
          <div>
            <p className="text-sm font-semibold text-ink-2">Driver</p>
            {insp.driverSignedAt ? (
              <>
                <SignatureImage
                  src={insp.driverSignature}
                  alt={`Signature of ${insp.driverSignedName ?? driverName}`}
                  className="mt-1.5"
                />
                <p className="mt-1.5 text-[15px] font-bold">
                  {insp.driverSignedName}
                </p>
                <p className="text-sm text-ink-2">
                  Signed {dateTime(insp.driverSignedAt, tz)}
                </p>
              </>
            ) : (
              <p className="mt-1 text-[15px] text-ink-2">Not signed yet.</p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
