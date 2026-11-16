import { and, asc, eq } from "drizzle-orm";
import { getDb, schema as s } from "@/db";
import type { WaiverSignature, WaiverTemplate } from "@/db/schema";
import { getRoster, type RosterRow } from "./queries";

/** Documents drivers are asked to sign, in display order. */
export async function activeTemplates(orgId: string): Promise<WaiverTemplate[]> {
  const db = await getDb();
  return db
    .select()
    .from(s.waiverTemplates)
    .where(and(eq(s.waiverTemplates.orgId, orgId), eq(s.waiverTemplates.active, true)))
    .orderBy(asc(s.waiverTemplates.sortOrder), asc(s.waiverTemplates.title));
}

export async function allTemplates(orgId: string): Promise<WaiverTemplate[]> {
  const db = await getDb();
  return db.select().from(s.waiverTemplates).where(eq(s.waiverTemplates.orgId, orgId)).orderBy(asc(s.waiverTemplates.sortOrder), asc(s.waiverTemplates.title));
}

/** One person's signatures for an event, keyed by template. */
export async function signaturesFor(eventId: string, userId: string): Promise<Map<string, WaiverSignature>> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(s.waiverSignatures)
    .where(and(eq(s.waiverSignatures.eventId, eventId), eq(s.waiverSignatures.userId, userId)));
  return new Map(rows.map((r) => [r.templateId, r]));
}

/** A signature only counts while it is for the template's current version. */
export const isCurrent = (template: Pick<WaiverTemplate, "version">, sig?: Pick<WaiverSignature, "templateVersion"> | null) =>
  Boolean(sig && sig.templateVersion >= template.version);

export type WaiverCell = { signedAt: Date; version: number; current: boolean };
export type WaiverMatrixRow = {
  person: RosterRow;
  cells: Record<string, WaiverCell | undefined>;
  /** Required documents with no current signature. */
  outstanding: number;
};

/** Who has signed what for an event. Signature images are left out; they are loaded per person. */
export async function waiverMatrix(orgId: string, eventId: string): Promise<{ templates: WaiverTemplate[]; rows: WaiverMatrixRow[] }> {
  const db = await getDb();
  const [templates, roster, sigs] = await Promise.all([
    activeTemplates(orgId),
    getRoster(eventId),
    db
      .select({
        templateId: s.waiverSignatures.templateId,
        userId: s.waiverSignatures.userId,
        version: s.waiverSignatures.templateVersion,
        signedAt: s.waiverSignatures.signedAt,
      })
      .from(s.waiverSignatures)
      .where(eq(s.waiverSignatures.eventId, eventId)),
  ]);
  const byUser = new Map<string, typeof sigs>();
  for (const sig of sigs) {
    const list = byUser.get(sig.userId);
    if (list) list.push(sig);
    else byUser.set(sig.userId, [sig]);
  }
  const rows = roster.map((person) => {
    const mine = byUser.get(person.user.id) ?? [];
    const cells: Record<string, WaiverCell | undefined> = {};
    let outstanding = 0;
    for (const t of templates) {
      const sig = mine.find((x) => x.templateId === t.id);
      const current = Boolean(sig && sig.version >= t.version);
      if (sig) cells[t.id] = { signedAt: sig.signedAt, version: sig.version, current };
      if (t.required && !current) outstanding += 1;
    }
    return { person, cells, outstanding };
  });
  return { templates, rows };
}

export const hasPlaceholder = (body: string) => /PLACEHOLDER/.test(body);

/** Split stored wording into paragraphs for display. */
export const paragraphs = (body: string) =>
  body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
