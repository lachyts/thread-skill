#!/usr/bin/env bash
# p33-4 (ADR 0064), the gated live rig: two projects' parallel rollouts on one real GitHub repo, each in its own rollout
# clone, one task each landing through the origin lane, the second re-verified on the first's squash. Script-driven, as
# tests/parallel-rollouts-one-repo.test.sh's S1 is, against a private scratch repo it creates and deletes.
#
#   bash tests/e2e/parallel-rollouts-one-repo.live.sh <owner/name>     e.g. lachyts/zz-thread-p33-4-e2e
#
# GATED (ADR 0008): it creates a private GitHub repo, opens and merges two PRs in it, then deletes it. Run it only under
# an approved `irreversible:` gate. It needs gh with the `repo` and `delete_repo` scopes, and the network.
#
# It refuses a repo that already exists. HOME, THREAD_EVENTS_DIR, THREAD_NOTE_LOCK_DIR and THREAD_VERIFY_SLOTS_DIR are a
# temp dir, so nothing reads or writes ~/repos/obsidian or this Mac's rollout state; GH_CONFIG_DIR stays the real gh
# config and GH_TOKEN is gh's own token, read before HOME moves (a keyring token is out of a temp HOME's reach), and git
# authenticates through a temp GIT_CONFIG_GLOBAL whose credential helper is `gh auth git-credential`.
# It runs no /thread:schedule or /thread:execute and answers no question of Lachy's. It writes its record to
# docs/e2e/<today>-p33-4.md (both PR URLs, both squash SHAs, the ORIGIN LANE line and B's verify line). A trap deletes
# the repo and the temp dirs; a repo a failed delete leaves behind is named on stderr and in the record.
set -uo pipefail
cd "$(dirname "$0")/../.."
root=$(pwd -P)
SLUG="${1:-}"
case "$SLUG" in ?*/?*) ;; *) echo "usage: $0 <owner/name>" >&2; exit 2 ;; esac
command -v gh >/dev/null || { echo "live rig: gh not found" >&2; exit 2; }
unset $(git rev-parse --local-env-vars)
REAL_GH_CONFIG="${GH_CONFIG_DIR:-$HOME/.config/gh}"
# gh's token, read before HOME moves: a keyring-held token is not reachable from the temp HOME (GH_TOKEN wins over it).
GH_TOKEN="${GH_TOKEN:-$(gh auth token 2>/dev/null)}"
[ -n "$GH_TOKEN" ] || { echo "live rig: gh has no token (gh auth login)" >&2; exit 2; }
export GH_TOKEN
gh repo view "$SLUG" >/dev/null 2>&1 && { echo "live rig: $SLUG already exists: refusing to touch it" >&2; exit 2; }

tmp=$(cd "$(mktemp -d)" && pwd -P)
made=0
cleanup() {
  if [ "$made" = 1 ]; then
    if GH_CONFIG_DIR="$REAL_GH_CONFIG" gh repo delete "$SLUG" --yes >/dev/null 2>&1; then echo "live rig: deleted $SLUG"
    else echo "live rig: WARN: could not delete $SLUG: delete it by hand (gh repo delete $SLUG --yes)" >&2
      [ -n "${RECORD:-}" ] && [ -f "$RECORD" ] && printf '\n**Left behind:** %s (the delete failed).\n' "$SLUG" >> "$RECORD"; fi
  fi
  chmod -R u+w "$tmp" 2>/dev/null; rm -rf "$tmp"
}
trap cleanup EXIT
export HOME="$tmp/home" GH_CONFIG_DIR="$REAL_GH_CONFIG"; mkdir -p "$HOME"
printf '[init]\n\tdefaultBranch = main\n[user]\n\tname = thread-e2e\n\temail = thread-e2e@example.invalid\n[credential "https://github.com"]\n\thelper =\n\thelper = !gh auth git-credential\n' > "$tmp/gitconfig"
export GIT_CONFIG_GLOBAL="$tmp/gitconfig" GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0
export THREAD_EVENTS_DIR="$tmp/events" THREAD_NOTE_LOCK_DIR="$tmp/note-locks" THREAD_VERIFY_SLOTS_DIR="$tmp/verify-slots"
export TZ=UTC PYTHONDONTWRITEBYTECODE=1 THREAD_HEAT_LEVEL=0 THREAD_MACHINE_TIMES='{}'
gh auth status >/dev/null 2>&1 || { echo "live rig: gh is not authenticated under GH_CONFIG_DIR=$GH_CONFIG_DIR" >&2; exit 2; }
SC="$root/skills/execute/scripts/self-rollout-check.sh"
UR="$root/skills/_shared/scripts/unfinished-rollout.py"
RR="$root/skills/execute/scripts/reconcile-rollout.py"
LI="$root/skills/execute/scripts/lead-integrate.py"
MT="$root/skills/execute/scripts/merge-task.sh"
URL="https://github.com/$SLUG.git"
V="$tmp/vault/Work/Tasks"; mkdir -p "$V"
T="$tmp/repos/$(basename "$SLUG")"; D="$T-rollout"; P="$T-proj-b-rollout"
fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
die() { echo "live rig: FAIL - $*" >&2; exit 1; }
j() { printf '%s' "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); v=eval(sys.argv[1]); print(v if isinstance(v, str) else json.dumps(v))' "$2"; }

# 1. the scratch repo: a Makefile `test:` target on main
gh repo create "$SLUG" --private --description "thread-skill p33-4 live rig (scratch; deleted at its end)" >/dev/null || die "gh repo create $SLUG"
made=1
mkdir -p "$tmp/seed" && git -C "$tmp/seed" init -q
printf 'test:\n\ttrue\n' > "$tmp/seed/Makefile"; printf 'base\n' > "$tmp/seed/base.txt"
git -C "$tmp/seed" add -A && git -C "$tmp/seed" commit -q -m base && git -C "$tmp/seed" remote add origin "$URL"
git -C "$tmp/seed" push -q origin main || die "push main"
B0=$(git -C "$tmp/seed" rev-parse HEAD)
mkdir -p "$tmp/repos" && git clone -q "$URL" "$T" || die "clone $URL"

# 2. the clones: Proj A takes the default, Proj B its own
ok "$(python3 "$UR" clone --repo "$T" --project "Proj A" --tasks-dir "$V" 2>/dev/null)" default "clone: Proj A → default"
ok "$(bash "$SC" --ensure "$T" 2>/dev/null)" "$D" "--ensure makes D"
mkro() { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 2\nprojects:\n  - "[[%s]]"\n---\n\n## Notes\n\nProject root: `%s`\n\n## Queue\n\n- [[%s]]\n' "$2" "$3" "$4" > "$V/$1.md"; }
mkt() { printf -- '---\ntags: [task]\nstatus: review\nscope: cross-cutting\nprojects:\n  - "[[%s]]"\nrollout: "[[%s]]"\npr: %s\nready: 2026-11-02T00:00+00:00\n---\n\n## Notes\n\n%s\n' "$3" "$2" "$4" "$1" > "$V/$1.md"; }
mkro proj-a-rollout-e2e "Proj A" "$D" proj-a-t1
ok "$(python3 "$UR" clone --repo "$T" --project "Proj B" --tasks-dir "$V" 2>/dev/null)" "project proj-b" "clone: Proj B, A in D → project proj-b"
ok "$(bash "$SC" --ensure "$T" proj-b 2>/dev/null)" "$P" "--ensure … proj-b makes P"
ok "$(python3 "$UR" check --repo "$P" --project "Proj B" --tasks-dir "$V" 2>/dev/null)" none "check --repo P for Proj B → none"
mkro proj-b-rollout-e2e "Proj B" "$P" proj-b-t1

# 3. one task each: a real branch, a real PR, its tree in its rollout's clone
task() {  # task <slug> <root> <file>
  local br="audit-fix/${1#*-}"
  git -C "$tmp/seed" fetch -q origin && git -C "$tmp/seed" checkout -q -B "$br" origin/main
  printf '%s\n' "$1" > "$tmp/seed/$3"; git -C "$tmp/seed" add -A && git -C "$tmp/seed" commit -q -m "task $1"
  git -C "$tmp/seed" push -q origin "$br" || die "push $br"; git -C "$tmp/seed" checkout -q main
  git -C "$2" fetch -q origin && git -C "$2" worktree add -q "$2/.claude/worktrees/$1" -b "$br" "origin/$br" >/dev/null 2>&1 || die "worktree $1"
  gh pr create -R "$SLUG" --head "$br" --base main --title "task $1" --body "p33-4 live rig" 2>/dev/null | tail -1
}
PRA=$(task proj-a-t1 "$D" a1.txt); PRB=$(task proj-b-t1 "$P" b1.txt)
case "$PRA$PRB" in *pull/*pull/*) ;; *) die "gh pr create: [$PRA] [$PRB]" ;; esac
mkt proj-a-t1 proj-a-rollout-e2e "Proj A" "$PRA"; mkt proj-b-t1 proj-b-rollout-e2e "Proj B" "$PRB"
ok "$(python3 "$UR" branches --repo "$P" --tasks proj-b-t1 --tasks-dir "$V" 2>/dev/null)" none "branches → none"
mkdir -p "$HOME/.config/thread/leases"
for r in proj-a-rollout-e2e proj-b-rollout-e2e; do
  printf '{"rollout": "%s", "written_at": "%s", "by": "next"}\n' "$r" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$HOME/.config/thread/leases/$r.json"
done

# 4. the origin lane: A takes it, B waits
python3 "$RR" mark-integrating --tasks proj-a-t1 --tasks-dir "$V" >/dev/null 2>&1; ok "$?" 0 "A's mark-integrating → 0"
python3 "$RR" mark-integrating --tasks proj-b-t1 --tasks-dir "$V" >/dev/null 2>"$tmp/lane.err"; ok "$?" 4 "B's mark-integrating → 4"
LANE_LINE=$(grep -m1 '^ORIGIN LANE:' "$tmp/lane.err")
case "$LANE_LINE" in *"[[proj-a-rollout-e2e]]'s [[proj-a-t1]] integrates on"*) ok y y "… the ORIGIN LANE line names A" ;; *) ok "$LANE_LINE" "the holder line" "… the ORIGIN LANE line names A" ;; esac

# 5. A: prepare routes merge (main unmoved), a real merge-task, mark-done
J=$(python3 "$LI" prepare --repo "$D" --slug proj-a-t1 --default main --note "$V/proj-a-t1.md" 2>"$tmp/prep.err") || die "A prepare: $(cat "$tmp/prep.err")"
ok "$(j "$J" 'd["route"]')" merge "A: prepare routes merge"
python3 "$RR" log-integration --tasks proj-a-t1 --tasks-dir "$V" --started "$(python3 "$LI" stamp)" --anchor "$(j "$J" 'd["anchor"]')" \
  --head "$(j "$J" 'd["prHead"]')" --base "$(j "$J" 'd["mainSha"]')" >/dev/null
bash "$MT" "$D" "${PRA##*/}" "$(j "$J" 'd["prHead"]')" "$(j "$J" 'd["mainSha"]')" > "$tmp/mt-a.log" 2>&1; ok "$?" 0 "A: merge-task merges it"
python3 "$RR" mark-done --tasks proj-a-t1 --tasks-dir "$V" >/dev/null 2>&1
git -C "$tmp/seed" fetch -q origin; A1=$(git -C "$tmp/seed" rev-parse origin/main)

# 6. B: its turn; prepare routes verify on A's squash; verify, push, log, prepare (case ii), merge-task, mark-done
python3 "$RR" mark-integrating --tasks proj-b-t1 --tasks-dir "$V" >/dev/null 2>&1; ok "$?" 0 "B's mark-integrating → 0, its turn"
J=$(python3 "$LI" prepare --repo "$P" --slug proj-b-t1 --default main --note "$V/proj-b-t1.md" 2>"$tmp/prep.err") || die "B prepare: $(cat "$tmp/prep.err")"
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["mainSha"]')" "verify|$A1" "B: prepare routes verify, mainSha A's squash"
M=$(j "$J" 'd["mergeCommit"]'); BASE=$(j "$J" 'd["mainSha"]'); ANCHOR=$(j "$J" 'd["anchor"]')
VERIFY_LINE="python3 $LI verify --tree $P/.claude/worktrees/proj-b-t1 --out $P/.claude/integration/proj-b-t1 --timeout 600 --verifier 'make test'"
python3 "$LI" verify --tree "$P/.claude/worktrees/proj-b-t1" --out "$P/.claude/integration/proj-b-t1" --timeout 600 --verifier 'make test' >/dev/null 2>&1
ok "$(cat "$P/.claude/integration/proj-b-t1.rc" 2>/dev/null)" 0 "B: make test green on the merge of A's squash"
python3 "$LI" push --repo "$P" --slug proj-b-t1 --head "$M" >/dev/null 2>&1; ok "$?" 0 "B: push"
python3 "$RR" log-integration --tasks proj-b-t1 --tasks-dir "$V" --started "$(python3 "$LI" stamp)" --anchor "$ANCHOR" --head "$M" --base "$BASE" >/dev/null
J=$(python3 "$LI" prepare --repo "$P" --slug proj-b-t1 --default main --note "$V/proj-b-t1.md" 2>/dev/null)
ok "$(j "$J" 'd["route"]')|$(j "$J" 'd["case"]')" "merge|ii" "B: prepare again routes merge (case ii)"
bash "$MT" "$P" "${PRB##*/}" "$M" "$BASE" > "$tmp/mt-b.log" 2>&1; ok "$?" 0 "B: merge-task merges it"
python3 "$RR" mark-done --tasks proj-b-t1 --tasks-dir "$V" >/dev/null 2>&1
git -C "$tmp/seed" fetch -q origin; B1=$(git -C "$tmp/seed" rev-parse origin/main)
ok "$(git -C "$tmp/seed" rev-list --parents -n 1 "$B1" | cut -d' ' -f2-)" "$A1" "from a fetch: B's squash's only parent is A's squash"
ok "$(git -C "$tmp/seed" rev-list --parents -n 1 "$A1" | cut -d' ' -f2-)" "$B0" "… and A's is the base"

# 7. the record
RECORD="$root/docs/e2e/$(date -u +%Y-%m-%d)-p33-4.md"
{ printf '# p33-4 live rig: two projects'"'"' parallel rollouts share a repo (ADR 0064)\n\n'
  printf 'Date: %s (UTC)\nRig: `tests/e2e/parallel-rollouts-one-repo.live.sh %s` (script-driven; a private scratch repo, deleted at the end)\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$SLUG"
  printf 'Result: %s\n\n' "$([ "$fail" = 0 ] && echo 'ALL PASS' || echo 'FAILED')"
  printf '## Clones\n\n- Proj A: `clone` → `default`, its rollout in `<T>-rollout`\n- Proj B: `clone` → `project proj-b`, its rollout in `<T>-proj-b-rollout` (`--in-place` twin `<T>`)\n\n'
  printf '## The origin lane\n\nB'"'"'s `mark-integrating` while A integrated exited 4:\n\n```\n%s\n```\n\n' "$LANE_LINE"
  printf '## Landings\n\n| | PR | Squash | Parent |\n|---|---|---|---|\n| A (proj-a-t1) | %s | `%s` | `%s` (the base) |\n| B (proj-b-t1) | %s | `%s` | `%s` (A'"'"'s squash) |\n\n' "$PRA" "$A1" "$B0" "$PRB" "$B1" "$A1"
  printf '## B'"'"'s verify on A'"'"'s squash\n\n```\n%s\n```\n\nrc `%s`; `prepare` routed `verify` with `mainSha` %s (A'"'"'s squash), then `merge` (case ii) after the push.\n' \
    "$(v=${VERIFY_LINE//$tmp/<tmp>}; printf '%s' "${v//$root/<plugin root>}")" "$(cat "$P/.claude/integration/proj-b-t1.rc" 2>/dev/null)" "$A1"
} > "$RECORD"
echo "live rig: record written to $RECORD"
echo; [ "$fail" -eq 0 ] && echo "parallel-rollouts-one-repo.live: ALL PASS" || echo "parallel-rollouts-one-repo.live: SOME FAILED"
exit "$fail"
