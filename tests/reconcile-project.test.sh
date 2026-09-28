#!/usr/bin/env bash
# skills/_shared/scripts/reconcile-project.py — the project Drift detector (ADR 0026 § Decision 1).
# Runs against copies of the static fixture vault tests/fixtures/reconcile/vault (project slug `demo`, one
# note per case; the fixture itself is never written) with a fake `gh` first on PATH, so no network. Pins
# every detector, the unambiguous/ambiguous split, dry run writing nothing, --apply writing exactly the
# unambiguous list, idempotence, the gh-less paths, --kinds/--phases scoping, usage errors, the phase's
# dependency on its task writes, the non-clobbering rollout move with its rollback, and the bound apply
# (--apply --only <dry-run json>: work landing between the review and the apply is listed, never written).
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
# Plain mode (no --only) is byte-identical to before the bound apply: execute's ceremony parses its text by
# section header. bound_keys → any --only-only JSON key present in $tmp/out; bound_lines → any such text line.
bound_keys() { python3 -c 'import json,sys
d = json.load(open(sys.argv[1])); print(" ".join(k for k in ("new_since_review", "reviewed_not_applied") if k in d))' "$tmp/out"; }
bound_lines() { printf '%s\n' "$out" | grep -E '^(New since review|Reviewed, not applied) \(|bound to the reviewed list'; }

U_ALL=$(lines "phase demo-p1-alpha" "phase demo-p18-single" "phase demo-p4-merged" "rollout demo-rollout-2025-12-01" \
  "rollout demo-rollout-2025-12-02" "task demo-p4-2-merged" "task demo-p8-1-merged" "task demo-p8-10-shortid" \
  "task demo-p8-14-escalias" "task demo-p8-23-fenced" "task demo-p8-3-bullet" | LC_ALL=C sort)
A_ALL=$(lines "phase demo-p17-broken" "phase demo-p5-partial" "phase demo-p6-archived-open" "phase demo-p9-review" \
  "rollout demo-rollout-2025-10-01" "task demo-p12-1-log" "task demo-p16-2-remain" "task demo-p5-2-partial" \
  "task demo-p8-11-closed" "task demo-p8-12-prose" "task demo-p8-13-pointer" "task demo-p8-15-notmerged" \
  "task demo-p8-16-cancelled" "task demo-p8-17-remaining" "task demo-p8-18-outstanding" "task demo-p8-19-todo" \
  "task demo-p8-20-boldopen" "task demo-p8-21-onlyitem" "task demo-p8-22-unchecked" "task demo-p8-24-broken" \
  "task demo-p8-4-followup" "task demo-p8-5-silent" "task demo-p8-6-owner" "task demo-p8-7-nonurl" \
  "task demo-p8-9-partial-log" | LC_ALL=C sort)


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
# Partial-landing wordings beyond "Open here", each on a merged-PR task (and one via a phase's task).
has "$(field ambiguous demo-p8-17-remaining reason)" '"Remaining"' "partial landing: Remaining: items 1-2"
has "$(field ambiguous demo-p8-18-outstanding reason)" '"outstanding"' "partial landing: items are outstanding"
has "$(field ambiguous demo-p8-19-todo reason)" '"TODO"' "partial landing: TODO"
has "$(field ambiguous demo-p8-20-boldopen reason)" '"**Open:**"' "partial landing: a bold Open: label"
has "$(field ambiguous demo-p8-21-onlyitem reason)" '"Only item 0"' "partial landing: only item 0 landed"
has "$(field ambiguous demo-p16-2-remain reason)" '"remain"' "partial landing: items remain"
has "$(field ambiguous demo-p8-22-unchecked reason)" "unchecked - [ ] item" "an unchecked - [ ] item is ambiguous"
has "$(field unambiguous demo-p8-23-fenced reason)" "is MERGED" "a partial marker and - [ ] inside a fence are stripped"
has "$(field ambiguous demo-p8-24-broken reason)" "does not parse" "an unparseable task note is ambiguous"
has "$(field ambiguous demo-p17-broken reason)" "does not parse" "an unparseable phase note is ambiguous"
# Completion-log rows whose outcome is a non-landing.
has "$(field ambiguous demo-p8-15-notmerged reason)" "not merged" "a not-merged log row quotes the marker"
has "$(field ambiguous demo-p8-16-cancelled reason)" "cancelled" "a cancelled log bullet quotes the marker"
ok "$(field unambiguous demo-p18-single reason)" "all 1 task landed" "one landed task reads in the singular"
has "$(field unambiguous demo-p1-alpha reason)" "all 3 tasks landed" "several landed tasks read in the plural"
ok "$(field unambiguous demo-p4-merged depends_on)" "demo-p4-2-merged" "demo-p4 depends on its merged task"
ok "$(field unambiguous demo-p1-alpha depends_on)" "" "demo-p1 depends on nothing"
has "$(strs skipped)" "demo-p8-8-gh404" "a gh error is skipped, not evidence"
ok "$(strs gh)" "ok" "gh reported ok"
ok "$(strs applied)" "False" "applied is false"
ok "$(bound_keys)" "" "plain dry run --json has no new_since_review / reviewed_not_applied keys"
# demo-p15-noroll: its task is at review with no rollout: a human step, a hold, never "run /thread:repair".
# demo-p16-mixed: one parked task and one ambiguous task: the hold wins, resolving p16-2 could never close it.
# demo-cmux-1-merged: a merged-PR `demo-cmux-*` task shares the slug prefix but is not `demo-p<N>-*`.
for s in demo-p2-empty demo-p3-openwork demo-p10-trap demo-p11-review-live demo-p13-hold demo-p8-2-open-pr demo-p7-done \
         demo-p14-archived demo-p8-8-gh404 demo-rollout-2025-11-01 demo-rollout-2025-09-01 \
         demo-p15-noroll demo-p15-1-review demo-p16-mixed demo-cmux-1-merged; do
  case "$(items unambiguous; items ambiguous)" in *" $s"*) ok listed absent "$s is in neither list";; *) ok absent absent "$s is in neither list";; esac
done
ok "$(manifest "$v")" "$before" "dry run (json) writes nothing"
rp
ok "$rc" 0 "text dry run exits 0"
has "$out" "dry run: nothing written; pass --apply" "text header says dry run"
has "$out" "Unambiguous (11)" "text lists the unambiguous block"
has "$out" "Ambiguous (25)" "text lists the ambiguous block"
ok "$(bound_lines)" "" "plain text dry run has no New since review / Reviewed, not applied lines"
ok "$(manifest "$v")" "$before" "dry run (text) writes nothing"

# The short id is bounded: p8-1 never matches a `| p8-10 |` row; the escaped alias and a -v2 successor.
m=$(python3 -c 'import importlib.util, sys
s = importlib.util.spec_from_file_location("rp", sys.argv[1]); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
row = "| p8-10 | short-id row | #21 | landed |"
print(bool(m.find_mentions("demo-p8-1-merged", "demo", row)), bool(m.find_mentions("demo-p8-10-shortid", "demo", row)),
      bool(m.find_mentions("demo-p8-14-x", "demo", "| 1 | [[demo-p8-14-x\\|a]] | #1 |")),
      bool(m.find_mentions("demo-p12-1-log", "demo", "- [[demo-p12-1-log-v2]] → #20")))' "$script" 2>&1)
ok "$m" "False True True False" "mention matching: short-id bound, escaped alias, successor stem"

# The partial-landing and negative-marker patterns catch each non-landing wording, and miss plain landed prose.
m=$(python3 -c 'import importlib.util, sys
s = importlib.util.spec_from_file_location("rp", sys.argv[1]); m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
part = ["Remaining: items 1-2.", "Items 1\u20132 remain.", "Items 1-2 are outstanding.", "item 1 not yet started",
        "TODO: items 1-2", "Part 2 still to do.", "Only item 0 landed.", "**Open:** items 1\u20132", "Open here: x", "Open: item 2"]
neg = ["| 3 | [[t]] | #12 | not merged |", "| abandoned |", "\u2192 #12 (cancelled)", "not dispatched (see #12)",
       "| skipped |", "unmerged", "| withdrawn |", "canceled"]
clean = ["Its PR merged; nobody ran mark-done.", "Reopened: then merged as #4.", "Landed as #7, profiled.", "opened the PR"]
print(" ".join(t for t in part if not m.PARTIAL_RE.search(t)) or "all-partial",
      "|", " ".join(t for t in neg if not m.NEGATIVE_RE.search(t)) or "all-negative",
      "|", " ".join(t for t in clean if m.PARTIAL_RE.search(t) or m.NEGATIVE_RE.search(t)) or "all-clean")' "$script" 2>&1)
ok "$m" "all-partial | all-negative | all-clean" "partial and negative patterns: every wording hits, landed prose does not"

# ---- 2. --apply --------------------------------------------------------------------------------------
echo "# 2. --apply"
rp --apply --json
ok "$rc" 0 "apply exits 0"
ok "$(strs applied)" "True" "applied is true"
ok "$(bound_keys)" "" "plain --apply --json has no new_since_review / reviewed_not_applied keys"
after=$(manifest "$v")
changed=$(printf '%s\n%s\n' "$before" "$after" | LC_ALL=C sort | uniq -u | sed 's/^[0-9a-f]*  //' | LC_ALL=C sort -u | tr '\n' ' ')
exp="./Work/Phases/demo-p1-alpha.md ./Work/Phases/demo-p18-single.md ./Work/Phases/demo-p4-merged.md ./Work/Tasks/Archive/Rollouts/demo-rollout-2025-12-01.md ./Work/Tasks/Archive/Rollouts/demo-rollout-2025-12-02.md ./Work/Tasks/Archive/demo-rollout-2025-12-01.md ./Work/Tasks/demo-p4-2-merged.md ./Work/Tasks/demo-p8-1-merged.md ./Work/Tasks/demo-p8-10-shortid.md ./Work/Tasks/demo-p8-14-escalias.md ./Work/Tasks/demo-p8-23-fenced.md ./Work/Tasks/demo-p8-3-bullet.md ./Work/Tasks/demo-rollout-2025-12-02.md "
ok "$changed" "$exp" "apply changed exactly the unambiguous file set"
F=$fixture/Work
want=$(awk '/^status: open$/ {print "status: done"; print "completed: 2026-09-27"; next} {print}' "$F/Phases/demo-p1-alpha.md")
ok "$(cat "$v/Work/Phases/demo-p1-alpha.md")" "$want" "demo-p1: status done, completed inserted directly after status (before owner)"
want=$(awk '/^status: open$/ {print "status: done"; next} /^completed:[[:space:]]*$/ {print "completed: 2026-09-27"; next} {print}' "$F/Phases/demo-p4-merged.md")
ok "$(cat "$v/Work/Phases/demo-p4-merged.md")" "$want" "demo-p4: the empty completed: line is filled in place"
for t in demo-p4-2-merged demo-p8-1-merged demo-p8-3-bullet demo-p8-10-shortid demo-p8-14-escalias demo-p8-23-fenced; do
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
ok "$(bound_lines)" "" "plain text --apply has no New since review / Reviewed, not applied lines"
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
  for t in demo-p4-2-merged demo-p8-1-merged demo-p8-11-closed demo-p8-23-fenced; do
    case "$u" in *"task $t"*) ok U not-U "gh $mode: $t is not U (a URL pr: is never decided by the log)";; *) ok not-U not-U "gh $mode: $t is not U (a URL pr: is never decided by the log)";; esac
  done
  for t in demo-p8-3-bullet demo-p8-10-shortid demo-p8-14-escalias; do has "$u" "task $t" "gh $mode: $t is still U"; done
  has "$(items ambiguous)" "phase demo-p4-merged" "gh $mode: demo-p4 is ambiguous"
  # A phase with other open work stays quiet even though one of its in-flight tasks has a PR URL.
  case "$(items unambiguous; items ambiguous)" in *"phase demo-p16-mixed"*) ok listed absent "gh $mode: demo-p16 (a hold plus an in-flight PR) is in neither list";; *) ok absent absent "gh $mode: demo-p16 (a hold plus an in-flight PR) is in neither list";; esac
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
# --phases narrows task candidates too, with the default --kinds; rollout detection ignores it.
rp --phases 8 --json
ok "$rc" 0 "--phases 8 exits 0"
t8=$( (items unambiguous; items ambiguous) | grep '^task ')
ok "$(printf '%s\n' "$t8" | grep -cv '^task demo-p8-')" 0 "--phases 8: every task candidate is demo-p8-*"
has "$t8" "task demo-p8-1-merged" "--phases 8: lists p8 tasks"
has "$(items unambiguous)" "rollout demo-rollout-2025-12-02" "--phases 8: rollouts are still listed"
case "$(items unambiguous; items ambiguous)" in *"phase "*) ok listed absent "--phases 8: no phase listed (there is no p8 phase note)";; *) ok absent absent "--phases 8: no phase listed (there is no p8 phase note)";; esac
rp --phases 4 --json
ok "$rc" 0 "--phases 4 exits 0"
ok "$( (items unambiguous; items ambiguous) | grep '^task ')" "task demo-p4-2-merged" "--phases 4: the only task candidate is demo-p4-2-merged"
has "$(items unambiguous)" "phase demo-p4-merged" "--phases 4: demo-p4 is U with its task"
ok "$(manifest "$v")" "$before" "--phases dry runs write nothing"

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
  has "$e" "task demo-p4-2-merged not written" "errors name the failed task write"
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
  has "$(strs errors)" "(rolled back)" "the error says the half-move was rolled back"
  ok "$(shasum < "$v/Work/Tasks/demo-rollout-2025-12-02.md")" "$(shasum < "$F/Tasks/demo-rollout-2025-12-02.md")" "the source is byte-identical"
  [ -e "$v/Work/Tasks/Archive/Rollouts/demo-rollout-2025-12-02.md" ] && ok duplicate none "rolled back: no copy in Archive/Rollouts" || ok none none "rolled back: no copy in Archive/Rollouts"
  ok "$(shasum 2>/dev/null < "$v/Work/Tasks/Archive/Rollouts/demo-rollout-2025-12-01.md")" "$(shasum < "$F/Tasks/Archive/demo-rollout-2025-12-01.md")" "a writable source still moves"
fi
chmod u+w "$v/Work/Tasks"

# ---- 10. bound apply (--only) ------------------------------------------------------------------------
echo "# 10. bound apply (--only)"
# landp3: a live rollout lands demo-p3's only task between the dry run and the apply (demo-p3 becomes U).
landp3() { f="$v/Work/Tasks/demo-p3-1-open.md"; sed 's/^status: open$/status: done/' "$f" > "$f.new" && mv "$f.new" "$f"; }
# review → $tmp/review.json, the dry run's --json on the current copy $v (what a human reviewed)
review() { rp --json; cp "$tmp/out" "$tmp/review.json"; }
# changed_from <manifest> → the sorted, space-joined paths that differ from it now
changed_from() { printf '%s\n%s\n' "$1" "$(manifest "$v")" | LC_ALL=C sort | uniq -u | sed 's/^[0-9a-f]*  //' | LC_ALL=C sort -u | tr '\n' ' '; }
written_section() { printf '%s\n' "$out" | sed -n '/^Written (/,/^Errors (/p'; }
# reasons <list> → the distinct reasons in that list, one per line
reasons() { python3 -c 'import json,sys
print("\n".join(sorted({i["reason"] for i in json.load(open(sys.argv[1]))[sys.argv[2]]})))' "$tmp/out" "$1"; }
NO_LONGER_DRIFT="no longer drift (closed, moved or out of scope since review)"
exp_p3=$(printf '%s\n' $exp ./Work/Tasks/demo-p3-1-open.md | LC_ALL=C sort | tr '\n' ' ')
U_P3=$(printf '%s\n%s\n' "$U_ALL" "phase demo-p3-openwork" | LC_ALL=C sort)

# 1. landed between runs
fresh; before=$(manifest "$v"); v1=$v
review; cp "$tmp/review.json" "$tmp/review1.json"
ok "$(items unambiguous)" "$U_ALL" "review: the dry run lists U_ALL"
landp3
rp --apply --only "$tmp/review.json" --json
ok "$rc" 0 "bound apply exits 0"
ok "$(strs applied)" "True" "bound apply: applied is true"
ok "$(items unambiguous)" "$U_P3" "bound apply: unambiguous is still the full recomputed list"
ok "$(items new_since_review)" "phase demo-p3-openwork" "bound apply: the phase that landed since review is new"
ok "$(items reviewed_not_applied)" "" "bound apply: every reviewed item was applied"
ok "$(changed_from "$before")" "$exp_p3" "bound apply wrote exactly the reviewed U (plus the test's own landing)"
ok "$(shasum < "$v/Work/Phases/demo-p3-openwork.md")" "$(shasum < "$F/Phases/demo-p3-openwork.md")" "the new phase is not written"
case "$(strs written)" in *demo-p3-openwork*) ok written absent "written never names the new phase";; *) ok absent absent "written never names the new phase";; esac
ok "$(strs errors)" "" "bound apply reports no errors"
# text mode, same mutation on a fresh copy
fresh; review; landp3
rp --apply --only "$tmp/review.json"
ok "$rc" 0 "text bound apply exits 0"
has "$out" "applied (bound to the reviewed list: $tmp/review.json)" "text header names the reviewed list"
has "$out" "New since review (1)" "text lists the new-since-review block"
has "$out" "  - phase demo-p3-openwork: status: done" "text names the new phase under it"
has "$out" "Reviewed, not applied (0)" "text lists the reviewed-not-applied block"
ok "$(written_section | grep -c demo-p3)" 0 "text Written never names p3"
has "$(written_section)" "Written (11)" "text Written lists the 11 reviewed writes"

# 2. a reviewed item turned ambiguous: `now ambiguous: <its ambiguous reason>`, for a human
fresh; review
printf '\nTODO: one more step.\n' >> "$v/Work/Tasks/demo-p8-3-bullet.md"
mid=$(shasum < "$v/Work/Tasks/demo-p8-3-bullet.md")
rp --apply --only "$tmp/review.json" --json
ok "$rc" 0 "a reviewed item gone ambiguous exits 0"
ok "$(items reviewed_not_applied)" "task demo-p8-3-bullet" "reviewed_not_applied names only it"
r=$(field reviewed_not_applied demo-p8-3-bullet reason)
ok "$r" "now ambiguous: $(field ambiguous demo-p8-3-bullet reason)" "the reason is now ambiguous plus its ambiguous reason"
case "$r" in "now ambiguous: "*) ok y y "the reason leads with now ambiguous";; *) ok "$r" "now ambiguous: …" "the reason leads with now ambiguous";; esac
has "$r" '"TODO"' "the reason quotes the partial-landing marker"
ok "$(shasum < "$v/Work/Tasks/demo-p8-3-bullet.md")" "$mid" "it is not written"
ok "$(items new_since_review)" "" "nothing new since review"

# 2b. a reviewed task that lands on its own between the review and the apply is benign, not ambiguous
fresh; review
f="$v/Work/Tasks/demo-p8-1-merged.md"; sed 's/^status: in_progress$/status: done/' "$f" > "$f.new" && mv "$f.new" "$f"
mid=$(shasum < "$f")
rp --apply --only "$tmp/review.json" --json
ok "$rc" 0 "a reviewed task landed on its own exits 0"
ok "$(items reviewed_not_applied)" "task demo-p8-1-merged" "reviewed_not_applied names only it"
ok "$(field reviewed_not_applied demo-p8-1-merged reason)" "$NO_LONGER_DRIFT" "its reason is benign: no longer drift"
case "$(items ambiguous)" in *demo-p8-1-merged*) ok ambiguous absent "it is not ambiguous";; *) ok absent absent "it is not ambiguous";; esac
ok "$(shasum < "$f")" "$mid" "it is not written again"
ok "$(items new_since_review)" "" "nothing new since review"
ok "$(strs errors)" "" "no errors"
rp --apply --only "$tmp/review.json"
has "$out" "  - task demo-p8-1-merged: $NO_LONGER_DRIFT" "text: Reviewed, not applied names it with the benign reason"

# 3. a reviewed phase whose dependency task was not reviewed
fresh; review
python3 -c 'import json,sys
d = json.load(open(sys.argv[1])); d["unambiguous"] = [i for i in d["unambiguous"] if i["slug"] != "demo-p4-2-merged"]
json.dump(d, open(sys.argv[2], "w"))' "$tmp/review.json" "$tmp/review-nop4.json"
rp --apply --only "$tmp/review-nop4.json" --json
ok "$rc" 0 "a withheld dependent phase exits 0 (withheld before apply, not skipped in it)"
ok "$(shasum < "$v/Work/Phases/demo-p4-merged.md")" "$(shasum < "$F/Phases/demo-p4-merged.md")" "the withheld phase is byte-identical"
ok "$(shasum < "$v/Work/Tasks/demo-p4-2-merged.md")" "$(shasum < "$F/Tasks/demo-p4-2-merged.md")" "the unreviewed task is byte-identical"
has "$(items new_since_review)" "task demo-p4-2-merged" "the unreviewed task is new since review"
has "$(items reviewed_not_applied)" "phase demo-p4-merged" "the phase is reviewed, not applied"
has "$(field reviewed_not_applied demo-p4-merged reason)" "demo-p4-2-merged" "the reason names the missing dependency"
ok "$(strs errors)" "" "no errors"

# 4. an empty reviewed list
fresh; before=$(manifest "$v")
printf '{"project":"demo","vault":"%s","applied":false,"unambiguous":[]}' "$v" > "$tmp/empty.json"
rp --apply --only "$tmp/empty.json" --json
ok "$rc" 0 "an empty reviewed list exits 0"
ok "$(manifest "$v")" "$before" "an empty reviewed list writes nothing"
ok "$(items new_since_review)" "$U_ALL" "everything is new since review"

# 5. usage errors (@V is the current copy's vault)
rp --only "$tmp/review.json"; ok "$rc" 2 "--only without --apply exits 2"
has "$err" "--only" "names --only"
rp --apply --only "$tmp/nope.json"; ok "$rc" 2 "a missing --only file exits 2"
bad() {
  printf '%s' "$1" | sed "s#@V#$v#g" > "$tmp/bad.json"; rp --apply --only "$tmp/bad.json"; ok "$rc" 2 "$2 exits 2"
  [ -z "${3:-}" ] || has "$err" "$3" "$2: the error says why"
}
bad 'not json' "invalid JSON" "not JSON"
bad '[1]' "a non-object JSON"
bad '{"project":"other","vault":"@V","applied":false,"unambiguous":[]}' "another project's dry run" "'other'"
bad '{"project":"demo","vault":"/elsewhere/vault","applied":false,"unambiguous":[]}' "another vault's dry run" "vault '/elsewhere/vault'"
bad '{"project":"demo","applied":false,"unambiguous":[]}' "a dry run with no vault" "vault None"
bad '{"project":"demo","vault":"@V","applied":true,"unambiguous":[]}' "an apply's output (applied: true)" "not a dry run"
bad '{"project":"demo","vault":"@V","applied":false}' "a missing unambiguous" "no unambiguous list"
bad '{"project":"demo","vault":"@V","applied":false,"unambiguous":{}}' "a non-list unambiguous" "no unambiguous list"
bad '{"project":"demo","vault":"@V","applied":false,"unambiguous":["x"]}' "a non-object item" "unambiguous item"
bad '{"project":"demo","vault":"@V","applied":false,"unambiguous":[{"kind":"bogus","slug":"x"}]}' "an item with a kind outside KINDS" "unambiguous item"
bad '{"project":"demo","vault":"@V","applied":false,"unambiguous":[{"kind":"task","slug":7}]}' "an item with a non-string slug" "unambiguous item"
bad '{"project":"demo","vault":"@V","applied":false,"unambiguous":[{"kind":"task","slug":""}]}' "an item with an empty slug" "unambiguous item"
ok "$(manifest "$v")" "$before" "usage errors write nothing"

# 6. stdin
fresh; before=$(manifest "$v"); review; landp3
rp --apply --only - --json < "$tmp/review.json"
ok "$rc" 0 "--only - exits 0"
ok "$(items new_since_review)" "phase demo-p3-openwork" "--only -: the new phase is listed"
ok "$(changed_from "$before")" "$exp_p3" "--only -: wrote exactly the reviewed U"

# 7. idempotence of the bound apply (on case 1's vault, with case 1's review)
v=$v1; after=$(manifest "$v")
rp --apply --only "$tmp/review1.json" --json
ok "$rc" 0 "a second bound apply exits 0"
ok "$(manifest "$v")" "$after" "a second bound apply writes nothing"
ok "$(strs written)" "" "a second bound apply lists no writes"
ok "$(items new_since_review)" "phase demo-p3-openwork" "the new phase is still listed, still unwritten"
ok "$(items reviewed_not_applied)" "$U_ALL" "the 11 items the first run wrote are reviewed, not applied"
ok "$(reasons reviewed_not_applied)" "$NO_LONGER_DRIFT" "each with the benign no-longer-drift reason, never now ambiguous"

exit $fail
