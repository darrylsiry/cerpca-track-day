#!/usr/bin/env bash
# Print "<table> <rows> <md5 of every row>" for every table in the UAT sandbox's database. Run before
# and after the read-only pass: any difference means a "read-only" function wrote, and the canary
# fails. Sandbox only: it refuses any database that is not on this machine.
#
# Excluded, because the read-only pass writes them on purpose:
#   - sessions    the read-only pass signs in by tapping a sample account, which adds a session row
set -euo pipefail
DB_URL="${UAT_DB_URL:?UAT_DB_URL is not set (scripts/uat.sh sets it)}"
echo "$DB_URL" | grep -qE '^postgres://postgres@127\.0\.0\.1:[0-9]+/[a-z0-9_]+$' || { echo "db-fingerprint.sh only reads a local throwaway database." >&2; exit 2; }
SQL="SELECT table_name || ' ' || (xpath('/row/n/text()', x))[1]::text || ' ' || (xpath('/row/h/text()', x))[1]::text
FROM (SELECT table_name, query_to_xml(format(
  'SELECT count(*) AS n, md5(coalesce(string_agg(t::text, ''|'' ORDER BY t::text), '''')) AS h FROM public.%I t', table_name),
  false, true, '') AS x
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'sessions') s
ORDER BY 1;"
psql "$DB_URL" -v ON_ERROR_STOP=1 -tAc "$SQL"
