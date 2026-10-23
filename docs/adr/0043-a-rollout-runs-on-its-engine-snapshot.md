# 0043 — A rollout runs on its Engine snapshot

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18` (83 h, 17 of 34 merged), built by P29. Supersedes ADR 0031 in part (§ Decision), so the Primary checkout no longer has to stand still while a rollout runs.

## Context

Every rollout lead, in any repo, runs its scripts, its Workflow engine (`skills/execute/task.workflow.js`) and the skill prose it follows from the Primary checkout, live. ADR 0031 kept that checkout still while any Running rollout exists, and ADR 0042 froze each rollout's *target repo* in its clone, but nothing froze the *engine*. On 2026-10-21 the Primary checkout was 71 commits behind origin, the false-trip fixes p26-1 and p26-3 among them, and could not move. A three-day Chorus rollout held it, and moving it under the thread-skill rollout would have broken both leads at once: a changed engine sha turns every `resumeFromRunId` into fresh agent work, a changed CLI flag breaks the lead's next command (p26-3's `mark-started --arm-repo` would have failed the next start), and a signed-gate handle stops matching. Lachy had to stop both rollouts to update the skill.

## Decision

**A rollout runs on an Engine snapshot: a frozen copy of the plugin at origin's tip of its default branch, fetched fresh when `/thread:schedule` writes the rollout note and named on it.** Schedule writes the note, its queue and its task stamps with that snapshot's own scripts, so the note and the engine that reads it are one version. Never the Primary checkout's working state: a branch, an unpushed commit or a stale checkout there reaches no rollout.

- **A rollout moves only at its Reinstate.** A pause followed by `/thread:execute` re-snapshots onto origin's tip as it then stands, and migrates the note to it. Nothing moves a rollout's snapshot mid-run, by schedule or by the lead's own judgement.
- **The Primary checkout is free to move.** A pull, a landing's fast-forward or a plugin update reaches no rollout; what reaches a new rollout or a Reinstate is origin's tip. ADR 0031's `primary-hold.sh` holds only for a running rollout whose note names no snapshot (one launched before P29). The plugin's hooks are the exception (Consequences).
- **Everything acting on a rollout reads its snapshot first.** Its lead (scripts, Workflow `scriptPath` and skill prose, for the whole run), execute, status and repair from any session, and any write to it from outside (a supersede's stamps, carry and canary retire, the close-out tune line) hand over to the snapshot its note names before any step that depends on a version, execute's protocol gate included. So a protocol change on origin never refuses a rollout on an older snapshot, and between Reinstates one version writes a rollout's canary records, Run record and note lines.
- **Snapshots are retired with their rollouts.** A snapshot is removed once every rollout note naming it is archived; one a live note names is never removed, a hard-paused one or one past its last merge included.

## Considered options

- **Re-snapshot at a quiet boundary** (lane free, no call in flight): rejected. In a busy rollout that moment is rare and unpredictable, and Lachy wants to choose the moment himself.
- **Never move mid-rollout:** rejected. A multi-day rollout would miss every engine fix made during it, the very fixes that unstick it.
- **Keep ADR 0031's hold and make rollouts shorter:** rejected. It ties the plugin's release cadence to the longest rollout on the machine.

## Consequences

- Two rollouts can run on two engine versions at once, and a Reinstate crosses versions. Three things must stay readable across versions, so a change to their format is a migration, never a silent rewrite:
  - the shared machine-wide state (verify slots, the Trickle's count, `~/.config/thread/*`);
  - a rollout's own earlier state, which its newer snapshot reads after a Reinstate;
  - what a reader across rollouts reads (the Run record a Reflection or the Watchdog reads, the notes the Trickle counts).
- **The rollout settings file stays readable by an older snapshot.** Today `rollout-settings.py` refuses a key it does not know (p15-4, ADR 0032), so one paused rollout on an older snapshot would refuse every newer key and halt. Instead the file carries its schema version, and a snapshot ignores a key newer than itself while it still refuses a typo, so a new key can be written at any time.
- The snapshot does not cover the plugin's hooks, which run from the Primary checkout, so the Stop-hook driver and the line it parses stay compatible with every snapshot still running.
- A session's rendered skill comes from the Primary checkout, so a lead reads its prose from the snapshot as a file.
