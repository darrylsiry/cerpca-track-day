# UAT report: Track Day App

Run: 2026-11-16 14:59 · code 96aa2b84 · live site https://cerpca.siryous.app

## Verdict
The live site works for signed-out visitors (11/11 checks pass) and nothing tried to write to it. The code about to ship does **not** pass end to end: 16 of 138 sandbox flows fail, and all 16 are app defects. Every main function does its job. The failures are about what users are told and shown: confirmations go missing after nine kinds of save, a promoted White driver is still shown as "instructed", a superseded waiver signature is still counted as signed, a signature or a ticked box disappears when a form is refused, and a few labels are wrong.

## Summary
| Pass | What it covers | Passed | Failed | Skipped | Result |
|------|----------------|--------|--------|---------|--------|
| Sandbox flows | every function end to end, writes included, on a disposable copy | 122 | 16 | 0 | FAIL |
| Canary | the read-only suite on the sandbox, data compared before and after | 14 | 0 | 1 | PASS |
| Live site | what a signed-out visitor can reach, writes blocked | 11 | 0 | 0 | PASS |

## Live-site safety
- Requests stopped by the guard on the live site: 0. No `blocked-prod.jsonl` or `blocked-canary.jsonl` was written. The live-site check "nothing on the sign-in page tried to write just by being opened" passed.
- Canary: no table changed (`canary.diff` is empty). The `sessions` table is left out of the comparison by design, because the read-only pass signs in by tapping a sample account.
- Signed in on the live site: never (signing in is a write).

## Failures

### UAT-F1 Success confirmation is lost when the saved item moves or its form closes (App defect)
- **Where:** One shared form helper, which shows up in 9 places:
  - Ask for an instructor (driver)
  - Upload the paper tech form (driver)
  - Recommend for promotion (instructor)
  - Approve, decline, and approve a solo sign-off on the promotions page (admin)
  - Event saved, when the event moves between the upcoming and past lists (admin)
  - "Sent back to the driver" on the tech review (admin)
  - "Sticker … issued" on grid tech (admin)
- **What a user sees:** The save works, but no "Request sent", "Recommendation sent for sign-off", "Approved and recorded", "Declined and recorded", "Event saved", "Sent back to the driver" or "Sticker F26-… issued" message appears.
  - When a solo sign-off is approved, the warning "They are still paired with an instructor: end it under Instructor pairing…" is lost too. That message is the only prompt telling the administrator to end the pairing.
  - The instructor's Recommend sheet does not close after sending. It switches in place to "A recommendation is already waiting for sign-off".
- **Evidence:**
  - Failed tests:
    - 10-driver.spec.ts:267
    - 12-driver-tech.spec.ts:395
    - 20-instructor.spec.ts:506–507 (the dialog is still on screen: count 1, expected 0)
    - 30-pairing-promotions.spec.ts:733, 805, 856
    - 40-admin-event.spec.ts:1610, 1617
    - 50-admin-paperwork.spec.ts:629, 635
  - Screenshots, all under `uat/.work/artifacts-sandbox/`:
    - `10-driver-instructor-ride--01f62-is-confirmed-with-a-message/test-failed-1.png`
    - `20-instructor-instructor-r-cbcf8-nistrators-with-her-reasons/test-failed-1.png`
    - `30-pairing-promotions-prom-58809-tells-driver-and-instructor/test-failed-1.png`
    - `40-admin-event-events-and--a300b-the-upcoming-and-past-lists/test-failed-1.png`
    - `50-admin-paperwork-tech-in-4fd5d-ch-confirmed-with-a-message/test-failed-1.png`
- **Likely cause:** `src/components/form.tsx:58-67`. `ActionForm` (and `GridForm` in `admin/tech/grid/grid-client.tsx:140-144`) only shows the toast and closes the sheet in a `useEffect` that runs after the action's result reaches state.
  - The server action revalidates the page (for example `refresh()` in `admin/promotions/actions.ts:141`).
  - The re-render removes the form before that effect can run: the waiting row leaves the list, the event moves list, the "Ask" sheet becomes "Withdraw", `pending` swaps the form for a Notice (`instructor/forms.tsx:219-232`), and grid tech shows "Cleared".
  - So the toast and `closeSheet()` never fire.
- **Suggested fix:** Show the toast and close the sheet right after `await action(...)` resolves, in the submit handler, the way `ActionButton` already does at `form.tsx:160-167`. Do not wait for an effect on a component that may have unmounted. Apply the same change to `GridForm`.

### UAT-F2 A refused waiver signature wipes the drawn signature (App defect)
- **Where:** Driver › Waivers › sign a document (`/me/waivers/:id`)
- **What a user sees:** The driver types only a first name, draws a signature and taps Sign, and is told to type her full legal name. She fixes the name and taps Sign again. Now she is told "Draw your signature in the box.", although her signature is still drawn on screen.
- **Evidence:**
  - `10-driver.spec.ts:687`: expected not "Draw your signature in the box.", got exactly that.
  - Screenshot: `uat/.work/artifacts-sandbox/10-driver-waivers-a-refuse-307c9-he-signature-that-was-drawn/test-failed-1.png`
- **Likely cause:** `src/components/signature-pad.tsx:128`. The hidden input has `defaultValue=""`, and the drawing is written to it by assigning `.value` (`:55`).
  - On a hidden input, `value` and `defaultValue` are the same attribute.
  - The error from the first attempt calls `setError` in `me/waivers/sign-form.tsx:29`, which re-renders the pad, and React writes `""` back as the default. That erases the stored signature while the canvas still shows it.
- **Suggested fix:** Keep the data URL in React state and render `<input type="hidden" name={name} value={dataUrl} readOnly />`, or drop `defaultValue` from the hidden input.

### UAT-F3 A refused tech submission resets the shop picker and the technician's certification box (App defect)
- **Where:**
  - Driver › Tech inspection › "Send it to my shop" (`/me/tech`)
  - Shop's tech form (`/tech/:token`)
- **What a user sees:**
  - **Driver:** she picks "Another shop…", enters her own email, and is refused. Her typed shop name stays, but the picker jumps to "Bluffton European Auto (Bluffton, SC)", a shop she did not choose. If she corrects the email and sends, the link may go to the wrong shop.
  - **Technician:** after a refused submit (a tire date code in the future), the "certify" box is unticked even though they ticked it.
- **Evidence:**
  - `12-driver-tech.spec.ts:443`: expected "Another shop…", got "Bluffton European Auto (Bluffton, SC)".
  - `12-driver-tech.spec.ts:494`: checkbox is unchecked.
  - Screenshots:
    - `uat/.work/artifacts-sandbox/12-driver-tech-tech-inspec-b7d66-er-s-choice-of-shop-showing/test-failed-1.png`
    - `uat/.work/artifacts-sandbox/12-driver-tech-tech-inspec-99238--certification-stays-ticked/test-failed-1.png`
- **Likely cause:** Both forms use React 19's `<form action={…}>`: `src/app/(app)/me/tech/steps.tsx:228` and `:288`, and `src/app/tech/[token]/shop-form.tsx:95`.
  - React calls `form.reset()` after the action finishes, even when it failed.
  - The controlled text inputs are restored, but the controlled `<select>` (`steps.tsx:147`) and checkbox (`shop-form.tsx:218`) are left at their DOM defaults. React state still holds the user's choice, so screen and state disagree.
  - `ActionForm` already avoids this; see the comment at `form.tsx:74-76`.
- **Suggested fix:** Submit these three forms by hand: `onSubmit`, then `preventDefault`, then `startTransition(() => dispatch(new FormData(form)))`, as `ActionForm` does. Or use `ActionForm` itself.

### UAT-F4 White driver promoted "now" still shows as instructed on his file and his instructor's list (App defect)
- **Where:** Admin › Roster › driver page (`/admin/roster/:id`); Instructor › My students (`/instructor`, `/instructor/:id`)
- **What a user sees:** The administrator moves Theo from Blue to White, effective now.
  - These screens correctly say he is now solo: his own Now and Profile screens, his schedule, and the pairing page ("Solo now").
  - These screens still say instructed:
    - His file shows "Run group White · instructed".
    - Gus's list shows "Instructed".
    - Gus's Recommend sheet still offers "Sign off to drive solo", a sign-off White has no use for.
- **Evidence:**
  - `30-pairing-promotions.spec.ts:1039, 1044, 1045, 1049`
  - Screenshots: `uat/.work/artifacts-sandbox/30-pairing-promotions-prom-7ffde-solo-driver-on-every-screen/test-failed-1.png` (and `-2`, `-3`)
- **Likely cause:**
  - `admin/roster/[userId]/page.tsx:489-493`, `instructor/page.tsx:164` and `:201`, and `instructor/[studentId]/page.tsx:107` and `:131` all read the raw `registration.solo` flag.
  - A group promotion only changes `runGroupId` (`admin/promotions/actions.ts:41-45`), so `solo` stays false.
  - The screens that are right use `instructorNeed(policy, reg)` (`src/lib/instruction.ts:12`), which treats a group without an instructor rule as solo.
- **Suggested fix:**
  - Work out "solo" in one place: `instructorNeed(group.instructorPolicy, reg)` is not `"instructed"` or `"required"`.
  - Use it on these pages.
  - Set `canSolo` only when the group's policy is `"optional"`.

### UAT-F5 A superseded waiver signature still counts as signed on the roster, overview and the driver's Now screen (App defect)
- **Where:** Admin › Roster (list and person page), Admin › Overview "Waivers signed", Driver › Now/Profile paperwork line
- **What a user sees:** After a document moves to version 2:
  - The Waivers screen correctly says Hank "Signed an earlier version", 3 of 4.
  - The roster still says 4/4, his page says "4 of 4 signed", the overview counts him as complete (1/42 instead of 0/42), and his own Now screen says "All 4 signed".
  - A driver can therefore look cleared for the track when he is not.
- **Evidence:**
  - `50-admin-paperwork.spec.ts:993, 995, 997, 999` (expected 3/4 and 0/42; got 4/4 and 1/42)
  - Screenshot: `uat/.work/artifacts-sandbox/50-admin-paperwork-waivers-4560a-the-driver-s-own-Now-screen/test-failed-1.png`
- **Likely cause:**
  - `src/server/queries.ts:130`: `signedIds` uses any signature, whatever its `version`.
  - `src/server/admin.ts:86-90`: `signedBy` adds the template id without comparing versions.
  - The correct check already exists as `isCurrent()` in `src/server/waivers.ts:32`.
- **Suggested fix:** In both places, count a signature only if `isCurrent(template, sig)` is true. The template's `version` will have to be loaded alongside.

### UAT-F6 Schedule editor states fixed reminder times of 15, 10 and 5 minutes (App defect)
- **Where:** Admin › Schedule editor (`/admin/schedule`)
- **What a user sees:** With the region's reminders set to 20 and 8 minutes, the editor header still says "Reminders go out 15, 10 and 5 minutes before each session".
- **Evidence:**
  - `40-admin-event.spec.ts:1887`
  - Error context: `uat/.work/artifacts-sandbox/40-admin-event-settings-th-9e2c0-mes-not-a-fixed-15-10-and-5/error-context.md`
- **Likely cause:** `src/app/(app)/admin/schedule/page.tsx:68` hard-codes the `lede` string.
- **Suggested fix:** Build the sentence from the region's `reminderOffsets` setting, the same source the settings page uses (that test, 40-admin-event:1845, passes).

### UAT-F7 "Notification settings" link lands at the top of the profile, not at the notification choices (App defect)
- **Where:** Alerts › "Notification settings" link, which goes to `/me#notifications`
- **What a user sees:** The address is right, but the page opens at the top of a long profile. The "How we reach you" section is off screen.
- **Evidence:**
  - `10-driver.spec.ts:456`: `toBeInViewport` gives viewport ratio 0.
  - Screenshot: `uat/.work/artifacts-sandbox/10-driver-alerts-the-Notif-1cf81-at-the-notification-choices/test-failed-1.png`
- **Likely cause:**
  - The anchor exists (`me/page.tsx:159`, `id="notifications"` with `scroll-mt-24`).
  - `src/app/(app)/loading.tsx` and the `screen()` wrapper show a skeleton first. When Next tries to scroll to the hash, `#notifications` is not on the page yet, and nothing tries again once the real content arrives.
- **Suggested fix:** On `/me`, add a small client effect that scrolls to `location.hash` once the page has mounted. Alternatively, give the link `scroll={false}` and do that scroll yourself.

### UAT-F8 An ended check-in is described to the instructor as a "ride-along" (App defect)
- **Where:** Admin › Instructor pairing › Remove on a check-in, and the alert the instructor receives
- **What a user sees:** Dale's alert reads "Elena Vasquez is off your student list. The administrators ended the ride-along." It was a check-in the administrators set up, not a ride-along the driver asked for.
- **Evidence:**
  - `30-pairing-promotions.spec.ts:569`, with the received text quoted above.
  - Screenshot: `uat/.work/artifacts-sandbox/30-pairing-promotions-inst-f8f73-s-the-instructor-what-ended/test-failed-1.png`
- **Likely cause:** `src/app/(app)/admin/instructors/actions.ts:288` hard-codes the alert body, although `reg.instructorRequest` (`"check_in"` or `"ride_along"`) is right there.
- **Suggested fix:** Use `reg.instructorRequest === "check_in" ? "The administrators ended the check-in." : "The administrators ended the ride-along."`.

## Observations

### UAT-O1 The roster table probably has the same solo/instructed error as UAT-F4 (Observation)
- **Where:** Admin › Roster list (`admin/roster/roster-table.tsx:229`, fed by `server/admin.ts:123`)
- **What happens:** The list's Solo/Instructed pill reads `r.solo` directly, so a driver moved into White probably shows "Instructed" there as well. No test checks this cell after a promotion.
- **Suggestion:** Fix it together with UAT-F4, and add a roster-list check to 30-pairing-promotions.spec.ts:996.

### UAT-O2 The canary skipped its sign-in page screenshot step (Observation)
- **Where:** `tests/readonly/02-crawl.spec.ts:47`, "capture the sign-in page for the design review"
- **What happens:** This step is skipped. It produces a screenshot for design review and is not a functional check, so coverage is not affected.
- **Suggestion:** None needed unless the design review expects that capture.

## Resolved since last run
First run; nothing to compare against.

## Coverage
- **Sandbox (production build of 96aa2b84 on 127.0.0.1:3980, throwaway Postgres, 42 people, 203 schedule items):** 138 flows across:
  - Sign-in
  - Driver Now, schedule, alerts, profile and car, waivers, track guide, phone layout and access limits
  - Driver tech inspection, from an open form to sticker, including the shop's link without an account
  - Instructor students, schedule, session notes, recommendations, ride-alongs and access limits
  - Pairing and promotions
  - Admin: overview, roster (check-in, days, roles, notes, add, import, export, cancel), schedule editor, announcements, events, settings, simulated clock and session reminders
  - Admin paperwork: tech review, shops, grid tech, waivers and incident reports
  - Access controls for every admin and paperwork screen
- **Canary crawl (read-only, on the sandbox):** every page and file returned 200 with no reported problems or failures.
  - Admin: 57 pages, 49 distinct page shapes, 10 files (including the tech form PDF and the roster CSV export).
  - Instructor: 24 pages, 21 shapes, 9 files.
  - Driver: 21 pages, 19 shapes, 9 files.
- **Live site:** these 11 signed-out checks pass:
  - The sign-in form loads.
  - Signed-out visitors are sent to sign in, and the page they wanted is remembered.
  - The reminder job, the live-update endpoint, uploaded files and the roster export are all refused to a signed-out caller.
  - An unknown shop link gives a proper message.
  - The manifest and icons load, and the track PDFs are real PDFs.
  - The sign-in page does not try to write when opened.
- **Not covered:**
  - Signed-in pages on the live site, by design (signing in is a write).
  - I did not open the Playwright traces.
  - I did not re-run the sandbox pass. Each failure has a specific cause in the code, so none looks flaky.
  - The review guard limited my work to this snapshot. I read nothing outside it, and there was no earlier report.

## Functions checked
| Area | Function | Sandbox | Live site |
|------|----------|---------|-----------|
| Sign-in | Tap sign-in, one-time code, no account enumeration, single-use code, hashed sessions | Pass | Sign-in page and redirects pass (no sign-in) |
| Driver | Now screen, grid call, day done, paperwork prompt | Pass | n/a (signed in) |
| Driver | Ask for and withdraw an instructor | Works; confirmation missing (F1) | n/a |
| Driver | Schedule, filters, on-the-day view | Pass | n/a |
| Driver | Alerts: count, open, mark read | Pass; settings link does not scroll to its section (F7) | n/a |
| Driver | Profile, contact, car, notification choices | Pass | n/a |
| Driver | Waivers: read and sign | Pass; signature lost after a refusal (F2) | n/a |
| Driver | Track guide: turns, passing, flags, rules, maps, PDFs | Pass | PDFs pass |
| Driver | Tech: steps, shop link, upload, shop form, submit, resubmit | Works; upload confirmation missing (F1); picker and checkbox reset (F3) | Unknown shop link passes |
| Instructor | My students, student page, schedule, grid prompt | Pass; White driver shown as Instructed (F4) | n/a |
| Instructor | Session notes, private notes | Pass | n/a |
| Instructor | Recommend for promotion | Works; no confirmation and the sheet stays open (F1) | n/a |
| Admin | Instructor pairing, auto-pair, check-ins, ride-alongs | Pass; ended check-in alert wording (F8) | n/a |
| Admin | Promotions: approve, decline, solo, direct change | Works; confirmations missing (F1); White still "instructed" (F4) | n/a |
| Admin | Overview, roster, check-in, roles, notes, add, import, export, cancel | Pass; superseded waivers counted (F5) | Export refused when signed out: pass |
| Admin | Schedule editor: add, move, delay, cancel, delete, alerts | Pass; lead-time text hard-coded (F6) | n/a |
| Admin | Announcements | Pass | n/a |
| Admin | Events: create, publish, switch, complete, history | Works; "Event saved" missing when the event changes list (F1) | n/a |
| Admin | Settings, run groups, simulated clock, session reminders | Pass | Reminder job refuses no secret: pass |
| Admin | Tech review, shops, grid tech, sticker, paper check | Works; "Sent back" and "Sticker issued" missing (F1) | Uploads refused when signed out: pass |
| Admin | Waivers: status, remind, versions, retire | Pass on the waivers screen; other screens count old versions (F5) | n/a |
| Admin | Incident reports: draft, final, print, send | Pass | n/a |
| Security | Drivers and instructors refused admin pages and actions | Pass | Protected pages redirect: pass |
