# 0012 — process candidates flow to the project's METHOD.md

Date: 2026-09-01
Status: accepted

## Context

On Mountain in the Sea Romance, the project's process lived in no single
conversation: copy developed in a Codex thread, images across many Claude
sessions, and the braid between them existed only on disk. The copy thread's
reasoning survived only because Lachy happened to ask for a snapshot before
closing it — capture depended on remembering. A re-scope grill (2026-09-01,
recorded in the vault's Method Skill project note) produced a standalone
`method` skill (`~/.agents/skills/method/`): one `METHOD.md` per project with a
gate-protected `## Method` section (the replayable method, written only after
Lachy's explicit confirmation) and an append-only, statused `## Candidates`
section any agent may write. Close is the natural capture moment — it is
already the ritual where the conversation is walked for what must not be lost.

## Decision

Close's scan gains a seventh category, **process observations**: a genuine
stage-shift, pivot, reusable move, revealing failure, or cross-workstream
effect in how the project is being made. The bar is stage-gated, never
per-iteration — most closes produce none, and NOOP is the expected outcome.
Hits append autonomously to the project's `METHOD.md` `## Candidates` (file
created from `~/.agents/skills/method/METHOD-template.md` on first write),
dated, source-attributed and evidence-linked.

Autonomy is safe by the same argument as ADR 0011: the Candidates section is
explicitly non-curated, entries are provenance-stamped and reversible — close
itself auto-commits the METHOD.md file in its containing repo immediately
after the append (Execute step 3; fresh-review 2026-09-01 caught that leaning
on the daily sweep left a window, and that the monorepo's prune list — TSMS/,
_archive/, Tutorials/, unlisted nested repos — makes sweep-only versioning
false in parts of the tree) — and the approval gate sits downstream: nothing
reaches `## Method` without Lachy confirming a `/method` propose. Close
appends candidates; it never synthesises, because a thread sees only its own
slice — filesystem-wide reconciliation belongs to `/method`. Category 7 fires
only on closes that resolve a project directory; shared-thread and no-project
closes NOOP it.

## Rejected

- **Close owns the synthesis** — a thread's view is structurally incomplete;
  canonising from one slice is exactly the failure the method skill exists to
  prevent.
- **Ask-before-append** — re-introduces the per-save gate ADR 0011 removed,
  for a section that is non-curated by design.
- **A separate candidates ledger file** — folded into `METHOD.md` as a
  section during the re-scope; one surface per project, no empty scaffolds.
- **Capture via harness session stores instead of close** — transcript
  archaeology is fragile and enormous; capture-at-close is the only door for
  chat-only material.

## Consequences

- The `METHOD.md` section contract (append-only Candidates, gate-protected
  Method) is a cross-repo interface: close (this repo) writes candidates; the
  `method` skill (agents-config repo) owns reconcile/propose/apply. Change the
  entry format in lockstep or not at all.
- Stash/defer/handoff are deliberately untouched — they are low-energy exits
  and must not force a process pass. *(Amended by ADR 0014, 2026-09-01: stash
  and defer now run the scan silently; handoff remains untouched.)*
- If capture proves too chatty in practice, tighten the category-7 bar here
  rather than adding an approval gate.
