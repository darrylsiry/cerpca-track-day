"use client";

import { Copy, Mail } from "lucide-react";
import Link from "next/link";
import { ActionButton } from "@/components/form";
import { toast } from "@/components/toast";
import { buttonClass, Card, Pill } from "@/components/ui";
import type { ActionResult } from "@/lib/types";

export type Recipient = { role: string; name?: string; email: string };

/**
 * Step two of an incident report: get it to PCA. The app never sends the report
 * itself. It lists who must receive it, opens the administrator's own email with
 * everyone addressed, and records when it went out.
 */
export function SendPanel({
  status,
  sentLabel,
  recipients,
  subject,
  body,
  printHref,
  markSent,
  unmarkSent,
}: {
  status: string;
  sentLabel: string | null;
  recipients: Recipient[];
  subject: string;
  body: string;
  printHref: string;
  markSent: () => Promise<ActionResult>;
  unmarkSent: () => Promise<ActionResult>;
}) {
  const emails = recipients.map((r) => r.email.trim()).filter(Boolean);
  const mailto = `mailto:${emails.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const needAddress = recipients.filter((r) => !r.email.trim());

  async function copy() {
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      toast(
        `${emails.length} address${emails.length === 1 ? "" : "es"} copied`,
      );
    } catch {
      toast(
        "Copying is blocked in this browser. Select the addresses and copy them by hand.",
        "bad",
      );
    }
  }

  return (
    <Card className="px-4 py-4 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="eyebrow text-ink-2">Send to PCA</h2>
        {status === "sent" ? <Pill tone="good">Sent</Pill> : null}
      </div>

      {status === "sent" ? (
        <p className="mt-2 text-[15px]">
          Recorded as sent{sentLabel ? ` on ${sentLabel}` : ""}.
        </p>
      ) : (
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px]">
          <li>
            <Link
              href={printHref}
              className="font-semibold underline underline-offset-4"
            >
              Open the print view
            </Link>{" "}
            and save the report as a PDF.
          </li>
          <li>Email the PDF, with the signed waivers, to everyone below.</li>
          <li>Come back and record it as sent.</li>
        </ol>
      )}

      <ul className="mt-3 divide-y divide-line border-y border-line">
        {recipients.map((r) => (
          <li key={`${r.role}-${r.email}`} className="py-2.5">
            <p className="text-sm font-semibold">
              {r.role}
              {r.name ? (
                <span className="font-normal text-ink-2"> · {r.name}</span>
              ) : null}
            </p>
            {r.email.trim() ? (
              <p className="text-sm break-all text-ink-2">{r.email}</p>
            ) : (
              <p className="text-sm font-semibold text-bad">
                Needs an email address
              </p>
            )}
          </li>
        ))}
        {!recipients.length ? (
          <li className="py-2.5 text-sm font-semibold text-bad">
            No recipients are set up yet.
          </li>
        ) : null}
      </ul>
      {needAddress.length || !recipients.length ? (
        <p className="mt-2 text-sm text-ink-2">
          Add the missing address in{" "}
          <Link
            href="/admin/settings"
            className="font-semibold text-ink underline underline-offset-4"
          >
            Settings
          </Link>
          . Check the list against the current PCA Region Procedures Manual.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={mailto}
          className={buttonClass("secondary", "md", "flex-1")}
          aria-disabled={!emails.length || undefined}
        >
          <Mail className="size-4" /> Open email
        </a>
        <button
          type="button"
          onClick={copy}
          disabled={!emails.length}
          className={buttonClass("secondary", "md", "flex-1")}
        >
          <Copy className="size-4" /> Copy addresses
        </button>
      </div>

      <div className="mt-3 border-t border-line pt-3">
        {status === "sent" ? (
          <ActionButton
            action={unmarkSent}
            variant="ghost"
            size="sm"
            confirm="Mark this report as not sent? The due date will start counting again."
          >
            Mark as not sent
          </ActionButton>
        ) : (
          <ActionButton
            action={markSent}
            variant="primary"
            className="w-full"
            confirm="Record this report as sent to PCA? Only do this after the email has gone out."
          >
            Record as sent to PCA
          </ActionButton>
        )}
      </div>
    </Card>
  );
}
