# 0059 — Vault chains claim their own project places

Date: 2026-10-31
Status: accepted. Ruled with Lachy on 2026-10-30 (the Obsidian Vault orient session's grill): rollouts in different project folders of the vault run side by side, only a real folder overlap waits, and the rare same-note collision is accepted. The technical calls below were decided for him in the task note `thread-skill-p33-1-vault-chains-claim-their-own-folders` (Phase 33 · Task 1). Amends ADR 0040's *The vault is a note space* mechanic; folds in the follow-up `contacts-admin-followup-thread-schedule-serial-row-gives-a`.

## Context

ADR 0040 made the vault a note space, not a checkout, so that every chain writing its own task notes there would not make every pair of chains overlap. Its surface grammar still had three ways to reach the bare `vault` token, which overlaps every vault token:

- a member with no declared, derived or added surface got `vault` as the default, with a WARN;
- `serial-chains.py`'s claim turns any path equal to the vault root into `vault`: an alias whose launch folder is the vault, a `## Launch` span or `cd` on it, a project `Local:` on it, or an added `--surface` path;
- an alias-less member opened from the vault root whenever it held zero or several `repo:` surfaces.

On 2026-10-29 `contacts-admin-rollout-2026-10-29` went down the first two. Its rows launch from `~/repos/obsidian` and declare no `surfaces:`, so all five got `vault` (one through an added vault-root path). The Obsidian Vault serial chain (five tasks) then could not be scheduled at all, and the claim held for a day while that chain sat stuck. Lachy: "I want to be working with Rollouts more and more. Is there a way that we can be designing this so that we can have the different projects running side by side?"

The same rollout's two-repo row also showed the third path. It opened from the vault root, and `leg.py done` refuses a task whose `Task:` commits sit in a checkout other than its Leg's own (`changed <top>, not this Leg's checkout`), so the row could never be finished.

## Decision

1. **A member's vault claim is its project place and its own task note.** On a root hit (any derived or added path that is the vault root), or when nothing else gives it a surface, a member claims its first project's place and its own task note (`vault:Work/Tasks/<slug>.md`, or its `Archive/` path as found). Both are relative to the vault path schedule reads, never a realpath. The place depends on the project note:
   - a **folder note** (`<dir>/<dir>.md`, with `<dir>` strictly below `Work/Projects`) claims its folder, `vault:<dir>`, so a project inside it shares the umbrella's chain;
   - a **flat note** (`<area>/<name>.md`) claims itself and the folder it would become: `vault:<area>/<name>.md` and `vault:<area>/<name>`.

   The flat note takes both forms because `vault:<area>/<name>` alone does not overlap the literal note path `vault:<area>/<name>.md`. A member whose `## Launch` span or declaration names the note itself would then miss the chain. The two forms cover a flat-to-folder-note conversion in either direction. The cost is one more token per flat-project member, and a pre-existing `<name>/` folder beside the note is claimed too, which is the conservative reading.

2. **Bookkeeping is never a claim.** A derived path at or under `Work/Tasks` (task notes, rollout notes, the engine's stamps, Leg log and Needs-you log) is dropped silently. An added path there is dropped with a WARN naming the literal token that claims one on purpose (`vault:Work/Tasks/...`). A literal token (`vault`, `vault:<rel>`, `ext:`, `any`) passed to `--surface` is kept as written, and so is every declared token, a declared `repo:` that claim maps to `vault` included. A declaration is deliberate.

3. **Bare `vault` remains only where nothing narrows it.**
   - A member that names no project and no path claims `vault` with the default WARN, verbatim (`source: default`).
   - A member with a root hit and no project claims `vault` with a WARN to link its project (`source: derived`).
   - A first project named with no note under `Work/Projects` gets a WARN and counts as none.
   - An added vault-root path narrows like a derived one, with a WARN that says so. Only the literal token `vault` claims the whole vault on purpose.
   - A root hit that narrows is the normal vault case and draws no WARN.

4. **A code row never opens where its Leg cannot finish it.** `serial-chains.py plan` refuses (exit 3) the two cases this ADR found:
   - an alias-less member that writes two or more checkouts, where a checkout is a `repo:` surface that is a git toplevel;
   - an aliased member whose launch folder is in the vault while it writes a checkout.

   An alias-less member with exactly one checkout opens from it, ahead of any path-only `repo:` token. Each refusal names its remedies: a `launch:` in the checkout it commits to, one task per checkout chained by `depends-on:`, or a declaration that leaves out a checkout it only reads.
   - The vault test compares realpaths, case-folded, exactly as claim does. A symlinked or case-variant alias is caught.
   - The refusal is applied only after ruling (c), so a session-lane member is never refused for its launch.
   - An aliased member in checkout A that also claims checkout B (a workspace `--add-dir`, a project `Local:`) is unchanged. Refusing it would match `leg.py done` exactly but would refuse real workspace chains, so that wider rule is left out.

5. **The same-note collision is accepted.** Two chains in different project places can still both write one Day note or one contact. Lachy accepted this risk: it is the one he already lives with when several sessions are open.

## Considered options

- **Drop `.md` from a flat project's token** (`vault:<area>/<name>` only). Rejected: it no longer overlaps a literal note-path claim (checked: `overlaps("vault:…/Contacts admin", "vault:…/Contacts admin.md")` is false).
- **Narrow `claim` itself**, so the vault root never yields `vault`. Rejected: claim would then lie about a path, and its callers (a declared `repo:`, `unfinished-rollout.py`'s parallel Project root) want the truthful token. The narrowing lives in the plan instead.
- **Refuse every row whose launch is not in each checkout it claims.** Deferred: it matches `leg.py done` exactly but refuses the workspace chains ADR 0040 built for.
- **Re-derive legacy notes automatically.** Rejected: a schedule never rewrites another chain's note.

## Consequences

- Vault chains in different project places no longer overlap, so `unfinished-rollout.py check --shape serial` lets them schedule side by side. Two chains in one project place still refuse.
- **Limits.**
  - A legacy note (e.g. `contacts-admin-rollout-2026-10-29`, `surfaces: vault`) is not re-derived. It blocks every vault chain until it is done, dropped or narrowed by hand. Amended by ADR 0060 (p33-2): while it is stuck it holds only its unlanded rows' cells, but a legacy row's own cell is `vault`, so its stuck row still holds the whole vault.
  - A project renamed, moved to another area or archived between two schedules gives disjoint tokens, so two chains on it would not meet.
  - An area note read as a folder note (`AI/AI.md`, `Life (area)/Life (area).md`) claims its whole area. This is conservative.
  - A `|` in a project path would break the serial note's Queue cell. QuickAdd strips only `/` from names.
- `serial-chains.py`'s header, CONTEXT.md **Surface**, **Serial rollout** and **Unfinished rollout**, schedule § Serial path and the serial template's legend carry the rule. `tests/serial-chains.test.sh` P7 pins it.
