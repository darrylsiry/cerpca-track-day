"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema as s } from "@/db";
import type { ActionResult } from "@/lib/types";
import { clientIp, clientUserAgent, getViewer } from "@/server/auth";
import { asFailure, bool, fail, ok, sha256, str } from "@/server/util";

const Signing = z.object({
  templateId: z.string().min(1),
  signedName: z
    .string()
    .trim()
    .min(3, "Type your full legal name, first and last.")
    .max(120, "That name is too long.")
    .regex(/\S\s+\S/, "Type your full legal name, first and last."),
  signature: z.string().startsWith("data:image/", "Draw your signature in the box.").max(1_500_000, "The signature could not be read. Clear it and sign again."),
});

/** Sign one document for the event in focus. Signing again replaces the earlier signature. */
export async function signWaiver(formData: FormData): Promise<ActionResult> {
  const v = await getViewer();
  try {
    if (!v.event) return fail("There is no event to sign for yet.");
    if (!bool(formData, "agree")) return fail("Tick the box to confirm you have read and understand the document.");
    const parsed = Signing.safeParse({ templateId: str(formData, "templateId"), signedName: str(formData, "signedName"), signature: str(formData, "signature") });
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check your name and signature.");

    const db = await getDb();
    const [template] = await db
      .select()
      .from(s.waiverTemplates)
      .where(and(eq(s.waiverTemplates.id, parsed.data.templateId), eq(s.waiverTemplates.orgId, v.org.id), eq(s.waiverTemplates.active, true)))
      .limit(1);
    if (!template) return fail("That document is no longer in use. Go back to the list of waivers.");

    const signed = {
      templateVersion: template.version,
      signedName: parsed.data.signedName,
      signatureData: parsed.data.signature,
      // Fingerprint of the exact wording on screen, so a later edit can't change what was agreed to.
      bodyHash: sha256(template.body),
      ip: await clientIp(),
      userAgent: await clientUserAgent(),
      signedAt: new Date(),
    };
    await db
      .insert(s.waiverSignatures)
      .values({ templateId: template.id, eventId: v.event.id, userId: v.user.id, ...signed })
      .onConflictDoUpdate({ target: [s.waiverSignatures.templateId, s.waiverSignatures.eventId, s.waiverSignatures.userId], set: signed });
  } catch (err) {
    return asFailure(err);
  }
  refresh();
  return ok("Waiver signed");
}
