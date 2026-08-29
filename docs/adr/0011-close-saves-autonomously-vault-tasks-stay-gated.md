# 0011 — close saves autonomously; vault tasks stay gated

Date: 2026-08-29
Status: accepted (supersedes close's original "Propose first, then wait" rule
for thread updates, auto-memory, and workspace knowledge)

## Context

Close's approval menu (one multiSelect per destination) was designed as the
safety gate for creative writes. In practice Lachy rubber-stamped every option
without reading — the gate filtered nothing, cost a decision point per close,
and the memory estate was drowning anyway: the ops-workspace index sat in
ALERT (222 lines, ~25–35% one-off residue), the global triage was 65 days
overdue, and a `temp_` memory four months past its self-declared flush date
proved the pattern — save-side discipline existed, prune-side execution did
not. A research sweep (mem0's ADD/UPDATE/DELETE pipeline, Letta's sleep-time
agents, Zep's supersede-don't-delete temporal metadata, MemoryBank's
recall-refreshed decay, the Claude Code plugin ecosystem) converged on the
same shape: gate at *curation time* with observed usage signals, not at *save
time* with menus.

## Decision

Grilled 2026-08-29, six rulings:

1. **De-gate everything except vault tasks.** Thread updates, auto-memory,
   and workspace knowledge auto-execute; the menu appears only when vault
   tasks are proposed (they surface on the daily agenda — the one destination
   with ongoing attention cost).
2. **Archive-first + provenance.** Nothing hard-deletes; prunes move to
   `.archive/` inside the scope's memory dir. Saves are stamped
   `provenance: close-inferred | user-explicit` — explicit saves get a higher
   prune bar.
3. **Weekly autonomous curator** (launchd, headless `claude -p`) with sole
   destructive authority; reversible ops only; changelog instead of approval.
4. **Daily recall harvest** from session transcripts — per-file
   `recall_count` / `last_recalled` / recalling scopes; the curator prunes on
   observed usage, not rated importance.
5. **First curator run is autonomous** like every other — confidence comes
   from a dry-run, not a one-off supervision gate.
6. **`/memory-triage` retired outright** (no alias stub); the curator absorbs
   scope demotion, evidence-driven by recall locations.

Close-side mechanics that make (1) safe: the four-verb save-time triage
(`ADD | UPDATE | SUPERSEDE | NOOP`, NOOP a success state) resolves every
candidate against existing memory before writing, and the frontmatter
contract (`captured`, `last_confirmed`, `status: provisional|active|
superseded`, `provenance`, `permanent`) gives the curator the levers.
Close-inferred saves land `provisional` — promoted on later recall, archived
if never recalled.

## Rejected

- **Fully autonomous including vault tasks** — the gate is theatre for disk
  writes, but a junk task pollutes the agenda until manually cleaned; that is
  maintenance, the thing this change removes.
- **Supervised inaugural curator run** — a one-time gate on the backlog
  cleanup. Rejected: archive-first makes every action reversible; the
  changelog is skimmable after the fact.
- **Keeping `/memory-triage` as a manual escape hatch** — two overlapping
  systems to keep in sync; the curator is itself manually invocable.
- **Hard-delete curation or git-versioning the memory dirs** — archive-first
  is lossless without new version-control machinery across 30+ scattered
  scope dirs.

## Consequences

- The frontmatter contract is a cross-repo interface: close (this repo)
  writes it; the curator (`~/.agents/skills/memory-curator`, state in
  `workspaces/_shared`) reads it. Change it in lockstep or not at all.
- If the curator stops running, provisional junk accumulates silently — the
  memory-audit curator-overdue alert (>9 days) is the tripwire.
- The ≥2-option `AskUserQuestion` quirk is handled inside the one surviving
  menu (a single task candidate gets an explicit Skip option); the ">4
  sections" merge prose died with the multi-section menu, and
  `triage-batching-protocol.md` §6's close cross-reference narrowed to the
  ">4 items" collapse.
- The Codex close adapter's description updated to the autonomous semantics.
- Doctrine repair rode along: dangling pointers to the deleted
  `base-instructions.md § Memory Management` now target
  `claude-base-instructions.md § Claude memory management`, and close's
  project-area file is canonically `AGENTS.md` (was `CLAUDE.md`).
