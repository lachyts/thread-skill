---
name: handoff
description: 'Fork the current conversation to a fresh agent NOW. Always writes a durable handoff doc at docs/handoffs/YYYY-MM-DD-<slug>.md in the session''s repo (never OS temp) and lands it: committed, then pushed or a `landing` PR opened with auto-merge queued, never waiting (ADR 0028); plus a paste-ready prompt; the consumer marks it consumed and its close deletes it. In Codex Desktop or a Chorus Session a successful handoff also creates a new visible task seeded with that prompt — a headless session or subagent is never a substitute; elsewhere label it a manual handoff. Trigger ONLY on explicit fork intent — "hand this off", "fork this to a fresh agent", "new session and keep going", /thread:handoff — or on router dispatch (thread:next / thread:orient). Never when "handoff" means people or other systems, never proactively because the context feels long — recommend thread:next instead.'
argument-hint: "What will the next session focus on?"
author: Matt Pocock
license: MIT
source: https://github.com/mattpocock/skills (skills/productivity/handoff) — adapted under MIT
---

# /thread:handoff — fork this thread into a visible fresh task

Brief a fresh agent so it can continue the work *immediately*.

Every handoff produces two artefacts: a **durable handoff doc**, committed to the repo the session is working in and landed there (pushed, or its merge queued, never waited on: ADR 0028, § Commit it), and a **paste-ready prompt** that points at it. In **Codex Desktop or a Chorus Session**, the primary outcome is additionally a **new visible task** that the user can open and interact with; the prompt is the payload used to create that task. (On the Stage the call raises a Handoff card the listener Starts — an offer, not yet a live Session, which is what the queued `clientThreadId` form of the directive already means; Chorus ADR 0047.) The doc is the object Lachy tracks — it is never optional and never lives in OS temp (ADR 0017).

**Invocation gate.** Run this only on explicit fork intent (the user asked for a
handoff of THIS conversation) or when a router (`next`/`orient`) dispatched it.
Never self-initiate a handoff because the session feels long or the context is
filling — that is a recommendation, and recommendations for the undecided
moment belong to `thread:next`'s ask-first menu. (Model invocation enabled
2026-08-12: the old `disable-model-invocation` flag was inherited from the
flat-skill port, never a recorded decision; handoff was then judged the
cheapest-misfire route of the family, a misfire costing one committed doc
(ADR 0017). Since landing (ADR 0028) a misfire reaches origin: the doc is pushed
to the default branch, or a `landing` PR is opened with its merge queued, and
withdrawing it lands a second push or PR. It must still be removed, not left: a
pending doc nobody meant silences the next `thread:close`'s continuation tasks
for that thread. See `handoff-lifecycle.md` § Withdrawn.)

## Success contract in Codex Desktop or a Chorus Session

A handoff is complete only when all of these are true:

1. The handoff doc below is written and handed to landing (§ Commit it) *before* the task is created, so the prompt's `Read first` path resolves the moment the new task starts. Every landing outcome, `stuck:` and `not versioned` included, proceeds to `create_thread`: the landing row is reported, and a landing result never blocks the handoff. A doc committed but not yet landed (`stuck:` with `land: commit` on stderr, `queued: needs merge <url>`, or a queued merge that later fails) is retried by a later landing call; a `not landed: <reason>` doc is committed only, by design, and no landing call retries it; a `not versioned` doc is on disk only and nothing retries committing it (§ Commit it).
2. A host-native `create_thread` call succeeds and returns a `threadId` or queued `clientThreadId`.
3. The new task is seeded with the compact handoff prompt and the correct project/workspace context.
4. Use `wait_threads` for an initial progress snapshot when available, so creation is verified without waiting for the whole job to finish.
5. The response emits the host directive exactly as required:
   - `::created-thread{threadId="..."}` for a created task, or
   - `::created-thread{clientThreadId="..."}` for queued worktree setup.

Search specifically for the host-native task tools before acting: `create_thread`, `wait_threads`, `read_thread`, `send_message_to_thread`, and related tools. Do not confuse them with third-party tools whose names also contain “thread”, such as Twist or email connectors.

The user's explicit handoff request is the authorisation to call `create_thread`; do not ask them to confirm the same action again. Unless they specify another destination, create the new task in the same project/workspace and give it a concise title derived from the task.

## Fail closed — never create an invisible substitute

If the native task-creation tool is absent, unavailable, or fails:

- Do **not** run `codex exec`, `codex resume`, or another shell command to create a non-interactive Codex session. These sessions are not visible sidebar tasks.
- Do **not** substitute a subagent, goal, background process, browser session, or desktop-automation attempt and describe it as a new thread.
- Do **not** emit `::created-thread` without a successful native creation result.
- Preserve the current work (the handoff doc is already written and handed to landing — § Success contract, step 1), print the prompt, and state plainly: “I couldn’t create a visible sidebar task from this session because the native task tool is unavailable. No hidden substitute was launched.”
- Give the user the ready-to-paste prompt so they can open a new task manually. This is a **manual handoff**: the doc and prompt are complete and the lifecycle below applies to them in full — what is missing is the native task, not the handoff.

This strict failure behaviour matters because a technically persistent session that the user cannot see, inspect, or message does not satisfy the purpose of a handoff.

## Handoff document — durable, committed, self-cleaning

**Where.** `<home>/docs/handoffs/<YYYY-MM-DD>-<slug>.md`, where `<home>` is what the resolver prints:

```
bash "${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh"            # add --shared when the active thread is a _shared/threads/<slug>.md
```

Its rules — project directory, seat, `_shared`, git toplevel, and `_shared` for a unit outside git or one whose repo ignores `docs/handoffs/` — are `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Home; never resolve `<home>` by hand, and never edit a `.gitignore` to make room. Never the OS temp directory (macOS clears it on reboot; a handoff must survive reboots and account switches) and never the vault. Slug: ≤5 words naming the work. Create `docs/handoffs/` if absent. A doc briefs exactly one consumer (`${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md`). Every path in this skill, in `thread:close` and in `thread:open` is this same `<home>/docs/handoffs/<doc>`; the prompt carries it **absolute**.

**Failure path.** If the resolver exits non-zero, prints nothing, or cannot be run (`CLAUDE_PLUGIN_ROOT` unset, a stale cache), stop before writing: no doc, no landing call, no Thread-state row, no captures touched, no task created. Print `handoff: resolver failed (<its stderr, or "not found at <path>">) — no doc written` and ask Lachy for an absolute directory. Only a directory he names is used as `<home>`, never one the agent infers.

**Consumer home.** When the consumer will launch somewhere other than this session's launch directory — the work moves to another repo, or this repo is about to be deleted or moved — resolve with `--dir <consumer launch dir>` (plus `--shared` for a shared thread), then write the doc there and hand it to landing with `home` set to that home (§ Commit it): land.sh resolves the repo that holds it. The prompt names that absolute path, and the producer's later `thread:close` still finds the doc through the THREAD.md Resume pointer.

**Shape.** Front matter — the block in `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Front matter, written with `status: pending` — then the body. The body's first line, above § 1, is ``**Run from:** `<abs dir>` ``: the directory the consumer must launch in, because the harness resets a `cd` out of the launch directory. It is this session's launch directory, or the consumer's under **Consumer home.**; for a shared thread written from a seat it is the seat, never `_shared`, which is not a launch directory.

Body sections, in this order:

1. **Done and verified** — what landed this session, with evidence (paths, SHAs, test output).
2. **What remains** — the continuation: what the next session does, in order.
3. **Decisions settled** — rulings already made, so they are not re-litigated.
4. **Gotchas found the hard way.**
5. **Suggested skills** — the skills the next agent should invoke to continue.
6. **Paste-ready prompt** — compose it first, per § Build the handoff prompt below, then write the doc carrying it verbatim, verified against live state.

Do not duplicate content already captured in other artefacts (PRDs, plans, ADRs, issues, commits, diffs, THREAD.md) — reference them by path or URL instead. Redact any sensitive information — API keys, passwords, tokens, or personally identifiable information. If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc and the prompt accordingly.

**Commit it** — land the doc, before anything else. Hand the doc to the shared landing script, `${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land.sh` (ADR 0028), through the snippet below, exactly as close lands its close-outs (close § Land the close-outs). Run it in its own Bash tool call with timeout 600000, and never add other commands to that Bash call. Fill in `home` (the `<home>` the resolver printed, or the consumer home under **Consumer home.**: land.sh resolves the repo that holds it), `slug` (the doc's `thread:` value — the thread's effective slug, else this handoff's slug — as close passes `--slug`) and `doc` (the doc's absolute path), and replace `<message>` with `📝 docs(handoff): <slug>`. `msg` is a `mktemp` file written by a quoted heredoc, so an apostrophe survives, and the `trap` removes it on every exit path.

```bash
# thread:handoff-land (extracted and run by tests/land.test.sh)
ld="${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land.sh"
if [ ! -f "$ld" ]; then echo "land: script not found at $ld (is CLAUDE_PLUGIN_ROOT set?)" >&2; exit 2; fi
home='<home>' slug='<slug>' doc='<abs doc path>'
msg=$(mktemp "${TMPDIR:-/tmp}/land-msg.XXXXXX") || exit 2
trap 'rm -f "$msg"' EXIT
cat > "$msg" <<'MSG'
<message>
MSG
bash "$ld" --slug "$slug" -F "$msg" -- "$home" "$doc"
# end thread:handoff-land
```

land.sh commits the doc by pathspec on the repo's current branch (a dirty or pre-staged index stays out of the commit: close § Commit hygiene), then lands it by the repo's own rules. An unprotected default branch is pushed (`landed`). A protected one gets the commit pushed unchanged to a `close/…` branch, a `landing` PR and auto-merge queued (`queued <url>`, or `queued: needs merge <url>` when a step was skipped). A repo on the landing register, a repo the daily sweep carries (land.sh `swept()`: `~/repos/workspaces`, `_shared` included, the `~/Projects` monorepo and the few nested project repos it lists; any other nested project repo with a GitHub origin lands), a repo with no GitHub origin, or a checkout on a branch other than origin's default is committed only (`not landed: <reason>`). Landing does not wait: nothing polls after the call, and nothing calls again to check the merge. land.sh never switches the checkout: it never leaves the default branch (a checkout on another branch stays there too), and a protected repo's merge happens on GitHub, never in this working tree, so the doc is on disk from the moment it is written, whatever the result.

On a landable repo checked out on its default branch, land.sh first fetches origin and fast-forwards the local default (`git merge --ff-only`), except the plugin's own primary checkout while a rollout runs on it (ADR 0031: `land: held the primary checkout …` on stderr; an unprotected one gets its rebased tip pushed without the branch moving, so the result is still `landed`), so a handoff can pull other people's merged changes into this session's working tree, which the old plain commit never did. Uncommitted edits are never discarded: a fast-forward that would overwrite a local edit is refused (`land: ff refused: …` on stderr) and changes nothing, and the doc is committed on the un-refreshed HEAD. On an unprotected repo the push then needs a rebase that is refused on the same path, so the result is `stuck: rebase refused: …` with the doc committed locally; on a protected repo it still queues, because HEAD is pushed unchanged.

Read the result by close step 8's **Landing rows**, applied to the one handed path; the rules below restate them in full. land.sh prints one line on stdout (`landed`, `queued <url>`, `queued: needs merge <url>`, `not landed: <reason>` or `stuck: <reason>`), and its stderr carries `land: commit <sha>` (the doc's SHA) or `land: nothing committed`. Print one `landing <top>: <result line>` row in the handoff output (`<top>` the doc's repo toplevel), plus ` (carried <N> earlier close-out commit(s))` when stderr carries `land: carried <N> earlier close-out commit(s)`; print no row for `landed` with `land: nothing to land` on stderr (nothing was committed or pushed, as when a withdrawal removes a doc that was never committed or is already gone), nor for `not landed: swept by the daily sweep`. A `dropped` path (`land: dropped <rel> (…)` on stderr) is listed as `not versioned: <path> (not on disk)`. `stuck:` together with `land: nothing committed` means land.sh's preflight refused before committing — a detached HEAD, a half-applied operation (`rebase-merge`, `rebase-apply`, `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `BISECT_LOG`), an ignored path — so also print `not versioned: <path> (<reason>)`, the reason being the stuck line's text: the doc is on disk only (a commit on a detached HEAD would be dropped by the next checkout). Any other exit, or no result line (the guard's exit 2, a crash) → `landing <top>: stuck: land.sh failed (<first stderr line>)`, plus `not versioned: <path> (land.sh failed)` unless stderr carries `land: commit`.

What each outcome leaves. A doc committed but not landed (`stuck:` with `land: commit` on stderr, `queued: needs merge <url>`, or a queued merge that later fails) is retried: the next land.sh call in that repo carries the commit (the next close there, the consumer's close that deletes the doc included), and the daily lander finishes an open `landing` PR. A `stuck: local commits not from a close-out` doc is carried only once those other commits are resolved. `not landed: <reason>` is committed only, by design, and no landing call retries it. A `not versioned` doc (detached HEAD, a half-applied operation, an ignored path, or land.sh missing or failing before its commit) is on disk only, and nothing retries committing it: close hands a pending doc to landing only when its refresh diff is not `unchanged` (close step 7.2), and the consumer's close plain-`rm`s a never-committed doc as `not versioned: <path> (never committed)`. An uncommitted handoff is not durable, and an uncommitted doc the consumer later deletes is destroyed rather than archived. That is the trade-off of having no fallback plain commit. To version it, fix the repo state and re-run the § Commit it snippet before the consumer closes (land.sh stages an existing doc itself).

**Thread state.** If the thread has a THREAD.md, apply `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md` § Thread state's handoff row now, after the landing call returns, whatever its result (`not versioned` and `stuck:` included): the continuation is live either way, and writing THREAD.md after the call keeps landing's fast-forward or rebase from ever meeting the fresh edit.

**Open captures.** Before the prompt is printed, close the thread's own open stash/defer captures, because the doc is now the single tracker for its continuation (ADR 0017). Run the query from `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` § 2, then act on each hit **only** on a deterministic match: its Notes `**Thread:**` link resolves to the active THREAD.md's absolute path, or its filename stem equals the THREAD.md `slug:` (the doc's `thread:` value). Each matched capture gets `status: done`, `completed: <today>` and a Notes line `Superseded by handoff <abs doc path>`; one with `scheduled:` also loses its unchecked day-page line (`task-writer.md` § 3b). A hit that matches only because its resume prompt describes the same work is **left open** — reported, not written. The handoff output lists every write: `capture closed: [[<slug>]] (superseded)`, `day-page line removed: <day-note path>`, and `capture left open (fuzzy match only): [[<slug>]]`. Skipped entirely on the resolver failure path.

**Lifecycle.** The doc's states, pickup, close-out and the manual-handoff rule are `${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md`. The one lifecycle procedure that runs here is **withdrawal** (`handoff-lifecycle.md` § Withdrawn): if the handoff is called off in the same session, remove the doc at once — `rm -f <path>`, then run the § Commit it snippet with `doc` set to that path and the message `🔧 chore(handoff): withdraw <slug>`, in its own Bash tool call (land.sh stages the deletion itself and lands the removal like the doc; report its result as § Commit it does), or plain `rm` if it was never committed, with no landing call — and undo the handoff row: when the thread has a THREAD.md, rewrite real Resume instructions there in place of the `Read <abs doc path> first` pointer, and reopen the captures it superseded: every task note carrying `Superseded by handoff <abs doc path>` (`rg` over `~/repos/obsidian/Work/Tasks/`) returns to `status: open`, loses `completed:` and that line, and a scheduled one gets its day-page line back per `task-writer.md` § 3b. The choice is reopen, not "close only once final": a handoff has no later final moment that the producing session observes.

## Build the handoff prompt

Create this compact payload for the new task. Print it as a fenced block when native creation is unavailable or when the user asks to see it:

```
You're continuing "<task title>" mid-stream — a live handoff, not a cold pickup.
Run from: <abs dir> — launch the session there; a cd from another launch directory is reset.
Read first: <home>/docs/handoffs/<YYYY-MM-DD>-<slug>.md (absolute path) — then mark it consumed: set `status: consumed` in its front matter (no commit; your thread:close deletes it).
Context: <2–5 lines: goal, state of play, what's built/decided, what's blocked.>
Also read: <key file paths / artefact links>
Suggested skills: <skills the next agent should invoke>
Next move: <the single concrete next step>
```

Keep it tight — the doc carries the depth; the prompt carries the momentum.

When native task creation succeeds, seed the new task with the prompt (the doc path travels inside it), then report the created task and emit the required directive. When native task creation is unavailable, print the prompt and the absolute path of the handoff doc so the user can open a new task manually.

## Other hosts

In a host with an equivalent native visible-session creation tool — a Chorus Session serves `create_thread` under the same name — use that tool and verify the returned session identifier. In a host with no such capability, the doc + prompt manual handoff is allowed only when it is explicitly labelled as a manual handoff; never claim that a new task was created.

## Relationship to the other thread:* routes

This is **not** a replacement for the rest of the family:

- `thread:open` + `thread:close` = persistent, durable continuity for ongoing work that spans many sessions.
- `thread:stash` / `thread:defer` = the work stops *for now*; a self-contained vault task guarantees it isn't lost.
- `thread:handoff` = the work continues *right now*, in a new visible task when the host supports it. Its doc is durable but transient: it lives in the repo's `docs/handoffs/` until the consuming session deletes it, and while it is pending `thread:close` treats it as the thread's continuation. THREAD.md remains the long-lived record; the doc is the hand-carried brief.

If the work is an ongoing project that should be remembered, use `thread:close` instead. Use `thread:handoff` for the live "carry this task to a new agent" moment.
