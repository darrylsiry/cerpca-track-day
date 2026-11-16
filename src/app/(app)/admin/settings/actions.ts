"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema as s } from "@/db";
import type { ActionResult, OrgSettings } from "@/lib/types";
import { requireAdmin } from "@/server/auth";
import { asFailure, fail, ok, str } from "@/server/util";

export async function saveRegionSettings(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const earliest = Number(str(fd, "earliestDays"));
    const latest = Number(str(fd, "latestDays"));
    if (!(earliest > 0) || !(latest >= 0) || latest >= earliest)
      return fail(
        "The inspection window needs an earliest day count larger than the latest (for example 28 and 14).",
      );
    const offsets = [
      ...new Set(
        str(fd, "reminderOffsets")
          .split(/[,\s]+/)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0 && n <= 120),
      ),
    ].sort((a, b) => b - a);
    if (!offsets.length)
      return fail(
        "Enter at least one reminder time in minutes, for example 15, 10, 5.",
      );

    const roles = fd.getAll("recipientRole").map(String);
    const names = fd.getAll("recipientName").map(String);
    const emails = fd.getAll("recipientEmail").map(String);
    const recipients = roles
      .map((role, i) => ({
        role: role.trim(),
        name: names[i]?.trim() || undefined,
        email: (emails[i] ?? "").trim(),
      }))
      .filter((r) => r.role || r.email);
    const bad = recipients.find(
      (r) => r.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email),
    );
    if (bad) return fail(`“${bad.email}” is not a valid email address.`);

    const settings: OrgSettings = {
      incidentRecipients: recipients,
      eventChair: {
        name: str(fd, "chairName"),
        phone: str(fd, "chairPhone") || undefined,
        email: str(fd, "chairEmail") || undefined,
      },
      techWindow: { earliestDays: earliest, latestDays: latest },
      reminderOffsets: offsets,
    };
    const db = await getDb();
    await db
      .update(s.organizations)
      .set({
        settings,
        name: str(fd, "orgName") || v.org.name,
        shortName: str(fd, "orgShort") || v.org.shortName,
        website: str(fd, "website") || null,
      })
      .where(eq(s.organizations.id, v.org.id));
    refresh();
    return ok("Settings saved");
  } catch (err) {
    return asFailure(err);
  }
}

export async function saveGroup(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const name = str(fd, "name");
    if (!name) return fail("The run group needs a name.");
    const hex = /^#[0-9a-fA-F]{6}$/;
    const color = str(fd, "color");
    const textColor = str(fd, "textColor");
    if (!hex.test(color) || !hex.test(textColor))
      return fail("Pick the colours with the colour pickers.");
    const policy = str(fd, "instructorPolicy");
    const db = await getDb();
    await db
      .update(s.runGroups)
      .set({
        name,
        summary: str(fd, "summary"),
        description: str(fd, "description"),
        color,
        textColor,
        instructorPolicy: ["required", "optional", "none"].includes(policy)
          ? policy
          : "none",
        passingKey: str(fd, "passingKey") || null,
      })
      .where(
        and(eq(s.runGroups.id, str(fd, "id")), eq(s.runGroups.orgId, v.org.id)),
      );
    refresh();
    return ok("Run group saved");
  } catch (err) {
    return asFailure(err);
  }
}
