# Independent review agents

Four Claude agents review the Track Day App, modeled on the framework in the AMS, the CRM and the
Underwriting Desktop. Each has one purpose and works alone.

| Agent | Purpose | Report (under `docs/agent-reports/`) | IDs | Run it |
|---|---|---|---|---|
| `code-auditor` | Bugs and code quality | `code/REPORT.md` | `CR-001` | `scripts/review-run.sh code` |
| `security-reviewer` | Vulnerabilities and insecure configuration | `security/REPORT.md` | `SEC-001` | `scripts/review-run.sh security` |
| `ux-reviewer` | Usability, with before/after mockups | `ux/REPORT.md` | `UX-001` | `scripts/review-run.sh ux` |
| `uat-tester` | Every function end to end, as a user | `uat/REPORT.md` | `UAT-F1` | `scripts/review-run.sh uat` |

The slash commands `/audit`, `/security-audit`, `/ux-audit` and `/uat` run the same thing. A run is
skipped when the code it covers has not changed; add `force` to run anyway. `scripts/review-run.sh all`
runs all four at once, each in its own process. `scripts/review-run.sh <agent> status` says what would
run. It needs a git checkout, Python 3, the Claude Code CLI and, for the UX screenshots and UAT,
Postgres's own tools (`brew install postgresql@16`). Each run reads the whole repository and costs
usage on your Claude plan. `REVIEW_MODEL` overrides the model.

There is no App Tests page in this app yet. The live site runs in demo mode, where any visitor can
sign in as an administrator, so a page showing the security report there would publish it. The
reports are Markdown files in this private repository.

## How independence is enforced

1. **Own snapshot.** `scripts/review-run.sh` copies the files git tracks to `.review/<agent>/`, with only
   that agent's definition and its own previous report. No other agent's report, definition or mockups,
   no ledger and no memory are in it. Everything gitignored stays out: `.env.local`, the local database,
   `.vercel/`, and the source documents (`CERPCA content/`, the product brief). `AGENTS.md` goes in as
   `PROJECT_NOTES.md`, so the agent reads it as notes rather than loading it as instructions.
2. **Own process.** Each run is a fresh `claude -p` started in the snapshot with a scrubbed environment,
   auto-memory off, project settings only, no MCP servers, no session history, and only Read, Grep, Glob
   and Bash. No tool reaches another agent.
3. **A guard on every tool call.** `scripts/review-guard.py` refuses paths outside the snapshot, memory
   and transcripts, other agents' reports, starting another agent, anything that writes, the package
   manager, database tools, deploys, network tools, command substitution, the `security` (Keychain) tool,
   and running code of any kind, including the repository's own scripts. It fails closed.
   `python3 scripts/review-guard-test.py` checks it.
4. **Checks run outside the agent.** The runner runs them before the agent starts and puts their output
   in the snapshot's `checks/` folder: the type-check and the linter (code), `npm audit` (security), and
   a screenshot of every page as an administrator, an instructor and a driver (UX). Only the UAT agent
   runs anything itself, and only its harness, `scripts/uat.sh`.
5. **The operating system.** On a Mac the run is wrapped in `sandbox-exec`, so the agent and anything it
   starts can read only its snapshot and the parts of the home folder its tools need. The repository,
   memory, transcripts, scheduled tasks and other tools' credentials are refused, and nothing in the
   home folder can be written except caches. For the three reading agents the snapshot is read-only too.
   The UAT agent's snapshot is writable, because its harness builds the app and keeps a throwaway
   database there. Two things stay open because the CLI needs them: reading `~/Library/Keychains`, where
   its login is (the guard refuses the `security` tool), and the network (the CLI talks to Anthropic, the
   UAT harness checks the live site, and the profile can't allow a single host). Elsewhere only the guard
   applies, and the run says so.
6. **Results meet only after the agents finish.** The runner saves each final message word for word and
   folds it into `docs/agent-reports/AGENT_LEDGER.json`, which keeps each finding's history across runs.
   No agent can read the ledger or another agent's report.

An agent's only link to the past is its own previous report, so it can keep finding IDs stable. Don't
pass one agent's findings, a session's conclusions or anyone's memory into another agent's definition
or snapshot. The definitions are in this repository, written by the same hand as the code:
independence covers their findings, not their brief.

## The acceptance tests and the live site

`scripts/uat.sh` has three passes. Only the UAT agent runs it during a review, but you can run it
yourself at any time.

- **Sandbox.** A production build of the code on `127.0.0.1`, with its own throwaway Postgres, the demo
  data, demo mode on, the server clock on UTC as on Vercel, and no email, text, push or file service
  connected. The writing flows run here and nowhere else: sign-in, a driver's paperwork, the shop's
  inspection page, instructor debriefs and recommendations, pairing, promotions, the roster, the
  schedule editor, announcements, events, settings, tech review, waivers and incidents.
  Everything is deleted afterwards.
- **Canary.** The read-only suite against the sandbox: the signed-out checks, then every page each role
  can reach. The database is fingerprinted table by table before and after, and any change fails the
  pass. Only `sessions` is left out, because that pass signs in by tapping a sample account.
- **Live site.** `https://cerpca.siryous.app` gets only the signed-out checks. A guard in the test
  browser aborts every request that is not a GET, the API client only has GET, and the script refuses to
  start if a read-only test calls a write method. Signing in adds a row to the database, so nothing
  signed-in ever runs against the live site.

Ports: a sandbox you start yourself uses 3960 (app) and 54360 (Postgres); the UX screenshots use 3970
and 54370; the UAT agent's run uses 3980 and 54380, so the three never collide.

To write or debug tests: `UAT_KEEP=1 scripts/uat.sh sandbox` leaves the sandbox up, and
`uat/dev-sandbox.sh N up` adds further freshly seeded copies of the app beside it.

## Using the reports

Fix items top-down and cite the ID in the commit. Agents mark items resolved when they see the fix. A
person may change a security finding's status to `Accepted`, or a UX finding's to `Declined`, with a
reason. A push to `main` deploys the live site, so review a fix before pushing it.

## Scheduling

These run well as Claude Code scheduled tasks. Make each one a short launcher that runs the script and
reports its last line, and run it once by hand while you're at the computer: a scheduled run has no one
to answer a permission prompt, so an unapproved `Bash` call waits forever and blocks that task's later runs.
