#!/usr/bin/env bash
# merge-wave.sh's base contract, driven end to end against a fake `gh` on PATH (no GitHub): every open
# PR in a wave must target the repo's default branch, and anything wrong — a PR off the base, a mixed
# wave, an unreadable or CLOSED PR, an unreadable default — halts BEFORE the first merge. A clean wave
# merges in order into the default and names it. Hermetic: temp repo, PATH shim, ssh disabled.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
. tests/lib/assert.sh

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/prs"
git -c init.defaultBranch=master init -q "$tmp/repo"
git -C "$tmp/repo" remote add origin git@github.com:o/r.git

# Fake gh. `repo view` prints $tmp/default (empty file ⇒ unreadable). `pr view N … --json F[,G]` prints
# the stored field(s) — "STATE BASE" for the combined pre-pass read. `pr merge N` logs and marks MERGED.
cat > "$tmp/bin/gh" <<EOF
#!/usr/bin/env bash
case "\$1 \$2" in
  "repo view") cat "$tmp/default" ;;
  "pr view")
    n=\$3; f=\$(printf '%s\n' "\$@" | grep -A1 -- '--json' | tail -1)
    [ -f "$tmp/prs/\$n.state" ] || exit 1
    if [ "\$f" = "state,baseRefName" ]; then echo "\$(cat "$tmp/prs/\$n.state") \$(cat "$tmp/prs/\$n.baseRefName")"
    else cat "$tmp/prs/\$n.\$f" 2>/dev/null; fi ;;
  "pr merge") echo "merge \$3" >> "$tmp/merges"; echo "MERGED" > "$tmp/prs/\$3.state" ;;
  *) : ;;
esac
EOF
chmod +x "$tmp/bin/gh"
pr() { printf '%s\n' "$2" > "$tmp/prs/$1.state"; printf '%s\n' "$3" > "$tmp/prs/$1.baseRefName"
       printf 'CLEAN\n' > "$tmp/prs/$1.mergeStateStatus"; printf 'audit-fix/t%s\n' "$1" > "$tmp/prs/$1.headRefName"; }
run() { rm -f "$tmp/merges"; PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$root/skills/execute/scripts/merge-wave.sh" "$tmp/repo" "$@" 2>&1; }
merges() { cat "$tmp/merges" 2>/dev/null | tr '\n' ' '; }
echo master > "$tmp/default"

# 1. mixed bases → halt, nothing merged
pr 11 OPEN master; pr 12 OPEN main
out=$(run 11 12); rc=$?
ok "$rc" 1 "mixed wave exits 1"; ok "$(merges)" "" "mixed wave merges nothing"
has "$out" "PR #12 targets 'main', not the default branch 'master'" "names the off-base PR and the default"
ok "$(cat "$tmp/repo/.claude/merge-wave.status")" "failed:1" "sentinel records the halt"

# 2. a single PR off the default (every agent skipped the default) → halt, nothing merged
pr 31 OPEN main
out=$(run 31); ok "$?" 1 "single off-base PR exits 1"; ok "$(merges)" "" "single off-base PR merges nothing"

# 3. an unreadable PR after a good one → halt before the good one merges
pr 41 OPEN master
out=$(run 41 49); ok "$?" 1 "unreadable PR exits 1"; ok "$(merges)" "" "unreadable PR: nothing merged (fails closed)"
has "$out" "cannot read PR #49" "names the unreadable PR"

# 4. a CLOSED PR last in the list → halt before the earlier ones merge
pr 51 OPEN master; pr 52 OPEN master; pr 53 CLOSED master
out=$(run 51 52 53); ok "$?" 1 "CLOSED PR exits 1"; ok "$(merges)" "" "CLOSED PR: nothing merged"

# 5. unreadable default branch → halt
: > "$tmp/default"; pr 61 OPEN master
out=$(run 61); ok "$?" 1 "unreadable default exits 1"; ok "$(merges)" "" "unreadable default: nothing merged"
echo master > "$tmp/default"

# 6. a clean wave → merges in order into the default; an already-MERGED PR is skipped
pr 21 OPEN master; pr 22 OPEN master; pr 23 MERGED main
out=$(run 21 22 23); rc=$?
ok "$rc" 0 "clean wave exits 0"; ok "$(merges)" "merge 21 merge 22 " "merges in the given order, skips the merged one"
has "$out" "== PR #21 (into master) ==" "names the base per PR"
has "$out" "PR #23 already merged — skipping." "reports the skip"
ok "$(cat "$tmp/repo/.claude/merge-wave.status")" "ok" "sentinel records success"

echo; [ "$fail" -eq 0 ] && echo "merge-wave base: ALL PASS" || echo "merge-wave base: SOME FAILED"
exit "$fail"
