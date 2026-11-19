import { and, desc, eq } from "drizzle-orm";
import { Lock, Pencil, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm, SubmitButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { screen } from "@/components/shell/skeleton";
import {
  buttonClass,
  Card,
  CarNumber,
  CheckRow,
  DefList,
  Field,
  GroupChip,
  PageHeader,
  Pill,
  SectionTitle,
} from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { fullName, vehicleLabel } from "@/lib/cn";
import { currentSignedCount } from "@/lib/clearance";
import { drivesSolo } from "@/lib/instruction";
import { TECH_STATUS } from "@/lib/tech-form";
import { dateOnly, dateRange, dateTime, weekday } from "@/lib/time";
import { usersByIds } from "@/server/admin";
import { requireAdmin } from "@/server/auth";
import { eventDays, getAssignments, groupLite } from "@/server/queries";
import {
  addDriverNote,
  deleteDriverNote,
  removeFromEvent,
  setRoles,
} from "../actions";
import { PersonForm } from "../person-form";

export const metadata: Metadata = { title: "Driver" };

const NOTE_CATEGORY: Record<
  string,
  { label: string; tone: "neutral" | "info" | "warn" | "bad" }
> = {
  general: { label: "General", tone: "neutral" },
  safety: { label: "Safety", tone: "bad" },
  conduct: { label: "Conduct", tone: "warn" },
  medical: { label: "Medical", tone: "info" },
  instructor: { label: "From instructor", tone: "info" },
};

export default screen(async function DriverPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const v = await requireAdmin();
  const db = await getDb();
  const [[user], [member]] = await Promise.all([
    db.select().from(s.users).where(eq(s.users.id, userId)).limit(1),
    db
      .select()
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.orgId, v.org.id),
          eq(s.memberships.userId, userId),
        ),
      )
      .limit(1),
  ]);
  if (!user || !member) notFound();

  const eventId = v.event?.id ?? "";
  const [
    notes,
    logs,
    promos,
    history,
    [vehicle],
    [reg],
    [tech],
    sigs,
    templates,
    assignments,
  ] = await Promise.all([
    db
      .select()
      .from(s.driverNotes)
      .where(
        and(
          eq(s.driverNotes.orgId, v.org.id),
          eq(s.driverNotes.userId, userId),
        ),
      )
      .orderBy(desc(s.driverNotes.createdAt)),
    db
      .select()
      .from(s.sessionLogs)
      .where(eq(s.sessionLogs.studentId, userId))
      .orderBy(desc(s.sessionLogs.createdAt)),
    db
      .select()
      .from(s.promotions)
      .where(eq(s.promotions.userId, userId))
      .orderBy(desc(s.promotions.createdAt)),
    db
      .select({ reg: s.registrations, event: s.events })
      .from(s.registrations)
      .innerJoin(s.events, eq(s.events.id, s.registrations.eventId))
      .where(eq(s.registrations.userId, userId))
      .orderBy(desc(s.events.startDate)),
    db
      .select()
      .from(s.vehicles)
      .where(and(eq(s.vehicles.userId, userId), eq(s.vehicles.isPrimary, true)))
      .limit(1),
    db
      .select()
      .from(s.registrations)
      .where(
        and(
          eq(s.registrations.eventId, eventId),
          eq(s.registrations.userId, userId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(s.techInspections)
      .where(
        and(
          eq(s.techInspections.eventId, eventId),
          eq(s.techInspections.userId, userId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(s.waiverSignatures)
      .where(
        and(
          eq(s.waiverSignatures.eventId, eventId),
          eq(s.waiverSignatures.userId, userId),
        ),
      ),
    db
      .select()
      .from(s.waiverTemplates)
      .where(
        and(
          eq(s.waiverTemplates.orgId, v.org.id),
          eq(s.waiverTemplates.active, true),
          eq(s.waiverTemplates.required, true),
        ),
      ),
    v.event
      ? getAssignments(v.event.id, userId)
      : Promise.resolve({ students: [], instructor: null }),
  ]);
  const people = await usersByIds(
    [
      ...notes.map((n) => n.authorId),
      ...logs.map((l) => l.instructorId),
      ...promos.flatMap((p) => [p.recommendedById ?? "", p.decidedById ?? ""]),
    ].filter(Boolean),
  );
  const who = (id: string | null) =>
    id && people.get(id) ? fullName(people.get(id)!) : "Unknown";
  const groupName = (id: string | null) =>
    v.groups.find((g) => g.id === id)?.name ?? "";
  const eventName = new Map(history.map((h) => [h.event.id, h.event.name]));
  const group = v.groups.find(
    (g) => g.id === (reg?.runGroupId ?? member.runGroupId),
  );
  const name = fullName(user);
  const techState = TECH_STATUS[tech?.status ?? "none"];
  const signed = currentSignedCount(templates, sigs);
  const dayLabels = v.event ? eventDays(v.event).map(weekday) : [];
  const active = reg && reg.status !== "cancelled";

  return (
    <>
      <PageHeader
        back={{ href: "/admin/roster", label: "Roster" }}
        title={name}
        lede={
          <span className="flex flex-wrap items-center gap-2">
            <GroupChip group={group} />
            <CarNumber n={reg?.carNumber ?? vehicle?.carNumber} size="sm" />
            <span>{vehicleLabel(vehicle)}</span>
            {member.isAdmin ? (
              <Pill tone="info">{member.adminTitle ?? "Administrator"}</Pill>
            ) : null}
            {member.isInstructor ? <Pill tone="info">Instructor</Pill> : null}
          </span>
        }
        actions={
          <>
            {v.event ? (
              <Sheet
                trigger={
                  <>
                    <Pencil className="size-4" /> Edit
                  </>
                }
                triggerClassName={buttonClass("primary")}
                title={`Edit ${user.firstName}`}
                description={
                  active
                    ? `Contact details, car and registration for ${v.event.name}.`
                    : `${user.firstName} is not registered for ${v.event.name}. Saving adds them.`
                }
              >
                <PersonForm
                  groups={v.groups.map(groupLite)}
                  dayLabels={dayLabels}
                  values={{
                    userId: user.id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    phone: user.phone,
                    address1: user.address1,
                    city: user.city,
                    state: user.state,
                    zip: user.zip,
                    emergencyName: user.emergencyName,
                    emergencyPhone: user.emergencyPhone,
                    pcaMemberNumber: user.pcaMemberNumber,
                    tshirtSize: reg?.tshirtSize ?? user.tshirtSize,
                    experience: member.experience,
                    groupId: reg?.runGroupId ?? member.runGroupId ?? undefined,
                    year: vehicle?.year,
                    make: vehicle?.make,
                    model: vehicle?.model,
                    color: vehicle?.color,
                    carNumber: reg?.carNumber ?? vehicle?.carNumber,
                    days: reg
                      ? reg.attendsDay1 && reg.attendsDay2
                        ? "both"
                        : reg.attendsDay1
                          ? "day1"
                          : "day2"
                      : "both",
                    isInstructor: reg?.isInstructor ?? member.isInstructor,
                    solo: reg?.solo ?? member.soloApproved,
                    status:
                      reg?.status === "cancelled" ? "confirmed" : reg?.status,
                  }}
                />
              </Sheet>
            ) : null}
            <Sheet
              trigger={
                <>
                  <ShieldCheck className="size-4" /> Roles
                </>
              }
              title="Roles"
              description={`What ${user.firstName} can do in the app, across all of the region's events.`}
            >
              <ActionForm action={setRoles} className="space-y-4">
                <input type="hidden" name="userId" value={user.id} />
                <div className="rounded-[12px] border border-line px-4 py-3">
                  <CheckRow
                    name="isInstructor"
                    defaultChecked={member.isInstructor}
                  >
                    <strong>Instructor.</strong> Can be paired with students,
                    log sessions and recommend promotions.
                  </CheckRow>
                  <Field label="Credential" optional className="mt-2">
                    <input
                      name="instructorCredential"
                      className="ctl"
                      defaultValue={member.instructorCredential ?? ""}
                      placeholder="PCA National Instructor"
                    />
                  </Field>
                </div>
                <div className="rounded-[12px] border border-line px-4 py-3">
                  <CheckRow name="isAdmin" defaultChecked={member.isAdmin}>
                    <strong>Administrator.</strong> Sees and manages everything:
                    roster, tech, waivers, promotions, incidents.
                  </CheckRow>
                  <Field label="Title" optional className="mt-2">
                    <input
                      name="adminTitle"
                      className="ctl"
                      defaultValue={member.adminTitle ?? ""}
                      placeholder="Chief Tech Inspector"
                    />
                  </Field>
                </div>
                <SubmitButton className="w-full">Save roles</SubmitButton>
              </ActionForm>
            </Sheet>
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-7">
          <section>
            <SectionTitle>
              <span className="inline-flex items-center gap-1.5">
                <Lock className="size-3.5" /> Notes for administrators
              </span>
            </SectionTitle>
            <Card className="px-4 py-4 sm:px-5">
              <ActionForm
                action={addDriverNote}
                resetOnSuccess
                closeOnSuccess={false}
                className="space-y-3"
              >
                <input type="hidden" name="userId" value={user.id} />
                <textarea
                  name="body"
                  className="ctl min-h-20"
                  required
                  placeholder={`A note about ${user.firstName}. Only administrators can read it.`}
                  aria-label="New note"
                />
                <div className="flex items-center justify-between gap-3">
                  <select
                    name="category"
                    className="ctl w-auto"
                    aria-label="Category"
                    defaultValue="general"
                  >
                    <option value="general">General</option>
                    <option value="safety">Safety</option>
                    <option value="conduct">Conduct</option>
                    <option value="medical">Medical</option>
                  </select>
                  <SubmitButton>Add note</SubmitButton>
                </div>
              </ActionForm>
            </Card>
            {notes.length ? (
              <ul className="mt-3 space-y-2">
                {notes.map((n) => {
                  const cat =
                    NOTE_CATEGORY[n.category] ?? NOTE_CATEGORY.general;
                  return (
                    <li
                      key={n.id}
                      className="rounded-[12px] border border-line bg-surface px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
                          <Pill tone={cat.tone}>{cat.label}</Pill>
                          {who(n.authorId)} · {dateOnly(n.createdAt, v.tz)}
                          {n.eventId && eventName.get(n.eventId)
                            ? ` · ${eventName.get(n.eventId)}`
                            : ""}
                        </p>
                        <ActionButton
                          action={deleteDriverNote.bind(null, n.id)}
                          confirm="Remove this note?"
                          variant="ghost"
                          size="sm"
                          className="-mt-1 -mr-2 text-ink-2"
                        >
                          Remove
                        </ActionButton>
                      </div>
                      <p className="mt-1.5 text-[15px] whitespace-pre-line">
                        {n.body}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <section>
            <SectionTitle>Promotions</SectionTitle>
            {promos.length ? (
              <ul className="space-y-2">
                {promos.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-[12px] border border-line bg-surface px-4 py-3"
                  >
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold">
                        {p.kind === "solo"
                          ? `Solo sign-off in ${groupName(p.fromGroupId)}`
                          : `${groupName(p.fromGroupId)} to ${groupName(p.toGroupId)}`}
                      </span>
                      <Pill
                        tone={
                          p.status === "approved"
                            ? "good"
                            : p.status === "declined"
                              ? "bad"
                              : "warn"
                        }
                      >
                        {p.status === "proposed"
                          ? "Awaiting sign-off"
                          : p.status === "approved"
                            ? "Approved"
                            : "Declined"}
                      </Pill>
                    </p>
                    <p className="mt-0.5 text-[13px] text-ink-3">
                      {eventName.get(p.eventId ?? "") ?? ""} · recommended by{" "}
                      {who(p.recommendedById)} on {dateOnly(p.createdAt, v.tz)}
                    </p>
                    <p className="mt-2 text-[15px]">{p.rationale}</p>
                    {p.decidedAt ? (
                      <p className="mt-2 border-t border-line pt-2 text-[15px] text-ink-2">
                        {p.status === "approved" ? "Signed off" : "Declined"} by{" "}
                        {who(p.decidedById)} on {dateOnly(p.decidedAt, v.tz)}
                        {p.decisionNote ? `: ${p.decisionNote}` : ""}
                      </p>
                    ) : (
                      <Link
                        href="/admin/promotions"
                        className="mt-2 inline-block text-sm font-semibold underline underline-offset-4"
                      >
                        Review this recommendation
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[15px] text-ink-2">
                No promotions or recommendations on file.
              </p>
            )}
          </section>

          <section>
            <SectionTitle>Instructor session notes</SectionTitle>
            {logs.length ? (
              <ul className="space-y-2">
                {logs.map((l) => (
                  <li
                    key={l.id}
                    className="rounded-[12px] border border-line bg-surface px-4 py-3"
                  >
                    <p className="font-bold">
                      {eventName.get(l.eventId) ?? "Event"} · {l.label}
                    </p>
                    <p className="text-[13px] text-ink-3">
                      {who(l.instructorId)} · {dateTime(l.createdAt, v.tz)}
                    </p>
                    <p className="mt-2 text-[15px] whitespace-pre-line">
                      {l.sharedNotes}
                    </p>
                    {l.privateNotes ? (
                      <div className="mt-2.5 rounded-[10px] bg-warn-soft px-3 py-2.5">
                        <p className="flex items-center gap-1.5 text-[13px] font-bold text-warn">
                          <Lock className="size-3.5" /> Administrators only
                        </p>
                        <p className="mt-0.5 text-[15px]">{l.privateNotes}</p>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[15px] text-ink-2">
                No sessions have been logged for {user.firstName}.
              </p>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-6">
          {v.event ? (
            <section>
              <SectionTitle>{v.event.name}</SectionTitle>
              <Card className="px-4 py-2 sm:px-5">
                {active ? (
                  <DefList
                    rows={[
                      [
                        "Run group",
                        <span key="g">
                          {group?.name}
                          {reg.isInstructor
                            ? " · instructing"
                            : drivesSolo(group?.instructorPolicy, reg)
                              ? " · solo"
                              : " · instructed"}
                        </span>,
                      ],
                      [
                        "Attending",
                        reg.attendsDay1 && reg.attendsDay2
                          ? "Both days"
                          : reg.attendsDay1
                            ? `${dayLabels[0]} only`
                            : `${dayLabels[1]} only`,
                      ],
                      [
                        "Checked in",
                        reg.checkedInAt
                          ? dateTime(reg.checkedInAt, v.tz)
                          : "Not yet",
                      ],
                      [
                        "Waivers",
                        <Link
                          key="w"
                          href={`/admin/waivers/person/${userId}`}
                          className="underline underline-offset-4"
                        >
                          {signed} of {templates.length} signed
                        </Link>,
                      ],
                      [
                        "Tech",
                        <Link
                          key="t"
                          href={tech ? `/admin/tech/${tech.id}` : "/admin/tech"}
                          className="underline underline-offset-4"
                        >
                          {tech?.stickerIssuedAt
                            ? `Sticker ${tech.stickerNumber ?? "issued"}`
                            : techState.label}
                        </Link>,
                      ],
                      ...(assignments.instructor
                        ? ([
                            [
                              "Instructor",
                              fullName(assignments.instructor.user),
                            ],
                          ] as [string, string][])
                        : []),
                      ...(assignments.students.length
                        ? ([
                            [
                              "Students",
                              assignments.students
                                .map((x) => fullName(x.user))
                                .join(", "),
                            ],
                          ] as [string, string][])
                        : []),
                      [
                        "Source",
                        reg.source === "import"
                          ? `Imported${reg.externalId ? ` (${reg.externalId})` : ""}`
                          : "Added by hand",
                      ],
                    ]}
                  />
                ) : (
                  <p className="py-3 text-[15px] text-ink-2">
                    Not registered for this event.
                  </p>
                )}
              </Card>
              {active ? (
                <ActionButton
                  action={removeFromEvent.bind(null, reg.id)}
                  confirm={`Cancel ${user.firstName}'s registration for ${v.event.name}?`}
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-bad"
                >
                  Cancel registration
                </ActionButton>
              ) : null}
            </section>
          ) : null}

          <section>
            <SectionTitle>Contact</SectionTitle>
            <Card className="px-4 py-2 sm:px-5">
              <DefList
                rows={[
                  [
                    "Email",
                    <a
                      key="e"
                      href={`mailto:${user.email}`}
                      className="underline underline-offset-4"
                    >
                      {user.email}
                    </a>,
                  ],
                  [
                    "Phone",
                    user.phone ? (
                      <a
                        key="p"
                        href={`tel:${user.phone.replace(/[^\d+]/g, "")}`}
                        className="underline underline-offset-4"
                      >
                        {user.phone}
                      </a>
                    ) : null,
                  ],
                  [
                    "Address",
                    [
                      user.address1,
                      [user.city, user.state].filter(Boolean).join(", "),
                      user.zip,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  ],
                  [
                    "Emergency contact",
                    [user.emergencyName, user.emergencyPhone]
                      .filter(Boolean)
                      .join(", "),
                  ],
                  ["PCA member", user.pcaMemberNumber],
                  ["T-shirt", reg?.tshirtSize ?? user.tshirtSize],
                  ["Experience", member.experience],
                ]}
              />
            </Card>
          </section>

          <section>
            <SectionTitle>Event history</SectionTitle>
            <ul className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface">
              {history.map((h) => (
                <li
                  key={h.reg.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {h.event.name}
                    </span>
                    <span className="block text-[13px] text-ink-3">
                      {dateRange(h.event.startDate, h.event.endDate)}
                      {h.reg.status === "cancelled" ? " · cancelled" : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <GroupChip
                      group={v.groups.find((g) => g.id === h.reg.runGroupId)}
                      size="sm"
                    />
                    <CarNumber n={h.reg.carNumber} size="sm" />
                  </span>
                </li>
              ))}
              {!history.length ? (
                <li className="px-4 py-3 text-[15px] text-ink-2">
                  No events on record.
                </li>
              ) : null}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
});
