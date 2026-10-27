#!/usr/bin/env bash
# Flakes (ADR 0050, p29-9): reconcile-rollout.py's _record_flakes, through `record-verify` (the lead's Integration
# verify and RACE re-verify, from lead-integrate.py verify --diff-base's <out>.flake.json) and through `reconcile` (an
# engine row's `flakes`, a task call's or an integrator's). Each Flake is one `flake` Run-record event and one line in
# the `## Flake log` of one follow-up task per (repo, test), `<project>-followup-flake-<h>`.
#   R1  record-verify on a flake file: one event (test, repo o/r, sha, site, followup, count 1), one follow-up with the
#       task's projects and one log line; the file stamped `recorded`.
#   R2  the same file again: nothing new.
#   R3  a second task, the same test: a second line on the same note, priority high, the twice section; one note.
#   R4  that follow-up done: the next Flake files a -2 note; that one archived: a -3.
#   R5  a timeout file: one suite-timeout event, no note.
#   R6  a red or green file: nothing; no file (verify wrote none: noslot, a failed env_bootstrap): `nothing to
#       record`, exit 0; a malformed or unreadable file: ERROR, exit 1, nothing written.
#   R7  reconcile: an engine row's flakes (site task), the same row again (no-op), an integrate row (site integrate),
#       flakes not a list (ERROR, exit 1, nothing recorded), a bad entry (WARNING, skipped), an integrate row
#       reconciled with --no-verdict (none recorded, one line says why), whatever its outcome.
#   R8  --dry-run writes nothing, through either verb.
#   R9  a follow-up another process created meanwhile is appended to, never overwritten.
#   R10 a test id holding ]], backticks or | is written inside a code span.
#   R11 _failing_ids reads the last pass's first run (the Heat hold's re-queue, p31-4): a heat-stopped pass's output and
#       one before a Flake check's re-runs are dropped, the named re-run and the confirming run are never read.
# Temp vault and repo only; no network. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="$TMP/events"   # this suite reads the Run record: each scenario keeps its own dir (scen)
export THREAD_NOTE_LOCK_DIR="$TMP/note-locks"
export HOME="$TMP/home"; mkdir -p "$HOME"
NOW=2026-10-27T09:00:00Z
RO_SLUG=proj-rollout-2026-10-27
TEST_ID='tests/test_x.py::test_a'
SHA1=1111111111111111111111111111111111111111
SHA2=2222222222222222222222222222222222222222

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

# scen <name>: a repo whose origin is github.com/o/r, a rollout note naming it, and three task notes.
scen() {
  D="$TMP/$1"; T="$D/tasks"; mkdir -p "$T" "$D/repo"; export THREAD_EVENTS_DIR="$D/events"
  git -c init.defaultBranch=master init -q "$D/repo"; git -C "$D/repo" remote add origin https://github.com/o/r.git
  RO="$T/$RO_SLUG.md"
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n- [[proj-p29-1-a]]\n- [[proj-p29-2-b]]\n- [[proj-p29-3-c]]\n' "$D/repo" > "$RO"
  for s in proj-p29-1-a proj-p29-2-b proj-p29-3-c; do
    printf -- '---\ntags: [task]\nstatus: in_progress\nscope: cross-cutting\nrollout: "[[%s]]"\nprojects:\n  - "[[Proj]]"\n  - "[[AI]]"\n---\n\n## Notes\n\n%s\n' "$RO_SLUG" "$s" > "$T/$s.md"
  done
  echo "== $1"
}
# setfm <file> <key> <value>: one frontmatter key rewritten in place.
setfm() { python3 - "$@" <<'PY'
import re, sys
p, k, v = sys.argv[1:]
t = open(p).read()
open(p, "w").write(re.sub(rf"(?m)^{re.escape(k)}:.*$", f"{k}: {v}", t, count=1))
PY
}
# fl <file> <verdict> <sha> [why] [timeout-json] [flakes-json]: a lead-integrate.py verify --diff-base record.
fl() { python3 - "$@" <<'PY'
import json, sys
p, verdict, sha = sys.argv[1:4]
why = sys.argv[4] if len(sys.argv) > 4 else ""
timeout = json.loads(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] else None
flakes = json.loads(sys.argv[6]) if len(sys.argv) > 6 else (["tests/test_x.py::test_a"] if verdict == "flake" else [])
json.dump({"v": 1, "sha": sha, "diffBase": "0" * 40, "verdict": verdict, "why": why, "failing": flakes, "touched": [],
           "flakes": flakes, "timeout": timeout}, open(p, "w"))
PY
}
rv() { python3 "$SCRIPT" record-verify --rollout "$RO" --tasks "$1" --site "$2" --from "$3" --tasks-dir "$T" --now "$NOW" "${@:4}" > "$D/out" 2> "$D/err"; rc=$?
       out=$(cat "$D/out"); err=$(cat "$D/err"); }
recon() { printf '%s' "$1" | python3 "$SCRIPT" reconcile --result - --tasks-dir "$T" --now "$NOW" "${@:2}" > "$D/out" 2> "$D/err"; rc=$?
          out=$(cat "$D/out"); err=$(cat "$D/err"); }
# ev <kind>: that kind's events, one JSON object per line, compact, keys sorted, ts, host, v, rollout and kind dropped
ev() { cat "$THREAD_EVENTS_DIR/$RO_SLUG.jsonl" 2>/dev/null | python3 -c '
import json, sys
for l in sys.stdin:
    d = json.loads(l)
    if d["kind"] == sys.argv[1]:
        for k in ("ts", "host", "v", "rollout", "kind"):
            d.pop(k)
        print(json.dumps(d, sort_keys=True, separators=(",", ":")))' "$1"; }
nev() { ev "$1" | grep -c . || true; }
H=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(("o/r\n" + sys.argv[1]).encode()).hexdigest()[:10])' "$TEST_ID")
FU="proj-followup-flake-$H"
fm() { grep -m1 "^$2:" "$1" | sed "s/^$2: *//" || true; }
loglines() { awk '/^## Flake log/{on=1; next} /^## /{on=0} on && /^- /' "$1"; }
flakenotes() { ls "$T" | grep -c 'followup-flake' || true; }

# ---- R1 ------------------------------------------------------------------------------------------------------
scen r1
fl "$D/f1.json" flake "$SHA1"
rv proj-p29-1-a integration "$D/f1.json"
ok "$rc|$err" "0|" "R1: record-verify on a flake file exits 0, nothing on stderr"
ok "$(ev flake)" "{\"count\":1,\"followup\":\"$FU\",\"repo\":\"o/r\",\"sha\":\"$SHA1\",\"site\":\"integration\",\"task\":\"proj-p29-1-a\",\"test\":\"$TEST_ID\"}" "R1: one flake event, its fields"
ok "$(flakenotes)" 1 "R1: one follow-up"
ok "$([ -f "$T/$FU.md" ] && echo yes || echo no)" yes "R1: … named <project>-followup-flake-<h>"
ok "$(loglines "$T/$FU.md")" "- 2026-10-27T09:00+00:00 [[proj-p29-1-a]] at ${SHA1:0:12} (integration)" "R1: … with one Flake log line"
ok "$(fm "$T/$FU.md" status)|$(fm "$T/$FU.md" priority)" "open|normal" "R1: … open, priority normal"
has "$(cat "$T/$FU.md")" $'projects:\n  - "[[Proj]]"\n  - "[[AI]]"' "R1: … the task's projects copied"
has "$(cat "$T/$FU.md")" "\`$TEST_ID\`" "R1: … the test named in a code span"
has "$(cat "$T/$FU.md")" "ADR 0050" "R1: … and ADR 0050"
hasnt "$(cat "$T/$FU.md")" "rollout:" "R1: … a loose task (no rollout:)"
has "$out" "flake: \`$TEST_ID\`" "R1: one flake: line on stdout"
ok "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("recorded", ""))' "$D/f1.json")" "2026-10-27T09:00+00:00" "R1: the file is stamped recorded"

# ---- R2 ------------------------------------------------------------------------------------------------------
before=$(cat "$T/$FU.md")
rv proj-p29-1-a integration "$D/f1.json"
ok "$rc|$(nev flake)|$(flakenotes)" "0|1|1" "R2: the same file again: exit 0, no new event or note"
ok "$(cat "$T/$FU.md")" "$before" "R2: … the follow-up unchanged"
has "$out" "[no-change]" "R2: … and it says so"

# ---- R3 ------------------------------------------------------------------------------------------------------
fl "$D/f2.json" flake "$SHA2"
rv proj-p29-2-b race "$D/f2.json"
ok "$rc|$(nev flake)|$(flakenotes)" "0|2|1" "R3: a second task, the same test: a second event, still one note"
ok "$(loglines "$T/$FU.md" | wc -l | tr -d ' ')" 2 "R3: … the same note gains a second line"
ok "$(fm "$T/$FU.md" priority)" high "R3: … priority high"
has "$(cat "$T/$FU.md")" "## The repo's to fix" "R3: … the twice section"
has "$(cat "$T/$FU.md")" "logged as a Flake twice" "R3: … saying it was logged twice"
ok "$(ev flake | tail -n 1 | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d["count"], d["site"], d["task"])')" "2 race proj-p29-2-b" "R3: … its event counts 2"

# ---- R4 ------------------------------------------------------------------------------------------------------
setfm "$T/$FU.md" status done
fl "$D/f3.json" flake "$SHA1"
rv proj-p29-3-c integration "$D/f3.json"
ok "$rc|$([ -f "$T/$FU-2.md" ] && echo yes || echo no)|$(loglines "$T/$FU-2.md" | wc -l | tr -d ' ')" "0|yes|1" "R4: the follow-up done → a fresh -2 note with one line"
ok "$(loglines "$T/$FU.md" | wc -l | tr -d ' ')" 2 "R4: … the done one untouched"
mkdir -p "$T/Archive/Tasks"; mv "$T/$FU-2.md" "$T/Archive/Tasks/"
fl "$D/f4.json" flake "$SHA2"
rv proj-p29-3-c race "$D/f4.json"
ok "$rc|$([ -f "$T/$FU-3.md" ] && echo yes || echo no)" "0|yes" "R4: the -2 archived → a -3 note"

# ---- R5 ------------------------------------------------------------------------------------------------------
scen r5
fl "$D/t.json" red "$SHA1" timeout '{"run": "named", "seconds": 1800}'
rv proj-p29-1-a integration "$D/t.json"
ok "$rc|$(ev suite-timeout)" "0|{\"run\":\"named\",\"seconds\":1800,\"sha\":\"$SHA1\",\"site\":\"integration\",\"task\":\"proj-p29-1-a\"}" "R5: a timeout file → one suite-timeout event"
ok "$(nev flake)|$(flakenotes)" "0|0" "R5: … and no Flake, no note"
has "$out" "suite-timeout:" "R5: … one suite-timeout: line"
rv proj-p29-1-a integration "$D/t.json"
ok "$(nev suite-timeout)" 1 "R5: … recorded once"

# ---- R6 ------------------------------------------------------------------------------------------------------
scen r6
fl "$D/r.json" red "$SHA1" touched; fl "$D/g.json" green "$SHA1"
rv proj-p29-1-a integration "$D/r.json"; r1=$rc
rv proj-p29-1-a race "$D/g.json"; r2=$rc
ok "$r1|$r2|$(nev flake)|$(nev suite-timeout)|$(flakenotes)" "0|0|0|0|0" "R6: a red or green file records nothing"
rv proj-p29-1-a integration "$D/missing.json"
ok "$rc|$err|$(flakenotes)|$(nev flake)|$(nev suite-timeout)" "0||0|0|0" "R6: no file (noslot, a failed env_bootstrap: verify wrote none) → exit 0, quiet, nothing written"
has "$out" "proj-p29-1-a: integration verify wrote no missing.json" "R6: … naming the file it found absent"
has "$out" "nothing to record" "R6: … and saying there is nothing to record"
rv proj-p29-1-a race "$D/no-such-dir/race-x.flake.json"
ok "$rc|$err" "0|" "R6: … a missing integration dir too (verify never got going)"
printf 'not json' > "$D/bad.json"
rv proj-p29-1-a integration "$D/bad.json"
ok "$rc|$(flakenotes)" "1|0" "R6: a malformed file → exit 1, nothing written"
has "$err" "ERROR: record-verify:" "R6: … one ERROR line"
printf '{"v": 2, "verdict": "flake"}' > "$D/v2.json"
rv proj-p29-1-a integration "$D/v2.json"
ok "$rc" 1 "R6: a record that is not v 1 → exit 1"
mkdir -p "$D/dir.json"
rv proj-p29-1-a integration "$D/dir.json"
ok "$rc" 1 "R6: an unreadable file (a directory) → exit 1"
ln -s "$D/gone.json" "$D/dangling.json"
rv proj-p29-1-a integration "$D/dangling.json"
ok "$rc" 1 "R6: a dangling symlink is unreadable, never absent → exit 1"
rv proj-p29-1-a lead "$D/g.json"
ok "$rc" 2 "R6: a --site other than integration or race → usage, exit 2"

# ---- R7 ------------------------------------------------------------------------------------------------------
scen r7
ROW='{"rolloutSlug": "'"$RO_SLUG"'", "tasks": [{"slug": "proj-p29-1-a", "scope": "cross-cutting", "status": "review", "prUrl": "https://github.com/o/r/pull/9", "reviewRoundsUsed": 1, "flakes": [{"test": "'"$TEST_ID"'", "sha": "'"$SHA1"'"}, {"test": "two\nlines", "sha": "'"$SHA1"'"}, {"test": "tests/test_y.py::t", "sha": "nothex"}]}]}'
recon "$ROW"
ok "$rc" 0 "R7: reconcile of a row with flakes exits 0"
ok "$(ev flake | python3 -c 'import json,sys; print([(d["site"], d["test"], d["count"]) for d in map(json.loads, sys.stdin)])')" "[('task', '$TEST_ID', 1)]" "R7: … one flake event, site task"
ok "$(grep -c '^WARNING: proj-p29-1-a: flakes entry' "$D/err")" 2 "R7: … each bad entry skipped with a WARNING"
has "$out" "flake: \`$TEST_ID\`" "R7: … one flake: line"
recon "$ROW"
ok "$rc|$(nev flake)|$(loglines "$T/$FU.md" | wc -l | tr -d ' ')" "0|1|1" "R7: the same row again: nothing new"
IROW='{"rolloutSlug": "'"$RO_SLUG"'", "tasks": [{"slug": "proj-p29-2-b", "scope": "cross-cutting", "status": "review", "prUrl": "https://github.com/o/r/pull/8", "reviewRoundsUsed": 1, "integration": {"outcome": "integrated", "path": "integrator"}, "flakes": [{"test": "'"$TEST_ID"'", "sha": "'"$SHA2"'"}]}]}'
setfm "$T/proj-p29-2-b.md" status review
recon "$IROW"
ok "$rc|$(ev flake | tail -n 1 | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d["site"], d["count"])')" "0|integrate 2" "R7: an integrate row's flakes: site integrate, the second line"
NROW='{"rolloutSlug": "'"$RO_SLUG"'", "tasks": [{"slug": "proj-p29-3-c", "scope": "cross-cutting", "status": "review", "prUrl": "https://github.com/o/r/pull/7", "reviewRoundsUsed": 1, "flakes": {"test": "x"}}]}'
recon "$NROW"
ok "$rc|$(nev flake)" "1|2" "R7: flakes not a list → exit 1, nothing recorded"
has "$err" "ERROR: proj-p29-3-c: flakes is not a list" "R7: … one ERROR line"
# --no-verdict (ADR 0053): the integrate call's canary check was non-zero, so a red its integrator saw may be the changed
# shared checkout's and its re-runs prove nothing: none of the row's flakes is recorded, whatever its outcome.
VTEST='tests/test_v.py::test_void'
for outcome in integrated rejected; do
  VROW='{"rolloutSlug": "'"$RO_SLUG"'", "tasks": [{"slug": "proj-p29-3-c", "scope": "cross-cutting", "status": "review", "prUrl": "https://github.com/o/r/pull/7", "reviewRoundsUsed": 1, "integration": {"outcome": "'"$outcome"'", "path": "integrator"}, "flakes": [{"test": "'"$VTEST"'", "sha": "'"$SHA1"'"}, {"test": "'"$TEST_ID"'", "sha": "'"$SHA1"'"}]}]}'
  setfm "$T/proj-p29-3-c.md" status review
  recon "$VROW" --no-verdict
  ok "$rc|$err|$(nev flake)|$(flakenotes)" "0||2|1" "R7: --no-verdict, an integrate row ($outcome) → exit 0, no flake event, no follow-up"
  has "$out" "proj-p29-3-c: 2 Flakes not recorded: --no-verdict" "R7: … one line says why ($outcome)"
  hasnt "$out" "flake: \`" "R7: … and no flake: line ($outcome)"
done
ok "$(loglines "$T/$FU.md" | wc -l | tr -d ' ')" 2 "R7: … the existing follow-up gains no line"
recon "$VROW"
ok "$rc|$(nev flake)|$(flakenotes)" "0|4|2" "R7: the same row without --no-verdict records both its Flakes (the void is the flag's alone)"

# ---- R8 ------------------------------------------------------------------------------------------------------
scen r8
fl "$D/f.json" flake "$SHA1"; fl "$D/t.json" red "$SHA1" timeout '{"run": "first", "seconds": 60}'
cp "$D/f.json" "$D/f.orig"
rv proj-p29-1-a integration "$D/f.json" --dry-run; r1=$rc
rv proj-p29-1-a integration "$D/t.json" --dry-run; r2=$rc
recon "$(printf '{"rolloutSlug": "%s", "tasks": [{"slug": "proj-p29-1-a", "scope": "cross-cutting", "status": "review", "prUrl": "https://github.com/o/r/pull/9", "reviewRoundsUsed": 1, "flakes": [{"test": "%s", "sha": "%s"}]}]}' "$RO_SLUG" "$TEST_ID" "$SHA1")" --dry-run; r3=$rc
ok "$r1|$r2|$r3|$(flakenotes)|$([ -e "$THREAD_EVENTS_DIR/$RO_SLUG.jsonl" ] && echo record || echo none)" "0|0|0|0|none" "R8: --dry-run writes no note and no event"
ok "$(cmp -s "$D/f.json" "$D/f.orig" && echo same || echo changed)" same "R8: … and never stamps the file"
has "$out" "(dry-run)" "R8: … and says so"

# ---- R9 ------------------------------------------------------------------------------------------------------
scen r9
python3 - "$SCRIPT" "$T" "$RO" "$TEST_ID" "$SHA1" <<'PY'
import importlib.util, sys, types
from pathlib import Path
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
T, RO, test, sha = Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], sys.argv[5]
real = m._flake_followup
def racing(tasks_dir, slug, h):
    path, found = real(tasks_dir, slug, h)
    # Another process creates the note between the lookup and the exclusive create.
    path.write_text("---\ntags: [task]\nstatus: open\npriority: normal\n---\n\n## Notes\n\nother\n\n## Flake log\n\n"
                    "- 2026-10-26T09:00+00:00 [[proj-x]] at aaaaaaaaaaaa (task)\n")
    return path, False
m._flake_followup = racing
args = types.SimpleNamespace(dry_run=False, now=m._iso_arg("2026-10-27T09:00:00Z"))
note = m.Note(T / "proj-p29-1-a.md")
lines, warns, errs = m._record_flakes(args, "proj-rollout-2026-10-27", "proj-p29-1-a", note, [{"test": test, "sha": sha}], "task", T,
                                      rollout_path=RO)
print("ERRS", errs)
PY
FUR=$(ls "$T" | grep followup-flake)
ok "$(loglines "$T/$FUR" | wc -l | tr -d ' ')|$(fm "$T/$FUR" priority)" "2|high" "R9: a follow-up created meanwhile is appended to (its line kept), never overwritten"
has "$(cat "$T/$FUR")" "other" "R9: … its own text kept"

# ---- R10 -----------------------------------------------------------------------------------------------------
scen r10
WEIRD='tests/t.py::test[a]]|b`c`]'
fl "$D/w.json" flake "$SHA1" "" "" "$(python3 -c 'import json,sys; print(json.dumps([sys.argv[1]]))' "$WEIRD")"
rv proj-p29-1-a integration "$D/w.json"
FUW=$(ls "$T" | grep followup-flake)
has "$(cat "$T/$FUW")" "\`\` $WEIRD \`\`" "R10: a test id holding ]], | and backticks is written in a longer code span"
ok "$(ev flake | python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["test"])')" "$WEIRD" "R10: … and recorded verbatim"

# ---- R11 -----------------------------------------------------------------------------------------------------
# A verify log the Heat hold re-queued twice: pass 1 heat-stopped mid-run (no rc line), pass 2 ran its first run and
# was heat-stopped in the named re-run, pass 3's first run is the verdict, then its Flake check's runs.
fids() { python3 - "$SCRIPT" "$1" <<'PY'
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); rr = importlib.util.module_from_spec(spec); spec.loader.exec_module(rr)
print(json.dumps(rr._failing_ids(open(sys.argv[2])), separators=(",", ":")))
PY
}
printf '%s\n' '== verifier: make test' 'FAILED tests/a.py::t1 - hot' 'verify: heat stop (trapping) during the verifier: stopped its process group, no verdict; back in line' \
  '== verify slot 1 of 2 after 30s' '== verifier: make test' 'FAILED tests/b.py::t2 - x' '== verifier rc 1' '== named re-run: r tests/b.py::t2' \
  'verify: heat stop (trapping) during the named re-run: stopped its process group, no verdict; back in line' \
  '== verify slot 1 of 2 after 40s' '== verifier: make test' 'FAILED tests/c.py::t3 - x' 'FAILED tests/c.py::t4 - x' '== verifier rc 1' \
  '== named re-run: r tests/c.py::t3 tests/c.py::t4' 'FAILED tests/d.py::t5 - x' '== named re-run rc 0' '== confirming run: make test' \
  'FAILED tests/e.py::t6 - x' '== confirming run rc 1' > "$TMP/r11.log"
ok "$(fids "$TMP/r11.log")" '["tests/c.py::t3","tests/c.py::t4"]' "R11: _failing_ids reads only the last pass's first run"
printf '%s\n' '== env_bootstrap: b' 'FAILED tests/z.py::t0' '== env_bootstrap rc 0' '== verifier: make test' 'FAILED tests/c.py::t3 - x' > "$TMP/r11b.log"
ok "$(fids "$TMP/r11b.log")" '["tests/c.py::t3"]' "R11: … never the env_bootstrap's lines, and a run with no rc line (a deadline) is read to the end"

echo; [ "$fail" -eq 0 ] && echo "reconcile-rollout-flake: ALL PASS" || echo "reconcile-rollout-flake: SOME FAILED"
exit "$fail"
