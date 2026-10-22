# 0043 — A rollout runs on its Engine snapshot

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18` (83 h, 17 of 34 merged), built by P29. Supersedes ADR 0031 in part: its hold covers only a running rollout whose note names no Engine snapshot, so the Primary checkout no longer has to stand still while a rollout runs.

## Context

Every rollout lead, in any repo, runs its scripts, its Workflow engine (`skills/execute/task.workflow.js`) and the skill prose it follows from the Primary checkout, live. ADR 0031 kept that checkout still while any Running rollout exists, and ADR 0042 froze each rollout's *target repo* in its clone, but nothing froze the *engine*. On 2026-10-21 the Primary checkout was 71 commits behind origin, the false-trip fixes p26-1 and p26-3 among them, and could not move. A three-day Chorus rollout held it, and moving it under the thread-skill rollout would have broken both leads at once: a changed engine sha turns every `resumeFromRunId` into fresh agent work, a changed CLI flag breaks the lead's next command (p26-3's `mark-started --arm-repo` would have failed the next start), and a signed-gate handle stops matching. Lachy had to stop both rollouts to update the skill.

## Decision

**A rollout runs on an Engine snapshot: a frozen copy of the plugin at origin's tip of its default branch, fetched fresh when the rollout launches and named on its rollout note.** Never the Primary checkout's working state: a branch, an unpushed commit or a stale checkout there reaches no rollout. The lead takes its scripts, its Workflow `scriptPath` and the execute, status and repair prose from the snapshot for the whole run, never from the Primary checkout.

- **A rollout moves only at its Reinstate.** A pause followed by `/thread:execute` re-snapshots onto origin's tip as it then stands. Nothing moves a rollout's snapshot mid-run, by schedule or by the lead's own judgement.
- **The Primary checkout is free to move.** A pull, a landing's fast-forward or a plugin update reaches every new rollout and every Reinstate, and none of a running rollout's scripts, engine or prose. ADR 0031's `primary-hold.sh` holds only for a running rollout whose note names no snapshot (one launched before P29). The plugin's hooks are the exception (Consequences).
- **A rollout is touched only by its own engine.** Any verb acting on one rollout (execute, status, repair) takes its scripts and prose from that rollout's snapshot, whichever session runs it, so between Reinstates a rollout's canary records, Run record and note lines are written by one version only. A Reinstate crosses versions, so those formats follow the migration rule below.
- **Snapshots are retired with their rollouts.** A snapshot is removed once every rollout note naming it is archived; one a live note names is never removed, a hard-paused one or one past its last merge included.

## Considered options

- **Re-snapshot at a quiet boundary** (lane free, no call in flight): rejected. In a busy rollout that moment is rare and unpredictable, and Lachy wants to choose the moment himself.
- **Never move mid-rollout:** rejected. A multi-day rollout would miss every engine fix made during it, the very fixes that unstick it.
- **Keep ADR 0031's hold and make rollouts shorter:** rejected. It ties the plugin's release cadence to the longest rollout on the machine.

## Consequences

- Two rollouts can run on two engine versions at once. Their shared machine-wide state (verify slots, the Trickle's count, `~/.config/thread/*`) what a Reinstated rollout's newer snapshot reads of its own earlier state, and what a reader across rollouts reads (the Run record a Reflection or the Watchdog reads, the notes the Trickle counts) must stay readable across versions, so a change to its format is a migration, never a silent rewrite.
- The rollout settings file is the sharpest case: an older snapshot refuses a key it does not know (ADR 0016), so a key only a newer snapshot knows is not written while an older one runs.
- The snapshot does not cover the plugin's hooks, which run from the Primary checkout, so the Stop-hook driver and the line it parses stay compatible with every snapshot still running.
- A session's rendered skill comes from the Primary checkout, so a lead reads its prose from the snapshot as a file.
