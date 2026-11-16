import { ArrowRight, Check, ChevronRight, CircleDashed, LogOut } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { PushToggle } from "@/components/push-toggle";
import { screen } from "@/components/shell/skeleton";
import { Card, CarNumber, DefList, EmptyState, GroupChip, PageHeader, Pill } from "@/components/ui";
import { cn, fullName, initials, vehicleLabel } from "@/lib/cn";
import { TECH_STATUS } from "@/lib/tech-form";
import { dateOnly, dateRange } from "@/lib/time";
import { getViewer } from "@/server/auth";
import { getProfile } from "@/server/profile";
import { getChecklist } from "@/server/queries";
import { CarSheet, ContactSheet, NotificationPrefs } from "./profile-forms";

export const metadata: Metadata = { title: "Profile and car" };

export default screen(async function ProfilePage() {
  const v = await getViewer();
  const [profile, checklist] = await Promise.all([getProfile(v), getChecklist(v)]);
  const u = v.user;
  const car = profile.vehicle;
  const carNumber = v.registration?.carNumber ?? car?.carNumber ?? null;
  const groupById = new Map(v.groups.map((g) => [g.id, g]));
  const roles = [v.membership.adminTitle, v.isInstructor ? (v.membership.instructorCredential ?? "Instructor") : null].filter(Boolean);
  const address = [u.address1, [u.city, u.state].filter(Boolean).join(", "), u.zip].filter(Boolean).join(" · ");

  const solo = v.registration?.solo ?? v.membership.soloApproved;
  const drivingStatus = !v.group
    ? null
    : v.group.isInstructorGroup
      ? "You drive in the instructor group."
      : v.group.instructorPolicy === "required"
        ? "Instructed: an instructor rides with you every session."
        : v.group.instructorPolicy === "optional"
          ? solo
            ? `${v.group.name} (Solo): signed off to drive without an instructor.`
            : `${v.group.name} (Instructed): an instructor rides with you until you are signed off solo.`
          : "Solo. You can ask for an instructor to ride along from the Now screen.";

  const tech = checklist?.tech ?? null;
  const waiversDone = checklist ? checklist.waiversSigned >= checklist.waiversTotal : true;
  const paperwork = checklist
    ? [
        {
          href: "/me/waivers",
          title: "Waivers",
          done: waiversDone,
          detail: waiversDone ? `All ${checklist.waiversTotal} signed` : `${checklist.waiversSigned} of ${checklist.waiversTotal} signed`,
        },
        {
          href: "/me/tech",
          title: "Tech inspection",
          done: tech?.status === "approved",
          detail: tech?.stickerIssuedAt ? `Approved · sticker ${tech.stickerNumber ?? "issued"}` : (TECH_STATUS[tech?.status ?? "none"] ?? TECH_STATUS.none).label,
        },
      ]
    : [];

  return (
    <>
      <PageHeader title="Profile and car" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <div className="min-w-0 space-y-4">
          {/* Who you are at this event */}
          <Card className="overflow-hidden">
            <div className="wristband h-2 border-b border-ink/15" aria-hidden />
            <div className="flex items-center gap-4 px-4 py-4 sm:px-5">
              <span aria-hidden className="inline-grid size-14 shrink-0 place-items-center rounded-full bg-sunk text-lg font-bold text-ink-2">
                {initials(u)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xl leading-tight font-bold">{fullName(u)}</p>
                <p className="truncate text-[15px] text-ink-2">{u.email}</p>
                {roles.length ? <p className="mt-0.5 text-sm font-semibold text-ink-2">{roles.join(" · ")}</p> : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <GroupChip group={v.group} size="lg" />
                <CarNumber n={carNumber} />
              </div>
            </div>
          </Card>

          {v.registration && v.event && paperwork.length ? (
            <Card>
              <h2 className="eyebrow px-4 pt-4 text-ink-2 sm:px-5">Paperwork for {v.event.name}</h2>
              <ul className="mt-1.5 divide-y divide-line">
                {paperwork.map((p) => (
                  <li key={p.href}>
                    <Link href={p.href} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-paper sm:px-5">
                      <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", p.done ? "bg-good text-white" : "bg-warn-soft text-warn")}>
                        {p.done ? <Check className="size-4" strokeWidth={3} aria-hidden /> : <CircleDashed className="size-4" strokeWidth={2.5} aria-hidden />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold">{p.title}</span>
                        <span className="block text-sm text-ink-2">{p.detail}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="eyebrow text-ink-2">Your details</h2>
              <ContactSheet
                values={{
                  email: u.email,
                  phone: u.phone ?? "",
                  address1: u.address1 ?? "",
                  city: u.city ?? "",
                  state: u.state ?? "",
                  zip: u.zip ?? "",
                  emergencyName: u.emergencyName ?? "",
                  emergencyPhone: u.emergencyPhone ?? "",
                  tshirtSize: u.tshirtSize ?? "",
                  pcaMemberNumber: u.pcaMemberNumber ?? "",
                }}
              />
            </div>
            <DefList
              className="mt-1"
              rows={[
                ["Email", u.email],
                ["Mobile phone", u.phone],
                ["Address", address],
                ["Emergency contact", [u.emergencyName, u.emergencyPhone].filter(Boolean).join(" · ")],
                ["T-shirt size", u.tshirtSize],
                ["PCA member no.", u.pcaMemberNumber],
              ]}
            />
          </Card>

          <Card className="px-4 py-4 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="eyebrow text-ink-2">Your car</h2>
              <CarSheet
                onRoster={Boolean(v.registration && v.event && v.event.status !== "completed")}
                values={{ year: car?.year ? String(car.year) : "", make: car?.make ?? "", model: car?.model ?? "", color: car?.color ?? "", carNumber: carNumber ?? "" }}
              />
            </div>
            {car ? (
              <div className="mt-3 flex items-center gap-4">
                <CarNumber n={carNumber} size="lg" />
                <div className="min-w-0">
                  <p className="text-lg leading-tight font-bold">{vehicleLabel(car)}</p>
                  {car.color ? <p className="text-[15px] text-ink-2">{car.color}</p> : null}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[15px] text-ink-2">No car on file yet. Add the one you will bring so tech and your instructor know what to look for.</p>
            )}
          </Card>

          <Card id="notifications" className="scroll-mt-24 px-4 py-4 sm:px-5">
            <h2 className="eyebrow text-ink-2">How we reach you</h2>
            <p className="mt-1 text-sm text-ink-2">Alerts always appear in the app. These are in addition.</p>
            <NotificationPrefs email={u.notifyEmail} sms={u.notifySms} push={u.notifyPush} hasPhone={Boolean(u.phone)} emailAddress={u.email} phone={u.phone ?? ""} />
            <PushToggle flat className="mt-1 border-t border-line pt-4" />
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {v.group ? (
            <Card className="px-4 py-4 sm:px-5">
              <h2 className="eyebrow text-ink-2">Your run group</h2>
              <div className="mt-2.5 flex items-center gap-3">
                <GroupChip group={v.group} size="lg" />
                <p className="text-lg font-bold">{v.group.summary}</p>
              </div>
              <p className="mt-2.5 text-[15px] text-ink">{v.group.description}</p>
              <DefList
                className="mt-2 border-t border-line"
                rows={[
                  ["Driving", drivingStatus],
                  ["Experience", v.membership.experience],
                ]}
              />
              <Link href="/track/passing" className="mt-1 inline-flex h-10 items-center gap-1.5 text-[15px] font-semibold underline underline-offset-4">
                Your passing zones <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Card>
          ) : null}

          <section>
            <h2 className="eyebrow mb-2.5 text-ink-2">Feedback from your instructors</h2>
            {profile.feedback.length ? (
              <ul className="space-y-3">
                {profile.feedback.map((f) => (
                  <li key={f.id} className="rounded-[14px] border border-line bg-surface px-4 py-3.5 sm:px-5">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-bold">{f.label}</span>
                      <span className="text-[13px] text-ink-3">{dateOnly(f.createdAt, v.tz)}</span>
                    </p>
                    <p className="text-sm text-ink-2">
                      {f.eventName} · {f.instructorFirst} {f.instructorLast}
                    </p>
                    <p className="mt-2 text-[16px] leading-relaxed whitespace-pre-line">{f.sharedNotes}</p>
                    {f.focusAreas.length ? (
                      <p className="mt-2.5 flex flex-wrap gap-1.5">
                        {f.focusAreas.map((area) => (
                          <Pill key={area}>{area}</Pill>
                        ))}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No session notes yet">After each instructed session, your instructor&apos;s notes for you will appear here.</EmptyState>
            )}
          </section>

          {profile.promotions.length ? (
            <Card>
              <h2 className="eyebrow px-4 pt-4 text-ink-2 sm:px-5">Promotions</h2>
              <ul className="mt-1.5 divide-y divide-line">
                {profile.promotions.map((p) => {
                  const from = p.fromGroupId ? groupById.get(p.fromGroupId) : null;
                  const to = p.toGroupId ? groupById.get(p.toGroupId) : null;
                  return (
                    <li key={p.id} className="px-4 py-3 sm:px-5">
                      <p className="flex flex-wrap items-center gap-2 font-bold">
                        {p.kind === "solo" ? (
                          <>
                            Signed off to drive solo <GroupChip group={to ?? from} size="sm" />
                          </>
                        ) : (
                          <>
                            <GroupChip group={from} size="sm" /> <ArrowRight className="size-4 text-ink-2" aria-label="to" /> <GroupChip group={to} size="sm" />
                          </>
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-2">
                        {[p.eventName, p.recommenderFirst ? `recommended by ${p.recommenderFirst} ${p.recommenderLast}` : null, p.decidedAt ? `approved ${dateOnly(p.decidedAt, v.tz)}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}

          <Card>
            <h2 className="eyebrow px-4 pt-4 text-ink-2 sm:px-5">Events with {v.org.shortName}</h2>
            {profile.history.length ? (
              <ul className="mt-1.5 divide-y divide-line">
                {profile.history.map((h) => (
                  <li key={h.eventId} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{h.name}</p>
                      <p className="truncate text-sm text-ink-2">
                        {dateRange(h.startDate, h.endDate)} · {h.track}
                        {h.instructing ? " · instructing" : ""}
                      </p>
                    </div>
                    {h.eventId === v.event?.id && !v.viewingOtherEvent ? <Pill tone="good">This event</Pill> : h.status !== "completed" ? <Pill tone="info">Upcoming</Pill> : null}
                    <GroupChip group={groupById.get(h.groupId)} size="sm" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 pt-2 pb-4 text-[15px] text-ink-2 sm:px-5">Your events will be listed here once you are on a roster.</p>
            )}
          </Card>

          <form action={signOut}>
            <button className="flex h-12 w-full items-center justify-center gap-2 rounded-[12px] border border-line-strong bg-surface text-[15px] font-semibold hover:bg-sunk">
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </form>
        </div>
      </div>
    </>
  );
});
