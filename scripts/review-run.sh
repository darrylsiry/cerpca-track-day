#!/usr/bin/env bash
# Run one review agent, completely on its own.
#
#   scripts/review-run.sh code|security|ux|uat [force] [sandbox|canary|prod]
#   scripts/review-run.sh all [force]        each agent in its own process, at the same time
#   scripts/review-run.sh <agent> status     what would run, without running it
#
# Independence, by construction rather than by asking nicely:
#  - Its own snapshot (.review/<agent>): the files git tracks, its own agent definition, its own previous
#    report, and nothing else. No other agent's report, definition or mockups, no ledger and no memory.
#    Everything gitignored stays out, so that includes .env.local, .data/ (the local database), .vercel/
#    and the source documents (CERPCA content/, the product brief).
#  - Its own process: a fresh `claude -p` started in that folder with a scrubbed environment, no memory,
#    no user settings, no session history, no MCP servers, and only Read, Grep, Glob and Bash. There is
#    no tool that reaches another agent, and nothing is passed between runs.
#  - A guard on every tool call (scripts/review-guard.py) keeps it inside the snapshot and read-only.
#  - The checks run here, before the agent starts, and their output goes in the snapshot's checks/
#    folder: the type-check and lint (code), npm audit (security), and screenshots of every page (ux).
#    Only the UAT agent runs anything itself, and only its own harness (scripts/uat.sh).
#  - The runner writes the agent's final message to docs/agent-reports/<agent>/REPORT.md as it stands
#    and folds it into the ledger. Agents never see the ledger, which is the only place results meet.
#
# A run is skipped when the code it covers has not changed since its last run, unless `force`.
# Costs usage on your Claude plan. REVIEW_MODEL overrides the model. Logs: .review/logs/.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
WHAT="${1:-}"; MODE="${2:-}"; PASS="${3:-all}"
case "$MODE" in force|status|"") ;; sandbox|canary|prod) PASS="$MODE"; MODE="" ;; *) echo "Unknown option $MODE"; exit 2 ;; esac

if [ "$WHAT" = all ]; then
  status=0; pids=()
  for k in code security ux uat; do "$0" "$k" $MODE & pids+=($!); done
  for p in "${pids[@]}"; do wait "$p" || status=1; done
  exit $status
fi

case "$WHAT" in
  code) AGENT=code-auditor ;;
  security) AGENT=security-reviewer ;;
  ux) AGENT=ux-reviewer ;;
  uat) AGENT=uat-tester ;;
  *) echo "Usage: scripts/review-run.sh code|security|ux|uat|all [force]"; exit 2 ;;
esac
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "The review agents work from a git checkout (they copy the files git tracks)."; exit 2; }

KEY="$WHAT"
WS="$ROOT/.review/$KEY"
REPORTS="$ROOT/docs/agent-reports"
STATE="$ROOT/.review/state/$KEY"
LOGS="$ROOT/.review/logs"
STAMP="$(date '+%Y%m%d-%H%M%S')"
LOG="$LOGS/$KEY-$STAMP.log"
CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"
mkdir -p "$ROOT/.review/state" "$LOGS"

# Tracked files plus new ones, never ignored ones. Agent definitions and reports are copied one at a
# time, below. Belt and braces for a private file that slipped past .gitignore: no databases, backups,
# spreadsheets or mail files, whatever their name.
repo_files() {
  git -c core.quotepath=off ls-files -co --exclude-standard | grep -v -E '^\.claude/|^docs/agent-reports/' \
    | grep -v -E -i '\.(csv|tsv|xlsx?|docx?|sqlite3?|db|db-wal|db-shm|bak|vcf|mbox|eml)$' \
    | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done
}
# What each agent covers: a change elsewhere doesn't trigger it.
UI='^src/(app|components|content)/|^src/lib/(schedule|instruction|time|types|cn)\.ts$|^src/server/(reminders|notify)\.ts$|^public/(sw\.js|icons/)'
scope_files() {
  if [ "$KEY" = ux ]; then repo_files | grep -E "$UI"
  else repo_files | grep -v -E '^docs/|^(README\.md|AGENTS\.md|LICENSE)$|^public/tracks/'; fi
}
# What each agent can read. UX judges what users see, so it gets no scripts, tests or database code.
# AGENTS.md is never copied under its own name: it is written for agents that change code. It goes in
# as PROJECT_NOTES.md (below), to be read like any other file.
snapshot_files() {
  if [ "$KEY" = ux ]; then repo_files | grep -E "$UI|^src/lib/|^README\.md$|^public/tracks/.*\.jpg$"
  else repo_files | grep -v -E '^AGENTS\.md$'; fi
}
fingerprint() {  # a hash of the covered files' names and contents
  scope_files | LC_ALL=C sort | tr '\n' '\0' | xargs -0 shasum -a 256 2>/dev/null | shasum -a 256 | cut -c1-8
}

NOW_FP="$(fingerprint)"
if [ "$MODE" = status ]; then
  echo "$KEY: code $NOW_FP; last run on $(sed -n 1p "$STATE" 2>/dev/null || echo none) at $(sed -n 2p "$STATE" 2>/dev/null || echo never)"
  exit 0
fi
if [ "$MODE" != force ] && [ -f "$STATE" ] && [ "$(sed -n 1p "$STATE")" = "$NOW_FP" ]; then
  echo "$KEY: no changes since its last run ($(sed -n 2p "$STATE"), code $NOW_FP). Skipped. Add 'force' to run anyway."
  exit 0
fi

# The UAT agent's sandbox gets its own ports, so a run never collides with a sandbox someone left up
# while writing tests (3960) or with the screenshots for the design review (3970).
AGENT_UAT_PORT=3980; AGENT_UAT_PGPORT=54380
LOCK="$ROOT/.review/lock-$KEY"
if ! mkdir "$LOCK" 2>/dev/null; then echo "$KEY: a run is already in progress ($LOCK)."; exit 1; fi
cleanup() {
  rmdir "$LOCK" 2>/dev/null
  if [ "$KEY" = uat ]; then
    # Whatever the harness left running in the snapshot's sandbox: the app and its throwaway database.
    lsof -ti "tcp:$AGENT_UAT_PORT" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
    [ -d "$WS/uat/.work/pg" ] && PATH="$PATH:/opt/homebrew/bin:/usr/local/bin" pg_ctl -D "$WS/uat/.work/pg" -m immediate stop >/dev/null 2>&1
  fi
  [ "${REVIEW_KEEP:-0}" = 1 ] || rm -rf "$WS"
}
trap cleanup EXIT

# ---- The snapshot: only what this agent is meant to see ----
rm -rf "$WS"; mkdir -p "$WS/docs/agent-reports/$KEY" "$WS/.claude/agents" "$WS/.claude/hooks" "$WS/checks"
snapshot_files | tr '\n' '\0' | tar --null -T - -cf - | tar -xf - -C "$WS"
[ -d "$REPORTS/$KEY" ] && cp -R "$REPORTS/$KEY/." "$WS/docs/agent-reports/$KEY/"
cp ".claude/agents/$AGENT.md" "$WS/.claude/agents/"
[ -f AGENTS.md ] && [ "$KEY" != ux ] && cp AGENTS.md "$WS/PROJECT_NOTES.md"
cp scripts/review-guard.py "$WS/.claude/hooks/review-guard.py"
cat > "$WS/.claude/settings.json" <<JSON
{
  "permissions": { "deny": ["Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Agent", "Task", "SendMessage"] },
  "hooks": { "PreToolUse": [ { "matcher": "Read|Grep|Glob|Bash", "hooks": [ { "type": "command",
    "command": "python3 \"\$CLAUDE_PROJECT_DIR/.claude/hooks/review-guard.py\" $KEY", "timeout": 20 } ] } ] }
}
JSON

# ---- The checks: run here, in the runner, so no agent runs package scripts or reaches the network ----
echo "$KEY: preparing (code $NOW_FP)"
case "$KEY" in
  code)
    ( cd "$ROOT" && node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json ) > "$WS/checks/typecheck.txt" 2>&1; echo "exit code $?" >> "$WS/checks/typecheck.txt"
    ( cd "$ROOT" && node node_modules/eslint/bin/eslint.js src scripts ) > "$WS/checks/lint.txt" 2>&1; echo "exit code $?" >> "$WS/checks/lint.txt"
    echo "This project has no unit-test suite. Its end-to-end tests are the UAT harness (uat/, scripts/uat.sh), which another process runs." > "$WS/checks/tests.txt"
    ;;
  security)
    ( cd "$ROOT" && npm audit --omit=dev --json ) > "$WS/checks/npm-audit.json" 2> "$WS/checks/npm-audit.err"
    ;;
  ux)
    # What the screens actually look like: every page as an administrator (desktop), an instructor and
    # a driver (phone), from a throwaway copy of the app with the demo data. On its own ports and its
    # own folder, so it can run beside a UAT run. If it cannot run, the agent reviews from source and says so.
    CAP="$ROOT/.review/capture-$$"
    rm -rf "$CAP"; mkdir -p "$CAP"
    snapshot_all() { repo_files | grep -v -E '^AGENTS\.md$' | tr '\n' '\0' | tar --null -T - -cf - | tar -xf - -C "$CAP"; }
    if snapshot_all && cp -cR "$ROOT/node_modules" "$CAP/node_modules" 2>/dev/null && { [ ! -d "$ROOT/uat/node_modules" ] || cp -cR "$ROOT/uat/node_modules" "$CAP/uat/node_modules"; }; then
      ( cd "$CAP" && UAT_PORT=3970 UAT_PGPORT=54370 scripts/uat.sh capture "$WS/checks/screens" ) > "$WS/checks/capture.txt" 2>&1
      echo "exit code $?" >> "$WS/checks/capture.txt"
    else
      echo "The screenshots could not be prepared (copying the project failed)." > "$WS/checks/capture.txt"
    fi
    lsof -ti "tcp:3970" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null
    rm -rf "$CAP"
    ;;
  uat)
    # The UAT agent runs its own harness, which builds and starts the app from this snapshot.
    cp -cR "$ROOT/node_modules" "$WS/node_modules" 2>/dev/null || cp -R "$ROOT/node_modules" "$WS/node_modules"
    if [ -d "$ROOT/uat/node_modules" ]; then cp -cR "$ROOT/uat/node_modules" "$WS/uat/node_modules" 2>/dev/null || cp -R "$ROOT/uat/node_modules" "$WS/uat/node_modules"; fi
    # `next build` walks up from its folder looking for the git root. Above the snapshot that is the real
    # repository, which the sandbox refuses, and the build stops on the refusal. An empty .git folder here
    # ends the search at the snapshot itself.
    mkdir -p "$WS/.git"
    ;;
esac

FP="$NOW_FP"
PROMPT="Run your review now, following your instructions in full. The code version is $FP. Return the complete report in the required Markdown format as your final message, with nothing before or after it."
[ "$KEY" = uat ] && PROMPT="$PROMPT Pass to run: $PASS."

echo "$KEY: started on code $FP ($(date '+%H:%M')), log $LOG"
OUT="$LOGS/$KEY-$STAMP.out"
# The operating system's word on it, not just the guard's: on a Mac the agent's whole process tree can
# read only the parts of the home folder its tools need, so not the repository (and the local database
# in it), anyone's memory and transcripts, or other tools' credentials; and it can write nothing in the
# home folder but caches, so nothing in ~/.claude or ~/.claude.json (settings, hooks, agents, MCP
# servers, scheduled tasks) that would run outside the sandbox later. For the three reading agents the
# snapshot is read-only too, so no command the guard misses can rewrite the guard itself. The UAT agent's
# snapshot is writable, because its harness builds the app and keeps a throwaway database there.
# Two things stay open, because the CLI can't work without them: reading ~/Library/Keychains (its
# login lives there; the guard refuses the `security` tool) and the network (the CLI talks to
# Anthropic, the UAT harness checks the live site, and the profile language can't allow one host).
SANDBOX=()
if [ "$(uname)" = Darwin ] && command -v sandbox-exec >/dev/null; then
  PROFILE="$ROOT/.review/state/sandbox-$KEY.sb"
  if [ "$KEY" = uat ]; then
    # Chromium won't start unless it can stat the folders above its cache. Only names, nothing inside them.
    WS_RULE="(allow file-read* file-write* (subpath \"$WS\"))
(allow file-read-metadata (literal \"$HOME/Library\"))"
  else
    WS_RULE="(allow file-read* (subpath \"$WS\"))
(deny file-write* (subpath \"$WS\"))"
  fi
  cat > "$PROFILE" <<SB
(version 1)
(allow default)
(deny file-read* file-write* (subpath "$HOME"))
(allow file-read-metadata (literal "$HOME") (literal "$(dirname "$HOME")"))
(allow file-read* (subpath "$HOME/.claude") (regex #"^$HOME/\.claude\.json") (subpath "$HOME/.local") (subpath "$HOME/Library/Keychains") (subpath "$HOME/Library/Preferences") (literal "$HOME/.gitconfig"))
(allow file-read* file-write* (subpath "$HOME/.npm") (subpath "$HOME/.cache") (subpath "$HOME/Library/Caches"))
(deny file-read* file-write* (subpath "$HOME/.claude/projects") (subpath "$HOME/.claude/scheduled-tasks") (literal "$HOME/.claude/history.jsonl"))
$WS_RULE
(allow file-read* (literal "$ROOT") (literal "$(dirname "$ROOT")") (literal "$ROOT/.review"))
SB
  SANDBOX=(sandbox-exec -f "$PROFILE")
else
  echo "$KEY: no OS sandbox on this machine; the guard is the only confinement."
fi
# A scrubbed environment: nothing from the session that launched this comes along.
EXTRA=()
# The harness builds the app before it tests it, which outlasts the CLI's usual limit on one command.
[ "$KEY" = uat ] && EXTRA+=("UAT_PORT=$AGENT_UAT_PORT" "UAT_PGPORT=$AGENT_UAT_PGPORT" "BASH_DEFAULT_TIMEOUT_MS=1800000" "BASH_MAX_TIMEOUT_MS=2700000")
(
  cd "$WS" || exit 1
  exec ${SANDBOX[@]+"${SANDBOX[@]}"} env -i HOME="$HOME" USER="${USER:-}" LOGNAME="${LOGNAME:-${USER:-}}" PATH="$PATH" LANG="${LANG:-en_US.UTF-8}" TMPDIR="${TMPDIR:-/tmp}" \
    CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 ${EXTRA[@]+"${EXTRA[@]}"} \
    "$CLAUDE_BIN" -p "$PROMPT" --agent "$AGENT" --model "${REVIEW_MODEL:-claude-opus-5-5}" \
      --tools "Read,Grep,Glob,Bash" --allowedTools "Read,Grep,Glob,Bash" \
      --strict-mcp-config --setting-sources project --no-session-persistence --permission-mode dontAsk \
      < /dev/null > "$OUT" 2> "$LOG"
) &
RUN=$!
# The sleep goes when the watcher does, or it would outlive the run and hold this script's output open.
( sleep "${REVIEW_TIMEOUT:-5400}" & S=$!; trap 'kill "$S" 2>/dev/null' EXIT TERM; wait "$S" && kill "$RUN" 2>/dev/null ) & WATCH=$!
wait "$RUN"; RC=$?
kill "$WATCH" 2>/dev/null; wait "$WATCH" 2>/dev/null
if [ $RC -ne 0 ]; then echo "$KEY: the agent exited with code $RC. Nothing written. See $LOG and $OUT."; exit 1; fi

python3 scripts/review-save.py "$KEY" "$OUT" "$REPORTS" || { echo "$KEY: see $OUT"; exit 1; }
{ echo "$FP"; date '+%Y-%m-%d %H:%M'; } > "$STATE"
node --import tsx scripts/agent-ledger.ts || echo "$KEY: report saved, but the ledger was not updated."
echo "$KEY: finished. Report: docs/agent-reports/$KEY/REPORT.md"
