"use client";

import { LoaderCircle } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { SignaturePad } from "@/components/signature-pad";
import { toast } from "@/components/toast";
import { buttonClass, Field, Notice } from "@/components/ui";
import { signWaiver } from "./actions";

/**
 * Agree, type your name, draw your signature. Submitted by hand rather than as
 * a form action so a rejected attempt keeps the name and the drawn signature.
 */
export function SignWaiverForm({ templateId, defaultName }: { templateId: string; defaultName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!fd.get("agree")) return setError("Tick the box to confirm you have read and understand the document.");
    if (!String(fd.get("signature") ?? "")) return setError("Draw your signature in the box.");
    start(async () => {
      const result = await signWaiver(fd);
      if (result.ok) {
        setError(null);
        toast(result.message ?? "Waiver signed");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <input type="hidden" name="templateId" value={templateId} />
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[15px] font-semibold">
        <input type="checkbox" name="agree" className="check mt-0.5" />
        <span>I have read and understand this document</span>
      </label>
      <Field label="Full legal name" hint="Type it exactly as it appears on your driver's license.">
        <input name="signedName" defaultValue={defaultName} className="ctl" autoComplete="name" required />
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-semibold">Signature</p>
        <SignaturePad name="signature" />
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "w-full sm:w-auto")}>
        {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? "Signing…" : "Sign this waiver"}
      </button>
      <p className="text-[13px] text-ink-2">Your name, signature, the time and the device you signed on are recorded with this event.</p>
    </form>
  );
}
