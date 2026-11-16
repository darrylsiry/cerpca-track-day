"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import {
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { SignatureImage, SignaturePad } from "@/components/signature-pad";
import { SketchPad } from "@/components/sketch-pad";
import { toast } from "@/components/toast";
import { buttonClass, Card, Field, Notice } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  INCIDENT_CRITERIA,
  incidentDueOn,
  incidentHasInjury,
} from "@/lib/incident";
import { dayLong } from "@/lib/time";
import type {
  IncidentData,
  IncidentParty,
  TrackShape,
  YesNo,
} from "@/lib/types";
import type { IncidentRosterOption } from "@/server/incidents";
import { saveIncident } from "./actions";

export type IncidentFormProps = {
  id: string | null;
  status: string;
  initial: {
    occurredOn: string;
    occurredTime: string;
    location: string;
    criteria: string[];
    driverUserId: string;
    summary: string;
    data: IncidentData;
    sketch: string | null;
  };
  roster: IncidentRosterOption[];
  locations: string[];
  shape: TrackShape | null;
  signedAtLabel: string | null;
};

/* ───────────── Small building blocks ───────────── */

function Section({
  n,
  title,
  hint,
  children,
}: {
  n?: string;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="px-4 py-4 sm:px-6 sm:py-5">
      <div className="mb-4 flex items-start gap-3">
        {n ? (
          <span
            className="board grid size-9 shrink-0 place-items-center rounded-full bg-sunk text-xl text-ink-2"
            aria-hidden
          >
            {n}
          </span>
        ) : null}
        <div className="min-w-0 pt-0.5">
          <h2 className="text-lg leading-tight font-bold">
            {n ? <span className="sr-only">Item {n}: </span> : null}
            {title}
          </h2>
          {hint ? <p className="mt-1 text-sm text-ink-2">{hint}</p> : null}
        </div>
      </div>
      {children}
    </Card>
  );
}

function YesNoField({
  name,
  legend,
  value,
  onChange,
  defaultValue,
}: {
  name: string;
  legend: string;
  value?: YesNo;
  onChange?: (v: YesNo) => void;
  defaultValue?: YesNo;
}) {
  const controlled = value !== undefined;
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold">{legend}</legend>
      <div className="inline-flex gap-1 rounded-[12px] border border-line-strong bg-white p-1">
        {(["yes", "no"] as const).map((opt) => (
          <label key={opt} className="relative">
            <input
              type="radio"
              name={name}
              value={opt}
              className="peer sr-only"
              {...(controlled
                ? { checked: value === opt, onChange: () => onChange?.(opt) }
                : { defaultChecked: defaultValue === opt })}
            />
            <span className="flex h-11 min-w-[4.5rem] cursor-pointer items-center justify-center rounded-[9px] px-4 text-[15px] font-semibold text-ink-2 peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-[2.5px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
              {opt === "yes" ? "Yes" : "No"}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const grid2 = "grid gap-4 sm:grid-cols-2";

/** Contact fields shared by the passenger and the other injured party (uncontrolled). */
function ContactInputs({ prefix, d }: { prefix: string; d: IncidentParty }) {
  return (
    <div className={grid2}>
      <Field label="Name">
        <input
          name={`${prefix}.name`}
          defaultValue={d.name}
          className="ctl"
          autoComplete="off"
        />
      </Field>
      <Field label="Telephone">
        <input
          name={`${prefix}.phone`}
          defaultValue={d.phone}
          className="ctl"
          inputMode="tel"
          autoComplete="off"
        />
      </Field>
      <Field label="Address" className="sm:col-span-2">
        <input
          name={`${prefix}.address`}
          defaultValue={d.address}
          className="ctl"
          autoComplete="off"
        />
      </Field>
      <Field label="Email" className="sm:col-span-2">
        <input
          name={`${prefix}.email`}
          defaultValue={d.email}
          className="ctl"
          inputMode="email"
          autoComplete="off"
        />
      </Field>
    </div>
  );
}

/* ───────────── The form ───────────── */

export function IncidentForm({
  id,
  status,
  initial,
  roster,
  locations,
  shape,
  signedAtLabel,
}: IncidentFormProps) {
  const d = initial.data;
  const [criteria, setCriteria] = useState<string[]>(initial.criteria);
  const [occurredOn, setOccurredOn] = useState(initial.occurredOn);
  const [location, setLocation] = useState(initial.location);
  const [driverUserId, setDriverUserId] = useState(initial.driverUserId);
  const [driver, setDriver] = useState<IncidentParty>(d.driver);
  const [vehicles, setVehicles] = useState(d.vehicles);
  const [passengerPresent, setPassengerPresent] = useState<YesNo>(
    d.passenger.present,
  );
  const [passengerInjuries, setPassengerInjuries] = useState<YesNo>(
    d.passenger.injuries,
  );
  const [passengerSignedIn, setPassengerSignedIn] = useState<YesNo>(
    d.passenger.signedIn,
  );
  const [otherPresent, setOtherPresent] = useState<YesNo>(d.other.present);
  const [otherSignedIn, setOtherSignedIn] = useState<YesNo>(d.other.signedIn);
  const [resign, setResign] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [intent, setIntent] = useState<"draft" | "final">("draft");
  const lastPrefill = useRef("");

  const injury = incidentHasInjury(criteria, {
    driver,
    passenger: {
      ...d.passenger,
      present: passengerPresent,
      injuries: passengerInjuries,
    },
    other: { ...d.other, present: otherPresent },
  });
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(occurredOn);
  const due = dateOk ? incidentDueOn(occurredOn, injury) : null;

  function pickDriver(userId: string) {
    setDriverUserId(userId);
    const person = roster.find((r) => r.id === userId);
    if (!person) return;
    setDriver((cur) => ({
      ...cur,
      name: person.name,
      address: person.address,
      phone: person.phone,
      email: person.email,
      signedIn: person.checkedIn ? "yes" : cur.signedIn,
    }));
    // Fill in the car unless something else has been typed there.
    if (!vehicles.trim() || vehicles === lastPrefill.current)
      setVehicles(person.vehicle);
    lastPrefill.current = person.vehicle;
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const want = submitter?.value === "final" ? "final" : "draft";
    const fd = new FormData(e.currentTarget);
    fd.set("intent", want);
    setIntent(want);
    start(async () => {
      const result = await saveIncident(fd);
      if (!result) return; // a new report redirects to its own page
      if (!result.ok) {
        setError(result.error);
        setMissing([]);
        toast("The report was not saved", "bad");
        return;
      }
      setError(null);
      setMissing(result.data?.missing ?? []);
      setResign(false);
      toast(result.message ?? "Saved");
    });
  }

  const set =
    (key: keyof IncidentParty) => (e: { target: { value: string } }) =>
      setDriver((cur) => ({ ...cur, [key]: e.target.value }));
  const sketchKey = `${initial.sketch?.length ?? 0}:${initial.sketch?.slice(-16) ?? ""}`;
  const pickedDriver = roster.find((r) => r.id === driverUserId);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {id ? <input type="hidden" name="id" value={id} /> : null}

      <Section
        title="Does this need a report?"
        hint="PCA requires an Incident Report whenever any of these happen. Check every one that applies."
      >
        <ul className="space-y-1">
          {INCIDENT_CRITERIA.map((c) => (
            <li key={c.key}>
              <label className="flex cursor-pointer items-start gap-3 rounded-[10px] px-1 py-2.5 hover:bg-paper">
                <input
                  type="checkbox"
                  name="criteria"
                  value={c.key}
                  checked={criteria.includes(c.key)}
                  onChange={(e) =>
                    setCriteria((cur) =>
                      e.target.checked
                        ? [...cur, c.key]
                        : cur.filter((k) => k !== c.key),
                    )
                  }
                  className="check mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">
                    {c.label}
                  </span>
                  <span className="block text-sm text-ink-2">{c.help}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {criteria.length ? (
          <Notice
            tone={injury ? "bad" : "warn"}
            title="A report is required"
            className="mt-3"
          >
            {due ? (
              <>
                Due at PCA by <strong>{dayLong(due)}</strong>:{" "}
                {injury
                  ? "the next business day, because there is bodily injury."
                  : "five business days after the incident."}
              </>
            ) : (
              "Enter the date of the incident to see when it is due."
            )}{" "}
            File one report per car.
          </Notice>
        ) : (
          <Notice tone="neutral" className="mt-3">
            Nothing is checked, so PCA does not require a report. You can still
            record what happened here for the region&apos;s own files.
          </Notice>
        )}
      </Section>

      <Section n="1" title="Event">
        <div className={grid2}>
          <Field label="PCA region">
            <input name="region" defaultValue={d.region} className="ctl" />
          </Field>
          <Field label="Name of event chair">
            <input
              name="eventChair"
              defaultValue={d.eventChair}
              className="ctl"
            />
          </Field>
          <Field label="Telephone">
            <input
              name="chairPhone"
              defaultValue={d.chairPhone}
              className="ctl"
              inputMode="tel"
            />
          </Field>
          <Field label="Email">
            <input
              name="chairEmail"
              defaultValue={d.chairEmail}
              className="ctl"
              inputMode="email"
            />
          </Field>
          <Field
            label="Location"
            hint="Venue, street, city and state."
            className="sm:col-span-2"
          >
            <input
              name="locationAddress"
              defaultValue={d.locationAddress}
              className="ctl"
            />
          </Field>
          <Field label="Type of event">
            <input
              name="eventType"
              defaultValue={d.eventType}
              className="ctl"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date of incident">
              <input
                type="date"
                name="occurredOn"
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
                className="ctl"
              />
            </Field>
            <Field label="Time">
              <input
                type="time"
                name="occurredTime"
                defaultValue={initial.occurredTime}
                className="ctl"
              />
            </Field>
          </div>
        </div>
        <div className="mt-4">
          <Field
            label="Where it happened"
            hint="Pick the nearest spot, then add detail such as “exit” or “braking zone”."
          >
            <input
              name="location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="ctl"
              maxLength={200}
              placeholder="Turn 5 exit"
            />
          </Field>
          <div
            className="mt-2 flex flex-wrap gap-2"
            role="group"
            aria-label="Quick picks for where it happened"
          >
            {locations.map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setLocation(loc)}
                className={cn(
                  "h-11 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                  location.startsWith(loc)
                    ? "border-ink bg-ink text-white"
                    : "border-line-strong bg-white text-ink-2 hover:border-ink hover:text-ink",
                )}
              >
                {loc}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section
        n="2"
        title="Driver"
        hint="One report per car. In a multiple-car incident, file a separate report for each car."
      >
        <input type="hidden" name="driverUserId" value={driverUserId} />
        <Field
          label="Pick from the roster"
          hint="Fills in the driver's contact details and car. Leave it on “Not on the roster” to type them in."
        >
          <select
            className="ctl"
            value={driverUserId}
            onChange={(e) => pickDriver(e.target.value)}
          >
            <option value="">Not on the roster</option>
            {roster.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
        <div className={cn(grid2, "mt-4")}>
          <Field label="Name of driver">
            <input
              name="driver.name"
              value={driver.name}
              onChange={set("name")}
              className="ctl"
              autoComplete="off"
            />
          </Field>
          <Field label="Telephone">
            <input
              name="driver.phone"
              value={driver.phone}
              onChange={set("phone")}
              className="ctl"
              inputMode="tel"
              autoComplete="off"
            />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <input
              name="driver.address"
              value={driver.address}
              onChange={set("address")}
              className="ctl"
              autoComplete="off"
            />
          </Field>
          <Field label="Email" className="sm:col-span-2">
            <input
              name="driver.email"
              value={driver.email}
              onChange={set("email")}
              className="ctl"
              inputMode="email"
              autoComplete="off"
            />
          </Field>
          <YesNoField
            name="driver.injuries"
            legend="Any injuries?"
            value={driver.injuries}
            onChange={(v) => setDriver((cur) => ({ ...cur, injuries: v }))}
          />
          <Field
            label="Who determined?"
            hint="For example, track medical staff."
          >
            <input
              name="driver.determinedBy"
              value={driver.determinedBy}
              onChange={set("determinedBy")}
              className="ctl"
            />
          </Field>
          <YesNoField
            name="driver.signedIn"
            legend="Was the driver a signed-in entrant?"
            value={driver.signedIn}
            onChange={(v) => setDriver((cur) => ({ ...cur, signedIn: v }))}
          />
          {driver.signedIn === "no" ? (
            <Field label="If no, please explain">
              <input
                name="driver.notSignedInExplain"
                value={driver.notSignedInExplain}
                onChange={set("notSignedInExplain")}
                className="ctl"
              />
            </Field>
          ) : null}
        </div>
      </Section>

      <Section n="3" title="Passenger">
        <YesNoField
          name="passenger.present"
          legend="Was there a passenger in the vehicle?"
          value={passengerPresent}
          onChange={setPassengerPresent}
        />
        {passengerPresent === "yes" ? (
          <div className="mt-4 space-y-4">
            <ContactInputs prefix="passenger" d={d.passenger} />
            <div className={grid2}>
              <YesNoField
                name="passenger.injuries"
                legend="Any injuries?"
                value={passengerInjuries}
                onChange={setPassengerInjuries}
              />
              <Field label="Who determined?">
                <input
                  name="passenger.determinedBy"
                  defaultValue={d.passenger.determinedBy}
                  className="ctl"
                />
              </Field>
              <YesNoField
                name="passenger.signedIn"
                legend="Was the passenger a signed-in entrant?"
                value={passengerSignedIn}
                onChange={setPassengerSignedIn}
              />
              {passengerSignedIn === "no" ? (
                <Field label="If no, please explain">
                  <input
                    name="passenger.notSignedInExplain"
                    defaultValue={d.passenger.notSignedInExplain}
                    className="ctl"
                  />
                </Field>
              ) : null}
            </div>
          </div>
        ) : null}
      </Section>

      <Section n="4" title="Other injured party">
        <YesNoField
          name="other.present"
          legend="Was there injury to any other party?"
          value={otherPresent}
          onChange={setOtherPresent}
        />
        {otherPresent === "yes" ? (
          <div className="mt-4 space-y-4">
            <ContactInputs prefix="other" d={d.other} />
            <div className={grid2}>
              <Field label="Who determined the injury?">
                <input
                  name="other.determinedBy"
                  defaultValue={d.other.determinedBy}
                  className="ctl"
                />
              </Field>
              <YesNoField
                name="other.signedIn"
                legend="Was the injured party a signed-in entrant?"
                value={otherSignedIn}
                onChange={setOtherSignedIn}
              />
              {otherSignedIn === "yes" ? (
                <Field
                  label="If yes, in what role?"
                  hint="For example photographer, caterer or corner worker."
                >
                  <input
                    name="other.role"
                    defaultValue={d.other.role}
                    className="ctl"
                  />
                </Field>
              ) : null}
              {otherSignedIn === "no" ? (
                <Field label="If no, please explain">
                  <input
                    name="other.notSignedInExplain"
                    defaultValue={d.other.notSignedInExplain}
                    className="ctl"
                  />
                </Field>
              ) : null}
            </div>
          </div>
        ) : null}
      </Section>

      <Section
        n="5"
        title="Signed waivers"
        hint="PCA asks for a photocopy of the signed waiver for every person named in this report, with the name and signature highlighted."
      >
        <label className="flex cursor-pointer items-start gap-3 py-1 text-[15px]">
          <input
            type="checkbox"
            name="waiversAttached"
            defaultChecked={d.waiversAttached}
            className="check mt-0.5"
          />
          <span>
            Signed waivers will be attached for everyone named in this report
          </span>
        </label>
        {pickedDriver ? (
          <p className="mt-2 text-sm">
            <Link
              href={`/admin/waivers/person/${pickedDriver.id}`}
              target="_blank"
              className="font-semibold underline underline-offset-4"
            >
              Open {pickedDriver.name}&apos;s signed waivers
            </Link>{" "}
            <span className="text-ink-2">
              (opens in a new tab so nothing here is lost)
            </span>
          </p>
        ) : null}
      </Section>

      <Section
        n="6"
        title="Automobile involved"
        hint="Make, year, model, color and body style."
      >
        <textarea
          name="vehicles"
          value={vehicles}
          onChange={(e) => setVehicles(e.target.value)}
          className="ctl"
          rows={3}
          aria-label="Automobile involved"
        />
      </Section>

      <Section
        n="7"
        title="What happened"
        hint="Describe the incident, including the nature of any injuries, damage to the car, and any property damage."
      >
        <textarea
          name="description"
          defaultValue={d.description}
          className="ctl"
          rows={7}
          aria-label="Description of the incident"
        />
        <Field
          label="One-line summary"
          hint="Shown in the incident list. Not part of the PCA form."
          className="mt-4"
          optional
        >
          <input
            name="summary"
            defaultValue={initial.summary}
            className="ctl"
            maxLength={240}
          />
        </Field>
      </Section>

      <Section
        n="8"
        title="Transport"
        hint="Only if injuries required transport. Record each person taken to hospital."
      >
        <div className={grid2}>
          <Field label="Name of person transported">
            <input
              name="transport.name"
              defaultValue={d.transport.name}
              className="ctl"
            />
          </Field>
          <Field label="Name of hospital">
            <input
              name="transport.hospital"
              defaultValue={d.transport.hospital}
              className="ctl"
            />
          </Field>
          <Field label="Hospital address" hint="City, state and ZIP.">
            <input
              name="transport.address"
              defaultValue={d.transport.address}
              className="ctl"
            />
          </Field>
          <Field label="Hospital telephone">
            <input
              name="transport.phone"
              defaultValue={d.transport.phone}
              className="ctl"
              inputMode="tel"
            />
          </Field>
        </div>
        <fieldset className="mt-4">
          <legend className="mb-1.5 text-sm font-semibold">Check one</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {(
              [
                ["outpatient", "Outpatient emergency room"],
                ["admitted", "Admitted"],
                ["", "No one was transported"],
              ] as const
            ).map(([value, label]) => (
              <label
                key={label}
                className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]"
              >
                <input
                  type="radio"
                  name="transport.disposition"
                  value={value}
                  defaultChecked={d.transport.disposition === value}
                  className="check"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </Section>

      <Section
        n="9"
        title="Sketch of the incident"
        hint="Draw the path the car took and mark where it came to rest. For something that happened off the circuit, sketch in the open space beside it."
      >
        <SketchPad
          key={sketchKey}
          name="sketch"
          shape={shape}
          existing={initial.sketch}
        />
      </Section>

      <Section n="10" title="Additional comments">
        <textarea
          name="comments"
          defaultValue={d.comments}
          className="ctl"
          rows={4}
          aria-label="Additional comments"
        />
      </Section>

      <Section n="11" title="Report prepared by">
        <div className={grid2}>
          <Field label="Name">
            <input
              name="preparedBy.name"
              defaultValue={d.preparedBy.name}
              className="ctl"
            />
          </Field>
          <Field label="Title">
            <input
              name="preparedBy.title"
              defaultValue={d.preparedBy.title}
              className="ctl"
            />
          </Field>
          <Field label="Telephone (work)">
            <input
              name="preparedBy.phoneWork"
              defaultValue={d.preparedBy.phoneWork}
              className="ctl"
              inputMode="tel"
            />
          </Field>
          <Field label="Telephone (home)" optional>
            <input
              name="preparedBy.phoneHome"
              defaultValue={d.preparedBy.phoneHome}
              className="ctl"
              inputMode="tel"
            />
          </Field>
          <Field label="Fax" optional>
            <input
              name="preparedBy.fax"
              defaultValue={d.preparedBy.fax}
              className="ctl"
              inputMode="tel"
            />
          </Field>
          <Field label="Email">
            <input
              name="preparedBy.email"
              defaultValue={d.preparedBy.email}
              className="ctl"
              inputMode="email"
            />
          </Field>
        </div>
        <div className="mt-4">
          <p className="mb-1.5 text-sm font-semibold">Signature</p>
          {d.preparedBy.signature && !resign ? (
            <div className="flex flex-wrap items-center gap-3">
              <SignatureImage
                src={d.preparedBy.signature}
                alt={`Signature of ${d.preparedBy.name || "the preparer"}`}
              />
              <div className="text-sm text-ink-2">
                {signedAtLabel ? <p>Signed {signedAtLabel}</p> : null}
                <button
                  type="button"
                  onClick={() => setResign(true)}
                  className="mt-1 inline-flex h-11 items-center font-semibold text-ink underline underline-offset-4"
                >
                  Sign again
                </button>
              </div>
            </div>
          ) : (
            <SignaturePad
              name="preparedBy.signature"
              label="Preparer signs here"
            />
          )}
        </div>
      </Section>

      {missing.length ? (
        <Notice tone="warn" title="Saved as a draft. To mark it final, add:">
          <ul className="mt-1 list-disc pl-5">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}

      <div className="no-print sticky bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom))] z-30 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur-md sm:mx-0 sm:rounded-[14px] sm:border lg:bottom-4">
        <p className="mr-auto hidden text-sm text-ink-2 sm:block">
          {status === "sent"
            ? "Already sent to PCA. Changes are saved to the record."
            : status === "final"
              ? "Final. Changes keep it final if nothing required is removed."
              : "Drafts can be saved with gaps."}
        </p>
        {status === "sent" ? (
          <SaveButton
            value="final"
            pending={pending && intent === "final"}
            disabled={pending}
            primary
          >
            Save changes
          </SaveButton>
        ) : (
          <>
            <SaveButton
              value="draft"
              pending={pending && intent === "draft"}
              disabled={pending}
            >
              {status === "final" ? "Move back to draft" : "Save draft"}
            </SaveButton>
            <SaveButton
              value="final"
              pending={pending && intent === "final"}
              disabled={pending}
              primary
            >
              {status === "final" ? "Save changes" : "Mark final"}
            </SaveButton>
          </>
        )}
      </div>
    </form>
  );
}

function SaveButton({
  value,
  pending,
  disabled,
  primary,
  children,
}: {
  value: string;
  pending: boolean;
  disabled: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      name="intent"
      value={value}
      disabled={disabled}
      className={buttonClass(
        primary ? "primary" : "secondary",
        "md",
        "flex-1 sm:flex-none",
      )}
    >
      {pending ? (
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
      ) : null}
      {children}
    </button>
  );
}
