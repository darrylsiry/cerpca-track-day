#!/usr/bin/env bash
# A development aid for writing specs, not part of a UAT run. It gives you an extra copy of the app
# with its own database beside the sandbox that `UAT_KEEP=1 scripts/uat.sh sandbox` left running,
# so several people can write flows at once without changing each other's data.
#
#   uat/dev-sandbox.sh N up      app on 127.0.0.1:(3960+N), database trackday_uatN, freshly seeded
#   uat/dev-sandbox.sh N reset   the same: drop the data and start again from the demo seed
#   uat/dev-sandbox.sh N down    stop the app and drop the database
#   uat/dev-sandbox.sh N env     print the variables to run specs against it
#
# It uses the throwaway Postgres (127.0.0.1:54360) and the production build (.next) that the kept
# sandbox already has. N is 1 to 9.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
N="${1:-}"; CMD="${2:-}"
case "$N" in [1-9]) ;; *) echo "usage: uat/dev-sandbox.sh N up|reset|down|env   (N is 1 to 9)"; exit 2 ;; esac
PORT=$((3960 + N)); PGPORT=54360; DB="trackday_uat$N"
URL="http://127.0.0.1:$PORT"
DB_URL="postgres://postgres@127.0.0.1:$PGPORT/$DB"
WORK="$ROOT/uat/.work"; mkdir -p "$WORK"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/postgresql@16/bin"
sb_env() {
  env DATABASE_URL="$DB_URL" DEMO_MODE=1 CRON_SECRET="uat-sandbox-cron-secret" TZ=UTC APP_URL="$URL" NODE_ENV=production \
    RESEND_API_KEY= EMAIL_FROM= TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= TWILIO_FROM= BLOB_READ_WRITE_TOKEN= \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY= VAPID_PRIVATE_KEY= VAPID_SUBJECT= NEXT_TELEMETRY_DISABLED=1 "$@"
}
stop_app() { lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null; sleep 1; }
case "$CMD" in
  env)
    echo "UAT_MODE=sandbox UAT_PASS_NAME=dev$N UAT_BASE_URL=$URL UAT_DB_URL=$DB_URL" ;;
  down)
    stop_app; dropdb --force --if-exists -h 127.0.0.1 -p $PGPORT -U postgres "$DB" && echo "dev sandbox $N removed" ;;
  up|reset)
    psql "postgres://postgres@127.0.0.1:$PGPORT/postgres" -tAc "select 1" >/dev/null 2>&1 || { echo "The UAT Postgres is not running. Start it with: UAT_KEEP=1 scripts/uat.sh sandbox"; exit 1; }
    [ -f .next/BUILD_ID ] || { echo "No production build in .next. Run: UAT_KEEP=1 scripts/uat.sh sandbox"; exit 1; }
    stop_app
    dropdb --force --if-exists -h 127.0.0.1 -p $PGPORT -U postgres "$DB"
    createdb -h 127.0.0.1 -p $PGPORT -U postgres "$DB" || exit 1
    (sb_env npm run --silent db:migrate && sb_env npm run --silent db:seed) > "$WORK/dev$N-db.log" 2>&1 || { echo "migrate or seed failed (uat/.work/dev$N-db.log)"; exit 1; }
    rm -f "$WORK/sandbox-state.json"
    sb_env nohup npx next start -H 127.0.0.1 -p "$PORT" > "$WORK/dev$N-app.log" 2>&1 &
    for _ in $(seq 1 40); do curl -sf -o /dev/null "$URL/login" 2>/dev/null && { echo "dev sandbox $N ready: $URL (database $DB, freshly seeded)"; exit 0; }; sleep 1; done
    echo "dev sandbox $N did not answer (uat/.work/dev$N-app.log)"; exit 1 ;;
  *) echo "usage: uat/dev-sandbox.sh N up|reset|down|env"; exit 2 ;;
esac
