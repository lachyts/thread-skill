#!/usr/bin/env bash
# repo-track.sh — thread:close step 2's tracked-task search (skills/close/SKILL.md step 2 is the contract):
# the first Active vault task (`open` or `in_progress`), by sorted name, whose body names branch $br as an
# exact token. The `status:` is read per skills/_shared/vault-grammar.md § Statuses: lower-cased, with `-`
# read as `_`, so TaskNotes' `in-progress` is `in_progress` (quoted `'in-progress'` or `"in-progress"` too);
# any other status is a hold, never tracked.
# Close calls it through the `# thread:repo-track` wrapper there; it lives in a script because Claude Code
# substitutes skill arguments into every positional `$N` in a SKILL.md body, awk's `$0` included (p5-2).
#
# Input from the environment: br (required).
# stdout: nothing, or one task name · Exit 0, or 2 with a `repo-track:` stderr line (br unset, no task
# directory, a grep failure). Always run as `bash "<path>"`. bash 3.2-compatible (macOS).
tasks="$HOME/repos/obsidian/Work/Tasks"
# vault-grammar.md § Statuses, Active (tests/contracts/vault-grammar.test.mjs pins this copy to the doc).
active='open in_progress'
if [ -z "${br:-}" ]; then echo "repo-track: br is unset" >&2; exit 2; fi
if [ ! -d "$tasks" ]; then echo "repo-track: no task directory at $tasks" >&2; exit 2; fi
hits=$(command grep -rlF --include='*.md' -e "$br" -- "$tasks" 2>/dev/null); rc=$?
if [ "$rc" -gt 1 ]; then echo "repo-track: grep failed (rc $rc)" >&2; exit 2; fi
printf '%s\n' "$hits" | while IFS= read -r f; do
  [ -n "$f" ] || continue
  # The status value is read as reconcile-project's Rec.status reads it: trimmed, a matched '…' or "…" pair
  # stripped (its _unq), trimmed again, then lower-cased with `-` as `_`. sq is a single quote, passed in
  # because the awk program sits inside one.
  awk -v b="$br" -v act="$active" -v sq="'" '
    BEGIN { n = split(act, a, " "); for (k = 1; k <= n; k++) active[a[k]] = 1 }
    { sub(/\r$/, "") }
    NR == 1 { fm = ($0 == "---") ? 1 : -1; if (fm == 1) next }
    fm == 1 && $0 == "---" { fm = 2; next }
    fm == 1 && $0 ~ /^status:/ {
      v = $0; sub(/^status:[ \t]*/, "", v); sub(/[ \t]+$/, "", v); q = substr(v, 1, 1)
      if (length(v) >= 2 && (q == "\"" || q == sq) && substr(v, length(v), 1) == q) v = substr(v, 2, length(v) - 2)
      sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v); v = tolower(v)
      gsub(/-/, "_", v); if (v in active) st = 1 }
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
