import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Join class names; later utilities win over earlier conflicting ones (`size-9` + `size-11` → `size-11`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
export const initials = (u: { firstName: string; lastName: string }) => `${u.firstName[0] ?? ""}${u.lastName[0] ?? ""}`.toUpperCase();

export function vehicleLabel(v?: { year?: number | null; make?: string | null; model?: string | null } | null) {
  if (!v) return "";
  return [v.year, v.make, v.model].filter(Boolean).join(" ");
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
