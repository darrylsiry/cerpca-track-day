"use client";

import { Check, Copy, ExternalLink, LoaderCircle, Mail, Send, Upload } from "lucide-react";
import { useState } from "react";
import { ActionButton, ActionForm, SubmitButton, useSubmit } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { SignaturePad } from "@/components/signature-pad";
import { toast } from "@/components/toast";
import { buttonClass, Field, Notice } from "@/components/ui";
import { cn } from "@/lib/cn";
import { DRIVER_CERTIFICATION } from "@/lib/tech-form";
import type { ActionResult } from "@/lib/types";
import { cancelShopRequest, inviteShop, saveCarDetails, signAndSubmit, uploadPaperForm, type InviteState } from "./actions";

/* ───────────── Step 1: car and driver ───────────── */

export type CarDefaults = {
  year: string;
  make: string;
  model: string;
  color: string;
  carNumber: string;
  emergency1: string;
  driver2Name: string;
  emergency2: string;
};

export function CarForm({ defaults, carLocked, submitLabel }: { defaults: CarDefaults; carLocked: boolean; submitLabel: string }) {
  const [second, setSecond] = useState(Boolean(defaults.driver2Name));
  return (
    <ActionForm action={saveCarDetails} className="space-y-4">
      {carLocked ? (
        <Notice tone="neutral">
          The car can&apos;t be changed once the form has gone to the shop, because the shop signs for this specific car. To enter a different car, cancel the shop request
          first.
        </Notice>
      ) : (
        <div className="grid grid-cols-6 gap-3">
          <Field label="Year" className="col-span-2">
            <input name="year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} required defaultValue={defaults.year} className="ctl timing" placeholder="2019" />
          </Field>
          <Field label="Make" className="col-span-4">
            <input name="make" required defaultValue={defaults.make} className="ctl" placeholder="Porsche" autoComplete="off" />
          </Field>
          <Field label="Model" className="col-span-6 sm:col-span-3">
            <input name="model" required defaultValue={defaults.model} className="ctl" placeholder="718 Cayman" autoComplete="off" />
          </Field>
          <Field label="Color" className="col-span-4 sm:col-span-2">
            <input name="color" defaultValue={defaults.color} className="ctl" autoComplete="off" />
          </Field>
          <Field label="Car #" className="col-span-2 sm:col-span-1">
            <input name="carNumber" required maxLength={4} defaultValue={defaults.carNumber} className="ctl timing" autoComplete="off" />
          </Field>
        </div>
      )}
      <Field label="Emergency contact and phone" hint="Someone who is not riding with you.">
        <input name="emergency1" required minLength={5} defaultValue={defaults.emergency1} className="ctl" placeholder="Name, (912) 555-0100" />
      </Field>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] font-semibold">
        <input type="checkbox" className="check" checked={second} onChange={(e) => setSecond(e.target.checked)} />A second driver is sharing this car
      </label>
      {second ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Second driver">
            <input name="driver2Name" required defaultValue={defaults.driver2Name} className="ctl" autoComplete="off" />
          </Field>
          <Field label="Their emergency contact and phone">
            <input name="emergency2" required minLength={5} defaultValue={defaults.emergency2} className="ctl" />
          </Field>
        </div>
      ) : null}
      <SubmitButton className="w-full sm:w-auto" pendingLabel="Saving…">
        {submitLabel}
      </SubmitButton>
    </ActionForm>
  );
}

/* ───────────── Step 2: the shop ───────────── */

export type ShopOption = { id: string; name: string; city: string | null; contactName: string | null };

export type ShopStepProps = {
  status: string;
  method: string;
  shops: ShopOption[];
  current: {
    shopId: string | null;
    shopName: string | null;
    shopEmail: string | null;
    shopPhone: string | null;
    mechanicName: string | null;
    invitedAt: string | null;
    expires: string | null;
    expired: boolean;
  };
  today: string;
  paperFormHref: string | null;
  /** Start with the "do it again" options open (after the reviewer asks for changes). */
  redoOpen?: boolean;
};

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
      <input readOnly value={link} aria-label="Link for your shop" className="ctl timing min-w-0 flex-1 text-sm" onFocus={(e) => e.currentTarget.select()} />
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass("primary", "md", "flex-1 sm:flex-none")}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              toast("Link copied");
              setTimeout(() => setCopied(false), 2500);
            } catch {
              toast("Could not copy. Select the link and copy it by hand.", "bad");
            }
          }}
        >
          {copied ? <Check className="size-4" strokeWidth={3} /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy link"}
        </button>
        <a href={link} target="_blank" rel="noreferrer" className={buttonClass("secondary", "md")} aria-label="Open the shop page in a new tab">
          <ExternalLink className="size-4" />
        </a>
      </div>
    </div>
  );
}

function InviteFields({ shops, current, pending }: Pick<ShopStepProps, "shops" | "current"> & { pending: boolean }) {
  const known = current.shopId && shops.some((x) => x.id === current.shopId) ? current.shopId : "";
  const [shopId, setShopId] = useState(known || (current.shopName && !known ? "other" : (shops[0]?.id ?? "other")));
  const [custom, setCustom] = useState({
    shopName: known ? "" : (current.shopName ?? ""),
    shopEmail: known ? "" : (current.shopEmail ?? ""),
    shopPhone: known ? "" : (current.shopPhone ?? ""),
  });
  const [mechanicName, setMechanicName] = useState(current.mechanicName ?? "");
  const other = shopId === "other";
  const set = (k: keyof typeof custom) => (e: React.ChangeEvent<HTMLInputElement>) => setCustom((c) => ({ ...c, [k]: e.target.value }));

  return (
    <div className="space-y-3">
      <Field label="Shop">
        <select name="shopId" className="ctl" value={shopId} onChange={(e) => setShopId(e.target.value)}>
          {shops.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.city ? ` (${x.city})` : ""}
            </option>
          ))}
          <option value="other">Another shop…</option>
        </select>
      </Field>
      {other ? (
        <>
          <Field label="Shop name">
            <input name="shopName" required className="ctl" value={custom.shopName} onChange={set("shopName")} autoComplete="organization" />
          </Field>
          <Field label="Shop email" hint="The link goes to this address. Use the shop's own address, not yours.">
            <input name="shopEmail" type="email" inputMode="email" required className="ctl" value={custom.shopEmail} onChange={set("shopEmail")} autoComplete="off" placeholder="service@yourshop.com" />
          </Field>
          <Field label="Shop phone" optional>
            <input name="shopPhone" type="tel" inputMode="tel" className="ctl" value={custom.shopPhone} onChange={set("shopPhone")} autoComplete="off" />
          </Field>
          <p className="text-[13px] text-ink-2">
            A shop the region has not worked with before shows as &quot;not verified&quot; until the tech team confirms it. That does not stop you submitting.
          </p>
        </>
      ) : (
        <p className="text-[13px] text-ink-2">The link is emailed to the address the region has on file for this shop.</p>
      )}
      <Field label="Technician" optional hint="If you know who will inspect the car.">
        <input name="mechanicName" className="ctl" value={mechanicName} onChange={(e) => setMechanicName(e.target.value)} autoComplete="off" />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass("primary", "md", "w-full")}>
        {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" />}
        {pending ? "Sending…" : "Send link to shop"}
      </button>
    </div>
  );
}

function UploadFields({ current, today }: Pick<ShopStepProps, "current" | "today">) {
  return (
    <div className="space-y-3">
      <Field label="Photo or PDF of the completed form" hint="The whole page, flat and in focus, with the shop stamp and signature visible. 6 MB at most.">
        <input
          name="file"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
          className="ctl file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white"
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Shop that stamped it">
          <input name="shopName" required className="ctl" defaultValue={current.shopName ?? ""} autoComplete="organization" />
        </Field>
        <Field label="Inspection date">
          <input name="inspectionDate" type="date" required max={today} className="ctl" />
        </Field>
      </div>
      <SubmitButton className="w-full" pendingLabel="Uploading…">
        <Upload className="size-4" /> Upload form
      </SubmitButton>
      <p className="text-[13px] text-ink-2">Bring the original to the track. Tech personnel may ask to see it.</p>
    </div>
  );
}

export function ShopStep({ status, method, shops, current, today, paperFormHref, redoOpen }: ShopStepProps) {
  // One action state for the whole step, so a freshly created link survives the
  // re-render that moves this step from "choose" to "waiting on the shop".
  // Submitted by hand so a refused send leaves the shop picker on what was chosen.
  const [invite, sendInvite, invitePending] = useSubmit<InviteState>(inviteShop, null);
  const inviteError = invite && !invite.ok ? invite.error : null;
  const freshLink = invite?.ok ? invite.link : undefined;

  const choices = (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-[12px] border border-line p-4">
        <h3 className="flex items-center gap-2 text-base font-bold">
          <Mail className="size-4.5" /> Send it to my shop
        </h3>
        <p className="mt-1 mb-3 text-sm text-ink-2">Your shop fills in the checklist and signs on their own phone or computer. Nothing to print, nothing to carry to the track.</p>
        <form onSubmit={sendInvite}>
          <InviteFields shops={shops} current={current} pending={invitePending} />
          {inviteError ? (
            <Notice tone="bad" className="mt-3">
              {inviteError}
            </Notice>
          ) : null}
        </form>
      </section>
      <section className="rounded-[12px] border border-line p-4">
        <h3 className="flex items-center gap-2 text-base font-bold">
          <Upload className="size-4.5" /> Upload the paper form
        </h3>
        <p className="mt-1 mb-3 text-sm text-ink-2">
          Already had the paper form filled in and stamped? Upload it here so the tech team can check it before the event.
          {paperFormHref ? (
            <>
              {" "}
              <a href={paperFormHref} target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-4">
                Get the blank form
              </a>
              .
            </>
          ) : null}
        </p>
        <ActionForm action={uploadPaperForm} closeOnSuccess={false}>
          <UploadFields current={current} today={today} />
        </ActionForm>
      </section>
    </div>
  );

  if (status === "draft") return choices;

  if (status === "with_shop") {
    return (
      <div className="space-y-4">
        <div className={cn("rounded-[12px] px-4 py-3.5", current.expired ? "bg-bad-soft" : "bg-info-soft")}>
          <p className="font-bold">{current.expired ? `The link sent to ${current.shopName} has expired` : `Waiting on ${current.shopName ?? "your shop"}`}</p>
          <p className="mt-0.5 text-[15px]">
            {current.invitedAt ? `Link sent ${current.invitedAt}. ` : ""}
            {current.expired ? "Send a new one so the shop can finish." : `It works once${current.expires ? ` and expires ${current.expires}` : ""}. You'll get an alert here when the shop signs.`}
          </p>
        </div>

        {invite?.ok ? (
          invite.emailed ? (
            <Notice tone="good" title={`Link emailed to ${invite.shopName}`}>
              It went to {invite.sentTo}. Ask the shop to check their inbox, including spam.
            </Notice>
          ) : freshLink ? (
            <Notice tone="warn" title="The email was not sent">
              Email is not set up in this environment, so nothing went to {invite.sentTo}. Copy this link and text or email it to your shop yourself.
              <CopyLink link={freshLink} />
            </Notice>
          ) : null
        ) : null}
        {inviteError ? <Notice tone="bad">{inviteError}</Notice> : null}

        <div className="flex flex-wrap gap-2">
          <form onSubmit={sendInvite}>
            <input type="hidden" name="shopId" value={current.shopId && shops.some((x) => x.id === current.shopId) ? current.shopId : "other"} />
            <input type="hidden" name="shopName" value={current.shopName ?? ""} />
            <input type="hidden" name="shopEmail" value={current.shopEmail ?? ""} />
            <input type="hidden" name="shopPhone" value={current.shopPhone ?? ""} />
            <input type="hidden" name="mechanicName" value={current.mechanicName ?? ""} />
            <button type="submit" disabled={invitePending} className={buttonClass("secondary", "md")}>
              {invitePending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" />} Send a new link
            </button>
          </form>
          <ActionButton action={cancelShopRequest} variant="ghost" confirm="Cancel this request? The link sent to the shop will stop working.">
            Cancel request
          </ActionButton>
        </div>
        <p className="text-[13px] text-ink-2">Sending a new link replaces the old one. Cancel if you want to use a different shop or upload a paper form instead.</p>
      </div>
    );
  }

  // The shop's part is on file. Offer a way to do it again where that still makes sense.
  if (status === "shop_signed" || status === "changes_requested") {
    return redoOpen ? (
      <div>
        <p className="mb-3 text-[15px] text-ink-2">
          {method === "paper" ? "Upload a corrected form, or switch to having your shop sign online." : "Send the form back to your shop to update. What they entered before is kept, so they only change what needs changing."}
        </p>
        {choices}
      </div>
    ) : (
      <Sheet
        trigger={method === "paper" ? "Replace the upload or use a shop link" : "Send it back to the shop"}
        triggerClassName={buttonClass("secondary", "sm")}
        title="Redo the shop inspection"
        description="Use this if something on the form is wrong or missing. Your shop's earlier answers are kept so they only change what needs changing."
        wide
      >
        {choices}
      </Sheet>
    );
  }
  return null;
}

/* ───────────── Step 3: the driver's signature ───────────── */

export function SignForm({ defaultName }: { defaultName: string }) {
  const [state, submit, pending] = useSubmit<ActionResult | null>(signAndSubmit, null);
  // Held in state (not just in the form) so a rejected submit doesn't wipe what was typed and drawn.
  const [name, setName] = useState(defaultName);
  const [signature, setSignature] = useState("");
  const [certify, setCertify] = useState(false);
  const ready = name.trim().length >= 3 && signature !== "" && certify;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="max-h-72 overflow-y-auto rounded-[10px] border border-line bg-paper px-4 py-3 text-[15px] leading-relaxed">
        <p className="font-bold">The undersigned hereby certifies that:</p>
        <ol className="mt-2 list-decimal space-y-2.5 pl-5">
          {DRIVER_CERTIFICATION.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ol>
      </div>
      <label className="flex cursor-pointer items-start gap-3 text-[15px] font-semibold">
        <input type="checkbox" name="certify" className="check mt-0.5" checked={certify} onChange={(e) => setCertify(e.target.checked)} />
        <span>I have read these three statements and certify that they are true.</span>
      </label>
      <Field label="Full name" hint="Typed, as it appears on your registration.">
        <input name="signedName" required className="ctl" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-semibold">Signature</p>
        <SignaturePad name="signature_pad" label="Driver signature" onChange={setSignature} />
        <input type="hidden" name="signature" value={signature} />
      </div>
      {state && !state.ok ? <Notice tone="bad">{state.error}</Notice> : null}
      <button type="submit" disabled={pending || !ready} className={buttonClass("primary", "lg", "w-full")}>
        {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? "Submitting…" : "Sign and submit to the tech team"}
      </button>
      {!ready ? <p className="text-center text-[13px] text-ink-2">Tick the box, type your name and sign to submit.</p> : null}
    </form>
  );
}
