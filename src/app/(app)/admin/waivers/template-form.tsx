"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/form";
import { Field, Notice } from "@/components/ui";
import { saveTemplate } from "./actions";

export type TemplateDraft = {
  id: string | null;
  title: string;
  summary: string;
  body: string;
  required: boolean;
  active: boolean;
  version: number;
};

/** Fields are controlled so nothing typed is lost if the server sends the form back with a problem. */
export function TemplateForm({ template }: { template: TemplateDraft }) {
  const [title, setTitle] = useState(template.title);
  const [summary, setSummary] = useState(template.summary);
  const [body, setBody] = useState(template.body);
  const [required, setRequired] = useState(template.required);
  const [active, setActive] = useState(template.active);
  const [resign, setResign] = useState(false);
  const bodyChanged =
    Boolean(template.id) && body.trim() !== template.body.trim();

  return (
    <ActionForm action={saveTemplate} className="space-y-4">
      {template.id ? (
        <input type="hidden" name="id" value={template.id} />
      ) : null}
      <Field label="Title">
        <input
          name="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="ctl"
          required
          maxLength={160}
        />
      </Field>
      <Field
        label="Summary"
        hint="One line shown in the driver's list, saying what the document is."
        optional
      >
        <input
          name="summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="ctl"
          maxLength={300}
        />
      </Field>
      <Field
        label="Wording"
        hint="Paste the full text. Leave a blank line between paragraphs."
      >
        <textarea
          name="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="ctl min-h-64 text-[15px] leading-relaxed"
          rows={14}
          required
        />
      </Field>
      <div className="space-y-1">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-[15px]">
          <input
            type="checkbox"
            name="required"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
            className="check mt-0.5"
          />
          <span>
            <span className="font-semibold">Required</span>
            <span className="block text-sm text-ink-2">
              Counts toward a driver being cleared, and toward reminders.
            </span>
          </span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-[15px]">
          <input
            type="checkbox"
            name="active"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="check mt-0.5"
          />
          <span>
            <span className="font-semibold">In use</span>
            <span className="block text-sm text-ink-2">
              Turn this off to retire a document. Signatures already collected
              are kept.
            </span>
          </span>
        </label>
        {template.id ? (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-[15px]">
            <input
              type="checkbox"
              name="resign"
              checked={resign}
              onChange={(e) => setResign(e.target.checked)}
              className="check mt-0.5"
            />
            <span>
              <span className="font-semibold">
                Require everyone to sign again
              </span>
              <span className="block text-sm text-ink-2">
                Moves the document from version {template.version} to{" "}
                {template.version + 1}. Existing signatures stay on record but
                no longer count.
              </span>
            </span>
          </label>
        ) : null}
      </div>
      {bodyChanged && !resign ? (
        <Notice tone="warn" title="The wording has changed">
          People who already signed agreed to the earlier wording. Tick “Require
          everyone to sign again” unless this is only a typo fix.
        </Notice>
      ) : null}
      <SubmitButton className="w-full sm:w-auto" pendingLabel="Saving…">
        {template.id ? "Save document" : "Add document"}
      </SubmitButton>
    </ActionForm>
  );
}
