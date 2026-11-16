"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema as s } from "@/db";
import {
  emptyParty,
  finalProblems,
  INCIDENT_CRITERIA,
  incidentDueOn,
  incidentHasInjury,
  type SaveIncidentResult,
} from "@/lib/incident";
import type {
  ActionResult,
  IncidentData,
  IncidentParty,
  YesNo,
} from "@/lib/types";
import { requireAdmin } from "@/server/auth";
import { asFailure, bool, fail, ok, str, strs } from "@/server/util";

const criteriaKeys = INCIDENT_CRITERIA.map((c) => c.key);

const Top = z.object({
  occurredOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date of the incident."),
  occurredTime: z
    .string()
    .regex(/^(\d{2}:\d{2})?$/, "Enter the time as hours and minutes."),
  location: z.string().max(200, "Keep the location under 200 characters."),
  summary: z.string().max(240, "Keep the summary under 240 characters."),
});

const yn = (v: string): YesNo => (v === "yes" || v === "no" ? v : "");
const text = (fd: FormData, key: string, max = 4000) =>
  str(fd, key).slice(0, max);

function party(fd: FormData, prefix: string): IncidentParty {
  return {
    name: text(fd, `${prefix}.name`, 200),
    address: text(fd, `${prefix}.address`, 300),
    phone: text(fd, `${prefix}.phone`, 60),
    email: text(fd, `${prefix}.email`, 200),
    injuries: yn(str(fd, `${prefix}.injuries`)),
    determinedBy: text(fd, `${prefix}.determinedBy`, 200),
    signedIn: yn(str(fd, `${prefix}.signedIn`)),
    notSignedInExplain: text(fd, `${prefix}.notSignedInExplain`, 600),
  };
}

/**
 * Create or update an incident report. `intent` is "draft" (save whatever is
 * there) or "final" (save, and mark final if nothing required is missing).
 * Work is never thrown away: a report that isn't ready for final is still saved.
 */
export async function saveIncident(
  formData: FormData,
): Promise<SaveIncidentResult> {
  const v = await requireAdmin();
  let createdId: string | null = null;
  let result: SaveIncidentResult;
  try {
    const db = await getDb();
    const id = str(formData, "id");
    const intent = str(formData, "intent") === "final" ? "final" : "draft";

    const [existing] = id
      ? await db
          .select()
          .from(s.incidents)
          .where(and(eq(s.incidents.id, id), eq(s.incidents.orgId, v.org.id)))
          .limit(1)
      : [];
    if (id && !existing)
      return fail(
        "That report no longer exists. Go back to the list and open it again.",
      );
    const eventId = existing?.eventId ?? v.event?.id;
    if (!eventId)
      return fail(
        "There is no event to file this report under. Create the event first.",
      );

    const top = Top.safeParse({
      occurredOn: str(formData, "occurredOn"),
      occurredTime: str(formData, "occurredTime"),
      location: str(formData, "location"),
      summary: str(formData, "summary"),
    });
    if (!top.success)
      return fail(
        top.error.issues[0]?.message ?? "Check the date, time and location.",
      );
    const criteria = strs(formData, "criteria").filter((k) =>
      criteriaKeys.includes(k),
    );

    const passengerPresent = yn(str(formData, "passenger.present"));
    const otherPresent = yn(str(formData, "other.present"));
    const disposition = str(formData, "transport.disposition");

    const sigIn = str(formData, "preparedBy.signature");
    if (sigIn && (!sigIn.startsWith("data:image/") || sigIn.length > 1_500_000))
      return fail("The signature could not be read. Clear it and sign again.");
    const prevPrepared = existing?.data.preparedBy;

    const data: IncidentData = {
      region: text(formData, "region", 200),
      eventChair: text(formData, "eventChair", 200),
      chairPhone: text(formData, "chairPhone", 60),
      chairEmail: text(formData, "chairEmail", 200),
      locationAddress: text(formData, "locationAddress", 300),
      eventType: text(formData, "eventType", 120),
      driver: party(formData, "driver"),
      passenger: {
        ...(passengerPresent === "yes"
          ? party(formData, "passenger")
          : emptyParty()),
        present: passengerPresent,
      },
      other: {
        ...(otherPresent === "yes" ? party(formData, "other") : emptyParty()),
        injuries: otherPresent,
        present: otherPresent,
        role: otherPresent === "yes" ? text(formData, "other.role", 200) : "",
      },
      waiversAttached: bool(formData, "waiversAttached"),
      vehicles: text(formData, "vehicles"),
      description: text(formData, "description", 8000),
      transport: {
        name: text(formData, "transport.name", 200),
        hospital: text(formData, "transport.hospital", 200),
        address: text(formData, "transport.address", 300),
        phone: text(formData, "transport.phone", 60),
        disposition:
          disposition === "outpatient" || disposition === "admitted"
            ? disposition
            : "",
      },
      comments: text(formData, "comments", 8000),
      preparedBy: {
        name: text(formData, "preparedBy.name", 200),
        title: text(formData, "preparedBy.title", 200),
        phoneWork: text(formData, "preparedBy.phoneWork", 60),
        phoneHome: text(formData, "preparedBy.phoneHome", 60),
        fax: text(formData, "preparedBy.fax", 60),
        email: text(formData, "preparedBy.email", 200),
        signature: sigIn || prevPrepared?.signature,
        signedAt: sigIn ? new Date().toISOString() : prevPrepared?.signedAt,
      },
    };

    let sketch = existing?.sketch ?? null;
    const sketchIn = str(formData, "sketch");
    if (sketchIn === "clear") sketch = null;
    else if (sketchIn) {
      if (
        !sketchIn.startsWith("data:image/png;base64,") ||
        sketchIn.length > 4_000_000
      )
        return fail(
          "The sketch could not be saved. Clear it and draw it again.",
        );
      sketch = sketchIn;
    }

    const hasInjury = incidentHasInjury(criteria, data);
    const missing = finalProblems({
      occurredOn: top.data.occurredOn,
      location: top.data.location,
      data,
      signed: Boolean(data.preparedBy.signature),
    });
    let status = existing?.status ?? "draft";
    if (status !== "sent")
      status = intent === "final" && !missing.length ? "final" : "draft";

    const firstSentence =
      data.description.split(/(?<=[.!?])\s/)[0]?.slice(0, 200) ?? "";
    const values = {
      status,
      occurredOn: top.data.occurredOn,
      occurredTime: top.data.occurredTime || null,
      location: top.data.location || null,
      criteria,
      hasInjury,
      driverUserId: str(formData, "driverUserId") || null,
      driverName: data.driver.name || null,
      summary: top.data.summary || firstSentence || null,
      data,
      sketch,
      dueOn: incidentDueOn(top.data.occurredOn, hasInjury),
      updatedAt: new Date(),
    };

    if (existing) {
      await db
        .update(s.incidents)
        .set(values)
        .where(eq(s.incidents.id, existing.id));
    } else {
      const [row] = await db
        .insert(s.incidents)
        .values({ ...values, orgId: v.org.id, eventId, createdById: v.user.id })
        .returning({ id: s.incidents.id });
      createdId = row.id;
    }

    if (intent === "final" && missing.length && status !== "sent") {
      // Saved, but it stays a draft until the listed items are filled in.
      result = { ok: true, message: "Saved as a draft", data: { missing } };
    } else {
      result = ok(
        status === "sent"
          ? "Changes saved"
          : intent === "final"
            ? "Report marked final"
            : "Draft saved",
      );
    }
  } catch (err) {
    return asFailure(err);
  }
  // A new report gets its own page; whatever is still missing is listed there.
  if (createdId) redirect(`/admin/incidents/${createdId}`);
  refresh();
  return result;
}

export async function markIncidentSent(id: string): Promise<ActionResult> {
  const v = await requireAdmin();
  try {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(s.incidents)
      .where(and(eq(s.incidents.id, id), eq(s.incidents.orgId, v.org.id)))
      .limit(1);
    if (!row) return fail("That report no longer exists.");
    if (row.status === "draft")
      return fail("Mark the report final before recording it as sent.");
    await db
      .update(s.incidents)
      .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(s.incidents.id, id));
  } catch (err) {
    return asFailure(err);
  }
  refresh();
  return ok("Recorded as sent to PCA");
}

export async function unmarkIncidentSent(id: string): Promise<ActionResult> {
  const v = await requireAdmin();
  try {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(s.incidents)
      .where(and(eq(s.incidents.id, id), eq(s.incidents.orgId, v.org.id)))
      .limit(1);
    if (!row) return fail("That report no longer exists.");
    await db
      .update(s.incidents)
      .set({ status: "final", sentAt: null, updatedAt: new Date() })
      .where(eq(s.incidents.id, id));
  } catch (err) {
    return asFailure(err);
  }
  refresh();
  return ok("Marked as not sent");
}

export async function deleteIncident(id: string): Promise<ActionResult> {
  const v = await requireAdmin();
  try {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(s.incidents)
      .where(and(eq(s.incidents.id, id), eq(s.incidents.orgId, v.org.id)))
      .limit(1);
    if (!row) return fail("That report no longer exists.");
    if (row.status !== "draft")
      return fail(
        "Only drafts can be deleted. Final and sent reports are kept as part of the event record.",
      );
    await db.delete(s.incidents).where(eq(s.incidents.id, id));
  } catch (err) {
    return asFailure(err);
  }
  redirect("/admin/incidents");
}
