"use client";

import { ArrowDown, LoaderCircle } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { SignaturePad } from "@/components/signature-pad";
import { buttonClass, Field, Notice } from "@/components/ui";
import { cn } from "@/lib/cn";
import { HELMET_NOTE, MECHANIC_CERTIFICATION, TECH_ITEMS, TECH_SECTIONS, tireCodeDate } from "@/lib/tech-form";
import type { TechFormData, TechItemResult } from "@/lib/types";
import type { ShopSubmitState } from "./actions";

const CHOICES: { value: TechItemResult; label: string; on: string }[] = [
  { value: "pass", label: "Pass", on: "border-good bg-good text-white" },
  { value: "fail", label: "Fail", on: "border-bad bg-bad text-white" },
  { value: "na", label: "N/A", on: "border-ink-2 bg-ink-2 text-white" },
];

const TIRES: { key: "lf" | "rf" | "lr" | "rr"; label: string }[] = [
  { key: "lf", label: "Left front" },
  { key: "rf", label: "Right front" },
  { key: "lr", label: "Left rear" },
  { key: "rr", label: "Right rear" },
];

function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
}

export function ShopForm({
  action,
  initial,
  shopName,
  defaultMechanic,
  today,
  eventStart,
  windowText,
}: {
  action: (prev: ShopSubmitState, fd: FormData) => Promise<ShopSubmitState>;
  initial: TechFormData;
  shopName: string;
  defaultMechanic: string;
  today: string;
  eventStart: string;
  windowText: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  // Everything is held in state, not only in the form, so nothing typed is lost if a submit is rejected.
  const [items, setItems] = useState<Record<string, TechItemResult | undefined>>(initial.items);
  const [notes, setNotes] = useState<Record<string, string>>(initial.itemNotes ?? {});
  const [tires, setTires] = useState(initial.tireDates);
  const [brakeFluidDate, setBrakeFluidDate] = useState(initial.brakeFluidDate);
  const [helmet, setHelmet] = useState(initial.helmet ?? "");
  const [formNotes, setFormNotes] = useState(initial.notes ?? "");
  const [inspectionDate, setInspectionDate] = useState(today);
  const [mechanicName, setMechanicName] = useState(defaultMechanic);
  const [certify, setCertify] = useState(false);
  const [signature, setSignature] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const serverError = state && !state.ok ? state : null;
  useEffect(() => {
    if (serverError?.field) jumpTo(serverError.field);
  }, [serverError]);

  const marked = TECH_ITEMS.filter((it) => items[it.key]).length;
  const failed = TECH_ITEMS.filter((it) => items[it.key] === "fail").length;
  const firstUnmarked = TECH_ITEMS.find((it) => !items[it.key]);
  const eventMs = new Date(`${eventStart}T12:00:00Z`).getTime();
  const fluidMonths = brakeFluidDate ? Math.round((eventMs - new Date(`${brakeFluidDate}T12:00:00Z`).getTime()) / (30.44 * 86400000)) : null;

  // Catch what's missing before the round trip, and take the technician straight to it.
  const check = (e: React.FormEvent) => {
    const stop = (message: string, id: string) => {
      e.preventDefault();
      setProblem(message);
      jumpTo(id);
    };
    if (firstUnmarked) return stop(`"${firstUnmarked.label}" is not marked yet.`, `item-${firstUnmarked.key}`);
    const noNote = TECH_ITEMS.find((it) => items[it.key] === "fail" && !notes[it.key]?.trim());
    if (noNote) return stop(`Add a note saying what is wrong with "${noNote.label}".`, `item-${noNote.key}`);
    const badTire = TIRES.find((t) => !tireCodeDate(tires[t.key]));
    if (badTire) return stop(`Enter the ${badTire.label.toLowerCase()} tire's date code as four digits.`, "tires");
    if (!brakeFluidDate) return stop("Enter the date the brake fluid was last changed.", "fluid");
    if (!inspectionDate || mechanicName.trim().length < 3) return stop("Enter the inspection date and your full name.", "signoff");
    if (!certify) return stop("Tick the box to certify the inspection.", "signoff");
    if (!signature) return stop("Sign in the box.", "signoff");
    setProblem(null);
  };

  return (
    <form action={formAction} onSubmit={check} noValidate className="space-y-4">
      {TECH_SECTIONS.map((section) => (
        <section key={section.key} className="rounded-[14px] border border-line bg-surface">
          <h2 className="eyebrow px-4 pt-4 text-ink-2 sm:px-5">{section.title}</h2>
          <ul className="mt-1 divide-y divide-line">
            {section.items.map((item) => {
              const value = items[item.key];
              return (
                <li key={item.key} id={`item-${item.key}`} className="grid scroll-mt-4 gap-x-5 gap-y-3 px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_15rem] sm:px-5">
                  <div>
                    <p className="font-bold">
                      {item.label}
                      {item.optional ? <span className="font-normal text-ink-3"> · if applicable</span> : null}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-2">{item.detail}</p>
                  </div>
                  <fieldset className="flex gap-1.5 self-start">
                    <legend className="sr-only">{item.label}</legend>
                    {CHOICES.filter((c) => c.value !== "na" || item.optional).map((c) => (
                      <label
                        key={c.value}
                        className={cn(
                          "grid min-h-12 flex-1 cursor-pointer place-items-center rounded-[10px] border text-[15px] font-bold transition-colors select-none",
                          "has-[:focus-visible]:outline-[2.5px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
                          value === c.value ? c.on : "border-line-strong bg-white text-ink hover:bg-sunk",
                        )}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={`item_${item.key}`}
                          value={c.value}
                          checked={value === c.value}
                          onChange={() => {
                            setItems((cur) => ({ ...cur, [item.key]: c.value }));
                            setProblem(null);
                          }}
                        />
                        {c.label}
                      </label>
                    ))}
                  </fieldset>
                  {value === "fail" ? (
                    <Field label="What is wrong?" className="sm:col-span-2">
                      <input
                        name={`note_${item.key}`}
                        className="ctl"
                        maxLength={500}
                        value={notes[item.key] ?? ""}
                        onChange={(e) => setNotes((cur) => ({ ...cur, [item.key]: e.target.value }))}
                        placeholder="What needs to be fixed before the car goes on track"
                      />
                    </Field>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section id="tires" className="scroll-mt-4 rounded-[14px] border border-line bg-surface px-4 py-4 sm:px-5">
        <h2 className="eyebrow text-ink-2">Tire date codes</h2>
        <p className="mt-1.5 text-sm text-ink-2">
          The last four digits of the DOT number on the sidewall: week, then year. <span className="timing font-semibold text-ink">2423</span> is week 24 of 2023. Tires must be less than 5
          years old at the event.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TIRES.map((t) => {
            const made = tireCodeDate(tires[t.key]);
            const age = made ? (eventMs - made.getTime()) / (365.25 * 86400000) : null;
            const old = age !== null && age >= 5;
            return (
              <Field key={t.key} label={t.label} error={old ? `${age!.toFixed(1)} years at the event. Over the limit.` : undefined} hint={age !== null ? `${age.toFixed(1)} years at the event` : "WWYY"}>
                <input
                  name={`tire_${t.key}`}
                  inputMode="numeric"
                  maxLength={4}
                  className={cn("ctl timing text-center text-lg", old && "border-bad")}
                  placeholder="2423"
                  value={tires[t.key]}
                  onChange={(e) => setTires((cur) => ({ ...cur, [t.key]: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                />
              </Field>
            );
          })}
        </div>
      </section>

      <section id="fluid" className="scroll-mt-4 rounded-[14px] border border-line bg-surface px-4 py-4 sm:px-5">
        <h2 className="eyebrow text-ink-2">Brake fluid and helmet</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            label="Brake fluid last changed"
            error={fluidMonths !== null && fluidMonths > 12 ? `${fluidMonths} months before the event. It must be changed at least annually.` : undefined}
            hint="Must be within 12 months of the event."
          >
            <input name="brakeFluidDate" type="date" max={today} className="ctl" value={brakeFluidDate} onChange={(e) => setBrakeFluidDate(e.target.value)} />
          </Field>
          <Field label="Helmet Snell rating" optional hint="If the driver brought it, for example SA2020.">
            <input name="helmet" className="ctl" maxLength={40} value={helmet} onChange={(e) => setHelmet(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <p className="mt-3 text-[13px] text-ink-2">{HELMET_NOTE}</p>
        <Field label="Anything else the tech team should know" optional className="mt-3">
          <textarea name="notes" className="ctl" maxLength={1000} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} />
        </Field>
      </section>

      <section id="signoff" className="scroll-mt-4 rounded-[14px] border border-ink bg-surface px-4 py-4 sm:px-5">
        <h2 className="eyebrow text-ink-2">Technician sign-off</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Your full name">
            <input name="mechanicName" className="ctl" value={mechanicName} onChange={(e) => setMechanicName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="Date of inspection" hint={windowText}>
            <input name="inspectionDate" type="date" max={today} className="ctl" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
          </Field>
        </div>
        <p className="mt-3 text-[15px]">
          Shop: <strong>{shopName}</strong>
        </p>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[10px] bg-paper px-3.5 py-3 text-[15px]">
          <input type="checkbox" name="certify" className="check mt-0.5" checked={certify} onChange={(e) => setCertify(e.target.checked)} />
          <span>{MECHANIC_CERTIFICATION}</span>
        </label>
        <div className="mt-4">
          <p className="mb-1.5 text-sm font-semibold">Signature</p>
          <SignaturePad name="signature_pad" label="Technician signature" onChange={setSignature} />
          <input type="hidden" name="signature" value={signature} />
        </div>

        {problem || serverError ? (
          <Notice tone="bad" className="mt-3">
            {problem ?? serverError?.error}
          </Notice>
        ) : null}
        {failed ? (
          <Notice tone="warn" className="mt-3" title={`${failed === 1 ? "One item is" : `${failed} items are`} marked as failed`}>
            You can still sign. The driver and the region&apos;s tech team will see what failed and why, and the car will not be approved until it is fixed and you update this form.
          </Notice>
        ) : null}
        <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "mt-4 w-full")}>
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
          {pending ? "Sending…" : "Sign and send to the driver"}
        </button>
        <p className="mt-2 text-center text-[13px] text-ink-2">Signing records the time, your IP address and device with the form. This link then stops working.</p>
      </section>

      {/* Progress, always in reach on a long form. */}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6">
        <p className="text-[15px] font-semibold">
          <span className="timing">
            {marked} of {TECH_ITEMS.length}
          </span>{" "}
          items marked
          {failed ? <span className="text-bad"> · {failed} failed</span> : null}
        </p>
        {firstUnmarked ? (
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => jumpTo(`item-${firstUnmarked.key}`)}>
            Next unmarked <ArrowDown className="size-3.5" />
          </button>
        ) : (
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => jumpTo("signoff")}>
            Go to sign-off <ArrowDown className="size-3.5" />
          </button>
        )}
      </div>
    </form>
  );
}
