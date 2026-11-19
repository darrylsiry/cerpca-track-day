import type { RunGroup } from "@/db/schema";

/*
 * Roster import.
 *
 * ClubRegistration.net has no documented API, so the bridge is the file an event
 * administrator exports from its Report Builder. That export is reported to be an
 * ".xls" that is really an HTML table; plain CSV works too. Column names vary by
 * report, so headers are matched loosely against the synonyms below and the
 * administrator sees exactly what was recognised before anything is written.
 */

export type ImportRow = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  pcaMemberNumber: string | null;
  tshirtSize: string | null;
  groupId: string | null;
  groupLabel: string;
  /** True when the export's group label says so ("Blue Solo"). */
  solo: boolean;
  carNumber: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  color: string | null;
  isInstructor: boolean;
  status: string;
  externalId: string | null;
};

export type ImportPreview = {
  format: "csv" | "html";
  rows: ImportRow[];
  /** field → the header it was read from */
  mapping: Record<string, string>;
  unmapped: string[];
  problems: string[];
};

const FIELDS: Record<string, string[]> = {
  firstName: ["firstname", "first", "fname", "givenname"],
  lastName: ["lastname", "last", "lname", "surname", "familyname"],
  name: [
    "name",
    "fullname",
    "driver",
    "drivername",
    "participant",
    "registrant",
  ],
  email: ["email", "emailaddress", "e-mail"],
  phone: [
    "phone",
    "mobile",
    "cell",
    "cellphone",
    "mobilephone",
    "telephone",
    "phonenumber",
  ],
  address1: ["address", "address1", "street", "streetaddress"],
  city: ["city", "town"],
  state: ["state", "province", "stateprovince"],
  zip: ["zip", "zipcode", "postalcode", "postal"],
  emergencyName: ["emergencycontact", "emergencycontactname", "emergencyname"],
  emergencyPhone: [
    "emergencyphone",
    "emergencycontactphone",
    "emergencynumber",
  ],
  pcaMemberNumber: [
    "pcamembernumber",
    "membernumber",
    "memberid",
    "pcanumber",
    "member",
    "pcamember",
  ],
  tshirtSize: ["tshirt", "tshirtsize", "shirt", "shirtsize"],
  group: ["rungroup", "group", "class", "drivergroup", "rungroupname", "level"],
  carNumber: [
    "number",
    "carnumber",
    "car",
    "carno",
    "racenumber",
    "vehiclenumber",
  ],
  vehicle: ["yearmakemodelcolor", "vehicle", "yearmakemodel", "cardescription"],
  year: ["year", "caryear", "vehicleyear"],
  make: ["make", "carmake", "vehiclemake"],
  model: ["model", "carmodel", "vehiclemodel"],
  color: ["color", "carcolor", "colour", "vehiclecolor"],
  instructor: ["instructor", "isinstructor"],
  status: ["status", "registrationstatus"],
  externalId: ["registrationid", "regid", "id", "registrationnumber"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const delimiter =
    text.split("\n")[0].includes("\t") && !text.split("\n")[0].includes(",")
      ? "\t"
      : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const decode = (v: string) =>
  v
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function parseHtmlTable(text: string): string[][] {
  const rows: string[][] = [];
  for (const tr of text.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(decode);
    if (cells.some(Boolean)) rows.push(cells);
  }
  return rows;
}

const clean = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

export function parseRosterFile(
  text: string,
  groups: RunGroup[],
): ImportPreview {
  const isHtml = /<table[\s>]/i.test(text);
  const table = isHtml
    ? parseHtmlTable(text)
    : parseCsv(text.replace(/^﻿/, ""));
  const problems: string[] = [];
  if (table.length < 2) {
    return {
      format: isHtml ? "html" : "csv",
      rows: [],
      mapping: {},
      unmapped: [],
      problems: [
        "The file has no data rows. Export the registrant report with a header row.",
      ],
    };
  }

  // The header is the first row that names an email or a name column.
  const headerIndex = table.findIndex((r) =>
    r.some((c) =>
      ["email", "emailaddress", "lastname", "name"].includes(norm(c)),
    ),
  );
  if (headerIndex === -1) {
    return {
      format: isHtml ? "html" : "csv",
      rows: [],
      mapping: {},
      unmapped: [],
      problems: [
        "No header row was recognised. The file needs at least a name and an email column.",
      ],
    };
  }
  const headers = table[headerIndex];
  const col: Record<string, number> = {};
  const mapping: Record<string, string> = {};
  headers.forEach((h, i) => {
    const key = norm(h);
    for (const [field, names] of Object.entries(FIELDS)) {
      if (col[field] === undefined && names.includes(key)) {
        col[field] = i;
        mapping[field] = h;
      }
    }
  });
  const used = new Set(Object.values(col));
  const unmapped = headers.filter((h, i) => h && !used.has(i));
  if (col.email === undefined)
    problems.push(
      "No email column was found. Email is how people sign in, so rows without one are skipped.",
    );
  if (col.group === undefined)
    problems.push(
      "No run group column was found. Add the run group to the report and export again.",
    );

  const matchGroup = (label: string): RunGroup | null => {
    const l = label.toLowerCase();
    if (!l) return null;
    return (
      groups.find(
        (g) => l.includes(g.key) || l.includes(g.name.toLowerCase()),
      ) ??
      (l.includes("instructor")
        ? (groups.find((g) => g.isInstructorGroup) ?? null)
        : null)
    );
  };

  const rows: ImportRow[] = [];
  let unknownGroups = 0;
  let noEmail = 0;
  for (const r of table.slice(headerIndex + 1)) {
    const get = (f: string) =>
      col[f] === undefined ? "" : (r[col[f]] ?? "").trim();
    let first = get("firstName");
    let last = get("lastName");
    if ((!first || !last) && get("name")) {
      const full = get("name");
      if (full.includes(","))
        [last, first] = full.split(",").map((x) => x.trim());
      else {
        const parts = full.split(/\s+/);
        last = parts.pop() ?? "";
        first = parts.join(" ");
      }
    }
    if (!first && !last) continue;
    let year: number | null = Number(get("year")) || null;
    let make = clean(get("make"));
    let model = clean(get("model"));
    let color = clean(get("color"));
    if (get("vehicle")) {
      // "2019, Porsche, 911 GT3, Guards Red"
      const parts = get("vehicle")
        .split(",")
        .map((x) => x.trim());
      if (parts.length >= 3) {
        year = Number(parts[0]) || year;
        make = parts[1] || make;
        model = parts[2] || model;
        color = parts[3] || color;
      } else {
        const m = /^(\d{4})\s+(\S+)\s+(.+)$/.exec(get("vehicle"));
        if (m) {
          year = Number(m[1]);
          make = m[2];
          model = m[3];
        }
      }
    }
    const groupLabel = get("group");
    const group = matchGroup(groupLabel);
    if (!group) unknownGroups += 1;
    const email = get("email").toLowerCase();
    if (!email) noEmail += 1;
    const rawStatus = get("status").toLowerCase();
    const status = rawStatus.includes("cancel")
      ? "cancelled"
      : rawStatus.includes("wait")
        ? "waitlist"
        : rawStatus.includes("pend")
          ? "pending"
          : "confirmed";
    rows.push({
      firstName: first,
      lastName: last,
      email,
      phone: clean(get("phone")),
      address1: clean(get("address1")),
      city: clean(get("city")),
      state: clean(get("state")),
      zip: clean(get("zip")),
      emergencyName: clean(get("emergencyName")),
      emergencyPhone: clean(get("emergencyPhone")),
      pcaMemberNumber: clean(get("pcaMemberNumber")),
      tshirtSize: clean(get("tshirtSize")),
      groupId: group?.id ?? null,
      groupLabel,
      solo: /\bsolo\b/i.test(groupLabel),
      carNumber: clean(get("carNumber")),
      year,
      make,
      model,
      color,
      isInstructor:
        /^(y|yes|true|1|x)$/i.test(get("instructor")) ||
        Boolean(group?.isInstructorGroup),
      status,
      externalId: clean(get("externalId")),
    });
  }
  if (noEmail)
    problems.push(
      `${noEmail} row${noEmail === 1 ? " has" : "s have"} no email address and will be skipped.`,
    );
  if (unknownGroups && col.group !== undefined)
    problems.push(
      `${unknownGroups} row${unknownGroups === 1 ? " has" : "s have"} a run group that was not recognised and will be skipped.`,
    );
  return { format: isHtml ? "html" : "csv", rows, mapping, unmapped, problems };
}
