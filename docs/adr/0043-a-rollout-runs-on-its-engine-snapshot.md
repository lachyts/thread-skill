# 0043 — A rollout runs on its Engine snapshot

Date: 2026-10-21
Status: accepted. Ruled with Lachy in the 2026-10-21 grill that followed `chorus-rollout-2026-10-18` (83 h, 17 of 34 merged), built by P29. Supersedes ADR 0031's hold: the Primary checkout no longer has to stand still while a rollout runs.

## Context

Every rollout lead, in any repo, runs its scripts, its Workflow engine (`skills/execute/task.workflow.js`) and the skill prose it follows from the Primary checkout, live. ADR 0031 kept that checkout still while any Running rollout exists, and ADR 0042 froze each rollout's *target repo* in its clone, but nothing froze the *engine*. On 2026-10-21 the Primary checkout was 71 commits behind origin, the false-trip fixes p26-1 and p26-3 among them, and could not move. A three-day Chorus rollout held it, and moving it under the thread-skill rollout would have broken both leads at once: a changed engine sha turns every `resumeFromRunId` into fresh agent work, a changed CLI flag breaks the lead's next command (p26-3's `mark-started --arm-repo` would have failed the next start), and a signed-gate handle stops matching. Lachy had to stop both rollouts to update the skill.

## Decision

**A rollout runs on an Engine snapshot: a frozen copy of the Primary checkout at one commit, made when the rollout launches and named on its rollout note.** The lead takes its scripts, its Workflow `scriptPath` and the execute, status and repair prose from the snapshot for the whole run, never from the Primary checkout.

- **A rollout moves only at its Reinstate.** A pause followed by `/thread:execute` re-snapshots onto the Primary checkout as it then stands. Nothing moves a rollout's snapshot mid-run, by schedule or by the lead's own judgement.
- **The Primary checkout is free.** A pull, a landing's fast-forward or a plugin update reaches every new rollout and every Reinstate, and no running one. ADR 0031's `primary-hold.sh` holds only for a running rollout whose note names no snapshot (one launched before P29).
- **Snapshots are retired with their rollouts.** A snapshot no unfinished rollout note names is removed; one a note still names is never removed, a hard-paused one included.

## Considered options

- **Re-snapshot at a quiet boundary** (lane free, no call in flight): rejected. In a busy rollout that moment is rare and unpredictable, and Lachy wants to choose the moment himself.
- **Never move mid-rollout:** rejected. A multi-day rollout would miss every engine fix made during it, the very fixes that unstick it.
- **Keep ADR 0031's hold and make rollouts shorter:** rejected. It ties the plugin's release cadence to the longest rollout on the machine.

## Consequences

- Two rollouts can run on two engine versions at once. Their shared machine-wide state (verify slots, the Trickle's count, `~/.config/thread/*`) must stay readable across versions, so a change to its format is a migration, never a silent rewrite.
- The lead session's rendered skill comes from the Primary checkout, so on entry it reads its prose from the snapshot as a file, by `skills/_shared/plugin-root.md` (the root is the path read).
