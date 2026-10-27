#!/usr/bin/env bash
# skills/_shared/scripts/engine-snapshot.py: a rollout runs on its Engine snapshot (ADR 0043, p29-1;
# skills/_shared/engine-snapshot.md).
#   S1-S8  cut: a detached, locked worktree at origin's fresh tip; the Primary's own state never reaches it; an
#          unreachable origin; a version-cache copy (nested in an unrelated repo, through a symlink; and bare) has no
#          git Primary and fetches nothing; a tip without the script; a nested home; a squatter; two cuts at one tip
#   A1-A3  adopt: the two stamps below protocol_version:, idempotent, ~/-form; refused from the Primary and on an
#          archived note; a Reinstate move rewrites them in place and logs it under ## Notes
#   R1-R4  resolve: the hand-over is tied to the rendered text's git `ident` prose id, never a disk hash; no
#          protocol_version read; a moved Primary changes nothing a stamped note runs; unusable snapshots; the
#          unstamped root (the Primary, or a cache copy's own realpath); an archived note whose snapshot is gone
#   M1     the move rule: a hard pause moves, a sign-off pause never does (and cuts nothing), a serial chain moves only
#          after a `stopped` close, until its next Leg begins
#   G1-G3b the guards: every wrong-root CLI refuses with `engine-snapshot:` and writes nothing (a task-keyed
#          reconcile-rollout verb with --rollout left off, and reconcile's stdin rows, included); the exemptions;
#          file-followup after Complete, and the retire race closed by the archived grace and close's re-resolve
#   G4     schedule step 6's defer of a Pre-flight leaver (ADR 0047): refused from this run's root, then run from
#          the prior's root before its carry, which carries only the rest; step 6's flags only
#   K1     rollouts.toml's schema: a newer file's unknown key is ignored by an older reader, a typo still refused
#   T1-T2  retire: the keep-list, the archived grace, an unreadable Archive, no Archive, no git Primary
#   H1     ADR 0031's hold: only an unsnapshotted running rollout holds; a snapshot stands for its Primary; a cache
#          copy holds nothing
# Hermetic: HOME, the global git config, the vault, the events dir, the note locks and the canary's state are temp;
# origin is a local bare repo seeded from this tree's files (tracked and new, never ignored), so nothing reaches the
# network. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
unset CLAUDE_CODE_SESSION_ID CODEX_THREAD_ID XDG_STATE_HOME GIT_SSH_COMMAND
root=$(pwd -P)

T=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
T=$(cd "$T" && pwd -P)
trap 'chmod -R u+rwX "$T" 2>/dev/null; rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL="$T/gitconfig" GIT_CONFIG_NOSYSTEM=1
git config --global user.name t; git config --global user.email t@t.invalid
git config --global init.defaultBranch master; git config --global advice.detachedHead false
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$T/events}"   # the Run record (run_record.py) stays in temp
export THREAD_NOTE_LOCK_DIR="$T/note-locks" THREAD_GIT_ENV_DIR="$T/git-env" THREAD_LEG_LOCK_DIR="$T/leg-locks"
export THREAD_VERIFY_SLOTS_DIR="$T/verify-slots" TMPDIR="$T/tmp"
export THREAD_HEAT_LEVEL=0   # the Heat hold's reading, pinned: a hot Mac never flips an assertion
mkdir -p "$TMPDIR" "$T/bin"
printf '#!/bin/sh\necho "gh $*" >> "%s/gh.log"\nexit 1\n' "$T" > "$T/bin/gh"; chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH"
export MERGE_TASK_CHECK_INTERVAL=0 MERGE_TASK_STATE_INTERVAL=0 MERGE_TASK_CONFIRM_INTERVAL=0 \
       MERGE_TASK_READ_INTERVAL=0 MERGE_TASK_READ_TRIES=1 MERGE_TASK_HEAD_LAG_INTERVAL=0
TASKS="$HOME/repos/obsidian/Work/Tasks"; mkdir -p "$TASKS/Archive/Rollouts"
NOW=2026-10-26T10:00:00Z

hasnt() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }
# es <root> <verb> [args...] → $out $err $rc: that root's engine-snapshot.py
es() { local r="$1"; shift; python3 "$r/skills/_shared/scripts/engine-snapshot.py" "$@" > "$T/out" 2> "$T/err"; rc=$?
  out=$(cat "$T/out"); err=$(cat "$T/err"); }
# j <python expr over d>: a field of the last JSON on $out (strings bare, the rest as JSON)
j() { printf '%s' "$out" | python3 -c 'import json, sys
try:
    d = json.load(sys.stdin)
    v = eval(sys.argv[1], {"d": d})
except Exception as e:
    print("<%s>" % type(e).__name__); sys.exit(0)
print(v if isinstance(v, str) else json.dumps(v))' "$1"; }
# py <root> <script rel> [args...] → $out $err $rc
py() { local r="$1" s="$2"; shift 2; python3 "$r/$s" "$@" > "$T/out" 2> "$T/err" < /dev/null; rc=$?
  out=$(cat "$T/out"); err=$(cat "$T/err"); }
mtime() { python3 -c 'import os, sys; print(int(os.stat(sys.argv[1]).st_mtime))' "$1"; }
setmtime() { python3 -c 'import os, sys; t = float(sys.argv[2]); os.utime(sys.argv[1], (t, t))' "$1" "$2"; }
iso() { python3 -c 'import sys, datetime; print(datetime.datetime.fromtimestamp(float(sys.argv[1]), datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))' "$1"; }
embedded() { grep -o '\$Id: [0-9a-f]* \$' "$1" | head -1 | sed 's/^\$Id: //; s/ \$$//'; }

# seed <dir>: this tree's plugin files, tracked and new (never ignored), as they are on disk, so a file not yet
# `git add`ed (engine-snapshot.py itself while it was written) reaches the fixture origin; no __pycache__.
seed() {
  local d="$1"
  mkdir -p "$d"
  if git -C "$root" rev-parse --show-toplevel >/dev/null 2>&1; then
    git -C "$root" ls-files -z --cached --others --exclude-standard -- skills hooks .claude-plugin .gitattributes \
      | (cd "$root" && python3 -c 'import os, shutil, sys
for p in sys.stdin.buffer.read().split(b"\0"):
    p = p.decode()
    if not p or not os.path.isfile(p) or "__pycache__" in p.split("/"):
        continue
    dst = os.path.join(sys.argv[1], p)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(p, dst)' "$d")
  else
    local p; for p in skills hooks .claude-plugin .gitattributes; do [ -e "$root/$p" ] && cp -R "$root/$p" "$d/"; done
    find "$d" -name __pycache__ -prune -exec rm -rf {} +
  fi
}

# The origin and its one writer W; the Primary P is a clone of it at $T/tools/plug.
ORIGIN="$T/srv/plug.git"; W="$T/work"
git init -q --bare -b master "$ORIGIN"; git clone -q "$ORIGIN" "$W" 2>/dev/null
seed "$W"; git -C "$W" add -A; git -C "$W" commit -qm v1; git -C "$W" push -q origin master
# push <file> <line>: a commit on origin's master
push() { mkdir -p "$(dirname "$W/$1")"; printf '%s\n' "$2" >> "$W/$1"; git -C "$W" add -A; git -C "$W" commit -qm "edit $1"
  git -C "$W" push -q origin master; }
tip() { git --git-dir "$ORIGIN" rev-parse refs/heads/master; }
mkdir -p "$T/tools"; git clone -q "$ORIGIN" "$T/tools/plug"; P="$T/tools/plug"; H="$T/tools/plug-snapshots"
# The target repo the notes' Project root names: its origin a local bare repo on a github.com/o/r path.
TSRV="$T/tsrv/github.com/o/r.git"; git init -q --bare -b master "$TSRV"
git clone -q "$TSRV" "$T/target" 2>/dev/null; git -C "$T/target" commit -q --allow-empty -m base; git -C "$T/target" push -q origin master

# ro <name> [frontmatter line]...: a parallel rollout note in $TASKS (protocol 5, Project root $T/target); $BODY
# goes at its end. sro: the same, serial, with a one-row Queue in $T/launch and $BODY (its Leg log) after it.
ro() { local f="$TASKS/$1.md"; shift
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n'; local l; for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nProject root: `%s`\n\n%s' "$T/target" "${BODY:-}"; } > "$f"; }
mkdir -p "$T/launch"
sro() { local n="$1"; shift
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprojects:\n  - "[[Demo]]"\nprotocol_version: 5\n'
    local l; for l in "$@"; do printf '%s\n' "$l"; done
    printf -- 'shape: serial\nsurfaces:\n  - "ext:x"\n---\n\n## Notes\n\nA chain.\n\n## Queue\n\n'
    printf -- '| # | Task | Launch | Surfaces |\n|---|---|---|---|\n| 1 | [[%s-t1\\|%s-t1]] | `cc-demo` from `%s` | `ext:x` |\n' "$n" "$n" "$T/launch"
    printf -- '\n## Post-rollout\n\nRollout-specific items go here:\n\n\n%s' "${BODY:-}"; } > "$TASKS/$n.md"
  printf -- '---\ntags: [task]\nstatus: open\nprojects:\n  - "[[Demo]]"\nrollout: "[[%s]]"\n---\n\n## Notes\n\nDo it.\n' "$n" > "$TASKS/$n-t1.md"; }
fmv() { python3 -c 'import re, sys
t = open(sys.argv[1]).read().split("\n---\n", 1)[0]
m = re.search(r"^" + re.escape(sys.argv[2]) + r":[ \t]*(.*)$", t, re.M)
print(m.group(1).strip() if m else "<none>")' "$1" "$2"; }
# The snapshot dirs under $H, as one sorted line
snaps() { ls "$H" 2>/dev/null | grep -E '^[0-9a-f]{12}$' | tr '\n' ' '; }

# ════ S4: a version-cache copy has no git Primary, so cut fetches nothing ═══════════════════════════════════════
echo "== S4"
CC="$T/claude-config"; git init -q "$CC"; git -C "$CC" remote add origin "$T/nowhere.git"
CACHE="$CC/plugins/cache/thread/thread/9.9.9"; mkdir -p "$CACHE"
cp -R "$W/skills" "$W/hooks" "$W/.claude-plugin" "$CACHE/"
LINKDIR="$HOME/.claude-profiles/p/plugins/cache/thread/thread"; mkdir -p "$LINKDIR"; ln -s "$CACHE" "$LINKDIR/9.9.9"
CL="$LINKDIR/9.9.9"
es "$CL" cut --verb execute
ok "$rc|$out" "4|" "S4a: cut from a cache copy nested in another repo, through a symlink → exit 4, stdout empty"
has "$err" "no git Primary (the plugin root is not its work tree's toplevel (a version-cache install))" "S4a: … the stderr reason"
ok "$(find "$T" -name '*-snapshots' -type d | wc -l | tr -d ' ')" 0 "S4a: … no *-snapshots directory anywhere (no fetch: exit 4, never 2)"
BARE="$T/cache"; mkdir -p "$BARE"; cp -R "$W/skills" "$W/hooks" "$W/.claude-plugin" "$BARE/"
es "$BARE" cut
ok "$rc|$out" "4|" "S4b: cut from a bare cp -R copy → exit 4, stdout empty"

# ════ S1: cut from the Primary ══════════════════════════════════════════════════════════════════════════════════
echo "== S1"
V1=$(tip)
es "$P" cut --verb execute --tasks-dir "$TASKS"
ok "$rc" 0 "S1: cut from the Primary → 0"
S1="$H/${V1:0:12}"
ok "$(j 'd["snapshot"]')|$(j 'd["sha"]')|$(j 'd["reused"]')|$(j 'd["primary"]')|$(j 'd["default"]')" \
   "$S1|$V1|false|$P|master" "S1: … the snapshot at <primary>-snapshots/<sha12>, origin's tip, fresh, on master"
ok "$(git -C "$S1" rev-parse HEAD)|$(git -C "$S1" symbolic-ref -q HEAD || echo detached)" "$V1|detached" "S1: … detached at the tip"
ok "$(git -C "$P" worktree list --porcelain | grep -A4 "^worktree $S1\$" | grep -c '^locked thread Engine snapshot (ADR 0043)$')" 1 \
   "S1: … locked with the snapshot reason"
X=$(embedded "$S1/skills/execute/SKILL.md")
ok "$X" "$(git -C "$S1" rev-parse HEAD:skills/execute/SKILL.md)" "S1: … its execute SKILL.md carries \$Id: <its blob id> \$ (git ident)"
ok "$(j 'd["prose"]["rootId"]')|$(j 'd["prose"]["identical"]')" "$X|false" "S1: … prose.rootId is that id; no --prose-id is never identical"
ok "$([ -f "$H/.cut/${V1:0:12}" ] && echo y)" y "S1: … its .cut marker"
ok "$(git -C "$P" status --porcelain)" "" "S1: … the Primary's tree untouched"

# ════ S2: the Primary's own state never reaches a snapshot ══════════════════════════════════════════════════════
echo "== S2"
git -C "$P" checkout -q -b feature; echo local > "$P/local.txt"; git -C "$P" add local.txt; git -C "$P" commit -qm unpushed
echo dirty >> "$P/hooks/hooks.json"
push notes/v2.txt v2; V2=$(tip)      # origin moves; the Primary's origin/master is now stale
phead=$(git -C "$P" rev-parse HEAD)
es "$P" cut --tasks-dir "$TASKS"
S2="$H/${V2:0:12}"
ok "$rc|$(j 'd["sha"]')" "0|$V2" "S2: a stale origin/master in the Primary → the cut fetches and snapshots origin's new tip"
ok "$([ -e "$S2/local.txt" ] && echo y || echo n)|$(git -C "$S2" status --porcelain)" "n|" "S2: … no unpushed commit, no dirty file in it"
ok "$(git -C "$P" rev-parse HEAD)|$(git -C "$P" symbolic-ref --short HEAD)|$(tail -1 "$P/hooks/hooks.json")" "$phead|feature|dirty" \
   "S2: … the Primary's branch, commit and dirty file untouched"
git -C "$P" checkout -q -- hooks/hooks.json; git -C "$P" checkout -q master; git -C "$P" merge -q --ff-only origin/master

# ════ S3: an unreachable origin ═════════════════════════════════════════════════════════════════════════════════
echo "== S3"
mkdir -p "$T/s3"; git clone -q "$ORIGIN" "$T/s3/plug"; git -C "$T/s3/plug" remote set-url origin "$T/nowhere.git"
es "$T/s3/plug" cut
ok "$rc|$out" "2|" "S3: an unreachable origin → exit 2, stdout empty"
ok "$([ -e "$T/s3/plug-snapshots" ] && echo made || echo none)" none "S3: … nothing created"

# ════ S5: a tip without the script ══════════════════════════════════════════════════════════════════════════════
echo "== S5"
mkdir -p "$T/s5"; git clone -q --bare "$ORIGIN" "$T/s5/plug.git"; git clone -q "$T/s5/plug.git" "$T/s5/plug"
git clone -q "$T/s5/plug.git" "$T/s5/w"; git -C "$T/s5/w" rm -q skills/_shared/scripts/engine-snapshot.py
git -C "$T/s5/w" commit -qm "drop the script"; git -C "$T/s5/w" push -q origin master
es "$T/s5/plug" cut
ok "$rc|$out" "3|" "S5: origin's tip lacks engine-snapshot.py → exit 3"
has "$err" "predates Engine snapshots" "S5: … says why"
ok "$([ -e "$T/s5/plug-snapshots" ] && echo made || echo none)" none "S5: … nothing created"

# ════ S6: a home inside another work tree ═══════════════════════════════════════════════════════════════════════
echo "== S6"
git init -q "$T/outer"; git clone -q "$ORIGIN" "$T/outer/plug"
es "$T/outer/plug" cut
ok "$rc|$out" "3|" "S6: <primary>-snapshots would sit in an outer work tree that tracks it → exit 3"
ok "$([ -e "$T/outer/plug-snapshots" ] && echo made || echo none)" none "S6: … nothing created"
echo 'plug-snapshots/' > "$T/outer/.gitignore"
es "$T/outer/plug" cut
ok "$rc" 0 "S6 control: the outer tree ignores it → 0"

# ════ S7: a squatter at <home>/<sha12> ══════════════════════════════════════════════════════════════════════════
echo "== S7"
push notes/v3.txt v3; V3=$(tip); mkdir -p "$H/${V3:0:12}"; echo mine > "$H/${V3:0:12}/keep.txt"
es "$P" cut
ok "$rc" 3 "S7: a directory already at <home>/<sha12> that is no snapshot → exit 3"
has "$err" "move it aside" "S7: … the remedy"
ok "$(cat "$H/${V3:0:12}/keep.txt")" mine "S7: … the squatter untouched"
rm -rf "$H/${V3:0:12}"

# ════ S8: two concurrent cuts at one tip ════════════════════════════════════════════════════════════════════════
echo "== S8"
python3 "$P/skills/_shared/scripts/engine-snapshot.py" cut > "$T/c1" 2>/dev/null & c1=$!
python3 "$P/skills/_shared/scripts/engine-snapshot.py" cut > "$T/c2" 2>/dev/null & c2=$!
wait "$c1"; r1=$?; wait "$c2"; r2=$?
S3S="$H/${V3:0:12}"
ok "$r1|$r2" "0|0" "S8: two cuts at one tip both exit 0"
ok "$( (out=$(cat "$T/c1"); j 'd["reused"]'; out=$(cat "$T/c2"); j 'd["reused"]') | sort | tr '\n' ' ')" "false true " \
   "S8: … one creates, the other reuses"
ok "$( (out=$(cat "$T/c1"); j 'd["snapshot"]'; out=$(cat "$T/c2"); j 'd["snapshot"]') | sort -u)" "$S3S" "S8: … one snapshot"

# ════ A1-A3: adopt ══════════════════════════════════════════════════════════════════════════════════════════════
echo "== A1"
ro a1
es "$S3S" adopt --rollout "$TASKS/a1.md"
ok "$rc|$(j 'd["changed"]')|$(j 'd["from"]')|$(j 'd["sha"]')" "0|true|null|$V3" "A1: adopt from a snapshot → stamped, no move"
ok "$(sed -n '4,6p' "$TASKS/a1.md" | tr '\n' '|')" "protocol_version: 5|engine_snapshot: \"$S3S\"|engine_sha: $V3|" \
   "A1: … the two stamps just below protocol_version:"
cp "$TASKS/a1.md" "$T/a1.before"
es "$S3S" adopt --rollout a1 --tasks-dir "$TASKS"
ok "$rc|$(j 'd["changed"]')" "0|false" "A1: a second adopt (by slug) → changed false"
cmp -s "$TASKS/a1.md" "$T/a1.before"; ok "$?" 0 "A1: … the note byte-equal"
# ~/-form: a Primary under HOME stamps its snapshot as ~/…
mkdir -p "$HOME/repos/tools"; git clone -q "$ORIGIN" "$HOME/repos/tools/hplug"
es "$HOME/repos/tools/hplug" cut; HS=$(j 'd["snapshot"]')
ro a1h; es "$HS" adopt --rollout "$TASKS/a1h.md"
ok "$(fmv "$TASKS/a1h.md" engine_snapshot)" "\"~/repos/tools/hplug-snapshots/${V3:0:12}\"" "A1: a snapshot under HOME is stamped in ~/-form"
es "$P" resolve --rollout "$TASKS/a1h.md"
ok "$rc|$(j 'd["root"]')" "0|$HS" "A1: … and resolves with the current HOME"

echo "== A2"
ro a2; cp "$TASKS/a2.md" "$T/a2.before"
es "$P" adopt --rollout "$TASKS/a2.md"
ok "$rc" 2 "A2: adopt from the Primary → exit 2"
cmp -s "$TASKS/a2.md" "$T/a2.before"; ok "$?" 0 "A2: … nothing written"
cp "$TASKS/a2.md" "$TASKS/Archive/Rollouts/a2x.md"; cp "$TASKS/a2.md" "$T/a2x.before"
es "$S3S" adopt --rollout "$TASKS/Archive/Rollouts/a2x.md"
ok "$rc" 2 "A2: adopt on an archived note → exit 2"
cmp -s "$TASKS/Archive/Rollouts/a2x.md" "$T/a2x.before"; ok "$?" 0 "A2: … nothing written"
rm -f "$TASKS/Archive/Rollouts/a2x.md"

echo "== A3"
push notes/v4.txt v4; V4=$(tip)
es "$P" cut; S4S=$(j 'd["snapshot"]')
es "$S4S" adopt --rollout "$TASKS/a1.md" --now "$NOW"
ok "$rc|$(j 'd["changed"]')|$(j 'd["from"]')" "0|true|$V3" "A3: adopt from a newer snapshot → a move from the old sha"
ok "$(sed -n '5,6p' "$TASKS/a1.md" | tr '\n' '|')" "engine_snapshot: \"$S4S\"|engine_sha: $V4|" "A3: … the stamps rewritten in place"
ok "$(grep -c '^engine_s' "$TASKS/a1.md")" 2 "A3: … no second stamp line"
ok "$(grep -c "^- 2026-10-26T10:00.* engine snapshot moved at reinstate: ${V3:0:12} → ${V4:0:12} (ADR 0043)\$" "$TASKS/a1.md")" 1 \
   "A3: … the move logged under ## Notes"

# ════ R1: the hand-over is tied to the rendered text ════════════════════════════════════════════════════════════
echo "== R1"
git -C "$P" merge -q --ff-only origin/master
X1=$(embedded "$P/skills/execute/SKILL.md")          # the session renders v1
push skills/execute/SKILL.md "A v2 line."; V5=$(tip)   # v2 lands on origin
git -C "$P" pull -q --ff-only                          # the Primary pulls v2
X2=$(embedded "$P/skills/execute/SKILL.md")
ok "$([ -n "$X1" ] && [ -n "$X2" ] && [ "$X1" != "$X2" ] && echo y)" y "R1: v1 and v2 carry different prose ids"
es "$P" cut --verb execute --prose-id "$X1"; B=$(j 'd["snapshot"]')
ok "$(j 'd["sha"]')|$(j 'd["prose"]["identical"]')" "$V5|false" "R1: cut B at v2; the v1 render is not identical (cut's rule)"
ro r1; es "$B" adopt --rollout "$TASKS/r1.md"
es "$P" resolve --rollout "$TASKS/r1.md" --verb execute --prose-id "$X1"
ok "$rc|$(j 'd["root"]')|$(j 'd["same"]')|$(j 'd["prose"]["identical"]')" "0|$B|false|false" "R1: resolve with the v1 id → root B, not identical"
es "$P" resolve --rollout "$TASKS/r1.md" --verb execute --prose-id "$X2"
ok "$(j 'd["prose"]["rootId"]')|$(j 'd["prose"]["identical"]')" "$X2|true" "R1: … with the v2 id → identical"
es "$P" resolve --rollout "$TASKS/r1.md" --verb execute
ok "$(j 'd["prose"]["identical"]')" false "R1: … no id → not identical"
es "$P" resolve --rollout "$TASKS/r1.md" --verb execute --prose-id '$Id$'
ok "$(j 'd["prose"]["identical"]')" false "R1: … a bare \$Id\$ is no id"
printf 'An edit under the same id line.\n' >> "$P/skills/execute/SKILL.md"
es "$P" resolve --rollout "$TASKS/r1.md" --verb execute --prose-id "$X2"
ok "$(j 'd["prose"]["identical"]')" false "R1: … an edit to the Primary's copy under the X2 line → not identical"
git -C "$P" checkout -q -- skills/execute/SKILL.md
es "$B" resolve --rollout "$TASKS/r1.md" --verb execute --prose-id "$X2"
ok "$(j 'd["same"]')|$(j 'd["prose"]["identical"]')" "true|true" "R1: from B: same and identical"
es "$P" cut --verb execute --prose-id "$X2"
ok "$(j 'd["reused"]')|$(j 'd["prose"]["identical"]')" "true|true" "R1: cut at the same tip reuses B; the v2 id is identical"

# ════ R2-R4 ═════════════════════════════════════════════════════════════════════════════════════════════════════
echo "== R2"
sed 's/^protocol_version: 5$/protocol_version: 99/' "$TASKS/r1.md" > "$TASKS/r2.md"
es "$P" resolve --rollout "$TASKS/r2.md"
ok "$rc|$(j 'd["root"]')" "0|$B" "R2: protocol_version: 99 resolves the same (resolve never reads it)"

echo "== R3"
push notes/v6.txt v6; git -C "$P" pull -q --ff-only; git -C "$P" checkout -q -b elsewhere; echo moved >> "$P/hooks/hooks.json"
es "$P" resolve --rollout "$TASKS/r1.md"
ok "$rc|$(j 'd["root"]')|$(j 'd["sha"]')" "0|$B|$V5" "R3: a pulled, branched, dirty Primary → root is still the snapshot"
ok "$(j 'd["primary"]')|$(j 'd["ahead"]')|$(j 'd["behind"]')" "$P|0|1" "R3: … the snapshot's own counts against the Primary's HEAD (0 ahead, 1 behind it)"
py "$B" skills/execute/scripts/reconcile-rollout.py touched-phases --rollout "$TASKS/r1.md" --tasks-dir "$TASKS"
hasnt "$err" "engine-snapshot:" "R3: … the guards from the snapshot still pass"
git -C "$P" checkout -q -- hooks/hooks.json; git -C "$P" checkout -q master

echo "== R4"
ro r4g 'engine_snapshot: "'"$H"'/000000000000"' "engine_sha: $V5"
es "$P" resolve --rollout "$TASKS/r4g.md"
ok "$rc|$out" "3|" "R4: a live note whose snapshot is gone → exit 3, stdout empty"
has "$err" "is gone: restore it at its sha" "R4: … the reason and the remedy"
ro r4m "engine_snapshot: \"$B\"" "engine_sha: $V4"
es "$P" resolve --rollout "$TASKS/r4m.md"
ok "$rc" 3 "R4: a snapshot not at the stamped sha → exit 3"; has "$err" "is moved (HEAD ${V5:0:12}, not ${V4:0:12})" "R4: … moved"
echo edit >> "$S4S/hooks/hooks.json"
es "$P" resolve --rollout "$TASKS/a1.md"
ok "$rc" 3 "R4: an edited snapshot → exit 3"; has "$err" "edited (tracked files changed)" "R4: … edited"
git -C "$S4S" checkout -q -- hooks/hooks.json
ro r4u
es "$P" resolve --rollout "$TASKS/r4u.md"
ok "$rc|$(j 'd["root"]')|$(j 'd["same"]')|$(j 'd["snapshot"]')" "0|$P|true|null" "R4: an unstamped note's root is the Primary (from the Primary)"
es "$B" resolve --rollout "$TASKS/r4u.md"
ok "$(j 'd["root"]')|$(j 'd["same"]')" "$P|false" "R4: … and from a snapshot of it"
es "$CL" resolve --rollout "$TASKS/r4u.md"
ok "$rc|$(j 'd["root"]')|$(j 'd["primary"]')" "0|$CACHE|null" "R4: from the nested cache copy (through its symlink) → its realpath, never $CC"
es "$BARE" resolve --rollout "$TASKS/r4u.md"
ok "$(j 'd["root"]')|$(j 'd["primary"]')" "$BARE|null" "R4: … and the bare cache copy's"
cp "$TASKS/r4g.md" "$TASKS/Archive/Rollouts/r4a.md"
es "$P" resolve --rollout r4a --tasks-dir "$TASKS"
ok "$rc|$(j 'd["archived"]')|$(j 'd["gone"]')|$(j 'd["root"]')" "0|true|true|$P" "R4: an archived note whose snapshot is gone → 0, gone, the unstamped root"

# ════ M1: the move rule ═════════════════════════════════════════════════════════════════════════════════════════
echo "== M1"
due() { es "$P" resolve --rollout "$TASKS/$1.md"; j 'd["move"]["due"]'; }
STAMP="engine_snapshot: \"$B\""; SHA="engine_sha: $V5"
ro m1h "$STAMP" "$SHA" "paused: 2026-10-26T09:00+00:00"
ok "$(due m1h)" true "M1: a hard pause (paused: alone) → due"
ro m1s "$STAMP" "$SHA" "paused: 2026-10-26T09:00+00:00" 'superseded_by: "[[m1h]]"'
ok "$(due m1s)" false "M1: … with superseded_by: → not due"
ro m1u "paused: 2026-10-26T09:00+00:00"
ok "$(due m1u)" false "M1: … no stamp → not due"
ro m1d "$STAMP" "$SHA" "paused: 2026-10-26T09:00+00:00"; sed -i.bak 's/^status: open$/status: done/' "$TASKS/m1d.md"; rm -f "$TASKS/m1d.md.bak"
ok "$(due m1d)" false "M1: … status done → not due"
ro m1g "$STAMP" "$SHA" "paused: 2026-10-26T09:00+00:00" "paused_for: sign-off"
es "$P" resolve --rollout "$TASKS/m1g.md"
ok "$(j 'd["move"]["due"]')|$(j 'd["move"]["why"]')" "false|sign-off pause (ADR 0034): the engine's own pause, never a move" \
   "M1: a sign-off pause → not due, the sign-off why"
# the session holds a signed-gate record; origin moves; execute § 1.5's sequence with move.due false is resolve alone
mkdir -p "$T/session"; echo '{"gate": "spend: x", "handle": "wf_signed"}' > "$T/session/signed-gate.json"
push notes/v7.txt v7; V7=$(tip)
es "$P" resolve --rollout "$TASKS/m1g.md" --verb execute
ok "$rc|$(j 'd["move"]["due"]')|$(j 'd["root"]')" "0|false|$B" "M1: … § 1.5 resolves on its snapshot and moves nothing"
ok "$([ -e "$H/${V7:0:12}" ] || [ -e "$H/.cut/${V7:0:12}" ] && echo cut || echo none)|$(cat "$T/session/signed-gate.json")" \
   'none|{"gate": "spend: x", "handle": "wf_signed"}' "M1: … no new snapshot, no .cut marker, the signed-gate record kept"
py "$B" skills/execute/scripts/reconcile-rollout.py clear-pause --rollout "$TASKS/m1g.md" --tasks-dir "$TASKS"
ok "$rc|$(fmv "$TASKS/m1g.md" paused)|$(fmv "$TASKS/m1g.md" paused_for)" "0|<none>|<none>" "M1: clear-pause (signed) from the snapshot reinstates it"
ok "$(due m1g)" false "M1: … unpaused → not due"
sed -i.bak 's/^engine_sha: .*/&\npaused: 2026-10-26T11:00+00:00/' "$TASKS/m1g.md"; rm -f "$TASKS/m1g.md.bak"
ok "$(due m1g)" true "M1: … a later hard pause → due"
# serial
LOG='## Leg log

- 2026-10-26T08:00+00:00 Leg 1 began: leg-1 session s1 in cc-demo from '"$T/launch"'
'
BODY="$LOG- 2026-10-26T08:30+00:00 Leg 1 closed: stopped: Lachy stopped the chain
" sro m1r "$STAMP" "$SHA"
ok "$(due m1r)" true "M1: serial: Leg 1 closed stopped → due"
es "$P" cut; MS=$(j 'd["snapshot"]')
es "$MS" adopt --rollout "$TASKS/m1r.md"; ok "$rc|$(j 'd["from"]')" "0|$V5" "M1: … cut and adopt move it"
(cd "$T/launch" && python3 "$MS/skills/execute/scripts/leg.py" begin --rollout "$TASKS/m1r.md" --tasks-dir "$TASKS" --session s2 \
   --now 2026-10-26T09:00+00:00 > "$T/out" 2> "$T/err"); rc=$?
ok "$rc" 0 "M1: … leg.py begin from the new snapshot → 0"; hasnt "$(cat "$T/err")" "engine-snapshot:" "M1: … the guard passes there"
ok "$(due m1r)" false "M1: … Leg 2 began → not due"
BODY="$LOG- 2026-10-26T08:30+00:00 Leg 1 closed: halted: a red verify
" sro m1t "$STAMP" "$SHA"
ok "$(due m1t)" false "M1: serial: a halted close → not due"
BODY="$LOG- 2026-10-26T08:30+00:00 Leg 1 closed: halted: a red verify
- 2026-10-26T08:40+00:00 halt cleared: fixed
" sro m1c "$STAMP" "$SHA"
ok "$(due m1c)" false "M1: … halt cleared → still not due"
BODY="$LOG- 2026-10-26T08:30+00:00 Leg 1 closed: handoff to Leg 2 in cc-demo from $T/launch
" sro m1o "$STAMP" "$SHA"
ok "$(due m1o)" false "M1: serial: a handoff close → not due"

# ════ G1: every wrong-root CLI refuses ══════════════════════════════════════════════════════════════════════════
echo "== G1"
ro g1 "$STAMP" "$SHA" "paused: 2026-10-26T09:00+00:00"
printf -- '---\ntags: [task]\nstatus: review\nrollout: "[[g1]]"\nintegrating: 2026-10-26T09:00+00:00\npr: https://github.com/o/r/pull/7\n---\n\n## Notes\n\nA task.\n' > "$TASKS/gt1.md"
BODY="$LOG" sro sg1 "$STAMP" "$SHA"
refused() {  # refused <label> <note>...: $rc 2, an engine-snapshot: line naming B, every note byte-equal
  local l="$1" n; shift
  ok "$rc" 2 "G1: $l from the Primary → exit 2"
  has "$err" "engine-snapshot: [[" "G1: … $l prints the engine-snapshot: line"
  has "$err" "$B" "G1: … naming the snapshot to re-run from"
  for n in "$@"; do cmp -s "$TASKS/$n.md" "$T/before.$n"; ok "$?" 0 "G1: … $l wrote nothing to $n"; done
}
keep() { local n; for n in "$@"; do cp "$TASKS/$n.md" "$T/before.$n"; done; }
keep g1 gt1 sg1
py "$P" skills/execute/scripts/reconcile-rollout.py clear-pause --rollout "$TASKS/g1.md" --tasks-dir "$TASKS"; refused "reconcile-rollout clear-pause" g1
py "$P" skills/execute/scripts/reconcile-rollout.py carry --from "$TASKS/g1.md" --dry-run --tasks-dir "$TASKS"; refused "reconcile-rollout carry --from" g1
# the task-keyed verbs with --rollout left off: the guard asks about each --tasks slug's rollout (and reconcile's rows')
evsum() { find "$THREAD_EVENTS_DIR" -type f -exec cksum {} + 2>/dev/null | sort; }
ev0=$(evsum)
py "$P" skills/execute/scripts/reconcile-rollout.py hand-back --tasks gt1 --tasks-dir "$TASKS"; refused "reconcile-rollout hand-back --tasks (no --rollout)" gt1 g1
py "$P" skills/execute/scripts/reconcile-rollout.py approve-gates --tasks gt1 --tasks-dir "$TASKS"; refused "reconcile-rollout approve-gates --tasks (no --rollout)" gt1 g1
py "$P" skills/execute/scripts/reconcile-rollout.py mark-done --tasks gt1 --tasks-dir "$TASKS"; refused "reconcile-rollout mark-done --tasks (no --rollout)" gt1 g1
ROW='{"tasks": [{"slug": "gt1", "status": "review", "prUrl": "https://github.com/o/r/pull/7"}]}'
printf '%s' "$ROW" | python3 "$P/skills/execute/scripts/reconcile-rollout.py" reconcile --result - --tasks-dir "$TASKS" > "$T/out" 2> "$T/err"; rc=$?
err=$(cat "$T/err"); refused "reconcile-rollout reconcile --result - (its row's task)" gt1 g1
ok "$(evsum)" "$ev0" "G1: … none of them wrote the Run record"
py "$P" skills/execute/scripts/git-env-canary.py check-all --rollout "$TASKS/g1.md" --tasks-dir "$TASKS"; refused "git-env-canary check-all" g1
ok "$([ -e "$T/git-env/g1" ] || [ -e "$T/git-env/g1.lock" ] && echo made || echo none)" none "G1: … the canary made no state"
echo "a room stop" | python3 "$P/skills/execute/scripts/step-boundary.py" begin --rollout "$TASKS/g1.md" > "$T/out" 2> "$T/err"; rc=$?
err=$(cat "$T/err"); refused "step-boundary begin" g1
py "$P" skills/execute/scripts/leg.py next --rollout "$TASKS/sg1.md" --tasks-dir "$TASKS"; refused "leg.py next" sg1
py "$P" skills/reflect/scripts/close-score.py --rollout "$TASKS/g1.md" --close completion; refused "close-score" g1
th=$(git -C "$T/target" rev-parse HEAD)
py "$P" skills/execute/scripts/lead-integrate.py prepare --repo "$T/target" --slug gt1 --default master --note "$TASKS/gt1.md"
refused "lead-integrate prepare" gt1 g1
ok "$(git -C "$T/target" rev-parse HEAD)|$(git -C "$T/target" rev-list --merges --count HEAD)" "$th|0" "G1: … the task tree's HEAD unchanged, no merge"
echo "own reason" | python3 "$P/skills/execute/scripts/lead-integrate.py" set-aside --note "$TASKS/gt1.md" --kind own > "$T/out" 2> "$T/err"; rc=$?
err=$(cat "$T/err"); refused "lead-integrate set-aside" gt1; ok "$(cat "$T/out")" "" "G1: … set-aside printed no row"
rm -f "$T/gh.log"
out=$(bash "$P/skills/execute/scripts/merge-task.sh" "$T/target" https://github.com/o/r/pull/7 "$(printf 'a%.0s' $(seq 40))" "$(printf 'b%.0s' $(seq 40))" 2>"$T/err"); rc=$?
err=$(cat "$T/err"); refused "merge-task" gt1 g1
ok "$([ -s "$T/gh.log" ] && echo called || echo none)|$([ -e "$T/target/.claude/merge-task" ] && echo made || echo none)" "none|none" \
   "G1: … merge-task made no gh call and no counter dir"
# the same commands from the right root print no engine-snapshot: line
py "$B" skills/execute/scripts/git-env-canary.py check-all --rollout "$TASKS/g1.md" --tasks-dir "$TASKS"; hasnt "$err" "engine-snapshot:" "G1: from B: the canary passes the guard"
py "$B" skills/execute/scripts/leg.py next --rollout "$TASKS/sg1.md" --tasks-dir "$TASKS"; hasnt "$err" "engine-snapshot:" "G1: from B: leg.py passes"
py "$B" skills/reflect/scripts/close-score.py --rollout "$TASKS/g1.md" --close completion; hasnt "$err" "engine-snapshot:" "G1: from B: close-score passes"
py "$B" skills/execute/scripts/lead-integrate.py prepare --repo "$T/target" --slug gt1 --default master --note "$TASKS/gt1.md"
hasnt "$err" "engine-snapshot:" "G1: from B: lead-integrate prepare passes"
echo "own reason" | python3 "$B/skills/execute/scripts/lead-integrate.py" set-aside --note "$TASKS/gt1.md" --kind own > "$T/setaside.row" 2> "$T/err"
hasnt "$(cat "$T/err")" "engine-snapshot:" "G1: from B: set-aside passes"
py "$B" skills/execute/scripts/reconcile-rollout.py approve-gates --tasks gt1 --tasks-dir "$TASKS"
ok "$rc" 1 "G1: from B: approve-gates --tasks gt1 passes the guard to its own status check → 1"
hasnt "$err" "engine-snapshot:" "G1: … no engine-snapshot: line"; has "$err" "refusing to approve gates" "G1: … its own refusal"
# set-aside's row ({rolloutSlug, tasks}), reconciled from B through stdin (the guard reads it once), then handed back
python3 "$B/skills/execute/scripts/reconcile-rollout.py" reconcile --result - --tasks-dir "$TASKS" --now "$NOW" < "$T/setaside.row" > "$T/out" 2> "$T/err"; rc=$?
ok "$rc|$(fmv "$TASKS/gt1.md" status)" "0|blocked" "G1: from B: reconcile --result - passes the guard and writes the row it read once from stdin"
hasnt "$(cat "$T/err")" "engine-snapshot:" "G1: … no engine-snapshot: line"
py "$B" skills/execute/scripts/reconcile-rollout.py hand-back --tasks gt1 --tasks-dir "$TASKS" --now "$NOW"
ok "$rc" 0 "G1: from B: hand-back --tasks gt1 passes the guard and hands it back → 0"
hasnt "$err" "engine-snapshot:" "G1: … no engine-snapshot: line"
out=$(bash "$B/skills/execute/scripts/merge-task.sh" "$T/target" https://github.com/o/r/pull/7 "$(printf 'a%.0s' $(seq 40))" "$(printf 'b%.0s' $(seq 40))" 2>&1)
hasnt "$out" "engine-snapshot:" "G1: from B: merge-task passes the guard"; ok "$([ -s "$T/gh.log" ] && echo called)" called "G1: … and reaches gh"
echo "a room stop" | python3 "$B/skills/execute/scripts/step-boundary.py" begin --rollout "$TASKS/g1.md" > "$T/out" 2> "$T/err"; rc=$?
ok "$rc" 0 "G1: from B: step-boundary begin → 0"; hasnt "$(cat "$T/err")" "engine-snapshot:" "G1: … no engine-snapshot: line"
py "$B" skills/execute/scripts/reconcile-rollout.py clear-pause --rollout "$TASKS/g1.md" --tasks-dir "$TASKS"
ok "$rc|$(fmv "$TASKS/g1.md" paused)" "0|<none>" "G1: from B: clear-pause writes"

# ════ G2: the exemptions ════════════════════════════════════════════════════════════════════════════════════════
echo "== G2"
pass() { hasnt "$err" "engine-snapshot:" "G2: $1 from the Primary passes"; }
py "$P" skills/execute/scripts/reconcile-rollout.py status --rollout "$TASKS/g1.md" --tasks-dir "$TASKS"; pass "reconcile-rollout status"
py "$P" skills/execute/scripts/reconcile-rollout.py fold-journals --rollout "$TASKS/g1.md" --dry-run; pass "fold-journals"
py "$P" skills/execute/scripts/step-boundary.py stands --rollout "$TASKS/g1.md"; pass "step-boundary stands"
py "$P" skills/execute/scripts/leg.py status --rollout "$TASKS/sg1.md" --tasks-dir "$TASKS"; pass "leg.py status"
py "$P" skills/execute/scripts/lead-integrate.py inputs --note "$TASKS/gt1.md"; pass "lead-integrate inputs"
py "$P" skills/execute/scripts/lead-integrate.py plan --note "$TASKS/gt1.md"; pass "lead-integrate plan"
rm -f "$T/gh.log"
out=$(bash "$P/skills/execute/scripts/merge-task.sh" "$T/target" https://github.com/o/r/pull/8 "$(printf 'a%.0s' $(seq 40))" "$(printf 'b%.0s' $(seq 40))" 2>&1)
hasnt "$out" "engine-snapshot:" "G2: merge-task on a PR no live note names passes"; ok "$([ -s "$T/gh.log" ] && echo called)" called "G2: … and reaches gh"
py "$P" skills/execute/scripts/reconcile-rollout.py touched-phases --rollout "$TASKS/r4u.md" --tasks-dir "$TASKS"; pass "an unstamped note"
py "$B" skills/execute/scripts/reconcile-rollout.py touched-phases --rollout "$TASKS/r4u.md" --tasks-dir "$TASKS"
hasnt "$err" "engine-snapshot:" "G2: an unstamped note from a snapshot passes"
py "$P" skills/execute/scripts/reconcile-rollout.py touched-phases --rollout "$TASKS/Archive/Rollouts/r4a.md" --tasks-dir "$TASKS"
pass "an archived note whose snapshot is gone"
py "$B" skills/execute/scripts/reconcile-rollout.py touched-phases --rollout "$TASKS/r4g.md" --tasks-dir "$TASKS"
ok "$rc" 2 "G2: a live note whose snapshot is gone refuses from any root"; has "$err" "is gone" "G2: … with gone"

# ════ G4: schedule step 6's defer of a Pre-flight leaver, from the prior's root, before its carry ═══════════════
# schedule § 1.5 (ADR 0047) leaves out a carried task still queued; step 6 takes it off the prior with the existing
# `defer --tasks --rollout` (flags every snapshot has), run from the prior's root, then carries the rest from there.
echo "== G4"
G4EV="$T/g4-events"
ro g4 "$STAMP" "$SHA"
ro g4n 'supersedes: "[[g4]]"'
g4t() { printf -- '---\ntags: [task]\nstatus: %s\nprojects:\n  - "[[Demo]]"\nrollout: "[[g4]]"\n---\n\n## Notes\n\nA task.\n' "$2" > "$TASKS/$1.md"; }
g4t g4-q open; g4t g4-q2 open; g4t g4-s in_progress
keep g4 g4n g4-q g4-q2 g4-s
THREAD_EVENTS_DIR="$G4EV" py "$P" skills/execute/scripts/reconcile-rollout.py defer --tasks g4-q --rollout "$TASKS/g4.md" --tasks-dir "$TASKS"
ok "$rc" 2 "G4: defer of a prior's task from this run's root (the Primary) → exit 2"
has "$err" "engine-snapshot: [[" "G4: … the engine-snapshot: line"; has "$err" "$B" "G4: … naming the prior's snapshot"
for n in g4 g4-q; do cmp -s "$TASKS/$n.md" "$T/before.$n"; ok "$?" 0 "G4: … $n byte-identical"; done
THREAD_EVENTS_DIR="$G4EV" py "$B" skills/execute/scripts/reconcile-rollout.py defer --tasks g4-q --rollout "$TASKS/g4.md" --tasks-dir "$TASKS"
ok "$rc" 0 "G4: the same defer from the prior's root → 0"; hasnt "$err" "engine-snapshot:" "G4: … no engine-snapshot: line"
ok "$(fmv "$TASKS/g4-q.md" rollout)|$(fmv "$TASKS/g4-q.md" status)" "<none>|open" "G4: … g4-q is unlinked and open"
THREAD_EVENTS_DIR="$G4EV" py "$B" skills/execute/scripts/reconcile-rollout.py carry --from "$TASKS/g4.md" --to "$TASKS/g4n.md" --tasks-dir "$TASKS"
ok "$rc" 0 "G4: then the carry from the prior's root → 0"
has "$out" "carry g4-q2 queued" "G4: … carries the queued task left in"; has "$out" "carry g4-s running" "G4: … and the started one"
hasnt "$out" "g4-q " "G4: … and never names the leaver"
ok "$(fmv "$TASKS/g4-q2.md" rollout)|$(fmv "$TASKS/g4-s.md" rollout)|$(fmv "$TASKS/g4-q.md" rollout)" \
   '"[[g4n]]"|"[[g4n]]"|<none>' "G4: … g4-q2 and g4-s link g4n, g4-q links nothing"
# rec <record> [kind]: the sorted tasks of a Run record's lines (of that kind), one line; none when it is absent
rec() { python3 -c 'import json, sys
try:
    rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
except OSError:
    rows = []
print(" ".join(sorted(str(r.get("task")) for r in rows if len(sys.argv) < 3 or r.get("kind") == sys.argv[2])))' "$@"; }
ok "$(rec "$G4EV/g4n.jsonl" carried)" "g4-q2 g4-s" "G4: … g4n's Run record carries g4-q2 and g4-s only"
case " $(rec "$G4EV/g4.jsonl") " in *" g4-q "*) ok has none "G4: … and g4's record has no line for g4-q";; *) ok none none "G4: … and g4's record has no line for g4-q";; esac

# ════ K1: the settings schema across versions ═══════════════════════════════════════════════════════════════════
echo "== K1"
mkdir -p "$HOME/.config/thread"
printf 'schema = 3\n\n[defaults]\nfoo_bar = 3\nparallel_ceiling = 3\n' > "$HOME/.config/thread/rollouts.toml"
py "$B" skills/_shared/scripts/rollout-settings.py
ok "$rc|$(j 'd["ignored"]')|$(j 'd["schema"]')|$(j 'd["settings"]["parallel_ceiling"]["value"]')" \
   '0|["defaults.foo_bar"]|{"file": 3, "engine": 2}|3' "K1: a schema-3 file's unknown key is ignored by the snapshot's reader"
py "$B" skills/execute/scripts/reconcile-rollout.py verify-timeout --rollout "$TASKS/r1.md"
ok "$rc" 0 "K1: … verify-timeout on a stamped note runs (no exit 3)"
printf 'schema = 3\n\n[defaults]\nparalel_ceiling = 3\n' > "$HOME/.config/thread/rollouts.toml"
py "$B" skills/_shared/scripts/rollout-settings.py
ok "$rc" 2 "K1: … a near-miss typo is still refused"; has "$err" "paralel_ceiling" "K1: … naming it"
rm -f "$HOME/.config/thread/rollouts.toml"

# ════ H1: ADR 0031's hold ═══════════════════════════════════════════════════════════════════════════════════════
echo "== H1"
HH="$T/h1home"; HT="$HH/repos/obsidian/Work/Tasks"; mkdir -p "$HT"
mkh() {  # mkh <name> [frontmatter line]: a started protocol-5 rollout (its task carries owner:)
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n%s\n---\n' "${2:-}" > "$HT/$1.md"
  printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[%s]]"\nowner: lead\n---\n' "$1" > "$HT/$1-task.md"; }
mkh h-snap "$STAMP"; mkh h-old
out=$(HOME="$HH" python3 "$P/skills/_shared/scripts/unfinished-rollout.py" running)
ok "$out" "running h-old" "H1: running leaves out a snapshotted note and lists the unsnapshotted one"
out=$(HOME="$HH" bash "$B/skills/_shared/scripts/primary-hold.sh" "$P")
ok "$out" "[[h-old]] running on it" "H1: primary-hold from a snapshot holds its Primary for the unsnapshotted rollout"
out=$(HOME="$HH" bash "$P/skills/_shared/scripts/primary-hold.sh" "$P")
ok "$out" "[[h-old]] running on it" "H1: … and from the Primary itself, as before"
out=$(HOME="$HH" bash "$B/skills/_shared/scripts/primary-hold.sh" "$B")
ok "$out" "" "H1: … the snapshot directory itself is never held"
out=$(HOME="$HH" bash "$CL/skills/_shared/scripts/primary-hold.sh" "$CC")
ok "$out" "" "H1: from the nested cache copy: its enclosing repo is never held"
out=$(HOME="$HH" bash "$CL/skills/_shared/scripts/primary-hold.sh" "$P")
ok "$out" "" "H1: … nor any other checkout (no hold, as today)"
rm -f "$HT/h-old.md" "$HT/h-old-task.md"
out=$(HOME="$HH" bash "$B/skills/_shared/scripts/primary-hold.sh" "$P")
ok "$out" "" "H1: only a snapshotted rollout runs → nothing holds"

# ════ G3: file-followup after Complete, then the retire race ════════════════════════════════════════════════════
echo "== G3"
push notes/v8.txt v8; V8=$(tip); es "$P" cut; GS=$(j 'd["snapshot"]')
BODY="$LOG- 2026-10-26T08:30+00:00 Leg 1 closed: chain complete
" sro g3 'completed: 2026-10-26'
es "$GS" adopt --rollout "$TASKS/g3.md"
sed -i.bak 's/^status: open$/status: done/' "$TASKS/g3.md"; rm -f "$TASKS/g3.md.bak"
mv "$TASKS/g3.md" "$TASKS/Archive/Rollouts/g3.md"; AM=$(mtime "$TASKS/Archive/Rollouts/g3.md")
py "$GS" skills/execute/scripts/leg.py file-followup --rollout g3 --tasks-dir "$TASKS" --title "audit the site" --why "after the chain"
ok "$rc|$(j 'd["pointer"]')" "0|false" "G3: file-followup from the snapshot after Complete → 0, no pointer"
ok "$(ls "$TASKS" | grep -c 'followup-audit-the-site')" 1 "G3: … the task filed"
py "$P" skills/execute/scripts/leg.py file-followup --rollout g3 --tasks-dir "$TASKS" --title "audit again" --why x
ok "$rc" 2 "G3: … from the Primary it refuses"; has "$err" "engine-snapshot:" "G3: … with the engine-snapshot: line"
es "$GS" retire --tasks-dir "$TASKS"
has "$out" "kept ${V8:0:12}: own root" "G3: retire from the snapshot keeps its own root"
es "$P" retire --tasks-dir "$TASKS" --now "$(iso $((AM + 3600)))"
has "$out" "kept ${V8:0:12}: archived [[g3]] within 24h" "G3: retire from the Primary an hour later keeps it for the archived note"
ok "$([ -d "$GS" ] && echo y)" y "G3: … the snapshot stays"

echo "== G3b"
setmtime "$H/.cut/${V8:0:12}" "$AM"
es "$P" retire --tasks-dir "$TASKS" --now "$(iso $((AM + 25 * 3600)))"
has "$out" "retired ${V8:0:12}" "G3b: another session's sweep past the grace retires it"
ok "$([ -f "$GS/skills/execute/scripts/leg.py" ] && echo y || echo n)|$(git -C "$P" worktree list | grep -c "$GS")" "n|0" \
   "G3b: … its leg.py is no file, its worktree gone"
es "$P" resolve --rollout g3 --tasks-dir "$TASKS"
ok "$rc|$(j 'd["gone"]')|$(j 'd["root"]')" "0|true|$P" "G3b: close's fallback: resolve again → gone, the Primary"
py "$P" skills/execute/scripts/leg.py file-followup --rollout g3 --tasks-dir "$TASKS" --title "audit once more" --why y
ok "$rc" 0 "G3b: … file-followup from that root → 0"; ok "$(ls "$TASKS" | grep -c 'followup-audit-once-more')" 1 "G3b: … the task filed"

# ════ T1-T2: retire ═════════════════════════════════════════════════════════════════════════════════════════════
echo "== T1"
push notes/t1a.txt a; es "$P" cut; N1=$(j 'd["sha12"]')
ro t1n "engine_snapshot: \"$H/$N1\"" "engine_sha: $(tip)" "paused: 2026-10-26T09:00+00:00"
push notes/t1b.txt b; es "$P" cut; N2=$(j 'd["sha12"]')
push notes/t1c.txt c; es "$P" cut; N3=$(j 'd["sha12"]')
setmtime "$H/.cut/$N1" 1000000000; setmtime "$H/.cut/$N3" 1000000000
es "$P" retire --tasks-dir "$T/nowhere"
ok "$rc|$(printf '%s\n' "$out" | grep -c '^retired')" "0|0" "T1: a missing tasks dir → everything kept"
has "$out" "kept $N3: the tasks dir $T/nowhere cannot be read" "T1: … saying why"
es "$P" retire --tasks-dir "$TASKS"
ok "$rc" 0 "T1: retire from the Primary → 0"
has "$out" "kept $N1: named by [[t1n]]" "T1: a hard-paused live note's snapshot is kept"
has "$out" "kept $N2: unnamed, cut 0h ago, within the 24h grace" "T1: an unnamed snapshot with a young .cut is kept"
has "$out" "retired $N3" "T1: an unnamed snapshot with an old .cut is retired"
ok "$([ -e "$H/$N3" ] && echo y || echo n)|$(git -C "$P" worktree list | grep -c "$H/$N3")|$([ -e "$H/.cut/$N3" ] && echo y || echo n)" \
   "n|0|n" "T1: … removed, pruned and its marker gone"
es "$H/$N2" retire --tasks-dir "$TASKS"
has "$out" "kept $N2: own root" "T1: from a snapshot, its own root is kept"

echo "== T2"
push notes/t2.txt t2; es "$P" cut; N4=$(j 'd["sha12"]')
ro t2n; es "$H/$N4" adopt --rollout "$TASKS/t2n.md"; mv "$TASKS/t2n.md" "$TASKS/Archive/Rollouts/t2n.md"
AM=$(mtime "$TASKS/Archive/Rollouts/t2n.md"); setmtime "$H/.cut/$N4" "$AM"
es "$P" retire --tasks-dir "$TASKS" --now "$(iso $((AM + 3600)))"
has "$out" "kept $N4: archived [[t2n]] within 24h" "T2: archived an hour ago → kept"
chmod 000 "$TASKS/Archive/Rollouts"
es "$P" retire --tasks-dir "$TASKS" --now "$(iso $((AM + 25 * 3600)))"
ok "$rc|$(printf '%s\n' "$out" | grep -c '^retired')" "0|0" "T2: Archive/Rollouts cannot be listed → everything kept, exit 0"
has "$out" "cannot be listed" "T2: … saying why"
chmod 755 "$TASKS/Archive/Rollouts"
es "$P" retire --tasks-dir "$TASKS" --now "$(iso $((AM + 25 * 3600)))"
has "$out" "retired $N4" "T2: archived 25 h ago → retired"
push notes/t2b.txt t2b; es "$P" cut; N5=$(j 'd["sha12"]'); setmtime "$H/.cut/$N5" 1000000000
mkdir -p "$T/t2vault/Work/Tasks"
es "$P" retire --tasks-dir "$T/t2vault/Work/Tasks"
has "$out" "retired $N5" "T2: no Archive/Rollouts dir → the old orphan is retired"
es "$CL" retire --tasks-dir "$TASKS"
ok "$rc|$out" "0|retire: no git Primary (the plugin root is not its work tree's toplevel (a version-cache install)): nothing to retire" \
   "T2: from the nested cache copy → no git Primary, exit 0"

echo
if [ "$fail" -eq 0 ]; then echo "engine-snapshot: ALL PASS"; else echo "engine-snapshot: FAILED"; fi
exit "$fail"
