"use client";

import { Pencil } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { toast } from "@/components/toast";
import { buttonClass, Field } from "@/components/ui";
import { cn } from "@/lib/cn";
import { setNotificationPref, updateCar, updateContact } from "./actions";

const SHIRTS = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];

const editTrigger = (
  <>
    <Pencil className="size-3.5" aria-hidden /> Edit
  </>
);

export type ContactValues = {
  email: string;
  phone: string;
  address1: string;
  city: string;
  state: string;
  zip: string;
  emergencyName: string;
  emergencyPhone: string;
  tshirtSize: string;
  pcaMemberNumber: string;
};

export function ContactSheet({ values }: { values: ContactValues }) {
  return (
    <Sheet trigger={editTrigger} triggerLabel="Edit your details" triggerClassName={buttonClass("secondary", "sm")} title="Your details" description="The organizers use these to reach you and, if it ever comes to it, your emergency contact.">
      <ActionForm action={updateContact} className="space-y-4">
        <Field label="Email" hint="This is how you sign in. Ask the registrar if it needs to change.">
          <input className="ctl" value={values.email} readOnly />
        </Field>
        <Field label="Mobile phone" hint="Needed if you want text alerts." optional>
          <input name="phone" type="tel" autoComplete="tel" inputMode="tel" className="ctl" defaultValue={values.phone} />
        </Field>
        <Field label="Street address" optional>
          <input name="address1" autoComplete="address-line1" className="ctl" defaultValue={values.address1} />
        </Field>
        <div className="grid grid-cols-[1fr_5rem_6.5rem] gap-3">
          <Field label="City">
            <input name="city" autoComplete="address-level2" className="ctl" defaultValue={values.city} />
          </Field>
          <Field label="State">
            <input name="state" autoComplete="address-level1" maxLength={2} className="ctl uppercase" defaultValue={values.state} />
          </Field>
          <Field label="ZIP">
            <input name="zip" autoComplete="postal-code" inputMode="numeric" className="ctl" defaultValue={values.zip} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Emergency contact">
            <input name="emergencyName" className="ctl" defaultValue={values.emergencyName} placeholder="Name" />
          </Field>
          <Field label="Their phone">
            <input name="emergencyPhone" type="tel" inputMode="tel" className="ctl" defaultValue={values.emergencyPhone} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="T-shirt size">
            <select name="tshirtSize" className="ctl" defaultValue={values.tshirtSize}>
              <option value="">Not chosen</option>
              {SHIRTS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </Field>
          <Field label="PCA member number" optional>
            <input name="pcaMemberNumber" inputMode="numeric" className="ctl" defaultValue={values.pcaMemberNumber} />
          </Field>
        </div>
        <SubmitButton className="w-full" pendingLabel="Saving…">
          Save details
        </SubmitButton>
      </ActionForm>
    </Sheet>
  );
}

export type CarValues = { year: string; make: string; model: string; color: string; carNumber: string };

export function CarSheet({ values, onRoster }: { values: CarValues; onRoster: boolean }) {
  return (
    <Sheet
      trigger={editTrigger}
      triggerLabel="Edit your car"
      triggerClassName={buttonClass("secondary", "sm")}
      title="Your car"
      description={onRoster ? "This is the car on the roster and on your tech inspection for this event." : "The car you usually bring to the track."}
    >
      <ActionForm action={updateCar} className="space-y-4">
        <div className="grid grid-cols-[6.5rem_1fr] gap-3">
          <Field label="Year">
            <input name="year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} className="ctl" defaultValue={values.year} placeholder="2019" />
          </Field>
          <Field label="Make">
            <input name="make" className="ctl" defaultValue={values.make} required placeholder="Porsche" />
          </Field>
        </div>
        <Field label="Model">
          <input name="model" className="ctl" defaultValue={values.model} required placeholder="911 Carrera S" />
        </Field>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Color" optional>
            <input name="color" className="ctl" defaultValue={values.color} />
          </Field>
          <Field label="Car number">
            <input name="carNumber" maxLength={4} autoCapitalize="characters" className="ctl" defaultValue={values.carNumber} />
          </Field>
        </div>
        {onRoster ? <p className="text-sm text-ink-2">Changing the number here changes it on this event&apos;s roster. It has to be unique at the event and match the numbers on your car.</p> : null}
        <SubmitButton className="w-full" pendingLabel="Saving…">
          Save car
        </SubmitButton>
      </ActionForm>
    </Sheet>
  );
}

type Channel = "email" | "sms" | "push";

/** Three switches that save as soon as they are flipped. */
export function NotificationPrefs({ email, sms, push, hasPhone, emailAddress, phone }: { email: boolean; sms: boolean; push: boolean; hasPhone: boolean; emailAddress: string; phone: string }) {
  const [state, setOptimistic] = useOptimistic({ email, sms, push }, (cur, change: { channel: Channel; on: boolean }) => ({ ...cur, [change.channel]: change.on }));
  const [pending, start] = useTransition();

  const flip = (channel: Channel) => {
    const on = !state[channel];
    start(async () => {
      setOptimistic({ channel, on });
      const result = await setNotificationPref(channel, on);
      if (!result.ok) toast(result.error, "bad");
    });
  };

  const rows: { channel: Channel; title: string; detail: string; disabled?: boolean }[] = [
    { channel: "email", title: "Email", detail: `Announcements and paperwork updates, to ${emailAddress}.` },
    {
      channel: "sms",
      title: "Text message",
      detail: hasPhone ? `Urgent announcements and session reminders, to ${phone}.` : "Add a mobile number to your details to get texts.",
      disabled: !hasPhone,
    },
    { channel: "push", title: "Push notification", detail: "Session reminders and announcements on each device where you turn notifications on, below." },
  ];

  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => {
        const on = state[row.channel] && !row.disabled;
        return (
          <li key={row.channel} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-bold" id={`pref-${row.channel}`}>
                {row.title}
              </p>
              <p className="text-sm text-ink-2">{row.detail}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-labelledby={`pref-${row.channel}`}
              disabled={row.disabled || pending}
              onClick={() => flip(row.channel)}
              className={cn(
                "relative h-8 w-14 shrink-0 rounded-full border-2 transition-colors disabled:opacity-50",
                // extend the tap target to a full 44px without growing the switch
                "before:absolute before:-inset-x-1.5 before:-inset-y-2.5 before:content-['']",
                on ? "border-good bg-good" : "border-line-strong bg-sunk",
              )}
            >
              <span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow-sm transition-[left]", on ? "left-[1.625rem]" : "left-0.5")} />
              <span className="sr-only">{on ? "On" : "Off"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
