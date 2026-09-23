#!/usr/bin/env bash
# merge-wave.sh's one-base-per-wave rule, driven end to end against a fake `gh` on PATH (no GitHub).
# A wave whose open PRs target different branches must halt BEFORE any merge; a single-base wave merges
# in order into that base and names it. Hermetic: temp repo, temp PATH shim, ssh disabled for fetches.
set -uo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)
fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/prs"
git -c init.defaultBranch=master init -q "$tmp/repo"
git -C "$tmp/repo" remote add origin git@github.com:o/r.git

# Fake gh: `pr view N … --json F -q .F` reads $tmp/prs/N.F; `pr merge N` logs; everything else succeeds.
cat > "$tmp/bin/gh" <<EOF
#!/usr/bin/env bash
case "\$1 \$2" in
  "pr view")  n=\$3; f=\$(printf '%s\n' "\$@" | grep -A1 -- '--json' | tail -1); cat "$tmp/prs/\$n.\$f" 2>/dev/null ;;
  "pr merge") echo "merge \$3" >> "$tmp/merges"; echo "MERGED" > "$tmp/prs/\$3.state" ;;
  "repo view") echo master ;;
  *) : ;;
esac
EOF
chmod +x "$tmp/bin/gh"
pr() { printf '%s\n' "$2" > "$tmp/prs/$1.state"; printf '%s\n' "$3" > "$tmp/prs/$1.baseRefName"
       printf 'CLEAN\n' > "$tmp/prs/$1.mergeStateStatus"; printf 'audit-fix/t%s\n' "$1" > "$tmp/prs/$1.headRefName"; }
run() { PATH="$tmp/bin:$PATH" GIT_SSH_COMMAND=false bash "$root/skills/execute/scripts/merge-wave.sh" "$tmp/repo" "$@" 2>&1; }

# 1. mixed bases → halt, nothing merged
pr 11 OPEN master; pr 12 OPEN main
out=$(run 11 12); rc=$?
ok "$rc" 1 "mixed-base wave exits 1"
ok "$(cat "$tmp/merges" 2>/dev/null | wc -l | tr -d ' ')" 0 "mixed-base wave merges nothing"
case "$out" in *"targets 'main' but this wave's other PRs target 'master'"*) ok y y "names both bases";; *) ok n y "names both bases";; esac
ok "$(cat "$tmp/repo/.claude/merge-wave.status")" "failed:1" "sentinel records the halt"

# 2. one base → merges in order, into master
rm -f "$tmp/merges"; pr 21 OPEN master; pr 22 OPEN master; pr 23 MERGED main
out=$(run 21 22 23); rc=$?
ok "$rc" 0 "single-base wave exits 0 (an already-merged PR's base is not checked)"
ok "$(tr '\n' ' ' < "$tmp/merges")" "merge 21 merge 22 " "merges in the given order"
case "$out" in *"== PR #21 (into master) =="*) ok y y "names the base per PR";; *) ok n y "names the base per PR";; esac
case "$out" in *"skipped local fast-forward"*|*"fast-forwarded"*|*"did not fast-forward"*) ok y y "runs the local refresh for master";; *) ok n y "runs the local refresh for master";; esac
ok "$(cat "$tmp/repo/.claude/merge-wave.status")" "ok" "sentinel records success"

echo; [ "$fail" -eq 0 ] && echo "merge-wave base: ALL PASS" || echo "merge-wave base: SOME FAILED"
exit "$fail"
