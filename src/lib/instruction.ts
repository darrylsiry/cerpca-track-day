/*
 * Who rides with an instructor at an event.
 *
 * A run group's policy decides the default: always instructed (Green),
 * instructed until signed off solo (Blue), or solo by default (White, Black).
 * A solo driver can still be paired: they can ask for a ride-along, and
 * administrators can ask an instructor to check in on them.
 */

export type InstructorNeed = "required" | "instructed" | "ride_along" | "check_in";

export function instructorNeed(
  policy: string | null | undefined,
  driver: { solo: boolean; isInstructor?: boolean; instructorRequest?: string | null },
): InstructorNeed | null {
  if (driver.isInstructor) return null;
  if (policy === "required") return "required";
  if (policy === "optional" && !driver.solo) return "instructed";
  if (driver.instructorRequest === "ride_along" || driver.instructorRequest === "check_in") return driver.instructorRequest;
  return null;
}

/**
 * Whether a driver goes out without an instructor as a matter of course. The
 * run group decides first and the solo sign-off second: Green is always
 * instructed, Blue is instructed until signed off, White and Black are solo.
 *
 * Use this wherever a screen says "Solo" or "Instructed". The stored `solo`
 * flag alone is only the sign-off: a driver moved up to White is solo without
 * it, and a driver moved down to Green is instructed in spite of it.
 */
export function drivesSolo(policy: string | null | undefined, driver: { solo: boolean; isInstructor?: boolean }): boolean {
  return instructorNeed(policy, { solo: driver.solo, isInstructor: driver.isInstructor }) === null;
}

/** A solo sign-off means something only in a group that is instructed until signed off. */
export const canSignOffSolo = (policy: string | null | undefined, driver: { solo: boolean }) => policy === "optional" && !driver.solo;

/** A solo driver who is not instructing can ask for an instructor to ride along. */
export function canAskForInstructor(
  group: { instructorPolicy: string; isInstructorGroup: boolean } | null | undefined,
  driver: { solo: boolean; isInstructor?: boolean; instructorRequest?: string | null },
): boolean {
  if (!group || group.isInstructorGroup || driver.isInstructor) return false;
  return instructorNeed(group.instructorPolicy, driver) === null;
}

/** Short status for a pill beside a driver's name. */
export const NEED_LABEL: Record<InstructorNeed, string> = {
  required: "Instructed",
  instructed: "Instructed",
  ride_along: "Asked for a ride-along",
  check_in: "Check-in",
};

/** One line per instructor policy, for settings and profiles. */
export const POLICY_LABEL: Record<string, string> = {
  required: "Always instructed",
  optional: "Instructed until signed off solo",
  none: "Solo by default; instructor on request",
};
