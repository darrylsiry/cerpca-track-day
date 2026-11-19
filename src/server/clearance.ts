import { and, eq } from "drizzle-orm";
import { getDb, schema as s } from "@/db";
import type { TechInspection } from "@/db/schema";
import { clearedToDrive, currentSignedCount } from "@/lib/clearance";

/* Paperwork that decides whether a driver may go on track. The counting rules live in @/lib/clearance. */

export type Clearance = {
  waiversTotal: number;
  /** Required waivers signed at their current version. */
  waiversSigned: number;
  /** Required waivers still to sign (or sign again). */
  waiversLeft: number;
  tech: TechInspection | null;
  /** Waivers current, tech form approved and sticker issued. */
  cleared: boolean;
};

async function requiredTemplates(orgId: string) {
  const db = await getDb();
  return db
    .select({ id: s.waiverTemplates.id, version: s.waiverTemplates.version })
    .from(s.waiverTemplates)
    .where(and(eq(s.waiverTemplates.orgId, orgId), eq(s.waiverTemplates.active, true), eq(s.waiverTemplates.required, true)));
}

/** One person's waivers, tech form and sticker for an event. */
export async function clearanceFor(orgId: string, eventId: string, userId: string): Promise<Clearance> {
  const db = await getDb();
  const [required, sigs, [tech]] = await Promise.all([
    requiredTemplates(orgId),
    db
      .select({ templateId: s.waiverSignatures.templateId, templateVersion: s.waiverSignatures.templateVersion })
      .from(s.waiverSignatures)
      .where(and(eq(s.waiverSignatures.eventId, eventId), eq(s.waiverSignatures.userId, userId))),
    db
      .select()
      .from(s.techInspections)
      .where(and(eq(s.techInspections.eventId, eventId), eq(s.techInspections.userId, userId)))
      .limit(1),
  ]);
  const waiversTotal = required.length;
  const waiversSigned = currentSignedCount(required, sigs);
  return {
    waiversTotal,
    waiversSigned,
    waiversLeft: waiversTotal - waiversSigned,
    tech: tech ?? null,
    cleared: clearedToDrive({ waiversSigned, waiversTotal, techStatus: tech?.status, sticker: Boolean(tech?.stickerIssuedAt) }),
  };
}

/** For a whole event: how many required waivers there are, and how many each person has signed at the current version. */
export async function waiverCounts(orgId: string, eventId: string): Promise<{ total: number; signedBy: Map<string, number> }> {
  const db = await getDb();
  const [required, sigs] = await Promise.all([
    requiredTemplates(orgId),
    db
      .select({ userId: s.waiverSignatures.userId, templateId: s.waiverSignatures.templateId, templateVersion: s.waiverSignatures.templateVersion })
      .from(s.waiverSignatures)
      .where(eq(s.waiverSignatures.eventId, eventId)),
  ]);
  const byUser = new Map<string, typeof sigs>();
  for (const sig of sigs) {
    const list = byUser.get(sig.userId);
    if (list) list.push(sig);
    else byUser.set(sig.userId, [sig]);
  }
  return { total: required.length, signedBy: new Map([...byUser].map(([userId, mine]) => [userId, currentSignedCount(required, mine)])) };
}
