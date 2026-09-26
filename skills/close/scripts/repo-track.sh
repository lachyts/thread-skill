#!/usr/bin/env bash
# repo-track.sh — thread:close step 2's tracked-task search (skills/close/SKILL.md step 2 is the contract):
# the first open or in_progress vault task, by sorted name, whose body names branch $br as an exact token.
# Close calls it through the `# thread:repo-track` wrapper there; it lives in a script because Claude Code
# substitutes skill arguments into every positional `$N` in a SKILL.md body, awk's `$0` included (p5-2).
#
# Input from the environment: br (required).
# stdout: nothing, or one task name · Exit 0, or 2 with a `repo-track:` stderr line (br unset, no task
# directory, a grep failure). Always run as `bash "<path>"`. bash 3.2-compatible (macOS).
tasks="$HOME/repos/obsidian/Work/Tasks"
if [ -z "${br:-}" ]; then echo "repo-track: br is unset" >&2; exit 2; fi
if [ ! -d "$tasks" ]; then echo "repo-track: no task directory at $tasks" >&2; exit 2; fi
hits=$(command grep -rlF --include='*.md' -e "$br" -- "$tasks" 2>/dev/null); rc=$?
if [ "$rc" -gt 1 ]; then echo "repo-track: grep failed (rc $rc)" >&2; exit 2; fi
printf '%s\n' "$hits" | while IFS= read -r f; do
  [ -n "$f" ] || continue
  awk -v b="$br" '
    { sub(/\r$/, "") }
    NR == 1 { fm = ($0 == "---") ? 1 : -1; if (fm == 1) next }
    fm == 1 && $0 == "---" { fm = 2; next }
    fm == 1 && $0 ~ /^status:[ \t]*"?(open|in_progress)"?[ \t]*$/ { st = 1 }
    { s = $0; off = 0
      while ((i = index(s, b)) > 0) {
        p = off + i
        pre = (p > 1) ? substr($0, p - 1, 1) : ""
        post = substr($0, p + length(b), 1); nxt = substr($0, p + length(b) + 1, 1)
        if (pre !~ "[A-Za-z0-9._-]" && (post !~ "[A-Za-z0-9._/-]" || (post == "." && nxt !~ "[A-Za-z0-9._/-]"))) hit = 1
        s = substr(s, i + 1); off = p
      } }
    END { exit !(st && hit) }' "$f" && basename "$f" .md
done | LC_ALL=C sort | head -n 1
