# Track Day

Runs a PCA driver education (HPDE) weekend: the live schedule, run groups, tech inspection, waivers, instructor notes and promotions, announcements, and PCA incident reports. Built first for the Coastal Empire Region (CERPCA) at Roebling Road Raceway, and structured so other regions and tracks can be added.

The product brief is `Track Day App Initial Product Brief.docx`; the source documents the track guide was built from are in `CERPCA content/`.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 (or the port the terminal prints). There is nothing else to set up: with no `DATABASE_URL`, the app uses PGlite (real Postgres compiled to WebAssembly) stored in `./.data/pglite`, and creates and seeds itself on first start.

The seed is a demo CERPCA event that is always "this weekend", with 42 fictional people. The sign-in screen lists sample accounts (administrator, tech chief, instructor, Green, Blue and White drivers). Because `DEMO_MODE=1` in `.env.local`, a strip at the top lets you move the app's clock to any moment of the weekend, so you can see the live board at 9:58 on Saturday whatever the real time is.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app. In development a timer also sends session reminders once a minute. |
| `npm run build` / `npm start` | Production build and server. |
| `npm run typecheck` / `npm run lint` | Type and lint checks. |
| `npm run db:reset` | Delete the local database. Stop the dev server first; it is rebuilt on next start. |
| `npm run db:generate` | After editing `src/db/schema.ts`, write a new SQL migration into `drizzle/`. |
| `npm run db:migrate` | Apply migrations to the hosted database in `DATABASE_URL`. |
| `npm run db:seed` | Load the demo data into an empty database. |

PGlite allows one process at a time. Do not run the `db:*` scripts while the dev server is running against the local database.

## What is in it

**Everyone**
- **Now**: who has the track, time left in the session, who is next, and your own next session with a countdown. It turns into a "head to the grid" call 15 minutes out. Unread urgent alerts sit at the top until you tap "Got it"; a cancelled session is shown as cancelled, and a moved one says what time it moved from.
- **Schedule**: both days, everyone's sessions with yours marked, live "now" marker, filters by run group and classroom.
- **Track guide**: interactive circuit map, turn-by-turn student line (pick one turn to study), passing zones per run group, flags, track rules, facility maps, documents.
- **Alerts**: announcements and reminders; optional push, text and email.
- **Before you drive**: sign waivers, complete the tech inspection, see your tech sticker. "Cleared to drive" means the same thing on every screen: every required waiver signed at its current version, the tech form approved, and a sticker on the car (`src/lib/clearance.ts`).
- **Instructor ride-along**: a solo driver (White, Black, Blue Solo) can ask for an instructor to ride along.

**Instructors**
- Assigned students with car, experience and next session.
- Log each session with notes the student sees, plus a private note only administrators see.
- Recommend a promotion or solo sign-off, with a written rationale.

**Administrators**
- Roster with search, filters, check-in, add and edit, import from a ClubRegistration.net export, CSV export. Importing again keeps a run group that was changed in the app, and says so in the preview.
- Driver file: contact, car, admin-only notes, session notes, promotion history, event history, roles.
- Schedule editor: add, edit, cancel (alerts the people in the session), delay or advance the rest of the day, copy from another event. Moving a session to another run group alerts the group that lost it too. A slot can be for one run group, several, or one half of Blue ("Blue Solo and White", "Green and Blue Instructed").
- Instructor pairing, with automatic suggestions and clash warnings. A clash is worked out from the schedule, so a combined session ("Green and Blue") counts and the warning names the session; automatic pairing never creates one. Solo drivers join the list when they ask for a ride-along or an administrator adds a check-in. When an instructor leaves the event or stops instructing, their students are unpaired again and told.
- Tech inspection: review queue with automatic flags, request changes, grid tech and sticker issue, shop registry.
- Waivers: who has signed what, reminders, document templates.
- Promotions: sign off or decline recommendations; every decision is kept.
- Announcements to everyone, run groups, instructors or students, and a delivery log limited to the administrator's own region. Sign-in codes are never kept in it.
- Incident reports in the PCA form's layout, with due dates, a sketch pad and a print view.
- Events and history: every event keeps its own records; open a past event to see them.

## How it is built

- **Next.js 16** (App Router, React 19, Server Components and Server Actions) with Cache Components on. Every screen behind sign-in is rendered at request time and streamed; `screen()` in `src/components/shell/skeleton.tsx` is the wrapper each page uses.
- **Postgres** through **Drizzle ORM**. One schema (`src/db/schema.ts`), two drivers: PGlite locally, `pg` against a hosted database in production.
- **Tailwind CSS 4**. Design tokens and the few custom utilities are in `src/app/globals.css`; shared components are in `src/components/`.
- **Sign-in** by one-time email code. Sessions are rows in the database, referenced by an HTTP-only cookie (`src/server/auth.ts`). There are no passwords. A code allows five guesses, an address ten guesses an hour and five codes a quarter hour, each counted in a single statement (`src/server/rate-limit.ts`).
- **Live updates** by polling: open apps ask `/api/live` every 20 seconds and re-render when the schedule, announcements or inbox changed.
- **Reminders**: `src/server/reminders.ts`, run every minute by Vercel Cron (`vercel.json`) or the development timer (`src/instrumentation.ts`).
- **Notifications**: `src/server/notify.ts` sends in-app alerts always, and email (Resend), text (Twilio) and web push when their keys are present. Without keys, sends are recorded as "simulated" in the delivery log.

```
src/
  app/(app)/        screens behind sign-in: home, schedule, track, alerts, me, instructor, admin
  app/login/        sign-in
  app/tech/[token]/ the public page a shop uses to sign an inspection
  app/api/          live fingerprint, cron, push subscription, uploaded files
  components/       design system and shared UI
  content/          Roebling Road guide (seeded into the track record)
  db/               schema, connection, seed
  lib/              shared logic and types (time, schedule, tech form)
  server/           auth, queries, notifications, reminders, imports
drizzle/            SQL migrations
public/tracks/      track images and documents
```

### Other regions and tracks

Nothing in the app code is specific to CERPCA or Roebling Road. Regions are rows in `organizations` (run groups, settings and members hang off them). Each run group carries its own instructor rule (always instructed, instructed until solo, or solo by default), so another region's ladder is a matter of settings. Tracks are rows in `tracks`, and each carries its whole guide (map shape, turns, flags, rules, passing zones, documents) as data. Adding a venue means adding a track record with its guide and putting its images under `public/tracks/<slug>/`.

## Deploying to Vercel

The app is a good fit for Vercel. It needs these pieces around it:

1. **Database**: add Neon Postgres from the Vercel Marketplace (or any Postgres) and set `DATABASE_URL`. Run `npm run db:migrate` against it, and `npm run db:seed` if you want the demo data.
2. **Cron**: `vercel.json` schedules `/api/cron/reminders` every minute, which requires the Pro plan (Hobby allows one run per day). Set `CRON_SECRET`.
3. **File storage**: add Vercel Blob and set `BLOB_READ_WRITE_TOKEN` so drivers can upload photos of paper tech forms.
4. **Messaging**: set the Resend, Twilio and VAPID variables below to turn on real email, texts and push.
5. Leave `DEMO_MODE` unset.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Hosted Postgres. Unset means local PGlite. |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/api/cron/*`. |
| `APP_URL` | Public address, used in links emailed to shops. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | Text messages. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push. Generate with `npx web-push generate-vapid-keys`. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob for uploads. |
| `DEMO_MODE` | `1` shows sample accounts and the simulated clock. Development and demos only. |

### The live demo

The app is deployed at https://cerpca.siryous.app as the Vercel project `cerpca-track-day`.

- **Demo mode is on.** Anyone with the link can sign in as any sample person, including an administrator, and change the demo data. Email and texts are not connected, so nothing is sent. Before real people or real data go in, connect email, remove `DEMO_MODE` and redeploy.
- **Database**: Neon Postgres (free plan, US East), added through the Vercel Marketplace and loaded with the demo data.
- **Uploads**: the Vercel Blob store `cerpca-track-day-uploads`.
- **Publishing a change**: push to the `main` branch of the private GitHub repository `cerpca-track-day`; Vercel builds and deploys it. Other branches get preview deployments, which have no database or settings configured, so they will not run until those are added for the Preview environment.
- **Source documents**: `CERPCA content/` and the product brief are git-ignored and stay on this machine. The copies the Track guide serves live in `public/tracks/`.
- **Schema changes**: run `npm run db:migrate` with `DATABASE_URL` set to the Neon connection string before deploying. Local development never touches the live database.
- **Reminder job**: Neon's free plan puts the database to sleep after five idle minutes and allows 100 compute-hours a month, which a query every minute would use up. When no event is running that day, the job leaves the database alone for 30 minutes at a time (`src/app/api/cron/reminders/route.ts`).

## Review agents and acceptance tests

Four independent Claude agents review this app: code quality, security, UX and user acceptance. `scripts/review-run.sh all` runs them, each alone in its own sandboxed copy of the code, and their reports land in `docs/agent-reports/`. `scripts/uat.sh` runs the acceptance tests on their own: every function on a throwaway local copy, and signed-out, read-only checks on the live site. `docs/REVIEW_AGENTS.md` explains how they work and what keeps them independent and the live site safe.

## Before using it for a real event

- The three waiver documents contain **placeholder wording**. Replace them under Waivers, and confirm with PCA national that electronically collected signatures satisfy the event insurance requirements.
- The run groups follow `CERPCA content/CERPCA Run Groups.docx`: Green always instructed, Blue split into Instructed and Solo, White and Black solo with an instructor on request, Red instructors. Review them under Settings. Black and Red have no passing-zone sheet on file.
- The incident report recipients are the national roles from the 2017 PCA guidelines. Confirm the current list and your zone representative under Settings. The app never emails a report itself.
- Everyone in the seed data is fictional. Start from an empty database (skip `db:seed`), or remove the demo people.
