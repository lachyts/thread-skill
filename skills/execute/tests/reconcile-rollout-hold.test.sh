#!/usr/bin/env bash
# Holds the engine can read (p30-3; skills/_shared/vault-grammar.md § Hold until): a `hold_until:` frontmatter key on a
# parallel rollout note holds every start until that PR merges, one on a task note holds that task's new calls, and
# `next` clears a merged one itself, off --dry-run. `next` reads the PR through gh (a stub here), `status` reads the
# key alone (no gh), and the compare-and-swap removal keeps a hold rewritten since the read. Temp notes only; no vault,
# no network.
# Usage: bash reconcile-rollout-hold.test.sh   (exit 0 = pass)
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../scripts/reconcile-rollout.py"
. "$HERE/../../../tests/lib/rollout-fixtures.sh"   # away_file
TMP="$(cd "$(mktemp -d)" && pwd -P)"   # physical: the stub gh logs the cwd gh ran in (macOS /var -> /private/var)
trap 'chmod -R u+w "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # the Run record (run_record.py, ADR 0032) stays in temp
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)
NOW=2026-10-02T14:05:00Z

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

D=""
# scen <name>: a fresh dir with the Project root ($D/repo), the stub gh ($D/bin/gh) and an empty gh log.
scen() {
  D="$TMP/$1"; mkdir -p "$D/repo" "$D/bin" "$D/gh"; echo "== $1"
  export GHLOG="$D/gh.log" GHDIR="$D/gh"; : > "$GHLOG"
  cat > "$D/bin/gh" <<'EOF'
#!/usr/bin/env bash
echo "$PWD|$*" >> "$GHLOG"
key() { printf '%s' "$1" | tr -c 'A-Za-z0-9' '_'; }
case "$1 $2" in
  "pr view") f="$GHDIR/pr-$(key "$3").json"; [ -f "$f" ] && { cat "$f"; exit 0; }; echo "no PR $3" >&2; exit 1 ;;
esac
echo "unexpected gh call: $*" >&2; exit 2
EOF
  chmod +x "$D/bin/gh"
}
# mkro <body> [frontmatter lines...] — the rollout note $D/ro.md; <body> is its schedule order and blocks.
mkro() {
  local body="$1"; shift
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n%s\n' "$D/repo" "$body"; } > "$D/ro.md"
}
# mkt <slug> <status|-> [frontmatter lines...] — a task note linked to ro ("-" writes no status line).
mkt() {
  local s="$1" st="$2"; shift 2
  { printf -- '---\ntags: [task]\n'
    [ "$st" = "-" ] || printf 'status: %s\n' "$st"
    printf 'rollout: "[[ro]]"\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody %s\n' "$s"; } > "$D/$s.md"
}
# prj <ref> <STATE> — the stub gh's answer to `gh pr view <ref>` (ref as gh receives it).
prj() { printf '{"state":"%s","mergedAt":null,"url":"https://github.com/o/r/pull/x"}\n' "$2" > "$D/gh/pr-$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '_').json"; }
U=https://github.com/o/r/pull
fm() { grep -m1 "^$2:" "$D/$1.md" || echo "<none>"; }   # fm <slug> <key> — the frontmatter line
EH="$TMP/settings-home"; mkdir -p "$EH"; away_file "$EH" 2026-10-02T00:00:00Z   # Away: each rollout runs to its own ceiling
nxt() { HOME="$EH" python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" --gh-bin "$D/bin/gh" "$@"; }
SH="$TMP/status-home"; mkdir -p "$SH"
q() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True, ensure_ascii=False))' "$2"; }
holds='{h["slug"]: h["reason"] for h in d["hold"]}'
hu='[[e["note"], e["scope"], e["state"], e["held"], e["waits"], e["cleared"]] for e in d["holdUntil"]]'
gh_calls() { grep -c . "$GHLOG"; }

# ── H1, the Verify: a rollout hold on an OPEN PR holds the whole queue and `next` reports held ─────────────────────
scen h1
mkro $'- [[a]]\n- [[b]]' 'hold_until: {pr: o/r#202, merged: true}'
mkt a open; mkt b open
prj "$U/202" OPEN
cp "$D/ro.md" "$D/ro.before"
J=$(nxt)
ok "$(q "$J" '[d["start"], d["restart"]]')" '[[],[]]' "H1: nothing starts or restarts under an OPEN rollout hold"
ok "$(q "$J" "$holds")" '{"a":"hold until o/r#202 merges (OPEN)","b":"hold until o/r#202 merges (OPEN)"}' "H1: every queued task is held with the hold reason"
ok "$(q "$J" 'd["halt"]')" '"held"' "H1: next reports halt held"
ok "$(q "$J" 'd["holdUntil"]')" '[{"cleared":false,"error":null,"held":true,"note":"ro","pr":"o/r#202","scope":"rollout","state":"OPEN","url":"https://github.com/o/r/pull/202","waits":"merge"}]' "H1: the holdUntil entry"
ok "$(grep -c "|pr view $U/202 --json state,mergedAt,url\$" "$GHLOG")" 1 "H1: owner/repo#N is read as its PR URL, one gh call"
cmp -s "$D/ro.md" "$D/ro.before"; ok "$?" 0 "H1: the rollout note is byte-identical"

# ── H2, the Verify's release: the fixture flips to MERGED and the hold releases with no note edit ─────────────────────
prj "$U/202" MERGED
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["a","b"]' "H2: once the PR merged both tasks start"
ok "$(q "$J" "$hu")" '[["ro","rollout","MERGED",false,null,true]]' "H2: the entry reads MERGED, released and cleared"
ok "$(q "$J" 'd["halt"]')" 'null' "H2: no halt"
grep -v '^hold_until:' "$D/ro.before" > "$D/ro.expect"
cmp -s "$D/ro.md" "$D/ro.expect"; ok "$?" 0 "H2: only the hold_until line went"
: > "$GHLOG"
J=$(nxt)
ok "$(q "$J" 'd["holdUntil"]')" '[]' "H2: a second next reads no hold"
ok "$(gh_calls)" 0 "H2: … and makes no gh call"

# ── H3: --dry-run on MERGED starts both, clears nothing ───────────────────────────────────────────────────────────
scen h3
mkro $'- [[a]]\n- [[b]]' 'hold_until: {pr: o/r#202, merged: true}  # wait for the engine fix'
mkt a open; mkt b open
prj "$U/202" MERGED
cp "$D/ro.md" "$D/ro.before"
J=$(nxt --dry-run)
ok "$(q "$J" 'd["start"]')" '["a","b"]' "H3: --dry-run on MERGED starts both (a trailing comment reads)"
ok "$(q "$J" "$hu")" '[["ro","rollout","MERGED",false,null,false]]' "H3: --dry-run reports cleared false"
cmp -s "$D/ro.md" "$D/ro.before"; ok "$?" 0 "H3: --dry-run leaves the note byte-identical"

# ── H4: the block form Obsidian re-serialises the flow form to ────────────────────────────────────────────────────
scen h4
mkro $'- [[a]]' 'hold_until:' '  pr: o/r#202' '  merged: true' 'parallel_ceiling: 2'
mkt a open
prj "$U/202" OPEN
J=$(nxt)
ok "$(q "$J" "[d['halt'], $holds]")" '["held",{"a":"hold until o/r#202 merges (OPEN)"}]' "H4: the block form holds while OPEN"
cp "$D/ro.md" "$D/ro.before"
prj "$U/202" MERGED
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["a"]' "H4: the block form releases on MERGED"
grep -v -e '^hold_until:$' -e '^  pr: o/r#202$' -e '^  merged: true$' "$D/ro.before" > "$D/ro.expect"
cmp -s "$D/ro.md" "$D/ro.expect"; ok "$?" 0 "H4: the key and both indented lines go, no orphan lines"
ok "$(fm ro parallel_ceiling)" "parallel_ceiling: 2" "H4: the next top-level key stays"

# ── H5: the pr forms: a URL as written, a quoted "#N" in the Project root, a bare N with no Project root ───────────
scen h5-url
mkro $'- [[a]]' "hold_until: {pr: $U/9/, merged: true}"
mkt a open
prj "$U/9/" OPEN
J=$(nxt)
ok "$(grep -c "|pr view $U/9/ --json state,mergedAt,url\$" "$GHLOG")" 1 "H5: a URL runs gh as written"
ok "$(q "$J" '[d["holdUntil"][0]["url"], d["holdUntil"][0]["waits"]]')" "[\"$U/9/\",\"merge\"]" "H5: … its url is the URL as written"
scen h5-num
mkro $'- [[a]]' 'hold_until: {pr: "#7", merged: true}'
mkt a open
prj 7 OPEN
J=$(nxt)
ok "$(grep -c "^$D/repo|pr view 7 --json state,mergedAt,url\$" "$GHLOG")" 1 "H5: a quoted \"#7\" runs pr view 7 in the Project root"
ok "$(q "$J" "[d['halt'], $holds]")" '["held",{"a":"hold until #7 merges (OPEN)"}]' "H5: … and holds"
scen h5-noroot
mkro $'- [[a]]' 'hold_until: {pr: 7}' 'parallel_ceiling: 2'   # no Project root: the ceiling cannot resolve through it
rmdir "$D/repo"
mkt a open
J=$(nxt)
ok "$(gh_calls)" 0 "H5: a bare number with no Project root dir makes no gh call"
ok "$(q "$J" '[d["holdUntil"][0]["held"], d["holdUntil"][0]["waits"], d["holdUntil"][0]["state"]]')" '[true,"you",null]' "H5: … holds and waits on you"
has "$(q "$J" "$holds")" '"a":"hold until: hold_until unreadable (' "H5: … with the unreadable reason"

# ── H6: a gh failure holds and waits on the merge ─────────────────────────────────────────────────────────────────
scen h6
mkro $'- [[a]]' 'hold_until: {pr: o/r#202, merged: true}'
mkt a open
J=$(nxt)
ok "$(q "$J" "$holds")" "{\"a\":\"hold until o/r#202 merges (gh: no PR $U/202)\"}" "H6: a gh failure holds with its first line"
ok "$(q "$J" '[d["halt"], d["holdUntil"][0]["waits"], d["holdUntil"][0]["state"], d["holdUntil"][0]["error"]]')" "[\"held\",\"merge\",null,\"no PR $U/202\"]" "H6: … waits on the merge, halt held"

# ── H7: CLOSED holds and waits on Lachy ──────────────────────────────────────────────────────────────────────────
scen h7
mkro $'- [[a]]' 'hold_until: {pr: o/r#202, merged: true}'
mkt a open
prj "$U/202" CLOSED
J=$(nxt)
ok "$(q "$J" "$holds")" '{"a":"hold until o/r#202 merges (CLOSED)"}' "H7: CLOSED holds"
ok "$(q "$J" "[d['halt'], $hu]")" '["held",[["ro","rollout","CLOSED",true,"you",false]]]' "H7: … and waits on you"

# ── H8: the unreadable forms hold, wait on Lachy and make no gh call ─────────────────────────────────────────────
for form in 'hold_until:' 'hold_until: null' 'hold_until: {merged: true}' 'hold_until: {pr: o/r#1, merged: false}' \
            'hold_until: {pr: o/r#1, base: main}' 'hold_until: wait for #202 to merge' 'hold_until: {pr: #7}'; do
  scen h8
  mkro $'- [[a]]' "$form"
  mkt a open
  prj "$U/1" MERGED
  cp "$D/ro.md" "$D/ro.before"
  J=$(nxt)
  ok "$(q "$J" '[d["start"], d["halt"], d["holdUntil"][0]["held"], d["holdUntil"][0]["waits"]]')" '[[],"held",true,"you"]' "H8: [$form] holds and waits on you"
  has "$(q "$J" "$holds")" '"a":"hold until: hold_until unreadable (' "H8: [$form] … with the unreadable reason"
  ok "$(gh_calls)" 0 "H8: [$form] … and makes no gh call"
  cmp -s "$D/ro.md" "$D/ro.before"; ok "$?" 0 "H8: [$form] … and never clears itself"
done

# ── H9: a task-scope hold holds that task's new calls only; dependants wait through their dependency ──────────────
scen h9
mkro $'- [[a]]\n- [[b]]\n- [[c]]'
mkt a open; mkt b open 'hold_until: {pr: o/r#5}'; mkt c open 'depends-on: [[b]]' 'hold_until: {pr: o/r#6}'
prj "$U/5" OPEN; prj "$U/6" MERGED
J=$(nxt)
ok "$(q "$J" 'd["start"]')" '["a"]' "H9: the unheld task starts"
ok "$(q "$J" "$holds")" '{"b":"hold until o/r#5 merges (OPEN)","c":"depends on [[b]] (open)"}' "H9: b is held; its dependant waits on it"
ok "$(q "$J" "[d['halt'], $hu]")" '[null,[["b","task","OPEN",true,"merge",false]]]' "H9: one task entry, no halt while a starts"
ok "$(grep -c 'pull/6' "$GHLOG")" 0 "H19: a task hold behind an unmet dependency makes no gh call"
sed -i.bak 's/^status: open$/status: done/' "$D/a.md"
J=$(nxt)
ok "$(q "$J" '[d["start"], d["halt"]]')" '[[],"held"]' "H9: only b and c left: halt held"
cp "$D/c.md" "$D/c.before"; cp "$D/ro.md" "$D/ro.before"
prj "$U/5" MERGED
J=$(nxt)
ok "$(q "$J" "[d['start'], $hu]")" '[["b"],[["b","task","MERGED",false,null,true]]]' "H9: on MERGED b starts, cleared"
ok "$(fm b hold_until)" "<none>" "H9: b's note loses the key"
cmp -s "$D/c.md" "$D/c.before"; ok "$?" 0 "H9: c's note keeps its own hold"
cmp -s "$D/ro.md" "$D/ro.before"; ok "$?" 0 "H9: the rollout note is untouched"
scen h9-solo
mkro $'- [[s]]\n- [[x]]'
mkt s open 'solo: true' 'hold_until: {pr: o/r#5}'; mkt x open
prj "$U/5" OPEN
J=$(nxt)
ok "$(q "$J" "[d['start'], $holds]")" '[["x"],{"s":"hold until o/r#5 merges (OPEN)"}]' "H9: a held Solo task holds nothing below it"

# ── H10: precedence: git-env beats a hold, a pause beats it, and complete beats a stale one ─────────────────────────
scen h10-git
mkro $'- [[a]]\n\n## Git-env log\n\n- 2026-10-02T10:00+00:00 git-env trip [[a]] task: refs/heads/main moved; repo /x' 'hold_until: {pr: o/r#202}'
mkt a open
prj "$U/202" OPEN
J=$(nxt)
ok "$(q "$J" "[d['halt'], $holds]")" '["git-env",{"a":"git-env hold: /thread:repair"}]' "H10: git-env plus a hold is git-env"
scen h10-paused
mkro $'- [[a]]\n- [[b]]' 'paused: 2026-10-02T10:00+00:00' 'hold_until: {pr: o/r#202}'
mkt a open; mkt b open 'hold_until: {pr: o/r#5}'
prj "$U/202" OPEN; prj "$U/5" OPEN
J=$(nxt)
ok "$(q "$J" "[d['halt'], $holds]")" '["paused",{"a":"paused","b":"paused"}]' "H10: paused plus a hold is paused, with the pause reasons"
ok "$(grep -c 'pull/5' "$GHLOG")" 0 "H10: … and no task-scope gh call"
ok "$(q "$J" "$hu")" '[["ro","rollout","OPEN",true,"merge",false]]' "H10: … the rollout hold still reads"
scen h10-complete
mkro $'- [[a]]\n- [[b]]' 'hold_until: {pr: o/r#202}'
mkt a done; mkt b done
prj "$U/202" OPEN
J=$(nxt)
ok "$(q "$J" 'd["halt"]')" '"complete"' "H10: every task merged plus a stale hold is complete"

# ── H11: live calls and Integration carry on under a rollout hold; a stalled task is not restarted ──────────────────
scen h11
mkro $'- [[l]]\n- [[w]]\n- [[s]]\n- [[q]]' 'hold_until: {pr: o/r#202}'
mkt l in_progress; mkt w review "pr: $U/3"; mkt s in_progress; mkt q open
prj "$U/202" OPEN
J=$(nxt --running l)
ok "$(q "$J" '[d["running"], d["awaitingIntegration"], d["start"], d["restart"], d["halt"]]')" '[["l"],["w"],[],[],null]' "H11: the live call and Integration carry on; nothing restarts"
ok "$(q "$J" "$holds")" '{"q":"hold until o/r#202 merges (OPEN)","s":"hold until o/r#202 merges (OPEN)"}' "H11: the stalled and queued tasks are held"
ok "$(q "$J" 'd["slotsInUse"]')" '1' "H11: slotsInUse is the live calls"

# ── H12: idle-slots records hold-pr, for a rollout hold and for a task hold ──────────────────────────────────────────
scen h12
EVD="$D/events"
ev() { python3 -c 'import json,sys
try:
    rows = [json.loads(l) for l in open(sys.argv[1])]
except FileNotFoundError:
    rows = []
print(json.dumps([r["reason"] for r in rows if r["kind"] == "idle-slots"], separators=(",", ":")))' "$EVD/ro.jsonl"; }
mkro $'- [[a]]' 'hold_until: {pr: o/r#202}'
mkt a open
prj "$U/202" OPEN
THREAD_EVENTS_DIR="$EVD" nxt --dry-run >/dev/null
ok "$(ev)" '[]' "H12: --dry-run records nothing"
THREAD_EVENTS_DIR="$EVD" nxt >/dev/null
ok "$(ev)" '["hold-pr"]' "H12: a rollout hold records hold-pr"
mkro $'- [[a]]'
mkt a open 'hold_until: {pr: o/r#202}'
THREAD_EVENTS_DIR="$EVD" nxt >/dev/null
ok "$(ev)" '["hold-pr","hold-pr"]' "H12: a task hold records hold-pr"

# ── H13: no hold anywhere: no gh call, and the output is unchanged apart from holdUntil: [] ─────────────────────────
scen h13
mkro $'- [[a]]\n- [[b]]\n- [[c]]' 'parallel_ceiling: 1'
mkt a open; mkt b open 'depends-on: [[a]]'; mkt c blocked
printf '#!/usr/bin/env bash\necho "$PWD|$*" >> "$GHLOG"\necho "gh must not run" >&2; exit 1\n' > "$D/bin/ghfail"; chmod +x "$D/bin/ghfail"
J1=$(HOME="$EH" python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" --gh-bin "$D/bin/ghfail" --dry-run 2>"$D/err1")
J0=$(PATH="$D/bin:$PATH" HOME="$EH" python3 "$SCRIPT" next --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW" --dry-run 2>"$D/err0")
ok "$(gh_calls)" 0 "H13: no hold, no gh call"
ok "$(q "$J1" 'd["holdUntil"]')" '[]' "H13: holdUntil is []"
ok "$(q "$J1" '{k: v for k, v in d.items() if k != "holdUntil"}')" "$(q "$J0" '{k: v for k, v in d.items() if k != "holdUntil"}')" "H13: every other key is the flagless output's"
ok "$(q "$J1" '[sorted(e) for e in d["setAside"]]')" '[["setAsideAt","slug","status"]]' "H13: a setAside entry gains no key"
ok "$(cat "$D/err1")" "" "H13: nothing on stderr"

# ── H14: status reports the parsed holds with no gh call ─────────────────────────────────────────────────────────
scen h14
mkro $'- [[a]]\n- [[b]]' 'hold_until: {pr: o/r#202, merged: true}'
mkt a open; mkt b done 'hold_until: {pr: "#7"}'
J=$(PATH="$D/bin:$PATH" HOME="$SH" python3 "$SCRIPT" status --rollout "$D/ro.md" --tasks-dir "$D" --now "$NOW"); rc=$?
ok "$rc" 0 "H14: status exits 0"
ok "$(q "$J" 'd["holdUntil"]')" "{\"error\":null,\"pr\":\"o/r#202\",\"url\":\"$U/202\"}" "H14: the rollout's holdUntil"
ok "$(q "$J" '{t["slug"]: t["holdUntil"] for t in d["tasks"]}')" '{"a":null,"b":{"error":null,"pr":"#7","url":null}}' "H14: each row's holdUntil, a landed task's included"
ok "$(gh_calls)" 0 "H14: status makes no gh call"

# ── H15: the compare-and-swap removal keeps a hold rewritten since the read ─────────────────────────────────────────
scen h15
mkro $'- [[a]]' 'hold_until: {pr: o/r#202, merged: true}'
cat > "$D/cas.py" <<'PY'
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
p = Path(sys.argv[2])
n = m.Note(p)
n.remove_block(m.HOLD_KEY, m._hold_until(n, None)["lines"])
p.write_text(p.read_text().replace("o/r#202", "o/r#303"))  # another writer: a new hold
n.save()
kept = "hold_until: {pr: o/r#303, merged: true}" in p.read_text()
n = m.Note(p)
n.remove_block(m.HOLD_KEY, m._hold_until(n, None)["lines"])
p.write_text(p.read_text().replace("status: open\n", "status: open\nfoo: bar\n"))  # another writer: another key
n.save()
t = p.read_text()
print(kept, "hold_until" in t, "foo: bar" in t)
PY
ok "$(python3 "$D/cas.py" "$SCRIPT" "$D/ro.md")" "True False True" "H15: a replay keeps a rewritten hold; on an unchanged hold it removes it"

# ── H16: a rollout hold with only a blocked set-aside task left is held, never stuck ─────────────────────────────────
scen h16
mkro $'- [[a]]' 'hold_until: {pr: o/r#202}'
mkt a blocked
printf '\n## Blocker diagnosis\n\n### Run 1 (2026-10-02T11:00+00:00)\n\nverifier red: a\n\n<!-- run 1 end sha=000000000000 -->\n' >> "$D/a.md"
prj "$U/202" OPEN
J=$(nxt)
ok "$(q "$J" '[d["halt"], d["setAside"]]')" '["held",[{"setAsideAt":"run","slug":"a","status":"blocked"}]]' "H16: halt held, not stuck; the entry is unchanged"

# ── H17: a task hold on a set-aside-at-run task rides its setAside entry ─────────────────────────────────────────────
scen h17
mkro $'- [[a]]'
mkt a blocked 'hold_until: {pr: o/r#5}'
prj "$U/5" OPEN
J=$(nxt)
ok "$(q "$J" '[d["halt"], d["setAside"]]')" '["held",[{"holdUntil":"hold until o/r#5 merges (OPEN)","setAsideAt":"run","slug":"a","status":"blocked"}]]' "H17: the entry carries holdUntil; halt held"
mkt a blocked
J=$(nxt)
ok "$(q "$J" '[d["halt"], d["setAside"]]')" '["stuck",[{"setAsideAt":"run","slug":"a","status":"blocked"}]]' "H17: without the key the entry has no holdUntil"

# ── H18: task holds are not read while the rollout hold stands ─────────────────────────────────────────────────────
scen h18
mkro $'- [[a]]\n- [[b]]' 'hold_until: {pr: o/r#202}'
mkt a open; mkt b open 'hold_until: {pr: o/r#5}'
prj "$U/202" OPEN; prj "$U/5" CLOSED
J=$(nxt --dry-run)
ok "$(q "$J" "$hu")" '[["ro","rollout","OPEN",true,"merge",false]]' "H18: only the rollout entry while it holds"
ok "$(grep -c 'pull/5' "$GHLOG")" 0 "H18: … no task-scope gh call"
prj "$U/202" MERGED
J=$(nxt --dry-run)
ok "$(q "$J" "$hu")" '[["ro","rollout","MERGED",false,null,false],["b","task","CLOSED",true,"you",false]]' "H18: once it releases both are listed; the task one waits on you"
ok "$(q "$J" "[d['start'], $holds]")" '[["a"],{"b":"hold until o/r#5 merges (CLOSED)"}]' "H18: a starts, b is held"

# ── H20: a save that fails leaves the hold, warns, and still releases for this call ──────────────────────────────────
scen h20
mkro $'- [[a]]'
mkt a open 'hold_until: {pr: o/r#5}'
prj "$U/5" MERGED
chmod 444 "$D/a.md"
J=$(nxt 2>"$D/err")
chmod 644 "$D/a.md"
ok "$(q "$J" "[d['start'], $hu]")" '[["a"],[["a","task","MERGED",false,null,false]]]' "H20: the task starts, cleared false"
has "$(cat "$D/err")" "WARN: hold_until on a: not cleared: " "H20: one WARN line on stderr"
ok "$(fm a hold_until)" "hold_until: {pr: o/r#5}" "H20: the hold stays for the next call"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-hold: ALL PASS"; else echo "reconcile-rollout-hold: FAILED"; fi
exit "$fail"
