#!/usr/bin/env bash
# skills/_shared/scripts/serial-chains.py plan: schedule § Serial path's S2 (ADR 0040, p24-2). A serial set's
# chains (surface overlap and dependencies), each member's surfaces and where they came from, its launch, and
# ruling (c)'s session lane:
#   P1   grouping and order: disjoint chains, overlap and dependency edges, the phase / launch / M / slug tie-break,
#        a cycle refused, an outside dependency listed
#   P2   derivation and sources: the real `## Launch` shapes, Read and MCP items skipped, non-path spans skipped,
#        the vault, a path in no checkout, --surface (always unions in), the added-only member, an empty `surfaces:`
#   P2b  a launch folder or path inside a checkout widens to its toplevel, declared or derived; workspace launchers
#        share one checkout, so their members form one chain with a launch per row (their markers are never read)
#   P2c  the default (the vault only) and its stated limit; a declared `any`
#   P2d  launch commands (`--add-dir` and a leading `cd`, fenced or in a span) and the first project's `Local:` are
#        derived claims; a fenced path no such command names, a comment, a Read item, a declared member, a second
#        project's `Local:` and a backticked `Local:` with no path claim nothing; a `## Launch` path that is `/` or
#        the home directory is never claimed (a WARN for an undeclared member)
#   P3   the overlap grammar (pure), symlinks, clones, a comma inside a token, sibling subdirectories, a malformed token
#   P4   ruling (c): a member on a checkout of lachyts/thread-skill (a `## Launch` `--add-dir` or `cd` path, declared
#        or not, its surface, its launch folder, its project's `Local:` or `repos:`) goes to the session lane
#   P5   launch: by_alias then plain_aliases, the null, missing and unknown refusals, the project's `launch:`, the
#        alias-less member (from its one repo, its project's `Local:` included), a missing launch-folders file
#   P6   exit 2
# Temp vaults, temp git repos with literal origin URLs (only `git rev-parse` and `git remote get-url` read them).
# No vault, no network. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR & co.)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
root=$(pwd -P)
SC="$root/skills/_shared/scripts/serial-chains.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"

TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
trap 'rm -rf "$TMP"' EXIT
export THREAD_EVENTS_DIR="${THREAD_TEST_EVENTS_DIR:-$TMP/events}"  # serial-chains.py loads reconcile-rollout.py: its Run record stays in temp
export THREAD_NOTE_LOCK_DIR="${TMP}/note-locks"   # the note save lock stays in temp too (reconcile-rollout.py _note_lock_path)

hasnt() { case "$1" in *"$2"*) ok n y "$3";; *) ok y y "$3";; esac; }

# mkrepo <dir> <origin-url> — a git repo whose origin is that URL
mkrepo() { mkdir -p "$1"; git -c init.defaultBranch=main init -q "$1" && git -C "$1" remote add origin "$2"; }
G="$TMP/g";   mkrepo "$G" https://github.com/demo/g.git;  mkdir -p "$G/sub/a" "$G/sub/b"; : > "$G/sub/file.txt"
G2="$TMP/g2"; mkrepo "$G2" git@github.com:demo/g.git       # a second clone of G's origin
H="$TMP/h";   mkrepo "$H" https://github.com/demo/h.git
TS="$TMP/ts"; mkrepo "$TS" https://github.com/lachyts/thread-skill.git
TS2="$TMP/ts2"; mkrepo "$TS2" git@github.com:lachyts/thread-skill
TS3="$TMP/ts3"; mkrepo "$TS3" https://github.com/LachyTS/Thread-Skill/
N="$TMP/plain"; mkdir -p "$N/a" "$N/b"                     # a directory in no checkout
mkdir -p "$TMP/links"; ln -s "$G" "$TMP/links/g"
# A workspaces monorepo: two workspaces, three launchers, each with a marker naming its workspace directory. The
# markers are here on purpose: the plan never reads them, so every launcher claims the one checkout.
W="$TMP/w"; mkrepo "$W" https://github.com/demo/workspaces.git
for l in aw/launchers/seo aw/launchers/web ow/launchers/full; do
  mkdir -p "$W/$l"; printf '{"workspace_dir": "%s"}\n' "$W/${l%%/*}" > "$W/$l/.workspace-launch.json"
done
mkdir -p "$W/aw/docs" "$W/_shared/x"
LF="$TMP/launch-folders.json"
cat > "$LF" <<EOF
{"schema_version": 1,
 "by_alias": {"cc-a-seo": "$W/aw/launchers/seo", "cc-a-web": "$W/aw/launchers/web", "cc-o": "$W/ow/launchers/full",
              "cx-a-seo": "$W/aw/launchers/seo", "cc-gone": "$TMP/gone"},
 "plain_aliases": {"cc-w": "$W", "cc-g": "$G", "cc-gsub": "$G/sub", "cc-ts": "$TS", "cc-null": null}}
EOF

S=""; V=""; T=""
# scen <name> — a fresh vault $V (tasks at $T, projects under $V/Work/Projects)
scen() { S="$TMP/$1"; V="$S/vault"; T="$V/Work/Tasks"; mkdir -p "$T" "$V/Work/Projects/Area" "$V/Work/X"; echo "== $1"; }
# mkt <slug> [frontmatter lines...] — a task note; $LAUNCH (when set) is its ## Launch body
mkt() {
  local s="$1"; shift
  { printf -- '---\ntags: [task]\nstatus: open\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody\n'
    [ -z "${LAUNCH:-}" ] || printf '\n## Launch\n\n%s\n' "$LAUNCH"; } > "$T/$s.md"
}
# mkp <name> [frontmatter lines...] — a project note at Work/Projects/Area/<name>.md; $PBODY is its body
mkp() {
  local n="$1"; shift
  { printf -- '---\ntags: [project]\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n%s\n' "${PBODY:-}"; } > "$V/Work/Projects/Area/$n.md"
}
# plan [args...] -> $out (stdout), $err (stderr), $rc
plan() { python3 "$SC" plan --vault "$V" --launch-folders "${LFX:-$LF}" "$@" > "$S.out" 2> "$S.err"; rc=$?; out=$(cat "$S.out"); err=$(cat "$S.err"); }
# j <python expression over d> — compact JSON of it, from the last plan's stdout
j() { printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(json.dumps(eval(sys.argv[1]), separators=(",", ":"), sort_keys=True, ensure_ascii=False))' "$1"; }
chains='[c["tasks"] for c in d["chains"]]'
mem() { j "{m: v[\"$2\"] for c in d[\"chains\"] for m, v in c[\"members\"].items()}[\"$1\"]"; }   # mem <slug> <field>

# ── P1: grouping and order ────────────────────────────────────────────────────────────────────────────
scen p1
mkt a 'surfaces: ["ext:cms-a"]'; mkt b 'surfaces: ["ext:cms-b"]'; mkt c 'surfaces: ["ext:CMS-A"]'
plan --tasks a,b
ok "$rc|$(j "$chains")|$err" '0|[["a"],["b"]]|' "P1: two declared disjoint tasks give two chains, exit 0, nothing on stderr"
plan --tasks a,c
ok "$(j "$chains")" '[["a","c"]]' "P1: an overlap (ext: case-folded) gives one chain"
mkt d 'surfaces: ["ext:d"]' 'depends-on: ["[[e]]"]'; mkt e 'surfaces: ["ext:e"]'
plan --tasks d,e
ok "$(j "$chains")" '[["e","d"]]' "P1: a depends-on: between disjoint tasks gives one chain, its dependency first"
mkt f 'surfaces: ["ext:f"]'; mkt gg 'surfaces: ["ext:g"]'
plan --tasks f,gg --dep f=gg
ok "$(j "$chains")" '[["gg","f"]]' "P1: --dep does the same"
# Ties: within a phase, rows of the previous row's launch first; a -p2- row after every -p1- row (even of the same
# launch), a slug with no phase after both; then M, then the slug.
for x in "x-p1-1 cc-a-seo" "x-p1-2 cc-a-web" "x-p1-3 cc-a-seo" "x-p1-4 cc-a-web" "x-p2-1 cc-a-seo" "xnum cc-a-web"; do
  set -- $x; mkt "$1" "launch: $2" 'surfaces: ["ext:same"]'
done
plan --tasks xnum,x-p2-1,x-p1-4,x-p1-3,x-p1-2,x-p1-1
ok "$(j "$chains")" '[["x-p1-1","x-p1-3","x-p1-2","x-p1-4","x-p2-1","xnum"]]' "P1: phase, then same launch as the previous row, then M, then slug"
mkt cy1 'surfaces: ["ext:c1"]' 'depends-on: ["[[cy2]]"]'; mkt cy2 'surfaces: ["ext:c2"]' 'depends-on: ["[[cy1]]"]'
plan --tasks cy1,cy2
ok "$rc|$out" "3|" "P1: a dependency cycle exits 3 with no stdout"
has "$err" "REFUSE: dependency cycle among [[cy1]], [[cy2]]" "P1: … naming the cycle"
mkt ex1 'surfaces: ["ext:x1"]' 'depends-on: ["[[outside]]"]'
plan --tasks ex1
ok "$(j 'd["chains"][0]["externalDeps"]')" '[{"dependsOn":"outside","task":"ex1"}]' "P1: a dependency outside the set is listed in externalDeps"

# ── P2: derivation and sources ────────────────────────────────────────────────────────────────────────
scen p2
LAUNCH="- **Repo:** \`$G\`" mkt d1
LAUNCH="- **Repo:** \`$G\` — branch off \`main\`, one PR." mkt d2
LAUNCH="- **Repos:** \`$G\`,
  \`$H\`" mkt d3
LAUNCH="- **Launch:** \`claude\` from \`$G\`" mkt d4
LAUNCH="\`cc-x\` — cwd \`$G/sub\`" mkt d5
LAUNCH="- **Repo:** \`$G/sub/file.txt\`" mkt d6
LAUNCH="- **Repo:** \`$G/sub/new.py\`" mkt d7
LAUNCH="- **Read first:** \`$H\`, \`$G/sub\`
- **MCP:** \`$H\`
- **Repo:** \`$G\`" mkt d8
LAUNCH="- **Launch:** \`cc-a-seo\`, then \`/seo:impact\` and \`/morning\`" mkt d9
LAUNCH="- **Notes:** \`$V/Work/X\`" mkt d10
LAUNCH="- **Engine:** \`$N\`" mkt d11
for t in d1 d2 d4 d5 d6 d8; do
  plan --tasks $t
  ok "$(mem $t surfaces)|$(mem $t source)" "[\"repo:$G\"]|\"derived\"" "P2: $t's ## Launch claims repo:$G (derived)"
done
plan --tasks d3
ok "$(mem d3 surfaces)" "[\"repo:$G\",\"repo:$H\"]" "P2: **Repos:** with a continuation line claims both"
plan --tasks d7
ok "$(mem d7 surfaces)" "[\"repo:$G\"]" "P2: a file that does not exist yet claims its checkout"
has "$(j 'd["warns"]')" "d7: $G/sub/new.py does not exist yet: claimed through its nearest existing ancestor $G/sub" "P2: … with the through-its-ancestor WARN"
plan --tasks d9
ok "$(mem d9 surfaces)|$(mem d9 source)" '["vault"]|"default"' "P2: /seo:impact, /morning and alias spans give no token"
plan --tasks d10
ok "$(mem d10 surfaces)" '["vault:Work/X"]' "P2: a vault path gives vault:<rel>"
plan --tasks d11
ok "$(mem d11 surfaces)" "[\"repo:$N\"]" "P2: a directory in no checkout is claimed path-only"
has "$(j 'd["warns"]')" "d11: $N is in no git checkout: repo:$N covers everything beneath it" "P2: … with the covers-everything WARN"
plan --tasks d1 --surface d1=ext:cms
ok "$(mem d1 surfaces)|$(mem d1 source)|$(mem d1 added)" "[\"ext:cms\",\"repo:$G\"]|\"derived\"|[\"ext:cms\"]" "P2: --surface adds a token, listed in added"
mkt d13 'surfaces: ["ext:a"]'
plan --tasks d13 --surface "d13=$H"
ok "$(mem d13 surfaces)|$(mem d13 source)|$(mem d13 added)" "[\"ext:a\",\"repo:$H\"]|\"declared\"|[\"repo:$H\"]" "P2: a declared member plus --surface keeps both (declared, added set)"
mkt d14
plan --tasks d14 --surface d14=ext:only
ok "$(mem d14 surfaces)|$(mem d14 source)|$(mem d14 added)" '["ext:only"]|"derived"|["ext:only"]' "P2: an added-only member reads derived, added set"
hasnt "$(j 'd["warns"]')" "d14: no surface" "P2: … with no default WARN"
LAUNCH="- **Repo:** \`$G\`" mkt d15 'surfaces: []'
plan --tasks d15
ok "$(mem d15 surfaces)|$(mem d15 source)" "[\"repo:$G\"]|\"derived\"" "P2: an empty surfaces: [] reads as absent"

# ── P2b: launch folders and paths widen to the checkout ───────────────────────────────────────────────
scen p2b
mkt w1 'launch: cc-a-seo'; mkt w2 'launch: cc-a-web'; mkt w3 'launch: cc-o'; mkt w4 'launch: cc-w'
plan --tasks w1
ok "$(mem w1 surfaces)|$(mem w1 launch)" "[\"repo:$W\"]|{\"alias\":\"cc-a-seo\",\"folder\":\"$W/aw/launchers/seo\"}" "P2b: cc-a-seo claims repo:\$W (never \$W/aw), from its launcher folder"
plan --tasks w1,w2
ok "$rc|$(j "$chains")|$(j '[m["launch"]["alias"] for m in d["chains"][0]["members"].values()]')" '0|[["w1","w2"]]|["cc-a-seo","cc-a-web"]' "P2b: two profiles of one workspace: one chain, two launches, exit 0"
plan --tasks w1,w3
ok "$rc|$(j "$chains")" '0|[["w1","w3"]]' "P2b: two workspaces of one checkout: one chain, two launches, exit 0"
plan --tasks w4,w1
ok "$(j "$chains")" '[["w1","w4"]]' "P2b: cc-w (the checkout itself) and cc-a-seo: one chain"
LAUNCH="- **Repo:** \`$W/aw/docs\`" mkt w5
LAUNCH="- **Repo:** \`$W/_shared/x\`" mkt w6
plan --tasks w5,w6
ok "$(mem w5 surfaces)|$(mem w6 surfaces)|$(j "$chains")" "[\"repo:$W\"]|[\"repo:$W\"]|[[\"w5\",\"w6\"]]" "P2b: two ## Launch paths in one checkout both claim it: one chain"
mkt w7 'launch: cc-gsub'
plan --tasks w7
ok "$(mem w7 surfaces)" "[\"repo:$G\"]" "P2b: a launch folder below the toplevel claims the toplevel"
mkt w8 'surfaces:' "  - repo:$W/aw"
plan --tasks w8
ok "$(mem w8 surfaces)|$(mem w8 source)" "[\"repo:$W\"]|\"declared\"" "P2b: a declared repo: inside a checkout widens to its toplevel"
mkt w9 'launch: cc-a-seo' 'surfaces: ["vault:Work/X"]'
plan --tasks w9
ok "$(mem w9 surfaces)" '["vault:Work/X"]' "P2b: a declaration replaces the launch-folder claim"
mkt w10 'launch: cx-a-seo'
plan --tasks w1,w10
ok "$(j "$chains")|$(j '[m["launch"]["alias"] for m in d["chains"][0]["members"].values()]')" '[["w1","w10"]]|["cc-a-seo","cx-a-seo"]' "P2b: cc-a-seo and cx-a-seo are different launches of one folder"

# ── P2c: the default ──────────────────────────────────────────────────────────────────────────────────
scen p2c
mkt f1; mkt f2 'surfaces: ["vault:Work/X"]'; mkt f3 "surfaces: [\"repo:$G\"]"; mkt f4 'surfaces: ["any"]'; mkt f5 'surfaces: ["ext:cms"]'
plan --tasks f1
ok "$(mem f1 surfaces)|$(mem f1 source)" '["vault"]|"default"' "P2c: no source claims the vault (default)"
has "$(j 'd["warns"]')" "f1: no surface declared or derived: it claims only the vault; declare \`surfaces:\`" "P2c: … with a WARN to declare surfaces:"
plan --tasks f1,f2
ok "$(j "$chains")" '[["f1","f2"]]' "P2c: the default shares a chain with a vault:Work/X task"
plan --tasks f1,f3
ok "$(j "$chains")" '[["f1"],["f3"]]' "P2c: … but not with a declared repo: task (the stated limit)"
plan --tasks f2,f3,f4,f5
ok "$(j "$chains")" '[["f2","f4","f5","f3"]]' "P2c: a declared any overlaps a repo:, an ext: and a vault task (rows of one launch kept together)"

# ── P2d: launch commands and the first project's Local: ───────────────────────────────────────────────
scen p2d
F='```'
LAUNCH="$F""bash
cc-g --add-dir $H
$F

No MCP required." mkt c1 'launch: cc-g'
plan --tasks c1
ok "$(mem c1 surfaces)|$(mem c1 source)" "[\"repo:$G\",\"repo:$H\"]|\"derived\"" "P2d: a fenced cc-g --add-dir \$H claims repo:\$H beside the launch folder's checkout"
LAUNCH="$F""bash
cc-g
cat $H/README.md
$F" mkt c2 'launch: cc-g'
plan --tasks c2
ok "$(mem c2 surfaces)" "[\"repo:$G\"]" "P2d control: a fenced block with no --add-dir claims nothing extra (a path a command only reads)"
LAUNCH="$F""bash
# cc-g --add-dir $H
cc-g
$F
- **Read first:** \`cc-g --add-dir $H\`" mkt c3 'launch: cc-g'
plan --tasks c3
ok "$(mem c3 surfaces)" "[\"repo:$G\"]" "P2d control: a commented-out --add-dir and one in a Read item claim nothing"
LAUNCH="$F""sh
cc-g --add-dir \"\$HOME/h\" \\
  --add-dir=$N/a
$F" mkt c4 'launch: cc-g'
HOME="$TMP" plan --tasks c4
ok "$(mem c4 surfaces)" "[\"repo:$G\",\"repo:$H\",\"repo:$N/a\"]" "P2d: a continued line's --add-dir \"\$HOME/…\" and --add-dir=<path> both claim"
# A bare home or root would contain every repo token (the whole estate): never claimed. HOME=$TMP, so ~/h is $H.
LAUNCH="$F""sh
cd ~ && cc-g --add-dir ~ ~/h
cc-g --add-dir /
$F
- **Repo:** \`~/\`" mkt c6 'launch: cc-g'
HOME="$TMP" plan --tasks c6
ok "$rc|$(mem c6 surfaces)|$(mem c6 source)" "0|[\"repo:$G\",\"repo:$H\"]|\"derived\"" "P2d: cd ~, --add-dir ~, --add-dir / and a \`~/\` span claim nothing; ~/h after --add-dir ~ still claims"
ok "$(j '[w for w in d["warns"] if "is / or the home directory" in w]' | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')" 4 "P2d: … each with a WARN naming it"
has "$(j 'd["warns"]')" "c6: its ## Launch --add-dir ~ is / or the home directory (or above it): not claimed" "P2d: … the WARN names the flag and the path"
hasnt "$(j 'd["warns"]')" "repo:$TMP " "P2d: … and no path-only claim on the home directory"
LAUNCH="$F""sh
cc-g --add-dir ~
$F" mkt c7 'launch: cc-g' 'surfaces: ["ext:c7"]'
HOME="$TMP" plan --tasks c7
ok "$(mem c7 surfaces)|$(j 'd["warns"]')" '["ext:c7"]|[]' "P2d control: a declared member's --add-dir ~ draws no WARN (its declaration is its claim)"
LAUNCH="$F""sh
cc-g --add-dir ~/h
$F" mkt c8 'launch: cc-g'
HOME="$TMP" plan --tasks c8
ok "$(mem c8 surfaces)|$(j 'd["warns"]')" "[\"repo:$G\",\"repo:$H\"]|[]" "P2d control: a path below the home directory is claimed, with no WARN"
LAUNCH="- **Launch:** \`cd $H && claude\`" mkt c5
plan --tasks c5
ok "$(mem c5 surfaces)|$(mem c5 launch)" "[\"repo:$H\"]|{\"alias\":\"claude\",\"folder\":\"$H\"}" "P2d: a leading cd in an inline launch span claims its checkout"
PBODY="Repo: x · Local: \`$H/\` · more" mkp HProj
PBODY="Local: \`$N/b\`" mkp NProj
mkp Bare
PBODY="(not a single repo, so no \`Local:\` marker): scouts in \`$G/sub\`" mkp NoLocal
mkt k1 'launch: cc-g' 'projects: ["[[HProj]]"]'
plan --tasks k1
ok "$(mem k1 surfaces)|$(mem k1 source)" "[\"repo:$G\",\"repo:$H\"]|\"derived\"" "P2d: an undeclared member claims its first project's Local: checkout beside its launch folder"
mkt k2 'projects: ["[[HProj]]"]' 'surfaces: ["ext:k"]'
plan --tasks k2
ok "$(mem k2 surfaces)" '["ext:k"]' "P2d control: a declared member never claims its project's Local:"
mkt k3 'projects: ["[[Bare]]", "[[HProj]]"]'
plan --tasks k3
ok "$(mem k3 surfaces)|$(mem k3 source)" '["vault"]|"default"' "P2d control: a second project's Local: is not claimed"
mkt k4 'projects: ["[[NProj]]"]'
plan --tasks k4
ok "$(mem k4 surfaces)" "[\"repo:$N/b\"]" "P2d: a Local: in no checkout is claimed path-only"
mkt k5 'projects: ["[[NoLocal]]"]'
plan --tasks k5
ok "$(mem k5 surfaces)" '["vault"]' "P2d control: a backticked \`Local:\` that names no path claims nothing"
LAUNCH="- **Repo:** \`$H\`" mkt k6
plan --tasks k6,k1
ok "$(j "$chains")" '[["k1","k6"]]' "P2d: a member writing \$H shares a chain with one whose project's Local: is \$H"

# ── P3: the overlap grammar ───────────────────────────────────────────────────────────────────────────
ovl() {
  python3 - "$SC" "$@" <<'PY'
import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("sc", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
print(" ".join("y" if m.overlaps(a, b) else "n" for a, b in zip(sys.argv[2::2], sys.argv[3::2])))
PY
}
echo "== p3 (the grammar)"
ok "$(ovl vault:Work/A vault:Work/AB  vault:Work vault:Work/A  vault vault:Work/A  vault:work/a vault:Work/A/b)" "n y y y" "P3: vault tokens overlap on a segment-boundary prefix (case-folded); vault overlaps every vault token"
ok "$(ovl ext:CMS ext:cms  ext:cms ext:cms2  repo:/A/b repo:/a/b/c  repo:/a/b repo:/a/bc)" "y n y n" "P3: ext: by case-folded equality; repo: by containment at a / boundary, case-folded"
ok "$(ovl vault:Work ext:Work  repo:/x vault:x  ext:x repo:/x  any ext:x  any vault  repo:/x any)" "n n n y y y" "P3: kinds never cross, save any"
scen p3
mkt s1 "surfaces: [\"repo:$TMP/links/g\"]"; mkt s2 "surfaces: [\"repo:$G\"]"; mkt s3 "surfaces: [\"repo:$G2\"]"
plan --tasks s1,s2
ok "$(mem s1 surfaces)|$(j "$chains")" "[\"repo:$G\"]|[[\"s1\",\"s2\"]]" "P3: a symlinked repo: equals its target"
plan --tasks s2,s3
ok "$(j "$chains")" '[["s2"],["s3"]]' "P3: two clones of one origin are disjoint"
mkt q1 'surfaces:' '  - "vault:Work/A, B"'; mkt q2 'surfaces: ["vault:Work/A, B/x"]'
plan --tasks q1,q2
ok "$(mem q1 surfaces)|$(mem q2 surfaces)|$(j "$chains")" '["vault:Work/A, B"]|["vault:Work/A, B/x"]|[["q1","q2"]]' "P3: a comma inside a declared token stays one token, and overlaps"
mkt sd1 "surfaces: [\"repo:$G/sub/a\"]"; mkt sd2 "surfaces: [\"repo:$G/sub/b\"]"
plan --tasks sd1,sd2
ok "$(j "$chains")" '[["sd1","sd2"]]' "P3: two declared sibling subdirectories of one checkout widen to it: one chain"
mkt sn1 "surfaces: [\"repo:$N/a\"]"; mkt sn2 "surfaces: [\"repo:$N/b\"]"
plan --tasks sn1,sn2
ok "$(mem sn1 surfaces)|$(j "$chains")" "[\"repo:$N/a\"]|[[\"sn1\"],[\"sn2\"]]" "P3: two declared sibling subdirectories of a non-checkout stay path-only: two chains"
mkt m1 'surfaces: ["bogus:x"]'; mkt m2 'surfaces: ["repo:relative/path"]'
plan --tasks m1,m2
ok "$rc|$out" "3|" "P3: a malformed declared token exits 3"
has "$err" "REFUSE: m1: surfaces: bogus:x is not a surface token" "P3: … naming the task and its value"
has "$err" "REFUSE: m2: surfaces: repo:relative/path is not a surface token" "P3: … every malformed one"

# ── P4: ruling (c) ────────────────────────────────────────────────────────────────────────────────────
scen p4
mkt r1 "surfaces: [\"repo:$TS\"]"; mkt r2 "surfaces: [\"repo:$TS2\"]"; mkt r3 "surfaces: [\"repo:$TS3\"]"
plan --tasks r1,r2,r3
ok "$rc|$(j "$chains")|$(j '[s["slug"] for s in d["sessionLane"]]')" '0|[]|["r1","r2","r3"]' "P4: a repo: checkout of lachyts/thread-skill (https, ssh, a case variant) goes to the session lane"
has "$(j 'd["sessionLane"][0]["why"]')" "its surface repo:$TS is a checkout of github.com/lachyts/thread-skill" "P4: … with a why naming the source"
mkt r4 'launch: cc-ts'
plan --tasks r4
ok "$(j '[s["slug"] for s in d["sessionLane"]]')" '["r4"]' "P4: launch: cc-ts with no ## Launch goes to the session lane"
mkt r4b 'launch: cc-ts' 'surfaces: ["ext:z"]'
plan --tasks r4b
has "$(j 'd["sessionLane"][0]["why"]')" "its launch folder $TS (cc-ts) is a checkout of github.com/lachyts/thread-skill" "P4: … through its launch folder, even when it declares surfaces"
PBODY="Repo: [x](https://github.com/x) · Local: \`$TS\` and more" mkp TSProj
mkt r5 'projects: ["[[TSProj]]"]' 'surfaces: ["ext:x"]'
plan --tasks r5
ok "$(j '[s["slug"] for s in d["sessionLane"]]')" '["r5"]' "P4: a project whose Local: (mid-line) is a thread-skill checkout"
has "$(j 'd["sessionLane"][0]["why"]')" "its project [[TSProj]]'s Local: $TS" "P4: … named in the why"
mkp TSRepos 'repos:' "  - $TS2"
mkt r6 'projects: ["[[TSRepos]]"]' 'surfaces: ["ext:y"]'
plan --tasks r6
ok "$(j '[s["slug"] for s in d["sessionLane"]]')" '["r6"]' "P4: a project whose repos: names one"
mkt r7 "surfaces: [\"repo:$G\"]"
plan --tasks r7
ok "$(j "$chains")|$(j 'd["sessionLane"]')" '[["r7"]]|[]' "P4 control: another origin gives a chain"
F='```'
LAUNCH="$F""bash
cc-a-seo --add-dir $TS
$F" mkt r8 'launch: cc-a-seo'
plan --tasks r8
ok "$(j "$chains")|$(j '[s["slug"] for s in d["sessionLane"]]')" '[]|["r8"]' "P4: a fenced cc-a-seo --add-dir <thread-skill> with no project Local: goes to the session lane"
has "$(j 'd["sessionLane"][0]["why"]')" "its ## Launch --add-dir $TS is a checkout of github.com/lachyts/thread-skill" "P4: … with a why naming the --add-dir path"
LAUNCH="$F""bash
cc-a-seo --add-dir $TS
$F" mkt r9 'launch: cc-a-seo' 'surfaces: ["ext:z"]'
plan --tasks r9
has "$(j 'd["sessionLane"][0]["why"]')" "its ## Launch --add-dir $TS" "P4: … even when it declares surfaces"
LAUNCH="- **Launch:** \`cd $TS2 && claude\`" mkt r10
plan --tasks r10
has "$(j 'd["sessionLane"][0]["why"]')" "its ## Launch cd $TS2 is a checkout of github.com/lachyts/thread-skill" "P4: a leading cd in an inline launch span does the same"
LAUNCH="$F""bash
cc-a-seo --add-dir $H
$F" mkt r11 'launch: cc-a-seo'
plan --tasks r11
ok "$(j "$chains")|$(j 'd["sessionLane"]')" '[["r11"]]|[]' "P4 control: an --add-dir on another origin gives a chain"

# ── P5: launch ────────────────────────────────────────────────────────────────────────────────────────
scen p5
mkt l1 'launch: cc-a-web'; mkt l2 'launch: cc-g'
plan --tasks l1
ok "$(mem l1 launch)" "{\"alias\":\"cc-a-web\",\"folder\":\"$W/aw/launchers/web\"}" "P5: a by_alias alias gives its folder"
plan --tasks l2
ok "$(mem l2 launch)" "{\"alias\":\"cc-g\",\"folder\":\"$G\"}" "P5: a plain_aliases alias gives its folder"
mkt l3 'launch: cc-null'; mkt l4 'launch: cc-gone'; mkt l5 'launch: cc-nope'
plan --tasks l3
ok "$rc|$out" "3|" "P5: a null alias exits 3"
has "$err" "l3: cc-null has no launch folder: set \`launch:\` to an alias with one, or remove it so its Leg opens with \`claude\`" "P5: … with the has-no-folder remedy"
plan --tasks l4
ok "$rc" 3 "P5: a missing launch folder exits 3"
has "$err" "l4: launch folder $TMP/gone for cc-gone is missing: fix launch-folders.json or the task's \`launch:\`" "P5: … with the missing-folder remedy"
plan --tasks l5
ok "$rc" 3 "P5: an unknown alias exits 3"
has "$err" "l5: unknown alias cc-nope" "P5: … naming it"
plan --tasks l3,l4,l5
ok "$(printf '%s\n' "$err" | grep -c '^REFUSE:')" 3 "P5: every refusal is reported"
mkt l6 'launch: cc-o'
plan --tasks l1,l6
ok "$rc|$(j '[[m, v["launch"]["alias"]] for c in d["chains"] for m, v in c["members"].items()]')" '0|[["l1","cc-a-web"],["l6","cc-o"]]' "P5: two aliases in one chain exit 0, each row keeping its own launch"
mkp LProj 'launch: cc-g'
mkt l7 'projects: ["[[LProj]]"]'
plan --tasks l7
ok "$(mem l7 launch)|$(mem l7 surfaces)" "{\"alias\":\"cc-g\",\"folder\":\"$G\"}|[\"repo:$G\"]" "P5: the project's launch: applies when the task has none"
mkt l8 "surfaces: [\"repo:$G\"]"; mkt l9 'surfaces: ["ext:x"]'; mkt l10 "surfaces: [\"repo:$G\", \"repo:$H\"]"
plan --tasks l8,l9,l10
ok "$(mem l8 launch)" "{\"alias\":\"claude\",\"folder\":\"$G\"}" "P5: an alias-less row opens claude from its single repo"
ok "$(mem l9 launch)|$(mem l10 launch)" "{\"alias\":\"claude\",\"folder\":\"$V\"}|{\"alias\":\"claude\",\"folder\":\"$V\"}" "P5: … or from the vault root with zero or several repos"
PBODY="Local: \`$H\`" mkp HLocal
mkt l11 'projects: ["[[HLocal]]"]'
plan --tasks l11
ok "$(mem l11 launch)|$(mem l11 surfaces)" "{\"alias\":\"claude\",\"folder\":\"$H\"}|[\"repo:$H\"]" "P5: an alias-less row whose project's Local: is its one repo opens claude from it"
LFX="$TMP/none.json" plan --tasks l2
ok "$rc|$out" "3|" "P5: a missing launch-folders file while an alias needs it exits 3"
has "$err" "l2: launch alias cc-g needs $TMP/none.json, which is missing or unreadable" "P5: … naming the path"
LFX="$TMP/none.json" plan --tasks l9
ok "$rc|$(j "$chains")" '0|[["l9"]]' "P5: with no alias it exits 0"
has "$(j 'd["warns"]')" "$TMP/none.json is missing or unreadable" "P5: … with a WARN"

# ── P6: exit 2 ────────────────────────────────────────────────────────────────────────────────────────
scen p6
mkt a 'surfaces: ["ext:a"]'
usage() {  # usage <label> <python3 args...>
  local label="$1"; shift
  python3 "$@" > "$S.out" 2> "$S.err"; rc=$?
  ok "$rc|$(cat "$S.out")|$(wc -l < "$S.err" | tr -d ' ')" "2||1" "P6: $label exits 2, no stdout, one stderr line"
  has "$(cat "$S.err")" "serial-chains:" "P6: $label names the script"
}
usage "no --tasks" "$SC" plan --vault "$V" --launch-folders "$LF"
usage "a missing note" "$SC" plan --vault "$V" --launch-folders "$LF" --tasks a,nope
usage "a --surface with no =" "$SC" plan --vault "$V" --launch-folders "$LF" --tasks a --surface a
usage "a --surface of an unknown kind" "$SC" plan --vault "$V" --launch-folders "$LF" --tasks a --surface a=bogus:x
usage "a relative repo: --surface" "$SC" plan --vault "$V" --launch-folders "$LF" --tasks a --surface a=repo:rel
usage "a --surface for a non-member" "$SC" plan --vault "$V" --launch-folders "$LF" --tasks a --surface zz=ext:x
usage "a --dep with no =" "$SC" plan --vault "$V" --launch-folders "$LF" --tasks a --dep a
mkdir -p "$S/alone/skills/_shared/scripts"; cp "$SC" "$S/alone/skills/_shared/scripts/"
usage "reconcile-rollout.py unloadable" "$S/alone/skills/_shared/scripts/serial-chains.py" plan --vault "$V" --launch-folders "$LF" --tasks a
has "$(cat "$S.err")" "serial-chains: cannot load" "P6: … says so"
mkdir -p "$S/bare/skills/_shared/scripts" "$S/bare/skills/execute/scripts"
cp "$SC" "$S/bare/skills/_shared/scripts/"; cp "$RR" "$S/bare/skills/execute/scripts/"
usage "plugin.json unreadable" "$S/bare/skills/_shared/scripts/serial-chains.py" plan --vault "$V" --launch-folders "$LF" --tasks a
has "$(cat "$S.err")" "plugin.json" "P6: … names plugin.json"
has "$(cat "$S.err")" "ruling (c) cannot be checked" "P6: … and fails closed"

echo
if [ "$fail" -eq 0 ]; then echo "serial-chains: ALL PASS"; else echo "serial-chains: FAILED"; fi
exit "$fail"
