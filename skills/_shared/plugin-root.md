# Plugin root — running commands from text read as a file

The one rule for a `${CLAUDE_PLUGIN_ROOT}` command the model reads rather than has rendered. Every skill and
spec that can send the model into such text, or be read as it, cites this file instead of restating it
(review e4fe2a2/a0bb12 findings 1 and 6; a per-caller patch was tried in p5-2 and reverted).

## Why

Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` only in the SKILL.md it **renders**: the skill the Skill tool
or a typed `/thread:<verb>` loaded. Text the model **reads as a file** keeps it literal, and the Bash tool
does not set the variable, so a command copied from that text runs against an empty root, a path that
starts with `/skills/`. The exit code depends on what ran it: a snippet's guard exits 2 with
`… not found at /skills/… (is CLAUDE_PLUGIN_ROOT set?)`; a bare `python3` (most plugin-root commands) exits
2 with `can't open file '/skills/…': [Errno 2] No such file or directory`; a bare `bash` exits 127; `cp` and
`node` exit 1. Seen 2026-10-03: `/thread:next` → handoff ran handoff's land snippet from the file it read,
and the guard exited 2.

## When it applies

Whenever the command comes from a plugin file you read rather than the skill that was rendered for you:

- a router or caller following a sibling's SKILL.md: `next` → stash, defer, handoff or close; `open save` →
  close; close → open's Repo-thread lookup; orient → schedule, execute, handoff or open; repair → execute's
  queue loop; orient-all → schedule (its forks), status, execute, repair or orient;
- a `_shared` spec or a skill's reference file: `task-writer.md` (stash, defer, handoff, close),
  `execution-fit.md` (schedule, execute, orient), `handoff-lifecycle.md`, `process-scan.md`,
  `readiness-grade.md` (orient-all), `orient/reshuffle.md`;
- a SKILL.md read from source with `sed` (after a mid-session pull or release, when the rendered body is
  stale).

A command in the SKILL.md that was rendered for this turn already carries an absolute path; it needs nothing.

## The rule

1. **The root comes from the path you read.** The plugin root is the absolute path of the file the command
   came from, up to (not including) its last `/skills/` segment:
   `/Users/me/repos/tools/thread-skill/skills/_shared/task-writer.md` → `/Users/me/repos/tools/thread-skill`.
   The rendered skill that sent you there named that file by its absolute path, so the root is always in
   hand. Never derive it another way: no `find`, no guess at `~/.claude/plugins/cache/…` (a stale cache runs
   old scripts), no root from a different checkout or worktree than the file you read.
2. **Export it at the start of every Bash tool call that runs such a command**, then the command unchanged:

   ```bash
   export CLAUDE_PLUGIN_ROOT='<root>'
   <the command or snippet, byte for byte>
   ```

   - **Every call**, because Bash tool shell state does not persist between calls.
   - **Export, never a prefix.** In `CLAUDE_PLUGIN_ROOT=<root> bash "${CLAUDE_PLUGIN_ROOT}/…"` the shell
     expands the path before the prefix assignment applies, so the path is still `/…`.
   - **The snippet stays unchanged.** Do not hard-code the root into it: its guards, markers and the tests
     that extract it all assume the text as written. The export line is the one addition allowed where a
     snippet says "never add other commands to that Bash call" (handoff § Commit it, close § Land the
     close-outs): it sets up that call, it is not another command in it.
3. **Paths to read resolve the same way.** A `${CLAUDE_PLUGIN_ROOT}/…` file the text names for reading is
   `<root>/…`.
4. **An empty-root failure means this rule was skipped.** Any error naming a path that starts with
   `/skills/` means the root was not exported, whatever the exit code: a guard's `not found at /skills/…`
   (exit 2), `python3`'s `can't open file '/skills/…'` (exit 2), `bash`'s `/skills/…: No such file or
   directory` (127), `cp`'s or `node`'s (exit 1). It is not the snippet's or the script's failure path:
   export the root and re-run that same call once.
   - **A `python3` exit 2 of this kind is not the script's own exit 2.** The script never ran, so it is
     not `resolve-day.py`'s refusal of a day, not `next-action.py set-down`'s refusal ("never retry the
     write by hand"), not `reconcile-rollout.py hand-back`'s refusal. A script's own refusal prints its
     own message (`resolve-day: …`, `next-action: …`, `ERROR: …`), never `can't open file '/skills/…'`.
   - The caller's own failure path (handoff's "resolver failed", close's "scan failed", task-writer's
     by-hand date, execution-fit's blocker stops, a refusal that stops before writing) applies only to a
     run that fails with the root set.
