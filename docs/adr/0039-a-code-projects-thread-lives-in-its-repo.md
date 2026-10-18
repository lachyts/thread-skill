# 0039 — a code project's thread lives in its repo

Date: 2026-10-18
Status: accepted (amends ADR 0017's p2-7 amendment: the repo-thread lookup; thread-skill-p23-5, run 2 of
`[[thread-skill-rollout-2026-10-18]]`)

## Context

The GifLab orient of 2026-10-18 found Chorus listing GifLab twice, at `~/repos/animately/giflab` and at
`~/Projects/Animately/giflab`, and compression-engine the same way. Chorus groups Sessions purely by working
directory, so a project whose thread lives in a folder beside its repo splits in two; and handoff's `Run from:`
defaults to the producer's directory, so one session started in the thread folder propagates there. The cause was in
this plugin: open § Creating a new thread offered only `~/Projects/<Area>/<Project>/THREAD.md` or
`_shared/threads/<slug>.md`, so a project with a code repo got a thread folder *beside* the repo. Repo threads
(`<repo>/THREAD.md`, found by open's lookup, ADR 0017's p2-7 amendment) already existed and every tool repo used
them, but creation never chose one.

GifLab had also grown `THREAD-leaderboard.md` and `THREAD-region-trainer.md` beside a superseded `THREAD.md`. Every
tool keys on the exact name, so the live thread was invisible to `/thread:open <slug>` and close-out landing refused
it; the 2026-10-17 rollout session committed around it by hand. Both projects were migrated by hand on 2026-10-18.
The estate audit the same day found more: workspace seat subfolders holding threads the lookup never reaches, repos
one level deeper than the lookup's depth 3 (`tools/mcp/*`), threads whose slug differs from their folder name,
`~/Projects` threads with no `slug:`, a thread home behind its default branch, and a `THREAD.md` that exists only on
a side branch.

## Decision

1. **The creation rule (d1).** A project's thread home is the first *qualifying* repo in its note's `repos:`; open
   § Creating a new thread's first row creates `<repo>/THREAD.md` there. A repo qualifies when it meets all three
   tests:
   - it is a main checkout: its `.git` is a directory. A `.git` file (a linked worktree, a submodule, a
     `--separate-git-dir` checkout) never qualifies;
   - it sits at most three directories below `~/repos`, so its THREAD.md is inside the lookup's depth 4;
   - it is outside `~/repos/obsidian`, `~/repos/workspaces`, any `.claude` and any `_archive`.

   `~/Projects/<Area>/<Project>/` is for a project with no code repo, and `_shared/threads/` for cross-workspace or
   meta work.
2. **One live thread per project, always named `THREAD.md` (d2).** A finished or parked arc moves to
   `docs/threads/<slug>.md` in a repo, or to `_archive/` under `~/Projects`; it never becomes a sibling
   `THREAD-<name>.md`. **Why the tools are not taught named threads:** every tool keys on the exact name — land.sh's
   `closeout_shaped` (:183), git-env-canary.py (:70, :235), pushed-base.sh (:152, :159, :238, :254), open's
   `find -name THREAD.md`, and close's rungs and step 7.1. Widening the lander's close-out test would widen what
   land.sh pushes unreviewed, and every reader would need its own rule for which named file is the live one. GifLab's
   `THREAD-leaderboard.md` is the worked failure. The hardcoded name stays the contract.
3. **Workspace seat subfolders are not thread homes (d3).** A thread in `~/repos/workspaces/<seat>/<dir>/` is
   invisible to the lookup, which excludes the workspaces repo on purpose. Seat-hosted work keeps its thread in
   `_shared/threads/<slug>.md`; making a seat subfolder a home would need a fourth lookup tier and a second
   ownership rule for its handoffs, for threads that already have one.
4. **The lookup (d4).** open § Repo-thread lookup reaches find depth 4, skips any `_archive`, and matches a repo
   thread by its effective slug or by its directory's name. The effective slug written into docs (a handoff doc's
   `thread:`, close's scan input) is unchanged.
5. **The placement check, its attribution and its identity (d5).** `skills/_shared/scripts/thread-placement.py`
   reports, read-only, where each thread sits against its home. Its kinds are `split-home`, `misnamed`,
   `undeclared`, `no-slug`, `behind`, `side-branch` and `workspace`; the first is named `split-home` so it never
   reads as the reshuffle verb `split` that ADR 0027 retired.
   - **A folder's note.** A `~/Projects` directory belongs to a note, in order: resolve-target's directory rungs
     (ADR 0036) resolve it at rung `directory` and the declared entry they matched lies at or below the folder's own
     directory; or they resolve it at rung `directory-name` with an exact hit; or exactly one live note declares a
     qualifying repo named like the folder. An ancestor entry, such as `~/Projects/Narcissus` seen from
     `Narcissus/show-images`, attributes nothing (it only owns the folder's findings). A fuzzy hit, a workspace-rung
     answer or an ask attributes nothing.
   - **`home` follows only a declared repo.** `thread-placement.py home` prints the folder note's first qualifying
     repo, never anything else. A same-named git repo that no note declares is audit-only: the brief's "or a
     same-named git repo exists" is what the audit reports, and it never decides where a thread or a launch goes.
   - **Identity.** A repo-tier finding is reported once per thread identity, `<home repo>/<path below its
     toplevel>`, never once per copy. A linked worktree reads as its main checkout, and an undeclared clone as the
     one declared repo that shares its origin. Git checks run per main checkout, never for a linked worktree. The
     finding names every copy on disk, and its path may exist only in a worktree.
6. **The wirings (d6).** orient § 2 runs the audit for its target, report-only; close rung 1 asks `home` before it
   creates a thread in a `~/Projects` folder, rung 2 takes a picked-up handoff doc's `thread:` as a reference, the
   ownership rule leaves another thread's docs alone when the active thread lies outside `<home>`, and steps 1 and 8
   warn with the audit; open's creation table starts with the repo row; and handoff **Split launch.** sends the
   consumer to the repo in three cases, which also say which thread the consumer's close writes. **Case 3 narrows
   "default to the repo".** The task that asked for this (thread-skill-p23-5, item 4) defaults `Run from:` and
   `create_thread`'s `cwd` to the repo with no exceptions. Split launch moves a launch only for the launch folder's
   own thread, or when no thread is active. A `_shared` thread, another repo's thread or another folder's thread (one
   close rung 2 resolved) active in a `~/Projects` session means the work is not this folder's project's. Sending its
   consumer into this project's repo would launch it beside a thread it does not continue, where that repo's own
   THREAD.md could capture it. So `Run from:` stays at the launch directory, and the skip is printed.

## Considered options

- *Teach the tools named threads:* rejected by d2; every reader would need a liveness rule, and land.sh's
  unreviewed push would widen.
- *Make a workspace seat subfolder a thread home:* rejected by d3.
- *Report a worktree copy at its own path:* one cause would read as two findings (giflab and its
  `-wt-structure-audit-2026-10-18` copy today), and the fix lands in the main checkout anyway; d5 reports the identity
  and names the copies.
- *Let `home` follow a same-named repo no note declares:* it would move launches and create threads in a repo no
  project claims; d5 keeps the guess in the audit.
- *A deterministic filter in handoff-scan.sh for the outside-`<home>` ownership exception:* left out, like the
  existing multi-thread exception, to keep the scan's contract and its test unchanged; about three script lines if
  a later review asks for it.

## Consequences

- Migrations belong to project-structure-audit, not this decision: the six code-project threads still in `_shared`
  (event-scanner, raycast-agent-quotas, mac-data-mcp, intercom-rest-mcp, oura-mcp, overlay-carousel-bakeoff), the
  workspace subfolder threads and the product-design "Moved to" stub. Chorus is unchanged.
- Depth 4 surfaces worktree copies kept outside `.claude` (`animately/optimizer-worktrees/structure-audit-2026-10-18`).
  The lookup's CWD tiebreak and its several-hits ask cover them, and the placement check folds them into their main
  checkout's identity.
- SEO becomes a `split-home`: its note declares `~/repos/animately/animately-SEO`, while its live thread is
  `~/Projects/Animately/seo/THREAD.md`, attributed by exact name, with `slug: animately-seo`. Until
  project-structure-audit decides, an SEO handoff with that thread active launches in the repo by split launch case 2.
- **Two-repo projects:** a project's home is its first `repos:` entry.
  - Event Scanner lists `event-scanner` first, so its migration lands its thread there with no reorder.
  - Murmur's second repo `cmux-fork-murmur` holds a THREAD.md, which reads as a repo-form `split-home`.
  - Smart Slider lists `prototype-simple-slider-ui` first, while its running thread moved to `optimizer/THREAD.md`
    on 2026-10-18; so far that file is only on `chore/structure-audit-2026-10-18`, in the linked worktree
    `optimizer-worktrees/structure-audit-2026-10-18`. The check reports a repo-form `split-home` at
    `~/repos/animately/optimizer/THREAD.md` and a `side-branch` on `optimizer`, both under Smart Slider, and d1 would
    point a *new* Smart Slider thread at the first repo, against the migration under way. project-structure-audit
    either reorders Smart Slider's `repos:` (optimizer first) or moves the thread; the `side-branch` clears once that
    branch merges to `develop`.
- Close's rung 2 now reads a picked-up doc's `thread:` for every consumer; an unfound one falls through to rungs
  3–5 exactly as before, while a slug named in the conversation still never reaches rung 3.
- The ownership exception for an active thread outside `<home>` also protects any rung-2 close of another repo's
  thread, not only a split launch's consumer.
- This amends ADR 0017's p2-7 amendment (the lookup's depth, `_archive` and the directory-name match).
