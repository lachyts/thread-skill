#!/usr/bin/env bash
# skills/execute/scripts/leg.py: a serial rollout's Legs, part 2 of 4: land (L17; L1-L16 are tests/leg.test.sh).
#   L17  leg.py land (ADR 0067 d3, d4): two chains land in turn by merge, a stale --verified asks again (L17a), with
#        change's first-parent WARN (L17k), check_cause's land-merge outside (L17l) and a row with no Verify line (L17n);
#        a conflict stands and Complete waits, then a hand resolution lands (L17b); a peer's edit or an untracked file
#        refuses the ff, never a stash (L17c); --retire removes the copy and deletes its branch with -d, kept on any
#        refusal with a follow-on (L17d); both p36-3 interims retired (L17e, L17f); actual claims (L17g); the repo lock
#        (L17h); the stands that run no git, the refusals and the in-place peer (L17i); --red (L17j); the verified tip
#        (L17m); Complete's Land first before the completion verify, and a land that waits closes stopped (L17o); a
#        claim stand still brings in what other chains landed, so the claim it unblocks passes (L17q); the ff in P
#        re-reads P's branch after the peer check, and lands only when <d> is the tip (L17r); it merges only when <d> is
#        strictly behind the chain branch and unmoved since step 4, after live-checkout.sh's overlap mode, so a stand
#        or a no-op leaves R's ORIG_HEAD absent (L17s: s1 in L17c, s2 a moved <d> before the overlap, s3 <d> already
#        the tip, s4 the branch at <d>, s5 the branch unreadable, s6 the overlap mode unrunnable); the carry of a
#        copy's ignored outputs under the chain's surfaces into the primary at land and --retire, never over a newer
#        file nor out of a Python environment, a re-render carried and logged again, its log lines capped (L17t, p36-13).
# Temp vaults (git repos), temp repos with literal origins and update-ref'd origin refs, so land.sh --route never
# needs the network; a fake gh and ssh log any call. HOME, LANDING_REGISTER and THREAD_LEG_LOCK_DIR are temp;
# --now and --session are pinned. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)
unset CLAUDE_CODE_SESSION_ID CODEX_THREAD_ID XDG_STATE_HOME THREAD_LEG_LOCK_TIMEOUT
root=$(pwd -P)
LEG="$root/skills/execute/scripts/leg.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"

TMP=$(mktemp -d) || { echo 'FAIL - mktemp'; exit 1; }
TMP=$(cd "$TMP" && pwd -P)
holders=()
cleanup() { local p; for p in ${holders[@]+"${holders[@]}"}; do kill "$p" 2>/dev/null; done; rm -rf "$TMP"; }
trap cleanup EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
export GIT_CONFIG_GLOBAL="$TMP/gitconfig" GIT_CONFIG_NOSYSTEM=1
git config --global user.name t; git config --global user.email t@t.invalid
git config --global init.defaultBranch master; git config --global advice.detachedHead false
export LANDING_REGISTER="$TMP/register.md"; : > "$LANDING_REGISTER"
export THREAD_LEG_LOCK_DIR="$TMP/locks" THREAD_EVENTS_DIR="$TMP/events" TMPDIR="$TMP/t"
export THREAD_HEAT_LEVEL=0   # the Heat hold's reading, pinned: a hot Mac never flips an assertion
# L1cv's completion-verify --run: the machine's verify slots and the detached verify trees stay in temp (ADR 0055)
export THREAD_VERIFY_SLOTS_DIR="$TMP/verify-slots" THREAD_COMPLETION_TREE_DIR="$TMP/trees"
# L16's Chain copies stay in temp (each L16 scenario points it at its own dir), and so does the launch-alias file a copy's
# manual launch line reads (absent unless a case writes it)
export THREAD_CHAIN_COPY_DIR="$TMP/chains" THREAD_LAUNCH_ALIASES="$TMP/aliases.zsh"
mkdir -p "$TMPDIR" "$TMP/bin"
# A fake gh and ssh: any call is logged and fails, so a test can assert no network was touched.
printf '#!/bin/sh\necho "gh $*" >> "%s/net.log"\nexit 1\n' "$TMP" > "$TMP/bin/gh"
printf '#!/bin/sh\necho "ssh $*" >> "%s/net.log"\nexit 1\n' "$TMP" > "$TMP/bin/fake-ssh"
chmod +x "$TMP/bin/gh" "$TMP/bin/fake-ssh"
export PATH="$TMP/bin:$PATH" GIT_SSH_COMMAND="$TMP/bin/fake-ssh"
: > "$TMP/net.log"
NOW=2026-10-20T10:00+00:00
REFL="close-score: demo-rollout-2026-10-20: recorded t-20261020T100000Z-abc123 (completion)"   # legs.md § Complete step 3's line

. tests/lib/leg-fixtures.sh   # the shared helpers (scen, mkro, mkt, leg, q, the repo helpers, cscen, lscen, ...)

# ════ L17: leg.py land (ADR 0067 d3, d4) ═══════════════════════════════════════════════════════════════════════════
master() { git -C "$R" rev-parse master; }
# ohR / nohR — the primary's ORIG_HEAD, absent or written / removed: a refused or no-op `merge --ff-only` writes it, so a
# land that ran no merge leaves it absent (p39-4)
ohR() { [ -e "$(git -C "$R" rev-parse --path-format=absolute --git-path ORIG_HEAD)" ] && echo written || echo absent; }
nohR() { rm -f "$(git -C "$R" rev-parse --path-format=absolute --git-path ORIG_HEAD)"; }

# ---- L17a: two chains land in turn, by merge ----
lscen l17a
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
RO=$RO2; mkro '' "b1~cc-r~$R/sub/l~\`repo:$R//b1.txt\`" "b2~cc-r~$R/sub/l~\`repo:$R//b2.txt\`"; mkt b1; NOVERIFY=1 mkt b2; RO=$RO1
mkcopies
CWD="$C1" leg begin --cwd "$C1"; ok "$rc" 0 "L17a: A's Leg begins in its copy"
RO=$RO2; CWD="$C2/sub/l" leg begin --cwd "$C2/sub/l"; ok "$rc" 0 "L17a: B's Leg begins in its copy"
CWD="$C2/sub/l" work "$C2" b1 b1.txt "b1 work"; b1sha=$(git -C "$C2" rev-parse HEAD)
CWD="$C2/sub/l" leg file-fix --target b1 --cause outside --evidence "red"
ok "$rc" 1 "L17l: control: before any land merge, outside is refused for b1"; RO=$RO1
CWD="$C1" work "$C1" a1 a1.txt "a1 work"; a1sha=$(git -C "$C1" rev-parse HEAD)
CWD="$C1" leg land
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$a1sha" "L17a: A lands a1: master is chain/A's tip"
ok "$(q 'd["lands"][0]["landed"]')|$(fm a1 leg_landed)" "['a1']|$NOW" "L17a: … a1 is listed, and leg_landed: stamped"
ok "$(logn "Leg 1 land: \[\[a1\]\] on master in $R (${a1sha:0:12})\$")" 1 "L17a: … and the land: line logged"
RO=$RO2; CWD="$C2/sub/l" leg land
ok "$rc|$(lands)" "0|verify|None|None" "L17a: B's b1, cut before A's land, asks for a re-verify after the merge"
ok "$(q 'd["lands"][0]["verify"]')" "[{'task': 'b1', 'line': '**Verify:** \`test -f b1.done\`', 'folder': '$C2/sub/l'}]" \
   "L17a: … naming b1's Verify line and its folder in the copy"
head=$(q 'd["lands"][0]["head"]')
ok "$(git -C "$C2" rev-parse HEAD)|$(git -C "$C2" rev-parse HEAD^1)|$(git -C "$C2" rev-parse HEAD^2)|$(master)" "$head|$b1sha|$a1sha|$a1sha" \
   "L17a: … chain/B's tip is a merge of b1 and master, and master is unmoved"
ok "$(git -C "$C2" log -1 --format=%s)" "🔀 land: merge master into chain/$RO2" "L17a: … its subject the land merge's"
CWD="$C2/sub/l" leg land --verified "$head"
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$head" "L17a: --verified <head> lands it"
ok "$(git -C "$R" merge-base --is-ancestor "$b1sha" master && echo y)|$(git -C "$C2" log -1 --format=%H "$b1sha")" "y|$b1sha" \
   "L17a: … b1's sha unchanged, an ancestor of master (never a rebase)"
ok "$(logn "Leg 1 land verified: $R at $head\$")|$(fm b1 leg_landed)" "1|$NOW" "L17a: … land verified: logged, b1 stamped"
# control: master moves after the verify, so a stale --verified merges again and asks again
CWD="$C2/sub/l" work "$C2" b2 b2.txt "b2 work"
pcommit "$R" peer.txt p "a peer moves master"
CWD="$C2/sub/l" leg land --verified "$head"
ok "$rc|$(lands)" "0|verify|None|None" "L17a: control: master moved after the verify: a stale --verified asks again"
ok "$(q 'd["lands"][0]["head"]' | grep -c "$head")|$(logn 'land verified:')" "0|1" "L17a: … on a new merge, and nothing more is logged"
ok "$(q 'd["lands"][0]["verify"]')" "[{'task': 'b2', 'line': None, 'folder': '$C2/sub/l'}]" \
   "L17n: a row with no Verify line asks with line None, and its folder"
CWD="$C2/sub/l" leg change --task b2
ok "$rc|$(q 'd["tops"][0]["warns"]')" "0|[]" "L17k: change: the untrailered peer commit a land merged in raises no WARN"
pcommit "$C2" loose2.txt l "an untrailered commit in the copy"
CWD="$C2/sub/l" leg change --task b2
has "$(q 'd["tops"][0]["warns"]')" "'an untrailered commit in the copy' in $C2 carries no Task: line" "L17k: control: one on the copy's own line still warns"
CWD="$C2/sub/l" leg file-fix --target b1 --cause outside --evidence "red after the land"
ok "$rc|$(q 'd["cause"]')" "0|outside" "L17l: outside passes for b1 once a land merge is in its range"
unset CWD

# ---- L17b: a conflict leaves the task unlanded, and Complete waits ----
# bscen <name> — A's a1 (cell a1.txt) and B's b1 (cell b1.txt) both write c.txt; A lands it first
bscen() {
  lscen "$1"
  mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1
  mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
  CWD="$C2" work "$C2" b1 c.txt "b's c"; b1sha=$(git -C "$C2" rev-parse HEAD); RO=$RO1
  CWD="$C1" work "$C1" a1 c.txt "a's c"; CWD="$C1" leg land; ok "$rc|$(lands)" "0|landed|None|None" "$1: A lands c.txt first"
  m0=$(master); RO=$RO2
}
bscen l17b
CWD="$C2" leg land
ok "$rc|$(lands)" "0|stood|conflict in c.txt|False" "L17b: B's land conflicts on c.txt: it stands, waits False"
ok "$(git -C "$C2" rev-parse -q --verify MERGE_HEAD || echo none)|$(git -C "$C2" rev-parse HEAD)|$(master)|$(fm b1 leg_landed)" \
   "none|$b1sha|$m0|<none>" "L17b: … the merge aborted: no MERGE_HEAD, nothing moved, nothing stamped"
ok "$(logn "Leg 1 land stood: $R: conflict in c.txt\$")" 1 "L17b: … and the stand logged"
CWD="$C2" leg land; ok "$(logn "land stood: $R: conflict in c.txt")" 1 "L17b: the same stand again is not logged twice"
snap; CWD="$C2" leg close --outcome complete --cwd "$C2" --reflection "$REFL"
ok "$rc" 1 "L17b: Complete refuses while b1 is unlanded"
has "$err" "[[b1]] is not on master in $R: run leg.py land first (legs.md § Complete's Land first); nothing written" "L17b: … naming the land"
same "L17b: a refused complete"
# (b2) the hand resolution: the pinned subject, resolve, add, commit --no-edit, then land again
git -C "$C2" merge --no-ff -m "🔀 land: merge master into chain/$RO2" refs/heads/master >/dev/null 2>&1
printf 'a and b\n' > "$C2/c.txt"; git -C "$C2" add c.txt; git -C "$C2" commit -q --no-edit
CWD="$C2" leg land
ok "$rc|$(lands)" "0|verify|None|None" "L17b2: after the hand resolution, land asks for the re-verify"
CWD="$C2" leg land --verified "$(q 'd["lands"][0]["head"]')"
ok "$rc|$(lands)|$(cat "$R/c.txt")" "0|landed|None|None|a and b" "L17b2: … then lands the resolution"
CWD="$C2" leg change --task b1
ok "$(q 'd["tops"][0]["warns"]')" "[]" "L17b2: … and change raises no WARN for the merge"
unset CWD

# ---- L17c: a peer's uncommitted edit, or an untracked file, refuses the fast-forward ----
lscen l17c
mkro '' "a1~cc-r~$R~\`repo:$R//b.txt\`" "a2~cc-r~$R~\`repo:$R//n.txt\`"; mkt a1; mkt a2; mkcopies
CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 b.txt "a1's b"
echo "peer's b" > "$R/b.txt"; m0=$(master); nohR
CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|the primary's uncommitted edit on b.txt|False" "L17c: a peer's uncommitted edit on b.txt stands the land"
ok "$(master)|$(cat "$R/b.txt")|$(git -C "$R" stash list | wc -l | tr -d ' ')|$(fm a1 leg_landed)" "$m0|peer's b|0|<none>" \
   "L17c: … master unchanged, the edit intact, nothing stashed, nothing stamped"
ok "$(ohR)" absent "L17s1: … and no merge ran: R's ORIG_HEAD absent (the overlap stood it first)"
git -C "$R" checkout -q -- b.txt
CWD="$C1" work "$C1" a2 n.txt "a2's n"; echo "untracked" > "$R/n.txt"; nohR
CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|the primary's uncommitted edit on n.txt|False" "L17c: an untracked file in the ff's way stands it too"
ok "$(master)|$(cat "$R/n.txt")" "$m0|untracked" "L17c: … the file intact"
ok "$(ohR)" absent "L17s1: … and R's ORIG_HEAD absent"
rm "$R/n.txt"; CWD="$C1" leg land
ok "$rc|$(lands)|$(fm a1 leg_landed)|$(fm a2 leg_landed)" "0|landed|None|None|$NOW|$NOW" "L17c: once cleared, both land"
unset CWD

# ---- L17d: --retire after Complete: the copy removed, its branch deleted with -d ----
# dscen <name> [checkout branch] — chain A alone, a1 worked in its copy and landed, then Complete; $A the archived note
dscen() {
  lscen "$1"; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  [ -z "${2:-}" ] || git -C "$R" checkout -qb "$2"
  CWD="$R" leg copies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"
  CWD="$C1" leg land; ok "$rc|$(lands)" "0|landed|None|None" "$1: a1 lands"
  CWD="$C1" leg close --outcome complete --cwd "$C1" --reflection "$REFL"; ok "$rc" 0 "$1: complete"
  A="$T/Archive/Rollouts/$RO.md"; cp "$A" "$TMP/snapA"
}
dscen l17d1
cfg0=$(git -C "$R" config --list --local | grep -v '^branch\.chain' | sort)
CWD="$C1" leg land --retire
ok "$rc|$(q '[(e["landed"], e["removed"], e["branchDeleted"], e["why"]) for e in d["retired"]]')|$(q 'd["followup"]')" \
   "0|[(True, True, True, None)]|None" "L17d1: --retire run from inside the copy: landed, removed, branch deleted"
ok "$(test -e "$C1" && echo y || echo n)|$(git -C "$R" show-ref -q --verify "refs/heads/chain/$RO1" && echo y || echo n)" "n|n" \
   "L17d1: … the copy is gone and chain/\$RO1 deleted"
ok "$(git -C "$R" config --list --local | grep -v '^branch\.chain' | sort)|$(git -C "$R" rev-parse --is-inside-work-tree)" "$cfg0|true" \
   "L17d1: … R's config intact"
cmp -s "$A" "$TMP/snapA"; ok "$?" 0 "L17d1: … and the archived note byte-identical"
dscen l17d2 w
CWD="$C1" leg land --retire
ok "$rc|$(q '[(e["removed"], e["branchDeleted"]) for e in d["retired"]]')" "0|[(True, True)]" \
   "L17d2: R on w (master landed by update-ref): -d deletes the branch, its upstream set to master first"
ok "$(git -C "$R" config --get-regexp '^branch\.chain' || echo none)|$(git -C "$R" symbolic-ref --short HEAD)" "none|w" \
   "L17d2: … no branch.chain* config is left, and R stays on w"
dscen l17d3; echo x > "$C1/untracked.txt"
CWD="$R" leg land --retire
ok "$rc|$(q '[(e["removed"], e["branchDeleted"]) for e in d["retired"]]')|$(test -d "$C1" && echo y)" "0|[(False, False)]|y" \
   "L17d3: an untracked file in the copy: worktree remove refuses (never --force), copy and branch kept"
has "$(q 'd["warns"]')" "WARN: $C1 (chain/$RO1 of $R) kept: git worktree remove refused" "L17d3: … with a WARN"
ok "$(q 'd["followup"]')" "demo-followup-retire-chain-2026-10-20" "L17d3: … and a retire follow-on"
has "$(cat "$T/demo-followup-retire-chain-2026-10-20.md")" "land --retire --rollout $A --session s1" "L17d3: … naming the command that finishes it"
cmp -s "$A" "$TMP/snapA"; ok "$?" 0 "L17d3: the archived note byte-identical"
dscen l17d4; pcommit "$C1" b.txt "close-out b" "📝 docs(thread): close-out"; echo "peer's b" > "$R/b.txt"
CWD="$R" leg land --retire
ok "$rc|$(q '[(e["landed"], e["removed"], e["branchDeleted"]) for e in d["retired"]]')|$(cat "$R/b.txt")" "0|[(False, False, False)]|peer's b" \
   "L17d4: a peer's edit on a close-out's file keeps the copy and the branch, the edit intact"
has "$(q 'd["retired"][0]["why"]')" "the primary's uncommitted edit on b.txt" "L17d4: … naming it"
bad=$(python3 - "$LEG" <<'PY2'
import ast, sys
src = open(sys.argv[1]).read()
tree = ast.parse(src)
for fn in ("land_retire", "_retire_land"):
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == fn)
    for s in ast.walk(node):
        if isinstance(s, ast.Constant) and s.value in ("-D", "--force", "-f"):
            print(fn, s.value)
PY2
)
ok "$bad" "" "L17d5: land --retire's source holds no -D, --force or -f"
unset CWD

# ---- L17t: a land, then --retire, carry the copy's ignored outputs into the primary (p36-13) ----
lscen l17t
printf '*.mp4\nnode_modules/\npydeps/\n' >> "$R/.gitignore"; pcommit "$R" .gitignore "$(cat "$R/.gitignore")" "ignore media"
mkro '' "a1~cc-r~$R/sub/l~\`repo:$R//media/\` \`repo:$R//sub/l/\`"; mkt a1
CWD="$R" leg copies; CWD="$C1/sub/l" leg begin --cwd "$C1/sub/l"; CWD="$C1/sub/l" work "$C1" a1 a1.txt "a1 work"
mkdir -p "$C1/media" "$C1/other" "$C1/sub/l/node_modules" "$R/media" "$C1/sub/l/tools/env/bin" "$C1/sub/l/pydeps/site-packages"
echo clip > "$C1/media/clip.mp4"; echo out > "$C1/sub/l/out.mp4"; echo x > "$C1/other/x.mp4"; echo m > "$C1/sub/l/node_modules/m.js"
echo "copy's old" > "$C1/media/old.mp4"; touch -t 202001010000 "$C1/media/old.mp4"; echo "primary's newer" > "$R/media/old.mp4"
# a uv venv by another name (its own `*` .gitignore, so git lists its files one by one), and a bare site-packages
echo '*' > "$C1/sub/l/tools/env/.gitignore"; echo v > "$C1/sub/l/tools/env/pyvenv.cfg"; echo p > "$C1/sub/l/tools/env/bin/pip"
echo p > "$C1/sub/l/pydeps/site-packages/p.pth"
CWD="$C1/sub/l" leg land
ok "$rc|$(lands)|$(q 'd["lands"][0]["carried"]')|$(q '[k["path"] for k in d["lands"][0]["carryKept"]]')" \
   "0|landed|None|None|['media/clip.mp4', 'sub/l/out.mp4']|['media/old.mp4']" \
   "L17t: land carries the ignored files under the chain's surfaces, never over a newer one"
ok "$(cat "$R/media/clip.mp4")|$(cat "$R/sub/l/out.mp4")|$(cat "$R/media/old.mp4")|$(ls -A "$R/sub/l" | tr '\n' ' ')|$(test -e "$R/other/x.mp4" && echo y || echo n)" \
   "clip|out|primary's newer|.mcp.json keep.txt out.mp4 |n" \
   "L17t: … the primary's newer file intact; nothing outside the surfaces, no node_modules, venv or site-packages"
ok "$(logn "Leg 1 carried: media/clip.mp4, sub/l/out.mp4 into $R\$")|$(logn "Leg 1 carry kept: $R/media/old.mp4: ")" "1|1" \
   "L17t: … each listed in the Leg log"
echo clip2 > "$C1/media/clip.mp4"; for i in 0 1 2 3 4 5 6 7 8 9; do echo n > "$C1/media/n$i.mp4"; done
for i in 1 2 3 4 5; do echo k > "$C1/media/k$i.mp4"; touch -t 202001010000 "$C1/media/k$i.mp4"; echo newer > "$R/media/k$i.mp4"; done
CWD="$C1/sub/l" leg land
ok "$rc|$(cat "$R/media/clip.mp4")|$(q 'len(d["lands"][0]["carried"])')|$(q 'len(d["lands"][0]["carryKept"])')" "0|clip2|11|6" \
   "L17t: a land after a re-render carries the file again"
ok "$(logn 'carried: ')|$(logn "Leg 1 carried: 11 files (media/clip.mp4, media/n0.mp4, .*, media/n8.mp4, … and 1 more) into $R\$")" "2|1" \
   "L17t: … and logs it again, past ten files as a count and the first ten"
ok "$(logn 'carry kept: ')|$(logn "Leg 1 carry kept: $R/media/k5.mp4: ")|$(logn "Leg 1 carry kept: 1 more file in $R: the primary's file is newer (1)\$")" \
   "7|1|1" "L17t: … past five files kept, one line for the rest"
CWD="$C1/sub/l" leg land
ok "$rc|$(q 'd["lands"][0]["carried"]')|$(logn 'carried: ')|$(logn 'carry kept: ')" "0|[]|2|7" \
   "L17t: a land with nothing new carries nothing and logs no kept line twice"
CWD="$C1/sub/l" leg close --outcome complete --cwd "$C1/sub/l" --reflection "$REFL"; ok "$rc" 0 "L17t: complete"
echo late > "$C1/media/late.mp4"; echo d > "$C1/media/d.mp4"; mkdir -p "$R/media/d.mp4"
CWD="$R" leg land --retire
ok "$rc|$(q '[(e["removed"], e["carried"]) for e in d["retired"]]')|$(cat "$R/media/late.mp4")|$(test -d "$C1" && echo y)" \
   "0|[(False, ['media/late.mp4'])]|late|y" "L17t: --retire carries a later file, and keeps the copy over one it cannot carry"
has "$(q 'd["retired"][0]["why"]')" "media/d.mp4 cannot be carried into $R" "L17t: … naming it"
rmdir "$R/media/d.mp4"; CWD="$R" leg land --retire
ok "$rc|$(q '[(e["removed"], e["branchDeleted"], e["carried"]) for e in d["retired"]]')|$(cat "$R/media/d.mp4")|$(cat "$R/media/clip.mp4")" \
   "0|[(True, True, ['media/d.mp4'])]|d|clip2" "L17t: … then carries it and removes the copy; the carried files stay in the primary"
unset CWD

# ---- L17e: interim (1) retired: a dependency another chain landed is claimed ----
lscen l17e
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
RO=$RO2; mkro '' "b0~cc-r~$R~\`repo:$R//b0.txt\`" "b1~cc-r~$R~\`repo:$R//b1.txt\`"; NOVERIFY=1 mkt b0; mkt b1 'depends-on:' '  - "[[a1]]"'
RO=$RO1; mkcopies
CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; RO=$RO1
CWD="$C1" work "$C1" a1 a1.txt "a1 work"; a1sha=$(git -C "$C1" rev-parse HEAD)
CWD="$C1" leg land; ok "$rc|$(lands)" "0|landed|None|None" "L17e: A lands a1"
RO=$RO2; CWD="$C2" finish b0
CWD="$C2" leg claim --task b1
ok "$rc" 1 "L17e: mid-Leg, B's copy lacks the landed a1: claim refuses"
ok "$(q 'd["error"]')" "[[b1]] depends on [[a1]] (on master, not yet in $C2: run leg.py land, which brings master in): run leg.py land, then claim again; nothing written" \
   "L17e: … naming the land and the claim again, never a set-aside"
CWD="$C2" leg land
ok "$rc|$(lands)|$(git -C "$C2" rev-parse HEAD)" "0|current|None|None|$a1sha" "L17e: land fast-forwards the copy: current"
CWD="$C2" leg claim --task b1; ok "$rc" 0 "L17e: … and b1 is claimed"
# a fresh Leg after A's land: begin's fast-forward brings a1 in
lscen l17e2
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1 'depends-on:' '  - "[[a1]]"'
RO=$RO1; mkcopies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; CWD="$C1" leg land
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["copies"][0]["fastForwarded"]')|$(q 'd["landFirst"]')" "0|True|False" "L17e: after A's land, B's fresh begin fast-forwards"
CWD="$C2" leg claim --task b1; ok "$rc" 0 "L17e: … and claim b1 passes"
unset CWD

# ---- L17f: interim (2) retired: the chain that takes its file turn second begins with the first's landed work ----
# fscen <name> [two] — A ($RO1) began first, a1 done on f.txt and its Leg closed stopped, not landed (with `two`, a
# second row a2 on g.txt still open); B ($RO2) writes f.txt too
fscen() {
  lscen "$1"
  if [ -n "${2:-}" ]; then mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`" "a2~cc-r~$R~\`repo:$R//g.txt\`"; mkt a2
  else mkro '' "a1~cc-r~$R~\`repo:$R//f.txt\`"; fi; mkt a1
  RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//f.txt\`"; mkt b1 'depends-on:' '  - "[[a1]]"'; RO=$RO1; mkcopies
  CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 f.txt "a's f"
  CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"
}
fscen l17f1 two
RO=$RO2; snap; CWD="$C2" leg begin --cwd "$C2"
ok "$rc" 3 "L17f1: B is held while A's done a1 is unlanded on f.txt"
has "$err" "surface held: [[$RO1]] holds repo:$R//f.txt" "L17f1: … naming it"; same "L17f1: a held begin"
RO=$RO1; CWD="$C1" leg land; ok "$rc|$(lands)" "0|landed|None|None" "L17f1: A's closed Leg lands a1"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["landFirst"]')|$(cat "$C2/f.txt")" "0|False|a's f" "L17f1: then B begins, with A's f.txt in its copy"
CWD="$C2" leg claim --task b1; ok "$rc" 0 "L17f1: … and claims b1"
fscen l17f2; git -C "$R" checkout -qb w; wh=$(git -C "$R" rev-parse HEAD)
CWD="$C1" leg land
ok "$rc|$(lands)|$(git -C "$R" symbolic-ref --short HEAD)|$(git -C "$R" rev-parse HEAD)|$(git -C "$R" status --porcelain --untracked-files=no)" \
   "0|landed|None|None|w|$wh|" "L17f2: R on w, master checked out nowhere: A lands by update-ref, R untouched"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["copies"][0]["fastForwarded"]')|$(cat "$C2/f.txt")" "0|True|a's f" "L17f2: B's begin fast-forwards to master though R is on w"
fscen l17f3; CWD="$C1" leg land
pcommit "$C2" THREAD.md closed "📝 docs(thread): close-out"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["landFirst"]')|$(q 'd["copies"][0]["fastForwarded"]')" "0|True|False" "L17f3: a close-out on chain/B: begin cannot fast-forward, landFirst"
has "$(q 'd["warns"]')" "WARN: $C2: not fast-forwarded to master: chain/$RO2 has commits master lacks (run leg.py land before the first claim: it merges master in)" \
   "L17f3: … with the WARN"
CWD="$C2" leg land
ok "$rc|$(lands)|$(cat "$C2/f.txt")" "0|landed|None|None|a's f" "L17f3: land merges master in and lands the close-out"
ok "$(logn "Leg 1 land: close-outs on master in $R (")" 1 "L17f3: … logged as close-outs"
CWD="$C2" leg claim --task b1; ok "$rc" 0 "L17f3: … and b1 is claimed with A's work in the copy"
fscen l17f4
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc" 3 "L17f4: a1 as A's only row (A complete, not landed): B is still held"
RO=$RO1; CWD="$C1" leg land; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(cat "$C2/f.txt")" "0|a's f" "L17f4: … and freed once A lands"
unset CWD

# ---- L17g: actual claims (ADR 0067 d4): an earlier chain's unlanded file stands a later chain's land ----
gscen l17g
ok "$(fm a1 leg_claims)" "[\"repo:$R//f.txt\"]" "L17g: done stamps leg_claims: f.txt only (no docs/reviews/, no bookkeeping)"
CWD="$C2" leg land
ok "$rc|$(lands)" "0|stood|[[$RO1]] holds repo:$R//f.txt unlanded and began first|True" \
   "L17g: B's land on f.txt stands: A began first and holds it unlanded (waits True)"
ok "$(master)|$(fm b1 leg_landed)" "$m0|<none>" "L17g: … nothing moved or stamped"
gscen l17g2 B
CWD="$C2" leg land
ok "$rc|$(lands)" "0|landed|None|None" "L17g: control: B began first: A never blocks it"
gscen l17g3; git -C "$R" merge -q --no-edit "chain/$RO1"
CWD="$C2" leg land
hasnt "$(lands)" "holds repo:" "L17g: control: a1 merged into master by hand (unstamped): git says landed, no claim stand"
gscen l17g4; RO=$RO1; subst "$T/a1.md" "leg_claims: [\"repo:$R//f.txt\"]" ""; RO=$RO2
CWD="$C2" leg land
ok "$rc|$(lands)" "0|landed|None|None" "L17g: control: a1 without leg_claims: (done before them) never blocks"
scen l17g5; R="$S/r"; mkrepo "$R" https://github.com/o/g5.git; export CWD="$R"
mkro '' "t1~cc-r~$R~\`repo:$R//c.txt\`"; mkt t1; leg begin --cwd "$R"; work "$R" t1 c.txt "t1 work"
ok "$(fm t1 leg_claims)" "<none>" "L17g: control: an in-place done stamps no leg_claims:"
leg land; ok "$rc|$(q 'd["inPlace"]')|$(q 'd["lands"]')" "0|True|[]" "L17i: in place, land is inPlace with no lands"
unset CWD

# ---- L17q: a land that stands on an earlier chain's claim still brings in what other chains landed ----
# X ($RO3) began first and holds f.txt unlanded; B's ($RO2) done b1 committed f.txt too, so B's land stands on X's
# claim; A ($RO1) has landed g.txt, and B's b2 depends on A's a1. B acts 16 minutes after X's done: within 15 minutes, X
# (earlier, between tasks) reads as about to land, and B's next would first wait for that land ((H), ADR 0067 d9: L18n).
lscen l17q; RO3=demox-rollout-2026-10-20; C3="$S/chains/r-$RO3"
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`" "b2~cc-r~$R~\`repo:$R//b2.txt\`"; mkt b1; mkt b2 'depends-on:' '  - "[[a1]]"'
RO=$RO3; mkro '' "x1~cc-r~$R~\`repo:$R//x1.txt\`"; mkt x1; CWD="$R" leg copies; mkcopies
RO=$RO3; CWD="$C3" leg begin --cwd "$C3"; ok "$rc" 0 "L17q: X's Leg begins first"
RO=$RO1; LNOW=2026-10-20T11:00+00:00 CWD="$C1" leg begin --cwd "$C1"
RO=$RO2; LNOW=2026-10-20T11:00+00:00 CWD="$C2" leg begin --cwd "$C2"; ok "$rc" 0 "L17q: … then A's and B's"
RO=$RO3; CWD="$C3" work "$C3" x1 f.txt "x's f"
RO=$RO2; CWD="$C2" work "$C2" b1 f.txt "b's f"; b1sha=$(git -C "$C2" rev-parse HEAD)
RO=$RO1; CWD="$C1" work "$C1" a1 g.txt "a's g"; CWD="$C1" leg land
ok "$rc|$(lands)" "0|landed|None|None" "L17q: A lands g.txt beside X's unlanded f.txt"; m0=$(master)
export LNOW=2026-10-20T10:16+00:00
RO=$RO2; CWD="$C2" leg claim --task b2
ok "$rc|$(q 'd["error"]')" "1|[[b2]] depends on [[a1]] (on master, not yet in $C2: run leg.py land, which brings master in): run leg.py land, then claim again; nothing written" \
   "L17q: B's b2 is refused: a1 is on master, not yet in \$C2"
CWD="$C2" leg land
ok "$rc|$(lands)" "0|stood|[[$RO3]] holds repo:$R//f.txt unlanded and began first|True" "L17q: B's land stands on X's claim on f.txt"
ok "$(cat "$C2/g.txt")|$(git -C "$C2" rev-parse HEAD^1)|$(git -C "$C2" rev-parse HEAD^2)|$(git -C "$C2" log -1 --format=%s)" \
   "a's g|$b1sha|$m0|🔀 land: merge master into chain/$RO2" "L17q: … yet its merge brought A's landed g.txt into \$C2, kept on chain/B"
ok "$(q 'd["lands"][0]["head"]')|$(q 'd["lands"][0]["merged"]')|$(master)|$(fm b1 leg_landed)" "$(git -C "$C2" rev-parse HEAD)|$m0|$m0|<none>" \
   "L17q: … the stand names that merge, and master and b1 are unmoved"
CWD="$C2" leg claim --task b2; ok "$rc" 0 "L17q: … so the claim of b2 that land named passes"
unset LNOW
tcommit "$C2" b2 b2.txt "b2 work"; d=$(review "$C2" HEAD); CWD="$C2" leg done --task b2 --verify pass --review "$d" --cwd "$C2"
subst "$T/x1.md" "leg_claims: [\"repo:$R//f.txt\"]" ""   # X's claim gone (as in L17g4): only the kept merge is left
CWD="$C2" leg land
ok "$rc|$(lands)|$(q '[v["task"] for v in d["lands"][0]["verify"]]')" "0|verify|None|None|['b1']" \
   "L17q: once X's claim clears, the kept merge asks for b1's re-verify (b2 was cut after it)"
unset CWD

# ---- L17r: the fast-forward in P re-reads P's branch after the peer check ----
# rscen <name> — one copy chain A with a1 done, unlanded; $m0 master, $tip chain/A's tip
rscen() {
  lscen "$1"; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1; CWD="$R" leg copies
  CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; m0=$(master); tip=$(git -C "$C1" rev-parse HEAD)
}
# pland <python> — A's land, in-process from $C1, after <python> (m the module, R the primary) patches it
pland() {
  out=$(cd "$C1" && python3 - "$LEG" "$T/$RO.md" "$T" "$V" "$NOW" "$R" "$1" <<'PY2'
import importlib.util, json, os, subprocess, sys
leg, note, tasks, vault, now, R, patch = sys.argv[1:]
spec = importlib.util.spec_from_file_location("legmod", leg); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.rr, m.sc = m._load("reconcile_rollout", m.RR_SRC), m._load("serial_chains", m.SC_SRC)
args = m.parser().parse_args(["land", "--rollout", note, "--tasks-dir", tasks, "--vault", vault, "--now", now, "--session", "s1"])
exec(patch)
print(json.dumps(m.cmd_land(m.Ctx(args), args)))
PY2
); rc=$?
}
rscen l17r
pland '
real = m.peer_stand
def peer_stand(*a, **k):   # R switches to w while the peer check reads the notes
    subprocess.run(["git", "-C", R, "checkout", "-q", "-b", "w"], check=True)
    return real(*a, **k)
m.peer_stand = peer_stand'
ok "$rc|$(lands)" "0|stood|$R left master during the land (its HEAD is now refs/heads/w)|True" \
   "L17r: R switched to w after where was read: the land stands (waits True), never an ff of w"
ok "$(master)|$(git -C "$R" rev-parse w)|$(fm a1 leg_landed)|$(logn 'Leg 1 land: ')" "$m0|$m0|<none>|0" \
   "L17r: … master and w unmoved, nothing stamped, no land: line"
CWD="$C1" leg land
ok "$rc|$(lands)|$(master)|$(git -C "$R" rev-parse w)" "0|landed|None|None|$tip|$m0" "L17r: control: the next land, R on w, lands by update-ref"
rscen l17r2
pland '
real, fired = m.git, []
def git(top, *a, **k):   # R switches to w2 between the re-read and the ff
    if not fired and "merge" in a and "--ff-only" in a and os.path.realpath(str(top)) == os.path.realpath(R):
        fired.append(1)
        real(R, "checkout", "-q", "-b", "w2")
    return real(top, *a, **k)
m.git = git'
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$tip" \
   "L17r: an ff that moved w2, not master, is moved, never landed: the next try lands master by update-ref"
ok "$(logn "Leg 1 land: \[\[a1\]\] on master in $R (${tip:0:12})\$")|$(fm a1 leg_landed)" "1|$NOW" "L17r: … logged once, a1 stamped"
unset CWD

# ---- L17s: the ff in P runs only when <d> is strictly behind the chain branch, and the overlap first (p39-4) ----
# Each case patches A's land once, from a wrapped peer_stand (between step 4 and the re-read), as L17r does.
# s2: <d> moves on and an untracked file lands in R's way: moved first (re-run from step 4), never the overlap's stand
rscen l17s2; nohR
pland '
real, fired = m.peer_stand, []
def peer_stand(*a, **k):
    if not fired:
        fired.append(1)
        subprocess.run(["git", "-C", R, "commit", "-q", "--allow-empty", "-m", "peer moves master"], check=True)
        open(os.path.join(R, "a1.txt"), "w").write("peer a1\n")
    return real(*a, **k)
m.peer_stand = peer_stand'
ok "$rc|$(lands)" "0|verify|None|None" \
   "L17s2: master moved during the peer check: moved, then the next try asks for the re-verify, never the overlap's stand"
ok "$(git -C "$R" log -1 --format=%s master)|$(cat "$R/a1.txt")|$(ohR)|$(fm a1 leg_landed)" "peer moves master|peer a1|absent|<none>" \
   "L17s2: … master is the moved commit, a1.txt intact, R's ORIG_HEAD absent, nothing stamped"
rm -f "$R/a1.txt"; unset CWD
# s3: R's master is already the chain's tip at the re-read (moved there by hand): landed, and no no-op merge ran
rscen l17s3
pland '
real, fired = m.peer_stand, []
def peer_stand(*a, **k):
    if not fired:
        fired.append(1)
        br = "refs/heads/chain/" + os.path.basename(note)[:-3]
        subprocess.run(["git", "-C", R, "merge", "-q", "--ff-only", br], check=True)
        oh = subprocess.run(["git", "-C", R, "rev-parse", "--path-format=absolute", "--git-path", "ORIG_HEAD"],
                            capture_output=True, text=True).stdout.strip()
        if os.path.exists(oh):
            os.remove(oh)
    return real(*a, **k)
m.peer_stand = peer_stand'
ok "$rc|$(lands)|$(master)|$(ohR)" "0|landed|None|None|$tip|absent" \
   "L17s3: master already at the chain's tip: landed with no merge run (R's ORIG_HEAD absent)"
unset CWD
# s4: the chain branch is moved back to master: d equals it, so moved with no merge, then the next try is current
rscen l17s4; nohR
pland '
real, fired = m.peer_stand, []
def peer_stand(*a, **k):
    if not fired:
        fired.append(1)
        br = "refs/heads/chain/" + os.path.basename(note)[:-3]
        subprocess.run(["git", "-C", R, "update-ref", br, "refs/heads/master"], check=True)
    return real(*a, **k)
m.peer_stand = peer_stand'
ok "$rc|$(lands)|$(master)|$(ohR)" "0|current|None|None|$m0|absent" \
   "L17s4: chain/<RO> moved to master: moved with no merge run, then current, R's ORIG_HEAD absent"
unset CWD
# s5: the chain branch is gone at the re-read, d unmoved: it stands, naming the branch, and no merge runs
rscen l17s5; nohR
pland '
real, fired = m.peer_stand, []
def peer_stand(*a, **k):
    if not fired:
        fired.append(1)
        br = "refs/heads/chain/" + os.path.basename(note)[:-3]
        subprocess.run(["git", "-C", R, "update-ref", "-d", br], check=True)
    return real(*a, **k)
m.peer_stand = peer_stand'
ok "$rc|$(lands)|$(master)|$(ohR)" "0|stood|cannot read refs/heads/chain/$RO in $R|False|$m0|absent" \
   "L17s5: chain/<RO> unreadable with master unmoved: it stands, naming it, no merge run"
unset CWD
# s6: the overlap mode cannot run: a WARN, and the merge goes on with git's own refusal as its only guard
rscen l17s6
pland 'm.LIVE_CHECKOUT_SH = m.Path("/nonexistent/live-checkout.sh")'
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$tip" "L17s6: live-checkout.sh overlap cannot run: the ff still lands"
has "$(q 'd["warns"]')" "WARN: $R: live-checkout.sh overlap exit 127: the fast-forward ran with git's own refusal as its only guard" \
   "L17s6: … with a WARN naming it"
unset CWD

# ---- L17h: the per-repo lock ----
lscen l17h; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1; mkcopies
CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; m0=$(master)
RL="$(git -C "$R" rev-parse --path-format=absolute --git-common-dir)/thread/chain-land.lock"
holdlock "$RL" "$TMP/rl1"; hp1=$hp
LEGENV=THREAD_LEG_LOCK_TIMEOUT=1 CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|another land held $RL past 1s|True" "L17h: a held chain-land.lock: exit 0, the copy stands naming it (waits True)"
ok "$(master)|$(fm a1 leg_landed)" "$m0|<none>" "L17h: … nothing moved"
holdlock "$THREAD_LEG_LOCK_DIR/$RO1.lock" "$TMP/rl2"; hp2=$hp
LEGENV=THREAD_LEG_LOCK_TIMEOUT=1 CWD="$C1" leg land; ok "$rc" 5 "L17h: a held rollout lock is still exit 5"
kill "$hp1" "$hp2"; wait "$hp1" "$hp2" 2>/dev/null
# (h2) two copies, R1's lock held: R1 stands, R2 lands; a row's stamp waits for every entry
cscen l17h2; R="$S/r"; crepo "$R" https://github.com/o/h2.git; R2="$S/r2"; crepo "$R2" https://github.com/o/h22.git
C="$S/chains/r-$RO"; C2="$S/chains/r2-$RO"
mkro '' "t1~cc-r~$R~\`repo:$R//a.txt\` \`repo:$R2//b.txt\`"; mkt t1
CWD="$R" leg copies; CWD="$C" leg begin --cwd "$C"; CWD="$C" work "$C" t1 c.txt "t1 work"
pcommit "$C2" THREAD.md closed "📝 docs(thread): close-out"; c2=$(git -C "$C2" rev-parse HEAD)
subst "$T/t1.md" "leg_head: [\"$C@" "leg_head: [\"$C2@$c2\", \"$C@"
RL2="$(git -C "$R" rev-parse --path-format=absolute --git-common-dir)/thread/chain-land.lock"
holdlock "$RL2" "$TMP/rl3"
LEGENV=THREAD_LEG_LOCK_TIMEOUT=1 CWD="$C" leg land
ok "$rc|$(lands)" "0|stood|another land held $RL2 past 1s|True;landed|None|None" "L17h2: R1 locked: R1 stands, R2 lands"
ok "$(git -C "$R2" rev-parse master)|$(fm t1 leg_landed)" "$c2|<none>" "L17h2: … t1's R2 entry is on master, yet its stamp waits for R1's"
kill "$hp"; wait "$hp" 2>/dev/null
CWD="$C" leg land
ok "$rc|$(lands)|$(fm t1 leg_landed)" "0|landed|None|None;current|None|None|$NOW" "L17h2: once free, R1 lands and t1 is stamped"
unset CWD

# ---- L17j: --red keeps the merge and moves nothing ----
# jscen <name> — A lands a1; B's b1 (cut before it) asks for its re-verify
jscen() {
  lscen "$1"; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`" "b2~cc-r~$R~\`repo:$R//b2.txt\`"; mkt b1; mkt b2; RO=$RO1; mkcopies
  CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" work "$C2" b1 b1.txt "b1 work"
  RO=$RO1; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; CWD="$C1" leg land; m0=$(master); RO=$RO2
}
jscen l17j
CWD="$C2" leg land; ok "$(lands)" "verify|None|None" "L17j: B's land asks"; h=$(q 'd["lands"][0]["head"]')
snap; CWD="$C2" leg land --red "make test red"
ok "$rc|$(lands)|$(master)|$(git -C "$C2" rev-parse HEAD)" "0|stood|Verify red after a land merge: make test red|False|$m0|$h" \
   "L17j1: --red logs the stand, keeps the merge on chain/B and moves nothing"
ok "$(diff "$TMP/snap" "$T/$RO.md" | grep -c '^>')|$(logn "Leg 1 land stood: $R: Verify red after a land merge: make test red\$")" "1|1" \
   "L17j1: … one line written"
# (j2) the close-time land: B's Leg closed, its red files no fix (file-fix refuses a closed Leg), the next Leg asks again
jscen l17j2
CWD="$C2" leg close --outcome handoff --cwd "$C2"; ok "$rc" 0 "L17j2: B's Leg 1 closes with a handoff"
CWD="$C2" leg land; ok "$rc|$(lands)" "0|verify|None|None" "L17j2: the closed Leg's land asks for the re-verify"
h=$(q 'd["lands"][0]["head"]'); snap
CWD="$C2" leg land --red "x"
ok "$rc|$(diff "$TMP/snap" "$T/$RO.md" | grep '^>' | sed 's/^> //')" "0|- $NOW Leg 1 land stood: $R: Verify red after a land merge: x" \
   "L17j2: --red on a closed Leg writes only that stand line"
ok "$(master)|$(git -C "$C2" rev-parse HEAD)" "$m0|$h" "L17j2: … no ref moved"
CWD="$C2" leg file-fix --target b1 --cause outside --evidence x
ok "$rc" 1 "L17j2: file-fix on the closed Leg is exit 1"; has "$err" "no Leg has begun" "L17j2: … naming it"
SESS=s2 CWD="$C2" leg begin --cwd "$C2"
ok "$rc|$(q 'd["landFirst"]')" "0|True" "L17j2: the next Leg's begin prints landFirst"
has "$(q 'd["warns"]')" "WARN: $C2: chain/$RO2 has commits master lacks, not yet landed (run leg.py land before the first claim)" \
   "L17j2: … its copy holding master through the kept merge"
SESS=s2 CWD="$C2" leg land; ok "$rc|$(lands)" "0|verify|None|None" "L17j2: … and its land asks again (no verified tip recorded)"
unset CWD

# ---- L17m: a verified tip is recorded, so a stand after --verified asks nothing more ----
jscen l17m
CWD="$C2" leg land; h=$(q 'd["lands"][0]["head"]'); echo x > "$R/b1.txt"
CWD="$C2" leg land --verified "$h"
ok "$rc|$(lands)" "0|stood|the primary's uncommitted edit on b1.txt|False" "L17m: --verified, then the ff stands on a peer's file"
ok "$(logn "Leg 1 land verified: $R at $h\$")" 1 "L17m: … the verified tip logged"
rm "$R/b1.txt"; CWD="$C2" leg land
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$h" "L17m: once the file is gone it lands with no ask"
CWD="$C2" work "$C2" b2 b2.txt "b2 work"; pcommit "$R" other.txt o "a peer moves master"
CWD="$C2" leg land; h2=$(q 'd["lands"][0]["head"]'); echo x > "$R/b2.txt"
CWD="$C2" leg land --verified "$h2"; ok "$(lands)" "stood|the primary's uncommitted edit on b2.txt|False" "L17m: control: a second round stands"
rm "$R/b2.txt"; pcommit "$R" other2.txt o "master moves again"
CWD="$C2" leg land; ok "$rc|$(lands)" "0|verify|None|None" "L17m: control: master moved after the verify: it asks again"
unset CWD

# ---- L17i: stands that run no git, the refusals, and the in-place peer ----
lscen l17i; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`" "a2~cc-r~$R~\`repo:$R//a2.txt\`"; mkt a1; mkt a2; mkcopies
CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" leg claim --task a1
snap; CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|a row is in progress: a land never merges mid-task|False" "L17i: a row in progress stands every copy"
ok "$(diff "$TMP/snap" "$T/$RO.md" | grep -c '^>')" 1 "L17i: … logging only its stand"
tcommit "$C1" a1 a1.txt "a1 work"; d=$(review "$C1" HEAD); CWD="$C1" leg done --task a1 --verify pass --review "$d" --cwd "$C1"
m0=$(master); snap; CWD="$C1" leg land --dry-run
ok "$rc|$(q 'd["lands"][0]["state"]')|$(q 'd["lands"][0]["plan"]["unl"]')|$(q 'd["lands"][0]["plan"]["ff"]')|$(q 'd["dryRun"]')" \
   "0|plan|['a1']|merge --ff-only in $R|True" "L17i: --dry-run prints the plan"
ok "$(master)|$(fm a1 leg_landed)" "$m0|<none>" "L17i: … and moves nothing"; same "L17i: --dry-run"
SESS=s9 CWD="$C1" leg land; ok "$rc" 1 "L17i: another session's land is exit 1"
has "$err" "no Leg of this session: run leg.py begin first" "L17i: … naming it"
CWD="$C1" leg land --retire; ok "$rc" 1 "L17i: --retire on a live note is exit 1"
CWD="$C1" leg land --verified abc; ok "$rc|$out" "2|" "L17i: --verified needs a full sha (usage)"
CWD="$C1" leg land --red x --verified "$m0"; ok "$rc|$out" "2|" "L17i: --red with --verified is usage"
git -C "$R" checkout -q -b w; git -C "$R" worktree add -q "$S/mw" master
CWD="$C1" leg land
ok "$rc|$(lands)|$(master)" "0|stood|master is checked out in $S/mw|False|$m0" "L17i: master checked out in another worktree: it stands"
git -C "$R" worktree remove "$S/mw"; git -C "$R" checkout -q master
dscen l17i2; CWD="$R" leg land; ok "$rc" 1 "L17i: plain land on an archived note is exit 1"
has "$err" "only file-followup and land --retire write after Complete" "L17i: … naming land --retire"
cscen l17i3
R="$S/r"; mkdir -p "$R"; git -c init.defaultBranch=trunk init -q "$R"; echo a > "$R/a.txt"; git -C "$R" add -A; git -C "$R" commit -qm base
C="$S/chains/r-$RO"; mkro '' "t1~cc-r~$R~\`repo:$R//a.txt\`"; mkt t1
CWD="$R" leg copies; CWD="$C" leg begin --cwd "$C"; CWD="$C" work "$C" t1 t.txt "t1 work"
CWD="$C" leg land
ok "$rc|$(lands)" "0|stood|$R has no default branch resolved (origin/HEAD, main or master)|False" "L17i: no default branch: it stands"
unset CWD
# The in-place peer: IP ($RO3) works $R in place, beside copy chain A ($RO1)
# pscen <name> — A's a1 done and landed, a close-out on chain/A, A closed stopped; IP's note (row ip1 on $R, from $R)
pscen() {
  lscen "$1"; RO3=demoip-rollout-2026-10-20
  mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
  RO=$RO3; mkro '' "ip1~cc-r~$R~\`repo:$R//ip.txt\`"; mkt ip1; RO=$RO1
  CWD="$R" leg copies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"
  CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "$1: a1 lands"
  pcommit "$C1" THREAD.md closed "📝 docs(thread): close-out"
  CWD="$C1" leg close --outcome stopped --reason "out of time" --cwd "$C1"
}
# closeout <name> — another close-out on chain/A
closeout() { pcommit "$C1" "THREAD-$1.md" "$1" "📝 docs(thread): close-out $1"; }
pscen l17p
RO=$RO3; CWD="$R" leg begin --cwd "$R"; ok "$rc" 0 "L17i (p1): IP's real begin in \$R passes beside A, all done and landed"
RO=$RO1; m0=$(master); rh=$(git -C "$R" rev-parse HEAD); ips=$(fm ip1 status)
CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|[[$RO3]] works $R in place (Leg 1 open): a land never moves a checked-out master under another chain's live work|True" \
   "L17i (p1): A's closed-Leg land stands while IP's Leg is open in \$R (waits True)"
ok "$(master)|$(git -C "$R" rev-parse HEAD)|$(git -C "$R" status --porcelain --untracked-files=no)|$(fm ip1 status)" "$m0|$rh||$ips" \
   "L17i (p1): … master, \$R's HEAD and tree and IP untouched"
ok "$(logn "Leg 1 land stood: $R: \[\[$RO3\]\] works $R in place (Leg 1 open)")" 1 "L17i (p1): … the stand logged"
RO=$RO3; CWD="$R" leg claim --task ip1; CWD="$R" leg close --outcome stopped --reason "out of time" --cwd "$R"; RO=$RO1
CWD="$C1" leg land
ok "$rc|$(lands)" "0|stood|[[$RO3]] works $R in place ([[ip1]] in progress): a land never moves a checked-out master under another chain's live work|True" \
   "L17i (p2): IP closed with ip1 in progress: it still stands"
RO=$RO3; CWD="$R" leg begin --cwd "$R"; CWD="$R" leg claim --task ip1 --inherit; ok "$rc" 0 "L17i (p3): IP's Leg 2 takes ip1"
CWD="$R" leg set-aside --task ip1 --reason "set aside"; ok "$rc" 0 "L17i (p3): … sets it aside"
CWD="$R" leg close --outcome stuck --cwd "$R"; ok "$rc" 0 "L17i (p3): … and closes stuck"; RO=$RO1
CWD="$C1" leg land
ok "$rc|$(lands)|$(master)" "0|landed|None|None|$(git -C "$C1" rev-parse HEAD)" "L17i (p3): control: nothing of IP's is live: A lands"
R2="$S/r2"; crepo "$R2" https://github.com/o/p2.git; RO4=demoipb-rollout-2026-10-20
RO=$RO4; mkro '' "q1~cc-r~$R2~\`repo:$R2//q.txt\`"; mkt q1; CWD="$R2" leg begin --cwd "$R2"; ok "$rc" 0 "L17i (p3): a second in-place chain opens a Leg in \$R2"
RO=$RO1; closeout two; CWD="$C1" leg land
ok "$rc|$(lands)" "0|landed|None|None" "L17i (p3): control: a live chain in place in another repo: A lands"
RO5=demoipc-rollout-2026-10-20; RO=$RO5; mkro '' "r1~cc-r~$R~\`repo:$R//r.txt\`"; mkt r1
CWD="$R" leg begin --cwd "$R"; ok "$rc" 0 "L17i (p3): a third in-place chain opens a Leg in \$R"
git -C "$R" checkout -q -b w; RO=$RO1; closeout three; wh=$(git -C "$R" rev-parse HEAD)
CWD="$C1" leg land
ok "$rc|$(lands)|$(git -C "$R" symbolic-ref --short HEAD)|$(git -C "$R" rev-parse HEAD)|$(git -C "$R" status --porcelain --untracked-files=no)" \
   "0|landed|None|None|w|$wh|" "L17i (p3): control: \$R on w, master checked out nowhere: update-ref beside that open Leg, \$R untouched"
git -C "$R" checkout -q master
RO=$RO5; CWD="$R" leg close --outcome stopped --reason "out of time" --cwd "$R"
subst "$T/$RO5.md" "status: open" "status: dropped"   # its unlanded row in $R would hold a later chain's begin there (d4)
RO6=demoipd-rollout-2026-10-20; RO=$RO6; EXTRA_FM='chain_copies: []'$'\n' mkro '' "s1~cc-r~$R~\`repo:$R//s.txt\`"; mkt s1
CWD="$R" leg copies; C6="$S/chains/r-$RO6"; CWD="$C6" leg begin --cwd "$C6"; ok "$rc" 0 "L17i (p3): a copy chain opens a Leg"
RO=$RO1; closeout four; CWD="$C1" leg land
ok "$rc|$(lands)" "0|landed|None|None" "L17i (p3): control: a chain with chain_copies: is no peer: A lands"
unset CWD
# (p4) A complete and archived, IP's Leg open: --retire keeps both, then retires both once IP closes
lscen l17p4; RO3=demoip-rollout-2026-10-20
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1; RO=$RO3; mkro '' "ip1~cc-r~$R~\`repo:$R//ip.txt\`"; mkt ip1; RO=$RO1
CWD="$R" leg copies; CWD="$C1" leg begin --cwd "$C1"; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; CWD="$C1" leg land
CWD="$C1" leg close --outcome complete --cwd "$C1" --reflection "$REFL"; ok "$rc" 0 "L17i (p4): A completes"
RO=$RO3; CWD="$R" leg begin --cwd "$R"; RO=$RO1; closeout one
CWD="$R" leg land --retire
ok "$rc|$(q '[(e["landed"], e["removed"], e["branchDeleted"]) for e in d["retired"]]')|$(test -d "$C1" && echo y)" "0|[(False, False, False)]|y" \
   "L17i (p4): --retire beside IP's open Leg keeps the copy and the branch"
has "$(cat "$T/$(q 'd["followup"]').md")" "once [[$RO3]]'s Leg closes, run" "L17i (p4): … its follow-on waits for IP's Leg"
RO=$RO3; CWD="$R" leg close --outcome stopped --reason "out of time" --cwd "$R"; RO=$RO1
CWD="$R" leg land --retire
ok "$rc|$(q '[(e["landed"], e["removed"], e["branchDeleted"]) for e in d["retired"]]')|$(test -d "$C1" && echo y || echo n)" "0|[(True, True, True)]|n" \
   "L17i (p4): once IP's Leg closes, the same --retire retires both"
unset CWD
# (p5) a peer whose Chain read raises stands only when its surfaces: name the primary (or read as any)
p5() {  # p5 <IP's extra surfaces line> — A's land, in-process, with Chain raising for IP's note
  RO=$RO3; EXTRA_FM="$1"$'\n' mkro '' "ip1~cc-r~$R~\`repo:$R//ip.txt\`"; RO=$RO1
  out=$(python3 - "$LEG" "$T/$RO1.md" "$T" "$V" "$NOW" "$RO3" <<'PY2'
import importlib.util, json, sys
leg, note, tasks, vault, now, bad = sys.argv[1:]
spec = importlib.util.spec_from_file_location("legmod", leg); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.rr, m.sc = m._load("reconcile_rollout", m.RR_SRC), m._load("serial_chains", m.SC_SRC)
args = m.parser().parse_args(["land", "--rollout", note, "--tasks-dir", tasks, "--vault", vault, "--now", now, "--session", "s1"])
real = m.Chain
class Chain(real):
    def __init__(self, ctx):
        if ctx.rollout.stem == bad:
            raise ValueError("planted")
        super().__init__(ctx)
m.Chain = Chain
print(json.dumps(m.cmd_land(m.Ctx(args), args)))
PY2
)
}
pscen l17p5; closeout five
p5 '  - "repo:'"$R"'"'
ok "$(lands)" "stood|[[$RO3]] could not be read (ValueError: planted) and may work $R in place: fix its note|False" \
   "L17i (p5): an unreadable peer whose surfaces: name \$R stands the land, waits False"
R2="$S/r2"; mkdir -p "$R2"; p5 '  - "repo:'"$R2"'"'
ok "$(lands)" "landed|None|None" "L17i (p5): … one whose surfaces: name only \$R2 lets it land"
has "$(q 'd["warns"]')" "WARN: [[$RO3]] could not be read (ValueError: planted)" "L17i (p5): … with a WARN"

# ---- L17o: Complete lands first, so the completion verify runs on the landed tip ----
lscen l17o; mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1
RO=$RO2; EXTRA_FM=$(printf '  - "repo:%s"\ncompletion_verifier: "true"' "$R")$'\n' mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; CWD="$C2" work "$C2" b1 b1.txt "b1 work"
RO=$RO1; CWD="$C1" work "$C1" a1 a1.txt "a1 work"; CWD="$C1" leg land
RO=$RO2; CWD="$C2" leg next; ok "$(q 'd["action"]')" complete "L17o: B's next is complete"
CWD="$C2" leg land; ok "$(lands)" "verify|None|None" "L17o: Land first: B's land asks for b1's re-verify"
CWD="$C2" leg land --verified "$(q 'd["lands"][0]["head"]')"; ok "$(lands)" "landed|None|None" "L17o: … then lands"
CWD="$C2" rcv --run; ok "$rc|$(q 'd["result"]')" "0|green" "L17o: the completion verify runs green"
ok "$(master)" "$(git -C "$C2" rev-parse HEAD)" "L17o: … on the copy's HEAD, which is master"
CWD="$C2" leg close --outcome complete --cwd "$C2" --reflection "$REFL"; ok "$rc" 0 "L17o: complete"
has "$(cat "$T/Archive/Rollouts/$RO2.md")" "- Completion verify: green at $(master | cut -c1-12) (\`true\`)" \
   "L17o: … its Completion verify line names master's landed tip"
# (o2) a land that waits for an earlier chain closes the Leg stopped, never a halt; once that chain lands, it completes
lscen l17o2; printf '1\n2\n3\n4\n5\n' > "$R/f.txt"; git -C "$R" add f.txt; git -C "$R" commit -qm "f"
mkro '' "a1~cc-r~$R~\`repo:$R//a1.txt\`"; mkt a1; RO=$RO2; mkro '' "b1~cc-r~$R~\`repo:$R//b1.txt\`"; mkt b1; RO=$RO1
mkcopies; CWD="$C1" leg begin --cwd "$C1"; RO=$RO2; LNOW=2026-10-20T11:00+00:00 CWD="$C2" leg begin --cwd "$C2"; RO=$RO1
CWD="$C1" work "$C1" a1 f.txt $'A\n2\n3\n4\n5'
RO=$RO2; CWD="$C2" work "$C2" b1 f.txt $'1\n2\n3\n4\nB'
CWD="$C2" leg next; ok "$(q 'd["action"]')" complete "L17o2: B's rows are all done: next is complete"
CWD="$C2" leg land
ok "$rc|$(lands)" "0|stood|[[$RO1]] holds repo:$R//f.txt unlanded and began first|True" "L17o2: Land first waits on A (waits True)"
CWD="$C2" leg close --outcome stopped --reason "land waits: [[$RO1]] holds repo:$R//f.txt unlanded and began first" --cwd "$C2"
ok "$rc|$(fm "$RO2" status)|$(test -f "$T/$RO2.md" && echo live)" "0|open|live" "L17o2: … B closes stopped: the note stays live, not done"
RO=$RO1; CWD="$C1" leg land; ok "$(lands)" "landed|None|None" "L17o2: A lands"
RO=$RO2; CWD="$C2" leg begin --cwd "$C2"; ok "$rc|$(q 'd["next"]["action"]')" "0|complete" "L17o2: B's fresh Leg reads complete"
CWD="$C2" leg land; ok "$(lands)" "verify|None|None" "L17o2: … its land merges A's f.txt in and asks"
CWD="$C2" leg land --verified "$(q 'd["lands"][0]["head"]')"; ok "$(lands)|$(cat "$R/f.txt" | tr '\n' ' ')" "landed|None|None|A 2 3 4 B " \
   "L17o2: … then lands both edits"
CWD="$C2" leg close --outcome complete --cwd "$C2" --reflection "$REFL"; ok "$rc" 0 "L17o2: and Complete closes"
unset CWD

echo
if [ "$fail" -eq 0 ]; then echo "leg-land.test.sh: ALL PASS"; else echo "leg-land.test.sh: FAILED"; fi
exit "$fail"
