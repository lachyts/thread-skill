#!/usr/bin/env bash
# skills/_shared/scripts/reconcile-project.py — the project Drift detector (ADR 0026 § Decision 1).
# Runs against copies of the static fixture vault tests/fixtures/reconcile/vault (project slug `demo`, one
# note per case; the fixture itself is never written) with a fake `gh` first on PATH, so no network. Pins
# every detector, the unambiguous/ambiguous split, dry run writing nothing, --apply writing exactly the
# unambiguous list, idempotence, the gh-less paths, --kinds/--phases scoping, usage errors, the phase's
# dependency on its task writes, and the non-clobbering rollout move with its rollback.
# Hermetic: every case works in its own copy under one mktemp dir; the chmod cases restore modes in the
# trap. bash 3.2-compatible (macOS).
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh

root=$(pwd -P)
script=$root/skills/_shared/scripts/reconcile-project.py
fixture=$root/tests/fixtures/reconcile/vault

tmp=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
tmp=$(cd "$tmp" && pwd -P) || { echo 'FAIL - cd into the mktemp dir'; exit 1; }
if [ -z "$tmp" ] || [ ! -d "$tmp" ] || [ "$tmp" = "$root" ]; then echo "FAIL - mktemp gave no usable temp dir [$tmp]"; exit 1; fi
trap 'chmod -R u+rwX "$tmp" 2>/dev/null; rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin"

# Fake gh: `gh pr view <url> --json state,mergedAt` answers from the case table below; anything else fails.
cat > "$tmp/bin/gh" <<'EOF'
#!/usr/bin/env bash
[ "$1 $2" = "pr view" ] || { echo "fake gh: unexpected $*" >&2; exit 1; }
case "$3" in
  */pull/42|*/pull/51|*/pull/81|*/pull/86) echo '{"mergedAt":"2026-09-20T00:00:00Z","state":"MERGED"}' ;;
  */pull/82) echo '{"mergedAt":null,"state":"OPEN"}' ;;
  */pull/811) echo '{"mergedAt":null,"state":"CLOSED"}' ;;
  */pull/88) echo 'GraphQL: Could not resolve to a PullRequest (HTTP 404)' >&2; exit 1 ;;
  *) echo "fake gh: no case for $3" >&2; exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/gh"

n=0
fresh() {  # fresh → $v, a new copy of the fixture vault
  n=$((n+1)); v="$tmp/case$n/vault"; mkdir -p "$tmp/case$n"; cp -R "$fixture" "$v"
}
# rp [args…] → $out, $err, $rc (fake gh first on PATH, today pinned)
rp() {
  PATH="$tmp/bin:$PATH" python3 "$script" --project demo --vault "$v" --today 2026-09-27 "$@" > "$tmp/out" 2> "$tmp/err"
  rc=$?; out=$(cat "$tmp/out"); err=$(cat "$tmp/err")
}
manifest() { (cd "$1" && find . -type f | LC_ALL=C sort | xargs shasum); }
# items <list> → sorted `kind slug` lines of that list in $tmp/out (JSON)
items() { python3 -c 'import json,sys
d = json.load(open(sys.argv[1]))
print("\n".join(sorted("%s %s" % (i["kind"], i["slug"]) for i in d[sys.argv[2]])))' "$tmp/out" "$1"; }
# field <list> <slug> <key> → that item's value (lists joined by ",")
field() { python3 -c 'import json,sys
d = json.load(open(sys.argv[1]))
for i in d[sys.argv[2]]:
    if i["slug"] == sys.argv[3]:
        x = i.get(sys.argv[4]); print(",".join(x) if isinstance(x, list) else x)' "$tmp/out" "$1" "$2" "$3"; }
# strs <key> → a top-level value, one line per list element
strs() { python3 -c 'import json,sys
x = json.load(open(sys.argv[1]))[sys.argv[2]]
print("\n".join(x) if isinstance(x, list) else x)' "$tmp/out" "$1"; }
lines() { printf '%s\n' "$@"; }

U_ALL=$(lines "phase demo-p1-alpha" "phase demo-p4-merged" "rollout demo-rollout-2025-12-01" "rollout demo-rollout-2025-12-02" \
  "task demo-p4-2-merged" "task demo-p8-1-merged" "task demo-p8-10-shortid" "task demo-p8-14-escalias" "task demo-p8-3-bullet" | LC_ALL=C sort)
A_ALL=$(lines "phase demo-p5-partial" "phase demo-p6-archived-open" "phase demo-p9-review" "rollout demo-rollout-2025-10-01" \
  "task demo-p12-1-log" "task demo-p5-2-partial" "task demo-p8-11-closed" "task demo-p8-12-prose" "task demo-p8-13-pointer" \
  "task demo-p8-4-followup" "task demo-p8-5-silent" "task demo-p8-6-owner" "task demo-p8-7-nonurl" "task demo-p8-9-partial-log" | LC_ALL=C sort)


# ---- 1. dry run --------------------------------------------------------------------------------------
echo "# 1. dry run"
fresh; before=$(manifest "$v")
rp --json
ok "$rc" 0 "dry run exits 0"
ok "$(items unambiguous)" "$U_ALL" "unambiguous is exactly the expected set (tags-only classification: every task carries phase:)"
ok "$(items ambiguous)" "$A_ALL" "ambiguous is exactly the expected set"
has "$(field ambiguous demo-p5-2-partial reason)" "Open here" "partial merge (PR path) quotes the marker"
has "$(field ambiguous demo-p8-9-partial-log reason)" "Open here" "partial landing (log path) quotes the marker"
has "$(field ambiguous demo-p9-review reason)" "run /thread:repair" "review task under a retired rollout routes to repair"
has "$(field ambiguous demo-p8-11-closed reason)" "CLOSED but the completion log records it" "CLOSED PR vs a log record is a conflict"
has "$(field ambiguous demo-p8-12-prose reason)" "prose" "a prose-only log mention is ambiguous"
has "$(field ambiguous demo-p8-13-pointer reason)" "pointer" "a pointer bullet quotes the marker"
has "$(field ambiguous demo-p8-4-followup reason)" "filed" "a follow-up bullet quotes the marker"
has "$(field ambiguous demo-p8-5-silent reason)" "does not record it" "a done rollout whose log is silent"
has "$(field ambiguous demo-p12-1-log reason)" "does not record it" "a -v2 successor link never names the task"
has "$(field ambiguous demo-p8-7-nonurl reason)" "not a URL" "a bare-number pr: is ambiguous"
has "$(field ambiguous demo-p6-archived-open reason)" "demo-p6-1-archived-open" "archived-but-open names the task"
has "$(field ambiguous demo-rollout-2025-10-01 reason)" "destination exists" "a clashing rollout move is ambiguous"
ok "$(field unambiguous demo-p4-merged depends_on)" "demo-p4-2-merged" "demo-p4 depends on its merged task"
ok "$(field unambiguous demo-p1-alpha depends_on)" "" "demo-p1 depends on nothing"
has "$(strs skipped)" "demo-p8-8-gh404" "a gh error is skipped, not evidence"
ok "$(strs gh)" "ok" "gh reported ok"
ok "$(strs applied)" "False" "applied is false"
for s in demo-p2-empty demo-p3-openwork demo-p10-trap demo-p11-review-live demo-p13-hold demo-p8-2-open-pr demo-p7-done \
         demo-p14-archived demo-p8-8-gh404 demo-rollout-2025-11-01 demo-rollout-2025-09-01; do
  case "$(items unambiguous; items ambiguous)" in *" $s"*) ok listed absent "$s is in neither list";; *) ok absent absent "$s is in neither list";; esac
done
ok "$(manifest "$v")" "$before" "dry run (json) writes nothing"
rp
ok "$rc" 0 "text dry run exits 0"
has "$out" "dry run: nothing written; pass --apply" "text header says dry run"
has "$out" "Unambiguous (9)" "text lists the unambiguous block"
has "$out" "Ambiguous (14)" "text lists the ambiguous block"
ok "$(manifest "$v")" "$before" "dry run (text) writes nothing"

# The short id is bounded: p8-1 never matches a `| p8-10 |` row; the escaped alias and a -v2 successor.
m=$(python3 -c 'import importlib.util, sys
s = importlib.util.spec_from_file_location("rp", sys.argv[1]); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
row = "| p8-10 | short-id row | #21 | landed |"
print(bool(m.find_mentions("demo-p8-1-merged", "demo", row)), bool(m.find_mentions("demo-p8-10-shortid", "demo", row)),
      bool(m.find_mentions("demo-p8-14-x", "demo", "| 1 | [[demo-p8-14-x\\|a]] | #1 |")),
      bool(m.find_mentions("demo-p12-1-log", "demo", "- [[demo-p12-1-log-v2]] → #20")))' "$script" 2>&1)
ok "$m" "False True True False" "mention matching: short-id bound, escaped alias, successor stem"

# ---- 2. --apply --------------------------------------------------------------------------------------
echo "# 2. --apply"
rp --apply --json
ok "$rc" 0 "apply exits 0"
ok "$(strs applied)" "True" "applied is true"
after=$(manifest "$v")
changed=$(printf '%s\n%s\n' "$before" "$after" | LC_ALL=C sort | uniq -u | sed 's/^[0-9a-f]*  //' | LC_ALL=C sort -u | tr '\n' ' ')
exp="./Work/Phases/demo-p1-alpha.md ./Work/Phases/demo-p4-merged.md ./Work/Tasks/Archive/Rollouts/demo-rollout-2025-12-01.md ./Work/Tasks/Archive/Rollouts/demo-rollout-2025-12-02.md ./Work/Tasks/Archive/demo-rollout-2025-12-01.md ./Work/Tasks/demo-p4-2-merged.md ./Work/Tasks/demo-p8-1-merged.md ./Work/Tasks/demo-p8-10-shortid.md ./Work/Tasks/demo-p8-14-escalias.md ./Work/Tasks/demo-p8-3-bullet.md ./Work/Tasks/demo-rollout-2025-12-02.md "
ok "$changed" "$exp" "apply changed exactly the unambiguous file set"
F=$fixture/Work
want=$(awk '/^status: open$/ {print "status: done"; print "completed: 2026-09-27"; next} {print}' "$F/Phases/demo-p1-alpha.md")
ok "$(cat "$v/Work/Phases/demo-p1-alpha.md")" "$want" "demo-p1: status done, completed inserted directly after status (before owner)"
want=$(awk '/^status: open$/ {print "status: done"; next} /^completed:[[:space:]]*$/ {print "completed: 2026-09-27"; next} {print}' "$F/Phases/demo-p4-merged.md")
ok "$(cat "$v/Work/Phases/demo-p4-merged.md")" "$want" "demo-p4: the empty completed: line is filled in place"
for t in demo-p4-2-merged demo-p8-1-merged demo-p8-3-bullet demo-p8-10-shortid demo-p8-14-escalias; do
  want=$(awk '/^status: (open|in_progress)$/ {print "status: done"; next} {print}' "$F/Tasks/$t.md")
  ok "$(cat "$v/Work/Tasks/$t.md")" "$want" "$t: only the status line changed"
done
for r in Archive/demo-rollout-2025-12-01 demo-rollout-2025-12-02; do
  b=$(basename "$r")
  ok "$(shasum < "$v/Work/Tasks/Archive/Rollouts/$b.md")" "$(shasum < "$F/Tasks/$r.md")" "$b moved byte-identical"
  [ -e "$v/Work/Tasks/$r.md" ] && ok present gone "$b gone from its source" || ok gone gone "$b gone from its source"
done
ok "$(shasum < "$v/Work/Tasks/demo-rollout-2025-10-01.md")" "$(shasum < "$F/Tasks/demo-rollout-2025-10-01.md")" "clashing rollout stays in place"
ok "$(shasum < "$v/Work/Tasks/Archive/Rollouts/demo-rollout-2025-10-01.md")" "$(shasum < "$F/Tasks/Archive/Rollouts/demo-rollout-2025-10-01.md")" "clash destination untouched"
has "$(items ambiguous)" "rollout demo-rollout-2025-10-01" "the clash is still ambiguous in the apply output"
ok "$(strs errors)" "" "apply reports no errors"

# ---- 3. idempotence ----------------------------------------------------------------------------------
echo "# 3. idempotence"
after=$(manifest "$v")
rp --apply
ok "$rc" 0 "second apply exits 0"
has "$out" "Unambiguous (0)" "second apply finds nothing unambiguous"
has "$out" "applied" "second apply header says applied"
ok "$(manifest "$v")" "$after" "second apply writes nothing"

# ---- 4. no gh ----------------------------------------------------------------------------------------
echo "# 4. no gh"
fresh; before=$(manifest "$v")
for mode in missing disabled; do
  if [ "$mode" = missing ]; then rp --json --gh-bin "$tmp/nope"; else rp --json --no-gh; fi
  ok "$rc" 0 "gh $mode: exits 0"
  ok "$(strs gh)" "$mode" "gh $mode: reported"
  has "$(strs skipped)" "PR evidence (gh unavailable)" "gh $mode: skipped names PR evidence"
  u=$(items unambiguous)
  for t in demo-p4-2-merged demo-p8-1-merged demo-p8-11-closed; do
    case "$u" in *"task $t"*) ok U not-U "gh $mode: $t is not U (a URL pr: is never decided by the log)";; *) ok not-U not-U "gh $mode: $t is not U (a URL pr: is never decided by the log)";; esac
  done
  for t in demo-p8-3-bullet demo-p8-10-shortid demo-p8-14-escalias; do has "$u" "task $t" "gh $mode: $t is still U"; done
  has "$(items ambiguous)" "phase demo-p4-merged" "gh $mode: demo-p4 is ambiguous"
done
ok "$(manifest "$v")" "$before" "no-gh dry runs write nothing"

# ---- 5. scoping and --kinds --------------------------------------------------------------------------
echo "# 5. scoping and --kinds"
rp --kinds phase --phases 1 --json
ok "$rc" 0 "--kinds phase --phases 1 exits 0"
ok "$(items unambiguous)" "phase demo-p1-alpha" "--phases 1: U is exactly demo-p1"
rp --kinds phase --phases 4 --json
ok "$rc" 0 "--kinds phase --phases 4 exits 0"
ok "$(items unambiguous)" "" "--kinds phase: demo-p4 is not U without task in --kinds"
ok "$(items ambiguous)" "phase demo-p4-merged" "--kinds phase: A is exactly demo-p4"
has "$(field ambiguous demo-p4-merged reason)" "needs task demo-p4-2-merged closed first" "--kinds phase: names the task to close"
rp --kinds phase --phases 4 --apply --json
ok "$rc" 0 "--kinds phase --phases 4 --apply exits 0"
ok "$(manifest "$v")" "$before" "--kinds phase --apply writes no task and no phase"

# ---- 6. usage and dependency errors ------------------------------------------------------------------
echo "# 6. usage and dependency errors"
PATH="$tmp/bin:$PATH" python3 "$script" --vault "$v" > /dev/null 2>&1; ok "$?" 2 "missing --project exits 2"
mkdir -p "$tmp/novault"
PATH="$tmp/bin:$PATH" python3 "$script" --project demo --vault "$tmp/novault" > /dev/null 2>&1; ok "$?" 2 "a vault with no Work/ exits 2"
rp --kinds phase,nope; ok "$rc" 2 "a bad --kinds exits 2"
rp --phases x; ok "$rc" 2 "a bad --phases exits 2"
mkdir -p "$tmp/plug/skills/_shared/scripts"; cp "$script" "$tmp/plug/skills/_shared/scripts/"
PATH="$tmp/bin:$PATH" python3 "$tmp/plug/skills/_shared/scripts/reconcile-project.py" --project demo --vault "$v" --apply > "$tmp/out" 2> "$tmp/err"
ok "$?" 2 "a missing reconcile-wave.py exits 2"
has "$(cat "$tmp/err")" "cannot load Note" "names the load failure"
has "$(cat "$tmp/err")" "reconcile-wave.py" "names reconcile-wave.py"
ok "$(manifest "$v")" "$before" "a load failure writes nothing"

# ---- 7. a phase depends on its task writes -----------------------------------------------------------
echo "# 7. phase depends on its task writes"
fresh
chmod 444 "$v/Work/Tasks/demo-p4-2-merged.md"
if [ -w "$v/Work/Tasks/demo-p4-2-merged.md" ]; then echo "SKIP - read-only file still writable (running as root)"
else
  rp --apply --json
  ok "$rc" 1 "a failed dependency exits 1"
  e=$(strs errors)
  has "$e" "demo-p4-2-merged" "errors name the failed task write"
  has "$e" "phase demo-p4-merged skipped: dependency demo-p4-2-merged" "errors name the skipped phase"
  ok "$(shasum < "$v/Work/Phases/demo-p4-merged.md")" "$(shasum < "$F/Phases/demo-p4-merged.md")" "the skipped phase is byte-identical"
  ok "$(shasum < "$v/Work/Tasks/demo-p4-2-merged.md")" "$(shasum < "$F/Tasks/demo-p4-2-merged.md")" "the failed task is byte-identical"
  has "$(cat "$v/Work/Phases/demo-p1-alpha.md")" "status: done" "an independent phase is still written"
  has "$(cat "$v/Work/Tasks/demo-p8-1-merged.md")" "status: done" "an independent task is still written"
fi

# ---- 8. a missing Archive/Rollouts/ ------------------------------------------------------------------
echo "# 8. missing Archive/Rollouts"
fresh
rm -rf "$v/Work/Tasks/Archive/Rollouts"
rp --kinds rollout --apply
ok "$rc" 0 "rollout apply without Archive/Rollouts exits 0"
[ -d "$v/Work/Tasks/Archive/Rollouts" ] && ok made made "Archive/Rollouts created" || ok missing made "Archive/Rollouts created"
for r in Archive/demo-rollout-2025-12-01 demo-rollout-2025-12-02 demo-rollout-2025-10-01; do
  b=$(basename "$r")
  ok "$(shasum 2>/dev/null < "$v/Work/Tasks/Archive/Rollouts/$b.md")" "$(shasum < "$F/Tasks/$r.md")" "$b moved byte-identical"
  [ -e "$v/Work/Tasks/$r.md" ] && ok present gone "$b gone from its source" || ok gone gone "$b gone from its source"
done

# ---- 9. a move half-failure rolls back ---------------------------------------------------------------
echo "# 9. move rollback"
fresh
chmod 555 "$v/Work/Tasks"
if [ -w "$v/Work/Tasks" ]; then echo "SKIP - read-only dir still writable (running as root)"
else
  rp --kinds rollout --apply --json
  ok "$rc" 1 "a half-failed move exits 1"
  has "$(strs errors)" "demo-rollout-2025-12-02 not moved" "errors name the unmoved rollout"
  ok "$(shasum < "$v/Work/Tasks/demo-rollout-2025-12-02.md")" "$(shasum < "$F/Tasks/demo-rollout-2025-12-02.md")" "the source is byte-identical"
  [ -e "$v/Work/Tasks/Archive/Rollouts/demo-rollout-2025-12-02.md" ] && ok duplicate none "rolled back: no copy in Archive/Rollouts" || ok none none "rolled back: no copy in Archive/Rollouts"
  ok "$(shasum 2>/dev/null < "$v/Work/Tasks/Archive/Rollouts/demo-rollout-2025-12-01.md")" "$(shasum < "$F/Tasks/Archive/demo-rollout-2025-12-01.md")" "a writable source still moves"
fi
chmod u+w "$v/Work/Tasks"

exit $fail
