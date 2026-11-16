#!/usr/bin/env bash
# p43-2 (ADR 0073 d1): the Fast tier. tests/lib/fast-tier.py's `select` (S1-S16: p54-4's docs carriers in S15, the
# reach one carrier deep in S2 and S6, READERS in S16) and the untracked paths it leaves out (U1-U4), and `check`
# (C1-C3, the Slow tier's check (j), check (k)'s READERS controls and its check (d) case among C2's controls, and the
# unstaged ones, which check an untracked helper or script as a worktree holds it before `git add`; C4 pins
# contract-text's skillCount) on throwaway repos, its results on the real tree (R1-R8, the Slow tier's `slow` and
# --shard-plan in R9-R10, and R11-R12's SKILL.md and docs reach through one index), tests/run.sh's --fast, --only,
# --shard and --shard-plan modes on a fixture checkout (F1-F22, with F2b's untracked note; p54-3's node order, warm
# knob and node-run.mjs signals in F23-F25; p54-10's --fast --shard in F26), and THREAD_SKIP_SLOW's filter on a second
# one (G1-G7, p54-1, ADR 0084 d3; tests/ci-workflows.test.mjs S1 runs --shard-plan on the real tree). Each throwaway
# repo has a local bare origin and a copy of the selector; no network, nothing written outside temp. Fixture basenames all start with zz, which no tracked
# file uses. The fixture runs leave the warm's stdlib half out (THREAD_TEST_WARM_STDLIB=0, exported before F1), all but
# F24's. bash 3.2-compatible (macOS).
set -uo pipefail
export PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
root=$(pwd -P)
SEL="$root/tests/lib/fast-tier.py"
TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
trap 'rm -rf "$TMP"' EXIT
# The fixture checkout binds scripts/merge-task.sh (a stub) and its run.sh copy reaches a verify-slot pool's knobs, so
# the Run record, the verify slots and the Heat hold's reading stay in temp even when this suite runs alone.
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"
export THREAD_VERIFY_SLOTS_DIR="$TMP/verify-slots"
export THREAD_HEAT_LEVEL=0
export HOME="$TMP/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL="$TMP/gitconfig"
unset $(git rev-parse --local-env-vars)
git config --global user.name "fast-tier-tests"; git config --global user.email "fast-tier-tests@example.invalid"
git config --global init.defaultBranch main

nl=$'\n'; tab=$'\t'

# mkrepo <dir>: an empty repo whose origin is a local bare repo, holding a copy of the selector.
mkrepo() {
  rm -rf "$1" "$1.git"; mkdir -p "$1/tests/lib"
  git init -q --bare "$1.git"; git -C "$1" init -q; git -C "$1" remote add origin "$1.git"
  cp "$SEL" "$1/tests/lib/fast-tier.py"
}
# holds <text> <sub> <yes> <no>: <yes> when <text> holds <sub>, else <no> (a function: bash 3.2 misparses a case in $(...)).
holds() { case "$1" in *"$2"*) printf '%s' "$3" ;; *) printf '%s' "$4" ;; esac; }
# put <dir> <path> <text>: one file, its parents made.
put() { mkdir -p "$(dirname "$1/$2")"; printf '%s\n' "$3" > "$1/$2"; }
# map <dir> <line>...: the repo's tests/fast-tier.map.
map() { local d="$1"; shift; printf '%s\n' "$@" > "$d/tests/fast-tier.map"; }
# sel <dir> <arg>...: the select output on one line, tabs as |, lines joined by a space. It stages the fixture first, so
# its files are tracked, as carriers must be (an index read only; `git diff <merge base>` reads the working tree).
sel() { local d="$1"; shift; git -C "$d" add -A >/dev/null 2>&1; python3 "$d/tests/lib/fast-tier.py" select "$@" 2>&1 | tr '\t\n' '| ' | sed 's/ $//'; }
# selr <dir> <arg>...: the same with no staging, stdout only; stderr goes to $TMP/selr.err (S12, U1-U4).
selr() { local d="$1"; shift; python3 "$d/tests/lib/fast-tier.py" select "$@" 2>"$TMP/selr.err" | tr '\t\n' '| ' | sed 's/ $//'; }
# chk <dir>: index the repo's files, then check (its output; $? is check's). chku: check with nothing staged.
chku() { python3 "$1/tests/lib/fast-tier.py" check 2>&1; }
chk() { git -C "$1" add -A >/dev/null 2>&1; chku "$1"; }
# push <dir> <msg>: commit everything and push it to origin's main, which origin/HEAD then names.
push() {
  git -C "$1" add -A && git -C "$1" commit -qm "$2" && git -C "$1" push -q origin HEAD:main 2>/dev/null &&
    git -C "$1" remote set-head origin main >/dev/null 2>&1
}

# ════ select ════════════════════════════════════════════════════════════════════════════════════════════════════
echo "== select"
D="$TMP/s1"; mkrepo "$D"
put "$D" skills/x/scripts/zzleaf.py 'X = 1'
put "$D" tests/zzleaf-a.test.sh 'python3 skills/x/scripts/zzleaf.py'
put "$D" tests/zzother.test.sh 'echo other'
put "$D" tests/zzextra.test.mjs '// extra'
map "$D" 'skills/**' 'skills/x/scripts/zzleaf.py tests/zzextra.test.mjs' 'tests/*.test.*'
ok "$(sel "$D" --paths skills/x/scripts/zzleaf.py)" "FAST|-|-|1 tests/zzextra.test.mjs tests/zzleaf-a.test.sh" \
  "S1: a leaf script selects the tests that name it plus its lines' entries, nothing else"

D="$TMP/s2"; mkrepo "$D"
put "$D" skills/x/scripts/zzleaf.py 'X = 1'
put "$D" skills/x/scripts/zzloader.py 'import os
HERE = os.path.dirname(os.path.abspath(__file__))
LEAF = os.path.join(HERE, "zzleaf.py")'
put "$D" tests/zzsuite-loader.test.mjs "// drives skills/x/scripts/zzloader.py"
put "$D" skills/x/scripts/zzleaf2.py 'Y = 2'
put "$D" skills/x/scripts/zzmid.py 'MID = "zzleaf2.py"'
put "$D" skills/x/scripts/zztop.sh 'python3 "$(dirname "$0")/zzmid.py"'
put "$D" tests/zztop.test.sh 'bash skills/x/scripts/zztop.sh'
map "$D" 'skills/**' 'tests/*.test.*'
ok "$(sel "$D" --paths skills/x/scripts/zzleaf.py)" "FAST|-|-|1 tests/zzsuite-loader.test.mjs" \
  "S2: a script loaded by path reaches its loader's suite, which never names it"
# p54-4: the reach stops one carrier deep, so a chain of three (zzleaf2 <- zzmid <- zztop) never reaches the top's suite.
ok "$(sel "$D" --paths skills/x/scripts/zzleaf2.py)" "FULL|skills/x/scripts/zzleaf2.py: reaches no test" \
  "S2: a chain of three (zzleaf2 <- zzmid <- zztop) stops at zzmid, which no suite names: FULL"
put "$D" tests/zzmid.test.sh 'python3 skills/x/scripts/zzmid.py'
ok "$(sel "$D" --paths skills/x/scripts/zzleaf2.py)" "FAST|-|-|1 tests/zzmid.test.sh" \
  "S2: … and once zzmid has a suite, it selects that one, never the top's"

D="$TMP/s3"; mkrepo "$D"
put "$D" skills/x/scripts/zzleaf3.py 'Z = 3'
put "$D" tests/zzleaf3.test.sh 'python3 skills/x/scripts/zzleaf3.py'
put "$D" skills/x/scripts/zzdoc.py '"""Reads zzleaf3.py."""
# and zzleaf3.py again, in a comment
def f():
    """zzleaf3.py once more."""
    return 1'
put "$D" tests/zzdoc.test.sh 'python3 skills/x/scripts/zzdoc.py'
put "$D" skills/x/scripts/zzc.sh '# runs zzleaf3.py
echo c'
put "$D" tests/zzc.test.sh 'bash skills/x/scripts/zzc.sh'
put "$D" skills/x/scripts/zzj.js '// reads zzleaf3.py
export const j = 1'
put "$D" tests/zzj.test.mjs '// imports skills/x/scripts/zzj.js'
put "$D" skills/x/scripts/zzmsg.py 'print("see zzleaf3.py")'
put "$D" tests/zzmsg.test.sh 'python3 skills/x/scripts/zzmsg.py'
map "$D" 'skills/**' 'tests/*.test.*'
ok "$(sel "$D" --paths skills/x/scripts/zzleaf3.py)" "FAST|-|-|1 tests/zzj.test.mjs tests/zzleaf3.test.sh tests/zzmsg.test.sh" \
  "S3: a docstring, a # comment and a shell comment line never propagate; a .js // comment and a message string do"

D="$TMP/s4"; mkrepo "$D"
put "$D" skills/x/scripts/zzleaf4.py 'W = 4'
put "$D" tests/zzleaf4.test.sh 'python3 skills/x/scripts/zzleaf4.py'
put "$D" skills/x/scripts/zzhub.py 'LEAF = "zzleaf4.py"'
put "$D" tests/zzhub.test.sh 'python3 skills/x/scripts/zzhub.py'
map "$D" 'skills/x/scripts/zzhub.py FULL' 'skills/**' 'tests/*.test.*'
ok "$(sel "$D" --paths skills/x/scripts/zzleaf4.py)" "FULL|skills/x/scripts/zzleaf4.py: reaches skills/x/scripts/zzhub.py, marked FULL" \
  "S4: reaching a FULL carrier is FULL, both paths in the reason"
ok "$(sel "$D" --paths skills/x/scripts/zzhub.py)" "FULL|skills/x/scripts/zzhub.py: marked FULL" "S4: a FULL path itself"
ok "$(sel "$D" --ignore-full --paths skills/x/scripts/zzleaf4.py)" "FAST|-|-|1 tests/zzhub.test.sh tests/zzleaf4.test.sh" \
  "S4: --ignore-full lists the reached tests instead"

D="$TMP/s5"; mkrepo "$D"
put "$D" skills/x/scripts/zzleaf5.py 'V = 5'
put "$D" tests/lib/zzh.sh 'zzrun() { python3 skills/x/scripts/zzleaf5.py; }'
put "$D" tests/zzt.test.sh '. tests/lib/zzh.sh; zzrun'
map "$D" 'skills/**' 'tests/lib/**' 'tests/*.test.*'
ok "$(sel "$D" --paths skills/x/scripts/zzleaf5.py)" "FAST|-|-|1 tests/zzt.test.sh" "S5: a tests/lib helper naming the script selects the suites that source it"

D="$TMP/s6"; mkrepo "$D"
put "$D" skills/x/scripts/zzleaf6.py 'U = 6'
put "$D" tests/zzleaf6.test.sh 'python3 skills/x/scripts/zzleaf6.py'
put "$D" zzorphan.py 'L = "zzleaf6.py"'
put "$D" zznone/a.md 'none'
put "$D" zzalso/a.md 'also'
map "$D" 'skills/**' 'tests/*.test.*' 'zznone/** NONE' 'zzalso/** ALSO tests/zzleaf6.test.sh'
ok "$(sel "$D" --paths zzloose.txt)" "FULL|zzloose.txt: not in the map" "S6: an unmapped path is FULL"
ok "$(sel "$D" --paths zznone/a.md)" "FAST|-|-|1" "S6: a path placed only by NONE selects nothing when the map has no \`** ALSO\` line"
ok "$(sel "$D" --paths zzalso/a.md)" "FULL|zzalso/a.md: not in the map" "S6: a path matched only by an ALSO line is not placed"
ok "$(sel "$D" --paths skills/x/scripts/zzleaf6.py)" "FULL|skills/x/scripts/zzleaf6.py: reaches zzorphan.py, not in the map" \
  "S6: a reached carrier no line places is FULL"
put "$D" tests/zzw.test.mjs '// a walker'
put "$D" tests/zzv.test.mjs '// reads zzr/'
put "$D" skills/x/scripts/zzleaf6b.py 'B = 6'
put "$D" tests/zzleaf6b.test.sh 'python3 skills/x/scripts/zzleaf6b.py'
put "$D" zzr/zzr.sh 'python3 skills/x/scripts/zzleaf6b.py'
put "$D" tests/zzrr.test.sh 'bash zzr/zzr.sh'
map "$D" '** ALSO tests/zzw.test.mjs' 'skills/**' 'tests/*.test.*' 'zznone/** NONE' 'zzr/** NONE' 'zzr/** ALSO tests/zzv.test.mjs'
ok "$(sel "$D" --paths zznone/a.md)" "FAST|-|-|1 tests/zzw.test.mjs" \
  "S6: a path placed only by NONE still selects the walkers (its ALSO entries), and only them"
ok "$(sel "$D" --paths skills/x/scripts/zzleaf6b.py)" "FAST|-|-|1 tests/zzleaf6b.test.sh tests/zzv.test.mjs tests/zzw.test.mjs" \
  "S6: a reached carrier placed only by NONE adds its lines' ALSO entries, never the tests that name it"
# p54-4: one carrier deep. zzd2 names zzd1, and zzorph2 (no line places it) and zzd3 (FULL) name zzd2.
D="$TMP/s6d"; mkrepo "$D"
put "$D" skills/x/scripts/zzd1.py 'A = 1'
put "$D" skills/x/scripts/zzd2.py 'B = "zzd1.py"'
put "$D" tests/zzd2.test.sh 'python3 skills/x/scripts/zzd2.py'
put "$D" zzorph2.py 'C = "zzd2.py"'
put "$D" skills/x/scripts/zzd3.py 'D = "zzd2.py"'
map "$D" 'skills/x/scripts/zzd3.py FULL' 'skills/**' 'tests/*.test.*'
ok "$(sel "$D" --paths skills/x/scripts/zzd1.py)" "FAST|-|-|1 tests/zzd2.test.sh" \
  "S6: a carrier two deep that no line places (zzorph2.py), or that is marked FULL (zzd3.py), no longer makes the result FULL"
ok "$(sel "$D" --paths skills/x/scripts/zzd2.py)" "FULL|skills/x/scripts/zzd2.py: reaches skills/x/scripts/zzd3.py, marked FULL" \
  "S6: … while either one carrier deep still does"

D="$TMP/s7"; mkrepo "$D"
put "$D" skills/x/scripts/zznobody.py 'T = 7'
put "$D" tests/zzw.test.mjs '// a walker'
map "$D" '** ALSO tests/zzw.test.mjs' 'skills/**' 'tests/*.test.*'
ok "$(sel "$D" --paths skills/x/scripts/zznobody.py)" "FULL|skills/x/scripts/zznobody.py: reaches no test" \
  "S7: a placed path nothing names is FULL, walkers or not"

D="$TMP/s8"; mkrepo "$D"
put "$D" tests/zzt1.test.sh 'python3 skills/x/scripts/zzleaf8.py'
put "$D" skills/x/scripts/zzleaf8.py 'S = 8'
put "$D" tests/zzw.test.mjs '// a walker'
put "$D" tests/zzpeer.test.mjs '// runs beside zzt1 on its line'
map "$D" '** ALSO tests/zzw.test.mjs' 'tests/zzt1.test.sh tests/zzpeer.test.mjs' 'skills/**' 'tests/*.test.*'
ok "$(sel "$D" --paths tests/zzt1.test.sh)" "FAST|-|-|1 tests/zzpeer.test.mjs tests/zzt1.test.sh tests/zzw.test.mjs" \
  "S8a: a changed test selects itself, its lines' entries and the walkers"
put "$D" tests/zzt2.test.sh 'bash tests/zzt1.test.sh'
has "$(sel "$D" --paths tests/zzt1.test.sh)" "tests/zzt2.test.sh" "S8b: a test that runs the changed test is selected"
put "$D" tests/zzt3.test.sh 'bash "$root/tests/zzt2.test.sh"'
has "$(sel "$D" --paths tests/zzt1.test.sh)" "tests/zzt3.test.sh" "S8c: … and the runner of that runner (rule 5)"
put "$D" tests/zzt4.test.mjs "const t1 = fs.readFileSync(path.join(root, 'tests/zzt1.test.sh'), 'utf8')"
has "$(sel "$D" --paths tests/zzt1.test.sh)" "tests/zzt4.test.mjs" "S8d: a test that reads the changed test's text is selected"
put "$D" tests/zzt5.test.sh '# usage: bash tests/zzt5.test.sh
echo "rerun with: bash tests/zzt5.test.sh"'
edges=$(python3 - "$D/tests/lib/fast-tier.py" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("ft", sys.argv[1]); ft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ft)
r = ft.Repo()
print(" ".join(f"{a}>{b}" for a in sorted(r.runs) for b in sorted(r.runs[a])))
PY
)
ok "$edges" "tests/zzt2.test.sh>tests/zzt1.test.sh tests/zzt3.test.sh>tests/zzt2.test.sh" \
  "S8g: the runner edges are exactly zzt2>zzt1 and zzt3>zzt2 (a test that runs itself adds none)"
got=$(sel "$D" --paths skills/x/scripts/zzleaf8.py)
ok "$(for t in zzt1.test.sh zzt2.test.sh zzt3.test.sh zzt4.test.mjs; do holds "$got" "tests/$t" "$t " ""; done)" \
  "zzt1.test.sh zzt2.test.sh zzt3.test.sh " "S8f: a script named only by zzt1 selects zzt1 and its runners, never zzt4 (zzt1's text did not change)"
rm "$D/tests/zzt1.test.sh"
got=$(sel "$D" --paths tests/zzt1.test.sh)
ok "$(holds "$got" tests/zzt1.test.sh has-t1 no-t1)|$(holds "$got" tests/zzt2.test.sh y n)$(holds "$got" tests/zzt3.test.sh y n)" \
  "no-t1|yy" "S8e: a deleted test selects its runners (they now fail) but never itself"

D="$TMP/s9"; mkrepo "$D"
put "$D" skills/x/ZZNOTE.md 'a note'
put "$D" skills/x/scripts/zzreader.py 'NOTE = "ZZNOTE.md"'
put "$D" tests/zzreader.test.sh 'python3 skills/x/scripts/zzreader.py'
put "$D" tests/lib/zzlib.sh 'zznote() { cat "skills/x/ZZNOTE.md"; }'
put "$D" tests/zzlibuser.test.sh '. tests/lib/zzlib.sh'
put "$D" tests/zznote.test.mjs "// reads skills/x/ZZNOTE.md"
map "$D" 'FOREIGN ZZNOTE.md' 'skills/**' 'tests/lib/**' 'tests/*.test.*'
ok "$(sel "$D" --paths skills/x/ZZNOTE.md)" "FAST|-|-|1 tests/zzlibuser.test.sh tests/zznote.test.mjs" \
  "S9: a FOREIGN name selects its naming tests and a tests/lib helper's, never a script's"
put "$D" tests/zzfx.test.sh 'printf x > "$tmp/repo/ZZNOTE.md"; python3 skills/x/scripts/zzreader.py "$tmp/repo"'
ok "$(sel "$D" --paths skills/x/ZZNOTE.md)" "FAST|-|-|1 tests/zzfx.test.sh tests/zzlibuser.test.sh tests/zznote.test.mjs" \
  "S9b: a test that writes a fixture repo's ZZNOTE.md names the FOREIGN name until a FOREIGN-ONLY line declares it"
map "$D" 'FOREIGN ZZNOTE.md' "FOREIGN-ONLY ZZNOTE.md tests/zzfx.test.sh  # a fixture repo's ZZNOTE.md" 'skills/**' 'tests/lib/**' 'tests/*.test.*'
ok "$(sel "$D" --paths skills/x/ZZNOTE.md)" "FAST|-|-|1 tests/zzlibuser.test.sh tests/zznote.test.mjs" \
  "S9b: … and once declared it is no namer of that name: a change to the real ZZNOTE.md never selects it"
has "$(sel "$D" --paths skills/x/scripts/zzreader.py)" "tests/zzfx.test.sh" "S9b: … while it still selects for the script it names"

D="$TMP/s10"; mkrepo "$D"
put "$D" tests/zzmd.test.mjs '// reads the skills prose'
put "$D" tests/zzdocs.test.mjs '// reads docs'
put "$D" tests/zzdocs2.test.mjs '// reads docs too'
map "$D" 'skills/**/*.md tests/zzmd.test.mjs' 'docs/*.md tests/zzdocs.test.mjs' 'tests/*.test.*'
ok "$(sel "$D" --paths skills/zz.md)" "FAST|-|-|1 tests/zzmd.test.mjs" "S10: skills/**/*.md matches at depth 1 (** is zero segments)"
ok "$(sel "$D" --paths skills/a/b/zz.md)" "FAST|-|-|1 tests/zzmd.test.mjs" "S10: … and at depth 3"
ok "$(sel "$D" --paths docs/zz/y.md)" "FULL|docs/zz/y.md: not in the map" "S10: docs/*.md never crosses a /"
map "$D" 'docs/*.md tests/zzdocs.test.mjs' 'docs/** tests/zzdocs2.test.mjs' 'tests/*.test.*'
ok "$(sel "$D" --paths docs/zz.md)" "FAST|-|-|1 tests/zzdocs.test.mjs tests/zzdocs2.test.mjs" "S10: two matching lines give their union"

D="$TMP/s11"; mkrepo "$D"
put "$D" skills/execute/scripts/merge-task.sh '. "$(dirname "$0")/zzmtlib.sh"'
put "$D" skills/execute/scripts/zzmtlib.sh 'zzmt() { :; }'
map "$D" 'skills/execute/scripts/merge-task.sh @merge-task-self-tests' 'skills/**'
ok "$(sel "$D" --paths skills/execute/scripts/merge-task.sh)" "FAST|-|-|1 @merge-task-self-tests" "S11: @merge-task-self-tests is selected directly"
ok "$(sel "$D" --paths skills/execute/scripts/zzmtlib.sh)" "FAST|-|-|1 @merge-task-self-tests" "S11: … and through a lib merge-task.sh sources"

D="$TMP/s13"; mkrepo "$D"
put "$D" skills/execute/scripts/merge-task.sh 'echo self-test'
put "$D" tests/run.sh 'bash skills/execute/scripts/merge-task.sh --self-test-base'
printf '\nSELF_TEST_SCRIPT = "skills/execute/scripts/merge-task.sh"\n' >> "$D/tests/lib/fast-tier.py"
map "$D" 'tests/run.sh FULL' 'tests/lib/fast-tier.py FULL' 'skills/execute/scripts/merge-task.sh @merge-task-self-tests' 'skills/**'
ok "$(sel "$D" --paths skills/execute/scripts/merge-task.sh)" "FAST|-|-|1 @merge-task-self-tests" \
  "S13: run.sh and the selector name merge-task.sh in code, yet are never carriers: FAST, never naming either"

# S14: a HUB line ends the reach at its declared suites (ADR 0073 follow-up: a hub named by most suites is no FULL).
D="$TMP/s14"; mkrepo "$D"
put "$D" skills/x/scripts/zzhub.py 'H = 1
LEAF = "zzleaf14.py"'
put "$D" skills/x/scripts/zzleaf14.py 'L = 14'
put "$D" skills/x/scripts/zzloader14.py 'H = "zzhub.py"'
put "$D" tests/zzhub.test.sh 'python3 skills/x/scripts/zzhub.py'
put "$D" tests/zzhub2.test.sh 'python3 skills/x/scripts/zzhub.py again'
put "$D" tests/zzloader14.test.sh 'python3 skills/x/scripts/zzloader14.py'
put "$D" tests/zzleaf14.test.sh 'python3 skills/x/scripts/zzleaf14.py'
put "$D" tests/zzw.test.mjs '// a walker'
map "$D" '** ALSO tests/zzw.test.mjs' 'skills/x/scripts/zzhub.py HUB tests/zzhub.test.sh' \
  'skills/x/scripts/zzhub.py HUB tests/zzhub2.test.sh' 'skills/**' 'tests/*.test.*'
ok "$(sel "$D" --paths skills/x/scripts/zzhub.py)" "FAST|-|-|1 tests/zzhub.test.sh tests/zzhub2.test.sh tests/zzw.test.mjs" \
  "S14: a HUB path selects its declared suites (two lines' union) and the walkers, never the suite of a carrier that names it"
ok "$(sel "$D" --paths skills/x/scripts/zzleaf14.py)" "FAST|-|-|1 tests/zzhub.test.sh tests/zzhub2.test.sh tests/zzleaf14.test.sh tests/zzw.test.mjs" \
  "S14: a leaf that reaches a hub adds the hub's suites, and the reach stops there"

# S15 (p54-4): a file under docs/ is no carrier, so a docs spike that names a script never adds the docs line's tests.
D="$TMP/s15"; mkrepo "$D"
put "$D" skills/x/scripts/zzd.py 'D = 1'
put "$D" tests/zzd.test.sh 'python3 skills/x/scripts/zzd.py'
put "$D" docs/spikes/zzspike.py 'D = "zzd.py"'
put "$D" tests/zzdocs.test.mjs '// reads docs'
map "$D" 'skills/**' 'tests/*.test.*' 'docs/** tests/zzdocs.test.mjs'
ok "$(sel "$D" --paths skills/x/scripts/zzd.py)" "FAST|-|-|1 tests/zzd.test.sh" \
  "S15: a script a docs/ file names selects its own suite, never the docs line's tests (a docs file is no carrier)"
ok "$(sel "$D" --paths docs/spikes/zzspike.py)" "FAST|-|-|1 tests/zzdocs.test.mjs" "S15: … while a change to the docs file itself still selects them"

# S16 (p54-4): a READERS name selects only the readers its files' lines declare, never every test that names the word,
# and pushes no carrier, a tests/lib helper included. zzra reads skills/a's copy literally, zzrel skills/execute's through
# $HERE/../, zzskuser through a helper that names skills/a's; zzfx only writes a fixture copy (FOREIGN-ONLY).
D="$TMP/s16"; mkrepo "$D"
put "$D" skills/a/ZZSK.md 'a'
put "$D" skills/execute/ZZSK.md 'e'
put "$D" tests/zzra.test.sh 'grep -c x skills/a/ZZSK.md'
put "$D" skills/execute/tests/zzrel.test.sh 'HERE=$(cd "$(dirname "$0")" && pwd); grep -c x "$HERE/../ZZSK.md"'
put "$D" tests/lib/zzskh.sh 'zzsk() { cat skills/a/ZZSK.md; }'
put "$D" tests/zzskuser.test.sh '. tests/lib/zzskh.sh; zzsk'
put "$D" tests/zzfx.test.sh 'printf x > "$tmp/repo/ZZSK.md"'
RD=('FOREIGN ZZSK.md' 'FOREIGN-ONLY ZZSK.md tests/zzfx.test.sh  # a fixture copy' 'skills/**' 'tests/lib/**' 'tests/*.test.*'
  'skills/a/ZZSK.md tests/zzra.test.sh tests/zzskuser.test.sh' 'skills/execute/ZZSK.md skills/execute/tests/zzrel.test.sh')
map "$D" 'READERS ZZSK.md' "${RD[@]}"
ok "$(sel "$D" --paths skills/a/ZZSK.md)" "FAST|-|-|1 tests/zzra.test.sh tests/zzskuser.test.sh" \
  "S16: a READERS file selects its line's readers, the helper's user included, never the other file's reader or zzfx"
ok "$(sel "$D" --paths skills/execute/ZZSK.md)" "FAST|-|-|1 skills/execute/tests/zzrel.test.sh" \
  "S16: … the other file selects only its relative reader (the helper that names the word is pushed no more)"
out=$(chk "$D"); rc=$?
ok "$rc|$(holds "$out" "fast-tier map: ok (" ok "$out")" "0|ok" "S16: … and check passes on the fixture (check k holds its lines)"
map "$D" "${RD[@]}"
ok "$(sel "$D" --paths skills/a/ZZSK.md)" "FAST|-|-|1 skills/execute/tests/zzrel.test.sh tests/zzra.test.sh tests/zzskuser.test.sh" \
  "S16: without the READERS line the name fans out to every test that names it (zzfx still left out by FOREIGN-ONLY)"

# S12: the changed paths from git (selr: the fixture's own index, never staged).
D="$TMP/s12"; mkrepo "$D"
for x in zza zzb zzc; do put "$D" "skills/x/scripts/$x.py" "N = '$x'"; put "$D" "tests/$x.test.sh" "python3 skills/x/scripts/$x.py"; done
put "$D" tests/zzdocs.test.mjs '// reads docs'
put "$D" tests/zzspace.test.mjs '// reads docs/a b.md by name'
put "$D" tests/zzr.test.sh 'python3 skills/x/scripts/zzr.py'
map "$D" 'skills/**' 'tests/*.test.*' 'docs/** tests/zzdocs.test.mjs'
push "$D" base
B=$(git -C "$D" rev-parse HEAD)
ok "$(selr "$D")" "FULL|no changed paths from $B" "S12: an empty diff from origin/HEAD is FULL"
ok "$(selr "$D" --base nope)" "FULL|base nope does not resolve" "S12: an unresolvable base is FULL"
mkdir -p "$D/.claude"; : > "$D/.claude/settings.json"; : > "$D/.claude/merge-task.status"
ok "$(selr "$D" --base HEAD)" "FULL|no changed paths from HEAD" "S12: untracked .claude/ files add nothing"
echo "M = 1" >> "$D/skills/x/scripts/zza.py"; git -C "$D" commit -qam one; C1=$(git -C "$D" rev-parse HEAD)
echo "M = 2" >> "$D/skills/x/scripts/zzb.py"; git -C "$D" commit -qam two
ok "$(selr "$D")" "FAST|$B|origin/HEAD|2 tests/zza.test.sh tests/zzb.test.sh" "S12: no --base reads origin/HEAD's merge base"
ok "$(selr "$D" --base "$C1")" "FAST|$C1|--base|1 tests/zzb.test.sh" "S12: --base wins when given"
git -C "$D" push -q origin "$B:refs/heads/master" 2>/dev/null; git -C "$D" remote set-head origin -d >/dev/null 2>&1
ok "$(selr "$D" | cut -d' ' -f1)" "FAST|$B|origin/master|2" "S12: no origin/HEAD falls back to origin/master"
H=$(git -C "$D" rev-parse HEAD)
echo "M = 3" >> "$D/skills/x/scripts/zza.py"; git -C "$D" add skills/x/scripts/zza.py
echo "M = 4" >> "$D/skills/x/scripts/zzb.py"
put "$D" tests/zznew.test.sh 'echo new'
ok "$(selr "$D" --base HEAD)" "FAST|$H|--base|3 tests/zza.test.sh tests/zzb.test.sh tests/zznew.test.sh" \
  "S12: staged, unstaged and untracked edits all count (.claude/ still ignored)"
git -C "$D" reset -q --hard && rm -f "$D/tests/zznew.test.sh"
git -C "$D" mv skills/x/scripts/zza.py skills/x/scripts/zzr.py; git -C "$D" commit -qm rename
ok "$(selr "$D" --base HEAD~1)" "FAST|$H|--base|2 tests/zza.test.sh tests/zzr.test.sh" "S12: a rename counts both paths"
put "$D" "docs/a b.md" 'spaced'
ok "$(selr "$D" --base HEAD)" "FAST|$(git -C "$D" rev-parse HEAD)|--base|1 tests/zzdocs.test.mjs tests/zzspace.test.mjs" \
  "S12: docs/a b.md survives the -z parse, and a basename that is no token matches as a substring"

# U1-U4 (p54-4): an untracked file is no carrier, and an untracked path no map line places is left out with a stderr
# note (CI never sees it), never FULL; one a line does place, a new test say, still counts. --paths never leaves one out.
D="$TMP/u"; mkrepo "$D"
put "$D" skills/x/scripts/zzu.py 'U = 1'
put "$D" tests/zzu.test.sh 'python3 skills/x/scripts/zzu.py'
map "$D" 'skills/**' 'tests/*.test.*'
push "$D" base
B=$(git -C "$D" rev-parse HEAD)
put "$D" .scratch/zzx.py 'L = "zzu.py"'
LEFT_NOTE='fast-tier: .scratch/zzx.py: untracked and placed by no map line, left out (CI never sees it)'
ok "$(selr "$D" --paths skills/x/scripts/zzu.py)" "FAST|-|-|1 tests/zzu.test.sh" \
  "U1: an untracked scratch file that names the script is no carrier: FAST, never \`reaches .scratch/zzx.py\`"
git -C "$D" add .scratch/zzx.py
ok "$(selr "$D" --paths skills/x/scripts/zzu.py)" "FULL|skills/x/scripts/zzu.py: reaches .scratch/zzx.py, not in the map" \
  "U1: … and once staged it is a carrier again, one no line places, so FULL"
git -C "$D" rm -q --cached .scratch/zzx.py
echo 'U = 2' >> "$D/skills/x/scripts/zzu.py"; git -C "$D" commit -qam u2
ok "$(selr "$D")" "FAST|$B|origin/HEAD|1 tests/zzu.test.sh" \
  "U2: a plain select beside the untracked file leaves it out and counts only the path it read"
ok "$(cat "$TMP/selr.err")" "$LEFT_NOTE" "U2: … and names it in one stderr line"
put "$D" tests/zzu2.test.sh 'echo new'
ok "$(selr "$D")" "FAST|$B|origin/HEAD|2 tests/zzu.test.sh tests/zzu2.test.sh" "U3: an untracked new test still counts (a line places it)"
rm -f "$D/tests/zzu2.test.sh"
git -C "$D" reset -q --hard "$B"
ok "$(selr "$D")" "FULL|no changed paths from $B once 1 untracked paths no map line places are left out" \
  "U4: when the only changed paths are untracked ones no line places, none is left: FULL, as an empty diff is"
ok "$(cat "$TMP/selr.err")" "$LEFT_NOTE" "U4: … the note still names it"
ok "$(selr "$D" --paths .scratch/zzx.py)|$(cat "$TMP/selr.err")" "FULL|.scratch/zzx.py: not in the map|" \
  "U4: --paths never leaves a path out, and writes no note"

# ════ check ═════════════════════════════════════════════════════════════════════════════════════════════════════
echo "== check"
t0=$(python3 -c 'import time; print(time.time())')
out=$(python3 "$SEL" check 2>&1); rc=$?
t1=$(python3 -c 'import time; print(time.time())')
ok "$rc" 0 "C1: check passes on the real repo ($(python3 -c "print(f'{$t1 - $t0:.1f}')") s)"
[ "$rc" -eq 0 ] || printf '%s\n' "$out"

# The base fixture check passes on; each control copies it, changes one thing and must name its problem.
CB="$TMP/cbase"; mkrepo "$CB"
put "$CB" skills/x/scripts/zza.py 'A = 1'
put "$CB" tests/zza.test.sh 'python3 skills/x/scripts/zza.py'
map "$CB" 'skills/**' 'tests/*.test.*'
out=$(chk "$CB"); rc=$?
ok "$rc|$(holds "$out" "fast-tier map: ok (" ok "$out")" "0|ok" "C2: the base fixture passes check"
# ctl <label> <expected text> <setup...>: a copy of the base fixture, the setup run in it, check exits 1 naming it.
# ctlu: the same with nothing staged, so the setup's new files stay untracked, as in a worktree before `git add`.
ctl() { _ctl chk "$@"; }
ctlu() { _ctl chku "$@"; }
_ctl() {
  local how="$1" label="$2" want="$3" out rc tag=C2; shift 3
  [ "$how" = chku ] && tag="C2 unstaged"
  D="$TMP/ctl"; rm -rf "$D"; cp -R "$CB" "$D"
  ( cd "$D" && eval "$@" )
  out=$($how "$D"); rc=$?
  ok "$rc|$(holds "$out" "$want" named "$(echo "$out" | head -3)")" "1|named" "$tag: $label"
}
# pass <label> <setup...>: the same, and check passes.
pass() {
  local label="$1" out rc; shift
  D="$TMP/ctl"; rm -rf "$D"; cp -R "$CB" "$D"
  ( cd "$D" && eval "$@" )
  out=$(chk "$D"); rc=$?
  ok "$rc|$(echo "$out" | head -2)" "0|$(echo "$out" | grep '^fast-tier map: ok' | head -1)" "C2 pass: $label"
}
ml() { printf '%s\n' "$@" >> tests/fast-tier.map; }   # append map lines, inside a control's setup
ctl "an unplaced script" "hooks/zzhook.py: not placed" 'put . hooks/zzhook.py "H = 1"'
ctl "a script that reaches no test" "skills/x/scripts/zzlonely.py: reaches no test" 'put . skills/x/scripts/zzlonely.py "L = 1"'
ctl "a stale exact path" "skills/x/scripts/zzgone.py does not exist (check b)" 'ml "skills/x/scripts/zzgone.py tests/zza.test.sh"'
ctl "an uncollected entry" "the entry tests/lib/zzhelp.sh is not a collected test (check c)" \
  'put . tests/lib/zzhelp.sh ":"; ml "tests/lib/** tests/lib/zzhelp.sh"'
ctl "an empty glob" "the glob zzempty/** matches no tracked file (check b)" 'ml "zzempty/** tests/zza.test.sh"'
ctl "a second @ word" "@zzother-tests: @merge-task-self-tests is the only @ entry" 'ml "skills/x/scripts/zza.py @zzother-tests"'
ctl "a fixture dir with no line" "tests/fixtures/zzfx/: no \`tests/fixtures/zzfx/** <test>...\` line" 'put . tests/fixtures/zzfx/data.txt d'
ctl "a fixture line missing a helper's sourcing test" \
  "tests/zzsrc.test.sh names tests/lib/zzenv.sh, which holds fixtures/zzfx but is missing from the tests/fixtures/zzfx/** line" \
  'put . tests/fixtures/zzfx/data.txt d; put . tests/lib/zzenv.sh "FX=\"\$root/tests/fixtures/zzfx\""
   put . tests/zzsrc.test.sh ". tests/lib/zzenv.sh"; ml "tests/lib/**" "tests/fixtures/zzfx/** tests/zza.test.sh"'
ctl "a fixture consumer named only through path.join segments" \
  "tests/zzpj.test.mjs holds 'fixtures', 'zzfx' but is missing from the tests/fixtures/zzfx/** line" \
  "put . tests/fixtures/zzfx/data.txt d; put . tests/zzpj.test.mjs \"const fx = path.join(root, 'tests', 'fixtures', 'zzfx')\"
   ml 'tests/fixtures/zzfx/** tests/zza.test.sh'"
PJ2="const fx = path.join(root, 'tests/fixtures', \"zzfx\", 'data.txt')"
ctl "… with 'tests/fixtures' as one segment and a double-quoted dir" "tests/zzpj2.test.mjs holds 'fixtures', 'zzfx' but is missing" \
  'put . tests/fixtures/zzfx/data.txt d; put . tests/zzpj2.test.mjs "$PJ2"; ml "tests/fixtures/zzfx/** tests/zza.test.sh"'
pass "fixture dirs zz and zz-long: a test holding only fixtures/zz-long/a.md is no consumer of zz" \
  'put . tests/fixtures/zz/a.txt a; put . tests/fixtures/zz-long/a.txt a; put . tests/zzlong.test.sh "cat tests/fixtures/zz-long/a.md"
   ml "tests/fixtures/zz/** tests/zza.test.sh" "tests/fixtures/zz-long/** tests/zzlong.test.sh"'
ctl "a FOREIGN name with no file" "the FOREIGN name ZZNOPE.md is the basename of no tracked file (check g)" 'ml "FOREIGN ZZNOPE.md"'
# FO: a FOREIGN name ZZFX.md and a test that writes a temp repo's copy of it.
FO='put . skills/x/ZZFX.md x; put . tests/zzfx.test.sh "echo x > \"\$tmp/ZZFX.md\""; ml "FOREIGN ZZFX.md"'
pass "a FOREIGN-ONLY line naming a FOREIGN name, a test that holds it and what it holds" "$FO; ml 'FOREIGN-ONLY ZZFX.md tests/zzfx.test.sh  # a temp repo'"
ctl "a FOREIGN-ONLY line without its comment" "a FOREIGN-ONLY line ends with a \`# ...\` comment" "$FO; ml 'FOREIGN-ONLY ZZFX.md tests/zzfx.test.sh'"
ctl "a FOREIGN-ONLY line with no test" "FOREIGN-ONLY names a FOREIGN name and at least one test (check a)" "$FO; ml 'FOREIGN-ONLY ZZFX.md  # x'"
ctl "a FOREIGN-ONLY name that is not FOREIGN" "FOREIGN-ONLY ZZOTHER.md: ZZOTHER.md is not a FOREIGN name (check a)" \
  "$FO; ml 'FOREIGN-ONLY ZZOTHER.md tests/zzfx.test.sh  # x'"
ctl "an uncollected FOREIGN-ONLY entry" "the FOREIGN-ONLY entry tests/lib/zzh.sh is not a collected test (check c)" \
  "$FO; put . tests/lib/zzh.sh ZZFX.md; ml 'tests/lib/**' 'FOREIGN-ONLY ZZFX.md tests/lib/zzh.sh  # x'"
ctl "a stale FOREIGN-ONLY entry" "tests/zza.test.sh does not name ZZFX.md; drop it from that FOREIGN-ONLY line (check g)" \
  "$FO; ml 'FOREIGN-ONLY ZZFX.md tests/zza.test.sh  # x'"
ctl "(h) a script run.sh runs, neither FULL nor self-tests" "tests/run.sh names skills/x/scripts/zza.py; mark it FULL" \
  'put . tests/run.sh "python3 skills/x/scripts/zza.py"; ml "tests/run.sh FULL"'
pass "(h) a script named only in a run.sh comment line" 'put . tests/run.sh "# runs skills/x/scripts/zza.py"; ml "tests/run.sh FULL"'
# (i): a hub's declared suites are whole.
HUB='skills/x/scripts/zza.py HUB tests/zza.test.sh'
pass "(i) a HUB line holding every suite that names it" "ml '$HUB'"
ctl "(i) a suite that names the hub, missing from its HUB line" "tests/zzb.test.sh names it but is missing from the HUB line of skills/x/scripts/zza.py (check i)" \
  "put . tests/zzb.test.sh 'python3 skills/x/scripts/zza.py'; ml '$HUB'"
ctl "(i) a suite that names a tests/lib helper naming the hub, missing" \
  "tests/zzu.test.sh names tests/lib/zzh.sh, which names it but is missing from the HUB line of skills/x/scripts/zza.py (check i)" \
  "put . tests/lib/zzh.sh 'python3 skills/x/scripts/zza.py'; put . tests/zzu.test.sh '. tests/lib/zzh.sh'; ml 'tests/lib/**' '$HUB'"
ctlu "(i) … with the helper and its suite untracked (CI's checkout tracks them)" \
  "tests/zzu.test.sh names tests/lib/zzh.sh, which names it but is missing from the HUB line of skills/x/scripts/zza.py (check i)" \
  "put . tests/lib/zzh.sh 'python3 skills/x/scripts/zza.py'; put . tests/zzu.test.sh '. tests/lib/zzh.sh'; ml 'tests/lib/**' '$HUB'"
ctl "(i) a HUB line naming no exact path" "skills/x/scripts/*.py: a HUB line names one exact path (check i)" 'ml "skills/x/scripts/*.py HUB tests/zza.test.sh"'
ctl "(a) a HUB line with no entries" "HUB lists no entry (check a)" 'ml "skills/x/scripts/zza.py HUB"'
ctl "an unknown keyword" "unknown keyword ZZKEY (check a)" 'ml "ZZKEY skills/x/scripts/zza.py"'
ctl "FULL beside an entry" "FULL stands alone on its line (check a)" 'ml "skills/x/scripts/zza.py FULL tests/zza.test.sh"'
ctl "an OWN-LISTINGS line without its kind" "an OWN-LISTINGS line ends with a" 'put . tests/zzls.test.sh "ls tests/*.test.sh"; ml "OWN-LISTINGS tests/zzls.test.sh"'
# (f): one unclassified test per directory-listing form.
f_ctl() { ctl "(f) $1" "$2: lists a directory" "put . $2 $(printf '%q' "$3")"; }
# CT is built, so this suite's own text never holds the import it plants (it would walk the tree through contract-text).
CT=contract-text
f_ctl "a contract-text textFiles import" tests/zzct.test.mjs "import { read, textFiles } from './lib/$CT.mjs'"
f_ctl "readdirSync(" tests/zzrd.test.mjs "const names = fs.readdirSync(dir)"
f_ctl "ls-files" tests/zzlsf.test.mjs "execFileSync('git', ['ls-files'])"
f_ctl ".sh ls tests/*.test.sh" tests/zzls.test.sh 'for t in $(ls tests/*.test.sh); do :; done'
f_ctl ".sh git grep -l x" tests/zzgg.test.sh 'n=$(git grep -l x | wc -l)'
f_ctl "node spawnSync('grep', ['-rn', 'x', 'skills'])" tests/zzsg.test.mjs "const r = spawnSync('grep', ['-rn', 'x', 'skills'])"
f_ctl ".sh cp -R \"\$root/skills\"" tests/zzcp.test.sh 'cp -R "$root/skills" "$tmp/p"'
f_ctl "node cpSync(path.join(root, 'skills'))" tests/zzcps.test.mjs "fs.cpSync(path.join(root, 'skills'), d, { recursive: true })"
f_ctl ".sh find . with no cd" tests/zzfind.test.sh 'n=$(find . -name x | wc -l)'
f_ctl ".sh (cd \"\$root\" && find .)" tests/zzfcd.test.sh 'files=$(cd "$root" && find . -type f)'
ctl "(f) .sh grep -rn over skills hooks names both lines" "OWN-LISTINGS" \
  'put . tests/zzgr.test.sh "ok \"\$(grep -rn x skills hooks)\" \"\" none"'
ctl "(f) … and the walkers line" "\`** ALSO\` walkers line" 'put . tests/zzgr.test.sh "ok \"\$(grep -rn x skills hooks)\" \"\" none"'
pass "(f) grep -c over one named file (no r flag)" 'put . tests/zzgc.test.sh "n=\$(grep -c x tests/one.txt)"'
pass "(f) grep -rn over \"\$tmp\" (a temp operand) needs no line" 'put . tests/zzgt.test.sh "n=\$(grep -rn x \"\$tmp\")"'
ctl "(f) … and on OWN-LISTINGS it lists nothing" "the OWN-LISTINGS entry tests/zzgt.test.sh lists nothing" \
  'put . tests/zzgt.test.sh "n=\$(grep -rn x \"\$tmp\")"; ml "OWN-LISTINGS tests/zzgt.test.sh  # (i) a temp dir"'
pass "(f) (cd \"\$tmp\" && find . -type f)" 'put . tests/zzft.test.sh "files=\$(cd \"\$tmp\" && find . -type f)"'
W_SETUP='put . tests/zzw.test.sh "ls tests/*.test.sh"; put . tests/zzrun.test.sh "bash tests/zzw.test.sh"; ml "** ALSO tests/zzw.test.sh"'
ctl "(f) a runner of a walker on OWN-LISTINGS" "tests/zzrun.test.sh: runs the walker tests/zzw.test.sh" \
  "$W_SETUP; ml 'OWN-LISTINGS tests/zzrun.test.sh  # (i) runs zzw'"
pass "(f) a runner of a walker on the walkers line" "$W_SETUP; ml '** ALSO tests/zzrun.test.sh'"
ctl "(f) a contract-text importer on OWN-LISTINGS" "walks the tree through contract-text.mjs" \
  "put . tests/zzct.test.mjs \"import { walk } from './lib/$CT.mjs'\"; ml 'OWN-LISTINGS tests/zzct.test.mjs  # (i) x'"
# (j): the Slow tier (ADR 0084 d3), SLOW lines held to tests/ci-seconds.tsv's measured seconds. SL adds a second suite,
# zzs, that names nothing, so making it SLOW never leaves zza.py's only test SLOW. ts writes the seconds file.
ts() { : > tests/ci-seconds.tsv; while [ "$#" -ge 2 ]; do printf '%s\t%s\n' "$1" "$2" >> tests/ci-seconds.tsv; shift 2; done; }
SL='put . tests/zzs.test.sh "echo s"'
pass "(j) a SLOW line and its suite measured at 200 s" "$SL; ml 'SLOW tests/zzs.test.sh'; ts 200 tests/zzs.test.sh"
pass "(j) the band: a SLOW suite at 160 s and one not SLOW at 175 s" \
  "$SL; put . tests/zzt.test.sh 'echo t'; ml 'SLOW tests/zzs.test.sh  # a comment'; ts 160 tests/zzs.test.sh 175 tests/zzt.test.sh"
pass "(j) the edges: a SLOW suite at exactly 150 s stays, and a suite under 180 s needs no line" \
  "$SL; put . tests/zzt.test.sh 'echo t'; ml 'SLOW tests/zzs.test.sh'; ts 150 tests/zzs.test.sh 179.5 tests/zzt.test.sh"
ctl "(j) a SLOW line naming a missing file" "the SLOW entry tests/zzgone.test.sh is not a collected test (check j)" \
  "ml 'SLOW tests/zzgone.test.sh'; ts 200 tests/zza.test.sh"
ctl "(j) a suite measured at 200 s that is not SLOW" "tests/zzs.test.sh is measured at 200 s, at or over 180 s: add it to a SLOW line (check j)" \
  "$SL; ts 200 tests/zzs.test.sh"
ctl "(j) … and at exactly 180 s" "tests/zzs.test.sh is measured at 180 s, at or over 180 s" "$SL; ts 180 tests/zzs.test.sh"
ctl "(j) a SLOW suite measured at 140 s" "the SLOW suite tests/zzs.test.sh is measured at 140 s, under 150 s: drop its SLOW line (check j)" \
  "$SL; ml 'SLOW tests/zzs.test.sh'; ts 140 tests/zzs.test.sh"
ctl "(j) a SLOW suite with no row" "the SLOW suite tests/zzs.test.sh has no row in tests/ci-seconds.tsv (check j)" \
  "$SL; ml 'SLOW tests/zzs.test.sh'; ts 10 tests/zza.test.sh"
ctl "(j) SLOW lines and no seconds file" "tests/ci-seconds.tsv is missing" "$SL; ml 'SLOW tests/zzs.test.sh'"
ctl "(j) a stale row" "tests/ci-seconds.tsv:1: tests/zzgone.test.sh is not a collected test; drop its row (check j)" \
  "ts 10 tests/zzgone.test.sh 5 tests/zza.test.sh"
for bad in "x${tab}tests/zza.test.sh" "0${tab}tests/zza.test.sh" "10 tests/zza.test.sh" "5${tab}tests/zza.test.sh${nl}6${tab}tests/zza.test.sh"; do
  ctl "(j) a malformed row ($(printf '%s' "$bad" | tr '\t\n' '>/'))" "tests/ci-seconds.tsv:" "printf '%s\n' $(printf '%q' "$bad") > tests/ci-seconds.tsv"
done
ctl "(j) … names its line and its rule" "tests/ci-seconds.tsv:2: not a <seconds><TAB><suite> row" \
  "printf '# c\n10 tests/zza.test.sh\n' > tests/ci-seconds.tsv"
ctl "(a) a SLOW glob" "SLOW tests/*.test.sh: a SLOW entry is one exact collected test path (check a)" "ml 'SLOW tests/*.test.sh'"
ctl "(a) a SLOW @ entry" "SLOW @merge-task-self-tests: a SLOW entry is one exact collected test path (check a)" "ml 'SLOW @merge-task-self-tests'"
ctl "(a) a SLOW line with no entry" "SLOW names no test (check a)" "ml 'SLOW  # nothing'"
ctl "(d) a script whose only test is SLOW" "skills/x/scripts/zza.py: its only tests are SLOW; name it in a Fast-tier test or mark it FULL (check d)" \
  "ml 'SLOW tests/zza.test.sh'; ts 200 tests/zza.test.sh"
pass "(d) … while a second, non-SLOW test that names it clears it" \
  "put . tests/zzb.test.sh 'python3 skills/x/scripts/zza.py'; ml 'SLOW tests/zza.test.sh'; ts 200 tests/zza.test.sh"
# DN: a new script whose only suite runs it through a second new script. Unstaged, the second is no carrier yet.
DN='put . skills/x/scripts/zznew.py "N = 1"; put . skills/x/scripts/zzrun.sh "python3 skills/x/scripts/zznew.py"
  put . tests/zzrun.test.sh "bash skills/x/scripts/zzrun.sh"'
DN_WANT="skills/x/scripts/zznew.py: reaches no test; name it in a test, give its line entries, or mark it FULL"
DN_WANT="$DN_WANT (skills/x/scripts/zzrun.sh names it but is untracked, and a file carries a name only once staged)"
ctlu "(d) a new script reached only through an unstaged one names the unstaged file" "$DN_WANT (check d)" "$DN"
pass "(d) … and once staged it carries it" "$DN"
# (k) (p54-4): a READERS name's readers are declared on its files' lines. RK: two ZZSK.md files, skills/a's and skills/b's.
RK='put . skills/a/ZZSK.md a; put . skills/b/ZZSK.md b; ml "FOREIGN ZZSK.md" "READERS ZZSK.md"'
pass "(k) a declared literal reader, a FOREIGN-ONLY test and a walker that name ZZSK.md" \
  "$RK; put . tests/zzra.test.sh 'cat skills/a/ZZSK.md'; put . tests/zzfx.test.sh 'echo x > \"\$tmp/ZZSK.md\"'
   put . tests/zzw.test.mjs '// reads every ZZSK.md'
   ml 'skills/a/ZZSK.md tests/zzra.test.sh' 'FOREIGN-ONLY ZZSK.md tests/zzfx.test.sh  # a temp copy' '** ALSO tests/zzw.test.mjs'"
pass "(k) a reader of skills/b-a/ZZSK.md, through path.join segments, never reads skills/a's" \
  "$RK; put . skills/b-a/ZZSK.md c; put . tests/zzba.test.mjs \"const f = path.join(root, 'skills', 'b-a', 'ZZSK.md')\"
   ml 'skills/b-a/ZZSK.md tests/zzba.test.mjs'"
ctl "(k1) an undeclared namer" "tests/zzrn.test.sh names ZZSK.md but is on no line of a ZZSK.md file (check k)" \
  "$RK; put . tests/zzrn.test.sh 'echo ZZSK.md'"
ctl "(k1) an undeclared user of a tests/lib helper that names it" \
  "tests/zzru.test.sh names tests/lib/zzrh.sh, which names ZZSK.md but is on no line of a ZZSK.md file (check k)" \
  "$RK; put . tests/lib/zzrh.sh 'cat skills/a/ZZSK.md'; put . tests/zzru.test.sh '. tests/lib/zzrh.sh'; ml 'tests/lib/**'"
ctlu "(k1) … with the helper and its user untracked (the ZZSK.md files staged)" \
  "tests/zzru.test.sh names tests/lib/zzrh.sh, which names ZZSK.md but is on no line of a ZZSK.md file (check k)" \
  "$RK; git add -A; put . tests/lib/zzrh.sh 'cat skills/a/ZZSK.md'; put . tests/zzru.test.sh '. tests/lib/zzrh.sh'; ml 'tests/lib/**'"
ctl "(k2) a literal read declared on another file's line" \
  "tests/zzrb.test.sh reads skills/b/ZZSK.md but is on no line of skills/b/ZZSK.md (check k)" \
  "$RK; put . tests/zzrb.test.sh 'cat skills/b/ZZSK.md'; ml 'skills/a/ZZSK.md tests/zzrb.test.sh'"
ctl "(k2) a path.join segment read declared on another file's line" \
  "tests/zzrs.test.mjs reads skills/b/ZZSK.md but is on no line of skills/b/ZZSK.md (check k)" \
  "$RK; put . tests/zzrs.test.mjs \"const f = path.join(root, 'skills', 'b', 'ZZSK.md')\"; ml 'skills/a/ZZSK.md tests/zzrs.test.mjs'"
ctl "(k2) a \$HERE/../ read under skills/execute/tests declared on the wrong line" \
  "skills/execute/tests/zzrel.test.sh reads skills/execute/ZZSK.md but is on no line of skills/execute/ZZSK.md (check k)" \
  "$RK; put . skills/execute/ZZSK.md e; put . skills/execute/tests/zzrel.test.sh 'cat \"\$HERE/../ZZSK.md\"'
   ml 'skills/a/ZZSK.md skills/execute/tests/zzrel.test.sh'"
ctl "(k2) a '..', 'ZZSK.md' read under skills/execute/tests declared on the wrong line" \
  "skills/execute/tests/zzrelj.test.mjs reads skills/execute/ZZSK.md but is on no line of skills/execute/ZZSK.md (check k)" \
  "$RK; put . skills/execute/ZZSK.md e; put . skills/execute/tests/zzrelj.test.mjs \"const f = path.join(here, '..', 'ZZSK.md')\"
   ml 'skills/a/ZZSK.md skills/execute/tests/zzrelj.test.mjs'"
ctl "(k3) a stale readers entry" "tests/zza.test.sh does not name ZZSK.md; drop it from that readers line (check k)" \
  "$RK; ml 'skills/a/ZZSK.md tests/zza.test.sh'"
ctl "(a) READERS of a name that is not FOREIGN" "READERS ZZNOT.md: ZZNOT.md is not a FOREIGN name (check a)" "ml 'READERS ZZNOT.md'"
ctl "(a) READERS with no name" "READERS names no name (check a)" "ml 'READERS  # nothing'"

# C3: the selector collects exactly what run.sh runs.
globs=$(python3 - "$SEL" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("ft", sys.argv[1]); ft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ft)
print(" ".join(sorted(ft.COLLECTED)))
PY
)
run_globs=$(sed -n -e 's/^node_tests=(\(.*\))$/\1/p' -e 's/^sh_tests=(\$(ls -S \(.*\)))$/\1/p' tests/run.sh | tr ' ' '\n' | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')
ok "$globs" "$run_globs" "C3: the selector's COLLECTED globs equal run.sh's node_tests and sh_tests globs"

# C4 (p54-4): contract-text's skillCount counts the directories under skills/ but _shared whose top holds a .md file, so
# a deleted skill's leftovers (an ignored __pycache__/, a .DS_Store) count as none; it names no SKILL.md (check k).
d="$TMP/c4"; rm -rf "$d"; mkdir -p "$d/skills/zza" "$d/skills/_shared" "$d/skills/zzgone/scripts/__pycache__"
: > "$d/skills/zza/SKILL.md"; : > "$d/skills/_shared/x.md"; : > "$d/skills/zzgone/scripts/__pycache__/x.cpython-312.pyc"
: > "$d/skills/zzgone/.DS_Store"
c4=$(node --input-type=module -e 'const { skillCount } = await import(process.argv[1]); console.log(skillCount(process.argv[2]))' \
  "$root/tests/lib/$CT.mjs" "$d/skills" 2>&1)
ok "$c4" 1 "C4: skillCount over a temp skills tree counts zza only, never _shared or zzgone's leftovers"

# ════ the real tree ═════════════════════════════════════════════════════════════════════════════════════════════
echo "== the real tree"
r1=$(python3 "$SEL" select --paths skills/reflect/scripts/attention.py)
ok "$(holds "${r1:0:4}" FULL y "$(holds "$r1" tests/reflect-weekly.test.mjs y "$(echo "$r1" | head -1)")")" y \
  "R1: attention.py is FULL or reaches tests/reflect-weekly.test.mjs (reflect.py loads it by path)"
r2=$(python3 "$SEL" select --ignore-full --paths skills/reflect/scripts/attention.py)
has "$r2" "tests/reflect-weekly.test.mjs" "R2: with --ignore-full, attention.py reaches tests/reflect-weekly.test.mjs through reflect.py"
# R3, re-judged in p45-4 (ADR 0078 d2) and p54-4: land-carrier.py runs merge-task.sh's classifier (--classify-steps), so
# a merge-task.sh change reaches land-carrier.py, and the reach stops there, one carrier deep (land.sh, which runs
# land-carrier.py's marker verb, and rollout-settings.py, which runs land.sh, are no longer reached): FAST, with the
# carrier's suite as well as the self-tests.
r3=$(python3 "$SEL" select --paths skills/execute/scripts/merge-task.sh)
ok "$(echo "$r3" | head -1 | cut -f1)|$(printf '%s\n' "$r3" | grep -cx '@merge-task-self-tests')|$(printf '%s\n' "$r3" | grep -cx 'tests/land-carrier.test.sh')|$(printf '%s\n' "$r3" | grep -c 'fast-tier.py')" \
  "FAST|1|1|0" "R3: merge-task.sh is FAST with @merge-task-self-tests and the suite of land-carrier.py, the carrier that runs it (if this turns FULL, re-judge the FULL list: what does it reach?)"
r4=$(python3 "$SEL" select --paths docs/adr/0073-thread-skill-verifies-a-fast-tier-at-merge.md)
ok "$(printf '%s\n' "$r4" | head -1 | cut -f1)|$(printf '%s\n' "$r4" | grep -cxE 'tests/(verify-slot|release-check-quoting-diff)\.test\.sh')" "FAST|2" \
  "R4: a docs-only change is FAST and runs the walkers (verify-slot, release-check-quoting-diff)"
d=landing-register   # built, so this suite reads no fixture dir
r5=$(python3 "$SEL" select --paths "tests/fixtures/$d/register.md")
ok "$(printf '%s\n' "$r5" | grep -cxE 'tests/(landing-register\.test\.mjs|execution-fit-remote\.test\.sh)')" 2 \
  "R5: a landing-register fixture reaches its path.join consumer and its literal one"
has "$(python3 "$SEL" select --paths tests/release-check.test.sh)" "tests/release-check-quoting-diff.test.sh" \
  "R5: a change to release-check.test.sh runs its runner, release-check-quoting-diff"
has "$(python3 "$SEL" select --paths tests/reflect-weekly.test.mjs)" "tests/fast-tier.test.sh" \
  "R5: a change to a test this suite names selects this suite (rule 1), its OWN-LISTINGS (ii) reason"
r6=$(python3 "$SEL" select --paths tests/e2e/parallel-rollouts-one-repo.live.sh)
ok "$(printf '%s\n' "$r6" | head -1 | cut -f1)|$(printf '%s\n' "$r6" | grep -cxE 'tests/contracts/(queue-only|rung-vocabulary|no-single-cause)\.test\.mjs')" \
  "FAST|3" "R6: a tests/e2e/ change (NONE) still runs the walkers that read it (queue-only, rung-vocabulary, no-single-cause)"
for h in skills/execute/scripts/reconcile-rollout.py skills/execute/scripts/lead-integrate.py skills/_shared/scripts/run_record.py \
  skills/execute/scripts/verify-slot.py skills/_shared/scripts/rollout-settings.py; do
  r7=$(python3 "$SEL" select --paths "$h")
  ok "$(printf '%s\n' "$r7" | head -1 | cut -f1)|$(printf '%s\n' "$r7" | grep -cx 'tests/verify-slot.test.sh')" "FAST|1" \
    "R7: the hub $h is FAST: its declared suites and the walkers (FULL means its HUB line went)"
done
r8=$(python3 "$SEL" select --paths THREAD.md)
ok "$(printf '%s\n' "$r8" | head -1 | cut -f1)|$(printf '%s\n' "$r8" | grep -cxE 'tests/leg.test.sh|tests/lead-integrate.test.sh|tests/land.test.sh')" "FAST|0" \
  "R8: a THREAD.md change is FAST and skips the suites that write only fixture repos' THREAD.md (their FOREIGN-ONLY line)"
has "$(python3 "$SEL" select --paths CONTEXT.md)" "tests/repo-threads.test.sh" "R8: … while CONTEXT.md still selects repo-threads.test.sh, which reads the real one"
has "$(python3 "$SEL" select --paths CLAUDE.md)" "tests/fast-tier-wiring.test.mjs" "R8: … and CLAUDE.md still selects fast-tier-wiring.test.mjs (W3 reads it)"
# R9-R10: the real Slow tier (ADR 0084 d3). The map's SLOW lines, read here as text, are what `slow` prints; no suite is
# named here, so a change to one never selects this suite by its name (rule 1).
slow_map=$(sed -n -e 's/#.*//' -e 's/^SLOW[[:space:]]//p' tests/fast-tier.map | tr -s ' \t' '\n\n' | grep . | LC_ALL=C sort -u)
r9=$(python3 "$SEL" slow --paths docs/zz.md); r9rc=$?
ok "$r9rc|$(printf '%s\n' "$r9" | cut -f1 | LC_ALL=C sort -u | tr '\n' ' ')|$(printf '%s\n' "$r9" | cut -f2)" "0|OUT |$slow_map" \
  "R9: slow over a path that is no SLOW suite prints OUT for every SLOW suite the map declares, and nothing else"
ok "$([ "$(printf '%s\n' "$slow_map" | grep -c .)" -ge 1 ] && echo y || echo none)" y "R9: … and the real map declares a Slow tier"
s1=$(printf '%s\n' "$slow_map" | head -1)
r9=$(python3 "$SEL" slow --paths "$s1" skills/zz.py)
ok "$(printf '%s\n' "$r9" | grep -c "^KEPT$tab")|$(printf '%s\n' "$r9" | grep -cx "KEPT$tab$s1")|$(printf '%s\n' "$r9" | grep -c "^OUT$tab")" \
  "1|1|$(( $(printf '%s\n' "$slow_map" | grep -c .) - 1 ))" "R9: a diff that edits one SLOW suite ($s1) keeps it, and leaves every other one OUT"
r10=$(THREAD_SKIP_SLOW=1 bash tests/run.sh --shard-plan 4 2>&1); r10rc=$?
missing=""; for t in $slow_map; do printf '%s\n' "$r10" | grep -qx "[1-4]$tab$t" || missing="$missing $t"; done
ok "$r10rc|${missing:-none}" "0|none" "R10: THREAD_SKIP_SLOW=1 bash tests/run.sh --shard-plan 4 still lists every SLOW suite"
# R11-R12 (p54-4): the real tree through one index. core(p) is the entries of every map line matching p, ALSO included;
# closure(s) adds the runners of s until nothing is new (rule 5). R11: a SKILL.md (a READERS name) selects exactly the
# closure of its lines' entries, so no test that only names the word is reach, and orient's holds no SLOW suite. R12: an
# ADR selects between the closure of its lines' entries and its namers, and that plus what its carriers add one deep;
# the asserted counts are of lines' entries only, so only a FULL change moves them.
rr=$(python3 - "$SEL" <<'PY'
import importlib.util, os, sys
spec = importlib.util.spec_from_file_location("ft", sys.argv[1]); ft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ft)
R = ft.Repo()
slow = {t for _no, t in R.slow}
def core(p):
    return set().union(*(l.entries for l in R.matching(p)))
def closure(s):
    s = set(s); todo = [t for t in s if t != ft.SELF_TESTS]
    while todo:
        for r in R.ran_by.get(todo.pop(), ()):
            if r not in s:
                s.add(r); todo.append(r)
    return s
def say(cond, msg):
    print(f"{'ok' if cond else 'FAIL'}\t{msg}")
for p in ("skills/orient/SKILL.md", "skills/execute/SKILL.md"):
    full, sel = R.select([p])
    say(not full and sel == closure(core(p)),
        f"R11: {p} is FAST and selects exactly the closure of its lines' entries ({full or len(sel)})")
full, sel = R.select(["skills/orient/SKILL.md"])
say(not full and not (sel & slow), f"R11: … and orient's selection holds no SLOW suite ({sorted(sel & slow)})")
say("skills/execute/tests/prompt-invariants.test.mjs" in core("skills/execute/SKILL.md"),
    "R11: … while execute's lines hold prompt-invariants, its declared relative reader")
p = "docs/adr/0083-capacity-backs-off-only-for-strain-it-can-relieve.md"
b = os.path.basename(p)
full, sel = R.select([p])
lower = closure(core(p) | R.namers(b, "tests"))
carriers = R.namers(b, "carriers")
upper = set(lower)
for c in carriers:
    upper |= core(c) | R.namers(os.path.basename(c), "tests")
upper = closure(upper)
say((not full and lower <= sel <= upper) or (full and any(c in full for c in carriers)),
    f"R12: ADR 0083 selects between its lines' entries and namers, and what its carriers add one deep ({full or len(sel)})")
say(len(core(p)) < 50, f"R12: … its lines' entries number under 50 ({len(core(p))}; it selects {full or len(sel)})")
say(not any(c.startswith("docs/") for c in R.carriers) and set(R.carriers) <= set(R.tracked),
    "R12: no carrier lies under docs/, and every carrier is tracked")
PY
)
n=0
while IFS=$tab read -r v msg; do ok "$v" ok "$msg"; n=$((n + 1)); done <<< "$rr"
ok "$n" 7 "R11-R12: the real-tree reading printed its seven verdicts"

# ════ tests/run.sh on a fixture checkout ════════════════════════════════════════════════════════════════════════
echo "== run.sh"
# Every fixture run below leaves the warm's stdlib half out (run.sh's header, "The bytecode cache"): each launches only a
# few pythons, so warming about 560 stdlib modules per run cost this suite more than the warm saved. F24 runs it whole.
export THREAD_TEST_WARM_STDLIB=0
F="$TMP/f"; mkrepo "$F"
cp "$root/tests/run.sh" "$F/tests/run.sh"
cp "$root/tests/lib/test-jobs.sh" "$root/tests/lib/check-workflow-parse.sh" "$root/tests/lib/shard.py" "$root/tests/lib/node-run.mjs" \
  "$F/tests/lib/"
put "$F" skills/execute/scripts/merge-task.sh 'echo "zzmarker-self-test $1"'
put "$F" skills/x/scripts/zza.py 'print("a")'
put "$F" skills/x/scripts/zzb.py 'print("b")'
put "$F" skills/x/zz.workflow.js 'export const meta = {}
return 1'
put "$F" tests/zza.test.sh 'echo "zzmarker-a zza.py"'
put "$F" tests/zzb.test.sh 'echo "zzmarker-b zzb.py zz.workflow.js"'
put "$F" tests/contracts/zzc.test.mjs "console.log('zzmarker-c'); if (process.env.ZZ_C_OK !== '1') process.exit(1)"
put "$F" docs/zzreadme.md 'notes'
map "$F" 'tests/run.sh FULL' 'tests/fast-tier.map FULL' 'tests/lib/** FULL' \
  'skills/execute/scripts/merge-task.sh @merge-task-self-tests' 'skills/**' 'tests/*.test.*' 'tests/contracts/*.test.mjs' 'docs/** NONE'
push "$F" base
FB=$(git -C "$F" rev-parse HEAD)
# run <shell> <arg>...: tests/run.sh in the fixture; output in $out, exit in $rc.
run() { local sh="$1"; shift; out=$(cd "$F" && "$sh" tests/run.sh "$@" 2>&1); rc=$?; }
markers() { printf '%s\n' "$out" | grep -oE 'zzmarker-[a-z-]+( --self-test-[a-z]+)?' | grep -v '^zzmarker-self-test$' | LC_ALL=C sort -u | tr '\n' ' '; }
porc() { git -C "$F" status --porcelain; }

echo 'B = 1' >> "$F/skills/x/scripts/zza.py"; git -C "$F" commit -qam "a only"
p0=$(porc)
THREAD_VERIFY_BASE=$FB run bash --fast
ok "$rc|$(markers)" "0|zzmarker-a " "F1: a commit touching only zza.py runs only zza's suite"
for s in "== bash syntax" "== python syntax" "== workflow parse" "== fast-tier map check" "== node tests: none selected" \
  "== fast tier: base ${FB:0:12} (--base), 1 changed paths, 1 test files" "make test: ALL PASS"; do
  has "$out" "$s" "F1: … prints '$s'"
done
ok "$(porc)" "$p0" "F8: the fast run left the fixture's git status unchanged"

put "$F" new.txt 'loose'
ZZ_C_OK=1 THREAD_VERIFY_BASE=$FB run bash --fast
ok "$rc|$(markers)" "0|zzmarker-a " "F2b: an untracked path no map line places is left out: the zza.py commit runs only zza's suite"
has "$out" "== fast tier: base ${FB:0:12} (--base), 1 changed paths, 1 test files" "F2b: … counting only the path it read"
has "$out" "fast-tier: new.txt: untracked and placed by no map line, left out (CI never sees it)" "F2b: … and the note reaches the run log"
git -C "$F" add new.txt
ZZ_C_OK=1 THREAD_VERIFY_BASE=$FB run bash --fast
ok "$rc|$(markers)" "0|zzmarker-a zzmarker-b zzmarker-c zzmarker-self-test --self-test-base zzmarker-self-test --self-test-classify " \
  "F2: a tracked unmapped path runs everything"
has "$out" "== fast tier: full suite (new.txt: not in the map)" "F2: … and says why"
rm -f "$F/new.txt"

git -C "$F" reset -q --hard "$FB"
put "$F" docs/zz.md 'notes'; git -C "$F" add -A; git -C "$F" commit -qm docs
shells=("$(command -v bash)"); [ -x /bin/bash ] && ! [ /bin/bash -ef "${shells[0]}" ] && shells+=(/bin/bash)
for sh in "${shells[@]}"; do
  v=$("$sh" -c 'echo ${BASH_VERSINFO[0]}')
  THREAD_VERIFY_BASE=$FB run "$sh" --fast
  ok "$rc|$(markers)|$(printf '%s\n' "$out" | grep -c '^== tests/')" "0||0" "F3 ($sh, bash $v): a NONE-only diff in a fixture with no \`** ALSO\` line selects nothing: no suite spawned, no node, the run passes"
  has "$out" "== node tests: none selected" "F3 ($sh, bash $v): … node is never run"
  has "$out" "0 test files" "F3 ($sh, bash $v): … and the fast-tier line says 0 test files"
done
git -C "$F" reset -q --hard "$FB"
ZZ_C_OK=1 THREAD_VERIFY_BASE=$FB run bash --only tests/contracts/zzc.test.mjs
ok "$rc|$(markers)|$(printf '%s\n' "$out" | grep -c '^== tests/')" "0|zzmarker-c |0" "F3: a node-only run spawns no shell suite and no self-test"

run bash --only tests/zzb.test.sh
ok "$rc|$(markers)" "0|zzmarker-b " "F4: --only runs only the named file, in the harness"
has "$out" "== fast-tier map check" "F4: … after the always-run steps"
for args in "--fast --only tests/zzb.test.sh" "--zzbogus" "--only" "--only tests/zznope.test.sh" "--only tests/run.sh"; do
  # shellcheck disable=SC2086
  run bash $args
  ok "$rc|$(markers)" "2|" "F4: run.sh $args exits 2 and runs nothing"
done

ZZ_C_OK=1 run bash
ok "$rc|$(markers)" "0|zzmarker-a zzmarker-b zzmarker-c zzmarker-self-test --self-test-base zzmarker-self-test --self-test-classify " \
  "F5: a bare run runs everything"
has "$out" "== fast-tier map check" "F5: … the map check included"
ok "$(printf '%s\n' "$out" | grep -c '== fast tier')" 0 "F5: … and reads no selection"

printf '%s\n' 'skills/x/scripts/zzgone.py tests/zza.test.sh' >> "$F/tests/fast-tier.map"
for mode in --fast bare; do
  if [ "$mode" = bare ]; then ZZ_C_OK=1 run bash; else ZZ_C_OK=1 THREAD_VERIFY_BASE=$FB run bash --fast; fi
  ok "$rc|$(printf '%s\n' "$out" | grep -c 'zzgone.py does not exist')" "1|1" "F6 ($mode): a stale map line turns the run red"
  has "$out" "  - fast-tier map check" "F6 ($mode): … through the map check step"
done
git -C "$F" checkout -q -- tests/fast-tier.map

echo 'B = 2' >> "$F/skills/x/scripts/zza.py"; git -C "$F" commit -qam one
echo 'B = 3' >> "$F/skills/x/scripts/zzb.py"; git -C "$F" commit -qam two
p0=$(porc)
THREAD_VERIFY_BASE=$(git -C "$F" rev-parse HEAD~2) run bash --fast
ok "$rc|$(markers)" "0|zzmarker-a zzmarker-b " "F7: a base two commits back selects both commits' suites (captured before the unset)"
ok "$(porc)" "$p0" "F8: … and the run left the fixture's git status unchanged"

git -C "$F" reset -q --hard "$FB"
echo '# touched' >> "$F/skills/execute/scripts/merge-task.sh"; git -C "$F" commit -qam mt
THREAD_VERIFY_BASE=$FB run bash --fast
ok "$rc|$(markers)" "0|zzmarker-self-test --self-test-base zzmarker-self-test --self-test-classify " \
  "F9: a change to merge-task.sh runs both self-tests and nothing else"

# --shard K/N and --shard-plan N (p43-3, ADR 0073 d3): tests/lib/shard.py's split, run one shard at a time.
git -C "$F" reset -q --hard "$FB"
# allmarkers: every marker the run printed, one per run of a suite (not deduplicated), sorted.
allmarkers() { printf '%s\n' "$1" | grep -oE 'zzmarker-[a-z-]+( --self-test-[a-z]+)?' | grep -v '^zzmarker-self-test$' | LC_ALL=C sort | tr '\n' ' '; }
ZZ_C_OK=1 run bash --shard 1/2; rc1=$rc; out1=$out
ZZ_C_OK=1 run bash --shard 2/2; rc2=$rc; out2=$out
ok "$rc1|$rc2|$(allmarkers "$out1$nl$out2")" \
  "0|0|zzmarker-a zzmarker-b zzmarker-c zzmarker-self-test --self-test-base zzmarker-self-test --self-test-classify " \
  "F10: --shard 1/2 and --shard 2/2 together run every suite and both self-tests exactly once, and both pass"
ok "$(printf '%s\n' "$out1" | grep -c 'zzmarker-self-test --self-test-')|$(printf '%s\n' "$out2" | grep -c 'zzmarker-self-test')" "2|0" \
  "F10: … the self-tests run in shard 1 only"
has "$out1" "== shard 1/2: " "F10: … shard 1 names itself and its file count"
has "$out1" "   the merge-task self-tests" "F10: … and lists the self-tests"

run bash --shard-plan 2
ok "$rc|$(markers)|$(printf '%s\n' "$out" | grep -c '^== ')" "0||0" "F11: --shard-plan 2 exits 0, starts no suite and runs no always-run step"
ok "$(printf '%s\n' "$out" | grep -cE '^[12]'"$tab"'')|$(printf '%s\n' "$out" | cut -f2 | LC_ALL=C sort | tr '\n' ' ')" \
  "4|@merge-task-self-tests tests/contracts/zzc.test.mjs tests/zza.test.sh tests/zzb.test.sh " \
  "F11: … and prints <k><TAB><entry> for each entry once"

for args in "--shard 0/2" "--shard 3/2" "--shard x" "--shard 1/2 extra" "--shard" "--shard 1/2/3" "--shard /2" \
  "--shard-plan 0" "--shard-plan" "--shard-plan x" "--shard 1/2 --fast" "--only tests/zza.test.sh --shard 1/2" \
  "--fast --shard 0/2" "--fast --shard 3/2" "--fast --shard 1/2 extra" "--fast --shard-plan 0" "--fast --fast" \
  "--fast --only tests/zza.test.sh" "--shard-plan 2 --fast"; do
  # shellcheck disable=SC2086
  run bash $args
  ok "$rc|$(markers)|$(printf '%s\n' "$out" | grep -c '^== ')" "2||0" "F12: run.sh $args exits 2 and runs nothing"
done

run bash --shard 4/4
ok "$rc|$(markers)|$(printf '%s\n' "$out" | grep -c '^== tests/')" "0||0" "F13: an empty shard (--shard 4/4 on the small fixture) passes and spawns no suite"
has "$out" "== shard 4/4: 0 test files" "F13: … says 0 test files"
has "$out" "== node tests: none selected" "F13: … and never runs node"

put "$F" tests/lib/shard.py 'import sys; sys.exit(1)'
ZZ_C_OK=1 run bash --shard 1/2
ok "$rc|$(markers)" "1|" "F14: a failing shard.py fails the run, which runs no test"
has "$out" "  - shard split" "F14: … through the shard split step"
has "$out" "run.sh: shard.py --order failed, so node takes its files in glob order" "F14: … and node's order falls back to the glob's, and says so"
git -C "$F" checkout -q -- tests/lib/shard.py

# F26 (p54-10, ADR 0084 d4): --fast --shard K/N runs shard K of the fast tier's selection, so the shards together run it
# exactly once: over a small diff (F1's: zza alone, so shards 2 and 3 hold nothing) and a FULL one (F2's tracked
# unmapped path), the union of --fast --shard k/3's suite runs (allmarkers, not deduplicated) is --fast's selection,
# which F1 and F2 pin. G7 runs the same under the Slow tier's flag.
# fshards <base>: shard k's output in fo[k], the three joined in $fsh, their exit codes in $frc.
fshards() {
  local k; fsh=""; frc=""; fo=()
  for k in 1 2 3; do ZZ_C_OK=1 THREAD_VERIFY_BASE=$1 run bash --fast --shard "$k/3"; fo[$k]=$out; fsh="$fsh$nl$out"; frc="$frc$rc"; done
}
echo 'B = 1' >> "$F/skills/x/scripts/zza.py"; git -C "$F" commit -qam "a only"
fshards "$FB"
ok "$frc|$(allmarkers "$fsh")" "000|zzmarker-a " "F26: a small diff's three --fast shards run its one suite exactly once, and all pass"
ok "$(holds "${fo[1]}" "== shard 1/3: 1 test files" y n)$(holds "${fo[1]}" "== fast tier: base ${FB:0:12} (--base), 1 changed paths, 1 test files" y n)" yy \
  "F26: … shard 1 holds it, after the fast tier's own line"
for k in 2 3; do
  o=${fo[$k]}
  ok "$(holds "$o" "== fast-tier map check" y n)$(holds "$o" "== shard $k/3: 0 test files" y n)$(holds "$o" "== node tests: none selected" y n)$(holds "$o" "make test: ALL PASS" y n)" yyyy \
    "F26: … shard $k holds no entry: it runs the always-run steps, no suite and no node, and passes"
done
fpo=$(cd "$F" && THREAD_VERIFY_BASE=$FB bash tests/run.sh --fast --shard-plan 3 2>"$TMP/fplan.err"); fprc=$?
ok "$fprc|$(printf '%s' "$fpo" | tr '\t\n' ':/')|$(grep -c '^== fast tier: base ' "$TMP/fplan.err")|$(grep -c '^== fast-tier map check' "$TMP/fplan.err")" \
  "0|1:tests/zza.test.sh|1|0" "F26: --fast --shard-plan 3 prints only the selection's split on stdout, its fast tier line on stderr, and runs no step"
git -C "$F" reset -q --hard "$FB"
put "$F" new.txt 'loose'; git -C "$F" add new.txt
fshards "$FB"
ok "$frc|$(allmarkers "$fsh")" \
  "000|zzmarker-a zzmarker-b zzmarker-c zzmarker-self-test --self-test-base zzmarker-self-test --self-test-classify " \
  "F26: a FULL diff's three --fast shards run every suite and both self-tests exactly once, and all pass"
ok "$(printf '%s\n' "${fo[1]}" | grep -c 'zzmarker-self-test --self-test-')|$(printf '%s\n' "${fo[2]}$nl${fo[3]}" | grep -c 'zzmarker-self-test')|$(printf '%s\n' "$fsh" | grep -c '^== fast tier: full suite (new.txt: not in the map)$')" \
  "2|0|3" "F26: … the self-tests in shard 1 only, and each shard says why it fell to the full suite"
git -C "$F" rm -qf new.txt

# F15-F17 (p43-6, #327 finding 2): each suite and each step prints `<label>: ok|FAILED (<N>s)` as it ends, so a job cut
# mid-run still shows every suite that finished (F15's sentinel case: one suite's line while another still runs); the
# grouped blocks print before node; the verdict carries the seconds.
# lnum <ERE>: the number of the first line of $out that matches <ERE>, else 0. lines <ERE>: how many lines match.
lnum() { local l; l=$(printf '%s\n' "$out" | grep -nE "$1" | head -1 | cut -d: -f1); echo "${l:-0}"; }
lines() { printf '%s\n' "$out" | grep -cE "$1"; }
ZZ_C_OK=1 run bash; rc15=$rc
blk=$(lnum '^== (merge-task (classifier|base) self-test|tests/zz[ab]\.test\.sh)$')
lastblk=$(printf '%s\n' "$out" | grep -nE '^== (merge-task (classifier|base) self-test|tests/zz[ab]\.test\.sh)$' | tail -1 | cut -d: -f1)
nodel=$(lnum '^== node tests \(')
early=""
for l in 'tests/zza\.test\.sh' 'tests/zzb\.test\.sh' 'merge-task classifier self-test' 'merge-task base self-test'; do
  e=$(lnum "^$l: ok \([0-9]+s\)$"); [ "$e" -gt 0 ] && [ "$e" -lt "$blk" ] && early="${early}y" || early="${early}n"
done
ok "$rc15|$early" "0|yyyy" "F15: each shell suite and self-test prints its own ok line, all before the first grouped block"
ok "$([ "$blk" -gt 0 ] && [ "${lastblk:-0}" -lt "$nodel" ] && echo y || echo "blocks $blk..${lastblk:-0}, node $nodel")" y \
  "F15: … and every grouped block prints before node runs"
ok "$(lines '^fast-tier map check: ok \([0-9]+s\)$')|$(lines '^node tests \(1 files\): ok \([0-9]+s\)$')" "1|1" \
  "F17: a step ends with its own line"
ok "$(lines '^make test: ALL PASS \([0-9]+s\)$')" 1 "F17: … and the verdict carries the run's seconds"

# A finished suite's line shows while another suite still runs, the case a cut job meets. zzb blocks on a sentinel
# this test creates only once zza's line is in the run's output file, so a run.sh that printed the lines from the main
# shell after `wait` never shows zza's line in time. Both waits are bounded (estate ADR 0011 d3): zzb gives up at 30 s,
# the poll at 20 s, so a regression fails in about 20 s and never hangs the suite.
go="$TMP/f15.go"; f15out="$TMP/f15.out"; rm -f "$go" "$f15out"
put "$F" tests/zzb.test.sh 'n=0; while [ ! -e "$ZZ_GO" ] && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n+1)); done
[ -e "$ZZ_GO" ] || { echo "zzb: no sentinel in 30 s"; exit 1; }
echo "zzmarker-b zzb.py zz.workflow.js released"'
(cd "$F" && THREAD_TEST_JOBS=4 ZZ_GO="$go" bash tests/run.sh --only tests/zza.test.sh tests/zzb.test.sh > "$f15out" 2>&1) &
f15pid=$!
n=0; while ! grep -q '^tests/zza\.test\.sh: ok (' "$f15out" 2>/dev/null && [ "$n" -lt 200 ]; do sleep 0.1; n=$((n+1)); done
seen=$(cat "$f15out" 2>/dev/null)
: > "$go"
wait "$f15pid"; f15rc=$?
ok "$(holds "$seen" 'tests/zza.test.sh: ok (' y n)|$(holds "$seen" 'tests/zzb.test.sh: ' y n)|$(holds "$seen" '== tests/zz' y n)" "y|n|n" \
  "F15: zza's ok line is in the output while zzb is still blocked on its sentinel, before any block (printed before wait returned)"
out=$(cat "$f15out")
ok "$f15rc|$(lines '^tests/zzb\.test\.sh: ok \([0-9]+s\)$')|$(markers)" "0|1|zzmarker-a zzmarker-b " \
  "F15: … and once the sentinel is there, zzb ends ok and the run passes"
git -C "$F" checkout -q -- tests/zzb.test.sh

put "$F" tests/zzb.test.sh 'exit 1'
run bash --only tests/zzb.test.sh
ok "$rc|$(lines '^tests/zzb\.test\.sh: FAILED \([0-9]+s\)$')|$(lines '^  - tests/zzb\.test\.sh$')" "1|1|1" \
  "F16: a failing suite prints its FAILED line, fails the run and is in the failure list"
ok "$(lines '^make test: FAILED \([0-9]+s\)$')" 1 "F17: … and the red verdict carries the run's seconds"
git -C "$F" checkout -q -- tests/zzb.test.sh

# F20-F22 (#327 finding 6): a hung suite fails the run within its liveness bound and names itself. zzb hangs (a 60 s
# sleep, and a background child) past the 2 s bound THREAD_SUITE_BOUND sets, so the run ends in seconds with zzb's whole
# process group gone. zzb exits 0 on its TERM and still names zzb.py and zz.workflow.js (so the map check stays green),
# so only the timeout can make the run red. A regression ends at zzb's own 60 s, so the check never hangs the suite.
pids="$TMP/f20.pids"; rm -f "$pids"
put "$F" tests/zzb.test.sh 'trap "exit 0" TERM; sleep 60 & echo $! >> "$ZZ_PIDS"; echo $$ >> "$ZZ_PIDS"
echo "zzmarker-b hung zzb.py zz.workflow.js"; sleep 60'
s20=$SECONDS
ZZ_PIDS="$pids" THREAD_SUITE_BOUND=2 run bash --only tests/zza.test.sh tests/zzb.test.sh
t20=$((SECONDS - s20))
alive=""; for p in $(cat "$pids" 2>/dev/null); do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
ok "$rc|$(markers)|$([ "$t20" -lt 30 ] && echo fast || echo "slow (${t20}s)")" "1|zzmarker-a zzmarker-b |fast" \
  "F20: a suite hung past its 2 s bound fails the run in seconds, not at its 60 s, and the other suite still runs"
ok "$(lines '^tests/zzb\.test\.sh: FAILED \([0-9]+s\)$')|$(lines '^tests/zzb\.test\.sh: timed out after 2s$')|$(lines '^tests/zza\.test\.sh: ok \([0-9]+s\)$')" \
  "1|1|1" "F20: … the hung suite prints its FAILED line and a timed-out line, the other its ok line"
ok "$(lines '^  - tests/zzb\.test\.sh \(timed out after 2s\)$')|$(lines '^run\.sh: timed out after 2s \(its liveness bound\); its process group was killed$')|$(lines '^  - ')" \
  "1|1|1" "F20: … its failure-list line and its block say it timed out, and it is the run's only failure"
ok "$(lines '^run\.sh: a healthy suite that has only grown slower needs tests/shard-weights\.tsv regenerated \(its header says how\), or THREAD_SUITE_BOUND=<seconds>$')" \
  1 "F20: … and its block names the fix for a suite that has only grown slower"
ok "$(wc -l < "$pids" | tr -d ' ')|${alive:-none}" "2|none" "F20: … and its whole process group is gone, the background child too"
git -C "$F" checkout -q -- tests/zzb.test.sh
for bad in 0 x; do
  THREAD_SUITE_BOUND=$bad run bash --only tests/zza.test.sh
  ok "$rc|$(markers)|$(lines '^== ')" "2||0" "F21: THREAD_SUITE_BOUND=$bad exits 2 and runs nothing"
done

# F22: a TERM to run.sh's pid alone (as when a verify slot's guard ends a run) still ends a hung suite: the suite's
# process group is no longer run.sh's, so run.sh's trap TERMs it. Both waits are bounded (20 s, then 5 s).
pids="$TMP/f22.pids"; rm -f "$pids"
put "$F" tests/zzb.test.sh 'sleep 60 & echo $! >> "$ZZ_PIDS"; echo $$ >> "$ZZ_PIDS"; sleep 60'
(cd "$F" && ZZ_PIDS="$pids" exec bash tests/run.sh --only tests/zzb.test.sh > "$TMP/f22.out" 2>&1) & rpid=$!
n=0; while [ "$(cat "$pids" 2>/dev/null | wc -l | tr -d ' ')" != 2 ] && [ "$n" -lt 200 ]; do sleep 0.1; n=$((n+1)); done
sleep 0.5  # the spawn block has written the group id stop_suites reads
kill -TERM "$rpid"; wait "$rpid"; rrc=$?
n=0; alive=x
while [ -n "$alive" ] && [ "$n" -lt 50 ]; do
  alive=""; for p in $(cat "$pids" 2>/dev/null); do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
  [ -z "$alive" ] || sleep 0.1; n=$((n+1))
done
ok "$rrc|$(cat "$pids" 2>/dev/null | wc -l | tr -d ' ')|${alive:-none}" "143|2|none" \
  "F22: a TERM to run.sh exits 143 and TERMs the live suite's whole process group, its background child too"
git -C "$F" checkout -q -- tests/zzb.test.sh

# F18-F19 (p43-6): shard.py reads measured weights from tests/shard-weights.tsv beside run.sh (its docstring holds the
# rules). splan: the two shell suites' shards from --shard-plan 2, as `<k>:<entry>` words.
W="$F/tests/shard-weights.tsv"
splan() { run bash --shard-plan 2; printf '%s\n' "$rc"; printf '%s\n' "$out" | grep -E 'zz[ab]\.test\.sh$' | tr '\t' ':'; }
ok "$(splan | tr '\n' ' ')" "0 1:tests/zzb.test.sh 2:tests/zza.test.sh " "F18: with no weights file, the larger suite (zzb) leads shard 1"
printf '%s\t%s\n' 100 tests/zza.test.sh 1 tests/zzb.test.sh > "$W"
ok "$(splan | tr '\n' ' ')" "0 2:tests/zzb.test.sh 1:tests/zza.test.sh " "F18: … a weight beats the size: zza (100 s) now leads shard 1"
printf '%s\t%s\n' 1000 @merge-task-self-tests >> "$W"
ok "$(splan | tr '\n' ' ')" "0 2:tests/zzb.test.sh 2:tests/zza.test.sh " "F18: … the self-tests' weight seeds shard 1, so both suites go to shard 2"
before=$(splan); printf '# a comment\n\n%s\t%s\n' 5 tests/zzgone.test.sh >> "$W"
ok "$(splan)" "$before" "F18: … a weights line for a test that is not in the input, a comment and a blank line change nothing"
printf '%s\t%s\n' 100 tests/zza.test.sh > "$W"
ok "$(splan | tr '\n' ' ')" "0 1:tests/zzb.test.sh 2:tests/zza.test.sh " \
  "F18: … an unweighted suite's load is its size times its kind's median seconds per byte, so zzb (larger) leads shard 1 again"
for bad in "nottab tests/zza.test.sh" "0${tab}tests/zza.test.sh" "3${tab}tests/zza.test.sh${nl}4${tab}tests/zza.test.sh"; do
  printf '%s\n' "$bad" > "$W"
  so=$(cd "$F" && printf '%s\n' tests/zza.test.sh tests/zzb.test.sh | python3 tests/lib/shard.py 2 2>"$TMP/shard.err"); src=$?
  ok "$src|$so|$(grep -c '^shard: tests/shard-weights\.tsv:[0-9][0-9]*: ' "$TMP/shard.err")|$(wc -l < "$TMP/shard.err" | tr -d ' ')" "2||1|1" \
    "F19: a bad weights file ($(printf '%s' "$bad" | tr '\t\n' '>/')) exits 2 with one shard: tests/shard-weights.tsv:<n>: line and no stdout"
done
rm -f "$W"

# F23 (p54-3): node takes its files longest first, by the measured seconds in tests/shard-weights.tsv: shard.py --order
# sorts them and tests/lib/node-run.mjs keeps that order (`node --test` itself sorts its arguments by path). At
# THREAD_TEST_JOBS=1 node runs one file at a time, so the markers' order is the files' start order.
put "$F" tests/zzd.test.mjs "console.log('zzmarker-d')"
nodeorder() { printf '%s\n' "$out" | grep -oE 'zzmarker-[cd]' | tr '\n' ' '; }
printf '%s\t%s\n' 1 tests/contracts/zzc.test.mjs 100 tests/zzd.test.mjs > "$W"
ZZ_C_OK=1 THREAD_TEST_JOBS=1 run bash --only tests/contracts/zzc.test.mjs tests/zzd.test.mjs
ok "$rc|$(nodeorder)" "0|zzmarker-d zzmarker-c " "F23: the heavier node file (zzd, 100 s) runs first, though zzc's path sorts first"
has "$out" "== node seconds per file" "F23: … and node prints each file's seconds, the weights' source"
printf '%s\t%s\n' 100 tests/contracts/zzc.test.mjs 1 tests/zzd.test.mjs > "$W"
ZZ_C_OK=1 THREAD_TEST_JOBS=1 run bash --only tests/contracts/zzc.test.mjs tests/zzd.test.mjs
ok "$rc|$(nodeorder)" "0|zzmarker-c zzmarker-d " "F23: … and with the weights swapped, zzc runs first"
ZZ_C_OK=0 THREAD_TEST_JOBS=1 run bash --only tests/contracts/zzc.test.mjs tests/zzd.test.mjs
ok "$rc|$(lines '^node tests \(2 files\): FAILED \([0-9]+s\)$')" "1|1" "F23: … a failing node file still fails the node step and the run"
# node-run.mjs exits as `node --test` does, by the run's summary: a failing `todo` test passes, a failing test does not.
put "$F" tests/zze.test.mjs "import test from 'node:test'
test('zze todo', { todo: true }, () => { throw new Error('zze') })
test('zze fails', () => { if (process.env.ZZ_E_FAIL) throw new Error('zze') })"
erc() { (cd "$F" && env "$@" node tests/lib/node-run.mjs tests/zze.test.mjs > /dev/null 2>&1); echo $?; }
ok "$(erc ZZ_E=)|$(erc ZZ_E_FAIL=1)" "0|1" "F23: … node-run.mjs passes a failing todo test, as the CLI does, and fails a failing test"
rm -f "$W" "$F/tests/zzd.test.mjs" "$F/tests/zze.test.mjs"

# F24 (p54-3): the warm's stdlib half. zzw prints whether its python finds argparse's bytecode in the run's prefix, and
# the knob it sees. This suite's THREAD_TEST_WARM_STDLIB=0 leaves the stdlib out; 1 warms it; the suite never sees the
# knob (run.sh unsets it); any other value exits 2 before any step.
put "$F" tests/zzw.test.sh "python3 -c 'import argparse, importlib.util, os
warm = os.path.isfile(importlib.util.cache_from_source(argparse.__file__))
print(\"zzwarm\", \"warm\" if warm else \"cold\", os.environ.get(\"THREAD_TEST_WARM_STDLIB\", \"unset\"))'"
warmed() { printf '%s\n' "$out" | grep '^zzwarm ' | tr '\n' '/'; }
run bash --only tests/zzw.test.sh; w0="$rc|$(warmed)"
THREAD_TEST_WARM_STDLIB=1 run bash --only tests/zzw.test.sh; w1="$rc|$(warmed)"
ok "$w0 $w1" "0|zzwarm cold unset/ 0|zzwarm warm unset/" \
  "F24: THREAD_TEST_WARM_STDLIB=0 leaves the stdlib out of the prefix, 1 warms it, and no suite inherits the knob"
THREAD_TEST_WARM_STDLIB=x run bash --only tests/zzw.test.sh
ok "$rc|$(warmed)|$(lines '^== ')|$(lines "THREAD_TEST_WARM_STDLIB must be 0, 1 or empty, got 'x'")" "2||0|1" \
  "F24: … THREAD_TEST_WARM_STDLIB=x exits 2 before any step and runs nothing"
rm -f "$F/tests/zzw.test.sh"

# F25 (p54-3): a TERM to node-run.mjs alone (as when a verify slot's guard ends a run inside node's step) cancels the
# run as the CLI does: the running file's child ends with it, never left to init, its test reads cancelled, and the run
# exits 1. Both waits are bounded (20 s for the child's pid, 5 s for its end), and a node-run.mjs that ignored the TERM
# still ends at zzt's own 60 s, so a regression never hangs the suite.
tpid="$TMP/f25.pid"; rm -f "$tpid"
put "$F" tests/zzt.test.mjs "import { writeFileSync } from 'node:fs'
writeFileSync(process.env.ZZ_PID, String(process.pid))
setTimeout(() => {}, 60000)"
(cd "$F" && ZZ_PID="$tpid" exec node tests/lib/node-run.mjs tests/zzt.test.mjs > "$TMP/f25.out" 2>&1) & npid=$!
n=0; while [ ! -s "$tpid" ] && [ "$n" -lt 200 ]; do sleep 0.1; n=$((n+1)); done
kill -TERM "$npid"; wait "$npid"; nrc=$?
child=$(cat "$tpid" 2>/dev/null)
n=0; while [ -n "$child" ] && kill -0 "$child" 2>/dev/null && [ "$n" -lt 50 ]; do sleep 0.1; n=$((n+1)); done
if [ -z "$child" ]; then alive="no child pid"
elif kill -0 "$child" 2>/dev/null; then alive="child alive, ppid $(ps -o ppid= -p "$child" | tr -d ' ')"; kill "$child"
else alive=none; fi
ok "$nrc|$alive|$(grep -c 'cancelled 1' "$TMP/f25.out")" "1|none|1" \
  "F25: a TERM to node-run.mjs cancels the run: exit 1, the running file's child gone with it, its test cancelled"
rm -f "$F/tests/zzt.test.mjs"

# G1-G6 (p54-1, ADR 0084 d3): THREAD_SKIP_SLOW=1, GitHub's check, leaves the Slow tier out of --fast, the FULL fallbacks
# included, and keeps a SLOW suite the diff itself edits. A fixture of its own, so F1-F22's marker sets stay as they are:
# zzs.py is named by zzslow (SLOW, 200 s) and zzsfast; zzslow prints the THREAD_SKIP_SLOW it sees. A workflow script,
# as in F, since run.sh's workflow parse step needs one under bash 3.2's set -u.
G="$TMP/g"; mkrepo "$G"
cp "$root/tests/run.sh" "$G/tests/run.sh"
cp "$root/tests/lib/test-jobs.sh" "$root/tests/lib/check-workflow-parse.sh" "$root/tests/lib/shard.py" "$root/tests/lib/node-run.mjs" \
  "$G/tests/lib/"
put "$G" skills/execute/scripts/merge-task.sh 'echo "zzmarker-self-test $1"'
put "$G" skills/x/scripts/zzs.py 'print("s")'
put "$G" tests/zzslow.test.sh 'echo "zzmarker-slow zzs.py ${THREAD_SKIP_SLOW:-unset}"'
put "$G" skills/x/zz.workflow.js 'export const meta = {}
return 1'
put "$G" tests/zzsfast.test.sh 'echo "zzmarker-sfast zzs.py zz.workflow.js"'
printf '%s\t%s\n' 200 tests/zzslow.test.sh 1 tests/zzsfast.test.sh > "$G/tests/ci-seconds.tsv"
map "$G" 'tests/run.sh FULL' 'tests/fast-tier.map FULL' 'tests/lib/** FULL' 'skills/execute/scripts/merge-task.sh @merge-task-self-tests' \
  'SLOW tests/zzslow.test.sh' 'tests/ci-seconds.tsv tests/zzsfast.test.sh' 'skills/**' 'tests/*.test.*'
push "$G" base
GB=$(git -C "$G" rev-parse HEAD)
rung() { local sh="$1"; shift; out=$(cd "$G" && "$sh" tests/run.sh "$@" 2>&1); rc=$?; }
slowl() { printf '%s\n' "$out" | grep '^== slow tier' | tr '\n' '/'; }
LEFT='== slow tier: left out 1 suites (THREAD_SKIP_SLOW=1): tests/zzslow.test.sh/'
echo 'S = 1' >> "$G/skills/x/scripts/zzs.py"; git -C "$G" commit -qam "zzs only"
for sh in "${shells[@]}"; do
  v=$("$sh" -c 'echo ${BASH_VERSINFO[0]}')
  THREAD_SKIP_SLOW=1 THREAD_VERIFY_BASE=$GB rung "$sh" --fast
  ok "$rc|$(markers)|$(slowl)" "0|zzmarker-sfast |$LEFT" \
    "G1 ($sh, bash $v): with the flag, a diff that reaches a SLOW suite runs the rest, leaves it out and names it in one line"
done
THREAD_VERIFY_BASE=$GB rung bash --fast
ok "$rc|$(markers)|$(slowl)" "0|zzmarker-sfast zzmarker-slow |" "G2: without the flag the same diff runs both, and prints no slow-tier line"
git -C "$G" reset -q --hard "$GB"
echo 'echo edited' >> "$G/tests/zzslow.test.sh"; git -C "$G" commit -qam "zzslow itself"
for sh in "${shells[@]}"; do
  THREAD_SKIP_SLOW=1 THREAD_VERIFY_BASE=$GB rung "$sh" --fast
  ok "$rc|$(markers)|$(slowl)|$(printf '%s\n' "$out" | grep -c '^   kept, the diff edits it: tests/zzslow\.test\.sh$')" \
    "0|zzmarker-slow |== slow tier: left out 0 suites (THREAD_SKIP_SLOW=1)/|1" \
    "G3 ($sh): with the flag, a diff that edits the SLOW suite's own file still runs it, and says so"
done
git -C "$G" reset -q --hard "$GB"
put "$G" new.txt 'loose'; git -C "$G" add new.txt
THREAD_SKIP_SLOW=1 THREAD_VERIFY_BASE=$GB rung bash --fast
ok "$rc|$(markers)|$(slowl)" \
  "0|zzmarker-self-test --self-test-base zzmarker-self-test --self-test-classify zzmarker-sfast |$LEFT" \
  "G4: with the flag, a FULL fallback (a tracked unmapped path) runs everything but the SLOW suite, and names it"
has "$out" "== fast tier: full suite (new.txt: not in the map)" "G4: … the fallback says why"
git -C "$G" rm -qf new.txt
THREAD_SKIP_SLOW=1 THREAD_VERIFY_BASE=0000000000000000000000000000000000000bad rung bash --fast
ok "$rc|$(markers)|$(slowl)" \
  "0|zzmarker-self-test --self-test-base zzmarker-self-test --self-test-classify zzmarker-sfast |$LEFT" \
  "G4: … and so does a base that does not resolve: an unreadable diff leaves every SLOW suite out"
THREAD_SKIP_SLOW=1 rung bash
ok "$rc|$(markers)|$(slowl)|$(printf '%s\n' "$out" | grep -c 'zzmarker-slow zzs.py unset')" \
  "0|zzmarker-self-test --self-test-base zzmarker-self-test --self-test-classify zzmarker-sfast zzmarker-slow ||1" \
  "G5: with the flag, a bare run runs the SLOW suite, which never sees the flag (run.sh unsets it)"
THREAD_SKIP_SLOW=1 rung bash --shard-plan 2
ok "$rc|$(printf '%s\n' "$out" | grep -cE "^[12]${tab}tests/zzslow\.test\.sh$")" "0|1" "G5: … --shard-plan 2 lists it"
THREAD_SKIP_SLOW=1 rung bash --only tests/zzslow.test.sh
ok "$rc|$(markers)|$(slowl)" "0|zzmarker-slow |" "G5: … and --only runs it"
for mode in --fast "" "--shard-plan 2"; do
  # shellcheck disable=SC2086
  THREAD_SKIP_SLOW=yes THREAD_VERIFY_BASE=$GB rung bash $mode
  ok "$rc|$(markers)|$(printf '%s\n' "$out" | grep -c -e '^== ' -e "^[12]$tab")|$(printf '%s\n' "$out" | grep -c "THREAD_SKIP_SLOW must be 1 or empty, got 'yes'")" \
    "2||0|1" "G6: THREAD_SKIP_SLOW=yes (${mode:-bare}) exits 2 before any step and runs nothing"
done

# G7 (p54-10): F26 under the Slow tier's flag. A diff reaching zzslow (SLOW), zzsfast and the self-tests: with the flag,
# the union of --fast --shard k/3 is --fast's selection with zzslow left out (G1's rule), each entry once, and each shard
# names what it left out; --fast --shard-plan 3 leaves it out of the split too.
echo 'S = 2' >> "$G/skills/x/scripts/zzs.py"; echo '# touched' >> "$G/skills/execute/scripts/merge-task.sh"
git -C "$G" commit -qam "zzs and merge-task"
gsh=""; grc=""
for k in 1 2 3; do THREAD_SKIP_SLOW=1 THREAD_VERIFY_BASE=$GB rung bash --fast --shard "$k/3"; gsh="$gsh$nl$out"; grc="$grc$rc"; done
ok "$grc|$(allmarkers "$gsh")|$(printf '%s\n' "$gsh" | grep -cxF "${LEFT%/}")" \
  "000|zzmarker-self-test --self-test-base zzmarker-self-test --self-test-classify zzmarker-sfast |3" \
  "G7: with the flag, the three --fast shards run the selection less the SLOW suite exactly once, and each names it"
gpo=$(cd "$G" && THREAD_SKIP_SLOW=1 THREAD_VERIFY_BASE=$GB bash tests/run.sh --fast --shard-plan 3 2>/dev/null); gprc=$?
ok "$gprc|$(printf '%s\n' "$gpo" | cut -f2 | LC_ALL=C sort | tr '\n' ' ')" "0|@merge-task-self-tests tests/zzsfast.test.sh " \
  "G7: … and --fast --shard-plan 3 splits only that selection"

echo; [ "$fail" -eq 0 ] && echo "fast-tier: ALL PASS" || echo "fast-tier: SOME FAILED"
exit "$fail"
