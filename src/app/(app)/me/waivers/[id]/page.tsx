import { ArrowRight, Check } from "lucide-react";
import type { Metadata } from "next";
import { SignatureImage } from "@/components/signature-pad";
import { screen } from "@/components/shell/skeleton";
import { ButtonLink, Card, DefList, EmptyState, Notice, PageHeader, Pill } from "@/components/ui";
import { fullName } from "@/lib/cn";
import { dateTime } from "@/lib/time";
import { getViewer } from "@/server/auth";
import { activeTemplates, isCurrent, paragraphs, signaturesFor } from "@/server/waivers";
import { SignWaiverForm } from "../sign-form";

export const metadata: Metadata = { title: "Waiver" };

export default screen(async function WaiverPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await getViewer();
  const { id } = await params;
  const back = { href: "/me/waivers", label: "Waivers" };
  if (!v.event) {
    return (
      <>
        <PageHeader title="Waiver" back={back} />
        <EmptyState title="Nothing to sign yet">Waivers are signed once per event, and no event is scheduled.</EmptyState>
      </>
    );
  }
  const [templates, signatures] = await Promise.all([activeTemplates(v.org.id), signaturesFor(v.event.id, v.user.id)]);
  const template = templates.find((t) => t.id === id);
  if (!template) {
    return (
      <>
        <PageHeader title="Waiver" back={back} />
        <EmptyState title="That document is no longer in use" action={<ButtonLink href="/me/waivers">Back to waivers</ButtonLink>}>
          The region may have replaced it. Your list of waivers shows what needs signing now.
        </EmptyState>
      </>
    );
  }
  const sig = signatures.get(template.id);
  const current = isCurrent(template, sig);
  const next = templates.find((t) => t.id !== template.id && t.required && !isCurrent(t, signatures.get(t.id)));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={template.title} lede={template.summary ?? undefined} back={back} />

      {current && sig ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-good/30 bg-good-soft px-4 py-3.5">
          <p className="flex items-center gap-2.5 font-bold text-good">
            <span className="grid size-7 place-items-center rounded-full bg-good text-white">
              <Check className="size-4" strokeWidth={3} />
            </span>
            Signed for {v.event.name}
          </p>
          {next ? (
            <ButtonLink href={`/me/waivers/${next.id}`} size="sm">
              Next: {next.title} <ArrowRight className="size-4" />
            </ButtonLink>
          ) : (
            <ButtonLink href="/me/waivers" variant="secondary" size="sm">
              Back to waivers
            </ButtonLink>
          )}
        </div>
      ) : sig ? (
        <Notice tone="warn" title="This document was updated after you signed it" className="mb-4">
          Read the current wording below and sign again.
        </Notice>
      ) : null}

      <Card className="px-4 py-5 sm:px-7 sm:py-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="eyebrow text-ink-2">The document</h2>
          <Pill>Version {template.version}</Pill>
        </div>
        <div className="prose-td">
          {paragraphs(template.body).map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>
      </Card>

      {current && sig ? (
        <Card className="mt-4 px-4 py-4 sm:px-7 sm:py-5">
          <h2 className="eyebrow text-ink-2">Your signature</h2>
          <div className="mt-3">
            <SignatureImage src={sig.signatureData} alt={`Signature of ${sig.signedName}`} />
          </div>
          <DefList
            className="mt-2"
            rows={[
              ["Signed by", sig.signedName],
              ["Signed", dateTime(sig.signedAt, v.tz)],
              ["Document", `Version ${sig.templateVersion}`],
              ["For", v.event.name],
            ]}
          />
        </Card>
      ) : (
        <Card className="mt-4 px-4 py-5 sm:px-7 sm:py-6">
          <h2 className="eyebrow mb-3 text-ink-2">Sign</h2>
          <SignWaiverForm templateId={template.id} defaultName={fullName(v.user)} />
        </Card>
      )}
    </div>
  );
});
