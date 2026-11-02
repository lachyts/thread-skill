# 0066 — The primary checkout keeps itself current

Date: 2026-11-02
Status: accepted. Lachy asked for it on 2026-11-02: "some sort of automation where it detects that no rollouts are running and then automatically updates it (rather than me having to remember when those rollouts are running or not)". The plan was approved the same day. The technical calls below were decided for him. Amends ADR 0031 and ADR 0043. It is the first task of the every-rollout-at-once build (the 2026-11-02 spike).

## Context

Every session loads this plugin live from its Primary checkout (`~/repos/tools/thread-skill`, a directory-source install). On 2026-11-02 every recent skill load, and every one of thousands of script runs, came from that checkout; none came from the version cache. ADR 0043 lets the checkout move under a rollout that runs on an Engine snapshot, and ADR 0031's hold (`primary-hold.sh`) now covers only a rollout that runs without one.

But nothing moves it. `self-rollout-check.sh --refresh-in-place` runs only after this repo's own merges and at its completion ceremony. The daily sweep is push-only for this repo (`daily-sweep.sh`, its own-repos section). So the checkout sat at 2026-10-26, 97 commits behind origin. That was older than `engine-snapshot.py`, so every rollout scheduled since ran unstamped, the hold never released, and nothing would ever break the circle. That day's `/thread:orient-all` pass ran four-day-old rules: the every-rollout-at-once spike found that every vault chain claimed the whole vault because of it.

`/fresh-review`, which every Leg's review and every close's landing run, lives in `~/.agents`. Every profile's `skills/` links to it, so it too is read live from a checkout.

## Decision

1. **The Primary refresh.** A launchd job, `com.thread.primary-refresh`, runs `primary-refresh.py run` every 5 minutes. Each pass fast-forwards the Primary checkout to origin's default branch whenever ADR 0031's hold is clear. The hold is read through the primary's own `primary-hold.sh`, because that is the rule the rollouts reading the primary run by. A missing hold script, an error or a timeout holds. So the circle breaks at the first quiet moment: once the primary is current, new rollouts carry Engine snapshots and no longer hold it.

2. **Fast-forward only, never in the way.**
   - **What skips a pass:** an `index.lock`, a rebase or merge in progress, or a branch other than the default.
   - **The move:** `git merge --ff-only --no-autostash`, so git itself refuses to overwrite an uncommitted edit.
   - **Ahead of origin:** left to its landing route. A close's landing PR merges with `--merge`, so its commits become ancestors of origin and a later pass moves.
   - **Diverged:** never integrated (ADR 0042's rule).
   - **Notice:** Lachy is notified once, through `ntfy-push.py`, when a checkout stays stuck for 24 hours. A stuck spell runs from the first pass that cannot bring it current (it is no main checkout, it is busy, its fetch fails, git refuses the fast-forward, or it has diverged) to the next pass that reads current, moved, ahead or held. A held pass is a meant wait (ADR 0031), so it ends a spell. New commits on origin and a failed fetch never restart the clock.

3. **The other live-loaded checkouts.** Each `--also` checkout gets the same pass with no hold, because sessions already commit there in place, so a fast-forward is no different from a peer's commit. The job is installed with `--also ~/.agents`.

4. **It runs an installed copy and updates it.** `install` copies the script to `~/.local/state/thread/bin/` and points the job there with `--primary`. The job exists before the primary holds the script, and its path never moves. Whenever the primary's HEAD is its origin's tip as last fetched, however it got there (this job, merge-task's refresh, a pull), the copy is replaced by the primary's committed script, once it compiles. The working tree is never read, so a half-written edit never reaches the job, and a primary behind origin never downgrades it. A script inside any git work tree is source, never the installed copy, and is never rewritten.

5. **`/fresh-review` stays a shared skill.** Lachy, 2026-11-02, "Stay shared, kept current": it stays in `~/.agents`, which Thread Skill depends on, kept current by decision 3.

## Considered options

- **Move `/fresh-review` into the plugin.** It would be versioned with the plugin, so a rollout always reviews with the matching version. Rejected by Lachy: every session's review and Codex use it outside rollouts, so it would be renamed, lost to Codex, and need the global review rules and hooks re-pointed.
- **A Chorus-triggered refresh when the Stage goes quiet.** Chorus has no quiet hook (its `messages.py` quiet serves the Lunch restart), and a terminal-run rollout would not be covered.
- **The daily sweep.** It is push-only for own repos by design, and once a day would leave the primary behind for most of it.
- **Running the job from the primary's own file.** The job could not exist until the primary already held it, and that is exactly the stale case this ADR fixes.
- **Merging a diverged checkout.** That integrates under a live session's feet, against ADR 0042's rule for in-place twins.

## Consequences

- The primary is current within about 5 minutes of the last unsnapshotted rollout stopping. While one runs, the job logs `held: [[…]] running on it` each pass and moves nothing.
- `~/Library/Logs/thread-primary-refresh.log` gains a line per checkout per pass. The state file `~/.local/state/thread/primary-refresh.json` holds only the stuck entries.
- **Installing it is a one-time step** (README § The convergence engine, beside the Watchdog). Run `primary-refresh.py install --primary ~/repos/tools/thread-skill --also ~/.agents` from any checkout that holds the script, then run the `launchctl bootstrap` line it prints.
- **Limits.**
  - A checkout whose local commits never reach origin (unpushed in-place work) stays ahead and is never pushed by this job; pushing is its landing route's.
  - A pass that fast-forwards the primary in the seconds before a new unsnapshotted rollout's first command is the same race a manual pull always had. Once snapshots are cut it cannot recur.

## Files

`skills/_shared/scripts/primary-refresh.py`; `tests/primary-refresh.test.sh`; CONTEXT.md **Primary checkout** and **Primary refresh**; README § The convergence engine.
