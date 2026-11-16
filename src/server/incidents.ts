import { and, desc, eq } from "drizzle-orm";
import { getDb, schema as s } from "@/db";
import type { EventRow, Incident, Track } from "@/db/schema";
import { fullName, vehicleLabel } from "@/lib/cn";
import { emptyIncidentData, emptyParty } from "@/lib/incident";
import type { IncidentData } from "@/lib/types";
import type { Viewer } from "./auth";
import { getRoster } from "./queries";

/** A person the report can be about, with everything the form prefills. */
export type IncidentRosterOption = {
  id: string;
  label: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  vehicle: string;
  checkedIn: boolean;
};

export async function listIncidents(orgId: string) {
  const db = await getDb();
  return db
    .select({ incident: s.incidents, eventName: s.events.name, eventStart: s.events.startDate })
    .from(s.incidents)
    .innerJoin(s.events, eq(s.events.id, s.incidents.eventId))
    .where(eq(s.incidents.orgId, orgId))
    .orderBy(desc(s.incidents.occurredOn), desc(s.incidents.occurredTime), desc(s.incidents.createdAt));
}

export async function getIncident(orgId: string, id: string): Promise<{ incident: Incident; event: EventRow; track: Track | null } | null> {
  const db = await getDb();
  const [row] = await db
    .select({ incident: s.incidents, event: s.events, track: s.tracks })
    .from(s.incidents)
    .innerJoin(s.events, eq(s.events.id, s.incidents.eventId))
    .leftJoin(s.tracks, eq(s.tracks.id, s.events.trackId))
    .where(and(eq(s.incidents.id, id), eq(s.incidents.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function incidentRoster(eventId: string): Promise<IncidentRosterOption[]> {
  const rows = await getRoster(eventId);
  return rows.map(({ user, reg, vehicle }) => {
    const car = [vehicleLabel(vehicle), vehicle?.color, reg.carNumber ? `car #${reg.carNumber}` : null].filter(Boolean).join(", ");
    return {
      id: user.id,
      label: `${user.lastName}, ${user.firstName}${reg.carNumber ? ` · #${reg.carNumber}` : ""}`,
      name: fullName(user),
      address: [user.address1, [user.city, user.state].filter(Boolean).join(", "), user.zip].filter(Boolean).join(", ").replace(/, (\d{5})$/, " $1"),
      phone: user.phone ?? "",
      email: user.email,
      vehicle: car ? `${car}.` : "",
      checkedIn: Boolean(reg.checkedInAt),
    };
  });
}

export function trackAddress(track: Track | null): string {
  if (!track) return "";
  const cityLine = [track.city, [track.state, track.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [track.name, track.address, cityLine].filter(Boolean).join(", ");
}

/** A blank report with section 1 and "prepared by" filled from what the app already knows. */
export function prefilledIncident(v: Viewer, track: Track | null): IncidentData {
  const chair = v.org.settings.eventChair;
  return emptyIncidentData({
    region: v.org.name.replace(/,\s*Porsche Club of America$/i, ""),
    eventChair: chair?.name ?? "",
    chairPhone: chair?.phone ?? "",
    chairEmail: chair?.email ?? "",
    locationAddress: trackAddress(track),
    driver: emptyParty(),
    preparedBy: {
      name: fullName(v.user),
      title: v.membership.adminTitle ?? "",
      phoneWork: v.user.phone ?? "",
      phoneHome: "",
      fax: "",
      email: v.user.email,
    },
  });
}

/** Stored reports from before a field existed still load cleanly. */
export function normalizeIncidentData(data: Partial<IncidentData> | null | undefined): IncidentData {
  const base = emptyIncidentData();
  const d = data ?? {};
  return {
    ...base,
    ...d,
    driver: { ...base.driver, ...d.driver },
    passenger: { ...base.passenger, ...d.passenger },
    other: { ...base.other, ...d.other },
    transport: { ...base.transport, ...d.transport },
    preparedBy: { ...base.preparedBy, ...d.preparedBy },
  };
}
