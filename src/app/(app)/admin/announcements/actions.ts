"use server";

import { refresh } from "next/cache";
import { getDb, schema as s } from "@/db";
import type {
  ActionResult,
  AnnouncementAudience,
  AudienceKind,
  Channel,
} from "@/lib/types";
import { audienceUserIds } from "@/server/admin";
import { requireEvent } from "@/server/auth";
import { notifyUsers } from "@/server/notify";
import { asFailure, bool, fail, ok, str, strs } from "@/server/util";

const KINDS: AudienceKind[] = [
  "all",
  "groups",
  "instructors",
  "students",
  "admins",
];

export async function sendAnnouncement(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const v = await requireEvent("admin");
    const title = str(fd, "title");
    const body = str(fd, "body");
    if (title.length < 3) return fail("Give the announcement a short title.");
    if (body.length < 3) return fail("Write the message.");
    const kind = str(fd, "audience") as AudienceKind;
    if (!KINDS.includes(kind)) return fail("Choose who this is for.");
    const groupIds = strs(fd, "groupIds").filter((g) =>
      v.groups.some((x) => x.id === g),
    );
    if (kind === "groups" && !groupIds.length)
      return fail("Choose at least one run group.");
    const audience: AnnouncementAudience =
      kind === "groups" ? { kind, groupIds } : { kind };
    const channels: Channel[] = [
      "inapp",
      ...(["email", "sms", "push"] as const).filter((c) => bool(fd, c)),
    ];
    const urgent = bool(fd, "urgent");

    const userIds = await audienceUserIds(v.event.id, v.org.id, audience);
    if (!userIds.length)
      return fail("Nobody on the roster matches that audience.");
    const db = await getDb();
    const [row] = await db
      .insert(s.announcements)
      .values({
        orgId: v.org.id,
        eventId: v.event.id,
        title,
        body,
        audience,
        channels,
        urgent,
        authorId: v.user.id,
        recipientCount: userIds.length,
      })
      .returning();
    await notifyUsers({
      userIds,
      title,
      body,
      href: "/alerts",
      kind: "announcement",
      eventId: v.event.id,
      announcementId: row.id,
      urgent,
      channels,
    });
    refresh();
    return ok(
      `Sent to ${userIds.length} ${userIds.length === 1 ? "person" : "people"}`,
    );
  } catch (err) {
    return asFailure(err);
  }
}
