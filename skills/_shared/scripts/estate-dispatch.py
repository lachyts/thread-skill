#!/usr/bin/env python3
"""The estate pass's deterministic half after the ranker (ADR 0041; CONTEXT.md **Decision round**, **Dispatch plan**).

Scripts scan, the model decides: estate-scan.py lists the estate, the grading agents grade it, estate-rank.py ranks
it, and this script does the rest that needs no judgement. It cuts the decision round to Lachy's budget and builds
its AskUserQuestion payloads (`rounds`), works out which runs go once the answers are in (`plan`), which sessions
start and with what (`sessions`), and writes each answer into its task note (`record`); `slices` cuts the scan into
the grading agents' inputs, and `log` keeps the pass's grades in the Grade log. `preflight` is schedule's Pre-flight
split (ADR 0047): which candidates queue, which leave with their Dependent closure, and the decision round for one
rollout's tasks. `decided-for-you` writes the calls a grade ruled for Lachy, never asked (ADR 0054), into the tasks a
schedule run queues. Two callers: skills/orient-all/SKILL.md, and skills/schedule/SKILL.md § 1.5 (and its serial
path's S3.5), which runs `slices`, `log`, `preflight`, `record` (`record --by schedule`) and `decided-for-you --by
schedule --write`, and under orient-all only `preflight` and `decided-for-you --by orient-all --write`; orient's
reshuffle R5.2 runs `record --owner --by orient`. This docstring is the only copy of the output schemas. python >= 3.9 with PyYAML (`log` and `preflight`
need none). Called as:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py slices --scan FILE --dir DIR
        [--tasks SLUG[,SLUG]]... [--superseding PRIOR]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py rounds --rank FILE --scan FILE --budget N
        [--top K] [--vault PATH]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py plan --rank FILE --scan FILE
        [--decided SLUG]... [--unparked NOTE]... [--signed SLUG]... [--rounds FILE --assume-answered] [--vault PATH]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py sessions --plan FILE [--wrote PATH]...
        [--status SLUG=N]... [--vault PATH]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py record --task SLUG|PATH --question Q
        --answer A (--recommended R [--fork F] | --owner priorities|technical [--why W]) [--by orient-all|schedule]
        [--superseding PRIOR] [--today YYYY-MM-DD] [--vault PATH]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py decided-for-you --rank FILE
        --tasks SLUG[,SLUG]... [--by orient-all|schedule] [--superseding PRIOR] [--write] [--today YYYY-MM-DD]
        [--vault PATH]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py log --rank FILE --scan FILE [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/estate-dispatch.py preflight --rank FILE --scan FILE
        --tasks SLUG[,SLUG]... [--kept SLUG]... [--decided SLUG]... [--dep A=B]...

Defaults: rounds, plan and sessions take the vault from the scan's (or the plan's) `vault`; record takes
~/repos/obsidian and the local date, decided-for-you ~/repos/obsidian and the rank's `today`. Only `slices` (its own
files under --dir), `record` (one task note), `decided-for-you --write` (the task notes it names) and `log`
(grades.jsonl, through run_record) write; rounds, plan, sessions, preflight and decided-for-you without --write
write nothing and are byte-deterministic for the same inputs. No subprocess, no network, no bytecode (sys.dont_write_bytecode is set before
any sibling loads). Exit 0 when done; 1 when `log` cannot write a line (run_record's warning above it; orient-all § 8
and schedule step 8 report it as a caveat); 2 on a usage error or a refusal (one `estate-dispatch:` stderr line,
nothing written): an unknown verb or flag, a scan, rank or plan that is not JSON or whose `schema` is not 1, a
negative budget, a bad --status or --wrote, an existing slice file, every record refusal, an empty
decided-for-you --tasks, a grade line whose field
run_record refuses (a task whose name has no key is skipped, never refused), and preflight's own refusals (an empty
--tasks; a --kept, --decided or --dep slug outside --tasks; a --dep not given as A=B); 3 when the vault, PyYAML or a
sibling script is missing.

What it reuses. Loaded by path inside main(), so importing this file runs nothing (the contract tests read its
constants that way): estate-rank.py (ER: Ranker's index, the gradeable rule; slug_key; DECISION_MINUTES and
REVIEW_MINUTES), and through ER.load_siblings resolve-target.py's next-action.py (NA: Vault, Note, status_of,
OPEN_STATUSES, links_in, tags_of) and estate-scan.py (ES: first_link, link_live and in_flight, vault-grammar.md
§ In flight stated once, and still_to_start, its one exception); `preflight` loads ER alone, for slug_key;
reconcile-rollout.py (RR: Note, GATE_PENDING_SECTION, GATE_BOUNCE_SECTION,
PROJECT_ROOT_RE, _shape and _start_unattended, the start stamp's reader; _dep_status and _fold_unit, the dependency
rule a rollout row waits on); and, for `sessions` only, leg.py (LEG:
split_cells, LAUNCH_RE, LINK_RE and QUEUE, the serial Queue's row grammar); and, for `log` only, run_record.py (RRec:
check, emit, events_dir, normalise_slug, title_key, GRADE_LOG and RESERVED: the Grade log's one writer is run_record
itself).

slices --scan F --dir D [--tasks SLUG[,SLUG]]... [--superseding PRIOR]: one file per home project with gradeable tasks
(ER's rule: statusClass active, not in flight, a live first project), `D/<NN>-<kebab name>.json`, NN from 01 in the
scan's project order, holding {project (the scan row), tasks[] (its gradeable scan task rows), repos[] (the scan repo
rows whose declared paths meet the project's `repos:`), today}. It creates D; any target file that already exists is
exit 2 with nothing written. Prints {homes[] {project, note, file, tasks}, gradeable, skipped}. --tasks (schedule
§ 1.5's graded set) keeps only the named tasks that are gradeable, matched by ER.slug_key, so a home with none gets
no file, and adds notGradeable[] {slug, why}, in the order named: each named task that is not gradeable, why the
Ranker's skip reason (`unhomed`, `in flight`, `hold`) or `not in the scan`. --superseding passes the prior to the
Ranker, so a carried task still queued is gradeable (ER's Gradeable exception). gradeable and skipped count the whole
scan either way. With neither flag (orient-all § 2) the output is as it always was.

rounds --rank R --scan S --budget N [--top K=15] [--vault V]: the decision round, cut to N minutes.
  Sign-offs: each scan rollout summary's `pendingSignOffs` (with a null summary, the scan's open tasks at status
  RR.GATE_PENDING_STATUS whose `rollout:` names it), as {slug, rollout, note, gateText, gates[], bounced, bounce, ask,
  why}: gateText is RR.Note(task).section_text(RR.GATE_PENDING_SECTION), raw; gates[] its non-empty lines, a leading
  bullet mark stripped (the lines `reconcile-rollout.py approve-gates` signs, sub-bullets included); bounced is
  has_heading(RR.GATE_BOUNCE_SECTION) and bounce that section's text. ask is true unless why is `status unread` (a
  null summary), `paused` (a stamped pause other than pausedFor sign-off), `draining` (pause_requested) or `needs you`
  (its setAside entry carries needsHuman): repair § 1 runs approve-gates under no other pause. Every asked sign-off is
  asked whatever the budget, and charged first at REVIEW_MINUTES.signOff each.
  The cut, in order, after the sign-offs: the rank's One calls (decisions[] round one-call, in order) at
  DECISION_MINUTES['One call'] per decision; the offered Unpark rows at the One-call minute each; the Grills at their
  rank `minutes`. The first item that does not fit the minutes left stops the cut: it and everything after it go to
  later[]. A decision task whose holds this pass can never clear (a `blockedBy` why other than One call, Grill and
  held, followed through `held` dependencies with a memo and a cycle guard) goes to skipped[], charged nothing.
  Payloads: up to QUESTIONS_MAX questions per AskUserQuestion call, sign-offs first, then One calls, then Unpark offers;
  each {question, header (HEADERS, at most 12 chars), multiSelect: false, options[] {label, description}}. Every
  question opens with `[[slug]]` or `[[project]]`, so every text is unique. A label is at most LABEL_MAX chars, "
  (Recommended)" counted: a longer option is asked as `<k>. <leading words>…` (k its 1-based place, so labels stay
  distinct), its description opening with the full text. A One call's options are the decision's, the recommendation
  first and marked " (Recommended)", described by framing(): with the decision's `stakes` (one line per option, ADR
  0054 d8), each option's stakes line, the recommended one's ending " Recommended: <why>"; without, the grader's why
  on the recommendation and the bare label on the rest. A One call's text is `[[slug]] <question>`, then its `goal`
  when it has one, then NOTE_INVITE; a sign-off's are `Sign off` (its description lists exactly the gates[] it signs)
  and `Not now`; an Unpark offer's are unpark, snooze and kill (the kill names the project's open tasks). Every
  question ends with NOTE_INVITE; sign-offs and Unpark offers carry no recommendation (the authorisation is his, ADR
  0008; parking is his standing call, ADR 0041).
  Output: {schema, today, budget, top[] {rank, slug, home, grade, shape, size, leverage, dueSoon, deadline, review,
  blockedBy}, live[] {slug, note, shape, progress, paused, pausedFor, pauseRequested, awaitingSignOff, live,
  pendingSignOffs[], error}, signOffs[], oneCalls[] {slug, home, minutes, decision, blockedBy}, unpark[] (the rank's
  rows, offered and in budget), grill[] {slug, home, minutes, decisions[], blockedBy}, later[] {kind, slug|project,
  minutes}, skipped[] {kind, slug, blockedBy}, asks[][] (AskUserQuestion's `questions`, one array per call), index[]
  {question, kind (sign-off | one-call | unpark), slug|project, note, labels[], texts[] (each label's full text),
  recommended (texts[0] for a One call, else null), fork?, bounced?}, minutes {signOffs, oneCalls, unpark, grill, used,
  budget}}.

plan --rank R --scan S [--decided SLUG]... [--unparked NOTE]... [--signed SLUG]... [--rounds F --assume-answered]:
  what the pass schedules and starts once the answers are in.
  Decided: a task graded Ready, or named by --decided; with --assume-answered, also every oneCalls[] and grill[] slug
  in F (the dry run's reading: every in-budget decision answered). A member is scheduled when it is decided and every
  hold on it clears: a One call or Grill hold when the dependency is decided and clear, a `held` hold when the
  dependency is clear, a `parked` hold when the dependency's home is in --unparked (by name or note) and it is clear;
  no other hold ever clears (memo and cycle guard).
  The dependencies. reconcile-rollout's _dep_status holds a rollout row until each dependency lands, so a member is
  scheduled only with every dependency it needs scheduled too. A rank dependsOn[] link is matched as the ranker
  matches it (ER.slug_key) to an open scan task, else read through RR._dep_status and RR._fold_unit over the vault's
  task notes (a lazy copy of RR._scan's index): one landed, or open and in flight (a live rollout lands it), is
  satisfied; an open one not in flight (a merged tombstone's unit too) is needed; one that left the scan without
  landing (status dropped, an `archived` tag, the Archive folder) holds the member as `dependency dropped`, and a link
  to no task note as `dependency not found`, since nothing ever lands them.
  A run is scheduled when it has members left; it is parallel with a root, or serial; its repo row has no blocker
  (`unchecked` passes: schedule § 0 is the gate); it is not parked, unless unparked here (then only its Ready, unheld
  members go); and it is the best-ranked parallel run on its root (keyed on rolloutRoot when set, else root). Before
  that root contest, the pre-hold: a member whose needed dependency can never go this pass, whatever the contest
  decides (undecided or held, session-lane or in no run, a member of a run that waits parked, blocker, repo unknown
  or no repo declared, or itself pre-held: transitively, to a fixpoint), is held, so the contest never hands a root to
  a run that would only lose its members afterwards. What the pre-hold cannot foresee is a dependency in a run that
  loses the contest: after it, each scheduled member with a needed dependency no entry holds is held, and the runs are
  chosen again, since a run can lose every member and free its root. Those holds only grow, so the plan is stable and
  never flips back; a member held so whose dependencies a later round did schedule stays held this pass, and goes
  next pass. Every other run waits, with why {kind: parked | nothing decided | repo unknown | no repo declared |
  blocker | same root | dependency not scheduled | dependency scheduled late, detail}; the last two are a run whose
  every member the dependencies took, worded from the final schedule: `dependency not scheduled` naming only the
  dependencies no entry holds, else `dependency scheduled late` naming the ones a later round scheduled.
  Schedule entries: {run, project, note, projectSlug, batchKeys[], shape, root, rolloutRoot, members[], args
  ("--tasks a,b,c", never --regenerate), batch, review {pr, signOff, eyeCheck, minutes}}. projectSlug is the name
  NFKD-folded to ASCII and lower-cased, apostrophes (' and ’) deleted, every other run outside [a-z0-9] made a `-`, the
  ends trimmed ("Lachy's Tools" -> lachys-tools). batchKeys are the name's alphanumerics-only lower-case forms, taken
  NFKD-folded to ASCII and with non-ASCII dropped ("Café" -> cafe, caf): two entries whose keys meet may name the same
  note, and schedule step 6's naming (glob, then write) is not atomic, so they never share a batch. Parallel entries,
  in rank order, each take the lowest batch from 1 holding no entry whose keys meet theirs; serial entries each take a
  batch of their own after the last parallel one, in rank order. Listed by batch, then rank.
  rollouts[]: one per scan rollout, {slug, note, shape, projectRoot, pausedFor, owners? (the `owner:` tags of its open
  tasks), holds[], canExecute, canRepair, reinstate}. holds, in this order: superseded (supersededBy), lineage
  (another live rollout's supersedes names it), version (protocol_version not 5), incomplete, serial (status § 5
  reads a chain by its own S rules, which STATUS_ACTIONS never maps), paused, draining (pause_requested), live queue
  (running + integrating > 0), start stamp (RR._start_unattended: the Stage starts it), status unread (a null
  summary). reinstate: awaitingSignOff with every pending sign-off in --signed. canExecute: no hold, or reinstate
  with paused the only hold. canRepair: none of superseded, lineage, version, serial and status unread.
  Output: {schema, vault, today, schedule[], waiting[] {run, project, note, shape, root, rolloutRoot, members[], why},
  rollouts[], reinstate[], orient[] {name, note, area[]} (the rank's, whatever the budget), held[] {slug, run, grade,
  blockedBy (the rank holds that stand, then, for a member the dependencies took, read against the final schedule:
  {slug, why: `dependency not scheduled`} for each needed dependency no entry holds, `dependency dropped` or
  `dependency not found` for each that never lands, or, when none of those is left, {slug, why: `dependency scheduled
  late`} for each it was held on)}, undecided[] {slug, run, grade}, sessionLane[] {slug, home, grade}}.

sessions --plan P [--wrote PATH]... [--status SLUG=N]...: the sessions to start, in start order. STATUS_ACTIONS maps
  each status § 4 **Recommended action** rule (its number, as a status agent reports it) to the item it may start:
  6 and 13 an execute, 8 a reinstate, 7 and 11 a repair, every other number none (o10 pins the table to the rules).
  --wrote: each note a § 6 schedule fork wrote, directly in the vault's Work/Tasks (else exit 2). A parallel one
  (RR._shape) is an execute item in its Project root (no root: manual); a serial one is a `leg` item for Leg 1, in
  its `## Queue` row 1's launch folder, manual when its alias starts `cx-` (legs.md § Hand over).
  --status SLUG=N: SLUG one of plan.rollouts[], N an integer 1 to 13 (else exit 2). An execute item only with
  canExecute, a reinstate only with reinstate and canExecute (so a sign-off pause that every gate signed but another
  hold stands on, serial, a start stamp or a drain, gets none), a repair only with canRepair; every live rollout that
  gets no item goes to left[] {rollout, action (null: status unread), holds[], why}.
  Orient items: one per plan.orient[], prompt `/thread:orient [[<name>]]`, with one more line per --wrote note whose
  `projects:` resolves to that project, naming it. Order: the written-note items (in --wrote order), the live
  execute items by slug, the repair items by slug, the orient items last. A title over TITLE_MAX is cut to
  TITLE_MAX - 1 chars plus "…".
  Output: {schema, today, items[] {kind (execute | leg | repair | orient), rollout | project, note, title, cwd, alias?,
  prompt, tldr, manual, why}, left[]}.

log --rank R --scan S [--dry-run]: the pass's grades into the Grade log (p25-4; CONTEXT.md **Grade log**), at
  orient-all § 2 step 7 (never on a dry run) and at schedule § 1.5 on every run that grades (all but an orient-all
  fork, whose estate pass logged them). One run_record `grade` line per rank tasks[] entry, Orient included, in rank order:
  task its key (grade_key below), project its home, grade, agentGrade, shape and size; decisions the
  count of its decisions[], his decisions only (owner yours, ADR 0054: a decision ruled for him, in decidedForYou[], is
  never counted, so lines before ADR 0054 are not comparable), and low those whose confidence is low; held true when its blockedBy[] is non-empty; gates
  its gates[]; raised the `why` of each raised[] step, when there is one; rank when it is not null; linked the scan
  row's `rollout`, through run_record's normalise_slug, when it is a slug and not a reserved name. The pass shares one
  minted id, g-<UTC YYYYMMDDTHHMMSSZ>-<6 hex>, and one ts, and its digest is the first 12 hex of sha1 over the rank
  file's realpath, the rank's `today` and the sorted (slug, grade, agentGrade, shape, size) tuples: orient-all's $S is
  a fresh mktemp per pass, so two passes never share a digest, and a rerun of one pass keeps it. The key (p34-6): a
  slug is normalise_slug's; estate-scan's slug is the raw file stem, so a titled vault note (spaces, capitals, an em
  dash: a quick capture's) is keyed by run_record's title_key and its line carries the exact name as `note`, which
  grades.py looks the note up by. A slug-named task holds its key first, whatever the rank order, and a titled name
  holds its key next, in rank order, so a titled name whose key another graded task of the pass holds, or a name with
  no ASCII letter or digit, has no key and is skipped: one `estate-dispatch: skipped <slug>: <why>` stderr line each,
  and the rest are still logged. Every other line passes run_record's check before any is written. A (digest, task)
  already in grades.jsonl is skipped: with every task there it prints `exists <pass> (<n> grade(s))`; with some, it
  writes the rest under that pass's id and ts, printing `completed <pass>: <k> more`, so a pass whose write stopped
  part-way is completed by a rerun; else
  `logged <n> grade(s), pass <id>`. Any of the three ends `; <k> skipped (no key): <slug>, ...` when a task was
  skipped (orient-all § 8 reports it as a caveat). --dry-run prints each line (`would log grade <task>: <fields>`) and
  that outcome after `dry run, nothing written: `, and writes nothing. A torn grades.jsonl line is skipped, and a log
  that cannot be read counts as empty.

record --task SLUG|PATH --question Q --answer A --recommended R [--fork F] [--by B] [--superseding PRIOR] [--today D]:
  one answer into its task. Q, A, R and F have every whitespace run (newlines included) folded to one space, and Q
  loses a leading link to its own task (`[[<slug>]] `, as a rounds or preflight index text opens; ER.slug_key
  compares), so the note never links to itself and a rerun with the bare question is [no-change]. Refused (exit 2, the file byte-identical): no such task note directly
  in Work/Tasks, a note that is not a `task`, a status outside Active (NA.status_of not in NA.OPEN_STATUSES), a task
  in flight (ES.in_flight over ES.link_live of its `rollout:`), unless --superseding names the prior and
  ES.still_to_start holds (schedule § 1.5's carried task still queued: open, its `rollout:` that prior; one that has
  started is still refused), a value empty after the fold (Q after its link is cut too), and a --fork that the latest
  `orient end:` line in its `## Notes` does not name as `fork for Lachy: F`. The bullet `- <Q> → <A> (asked at
  /thread:<B>; recommended: <R>)`, B the --by caller (orient-all, the default, or schedule), extends in place the
  section DECISIONS_HEADING of the same date (after its last line, before the next `## ` heading outside a fence),
  else opens that section at the note's end (schedule step 7's form). --fork also appends RULING_LINE (orient § 5's) as the last `## Notes`
  line. One in-place write (the inode kept), printing `recorded <note>: <Q> → <A>`; nothing to add prints
  `<note>: <Q> → <A> [no-change]`, exit 0.
  --owner priorities|technical writes a call made for Lachy instead (ADR 0054 d3): the bullet
  `- <Q> → <A> (decided for you at /thread:<B>, <owner>: <W>)` (`: <W>` dropped with no --why) under DECIDED_HEADING
  of the same date, a new section opening with DECIDED_PREAMBLE; never under DECISIONS_HEADING. --recommended with
  it exits 2 (the call is the answer), and so does --fork (an open fork stays his); --by orient (reshuffle R5.2) is
  allowed only with --owner. The same refusals hold. Without --owner, --recommended is required.

decided-for-you --rank R --tasks SLUG[,SLUG]... [--by B] [--superseding PRIOR] [--write] [--today D]: the calls the
  rank ruled for Lachy (each task row's decidedForYou[], the less sure first) for the named tasks, matched by
  ER.slug_key, in --tasks order and then the rank's. Output: {schema, today, items[] {slug, note, question, answer
  (the recommendation), options[], owner, confidence, why}, skipped[] {slug, why: not in the rank}, written[] {slug,
  question}, unchanged[], refused[] {slug, question, why}}. Read-only without --write. With --write, each item goes
  through record's core with --owner (its own owner) and --by B: a refusal (a task in flight since the scan, say) is
  listed in refused[] and the rest are still written, exit 0; a rerun is all unchanged. Exit 2 on a usage error, a
  rank that is not JSON or not schema 1, or an empty --tasks; 3 when --write finds no vault or no PyYAML.

preflight --rank R --scan S --tasks SLUG[,SLUG]... [--kept SLUG]... [--decided SLUG]... [--dep A=B]...: schedule
  § 1.5's split of its candidates (ADR 0047). It reads only the two files. --tasks is every candidate, deduplicated
  by ER.slug_key in first-seen order (a scan task is shown by its scan slug); --kept, --decided and --dep (each
  repeatable, --kept and --decided also comma-joined) must name candidates. Each candidate, in order:
  - kept (a carried task that has started): in, `kept`, never graded or asked;
  - graded Ready (the rank's tasks[]): in, `ready`;
  - One call or Grill: in when decided (`decided`), else out (`undecided`);
  - Orient: out (`orient`, with its `home`), decided or not;
  - not graded (the rank's invalid[], ungraded[] or skipped[], or no scan row): ungraded, its reason `invalid: <the
    errors>`, the rank's why (`no grade`, a skip reason) or `not in the scan`, with STATUS_OUTSIDE in place of a skip
    reason `in flight` or `hold` when the scan row's statusClass is `hold` (its own status is the cause: a carried
    task at an empty status, which carry queues but ES.still_to_start does not); in when decided (`queued as it
    stands`), else out (`ungraded`).
  The Dependent closure, in two steps. The edges are each candidate's scan `dependsOn`, matched by ER.slug_key among
  the candidates, and each --dep (A depends on B). A kept candidate never leaves; one whose dependency is out gives
  one warnings[] line naming them. First what leaves whatever Lachy answers: every candidate that depends on an
  Orient one, directly or through others, leaves as `dependency` (Ready, decided, undecided or ungraded alike), via
  its first dependency in that closure. Then a candidate still in leaves, to a fixpoint, when a dependency is out:
  `dependency`, via the first such dependency.
  The round: one question per AskUserQuestion call, each candidate still out undecided or ungraded after the closure,
  so never a task already out through an Orient dependency, which leaves whatever the answer: the One calls in rank
  order (`[[slug]] <question>`), then each Grill's decisions in rank order (`[[slug]] (k/n) <question>`), each text
  followed by its `goal` when it has one and NOTE_INVITE (framing(), as rounds), then the ungraded in --tasks order
  (`[[slug]] could not be graded (<reason>): leave it out of this rollout, or queue it as it stands? <NOTE_INVITE>`,
  UNGRADED_OPTIONS, `Leave it out` recommended, its description and UNGRADED_WHY saying why over his autonomy). Only
  his decisions are asked: the rank's decisions[] hold only those (ADR 0054). Options are built as rounds builds them
  (label_for, the recommendation first and marked, framing()'s descriptions); HEADERS gives each header. An ungraded answer is never recorded (schedule § 1.5).
  Output: {schema, today, counts {candidates, graded, ready, oneCall, grill, orient, ungraded, kept, decided, in, out}
  (graded, the grades and ungraded over the candidates not kept), tasks[] {slug, grade, decided, in, why, via?,
  reason?}, queue[] (the slugs in, in --tasks order), out[] {slug, grade, why, via?, reason?, home?, note?}, asks[][]
  (one question each), index[] {question, kind (one-call | grill | ungraded), slug, note, decision {question,
  options[], recommendation, why?, fork?} (an ungraded one's synthesised from UNGRADED_QUESTION), labels[], texts[],
  recommended (texts[0]), k?, n?, fork?}, warnings[]}.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
import re
import secrets
import sys
import unicodedata
from pathlib import Path

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.dirname(os.path.dirname(HERE))
ESTATE_RANK_PY = os.path.join(HERE, "estate-rank.py")
LEG_PY = os.path.join(SKILLS, "execute", "scripts", "leg.py")
RUN_RECORD_PY = os.path.join(HERE, "run_record.py")

SCHEMA = 1
RANK_SCHEMA = 1
SCAN_SCHEMA = 1
PLAN_SCHEMA = 1
VAULT_DEFAULT = "~/repos/obsidian"
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
FENCE = re.compile(r"^\s*(```|~~~)")

# AskUserQuestion's shape, as far as this script builds it (orient-all § Risks: assumed, not read from the tool); who is
# asked and how: `skills/_shared/asking.md`.
QUESTIONS_MAX = 4
LABEL_MAX = 40
RECOMMENDED = " (Recommended)"
ELLIPSIS = "…"
HEADERS = {"sign-off": "Sign-off", "one-call": "One call", "unpark": "Unpark", "grill": "Grill", "ungraded": "Ungraded"}
# The Framing's Note (asking.md § 3): the last words of every question this script builds (ADR 0054 d8).
NOTE_INVITE = "What would make this wrong for you?"
# schedule § 1.5's question for a task the grading could not grade (its options, the recommendation first).
UNGRADED_OPTIONS = ("Leave it out", "Queue it as it stands")
UNGRADED_QUESTION = "could not be graded ({why}): leave it out of this rollout, or queue it as it stands?"
UNGRADED_DESCRIPTIONS = ("Leaves it out of this rollout, with every task that depends on it; the next schedule grades it "
                         "again. Recommended over autonomy because nobody could read it for a decision of yours: queued "
                         "unread, it can build the wrong thing, which costs you more than one schedule's wait",
                         "Queues it ungraded: it runs this rollout without you, and an open decision it hides is met at "
                         "its start, by its plan")
UNGRADED_WHY = ("nobody could read it for a decision of yours; queued unread it can build the wrong thing, and quality "
                "over speed outweighs one schedule's wait")
STATUS_OUTSIDE = "status outside Active"  # an ungraded candidate's reason when its own status is the cause
SIGN_OFF_OPTIONS = ("Sign off", "Not now")
TOP_DEFAULT = 15
TITLE_MAX = 60  # create_thread's title (skills/execute/legs.md § Hand over)
KILL_NAMES_MAX = 8

# schedule step 7's ask-ahead heading and orient § 5's ruling line (tests/contracts/orient-all.test.mjs o4).
DECISIONS_HEADING = "## Decisions (asked ahead {date})"
RULING_LINE = "- {stamp} orient ruling: {fork} → {answer}"
DECISION_BULLET = "- {question} → {answer} (asked at /thread:{by}; recommended: {recommended})"
RECORD_BY = ("orient-all", "schedule")
# A call made for Lachy, never asked (ADR 0054 d3): its own heading, never `## Decisions`, so no reader of a recorded
# human decision takes it for one (tests/contracts/question-gate.test.mjs q4).
DECIDED_HEADING = "## Decided for you ({date})"
DECIDED_PREAMBLE = ("Calls made for Lachy, never asked (ADR 0054): each stands unless the code shows it wrong, a plan that "
                    "departs from one says why, and none signs a gated input (ADR 0008); he can overturn any here.")
DECIDED_BULLET = "- {question} → {answer} (decided for you at /thread:{by}, {owner}: {why})"
DECIDED_OWNERS = ("priorities", "technical")
DECIDED_BY = RECORD_BY + ("orient",)
NOTES_HEADING = "## Notes"
END_MARK = " orient end: "
FORK_MARK = "fork for Lachy: "

# status/SKILL.md § 4's **Recommended action** rules: number -> (the item it may start here, the rule's opening
# words). tests/contracts/orient-all.test.mjs o10 pins every entry to the rule it names.
STATUS_ACTIONS = {
    1: (None, "`superseded_by:`"),
    2: (None, "Named by another rollout's `supersedes:`"),
    3: (None, "Predates the queue"),
    4: (None, "Unsupported protocol version"),
    5: (None, "`incomplete`"),
    6: ("execute", "Every task merged"),
    7: ("repair", "An open escalation"),
    8: ("reinstate", "`paused`"),
    9: (None, "`pause_requested`"),
    10: (None, "A live queue"),
    11: ("repair", "Any drift flag"),
    12: (None, "Awaiting Integration"),
    13: ("execute", "Nothing started"),
}
HOLDS = ("superseded", "lineage", "version", "incomplete", "serial", "paused", "draining", "live queue", "start stamp",
         "status unread")
NO_REPAIR = frozenset({"superseded", "lineage", "version", "serial", "status unread"})
# plan's own dependency holds (blockedBy whys), and the why kinds of a run they empty.
DEP_UNSCHEDULED = "dependency not scheduled"
DEP_LATE = "dependency scheduled late"
DEP_DROPPED = "dependency dropped"
DEP_MISSING = "dependency not found"


def fail(code, reason):
    sys.stderr.write("estate-dispatch: %s\n" % reason)
    sys.exit(code)


class Parser(argparse.ArgumentParser):
    def error(self, message):
        fail(2, message)


def _load(name, path):
    """A sibling script as a module, by path (resolve-target.py's _load)."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load(name, path):
    try:
        return _load(name, path)
    except SystemExit:
        fail(3, "cannot load %s" % path)
    except Exception as e:
        fail(3, "cannot load %s: %s" % (path, e))


class Mods:
    """The siblings, loaded once in main()."""

    def __init__(self, leg=False):
        self.ER = load("thread_estate_rank", ESTATE_RANK_PY)
        self.RT, self.ES = self.ER.load_siblings()  # its own one-line exit 3 on a missing sibling or PyYAML
        self.NA = self.RT.NA
        self.RR = load("thread_reconcile_rollout", self.ES.RECONCILE_ROLLOUT_PY)
        self.LEG = load("thread_leg", LEG_PY) if leg else None


# ---- values ------------------------------------------------------------------------------------------------------

def emit(out):
    sys.stdout.buffer.write((json.dumps(out, ensure_ascii=False, indent=2) + "\n").encode("utf-8", "replace"))
    sys.stdout.flush()


def fold(s):
    """Every whitespace run, newlines included, folded to one space; the ends trimmed."""
    return " ".join((s or "").split())


def parse_date(raw, flag):
    try:
        if not ISO_DATE.fullmatch(raw):
            raise ValueError
        return datetime.date.fromisoformat(raw)
    except ValueError:
        fail(2, "%s must be a date, YYYY-MM-DD: %r" % (flag, raw))


def read_json(path, what, schema):
    try:
        with open(path, encoding="utf-8") as fh:
            raw = fh.read()
    except (OSError, UnicodeDecodeError) as e:
        fail(2, "cannot read the %s %s: %s" % (what, path, getattr(e, "strerror", None) or e))
    try:
        data = json.loads(raw)
    except ValueError as e:
        fail(2, "the %s %s is not JSON: %s" % (what, path, e))
    if not isinstance(data, dict):
        fail(2, "the %s %s is not an object" % (what, path))
    got = data.get("schema")
    if isinstance(got, bool) or got != schema:
        fail(2, "the %s %s has schema %s; this script reads schema %d"
             % (what, path, json.dumps(got), schema))
    return data


def read_scan(path):
    scan = read_json(path, "scan", SCAN_SCHEMA)
    for key in ("projects", "tasks", "repos", "rollouts"):
        if not isinstance(scan.get(key), list):
            fail(2, "the scan %s has no %s list" % (path, key))
    return scan


def read_rank(path):
    rank = read_json(path, "rank", RANK_SCHEMA)
    for key in ("tasks", "runs", "decisions", "orient", "unpark"):
        if not isinstance(rank.get(key), list):
            fail(2, "the rank %s has no %s list" % (path, key))
    return rank


def vault_root(arg, data):
    v = arg or (data.get("vault") if isinstance(data.get("vault"), str) else None) or VAULT_DEFAULT
    root = os.path.expanduser(v)
    if not os.path.isdir(root):
        fail(3, "no vault at %s" % root)
    return os.path.realpath(root)


def today_of(data):
    raw = data.get("today")
    if isinstance(raw, str) and ISO_DATE.fullmatch(raw):
        return raw
    return datetime.date.today().isoformat()


def project_slug(name):
    """The name as schedule step 6's note slug: NFKD-folded to ASCII, lower-cased, apostrophes deleted, every other
    run outside [a-z0-9] a `-`, the ends trimmed."""
    s = name.replace("'", "").replace("’", "")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def batch_keys(name):
    """The name's alphanumerics-only lower-case forms, NFKD-folded to ASCII and with non-ASCII dropped."""
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    dropped = name.encode("ascii", "ignore").decode("ascii")
    return sorted({re.sub(r"[^a-z0-9]", "", x.lower()) for x in (folded, dropped)})


def status_key(v):
    """A raw `status:` value read as vault-grammar.md § Statuses reads one: lower-cased, `-` as `_`."""
    return str(v or "").strip().lower().replace("-", "_")


def titled(title):
    return title if len(title) <= TITLE_MAX else title[:TITLE_MAX - 1] + ELLIPSIS


def is_five(v):
    return (isinstance(v, int) and not isinstance(v, bool) and v == 5) or (isinstance(v, str) and v.strip() == "5")


# ---- slices ------------------------------------------------------------------------------------------------------

def split_slugs(values):
    """Each repeated SLUG[,SLUG] value as one list of stripped, non-empty slugs, in the order given."""
    return [s.strip() for v in values or [] for s in v.split(",") if s.strip()]


def cmd_slices(args):
    scan = read_scan(args.scan)
    M = Mods()
    today = scan.get("today")
    ranker = M.ER.Ranker(M.RT, M.ES, scan, None, None, [], superseding=args.superseding)
    ranker.index()
    wanted, not_gradeable = None, []
    if args.tasks:  # schedule § 1.5's graded set: only these, and why each named task that is not gradeable is not
        wanted, seen = set(), set()
        for raw in split_slugs(args.tasks):
            key = M.ER.slug_key(raw)
            if not key or key in seen:
                continue
            seen.add(key)
            slug = ranker.lower.get(key)
            if slug is None:
                not_gradeable.append({"slug": raw, "why": "not in the scan"})
            elif slug not in ranker.home:
                not_gradeable.append({"slug": slug, "why": ranker.skip[slug]})
            else:
                wanted.add(slug)
    by_home = {}
    for slug in sorted(ranker.home):
        if wanted is None or slug in wanted:
            by_home.setdefault(ranker.home[slug]["name"], []).append(slug)
    plan, n = [], 0
    for p in scan["projects"]:
        if not isinstance(p, dict) or p.get("name") not in by_home or ranker.projects.get(p["name"]) is not p:
            continue
        n += 1
        name = p["name"]
        declared = set(x for x in (p.get("repos") or []) if isinstance(x, str))
        repos = [r for r in scan["repos"] if isinstance(r, dict) and declared & set(r.get("declared") or [])]
        tasks = [ranker.tasks[s] for s in by_home[name]]
        fname = "%02d-%s.json" % (n, project_slug(name) or "project")
        plan.append((fname, {"project": p, "tasks": tasks, "repos": repos, "today": today}))
    d = os.path.expanduser(args.dir)
    taken = [f for f, _ in plan if os.path.lexists(os.path.join(d, f))]
    if taken:
        fail(2, "%s already holds %s; slices never overwrite" % (d, ", ".join(taken)))
    try:
        os.makedirs(d, exist_ok=True)
        for fname, body in plan:
            with open(os.path.join(d, fname), "x", encoding="utf-8") as fh:
                fh.write(json.dumps(body, ensure_ascii=False, indent=2) + "\n")
    except OSError as e:
        fail(2, "cannot write the slices under %s: %s" % (d, e))
    out = {"homes": [{"project": b["project"]["name"], "note": b["project"].get("note"), "file": os.path.join(d, f),
                      "tasks": [t["slug"] for t in b["tasks"]]} for f, b in plan],
           "gradeable": len(ranker.home), "skipped": len(ranker.skip)}
    if wanted is not None:
        out["notGradeable"] = not_gradeable
    emit(out)


# ---- rounds ------------------------------------------------------------------------------------------------------

def label_for(k, full, recommended):
    """(label, shortened): the option's label, at most LABEL_MAX chars with the suffix counted."""
    suffix = RECOMMENDED if recommended else ""
    if len(full) + len(suffix) <= LABEL_MAX:
        return full + suffix, False
    prefix = "%d. " % k
    room = LABEL_MAX - len(prefix) - len(ELLIPSIS) - len(suffix)
    words, cut = full.split(), ""
    for w in words:
        nxt = (cut + " " + w) if cut else w
        if len(nxt) > room:
            break
        cut = nxt
    if not cut:
        cut = full[:room].rstrip()
    return prefix + cut + ELLIPSIS + suffix, True


def framing(d):
    """(suffix, descriptions): a rank decision's Framing (asking.md § 3, ADR 0054 d8). The suffix follows the question
    text: its `goal`, when it has one, then NOTE_INVITE. The descriptions, one per option in the decision's order (the
    recommendation first): with `stakes` (one non-empty line per option, as estate-rank.py passes it), each option's
    stakes line, the recommended one's ending " Recommended: <why>"; without, the why on the recommendation and nothing
    on the rest (Rounds.options shows a bare label then)."""
    fulls = list(d.get("options") or [])
    why = d.get("why") or "the grader's recommendation"
    stakes = d.get("stakes")
    if isinstance(stakes, list) and fulls and len(stakes) == len(fulls) and \
            all(isinstance(x, str) and x.strip() for x in stakes):
        descs = [stakes[0].strip() + " Recommended: " + why] + [x.strip() for x in stakes[1:]]
    else:
        descs = [why] + ["" for _ in fulls[1:]]
    goal = d.get("goal")
    suffix = (" " + goal.strip() if isinstance(goal, str) and goal.strip() else "") + " " + NOTE_INVITE
    return suffix, descs


class Rounds:
    def __init__(self, M, rank, scan, vroot, budget, top):
        self.M, self.rank, self.scan, self.vroot = M, rank, scan, vroot
        self.budget, self.top = budget, top
        self.rows = {t["slug"]: t for t in rank["tasks"] if isinstance(t, dict) and isinstance(t.get("slug"), str)}
        self._clear = {}

    # A hold this pass can clear: One call or Grill (asked in this round), or held by such a chain.
    def clears(self, slug, visiting):
        if slug in self._clear:
            return self._clear[slug]
        if slug in visiting:
            return False
        visiting.add(slug)
        ok = True
        for h in (self.rows.get(slug) or {}).get("blockedBy") or []:
            why = h.get("why")
            if why in ("One call", "Grill"):
                continue
            if why == "held" and self.clears(h.get("slug"), visiting):
                continue
            ok = False
            break
        visiting.discard(slug)
        self._clear[slug] = ok
        return ok

    def task_note(self, slug):
        row = next((t for t in self.scan["tasks"] if isinstance(t, dict) and t.get("slug") == slug), None)
        return row.get("note") if row and isinstance(row.get("note"), str) else "Work/Tasks/%s.md" % slug

    def sign_offs(self):
        RR, ER = self.M.RR, self.M.ER
        out = []
        for r in sorted((x for x in self.scan["rollouts"] if isinstance(x, dict)), key=lambda x: str(x.get("slug"))):
            s = r.get("summary")
            if isinstance(s, dict):
                slugs = [x for x in (s.get("pendingSignOffs") or []) if isinstance(x, str)]
                needs = {e.get("slug") for e in (s.get("setAside") or [])
                         if isinstance(e, dict) and e.get("needsHuman")}
            else:
                key, gate = ER.slug_key(r.get("slug") or ""), status_key(RR.GATE_PENDING_STATUS)
                slugs = sorted(t["slug"] for t in self.scan["tasks"] if isinstance(t, dict)
                               and status_key(t.get("status")) == gate
                               and t.get("rollout") and ER.slug_key(t["rollout"]) == key)
                needs = set()
            for slug in slugs:
                rel = self.task_note(slug)
                text, gates, bounced, bounce = "", [], False, ""
                path = Path(os.path.join(self.vroot, *rel.split("/")))
                try:
                    note = RR.Note(path)
                    text = note.section_text(RR.GATE_PENDING_SECTION)
                    gates = [re.sub(r"^[-*]\s+", "", ln.strip()) for ln in text.split("\n") if ln.strip()]
                    bounced = note.has_heading(RR.GATE_BOUNCE_SECTION)
                    bounce = note.section_text(RR.GATE_BOUNCE_SECTION) if bounced else ""
                except (OSError, ValueError, UnicodeDecodeError):
                    pass
                if not isinstance(s, dict):
                    why = "status unread"
                elif s.get("paused") and s.get("pausedFor") != "sign-off":
                    why = "paused"
                elif s.get("pause_requested"):
                    why = "draining"
                elif slug in needs:
                    why = "needs you"
                else:
                    why = None
                out.append({"slug": slug, "rollout": r.get("slug"), "note": rel, "gateText": text, "gates": gates,
                            "bounced": bounced, "bounce": bounce, "ask": why is None and bool(gates), "why":
                            why if why or gates else "no gates under %s" % RR.GATE_PENDING_SECTION})
        return out

    def live(self):
        out = []
        for r in sorted((x for x in self.scan["rollouts"] if isinstance(x, dict)), key=lambda x: str(x.get("slug"))):
            s = r.get("summary") if isinstance(r.get("summary"), dict) else None
            counts = (s or {}).get("counts") or {}
            out.append({"slug": r.get("slug"), "note": r.get("note"), "shape": r.get("shape"),
                        "progress": (s or {}).get("progress"), "paused": (s or {}).get("paused"),
                        "pausedFor": (s or {}).get("pausedFor"),
                        "pauseRequested": bool((s or {}).get("pause_requested")),
                        "awaitingSignOff": bool((s or {}).get("awaitingSignOff")),
                        "live": (counts.get("running") or 0) + (counts.get("integrating") or 0),
                        "pendingSignOffs": list((s or {}).get("pendingSignOffs") or []), "error": r.get("error")})
        return out

    def run(self):
        ER = self.M.ER
        sign = self.sign_offs()
        asked = [x for x in sign if x["ask"]]
        so_min = len(asked) * ER.REVIEW_MINUTES["signOff"]
        left = self.budget - so_min
        one_min = ER.DECISION_MINUTES["One call"]
        stages = []
        for d in self.rank["decisions"]:
            if not isinstance(d, dict):
                continue
            kind = "one-call" if d.get("round") == "one-call" else "grill"
            mins = one_min * len(d.get("decisions") or []) if kind == "one-call" else d.get("minutes") or 0
            stages.append((0 if kind == "one-call" else 2, kind, d, mins))
        for u in self.rank["unpark"]:
            if isinstance(u, dict) and u.get("offer"):
                stages.append((1, "unpark", u, one_min))
        stages.sort(key=lambda x: x[0])  # stable: rank order inside each stage
        one_calls, unpark, grill, later, skipped = [], [], [], [], []
        mins = {"one-call": 0, "unpark": 0, "grill": 0}
        stopped = False
        for _, kind, item, m in stages:
            if kind != "unpark" and not self.clears(item["slug"], set()):
                skipped.append({"kind": kind, "slug": item["slug"], "blockedBy": item.get("blockedBy") or []})
                continue
            if stopped or m > left:
                stopped = True
                later.append({"kind": kind, ("project" if kind == "unpark" else "slug"):
                              item["project"] if kind == "unpark" else item["slug"], "minutes": m})
                continue
            left -= m
            mins[kind] += m
            if kind == "one-call":
                one_calls.append({"slug": item["slug"], "home": item.get("home"), "minutes": m,
                                  "decision": (item.get("decisions") or [None])[0],
                                  "blockedBy": item.get("blockedBy") or []})
            elif kind == "grill":
                grill.append({"slug": item["slug"], "home": item.get("home"), "minutes": m,
                              "decisions": item.get("decisions") or [], "blockedBy": item.get("blockedBy") or []})
            else:
                unpark.append(item)
        questions, index = [], []
        for so in asked:
            self.sign_off_q(so, questions, index)
        for oc in one_calls:
            self.one_call_q(oc, questions, index)
        for u in unpark:
            self.unpark_q(u, questions, index)
        texts = [q["question"] for q in questions]
        if len(set(texts)) != len(texts):
            fail(2, "two questions share a text; every question must open with its own [[slug]] or [[project]]")
        asks = [questions[i:i + QUESTIONS_MAX] for i in range(0, len(questions), QUESTIONS_MAX)]
        top = [{"rank": t.get("rank"), "slug": t.get("slug"), "home": t.get("home"), "grade": t.get("grade"),
                "shape": t.get("shape"), "size": t.get("size"), "leverage": t.get("leverage"),
                "dueSoon": t.get("dueSoon"), "deadline": t.get("deadline"), "review": t.get("review"),
                "blockedBy": t.get("blockedBy") or []}
               for t in self.rank["tasks"] if isinstance(t, dict) and t.get("rank") is not None][:self.top]
        used = so_min + mins["one-call"] + mins["unpark"] + mins["grill"]
        return {"schema": SCHEMA, "today": self.rank.get("today") or today_of(self.scan), "budget": self.budget,
                "top": top, "live": self.live(), "signOffs": sign, "oneCalls": one_calls, "unpark": unpark,
                "grill": grill, "later": later, "skipped": skipped, "asks": asks, "index": index,
                "minutes": {"signOffs": so_min, "oneCalls": mins["one-call"], "unpark": mins["unpark"],
                            "grill": mins["grill"], "used": used, "budget": self.budget}}

    @staticmethod
    def options(fulls, descriptions, recommend):
        opts, labels = [], []
        for k, (full, desc) in enumerate(zip(fulls, descriptions), 1):
            label, short = label_for(k, full, recommend and k == 1)
            if short:
                desc = full + (" — " + desc if desc and desc != full else "")
            opts.append({"label": label, "description": desc or full})
            labels.append(label)
        return opts, labels

    def sign_off_q(self, so, questions, index):
        n = len(so["gates"])
        text = "[[%s]] in [[%s]]: sign off its %d gated input%s, shown verbatim above?" % (
            so["slug"], so["rollout"], n, "" if n == 1 else "s")
        if so["bounced"]:
            text += (" The plan judge bounced this plan (ADR 0038): its feedback is under %s."
                     % self.M.RR.GATE_BOUNCE_SECTION)
        text += " " + NOTE_INVITE  # no pick: the authorisation is his (ADR 0008)
        descs = ["Signs exactly: " + " · ".join(so["gates"]), "Leaves it set aside; nothing is written"]
        opts, labels = self.options(SIGN_OFF_OPTIONS, descs, False)
        questions.append({"question": text, "header": HEADERS["sign-off"], "multiSelect": False, "options": opts})
        index.append({"question": text, "kind": "sign-off", "slug": so["slug"], "rollout": so["rollout"],
                      "note": so["note"], "labels": labels, "texts": list(SIGN_OFF_OPTIONS), "recommended": None,
                      "bounced": so["bounced"]})

    def one_call_q(self, oc, questions, index):
        d = oc["decision"] or {}
        fulls = [o for o in d.get("options") or []]
        suffix, descs = framing(d)
        text = "[[%s]] %s%s" % (oc["slug"], d.get("question") or "", suffix)
        opts, labels = self.options(fulls, descs, True)
        row = self.rows.get(oc["slug"]) or {}
        questions.append({"question": text, "header": HEADERS["one-call"], "multiSelect": False, "options": opts})
        entry = {"question": text, "kind": "one-call", "slug": oc["slug"], "note": row.get("note"), "labels": labels,
                 "texts": fulls, "recommended": fulls[0] if fulls else None}
        if d.get("fork"):
            entry["fork"] = d["fork"]
        index.append(entry)

    def unpark_q(self, u, questions, index):
        p = next((x for x in self.scan["projects"] if isinstance(x, dict) and x.get("note") == u.get("note")), {})
        open_tasks = [t for t in p.get("tasks") or [] if isinstance(t, str)]
        n, ready = len(open_tasks), u.get("ready") or 0
        names = ", ".join(open_tasks[:KILL_NAMES_MAX]) + (
            " and %d more" % (n - KILL_NAMES_MAX) if n > KILL_NAMES_MAX else "")
        sw = u.get("snoozeWrite") or {}
        text = "[[%s]]: %s. Unpark, snooze or kill it? %s" % (
            u["project"], u.get("why") or "parked with %d ready task%s" % (ready, "" if ready == 1 else "s"),
            NOTE_INVITE)  # no pick: parking is his standing call (ADR 0041)
        descs = ["status: queued; its Ready, unheld work starts this pass",
                 "asked again after %s, or sooner if its Ready work grows past %s"
                 % (sw.get("snoozed_until"), sw.get("snoozed_ready")),
                 "Mark done (done: true); its %d open task%s left unhomed%s" % (
                     n, " is" if n == 1 else "s are", ": " + names if names else "")]
        opts, labels = self.options(("unpark", "snooze", "kill"), descs, False)
        questions.append({"question": text, "header": HEADERS["unpark"], "multiSelect": False, "options": opts})
        index.append({"question": text, "kind": "unpark", "project": u["project"], "note": u.get("note"),
                      "labels": labels, "texts": ["unpark", "snooze", "kill"], "recommended": None,
                      "snoozeReady": sw.get("snoozed_ready")})


def cmd_rounds(args):
    rank, scan = read_rank(args.rank), read_scan(args.scan)
    M = Mods()
    vroot = vault_root(args.vault, scan)
    emit(Rounds(M, rank, scan, vroot, args.budget, args.top).run())


# ---- plan --------------------------------------------------------------------------------------------------------

class TaskIndex:
    """reconcile-rollout _scan's dependency index, read lazily: the stem (lower-cased) of every note under Work/Tasks,
    Archive included, to (path, RR.Note), a root copy preferred over an archived one. RR._fold_unit and RR._dep_status
    read it only through get(), so only the notes a dependency names are parsed."""

    def __init__(self, RR, tasks_dir):
        self.RR, self.tasks_dir, self.paths, self.found = RR, tasks_dir, {}, {}
        if tasks_dir.is_dir():
            for p in sorted(tasks_dir.rglob("*.md")):
                self.paths.setdefault(p.stem.lower(), []).append(p)

    def get(self, key, default=None):
        if key not in self.found:
            self.found[key] = None
            for p in sorted(self.paths.get(key, ()), key=lambda x: x.parent != self.tasks_dir):
                try:
                    self.found[key] = (p, self.RR.Note(p))
                    break
                except (OSError, ValueError):
                    continue
        got = self.found[key]
        return default if got is None else got


class Plan:
    def __init__(self, M, rank, scan, vroot, decided, unparked, signed):
        self.M, self.rank, self.scan, self.vroot = M, rank, scan, vroot
        self.rows = {t["slug"]: t for t in rank["tasks"] if isinstance(t, dict) and isinstance(t.get("slug"), str)}
        self.decided = {s for s, t in self.rows.items() if t.get("grade") == "Ready"} | set(decided)
        self.unparked = set(unparked)
        self.signed = set(signed)
        self._clear, self._deps, self._index = {}, {}, None
        self.open = {}  # the scan's tasks (open: not landed, not archived) by lower-case slug, the first one kept
        for t in self.scan["tasks"]:
            if isinstance(t, dict) and isinstance(t.get("slug"), str):
                self.open.setdefault(t["slug"].lower(), t)

    def index(self):
        if self._index is None:
            self._index = TaskIndex(self.M.RR, Path(self.vroot) / self.M.NA.TASKS_DIR)
        return self._index

    def deps(self, slug):
        """[(dependency, why)], in dependsOn[] order: each dependency that would hold the task's rollout row, read as
        the module docstring's plan paragraph on dependencies says. DEP_UNSCHEDULED marks one needed (an open scan
        task, not in flight, that a scheduled entry must hold); DEP_DROPPED and DEP_MISSING one that never lands."""
        if slug in self._deps:
            return self._deps[slug]
        RR, out = self.M.RR, []
        for link in (self.rows.get(slug) or {}).get("dependsOn") or []:
            key = self.M.ER.slug_key(link)
            t = self.open.get(key)
            if t is None:
                if not key or RR._dep_status(key, self.index())[0]:
                    continue
                t = self.open.get(RR._fold_unit(key, self.index())[0].lower())
            if t is None:
                found = self.index().get(key)
                dep = (found[0].stem, DEP_DROPPED) if found else (key, DEP_MISSING)
            elif t.get("inFlight"):
                continue
            else:
                dep = (t["slug"], DEP_UNSCHEDULED)
            if all(d != dep[0] for d, _ in out):
                out.append(dep)
        self._deps[slug] = out
        return out

    def home_unparked(self, slug):
        t = self.rows.get(slug) or {}
        note = next((r.get("note") for r in self.rank["runs"] if slug in (r.get("ready") or [])
                     + (r.get("waiting") or []) + (r.get("blocked") or [])), None)
        return t.get("home") in self.unparked or (note is not None and note in self.unparked)

    def clear(self, slug, visiting):
        """Every hold on the task clears this pass."""
        if slug in self._clear:
            return self._clear[slug]
        if slug in visiting:
            return False
        visiting.add(slug)
        ok = True
        for h in (self.rows.get(slug) or {}).get("blockedBy") or []:
            d, why = h.get("slug"), h.get("why")
            if why in ("One call", "Grill"):
                good = d in self.decided and self.clear(d, visiting)
            elif why == "held":
                good = self.clear(d, visiting)
            elif why == "parked":
                good = self.home_unparked(d) and self.clear(d, visiting)
            else:
                good = False
            if not good:
                ok = False
                break
        visiting.discard(slug)
        self._clear[slug] = ok
        return ok

    def clear_one(self, h):
        d, why = h.get("slug"), h.get("why")
        if why in ("One call", "Grill"):
            return d in self.decided and self.clear(d, set())
        if why == "held":
            return self.clear(d, set())
        if why == "parked":
            return self.home_unparked(d) and self.clear(d, set())
        return False

    def choose(self, late):
        """(held, undecided, entries, waiting, lost): the runs chosen with every slug in `late` held. lost is the set
        of members the dependencies took; a waiting row that lost every member carries `_lost` for run() to word."""
        held, undecided, runs = {}, {}, []
        for order, run in enumerate(r for r in self.rank["runs"] if isinstance(r, dict)):
            slugs = sorted(set((run.get("ready") or []) + (run.get("waiting") or []) + (run.get("blocked") or [])),
                           key=lambda s: (self.rows.get(s, {}).get("rank") is None,
                                          self.rows.get(s, {}).get("rank") or 0, s))
            parked = bool(run.get("parked"))
            unparked = parked and (run.get("project") in self.unparked or run.get("note") in self.unparked)
            members, lost = [], []
            for s in slugs:
                t = self.rows.get(s) or {}
                if s in late:  # only ever a former member, so decided with every rank hold clear
                    lost.append(s)
                elif parked:
                    if t.get("grade") == "Ready" and not t.get("blockedBy"):
                        members.append(s)
                    elif unparked:
                        (undecided if t.get("grade") != "Ready" else held)[s] = t
                elif s not in self.decided:
                    undecided[s] = t
                elif not self.clear(s, set()):
                    held[s] = t
                else:
                    members.append(s)
            # A run that waits whatever the root contest decides: parked, rootless or blocked.
            fixed = (parked and not unparked) or (run.get("shape") == "parallel" and not run.get("root")) \
                or bool(run.get("blockers"))
            runs.append((order, run, parked and not unparked, members, lost, fixed))
        # The pre-hold, before any root is contested: a member whose dependency can never go this pass, whatever the
        # contest decides, is held, transitively. Only a member of a run the contest can schedule may go.
        pool = {s for _, _, _, members, _, fixed in runs if not fixed for s in members}
        while True:
            out = {s for s in pool if any(why != DEP_UNSCHEDULED or d not in pool for d, why in self.deps(s))}
            if not out:
                break
            pool -= out
        entries, waiting, roots, gone = [], [], {}, set()
        for order, run, still_parked, members, lost, fixed in runs:
            if not fixed:
                lost = lost + [s for s in members if s not in pool]
                members = [s for s in members if s in pool]
            for s in lost:
                held[s] = self.rows.get(s) or {}
                gone.add(s)
            why = None
            if still_parked:
                why = {"kind": "parked", "detail": "the project is parked: its Unpark offer decides"}
            elif not members and lost:
                why = {"kind": DEP_UNSCHEDULED, "detail": None}  # worded by run() from the final schedule
            elif not members:
                why = {"kind": "nothing decided", "detail": "no member is decided with every hold clear"}
            elif run.get("shape") == "parallel" and not run.get("root"):
                kind = run.get("why") or "repo unknown"
                why = {"kind": kind, "detail": "a parallel run needs one declared repo to root it"
                       if kind == "repo unknown" else "the project declares no repos:"}
            elif run.get("blockers"):
                why = {"kind": "blocker", "detail": "; ".join("%s: %s" % (b.get("check"), b.get("why"))
                                                              for b in run["blockers"] if isinstance(b, dict))}
            elif run.get("shape") == "parallel":
                key = run.get("rolloutRoot") or run.get("root")
                if key in roots:
                    why = {"kind": "same root", "detail": "%s goes on %s" % (roots[key], key)}
                else:
                    roots[key] = run.get("id")
            row = {"run": run.get("id"), "project": run.get("project"), "note": run.get("note"),
                   "shape": run.get("shape"), "root": run.get("root"), "rolloutRoot": run.get("rolloutRoot"),
                   "members": members}
            if why:
                row["why"] = why
                if why["detail"] is None:
                    row["_lost"] = lost
                waiting.append(row)
                continue
            review = {k: sum((self.rows[m].get("review") or {}).get(k) or 0 for m in members)
                      for k in ("pr", "signOff", "eyeCheck", "minutes")}
            name = run.get("project") or ""
            row.update(projectSlug=project_slug(name), batchKeys=batch_keys(name), args="--tasks " + ",".join(members),
                       batch=None, review=review, _order=order)
            entries.append(row)
        return held, undecided, entries, waiting, gone

    def run(self):
        # The pre-hold (choose) foresees every dependency that cannot go whatever the root contest decides. What it
        # cannot foresee is a dependency in a run that loses its root: its dependants are held after the contest, and
        # the runs are chosen again, since a run can lose every member and free its root. `late` only grows, so this
        # stops within one round per task, and the plan never flips back.
        late = {}
        while True:
            held, undecided, entries, waiting, gone = self.choose(late)
            scheduled = {m for e in entries for m in e["members"]}
            more = {}
            for e in entries:
                for m in e["members"]:
                    missing = [d for d, _ in self.deps(m) if d not in scheduled]
                    if missing:
                        more[m] = missing
            if not more:
                break
            late.update(more)

        def dep_holds(s):
            """Its dependency holds, read against the final schedule: only dependencies still not scheduled, or, when a
            later round scheduled every one, the ones it was held for, as DEP_LATE."""
            out = [{"slug": d, "why": why} for d, why in self.deps(s) if why != DEP_UNSCHEDULED or d not in scheduled]
            return out or [{"slug": d, "why": DEP_LATE} for d in late.get(s) or []]

        for w in waiting:
            lost = w.pop("_lost", None)
            if lost is None:
                continue
            holds = [h for s in lost for h in dep_holds(s)]
            absent = sorted({h["slug"] for h in holds if h["why"] != DEP_LATE})
            if absent:
                w["why"]["detail"] = "every member left depends on a task no scheduled run holds: " + ", ".join(absent)
            else:
                w["why"] = {"kind": DEP_LATE, "detail": "every member left was held before its dependency was "
                            "scheduled, and goes next pass: " + ", ".join(sorted({h["slug"] for h in holds}))}
        # Batches: parallel entries take the lowest batch whose keys never meet theirs; serial ones follow, one each.
        batches = []
        for e in (x for x in entries if x["shape"] == "parallel"):
            keys = set(e["batchKeys"])
            for i, b in enumerate(batches):
                if not keys & b:
                    b |= keys
                    e["batch"] = i + 1
                    break
            else:
                batches.append(set(keys))
                e["batch"] = len(batches)
        n = len(batches)
        for e in (x for x in entries if x["shape"] != "parallel"):
            n += 1
            e["batch"] = n
        entries.sort(key=lambda e: (e["batch"], e["_order"]))
        order = ("run", "project", "note", "projectSlug", "batchKeys", "shape", "root", "rolloutRoot", "members",
                 "args", "batch", "review")
        schedule = [{k: e[k] for k in order} for e in entries]
        rollouts = self.rollouts()
        projects = {p.get("note"): p for p in self.scan["projects"] if isinstance(p, dict)}
        orient = [{"name": o.get("project"), "note": o.get("note"), "area": list((projects.get(o.get("note")) or {})
                   .get("area") or [])} for o in self.rank["orient"] if isinstance(o, dict)]
        run_of = {}
        for r in self.rank["runs"]:
            for s in (r.get("ready") or []) + (r.get("waiting") or []) + (r.get("blocked") or []):
                run_of[s] = r.get("id")
        return {
            "schema": SCHEMA, "vault": self.vroot, "today": self.rank.get("today") or today_of(self.scan),
            "schedule": schedule, "waiting": waiting, "rollouts": rollouts,
            "reinstate": [r["slug"] for r in rollouts if r["reinstate"]], "orient": orient,
            "held": [{"slug": s, "run": run_of.get(s), "grade": t.get("grade"),
                      "blockedBy": [h for h in t.get("blockedBy") or [] if not self.clear_one(h)]
                      + (dep_holds(s) if s in gone else [])} for s, t in sorted(held.items())],
            "undecided": [{"slug": s, "run": run_of.get(s), "grade": t.get("grade")}
                          for s, t in sorted(undecided.items())],
            "sessionLane": [{"slug": t["slug"], "home": t.get("home"), "grade": t.get("grade")}
                            for t in sorted(self.rows.values(), key=lambda t: t["slug"])
                            if t.get("shape") == "session" and t.get("grade") != "Orient"],
        }

    def rollouts(self):
        RR, ER, NA = self.M.RR, self.M.ER, self.M.NA
        rows = [r for r in self.scan["rollouts"] if isinstance(r, dict)]
        named = {ER.slug_key(r["supersedes"]) for r in rows if r.get("supersedes")}
        owners = {}
        vault = NA.Vault(self.vroot)
        for t in self.scan["tasks"]:
            if isinstance(t, dict) and t.get("rollout") and isinstance(t.get("note"), str):
                owner = vault.note(os.path.join(*t["note"].split("/"))).get("owner")
                if isinstance(owner, str) and owner.strip():
                    owners.setdefault(ER.slug_key(t["rollout"]), set()).add(owner.strip())
        out = []
        for r in sorted(rows, key=lambda x: str(x.get("slug"))):
            s = r.get("summary") if isinstance(r.get("summary"), dict) else None
            note, stamped, shape = None, False, "parallel"
            try:
                note = RR.Note(Path(os.path.join(self.vroot, *str(r.get("note")).split("/"))))
                stamped, shape = RR._start_unattended(note), RR._shape(note)
            except (OSError, ValueError, UnicodeDecodeError):
                pass
            counts = (s or {}).get("counts") or {}
            holds = set()
            if r.get("supersededBy"):
                holds.add("superseded")
            if ER.slug_key(r.get("slug") or "") in named:
                holds.add("lineage")
            if not is_five(r.get("protocolVersion")):
                holds.add("version")
            if s and s.get("incomplete"):
                holds.add("incomplete")
            if shape == "serial":
                holds.add("serial")
            if s and s.get("paused"):
                holds.add("paused")
            if s and s.get("pause_requested"):
                holds.add("draining")
            if (counts.get("running") or 0) + (counts.get("integrating") or 0) > 0:
                holds.add("live queue")
            if stamped:
                holds.add("start stamp")
            if s is None:
                holds.add("status unread")
            holds = [h for h in HOLDS if h in holds]
            pending = [x for x in (s or {}).get("pendingSignOffs") or [] if isinstance(x, str)]
            reinstate = bool(s and s.get("awaitingSignOff") and all(p in self.signed for p in pending))
            row = {"slug": r.get("slug"), "note": r.get("note"), "shape": shape, "projectRoot": r.get("projectRoot"),
                   "pausedFor": (s or {}).get("pausedFor")}
            mine = owners.get(ER.slug_key(r.get("slug") or ""))
            if mine:
                row["owners"] = sorted(mine)
            row.update(holds=holds, canExecute=not holds or (reinstate and holds == ["paused"]),
                       canRepair=not (set(holds) & NO_REPAIR), reinstate=reinstate)
            out.append(row)
        return out


def cmd_plan(args):
    rank, scan = read_rank(args.rank), read_scan(args.scan)
    if args.assume_answered and not args.rounds:
        fail(2, "--assume-answered needs --rounds")
    if args.rounds and not args.assume_answered:
        fail(2, "--rounds is read only with --assume-answered (the dry run)")
    decided = list(args.decided or [])
    if args.rounds:
        r = read_json(args.rounds, "rounds", SCHEMA)
        decided += [x.get("slug") for x in (r.get("oneCalls") or []) + (r.get("grill") or [])
                    if isinstance(x, dict) and isinstance(x.get("slug"), str)]
    M = Mods()
    vroot = vault_root(args.vault, scan)
    emit(Plan(M, rank, scan, vroot, decided, args.unparked or [], args.signed or []).run())


# ---- sessions ----------------------------------------------------------------------------------------------------

def queue_row1(M, note):
    """(alias, folder) of the `## Queue` table's first data row, read with leg.py's own row grammar, or (None, None)."""
    LEG = M.LEG
    found = note._section_bounds(LEG.QUEUE)
    if found is None:
        return None, None
    lines, start, end = found
    for k in range(start + 1, end):
        cells = LEG.split_cells(lines[k])
        if len(cells) < 3 or not LEG.LINK_RE.search(cells[1]):
            continue
        m = LEG.LAUNCH_RE.match(cells[2])
        return (m.group(1), m.group(2)) if m else (None, None)
    return None, None


def cmd_sessions(args):
    plan = read_json(args.plan, "plan", PLAN_SCHEMA)
    for key in ("rollouts", "orient", "schedule"):
        if not isinstance(plan.get(key), list):
            fail(2, "the plan %s has no %s list" % (args.plan, key))
    rollouts = {r["slug"]: r for r in plan["rollouts"] if isinstance(r, dict) and isinstance(r.get("slug"), str)}
    status = {}
    for raw in args.status or []:
        slug, sep, n = raw.partition("=")
        if not sep or slug not in rollouts:
            fail(2, "--status %s: name a rollout of the plan as SLUG=N" % raw)
        if not re.fullmatch(r"\d+", n.strip()) or not 1 <= int(n) <= 13:
            fail(2, "--status %s: N is the status § 4 action number, 1 to 13" % raw)
        status[slug] = int(n)
    M = Mods(leg=True)
    RR, NA = M.RR, M.NA
    vroot = vault_root(args.vault, plan)
    tasks_dir = os.path.realpath(os.path.join(vroot, NA.TASKS_DIR))
    vault = NA.Vault(vroot)
    today = today_of(plan)
    wrote = []
    for p in args.wrote or []:
        full = os.path.realpath(os.path.expanduser(p))
        if os.path.dirname(full) != tasks_dir or not full.endswith(".md") or not os.path.isfile(full):
            fail(2, "--wrote %s: not a note directly in %s" % (p, tasks_dir))
        wrote.append(full)
    items = []
    for full in wrote:
        slug = os.path.basename(full)[:-3]
        rel = os.path.relpath(full, vault.root).replace(os.sep, "/")
        try:
            note = RR.Note(Path(full))
        except (OSError, ValueError, UnicodeDecodeError) as e:
            fail(2, "--wrote %s: %s" % (full, e))
        if RR._shape(note) == "serial":
            alias, folder = queue_row1(M, note)
            items.append({"kind": "leg", "rollout": slug, "note": rel, "title": titled("Leg 1: %s" % slug),
                          "cwd": os.path.expanduser(folder) if folder else None, "alias": alias,
                          "prompt": "/thread:execute [[%s]]\nLeg 1 of the serial chain; the brief is the rollout "
                                    "note: %s" % (slug, full),
                          "tldr": "Leg 1 of the serial rollout orient-all scheduled this pass. It works the chain's "
                                  "first tasks and hands the rest on.",
                          "manual": not alias or alias.startswith("cx-") or not folder, "why": "written this pass"})
        else:
            m = RR.PROJECT_ROOT_RE.search(note._body)
            cwd = os.path.expanduser(m.group(1).strip()) if m else None
            items.append({"kind": "execute", "rollout": slug, "note": rel, "title": titled("Execute: %s" % slug),
                          "cwd": cwd, "prompt": "/thread:execute [[%s]]" % slug,
                          "tldr": "Runs the parallel rollout orient-all scheduled this pass, to the end.",
                          "manual": cwd is None, "why": "written this pass"})
    executes, repairs, left = [], [], []
    for slug in sorted(rollouts):
        r = rollouts[slug]
        n = status.get(slug)
        if n is None:
            left.append({"rollout": slug, "action": None, "holds": r.get("holds") or [], "why": "status unread"})
            continue
        kind, words = STATUS_ACTIONS[n]
        root = os.path.expanduser(r["projectRoot"]) if r.get("projectRoot") else None
        # canExecute is every hold clear, but for the sign-off pause when every gate is signed (reinstate): so a
        # reinstate needs both, and a sign-off pause with any other hold (serial, a start stamp, a drain) gets nothing.
        if kind in ("execute", "reinstate") and r.get("canExecute") and (kind == "execute" or r.get("reinstate")):
            why = ("status action 8: the sign-off pause, every gate signed this pass" if kind == "reinstate"
                   else "status action %d: %s" % (n, words))
            executes.append({"kind": "execute", "rollout": slug, "note": r.get("note"),
                             "title": titled("Execute: %s" % slug), "cwd": root,
                             "prompt": "/thread:execute [[%s]]" % slug,
                             "tldr": "Moves a live rollout on, as its status report recommends.",
                             "manual": root is None, "why": why})
        elif kind == "repair" and r.get("canRepair"):
            repairs.append({"kind": "repair", "rollout": slug, "note": r.get("note"),
                            "title": titled("Repair: %s" % slug), "cwd": root, "prompt": "/thread:repair [[%s]]" % slug,
                            "tldr": "Sorts out a live rollout that status says needs repair.",
                            "manual": False, "why": "status action %d: %s" % (n, words)})
        else:
            if kind is None:
                why = "status action %d (%s) starts nothing from here" % (n, words)
            elif kind == "reinstate" and r.get("reinstate"):
                why = "status action 8 (%s): every gate signed, but held by %s" % (
                    words, ", ".join(h for h in r.get("holds") or [] if h != "paused") or "nothing")
            elif kind == "reinstate" and r.get("pausedFor") == "sign-off":
                why = "status action 8 (%s): a gate is still unsigned, so the sign-off pause holds" % words
            elif kind == "reinstate" and "paused" in (r.get("holds") or []):
                why = "status action 8 (%s): paused by you: the reinstate is yours" % words
            elif kind == "reinstate":
                why = "status action 8 (%s), but the plan reads no sign-off pause to reinstate" % words
            else:
                why = "status action %d (%s) held by %s" % (n, words, ", ".join(r.get("holds") or []) or "nothing")
            left.append({"rollout": slug, "action": n, "holds": r.get("holds") or [], "why": why})
    orients = []
    projects = {}
    for full in wrote:
        rel = os.path.relpath(full, vault.root)
        for link in NA.links_in(vault.note(rel).get("projects")):
            prel, why = vault.resolve_project(link, link=True)
            if prel:
                projects.setdefault(prel.replace(os.sep, "/"), []).append(os.path.basename(full)[:-3])
    for o in plan["orient"]:
        if not isinstance(o, dict) or not isinstance(o.get("name"), str):
            continue
        lines = ["/thread:orient [[%s]]" % o["name"]]
        for slug in projects.get(o.get("note"), []):
            lines.append("orient-all wrote [[%s]] for this project on %s and is starting its execute; leave that "
                         "rollout to it, its tasks are in flight." % (slug, today))
        orients.append({"kind": "orient", "project": o["name"], "note": o.get("note"),
                        "title": titled("Orient: %s" % o["name"]), "prompt": "\n".join(lines),
                        "tldr": "Orients this project: its open work needs decisions that shape it.",
                        "manual": False, "why": "graded Orient"})
    emit({"schema": SCHEMA, "today": today, "items": items + executes + repairs + orients, "left": left})


# ---- record ------------------------------------------------------------------------------------------------------

def body_headings(lines, first):
    """[(index, stripped text)] of every `## ` line from `first` on, outside a fence."""
    out, fence = [], False
    for i in range(first, len(lines)):
        ln = lines[i].rstrip("\r\n")
        if FENCE.match(ln):
            fence = not fence
            continue
        if not fence and ln.startswith("## "):
            out.append((i, ln.strip()))
    return out


def section_span(lines, first, heading):
    """(heading index, end index) of the first `heading` outside a fence, or None."""
    heads = body_headings(lines, first)
    for k, (i, text) in enumerate(heads):
        if text == heading:
            return i, heads[k + 1][0] if k + 1 < len(heads) else len(lines)
    return None


def insert_last(lines, span, line):
    """`line` placed after the section's last non-blank line (just under its heading, after a blank, when empty)."""
    h, end = span
    last = max((i for i in range(h + 1, end) if lines[i].strip()), default=None)
    if last is None:
        return lines[:h + 1] + ["\n", line + "\n"] + lines[h + 1:]
    if not lines[last].endswith("\n"):
        lines = lines[:last] + [lines[last] + "\n"] + lines[last + 1:]
    return lines[:last + 1] + [line + "\n"] + lines[last + 1:]


SELF_LINK = re.compile(r"\[\[([^\[\]]*)\]\](?:\s+|$)")


def without_self_link(q, slug, slug_key):
    """The folded question with a leading link to its own task (`[[<slug>]] `, as a rounds index text opens) cut, so
    the bullet never links the note to itself and the bare question reads as the same answer."""
    m = SELF_LINK.match(q)
    return q[m.end():] if m and slug_key("[[%s]]" % m.group(1)) == slug.lower() else q


def latest_end_forks(lines, span):
    """(index, forks) of the last `orient end:` line in the section, or (None, [])."""
    hit = None
    for i in range(span[0] + 1, span[1]):
        if END_MARK in lines[i]:
            hit = i
    if hit is None:
        return None, []
    forks = []
    for piece in lines[hit].rstrip("\r\n").split(FORK_MARK)[1:]:
        forks.append(fold(re.split(r";\s*evidence:|;", piece, maxsplit=1)[0]))
    return hit, forks


class Refusal(Exception):
    """A record refusal: its exit code and its one `estate-dispatch:` line (nothing written)."""

    def __init__(self, code, reason):
        super().__init__(reason)
        self.code = code


def decided_bullet(q, a, by, owner, why):
    """DECIDED_BULLET, its `: {why}` dropped when there is no why."""
    form = DECIDED_BULLET if why else DECIDED_BULLET.replace(": {why}", "")
    return form.format(question=q, answer=a, by=by, owner=owner, why=why or "")


def record_core(M, vault, task, question, answer, today, by, recommended=None, fork=None, owner=None, why=None,
                superseding=None):
    """(status, line): one answer, or with `owner` one call made for Lachy, into its task note (the module docstring's
    record paragraph). status is `recorded` or `no-change`, line what `record` prints. Raises Refusal on every record
    refusal, the file byte-identical. Shared by `record` and `decided-for-you --write`."""
    NA, ES = M.NA, M.ES
    q, a = fold(question), fold(answer)
    rec = fold(recommended) if recommended is not None else None
    fork = fold(fork) if fork is not None else None
    why = fold(why) if why is not None else None
    for flag, v in (("--question", q), ("--answer", a), ("--recommended", rec), ("--fork", fork)):
        if v == "":
            raise Refusal(2, "%s is empty" % flag)
    try:
        rel = vault.resolve_task(task)
    except NA.Refused as e:
        raise Refusal(2, str(e))
    shown = rel.replace(os.sep, "/")
    q = without_self_link(q, os.path.basename(rel)[:-3], M.ER.slug_key)
    if q == "":
        raise Refusal(2, "--question is empty once its leading [[%s]] is stripped" % os.path.basename(rel)[:-3])
    note = NA.Note.load(os.path.join(vault.root, rel))
    if note.fm is None:
        raise Refusal(2, "%s: %s" % (shown, note.error))
    if "task" not in NA.tags_of(note):
        raise Refusal(2, "%s is not a task note" % shown)
    st = NA.status_of(note)
    if st not in NA.OPEN_STATUSES:
        raise Refusal(2, "%s is at status %s, not Active; a decision is written only into Active work" % (shown, st or "none"))
    link = ES.first_link(NA, note.get("rollout"))
    if ES.in_flight(st, ES.link_live(NA, vault, link)) and not ES.still_to_start(st, link, superseding):
        raise Refusal(2, "%s is in flight (vault-grammar.md § In flight); its run owns the note, so the answer is not "
                         "written" % shown)
    lines = list(note.lines)
    first = note.span[1] + 1
    notes = section_span(lines, first, NOTES_HEADING)
    ruled = False
    if fork is not None:
        end_at, forks = latest_end_forks(lines, notes) if notes else (None, [])
        if fork not in forks:
            raise Refusal(2, "%s: its latest orient end line names no `fork for Lachy: %s`" % (shown, fork))
        tail = " orient ruling: %s → %s" % (fork, a)
        ruled = any(ln.rstrip("\r\n").endswith(tail) for ln in lines[end_at + 1:notes[1]])
    if owner is not None:  # a call made for Lachy (ADR 0054 d3): its own heading and preamble, never ## Decisions
        bullet = decided_bullet(q, a, by, owner, why)
        heading = DECIDED_HEADING.format(date=today.isoformat())
        opening = heading + "\n\n" + DECIDED_PREAMBLE + "\n\n" + bullet + "\n"
    else:
        bullet = DECISION_BULLET.format(question=q, answer=a, recommended=rec, by=by)
        heading = DECISIONS_HEADING.format(date=today.isoformat())
        opening = heading + "\n\n" + bullet + "\n"
    span = section_span(lines, first, heading)
    has = span is not None and any(lines[i].rstrip("\r\n") == bullet for i in range(span[0] + 1, span[1]))
    if has and (fork is None or ruled):
        return "no-change", "%s: %s → %s [no-change]" % (shown, q, a)
    if fork is not None and not ruled:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        lines = insert_last(lines, notes, RULING_LINE.format(stamp=stamp, fork=fork, answer=a))
    if not has:
        span = section_span(lines, first, heading)
        if span is not None:
            lines = insert_last(lines, span, bullet)
        else:
            text = "".join(lines)
            if text and not text.endswith("\n"):
                text += "\n"
            if text and not text.endswith("\n\n"):
                text += "\n"
            lines = NA.split_lines(text + opening)
    try:
        note.save("".join(lines))
    except OSError as e:
        raise Refusal(2, "cannot write %s: %s" % (shown, e))
    return "recorded", "recorded %s: %s → %s" % (shown, q, a)


def cmd_record(args):
    if args.owner is not None and args.fork is not None:
        fail(2, "--fork is never a call made for Lachy: an open fork stays his (ADR 0054), so --owner takes no --fork")
    if args.owner is not None and args.recommended is not None:
        fail(2, "--recommended goes only with an answer: a call made for Lachy (--owner) is the call itself, "
                "so --owner takes no --recommended")
    if args.owner is None and args.recommended is None:
        fail(2, "--recommended is required for an answer (only a call made for Lachy, --owner, goes without)")
    if args.owner is None and args.by not in RECORD_BY:
        fail(2, "--by %s writes only a call made for Lachy (--owner); an answer is recorded --by %s"
             % (args.by, " or ".join(RECORD_BY)))
    if args.owner is None and args.why is not None:
        fail(2, "--why goes only with --owner")
    for flag, v in (("--question", args.question), ("--answer", args.answer), ("--recommended", args.recommended),
                    ("--fork", args.fork)):
        if v is not None and fold(v) == "":
            fail(2, "%s is empty" % flag)
    M = Mods()
    vroot = os.path.expanduser(args.vault)
    if not os.path.isdir(vroot):
        fail(3, "no vault at %s" % vroot)
    try:
        _, line = record_core(M, M.NA.Vault(vroot), args.task, args.question, args.answer, args.today, args.by,
                              recommended=args.recommended, fork=args.fork, owner=args.owner,
                              why=args.why, superseding=args.superseding)
    except Refusal as e:
        fail(e.code, str(e))
    sys.stdout.write(line + "\n")


# ---- decided-for-you ---------------------------------------------------------------------------------------------

def cmd_decided(args):
    rank = read_rank(args.rank)
    ER = load("thread_estate_rank", ESTATE_RANK_PY)
    slugs = split_slugs(args.tasks)
    if not slugs:
        fail(2, "--tasks names no task")
    if args.today is None:
        raw = rank.get("today")
        args.today = datetime.date.fromisoformat(raw) if isinstance(raw, str) and ISO_DATE.fullmatch(raw) \
            else datetime.date.today()
    rows = {}
    for t in rank["tasks"]:
        if isinstance(t, dict) and isinstance(t.get("slug"), str):
            rows.setdefault(ER.slug_key(t["slug"]), t)
    items, skipped, seen = [], [], set()
    for raw in slugs:
        k = ER.slug_key(raw)
        if not k or k in seen:
            continue
        seen.add(k)
        row = rows.get(k)
        if row is None:
            skipped.append({"slug": raw, "why": "not in the rank"})
            continue
        for d in row.get("decidedForYou") or []:
            if not isinstance(d, dict):
                continue
            items.append({"slug": row["slug"], "note": row.get("note"), "question": d.get("question"),
                          "answer": d.get("recommendation"), "options": list(d.get("options") or []),
                          "owner": d.get("owner"), "confidence": d.get("confidence"), "why": d.get("why")})
    out = {"schema": SCHEMA, "today": args.today.isoformat(), "items": items, "skipped": skipped, "written": [],
           "unchanged": [], "refused": []}
    if args.write:
        M = Mods()
        vroot = os.path.expanduser(args.vault)
        if not os.path.isdir(vroot):
            fail(3, "no vault at %s" % vroot)
        vault = M.NA.Vault(vroot)
        for it in items:
            try:
                if it["owner"] not in DECIDED_OWNERS:
                    raise Refusal(2, "owner %s is not one a call made for Lachy carries (%s)"
                                  % (json.dumps(it["owner"]), ", ".join(DECIDED_OWNERS)))
                status, _ = record_core(M, vault, it["slug"], it["question"] or "", it["answer"] or "", args.today,
                                        args.by, owner=it["owner"], why=it["why"], superseding=args.superseding)
            except Refusal as e:
                out["refused"].append({"slug": it["slug"], "question": it["question"], "why": str(e)})
                continue
            out["written" if status == "recorded" else "unchanged"].append({"slug": it["slug"], "question": it["question"]})
    emit(out)


# ---- log -------------------------------------------------------------------------------------------------------

def grade_fields(RRec, t, row, pass_id, digest):
    """One rank tasks[] entry as a `grade` line's fields (the docstring's log rule)."""
    decisions = t.get("decisions") if isinstance(t.get("decisions"), list) else []
    gates = []
    for g in t.get("gates") or []:
        if g not in gates:
            gates.append(g)
    f = {"pass": pass_id, "digest": digest, "project": t.get("home"), "grade": t.get("grade"),
         "agentGrade": t.get("agentGrade"), "shape": t.get("shape"), "size": t.get("size"), "decisions": len(decisions),
         "low": sum(1 for d in decisions if isinstance(d, dict) and d.get("confidence") == "low"),
         "held": bool(t.get("blockedBy")), "gates": gates}
    raised = [r.get("why") for r in t.get("raised") or [] if isinstance(r, dict)]
    if raised:
        f["raised"] = raised
    if t.get("rank") is not None:
        f["rank"] = t["rank"]
    link = (row or {}).get("rollout")
    if isinstance(link, str):
        try:
            slug = RRec.normalise_slug(link)
        except RRec.Refused:
            slug = None
        if slug and slug not in RRec.RESERVED:
            f["linked"] = slug
    return f


def grade_key(RRec, name):
    """(task, note): a rank task's Grade-log key. Its slug and no note (run_record's normalise_slug), else, for a titled
    vault note, title_key's key and the exact name kept as the line's note (p34-6). Refused when the name has no key."""
    try:
        return RRec.normalise_slug(name, "task"), None
    except RRec.Refused:
        return RRec.title_key(name), name


def logged(RRec):
    """{digest: {task: (pass, ts)}} of the grade lines already in grades.jsonl; a torn line is skipped, and a log that
    cannot be read (or an events dir that cannot be resolved) reads as empty."""
    out = {}
    try:
        path = os.path.join(RRec.events_dir(), RRec.GRADE_LOG + ".jsonl")
        with open(path, "rb") as fh:
            raw = fh.read().split(b"\n")
    except (OSError, ValueError):
        return out
    for line in raw:
        try:
            d = json.loads(line)
        except ValueError:
            continue
        if isinstance(d, dict) and d.get("kind") == "grade" and isinstance(d.get("digest"), str) \
                and isinstance(d.get("task"), str):
            out.setdefault(d["digest"], {}).setdefault(d["task"], (d.get("pass"), d.get("ts")))
    return out


def cmd_log(args):
    rank = read_rank(args.rank)
    scan = read_scan(args.scan)
    RRec = load("thread_run_record", RUN_RECORD_PY)
    rows = {r["slug"].lower(): r for r in scan["tasks"] if isinstance(r, dict) and isinstance(r.get("slug"), str)}
    tasks = [t for t in rank["tasks"] if isinstance(t, dict)]
    for t in tasks:
        if not isinstance(t.get("slug"), str):
            fail(2, "the rank %s has a task with no slug" % args.rank)
    key = sorted((t["slug"], str(t.get("grade")), str(t.get("agentGrade")), str(t.get("shape")), str(t.get("size")))
                 for t in tasks)
    text = json.dumps([os.path.realpath(args.rank), str(rank.get("today")), key], ensure_ascii=True)
    digest = hashlib.sha1(text.encode("ascii")).hexdigest()[:12]
    have = logged(RRec).get(digest, {})
    now = datetime.datetime.now(datetime.timezone.utc)
    pass_id = "g-%s-%s" % (now.strftime("%Y%m%dT%H%M%SZ"), secrets.token_hex(3))
    ts = now.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (now.microsecond // 1000)
    if have:  # complete the pass already begun: its id and ts
        pass_id, ts = sorted(have.values(), key=lambda x: (str(x[1]), str(x[0])))[0]
    keyed = []
    for t in tasks:
        try:
            keyed.append((t,) + grade_key(RRec, t["slug"]) + (None,))
        except RRec.Refused as e:
            keyed.append((t, None, None, str(e)))
    # A slug-named task holds its key first; a titled name whose key is already held is skipped, so two notes never
    # share one task's episodes.
    held = {task for _t, task, note, why in keyed if why is None and note is None}
    lines, skipped, kept = [], [], 0
    for t, task, note, why in keyed:
        if why is None and note is not None:
            if task in held:
                why = "its key %r is another graded task's" % task
            else:
                held.add(task)
        if why is not None:  # a name with no key of its own: skipped and named, never a refusal
            skipped.append(t["slug"])
            sys.stderr.write("estate-dispatch: skipped %s: %s\n" % (t["slug"], why))
            continue
        kept += 1
        fields = grade_fields(RRec, t, rows.get(t["slug"].lower()), pass_id, digest)
        if note is not None:
            fields["note"] = note
        try:
            RRec.check(None, "grade", task, fields, ts=ts)
        except RRec.Refused as e:
            fail(2, "the run record refused the grade line for %s: %s; nothing written" % (t["slug"], e))
        if task not in have:
            lines.append((task, fields))
    if have and not lines:
        outcome = "exists %s (%d grade(s))" % (pass_id, kept)
    elif have:
        outcome = "completed %s: %d more" % (pass_id, len(lines))
    else:
        outcome = "logged %d grade(s), pass %s" % (len(lines), pass_id)
    if skipped:
        outcome += "; %d skipped (no key): %s" % (len(skipped), ", ".join(skipped))
    if args.dry_run:
        for task, fields in lines:
            print("would log grade %s: %s" % (task, json.dumps(fields, ensure_ascii=False, sort_keys=True)))
        print("dry run, nothing written: " + outcome)
        return
    for n, (task, fields) in enumerate(lines):
        if not RRec.emit(None, "grade", task, fields, ts=ts):
            fail(1, "wrote %d of %d grade line(s) of pass %s (run_record's warning above): a rerun completes it"
                 % (n, len(lines), pass_id))
    print(outcome)


# ---- preflight ---------------------------------------------------------------------------------------------------

def decision_of(d):
    """A rank decision as the index carries it: question, options (the recommendation first), recommendation, and its
    why and fork when it has them."""
    out = {"question": d.get("question"), "options": list(d.get("options") or []), "recommendation": d.get("recommendation")}
    for k in ("why", "fork"):
        if d.get(k):
            out[k] = d[k]
    return out


class Preflight:
    """schedule § 1.5's split of its candidates (the module docstring's preflight paragraph). Reads the rank and the
    scan only; ER is loaded for slug_key alone."""

    def __init__(self, ER, rank, scan, tasks, kept, decided, deps):
        self.ER, self.rank, self.scan = ER, rank, scan
        key = ER.slug_key
        self.rows = {}  # the rank's graded tasks by key, in rank order
        for t in rank["tasks"]:
            if isinstance(t, dict) and isinstance(t.get("slug"), str):
                self.rows.setdefault(key(t["slug"]), t)
        self.scanned = {}
        for t in scan["tasks"]:
            if isinstance(t, dict) and isinstance(t.get("slug"), str):
                self.scanned.setdefault(key(t["slug"]), t)
        self.listed = {}  # the rank's other lists: the why of a task it could not grade
        for t in rank.get("invalid") or []:
            if isinstance(t, dict) and isinstance(t.get("slug"), str):
                errs = [e for e in t.get("errors") or [] if isinstance(e, str)]
                self.listed.setdefault(key(t["slug"]), "invalid: " + ("; ".join(errs) or "no reason given"))
        for t in rank.get("ungraded") or []:
            if isinstance(t, dict) and isinstance(t.get("slug"), str):
                self.listed.setdefault(key(t["slug"]), t.get("why") or "no grade")
        for t in rank.get("skipped") or []:
            if isinstance(t, dict) and isinstance(t.get("slug"), str):
                self.listed.setdefault(key(t["slug"]), t.get("why") or "skipped")
        self.order, self.shown = [], {}  # the candidates' keys in first-seen order, and each one's slug as shown
        for raw in tasks:
            k = key(raw)
            if k and k not in self.shown:
                self.order.append(k)
                row = self.scanned.get(k) or self.rows.get(k)
                self.shown[k] = row["slug"] if row else raw
        if not self.order:
            fail(2, "--tasks names no task")

        def inside(flag, raw):
            k = key(raw)
            if k not in self.shown:
                fail(2, "%s %s is not one of --tasks" % (flag, raw))
            return k
        self.kept = {inside("--kept", s) for s in kept}
        self.decided = {inside("--decided", s) for s in decided}
        self.edges = {k: [] for k in self.order}
        for k in self.order:
            for link in (self.scanned.get(k) or {}).get("dependsOn") or []:
                d = key(link)
                if d in self.shown and d != k and d not in self.edges[k]:
                    self.edges[k].append(d)
        for raw in deps:
            a, sep, b = raw.partition("=")
            if not sep or not a.strip() or not b.strip():
                fail(2, "--dep %s: give it as <dependant>=<dependency>" % raw)
            ka, kb = key(a), key(b)
            if ka not in self.shown or kb not in self.shown:
                fail(2, "--dep %s: both tasks must be among --tasks" % raw)
            if ka != kb and kb not in self.edges[ka]:
                self.edges[ka].append(kb)

    def note_of(self, k):
        row = self.scanned.get(k) or self.rows.get(k) or {}
        return row.get("note") if isinstance(row.get("note"), str) else None

    def reason(self, k):
        """Why a candidate could not be graded: the rank's why, else `no grade` or `not in the scan`. A task whose own
        status is outside Active (its scan statusClass `hold`) is skipped by the ranker as `hold`, or as `in flight`
        when its `rollout:` is live: a carried task at an empty status, which carry queues but ES.still_to_start does
        not, as it reads `open` alone. Either way the real cause is its status, so it is named STATUS_OUTSIDE."""
        row = self.scanned.get(k)
        why = self.listed.get(k) or ("no grade" if row else "not in the scan")
        if why in ("in flight", "hold") and row and row.get("statusClass") == "hold":
            return STATUS_OUTSIDE
        return why

    def closure(self, seed):
        """seed and, to a fixpoint, every candidate not kept with a dependency in it (a kept task never leaves)."""
        out = set(seed)
        while True:
            more = {k for k in self.order if k not in out and k not in self.kept and any(d in out for d in self.edges[k])}
            if not more:
                return out
            out |= more

    def via(self, k, out):
        """The first of k's dependencies in out, as shown."""
        return self.shown[next(d for d in self.edges[k] if d in out)]

    def run(self):
        entry = {}
        for k in self.order:
            row = self.rows.get(k)
            grade = row.get("grade") if row else None
            e = {"slug": self.shown[k], "grade": grade, "decided": k in self.decided}
            if k in self.kept:
                e.update({"in": True, "why": "kept"})
            elif grade == "Ready":
                e.update({"in": True, "why": "ready"})
            elif grade in ("One call", "Grill"):
                e.update({"in": k in self.decided, "why": "decided" if k in self.decided else "undecided"})
            elif grade == "Orient":
                e.update({"in": False, "why": "orient", "home": row.get("home")})
            else:
                reason = self.reason(k)
                e.update({"in": k in self.decided, "why": "queued as it stands" if k in self.decided else "ungraded",
                          "reason": reason})
            entry[k] = e
        # The Dependent closure, in two steps. First what leaves whatever Lachy answers: the Orient candidates and
        # every task that depends on one, directly or through another, whatever its grade or answer. Those are out as
        # `dependency` before the round is built, so none of them is asked.
        fixed = self.closure(k for k in self.order if entry[k]["why"] == "orient")
        for k in self.order:
            if k in fixed and entry[k]["why"] != "orient":
                entry[k].update({"in": False, "why": "dependency", "via": self.via(k, fixed)})
        # Then the rest: a task that is in leaves when a dependency is out (one undecided or ungraded included).
        out = self.closure(k for k in self.order if not entry[k]["in"])
        for k in self.order:
            if k in out and entry[k]["in"]:
                entry[k].update({"in": False, "why": "dependency", "via": self.via(k, out)})
        warnings = []
        for k in self.order:
            if k in self.kept:
                gone = [self.shown[d] for d in self.edges[k] if d in out]
                if gone:
                    warnings.append("[[%s]] keeps its place (a carried task that has started) but depends on %s, which "
                                    "this rollout leaves out" % (self.shown[k], ", ".join("[[%s]]" % g for g in gone)))
        questions, index = [], []
        asked = [k for k in self.order if not entry[k]["in"] and entry[k]["why"] == "undecided"]
        pos = {k: i for i, k in enumerate(self.rows)}
        ranked = sorted(asked, key=lambda k: pos[k])
        for k in (x for x in ranked if entry[x]["grade"] == "One call"):
            self.one_call(k, questions, index)
        for k in (x for x in ranked if entry[x]["grade"] == "Grill"):
            self.grill(k, questions, index)
        for k in self.order:
            if not entry[k]["in"] and entry[k]["why"] == "ungraded":
                self.ungraded(k, entry[k]["reason"], questions, index)
        tasks, queue, left = [], [], []
        for k in self.order:
            e = entry[k]
            tasks.append({x: e[x] for x in ("slug", "grade", "decided", "in", "why", "via", "reason") if x in e})
            if e["in"]:
                queue.append(e["slug"])
                continue
            o = {x: e[x] for x in ("slug", "grade", "why", "via", "reason", "home") if x in e}
            if self.note_of(k):
                o["note"] = self.note_of(k)
            left.append(o)
        graded = [k for k in self.order if k not in self.kept and entry[k]["grade"]]
        n = lambda g: sum(1 for k in graded if entry[k]["grade"] == g)  # noqa: E731
        counts = {"candidates": len(self.order), "graded": len(graded), "ready": n("Ready"), "oneCall": n("One call"),
                  "grill": n("Grill"), "orient": n("Orient"),
                  "ungraded": sum(1 for k in self.order if k not in self.kept and not entry[k]["grade"]),
                  "kept": len(self.kept), "decided": sum(1 for k in self.order if entry[k]["decided"]),
                  "in": len(queue), "out": len(left)}
        return {"schema": SCHEMA, "today": self.rank.get("today") or today_of(self.scan), "counts": counts,
                "tasks": tasks, "queue": queue, "out": left, "asks": [[q] for q in questions], "index": index,
                "warnings": warnings}

    def ask(self, k, kind, text, fulls, descs, decision, questions, index, extra=None):
        opts, labels = Rounds.options(fulls, descs, True)
        questions.append({"question": text, "header": HEADERS[kind], "multiSelect": False, "options": opts})
        e = {"question": text, "kind": kind, "slug": self.shown[k], "note": self.note_of(k), "decision": decision,
             "labels": labels, "texts": list(fulls), "recommended": fulls[0] if fulls else None}
        e.update(extra or {})
        if decision.get("fork"):
            e["fork"] = decision["fork"]
        index.append(e)

    def one_call(self, k, questions, index):
        raw = (self.rows[k].get("decisions") or [{}])[0]
        d = decision_of(raw)
        suffix, descs = framing(raw)
        self.ask(k, "one-call", "[[%s]] %s%s" % (self.shown[k], d["question"] or "", suffix), d["options"], descs, d,
                 questions, index)

    def grill(self, k, questions, index):
        raws = [d for d in self.rows[k].get("decisions") or [] if isinstance(d, dict)]
        for i, raw in enumerate(raws, 1):
            d = decision_of(raw)
            suffix, descs = framing(raw)
            self.ask(k, "grill", "[[%s]] (%d/%d) %s%s" % (self.shown[k], i, len(raws), d["question"] or "", suffix),
                     d["options"], descs, d, questions, index, {"k": i, "n": len(raws)})

    def ungraded(self, k, why, questions, index):
        q = UNGRADED_QUESTION.format(why=why)
        d = {"question": q, "options": list(UNGRADED_OPTIONS), "recommendation": UNGRADED_OPTIONS[0], "why": UNGRADED_WHY}
        self.ask(k, "ungraded", "[[%s]] %s %s" % (self.shown[k], q, NOTE_INVITE), UNGRADED_OPTIONS, UNGRADED_DESCRIPTIONS,
                 d, questions, index)


def cmd_preflight(args):
    rank, scan = read_rank(args.rank), read_scan(args.scan)
    ER = load("thread_estate_rank", ESTATE_RANK_PY)
    emit(Preflight(ER, rank, scan, split_slugs(args.tasks), split_slugs(args.kept), split_slugs(args.decided),
                   [d for d in args.dep or []]).run())


# ---- main --------------------------------------------------------------------------------------------------------

def parse(argv):
    p = Parser(prog="estate-dispatch", allow_abbrev=False,
               description="The estate pass's decision round and dispatch plan (skills/orient-all/SKILL.md).")
    sub = p.add_subparsers(dest="verb", parser_class=Parser)
    s = sub.add_parser("slices", allow_abbrev=False)
    s.add_argument("--scan", required=True)
    s.add_argument("--dir", required=True)
    s.add_argument("--tasks", action="append", default=[])
    s.add_argument("--superseding")
    r = sub.add_parser("rounds", allow_abbrev=False)
    r.add_argument("--rank", required=True)
    r.add_argument("--scan", required=True)
    r.add_argument("--budget", required=True)
    r.add_argument("--top", default=str(TOP_DEFAULT))
    r.add_argument("--vault")
    pl = sub.add_parser("plan", allow_abbrev=False)
    pl.add_argument("--rank", required=True)
    pl.add_argument("--scan", required=True)
    pl.add_argument("--decided", action="append", default=[])
    pl.add_argument("--unparked", action="append", default=[])
    pl.add_argument("--signed", action="append", default=[])
    pl.add_argument("--rounds")
    pl.add_argument("--assume-answered", action="store_true")
    pl.add_argument("--vault")
    se = sub.add_parser("sessions", allow_abbrev=False)
    se.add_argument("--plan", required=True)
    se.add_argument("--wrote", action="append", default=[])
    se.add_argument("--status", action="append", default=[])
    se.add_argument("--vault")
    rc = sub.add_parser("record", allow_abbrev=False)
    rc.add_argument("--task", required=True)
    rc.add_argument("--question", required=True)
    rc.add_argument("--answer", required=True)
    rc.add_argument("--recommended")
    rc.add_argument("--fork")
    rc.add_argument("--owner", choices=DECIDED_OWNERS)
    rc.add_argument("--why")
    rc.add_argument("--today")
    rc.add_argument("--vault", default=VAULT_DEFAULT)
    rc.add_argument("--by", choices=DECIDED_BY, default=RECORD_BY[0])
    rc.add_argument("--superseding")
    dy = sub.add_parser("decided-for-you", allow_abbrev=False)
    dy.add_argument("--rank", required=True)
    dy.add_argument("--tasks", action="append", required=True)
    dy.add_argument("--by", choices=RECORD_BY, default=RECORD_BY[0])
    dy.add_argument("--superseding")
    dy.add_argument("--write", action="store_true")
    dy.add_argument("--today")
    dy.add_argument("--vault", default=VAULT_DEFAULT)
    lg = sub.add_parser("log", allow_abbrev=False)
    lg.add_argument("--rank", required=True)
    lg.add_argument("--scan", required=True)
    lg.add_argument("--dry-run", action="store_true")
    pf = sub.add_parser("preflight", allow_abbrev=False)
    pf.add_argument("--rank", required=True)
    pf.add_argument("--scan", required=True)
    pf.add_argument("--tasks", action="append", required=True)
    pf.add_argument("--kept", action="append", default=[])
    pf.add_argument("--decided", action="append", default=[])
    pf.add_argument("--dep", action="append", default=[])
    args = p.parse_args(argv)
    if not args.verb:
        fail(2, "a verb is required: slices | rounds | plan | sessions | record | decided-for-you | log | preflight")
    if args.verb == "rounds":
        for flag in ("budget", "top"):
            v = getattr(args, flag)
            if not re.fullmatch(r"\d+", v.strip()):
                fail(2, "--%s must be a whole number of %s, 0 or more: %r"
                     % (flag, "minutes" if flag == "budget" else "rows", v))
            setattr(args, flag, int(v.strip()))
    if args.verb == "record":
        args.today = parse_date(args.today, "--today") if args.today else datetime.date.today()
    if args.verb == "decided-for-you" and args.today is not None:
        args.today = parse_date(args.today, "--today")
    return args


VERBS = {"slices": cmd_slices, "rounds": cmd_rounds, "plan": cmd_plan, "sessions": cmd_sessions, "record": cmd_record,
         "decided-for-you": cmd_decided, "log": cmd_log, "preflight": cmd_preflight}


def main(argv):
    args = parse(argv)
    VERBS[args.verb](args)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
