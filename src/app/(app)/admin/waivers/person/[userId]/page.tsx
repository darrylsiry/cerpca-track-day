import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { ActionButton } from "@/components/form";
import { SignatureImage } from "@/components/signature-pad";
import { screen } from "@/components/shell/skeleton";
import {
  ButtonLink,
  Card,
  DefList,
  EmptyState,
  PageHeader,
  Pill,
} from "@/components/ui";
import { getDb, schema as s } from "@/db";
import { fullName } from "@/lib/cn";
import { dateTime } from "@/lib/time";
import { requireAdmin } from "@/server/auth";
import { sha256 } from "@/server/util";
import { activeTemplates, isCurrent, signaturesFor } from "@/server/waivers";
import { remindPerson } from "../../actions";

export const metadata: Metadata = { title: "Signed waivers" };

export default screen(async function PersonWaiversPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const v = await requireAdmin();
  const { userId } = await params;
  const back = { href: "/admin/waivers", label: "Waivers" };
  const db = await getDb();
  // Only people who belong to this region can be looked up.
  const [found] = await db
    .select({ user: s.users, orgId: s.memberships.orgId })
    .from(s.users)
    .innerJoin(s.memberships, eq(s.memberships.userId, s.users.id))
    .where(and(eq(s.users.id, userId), eq(s.memberships.orgId, v.org.id)))
    .limit(1);
  if (!found || !v.event) {
    return (
      <>
        <PageHeader title="Signed waivers" back={back} />
        <EmptyState
          title={v.event ? "That person was not found" : "No event is in focus"}
          action={
            <ButtonLink href="/admin/waivers">Back to waivers</ButtonLink>
          }
        >
          {v.event
            ? "They may have been removed from the region."
            : "Signatures are kept per event. Select an event first."}
        </EmptyState>
      </>
    );
  }
  const [templates, signatures] = await Promise.all([
    activeTemplates(v.org.id),
    signaturesFor(v.event.id, userId),
  ]);
  const outstanding = templates.filter(
    (t) => t.required && !isCurrent(t, signatures.get(t.id)),
  ).length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={fullName(found.user)}
        lede={`Signed waivers for ${v.event.name}.`}
        back={back}
        actions={
          outstanding ? (
            <ActionButton action={remindPerson.bind(null, userId)}>
              Remind about {outstanding} unsigned
            </ActionButton>
          ) : undefined
        }
      />
      <ul className="space-y-4">
        {templates.map((t) => {
          const sig = signatures.get(t.id);
          const current = isCurrent(t, sig);
          return (
            <li key={t.id}>
              <Card className="px-4 py-4 sm:px-6 sm:py-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg leading-tight font-bold">{t.title}</h2>
                  <Pill
                    tone={
                      current
                        ? "good"
                        : sig
                          ? "warn"
                          : t.required
                            ? "bad"
                            : "neutral"
                    }
                  >
                    {current
                      ? "Signed"
                      : sig
                        ? "Signed an earlier version"
                        : t.required
                          ? "Not signed"
                          : "Not signed (optional)"}
                  </Pill>
                </div>
                {sig ? (
                  <>
                    <div className="mt-3">
                      <SignatureImage
                        src={sig.signatureData}
                        alt={`Signature of ${sig.signedName}`}
                      />
                    </div>
                    <DefList
                      className="mt-2"
                      rows={[
                        ["Signed by", sig.signedName],
                        ["Signed", dateTime(sig.signedAt, v.tz)],
                        [
                          "Document version",
                          `Version ${sig.templateVersion}${current ? " (current)" : `, now superseded by version ${t.version}`}`,
                        ],
                        [
                          "Wording",
                          sig.bodyHash
                            ? sig.bodyHash === sha256(t.body)
                              ? "Matches the wording in use today"
                              : "Signed different wording from what is in use today"
                            : "No fingerprint recorded",
                        ],
                        ["IP address", sig.ip ?? ""],
                        ["Device", sig.userAgent ?? ""],
                      ]}
                    />
                  </>
                ) : (
                  <p className="mt-2 text-[15px] text-ink-2">
                    No signature on file for this event.
                  </p>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      {!templates.length ? (
        <EmptyState title="No documents are in use">
          Add documents under Waivers, then signatures will be listed here.
        </EmptyState>
      ) : null}
    </div>
  );
});
