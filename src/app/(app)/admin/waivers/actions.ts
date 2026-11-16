"use server";

import { and, eq, max } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, schema as s } from "@/db";
import type { ActionResult } from "@/lib/types";
import { requireAdmin, requireEvent } from "@/server/auth";
import { notifyUsers } from "@/server/notify";
import { asFailure, bool, fail, ok, str } from "@/server/util";
import { waiverMatrix } from "@/server/waivers";

const Template = z.object({
  title: z
    .string()
    .trim()
    .min(3, "Give the document a title.")
    .max(160, "Keep the title under 160 characters."),
  summary: z.string().trim().max(300, "Keep the summary under 300 characters."),
  body: z
    .string()
    .trim()
    .min(20, "Paste the full wording of the document.")
    .max(
      60_000,
      "That document is too long to store. Trim it or split it in two.",
    ),
});

/** Add or edit a document drivers sign. Ticking "sign again" bumps its version. */
export async function saveTemplate(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const v = await requireAdmin();
  try {
    const parsed = Template.safeParse({
      title: str(formData, "title"),
      summary: str(formData, "summary"),
      body: String(formData.get("body") ?? ""),
    });
    if (!parsed.success)
      return fail(
        parsed.error.issues[0]?.message ?? "Check the title and wording.",
      );
    const db = await getDb();
    const id = str(formData, "id");
    const fields = {
      title: parsed.data.title,
      summary: parsed.data.summary || null,
      body: parsed.data.body,
      required: bool(formData, "required"),
      active: bool(formData, "active"),
      updatedAt: new Date(),
    };
    if (id) {
      const [existing] = await db
        .select()
        .from(s.waiverTemplates)
        .where(
          and(
            eq(s.waiverTemplates.id, id),
            eq(s.waiverTemplates.orgId, v.org.id),
          ),
        )
        .limit(1);
      if (!existing) return fail("That document no longer exists.");
      const resign = bool(formData, "resign");
      await db
        .update(s.waiverTemplates)
        .set({
          ...fields,
          version: resign ? existing.version + 1 : existing.version,
        })
        .where(eq(s.waiverTemplates.id, id));
      refresh();
      return ok(
        resign
          ? "Saved. Everyone will be asked to sign again."
          : "Document saved",
      );
    }
    const [{ top }] = await db
      .select({ top: max(s.waiverTemplates.sortOrder) })
      .from(s.waiverTemplates)
      .where(eq(s.waiverTemplates.orgId, v.org.id));
    await db
      .insert(s.waiverTemplates)
      .values({ ...fields, orgId: v.org.id, sortOrder: (top ?? -1) + 1 });
  } catch (err) {
    return asFailure(err);
  }
  refresh();
  return ok("Document added");
}

async function remind(
  userIds: string[],
  counts: Map<string, number>,
  v: Awaited<ReturnType<typeof requireEvent>>,
) {
  // One message per distinct count keeps the wording exact ("1 waiver" vs "2 waivers").
  const byCount = new Map<number, string[]>();
  for (const id of userIds) {
    const n = counts.get(id) ?? 0;
    if (n > 0) byCount.set(n, [...(byCount.get(n) ?? []), id]);
  }
  let recipients = 0;
  for (const [n, ids] of byCount) {
    const result = await notifyUsers({
      userIds: ids,
      title:
        n === 1 ? "You have a waiver to sign" : `You have ${n} waivers to sign`,
      body: `${n === 1 ? "One waiver is" : `${n} waivers are`} still unsigned for ${v.event.name}. Sign before you arrive; it takes about two minutes.`,
      href: "/me/waivers",
      kind: "waiver",
      eventId: v.event.id,
      channels: ["inapp", "email", "push"],
    });
    recipients += result.recipients;
  }
  return recipients;
}

export async function remindPerson(userId: string): Promise<ActionResult> {
  const v = await requireEvent("admin");
  try {
    const { rows } = await waiverMatrix(v.org.id, v.event.id);
    const row = rows.find((r) => r.person.user.id === userId);
    if (!row) return fail("That person is not on the roster for this event.");
    if (!row.outstanding)
      return fail(
        `${row.person.user.firstName} has signed everything that is required.`,
      );
    await remind([userId], new Map([[userId, row.outstanding]]), v);
    return ok(`Reminder sent to ${row.person.user.firstName}`);
  } catch (err) {
    return asFailure(err);
  }
}

export async function remindAllUnsigned(): Promise<ActionResult> {
  const v = await requireEvent("admin");
  try {
    const { rows } = await waiverMatrix(v.org.id, v.event.id);
    const pending = rows.filter((r) => r.outstanding > 0);
    if (!pending.length)
      return fail(
        "Everyone has signed the required waivers. No reminder was sent.",
      );
    const sent = await remind(
      pending.map((r) => r.person.user.id),
      new Map(pending.map((r) => [r.person.user.id, r.outstanding])),
      v,
    );
    return ok(`Reminder sent to ${sent} ${sent === 1 ? "person" : "people"}`);
  } catch (err) {
    return asFailure(err);
  }
}
