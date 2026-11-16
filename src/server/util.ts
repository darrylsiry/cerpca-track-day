import { createHash } from "node:crypto";
import type { ActionResult } from "@/lib/types";

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Action results. */
export const ok = (message?: string): ActionResult => ({ ok: true, message });
export const fail = (error: string): ActionResult => ({ ok: false, error });

/** FormData readers that never return null. */
export const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();
export const bool = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return v === "on" || v === "true" || v === "1" || v === "yes";
};
export const strs = (fd: FormData, key: string) => fd.getAll(key).map((v) => String(v)).filter(Boolean);
export const intOrNull = (fd: FormData, key: string) => {
  const v = str(fd, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Turn a thrown error from a Server Action into a result the form can show. */
export function asFailure(err: unknown): ActionResult {
  // Let Next.js redirects and not-found signals through untouched.
  if (err && typeof err === "object" && "digest" in err && typeof (err as { digest: unknown }).digest === "string" && String((err as { digest: string }).digest).startsWith("NEXT_")) throw err;
  console.error(err);
  return fail(err instanceof Error && err.message ? err.message : "Something went wrong. Try again.");
}
