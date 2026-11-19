/* One definition of "signed" and "cleared to drive". Every screen that shows either uses these. */

type TemplateRef = { id: string; version: number };
type SignatureRef = { templateId: string; templateVersion: number };

/** A signature only counts while it is for the template's current version. */
export const isCurrent = (template: Pick<TemplateRef, "version">, sig?: Pick<SignatureRef, "templateVersion"> | null) =>
  Boolean(sig && sig.templateVersion >= template.version);

/** How many of these documents one person has signed at the current version. */
export function currentSignedCount(templates: TemplateRef[], sigs: SignatureRef[]): number {
  return templates.filter((t) => sigs.some((x) => x.templateId === t.id && isCurrent(t, x))).length;
}

/** Cleared to drive: every required waiver signed at its current version, the tech form approved, and a sticker on the car. */
export function clearedToDrive(c: { waiversSigned: number; waiversTotal: number; techStatus: string | null | undefined; sticker: boolean }): boolean {
  return c.waiversSigned >= c.waiversTotal && c.techStatus === "approved" && c.sticker;
}

/** "1 waiver" / "2 waivers". */
export const waiverCount = (n: number) => `${n} waiver${n === 1 ? "" : "s"}`;
