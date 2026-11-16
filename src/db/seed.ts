import { createHash } from "node:crypto";
import { roeblingRoadGuide } from "../content/roebling-road";
import { GRID_TECH_ITEMS, TECH_ITEMS } from "../lib/tech-form";
import { addBusinessDays, addDays, offsetToReach, weekdayIndex, zoned } from "../lib/time";
import type { GroupPart, IncidentData, IncidentParty, TechFormData } from "../lib/types";
import type { DB } from "./index";
import * as s from "./schema";

/*
 * Demo data for the Coastal Empire Region. Every person, shop and phone number
 * here is fictional. The schedule is the region's pocket schedule; the track
 * guide is transcribed from the documents the region supplied.
 */

const TZ = "America/New_York";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

function rng(seedValue: number) {
  let a = seedValue;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deterministic scribble so seeded signatures look signed. */
function fakeSignature(name: string): string {
  const r = rng(name.split("").reduce((n, c) => n + c.charCodeAt(0), 7));
  let d = "M12 44";
  let x = 12;
  while (x < 250) {
    const dx = 14 + r() * 26;
    d += ` C${(x + dx * 0.3).toFixed(0)} ${(8 + r() * 30).toFixed(0)}, ${(x + dx * 0.6).toFixed(0)} ${(40 + r() * 34).toFixed(0)}, ${(x + dx).toFixed(0)} ${(30 + r() * 24).toFixed(0)}`;
    x += dx;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 270 84"><path d="${d}" fill="none" stroke="#14171a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

type GroupKey = "green" | "blue" | "white" | "black" | "red";
type Person = {
  key: string;
  first: string;
  last: string;
  group: GroupKey;
  car: [number, string, string, string];
  num: string;
  admin?: string;
  instructor?: boolean;
  solo?: boolean;
  exp: string;
  only?: "sat" | "sun";
};

const PEOPLE: Person[] = [
  { key: "marian", first: "Marian", last: "Castellanos", group: "red", car: [2019, "Porsche", "911 GT3", "Guards Red"], num: "17", admin: "Event Chair", instructor: true, exp: "PCA instructor since 2014" },
  { key: "dale", first: "Dale", last: "Whitfield", group: "red", car: [2016, "Porsche", "Cayman GT4", "Sapphire Blue"], num: "44", admin: "Chief Driving Instructor", instructor: true, exp: "PCA instructor since 2009" },
  { key: "priya", first: "Priya", last: "Raman", group: "blue", car: [2021, "Porsche", "718 Cayman GTS 4.0", "Chalk"], num: "212", admin: "Registrar", solo: true, exp: "9 track days" },
  { key: "hank", first: "Hank", last: "Odom", group: "black", car: [1987, "Porsche", "911 Carrera 3.2", "Grand Prix White"], num: "87", admin: "Chief Tech Inspector", solo: true, exp: "60+ track days" },
  { key: "lucille", first: "Lucille", last: "Brandt", group: "white", car: [2018, "Porsche", "911 Carrera T", "Racing Yellow"], num: "63", admin: "Safety Chair", solo: true, exp: "22 track days" },
  { key: "tomas", first: "Tomás", last: "Echeverría", group: "black", car: [2015, "Porsche", "Boxster GTS", "Carmine Red"], num: "151", admin: "Track Operations", solo: true, exp: "45 track days" },

  { key: "rosalind", first: "Rosalind", last: "Achterberg", group: "red", car: [2014, "Porsche", "911 Carrera S", "Agate Grey"], num: "91", instructor: true, exp: "PCA instructor since 2017" },
  { key: "gus", first: "Gus", last: "Lindqvist", group: "red", car: [2007, "Porsche", "Cayman S", "Speed Yellow"], num: "7", instructor: true, exp: "PCA instructor since 2011" },
  { key: "noelle", first: "Noelle", last: "Fairbanks", group: "red", car: [2022, "Porsche", "718 Cayman GT4", "Shark Blue"], num: "118", instructor: true, exp: "PCA instructor since 2020" },
  { key: "dmitri", first: "Dmitri", last: "Kovalenko", group: "red", car: [1999, "Porsche", "911 Carrera (996)", "Arctic Silver"], num: "96", instructor: true, exp: "PCA instructor since 2006" },
  { key: "yvonne", first: "Yvonne", last: "Traylor", group: "red", car: [2017, "Porsche", "911 GT3", "White"], num: "33", instructor: true, exp: "PCA instructor since 2015" },
  { key: "calvin", first: "Calvin", last: "Oduya", group: "red", car: [2011, "Porsche", "Cayman R", "Peridot Green"], num: "211", instructor: true, exp: "PCA instructor since 2019" },
  { key: "beatrix", first: "Beatrix", last: "Holloway", group: "red", car: [1986, "Porsche", "944 Turbo", "Guards Red"], num: "951", instructor: true, exp: "PCA instructor since 2003" },
  { key: "rafael", first: "Rafael", last: "Montoya", group: "red", car: [2020, "BMW", "M2 Competition", "Hockenheim Silver"], num: "27", instructor: true, exp: "PCA instructor since 2021" },

  { key: "owen", first: "Owen", last: "Gallagher", group: "green", car: [2023, "Porsche", "718 Cayman", "Gentian Blue"], num: "314", exp: "First track day" },
  { key: "tessa", first: "Tessa", last: "Nakamura", group: "green", car: [2015, "Porsche", "Cayman", "Agate Grey"], num: "402", exp: "First track day" },
  { key: "marcus", first: "Marcus", last: "Feldman", group: "green", car: [2020, "Porsche", "911 Carrera", "Night Blue"], num: "520", exp: "4 track days" },
  { key: "ingrid", first: "Ingrid", last: "Solberg", group: "green", car: [2022, "Volkswagen", "Golf GTI", "Pure White"], num: "808", exp: "1 track day" },
  { key: "desmond", first: "Desmond", last: "Achebe", group: "green", car: [2017, "Porsche", "718 Boxster S", "Lava Orange"], num: "171", exp: "2 track days" },
  { key: "claire", first: "Claire", last: "Whitaker", group: "green", car: [2012, "Porsche", "Boxster", "Platinum Silver"], num: "129", exp: "2 track days" },
  { key: "raj", first: "Raj", last: "Venkataraman", group: "green", car: [2024, "Porsche", "911 Carrera T", "Ice Grey"], num: "992", exp: "First track day" },
  { key: "holly", first: "Holly", last: "Pruitt", group: "green", car: [2021, "Mazda", "MX-5 Miata", "Soul Red"], num: "55", exp: "1 track day", only: "sat" },

  { key: "simone", first: "Simone", last: "Baptiste", group: "blue", car: [2018, "Porsche", "718 Cayman S", "Miami Blue"], num: "718", exp: "7 track days" },
  { key: "theo", first: "Theo", last: "Marchetti", group: "blue", car: [2016, "Porsche", "911 Carrera", "Jet Black"], num: "160", exp: "6 track days" },
  { key: "joanna", first: "Joanna", last: "Kessler", group: "blue", car: [2009, "Porsche", "Cayman", "Meteor Grey"], num: "909", solo: true, exp: "11 track days" },
  { key: "victor", first: "Victor", last: "Osei", group: "blue", car: [2019, "Chevrolet", "Corvette Grand Sport", "Arctic White"], num: "66", solo: true, exp: "10 track days" },
  { key: "maya", first: "Maya", last: "Lindholm", group: "blue", car: [2013, "Porsche", "Boxster S", "Agate Grey"], num: "138", exp: "5 track days" },
  { key: "peter", first: "Peter", last: "Zielinski", group: "blue", car: [2006, "Porsche", "911 Carrera S (997)", "Midnight Blue"], num: "297", solo: true, exp: "12 track days" },
  { key: "naomi", first: "Naomi", last: "Ashcroft", group: "blue", car: [2020, "Porsche", "718 Spyder", "Crayon"], num: "204", solo: true, exp: "9 track days" },
  { key: "luis", first: "Luis", last: "Carvalho", group: "blue", car: [2015, "BMW", "M235i", "Estoril Blue"], num: "235", exp: "5 track days", only: "sun" },

  { key: "arjun", first: "Arjun", last: "Mehta", group: "white", car: [2019, "Porsche", "911 Carrera S", "GT Silver"], num: "199", solo: true, exp: "18 track days" },
  { key: "fiona", first: "Fiona", last: "Castellan", group: "white", car: [2016, "Porsche", "Cayman GT4", "Racing Yellow"], num: "4", solo: true, exp: "25 track days" },
  { key: "greg", first: "Greg", last: "Thibodeaux", group: "white", car: [2004, "Porsche", "911 GT3 (996)", "Speed Yellow"], num: "396", solo: true, exp: "30 track days" },
  { key: "hannah", first: "Hannah", last: "Oyelaran", group: "white", car: [2018, "Porsche", "911 Carrera GTS", "Carrara White"], num: "81", solo: true, exp: "16 track days" },
  { key: "ian", first: "Ian", last: "Brzezinski", group: "white", car: [2011, "Porsche", "911 Turbo", "Basalt Black"], num: "711", solo: true, exp: "20 track days" },
  { key: "keiko", first: "Keiko", last: "Tanabe", group: "white", car: [2021, "Porsche", "718 Cayman GT4", "Python Green"], num: "24", solo: true, exp: "15 track days" },
  { key: "wendell", first: "Wendell", last: "Park", group: "white", car: [2008, "Porsche", "Cayman S", "Guards Red"], num: "108", solo: true, exp: "19 track days" },

  { key: "abby", first: "Abigail", last: "Renner", group: "black", car: [2019, "Porsche", "911 GT3 RS", "Lizard Green"], num: "11", solo: true, exp: "50+ track days" },
  { key: "cyrus", first: "Cyrus", last: "Daneshvar", group: "black", car: [2015, "Porsche", "911 GT3", "Sapphire Blue"], num: "39", solo: true, exp: "40 track days" },
  { key: "elena", first: "Elena", last: "Vasquez", group: "black", car: [2010, "Porsche", "911 GT3 RS (997)", "Grey Black"], num: "73", solo: true, exp: "70+ track days" },
  { key: "frank", first: "Frank", last: "Dombrowski", group: "black", car: [1973, "Porsche", "911 RSR tribute", "Light Yellow"], num: "173", solo: true, exp: "80+ track days" },
  { key: "jerome", first: "Jerome", last: "Tillman", group: "black", car: [2022, "Porsche", "911 GT3 (992)", "Shark Blue"], num: "292", solo: true, exp: "35 track days" },
];

const CITIES: [string, string, string][] = [
  ["Savannah", "GA", "31401"],
  ["Pooler", "GA", "31322"],
  ["Richmond Hill", "GA", "31324"],
  ["Bluffton", "SC", "29910"],
  ["Hilton Head Island", "SC", "29928"],
  ["Statesboro", "GA", "30458"],
  ["Tybee Island", "GA", "31328"],
  ["Brunswick", "GA", "31520"],
  ["Beaufort", "SC", "29902"],
  ["Rincon", "GA", "31326"],
];
const STREETS = ["Abercorn St", "Whitaker St", "Victory Dr", "Skidaway Rd", "Bull St", "Waters Ave", "Habersham St", "Marsh Harbor Ln", "Live Oak Ct", "Tidewater Way", "Bluff Dr", "Oglethorpe Ave"];
const CONTACT_FIRST = ["Alex", "Jordan", "Sam", "Casey", "Morgan", "Robin", "Jamie", "Taylor", "Chris", "Pat"];
const SHIRTS = ["S", "M", "M", "L", "L", "L", "XL", "XL", "2XL", "M"];

const emailFor = (p: Person) =>
  `${p.first}.${p.last}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z.]/g, "") + "@example.com";

export const DEMO_PERSONAS: { email: string; label: string; detail: string }[] = [
  { email: "marian.castellanos@example.com", label: "Marian Castellanos", detail: "Administrator · Event Chair · Instructor" },
  { email: "hank.odom@example.com", label: "Hank Odom", detail: "Administrator · Chief Tech Inspector · Black group" },
  { email: "rosalind.achterberg@example.com", label: "Rosalind Achterberg", detail: "Instructor with two students and a check-in" },
  { email: "owen.gallagher@example.com", label: "Owen Gallagher", detail: "Green group · first track day" },
  { email: "tessa.nakamura@example.com", label: "Tessa Nakamura", detail: "Green group · paperwork still open" },
  { email: "simone.baptiste@example.com", label: "Simone Baptiste", detail: "Blue group · instructed" },
  { email: "arjun.mehta@example.com", label: "Arjun Mehta", detail: "White group · solo" },
];

/* ───────────── Schedule template (from CERPCAPocketSchedule) ───────────── */

type Slot = {
  t: string;
  end: string;
  kind: string;
  title: string;
  groups?: GroupKey[];
  /** Limit a group to its instructed or solo half: { blue: "solo" } for "Blue Solo and White". */
  parts?: Partial<Record<GroupKey, GroupPart>>;
  audience?: string;
  location?: string;
  note?: string;
};
const m = (t: string) => {
  const [h, mm] = t.split(":").map(Number);
  return h * 60 + mm;
};

const SATURDAY: Slot[] = [
  { t: "7:00", end: "8:00", kind: "other", title: "Tech opens", audience: "none", location: "Tech shed" },
  { t: "7:15", end: "7:30", kind: "meeting", title: "Instructors meeting", audience: "instructors" },
  { t: "7:30", end: "7:55", kind: "meeting", title: "Drivers meeting", audience: "all", note: "Mandatory for every driver." },
  { t: "8:00", end: "8:15", kind: "track", title: "Green orientation laps", groups: ["green"], note: "Paced laps with your instructor." },
  { t: "8:15", end: "8:45", kind: "track", title: "White", groups: ["white"] },
  { t: "8:30", end: "9:15", kind: "classroom", title: "Green ground school", groups: ["green"], location: "Student classroom" },
  { t: "8:45", end: "9:15", kind: "track", title: "Black", groups: ["black"] },
  { t: "9:15", end: "9:45", kind: "track", title: "Red", groups: ["red"] },
  { t: "9:45", end: "10:10", kind: "track", title: "Blue", groups: ["blue"] },
  { t: "10:10", end: "10:30", kind: "track", title: "Green", groups: ["green"] },
  { t: "10:30", end: "10:45", kind: "track", title: "DEX program", audience: "none", note: "Driver Experience laps." },
  { t: "10:45", end: "11:10", kind: "track", title: "White", groups: ["white"] },
  { t: "10:45", end: "11:25", kind: "classroom", title: "Blue ground school", groups: ["blue"], location: "Student classroom" },
  { t: "11:10", end: "11:40", kind: "track", title: "Black", groups: ["black"] },
  { t: "11:40", end: "12:00", kind: "track", title: "Blue", groups: ["blue"] },
  { t: "12:00", end: "13:00", kind: "break", title: "Lunch and track walk", audience: "none" },
  { t: "13:00", end: "13:20", kind: "track", title: "Green", groups: ["green"] },
  { t: "13:20", end: "13:50", kind: "track", title: "Red", groups: ["red"] },
  { t: "13:25", end: "14:00", kind: "classroom", title: "Green ground school", groups: ["green"], location: "Student classroom" },
  { t: "13:50", end: "14:15", kind: "track", title: "White", groups: ["white"] },
  { t: "14:15", end: "14:45", kind: "track", title: "Black", groups: ["black"] },
  { t: "14:15", end: "14:45", kind: "classroom", title: "White ground school (optional)", groups: ["white"], location: "Student classroom" },
  { t: "14:45", end: "15:05", kind: "track", title: "Green", groups: ["green"] },
  { t: "15:05", end: "15:25", kind: "track", title: "Blue", groups: ["blue"] },
  { t: "15:15", end: "15:45", kind: "classroom", title: "Green ground school", groups: ["green"], location: "Student classroom" },
  { t: "15:25", end: "15:55", kind: "track", title: "Red", groups: ["red"] },
  { t: "15:55", end: "16:20", kind: "track", title: "White", groups: ["white"] },
  { t: "16:20", end: "16:40", kind: "track", title: "Green", groups: ["green"] },
  { t: "16:40", end: "17:00", kind: "track", title: "Blue", groups: ["blue"] },
];

const SUNDAY: Slot[] = [
  { t: "7:00", end: "8:00", kind: "other", title: "Tech opens", audience: "none", location: "Tech shed" },
  { t: "7:45", end: "8:00", kind: "meeting", title: "Instructors meeting", audience: "instructors" },
  { t: "8:00", end: "8:15", kind: "meeting", title: "Drivers meeting", audience: "all", note: "Mandatory for every driver." },
  { t: "8:15", end: "8:45", kind: "track", title: "White", groups: ["white"] },
  { t: "8:30", end: "9:15", kind: "classroom", title: "Green ground school", groups: ["green"], location: "Student classroom" },
  { t: "8:45", end: "9:15", kind: "track", title: "Black", groups: ["black"] },
  { t: "9:15", end: "9:45", kind: "track", title: "Red", groups: ["red"] },
  { t: "9:45", end: "10:05", kind: "track", title: "Blue", groups: ["blue"] },
  { t: "10:05", end: "10:30", kind: "track", title: "Green exercise", groups: ["green"] },
  { t: "10:30", end: "11:00", kind: "track", title: "White", groups: ["white"] },
  { t: "10:30", end: "11:00", kind: "classroom", title: "Blue ground school", groups: ["blue"], location: "Student classroom" },
  { t: "11:00", end: "12:00", kind: "break", title: "Lunch", audience: "none", note: "Sunday quiet hour: no engines from 11:00 to noon." },
  { t: "12:00", end: "12:30", kind: "track", title: "Black", groups: ["black"] },
  { t: "12:30", end: "12:50", kind: "track", title: "Green", groups: ["green"] },
  { t: "12:50", end: "13:10", kind: "track", title: "Blue", groups: ["blue"] },
  { t: "13:10", end: "13:40", kind: "track", title: "Red", groups: ["red"] },
  { t: "13:40", end: "14:05", kind: "track", title: "White", groups: ["white"] },
  { t: "14:05", end: "14:25", kind: "track", title: "Green", groups: ["green"] },
  { t: "14:25", end: "14:45", kind: "track", title: "Blue", groups: ["blue"] },
  { t: "14:45", end: "15:10", kind: "track", title: "White", groups: ["white"] },
  { t: "15:10", end: "15:40", kind: "track", title: "Green and Blue", groups: ["green", "blue"] },
  { t: "15:40", end: "16:10", kind: "track", title: "Red, Black and White", groups: ["red", "black", "white"] },
  { t: "16:10", end: "16:30", kind: "other", title: "Track goes cold", audience: "none", note: "Safe travels home." },
];
/*
 * The pocket schedule's "Alternate Run Group Schedule - Sunday": after lunch
 * the groups are combined, and Blue is divided into its instructed and solo
 * halves. The sheet gives start times only, so each session runs to the next
 * start; the classroom and final session lengths are assumed.
 */
const SUNDAY_ALTERNATE: Slot[] = [
  { t: "7:00", end: "8:00", kind: "other", title: "Tech opens", audience: "none", location: "Tech shed" },
  { t: "7:45", end: "8:00", kind: "meeting", title: "Instructors meeting", audience: "instructors" },
  { t: "8:00", end: "8:15", kind: "meeting", title: "Drivers meeting", audience: "all", note: "Mandatory for every driver." },
  { t: "8:30", end: "9:00", kind: "track", title: "White", groups: ["white"] },
  { t: "8:35", end: "9:15", kind: "classroom", title: "Green ground school", groups: ["green"], location: "Student classroom" },
  { t: "9:00", end: "9:30", kind: "track", title: "Black", groups: ["black"] },
  { t: "9:30", end: "10:00", kind: "track", title: "Red", groups: ["red"] },
  { t: "10:00", end: "10:30", kind: "track", title: "Blue", groups: ["blue"] },
  { t: "10:30", end: "11:00", kind: "track", title: "Green", groups: ["green"] },
  { t: "11:00", end: "12:00", kind: "break", title: "Lunch", audience: "none", note: "Sunday quiet hour: no engines from 11:00 to noon." },
  { t: "12:00", end: "12:45", kind: "track", title: "Black and Red", groups: ["black", "red"] },
  { t: "12:45", end: "13:15", kind: "track", title: "Green and Blue Instructed", groups: ["green", "blue"], parts: { blue: "instructed" } },
  { t: "13:15", end: "13:45", kind: "track", title: "Blue Solo and White", groups: ["blue", "white"], parts: { blue: "solo" } },
  { t: "13:45", end: "14:30", kind: "track", title: "Black and Red", groups: ["black", "red"] },
  { t: "14:30", end: "15:00", kind: "track", title: "Green and Blue Instructed", groups: ["green", "blue"], parts: { blue: "instructed" } },
  { t: "15:00", end: "15:30", kind: "track", title: "Blue Solo and White", groups: ["blue", "white"], parts: { blue: "solo" } },
  { t: "15:30", end: "16:00", kind: "track", title: "Green and Blue Instructed", groups: ["green", "blue"], parts: { blue: "instructed" } },
  { t: "16:00", end: "16:30", kind: "track", title: "Blue Solo and White", groups: ["blue", "white"], parts: { blue: "solo" } },
];

/* ───────────── Waiver wording ───────────── */

const PLACEHOLDER =
  "PLACEHOLDER WORDING. Replace this text with the official document before using this app to collect signatures for a real event.";

const WAIVERS = [
  {
    title: "PCA Release and Waiver of Liability",
    summary: "The national PCA release every adult entering the event must sign.",
    body: `${PLACEHOLDER}\n\nBy signing, I acknowledge that I have read the Porsche Club of America Release and Waiver of Liability, Assumption of Risk and Indemnity Agreement for this event, that I understand it, and that I am signing it voluntarily.\n\nThe region should paste the current official PCA release here, or link this step to the PCA-approved electronic waiver, and confirm with the PCA Insurance Chair that signatures collected this way satisfy the event insurance requirements.`,
  },
  {
    title: "Roebling Road Raceway track waiver",
    summary: "The track requires a signed waiver from every person entering the grounds. No exceptions.",
    body: `${PLACEHOLDER}\n\nBy signing, I acknowledge that I have read and agree to the Roebling Road Raceway release and waiver, and that all persons entering Roebling Road Raceway are required to sign the track waiver forms.\n\nThe region should confirm with track management whether a signature collected here is accepted in place of the waiver signed at the gate.`,
  },
  {
    title: "CERPCA driver acknowledgment",
    summary: "Confirms you have read the track rules, the flags and your run group's passing zones.",
    body: `Draft wording for review by the region.\n\nI confirm that before driving at this event:\n\n1. I have read the Rules of Roebling Road, including the 5 mph paddock limit, the 40 mph pit lane limit, quiet hours, and the waste fluid rules.\n2. I know the meaning of every flag on the flag card and will acknowledge the flagger when a flag is shown to me.\n3. I have read the passing-zone sheet for my run group. I will pass only in the designated zones, only on the right, and only with a point-by.\n4. My car will carry a current tech sticker before it enters the track, and I will bring my helmet to grid tech.\n5. I will attend the drivers meeting each day I drive, and every classroom session scheduled for my run group.\n6. No alcohol will be consumed until the final checkered flag of the day and the track is clear of vehicles.`,
  },
];

const SHARED_NOTES = [
  "Good first session. Eyes are coming up nicely by the end of the front straight. Next time out we work on a later turn-in for Turn 1; you are turning at the 2 marker and it is costing you the apex in Turn 2.",
  "Braking is smooth and in a straight line. Turn 4 is the homework: stay left longer and wait until you can see the end of the right gator before you add steering.",
  "Much better through 6 and 7 once you treated them as one corner. Keep practising the point-by: early, clear, arm fully out. Mirrors every straight.",
  "Consistent laps. Turn 5 double apex is starting to click. Remember to cross back to the left before Turn 6 rather than hugging the right.",
  "Strong session. Hands are quieter and you are unwinding the wheel at exit instead of holding it. We added a little speed into Turn 3 with a lift rather than a brake and the car stayed settled.",
  "Traffic management was excellent today. Two clean point-bys in zone 3 and you lifted to let them complete. Let's bring the Turn 1 brake point to the 4 marker next session.",
];
const PRIVATE_NOTES = [
  "Tends to fixate on the car ahead through 4 and 5. Would benefit from a lead-follow lap on Sunday.",
  "Very coachable. Ready for more speed, but check-in on mirrors is still prompted rather than habitual.",
  "Got flustered after a late point-by in zone 1. Settled after a slow lap. Keep an eye on fatigue in the afternoon.",
];

const party = (p: Partial<IncidentParty> = {}): IncidentParty => ({
  name: "",
  address: "",
  phone: "",
  email: "",
  injuries: "",
  determinedBy: "",
  signedIn: "",
  notSignedInExplain: "",
  ...p,
});

export async function seed(db: DB) {
  const now = new Date();
  const today = zoned(now, TZ).day;
  const wd = weekdayIndex(today);
  // The demo event is always "this weekend": live on Saturday and Sunday, upcoming otherwise.
  const day1 = wd === 6 ? today : wd === 0 ? addDays(today, -1) : addDays(today, 6 - wd);
  const at = (day: string, minutes: number) => new Date(now.getTime() + offsetToReach(day, minutes, TZ, now));

  /* Region, track, run groups */
  const [org] = await db
    .insert(s.organizations)
    .values({
      slug: "cerpca",
      name: "Coastal Empire Region, Porsche Club of America",
      shortName: "CERPCA",
      website: "https://www.cerpca.net/",
      timezone: TZ,
      settings: {
        incidentRecipients: [
          { role: "PCA Insurance Chair", email: "InsuranceChair@pca.org" },
          { role: "PCA Safety Chair", email: "safety@pca.org" },
          { role: "PCA National Office", email: "insurance@pca.org" },
          { role: "Zone Representative", email: "" },
        ],
        eventChair: { name: "Marian Castellanos", phone: "(912) 555-0117", email: "marian.castellanos@example.com" },
        techWindow: { earliestDays: 28, latestDays: 14 },
        reminderOffsets: [15, 10, 5],
      },
    })
    .returning();

  const [track] = await db
    .insert(s.tracks)
    .values({
      slug: "roebling-road",
      name: "Roebling Road Raceway",
      shortName: "Roebling Road",
      address: "1135 Roebling Road",
      city: "Bloomingdale",
      state: "GA",
      zip: "31302",
      lengthMiles: 2.02,
      turnCount: 9,
      timezone: TZ,
      guide: roeblingRoadGuide,
    })
    .returning();

  const groupRows = await db
    .insert(s.runGroups)
    .values([
      {
        orgId: org.id,
        key: "green",
        name: "Green",
        color: "#12894a",
        textColor: "#ffffff",
        sortOrder: 1,
        summary: "Novice",
        description: "Novice drivers. Always instructed: an instructor rides in the right seat every session.",
        instructorPolicy: "required",
        passingKey: "greenBlue",
      },
      {
        orgId: org.id,
        key: "blue",
        name: "Blue",
        color: "#1d5fd1",
        textColor: "#ffffff",
        sortOrder: 2,
        summary: "Intermediate",
        description: "Intermediate drivers. Blue has two halves, Blue (Instructed) and Blue (Solo). An instructor must sign a driver off before they drive solo.",
        instructorPolicy: "optional",
        passingKey: "greenBlue",
      },
      {
        orgId: org.id,
        key: "white",
        name: "White",
        color: "#ffffff",
        textColor: "#14171a",
        sortOrder: 3,
        summary: "Advanced",
        description: "Advanced drivers. Solo by default. A driver can ask for an instructor to ride along, or be asked to have an instructor check in on them.",
        instructorPolicy: "none",
        passingKey: "white",
      },
      {
        orgId: org.id,
        key: "black",
        name: "Black",
        color: "#14171a",
        textColor: "#ffffff",
        sortOrder: 4,
        summary: "Expert",
        description: "Expert drivers. Solo by default. A driver can ask for an instructor to ride along, or be asked to have an instructor check in on them.",
        instructorPolicy: "none",
        passingKey: null,
      },
      {
        orgId: org.id,
        key: "red",
        name: "Red",
        color: "#d1242a",
        textColor: "#ffffff",
        sortOrder: 5,
        summary: "Instructors",
        description: "Instructors.",
        instructorPolicy: "none",
        passingKey: null,
        isInstructorGroup: true,
      },
    ])
    .returning();
  const G = Object.fromEntries(groupRows.map((g) => [g.key, g])) as Record<GroupKey, (typeof groupRows)[number]>;

  /* People, memberships, cars */
  const U: Record<string, typeof s.users.$inferSelect> = {};
  const V: Record<string, typeof s.vehicles.$inferSelect> = {};
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    const [city, state, zip] = CITIES[i % CITIES.length];
    const [user] = await db
      .insert(s.users)
      .values({
        email: emailFor(p),
        firstName: p.first,
        lastName: p.last,
        phone: `(912) 555-01${String(10 + i).padStart(2, "0")}`,
        address1: `${118 + i * 37} ${STREETS[i % STREETS.length]}`,
        city,
        state,
        zip,
        emergencyName: `${CONTACT_FIRST[i % CONTACT_FIRST.length]} ${p.last}`,
        emergencyPhone: `(912) 555-01${String(60 + (i % 39)).padStart(2, "0")}`,
        pcaMemberNumber: `20${String(11 + (i % 14)).padStart(2, "0")}${String(40117 + i * 613).slice(0, 5)}`,
        tshirtSize: SHIRTS[i % SHIRTS.length],
        notifySms: i % 3 === 0,
      })
      .returning();
    U[p.key] = user;
    await db.insert(s.memberships).values({
      orgId: org.id,
      userId: user.id,
      isAdmin: Boolean(p.admin),
      isInstructor: Boolean(p.instructor),
      adminTitle: p.admin ?? null,
      instructorCredential: p.instructor ? "PCA National Instructor" : null,
      runGroupId: G[p.group].id,
      soloApproved: Boolean(p.solo || p.instructor),
      experience: p.exp,
    });
    const [vehicle] = await db
      .insert(s.vehicles)
      .values({ userId: user.id, year: p.car[0], make: p.car[1], model: p.car[2], color: p.car[3], carNumber: p.num })
      .returning();
    V[p.key] = vehicle;
  }
  const P = Object.fromEntries(PEOPLE.map((p) => [p.key, p]));
  const fullName = (k: string) => `${U[k].firstName} ${U[k].lastName}`;

  /* Events: three completed, one this weekend */
  const mkEvent = async (name: string, slug: string, start: string, status: string, description: string) => {
    const [e] = await db
      .insert(s.events)
      .values({
        orgId: org.id,
        trackId: track.id,
        slug,
        name,
        startDate: start,
        endDate: addDays(start, 1),
        status,
        description,
        registrationUrl: "https://clubregistration.net/",
      })
      .returning();
    return e;
  };
  const fall25 = await mkEvent("Fall Driver Education 2025", "fall-de-2025", addDays(day1, -434), "completed", "Two days of driver education at Roebling Road.");
  const spring = await mkEvent("Spring Driver Education", "spring-de", addDays(day1, -245), "completed", "Season opener at Roebling Road.");
  const summer = await mkEvent("Summer Driver Education", "summer-de", addDays(day1, -161), "completed", "Early starts to beat the heat.");
  const current = await mkEvent(
    "Fall Driver Education",
    "fall-de",
    day1,
    "published",
    "Two days of high performance driver education at Roebling Road Raceway, with instruction for Green and Blue drivers.",
  );

  const addSchedule = async (eventId: string, d1: string, sunday: Slot[] = SUNDAY) => {
    const rows = [
      ...SATURDAY.map((slot) => ({ slot, day: d1 })),
      ...sunday.map((slot) => ({ slot, day: addDays(d1, 1) })),
    ].map(({ slot, day }) => ({
      eventId,
      day,
      startMin: m(slot.t),
      endMin: m(slot.end),
      kind: slot.kind,
      title: slot.title,
      location: slot.location ?? null,
      audience: slot.audience ?? (slot.groups ? "groups" : "none"),
      groupIds: (slot.groups ?? []).map((k) => G[k].id),
      groupParts: Object.fromEntries(Object.entries(slot.parts ?? {}).map(([k, part]) => [G[k as GroupKey].id, part])),
      note: slot.note ?? null,
    }));
    return db.insert(s.scheduleItems).values(rows).returning();
  };
  for (const e of [fall25, spring]) await addSchedule(e.id, e.startDate);
  // The summer event ran the alternate Sunday, so there is one on file to copy from.
  await addSchedule(summer.id, summer.startDate, SUNDAY_ALTERNATE);
  const currentSchedule = await addSchedule(current.id, day1);

  /* Registrations */
  const earlierGroup: Record<string, Partial<Record<string, GroupKey>>> = {
    simone: { [fall25.id]: "green", [spring.id]: "green" },
    arjun: { [fall25.id]: "blue" },
    keiko: { [fall25.id]: "blue" },
    marcus: {},
    peter: { [fall25.id]: "blue" },
  };
  const skipPast = new Set(["owen", "tessa", "raj", "ingrid", "holly", "claire", "desmond"]);
  for (const e of [fall25, spring, summer]) {
    const rows = PEOPLE.filter((p, i) => !skipPast.has(p.key) && (i + e.name.length) % 5 !== 0).map((p) => ({
      eventId: e.id,
      userId: U[p.key].id,
      runGroupId: G[earlierGroup[p.key]?.[e.id] ?? p.group].id,
      vehicleId: V[p.key].id,
      carNumber: p.num,
      isInstructor: Boolean(p.instructor),
      solo: Boolean(p.solo || p.instructor),
      tshirtSize: U[p.key].tshirtSize,
      checkedInAt: at(e.startDate, 7 * 60 + 10),
      source: "import",
    }));
    if (e.id === summer.id) {
      for (const k of ["ingrid", "claire", "desmond"]) {
        rows.push({
          eventId: e.id,
          userId: U[k].id,
          runGroupId: G.green.id,
          vehicleId: V[k].id,
          carNumber: P[k].num,
          isInstructor: false,
          solo: false,
          tshirtSize: U[k].tshirtSize,
          checkedInAt: at(e.startDate, 7 * 60 + 15),
          source: "import",
        });
      }
    }
    await db.insert(s.registrations).values(rows);
  }

  const noSticker = new Set(["tessa", "holly", "luis", "ingrid", "wendell", "greg", "victor", "naomi", "frank", "jerome"]);
  // Solo drivers who ride with an instructor anyway: one asked for a ride-along, one was given a check-in.
  const instructorRequests: Record<string, { kind: "ride_along" | "check_in"; note: string }> = {
    keiko: { kind: "ride_along", note: "I would like a second opinion on my line through Turns 4 and 5, and on braking into Turn 1." },
    wendell: { kind: "check_in", note: "Ride one session and watch traffic awareness in the longer White passing zone." },
  };
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    await db.insert(s.registrations).values({
      eventId: current.id,
      userId: U[p.key].id,
      runGroupId: G[p.group].id,
      vehicleId: V[p.key].id,
      carNumber: p.num,
      attendsDay1: p.only !== "sun",
      attendsDay2: p.only !== "sat",
      isInstructor: Boolean(p.instructor),
      solo: Boolean(p.solo || p.instructor),
      instructorRequest: instructorRequests[p.key]?.kind ?? null,
      instructorRequestNote: instructorRequests[p.key]?.note ?? null,
      tshirtSize: U[p.key].tshirtSize,
      checkedInAt: noSticker.has(p.key) ? null : at(day1, 6 * 60 + 50 + (i % 9) * 4),
      source: "import",
      externalId: `CR-${48210 + i}`,
    });
  }

  /* Instructor assignments */
  const pairs: [string, string][] = [
    ["rosalind", "owen"],
    ["rosalind", "simone"],
    ["gus", "tessa"],
    ["gus", "theo"],
    ["noelle", "marcus"],
    ["noelle", "maya"],
    ["dmitri", "ingrid"],
    ["dmitri", "luis"],
    ["yvonne", "desmond"],
    ["calvin", "claire"],
    ["beatrix", "raj"],
    // A check-in asked for by the administrators; Keiko's ride-along request is still waiting.
    ["rosalind", "wendell"],
  ];
  await db.insert(s.instructorAssignments).values(pairs.map(([i, st]) => ({ eventId: current.id, instructorId: U[i].id, studentId: U[st].id })));
  await db.insert(s.instructorAssignments).values([
    { eventId: summer.id, instructorId: U.rosalind.id, studentId: U.simone.id },
    { eventId: summer.id, instructorId: U.noelle.id, studentId: U.marcus.id },
    { eventId: summer.id, instructorId: U.yvonne.id, studentId: U.desmond.id },
    { eventId: spring.id, instructorId: U.gus.id, studentId: U.arjun.id },
    { eventId: spring.id, instructorId: U.rosalind.id, studentId: U.simone.id },
  ]);

  /* Waivers */
  const templates = await db
    .insert(s.waiverTemplates)
    .values(WAIVERS.map((w, i) => ({ orgId: org.id, title: w.title, summary: w.summary, body: w.body, sortOrder: i })))
    .returning();
  const unsigned: Record<string, number[]> = { tessa: [1], holly: [0, 1, 2], luis: [1, 2], jerome: [2] };
  const sigRows: (typeof s.waiverSignatures.$inferInsert)[] = [];
  PEOPLE.forEach((p, i) => {
    templates.forEach((t, ti) => {
      if (unsigned[p.key]?.includes(ti)) return;
      sigRows.push({
        templateId: t.id,
        templateVersion: t.version,
        eventId: current.id,
        userId: U[p.key].id,
        signedName: fullName(p.key),
        signatureData: fakeSignature(fullName(p.key) + ti),
        bodyHash: sha(t.body),
        ip: "203.0.113." + (10 + i),
        userAgent: "Seeded demo signature",
        signedAt: new Date(now.getTime() - (20 - (i % 14)) * 86400000 - ti * 60000),
      });
    });
  });
  await db.insert(s.waiverSignatures).values(sigRows);

  /* Shops */
  const shopRows = await db
    .insert(s.shops)
    .values([
      { orgId: org.id, name: "Lowcountry Motorwerks", contactName: "Bram Ostrander", email: "service@lowcountrymotorwerks.example", phone: "(912) 555-0181", city: "Savannah, GA", verified: true },
      { orgId: org.id, name: "Tybee Autohaus", contactName: "Deb Halloran", email: "tech@tybeeautohaus.example", phone: "(912) 555-0182", city: "Thunderbolt, GA", verified: true },
      { orgId: org.id, name: "Bluffton European Auto", contactName: "Marcel Adeyemi", email: "frontdesk@blufftoneuro.example", phone: "(843) 555-0183", city: "Bluffton, SC", verified: true },
      { orgId: org.id, name: "Pooler Performance & Tire", contactName: "Rick Sandoval", email: "rick@poolerperformance.example", phone: "(912) 555-0184", city: "Pooler, GA", verified: false, notes: "First form received from this shop this season." },
    ])
    .returning();

  /* Tech inspections */
  const passAll = (overrides: Partial<TechFormData> = {}): TechFormData => ({
    items: Object.fromEntries(
      TECH_ITEMS.map((it) => [it.key, it.optional && it.key !== "center_locks" ? "na" : it.key === "center_locks" ? "na" : "pass"]),
    ) as TechFormData["items"],
    itemNotes: {},
    tireDates: { lf: "1825", rf: "1825", lr: "2025", rr: "2025" },
    brakeFluidDate: addDays(day1, -75),
    helmet: "SA2020",
    notes: "",
    ...overrides,
  });
  const gridAll = { items: Object.fromEntries(GRID_TECH_ITEMS.map((g) => [g.key, true])), notes: "" };
  let sticker = 0;
  for (let i = 0; i < PEOPLE.length; i++) {
    const p = PEOPLE[i];
    if (p.key === "holly") continue; // not started
    const shop = shopRows[i % 3];
    const inspected = addDays(day1, -(16 + (i % 9)));
    const base: typeof s.techInspections.$inferInsert = {
      eventId: current.id,
      userId: U[p.key].id,
      vehicleYear: p.car[0],
      vehicleMake: p.car[1],
      vehicleModel: p.car[2],
      vehicleColor: p.car[3],
      carNumber: p.num,
      emergency1: `${U[p.key].emergencyName}, ${U[p.key].emergencyPhone}`,
      form: passAll(),
      method: "online",
      status: "approved",
      shopId: shop.id,
      shopName: shop.name,
      shopEmail: shop.email,
      shopPhone: shop.phone,
      mechanicName: shop.contactName,
      inspectionDate: inspected,
      mechanicInvitedAt: at(addDays(inspected, -2), 9 * 60),
      mechanicSignedAt: at(inspected, 15 * 60 + (i % 40)),
      mechanicSignature: fakeSignature(shop.contactName ?? shop.name),
      mechanicIp: "198.51.100." + (20 + (i % 3)),
      mechanicUserAgent: "Seeded demo signature",
      driverSignedName: fullName(p.key),
      driverSignature: fakeSignature(fullName(p.key)),
      driverSignedAt: at(addDays(inspected, 1), 19 * 60),
      submittedAt: at(addDays(inspected, 1), 19 * 60 + 2),
      reviewedById: U.hank.id,
      reviewedAt: at(addDays(inspected, 2), 8 * 60 + 30),
    };

    if (p.key === "tessa") {
      Object.assign(base, { status: "shop_signed", driverSignedName: null, driverSignature: null, driverSignedAt: null, submittedAt: null, reviewedById: null, reviewedAt: null });
    } else if (p.key === "luis" || p.key === "jerome") {
      Object.assign(base, {
        status: "with_shop",
        form: { items: {}, itemNotes: {}, tireDates: { lf: "", rf: "", lr: "", rr: "" }, brakeFluidDate: "", helmet: "", notes: "" },
        inspectionDate: null,
        mechanicSignedAt: null,
        mechanicSignature: null,
        mechanicIp: null,
        mechanicUserAgent: null,
        sealHash: null,
        mechanicInvitedAt: at(addDays(day1, -6), 10 * 60),
        mechanicTokenHash: sha(`demo-shop-link-${p.key}`),
        mechanicTokenExpires: new Date(now.getTime() + 21 * 86400000),
        driverSignedName: null,
        driverSignature: null,
        driverSignedAt: null,
        submittedAt: null,
        reviewedById: null,
        reviewedAt: null,
      });
    } else if (p.key === "ingrid") {
      const unverified = shopRows[3];
      Object.assign(base, {
        status: "submitted",
        shopId: unverified.id,
        shopName: unverified.name,
        shopEmail: unverified.email,
        shopPhone: unverified.phone,
        mechanicName: unverified.contactName,
        mechanicSignature: fakeSignature(unverified.contactName ?? "x"),
        reviewedById: null,
        reviewedAt: null,
        submittedAt: at(addDays(day1, -3), 20 * 60),
      });
    } else if (p.key === "wendell") {
      Object.assign(base, {
        status: "submitted",
        form: passAll({ tireDates: { lf: "3122", rf: "3122", lr: "4020", rr: "4020" } }),
        reviewedById: null,
        reviewedAt: null,
        submittedAt: at(addDays(day1, -2), 18 * 60 + 12),
      });
    } else if (p.key === "greg") {
      Object.assign(base, {
        status: "changes_requested",
        form: passAll({ brakeFluidDate: addDays(day1, -410) }),
        reviewNote: "Brake fluid was last changed more than 12 months before the event. Have it flushed and ask the shop to update the date, then resubmit.",
      });
    }
    if (!noSticker.has(p.key)) {
      sticker += 1;
      Object.assign(base, {
        gridTech: gridAll,
        gridTechById: i % 2 ? U.hank.id : U.tomas.id,
        gridTechAt: at(day1, 7 * 60 + 2 + (i % 11) * 4),
        stickerIssuedAt: at(day1, 7 * 60 + 4 + (i % 11) * 4),
        stickerNumber: `F${day1.slice(2, 4)}-${String(sticker).padStart(3, "0")}`,
      });
    }
    // Seal what the shop signed (after the per-person variations above), in the same shape src/server/tech.ts verifies.
    base.sealHash = base.mechanicSignedAt ? sha(JSON.stringify([base.form, base.inspectionDate, base.mechanicName, base.shopName])) : null;
    await db.insert(s.techInspections).values(base);
  }

  /* Session logs, promotions, notes */
  const item = (day: string, title: string, start: string) => currentSchedule.find((x) => x.day === day && x.title === title && x.startMin === m(start))!;
  const sat = (min: number) => at(day1, min);
  const nowMin = zoned(now, TZ);
  const eventStarted = today >= day1;
  const happened = (startMin: number) => eventStarted && (today > day1 || nowMin.minutes > startMin + 25);
  const logs: (typeof s.sessionLogs.$inferInsert)[] = [];
  let noteIdx = 0;
  for (const [inst, student] of pairs) {
    const group = P[student].group;
    if (P[student].only === "sun") continue;
    const sessions = group === "green" ? [["Green orientation laps", "8:00"], ["Green", "10:10"], ["Green", "13:00"]] : [["Blue", "9:45"], ["Blue", "11:40"]];
    for (const [title, start] of sessions) {
      if (!happened(m(start))) continue;
      if (student === "tessa" || student === "ingrid") continue; // not cleared to drive yet
      const it = item(day1, title, start);
      logs.push({
        eventId: current.id,
        instructorId: U[inst].id,
        studentId: U[student].id,
        scheduleItemId: it.id,
        day: day1,
        label: `Saturday ${start.replace(/^13:/, "1:")} · ${title}`,
        sharedNotes: SHARED_NOTES[noteIdx % SHARED_NOTES.length],
        privateNotes: noteIdx % 3 === 1 ? PRIVATE_NOTES[noteIdx % PRIVATE_NOTES.length] : null,
        focusAreas: [["Vision", "Braking"], ["Line", "Turn 4"], ["Passing signals", "Mirrors"]][noteIdx % 3],
        createdAt: sat(m(start) + 32),
      });
      noteIdx++;
    }
  }
  logs.push(
    {
      eventId: summer.id,
      instructorId: U.rosalind.id,
      studentId: U.simone.id,
      day: summer.startDate,
      label: "Saturday 10:10 · Green",
      sharedNotes: "Clean, repeatable laps. You are ready to think about traffic: start checking mirrors on every straight and practise giving the point-by before you are asked.",
      privateNotes: "Strong candidate for Blue after this weekend.",
      focusAreas: ["Mirrors", "Passing signals"],
      createdAt: at(summer.startDate, 10 * 60 + 45),
    },
    {
      eventId: summer.id,
      instructorId: U.rosalind.id,
      studentId: U.simone.id,
      day: summer.endDate,
      label: "Sunday 12:30 · Green",
      sharedNotes: "Best session of the weekend. Late apexes everywhere and you held the student line under pressure from faster cars. I am recommending you for Blue.",
      focusAreas: ["Line", "Consistency"],
      createdAt: at(summer.endDate, 13 * 60),
    },
    {
      eventId: summer.id,
      instructorId: U.noelle.id,
      studentId: U.marcus.id,
      day: summer.startDate,
      label: "Saturday 1:00 · Green",
      sharedNotes: "Good pace, but slow the hands down. Turn 1 to 2 should feel like one decreasing-radius corner. We will keep working on being patient at turn-in.",
      focusAreas: ["Smooth inputs", "Turn 1–2"],
      createdAt: at(summer.startDate, 13 * 60 + 30),
    },
    {
      eventId: spring.id,
      instructorId: U.gus.id,
      studentId: U.arjun.id,
      day: spring.startDate,
      label: "Saturday 11:40 · Blue",
      sharedNotes: "Solo-quality driving all morning. Awareness of traffic is excellent and point-bys are early. Recommending White.",
      focusAreas: ["Traffic", "Consistency"],
      createdAt: at(spring.startDate, 12 * 60 + 5),
    },
  );
  if (logs.length) await db.insert(s.sessionLogs).values(logs);

  await db.insert(s.promotions).values([
    {
      orgId: org.id,
      eventId: fall25.id,
      userId: U.keiko.id,
      kind: "group",
      fromGroupId: G.blue.id,
      toGroupId: G.white.id,
      recommendedById: U.yvonne.id,
      rationale: "Two full weekends of consistent solo laps in Blue. Reads traffic early, gives and takes point-bys without prompting, and recovers calmly from mistakes.",
      status: "approved",
      decidedById: U.dale.id,
      decidedAt: at(fall25.endDate, 16 * 60 + 40),
      decisionNote: "Agreed. Rode with her Sunday afternoon.",
      createdAt: at(fall25.endDate, 15 * 60),
    },
    {
      orgId: org.id,
      eventId: spring.id,
      userId: U.arjun.id,
      kind: "group",
      fromGroupId: G.blue.id,
      toGroupId: G.white.id,
      recommendedById: U.gus.id,
      rationale: "Solo-quality driving all weekend with excellent situational awareness. Ready for the longer White passing zone.",
      status: "approved",
      decidedById: U.dale.id,
      decidedAt: at(spring.endDate, 16 * 60 + 20),
      decisionNote: "Approved, effective next event.",
      createdAt: at(spring.endDate, 14 * 60 + 10),
    },
    {
      orgId: org.id,
      eventId: summer.id,
      userId: U.simone.id,
      kind: "group",
      fromGroupId: G.green.id,
      toGroupId: G.blue.id,
      recommendedById: U.rosalind.id,
      rationale: "Holds the student line lap after lap, late apexes at every corner, and manages faster traffic without losing composure. She has completed all Green ground school sessions.",
      status: "approved",
      decidedById: U.dale.id,
      decidedAt: at(summer.endDate, 16 * 60 + 30),
      decisionNote: "Approved. Stays instructed in Blue to start.",
      createdAt: at(summer.endDate, 13 * 60 + 20),
    },
    {
      orgId: org.id,
      eventId: summer.id,
      userId: U.theo.id,
      kind: "solo",
      fromGroupId: G.blue.id,
      toGroupId: G.blue.id,
      recommendedById: U.gus.id,
      rationale: "Pace and line are there. Requesting solo sign-off in Blue.",
      status: "declined",
      decidedById: U.dale.id,
      decidedAt: at(summer.endDate, 16 * 60 + 35),
      decisionNote: "Not yet. Mirror checks were inconsistent on my check ride. Revisit in the fall.",
      createdAt: at(summer.endDate, 14 * 60),
    },
    {
      orgId: org.id,
      eventId: current.id,
      userId: U.simone.id,
      kind: "solo",
      fromGroupId: G.blue.id,
      toGroupId: G.blue.id,
      recommendedById: U.rosalind.id,
      rationale: "Three events in Blue now. This morning she ran both sessions without a single correction from me: mirrors every straight, early point-bys in all three zones, and she pitted on her own when she felt the brake pedal go long. I am comfortable with her driving solo.",
      status: "proposed",
      createdAt: new Date(now.getTime() - 55 * 60000),
    },
    {
      orgId: org.id,
      eventId: current.id,
      userId: U.marcus.id,
      kind: "group",
      fromGroupId: G.green.id,
      toGroupId: G.blue.id,
      recommendedById: U.noelle.id,
      rationale: "Fifth event. The hands have calmed down since the summer and the line through Turns 4 and 5 is repeatable. He is giving point-bys early and lifting to complete them. Ready for Blue, instructed.",
      status: "proposed",
      createdAt: new Date(now.getTime() - 25 * 60000),
    },
  ]);

  await db.insert(s.driverNotes).values([
    { orgId: org.id, userId: U.theo.id, authorId: U.tomas.id, eventId: current.id, category: "conduct", body: "Reminded about the 5 mph paddock limit on Saturday morning. Took it well.", createdAt: sat(7 * 60 + 5) },
    { orgId: org.id, userId: U.desmond.id, authorId: U.priya.id, eventId: current.id, category: "general", body: "Brings his own intercom set. Asked to keep the same instructor both days.", createdAt: new Date(now.getTime() - 9 * 86400000) },
    { orgId: org.id, userId: U.frank.id, authorId: U.hank.id, eventId: spring.id, category: "safety", body: "Open-top tribute car. Roll bar and broomstick check confirmed in person at the spring event; recheck each event.", createdAt: at(spring.startDate, 7 * 60 + 20) },
    { orgId: org.id, userId: U.desmond.id, authorId: U.yvonne.id, eventId: summer.id, category: "instructor", body: "Tends to fixate on the car ahead through Turns 4 and 5. Suggest a lead-follow lap early in his next event.", createdAt: at(summer.endDate, 15 * 60) },
  ]);

  /* Incidents */
  const baseIncident = (over: Partial<IncidentData>): IncidentData => ({
    region: "Coastal Empire Region",
    eventChair: "Marian Castellanos",
    chairPhone: "(912) 555-0117",
    chairEmail: "marian.castellanos@example.com",
    locationAddress: "Roebling Road Raceway, 1135 Roebling Road, Bloomingdale, GA 31302",
    eventType: "Driver Education (HPDE)",
    driver: party(),
    passenger: { ...party(), present: "no" },
    other: { ...party(), present: "no", role: "" },
    waiversAttached: false,
    vehicles: "",
    description: "",
    transport: { name: "", hospital: "", address: "", phone: "", disposition: "" },
    comments: "",
    preparedBy: { name: "Marian Castellanos", title: "Event Chair", phoneWork: "(912) 555-0117", phoneHome: "", fax: "", email: "marian.castellanos@example.com" },
    ...over,
  });
  const cy = U.cyrus;
  await db.insert(s.incidents).values([
    {
      orgId: org.id,
      eventId: summer.id,
      status: "sent",
      occurredOn: summer.startDate,
      occurredTime: "14:22",
      location: "Pit lane entrance",
      criteria: ["car_to_car"],
      hasInjury: false,
      driverUserId: U.peter.id,
      driverName: fullName("peter"),
      summary: "Low-speed car-to-car contact at pit-in. No injuries.",
      data: baseIncident({
        driver: party({ name: fullName("peter"), address: `${U.peter.address1}, ${U.peter.city}, ${U.peter.state} ${U.peter.zip}`, phone: U.peter.phone ?? "", email: U.peter.email, injuries: "no", determinedBy: "Track medical staff", signedIn: "yes" }),
        vehicles: "2006 Porsche 911 Carrera S (997), Midnight Blue, coupe, car #297. Second car reported separately: 2019 Chevrolet Corvette Grand Sport, Arctic White, coupe, car #66.",
        description: "While slowing on driver's right to enter the pits after the checkered flag, car #297 was contacted on the left rear quarter by car #66, which had not seen the pit-in signal. Contact was at roughly 25 mph. Left rear quarter panel of #297 is dented and scraped; right front bumper cover of #66 is cracked. Neither driver reported injury.",
        comments: "Both drivers were reminded at the Sunday drivers meeting to raise a fist out of the window well before the pit entrance. One report filed per car.",
        waiversAttached: true,
        preparedBy: { name: "Marian Castellanos", title: "Event Chair", phoneWork: "(912) 555-0117", phoneHome: "", fax: "", email: "marian.castellanos@example.com", signature: fakeSignature("Marian Castellanos"), signedAt: at(summer.endDate, 18 * 60).toISOString() },
      }),
      dueOn: addBusinessDays(summer.startDate, 5),
      sentAt: at(addDays(summer.startDate, 2), 10 * 60),
      createdById: U.marian.id,
      createdAt: at(summer.startDate, 15 * 60),
    },
    {
      orgId: org.id,
      eventId: current.id,
      status: "draft",
      occurredOn: day1,
      occurredTime: "11:22",
      location: "Turn 5 exit",
      criteria: ["immovable_object"],
      hasInjury: false,
      driverUserId: cy.id,
      driverName: fullName("cyrus"),
      summary: "Single car off at Turn 5 exit, contact with tire barrier. No injuries.",
      data: baseIncident({
        driver: party({ name: fullName("cyrus"), address: `${cy.address1}, ${cy.city}, ${cy.state} ${cy.zip}`, phone: cy.phone ?? "", email: cy.email, injuries: "no", determinedBy: "Track medical staff", signedIn: "yes" }),
        vehicles: "2015 Porsche 911 GT3, Sapphire Blue, coupe, car #39.",
        description: "During the 11:10 Black session, car #39 dropped two wheels at the Turn 5 track-out, rotated, and made contact with the tire barrier on driver's left with the right rear corner. Right rear bumper cover and quarter panel are damaged.",
      }),
      dueOn: addBusinessDays(day1, 5),
      createdById: U.marian.id,
      createdAt: sat(11 * 60 + 50),
    },
  ]);

  /* Announcements and inbox */
  const allIds = PEOPLE.map((p) => U[p.key].id);
  const ann = async (a: { title: string; body: string; audience: typeof s.announcements.$inferInsert.audience; ids: string[]; when: Date; urgent?: boolean; author: string; channels: string[]; read: boolean }) => {
    const [row] = await db
      .insert(s.announcements)
      .values({ orgId: org.id, eventId: current.id, title: a.title, body: a.body, audience: a.audience, channels: a.channels, urgent: Boolean(a.urgent), authorId: U[a.author].id, recipientCount: a.ids.length, createdAt: a.when })
      .returning();
    await db.insert(s.notifications).values(
      a.ids.map((userId) => ({ userId, eventId: current.id, announcementId: row.id, kind: "announcement", title: a.title, body: a.body, href: "/alerts", urgent: Boolean(a.urgent), readAt: a.read ? a.when : null, createdAt: a.when })),
    );
  };
  await ann({
    title: "Welcome to the Fall Driver Education",
    body: "Gates open at 6:30 AM. Tech opens at 7:00 at the tech shed; bring your helmet and have your car numbers on. The drivers meeting is mandatory for everyone who drives. See the schedule for your run group's times.",
    audience: { kind: "all" },
    ids: allIds,
    when: new Date(now.getTime() - 2 * 86400000),
    author: "marian",
    channels: ["inapp", "email"],
    read: true,
  });
  await ann({
    title: "Green drivers: track walk at lunch",
    body: "Meet your instructors at the false grid at 12:15 for a walk of Turns 1 through 4. Wear closed-toe shoes.",
    audience: { kind: "groups", groupIds: [G.green.id] },
    ids: PEOPLE.filter((p) => p.group === "green").map((p) => U[p.key].id),
    when: eventStarted ? sat(9 * 60 + 20) : new Date(now.getTime() - 86400000),
    author: "dale",
    channels: ["inapp", "push"],
    read: false,
  });
  await ann({
    title: "Instructors: debrief cards due by 5:15",
    body: "Please log every session with your student before you leave today, and enter any promotion recommendations so we can review them tonight.",
    audience: { kind: "instructors" },
    ids: PEOPLE.filter((p) => p.instructor).map((p) => U[p.key].id),
    when: eventStarted ? sat(12 * 60 + 5) : new Date(now.getTime() - 3600000),
    author: "dale",
    channels: ["inapp"],
    read: false,
  });
  await ann({
    title: "Oil-dry at Turn 5 exit",
    body: "There is absorbent down on driver's left at the Turn 5 track-out. Expect a debris flag at Station 5 for the next few sessions and stay off the powder.",
    audience: { kind: "all" },
    ids: allIds,
    when: eventStarted ? sat(11 * 60 + 48) : new Date(now.getTime() - 1800000),
    urgent: true,
    author: "tomas",
    channels: ["inapp", "push", "sms"],
    read: false,
  });

  return { orgId: org.id, eventId: current.id };
}
