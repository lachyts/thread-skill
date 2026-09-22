---
thread: thread-skill
written: 2026-09-22
status: pending
---

# Claude protocol 4 pilot: launch after restart

Manual handoff for the next native Claude session in this worktree. The previous session prepared the pilot and got explicit agreement, then found that the running session does not reload effort settings. Lachy's rule is: do not launch with Fable review below xhigh. So nothing was initialised.

## Done and verified

- Consumed `docs/handoffs/2026-09-22-rollout-claude-pilot.md` (front matter only, uncommitted). Read the Codex pilot evidence, both audits and all review dispositions.
- Candidate pinned target: `5d3e40fd64a3f3b51d8714370eb589df6d7905e8` (contains `67a825f` and the ignored-file fix `fa937df`, fresh review no findings). Shared adapter worktree `/Users/lachlants/.codex/worktrees/thread-native-recovery` at `0cdc433`, adapter SHA-256 `33871419dc9ba306a3de2841b6947167f358b0b8522a28a0f9796688e196d585`. At `5d3e40f`: 49 engine-safety/prompt tests, 112 domain/host/engine tests and 3 integration fixtures with the candidate adapter pass.
- Private pilot directory `/Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/.thread/pilot-claude-2026-09-22/` (mode 700, gitignored): `approval.json` (Lachy's verbatim amended agreement), `preparation.json`, `config.json`, `verify.sh` (SHA-256 `c6eb222776ce8977481dbb8e4200029f41f87a11af94ae072b4f7870982dc5a4`, isolated venv with markdown 3.10.3), `preflight/baseline.json` (verifier exit 0 on a clean archive of `origin/main` `fbf1f9372abd6f074b5f93fb2c50649cf3db6684`), and `evidence/*.json` for every probe below.
- Vault requirement notes (immutable once adopted): `agent-reader-claude-pilot-a-claude-state-tests.md`, `agent-reader-claude-pilot-b-tests-readme.md` (depends on A), `agent-reader-claude-pilot-c-readme-runtime.md`; derived progress note `agent-reader-claude-pilot-rollout-2026-09-22.md` (`protocol_version: 4`).
- Worktree-local Stop hook `.claude/settings.local.json` (excluded via the repo's `info/exclude`): a timestamp probe plus the candidate `hooks/rollout-stop-driver.py`. Hot-reload verified: the probe fired at a turn end without restart (`evidence/stop-hook-hot-reload.json`).
- Pilot agent definitions in `~/.claude-profiles/fauxmuse/agents/rollout-{opus,fable}-{low,medium,high,xhigh}.md`. Their `model` field governs (Opus 5 / Fable 5.1 observed); their `effort` field does not.
- Profile edit, authorised: `modelSettings.claude-fable-5-1.effortLevel` changed `high` to `xhigh` in `~/.claude-profiles/fauxmuse/settings.json` by a single-key text edit (`evidence/profile-effort-change.json` has both hashes). Not picked up by the running session.

## What remains

1. Start a fresh native Claude session in this worktree (same fauxmuse profile and account). Confirm `.claude/settings.local.json` hooks are active and the eight `rollout-*` agent types are listed.
2. Probe before init: spawn `rollout-fable-xhigh` and `rollout-opus-medium` with a trivial prompt and read the child transcripts under the new session's `subagents/` directory (fields `model` and `effort` on assistant entries). Require Fable at `xhigh`. Lachy accepts Opus at `xhigh`. Record requested versus observed effort separately; if Fable is still `high`, stop and report, do not launch.
3. Initialise: build the `init` payload from `preparation.json` as `spec`, `config.json` as `config`, and `owner` `{harness:"claude", account:"claude-account-sha256:b9908d43548b55d10e8a8fdfbc269d824df61ecf32502407794187f9ad16a2bd", session:"<new session id>", epoch:1}`. Record dir: `<pilot dir>/record`. Run `node skills/execute/scripts/rollout-host.mjs init <record> <payload>` from the worktree; save payload/output under `payloads/` and `outputs/`; use the returned `pinnedHost` for every later mutation. Record launch hashes of the pinned files.
4. Emit `THREAD-EXECUTION: {"record":"<abs record dir>","execution":"<execution id>"}` in an assistant message; check `CronList`, then `CronCreate` the 20-minute heartbeat (off-minute cadence) whose prompt names the record and pinned host, reads status first, collects/recovers children, polls merges via the host, never resumes, and `CronDelete`s itself on paused/stopped/ended. Record the first real Stop driver block message and the first real heartbeat delivery as separate evidence files.
5. Loop per `skills/execute/protocol-v4.md` and `host-api.md`: `advance`, then `claim` and spawn every admitted request up to capacity (two) before waiting, `bind` real agent IDs immediately, spawn with `subagent_type` `rollout-<tier>-<effort>` matching each request's `options.model` and `options.effort`, pass the request's `prompt` verbatim, accept only schema-valid JSON with the request's current `resultCaller`, `advance`, `merge` serially through the pinned host. Save every payload and output.
6. Controlled pause: once A is active and its PR is up, issue `pause`, let A's review and merge drain, confirm B is held solely by pause (record the paused checkpoint), then one recorded coordinator `resume` citing the approval; the heartbeat must not resume.
7. Project status into the rollout note after each meaningful change. At the end, write the native evidence into `docs/implementation/2026-09-22-live-pilot.md` (new section) or a sibling report, update the acceptance task `~/repos/obsidian/Work/Tasks/thread-rollout-v4-native-acceptance.md` and the shared ledger R-WAVE in the adapter worktree. Only claim changed-base acceptance if a request actually traversed the corrected entry.
8. At close: restore only `modelSettings.claude-fable-5-1.effortLevel` to `high` by a targeted edit (preserve intervening edits), remove the eight `rollout-*` definitions and the local Stop hook file, and delete both consumed handoff docs in the close commit. Run `/thread:close`.

## Decisions settled

- Tasks A/B/C, allowances 8 calls / 16 verifier reservations / 2 recoveries per task, maxConcurrent 2, engine 3/2/2, automatic squash merges after verification and fresh independent native review, one draining pause and one recorded resume, no artificial blocker, no reuse of Codex pools. Verbatim in `approval.json`.
- Opus at xhigh and Fable at xhigh accepted for this bounded pilot; per-subagent effort selection is not established.
- The Codex record, its allowances, pinned release and worktrees stay untouched. Nothing is installed or released.

## Gotchas found the hard way

- An unknown `subagent_type` spawns a general-purpose child silently; a spawn success never proves a definition applied. Read the child transcript's `model` and `effort` fields.
- Definitions added mid-session were announced by the harness about two minutes after being written; hooks reloaded within a turn; effort settings did not reload at all.
- The originating Codex session commits into this same worktree concurrently (audits at 14:23 and the fix at ~15:xx today). Re-read `git log` before pinning and never assume HEAD is what it was.

## Suggested skills

- `thread:open` with this doc's path (marks it consumed), then follow `skills/execute/protocol-v4.md` and `skills/execute/host-api.md` directly. No design interview is needed.

## Paste-ready prompt

```
You're continuing "Claude protocol 4 pilot: launch after restart" mid-stream — a live handoff, not a cold pickup.
Read first: /Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill/docs/handoffs/2026-09-22-claude-pilot-restart.md — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: The Thread protocol 4 native Claude pilot on lachyts/agent-reader is fully prepared and explicitly agreed (approval.json). The previous session could not launch because a running Claude session does not reload effort settings; Fable review must run at xhigh. The profile now says xhigh; verify it in this new session with a child probe before initialising anything.
Also read: skills/execute/protocol-v4.md, skills/execute/host-api.md, .thread/pilot-claude-2026-09-22/{approval,preparation,config}.json and evidence/, docs/implementation/2026-09-22-live-pilot.md.
Suggested skills: thread:open (this doc), then the protocol 4 procedure directly.
Next move: probe rollout-fable-xhigh and read its transcript effort; if xhigh, run init through the candidate host and proceed unattended under the recorded agreement.
```
