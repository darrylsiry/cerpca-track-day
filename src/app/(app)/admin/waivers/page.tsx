import { BellRing, Check, Minus, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { CSSProperties } from "react";
import { ActionButton } from "@/components/form";
import { Sheet } from "@/components/sheet";
import { screen } from "@/components/shell/skeleton";
import {
  buttonClass,
  Card,
  CarNumber,
  EmptyState,
  GroupChip,
  Notice,
  PageHeader,
  Pill,
  Segmented,
} from "@/components/ui";
import { cn, fullName } from "@/lib/cn";
import { dateOnly, monthDay, zoned } from "@/lib/time";
import { requireAdmin } from "@/server/auth";
import { allTemplates, hasPlaceholder, waiverMatrix } from "@/server/waivers";
import { remindAllUnsigned, remindPerson } from "./actions";
import { TemplateForm } from "./template-form";

export const metadata: Metadata = { title: "Waivers" };

type Search = Promise<Record<string, string | string[] | undefined>>;

export default screen(async function AdminWaiversPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const v = await requireAdmin();
  const sp = await searchParams;
  const tab = sp.tab === "documents" ? "documents" : "signatures";
  const show = sp.show === "unsigned" ? "unsigned" : "all";

  return (
    <>
      <PageHeader
        title="Waivers"
        lede={
          v.event
            ? `Who has signed what for ${v.event.name}, and the documents drivers are asked to sign.`
            : "The documents drivers are asked to sign before each event."
        }
      />

      <Notice
        tone="warn"
        title="Confirm this with PCA before relying on it"
        className="mb-5"
      >
        PCA&apos;s event insurance depends on a signed Release and Waiver from
        every adult on site. Ask the PCA national office whether signatures
        collected in this app satisfy that requirement, or whether they must
        still be collected on the PCA-approved form.
      </Notice>

      <Segmented
        label="Waivers views"
        current={tab}
        items={[
          { key: "signatures", label: "Signatures", href: "/admin/waivers" },
          {
            key: "documents",
            label: "Documents",
            href: "/admin/waivers?tab=documents",
          },
        ]}
        className="mb-5"
      />

      {tab === "documents" ? (
        <Documents orgId={v.org.id} tz={v.tz} />
      ) : (
        <Signatures
          orgId={v.org.id}
          eventId={v.event?.id ?? null}
          eventName={v.event?.name ?? ""}
          tz={v.tz}
          show={show}
        />
      )}
    </>
  );
});

/* ───────────── Signatures for the event in focus ───────────── */

async function Signatures({
  orgId,
  eventId,
  eventName,
  tz,
  show,
}: {
  orgId: string;
  eventId: string | null;
  eventName: string;
  tz: string;
  show: "all" | "unsigned";
}) {
  if (!eventId) {
    return (
      <EmptyState title="No event is in focus">
        Signatures are collected per event. Create or select an event to see who
        has signed.
      </EmptyState>
    );
  }
  const { templates, rows } = await waiverMatrix(orgId, eventId);
  if (!templates.length) {
    return (
      <EmptyState
        title="No documents are in use"
        action={
          <Link href="/admin/waivers?tab=documents" className={buttonClass()}>
            Set up documents
          </Link>
        }
      >
        Add the waivers drivers should sign, and this screen will track who has
        signed each one.
      </EmptyState>
    );
  }
  const pending = rows.filter((r) => r.outstanding > 0);
  const visible = show === "unsigned" ? pending : rows;
  const cols = {
    "--cols": `minmax(0, 1.5fr) repeat(${templates.length}, minmax(0, 1fr)) 12.5rem`,
  } as CSSProperties;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => {
          const signed = rows.filter((r) => r.cells[t.id]?.current).length;
          const pct = rows.length ? signed / rows.length : 0;
          return (
            <div
              key={t.id}
              className="rounded-[14px] border border-line bg-surface px-4 py-3.5"
            >
              <p className="flex items-start justify-between gap-2 text-sm font-semibold">
                <span className="min-w-0">{t.title}</span>
                {!t.required ? <Pill>Optional</Pill> : null}
              </p>
              <p className="board mt-2 text-[2.2rem]">
                {signed}
                <span className="text-ink-3">/{rows.length}</span>
              </p>
              <div
                className="mt-2 h-2 overflow-hidden rounded-full bg-sunk"
                role="progressbar"
                aria-label={`${t.title}: signed`}
                aria-valuemin={0}
                aria-valuemax={rows.length}
                aria-valuenow={signed}
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    pct === 1 ? "bg-good" : "bg-ink",
                  )}
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Filter people"
          current={show}
          items={[
            {
              key: "all",
              label: "Everyone",
              href: "/admin/waivers",
              count: rows.length,
            },
            {
              key: "unsigned",
              label: "Unsigned",
              href: "/admin/waivers?show=unsigned",
              count: pending.length,
            },
          ]}
        />
        <ActionButton
          action={remindAllUnsigned}
          variant="primary"
          disabled={!pending.length}
          confirm={`Send a reminder to ${pending.length} ${pending.length === 1 ? "person" : "people"} with unsigned waivers for ${eventName}? It goes out in the app, by email and as a push notification.`}
        >
          <BellRing className="size-4" /> Remind everyone with unsigned waivers
        </ActionButton>
      </div>

      {!visible.length ? (
        <div className="mt-4">
          <EmptyState
            title={
              rows.length
                ? "Everyone has signed the required waivers"
                : "Nobody is registered for this event yet"
            }
          >
            {rows.length
              ? "Switch to Everyone to see the full list."
              : "People appear here as soon as they are on the roster."}
          </EmptyState>
        </div>
      ) : (
        <Card className="mt-4">
          <div
            style={cols}
            className="hidden border-b border-line px-5 py-2.5 md:grid md:[grid-template-columns:var(--cols)] md:items-end md:gap-4"
          >
            <p className="eyebrow text-[11px] text-ink-3">Driver</p>
            {templates.map((t) => (
              <p key={t.id} className="eyebrow text-[11px] text-ink-3">
                {t.title}
              </p>
            ))}
            <span />
          </div>
          <ul className="divide-y divide-line">
            {visible.map(({ person, cells, outstanding }) => (
              <li
                key={person.user.id}
                style={cols}
                className="px-4 py-3.5 sm:px-5 md:grid md:[grid-template-columns:var(--cols)] md:items-center md:gap-4"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="min-w-0 truncate font-bold">
                    {fullName(person.user)}
                  </span>
                  <GroupChip group={person.group} size="sm" />
                  <CarNumber n={person.reg.carNumber} size="sm" />
                </div>
                {templates.map((t) => {
                  const cell = cells[t.id];
                  const ok = Boolean(cell?.current);
                  return (
                    <div
                      key={t.id}
                      className="mt-2 flex items-center gap-2 text-sm md:mt-0"
                    >
                      <span
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded-full",
                          ok
                            ? "bg-good text-white"
                            : t.required
                              ? "bg-warn-soft text-warn"
                              : "bg-sunk text-ink-3",
                        )}
                      >
                        {ok ? (
                          <Check className="size-3.5" strokeWidth={3} />
                        ) : (
                          <Minus className="size-3.5" strokeWidth={3} />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="font-semibold md:sr-only">
                          {t.title}:{" "}
                        </span>
                        <span
                          className={cn(
                            ok
                              ? "text-ink-2"
                              : t.required
                                ? "font-semibold text-warn"
                                : "text-ink-3",
                          )}
                        >
                          {ok && cell
                            ? `Signed ${monthDay(zoned(cell.signedAt, tz).day)}`
                            : cell
                              ? "Signed an earlier version"
                              : t.required
                                ? "Not signed"
                                : "Not signed (optional)"}
                        </span>
                      </span>
                    </div>
                  );
                })}
                <div className="mt-3 flex gap-2 md:mt-0 md:justify-end">
                  {outstanding ? (
                    <ActionButton
                      action={remindPerson.bind(null, person.user.id)}
                      size="sm"
                      className="h-11 flex-1 md:h-9 md:flex-none"
                    >
                      Remind
                    </ActionButton>
                  ) : null}
                  <Link
                    href={`/admin/waivers/person/${person.user.id}`}
                    className={buttonClass(
                      "ghost",
                      "sm",
                      "h-11 flex-1 border border-line-strong md:h-9 md:flex-none",
                    )}
                  >
                    Signed copies
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/* ───────────── The documents themselves ───────────── */

async function Documents({ orgId, tz }: { orgId: string; tz: string }) {
  const templates = await allTemplates(orgId);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[60ch] text-[15px] text-ink-2">
          Drivers sign every document that is in use, once per event. Paste the
          official wording; the app records which version each person signed.
        </p>
        <Sheet
          wide
          title="Add a document"
          trigger={
            <>
              <Plus className="size-4" /> Add a document
            </>
          }
          triggerClassName={buttonClass("primary", "md")}
        >
          <TemplateForm
            template={{
              id: null,
              title: "",
              summary: "",
              body: "",
              required: true,
              active: true,
              version: 1,
            }}
          />
        </Sheet>
      </div>

      {!templates.length ? (
        <EmptyState title="No documents yet">
          Add the PCA release, the track&apos;s waiver and anything else drivers
          must sign before they go on track.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {templates.map((t) => (
            <li key={t.id}>
              <Card className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-lg leading-tight font-bold">
                        {t.title}
                      </span>
                      <Pill tone={t.active ? "good" : "neutral"}>
                        {t.active ? "In use" : "Retired"}
                      </Pill>
                      <Pill>{t.required ? "Required" : "Optional"}</Pill>
                    </p>
                    {t.summary ? (
                      <p className="mt-1 text-[15px] text-ink-2">{t.summary}</p>
                    ) : null}
                    <p className="mt-1 text-[13px] text-ink-3">
                      Version {t.version} · last changed{" "}
                      {dateOnly(t.updatedAt, tz)}
                    </p>
                  </div>
                  <Sheet
                    wide
                    title="Edit document"
                    description={t.title}
                    trigger="Edit"
                    triggerClassName={buttonClass("secondary", "md")}
                  >
                    <TemplateForm
                      template={{
                        id: t.id,
                        title: t.title,
                        summary: t.summary ?? "",
                        body: t.body,
                        required: t.required,
                        active: t.active,
                        version: t.version,
                      }}
                    />
                  </Sheet>
                </div>
                {hasPlaceholder(t.body) ? (
                  <Notice
                    tone="bad"
                    title="Still placeholder wording"
                    className="mt-3"
                  >
                    Replace this text with the official document before
                    collecting signatures for a real event. Signatures on
                    placeholder wording mean nothing.
                  </Notice>
                ) : null}
                <details className="mt-3">
                  <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold underline underline-offset-4">
                    Read the wording
                  </summary>
                  <p className="prose-td mt-2 text-[15px] whitespace-pre-line text-ink-2">
                    {t.body}
                  </p>
                </details>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
