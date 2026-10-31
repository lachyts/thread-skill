# 0060 — orient-all sweeps low-thinking work; big projects keep their own sessions

Date: 2026-10-31
Status: accepted. Grilled with Lachy on 2026-10-29, mid `/thread:orient-all`; written for the vault task
`thread-skill-p35-1-orient-all-sweeps-low-thinking-work` (Phase 35 · Task 1), whose Decisions 1-7 he settled that day
and whose plan was judged before the build. Amends ADR 0041's Decision item 3 ("Orient-graded projects get their own
child `orient` session, whatever the budget") and "It starts everything itself"; both now read through this record.

## Context

On 2026-10-29 the estate pass asked Lachy Chorus ADR and design questions as One calls, which he could not answer
without the whole project in view. In his words, merged into the task: "I'm really struggling in this thread, the
orient-all question thread, because I'm just not getting enough context around these questions that are being asked
of me. I wonder if orient-all should probably be related to smaller projects rather than bigger projects like
chorus." And: "for bigger projects I don't want to have an agent that has context of the whole Obsidian vault. I want
it to have the context of that particular project."

The same pass filtered `rank.json` by hand in scratch, because `estate-dispatch.py`'s `rounds`, `plan` and `sessions`
had no project filter, and it started child orients for every Orient-graded project with nothing ticked.

## Decision

Lachy's, as he settled them on 2026-10-29:

1. **Purpose.** orient-all sweeps up work that needs little of *his* thinking and has been sitting idle. Agent size
   does not matter: an L task qualifies if it needs nothing context-heavy from him.
2. **Big versus small is a project property, not a task count.** A big project has its own design record. His
   hand-cut list that day: AVP show, Agent Reader, Agent Stable, Audio Intake, Check Engine, Chorus, Colocated XR,
   Compression Engine, Echo prototype, Event Scanner, Focus App, GifLab, Ikeda-style AV prototype, Local LLM rig,
   Maquette, Morning and Weekly Commands, Murmur, Narcissus, Obsidian Vault, Overlay Carousel, SEO, Smart Slider, Taste
   System, Thread Skill, Video Watchlist System. A bare THREAD.md is too weak a signal; the exact test is below.
3. **Big projects send no questions to orient-all.** Their decisions wait for that project's own orient session.
4. **orient-all never schedules a rollout for a big project.** Rollouts for big projects are scheduled only in that
   project's own session: a session holding context across many projects must not work one out.
5. **Big projects reach him through one pick list at the end of the pass**, the top projects by idle ready work and
   piled-up decisions. He ticks which to open, and only those start; each opened session orients and schedules its
   own rollout. Nothing big-project-shaped starts by itself.
6. **Small, list-style projects** get their quick calls asked in the pass, and their ready work scheduled and started
   by it. Anything needing his hands, money or a message still waits for his yes.
7. **Technical calls are never asked** in the decision round, even for small projects: the pass decides them and lists
   them as Decided for you (ADR 0054). On 2026-10-29, 18 of 25 small-project One calls were technical.

## Decided for him (overturnable)

- **The big-project test.** The project note's `orient:` key, `own` or `sweep` (read stripped and case-blind), wins.
  With no valid key, a project is big when one of its declared `repos:` paths is absolute after expanduser, is a
  directory, and holds both a `CONTEXT.md` file and a `docs/adr/` directory with at least one `*.md` file; otherwise
  it is small. `estate-scan.py` writes it as each project row's `ownSession {own, by, repo, invalid?}`, with plain
  reads that run under `--deadline 0` too. Scored read-only against his list in the live vault, the derived test
  found 18 of the 25. Its one false positive, Unicorse Costume, is parked; requiring both files keeps Mac Data MCP (an
  ADR folder alone) small. It missed seven: Agent Stable, Colocated XR, Compression Engine, Narcissus, Obsidian Vault,
  SEO and Video Watchlist System. Those seven carry `orient: own` and Unicorse Costume `orient: sweep`, seeded with
  this build, so the list reads exactly as he cut it.
- **The pick list is built by `plan` and asked at the end (orient-all § 7).** Its candidates: every big project with
  any of Ready unheld tasks, his decisions waiting (One call and Grill `decisions[]`), Orient tasks, pending sign-offs
  on its live rollouts, or a held live-rollout item (a live rollout of its own whose status action would give an
  execute or repair item, or whose pending sign-offs the repair below asks); and every small project with an
  Orient-graded task (the rank's `orient[]`, parked homes
  out). A small project's counts are its Orient tasks alone, since the pass asks and schedules the rest of its work.
- **The ranking key**: parked last; due soon first (any of its tasks within `DUE_SOON_DAYS`), the earliest deadline
  first; crowned first; weight, highest first (ready + decisions + orient + sign-offs + held items); then the ready
  count; then the oldest `captured` among its counted tasks (none last); then name and note.
- **The question**: one AskUserQuestion multiSelect question of the top `PICK_MAX` = 3 projects and the fixed `Not now`,
  the whole ranked list printed just before it. Each option says what opening it starts: a big project's orient session
  (its One calls and Grills, its rollout), its held rollout items, and the repair that asks its sign-offs; a small
  project's orient session. Two projects of one name (two `SEO.md` in different folders) are each linked by the note's
  path, in the option, the orient prompt and the session title, and every one of their labels is numbered, the first
  included; a ticked label opens its own option alone. His typed words may name any candidate, beyond the top 3
  included; words that match nothing are reported, never an error. Three plus `Not now` is AskUserQuestion's four
  options; whether it accepts an empty selection is unverified, which `Not now` covers.
- **It is asked whatever the budget**, a budget of 0 and a Grill "stop" included, as sign-offs are. A dry run prints
  it and never asks it.
- **Big projects are still graded**, for the pick list's counts and the Grade log only. The pass asks none of their
  One calls, Grills, Unpark offers or sign-offs.
- **Their sign-offs wait**, `ask: false` with why `own session` (after the unread, paused and draining reasons, which
  hold a small project's too), charged no minutes. `/thread:orient` has no sign-off step: repair § 1 runs
  `approve-gates`. So opening the project also starts `/thread:repair [[<rollout>]]` for each live rollout of its own
  whose pending sign-offs a repair can ask (no drain, and no pause but the sign-off pause), even where the status
  action gives no item: an unsigned gate under the sign-off pause reads action 8, which the allow-list gives nothing.
  The orient prompt names that repair and leaves the gates to it. Each waiting sign-off is named in the report with its
  way out: tick the project on the next pass's pick list, which starts that repair, or run it yourself.
- **Their live rollouts get no execute or repair item** unless the project is ticked.
- **A ticked small project's orient prompt** says only that it was ticked for its Orient tasks: the pass asks and
  schedules the rest of its work, so a big project's own-session line would be wrong there.
- **A parked big project gets no Unpark offer.** It sits on the pick list, ranked last.
- **A small task that depends on a big project's open, not-in-flight task** is skipped in the rounds (not asked),
  naming the project and the task, and held in the plan (`dependency not scheduled`).
- **A small project's Orient tasks no longer start a child orient by themselves.** They become pick-list candidates.
  This changes ADR 0041 d3, read through Decision 5's "nothing … starts by itself".
- **The filter lives in `estate-dispatch.py`'s `rounds`, `plan` and `sessions`**, never in `estate-rank.py`:
  `preflight`, `record`, `decided-for-you` and `log` are unchanged, so schedule's Pre-flight, run inside a big
  project's own session, still asks its decisions there (Decision 3).
- **The pick list lives in `plan`, not in `rounds`**: Decision 5 puts it at the end of the pass, the held-item count
  needs `plan`'s rollout holds and the status numbers, and `sessions` matches `--open` against `plan.pick[]`.
- **orient-all's description is unchanged.** A description change needs a human eval baseline (the Makefile), and
  its "starts … child orients" stays true for the projects he ticks.
- **"Found while applying it" (one serial chain holding the vault)** is answered by ADR 0059, on master since PR #253:
  vault chains claim their own project places, so small projects' vault chains run side by side. No new mechanism.

## Considered options

- **THREAD.md depth as the test.** Rejected: Ice frame (small) has 208 lines, Colocated XR (big) 108.
- **An ADR folder or a CONTEXT.md, either one.** Rejected: it makes Mac Data MCP (ADR only) big.
- **The inverse, "no repo means small".** Rejected: several of his big projects (Obsidian Vault among them) declare no
  repo, and many small ones declare one.
- **Skip grading the big projects.** Cheaper, but it loses the pick list's counts and the Grade log. The grading
  costs agent tokens, never his attention.
- **The pick list in `rounds` (orient-all § 4).** Rejected: it would be asked before the pass has scheduled anything,
  against Decision 5's "at the end", and `rounds` has no status numbers for the held items.

## Consequences

- The vault seed landed with this build: seven project notes gained `orient: own` and Unicorse Costume `orient:
  sweep`, each one in-place frontmatter key (next-action's one-key edit, re-parsed). His Decision 2 list is the
  authority; deleting the key reverses it.
- A project added later is read by its design record unless it carries the key.
- The vault schema doc (`~/repos/workspaces/_shared/knowledge/obsidian-schema.md` § Project) gains the `orient:` bullet
  in that repo, after this build; nothing reads the doc, so the pass does not wait on it.
- `estate-scan.py` (`ownSession`), `estate-dispatch.py` (`rounds.ownSession[]` and `warnings[]`, `plan --status`,
  `pick[]`, `pickAsk` and `pickIndex`, `sessions --open`, `--typed` and `unmatched[]`, and an opened big project's
  sign-off repair), `skills/orient-all/SKILL.md`
  §§ 2-4 and 6-9, `skills/_shared/readiness-grade.md`, `skills/_shared/asking.md` § 6, ADR 0054 § Sites, CONTEXT.md
  (**Big project**, **Small project**, **Pick list**) and the README carry it. `tests/estate-scan.test.mjs` 19,
  `tests/estate-dispatch.test.mjs` D23 and `tests/contracts/orient-all.test.mjs` o12 pin it.
- A running big rollout's gated task waits longer than it did: its sign-off and its execute or repair item hold until
  he ticks the project, which starts the repair that asks the sign-off, or runs repair himself. The wait is visible:
  the project becomes a pick-list candidate, and the report names the repair command.
