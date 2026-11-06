# 0066 — The primary checkout keeps itself current

Date: 2026-11-02
Status: accepted. Lachy asked for it on 2026-11-02: "some sort of automation where it detects that no rollouts are running and then automatically updates it (rather than me having to remember when those rollouts are running or not)". The plan was approved the same day. The technical calls below were decided for him. Amends ADR 0031 and ADR 0043. It is the first task of the every-rollout-at-once build (the 2026-11-02 spike). *(Amended 2026-11-05, p37-7: see the Amendment section below.)*

## Context

Every session loads this plugin live from its Primary checkout (`~/repos/tools/thread-skill`, a directory-source install). On 2026-11-02 every recent skill load, and every one of thousands of script runs, came from that checkout; none came from the version cache. ADR 0043 lets the checkout move under a rollout that runs on an Engine snapshot, and ADR 0031's hold (`primary-hold.sh`) now covers only a rollout that runs without one.

Little moves it, and only when the hold is clear. land.sh S4 (every close's landing) and merge-task's in-place refresh (`self-rollout-check.sh --refresh-in-place`, after this repo's own merges and at its completion ceremony) both fast-forward it, but both skip it while ADR 0031's hold stands. The daily sweep is push-only for this repo (`daily-sweep.sh`, its own-repos section). The hold never cleared, so the checkout sat at 2026-10-26, 97 commits behind origin. That was older than `engine-snapshot.py`, so every rollout scheduled since ran unstamped, the hold never released, and nothing would ever break the circle. That day's `/thread:orient-all` pass ran four-day-old rules: the every-rollout-at-once spike found that every vault chain claimed the whole vault because of it.

`/fresh-review`, which every Leg's review and every close's landing run, lives in `~/.agents`. Every profile's `skills/` links to it, so it too is read live from a checkout.

## Decision

1. **The Primary refresh.** A launchd job, `com.thread.primary-refresh`, runs `primary-refresh.py run` every 5 minutes. Each pass fast-forwards the Primary checkout to origin's default branch whenever ADR 0031's hold is clear. The hold is read through the primary's own `primary-hold.sh`, because that is the rule the rollouts reading the primary run by. A missing hold script, an error or a timeout holds. So the circle breaks at the first pass with no unsnapshotted rollout running. A primary that old counts every rollout it scheduled, and a stuck one (on 2026-11-02, `mac-data-mcp-rollout-2026-10-29`) holds until it is resolved or dropped; a hold standing a day reaches Lachy with its holders named (decision 2). Once the primary is current, new rollouts carry Engine snapshots and no longer hold it.

2. **Fast-forward only, never in the way.**
   - **What stops a move:** the pass always fetches and reads current, ahead or diverged first; a checkout behind origin is then left as it is while it has an `index.lock`, a rebase or merge in progress, or a branch other than the default.
   - **The move:** `git merge --ff-only --no-autostash`, so git itself refuses to overwrite an uncommitted edit.
   - **Ahead of origin:** left to its landing route. A close's landing PR merges with `--merge`, so its commits become ancestors of origin and a later pass moves.
   - **Diverged:** never integrated (ADR 0042's rule).
   - **Notice:** Lachy is notified once, through `ntfy-push.py`, when a checkout stays stuck for 24 hours. A stuck spell runs from the first pass that cannot bring it current (it is no main checkout, it is busy, it is held, its fetch fails, git refuses the fast-forward, or it has diverged) to the next pass that reads current, moved or ahead. A hold is a meant wait while a rollout runs (ADR 0031), but one standing a day is reported with its holders: on 2026-11-02, `mac-data-mcp-rollout-2026-10-29` still read as running with every task merged. New commits on origin and a failed fetch never restart the clock.

3. **The other live-loaded checkouts.** Each `--also` checkout gets the same pass with no hold, because sessions already commit there in place, so a fast-forward is no different from a peer's commit. The job is installed with `--also ~/.agents`. Every pass fetches first, so busy and held count only for a checkout that is actually behind origin.

4. **It runs an installed copy and updates it.** `install` copies the script to `~/.local/state/thread/bin/` and points the job there with `--primary`. The job exists before the primary holds the script, and its path never moves. On a pass that has just fetched and found the primary at origin's tip, however it got there (this job, merge-task's refresh, a pull), the copy is replaced by origin's committed script at that tip, once it compiles. The working tree is never read, so a half-written edit never reaches the job. The copy tracks origin's tip: one installed from a branch ahead of origin is replaced by origin's own at the next such pass. Only the copy `install` placed, marked by `primary-refresh.installed` beside it, is ever rewritten: never a checkout's file or the version cache.

5. **`/fresh-review` stays a shared skill.** Lachy, 2026-11-02, "Stay shared, kept current": it stays in `~/.agents`, which Thread Skill depends on, kept current by decision 3.

## Considered options

- **Move `/fresh-review` into the plugin.** It would be versioned with the plugin, so a rollout always reviews with the matching version. Rejected by Lachy: every session's review and Codex use it outside rollouts, so it would be renamed, lost to Codex, and need the global review rules and hooks re-pointed.
- **A Chorus-triggered refresh when the Stage goes quiet.** Chorus has no quiet hook (its `messages.py` quiet serves the Lunch restart), and a terminal-run rollout would not be covered.
- **The daily sweep.** It is push-only for own repos by design, and once a day would leave the primary behind for most of it.
- **Running the job from the primary's own file.** The job could not exist until the primary already held it, and that is exactly the stale case this ADR fixes.
- **Merging a diverged checkout.** That integrates under a live session's feet, against ADR 0042's rule for in-place twins.

## Consequences

- The primary is current within about 5 minutes of the last unsnapshotted rollout stopping. While one runs and the primary is behind origin, the job logs `held: [[…]] running on it` each pass and moves nothing (at origin's tip it logs `current`); a hold standing a day reaches Lachy once, naming its holders. The fast-forward has no timeout, since a merge killed mid-checkout would leave the live-loaded tree half updated.
- `~/Library/Logs/thread-primary-refresh.log` gains a line per checkout per pass. The state file `~/.local/state/thread/primary-refresh.json` holds only the stuck entries.
- **Installing it is a one-time step** (README § The convergence engine, beside the Watchdog). Run `primary-refresh.py install --primary ~/repos/tools/thread-skill --also ~/.agents` from any checkout that holds the script, then run the `launchctl bootstrap` line it prints.
- **Limits.**
  - A checkout whose local commits never reach origin (unpushed in-place work) stays ahead and is never pushed by this job; pushing is its landing route's.
  - A pass that fast-forwards the primary in the seconds before a new unsnapshotted rollout's first command is the same race a manual pull always had. Once snapshots are cut it cannot recur.

## Amendment (2026-11-05, p37-7)

The `/fresh-review` chain on `feat/primary-refresh` left findings open after five rounds; p37-7 closed them. What changed:

1. **One primitive for a live checkout.** `skills/_shared/scripts/live-checkout.sh` is the one copy of "fast-forward a live checkout": what a half-applied operation is (now with BISECT_LOG and a multi-pick's `sequencer/`), land.sh's ssh rule (read from the target repo's own config), origin's default branch (local refs first, then origin under the ssh rule), the one-branch fetch, the overlap check and the guarded fast-forward. land.sh (S1, S4, O1, O4) and `self-rollout-check.sh` (`--ensure`, `--refresh`, `--refresh-in-place`) source it behind a guard that fails closed. primary-refresh.py runs its four modes, whose exit codes and lines are a parsed contract: anything else reads `broken:`, never current or moved.
2. **The fetch takes one branch**, `+refs/heads/<d>:refs/remotes/origin/<d>` with no tags, so an unrelated ref conflict (a stale `origin/feat` against origin's `feat/x`) never fails it.
3. **The hold is read before the overlap.** Only a checkout that could move asks the hold, so `refused:` always means the hold is clear and git still would not move. The overlap is checked before any merge runs, so a refusal never rewrites ORIG_HEAD.
4. **The fast-forward is bounded** (600 s), and a timeout is urgent: `timed out: … the working tree may be partly updated`, notified on the pass it happens. This reverses Consequences' "The fast-forward has no timeout" and decision 4's reason for it: a hang (an LFS smudge, a post-merge hook, a keychain prompt) wedged the job for good, since launchd never starts a second run, and the half-updated tree it feared is now reported at once instead.
5. **The notices.** A spell's first notice goes at 24 h from its start, or at once for a timeout. After it, each new kind of stuck gets one re-notice once it has stood an hour (a timeout at once). A kind already notified never sends again within the spell. So a held-then-refused primary is no longer stale in silence, and a flapping one is bounded by its kinds. The message puts the outcome first, so a five-holder hold keeps its last holder. A failed send waits an hour and logs ntfy-push's reason.
6. **The self-update installs a smoke-tested bundle on every fetched pass**, whatever the primary read: the copy, live-checkout.sh, default-branch.sh, ntfy-push.py, rollout-settings.py and ladder.py, each read at the fetched tip. A candidate is staged from its own table (its `bundle` subcommand) and smoke-run with the job's own argv under `--dry-run`, which fetches for real through its staged helper, reads the hold, and runs its compare-only self-update against the stage. It is installed only when the smoke run passes. Files the candidate's table drops are removed, and the copy goes last. A refused tip is smoked once a day, and a refusal standing 24 h is itself a notice.
   - 2026-11-06 (p39-6): a seventh file, `skills/_shared/scripts/background_job.py`, which the Watchdog shares (the state file, the ntfy-push call, the launchd plist and the process-group stop). The old copy's table-driven install brings it with no re-install (JOB_SHAPE stays 1). A copy loads its own, else the primary's when its own has no file; a broken file is an ERROR, never the primary's.
7. **The self-update contract is frozen.** An installed copy sends every candidate `run`, `--state`, `--log`, `--now`, `--dry-run` and `bundle`, and reads back the `primary-refresh <P>: <outcome>`, `self-update: current` and bundle lines. Changing any of them strands every installed copy until a hand-run install (tests/primary-refresh.test.sh I6 pins them).
8. **A signal to a pass stops its live child's process group**, one session down included: a smoke's candidate stops its own child before it exits. launchd's bootout no longer leaves a git or a hold running.
9. **install** refuses a python older than 3.11 (ntfy-push.py needs tomllib). It runs `python3` from PATH when that is the same interpreter, puts git's and python's directories first on the job's PATH, writes `--log` and `--job-shape` into the job, and prints a bootout line that waits before it bootstraps. A job whose shape is older than the copy's (the self-update never rewrites the plist) opens a `job` spell, which notifies after a day. The log rotates at 1 MiB.
10. **The running rule.** ADR 0031's definition of a running rollout (its Decision: a live, started note at the current protocol, neither done nor dropped, not hard-paused: `unfinished-rollout.py running`) no longer includes an unstamped serial chain that ADR 0060 decision 1 reads as `stuck` with no Queue row `running`. Such a chain has no Leg open and uses no index or HEAD, so it holds nothing on the Primary checkout (ADR 0060's rule, carried to the primary hold). So this ADR's decision 1, "a stuck one … holds until it is resolved or dropped", no longer applies to a serial chain; a stuck parallel rollout still counts as running.

**Re-install once (Lachy's step).** After this amendment lands, run `python3 skills/_shared/scripts/primary-refresh.py install --primary ~/repos/tools/thread-skill --also ~/.agents` from the primary, then the line it prints. The self-update never rewrites the plist. If this is missed, the job spell's notice says so after a day.

## Files

`skills/_shared/scripts/primary-refresh.py`; `skills/_shared/scripts/live-checkout.sh`; `skills/_shared/scripts/background_job.py`; `tests/primary-refresh.test.sh`; `tests/live-checkout.test.sh`; `tests/background-job.test.mjs`; the installed bundle in `~/.local/state/thread/bin/` (primary-refresh.py's `bundle` table); CONTEXT.md **Primary checkout**, **Primary refresh** and **Running rollout**; README § The convergence engine.
