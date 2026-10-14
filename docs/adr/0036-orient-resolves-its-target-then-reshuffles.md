# 0036 — orient resolves its target before it reads, then reshuffles without asking

Date: 2026-10-14
Status: proposed, d1–d4 implemented by p20-1; d5, d6 pending (p20-2, p20-3). P20, orient's front
door; amends ADR 0027's three-way question and ADR 0026's drift authorisation; from the 2026-10-14
`/thread:orient Thread Skill` grill.

## Context

Lachy starts most orients from a project's own directory and then has to point the orient at the
Obsidian project anyway. Orient § 1 says a bare invocation "infers the area from CWD", but only in
prose: there is no resolver, so each session works it out by hand, and an area-level answer makes
§ 2 sweep the whole top-level vault folder (every project under `AI/`, not Thread Skill). 65
project notes already declare `repos:`; only `~/repos/workspaces` is claimed by more than one
project. Dated project directories under `~/Projects/<Area>/` are mostly declared nowhere.

He also picks **Reshuffle** at every orient, so the question costs a turn and buys nothing: the
reshuffle writes nothing before its gate and the grill can be stopped at any question. And Chorus
ADR 0088 d4 asks orient to run a check a project declares (its SDK watch).

## Decision

1. **Resolve first, then read.** A deterministic resolver runs before § 2's sweep and answers
   `resolved`, `candidates` or `none`. Order: an explicit argument (link, path, name or alias);
   else the session directory, matched longest-prefix against every live project note's `repos:`;
   else, for a workspace or launch folder, its area; else the directory's own name, matched as a
   typed name confined to that directory's area.
2. **A project target audits that project**, its tasks, phases and related projects, never its
   whole area. An area is the target only when Lachy names one or starts from a workspace or
   launch folder.
3. **When to go and when to ask.** An exact name, alias or folder hit goes ahead; so does a fuzzy
   match with a clear winner. Either names its pick in one line so Lachy can stop it. A close call,
   a directory several projects declare, or no match asks him with the top three, before any audit
   is spent.
4. **The answer is learned.** When he picks the project for an undeclared directory, orient adds
   that directory to the project note's `repos:`, so the next orient there resolves without
   asking. It is the one write before the gate besides drift fixes. A shared directory (declared by
   several projects) is never written back.
5. **Reshuffle is the default, not a question.** The audit flows into the reshuffle; `--steer`
   or `--look` (or saying so in the arguments) opts out, and an empty shape goes straight to
   steering. A default run authorises the unambiguous drift fixes as choosing Reshuffle did; the
   audit's Drift line is the notice. `--look` writes nothing.
6. **A declared check lives on the project note.** `orient_check: <command>`, run from the
   project's repo. A plain run prints the entries newer than its record and changes nothing (§ 2).
   Orient turns them into proposals, and runs the command with `--advance` only after the gate
   passes them. The check owns its record and how it lands; orient still runs no git. A failing or
   missing check is one audit line, never a blocker.

## Consequences

- A wrong confident pick costs one audit before Lachy stops it; the one-line naming is the guard.
  The clear-winner margin is fixed by tests with real names (`murmur` → Murmur over Murmur's cmux
  fork).
- `repos:` grows as a side effect of orients, and that frontmatter becomes the map from directories
  to projects.
- Steer only and Look only become flags: an orient that should change nothing has to say so.
- How p20-1 reads d1–d4 (`skills/_shared/scripts/resolve-target.py`): the directory rungs compare
  by depth, so a workspace holding the directory more deeply than any `repos:` entry gives its area,
  and a tie goes to the declaration. Dated directories and repos inside umbrella repos (`~/Projects`,
  `~/repos/workspaces`, `~/.agents`) are named by their own directory, never the umbrella's. A
  matched workspace root or area directory is never learned, even after a stop, so a project pick
  there asks every time; `_`-prefixed folders (`_archive`, `_sources`, `_shared`) are never learned
  either. A list-valued `area:` gives its first item.
