#!/usr/bin/env bash
# skills/_shared/scripts/serial-chains.py plan: schedule § Serial path's S2 (ADR 0040, p24-2). A serial set's
# chains (surface overlap and dependencies), each member's surfaces and where they came from, its launch, and
# ruling (c)'s session lane:
#   P1   grouping and order: disjoint chains, overlap and dependency edges, the phase / launch / M / slug tie-break,
#        a cycle refused, an outside dependency listed
#   P2   derivation and sources: the real `## Launch` shapes, Read and MCP items skipped, non-path spans skipped,
#        the vault, a path in no checkout, --surface (always unions in), the added-only member, an empty `surfaces:`
#   P2b  reach (a launch folder, a where-label value at any depth, a toplevel span) names only the checkout a member
#        works, predicting nothing there (its own task note only), so two workspace launchers' members form two
#        chains; a path below a toplevel is a file or folder token, declared or derived; two members naming one file
#        share a chain, sibling files do not; the ledgers are bookkeeping; a linked worktree keys to its main
#        worktree, a second clone and a --separate-git-dir checkout to their own toplevel (their markers are never read)
#   P2c  the default (the vault only, for a member naming no project and no path) and its stated limit; a declared
#        `any`
#   P2d  launch commands (`--add-dir` and a leading `cd`, fenced or in a span) and the first project's `Local:` are
#        derived claims; a fenced path no such command names, a comment, a Read item, a declared member, a second
#        project's `Local:` and a backticked `Local:` with no path claim nothing; a `## Launch` path that is `/` or
#        the home directory is never claimed (a WARN for an undeclared member)
#   P3   the token grammar and the overlap grammar (pure: keyed `repo:<toplevel>//<path>` tokens, a bare one covering
#        its checkout, checkouts_of), symlinks, clones, a checkout nested inside another (p33-3), a comma inside a
#        token, sibling subdirectories, a malformed token
#   P4   ruling (c): a member on a checkout of lachyts/thread-skill (a `## Launch` `--add-dir` or `cd` path, declared
#        or not, its surface, its launch folder, its project's `Local:` or `repos:`) goes to the session lane
#   P5   launch: by_alias then plain_aliases, the null, missing and unknown refusals, the project's `launch:`, the
#        alias-less member (from its one repo, its project's `Local:` included; refused when it writes two
#        checkouts), a missing launch-folders file
#   P7   vault chains claim their own project places (ADR 0059): a vault-root launch or path narrows to the first
#        project's place (a folder note's folder, else the note and its would-be folder) and the member's own task
#        note; Work/Tasks is bookkeeping; the whole-vault fallbacks; --surface adds; a code row never opens where its
#        Leg cannot finish it (ruling (c) first, read through `works`); the serial check schedules every chain, a
#        shared place WARNing that they take turns (ADR 0067 d4)
#   P8   the 2026-11-02 replan fixture (docs/spikes/2026-11-02-replan.py) over a synthetic estate: only the same-file
#        pair and the declared-bare pairs clash, and no workspaces or Projects pair appears
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
  \`$H\`" mkt d3 'launch: cc-g'   # an alias-less row writing two checkouts is refused (P7)
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
# A where-label value (**Repo:**, **Launch:**, at any depth) names where the member works, never what it writes: it
# predicts nothing in $G, so it claims only its own task note, with a WARN (ADR 0067 d4).
for t in d1 d2 d4 d6 d7 d8; do
  plan --tasks $t
  ok "$(mem $t surfaces)|$(mem $t source)|$(mem $t works)" "[\"vault:Work/Tasks/$t.md\"]|\"derived\"|[\"$G\"]" "P2: $t's ## Launch names \$G as where it works: works [\$G], its own task note its only claim (derived)"
  has "$(j 'd["warns"]')" "WARN: $t: names no file in $G: it predicts nothing there, so it orders against no chain's files (ADR 0067 d4); declare \`surfaces:\` for the files it writes" "P2: … with the predicts-nothing WARN"
done
plan --tasks d7
hasnt "$(j 'd["warns"]')" "does not exist yet" "P2: a **Repo:** value not there yet keeps no token, so no through-its-ancestor WARN"
plan --tasks d5
ok "$(mem d5 surfaces)|$(mem d5 works)" "[\"repo:$G//sub/\"]|[\"$G\"]" "P2: d5's unlabelled cwd span is a prediction: a folder token repo:\$G//sub/"
plan --tasks d3
ok "$(mem d3 surfaces)|$(mem d3 works)" "[\"vault:Work/Tasks/d3.md\"]|[\"$G\",\"$H\"]" "P2: **Repos:** with a continuation line: both toplevels are reach"
LAUNCH="- **Files:** \`$G/sub/new.py\`, \`$G/sub/file.txt\`" mkt d16 'launch: cc-g'
plan --tasks d16
ok "$(mem d16 surfaces)|$(mem d16 works)" "[\"repo:$G//sub/file.txt\",\"repo:$G//sub/new.py\"]|[\"$G\"]" "P2: **Files:** spans below the toplevel are file tokens"
has "$(j 'd["warns"]')" "d16: $G/sub/new.py does not exist yet: claimed through its nearest existing ancestor $G/sub" "P2: … a file not there yet with the through-its-ancestor WARN"
LAUNCH="- **Repo:** \`$G\` (also edits \`$G/sub/file.txt\`)" mkt d17
plan --tasks d17
ok "$(mem d17 surfaces)|$(mem d17 works)" "[\"repo:$G//sub/file.txt\"]|[\"$G\"]" "P2: a later span below the toplevel on a **Repo:** line is a prediction"
plan --tasks d9
ok "$(mem d9 surfaces)|$(mem d9 source)" '["vault"]|"default"' "P2: /seo:impact, /morning and alias spans give no token"
plan --tasks d10
ok "$(mem d10 surfaces)" '["vault:Work/X"]' "P2: a vault path gives vault:<rel>"
plan --tasks d11
ok "$(mem d11 surfaces)" "[\"repo:$N\"]" "P2: a directory in no checkout is claimed path-only"
has "$(j 'd["warns"]')" "d11: $N is in no git checkout: repo:$N covers everything beneath it" "P2: … with the covers-everything WARN"
plan --tasks d1 --surface d1=ext:cms
ok "$(mem d1 surfaces)|$(mem d1 source)|$(mem d1 added)|$(mem d1 works)" "[\"ext:cms\"]|\"derived\"|[\"ext:cms\"]|[\"$G\"]" "P2: --surface adds a token, listed in added (its reach names no file, so no own-note claim)"
plan --tasks d1 --surface "d1=$G/sub/file.txt"
ok "$(mem d1 surfaces)|$(mem d1 added)" "[\"repo:$G//sub/file.txt\"]|[\"repo:$G//sub/file.txt\"]" "P2: an added path below the toplevel is a file token"
mkt d13 'surfaces: ["ext:a"]'
plan --tasks d13 --surface "d13=$H"
ok "$(mem d13 surfaces)|$(mem d13 source)|$(mem d13 added)" "[\"ext:a\",\"repo:$H\"]|\"declared\"|[\"repo:$H\"]" "P2: a declared member plus --surface keeps both (declared, added set; a toplevel stays bare)"
mkt d14
plan --tasks d14 --surface d14=ext:only
ok "$(mem d14 surfaces)|$(mem d14 source)|$(mem d14 added)" '["ext:only"]|"derived"|["ext:only"]' "P2: an added-only member reads derived, added set"
hasnt "$(j 'd["warns"]')" "d14: no surface" "P2: … with no default WARN"
LAUNCH="- **Repo:** \`$G\`" mkt d15 'surfaces: []'
plan --tasks d15
ok "$(mem d15 surfaces)|$(mem d15 source)|$(mem d15 works)" "[\"vault:Work/Tasks/d15.md\"]|\"derived\"|[\"$G\"]" "P2: an empty surfaces: [] reads as absent"
# touches: are predicted file tokens: a relative item keyed to the member's one checkout, an absolute one claimed.
mkt d18 'launch: cc-g' 'touches:' '  - sub/file.txt' '  - "sub/a/"' "  - $H/x.py"
plan --tasks d18
ok "$(mem d18 surfaces)|$(mem d18 works)" "[\"repo:$G//sub/a/\",\"repo:$G//sub/file.txt\",\"repo:$H//x.py\"]|[\"$G\",\"$H\"]" "P2: touches: relative items keyed to its one checkout, an absolute one claimed"
LAUNCH="\`\`\`
cc-g --add-dir $H
\`\`\`" mkt d19 'launch: cc-g' "touches: [sub/file.txt]"
plan --tasks d19
ok "$(mem d19 surfaces)|$(mem d19 works)" "[\"vault:Work/Tasks/d19.md\"]|[\"$G\",\"$H\"]" "P2: relative touches: with two checkouts are skipped"
has "$(j 'd["warns"]')" "d19: its touches: sub/file.txt name paths in a checkout, and it works 2 checkouts ($G, $H): not claimed" "P2: … with one WARN"

# ── P2b: reach names a checkout; a path below its toplevel is a file or folder token (ADR 0067 d4) ─────────
scen p2b
co() { j "[c[\"checkouts\"] for c in d[\"chains\"]]"; }   # each chain's checkouts
mkt w1 'launch: cc-a-seo'; mkt w2 'launch: cc-a-web'; mkt w3 'launch: cc-o'; mkt w4 'launch: cc-w'
plan --tasks w1
ok "$(mem w1 surfaces)|$(mem w1 works)|$(mem w1 launch)" "[\"vault:Work/Tasks/w1.md\"]|[\"$W\"]|{\"alias\":\"cc-a-seo\",\"folder\":\"$W/aw/launchers/seo\"}" "P2b: cc-a-seo's launcher folder is reach: it works \$W (never \$W/aw) and predicts nothing there"
has "$(j 'd["warns"]')" "w1: names no file in $W: it predicts nothing there" "P2b: … with the predicts-nothing WARN"
plan --tasks w1,w2
ok "$rc|$(j "$chains")|$(co)" "0|[[\"w1\"],[\"w2\"]]|[[\"$W\"],[\"$W\"]]" "P2b: two profiles of one workspace: two chains, each with checkouts [\$W], exit 0"
plan --tasks w1,w3
ok "$rc|$(j "$chains")|$(co)" "0|[[\"w1\"],[\"w3\"]]|[[\"$W\"],[\"$W\"]]" "P2b: two workspaces of one checkout: two chains, exit 0"
plan --tasks w4,w1
ok "$(j "$chains")" '[["w1"],["w4"]]' "P2b: cc-w (the checkout itself) and cc-a-seo: two chains"
LAUNCH="- **Repo:** \`$W/aw/docs\`" mkt w5
LAUNCH="- **Repo:** \`$W/_shared/x\`" mkt w6
plan --tasks w5,w6
ok "$(mem w5 surfaces)|$(mem w6 works)|$(j "$chains")" "[\"vault:Work/Tasks/w5.md\"]|[\"$W\"]|[[\"w5\"],[\"w6\"]]" "P2b: a **Repo:** value at depth is reach: two chains"
mkt w7 'launch: cc-gsub'
plan --tasks w7
ok "$(mem w7 surfaces)|$(mem w7 works)" "[\"vault:Work/Tasks/w7.md\"]|[\"$G\"]" "P2b: a launch folder below the toplevel names that checkout"
mkt w8 'surfaces:' "  - repo:$W/aw"; mkt w8b "surfaces: [\"repo:$W\"]"
plan --tasks w8
ok "$(mem w8 surfaces)|$(mem w8 source)|$(mem w8 works)" "[\"repo:$W//aw/\"]|\"declared\"|[\"$W\"]" "P2b: a declared repo: inside a checkout is a folder token at its own depth"
plan --tasks w8b
ok "$(mem w8b surfaces)" "[\"repo:$W\"]" "P2b: a declared repo: toplevel stays bare (it covers the whole checkout)"
mkt w9 'launch: cc-a-seo' 'surfaces: ["vault:Work/X"]'
plan --tasks w9
ok "$(mem w9 surfaces)|$(mem w9 works)" '["vault:Work/X"]|[]' "P2b: a declaration replaces the launch-folder reach"
mkt w10 'launch: cx-a-seo'
plan --tasks w1,w10
ok "$(j "$chains")|$(j '[m["launch"]["alias"] for c in d["chains"] for m in c["members"].values()]')" '[["w1"],["w10"]]|["cc-a-seo","cx-a-seo"]' "P2b: cc-a-seo and cx-a-seo are different launches of one folder"
LAUNCH="- **Files:** \`$W/aw/docs/x.md\`" mkt w11 'launch: cc-a-seo'
LAUNCH="- **Files:** \`$W/aw/docs/x.md\`" mkt w12 'launch: cc-a-web'
LAUNCH="- **Files:** \`$W/aw/docs/y.md\`" mkt w13 'launch: cc-a-web'
plan --tasks w11
ok "$(mem w11 surfaces)|$(mem w11 works)" "[\"repo:$W//aw/docs/x.md\"]|[\"$W\"]" "P2b: a **Files:** span is a file token, keyed to its toplevel"
plan --tasks w11,w12,w13
ok "$(j "$chains")|$(co)" "[[\"w11\",\"w12\"],[\"w13\"]]|[[\"$W\"],[\"$W\"]]" "P2b: two members naming one file share a chain (two launches); a sibling file is another chain"
mkt w20 "surfaces: [\"repo:$W//aw/docs/\"]"
plan --tasks w11,w13,w20
ok "$(j "$chains")" '[["w11","w13","w20"]]' "P2b: a folder token covers the files inside it"
# The ledgers every run appends to are bookkeeping (ADR 0067 d5): derived ones dropped silently, an added one with a
# WARN, a declared one kept.
mkdir -p "$W/_shared/state/thread-events" "$G/docs/reviews"
LAUNCH="- **Ledger:** \`$W/_shared/state/thread-events/x.jsonl\`, \`$G/docs/reviews/r.md\`" mkt w14 'launch: cc-w'
plan --tasks w14
ok "$(mem w14 surfaces)|$(mem w14 works)" "[\"vault:Work/Tasks/w14.md\"]|[\"$W\"]" "P2b: a Run record or review-doc span is bookkeeping, never a claim"
hasnt "$out" "thread-events" "P2b: … named nowhere in the plan"
plan --tasks w14 --surface "w14=$W/_shared/state/thread-events/y.jsonl"
ok "$(mem w14 added)" '[]' "P2b: an added ledger path is dropped"
has "$(j 'd["warns"]')" "w14: --surface $W/_shared/state/thread-events/y.jsonl is a ledger every run appends to" "P2b: … with a WARN"
mkt w15 "surfaces: [\"repo:$G/docs/reviews/r.md\"]"
plan --tasks w15
ok "$(mem w15 surfaces)" "[\"repo:$G//docs/reviews/r.md\"]" "P2b: a declared ledger is kept (a declaration is deliberate)"
# Keys: a linked worktree's path keys to its main worktree, so it reads the same from any copy; a second clone, and a
# --separate-git-dir checkout, are their own.
GW="$TMP/gw"; mkrepo "$GW" https://github.com/demo/gw.git; : > "$GW/a.txt"
git -C "$GW" add a.txt && git -C "$GW" -c user.name=t -c user.email=t@t.invalid commit -qm a
git -C "$GW" worktree add -q "$TMP/gw-wt" -b wt 2>/dev/null
git init -q --separate-git-dir "$TMP/sep.git" "$TMP/sep"; : > "$TMP/sep/f.txt"
LAUNCH="- **Files:** \`$TMP/gw-wt/a.txt\`" mkt k20
LAUNCH="- **Files:** \`$G2/x.txt\`" mkt k21
LAUNCH="- **Files:** \`$TMP/sep/f.txt\`" mkt k22
LAUNCH="- **Files:** \`$GW/a.txt\`" mkt k23
plan --tasks k20
ok "$(mem k20 surfaces)" "[\"repo:$GW//a.txt\"]" "P2b: a file in a linked worktree keys to the main worktree"
plan --tasks k21
ok "$(mem k21 surfaces)" "[\"repo:$G2//x.txt\"]" "P2b: a second clone keeps its own key"
plan --tasks k22
ok "$(mem k22 surfaces)" "[\"repo:$TMP/sep//f.txt\"]" "P2b: a --separate-git-dir checkout keys to its own toplevel"
plan --tasks k20,k23
ok "$(j "$chains")" '[["k20","k23"]]' "P2b: the linked worktree's file and the main worktree's are one place"

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
ok "$(mem c1 surfaces)|$(mem c1 source)|$(mem c1 works)" "[\"vault:Work/Tasks/c1.md\"]|\"derived\"|[\"$G\",\"$H\"]" "P2d: a fenced cc-g --add-dir \$H is reach: it works \$H beside the launch folder's checkout"
LAUNCH="$F""bash
cc-g
cat $H/README.md
$F" mkt c2 'launch: cc-g'
plan --tasks c2
ok "$(mem c2 works)" "[\"$G\"]" "P2d control: a fenced block with no --add-dir reaches nothing extra (a path a command only reads)"
LAUNCH="$F""bash
# cc-g --add-dir $H
cc-g
$F
- **Read first:** \`cc-g --add-dir $H\`" mkt c3 'launch: cc-g'
plan --tasks c3
ok "$(mem c3 works)" "[\"$G\"]" "P2d control: a commented-out --add-dir and one in a Read item reach nothing"
LAUNCH="$F""sh
cc-g --add-dir \"\$HOME/h\" \\
  --add-dir=$N/a
$F" mkt c4 'launch: cc-g'
HOME="$TMP" plan --tasks c4
ok "$(mem c4 surfaces)|$(mem c4 works)" "[\"repo:$N/a\"]|[\"$G\",\"$H\"]" "P2d: a continued line's --add-dir \"\$HOME/…\" and --add-dir=<path> both count (reach in a checkout, path-only in none)"
# A bare home or root would contain every repo token (the whole estate): never claimed. HOME=$TMP, so ~/h is $H.
LAUNCH="$F""sh
cd ~ && cc-g --add-dir ~ ~/h
cc-g --add-dir /
$F
- **Repo:** \`~/\`" mkt c6 'launch: cc-g'
HOME="$TMP" plan --tasks c6
ok "$rc|$(mem c6 works)|$(mem c6 source)" "0|[\"$G\",\"$H\"]|\"derived\"" "P2d: cd ~, --add-dir ~, --add-dir / and a \`~/\` span reach nothing; ~/h after --add-dir ~ still does"
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
ok "$(mem c8 works)" "[\"$G\",\"$H\"]" "P2d control: a path below the home directory is reach"
hasnt "$(j 'd["warns"]')" "is / or the home directory" "P2d control: … with no home-directory WARN"
LAUNCH="- **Launch:** \`cd $H && claude\`" mkt c5
plan --tasks c5
ok "$(mem c5 surfaces)|$(mem c5 works)|$(mem c5 launch)" "[\"vault:Work/Tasks/c5.md\"]|[\"$H\"]|{\"alias\":\"claude\",\"folder\":\"$H\"}" "P2d: a leading cd in an inline launch span reaches its checkout, which the alias-less row opens from"
PBODY="Repo: x · Local: \`$H/\` · more" mkp HProj
PBODY="Local: \`$N/b\`" mkp NProj
mkp Bare
PBODY="(not a single repo, so no \`Local:\` marker): scouts in \`$G/sub\`" mkp NoLocal
mkt k1 'launch: cc-g' 'projects: ["[[HProj]]"]'
plan --tasks k1
ok "$(mem k1 surfaces)|$(mem k1 source)|$(mem k1 works)" "[\"vault:Work/Tasks/k1.md\"]|\"derived\"|[\"$G\",\"$H\"]" "P2d: an undeclared member reaches its first project's Local: checkout beside its launch folder"
mkt k2 'projects: ["[[HProj]]"]' 'surfaces: ["ext:k"]'
plan --tasks k2
ok "$(mem k2 surfaces)" '["ext:k"]' "P2d control: a declared member never claims its project's Local:"
mkt k3 'projects: ["[[Bare]]", "[[HProj]]"]'
plan --tasks k3
ok "$(mem k3 surfaces)|$(mem k3 source)" '["vault:Work/Projects/Area/Bare","vault:Work/Projects/Area/Bare.md","vault:Work/Tasks/k3.md"]|"derived"' "P2d control: a second project's Local: is not claimed (the first project's place is, P7)"
mkt k4 'projects: ["[[NProj]]"]'
plan --tasks k4
ok "$(mem k4 surfaces)" "[\"repo:$N/b\"]" "P2d: a Local: in no checkout is claimed path-only"
mkt k5 'projects: ["[[NoLocal]]"]'
plan --tasks k5
ok "$(mem k5 surfaces)" '["vault:Work/Projects/Area/NoLocal","vault:Work/Projects/Area/NoLocal.md","vault:Work/Tasks/k5.md"]' "P2d control: a backticked \`Local:\` that names no path claims nothing (its project's place only, P7)"
LAUNCH="- **Repo:** \`$H\`" mkt k6
plan --tasks k6,k1
ok "$(j "$chains")|$(j '[c["checkouts"] for c in d["chains"]]')" "[[\"k1\"],[\"k6\"]]|[[\"$G\"],[\"$H\"]]" "P2d: a member working \$H and one whose project's Local: is \$H are two chains (reach predicts nothing; a chain's checkouts are its surfaces' and its launch folders', never a Local: reach)"

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
ptok() {
  python3 - "$SC" "$@" <<'PY'
import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("sc", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
out = []
for t in sys.argv[2:]:
    try:
        out.append(m.fmt_token(m.parse_token(t)))
    except ValueError:
        out.append("ERR")
print(" ".join(out))
PY
}
ok "$(ptok repo:/x//a/b.py repo:/x//a/ repo:/x// repo:///x//./a repo:/x//../y repo:/x///abs repo:/x/./y//a/../b repo:/x/)" \
   "repo:/x//a/b.py repo:/x//a/ repo:/x repo:/x//a ERR ERR repo:/x/y//b repo:/x" "P3: keyed tokens round-trip; an empty rel is bare; a ..-escaping or absolute rel is refused"
ok "$(ovl repo:/x//a.py repo:/x//a.py  repo:/x//a/ repo:/x//a/b.py  repo:/x//a.py repo:/x//b.py  repo:/x repo:/x//a.py)" "y y n y" "P3: a file meets itself and its folder, never a sibling; a bare toplevel covers every file under it"
ok "$(ovl repo:/x//a/b repo:/x/a//b  repo:/X//a repo:/x//a  repo:/x//a repo:/x//ab  repo:/x//a/ repo:/x//a)" "n y n y" "P3: keys /x and /x/a are apart with no resolver; keys and paths compare case-folded; a folder mark is information only"
cko() {
  python3 - "$SC" "$@" <<'PY'
import importlib.util, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("sc", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
toks, folders, vault = json.loads(sys.argv[2]), json.loads(sys.argv[3]), sys.argv[4]
print(json.dumps(m.checkouts_of(toks, folders, m.Git().toplevel, vault), separators=(",", ":")))
PY
}
ok "$(ovl vault:Work/A vault:Work/AB  vault:Work vault:Work/A  vault vault:Work/A  vault:work/a vault:Work/A/b)" "n y y y" "P3: vault tokens overlap on a segment-boundary prefix (case-folded); vault overlaps every vault token"
ok "$(ovl ext:CMS ext:cms  ext:cms ext:cms2  repo:/A/b repo:/a/b/c  repo:/a/b repo:/a/bc)" "y n y n" "P3: ext: by case-folded equality; repo: by containment at a / boundary, case-folded"
ok "$(ovl vault:Work ext:Work  repo:/x vault:x  ext:x repo:/x  any ext:x  any vault  repo:/x any)" "n n n y y y" "P3: kinds never cross, save any"
scen p3
mkt s1 "surfaces: [\"repo:$TMP/links/g\"]"; mkt s2 "surfaces: [\"repo:$G\"]"; mkt s3 "surfaces: [\"repo:$G2\"]"
plan --tasks s1,s2
ok "$(mem s1 surfaces)|$(j "$chains")" "[\"repo:$G\"]|[[\"s1\",\"s2\"]]" "P3: a symlinked repo: equals its target"
plan --tasks s2,s3
ok "$(j "$chains")" '[["s2"],["s3"]]' "P3: two clones of one origin are disjoint"
GN="$G/nested"; mkrepo "$GN" https://github.com/demo/nested.git   # a separate checkout nested inside G by path (p33-3)
mkdir -p "$GN/deep"
mkt sx1 "surfaces: [\"repo:$G\"]"; mkt sx2 "surfaces: [\"repo:$GN\"]"; mkt sx3 "surfaces: [\"repo:$G/sub/a\"]"
mkt sx4 "surfaces: [\"repo:$GN/deep\"]"
plan --tasks sx1,sx2
ok "$(mem sx2 surfaces)|$(j "$chains")" "[\"repo:$GN\"]|[[\"sx1\"],[\"sx2\"]]" "P3: a checkout nested inside another by path is its own repo: two chains"
plan --tasks sx1,sx4
ok "$(mem sx4 surfaces)|$(j "$chains")" "[\"repo:$GN//deep/\"]|[[\"sx1\"],[\"sx4\"]]" "P3: … a path inside the nested checkout keys to the nested one, never the outer: two chains"
plan --tasks sx2,sx4
ok "$(j "$chains")" '[["sx2","sx4"]]' "P3 control: a path inside the nested checkout meets the nested checkout: one chain"
plan --tasks sx1,sx3
ok "$(mem sx3 surfaces)|$(j "$chains")" "[\"repo:$G//sub/a/\"]|[[\"sx1\",\"sx3\"]]" "P3 control: a path inside the outer checkout keys to it, and its bare toplevel covers it: one chain"
mkt q1 'surfaces:' '  - "vault:Work/A, B"'; mkt q2 'surfaces: ["vault:Work/A, B/x"]'
plan --tasks q1,q2
ok "$(mem q1 surfaces)|$(mem q2 surfaces)|$(j "$chains")" '["vault:Work/A, B"]|["vault:Work/A, B/x"]|[["q1","q2"]]' "P3: a comma inside a declared token stays one token, and overlaps"
mkt sd1 "surfaces: [\"repo:$G/sub/a\"]"; mkt sd2 "surfaces: [\"repo:$G/sub/b\"]"
plan --tasks sd1,sd2
ok "$(j "$chains")" '[["sd1"],["sd2"]]' "P3: two declared sibling subdirectories of one checkout are two folders: two chains"
ok "$(cko "[\"repo:$G//sub/a/\", \"repo:$H\", \"vault:Work/X\", \"ext:x\"]" "[\"$W/aw/launchers/seo\", \"$V/Work/X\", \"$N/a\"]" "$V")" "[\"$G\",\"$H\",\"$W\"]"    "P3: checkouts_of: a keyed token's key, a bare toplevel and a launch folder's toplevel; a vault folder and one in no checkout skipped"
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
LAUNCH="- **Repo:** \`$TS/sub\`" mkt r12
plan --tasks r12
ok "$(j '[s["slug"] for s in d["sessionLane"]]')" '["r12"]' "P4: a **Repo:** value inside a thread-skill checkout (reach, no token) goes to the session lane"
has "$(j 'd["sessionLane"][0]["why"]')" "its ## Launch path $TS/sub is a checkout of github.com/lachyts/thread-skill" "P4: … through its ## Launch path"
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
plan --tasks l1,l6 --dep l6=l1
ok "$rc|$(j "$chains")|$(j '[[m, v["launch"]["alias"]] for c in d["chains"] for m, v in c["members"].items()]')" '0|[["l1","l6"]]|[["l1","cc-a-web"],["l6","cc-o"]]' "P5: two aliases in one chain exit 0, each row keeping its own launch"
mkp LProj 'launch: cc-g'
mkt l7 'projects: ["[[LProj]]"]'
plan --tasks l7
ok "$(mem l7 launch)|$(mem l7 works)" "{\"alias\":\"cc-g\",\"folder\":\"$G\"}|[\"$G\"]" "P5: the project's launch: applies when the task has none"
mkt l8 "surfaces: [\"repo:$G\"]"; mkt l9 'surfaces: ["ext:x"]'; mkt l10 "surfaces: [\"repo:$G\", \"repo:$H\"]"
plan --tasks l8,l9
ok "$(mem l8 launch)" "{\"alias\":\"claude\",\"folder\":\"$G\"}" "P5: an alias-less row opens claude from its single repo"
ok "$(mem l9 launch)" "{\"alias\":\"claude\",\"folder\":\"$V\"}" "P5: … or from the vault root with zero repos"
plan --tasks l10
ok "$rc|$out" "3|" "P5: an alias-less row writing two checkouts exits 3 (its Leg could finish only one)"
has "$err" "REFUSE: l10: it writes the checkouts $G, $H and has no launch alias" "P5: … naming them (its works)"
mkt l12 "surfaces: [\"repo:$G//sub/file.txt\", \"repo:$H//x.py\"]"
plan --tasks l12
ok "$rc|$out" "3|" "P5: … and so do file tokens in two checkouts (works reads their checkouts)"
PBODY="Local: \`$H\`" mkp HLocal
mkt l11 'projects: ["[[HLocal]]"]'
plan --tasks l11
ok "$(mem l11 launch)|$(mem l11 works)|$(mem l11 surfaces)" "{\"alias\":\"claude\",\"folder\":\"$H\"}|[\"$H\"]|[\"vault:Work/Tasks/l11.md\"]" "P5: an alias-less row whose project's Local: is its one repo opens claude from it"
LFX="$TMP/none.json" plan --tasks l2
ok "$rc|$out" "3|" "P5: a missing launch-folders file while an alias needs it exits 3"
has "$err" "l2: launch alias cc-g needs $TMP/none.json, which is missing or unreadable" "P5: … naming the path"
LFX="$TMP/none.json" plan --tasks l9
ok "$rc|$(j "$chains")" '0|[["l9"]]' "P5: with no alias it exits 0"
has "$(j 'd["warns"]')" "$TMP/none.json is missing or unreadable" "P5: … with a WARN"

# ── P7: vault chains claim their own project places (ADR 0059) ───────────────────────────────────────
scen p7
mkrepo "$V" https://github.com/demo/obsidian.git   # the vault is a checkout, as ~/repos/obsidian is
# mkpp <path under Work/Projects> [frontmatter lines...] — a project note anywhere under Work/Projects; $PBODY is its body
mkpp() {
  local f="$V/Work/Projects/$1"; shift
  mkdir -p "$(dirname "$f")"
  { printf -- '---\ntags: [project]\n'
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n%s\n' "${PBODY:-}"; } > "$f"
}
mkpp "Life (area)/Contacts admin.md"; mkpp "Life (area)/Obsidian Vault.md"   # flat siblings in one area folder
mkpp "Art/Narc/Narc.md"; mkpp "Art/Narc/Narc sub.md"                          # a folder note and a project inside it
PBODY="Local: \`$TS\`" mkpp "Code/TSProj7.md"
ln -s "$V" "$S/vlink"
LFX7="$S/lf.json"
cat > "$LFX7" <<EOF
{"schema_version": 1, "by_alias": {},
 "plain_aliases": {"cc-v": "$V", "cc-vl": "$S/vlink", "cc-vc": "$S/VAULT", "cc-g": "$G"}}
EOF
UR="$root/skills/_shared/scripts/unfinished-rollout.py"
# chk7 <chain index> [check args...] — the serial check over that chain of the last plan's surfaces -> $cout, $crc, $cerr
chk7() {
  local i="$1" t; shift
  local sv=()
  while IFS= read -r t; do [ -n "$t" ] && sv+=(--surface "$t"); done <<EOF
$(printf '%s' "$out" | python3 -c 'import json,sys; print("\n".join(json.load(sys.stdin)["chains"][int(sys.argv[1])]["surfaces"]))' "$i")
EOF
  python3 "$UR" check --tasks-dir "$T" --shape serial ${sv[@]+"${sv[@]}"} "$@" > "$S.cout" 2> "$S.cerr"; crc=$?
  cout=$(cat "$S.cout"); cerr=$(cat "$S.cerr")
}
CA='"vault:Work/Projects/Life (area)/Contacts admin","vault:Work/Projects/Life (area)/Contacts admin.md"'
OV='"vault:Work/Projects/Life (area)/Obsidian Vault","vault:Work/Projects/Life (area)/Obsidian Vault.md"'
# 1. A member with only a project claims that project's place and its own task note, never the whole vault.
mkt a1 'projects: ["[[Contacts admin]]"]'
LFX="$LFX7" plan --tasks a1
ok "$rc|$(mem a1 surfaces)|$(mem a1 source)|$(mem a1 launch)|$(j 'd["warns"]')" "0|[$CA,\"vault:Work/Tasks/a1.md\"]|\"derived\"|{\"alias\":\"claude\",\"folder\":\"$V\"}|[]" "P7: a flat project's member claims its note, its would-be folder and its own task note (derived, no WARN)"
# 2. A launch from the vault root (an alias, a symlinked alias, a ## Launch path) narrows the same way.
mkt a2 'projects: ["[[Contacts admin]]"]' 'launch: cc-v'
mkt a3 'projects: ["[[Contacts admin]]"]' 'launch: cc-vl'
LAUNCH="- **Repo:** \`$V\`" mkt b1 'projects: ["[[Obsidian Vault]]"]'
for x in "a2 $CA" "a3 $CA" "b1 $OV"; do
  m="${x%% *}"; want="${x#* }"
  LFX="$LFX7" plan --tasks "$m"
  ok "$rc|$(mem "$m" surfaces)" "0|[$want,\"vault:Work/Tasks/$m.md\"]" "P7: $m, launched at the vault root, claims its project's place and its own note"
  hasnt "$(mem "$m" surfaces)" '"vault"' "P7: … never the whole vault"
  hasnt "$(j 'd["warns"]')" "no surface declared" "P7: … with no default WARN"
  hasnt "$(j 'd["warns"]')" "is the vault root" "P7: … and no root-hit WARN"
done
LFX="$LFX7" plan --tasks a2
ok "$(mem a2 launch)" "{\"alias\":\"cc-v\",\"folder\":\"$V\"}" "P7: a2 keeps its vault launch"
if [ -d "$S/VAULT" ]; then   # a case-insensitive volume (APFS): a case-variant alias is the vault root too
  mkt a4 'projects: ["[[Contacts admin]]"]' 'launch: cc-vc'
  LFX="$LFX7" plan --tasks a4
  ok "$rc|$(mem a4 surfaces)" "0|[$CA,\"vault:Work/Tasks/a4.md\"]" "P7: a case-variant vault alias narrows the same way"
else
  echo "skip - P7: a case-variant vault alias (case-sensitive volume)"
fi
# 3. Two projects in one area folder are two chains; one project is one chain.
mkt c1 'projects: ["[[Contacts admin]]"]' 'launch: cc-v'
LFX="$LFX7" plan --tasks a1,b1
ok "$rc|$(j "$chains")" '0|[["a1"],["b1"]]' "P7: members of sibling flat projects in one area folder form two chains"
LFX="$LFX7" plan --tasks a1,c1
ok "$(j "$chains")" '[["a1","c1"]]' "P7: two members of one project form one chain"
# 4. The Verify line, end to end: chain A live, a chain in another project schedules beside it, one in A's refuses.
LFX="$LFX7" plan --tasks a1
{ printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nshape: serial\nprojects: ["[[Contacts admin]]"]\nsurfaces:\n'
  printf '%s' "$out" | python3 -c 'import json,sys; [print("  - \"%s\"" % t) for t in json.load(sys.stdin)["chains"][0]["surfaces"]]'
  printf -- '---\n\n## Notes\n\nChain A.\n'; } > "$T/ca-rollout-2026-10-31.md"
mkt b2 'projects: ["[[Obsidian Vault]]"]' 'launch: cc-v'
LFX="$LFX7" plan --tasks b1,b2
ok "$rc|$(j "$chains")" '0|[["b1","b2"]]' "P7: two Obsidian Vault members form one chain"
chk7 0 --tasks b1,b2
ok "$cout|$crc" "none|0" "P7: … and the serial check lets it schedule beside the live Contacts admin chain"
LFX="$LFX7" plan --tasks c1
chk7 0 --tasks c1
ok "$cout|$crc" "none|0" "P7: a second chain in the Contacts admin project is scheduled (ADR 0067 d4)"
has "$cerr" "WARN: [[ca-rollout-2026-10-31]] (Contacts admin; never started) also predicts vault:Work/Projects/Life (area)/Contacts admin" "P7: … with the takes-turns WARN"
has "$cerr" "they take turns on it, the first to begin going first (ADR 0067 d4)" "P7: … saying they take turns"
# 5. The fallbacks: no project and no path, a vault-root path with no project, a project with no note.
mkt n1
LFX="$LFX7" plan --tasks n1
ok "$(mem n1 surfaces)|$(mem n1 source)" '["vault"]|"default"' "P7: a member naming no project and no path claims the whole vault (default)"
has "$(j 'd["warns"]')" "n1: no surface declared or derived: it claims only the vault; declare \`surfaces:\` for any repo or external system it writes" "P7: … with the default WARN, verbatim"
chk7 0 --tasks n1
ok "$cout|$crc" "none|0" "P7: … and its check schedules it beside chain A"
has "$cerr" "WARN: [[ca-rollout-2026-10-31]] (Contacts admin; never started) also predicts" "P7: … taking turns with it"
LAUNCH="- **Repo:** \`$V\`" mkt n2
LFX="$LFX7" plan --tasks n2
ok "$(mem n2 surfaces)|$(mem n2 source)" '["vault"]|"derived"' "P7: a vault-root path with no project claims the whole vault (derived)"
has "$(j 'd["warns"]')" "n2: its ## Launch path $V is the vault root and it names no project: it claims the whole vault" "P7: … with the root-hit WARN"
hasnt "$(j 'd["warns"]')" "no surface declared" "P7: … and not the default one"
mkt m1 'projects: ["[[Ghost]]"]'
LFX="$LFX7" plan --tasks m1
ok "$(mem m1 surfaces)|$(mem m1 source)" '["vault"]|"default"' "P7: a first project with no note claims the whole vault (default)"
has "$(j 'd["warns"]')" "m1: no surface declared or derived" "P7: … with the default WARN"
has "$(j 'd["warns"]')" "m1: its first project [[Ghost]] has no note under Work/Projects: its vault claim cannot narrow to it" "P7: … and one naming the missing project"
# 6. A folder note claims its folder, so a project inside it shares the chain.
mkt e1 'projects: ["[[Narc]]"]'; mkt e2 'projects: ["[[Narc sub]]"]'
LFX="$LFX7" plan --tasks e1
ok "$(mem e1 surfaces)" '["vault:Work/Projects/Art/Narc","vault:Work/Tasks/e1.md"]' "P7: a folder note's member claims the folder"
LFX="$LFX7" plan --tasks e1,e2
ok "$(j "$chains")" '[["e1","e2"]]' "P7: … so a project inside it shares the chain"
# 7. Bookkeeping: a task or rollout note under Work/Tasks is never a claim.
printf -- '---\ntags: [task, rollout]\nstatus: done\n---\n' > "$T/some-rollout.md"   # a rollout note the row names
LAUNCH="- **Notes:** \`$V/Work/Tasks/some-rollout.md\`" mkt k1 'projects: ["[[Contacts admin]]"]'
LFX="$LFX7" plan --tasks k1
ok "$(mem k1 surfaces)|$(mem k1 source)" "[$CA,\"vault:Work/Tasks/k1.md\"]|\"derived\"" "P7: a ## Launch path under Work/Tasks is bookkeeping, never a claim"
hasnt "$out" "some-rollout" "P7: … named nowhere in the plan"
# 8. --surface adds: the vault root narrows, a literal vault is kept, a path under Work/Tasks is dropped.
LFX="$LFX7" plan --tasks a1 --surface "a1=$V"
ok "$(mem a1 surfaces)|$(mem a1 added)" "[$CA,\"vault:Work/Tasks/a1.md\"]|[]" "P7: an added vault-root path narrows to the project's place"
has "$(j 'd["warns"]')" "a1: --surface $V is the vault root: it claims its first project's place and its own task note instead" "P7: … with a WARN"
LFX="$LFX7" plan --tasks a1 --surface a1=vault
ok "$(mem a1 surfaces)|$(mem a1 added)" '["vault"]|["vault"]' "P7: an added literal vault token is kept as written"
LFX="$LFX7" plan --tasks a1 --surface "a1=$V/Work/Tasks"
ok "$(mem a1 surfaces)|$(mem a1 added)" "[$CA,\"vault:Work/Tasks/a1.md\"]|[]" "P7: an added path under Work/Tasks is dropped"
has "$(j 'd["warns"]')" "a1: --surface $V/Work/Tasks is under Work/Tasks: task and rollout notes are bookkeeping, never a claim (ADR 0059)" "P7: … with a WARN"
# 9. A code row never opens where its Leg cannot finish it.
LAUNCH="- **Repos:** \`$G\`, \`$H\`" mkt r1
LFX="$LFX7" plan --tasks r1
ok "$rc|$out" "3|" "P7: an alias-less row writing two checkouts exits 3"
has "$err" "REFUSE: r1: it writes the checkouts $G, $H and has no launch alias: leg.py done finishes only commits in the Leg's own checkout" "P7: … naming both and why"
LAUNCH="- **Repo:** \`$G\`" mkt r2 'launch: cc-v'
LFX="$LFX7" plan --tasks r2
ok "$rc|$out" "3|" "P7: a vault launch writing a checkout exits 3"
has "$err" "REFUSE: r2: its launch cc-v opens in $V, inside the vault, but it writes the checkout $G" "P7: … naming the launch and the checkout"
LAUNCH="- **Repo:** \`$G\`" mkt r3 'launch: cc-vl'
LFX="$LFX7" plan --tasks r3
ok "$rc" 3 "P7: … and so does a symlinked vault launch"
has "$err" "REFUSE: r3: its launch cc-vl opens in $S/vlink, inside the vault" "P7: … caught through its realpath"
if [ -d "$S/VAULT" ]; then
  LAUNCH="- **Repo:** \`$G\`" mkt r5 'launch: cc-vc'
  LFX="$LFX7" plan --tasks r5
  ok "$rc" 3 "P7: … and a case-variant vault launch"
else
  echo "skip - P7: a case-variant vault launch (case-sensitive volume)"
fi
LAUNCH="- **Repos:** \`$G\`, \`$N\`" mkt r4
LFX="$LFX7" plan --tasks r4
ok "$rc|$(mem r4 launch)" "0|{\"alias\":\"claude\",\"folder\":\"$G\"}" "P7: an alias-less row with one checkout and a path-only place opens from the checkout"
# 10. Ruling (c) comes first: a session-lane member is never refused for its launch.
LAUNCH="- **Repos:** \`$TS\`, \`$G\`" mkt t1
mkt t2 'launch: cc-v' 'projects: ["[[TSProj7]]"]'
LFX="$LFX7" plan --tasks a1,t1,t2
ok "$rc|$(j "$chains")|$(j '[s["slug"] for s in d["sessionLane"]]')" '0|[["a1"]]|["t1","t2"]' "P7: two code rows of thread-skill go to the session lane, unrefused"
# 11. A legacy whole-vault chain overlaps every vault chain: a WARN, never a refusal (ADR 0067 d4).
{ printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nshape: serial\nsurfaces: ["vault"]\n'
  printf -- '---\n\n## Notes\n\nA legacy chain.\n'; } > "$T/legacy-rollout.md"
LFX="$LFX7" plan --tasks b1
chk7 0 --tasks b1
ok "$cout|$crc" "none|0" "P7: a legacy note claiming the whole vault no longer refuses: it takes turns"
has "$cerr" "WARN: [[legacy-rollout]] (no project; never started) also predicts vault, which this chain predicts as" "P7: … with the takes-turns WARN"

# ── P8: the 2026-11-02 replan fixture (ADR 0067 d4) ───────────────────────────────────────────────────
# A synthetic estate in the 2026-11-02 shape, re-planned through docs/spikes/2026-11-02-replan.py (read-only), with
# HOME holding the default --vault and launch-folders file: a workspaces monorepo with three launchers whose tasks name
# it only as where they work (five as `**Repo:** <toplevel>`, one at depth); an .agents-like checkout reached by
# --add-dir whose tasks name distinct files (a **Files:** span, `touches:`, declared surfaces), and one `**Repo:**
# ~/.agents/skills/` (reach at depth); a Projects monorepo reached by `Local:`; two chains naming one file, two naming
# sibling files of one folder, and one declaring the bare .agents toplevel.
echo "== p8"
PH="$TMP/p8home"; PV="$PH/repos/obsidian"; PT="$PV/Work/Tasks"; mkdir -p "$PT" "$PV/Work/Projects"
PW="$PH/repos/workspaces"; mkrepo "$PW" https://github.com/demo/workspaces.git
for l in aw/launchers/seo aw/launchers/web ow/launchers/full; do mkdir -p "$PW/$l"; done
mkdir -p "$PW/_shared/state"
cat > "$PW/_shared/state/launch-folders.json" <<EOF
{"schema_version": 1,
 "by_alias": {"cc-a-seo": "$PW/aw/launchers/seo", "cc-a-web": "$PW/aw/launchers/web", "cc-o": "$PW/ow/launchers/full"},
 "plain_aliases": {}}
EOF
PA="$PH/.agents"; mkrepo "$PA" https://github.com/demo/agents.git; mkdir -p "$PA/skills/x" "$PA/skills/w" "$PA/skills/z"
PP="$PH/Projects"; mkrepo "$PP" https://github.com/demo/projects.git; mkdir -p "$PP/narc"
# p8t <slug> <project> [frontmatter lines...] — a task note in the P8 vault; $LAUNCH (when set) is its ## Launch body
p8t() {
  local s="$1" pr="$2"; shift 2
  { printf -- '---\ntags: [task]\nstatus: open\nprojects: ["[[%s]]"]\n' "$pr"
    for l in "$@"; do printf '%s\n' "$l"; done
    printf -- '---\n\n## Notes\n\nbody\n'
    [ -z "${LAUNCH:-}" ] || printf '\n## Launch\n\n%s\n' "$LAUNCH"; } > "$PT/$s.md"
}
for p in SEO Web Ops AgA SameA AgB AgC AgD SibA SibB Decl; do printf -- '---\ntags: [project]\n---\n' > "$PV/Work/Projects/$p.md"; done
for p in ProjA ProjB; do printf -- '---\ntags: [project]\n---\n\nLocal: `~/Projects`\n' > "$PV/Work/Projects/$p.md"; done
F='```'
LAUNCH='- **Repo:** `~/repos/workspaces`' p8t seo1 SEO 'launch: cc-a-seo'
LAUNCH='- **Repo:** `~/repos/workspaces/aw/`' p8t seo2 SEO 'launch: cc-a-seo'
LAUNCH='- **Repo:** `~/repos/workspaces`' p8t web1 Web 'launch: cc-a-web'
for t in ops1 ops2 ops3; do LAUNCH='- **Repo:** `~/repos/workspaces`' p8t $t Ops 'launch: cc-o'; done
LAUNCH="$F""bash
cc-o --add-dir ~/.agents
$F
- **Files:** \`~/.agents/skills/x/SKILL.md\`" p8t ag1 AgA 'launch: cc-o'
LAUNCH='- **Files:** `~/.agents/skills/x/SKILL.md`' p8t sf1 SameA 'launch: cc-o'
LAUNCH='- **Repo:** `~/.agents`' p8t ag2 AgB 'touches: [skills/y/run.py]'
p8t ag3 AgC 'surfaces:' '  - "repo:~/.agents/skills/z/"'
LAUNCH='- **Repo:** `~/.agents/skills/`' p8t ag4 AgD
LAUNCH='- **Files:** `~/.agents/skills/w/a.md`' p8t sib1 SibA 'launch: cc-o'
LAUNCH='- **Files:** `~/.agents/skills/w/b.md`' p8t sib2 SibB 'launch: cc-o'
p8t dclr Decl 'surfaces: ["repo:~/.agents"]'
p8t pa1 ProjA; p8t pb1 ProjB
cat > "$TMP/p8-args.txt" <<'EOF'
2 | SEO | --tasks seo1,seo2
3 | Web | --tasks web1
4 | Ops | --tasks ops1,ops2,ops3
5 | AgA | --tasks ag1
6 | SameA | --tasks sf1
7 | AgB | --tasks ag2
8 | AgC | --tasks ag3
9 | AgD | --tasks ag4
10 | SibA | --tasks sib1
11 | SibB | --tasks sib2
12 | Decl | --tasks dclr
13 | ProjA | --tasks pa1
14 | ProjB | --tasks pb1
EOF
rp=$(cd "$root" && HOME="$PH" python3 docs/spikes/2026-11-02-replan.py "$TMP/p8-args.txt" 2>&1); rprc=$?
ov=$(printf '%s\n' "$rp" | sed -n '/^OVERLAPS$/,/^$/p' | sed '1d;/^$/d' | awk '{print $1, $2, $3, $4}')
ok "$rprc|$(printf '%s\n' "$rp" | grep -c ' ERR ')" "0|0" "P8: the replan runs every batch, none in error"
ok "$ov" "AgA#0 <-> SameA#0 file
AgA#0 <-> Decl#0 checkout
SameA#0 <-> Decl#0 checkout
AgB#0 <-> Decl#0 checkout
AgC#0 <-> Decl#0 checkout
SibA#0 <-> Decl#0 checkout
SibB#0 <-> Decl#0 checkout" "P8: only the same-file pair and the declared-bare pairs clash"
ok "$(printf '%s\n' "$rp" | tail -1)" "chains 16 with any clash 7 (checkout-wide 1)" "P8: … and only the declared-bare chain is checkout-wide"
hasnt "$ov" "SEO" "P8: no workspaces pair (five **Repo:** toplevels and one at depth name where they work)"
hasnt "$ov" "Ops" "P8: … nor between two members of one launcher"
hasnt "$ov" "Proj" "P8: no Projects pair (a Local: reach predicts nothing)"
hasnt "$ov" "AgD" "P8: a **Repo:** ~/.agents/skills/ value predicts nothing, not even beside the declared toplevel"
has "$rp" "AgB#0 ['repo:$PA//skills/y/run.py']" "P8: a relative touches: item keyed to the member's one checkout"

# ── P6: exit 2────────────────────────────────────────────────────────────────────────────────────────
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
