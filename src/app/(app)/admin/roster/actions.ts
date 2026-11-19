"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb, schema as s } from "@/db";
import type { RunGroup } from "@/db/schema";
import { plural } from "@/lib/cn";
import type { ActionResult } from "@/lib/types";
import { requireAdmin, requireEvent } from "@/server/auth";
import { endPairings } from "@/server/pairings";
import { parseRosterFile, type ImportPreview } from "@/server/roster-import";
import { asFailure, bool, fail, intOrNull, ok, str } from "@/server/util";

const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** What ending someone's pairings means for the administrator, as the tail of a confirmation. */
function pairingsEnded(ended: Awaited<ReturnType<typeof endPairings>>): string {
  const parts: string[] = [];
  if (ended.needInstructor)
    parts.push(
      `${plural(ended.needInstructor, "student")} now ${ended.needInstructor === 1 ? "needs" : "need"} a new instructor: pair them under Instructor pairing`,
    );
  else if (ended.students) parts.push("their students have been told");
  if (ended.instructors) parts.push("their instructor has been told");
  return parts.length ? `. ${parts.join(", and ")}` : "";
}

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
    let pairingNote = "";
    if (reg) {
      await db
        .update(s.registrations)
        .set(regValues)
        .where(eq(s.registrations.id, reg.id));
      // Someone who leaves the event, or stops instructing at it, cannot stay paired.
      const left = regValues.status === "cancelled" && reg.status !== "cancelled";
      const ended = await endPairings(v.event.id, id, {
        asInstructor: left || (reg.isInstructor && !instructor),
        asStudent: left || (!reg.isInstructor && instructor),
      });
      pairingNote = pairingsEnded(ended);
    } else
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
      userId
        ? `Saved${pairingNote}`
        : `${firstName} ${lastName} added to the roster`,
    );
  } catch (err) {
    return asFailure(err);
  }
}

export async function removeFromEvent(regId: string): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const db = await getDb();
    const [reg] = await db
      .update(s.registrations)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(s.registrations.id, regId),
          eq(s.registrations.eventId, v.event.id),
        ),
      )
      .returning({ userId: s.registrations.userId });
    if (!reg) return fail("That registration could not be found.");
    // Their students need a new instructor, and their instructor should stop expecting them.
    const ended = await endPairings(v.event.id, reg.userId, {
      asInstructor: true,
      asStudent: true,
    });
    refresh();
    return ok(`Registration cancelled${pairingsEnded(ended)}`);
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

/** Someone whose run group in the app differs from the one in the file. */
export type GroupDifference = {
  name: string;
  fileGroup: string;
  appGroup: string;
  /** "roster": already on this event's roster · "member": new to this event, classified higher in the app. */
  where: "roster" | "member";
};

export type ImportState =
  | { step: "choose"; error?: string }
  | {
      step: "preview";
      preview: ImportPreview;
      differences: GroupDifference[];
      error?: string;
    }
  | {
      step: "done";
      created: number;
      updated: number;
      skipped: number;
      /** People whose run group in the app was kept over the file's. */
      kept: number;
    };

/**
 * The run group a person imports into. Promotions and group changes are made
 * in the app, so the app wins over the registration export:
 *  - already on this event's roster: keep the group they have here;
 *  - new to this event but classified higher in the app (promoted "from the
 *    next event"): use that classification.
 * `preferFile` lets the administrator take the file's group instead.
 */
function importGroup(
  groups: RunGroup[],
  fileGroupId: string,
  current: { regGroupId?: string | null; memberGroupId?: string | null },
  preferFile: boolean,
): { groupId: string; where: "roster" | "member" | null } {
  if (current.regGroupId)
    return current.regGroupId === fileGroupId
      ? { groupId: fileGroupId, where: null }
      : {
          groupId: preferFile ? fileGroupId : current.regGroupId,
          where: "roster",
        };
  const rank = (id: string | null | undefined) => {
    const g = groups.find((x) => x.id === id);
    return g && !g.isInstructorGroup ? g.sortOrder : null;
  };
  const inFile = rank(fileGroupId);
  const inApp = rank(current.memberGroupId);
  if (inFile !== null && inApp !== null && inApp > inFile)
    return {
      groupId: preferFile ? fileGroupId : current.memberGroupId!,
      where: "member",
    };
  return { groupId: fileGroupId, where: null };
}

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
    const db = await getDb();
    const preferFile = bool(fd, "fileGroups");
    if (str(fd, "intent") !== "commit") {
      // Show where the file disagrees with run groups set in the app, before anything is written.
      const emails = [
        ...new Set(
          preview.rows
            .filter((r) => r.email && r.groupId && r.status !== "cancelled")
            .map((r) => r.email),
        ),
      ];
      const known = emails.length
        ? await db
            .select({
              email: s.users.email,
              regGroupId: s.registrations.runGroupId,
              memberGroupId: s.memberships.runGroupId,
            })
            .from(s.users)
            .leftJoin(
              s.registrations,
              and(
                eq(s.registrations.userId, s.users.id),
                eq(s.registrations.eventId, v.event.id),
              ),
            )
            .leftJoin(
              s.memberships,
              and(
                eq(s.memberships.userId, s.users.id),
                eq(s.memberships.orgId, v.org.id),
              ),
            )
            .where(inArray(s.users.email, emails))
        : [];
      const byEmail = new Map(known.map((k) => [k.email, k]));
      const groupName = (id: string) =>
        v.groups.find((g) => g.id === id)?.name ?? "";
      const differences: GroupDifference[] = [];
      for (const row of preview.rows) {
        const current = byEmail.get(row.email);
        if (!current || !row.groupId || row.status === "cancelled") continue;
        const pick = importGroup(v.groups, row.groupId, current, false);
        if (pick.where)
          differences.push({
            name: `${row.firstName} ${row.lastName}`.trim(),
            fileGroup: row.groupLabel || groupName(row.groupId),
            appGroup: groupName(pick.groupId),
            where: pick.where,
          });
      }
      return { step: "preview", preview, differences };
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let kept = 0;
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
            soloApproved: row.isInstructor || row.solo,
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
      // A re-import must not undo a promotion or a group change made in the app.
      const group = importGroup(
        v.groups,
        row.groupId,
        { regGroupId: reg?.runGroupId, memberGroupId: member?.runGroupId },
        preferFile,
      );
      if (group.where && !preferFile) kept += 1;
      const values = {
        runGroupId: group.groupId,
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
            solo: Boolean(member?.soloApproved) || row.isInstructor || row.solo,
            ...values,
          });
        created += 1;
      }
    }
    refresh();
    return { step: "done", created, updated, skipped, kept };
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
