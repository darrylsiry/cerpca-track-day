// Fold the review agents' reports into docs/agent-reports/AGENT_LEDGER.json, so history survives each
// report being overwritten. scripts/review-run.sh runs this after every run. Idempotent.
//   npx tsx scripts/agent-ledger.ts [--check]      --check prints the totals and writes nothing.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { foldReport, readLedger } from "./review/agent-ledger";
import { AGENTS, parseReport } from "./review/agent-reports";

const check = process.argv.includes("--check");
const dir = path.resolve(process.cwd(), "docs/agent-reports");
const ledgerPath = path.join(dir, "AGENT_LEDGER.json");
const timeZone = process.env.DISPLAY_TZ || "America/New_York";

const stored = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : null;
const ledger = readLedger(stored);
for (const a of AGENTS) {
  const file = path.join(dir, a.file);
  if (!existsSync(file)) continue;
  const r = parseReport(a.key, readFileSync(file, "utf8"), timeZone);
  foldReport(ledger, r, r.runAt ?? statSync(file).mtime.toISOString());
}

const order = (k: string) => AGENTS.findIndex((a) => a.key === k);
const num = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
const items = Object.values(ledger.items).sort((a, b) => order(a.agent) - order(b.agent) || num(a.id) - num(b.id) || a.key.localeCompare(b.key));
const body = (updatedAt: string | null) => JSON.stringify({ ...ledger, updatedAt, items: Object.fromEntries(items.map((i) => [i.key, i])) }, null, 2) + "\n";
const changed = !stored || body(null) !== JSON.stringify({ ...readLedger(stored), updatedAt: null }, null, 2) + "\n";
const count = (s: string) => items.filter((i) => i.status === s).length;
const summary = `${items.length} findings (${count("open")} open, ${count("resolved")} resolved) across ${ledger.runs.length} runs`;
if (!check && changed && existsSync(dir)) writeFileSync(ledgerPath, body(new Date().toISOString()));
console.log(`agent ledger: ${summary}${changed ? (check ? " (would update)" : " (updated)") : " (no change)"}`);
