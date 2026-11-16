"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema as s } from "@/db";
import type { ActionResult } from "@/lib/types";
import { requireAdmin, requireEvent } from "@/server/auth";
import { parseRosterFile, type ImportPreview } from "@/server/roster-import";
import { asFailure, bool, fail, intOrNull, ok, str } from "@/server/util";

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export async function setCheckedIn(
  regId: string,
  on: boolean,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const db = await getDb();
    await db
      .update(s.registrations)
      .set({ checkedInAt: on ? new Date() : null })
      .where(
        and(
          eq(s.registrations.id, regId),
          eq(s.registrations.eventId, v.event.id),
        ),
      );
    refresh();
    return ok(on ? "Checked in" : "Check-in undone");
  } catch (err) {
    return asFailure(err);
  }
}

/** Add someone to the event, or update their contact details, car and registration. */
export async function savePerson(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const db = await getDb();
    const userId = str(fd, "userId");
    const email = str(fd, "email").toLowerCase();
    const firstName = str(fd, "firstName");
    const lastName = str(fd, "lastName");
    if (!firstName || !lastName) return fail("Enter a first and last name.");
    if (!emailOk(email))
      return fail(
        "Enter a valid email address. It is how this person signs in.",
      );
    const groupId = str(fd, "groupId");
    const group = v.groups.find((g) => g.id === groupId);
    if (!group) return fail("Choose a run group.");

    const person = {
      email,
      firstName,
      lastName,
      phone: str(fd, "phone") || null,
      address1: str(fd, "address1") || null,
      city: str(fd, "city") || null,
      state: str(fd, "state") || null,
      zip: str(fd, "zip") || null,
      emergencyName: str(fd, "emergencyName") || null,
      emergencyPhone: str(fd, "emergencyPhone") || null,
      pcaMemberNumber: str(fd, "pcaMemberNumber") || null,
      tshirtSize: str(fd, "tshirtSize") || null,
    };

    let id = userId;
    const [existing] = await db
      .select()
      .from(s.users)
      .where(eq(s.users.email, email))
      .limit(1);
    if (id) {
      if (existing && existing.id !== id)
        return fail("Another person already uses that email address.");
      await db.update(s.users).set(person).where(eq(s.users.id, id));
    } else if (existing) {
      id = existing.id;
      await db.update(s.users).set(person).where(eq(s.users.id, id));
    } else {
      const [created] = await db.insert(s.users).values(person).returning();
      id = created.id;
    }

    const instructor = bool(fd, "isInstructor");
    const solo = bool(fd, "solo") || instructor;
    const [member] = await db
      .select()
      .from(s.memberships)
      .where(
        and(eq(s.memberships.orgId, v.org.id), eq(s.memberships.userId, id)),
      )
      .limit(1);
    if (!member) {
      await db
        .insert(s.memberships)
        .values({
          orgId: v.org.id,
          userId: id,
          runGroupId: group.id,
          isInstructor: instructor,
          soloApproved: solo,
          experience: str(fd, "experience") || null,
        });
    } else if (fd.has("experience")) {
      await db
        .update(s.memberships)
        .set({ experience: str(fd, "experience") || null })
        .where(eq(s.memberships.id, member.id));
    }

    const make = str(fd, "make");
    const model = str(fd, "model");
    const carNumber = str(fd, "carNumber") || null;
    let vehicleId: string | null = null;
    const [vehicle] = await db
      .select()
      .from(s.vehicles)
      .where(and(eq(s.vehicles.userId, id), eq(s.vehicles.isPrimary, true)))
      .limit(1);
    if (make || model) {
      const car = {
        year: intOrNull(fd, "year"),
        make: make || "Unknown",
        model: model || "",
        color: str(fd, "color") || null,
        carNumber,
      };
      if (vehicle) {
        await db
          .update(s.vehicles)
          .set(car)
          .where(eq(s.vehicles.id, vehicle.id));
        vehicleId = vehicle.id;
      } else {
        const [nv] = await db
          .insert(s.vehicles)
          .values({ userId: id, ...car })
          .returning();
        vehicleId = nv.id;
      }
    } else {
      vehicleId = vehicle?.id ?? null;
    }

    const days = str(fd, "days") || "both";
    const regValues = {
      runGroupId: group.id,
      vehicleId,
      carNumber,
      attendsDay1: days !== "day2",
      attendsDay2: days !== "day1",
      isInstructor: instructor,
      solo,
      status: str(fd, "status") || "confirmed",
      tshirtSize: person.tshirtSize,
    };
    const [reg] = await db
      .select()
      .from(s.registrations)
      .where(
        and(
          eq(s.registrations.eventId, v.event.id),
          eq(s.registrations.userId, id),
        ),
      )
      .limit(1);
    if (reg)
      await db
        .update(s.registrations)
        .set(regValues)
        .where(eq(s.registrations.id, reg.id));
    else
      await db
        .insert(s.registrations)
        .values({
          eventId: v.event.id,
          userId: id,
          ...regValues,
          source: "manual",
        });

    refresh();
    return ok(
      userId ? "Saved" : `${firstName} ${lastName} added to the roster`,
    );
  } catch (err) {
    return asFailure(err);
  }
}

export async function removeFromEvent(regId: string): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const db = await getDb();
    await db
      .update(s.registrations)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(s.registrations.id, regId),
          eq(s.registrations.eventId, v.event.id),
        ),
      );
    refresh();
    return ok("Registration cancelled");
  } catch (err) {
    return asFailure(err);
  }
}

export async function setRoles(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const userId = str(fd, "userId");
    const isAdmin = bool(fd, "isAdmin");
    if (userId === v.user.id && !isAdmin)
      return fail(
        "You cannot remove your own administrator access. Ask another administrator to do it.",
      );
    const db = await getDb();
    await db
      .update(s.memberships)
      .set({
        isAdmin,
        adminTitle: isAdmin ? str(fd, "adminTitle") || null : null,
        isInstructor: bool(fd, "isInstructor"),
        instructorCredential: bool(fd, "isInstructor")
          ? str(fd, "instructorCredential") || null
          : null,
      })
      .where(
        and(
          eq(s.memberships.orgId, v.org.id),
          eq(s.memberships.userId, userId),
        ),
      );
    refresh();
    return ok("Roles updated");
  } catch (err) {
    return asFailure(err);
  }
}

export async function addDriverNote(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const body = str(fd, "body");
    if (body.length < 3) return fail("Write the note first.");
    const db = await getDb();
    await db.insert(s.driverNotes).values({
      orgId: v.org.id,
      userId: str(fd, "userId"),
      authorId: v.user.id,
      eventId: v.event?.id ?? null,
      category: str(fd, "category") || "general",
      body,
    });
    refresh();
    return ok("Note added");
  } catch (err) {
    return asFailure(err);
  }
}

export async function deleteDriverNote(noteId: string): Promise<ActionResult> {
  try {
    const v = await requireAdmin();
    const db = await getDb();
    await db
      .delete(s.driverNotes)
      .where(
        and(eq(s.driverNotes.id, noteId), eq(s.driverNotes.orgId, v.org.id)),
      );
    refresh();
    return ok("Note removed");
  } catch (err) {
    return asFailure(err);
  }
}

/* ───────────── Import from ClubRegistration.net (or any CSV) ───────────── */

export type ImportState =
  | { step: "choose"; error?: string }
  | { step: "preview"; preview: ImportPreview; error?: string }
  | { step: "done"; created: number; updated: number; skipped: number };

export async function importRoster(
  _prev: ImportState,
  fd: FormData,
): Promise<ImportState> {
  try {
    const v = await requireEvent("admin");
    // The browser reads the file and posts its text, so the same content can be previewed and then committed.
    const content = String(fd.get("content") ?? "");
    if (!content.trim())
      return { step: "choose", error: "Choose the file you exported." };
    if (content.length > 5_000_000)
      return {
        step: "choose",
        error:
          "That file is larger than 5 MB. Export just the registrant report.",
      };
    const preview = parseRosterFile(content, v.groups);
    if (!preview.rows.length)
      return {
        step: "choose",
        error: preview.problems[0] ?? "No registrants were found in that file.",
      };
    if (str(fd, "intent") !== "commit") return { step: "preview", preview };

    const db = await getDb();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (const row of preview.rows) {
      if (!row.email || !row.groupId || row.status === "cancelled") {
        skipped += 1;
        continue;
      }
      const [existing] = await db
        .select()
        .from(s.users)
        .where(eq(s.users.email, row.email))
        .limit(1);
      const contact = {
        phone: row.phone,
        address1: row.address1,
        city: row.city,
        state: row.state,
        zip: row.zip,
        emergencyName: row.emergencyName,
        emergencyPhone: row.emergencyPhone,
        pcaMemberNumber: row.pcaMemberNumber,
        tshirtSize: row.tshirtSize,
      };
      let userId: string;
      if (existing) {
        userId = existing.id;
        // Fill gaps only: what the member has since edited in the app wins over the export.
        const patch = Object.fromEntries(
          Object.entries(contact).filter(
            ([k, val]) => val && !existing[k as keyof typeof contact],
          ),
        );
        if (Object.keys(patch).length)
          await db.update(s.users).set(patch).where(eq(s.users.id, userId));
      } else {
        const [u] = await db
          .insert(s.users)
          .values({
            email: row.email,
            firstName: row.firstName,
            lastName: row.lastName,
            ...contact,
          })
          .returning();
        userId = u.id;
      }
      const [member] = await db
        .select()
        .from(s.memberships)
        .where(
          and(
            eq(s.memberships.orgId, v.org.id),
            eq(s.memberships.userId, userId),
          ),
        )
        .limit(1);
      if (!member)
        await db
          .insert(s.memberships)
          .values({
            orgId: v.org.id,
            userId,
            runGroupId: row.groupId,
            isInstructor: row.isInstructor,
            soloApproved: row.isInstructor,
          });

      let [vehicle] = await db
        .select()
        .from(s.vehicles)
        .where(
          and(eq(s.vehicles.userId, userId), eq(s.vehicles.isPrimary, true)),
        )
        .limit(1);
      if (!vehicle && (row.make || row.model)) {
        [vehicle] = await db
          .insert(s.vehicles)
          .values({
            userId,
            year: row.year,
            make: row.make || "Unknown",
            model: row.model || "",
            color: row.color,
            carNumber: row.carNumber,
          })
          .returning();
      }
      const [reg] = await db
        .select()
        .from(s.registrations)
        .where(
          and(
            eq(s.registrations.eventId, v.event.id),
            eq(s.registrations.userId, userId),
          ),
        )
        .limit(1);
      const values = {
        runGroupId: row.groupId,
        vehicleId: vehicle?.id ?? null,
        carNumber: row.carNumber ?? vehicle?.carNumber ?? null,
        isInstructor: row.isInstructor || Boolean(member?.isInstructor),
        status: row.status,
        tshirtSize: row.tshirtSize,
        source: "import",
        externalId: row.externalId,
      };
      if (reg) {
        await db
          .update(s.registrations)
          .set(values)
          .where(eq(s.registrations.id, reg.id));
        updated += 1;
      } else {
        await db
          .insert(s.registrations)
          .values({
            eventId: v.event.id,
            userId,
            solo: Boolean(member?.soloApproved) || row.isInstructor,
            ...values,
          });
        created += 1;
      }
    }
    refresh();
    return { step: "done", created, updated, skipped };
  } catch (err) {
    console.error(err);
    return {
      step: "choose",
      error:
        err instanceof Error
          ? err.message
          : "The import failed. Nothing was changed.",
    };
  }
}
