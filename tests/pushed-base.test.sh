#!/usr/bin/env bash
# p12-15, executed: the pushed-base check in skills/_shared/execution-fit.md § Dispatch blockers — the
# `# thread:pushed-base-check` snippet extracted by its markers (placeholders substituted: `R="$1"; shift`,
# `L="$1"; shift`, `<citedPaths>` → `"$@"`), run under bash AND zsh (the Bash tool's shell on macOS) against
# fixture clones, plus skills/_shared/scripts/pushed-base.sh called directly. Then the wiring: schedule § 0
# and step 2, execute § 2.7 (entry points only) and repair §§ 4/6 point at it without copying it.
#
# Fixture shape: a bare origin made with `init --bare -b master`, a seed clone pushes the first commit, and
# every test clone is made AFTER that push (so `git clone` sets origin/HEAD → origin/master, which repo-state.sh
# reads). Each clone's raw origin URL is https://github.com/o/<name>.git (so it normalises to o/<name>, the
# clone-set identity) and a clone-local url.<bare>.insteadOf rewrites it to the bare repo for fetch and
# ls-remote. Hermetic: HOME, CLAUDE_CONFIG_DIR and every repo live under mktemp; git identity is passed per
# command; global and system git config are ignored; no gh, no network.
set -uo pipefail
cd "$(dirname "$0")/.."
. tests/lib/assert.sh
unset $(git rev-parse --local-env-vars)   # git's own list of repo-local vars (GIT_DIR, GIT_CONFIG_PARAMETERS, …)
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
root=$(pwd -P)
ef=skills/_shared/execution-fit.md
script="$root/skills/_shared/scripts/pushed-base.sh"

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
tmp=$(cd "$tmp" && pwd -P)
g() { git -c user.name=t -c user.email=t@t -c init.defaultBranch=master "$@"; }

# ---- shells: bash always; zsh mandatory on macOS, else run when installed and SKIP visibly --------------
shells=("$(command -v bash)")
zsh_bin=$(command -v zsh 2>/dev/null || true)
if [ -n "$zsh_bin" ]; then shells+=("$zsh_bin -f")
elif [ "$(uname)" = Darwin ]; then ok "missing" "present" "zsh is installed (mandatory on macOS: it is the Bash tool's shell)"
else echo "SKIP - zsh arm: zsh not installed on this $(uname) runner"; fi

# ---- the snippet, verbatim from execution-fit.md ----------------------------------------------------------
awk '/^# thread:pushed-base-check/{on=1; next} /^# end thread:pushed-base-check/{on=0} on' "$ef" > "$tmp/raw.sh"
ok "$(grep -c '^R="<repoPath>"$' "$tmp/raw.sh")" 1 "pushed-base-check snippet found in execution-fit.md"
[ -s "$tmp/raw.sh" ] || { echo; echo "pushed-base: SOME FAILED (no snippet to run)"; exit 1; }
ok "$(grep -c '^L="<localPath>"$' "$tmp/raw.sh")" 1 "the snippet carries the <localPath> placeholder"
ok "$(grep -c '<citedPaths>' "$tmp/raw.sh")" 1 "the snippet carries the <citedPaths> placeholder"
ok "$(grep -cE '\$\{?[0-9]' "$tmp/raw.sh")" 0 "the snippet holds no positional \$N (skill arguments substitute into them)"
ok "$(grep -c 'skills/_shared/scripts/pushed-base\.sh' "$tmp/raw.sh")" 1 "the snippet calls pushed-base.sh"
ok "$(grep -c 'skills/execute/scripts/default-branch\.sh' "$tmp/raw.sh")" 1 "the snippet resolves the branch with default-branch.sh"
snip=$(sed -e 's/^R="<repoPath>"$/R="$1"; shift/' -e 's/^L="<localPath>"$/L="$1"; shift/' -e 's/<citedPaths>/"$@"/' "$tmp/raw.sh")

# ---- fixtures -------------------------------------------------------------------------------------------
home="$tmp/home"; cfg="$tmp/cfg"; mkdir -p "$home" "$cfg/plugins" "$tmp/plain"
reg="$cfg/plugins/known_marketplaces.json"
write_reg() {  # write_reg <directory-source path>…: one directory source per path, plus a github source
  { echo '{'; echo '  "official": {"source": {"source": "github", "repo": "o/official"}, "installLocation": "'"$tmp"'/plain"}'
    local i=0 p; for p in "$@"; do i=$((i+1)); echo "  ,\"dir$i\": {\"source\": {\"source\": \"directory\", \"path\": \"$p\"}, \"installLocation\": \"$p\"}"; done
    echo '}'; } > "$reg"
}

k=0
fresh() {  # fresh → $O (bare origin, slug o/r), $S (the seed clone that pushed), $C (a clone made after the push)
  k=$((k+1)); O="$tmp/o$k.git"; S="$tmp/s$k"; C="$tmp/c$k"
  g init -q --bare -b master "$O"
  g clone -q "$O" "$S" 2>/dev/null
  mkdir -p "$S/docs/adr"; echo base > "$S/README"; echo y > "$S/docs/adr/0026-y.md"; echo t > "$S/THREAD.md"
  echo ignored.md > "$S/.gitignore"
  g -C "$S" add -A && g -C "$S" commit -q -m base && g -C "$S" push -q origin master
  mkclone "$O" "$C"
}
mkclone() {  # mkclone <bare> <dir> [<name>]: a clone whose raw origin URL is github.com/o/<name>, rewritten to <bare>
  g clone -q "$1" "$2"
  git -C "$2" remote set-url origin "https://github.com/o/${3:-r}.git"
  git -C "$2" config "url.$1.insteadOf" "https://github.com/o/${3:-r}.git"
}
commit() {  # commit <dir> <message> <file>…: append a line to each file, commit them all
  local d="$1" m="$2" f; shift 2
  for f in "$@"; do mkdir -p "$(dirname "$d/$f")"; echo "$m" >> "$d/$f"; g -C "$d" add -- "$f"; done
  g -C "$d" commit -q -m "$m"
}

# run <repoPath> <localPath> [<cited>…]: the snippet under every shell; rc, out, err from the first, and every
# other shell must agree. $XENV adds env assignments (no spaces), $PLUGROOT overrides CLAUDE_PLUGIN_ROOT.
XENV=''
run() {
  local sh first=1 o e r
  for sh in "${shells[@]}"; do
    o=$(cd "$tmp" && env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" CLAUDE_PLUGIN_ROOT="${PLUGROOT:-$root}" $XENV $sh -c "$snip" _ "$@" 2>"$tmp/err"); r=$?
    e=$(cat "$tmp/err")
    if [ "$first" = 1 ]; then rc=$r out=$o err=$e first=0
    else ok "$r|$o|$e" "$rc|$out|$err" "  … $(basename "${sh%% *}") agrees"; fi
  done
}
# pb <arg>…: the script directly (bash only); rc, out, err
pb() { out=$(cd "$tmp" && env HOME="$home" CLAUDE_CONFIG_DIR="$cfg" bash "$script" "$@" 2>"$tmp/err"); rc=$?; err=$(cat "$tmp/err"); }
lacks() { case "$1" in *"$2"*) ok y n "$3" ;; *) ok n n "$3" ;; esac; }
count() { printf '%s\n' "$1" | grep -cF -- "$2"; }

# ======== block, single clone ===========================================================================
# 1. in sync
fresh
ok "$(git -C "$C" symbolic-ref -q refs/remotes/origin/HEAD)" refs/remotes/origin/master "a clone made after the seed push has origin/HEAD (precondition)"
run "$C" ""
ok "$rc|$out|$err" "0|pushed|" "1. in sync → 0, pushed, silent"

# 2. ahead 2 with an ADR, no close ref: stranded
fresh
commit "$C" "add adr 0018" docs/adr/0018-x.md
commit "$C" "second local commit" notes.md
run "$C" ""
ok "$rc|${out:-<empty>}" "3|<empty>" "2. ahead 2 → 3, nothing on stdout"
while IFS= read -r l; do has "$err" "$l" "2. … lists '$l'"; done <<EOF
$(git -C "$C" log --oneline --no-decorate origin/master..master)
EOF
has "$err" "local master in $C is 2 commit(s) ahead of origin/master" "2. … the header names the clone and the count"
has "$err" "stranded" "2. … repo-state's stranded line"
has "$err" "land them on origin/master by PR" "2. … the land-by-PR remedy"
has "$err" "ADR 0025" "2. … citing ADR 0025"
has "$err" "git -C $C reset --keep origin/master\` drops the local copies" "2. … naming the reset for once they land (master checked out)"

# 3. stale tracking ref: the fetch refreshes it
fresh
commit "$C" "pushed already" a.md
g -C "$C" push -q origin master
git -C "$C" update-ref refs/remotes/origin/master "$(git -C "$S" rev-parse HEAD)"
ok "$(git -C "$C" rev-list --count origin/master..master)" 1 "3. stale origin/master reads ahead locally (precondition)"
run "$C" ""
ok "$rc|$out|$err" "0|pushed|" "3. stale tracking ref → 0 (the gate fetched)"

# 4. behind → 0; diverged → 3 listing only the ahead commit
fresh
commit "$S" "upstream only" up.md; g -C "$S" push -q origin master
run "$C" ""
ok "$rc|$out|$err" "0|pushed|" "4. behind → 0"
commit "$C" "local only" local.md
run "$C" ""
ok "$rc" 3 "4. diverged → 3"
has "$err" "local only" "4. … lists the ahead commit"
lacks "$err" "upstream only" "4. … and not the behind one"
has "$err" "is 1 commit(s) ahead" "4. … counting only the ahead commit"

# 5. ahead only by THREAD.md → note; diverged too; THREAD.md + another file → 3
fresh
commit "$C" "thread close-out" THREAD.md
run "$C" ""
ok "$rc|$out" "0|pushed" "5. ahead only by THREAD.md → 0"
has "$err" "pushed-base: note: local master in $C is 1 commit(s) ahead of origin/master, touching only THREAD.md: not a blocker" "5. … with the THREAD.md note"
commit "$S" "upstream only" up.md; g -C "$S" push -q origin master
run "$C" ""
ok "$rc|$out" "0|pushed" "5. diverged, ahead only by THREAD.md → 0"
has "$err" "touching only THREAD.md" "5. … with the note"
fresh
commit "$C" "mixed close-out" THREAD.md docs/handoffs/x.md
run "$C" ""
ok "$rc" 3 "5. THREAD.md plus docs/handoffs/x.md → 3"

# 6. queued: that mixed commit rides a close/… branch on origin
g -C "$C" push -q origin master:refs/heads/close/2026-10-01-x-abc
git -C "$C" update-ref -d refs/remotes/origin/close/2026-10-01-x-abc   # the gate's own fetch must bring it back
run "$C" ""
ok "$rc|${out:-<empty>}" "3|<empty>" "6. queued → 3"
has "$err" "queued in close/2026-10-01-x-abc" "6. … repo-state's queued line (the gate fetched origin/close/*)"
has "$err" "wait for" "6. … the wait-for-the-landing-PR remedy"
lacks "$err" "land them on origin/master by PR" "6. … not the land-by-PR remedy"
has "$err" "do not open a second PR" "6. … and no second PR"

# 7. split: one more stranded commit on top
commit "$C" "stranded on top" s.md
run "$C" ""
ok "$rc" 3 "7. split → 3"
has "$err" "1 queued in close/2026-10-01-x-abc, 1 stranded" "7. … repo-state's split line"
has "$err" "wait for" "7. … wait for the queued ones"
has "$err" "land the stranded ones on origin/master by PR" "7. … land the stranded ones"

# 7b. the close/… branch deleted on origin (its PR closed unmerged): the fetch prunes the stale tracking ref
g -C "$S" push -q origin --delete close/2026-10-01-x-abc
ok "$(git -C "$C" rev-parse -q --verify refs/remotes/origin/close/2026-10-01-x-abc >/dev/null && echo stale)" stale "7b. the clone still holds the deleted close ref (precondition)"
run "$C" ""
ok "$rc" 3 "7b. close/… deleted on origin → still 3"
has "$err" "2 commit(s) not on origin/master — stranded" "7b. … the line flips to stranded (the fetch pruned the close ref)"
lacks "$err" "queued in" "7b. … nothing reads as queued"
lacks "$err" "do not open a second PR" "7b. … no wait-for-the-landing-PR remedy"
ok "$(git -C "$C" rev-parse -q --verify refs/remotes/origin/close/2026-10-01-x-abc || echo gone)" gone "7b. … the stale tracking ref is gone"

# 8. HEAD on a feature branch, master ahead → generic remedy
fresh
commit "$C" "adr on master" docs/adr/0018-x.md
g -C "$C" checkout -q -b feat
run "$C" ""
ok "$rc" 3 "8. HEAD on feat, master ahead → 3"
has "$err" "adr on master" "8. … lists master's commit"
has "$err" "git branch -r --contains" "8. … the generic remedy"
has "$err" "close/" "8. … naming close/"
has "$err" "git -C $C branch -f master origin/master\` drops the local copies" "8. … naming the branch -f reset (master not checked out)"

# 9. HEAD on a feature branch, master in sync → 0
fresh
g -C "$C" checkout -q -b feat; commit "$C" "feature work" f.md
run "$C" ""
ok "$rc|$out|$err" "0|pushed|" "9. HEAD on feat, master in sync → 0"

# 10. no local default branch → 0
fresh
g -C "$C" checkout -q -b other; g -C "$C" branch -q -D master
run "$C" ""
ok "$rc|$out|$err" "0|pushed|" "10. no local master → 0"

# 11. an empty commit ahead → 3 (conservative)
fresh
g -C "$C" commit -q --allow-empty -m "empty ahead"
run "$C" ""
ok "$rc" 3 "11. empty-diff ahead → 3"

# 12. origin/HEAD unset → generic remedy, no repo-state line
fresh
commit "$C" "adr" docs/adr/0018-x.md
git -C "$C" remote set-head origin -d
run "$C" ""
ok "$rc" 3 "12. origin/HEAD unset, ahead → 3"
has "$err" "git branch -r --contains" "12. … the generic remedy"
lacks "$err" "default branch unresolved" "12. … repo-state's unresolved line is not echoed"

# 13. origin/HEAD stale (names an existing origin/old) or dangling → generic remedy
fresh
g -C "$S" push -q origin master:old; g -C "$C" fetch -q origin
git -C "$C" remote set-head origin old
commit "$C" "adr" docs/adr/0018-x.md
run "$C" ""
ok "$rc" 3 "13. origin/HEAD stale (old), ahead → 3"
has "$err" "git branch -r --contains" "13. … the generic remedy"
lacks "$err" "unmerged to old" "13. … repo-state's line for old is not echoed"
fresh
git -C "$C" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/gone
commit "$C" "adr" docs/adr/0018-x.md
run "$C" ""
ok "$rc" 3 "13. origin/HEAD dangling (gone), ahead → 3"
has "$err" "git branch -r --contains" "13. … the generic remedy"

# 13b. landed by a separate commit with identical content (a one-commit squash): a note naming the reset
fresh
commit "$C" "add adr 0031" docs/adr/0031-x.md
mkdir -p "$S/docs/adr"; cp "$C/docs/adr/0031-x.md" "$S/docs/adr/0031-x.md"
g -C "$S" add -A; g -C "$S" commit -q -m "add adr 0031 (#99)"; g -C "$S" push -q origin master
run "$C" ""
ok "$(git -C "$C" rev-list --count origin/master..master)" 1 "13b. local master still ahead by ancestry (precondition)"
ok "$rc|$out" "0|pushed" "13b. landed by squash (cherry -) → 0"
has "$err" "pushed-base: note: local master in $C is 1 commit(s) ahead of origin/master, but each is already on origin/master by content" "13b. … a note, not a block"
has "$err" "git -C $C reset --keep origin/master" "13b. … naming reset --keep (master checked out)"
lacks "$err" "stranded" "13b. … no stranded line"

# 13c. two local commits landed as one squash commit (cherry +, but no touched file differs); HEAD on feat
fresh
commit "$C" "adr part 1" docs/adr/0031-x.md
commit "$C" "adr part 2" docs/adr/0031-x.md notes.md
mkdir -p "$S/docs/adr"; cp "$C/docs/adr/0031-x.md" "$S/docs/adr/0031-x.md"; cp "$C/notes.md" "$S/notes.md"
g -C "$S" add -A; g -C "$S" commit -q -m "adr 0031 (#100)"; g -C "$S" push -q origin master
commit "$S" "later upstream work" up.md; g -C "$S" push -q origin master
g -C "$C" checkout -q -b feat
run "$C" ""
ok "$(git -C "$C" fetch -q origin; git -C "$C" cherry origin/master master | grep -c '^+')" 2 "13c. git cherry still marks both + (precondition)"
ok "$rc|$out" "0|pushed" "13c. multi-commit squash → 0"
has "$err" "local master in $C is 2 commit(s) ahead of origin/master, but their content is already on origin/master" "13c. … a note"
has "$err" "git -C $C branch -f master origin/master" "13c. … naming branch -f (master not checked out)"

# 13d. one landed by squash, one not → 3; landed content plus a THREAD.md-only change → a note
g -C "$C" checkout -q master
commit "$C" "stranded adr" docs/adr/0032-z.md
run "$C" ""
ok "$rc" 3 "13d. squash-landed plus a stranded ADR → 3"
has "$err" "3 commit(s) ahead" "13d. … the header counts every ahead commit"
g -C "$C" reset -q --hard HEAD~1
commit "$C" "thread close-out" THREAD.md
run "$C" ""
ok "$rc|$out" "0|pushed" "13d. squash-landed plus a THREAD.md-only commit → 0"
has "$err" "beyond THREAD.md their content is already on origin/master" "13d. … the mixed note"
lacks "$err" "reset --keep" "13d. … with no reset hint (it would drop the THREAD.md commit)"

# 13e. landed, then changed again upstream: the touched file differs now → still 3 (conservative)
fresh
commit "$C" "adr part 1" docs/adr/0031-x.md
commit "$C" "adr part 2" docs/adr/0031-x.md
mkdir -p "$S/docs/adr"; cp "$C/docs/adr/0031-x.md" "$S/docs/adr/0031-x.md"
g -C "$S" add -A; g -C "$S" commit -q -m "adr 0031 (#101)"; commit "$S" "amend adr upstream" docs/adr/0031-x.md
g -C "$S" push -q origin master
run "$C" ""
ok "$rc" 3 "13e. squash-landed then edited upstream → 3 (content differs, conservative)"

# ======== the clone set ==================================================================================
# 14. rollout clone in sync, primary (same origin) ahead with an ADR, given via --also
fresh; P="$tmp/p$k"; mkclone "$O" "$P"
commit "$P" "primary adr" docs/adr/0018-x.md
run "$C" "$P"
ok "$rc|${out:-<empty>}" "3|<empty>" "14. primary ahead via --also → 3"
has "$err" "local master in $P is 1 commit(s) ahead" "14. … the header names the primary"
lacks "$err" "in $C is" "14. … not the in-sync rollout clone"
has "$err" "primary adr" "14. … listing the primary's commit"
has "$err" "stranded" "14. … the remedy from the primary's repo-state"

# 15. the same, the primary found only through the registry
write_reg "$P"
run "$C" ""
ok "$rc" 3 "15. primary found via the registry, --also \"\" → 3"
has "$err" "local master in $P is 1 commit(s) ahead" "15. … naming the primary"
# 15b. the same while a rollout runs: the reset remedy waits for it (ADR 0031)
mkdir -p "$home/repos/obsidian/Work/Tasks"
printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n---\n' > "$home/repos/obsidian/Work/Tasks/demo-rollout-2026-10-03.md"
run "$C" ""
ok "$rc" 3 "15b. still blocked → 3"
has "$err" "drops the local copies once no rollout runs on this primary checkout (ADR 0031; now: demo-rollout-2026-10-03)" "15b. … the reset remedy waits for the running rollout"
printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\npaused: 2026-10-03T10:00+10:00\n---\n' > "$home/repos/obsidian/Work/Tasks/demo-rollout-2026-10-03.md"
run "$C" ""
lacks "$err" "once no rollout runs" "15b. … and not once it is hard-paused"
rm -rf "$home/repos" "$reg"

# 16. the live shape: rollout clone in sync, primary diverged by a THREAD.md-only commit, registry-found
fresh; P="$tmp/p$k"; mkclone "$O" "$P"
commit "$P" "thread close-out" THREAD.md
commit "$S" "upstream merge" up.md; g -C "$S" push -q origin master; g -C "$C" pull -q
mkdir -p "$P/docs/handoffs"; echo wip > "$P/docs/handoffs/h.md"
write_reg "$P"
run "$C" ""
ok "$rc|$out" "0|pushed" "16. live shape → 0"
has "$err" "note: local master in $P is 1 commit(s) ahead of origin/master, touching only THREAD.md" "16. … a note naming the primary"
lacks "$err" "h.md" "16. … the primary's uncommitted, uncited handoff doc stays silent"
lacks "$err" "WARN" "16. … no WARN"
rm -f "$reg"

# 17. other-origin and non-clone candidates
fresh; O1=$O; C1=$C
fresh; Q="$tmp/q$k"; mkclone "$O" "$Q" other
commit "$Q" "other repo adr" docs/adr/0018-x.md
write_reg "$Q"
run "$C1" ""
ok "$rc|$out|$err" "0|pushed|" "17. a registry directory source with another origin, ahead → skipped silently"
rm -f "$reg"
for a in "$tmp/plain" "$tmp/nope" "$Q"; do
  run "$C1" "$a"
  ok "$rc|$out" "0|pushed" "17. --also $(basename "$a") → 0"
  has "$err" "pushed-base: note: $a is not a clone of o/r: skipped" "17. … noted as not a clone of o/r"
done

# 18. de-duplication: repoPath again, a symlink to it, and the primary via --also AND the registry. C1's master
# carries a THREAD.md-only commit, so each member prints one note: a duplicate member would print two.
commit "$C1" "c1 thread note" THREAD.md
ln -s "$C1" "$tmp/c1link"
run "$C1" "$C1"; ok "$rc|$out" "0|pushed" "18. --also repoPath itself → 0"
ok "$(count "$err" "local master in $C1 is 1 commit(s) ahead of origin/master, touching only THREAD.md")" 1 "18. … deduplicated: its note printed once"
run "$C1" "$tmp/c1link"; ok "$rc|$out" "0|pushed" "18. --also a symlink to repoPath → 0"
ok "$(count "$err" "local master in $C1 is 1 commit(s) ahead of origin/master, touching only THREAD.md")" 1 "18. … deduplicated: its note printed once"
P="$tmp/pdedup"; mkclone "$O1" "$P"; commit "$P" "thread note" THREAD.md
ln -s "$P" "$tmp/pdeduplink"; write_reg "$P"
run "$C1" "$tmp/pdeduplink"
ok "$rc" 0 "18. primary via --also (symlink) and the registry → 0"
ok "$(count "$err" "local master in $P is 1 commit(s) ahead of origin/master, touching only THREAD.md")" 1 "18. … its note printed once"
rm -f "$reg"

# 19. the primary's fetch fails while repoPath's works → 2 naming the primary
git -C "$P" config --unset "url.$O1.insteadOf"
git -C "$P" config "url.$tmp/missing.git.insteadOf" "https://github.com/o/r.git"
run "$C1" "$P"
ok "$rc|${out:-<empty>}" "2|<empty>" "19. the primary's fetch fails → 2"
has "$err" "pushed-base: fetch failed in $P" "19. … naming the primary"

# 20. a malformed registry: the reader's warning, and the run continues on the remaining members
P="$tmp/pmalformed"; mkclone "$O1" "$P"; commit "$P" "primary adr" docs/adr/0018-x.md
echo '{ not json' > "$reg"
run "$C1" "$P"
ok "$rc" 3 "20. malformed registry, primary via --also ahead → 3"
has "$err" "WARN" "20. … the registry warning passes through"
has "$err" "in $P is 1 commit(s) ahead" "20. … the --also member is still checked"
rm -f "$reg"

# ======== warn: cited paths ==============================================================================
# 21. an uncommitted cited ADR, by name and by glob; staged-only too
fresh
echo dirty >> "$C/docs/adr/0026-y.md"
run "$C" "" docs/adr/0026-y.md
ok "$rc|$out" "0|pushed" "21. a dirty cited ADR → 0"
has "$err" "pushed-base: WARN: docs/adr/0026-y.md: uncommitted change: agents see origin/master's copy, not this one" "21. … WARN naming it"
run "$C" "" 'docs/adr/0026-*'
has "$err" "WARN: docs/adr/0026-y.md: uncommitted change" "21. … a glob warns too"
g -C "$C" add docs/adr/0026-y.md; git -C "$C" show HEAD:docs/adr/0026-y.md > "$C/docs/adr/0026-y.md"
ok "$(git -C "$C" diff --name-only HEAD)" "" "21. staged-only: the work tree matches HEAD (precondition)"
run "$C" "" docs/adr/0026-y.md
has "$err" "WARN: docs/adr/0026-y.md: uncommitted change" "21. … a staged-only change warns"

# 22. untracked cited CONTEXT.md → WARN; a gitignored one → silent
fresh
echo ctx > "$C/CONTEXT.md"; echo ig > "$C/ignored.md"
run "$C" "" CONTEXT.md
has "$err" "WARN: CONTEXT.md: untracked" "22. untracked cited CONTEXT.md → WARN"
run "$C" "" ignored.md
ok "$rc|$err" "0|" "22. a gitignored cited file → silent"

# 23. an uncommitted THREAD.md, cited or not → silent
fresh
echo more >> "$C/THREAD.md"
run "$C" "" THREAD.md; ok "$rc|$err" "0|" "23. dirty THREAD.md cited → silent"
run "$C" "" ./THREAD.md; ok "$rc|$err" "0|" "23. … cited as ./THREAD.md → silent"
run "$C" ""; ok "$rc|$err" "0|" "23. … not cited → silent"

# 24. a dirty file not cited → silent; only THREAD.md cited while others are dirty → no WARN
echo dirty >> "$C/docs/adr/0026-y.md"
run "$C" "" README; ok "$rc|$err" "0|" "24. dirty ADR not cited → silent"
run "$C" "" THREAD.md; ok "$rc|$err" "0|" "24. only THREAD.md cited → no WARN"

# 25. a cited path that does not exist → silent
run "$C" "" docs/adr/9999-none.md; ok "$rc|$err" "0|" "25. a nonexistent cited path → silent"

# 26. behind-checkout noise: the cited ADR changed upstream only → silent
fresh
commit "$S" "upstream adr edit" docs/adr/0026-y.md; g -C "$S" push -q origin master
run "$C" "" docs/adr/0026-y.md
ok "$rc|$out|$err" "0|pushed|" "26. checkout behind, cited ADR changed upstream → silent"

# 27. committed on the checked-out feature branch → WARN
fresh
g -C "$C" checkout -q -b feat; commit "$C" "feature adr edit" docs/adr/0026-y.md
run "$C" "" docs/adr/0026-y.md
has "$err" "WARN: docs/adr/0026-y.md: committed on the checked-out branch feat but not on origin/master" "27. committed on the checked-out branch → WARN"

# 27b. the feature branch's PR squash-merged upstream, the branch still checked out → silent
fresh
g -C "$C" checkout -q -b feat; commit "$C" "add adr 0031" docs/adr/0031-x.md; commit "$C" "tweak adr 0026" docs/adr/0026-y.md
cp "$C/docs/adr/0031-x.md" "$S/docs/adr/0031-x.md"; cp "$C/docs/adr/0026-y.md" "$S/docs/adr/0026-y.md"
g -C "$S" add -A; g -C "$S" commit -q -m "adr 0031 (#102)"; g -C "$S" push -q origin master
run "$C" "" docs/adr/0031-x.md docs/adr/0026-y.md
ok "$(git -C "$C" diff --name-only origin/master...HEAD -- docs/adr | wc -l | tr -d ' ')" 2 "27b. the three-dot diff still lists both (precondition)"
ok "$rc|$out|$err" "0|pushed|" "27b. a squash-merged branch still checked out → silent"
commit "$C" "post-merge edit" docs/adr/0031-x.md
run "$C" "" docs/adr/0031-x.md docs/adr/0026-y.md
has "$err" "WARN: docs/adr/0031-x.md: committed on the checked-out branch feat but not on origin/master" "27b. … a later edit on the branch warns"
lacks "$err" "0026-y.md" "27b. … the landed file stays silent"

# 28. committed on a branch that is not checked out → silent (the documented limit)
fresh
g -C "$C" checkout -q -b side; commit "$C" "side adr edit" docs/adr/0026-y.md; g -C "$C" checkout -q master
run "$C" "" docs/adr/0026-y.md
ok "$rc|$err" "0|" "28. committed on a non-checked-out branch → silent (out of scope)"

# 29. batching: an outside path, a vault path and a dirty ADR together
fresh
mkdir -p "$home/vault"; echo n > "$home/vault/Note.md"
echo dirty >> "$C/docs/adr/0026-y.md"
run "$C" "" /etc/hosts "~/vault/Note.md" docs/adr/0026-y.md
ok "$rc|$out" "0|pushed" "29. outside + vault + dirty ADR → 0"
has "$err" "WARN: docs/adr/0026-y.md: uncommitted change" "29. … the ADR still warns"
ok "$(count "$err" "is outside every known clone of o/r: not compared")" 2 "29. … two outside notes"
lacks "$err" "could not compare" "29. … no could-not-compare"

# 30. a relative path that escapes the clone → noted
run "$C" "" ../escape.md
has "$err" "escapes $C: not compared" "30. ../escape.md → escapes note"

# 31-32. paths in the primary: relative (compared in every member) and absolute
fresh; P="$tmp/p$k"; mkclone "$O" "$P"
echo dirty >> "$P/docs/adr/0026-y.md"
run "$C" "$P" docs/adr/0026-y.md
ok "$rc|$out" "0|pushed" "31. rollout clone clean, primary dirty → 0"
has "$err" "WARN: docs/adr/0026-y.md in $P: uncommitted change" "31. … the relative path warns in the primary"
run "$C" "$P" "$P/docs/adr/0026-y.md"
has "$err" "WARN: docs/adr/0026-y.md in $P: uncommitted change" "32. an absolute path into the primary → WARN naming it"
run "$C" "$P" "$Q/README"
has "$err" "$Q/README is outside every known clone of o/r: not compared" "32. an absolute path into another-origin clone → note"

# 33. a cited path with a space, and one with a leading -
fresh
echo s > "$C/docs/my file.md"; echo d > "$C/-dash.md"
run "$C" "" "docs/my file.md" -dash.md
has "$err" "WARN: docs/my file.md: untracked" "33. a path with a space → WARN naming it"
has "$err" "WARN: -dash.md: untracked" "33. a leading - → WARN (passed after --)"

# ======== failures and plumbing ==========================================================================
fresh
pb "$C" nobranch; ok "$rc|${out:-<empty>}" "2|<empty>" "34. a branch origin lacks → 2"
has "$err" "fetch failed in $C" "34. … fetch failed"
pb; ok "$rc" 2 "34. no args → 2"
pb "" master; ok "$rc" 2 "34. empty repoPath → 2"
pb "$C" ""; ok "$rc" 2 "34. empty branch → 2"
pb "$tmp/plain" master; ok "$rc" 2 "34. not a work tree → 2"
pb --also "$C"; ok "$rc" 2 "34. --also only → 2"
pb "$C" master; ok "$rc|$out" "0|pushed" "34. a direct call in sync → 0, pushed"

# 35. origin unreachable through the snippet → 2 (default-branch.sh cannot answer)
git -C "$C" config --unset "url.$O.insteadOf"; git -C "$C" config "url.$tmp/missing.git.insteadOf" "https://github.com/o/r.git"
run "$C" ""; ok "$rc|${out:-<empty>}" "2|<empty>" "35. origin unreachable → 2"

# 36. a wrong CLAUDE_PLUGIN_ROOT → 2 with not found
fresh
PLUGROOT="$tmp/nowhere" run "$C" ""
ok "$rc" 2 "36. wrong CLAUDE_PLUGIN_ROOT → 2"
has "$err" "not found" "36. … not found"

# 37. ~/ repoPath and ~/ --also
mkclone "$O" "$home/rc"; mkclone "$O" "$home/rp"; commit "$home/rp" "primary adr" docs/adr/0018-x.md
run "~/rc" "~/rp"
ok "$rc" 3 "37. ~/ repoPath and ~/ --also resolve → 3"
has "$err" "in $home/rp is 1 commit(s) ahead" "37. … naming the expanded primary"

# 38. an inherited GIT_DIR decoy: answers for repoPath, the decoy's refs untouched
g init -q "$tmp/decoy"; commit "$tmp/decoy" "decoy" d.md
before=$(git -C "$tmp/decoy" for-each-ref)
commit "$C" "adr" docs/adr/0018-x.md
XENV="GIT_DIR=$tmp/decoy/.git GIT_WORK_TREE=$tmp/decoy" run "$C" ""
ok "$rc" 3 "38. GIT_DIR decoy → answers for repoPath (3)"
has "$err" "in $C is 1 commit(s) ahead" "38. … naming repoPath"
ok "$(git -C "$tmp/decoy" for-each-ref)" "$before" "38. … the decoy's refs are unchanged"

# ======== wiring ========================================================================================
eff=$(tr '\n' ' ' < "$ef")
pbpara=$(awk '/^\*\*Pushed base\.\*\*/{on=1} /^\*\*Unfinished rollout\.\*\*/{on=0} on' "$ef" | tr '\n' ' ')
has "$eff" "Five blockers" "execution-fit names five blockers"
has "$pbpara" "**Pushed base.**" "execution-fit has the Pushed base blocker"
for w in "ADR 0025" "THREAD.md" "known_marketplaces" "\`Local:\`" "never per merge" "execute § 2.7" "origin/close/*" "queued" "stranded"; do
  has "$pbpara" "$w" "the Pushed base blocker names $w"
done
lr=$(grep -n '^\*\*Landing register\.\*\*' "$ef" | cut -d: -f1); pbl=$(grep -n '^\*\*Pushed base\.\*\*' "$ef" | cut -d: -f1); epl=$(grep -n '^\*\*Engine path\.\*\*' "$ef" | cut -d: -f1)
ok "$([ -n "$lr" ] && [ -n "$pbl" ] && [ -n "$epl" ] && [ "$lr" -lt "$pbl" ] && [ "$pbl" -lt "$epl" ] && echo y)" y "Pushed base sits between Landing register and Engine path"
has "$(grep -n 'pushed-base-check' "$ef")" "tests/pushed-base.test.sh" "the snippet line names this test"

sch=skills/schedule/SKILL.md
s0=$(awk '/^### 0\./{on=1} /^### 1\./{on=0} on' "$sch" | tr '\n' ' ')
has "$s0" "pushed-base check" "schedule § 0 runs the pushed-base check"
after_reg="${s0#*landing register check}"
has "$after_reg" "pushed-base check" "schedule § 0: the pushed-base check comes after the landing register check"
has "${after_reg#*pushed-base check}" "stop before step 1" "schedule § 0: stop before step 1 follows the pushed-base check"
s2=$(awk '/^### 2\. /{on=1} /^### 2\.5\./{on=0} on' "$sch" | tr '\n' ' ')
has "$s2" "pushed-base check" "schedule step 2 re-runs the pushed-base check"
has "$s2" "cited paths" "schedule step 2 passes cited paths"
s8=$(awk '/^### 8\./{on=1} /^## Execution lives/{on=0} on' "$sch")
has "$s8" "local copies agents won't see" "schedule step 8 lists the local copies agents won't see"
has "$(grep -n '^\*\*Obsidian only\*\*' "$sch")" "origin/close/*" "schedule Scope names the fetch"
has "$(grep "^- Don't run \`git\` operations" "$sch")" "git fetch" "schedule Don'ts names the fetch"

for f in skills/schedule/SKILL.md skills/execute/SKILL.md skills/repair/SKILL.md; do
  ok "$(grep -c '# thread:pushed-base-check' "$f")" 0 "$f does not copy the pushed-base snippet"
done

ex=skills/execute/SKILL.md
ln_() { grep -nF -- "$1" "$ex" | head -1 | cut -d: -f1; }
a=$(ln_ '### 2.6. '); b=$(ln_ '### 2.7. Pushed-base gate'); c=$(ln_ '### 3. ')
ok "$([ -n "$a" ] && [ -n "$b" ] && [ -n "$c" ] && [ "$a" -lt "$b" ] && [ "$b" -lt "$c" ] && echo y)" y "execute § 2.7 sits between § 2.6 and § 3"
s27=$(awk '/^### 2\.7\. /{on=1} /^### 3\. /{on=0} on' "$ex" | tr '\n' ' ')
for w in "execution-fit.md\` § Dispatch blockers" "entered at § 1" "ROLLOUT-HEARTBEAT" "resumeFromRunId" "/thread:repair" \
         "before §4.5 *Reinstate*'s \`clear-pause\`" "**Pausing is exempt**" "**Any other non-zero exit**" \
         'reason="local default branch is ahead of origin"' 'reason="pushed-base check failed"' "Local:" "never per merge"; do
  has "$s27" "$w" "execute § 2.7 names $w"
done
s45raw=$(awk '/^### 4\.5\./{on=1} /^### 5\./{on=0} on' "$ex")
rein=$(printf '%s\n' "$s45raw" | awk '/^\*\*Reinstate \(/{on=1} on' | tr '\n' ' ')
has "${rein%%clear-pause*}" "§ 2.7" "execute § 4.5 Reinstate runs § 2.7 before clear-pause"
preins=$(grep '^\*\*Reinstate\.\*\*' "$ex")
has "${preins%%"clears it"*}" "§ 2.7" "execute Pausing: Reinstate runs § 2.7 before clearing the stamp"
cold=$(printf '%s\n' "$s45raw" | awk '/^\*\*Cold resume\.\*\*/{on=1} on && /^$/{on=0} on' | tr '\n' ' ')
has "$cold" "§ 2.7" "execute Cold resume names § 2.7"
has "$cold" "entered at § 1" "execute Cold resume gates § 2.7 on entry at § 1"
lrc=$(grep '^\*\*Landing-register re-check\.\*\*' "$ex")
lacks "$lrc" "2.7" "execute § 4.5 Landing-register re-check does not run § 2.7 at each merge"
rr=$(grep '^"Re-run § 2.5"' "$ex")
ok "$([ -n "$rr" ] && echo y)" y "execute keeps the Re-run § 2.5 definition"
lacks "$rr" "2.7" "the Re-run § 2.5 definition does not include § 2.7"
hb=$(grep '^> ROLLOUT-HEARTBEAT' "$ex")
has "$hb" "§4.5" "the heartbeat still re-enters through §4.5"
has "$hb" "skips § 2.7" "the heartbeat says its re-entry skips § 2.7"
pz=$(awk '/^## Pausing \+ reinstating/{on=1} /^\*\*Soft pause/{on=0} on' "$ex" | tr '\n' ' ')
has "$pz" "§ 2.7" "execute Pausing: neither pause runs § 2.7"
s7=$(awk '/^### 7\./{on=1} /^### 8\./{on=0} on' "$ex")
for r in 'reason="local default branch is ahead of origin"' 'reason="pushed-base check failed"'; do
  has "$s7" "$r" "execute § 7 names $r"
done
ok "$(printf '%s\n%s\n' "$s27" "$s7" | python3 -c '
import re, sys
vals = re.findall(r"reason=\"([^`]*?)\"", sys.stdin.read())
print("ok" if vals and all("\"" not in v for v in vals) else "bad: %r" % vals)')" ok "every § 2.7 / § 7 reason value is quote-free"
ok "$(python3 - "$root/hooks/rollout-stop-driver.py" <<'PY'
import importlib.util, sys
spec = importlib.util.spec_from_file_location("rsd", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
ok = True
for r in ("local default branch is ahead of origin", "pushed-base check failed"):
    hit = m.STATUS_RE.search('ROLLOUT-STATUS: proj-rollout merged=0/3 running=0 state=halted reason="%s"' % r)
    ok = ok and bool(hit) and hit.group("state") == "halted"
print("ok" if ok else "no match")
PY
)" ok "the § 2.7 halt lines match the Stop hook's STATUS_RE"

rp=skills/repair/SKILL.md
r4=$(awk '/^### 4\./{on=1} /^### 5\./{on=0} on' "$rp" | tr '\n' ' ')
r6=$(awk '/^### 6\./{on=1} /^## Don/{on=0} on' "$rp" | tr '\n' ' ')
for s in 4 6; do
  eval "t=\$r$s"
  has "$t" "§ 2.7" "repair § $s names execute § 2.7"
  has "$t" "does not run" "repair § $s says the hand-off does not run it"
done

echo; [ "$fail" -eq 0 ] && echo "pushed-base: ALL PASS" || echo "pushed-base: SOME FAILED"
exit "$fail"
