import { NextResponse } from "next/server";
import { getRosterView } from "@/server/admin";
import { getViewer } from "@/server/auth";
import { getRoster } from "@/server/queries";

const cell = (v: unknown) => {
  const t = v === null || v === undefined ? "" : String(v);
  // Quote anything with separators, and neutralise formula-leading characters for spreadsheet apps.
  const safe = /^[=+\-@]/.test(t) ? `'${t}` : t;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The event roster as CSV: name, address, email, phone, car, number, run group, t-shirt size and status. */
export async function GET() {
  const v = await getViewer();
  if (!v.isAdmin || !v.event)
    return NextResponse.json({ error: "Administrators only" }, { status: 403 });
  const [roster, view] = await Promise.all([
    getRoster(v.event.id),
    getRosterView(v.event.id, v.org.id),
  ]);
  const extra = new Map(view.rows.map((r) => [r.userId, r]));
  const header = [
    "Car number",
    "Last name",
    "First name",
    "Run group",
    "Solo",
    "Instructor",
    "Email",
    "Phone",
    "Address",
    "City",
    "State",
    "ZIP",
    "Emergency contact",
    "Emergency phone",
    "PCA member number",
    "T-shirt",
    "Year",
    "Make",
    "Model",
    "Color",
    "Day 1",
    "Day 2",
    "Waivers signed",
    "Tech status",
    "Tech sticker",
    "Checked in",
    "Assigned instructor",
  ];
  const lines = roster.map(({ user, reg, vehicle, group }) => {
    const x = extra.get(user.id);
    return [
      reg.carNumber,
      user.lastName,
      user.firstName,
      group.name,
      reg.solo ? "Yes" : "No",
      reg.isInstructor ? "Yes" : "No",
      user.email,
      user.phone,
      user.address1,
      user.city,
      user.state,
      user.zip,
      user.emergencyName,
      user.emergencyPhone,
      user.pcaMemberNumber,
      reg.tshirtSize ?? user.tshirtSize,
      vehicle?.year,
      vehicle?.make,
      vehicle?.model,
      vehicle?.color,
      reg.attendsDay1 ? "Yes" : "No",
      reg.attendsDay2 ? "Yes" : "No",
      x ? `${x.waiversSigned}/${view.waiversTotal}` : "",
      x?.techStatus ?? "",
      x?.sticker ?? "",
      reg.checkedInAt ? "Yes" : "No",
      x?.instructorName ?? "",
    ]
      .map(cell)
      .join(",");
  });
  const csv = [header.join(","), ...lines].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${v.event.slug}-roster.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
