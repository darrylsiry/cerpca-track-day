import { addBusinessDays, addDays, weekdayIndex } from "./time";
import type { ActionResult, IncidentData, IncidentParty } from "./types";

/*
 * Rules and helpers for the PCA "Incident Report – Driving Event" form,
 * taken from the PCA Guidelines for Incident Reports (January 2017).
 * Shared by the form (browser) and the Server Actions.
 */

/** When PCA requires an Incident Report. Keys are stored in `incidents.criteria`. */
export const INCIDENT_CRITERIA: { key: string; label: string; help: string }[] = [
  {
    key: "car_to_car",
    label: "Car-to-car contact of any sort",
    help: "Report it whether or not the damage can be rubbed out.",
  },
  {
    key: "immovable_object",
    label: "Car damage from contact with an immovable object that cannot be buffed out",
    help: "Not required for damage caused by contact with debris, or for damage to the undercarriage, wheels or suspension from an off-track excursion.",
  },
  {
    key: "injury",
    label: "Injury to a person",
    help: "Report it even when none of the other criteria are met.",
  },
  {
    key: "off_track_injury",
    label: "Potential or actual injury to a person away from the track",
    help: "Any incident that does not happen in an on-track environment, such as the paddock or the grid.",
  },
  {
    key: "altercation",
    label: "Verbal altercation with an event or region official",
    help: "Between one or more individuals and an event or Region official.",
  },
];

export const INCIDENT_RULE =
  "Reports are due at PCA within five business days of the incident. When there is bodily injury, the report is due the next business day. File one report per car.";

export const INCIDENT_STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "good" }> = {
  draft: { label: "Draft", tone: "neutral" },
  final: { label: "Final, not sent", tone: "warn" },
  sent: { label: "Sent to PCA", tone: "good" },
};

export function locationPicks(turnCount: number | null | undefined): string[] {
  const turns = Array.from({ length: turnCount ?? 0 }, (_, i) => `Turn ${i + 1}`);
  return [...turns, "Front straight", "Pit lane", "Paddock"];
}

export const emptyParty = (over: Partial<IncidentParty> = {}): IncidentParty => ({
  name: "",
  address: "",
  phone: "",
  email: "",
  injuries: "",
  determinedBy: "",
  signedIn: "",
  notSignedInExplain: "",
  ...over,
});

export function emptyIncidentData(over: Partial<IncidentData> = {}): IncidentData {
  return {
    region: "",
    eventChair: "",
    chairPhone: "",
    chairEmail: "",
    locationAddress: "",
    eventType: "Driver Education (HPDE)",
    driver: emptyParty(),
    passenger: { ...emptyParty(), present: "" },
    other: { ...emptyParty(), present: "", role: "" },
    waiversAttached: false,
    vehicles: "",
    description: "",
    transport: { name: "", hospital: "", address: "", phone: "", disposition: "" },
    comments: "",
    preparedBy: { name: "", title: "", phoneWork: "", phoneHome: "", fax: "", email: "" },
    ...over,
  };
}

/** Bodily injury, as answered on the form. It decides how soon the report is due. */
export function incidentHasInjury(criteria: string[], data: Pick<IncidentData, "driver" | "passenger" | "other">): boolean {
  return (
    criteria.includes("injury") ||
    data.driver.injuries === "yes" ||
    (data.passenger.present === "yes" && data.passenger.injuries === "yes") ||
    data.other.present === "yes"
  );
}

/** Next business day with bodily injury, otherwise five business days from the incident. */
export function incidentDueOn(occurredOn: string, injury: boolean): string {
  return addBusinessDays(occurredOn, injury ? 1 : 5);
}

/** Business days from `from` to `to`: positive when `to` is ahead, negative when it has passed. */
export function businessDaysUntil(from: string, to: string): number {
  if (from === to) return 0;
  const forward = to > from;
  let d = forward ? from : to;
  const end = forward ? to : from;
  let n = 0;
  while (d < end) {
    d = addDays(d, 1);
    const w = weekdayIndex(d);
    if (w !== 0 && w !== 6) n += 1;
  }
  return forward ? n : -n;
}

/** Result of saving a report: when "final" was asked for but something is missing, it says what. */
export type SaveIncidentResult = ActionResult<{ missing: string[] }>;

export type DueState = { label: string; tone: "neutral" | "warn" | "bad" };

/** How urgent an unsent report is, in words. */
export function dueState(dueOn: string, today: string): DueState {
  if (today > dueOn) {
    const late = -businessDaysUntil(today, dueOn);
    return { label: late > 0 ? `Overdue by ${late} business day${late === 1 ? "" : "s"}` : "Overdue", tone: "bad" };
  }
  if (today === dueOn) return { label: "Due today", tone: "bad" };
  const left = businessDaysUntil(today, dueOn);
  if (left <= 1) return { label: left === 1 ? "Due in 1 business day" : "Due on the next business day", tone: "bad" };
  return { label: `Due in ${left} business days`, tone: left <= 2 ? "warn" : "neutral" };
}

/** What still has to be filled in before a report can be marked final. Empty means ready. */
export function finalProblems(input: { occurredOn: string; location: string; data: IncidentData; signed: boolean }): string[] {
  const { data } = input;
  const missing: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) missing.push("the date of the incident");
  if (!input.location.trim()) missing.push("where it happened");
  if (!data.region.trim()) missing.push("the PCA region");
  if (!data.eventChair.trim()) missing.push("the event chair's name");
  if (!data.driver.name.trim()) missing.push("the driver's name");
  if (!data.driver.injuries) missing.push("whether the driver was injured");
  if (!data.driver.signedIn) missing.push("whether the driver was a signed-in entrant");
  if (data.driver.signedIn === "no" && !data.driver.notSignedInExplain.trim()) missing.push("why the driver was not signed in");
  if (!data.passenger.present) missing.push("whether there was a passenger");
  if (data.passenger.present === "yes") {
    if (!data.passenger.name.trim()) missing.push("the passenger's name");
    if (!data.passenger.injuries) missing.push("whether the passenger was injured");
    if (!data.passenger.signedIn) missing.push("whether the passenger was a signed-in entrant");
  }
  if (!data.other.present) missing.push("whether any other party was injured");
  if (data.other.present === "yes" && !data.other.name.trim()) missing.push("the injured party's name");
  if (!data.vehicles.trim()) missing.push("a description of the automobile");
  if (!data.description.trim()) missing.push("a description of the incident");
  if (!data.preparedBy.name.trim()) missing.push("who prepared the report");
  if (!data.preparedBy.title.trim()) missing.push("the preparer's title");
  if (!input.signed) missing.push("the preparer's signature");
  return missing;
}
