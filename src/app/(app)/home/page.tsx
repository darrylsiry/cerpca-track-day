import { and, count, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { Check, ChevronRight, CircleDashed, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ClockProvider } from "@/components/clock";
import {
  Avatar,
  ButtonLink,
  Card,
  CarNumber,
  EmptyState,
  GroupChip,
  Pill,
  Stat,
} from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { cn, fullName, vehicleLabel } from "@/lib/cn";
import { TECH_STATUS } from "@/lib/tech-form";
import { relativeTime } from "@/lib/time";
import { canAskForInstructor, instructorNeed } from "@/lib/instruction";
import { clockProps, getViewer } from "@/server/auth";
import {
  adminBadges,
  eventDays,
  getAssignments,
  getChecklist,
  getSchedule,
  groupLite,
  viewerLens,
} from "@/server/queries";
import { screen } from "@/components/shell/skeleton";
import { NowPanel } from "./now-panel";
import { AskForInstructorSheet, WithdrawRideAlongButton } from "./ride-along";
import { UrgentAlerts } from "./urgent-alerts";

export const metadata: Metadata = { title: "Now" };

/** How many unread urgent alerts are shown in full at the top of the screen; the rest are a tap away. */
const URGENT_SHOWN = 2;

export default screen(async function HomePage() {
  const v = await getViewer();
  if (!v.event) {
    return (
      <EmptyState
        title="No event is scheduled yet"
        action={
          v.isAdmin ? (
            <ButtonLink href="/admin/events">Create an event</ButtonLink>
          ) : undefined
        }
      >
        When the region publishes its next track day, the schedule and your
        checklist will appear here.
      </EmptyState>
    );
  }
  const db = await getDb();
  const event = v.event;
  const [items, assignments, checklist, urgent, inbox] = await Promise.all([
    getSchedule(event.id),
    getAssignments(event.id, v.user.id),
    getChecklist(v),
    // Unread urgent alerts for this event go first on the screen. Session reminders are
    // left out: the "Head to the grid" call below already carries them.
    db
      .select()
      .from(s.notifications)
      .where(
        and(
          eq(s.notifications.userId, v.user.id),
          eq(s.notifications.eventId, event.id),
          eq(s.notifications.urgent, true),
          isNull(s.notifications.readAt),
          ne(s.notifications.kind, "reminder"),
        ),
      )
      .orderBy(desc(s.notifications.createdAt))
      .limit(URGENT_SHOWN + 20),
    db
      .select()
      .from(s.notifications)
      .where(
        and(
          eq(s.notifications.userId, v.user.id),
          eq(s.notifications.kind, "announcement"),
          eq(s.notifications.eventId, event.id),
        ),
      )
      .orderBy(desc(s.notifications.createdAt))
      .limit(3),
  ]);

  const groups = v.groups.map(groupLite);
  const groupById = new Map(v.groups.map((g) => [g.id, g]));
  const gridPlace = v.track?.guide.places.find((p) => p.name === "False grid")
    ? "False grid"
    : "Grid";
  // Why this driver rides with an instructor, if they do; solo drivers can ask for one.
  const need = v.registration
    ? instructorNeed(v.group?.instructorPolicy, v.registration)
    : null;
  const canAsk =
    Boolean(v.registration) &&
    event.status !== "completed" &&
    canAskForInstructor(v.group, v.registration!);

  const admin = v.isAdmin
    ? await (async () => {
        const [badges, [reg], [inCount]] = await Promise.all([
          adminBadges(v.org.id, event.id),
          db
            .select({ n: count() })
            .from(s.registrations)
            .where(
              and(
                eq(s.registrations.eventId, event.id),
                ne(s.registrations.status, "cancelled"),
              ),
            ),
          db
            .select({ n: count() })
            .from(s.registrations)
            .where(
              and(
                eq(s.registrations.eventId, event.id),
                isNotNull(s.registrations.checkedInAt),
              ),
            ),
        ]);
        return { badges, registered: reg?.n ?? 0, checkedIn: inCount?.n ?? 0 };
      })()
    : null;

  const tech = checklist?.tech ?? null;
  const techState = TECH_STATUS[tech?.status ?? "none"];
  const waiversDone = checklist
    ? checklist.waiversSigned >= checklist.waiversTotal
    : true;
  const cleared = Boolean(checklist?.cleared);

  // What this driver still has to do themselves, surfaced at the very top on a phone.
  const todo: { text: string; href: string }[] = [];
  if (v.registration && checklist) {
    const left = checklist.waiversTotal - checklist.waiversSigned;
    if (left > 0) todo.push({ text: `Sign ${left} waiver${left === 1 ? "" : "s"}`, href: "/me/waivers" });
    const st = tech?.status ?? "none";
    if (st === "none" || st === "draft") todo.push({ text: "Start your tech inspection", href: "/me/tech" });
    else if (st === "shop_signed") todo.push({ text: "Sign and submit your tech form", href: "/me/tech" });
    else if (st === "changes_requested") todo.push({ text: "Fix your tech form", href: "/me/tech" });
    else if (st === "approved" && !tech?.stickerIssuedAt && v.now.day >= event.startDate)
      todo.push({ text: "Get your tech sticker at the tech shed", href: "/me/tech" });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-6">
      <div className="min-w-0">
        <h1 className="sr-only">Now</h1>
        {todo.length ? (
          <Link
            href={todo[0].href}
            className="mb-4 flex items-center gap-3 rounded-[14px] border border-warn/40 bg-warn-soft px-4 py-3 text-ink"
          >
            <CircleDashed className="size-5 shrink-0 text-warn" strokeWidth={2.5} />
            <span className="min-w-0 flex-1">
              <span className="block font-bold">Before you drive</span>
              <span className="block text-[15px]">{todo.map((x) => x.text).join(" · ")}</span>
            </span>
            <ChevronRight className="size-4 shrink-0" />
          </Link>
        ) : null}
        <UrgentAlerts
          alerts={urgent.slice(0, URGENT_SHOWN).map((n) => ({
            id: n.id,
            title: n.title,
            body: n.body,
            href: n.href,
            ago: relativeTime(n.createdAt, v.nowMs),
          }))}
          more={Math.max(0, urgent.length - URGENT_SHOWN)}
        />
        <ClockProvider {...clockProps(v)}>
          <NowPanel
            items={items}
            groups={groups}
            days={eventDays(event)}
            lens={viewerLens(v, assignments.students)}
            registered={Boolean(v.registration)}
            gridPlace={gridPlace}
          />
        </ClockProvider>
        {!v.registration ? (
          <Card className="mt-4 px-5 py-4">
            <p className="font-bold">
              You are not on the roster for this event
            </p>
            <p className="mt-1 text-[15px] text-ink-2">
              You can still follow the schedule and use the track guide.
              Registration is handled on ClubRegistration.net.
            </p>
            {event.registrationUrl ? (
              <a
                href={event.registrationUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-[15px] font-semibold underline underline-offset-4"
              >
                Open registration
              </a>
            ) : null}
          </Card>
        ) : null}
      </div>

      <div className="min-w-0 space-y-4">
        {admin ? (
          <section aria-label="Event control">
            <h2 className="eyebrow mb-2.5 text-ink-2">Event control</h2>
            <div className="grid grid-cols-2 gap-3">
              <Stat
                label="Checked in"
                value={`${admin.checkedIn}/${admin.registered}`}
                href="/admin/roster"
              />
              <Stat
                label="Tech to review"
                value={admin.badges.tech}
                tone={admin.badges.tech ? "warn" : undefined}
                href="/admin/tech"
              />
              <Stat
                label="Promotions"
                value={admin.badges.promotions}
                sub="waiting on sign-off"
                tone={admin.badges.promotions ? "warn" : undefined}
                href="/admin/promotions"
              />
              <Stat
                label="Incidents open"
                value={admin.badges.incidents}
                sub="not yet sent to PCA"
                tone={admin.badges.incidents ? "bad" : undefined}
                href="/admin/incidents"
              />
            </div>
          </section>
        ) : null}

        {inbox.length ? (
          <Card>
            <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
              <h2 className="eyebrow text-ink-2">Announcements</h2>
              <Link
                href="/alerts"
                className="text-sm font-semibold underline-offset-4 hover:underline"
              >
                All alerts
              </Link>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {inbox.map((n) => (
                <li key={n.id} className="relative px-4 py-3 sm:px-5">
                  {n.urgent ? (
                    <span
                      className="absolute inset-y-3 left-0 w-1 rounded-r bg-flag-yellow"
                      aria-hidden
                    />
                  ) : null}
                  <p className="flex items-start justify-between gap-3">
                    <span className="font-bold">{n.title}</span>
                    {!n.readAt ? (
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-flag-red"
                        aria-label="Unread"
                      />
                    ) : null}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[15px] text-ink-2">
                    {n.body}
                  </p>
                  <p className="mt-1 text-[13px] text-ink-3">
                    {n.urgent ? (
                      <span className="font-bold text-warn">Urgent · </span>
                    ) : null}
                    {relativeTime(n.createdAt, v.nowMs)}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {v.registration && checklist ? (
          <Card>
            <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
              <h2 className="eyebrow text-ink-2">Before you drive</h2>
              {cleared ? <Pill tone="good">Cleared to drive</Pill> : null}
            </div>
            <ul className="mt-2 divide-y divide-line">
              <CheckRow
                href="/me/waivers"
                done={waiversDone}
                title="Waivers"
                detail={
                  waiversDone
                    ? `All ${checklist.waiversTotal} signed`
                    : `${checklist.waiversSigned} of ${checklist.waiversTotal} signed. Sign the rest before you arrive.`
                }
              />
              <CheckRow
                href="/me/tech"
                done={tech?.status === "approved"}
                title="Shop inspection"
                detail={
                  tech?.status === "approved"
                    ? "Reviewed and approved"
                    : tech?.status === "changes_requested"
                      ? (tech.reviewNote ?? techState.label)
                      : techState.label
                }
                tone={techState.tone}
              />
              <CheckRow
                href="/me/tech"
                done={Boolean(tech?.stickerIssuedAt)}
                title="Tech sticker"
                detail={
                  tech?.stickerIssuedAt
                    ? `Sticker ${tech.stickerNumber ?? ""} is on your car`
                    : "Issued at the tech shed. Bring your helmet and have your numbers on."
                }
              />
            </ul>
          </Card>
        ) : null}

        {assignments.students.length ? (
          <Card>
            <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
              <h2 className="eyebrow text-ink-2">Your students</h2>
              <Link
                href="/instructor"
                className="text-sm font-semibold underline-offset-4 hover:underline"
              >
                Log a session
              </Link>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {assignments.students.map((st) => (
                <li key={st.user.id}>
                  <Link
                    href={`/instructor/${st.user.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-paper sm:px-5"
                  >
                    <Avatar name={fullName(st.user)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">
                        {fullName(st.user)}
                      </span>
                      <span className="block truncate text-sm text-ink-2">
                        {vehicleLabel(st.vehicle)}
                      </span>
                    </span>
                    <GroupChip group={groupById.get(st.groupId)} size="sm" />
                    <CarNumber n={st.carNumber} size="sm" />
                    <ChevronRight className="size-4 shrink-0 text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {assignments.instructor ? (
          <Card className="px-4 py-4 sm:px-5">
            <h2 className="eyebrow text-ink-2">Your instructor</h2>
            <div className="mt-3 flex items-center gap-3">
              <Avatar
                name={fullName(assignments.instructor.user)}
                className="size-11 text-sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg leading-tight font-bold">
                  {fullName(assignments.instructor.user)}
                </p>
                <p className="truncate text-sm text-ink-2">
                  {vehicleLabel(assignments.instructor.vehicle)}
                </p>
              </div>
              <CarNumber n={assignments.instructor.carNumber} />
            </div>
            <p className="mt-3 text-[15px] text-ink-2">
              {need === "ride_along"
                ? "Riding along at your request. "
                : need === "check_in"
                  ? "The administrators have asked them to check in with you at this event. "
                  : ""}
              {need === null
                ? "You drive solo now. They are still your instructor contact at this event."
                : `Meet at the ${gridPlace.toLowerCase()} ten minutes before each of your sessions.`}
            </p>
            {assignments.instructor.user.phone ? (
              <a
                href={`tel:${assignments.instructor.user.phone.replace(/[^\d+]/g, "")}`}
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-[10px] border border-line-strong px-3 text-[15px] font-semibold hover:bg-sunk"
              >
                <Phone className="size-4" /> {assignments.instructor.user.phone}
              </a>
            ) : null}
            {need === "ride_along" ? (
              <div className="mt-2">
                <WithdrawRideAlongButton paired />
              </div>
            ) : null}
          </Card>
        ) : need ? (
          <Card className="px-4 py-4 sm:px-5">
            <h2 className="eyebrow text-ink-2">Your instructor</h2>
            <p className="mt-2 text-[15px] text-ink-2">
              {need === "ride_along"
                ? "You asked for an instructor to ride along. Not paired yet; you will get an alert when one is assigned."
                : need === "check_in"
                  ? "The administrators have asked for an instructor to check in with you at this event. You will get an alert when one is assigned."
                  : "Not paired yet. The Chief Driving Instructor assigns instructors before the drivers meeting, and you will get an alert when yours is set."}
            </p>
            {need === "ride_along" ? (
              <div className="mt-2">
                <WithdrawRideAlongButton paired={false} />
              </div>
            ) : null}
          </Card>
        ) : canAsk ? (
          <Card className="px-4 py-4 sm:px-5">
            <h2 className="eyebrow text-ink-2">Instructor ride-along</h2>
            <p className="mt-2 text-[15px] text-ink-2">
              You drive solo
              {v.group ? ` in ${v.group.name}` : ""}. If you would like an
              instructor in the right seat for a session or two, ask and the
              administrators will pair you.
            </p>
            <div className="mt-3">
              <AskForInstructorSheet />
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
});

function CheckRow({
  href,
  done,
  title,
  detail,
  tone,
}: {
  href: string;
  done: boolean;
  title: string;
  detail: string;
  tone?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-3 hover:bg-paper sm:px-5"
      >
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full",
            done
              ? "bg-good text-white"
              : tone === "bad"
                ? "bg-bad-soft text-bad"
                : "bg-warn-soft text-warn",
          )}
        >
          {done ? (
            <Check className="size-4" strokeWidth={3} />
          ) : (
            <CircleDashed className="size-4" strokeWidth={2.5} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{title}</span>
          <span
            className={cn(
              "block text-sm",
              done ? "text-ink-2" : tone === "bad" ? "text-bad" : "text-ink-2",
            )}
          >
            {detail}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-ink-3" />
      </Link>
    </li>
  );
}
