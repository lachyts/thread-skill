#!/usr/bin/env bash
# Real syntax check for Workflow scripts. `node --check` is VACUOUS on these files: Node 23 detects the
# ESM `export const meta` and silently passes a body with a syntax error, while the body's top-level
# `return` (legal only inside the Workflow runtime's async wrapper) fails a plain module parse. So parse
# the file the way the runtime does — the body inside an async function — as a module.
# Usage: check-workflow-parse.sh <file.workflow.js>...   (exit 0 = every file parses)
set -uo pipefail
fail=0

wrap_check() {  # stdin: a workflow body → exit status of a module parse of it wrapped in an async fn
  { printf 'async function __wf() {\n'; sed 's/^export const meta/const meta/'; printf '\n}\n'; } \
    | node --input-type=module --check - 2>&1
}

# Control: a known-broken body must FAIL, or this check proves nothing (the node --check trap).
if printf 'export const meta = {}\nconst = ;\nreturn 1\n' | wrap_check >/dev/null; then
  echo "FAIL - parse check accepted a broken body (the check itself is vacuous)"; exit 1
fi
echo "ok   - control: a broken workflow body is rejected"

for f in "$@"; do
  n=$(grep -c '^export const meta' "$f")
  if [ "$n" -ne 1 ]; then echo "FAIL - $f: expected exactly one 'export const meta', found $n"; fail=1; continue; fi
  if out=$(wrap_check < "$f"); then echo "ok   - $f parses"; else echo "FAIL - $f: $out" | head -5; fail=1; fi
done
exit "$fail"
