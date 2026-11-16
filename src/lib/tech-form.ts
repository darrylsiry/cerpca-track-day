import type { TechFormData } from "./types";

/**
 * The CERPCA Driver's Education Technical Inspection Form, item for item.
 * `optional` items may be marked "N/A" (they only apply to some cars).
 */
export const TECH_SECTIONS: {
  key: string;
  title: string;
  items: { key: string; label: string; detail: string; optional?: boolean }[];
}[] = [
  {
    key: "interior",
    title: "Vehicle interior",
    items: [
      {
        key: "roll_bar",
        label: "Roll bar and cages",
        detail:
          "Mandatory for all open and semi-open cars without manufacturer's structural or deploying roll-over protection. Roll bars must pass the broomstick rule and be covered with closed-cell foam padding anywhere a helmet could contact the bar.",
        optional: true,
      },
      {
        key: "seat_belts",
        label: "Seat belts",
        detail: "Factory or better installation in both seats; securely mounted; belts not frayed; equal restraints for passenger and driver.",
      },
      {
        key: "harness",
        label: "Harness belts",
        detail:
          "All harness belts must display the manufacturing or expiration date (sewn into the webbing) and cannot exceed the expiration date. No exceptions. 4-point harnesses are prohibited except Schroth Quick Fit. 5-, 6- and 7-point harnesses must use seats with factory routing holes. An approved head and neck restraint (HANS) is required with all harness systems.",
        optional: true,
      },
      { key: "doors", label: "Doors", detail: "Must be operational from inside and outside." },
      { key: "pedals", label: "Pedals", detail: "All pedals must have free return and be in good operating condition. The brake pedal must be firm." },
    ],
  },
  {
    key: "exterior",
    title: "Vehicle exterior",
    items: [
      { key: "structure", label: "Structural integrity", detail: "No loose body or interior parts; no structural rust at or near suspension points." },
      { key: "windshield", label: "Windshield", detail: "No cracks; condition does not impair vision." },
      { key: "mirrors", label: "Mirrors", detail: "Minimum of a single mirror in good condition and securely mounted." },
      { key: "gas_cap", label: "Gas cap", detail: "Tightly closed and no leakage." },
      { key: "brake_lights", label: "Brake lights", detail: "Functional and visible brake lights." },
      { key: "wheels", label: "Wheels: overall condition", detail: "No cracks, bends or flaws; valve stems must have airtight caps." },
      {
        key: "lugs",
        label: "Wheel bolts and lugs",
        detail: "All lug nuts engaged; pay special attention to after-market wheels and Turbo Twist wheels. If using track tires, steel lug nuts should be used.",
      },
      { key: "center_locks", label: "Wheel center locks", detail: "Make sure locking devices are fully engaged.", optional: true },
      {
        key: "tires_condition",
        label: "Tires: condition",
        detail: "Generally good condition; no cracks, cuts, cords or blisters. The tires to be used at the track should be inspected.",
      },
      { key: "tires_tread", label: "Tires: tread and age", detail: "Must have a minimum of 4/32″ of tread and be less than 5 years of age." },
      {
        key: "tow_hook",
        label: "Tow hook",
        detail: "Each participant should have a tow hook installed, or have one readily accessible and know how to install it if needed.",
      },
    ],
  },
  {
    key: "undercarriage",
    title: "Suspension and undercarriage",
    items: [
      {
        key: "brakes",
        label: "Brakes",
        detail:
          "Sufficient brake pads (50% minimum); rotors and pads in good condition; no cuts or abrasions in brake lines. No visible cracks extending to the edge of the rotor. With a co-driver, pads should exceed the minimum standard.",
      },
      { key: "brake_fluid", label: "Brake fluid", detail: "Sufficient brake fluid; premium fluid recommended. Brake fluid must be changed at least annually." },
      { key: "wheel_bearings", label: "Wheel bearings", detail: "Proper free rotation; no looseness in the hub." },
      { key: "front_suspension", label: "Front suspension", detail: "No excessive play; ball joints and tie rods secure; boots and all seals in good condition." },
      { key: "rear_suspension", label: "Rear suspension", detail: "Half-shaft boots in good condition; mounting hardware in good condition; no leakage." },
    ],
  },
  {
    key: "engine",
    title: "Engine compartment",
    items: [
      { key: "fluids", label: "Fluids", detail: "No dripping leaks of any fluid of any type." },
      { key: "fluid_lines", label: "Fluid lines", detail: "Proper fittings and line condition; no external clamps used on pressurized oil lines." },
      { key: "battery", label: "Battery", detail: "Properly secured; no apparent corrosion." },
      { key: "throttle_return", label: "Throttle return", detail: "Freely operating and proper spring(s)." },
      { key: "engine", label: "Engine", detail: "Proper exhaust in good condition; general condition of engine and accessories." },
      { key: "belts", label: "Belts", detail: "Fan and other auxiliary belts in good condition with proper tension." },
      { key: "exhaust", label: "Exhaust system", detail: "Securely fastened and in good condition." },
    ],
  },
];

export const TECH_ITEMS = TECH_SECTIONS.flatMap((s) => s.items);

export const HELMET_NOTE =
  "Motorcycle helmets are not allowed. The helmet must be Snell rated, current or last date certificate, with no cracks and the chin strap in good condition.";

/** Grid tech, performed by region tech personnel at the track. */
export const GRID_TECH_ITEMS: { key: string; label: string }[] = [
  { key: "brake_lights", label: "Functioning brake lights" },
  { key: "helmet", label: "Helmet with proper Snell rating" },
  { key: "loose_objects", label: "No loose objects or distracting items" },
  { key: "lugs_torqued", label: "Wheel lug nuts torqued" },
  { key: "tires", label: "Tires in good condition" },
  { key: "pads", label: "Proper brake pad thickness" },
  { key: "cap_battery", label: "Gas cap and battery secure (if accessible)" },
  { key: "numbers", label: "Car numbers in place" },
  { key: "clothing", label: "Proper clothing per region rules" },
  { key: "smoke", label: "No excessive smoking" },
];

export const DRIVER_CERTIFICATION = [
  "This official technical inspection form submitted to the Coastal Empire Region of the Porsche Club of America, in connection with this High Performance Driver Education event, was performed on the date shown by a Porsche mechanic or other person authorized by the Region and/or knowledgeable to conduct such an inspection on the make and model listed.",
  "The completed form correctly and accurately shows the condition of the car identified on the date of the inspection.",
  "There have been no changes in the condition of the car since the date of the inspection that would affect the track worthiness of the car. I agree to defend, indemnify, and hold harmless PCA, its Zones and Regions, as well as the inspector, from any and all claims or demands arising directly or indirectly from any incorrect and/or inaccurate statements set forth in this form. I understand that the technical inspection performed on my car and my helmet is solely for the purpose of meeting minimum standards of car preparation for the Zone's or Region's High Performance Driving Event. No warranties or guarantees are implied or expressed by the passing of the inspection performed. I acknowledge that the safe condition and operation of my car is entirely my responsibility. I take full and sole responsibility for any vehicle problems, malfunctions, or damage that may occur in connection with the operation or performance of my car prior to, during, or subsequent to the event, and understand that if I have a mechanical issue on the track surface that requires clean up with an oil dry absorbent (i.e. fluids dropped such as oil, antifreeze, etc.) I, as the driver, will be responsible for the cost.",
];

export const MECHANIC_CERTIFICATION =
  "I inspected this car on the date shown and the results recorded here are accurate. I am a technician at the shop named below and am knowledgeable to inspect this make and model.";

export function emptyTechForm(): TechFormData {
  return { items: {}, itemNotes: {}, tireDates: { lf: "", rf: "", lr: "", rr: "" }, brakeFluidDate: "", helmet: "", notes: "" };
}

export const TECH_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "warn" | "good" | "bad" }> = {
  none: { label: "Not started", tone: "neutral" },
  draft: { label: "Not sent to a shop", tone: "neutral" },
  with_shop: { label: "Waiting on shop", tone: "info" },
  shop_signed: { label: "Shop signed, driver to submit", tone: "warn" },
  submitted: { label: "Ready for review", tone: "warn" },
  changes_requested: { label: "Changes requested", tone: "bad" },
  approved: { label: "Approved", tone: "good" },
};

/** Parse a DOT date code ("2423" → week 24 of 2023) into an approximate date. */
export function tireCodeDate(code: string): Date | null {
  const m = /^(\d{2})(\d{2})$/.exec(code.trim());
  if (!m) return null;
  const week = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (week < 1 || week > 53) return null;
  return new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
}

export type TechFlag = { level: "block" | "warn"; text: string };

/**
 * Automatic checks against the rules printed on the form, so problems surface
 * weeks before the event instead of at the tech shed.
 */
export function techFlags(input: {
  form: TechFormData;
  inspectionDate: string | null;
  eventStart: string;
  window: { earliestDays: number; latestDays: number };
  method: string;
  shopVerified: boolean | null;
}): TechFlag[] {
  const flags: TechFlag[] = [];
  const start = new Date(`${input.eventStart}T12:00:00Z`);
  const failed = TECH_ITEMS.filter((i) => input.form.items[i.key] === "fail");
  for (const f of failed) flags.push({ level: "block", text: `Failed item: ${f.label}` });
  if (input.method === "online") {
    const missing = TECH_ITEMS.filter((i) => !input.form.items[i.key]);
    if (missing.length) flags.push({ level: "block", text: `${missing.length} checklist item${missing.length === 1 ? "" : "s"} not marked` });
  }
  const oldest = Object.entries(input.form.tireDates)
    .map(([pos, code]) => ({ pos, date: tireCodeDate(code) }))
    .filter((t) => t.date);
  for (const t of oldest) {
    const ageYears = (start.getTime() - t.date!.getTime()) / (365.25 * 86400000);
    if (ageYears >= 5) flags.push({ level: "block", text: `${t.pos.toUpperCase()} tire is ${ageYears.toFixed(1)} years old (limit: under 5)` });
  }
  if (input.method === "online" && oldest.length < 4) flags.push({ level: "warn", text: "Tire date codes are incomplete" });
  if (input.form.brakeFluidDate) {
    const changed = new Date(`${input.form.brakeFluidDate}T12:00:00Z`);
    const months = (start.getTime() - changed.getTime()) / (30.44 * 86400000);
    if (months > 12) flags.push({ level: "block", text: `Brake fluid last changed ${Math.round(months)} months before the event (limit: 12)` });
  } else if (input.method === "online") {
    flags.push({ level: "warn", text: "Brake fluid change date is missing" });
  }
  if (input.inspectionDate) {
    const insp = new Date(`${input.inspectionDate}T12:00:00Z`);
    const daysBefore = Math.round((start.getTime() - insp.getTime()) / 86400000);
    if (daysBefore > input.window.earliestDays)
      flags.push({ level: "warn", text: `Inspected ${daysBefore} days before the event (earliest allowed: ${input.window.earliestDays})` });
    if (daysBefore < input.window.latestDays)
      flags.push({ level: "warn", text: `Inspected ${Math.max(daysBefore, 0)} days before the event (should be at least ${input.window.latestDays})` });
  }
  if (input.method === "paper") flags.push({ level: "warn", text: "Paper form: check the shop stamp and signature on the upload" });
  if (input.method === "online" && input.shopVerified === false)
    flags.push({ level: "warn", text: "Shop is not on the region's verified list" });
  return flags;
}
