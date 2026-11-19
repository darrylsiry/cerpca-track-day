import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  AnnouncementAudience,
  GridTechData,
  GroupPart,
  IncidentData,
  OrgSettings,
  TechFormData,
  TrackGuide,
} from "@/lib/types";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ───────────── Tenancy: a PCA region and the tracks it runs events at ───────────── */

export const organizations = pgTable("organizations", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  website: text("website"),
  timezone: text("timezone").notNull().default("America/New_York"),
  settings: jsonb("settings").$type<OrgSettings>().notNull(),
  createdAt: createdAt(),
});

export const tracks = pgTable("tracks", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  lengthMiles: real("length_miles"),
  turnCount: integer("turn_count"),
  timezone: text("timezone").notNull().default("America/New_York"),
  /** All track-specific content (map shape, turns, flags, rules, passing zones, documents). */
  guide: jsonb("guide").$type<TrackGuide>().notNull(),
  createdAt: createdAt(),
});

/* ───────────── People ───────────── */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  address1: text("address1"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  emergencyName: text("emergency_name"),
  emergencyPhone: text("emergency_phone"),
  pcaMemberNumber: text("pca_member_number"),
  tshirtSize: text("tshirt_size"),
  notifyEmail: boolean("notify_email").notNull().default(true),
  notifySms: boolean("notify_sms").notNull().default(false),
  notifyPush: boolean("notify_push").notNull().default(true),
  createdAt: createdAt(),
});

/** A person's standing within one region: roles and current driver classification. */
export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    userId: text("user_id").notNull().references(() => users.id),
    isAdmin: boolean("is_admin").notNull().default(false),
    isInstructor: boolean("is_instructor").notNull().default(false),
    adminTitle: text("admin_title"),
    instructorCredential: text("instructor_credential"),
    /** Current classification; registrations copy this at sign-up and promotions update it. */
    runGroupId: text("run_group_id"),
    soloApproved: boolean("solo_approved").notNull().default(false),
    experience: text("experience"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user").on(t.orgId, t.userId)],
);

export const vehicles = pgTable(
  "vehicles",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id),
    year: integer("year"),
    make: text("make").notNull(),
    model: text("model").notNull(),
    color: text("color"),
    carNumber: text("car_number"),
    isPrimary: boolean("is_primary").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("vehicles_user").on(t.userId)],
);

/* ───────────── Run groups (the region's classification ladder) ───────────── */

export const runGroups = pgTable(
  "run_groups",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    textColor: text("text_color").notNull(),
    sortOrder: integer("sort_order").notNull(),
    summary: text("summary").notNull(),
    description: text("description").notNull(),
    /**
     * "required": always instructed.
     * "optional": instructed until signed off solo, so the group has an instructed and a solo half.
     * "none": solo by default; an instructor rides along when the driver asks or administrators ask.
     */
    instructorPolicy: text("instructor_policy").notNull().default("none"),
    /** Which passing-zone sheet in the track guide applies to this group. */
    passingKey: text("passing_key"),
    isInstructorGroup: boolean("is_instructor_group").notNull().default(false),
  },
  (t) => [uniqueIndex("run_groups_org_key").on(t.orgId, t.key)],
);

/* ───────────── Events ───────────── */

export const events = pgTable(
  "events",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    trackId: text("track_id").notNull().references(() => tracks.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Local calendar dates at the track, YYYY-MM-DD. */
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    /** "draft" | "published" | "completed" */
    status: text("status").notNull().default("draft"),
    description: text("description"),
    registrationUrl: text("registration_url"),
    /** Bumped on every schedule edit so open apps know to refresh. */
    scheduleVersion: integer("schedule_version").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("events_org_slug").on(t.orgId, t.slug)],
);

export const registrations = pgTable(
  "registrations",
  {
    id: id(),
    eventId: text("event_id").notNull().references(() => events.id),
    userId: text("user_id").notNull().references(() => users.id),
    runGroupId: text("run_group_id").notNull().references(() => runGroups.id),
    vehicleId: text("vehicle_id"),
    carNumber: text("car_number"),
    attendsDay1: boolean("attends_day1").notNull().default(true),
    attendsDay2: boolean("attends_day2").notNull().default(true),
    /** Instructing at this event (as opposed to holding the credential in general). */
    isInstructor: boolean("is_instructor").notNull().default(false),
    solo: boolean("solo").notNull().default(false),
    /**
     * A solo driver who should ride with an instructor at this event anyway:
     * "ride_along" (the driver asked) | "check_in" (administrators asked).
     */
    instructorRequest: text("instructor_request"),
    /** The driver's own words for a ride-along; the administrators' reason for a check-in (never shown to the driver). */
    instructorRequestNote: text("instructor_request_note"),
    /** "confirmed" | "pending" | "waitlist" | "cancelled" */
    status: text("status").notNull().default("confirmed"),
    tshirtSize: text("tshirt_size"),
    checkedInAt: ts("checked_in_at"),
    source: text("source").notNull().default("manual"),
    externalId: text("external_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("registrations_event_user").on(t.eventId, t.userId), index("registrations_event").on(t.eventId)],
);

export const instructorAssignments = pgTable(
  "instructor_assignments",
  {
    id: id(),
    eventId: text("event_id").notNull().references(() => events.id),
    instructorId: text("instructor_id").notNull().references(() => users.id),
    studentId: text("student_id").notNull().references(() => users.id),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("assignments_event_student").on(t.eventId, t.studentId)],
);

export const scheduleItems = pgTable(
  "schedule_items",
  {
    id: id(),
    eventId: text("event_id").notNull().references(() => events.id),
    day: text("day").notNull(),
    /** Minutes after local midnight. */
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    /** "track" | "classroom" | "meeting" | "break" | "other" */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    /** "groups" | "all" | "instructors" | "none" — who it concerns and who gets reminders. */
    audience: text("audience").notNull().default("groups"),
    groupIds: jsonb("group_ids").$type<string[]>().notNull().default([]),
    /** Limits a group in `groupIds` to its instructed or solo half: { [blueId]: "solo" } for "Blue Solo and White". */
    groupParts: jsonb("group_parts").$type<Record<string, GroupPart>>().notNull().default({}),
    note: text("note"),
    cancelled: boolean("cancelled").notNull().default(false),
    /** Where a published item was before it was moved, so screens can say "moved from 10:10". Null when it is where it started. */
    movedFromDay: text("moved_from_day"),
    movedFromMin: integer("moved_from_min"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("schedule_event_day").on(t.eventId, t.day)],
);

/* ───────────── Communication ───────────── */

export const announcements = pgTable(
  "announcements",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    eventId: text("event_id").references(() => events.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    audience: jsonb("audience").$type<AnnouncementAudience>().notNull(),
    channels: jsonb("channels").$type<string[]>().notNull().default([]),
    urgent: boolean("urgent").notNull().default(false),
    authorId: text("author_id").references(() => users.id),
    recipientCount: integer("recipient_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("announcements_event").on(t.eventId)],
);

/** In-app inbox. */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id),
    eventId: text("event_id"),
    announcementId: text("announcement_id"),
    /** "announcement" | "reminder" | "schedule" | "tech" | "promotion" | "assignment" | "session" | "waiver" */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href"),
    urgent: boolean("urgent").notNull().default(false),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user").on(t.userId, t.createdAt)],
);

/** Every email, text and push we attempted — the delivery log admins can audit. */
export const messageLog = pgTable(
  "message_log",
  {
    id: id(),
    userId: text("user_id"),
    eventId: text("event_id"),
    channel: text("channel").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    /** "sent" | "simulated" | "failed" */
    status: text("status").notNull(),
    provider: text("provider"),
    error: text("error"),
    kind: text("kind"),
    createdAt: createdAt(),
  },
  (t) => [index("message_log_created").on(t.createdAt)],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

export const reminderSends = pgTable(
  "reminder_sends",
  {
    id: id(),
    scheduleItemId: text("schedule_item_id").notNull(),
    offsetMin: integer("offset_min").notNull(),
    /** Day and start time the reminder was sent for; a session moved to another day or time reminds again. */
    day: text("day").notNull().default(""),
    startMin: integer("start_min").notNull(),
    recipients: integer("recipients").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reminder_once").on(t.scheduleItemId, t.offsetMin, t.day, t.startMin)],
);

/* ───────────── Waivers ───────────── */

export const waiverTemplates = pgTable("waiver_templates", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  title: text("title").notNull(),
  summary: text("summary"),
  body: text("body").notNull(),
  version: integer("version").notNull().default(1),
  required: boolean("required").notNull().default(true),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const waiverSignatures = pgTable(
  "waiver_signatures",
  {
    id: id(),
    templateId: text("template_id").notNull().references(() => waiverTemplates.id),
    templateVersion: integer("template_version").notNull(),
    eventId: text("event_id").notNull().references(() => events.id),
    userId: text("user_id").notNull().references(() => users.id),
    signedName: text("signed_name").notNull(),
    signatureData: text("signature_data"),
    /** SHA-256 of the exact text that was on screen when signed. */
    bodyHash: text("body_hash"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("waiver_once").on(t.templateId, t.eventId, t.userId)],
);

/* ───────────── Tech inspection ───────────── */

/** Shops the region knows. Verified shops' online sign-offs are trusted without extra checks. */
export const shops = pgTable("shops", {
  id: id(),
  orgId: text("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  city: text("city"),
  verified: boolean("verified").notNull().default(false),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const techInspections = pgTable(
  "tech_inspections",
  {
    id: id(),
    eventId: text("event_id").notNull().references(() => events.id),
    userId: text("user_id").notNull().references(() => users.id),
    /**
     * "draft"            driver is filling in car details
     * "with_shop"        link sent to the shop, waiting for the technician
     * "shop_signed"      technician signed; driver still has to sign and submit
     * "submitted"        waiting for the Chief Tech Inspector
     * "changes_requested" reviewer sent it back
     * "approved"         pre-event paperwork accepted
     */
    status: text("status").notNull().default("draft"),
    /** "online" (shop signs in the app) | "paper" (photo of the stamped paper form) */
    method: text("method").notNull().default("online"),
    vehicleYear: integer("vehicle_year"),
    vehicleMake: text("vehicle_make"),
    vehicleModel: text("vehicle_model"),
    vehicleColor: text("vehicle_color"),
    carNumber: text("car_number"),
    driver2Name: text("driver2_name"),
    emergency1: text("emergency1"),
    emergency2: text("emergency2"),
    form: jsonb("form").$type<TechFormData>().notNull(),
    inspectionDate: text("inspection_date"),
    paperFile: text("paper_file"),
    shopId: text("shop_id"),
    shopName: text("shop_name"),
    shopEmail: text("shop_email"),
    shopPhone: text("shop_phone"),
    mechanicName: text("mechanic_name"),
    /** SHA-256 of the single-use link token emailed to the shop. */
    mechanicTokenHash: text("mechanic_token_hash"),
    mechanicTokenExpires: ts("mechanic_token_expires"),
    mechanicInvitedAt: ts("mechanic_invited_at"),
    mechanicSignedAt: ts("mechanic_signed_at"),
    mechanicSignature: text("mechanic_signature"),
    mechanicIp: text("mechanic_ip"),
    mechanicUserAgent: text("mechanic_user_agent"),
    /** Tamper-evident fingerprint of the checklist + signature at the moment the shop signed. */
    sealHash: text("seal_hash"),
    driverSignedName: text("driver_signed_name"),
    driverSignature: text("driver_signature"),
    driverSignedAt: ts("driver_signed_at"),
    submittedAt: ts("submitted_at"),
    reviewedById: text("reviewed_by_id"),
    reviewedAt: ts("reviewed_at"),
    reviewNote: text("review_note"),
    /** At-track grid tech by region tech personnel. */
    gridTech: jsonb("grid_tech").$type<GridTechData>(),
    gridTechById: text("grid_tech_by_id"),
    gridTechAt: ts("grid_tech_at"),
    stickerIssuedAt: ts("sticker_issued_at"),
    stickerNumber: text("sticker_number"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tech_event_user").on(t.eventId, t.userId)],
);

/* ───────────── Driver development ───────────── */

export const promotions = pgTable(
  "promotions",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    eventId: text("event_id").references(() => events.id),
    userId: text("user_id").notNull().references(() => users.id),
    /** "group" (move up a run group) | "solo" (signed off to drive without an instructor) */
    kind: text("kind").notNull().default("group"),
    fromGroupId: text("from_group_id"),
    toGroupId: text("to_group_id"),
    recommendedById: text("recommended_by_id").references(() => users.id),
    rationale: text("rationale").notNull(),
    /** "proposed" | "approved" | "declined" */
    status: text("status").notNull().default("proposed"),
    decidedById: text("decided_by_id"),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [index("promotions_user").on(t.userId)],
);

export const sessionLogs = pgTable(
  "session_logs",
  {
    id: id(),
    eventId: text("event_id").notNull().references(() => events.id),
    instructorId: text("instructor_id").notNull().references(() => users.id),
    studentId: text("student_id").notNull().references(() => users.id),
    scheduleItemId: text("schedule_item_id"),
    day: text("day").notNull(),
    label: text("label").notNull(),
    /** Visible to the student and to administrators. */
    sharedNotes: text("shared_notes").notNull().default(""),
    /** Visible to administrators (and the instructor who wrote it) only. */
    privateNotes: text("private_notes"),
    focusAreas: jsonb("focus_areas").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("session_logs_student").on(t.studentId)],
);

/** Administrator-only notes about a driver, unrelated to promotions. */
export const driverNotes = pgTable(
  "driver_notes",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    userId: text("user_id").notNull().references(() => users.id),
    authorId: text("author_id").notNull().references(() => users.id),
    eventId: text("event_id"),
    /** "general" | "safety" | "conduct" | "medical" | "instructor" */
    category: text("category").notNull().default("general"),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("driver_notes_user").on(t.userId)],
);

/* ───────────── Incidents (PCA Incident Report – Driving Event) ───────────── */

export const incidents = pgTable(
  "incidents",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id),
    eventId: text("event_id").notNull().references(() => events.id),
    /** "draft" | "final" | "sent" */
    status: text("status").notNull().default("draft"),
    occurredOn: text("occurred_on").notNull(),
    occurredTime: text("occurred_time"),
    location: text("location"),
    criteria: jsonb("criteria").$type<string[]>().notNull().default([]),
    hasInjury: boolean("has_injury").notNull().default(false),
    driverUserId: text("driver_user_id"),
    driverName: text("driver_name"),
    summary: text("summary"),
    data: jsonb("data").$type<IncidentData>().notNull(),
    sketch: text("sketch"),
    /** Date the report is due at PCA national. */
    dueOn: text("due_on").notNull(),
    sentAt: ts("sent_at"),
    createdById: text("created_by_id").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("incidents_event").on(t.eventId)],
);

/* ───────────── Sign-in ───────────── */

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: id(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("otp_email").on(t.email)],
);

/**
 * Counters that throttle sign-in: one row per limited thing and time window,
 * added to in a single statement. Keys hold a hash, never an address.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const sessions = pgTable("sessions", {
  /** SHA-256 of the cookie token; the raw token never touches the database. */
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

export type Organization = typeof organizations.$inferSelect;
export type Track = typeof tracks.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Vehicle = typeof vehicles.$inferSelect;
export type RunGroup = typeof runGroups.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type Registration = typeof registrations.$inferSelect;
export type ScheduleItem = typeof scheduleItems.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type WaiverTemplate = typeof waiverTemplates.$inferSelect;
export type WaiverSignature = typeof waiverSignatures.$inferSelect;
export type Shop = typeof shops.$inferSelect;
export type TechInspection = typeof techInspections.$inferSelect;
export type Promotion = typeof promotions.$inferSelect;
export type SessionLog = typeof sessionLogs.$inferSelect;
export type DriverNote = typeof driverNotes.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type MessageLogRow = typeof messageLog.$inferSelect;
