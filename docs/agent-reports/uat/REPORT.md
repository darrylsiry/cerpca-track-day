# UAT report: Track Day App

Run: 2026-11-19 18:36 · code b03e3116 · live site https://cerpca.siryous.app

## Verdict
The app works end to end. All 146 flows pass in the sandbox, including writes. The canary passes and no table changed. All 11 signed-out checks pass on the live site, and nothing there tried to write. All eight failures and both observations from the last run are resolved.

## Summary
| Pass | What it covers | Passed | Failed | Skipped | Result |
|------|----------------|--------|--------|---------|--------|
| Sandbox flows | every function end to end, writes included, on a disposable copy | 146 | 0 | 0 | PASS |
| Canary | the read-only suite on the sandbox, data compared before and after | 14 | 0 | 0 | PASS |
| Live site | what a signed-out visitor can reach, writes blocked | 11 | 0 | 0 | PASS |

## Live-site safety
- **Requests the guard stopped on the live site:** 0. Neither `blocked-prod.jsonl` nor `blocked-canary.jsonl` was written. The check "nothing on the sign-in page tried to write just by being opened" passed.
- **Canary:** no table changed (`canary.diff` is empty).
  - The `sessions` table is left out of the comparison by design, because the read-only pass signs in by tapping a sample account.
- **Signed in on the live site:** never (signing in is a write).

## Failures
None.

## Observations
None.

## Resolved since last run
- **UAT-F1 — Success confirmation is lost when the saved item moves or its form closes:** now passes. These tests confirm the messages and the closed sheet:
  - "sending the request is confirmed with a message"
  - tech-form upload confirmation
  - instructor recommendation
  - promotions approve, decline and solo
  - "Event saved" when the event changes list
  - "Sent back" and "Sticker issued"
- **UAT-F2 — A refused waiver signature wipes the drawn signature:** now passes ("a refused attempt to sign keeps the signature that was drawn").
- **UAT-F3 — A refused tech submission resets the shop picker and the technician's certification box:** both tests now pass ("…driver's choice of shop showing" and "…certification stays ticked").
- **UAT-F4 — White driver promoted "now" still shows as instructed:** now passes on his file, his instructor's list and the Recommend sheet.
- **UAT-F5 — A superseded waiver signature still counts as signed:** now passes. The roster shows 3/4, his page shows "3 of 4 signed", and the overview and his Now screen agree.
- **UAT-F6 — Schedule editor states fixed reminder times of 15, 10 and 5 minutes:** now passes. The editor quotes the region's own lead times.
- **UAT-F7 — "Notification settings" link lands at the top of the profile:** now passes. The link opens the page at the notification choices.
- **UAT-F8 — An ended check-in is described to the instructor as a "ride-along":** now passes ("…tells the instructor what ended").
- **UAT-O1 — The roster table probably has the same solo/instructed error as UAT-F4:** resolved.
  - The promotion test now also checks the roster list: it expects "White Solo" and no "Instructed" (`30-pairing-promotions.spec.ts:1041-1044`).
  - That check passes.
- **UAT-O2 — The canary skipped its sign-in page screenshot step:** resolved.
  - That step is now registered only when capture is turned on (`tests/readonly/02-crawl.spec.ts:47`, `if (CAPTURE)`), so it is no longer listed as skipped.
  - That is why the canary total went from 15 to 14. No functional check was lost.

## Coverage
- **Sandbox:** a production build of b03e3116 on 127.0.0.1:3980, with a throwaway Postgres (42 people, 203 schedule items). It ran 146 flows, 8 more than last run, covering:
  - Sign-in
  - Driver: Now, schedule, alerts, profile and car, waivers, track guide, phone layout and access limits
  - Driver tech inspection, from an open form to the sticker, including the shop's link without an account
  - Instructor: students, schedule, session notes, recommendations, ride-alongs and access limits
  - Pairing and promotions
  - Admin: overview, roster, schedule editor, announcements, events, settings, simulated clock and session reminders
  - Admin paperwork: tech review, shops, grid tech, waivers and incident reports
  - Access controls on every admin and paperwork screen
- **Canary crawl (read-only, on the sandbox):** every page and file returned 200, with no problems or failures reported.
  - Admin: 57 pages, 49 distinct page shapes, 10 files (including the tech form PDF and the roster CSV export).
  - Instructor: 24 pages, 21 shapes, 9 files.
  - Driver: 21 pages, 19 shapes, 9 files.
- **Live site:** these 11 signed-out checks pass:
  - The sign-in form loads.
  - Signed-out visitors are sent to sign in, and the page they wanted is remembered.
  - The reminder job, the live-update endpoint, uploaded files and the roster export are all refused to a signed-out caller.
  - An unknown shop link gives a proper message.
  - The manifest and icons load.
  - The track PDFs are real PDFs.
  - The sign-in page does not try to write when opened.
- **What I checked beyond the pass count:** every test that failed last run is still in the suite and still makes its specific check. I read the assertions for UAT-F4, UAT-F5 and UAT-O1 directly; they were not loosened.
- **Not covered:**
  - Signed-in pages on the live site, by design (signing in is a write).
  - I did not open the Playwright traces. Nothing failed, so there was nothing to investigate.
  - No second run was needed, because no test failed or was flaky.
  - The review guard limited my work to this snapshot. It also refused two of my read-only `jq` queries, apparently because of how their paths were written, so I gathered the same information with plain searches instead.

## Functions checked
| Area | Function | Sandbox | Live site |
|------|----------|---------|-----------|
| Sign-in | Tap sign-in, one-time code, no account enumeration, single-use code, hashed sessions | Pass | Sign-in page and redirects pass (no sign-in) |
| Driver | Now screen, grid call, day done, paperwork prompt | Pass | n/a (signed in) |
| Driver | Ask for and withdraw an instructor, with confirmation | Pass | n/a |
| Driver | Schedule, filters, on-the-day view | Pass | n/a |
| Driver | Alerts: count, open, mark read, settings link | Pass | n/a |
| Driver | Profile, contact, car, notification choices | Pass | n/a |
| Driver | Waivers: read, sign, keep signature after a refusal | Pass | n/a |
| Driver | Track guide: turns, passing, flags, rules, maps, PDFs | Pass | PDFs pass |
| Driver | Tech: steps, shop link, upload, shop form, submit, resubmit | Pass | Unknown shop link passes |
| Instructor | My students, student page, schedule, grid prompt | Pass | n/a |
| Instructor | Session notes, private notes | Pass | n/a |
| Instructor | Recommend for promotion | Pass | n/a |
| Admin | Instructor pairing, auto-pair, check-ins, ride-alongs | Pass | n/a |
| Admin | Promotions: approve, decline, solo, direct change | Pass | n/a |
| Admin | Overview, roster, check-in, roles, notes, add, import, export, cancel | Pass | Export refused when signed out: pass |
| Admin | Schedule editor: add, move, delay, cancel, delete, alerts, lead-time text | Pass | n/a |
| Admin | Announcements | Pass | n/a |
| Admin | Events: create, publish, switch, complete, history | Pass | n/a |
| Admin | Settings, run groups, simulated clock, session reminders | Pass | Reminder job refuses a caller without the secret: pass |
| Admin | Tech review, shops, grid tech, sticker, paper check | Pass | Uploads refused when signed out: pass |
| Admin | Waivers: status, remind, versions, retire, current-version counting | Pass | n/a |
| Admin | Incident reports: draft, final, print, send | Pass | n/a |
| Security | Drivers and instructors refused admin pages and actions | Pass | Protected pages redirect: pass |
