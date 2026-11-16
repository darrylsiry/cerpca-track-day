/* Shared, serialisable types. Safe to import from both server and client code. */

export type OrgSettings = {
  /** Who an incident report must be sent to. Confirm against the current PCA Region Procedures Manual. */
  incidentRecipients: { role: string; name?: string; email: string }[];
  eventChair?: { name: string; phone?: string; email?: string };
  /** Shop inspection window, in days before the first day of the event. */
  techWindow: { earliestDays: number; latestDays: number };
  /** Minutes before a session at which reminders go out. */
  reminderOffsets: number[];
};

/* ───────────── Track guide ───────────── */

export type TrackShape = {
  viewBox: [number, number, number, number];
  /** Closed centerline path, starting at start/finish and running in the direction of travel. */
  d: string;
  pitLane?: string;
  startFinish: [number, number];
  direction: "clockwise" | "counterclockwise";
  /** Positions are fractions (0–1) of the lap distance from start/finish. */
  turns: { n: number; start: number; apex: number; end: number; apexPoint: [number, number]; label: [number, number] }[];
  zones: Record<string, { n: number; start: number; end: number }[]>;
};

export type TrackTurn = {
  n: number;
  /** "Right" | "Left" */
  direction: string;
  character: string;
  keyPoints: string[];
  text: string;
  image?: string;
  /** Passing zone that starts at this turn's exit, if any. */
  passingNote?: string;
  caution?: string;
};

export type TrackFlag = {
  key: string;
  name: string;
  qualifier?: string;
  design: "solid" | "diagonal" | "stripes" | "circle" | "checkered";
  colors: string[];
  meanings: string[];
};

export type PassingSheet = {
  key: string;
  title: string;
  groupKeys: string[];
  headline: string;
  rule: string;
  zones: { n: number; from: string; to: string; note?: string }[];
  image: string;
  pdf: string;
};

export type TrackGuide = {
  overview: string;
  facts: { label: string; value: string }[];
  shape: TrackShape;
  lineIntro: string;
  lineSource: string;
  trackEntry: string;
  turns: TrackTurn[];
  passing: PassingSheet[];
  flags: TrackFlag[];
  rules: { title: string; items: { text: string; strong?: boolean }[] }[];
  rulesSource: string;
  glossary: { term: string; def: string }[];
  maps: { key: string; title: string; caption: string; image: string; width: number; height: number; pdf: string }[];
  places: { name: string; where: string }[];
  documents: { title: string; description: string; href: string; size: string }[];
};

/* ───────────── Communication ───────────── */

export type AudienceKind = "all" | "groups" | "instructors" | "admins" | "students";
/** The instructed or the solo half of a run group whose drivers are instructed until signed off solo. */
export type GroupPart = "instructed" | "solo";
export type AnnouncementAudience = { kind: AudienceKind; groupIds?: string[]; groupParts?: Record<string, GroupPart> };
export type Channel = "inapp" | "email" | "sms" | "push";

/* ───────────── Tech inspection ───────────── */

export type TechItemResult = "pass" | "fail" | "na";
export type TechFormData = {
  items: Record<string, TechItemResult>;
  itemNotes?: Record<string, string>;
  /** DOT date codes, week + year, e.g. "2423" = week 24 of 2023. */
  tireDates: { lf: string; rf: string; lr: string; rr: string };
  /** YYYY-MM-DD */
  brakeFluidDate: string;
  helmet?: string;
  notes?: string;
};
export type GridTechData = { items: Record<string, boolean>; notes?: string };

/* ───────────── Incident report (mirrors the PCA form) ───────────── */

export type YesNo = "yes" | "no" | "";
export type IncidentParty = {
  name: string;
  address: string;
  phone: string;
  email: string;
  injuries: YesNo;
  determinedBy: string;
  signedIn: YesNo;
  notSignedInExplain: string;
};
export type IncidentData = {
  region: string;
  eventChair: string;
  chairPhone: string;
  chairEmail: string;
  locationAddress: string;
  eventType: string;
  driver: IncidentParty;
  passenger: IncidentParty & { present: YesNo };
  other: IncidentParty & { present: YesNo; role: string };
  waiversAttached: boolean;
  vehicles: string;
  description: string;
  transport: { name: string; hospital: string; address: string; phone: string; disposition: "outpatient" | "admitted" | "" };
  comments: string;
  preparedBy: {
    name: string;
    title: string;
    phoneWork: string;
    phoneHome: string;
    fax: string;
    email: string;
    signature?: string;
    signedAt?: string;
  };
};

/* ───────────── View models passed to client components ───────────── */

export type GroupLite = {
  id: string;
  key: string;
  name: string;
  color: string;
  textColor: string;
  sortOrder: number;
  /** The group has an instructed and a solo half (CERPCA's Blue), and a session can be for one of them. */
  split: boolean;
};

export type ScheduleEntry = {
  id: string;
  day: string;
  startMin: number;
  endMin: number;
  kind: string;
  title: string;
  location: string | null;
  audience: string;
  groupIds: string[];
  groupParts: Record<string, GroupPart>;
  note: string | null;
  cancelled: boolean;
};

export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };
