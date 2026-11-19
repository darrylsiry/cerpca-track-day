#!/usr/bin/env bash
# User-acceptance test run: tries every function of the Track Day App as a user would.
#
#   scripts/uat.sh            # sandbox + canary + prod
#   scripts/uat.sh sandbox    # full end-to-end flows, writes included, on a disposable local copy
#   scripts/uat.sh canary     # the read-only suite against the sandbox, proving it writes nothing
#   scripts/uat.sh prod       # the signed-out checks against the live site
#   scripts/uat.sh capture DIR   # screenshots and text of every page, saved to DIR (for the design review)
#   UAT_KEEP=1 scripts/uat.sh sandbox    # leave the sandbox up afterwards (http://127.0.0.1:3960)
#   UAT_REUSE=1 scripts/uat.sh canary    # use a sandbox already up instead of rebuilding it
#   UAT_SKIP_BUILD=1 scripts/uat.sh ...  # reuse the production build already in .next
#
# The root comes from this script's own location, not git: it also runs from a copied workspace
# folder with no git and no .env.local.
#
# The sandbox is a production build of this folder (`next build`, `next start` on 127.0.0.1:3960)
# with its own throwaway Postgres (127.0.0.1:54360, files under uat/.work/pg), migrated and loaded
# with the demo data, demo mode on, the server clock on UTC as on Vercel, and no email, text, push
# or file-storage service connected. Everything is removed at the end. It needs Postgres's own
# tools on this machine (initdb, pg_ctl, psql, createdb; `brew install postgresql@16`).
#
# Nothing here writes to the live site:
#  - Writing flows run only in the sandbox. playwright.config.ts refuses to run that suite against
#    any non-local address, and the sandbox fixtures refuse a non-local database.
#  - The live site gets only the signed-out checks (@public) of the read-only suite. Three layers stop
#    a write: (1) the browser guard in uat/tests/guard.ts aborts every non-GET request; (2) the API
#    client in that fixture only has GET; (3) this script refuses to start if a read-only spec calls a
#    write method directly or touches the email sign-in form. Signing in is itself a write (it adds a
#    session row), so nothing signed-in ever runs against the live site.
#  - The canary pass proves on the sandbox, table by table, that the read-only suite leaves the data
#    alone. The only table left out is `sessions`: the pass signs in by tapping a sample account.
#
# Never opened in any pass: anything under /admin/app-tests.
#
# Results: uat/.work/results-<pass>.json (Playwright), blocked-<pass>.jsonl (writes the guard stopped),
# crawl-<pass>-<role>.json, canary.diff, summary.md. Exit code 0 only if every pass ran green.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WHAT="${1:-all}"
case "$WHAT" in all|sandbox|canary|prod|capture) ;; *) echo "usage: scripts/uat.sh [all|sandbox|canary|prod|capture DIR]"; exit 2 ;; esac
CAPTURE_DIR=""
if [ "$WHAT" = capture ]; then
  CAPTURE_DIR="${2:-}"; [ -n "$CAPTURE_DIR" ] || { echo "usage: scripts/uat.sh capture DIR"; exit 2; }
  mkdir -p "$CAPTURE_DIR"; CAPTURE_DIR="$(cd "$CAPTURE_DIR" && pwd)"
fi
PORT="${UAT_PORT:-3960}"
PGPORT="${UAT_PGPORT:-54360}"
# Ports are numbers and nothing else: the sandbox address is built from them.
case "$PORT$PGPORT" in ""|*[!0-9]*) echo "UAT_PORT and UAT_PGPORT must be port numbers."; exit 2 ;; esac
SANDBOX="http://127.0.0.1:$PORT"
PROD_URL="${UAT_PROD_URL:-https://cerpca.siryous.app}"
WORK="$ROOT/uat/.work"
PGDATA="$WORK/pg"
export UAT_DB_URL="postgres://postgres@127.0.0.1:$PGPORT/trackday_uat"
CRON_SECRET_SB="uat-sandbox-cron-secret"   # protects nothing real; uat/tests/sandbox/fixtures.ts has the same value
export LC_ALL="${LC_ALL:-en_US.UTF-8}"     # Postgres will not start without a valid locale
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/postgresql@16/bin"
mkdir -p "$WORK"
: > "$WORK/summary.md"
status=0
sandbox_is_up=0
APP_PID=""
note() { echo "$*" | tee -a "$WORK/summary.md"; }
psql_sb() { psql "$UAT_DB_URL" -tAc "$1" 2>/dev/null; }

ensure_deps() {
  if [ ! -d uat/node_modules/@playwright/test ]; then
    (cd uat && npm install --no-audit --no-fund >/dev/null) || { echo "npm install failed in uat/"; exit 2; }
  fi
  (cd uat && npx playwright install chromium >/dev/null 2>&1) || true
}

static_check() {
  # Layer 3 of the write guard: read-only specs may not call write methods, reach the database, or
  # touch the email sign-in form (asking for a code writes a row and would send an email).
  if grep -nE '\.(post|put|patch|delete)\(|\bfetch\(|setInputFiles|child_process|Email me a code"?\s*\}?\)\.click|getByLabel\("Email"\)\.(fill|type|press)' uat/tests/readonly/*.ts; then
    note "- REFUSED: a read-only spec calls a write method or submits the sign-in form (above). Fix it before running against the live site."
    exit 3
  fi
  if grep -rln --include='*.spec.ts' 'app-tests' uat/tests; then
    note "- REFUSED: a spec names /admin/app-tests (above). This suite must not open that area."
    exit 3
  fi
}

sandbox_env() {  # the sandbox's whole configuration, independent of any .env file
  env DATABASE_URL="$UAT_DB_URL" DEMO_MODE=1 CRON_SECRET="$CRON_SECRET_SB" TZ=UTC APP_URL="$SANDBOX" NODE_ENV=production \
    RESEND_API_KEY= EMAIL_FROM= TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= TWILIO_FROM= BLOB_READ_WRITE_TOKEN= \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY= VAPID_PRIVATE_KEY= VAPID_SUBJECT= NEXT_TELEMETRY_DISABLED=1 "$@"
}

sandbox_up() {
  if [ "${UAT_REUSE:-0}" = 1 ] && curl -sf -o /dev/null "$SANDBOX/login" 2>/dev/null; then
    note "- Sandbox: reusing the one already running on $SANDBOX"
    return 0
  fi
  for tool in initdb pg_ctl psql createdb; do
    command -v "$tool" >/dev/null || { note "- Sandbox: $tool is not installed, so there is no throwaway database to test against (brew install postgresql@16)."; return 1; }
  done
  if curl -s -o /dev/null "$SANDBOX/login" 2>/dev/null; then note "- Sandbox: something else is already answering on $SANDBOX. Stop it, or set UAT_PORT."; return 1; fi
  sandbox_is_up=1
  # The database: its own cluster, TCP on localhost only, wiped at the end.
  pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1; rm -rf "$PGDATA"
  initdb -D "$PGDATA" -U postgres -A trust --locale="$LC_ALL" > "$WORK/pg-init.log" 2>&1 || { note "  FAILED to create the database (see uat/.work/pg-init.log)"; return 1; }
  pg_ctl -D "$PGDATA" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c fsync=off" -l "$WORK/pg.log" -w start > /dev/null 2>&1 \
    || { note "  FAILED to start the database (see uat/.work/pg.log)"; return 1; }
  createdb -h 127.0.0.1 -p "$PGPORT" -U postgres trackday_uat || { note "  FAILED to create the trackday_uat database"; return 1; }
  note "- Sandbox: throwaway Postgres on 127.0.0.1:$PGPORT"
  (sandbox_env npm run --silent db:migrate && sandbox_env npm run --silent db:seed) > "$WORK/db-setup.log" 2>&1 \
    || { note "  FAILED to migrate or load the demo data (see uat/.work/db-setup.log)"; return 1; }
  local people; people=$(psql_sb "select count(*) from users" | tr -d '[:space:]')
  [ "${people:-0}" -gt 20 ] || { note "  the demo data did not load: ${people:-0} people (see uat/.work/db-setup.log)"; return 1; }
  note "- Sandbox seeded: $people people, $(psql_sb "select count(*) from schedule_items" | tr -d '[:space:]') schedule items"
  # The app: a production build of this folder.
  if [ "${UAT_SKIP_BUILD:-0}" = 1 ] && [ -f .next/BUILD_ID ]; then
    note "- Sandbox: reusing the production build in .next"
  else
    note "- Sandbox: building from $ROOT"
    sandbox_env npx next build > "$WORK/build.log" 2>&1 || { note "  FAILED to build (see uat/.work/build.log)"; return 1; }
  fi
  sandbox_env npx next start -H 127.0.0.1 -p "$PORT" > "$WORK/app.log" 2>&1 &
  APP_PID=$!
  local up=0
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "$SANDBOX/login" 2>/dev/null; then up=1; break; fi
    kill -0 "$APP_PID" 2>/dev/null || break
    sleep 1
  done
  [ $up = 1 ] || { note "  the sandbox never answered on $SANDBOX (see uat/.work/app.log)"; return 1; }
  note "- Sandbox: app running on $SANDBOX"
}

sandbox_down() {
  [ "$sandbox_is_up" = 1 ] || return 0
  sandbox_is_up=0
  if [ "${UAT_KEEP:-0}" = 1 ]; then
    note "- Sandbox left running on $SANDBOX. Stop it with: kill $APP_PID; pg_ctl -D uat/.work/pg -m fast stop"
    return
  fi
  if [ -n "$APP_PID" ]; then
    pkill -P "$APP_PID" 2>/dev/null; kill "$APP_PID" 2>/dev/null; wait "$APP_PID" 2>/dev/null
  fi
  # `next start` runs the server in a child process; make sure nothing is left on the port.
  lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
  pg_ctl -D "$PGDATA" -m fast stop >/dev/null 2>&1
  rm -rf "$PGDATA" "$ROOT/.data/uploads/uat"
  note "- Sandbox removed (app stopped, database deleted)"
}
trap sandbox_down EXIT

run_suite() {   # name mode base [extra playwright args]
  local name=$1 mode=$2 base=$3; shift 3
  rm -f "$WORK/blocked-$name.jsonl" "$WORK"/crawl-"$name"-*.json; rm -rf "$WORK/artifacts-$name"
  (cd uat && UAT_ROOT="$ROOT" UAT_PASS_NAME="$name" UAT_MODE="$mode" UAT_BASE_URL="$base" UAT_CAPTURE_DIR="$CAPTURE_DIR" npx playwright test "$@") > "$WORK/run-$name.log" 2>&1
  local rc=$?
  local line; line=$(grep -E '^\s+[0-9]+ (passed|failed|skipped|flaky|did not run|interrupted)' "$WORK/run-$name.log" | tr -s ' ' | paste -sd, -)
  note "- $name: ${line:-no result line} (exit $rc; log uat/.work/run-$name.log)"
  [ -s "$WORK/blocked-$name.jsonl" ] && note "  stopped by the guard: $(wc -l < "$WORK/blocked-$name.jsonl" | tr -d ' ') requests (see uat/.work/blocked-$name.jsonl)"
  return $rc
}

run_canary() {
  uat/db-fingerprint.sh > "$WORK/fingerprint-before.txt" || { note "- CANARY: fingerprint failed"; status=1; return; }
  run_suite canary readonly "$SANDBOX" || status=1
  sleep 3   # anything a page view started in the background
  uat/db-fingerprint.sh > "$WORK/fingerprint-after.txt" || { note "- CANARY: fingerprint failed"; status=1; return; }
  diff "$WORK/fingerprint-before.txt" "$WORK/fingerprint-after.txt" > "$WORK/canary.diff"
  local changed; changed=$(grep -E '^>' "$WORK/canary.diff" | awk '{print $2}' | paste -sd, - || true)
  note "- Canary excludes: sessions (the read-only pass signs in by tapping a sample account)."
  if [ -n "$changed" ]; then
    status=1
    note "- CANARY FAILED: the read-only pass changed these tables: $changed (see uat/.work/canary.diff)"
  else
    note "- Canary: no table changed during the read-only pass"
  fi
}

ensure_deps
static_check

if [ "$WHAT" = capture ]; then
  sandbox_up || { sandbox_down; note "- Overall: FAIL"; exit 1; }
  UAT_PER_SHAPE=1 run_suite capture readonly "$SANDBOX" 02-crawl || status=1
  sandbox_down
  note "- Captured $(find "$CAPTURE_DIR" -name '*.jpg' | wc -l | tr -d ' ') screenshots to $CAPTURE_DIR"
  exit $status
fi

if [[ "$WHAT" == all || "$WHAT" == sandbox || "$WHAT" == canary ]]; then
  sandbox_up || { status=1; sandbox_down; note "- Overall: FAIL"; exit 1; }
  # The canary goes first, on untouched demo data; the writing flows then change it.
  if [[ "$WHAT" == all || "$WHAT" == canary ]]; then
    run_canary
  fi
  if [[ "$WHAT" == all || "$WHAT" == sandbox ]]; then
    run_suite sandbox sandbox "$SANDBOX" || status=1
  fi
  sandbox_down
fi

if [[ "$WHAT" == all || "$WHAT" == prod ]]; then
  note "- prod: signing in is a write, so only the signed-out checks run against $PROD_URL."
  run_suite prod readonly "$PROD_URL" --grep @public || status=1
fi

note "- Overall: $([ $status = 0 ] && echo PASS || echo FAIL)"
exit $status
