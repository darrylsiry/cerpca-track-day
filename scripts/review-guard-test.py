#!/usr/bin/env python3
"""Checks the review guard: what each agent may and may not do. Run: python3 scripts/review-guard-test.py"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOTS = {a: f"/x/Track Day App/.review/{a}" for a in ("code", "security", "ux", "uat")}
SLUG = {a: "-x-Track-Day-App--review-" + a for a in ROOTS}


def run(agent, tool, inp):
    p = subprocess.run([sys.executable, os.path.join(HERE, "review-guard.py"), agent], input=json.dumps({"tool_name": tool, "tool_input": inp}),
                       capture_output=True, text=True, env={**os.environ, "CLAUDE_PROJECT_DIR": ROOTS[agent]})
    return p.returncode == 0


def bash(agent, cmd):
    return run(agent, "Bash", {"command": cmd})


CASES = [
    # Allowed: reading, and the checks the runner left behind
    (True, "code", "cat src/db/index.ts"), (True, "code", "cat checks/typecheck.txt"), (True, "code", "tail -5 checks/lint.txt"),
    (True, "code", "grep -rn requireAdmin src | wc -l"), (True, "code", "date '+%Y-%m-%d %H:%M'"), (True, "code", "ls docs/agent-reports/code 2>/dev/null"),
    (True, "code", "find src -name '*.ts' | head -50"), (True, "code", "git log --oneline -5"), (True, "code", "node --version"),
    (True, "security", "head -c 20000 checks/npm-audit.json"), (True, "security", "cat .env.example"),
    (True, "ux", "ls checks/screens | head -40"), (True, "ux", "cat checks/screens/admin-admin-roster.txt"),
    (True, "uat", "scripts/uat.sh"), (True, "uat", "scripts/uat.sh sandbox"), (True, "uat", "scripts/uat.sh prod"), (True, "uat", "./scripts/uat.sh canary"),
    (True, "uat", "cat uat/.work/summary.md"), (True, "uat", "grep -c '\"status\": \"failed\"' uat/.work/results-sandbox.json"),
    # Independence
    (False, "code", "eval \"cat secret\""), (False, "code", "echo Y2F0 | base64 -d | sh"), (False, "code", "cat node_modules/../../docs/agent-reports/code/REPORT.md"),
    (False, "code", "cat /Users/someone/GitHub/Track\\ Day\\ App/docs/agent-reports/security/REPORT.md"), (False, "code", "cat ../security/docs/agent-reports/security/REPORT.md"),
    (False, "code", "cat docs/agent-reports/ux/REPORT.md"), (False, "ux", "cat ~/.claude/projects/x/memory/MEMORY.md"), (False, "ux", "cat $HOME/.claude/CLAUDE.md"),
    (False, "uat", "grep -r CR-001 /Users/someone"), (False, "code", "find / -name REPORT.md"), (False, "code", "cd .. && ls"), (False, "code", "cat docs/agent-reports/AGENT_LEDGER.json"),
    (False, "code", "claude -p hello"), (False, "uat", "curl -s http://127.0.0.1:3980/admin/app-tests/code"), (False, "code", "printenv"), (False, "code", "cat .env.local"),
    (False, "security", "cat .vercel/project.json"), (False, "code", "security find-generic-password -s x"),
    # Read-only, and no running code
    (False, "code", "echo x > src/a.ts"), (False, "code", "rm -rf src"), (False, "code", "sed -i '' s/a/b/ src/x"), (False, "code", "npm install lodash"),
    (False, "code", "npx tsc --noEmit"), (False, "code", "npm run build"), (False, "security", "npm audit --omit=dev --json"), (False, "ux", "npx next dev"),
    (False, "code", "python3 -c \"open('x','w')\""), (False, "code", "node -e 'console.log(1)'"), (False, "code", "node scripts/db-seed.ts"), (False, "code", "bash scripts/uat.sh"),
    (False, "code", "scripts/uat.sh sandbox | true; npx playwright test"), (False, "ux", "find src -name '*.tsx' -exec cat {} +"), (False, "code", "cat a `ls`"),
    (False, "uat", "vercel deploy --prod"), (False, "uat", "git push origin main"), (False, "uat", "rm -rf uat"), (False, "uat", "scripts/uat.sh capture out"),
    (False, "uat", "npx playwright test"), (False, "uat", "psql postgres://postgres@127.0.0.1:54380/trackday_uat -c 'drop table users'"), (False, "uat", "pkill -f next"),
    (False, "code", "scripts/uat.sh"), (False, "ux", "scripts/uat.sh prod"),
    (False, "uat", "UAT_REUSE=1 UAT_PORT=@cerpca.siryous.app scripts/uat.sh sandbox"), (False, "uat", "UAT_KEEP=1 scripts/uat.sh sandbox"),
    (False, "uat", "export UAT_PORT=@cerpca.siryous.app; scripts/uat.sh sandbox"), (False, "uat", "FOO=1 scripts/uat.sh"),
    (False, "uat", "UAT_PROD_URL=https://example.com scripts/uat.sh prod"), (True, "uat", "scripts/uat.sh sandbox 2>&1 | tail -40"),
    (True, "uat", "cd uat; ls .work"), (True, "uat", "scripts/uat.sh canary && cat uat/.work/summary.md"),
    # Network
    (False, "code", "curl -s https://example.com"), (False, "uat", "curl -X POST https://cerpca.siryous.app/login"), (False, "uat", "curl -s https://cerpca.siryous.app/"),
    (False, "ux", "curl -s http://localhost:3001/home"), (False, "security", "wget https://cerpca.siryous.app"),
]
TOOLS = [
    (True, "code", "Read", {"file_path": f"{ROOTS['code']}/src/db/index.ts"}), (True, "code", "Read", {"file_path": "src/db/index.ts"}), (True, "code", "Grep", {"pattern": "x"}),
    (True, "ux", "Read", {"file_path": "checks/screens/driver-home-phone.jpg"}), (True, "uat", "Read", {"file_path": "uat/.work/summary.md"}),
    (True, "code", "Read", {"file_path": "docs/agent-reports/code/REPORT.md"}), (True, "ux", "Read", {"file_path": "docs/agent-reports/ux/mockups/UX-001.html"}),
    (False, "code", "Read", {"file_path": "node_modules/../../docs/agent-reports/code/REPORT.md"}), (False, "code", "Grep", {"pattern": "x", "path": "node_modules/../.."}),
    (False, "code", "Read", {"file_path": os.path.expanduser(f"~/.claude/projects/{SLUG['security']}/s/tool-results/a.txt")}),
    (False, "code", "Read", {"file_path": os.path.expanduser(f"~/.claude/projects/{SLUG['code']}/memory/MEMORY.md")}),
    (True, "code", "Read", {"file_path": os.path.expanduser(f"~/.claude/projects/{SLUG['code']}/s/tool-results/a.txt")}),
    (False, "code", "Read", {"file_path": "/x/Track Day App/docs/agent-reports/security/REPORT.md"}), (False, "code", "Read", {"file_path": f"{ROOTS['code']}/../ux/docs/agent-reports/ux/REPORT.md"}),
    (False, "code", "Read", {"file_path": "docs/agent-reports/security/REPORT.md"}), (False, "ux", "Read", {"file_path": "docs/agent-reports/AGENT_LEDGER.json"}),
    (False, "code", "Grep", {"pattern": "x", "path": "/x/Track Day App"}), (False, "code", "Glob", {"pattern": "../*/REPORT.md"}), (False, "ux", "Read", {"file_path": "~/.claude/CLAUDE.md"}),
    (False, "code", "Read", {"file_path": ".env.local"}), (True, "code", "Read", {"file_path": ".env.example"}), (False, "security", "Read", {"file_path": ".vercel/project.json"}),
    (False, "code", "Write", {"file_path": "src/a"}), (False, "code", "Agent", {"prompt": "hi"}),
]
bad = 0
for want, agent, cmd in CASES:
    if bash(agent, cmd) != want:
        bad += 1; print(f"WRONG ({'should allow' if want else 'should refuse'}) [{agent}] {cmd}")
for want, agent, tool, inp in TOOLS:
    if run(agent, tool, inp) != want:
        bad += 1; print(f"WRONG ({'should allow' if want else 'should refuse'}) [{agent}] {tool} {inp}")
print(f"{len(CASES) + len(TOOLS) - bad} of {len(CASES) + len(TOOLS)} guard checks correct")
sys.exit(1 if bad else 0)
