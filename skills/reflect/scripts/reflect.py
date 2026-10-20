#!/usr/bin/env python3
"""reflect.py — the weekly reading's script half (p21-7, ADR 0037 d3-d5). This docstring is the one copy of its rules.

python >= 3.9, stdlib only (zoneinfo). skills/reflect/SKILL.md § The weekly reading (steps 9-17) and § Deciding the
decision task call it; the model does the reading between `span` and the writers. Chorus's
scripts/companion/reflect.py (span / watch / raised / close) gives the shape: borrowed, never imported.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py span [--since TS] [--until TS] [--fold] \\
        [--tasks-dir D] [--config P] --out F
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py watch --span F --rollout S [--rollout S2 ...] \\
        --rule R --shape H --count N [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py raised --watch ID --reflection ID \\
        [--confirmed | --declined] [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py bug --span F --rule R --shape H --slug <words> \\
        --title T --why W --rollout S [--rollout S2 ...] [--fixes <landed task>] [--tasks-dir D] [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py knobs --span F [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py decide --span F [--decisions F] [--tasks-dir D] \\
        [--now ISO] [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py close --span F [--tasks-dir D] [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py moot --task <slug> --trade <knob id> --from N \\
        --why W [--tasks-dir D] [--now ISO] [--dry-run]
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts/reflect.py rung

Writes. reflect.py is the only writer of reflections.jsonl (run_record.py's REFLECTIONS file, through run_record.emit:
the kinds watch, watch-raised, proposal and reflection; run_record's docstring holds their schema, the Watch rule, the
Agreement rule and the cadence rule) and of two kinds of vault task: a bug task (Work/Tasks/thread-skill-bug-<words>.md)
and the decision task (Work/Tasks/thread-skill-decisions-<date>[-N].md), to which `moot` adds a line at decide time. It
never writes rollouts.toml or tunings.jsonl (tune.py is their one writer: step 14 runs `tune.py --revert` and `--auto`),
never commits, and never touches git. `span --fold` runs reconcile-rollout.py fold-journals, whose call-journal lines
are span's only write outside --out's directory. Every writer takes --dry-run: it prints the lines and the file text it
would write, and writes nothing (Note.save(dry_run=True)).

Vault writes. A new note is created only by open(path, "x"), never over a file. A slug is taken when <slug>.md is
directly under Work/Tasks or anywhere under Work/Tasks/Archive (recursive), since Obsidian resolves a wikilink by
file name. An existing note is edited only through reconcile-rollout.py's Note (set, append_section, append_line,
then save), and a done task (vault grammar § Statuses: Landed) is never opened for writing.

Melbourne dates. Every calendar date is read on Australia/Melbourne: a note's `captured:`, a `repair:` line's date,
the decision task's slug date and its `## Still open` date. A date-only piece of evidence (a `repair:` line, a fixer's
`captured:` or its mtime's date) counts when it is on or after the Melbourne date of since and before that of until
(date_in()), and span reads it from every record, read this week or not: the Escapes sweep and the repair lines of
every record's rollout note (below). The next Reflection's since is this one's until, so the windows' dates tile: each
date is read once, by the Reflection whose window holds it, whichever rollouts have a line in that window (until's
date by the next Reflection, once the day is whole). An instant counts in [since, until]. No tz data is exit 3
(`python3 -m pip install tzdata`).

span. The window: --until defaults to now, and a future --until is clamped to now and flagged; --since defaults to
the last `reflection` line's until, else until - 7 days; since after until is exit 2. span mints the Reflection's id,
r-<UTC YYYYMMDDTHHMMSSZ>-<6 hex>. It reads every non-reserved <slug>.jsonl in the events directory with a line in
[since, until], and every `shape: serial` note directly under Work/Tasks or under Archive/Rollouts whose `## Leg log`
has a line stamped in [since, until] (a chain records only Lachy's acts, so a hands-off one has no record line): the
read rollouts. Each entry's shape is its note's (close-score.py's read: reconcile-rollout.py's Note and _shape;
parallel with no note). For each:
- closeLine: {id, close} from tune.py's close_line(), or null (a voided close line reads as none). A rollout whose
  note resolves under Work/Tasks/Archive/Rollouts/, or whose `status:` is done or dropped, with a null closeLine is
  flagged `closed with no close line: no baseline` and named in cannotShow; a running rollout's null is not. span
  writes no tunings.jsonl line: such a rollout is read in the week it ran and leaves no baseline.
- note (Work/Tasks/<slug>.md, then Work/Tasks/Archive/Rollouts/<slug>.md) and, for a parallel one (a serial chain:
  below), its ``Project root:`` line, the repo
  (rollout-settings.py's _origin_slug, cached per root), the settings (rollout-settings.py's resolve(repo=root,
  path=--config), redacted as the CLI prints it and written to <dir of F>/<slug>.settings.json), --fold's
  fold-journals, and score.py (--rollout --note --settings --repo-slug --repo --tasks-dir --until --out
  <dir of F>/<slug>.score.json). A missing note, a refused settings file or no origin: scored by slug, flagged, and
  never a knob candidate. No single rollout stops the span.
- A serial chain (ADR 0040) takes the serial path instead of the note's Project root, the repo, the settings, --fold
  and score.py, as close-score.py's serial path does: `serial-score.py --rollout <note> --tasks-dir <tasks> --until
  <until> --out <dir of F>/<slug>.score.json` (its header the one copy of the serial score's rules), flagged SERIAL_FLAG.
  root, repo and binding are null, proposals [] and chain is leg.py's chain state (the score's, else, with no
  readable score, the `leg.py status` read below; null only when neither reads): a chain is never a knob candidate
  (knobs() skips it whatever it holds), since its score proposes nothing and its line is never a baseline. A non-zero
  exit (2 for an --until before Leg 1 began, say) is flagged and the friction is still read. Its friction is the
  record's (below: its asks, and the note's repair lines) plus the chain's own, from one `leg.py status`
  (serial-score.py's leg_status(); an unreadable status is flagged and adds none), each in the window:
  set-aside a Leg log `set aside` line: leg, status (leg.py's), stage (gate for gate-pending, plan, review, else
            block), reasonClass null, setAsideAt `leg`, taskNote, and movedBy: the first record act on the task after
            it (answer-recorded, gate-signed, `gate-signed (standing)` for a standing one, handed-back with its via, or
            race-decided) before the end of the minute of the Leg log's next claimed, took or done of it (a Leg-log
            stamp floors to its minute, so an act in that minute came first: serial-score.py's done + 60 s rule);
            else `unrecorded`, with mover {kind (claimed | took | done), at, leg} of that pick-up; null while nothing
            picked it up by until.
            explainedIn and cannotShow as a parallel unrecorded set-aside's.
  ask       a `halt cleared:` line, act haltCleared (serial-score.py's act: a halt is Lachy's to clear), its task the
            first one a later Leg took from the halted Leg (null when none), detail `Leg <K>'s halt cleared: <reason>`,
            and halted: the reason the halted Leg's `closed: halted: <reason>` line gives (null when none).
  restart   one per restart, never one per `restart:` line (serial-score.py's fold_restarts(), its header's Restarts
            rule the one copy): repair § 7 (e) writes step 2's `pending` line and then step 3's `started` or step
            4's `manual` line for one restart, read as one item; a `--replace` re-mark is a second restart. leg (the
            Leg it starts), how (pending | started | manual: its latest line's, at or before until), started, manual,
            session (the marking repair's), began (that Leg's `began` stamp on its last restart, else null), and at:
            its first line's stamp, which decides the window. how `pending` means step 2 ran with no step 3 or 4
            line after it: with began null, trace why the start never happened, not why the last Leg did not hand
            over; with began set the Leg did start, by a route that wrote no line.
  escape    each piece of serial-score.py's escapes block (`fixes:` only: a fix task that names a chain task, its
            Leg-filed smoke fixes among them), dated as the sweep dates a fixer, with at and inWindow. The sweep below
            never reaches a chain (its record has no `merged` lines), so a chain's Escapes are read only in a week
            span reads it.
  A chain has no retry, descope or churn of its own, and no breach (its score has no Guardrails).
- breachCounts: true only for a read, non-partial rollout whose window.activeEnd falls in [since, until], so a
  Guardrail breach counts in the week its run ends. A partial rollout's breaches are reported, not counted.
- friction, each item {kind, rollout, task, at, ...}:
  ask       each human act in the window, read straight from the record for every task, landed or not (score.py's
            handsOff lists the landed tasks' acts only, so an act on a task still waiting at until, or on one that
            lands after it, would be lost): answer-recorded (answer), gate-signed standing false (signOff),
            handed-back via retry (retry) and race-decided (raceDecided), each with score.py's human_act() detail;
            and each merge hold (mergeHold) and git-env hold (gitEnvHold, task null), at the hold-started that opens
            it (holds paired as score.py pairs them). Each carries askedAhead (the task note holds a `## Decisions
            (asked ahead` section or an `asked ahead at schedule` gate), needsYou (its `## Needs you`, at most 600
            characters) and grade: the Grade log's line in force for the task at the act (grades.py's Log.at:
            {grade, agentGrade, raised, gates, pass}), null with no task or no grade line before it.
  set-aside a set-aside line in the window: stage, reasonClass, setAsideAt, taskNote (Work/Tasks, then Archive, or
            null) and movedBy, the first later event of auto-retry, handed-back (with its via), answer-recorded,
            gate-signed, race-decided, carried, slot-taken, lane-taken or merged; `unrecorded` when a slot-taken,
            lane-taken or merged comes first with no act or retry before it (a Human fix, ADR 0035, a gate signed
            on the note with no gate-signed line, or a hand edit); null while the task is still set aside at until.
            mover and explainedIn are null unless movedBy is `unrecorded`. mover is {kind, at, start?} of the line
            that moved it on (start, run_record's enum, on a slot-taken only). explainedIn lists where its mover
            may be written, in order: `## Needs you` and `## Integration log` when the task note holds text there;
            for a set-aside whose stage is gate only (approve-gates signs a gate-pending task alone), its
            `## Approved gates` lines, each label at most once: `## Approved gates: standing approval` (a line
            ending gated_inputs.annotation()'s `(approved <date> under the standing approval: ...)`), `## Approved
            gates: sign-off` (approve-gates' bare `(approved <date>)`), then `## Approved gates` (any other line);
            and `rollout ## Notes` when a line of the rollout note's `## Notes` holds a wikilink to the task (read
            as the repair lines' links are, so an alias, heading or path matches; the note is read once per
            rollout, only when an unrecorded item exists). A null or unreadable note adds nothing. cannotShow
            names each such task.
  retry     an auto-retry line in the window.
  descope   a handed-back line with via descope in the window.
  repair    each line of the rollout note's `## Notes` matching `- <YYYY-MM-DD> repair: ...` whose date is in the
            window (date_in()): {date, tasks (every wikilink), text (at most 300), shape}. shape is the first match of
            RACE decided (race-decided), `possible PR-less merge` (escalated), `merged, never marked` (flipped),
            `git-env trip` (git-env), `raised to` (raise), `deferred:` (deferred), else other. An undated
            `- repair:` line is flagged (on a read rollout only). auto-retry and descope lines are other items, and
            nothing outside `## Notes` is read. A line is date-only, so it is read by its date from the note of every
            record, read this week or not: a rollout with no line in the window that holds one is read light (below).
  escape    the sweep's evidence (below) against this rollout's landed tasks, with at and inWindow.
  churn     a review-verdict line in the window with regression > 0.
- The Escapes sweep (ADR 0037 d4). Every record's `merged` lines, of any age, are folded per rollout by score.py's
  landed_from(), and each rollout maps to its repo through its note's Project root (the newest existing root per repo
  is used; a repo with several is flagged). A task landed in two records is credited to the later, flagged. Per repo,
  one escapes.py score() over the union reads the evidence (fixes:, reverts, review findings). Each piece gets an at:
  a fixer note's captured: (else its mtime, flagged "undated fixer"), a revert's committer date, a review doc's
  newest add or modify commit (else its mtime). A record with no resolvable note or root, and a repo with no origin,
  are named in cannotShow.
- The light reads. A record not read this week is read for its in-window evidence alone, never scored, never a breach
  or a knob: escapes-only when the sweep traced an in-window Escape to it, else repairs-only when its rollout note
  holds an in-window repair line; either carries both kinds it holds. A repair line on a rollout with no Run record is
  not read, and cannotShow says so.
- grades: the Grade log joined to outcomes (p25-4, ADR 0041; skills/reflect/scripts/grades.py, loaded by path, whose
  docstring holds every rule: each grade line's episode, which runs to the task's next grade line or its close; whether
  it was dispatched; its acts; its outcome; each grade's hands-off rate over [since, until] (`window`) and over every
  closed episode (`all`); and Slot hours per size). It reads grades.jsonl once (its flags prefixed `grades: `, its gaps
  in cannotShow), every record span lists and each graded task's note, and never stops the span: no grades.jsonl is an
  empty block and the flag `grades: no grade log`.
- knobs: revert[] (each non-voided, un-reverted auto tunings line that is no revert, paired with a read non-partial
  rollout of its repo that passes tune.py's revert_check), land[] (the proposals of a repo's newest non-partial read
  rollout that pass tune.py's auto_check, over the same reflections.jsonl read and the same agreement as tune.py, and
  whose key no revert[] item names) and held[] (the rest, each with its reason).
span.json: {reflection, since, until, previous, rollouts[{rollout, mode (read | escapes-only | repairs-only), shape
(parallel | serial), note, root, repo, status, closeLine, score, window, partial, headline{handsOffRate, quality,
reviewChurn, throughput}, breached, breachCounts, binding, proposals (each with its knob_key), flags, friction[], and
chain on a read serial one}], freshReview[] (/fresh-review
rounds in the window with regression > 0, reported only: reviews.jsonl names no rollout), watches[] (every open Watch:
rule, shape, rollouts, count, recurring, stale, new, declinedBefore, lastSeen), knobs{revert, land, held}, bugsOpen[],
decisionTask, grades (grades.py's block: log, window, all, pending, episodes), cannotShow[], flags[]}. stderr gets one
summary line.

watch. One `watch` line per (Reflection, Watch), naming every rollout where the reading saw it. id is run_record's
watch_id(rule, shape); the line stores the stripped rule and shape. A rollout must be one the span read (its
rollouts[]) or one an in-window grade episode lists (grades.episodes[].rollouts, grade_rollouts(): a grade miss's
rollout, read this week or not, as a serial chain dispatched by link or a regraded task's earlier run); any other is
exit 2. A grade trace whose episodes list no rollout is reported, never a Watch (SKILL.md § 11). A repeat call
for an id this Reflection already holds compares its rollouts with that Reflection's latest line for the id: the same
set prints `exists <id>` and writes nothing (whatever --count); a strict superset writes ONE extending line naming the
union and prints `extended <id>: +<new>`; any other set is exit 2, naming both sets and their union to re-run with.

The Watch reader (watches()), per id in file order: a `watch` line opens a cycle or extends the open one; any
`watch-raised` closes it, whatever its via; a later sighting opens a new cycle whose rollouts start empty. Within a
cycle each Reflection counts by its latest line for the id; the cycle's rollouts are the union and its count the
sum. Recurring: two or more distinct rollouts in the open cycle, and a line from this Reflection. Stale: no line for
STALE_DAYS (28) before until. New: no `watch` line for the id before this Reflection's first. declinedBefore: the
id's last closed cycle ended via declined. Torn lines are skipped.

raised. --watch <id> --reflection <id> writes `watch-raised` {id, reflection, via}: plain is via recurring (Lachy's
yes to a rule item), --confirmed via confirmed (his yes to a Watch to confirm), --declined via declined (his no). Any
of them closes the Watch's cycle, so a declined pattern returns only when two later rollouts show it afresh. Exit 2:
an id with no open Watch (unknown, or closed by another line: `Watch <id> was closed by Reflection <rid> (<via>)`), or
a plain raise of a one-rollout Watch. A repeat whose cycle that same reflection and via closed prints `exists <id>`.

bug. The key is watch_id(rule, shape); the rollouts must be ones the span read (a grade episode's alone is refused: a
grade miss is a Watch or a rule, never a bug); --slug is one to five kebab words, none
starting reflect or call. Dedupe first: an open task directly under Work/Tasks (status not Landed; a note with no
frontmatter is skipped and flagged) carrying `bug_key: <key>`. If its `## Notes` holds `Found by Reflection <this
id>` the line records filed: true (a re-run after a failed line write); otherwise it prints `exists <slug>` and the
line records filed: false. Only when dedupe finds nothing: a taken `thread-skill-bug-<words>` is exit 2, `path exists:
thread-skill-bug-<words> (<status>); choose other slug words`, nothing written (as descope refuses a taken
follow-up name); else it creates the task by exclusive create in task-writer § 4's shape (tags [task, ai], never
`decisions`, so it stays schedulable; status open; priority normal; projects Thread Skill and AI; contexts [];
captured; launch cc-thread; bug_key; fixes: when --fixes names landed work; no scheduled:) with `## Notes`, `## Launch`
and `## Resume prompt`. The file goes first, then one `proposal` line per (Reflection, key): altitude bug, vaultTask,
filed, and auto: true only when filed. A repeat call prints the first outcome.

knobs. Once, after step 14's tune.py calls (its lines are knob_lines(), which close re-reads): one `proposal` line per
(Reflection, knob_key) over the read rollouts' score.py proposals (none for withheld entries, a light read or a rollout
with no repo; a partial rollout's are held "partial window"). from, to and ranAt are the land candidate's, else
the newest proposer's; rollouts names every proposer. landed needs a non-voided tunings line with auto: true, this
reflection, the same repo (case ignored), its rollout among the line's rollouts, no reverts, and an applied entry with
the same key and rule and sign(to - from) == direction; then auto: true and tuning: <its id>. An unlanded line carries
held: span's reason, or "eligible: tune.py --auto was not run". Each revert this Reflection wrote gets its own landed
line, id knob_key(repo, key, "revert:<rule>", -direction), with reverts and tuning. Every line passes run_record.check()
before any is written (a refusal is exit 2, nothing written); then each (Reflection, id) not yet in reflections.jsonl is
written.

decide. Rule items are the recurring open Watches. --decisions is a JSON object {<watch id>: {why, amends}}, `{}` when
no Watch recurs; an entry naming a Watch that is not recurring, closed or unknown is exit 2; a recurring Watch it leaves
out is still an item (why "not given"). Watches to confirm: the open one-rollout Watches this Reflection sighted, except
one whose last cycle Lachy declined (it returns only as a rule item); they are listed only beside a rule item. Held
trades (ADR 0037 d1): each knob_lines() line, not landed and no revert, with an integer from, whose held is tune.py
auto_check's `a trade (...): Lachy decides` or `a caution: Lachy decides` (held_trades(); a non-integer from is
skipped on stderr). One on a repo and key a revert line of this Reflection moved prints `trade <kid> at <from>: a revert
of <key> comes first this Reflection` and is not listed (its from is stale). Each (knob id, from) is read against every
decision task's lines (trade_listings(): Work/Tasks and Archive, `- trade` items and `moot` lines under a
`## Reflection` section, `trade ... still open` lines under `## Still open`; an item is moot when its own section
holds a moot line for it): decided when a non-moot item is in a task whose status is DECIDED (done or merged; a dropped
task decides nothing), printing `trade <kid> at <from>: decided in [[<slug>]]` (the first slug, sorted), and never
listed again at that from; still when a non-moot item is in an open task directly under Work/Tasks, under a section
other than this Reflection's own; else new (never listed, listed only in a dropped or archived task, every item moot, or
listed only in this Reflection's own section, which is a re-run). No rule item and no new or still trade prints
`no rule proposal or held trade: no decision task` and writes nothing. Else the open `decisions`-tagged task
directly under Work/Tasks, or a new one at the first untaken of thread-skill-decisions-<Melbourne date of now>, -2 ...
-9 (past -9 is exit 2), created by exclusive create with scheduled: from resolve-day.py (no day: the next Melbourne
morning; --now, tests only, is passed through), `## Notes` (conversation-gated), `## Launch` and `## Resume prompt`
(no capture-done line: it is no capture). Then, through Note: when `## Reflection <id>` is absent and the task already
existed, scheduled: moves to resolve-day.py's day; the section is appended once (its heading marks the visit). Its rule
part, only with a rule item: the rule items no earlier section lists, the Watches to confirm, or "No new rule items;
still open: <ids> (see ## Still open)". Then, after a blank line when both are present, its trade part: TRADE_LEAD and
one `- trade <kid> at <from>: <key> <from> -> <to> (<rule>); <held>[; caution <caution>]; evidence <evidence>; repo
<repo>; rollouts ...; a yes runs /thread:reflect [[<newest>]] and picks <key> (<rule>)` line per new trade (evidence and
caution the newest proposer's, folded and cut to 200), or, with no new trade and a still one, "No new trades; still
open: trade <kid> at <from>[, ...] (see ## Still open)". Each rule item an earlier section lists gets one
`## Still open` line, `<id> still open <D>: Reflection <rid>, rollouts ...`, then each still trade `trade <kid>
at <from> still open <D>: Reflection <rid>, rollouts ...`, with `; listed in [[<slug>]]` when the open task listing it
is not the one written; D is the Melbourne date of until. A re-run finds the heading and moves nothing, so it is
byte-identical at any hour. The sections are H2: append_section appends at the end of the body, where an H3 would fall
inside `## Resume prompt`. One `proposal` line (altitude rule, vaultTask) per (Reflection, rule item); a trade writes
none (knobs' line, with its held reason, is its record, and Lachy's no is the done task's `- trade` line). It prints
the slug, the scheduled date (and the old one when moved) and new | appended.

close. Exactly one `reflection` line per Reflection (a second close is exit 2). The writers refuse a closed Reflection,
so a skipped step could never be made up: first close checks that knobs and decide ran, and is exit 2 naming the step,
nothing written, when a line knob_lines() gives (a span proposal with a knob_key, or a revert tune.py wrote for this
Reflection) is not in reflections.jsonl (`run knobs`), when a recurring Watch (the Watch reader's, which needs a line
from this Reflection) has no rule `proposal` line from it (`run decide`), or when a held trade (decide's, the revert's
skipped ones aside) meets none of (i) a non-moot item in a DECIDED task, (ii) an item under `## Reflection <this id>`
in a task that is not dropped, (iii) a `still open` line naming this Reflection in a task that is not dropped (`held
trade <kid> at <from> has no decision task line from this Reflection: run decide`). Only with a held trade does close
read the vault: --tasks-dir (default the vault's Work/Tasks), exit 1 when it is no directory. A `knobs` refusal (a
run_record.check() of any of its lines) therefore blocks close too: it is a fault to fix, never a step to skip. The
line: since, until, rollouts (read), escapesOnly, counts (sightings: Watch ids with a line from this Reflection;
newWatches: those that are new; rules, bugs, filed, knobs, landed and reverted from its proposal lines; breaches:
distinct (rollout, Guardrail) pairs over breachCounts rollouts), quiet (newWatches, rules, bugs and breaches all 0),
repairsOnly when a rollout was read repairs-only, decisionTask when a rule line names one (else the first task, sorted,
whose line passed (ii) or (iii)), and cadence: run_record's cadence() over reflections.jsonl with this line appended
(three quiet Reflections in a row: 14; any that is not quiet: 7), on every line, so each change of cadence is on a
record line, and the outcome line ends `cadence <old> -> <new>` when it changes. The writers watch, bug, knobs and
decide refuse a closed Reflection. reflect-due.py beside it reads the same rule to say when the next reading is due (ADR
0037 d4 and d6).

moot. Lachy's yes to a held trade that cannot apply (the fresh score no longer proposes its key and rule, or tune.py
refuses a stale from) is answered here, at decide time, so it never refuses a closed Reflection and writes no
reflections.jsonl line. The note is <tasks>/<slug>.md directly under Work/Tasks; exit 2, nothing written, when --why is
empty, the note is absent, it has no frontmatter or no `decisions` tag, its status is Landed
(`<slug> is <status>: a done task is never written`), or no `## Reflection <id>` section lists
`- trade <kid> at <from>: ` (`[[<slug>]] lists no trade <kid> at <from>`). It writes
`moot <kid> at <from> <D>: <why>` (D the Melbourne date of --now, else now; why folded and cut to 200) through
Note.append_line into the last section that lists the item with no moot line for it, and prints `moot trade <kid> at
<from> in [[<slug>]] (## Reflection <id>)`; when every such section has one it prints `exists moot <kid> at
<from> in [[<slug>]]`. A moot item is no decision: the next reading that holds the trade offers it again.

rung. The ladder (ladder.py's load()): it prints {rung, model "opus", effort, judge, review, top, topModel}, the own
values of the highest opus rung, with a stderr note when the top rung is not opus (`rung: the ladder's top rung
<name> is <model>; ADR 0037 d4 names Opus`) and when that rung's effort is not xhigh (`rung: <name>'s effort is
<effort>; ADR 0037 d4 names xhigh`). No opus rung is exit 2; a refused ladder exits with ladder.py's code and line.

Exit codes: 0 done (exists and no-op answers included); 1 a file cannot be read or written (the events directory,
tunings.jsonl, reflections.jsonl, --out, a note, a --tasks-dir that is no directory); 2 usage or a refusal (a path that
exists, a watch call that leaves out a recorded rollout, a raise on a closed or unknown Watch, a closed Reflection, a
close before knobs or decide ran, a run_record refusal, a moot on a done, absent or untagged task, of an unlisted
trade or with no --why); 3 no tz data, or no tomllib for `rung` over a present ladder file.
"""
from __future__ import annotations

import argparse
import datetime
import glob
import importlib.util
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
SKILLS = os.path.dirname(os.path.dirname(HERE))
SHARED = os.path.join(SKILLS, "_shared", "scripts")
RECONCILE_PY = os.path.join(SKILLS, "execute", "scripts", "reconcile-rollout.py")
SCORE_PY = os.path.join(HERE, "score.py")
SERIAL_PY = os.path.join(HERE, "serial-score.py")
RESOLVE_DAY_PY = os.path.join(SHARED, "resolve-day.py")

ZONE = "Australia/Melbourne"
STALE_DAYS = 28
DAY_MS = 24 * 3600 * 1000
MINUTE_MS = 60 * 1000  # a Leg-log stamp's precision: it floors to its minute
NEEDS_YOU_MAX = 600
REPAIR_TEXT_MAX = 300
SCORE_TIMEOUT = 420
FOLD_TIMEOUT = 120
GIT_TIMEOUT = 60
DECISION_SUFFIX_MAX = 9
PROJECTS = '["[[Thread Skill]]", "[[AI]]"]'
REPAIR_RE = re.compile(r"^- (\d{4}-\d\d-\d\d) repair:\s*(.+)$", re.I)
UNDATED_REPAIR_RE = re.compile(r"^-\s+(?:(\S+)\s+)?repair:", re.I)
SLUG_WORDS_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+){0,4}\Z")
ASKED_AHEAD_RE = re.compile(r"^## Decisions \(asked ahead|asked ahead at schedule", re.M)
# A serial note's Leg log (leg.py's LEG_LOG) and the stamp of each of its line forms (leg.py's LOG_RE, CLEARED_RE and
# RESTART_RE): span reads a chain whose log has a line in the window, Run record or not
LEG_LOG = "## Leg log"
LEG_STAMP_RE = re.compile(r"^- (\S+) (?:Leg \d+ |halt cleared: |restart: Leg \d+ )")
SERIAL_FLAG = "a serial chain (ADR 0040): scored by serial-score.py (no fold, settings or score.py), never a knob candidate"
# A chain's set-aside (leg.py's statuses) read as the parallel stage it matches, so explained_in() reads a gate's gates
SERIAL_STAGES = {"gate-pending": "gate", "plan-blocked": "plan", "review-blocked": "review", "blocked": "block"}
# The record lines that move a chain's set-aside on (the human acts a serial chain's verbs write)
SERIAL_MOVERS = ("answer-recorded", "gate-signed", "handed-back", "race-decided")
MOVERS = ("auto-retry", "handed-back", "answer-recorded", "gate-signed", "race-decided", "carried", "slot-taken",
          "lane-taken", "merged")
UNRECORDED_MOVERS = ("slot-taken", "lane-taken", "merged")
SLOT_STARTS = ("start", "restart", "revise", "hand-back", "resume")  # run_record's slot-taken `start`
# An `## Approved gates` line's suffix: gated_inputs.annotation()'s (the Standing approval) and approve-gates' bare
# `(approved <date>)` (Lachy's sign-off, reconcile-rollout.py)
STANDING_GATE_RE = re.compile(r"\(approved \d{4}-\d\d-\d\d under the standing approval\b[^)]*\)\s*$")
SIGNED_GATE_RE = re.compile(r"\(approved \d{4}-\d\d-\d\d\)\s*$")
# A held trade (ADR 0037 d1): tune.py auto_check's two Lachy-decides reasons, and the decision task's lines for it
TRADE_HELD_RE = re.compile(r"^a (?:trade \(.*\)|caution): Lachy decides$")
DECISION_SLUG_RE = re.compile(r"^thread-skill-decisions-\d{4}-\d\d-\d\d(?:-\d+)?$")
TRADE_LINE_RE = re.compile(r"^- trade ([0-9a-f]{8}) at (-?\d+): ")
TRADE_STILL_RE = re.compile(r"^trade ([0-9a-f]{8}) at (-?\d+) still open \S+: Reflection (r-[^,]+),")
TRADE_MOOT_RE = re.compile(r"^moot ([0-9a-f]{8}) at (-?\d+) \S+: ")
TRADE_TEXT_MAX = 200
TRADE_LEAD = ("Trades for Lachy (ADR 0037 d1: a knob that trades one headline against the other, or a caution, is his "
              "call; a yes runs the by-hand Reflection, a no is recorded when this task is done):")


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RR = _load("thread_run_record", os.path.join(SHARED, "run_record.py"))
RS = _load("thread_rollout_settings", os.path.join(SHARED, "rollout-settings.py"))
SCORE = _load("thread_score", SCORE_PY)
SERIAL = _load("thread_serial_score", SERIAL_PY)  # leg_status() and Unreadable: the chain friction's one leg.py read
TUNE = _load("thread_tune", os.path.join(HERE, "tune.py"))
ESC = _load("thread_escapes", os.path.join(HERE, "escapes.py"))
GR = _load("thread_grades", os.path.join(HERE, "grades.py"))
REC = _load("thread_reconcile_rollout", RECONCILE_PY)
RP = _load("thread_reconcile_project", os.path.join(SHARED, "reconcile-project.py"))
LADDER = _load("thread_ladder", os.path.join(SHARED, "ladder.py"))
Note, NOTES_SECTION, RACE_DECIDED_RE = REC.Note, REC.NOTES_SECTION, REC.RACE_DECIDED_RE
WIKILINK_OPEN_RE, _wikilink_slug = REC.WIKILINK_OPEN_RE, REC._wikilink_slug
LANDED = RP.LANDED
DECIDED = LANDED - {"dropped"}  # a dropped decision task decides nothing
REPAIR_SHAPES = ((None, "race-decided"), ("possible PR-less merge", "escalated"), ("merged, never marked", "flipped"),
                 ("git-env trip", "git-env"), ("raised to", "raise"), ("deferred:", "deferred"))
# the holds a hold-started opens that are an ask: (act, detail)
HOLD_ASKS = {"merge": ("mergeHold", "a merge hold (%s)" % SCORE.MERGE_HOLD_DETAIL),
             "git-env": ("gitEnvHold", "a git-env hold: an unacked canary trip")}


class Stop(Exception):
    def __init__(self, message, code):
        Exception.__init__(self, message)
        self.code = code


def say(line):
    sys.stderr.write("reflect: %s\n" % line)


def done(a, line):
    """A writer's outcome line; under --dry-run it says nothing was written."""
    print(("dry run, nothing written: " if getattr(a, "dry_run", False) else "") + line)


# ---- time ------------------------------------------------------------------------------------------------------

_TZ = []


def zone():
    if not _TZ:
        try:
            from zoneinfo import ZoneInfo
            _TZ.append(ZoneInfo(ZONE))
        except Exception as e:  # ImportError, ZoneInfoNotFoundError
            raise Stop("no tz data for %s (%s): python3 -m pip install tzdata" % (ZONE, e), 3)
    return _TZ[0]


def to_ms(stamp, what):
    try:
        return SCORE.to_ms(stamp)
    except Exception as e:
        raise Stop("%s %s: %s" % (what, stamp, e), 2)


def fmt(ms):
    return SCORE.fmt(ms)


def now_ms():
    return int(datetime.datetime.now(datetime.timezone.utc).timestamp() * 1000)


def mdate(ms):
    """The Melbourne calendar date of an instant (ms), as YYYY-MM-DD."""
    return datetime.datetime.fromtimestamp(ms / 1000.0, tz=zone()).date().isoformat()


def date_in(day, since, until):
    """A date-only piece of evidence's window test (the module docstring's Melbourne dates): since's date up to, not
    including, until's, so the Reflection after this one (whose since is this until) reads until's date, once. span
    reads such evidence from every record, so that reading needs no line of the rollout in its own window."""
    return mdate(since) <= day < mdate(until)


# ---- files -----------------------------------------------------------------------------------------------------

def events_dir():
    try:
        return RR.events_dir()
    except ValueError as e:
        raise Stop("cannot resolve the events directory: %s" % e, 1)


def reflections_path():
    return os.path.join(events_dir(), RR.REFLECTIONS + ".jsonl")


def read_reflections():
    try:
        return TUNE.read_reflections(reflections_path())
    except OSError as e:
        raise Stop("reflections.jsonl cannot be read: %s" % e, 1)


def read_tunings():
    try:
        return SCORE.load_tunings(events_dir())
    except OSError as e:
        raise Stop("tunings.jsonl cannot be read: %s" % e, 1)


def read_span(path):
    try:
        with open(os.path.expanduser(path), encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError) as e:
        raise Stop("--span %s cannot be read as span's JSON: %s" % (path, e), 1)
    if not isinstance(doc, dict) or not isinstance(doc.get("reflection"), str) or not isinstance(doc.get("rollouts"), list):
        raise Stop("--span %s is not span's output (reflection, rollouts)" % path, 2)
    return doc


def span_rollouts(span):
    return {r.get("rollout") for r in span["rollouts"] if isinstance(r, dict)}


def closed(reflections, rid):
    return any(d.get("kind") == "reflection" and d.get("id") == rid for d in reflections)


def refuse_closed(reflections, rid):
    if closed(reflections, rid):
        raise Stop("Reflection %s is closed: nothing written" % rid, 2)


def check_line(kind, fields):
    """run_record's refusal of a reflections.jsonl line, before anything is written (exit 2, nothing written)."""
    try:
        RR.check(None, kind, None, fields)
    except RR.Refused as e:
        raise Stop("the run record refused the line: %s: nothing written" % e, 2)


def write_line(kind, fields, dry_run):
    """One reflections.jsonl line through run_record (validated first; a refusal is exit 2, a failed write exit 1)."""
    check_line(kind, fields)
    if dry_run:
        print("would write %s: %s" % (kind, json.dumps(fields, ensure_ascii=False, sort_keys=True)))
        return
    try:
        ok = RR.emit(None, kind, None, fields, strict=True)
    except RR.Refused as e:
        raise Stop("the run record refused the line: %s" % e, 2)
    if not ok:
        raise Stop("the %s line could not be written (see run_record above)" % kind, 1)


def git_env():
    """os.environ minus git's repo-local names (GIT_DIR & co.), as close-score.py's git_env()."""
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               stdin=subprocess.DEVNULL, timeout=GIT_TIMEOUT).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = []
    env = dict(os.environ)
    for name in names:
        env.pop(name, None)
    return env


def run(argv, timeout, env=None):
    """(rc, stdout, stderr) of a subprocess, stdin closed; rc None on a timeout or a failed start (stderr says)."""
    try:
        p = subprocess.run(argv, capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=timeout,
                           env=env if env is not None else git_env())
    except subprocess.TimeoutExpired:
        return None, "", "timed out after %ds" % timeout
    except OSError as e:
        return None, "", "cannot start: %s" % e
    return p.returncode, p.stdout, p.stderr


def first_line(text):
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip()[:240]
    return "no output"


# ---- the vault -------------------------------------------------------------------------------------------------

def default_tasks_dir():
    return os.path.join(RR._home(os.environ), "repos", "obsidian", "Work", "Tasks")


def expand(p):
    if p == "~" or p.startswith("~/"):
        return RR._home(os.environ) + p[1:]
    return os.path.expanduser(p)


class Vault:
    """The task notes: an index by stem (a root note preferred over an archived one), read lazily."""

    def __init__(self, tasks_dir):
        self.root = Path(expand(tasks_dir or default_tasks_dir()))
        self._index = None

    def index(self):
        if self._index is None:
            idx = {}
            if self.root.is_dir():
                for p in sorted(self.root.rglob("*.md")):
                    key = p.stem.lower()
                    prev = idx.get(key)
                    if prev is None or (prev.parent != self.root and p.parent == self.root):
                        idx[key] = p
            self._index = idx
        return self._index

    def find(self, slug):
        """The note for a slug: Work/Tasks/<slug>.md, else one under Archive, else None."""
        direct = self.root / ("%s.md" % slug)
        if direct.is_file():
            return direct
        return self.index().get(slug.lower())

    def rollout_note(self, slug):
        for p in (self.root / ("%s.md" % slug), self.root / "Archive" / "Rollouts" / ("%s.md" % slug)):
            if p.is_file():
                return p
        return None

    def taken(self, slug):
        """The path holding <slug>.md directly under Work/Tasks or anywhere under Work/Tasks/Archive, or None."""
        direct = self.root / ("%s.md" % slug)
        if os.path.lexists(direct):
            return direct
        archive = self.root / "Archive"
        if archive.is_dir():
            for p in archive.rglob("%s.md" % slug):
                return p
        return None

    def open_root_notes(self, flag=None):
        """(path, Rec) for every note directly under Work/Tasks that is not Landed; one with no frontmatter is
        skipped and flagged (span's flags, else stderr)."""
        out = []
        if not self.root.is_dir():
            return out
        for p in sorted(self.root.glob("*.md")):
            rec = RP.Rec(p, "root")
            if rec.fm is None:
                (flag or say)("skipped %s: no frontmatter (%s)" % (p.name, rec.err))
                continue
            if rec.status in LANDED:
                continue
            out.append((p, rec))
        return out


def status_of(path):
    rec = RP.Rec(Path(path), "")
    return rec.status if rec.fm is not None else "unreadable"


def read_note(path):
    try:
        return Note(Path(path))
    except (OSError, ValueError, UnicodeDecodeError):
        return None


def project_root(note_path):
    try:
        text = Path(note_path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    m = re.match(r"^---\n.*?\n---\n(.*)$", text, re.DOTALL)
    found = REC.PROJECT_ROOT_RE.search(m.group(1) if m else text)
    if not found:
        return None
    root = os.path.abspath(expand(found.group(1).strip()))
    return root if os.path.isdir(root) else None


def shape_of(note_path):
    """A rollout note's Shape, read as close-score.py reads it (reconcile-rollout.py's Note and _shape): `serial` or
    `parallel`; a note Note cannot read is parallel."""
    note = read_note(note_path)
    return REC._shape(note) if note is not None else "parallel"


def create(path, text, dry_run):
    """A new note by exclusive create (never over a file). Exit 2 when the path exists, 1 when it cannot be written."""
    if dry_run:
        print("would create %s:\n%s" % (path, text))
        return
    try:
        with open(path, "x", encoding="utf-8") as f:
            f.write(text)
    except FileExistsError:
        raise Stop("path exists: %s (%s)" % (Path(path).stem, status_of(path)), 2)
    except OSError as e:
        raise Stop("cannot create %s: %s" % (path, e), 1)


# ---- the Watch reader ------------------------------------------------------------------------------------------

def watches(lines, rid, until_ms=None):
    """{watch id: state} by the Watch rule (the module docstring), for the Reflection `rid`."""
    st = {}
    for d in lines:
        kind, wid = d.get("kind"), d.get("id")
        if kind not in ("watch", "watch-raised") or not isinstance(wid, str):
            continue
        w = st.setdefault(wid, {"id": wid, "cycles": [], "first": None, "rule": None, "shape": None, "lastTs": None})
        cyc = w["cycles"][-1] if w["cycles"] else None
        if kind == "watch":
            rollouts = [x for x in d.get("rollouts") or [] if isinstance(x, str)]
            count = d.get("count") if isinstance(d.get("count"), int) else 1
            if cyc is None or cyc["closedBy"] is not None:
                cyc = {"byRef": {}, "closedBy": None}
                w["cycles"].append(cyc)
            cyc["byRef"][d.get("reflection")] = (set(rollouts), count)
            if w["first"] is None:
                w["first"] = d.get("reflection")
            w["rule"], w["shape"] = d.get("rule"), d.get("shape")
            t = _ts(d)
            if t is not None:
                w["lastTs"] = max(w["lastTs"] or t, t)
        elif cyc is not None and cyc["closedBy"] is None:
            cyc["closedBy"] = (d.get("reflection"), d.get("via"))
    out = {}
    for wid, w in st.items():
        if not w["cycles"]:
            continue
        cyc = w["cycles"][-1]
        rollouts = set()
        for s, _n in cyc["byRef"].values():
            rollouts |= s
        prior = [c for c in w["cycles"] if c["closedBy"] is not None]
        last_closed = prior[-1]["closedBy"] if prior else None
        open_ = cyc["closedBy"] is None
        out[wid] = {
            "id": wid, "rule": w["rule"], "shape": w["shape"], "open": open_,
            "closedBy": None if open_ else {"reflection": cyc["closedBy"][0], "via": cyc["closedBy"][1]},
            "rollouts": sorted(rollouts), "count": sum(n for _s, n in cyc["byRef"].values()),
            "sighted": rid in cyc["byRef"], "recurring": open_ and len(rollouts) >= 2 and rid in cyc["byRef"],
            "stale": bool(until_ms is not None and w["lastTs"] is not None and until_ms - w["lastTs"] > STALE_DAYS * DAY_MS),
            "new": w["first"] == rid, "declinedBefore": bool(last_closed and last_closed[1] == "declined"),
            "lastSeen": fmt(w["lastTs"]) if w["lastTs"] is not None else None,
        }
    return out


def _ts(d):
    try:
        return SCORE.to_ms(d.get("ts"))
    except Exception:
        return None


# ---- span ------------------------------------------------------------------------------------------------------

class Span:
    def __init__(self, a):
        self.a = a
        self.flags, self.cannot = [], []
        self.vault = Vault(a.tasks_dir)
        self.out_dir = os.path.dirname(os.path.abspath(expand(a.out)))
        self.origins = {}
        self.genv = git_env()
        self.grade_log = None  # grades.py's Log, read once in run()

    def flag(self, text):
        if text not in self.flags:
            self.flags.append(text)

    def cannot_show(self, text):
        if text not in self.cannot:
            self.cannot.append(text)

    def origin(self, root):
        if root is None:
            return None
        if root not in self.origins:
            try:
                self.origins[root] = RS._origin_slug(root)
            except RS.SettingsError as e:
                self.flag("%s: no origin read (%s)" % (root, e))
                self.origins[root] = None
        return self.origins[root]

    # -- the window ---------------------------------------------------------------------------------------------

    def window(self, reflections):
        now = now_ms()
        until = to_ms(self.a.until, "--until") if self.a.until else now
        if until > now:
            self.flag("--until %s is in the future: clamped to now (%s)" % (fmt(until), fmt(now)))
            until = now
        prev = [d for d in reflections if d.get("kind") == "reflection"]
        if self.a.since:
            since = to_ms(self.a.since, "--since")
        elif prev and _ts({"ts": prev[-1].get("until")}) is not None:
            since = _ts({"ts": prev[-1].get("until")})
        else:
            since = until - 7 * DAY_MS
        if since > until:
            raise Stop("--since %s is after --until %s" % (fmt(since), fmt(until)), 2)
        return since, until, (prev[-1].get("id") if prev else None)

    # -- the records ----------------------------------------------------------------------------------------------

    def records(self, ev):
        """{slug: [(ms, n, line)]} for every non-reserved record in the events directory."""
        out = {}
        try:
            names = sorted(os.listdir(ev))
        except FileNotFoundError:
            self.flag("no events directory at %s: no rollout read" % ev)
            return out
        except OSError as e:
            raise Stop("cannot list the events directory %s: %s" % (ev, e), 1)
        reserved = {r + ".jsonl" for r in RR.RESERVED}
        for name in names:
            if not name.endswith(".jsonl") or name in reserved:
                continue
            try:
                lines, skipped = SCORE.read_lines(os.path.join(ev, name))
            except OSError as e:
                self.flag("%s cannot be read (%s): skipped" % (name, e))
                self.cannot_show("record %s cannot be read: neither read nor swept" % name)
                continue
            if skipped:
                self.flag("%s: %d line(s) did not parse: skipped" % (name, skipped))
            out[name[:-6]] = lines
        return out

    # -- one read rollout -------------------------------------------------------------------------------------------

    def read_rollout(self, slug, lines, since, until, tunings_file):
        entry = {"rollout": slug, "mode": "read", "shape": "parallel", "note": None, "root": None, "repo": None,
                 "status": None, "closeLine": None, "score": None, "window": None, "partial": None, "headline": None,
                 "breached": [], "breachCounts": False, "binding": None, "proposals": [], "flags": [], "friction": []}
        try:
            hit = TUNE.close_line(slug, path=tunings_file)
        except OSError as e:
            raise Stop("tunings.jsonl cannot be read: %s" % e, 1)
        except Exception as e:  # a record whose file name is no slug (run_record writes none)
            hit = None
            entry["flags"].append("no close line read (%s)" % e)
        if hit is not None:
            entry["closeLine"] = {"id": hit.get("id"), "close": hit.get("close")}
        note = self.vault.rollout_note(slug)
        if note is None:
            entry["flags"].append("no rollout note: scored by slug, never a knob candidate")
        else:
            entry["note"] = str(note)
            entry["status"] = status_of(note)
            archived = note.parent.name == "Rollouts" and note.parent.parent.name == "Archive"
            if hit is None and (archived or entry["status"] in ("done", "dropped")):
                entry["flags"].append("closed with no close line: no baseline")
                self.cannot_show("[[%s]] is closed (%s) with no close line: read this week, no baseline written"
                                 % (slug, "archived" if archived else entry["status"]))
            if shape_of(note) == "serial":
                return self.read_chain(entry, note, lines, since, until)
            entry["root"] = project_root(note)
            if entry["root"] is None:
                entry["flags"].append("no Project root: scored by slug, never a knob candidate")
        entry["repo"] = self.origin(entry["root"])
        if entry["root"] is not None and entry["repo"] is None:
            entry["flags"].append("no GitHub origin: never a knob candidate")
        settings = None
        if entry["root"] is not None:
            try:
                doc = RS.resolve(repo=entry["root"], path=expand(self.a.config) if self.a.config else None)
                settings = os.path.join(self.out_dir, "%s.settings.json" % slug)
                with open(settings, "w", encoding="utf-8") as f:
                    json.dump(RS.redacted(doc), f)  # the CLI's own JSON: whether an ntfy topic is set, never the topic
                entry["settingsFile"] = settings
            except RS.SettingsError as e:
                entry["flags"].append("rollout-settings refused (%s): scored without settings, never a knob candidate" % e)
                settings = None
            except OSError as e:
                raise Stop("cannot write %s: %s" % (settings, e), 1)
        if self.a.fold and note is not None:
            rc, _out, err = run([sys.executable, RECONCILE_PY, "fold-journals", "--rollout", str(note)], FOLD_TIMEOUT,
                                self.genv)
            if rc != 0:
                entry["flags"].append("fold-journals exited %s: %s" % (rc, first_line(err)))
        out = os.path.join(self.out_dir, "%s.score.json" % slug)
        argv = [sys.executable, SCORE_PY, "--rollout", slug, "--until", fmt(until), "--tasks-dir", str(self.vault.root),
                "--out", out]
        if note is not None:
            argv += ["--note", str(note)]
        if settings:
            argv += ["--settings", settings]
        if entry["repo"]:
            argv += ["--repo-slug", entry["repo"]]
        if entry["root"]:
            argv += ["--repo", entry["root"]]
        rc, _o, err = run(argv, SCORE_TIMEOUT, self.genv)
        sc = None
        if rc == 0:
            try:
                with open(out, encoding="utf-8") as f:
                    sc = json.load(f)
                entry["score"] = out
            except (OSError, ValueError) as e:
                entry["flags"].append("score.py wrote no readable score: %s" % e)
        else:
            entry["flags"].append("score.py exited %s: %s" % (rc, first_line(err)))
        if sc is not None:
            self.scored(entry, sc, since, until)
        self.friction(entry, lines, since, until)
        for f in entry["flags"]:
            self.flag("[[%s]]: %s" % (slug, f))
        return entry, sc

    # -- one read serial chain (ADR 0040) -----------------------------------------------------------------------------

    def read_chain(self, entry, note, lines, since, until):
        """A `shape: serial` note: serial-score.py instead of fold-journals, the settings resolve and score.py (close-score's
        serial path), and the chain's friction from leg.py status beside the record's. Never a knob candidate."""
        slug = entry["rollout"]
        entry["shape"] = "serial"
        entry["chain"] = None
        entry["flags"].append(SERIAL_FLAG)
        out = os.path.join(self.out_dir, "%s.score.json" % slug)
        argv = [sys.executable, SERIAL_PY, "--rollout", str(note), "--tasks-dir", str(self.vault.root),
                "--until", fmt(until), "--out", out]
        rc, _o, err = run(argv, SCORE_TIMEOUT, self.genv)
        sc = None
        if rc == 0:
            try:
                with open(out, encoding="utf-8") as f:
                    sc = json.load(f)
                entry["score"] = out
            except (OSError, ValueError) as e:
                entry["flags"].append("serial-score.py wrote no readable score: %s" % e)
        else:
            entry["flags"].append("serial-score.py exited %s: %s" % (rc, first_line(err)))
        if sc is not None:
            self.scored(entry, sc, since, until)
            entry["proposals"] = []  # a serial score proposes nothing, and its line is never a baseline
            entry["chain"] = sc.get("chain")
        try:
            st = SERIAL.leg_status(str(note), str(self.vault.root), self.genv)
        except SERIAL.Unreadable as e:
            st = None
            entry["flags"].append("%s: no chain friction read" % e)
        if sc is None and st is not None:  # no score (a non-zero exit, say --until before Leg 1): status's own state
            entry["chain"] = st.get("chain")
        extra = self.chain_friction(slug, st, sc, lines, since, until) if st is not None else []
        self.friction(entry, lines, since, until, extra)
        for f in entry["flags"]:
            self.flag("[[%s]]: %s" % (slug, f))
        return entry, sc

    def chain_friction(self, slug, st, sc, lines, since, until):
        """A chain's own friction items, from leg.py status (`st`) and serial-score's escapes block (`sc`): each in-window
        `set aside` line (movedBy read from the record's acts and the Leg log's later claim), `halt cleared:` line (an
        ask), restart (serial-score's fold_restarts(): its `restart:` lines read as one), and each Escape the block's
        `fixes:` evidence dates in or out of the window."""
        items = []

        def at_ms(stamp):
            try:
                return SCORE.to_ms(stamp)
            except Exception:  # a stamp leg.py printed raw that run_record's _stamp refuses
                self.flag("[[%s]]: a Leg-log stamp %r does not parse: skipped" % (slug, stamp))
                return None

        moves = []  # (ms, task, kind, leg) of every Leg-log claim, take and done: what picks a set-aside task back up
        for g in st.get("legs") or []:
            for kind in ("claimed", "took", "done"):
                for e in g.get(kind) or []:
                    t = at_ms(e.get("at"))
                    if t is not None and e.get("task"):
                        moves.append((t, e["task"].lower(), kind, g.get("n")))
        moves.sort(key=lambda m: m[0])
        for g in st.get("legs") or []:
            for e in g.get("setAside") or []:
                t = at_ms(e.get("at"))
                if t is None or not since <= t <= until or not e.get("task"):
                    continue
                moved, mover = self.chain_moved_by(lines, moves, e["task"], t, until)
                items.append({"kind": "set-aside", "rollout": slug, "task": e["task"], "at": fmt(t), "leg": g.get("n"),
                              "stage": SERIAL_STAGES.get(e.get("status"), "block"), "status": e.get("status"),
                              "reasonClass": None, "setAsideAt": "leg", "taskNote": self.task_note(e["task"]),
                              "movedBy": moved, "mover": mover, "explainedIn": None})
        took, halted = {}, {}
        for g in st.get("legs") or []:
            for e in g.get("took") or []:
                took.setdefault(e.get("from"), e.get("task"))
            if g.get("outcome") == "halted":  # its close line, `halted: <reason>`: what the trace starts from
                halted[g.get("n")] = (g.get("closed") or "").split(":", 1)[-1].strip() or None
        for c in st.get("haltCleared") or []:
            t = at_ms(c.get("at"))
            if t is None or not since <= t <= until:
                continue
            detail = "Leg %s's halt cleared: %s" % (c.get("leg"), c.get("reason"))
            item = self.ask(slug, took.get(c.get("leg")), t, "haltCleared", detail)
            item["halted"] = halted.get(c.get("leg"))
            items.append(item)
        for r in SERIAL.fold_restarts(st, until, at_ms):  # one per restart, never per line: its first line's stamp
            if not since <= r["at"] <= until:
                continue
            items.append({"kind": "restart", "rollout": slug, "task": None, "at": fmt(r["at"]), "leg": r["leg"],
                          "how": r["how"], "started": r["started"], "manual": r["manual"], "session": r["session"],
                          "began": fmt(r["began"]) if r["began"] is not None else None})
        block = (sc or {}).get("escapes") if isinstance((sc or {}).get("escapes"), dict) else None
        if block:
            dates = self.dates(None, block)  # fixes: only (no repo), so no git is read
            for tk in block.get("tasks") or []:
                for ev in tk.get("evidence") or []:
                    day, undated = dates.get(self.ev_key(ev), (None, False))
                    item = {"kind": "escape", "rollout": slug, "task": tk.get("task"), "source": ev.get("source"),
                            "at": day, "inWindow": self.in_window(day, since, until), "evidence": ev}
                    if undated:
                        item["undated"] = True
                    items.append(item)
        return items

    @staticmethod
    def chain_moved_by(lines, moves, task, at, until):
        """(movedBy, mover) of a chain's set-aside at `at` (ms): the first human act on the task in the record after it
        (its kind, a hand-back with its via), when it comes before the end of the minute of the Leg log's next claim,
        take or done of the task (a Leg-log stamp floors to its minute and a record act is ms, so an act in that minute
        came first: legs.md signs a gate, then claims, serial-score.py's done + 60 s rule); `unrecorded` with mover
        {kind, at, leg} when a Leg picked the task up with no act before it; else None."""
        key = task.lower()
        pick = next((m for m in moves if m[0] > at and m[1] == key and m[0] <= until), None)
        for t, _n, d in lines:
            if t <= at:
                continue
            if t > until or (pick is not None and t >= pick[0] + MINUTE_MS):
                break
            if str(d.get("task") or "").lower() != key or d.get("kind") not in SERIAL_MOVERS:
                continue
            if d["kind"] == "gate-signed" and d.get("standing") is True:
                return "gate-signed (standing)", None
            if d["kind"] == "handed-back":
                return "handed-back (via %s)" % d.get("via"), None
            return d["kind"], None
        if pick is not None:
            return "unrecorded", {"kind": pick[2], "at": fmt(pick[0]), "leg": pick[3]}
        return None, None

    def scored(self, entry, sc, since, until):
        w = sc.get("window") or {}
        entry["window"] = w
        entry["partial"] = w.get("partial") is True
        h = sc.get("headline") or {}
        entry["headline"] = {k: h.get(k) for k in ("handsOffRate", "quality", "reviewChurn", "throughput")}
        entry["breached"] = sorted(k for k, v in (sc.get("guardrails") or {}).items() if isinstance(v, dict) and v.get("breached"))
        end = _ts({"ts": w.get("activeEnd")}) if w.get("activeEnd") else None
        entry["breachCounts"] = bool(not entry["partial"] and end is not None and since <= end <= until)
        if entry["breached"] and entry["partial"]:
            entry["flags"].append("a breach on a partial window (%s): reported, not counted" % ", ".join(entry["breached"]))
        entry["binding"] = (sc.get("binding") or {}).get("constraint")
        knob_ok = entry["repo"] is not None and entry["note"] is not None and entry.get("settingsFile") is not None \
            and isinstance(sc.get("repo"), str)
        for p in sc.get("proposals") or []:
            if not isinstance(p, dict) or not isinstance(p.get("direction"), int) or not isinstance(p.get("key"), str):
                continue
            q = dict(p)
            q["knob_key"] = RR.knob_key(sc["repo"], p["key"], str(p.get("rule")), p["direction"]) if knob_ok else None
            entry["proposals"].append(q)

    # -- friction ---------------------------------------------------------------------------------------------------

    def task_note(self, task):
        p = self.vault.find(task) if task else None
        return str(p) if p else None

    def friction(self, entry, lines, since, until, extra=()):
        """The friction items of one read rollout: the record's, then `extra` (a chain's own, chain_friction()), then
        its note's repair lines; every unrecorded set-aside among them gets its explainedIn and a cannotShow line."""
        slug, items = entry["rollout"], entry["friction"]
        # ask: straight from the record, for every task, landed or not (score.py's handsOff lists landed tasks only):
        # each human act line (score.py's human_act) and each hold a hold-started opens (paired as score.py pairs them)
        holding = set()
        for t, _n, d in lines:
            if t > until:
                break
            kind = d.get("kind")
            task = d.get("task") if isinstance(d.get("task"), str) else None
            hold = d.get("hold") if isinstance(d.get("hold"), str) else None
            inside = since <= t
            if kind == "hold-started" and hold in HOLD_ASKS:
                if (hold, task) not in holding:
                    holding.add((hold, task))
                    if inside:
                        items.append(self.ask(slug, task, t, *HOLD_ASKS[hold]))
            elif kind == "hold-ended":
                holding.discard((hold, task))
            elif kind == "lane-freed" and task:
                holding.discard(("merge", task))
            elif kind == "carried" and task and d.get("rollout") == d.get("from"):
                holding = {k for k in holding if k[1] != task}
            elif inside and task and kind in SCORE.ACT_KINDS:
                act = SCORE.human_act(kind, d)
                if act is not None:
                    items.append(self.ask(slug, task, t, act[0], act[1]))
        for i, (t, n, d) in enumerate(lines):
            if not since <= t <= until:
                continue
            kind, task = d.get("kind"), d.get("task")
            if kind == "set-aside" and task:
                moved, mover = self.moved_by(lines, i, task, until)
                items.append({"kind": "set-aside", "rollout": slug, "task": task, "at": fmt(t), "stage": d.get("stage"),
                              "reasonClass": d.get("reasonClass"), "setAsideAt": d.get("setAsideAt"),
                              "taskNote": self.task_note(task), "movedBy": moved, "mover": mover, "explainedIn": None})
            elif kind == "auto-retry" and task:
                items.append({"kind": "retry", "rollout": slug, "task": task, "at": fmt(t), "stage": d.get("stage"),
                              "retryClass": d.get("retryClass"), "used": d.get("used"), "budget": d.get("budget")})
            elif kind == "handed-back" and task and d.get("via") == "descope":
                items.append({"kind": "descope", "rollout": slug, "task": task, "at": fmt(t), "arm": d.get("arm")})
            elif kind == "review-verdict" and task and isinstance(d.get("regression"), int) and d["regression"] > 0:
                items.append({"kind": "churn", "rollout": slug, "task": task, "at": fmt(t), "round": d.get("round"),
                              "findings": d.get("findings"), "regression": d.get("regression")})
        items.extend(extra)
        if entry["note"]:
            items.extend(self.repairs(slug, entry["note"], since, until))
        unrecorded = [it for it in items if it["kind"] == "set-aside" and it["movedBy"] == "unrecorded"]
        noted = self.notes_naming(entry["note"]) if unrecorded else set()
        for it in unrecorded:
            it["explainedIn"] = self.explained_in(it, noted)
            self.cannot_show("[[%s]] (%s) moved on with no recorded act: a Human fix, a gate signed on the note with no "
                             "gate-signed line, or a hand edit; read its ## Needs you, ## Integration log and ## Approved "
                             "gates, [[%s]]'s ## Notes and its Run record lines" % (it["task"], slug, slug))

    @staticmethod
    def notes_naming(note_path):
        """The task slugs a wikilink names on any line of the rollout note's `## Notes` (read as repairs() reads its
        links, so an alias, heading or path matches), or an empty set for a null or unreadable note."""
        note = read_note(note_path) if note_path else None
        out = set()
        if note is not None:
            for link in WIKILINK_OPEN_RE.findall(note.section_text(NOTES_SECTION)):
                s = _wikilink_slug(link)
                if s:
                    out.add(s)
        return out

    @staticmethod
    def explained_in(item, noted):
        """Where an unrecorded set-aside's mover may be written, in order: its task note's `## Needs you` and
        `## Integration log` when non-empty; for a gate set-aside only (approve-gates signs a gate-pending task alone),
        its `## Approved gates` lines, each label once (the Standing approval's annotation, approve-gates' bare
        `(approved <date>)`, then any other line); and `rollout ## Notes` when a line there links the task."""
        out = []
        note = read_note(item["taskNote"]) if item["taskNote"] else None
        if note is not None:
            for sec in (REC.NEEDS_HUMAN_SECTION, REC.INTEGRATION_LOG_SECTION):
                if note.section_text(sec):
                    out.append(sec)
            if item.get("stage") == "gate":
                gates = [l.strip() for l in note.section_text(REC.APPROVED_GATES_SECTION).split("\n") if l.strip()]
                standing = [l for l in gates if STANDING_GATE_RE.search(l)]
                signed = [l for l in gates if SIGNED_GATE_RE.search(l)]
                if standing:
                    out.append("%s: standing approval" % REC.APPROVED_GATES_SECTION)
                if signed:
                    out.append("%s: sign-off" % REC.APPROVED_GATES_SECTION)
                if len(gates) > len(standing) + len(signed):
                    out.append(REC.APPROVED_GATES_SECTION)
        if item["task"] in noted:
            out.append("rollout %s" % NOTES_SECTION)
        return out

    def ask(self, slug, task, at, act, detail):
        """An `ask` friction item for the act at `at` (ms), with the grade in force for its task then."""
        grade = self.grade_log.at(task, at) if task and self.grade_log is not None else None
        item = {"kind": "ask", "rollout": slug, "task": task, "at": fmt(at), "act": act, "detail": detail,
                "askedAhead": False, "needsYou": None, "grade": grade}
        p = self.task_note(task)
        note = read_note(p) if p else None
        if note is not None:
            item["askedAhead"] = bool(ASKED_AHEAD_RE.search(note._body))
            ny = note.section_text(REC.NEEDS_HUMAN_SECTION)
            item["needsYou"] = ny[:NEEDS_YOU_MAX] if ny else None
        return item

    @staticmethod
    def moved_by(lines, i, task, until):
        """(movedBy, mover) of the set-aside at lines[i]: mover is {kind, at, start?} of the slot-taken, lane-taken or
        merged line that moved it on with no act before it (start on a slot-taken only), else None."""
        for t, _n, d in lines[i + 1:]:
            if t > until:
                break
            if d.get("task") != task or d.get("kind") not in MOVERS:
                continue
            kind = d["kind"]
            if kind == "carried" and d.get("rollout") != d.get("from"):
                continue  # the to-file's copy: the from-file's line moved it
            if kind in UNRECORDED_MOVERS:
                mover = {"kind": kind, "at": fmt(t)}
                if kind == "slot-taken" and d.get("start") in SLOT_STARTS:
                    mover["start"] = d["start"]
                return "unrecorded", mover
            if kind == "handed-back":
                return "handed-back (via %s)" % d.get("via"), None
            return kind, None
        return None, None

    def repairs(self, slug, note_path, since, until, flag_undated=True):
        """The repair items of one rollout note: its `## Notes` lines dated in the window (date_in()). An undated line
        is flagged only for a read rollout (flag_undated), so a swept old note does not repeat its flag every week."""
        note = read_note(note_path)
        if note is None:
            self.flag("[[%s]]: its note cannot be read: no repair lines" % slug)
            return []
        out = []
        for line in note.section_text(NOTES_SECTION).split("\n"):
            line = line.rstrip()
            m = REPAIR_RE.match(line)
            if not m:
                u = UNDATED_REPAIR_RE.match(line) if flag_undated else None
                if u and not re.fullmatch(r"\d{4}-\d\d-\d\d", u.group(1) or ""):
                    self.flag("[[%s]]: an undated repair line in ## Notes: %s" % (slug, line[:120]))
                continue
            day, text = m.group(1), m.group(2)
            if not date_in(day, since, until):
                continue
            tasks = []
            for link in WIKILINK_OPEN_RE.findall(text):
                s = _wikilink_slug(link)
                if s and s not in tasks:
                    tasks.append(s)
            shape = "other"
            for needle, name in REPAIR_SHAPES:
                if (RACE_DECIDED_RE.search(line) if needle is None else needle in text):
                    shape = name
                    break
            out.append({"kind": "repair", "rollout": slug, "task": tasks[0] if tasks else None, "tasks": tasks,
                        "at": day, "date": day, "text": text[:REPAIR_TEXT_MAX], "shape": shape})
        return out

    # -- the serial chains with no record line in the window ------------------------------------------------------------

    def serial_notes(self):
        """(slug, path) of every `shape: serial` note holding a Leg log, directly under Work/Tasks, then under
        Archive/Rollouts (a live note wins its slug, as rollout_note() resolves it)."""
        seen = set()
        for d in (self.vault.root, self.vault.root / "Archive" / "Rollouts"):
            if not d.is_dir():
                continue
            for p in sorted(d.glob("*.md")):
                if p.stem.lower() in seen or p.stem in RR.RESERVED:
                    continue
                try:
                    if "\n%s" % LEG_LOG not in p.read_text(encoding="utf-8"):
                        continue
                except (OSError, UnicodeDecodeError):
                    continue
                if shape_of(p) == "serial":
                    seen.add(p.stem.lower())
                    yield p.stem, p

    def leg_log_in(self, note_path, since, until):
        """Whether a line of the note's `## Leg log` is stamped in [since, until]."""
        note = read_note(note_path)
        for line in (note.section_text(LEG_LOG) if note is not None else "").split("\n"):
            m = LEG_STAMP_RE.match(line.rstrip())
            if not m:
                continue
            try:
                t = SCORE.to_ms(m.group(1))
            except Exception:
                continue
            if since <= t <= until:
                return True
        return False

    # -- the Escapes sweep (ADR 0037 d4) ----------------------------------------------------------------------------

    def sweep(self, records, read, since, until):
        """{rollout: [escape items]}: every record's landed tasks, any age, per repo through escapes.py."""
        repos = {}  # repo -> {"roots": {root: newest ms}, "landed": {task: (rollout, info, at ms)}}
        for slug, lines in records.items():
            merges = [(t, d.get("task"), d.get("pr"), d.get("readOnly") is True) for t, _n, d in lines
                      if d.get("kind") == "merged" and d.get("task")]
            if not merges:
                continue
            landed, flags = SCORE.landed_from(merges, float("-inf"), until)
            for f in flags:
                self.flag("[[%s]]: %s" % (slug, f))
            if not landed:
                continue
            entry = read.get(slug)
            note = Path(entry["note"]) if entry and entry["note"] else self.vault.rollout_note(slug)
            root = (entry or {}).get("root") or (project_root(note) if note else None)
            if note is None or root is None:
                self.cannot_show("record %s: no rollout note%s: its %d landed task(s)' Escapes are not swept"
                                 % (slug, "" if note is None else " Project root", len(landed)))
                continue
            repo = self.origin(root)
            if repo is None:
                self.cannot_show("record %s: %s has no GitHub origin: its Escapes are not swept" % (slug, root))
                continue
            r = repos.setdefault(repo.lower(), {"slug": repo, "roots": {}, "landed": {}})
            last = lines[-1][0] if lines else 0
            r["roots"][root] = max(r["roots"].get(root, 0), last)
            for task, info in landed.items():
                at = _ts({"ts": info.get("at")}) or 0
                prev = r["landed"].get(task)
                if prev is not None and prev[0] != slug:
                    self.flag("[[%s]] landed in two records ([[%s]], [[%s]]): credited to the later" % (task, prev[0], slug))
                    if prev[2] > at:
                        continue
                r["landed"][task] = (slug, info, at)
        out = {}
        for key in sorted(repos):
            r = repos[key]
            roots = sorted(r["roots"], key=lambda x: r["roots"][x])
            root = roots[-1]
            if len(roots) > 1:
                self.flag("repo %s has %d Project roots (%s): the newest, %s, is read" % (r["slug"], len(roots),
                                                                                         ", ".join(roots), root))
            landed = {task: info for task, (_s, info, _a) in r["landed"].items()}
            owner = {ESC._canon(task): s for task, (s, _i, _a) in r["landed"].items()}
            block, flags = ESC.score(landed, str(self.vault.root), root, r["slug"], dict(os.environ))
            for f in flags:
                self.flag("escapes (%s): %s" % (r["slug"], f))
            for src, state in (block.get("sources") or {}).items():
                if state != "read":
                    self.cannot_show("repo %s: Escapes from %s %s" % (r["slug"], src, state))
            dates = self.dates(root, block)
            for t in block.get("tasks") or []:
                rollout = owner.get(t["task"])
                for ev in t.get("evidence") or []:
                    at, undated = dates.get(self.ev_key(ev), (None, False))
                    item = {"kind": "escape", "rollout": rollout, "task": t["task"], "source": ev.get("source"),
                            "at": at, "inWindow": self.in_window(at, since, until), "evidence": ev}
                    if undated:
                        item["undated"] = True
                    out.setdefault(rollout, []).append(item)
        return out

    @staticmethod
    def ev_key(ev):
        return (ev.get("source"), ev.get("note") or ev.get("commit") or ev.get("doc"))

    @staticmethod
    def in_window(at, since, until):
        if at is None:
            return False
        if re.fullmatch(r"\d{4}-\d\d-\d\d", at):
            return date_in(at, since, until)
        t = _ts({"ts": at})
        return t is not None and since <= t <= until

    def dates(self, root, block):
        """{(source, name): (at, undated)} for every piece of evidence in an escapes.py block."""
        out, reverts, docs = {}, [], []
        for t in block.get("tasks") or []:
            for ev in t.get("evidence") or []:
                src = ev.get("source")
                if src == "fixes":
                    p = self.vault.find(ev.get("note") or "")
                    day, undated = None, False
                    note = read_note(p) if p else None
                    cap = REC._scalar(note.get("captured")) if note is not None else ""
                    if re.match(r"\d{4}-\d\d-\d\d", cap):
                        day = cap[:10]
                    elif p is not None:
                        day, undated = mdate(int(os.stat(p).st_mtime * 1000)), True
                        self.flag("undated fixer: [[%s]] has no captured:, read by its mtime" % ev.get("note"))
                    out[self.ev_key(ev)] = (day, undated)
                elif src == "revert":
                    reverts.append(ev.get("commit"))
                elif src == "review":
                    docs.append(ev.get("doc"))
        env = git_env()
        # The checkout escapes.py read: the Project root's, or its fresher in-place twin's (ADR 0042), so a revert only
        # the twin has fetched is dated from it.
        top = (block.get("ref") or {}).get("top") or root
        trees = block.get("reviewTrees") or [root]
        if reverts:
            rc, so, _e = run(["git", "-C", top, "log", "--no-walk", "--format=%H%x1f%cI"] + sorted(set(reverts)) + ["--"],
                             GIT_TIMEOUT, env)
            if rc == 0:
                for line in so.splitlines():
                    parts = line.split("\x1f")
                    if len(parts) == 2:
                        out[("revert", parts[0])] = (fmt(_ts({"ts": parts[1]})) if _ts({"ts": parts[1]}) is not None else None, False)
        for doc in sorted(set(d for d in docs if d)):
            rc, so, _e = run(["git", "-C", top, "log", "--all", "--diff-filter=AM", "-1", "--format=%cI", "--", doc],
                             GIT_TIMEOUT, env)
            t = _ts({"ts": so.strip()}) if rc == 0 and so.strip() else None
            for tree in trees if t is None else []:  # a working-tree doc: the Project root's copy first
                p = os.path.join(tree, doc)
                if os.path.exists(p):
                    t = int(os.stat(p).st_mtime * 1000)
                    break
            out[("review", doc)] = (fmt(t) if t is not None else None, False)
        return out

    # -- /fresh-review churn (reported only) --------------------------------------------------------------------------

    def fresh_review(self, ev, since, until):
        path = os.path.join(ev, RR.REVIEWS + ".jsonl")
        if not os.path.exists(path):
            return []
        try:
            lines, _s = SCORE.read_lines(path)
        except OSError as e:
            self.flag("reviews.jsonl cannot be read (%s): no /fresh-review churn" % e)
            return []
        latest = {}
        for t, _n, d in lines:
            if d.get("kind") != "review-round" or t > until or not isinstance(d.get("repo"), str):
                continue
            doc = d.get("doc")
            key = ("doc", d["repo"], doc) if isinstance(doc, str) and doc else ("head", d["repo"], d.get("head"), d.get("digest"))
            latest[key] = (t, d)
        out = []
        for t, d in sorted(latest.values(), key=lambda x: x[0]):
            if since <= t <= until and isinstance(d.get("regression"), int) and d["regression"] > 0:
                out.append({"repo": d["repo"], "doc": d.get("doc"), "head": d.get("head"), "at": fmt(t),
                            "findings": d.get("findings"), "regression": d["regression"]})
        if out:
            self.cannot_show("/fresh-review churn: %d round(s) with regression findings, reported, not traced to a "
                             "rollout (reviews.jsonl names none)" % len(out))
        return out

    # -- knobs ------------------------------------------------------------------------------------------------------

    def knobs(self, entries, scores, rid, tunings, reflections):
        out = {"revert": [], "land": [], "held": []}
        by_repo = {}  # the knob-capable read rollouts (a note, a root, an origin, settings and a score), per repo
        for e in entries:
            if e["mode"] == "read" and e.get("shape") != "serial" and e["rollout"] in scores and e["repo"] \
                    and e.get("settingsFile") and e["note"]:
                by_repo.setdefault(e["repo"].lower(), []).append(e)
        # reverts first: each standing auto line against a read, non-partial rollout of its repo
        reverting = set()
        for line in tunings:
            if line["_voided"] or line.get("auto") is not True or isinstance(line.get("reverts"), str):
                continue
            sim = list(tunings)
            for e in sorted(by_repo.get(line["repo"].lower(), []), key=self.newest_key):
                if e["partial"]:
                    continue
                now_values = self.now_values(e)
                while True:
                    entry, _why = TUNE.revert_check(scores[e["rollout"]], line["id"], sim, now_values)
                    if entry is None:
                        break
                    out["revert"].append({"tuning": line["id"], "key": entry["key"], "rollout": e["rollout"],
                                          "repo": e["repo"], "root": e["root"], "scores": e["score"],
                                          "breached": entry["breached"]})
                    reverting.add((line["repo"].lower(), entry["key"]))
                    sim = sim + [{"_voided": False, "_t": 0, "reverts": line["id"], "repo": line["repo"],
                                  "applied": [{"key": entry["key"]}]}]
                if any(r["tuning"] == line["id"] for r in out["revert"]):
                    break
        for repo, es in sorted(by_repo.items()):
            whole = [e for e in es if not e["partial"]]
            newest = max(whole, key=self.newest_key) if whole else None
            for e in es:
                sc = scores[e["rollout"]]
                for p in e["proposals"]:
                    if p.get("knob_key") is None:
                        continue
                    item = {"id": p["knob_key"], "rollout": e["rollout"], "repo": e["repo"], "root": e["root"],
                            "scores": e["score"], "key": p["key"], "rule": p.get("rule"), "direction": p["direction"],
                            "from": p.get("from"), "to": p.get("to"), "ranAt": p.get("ranAt")}
                    if e["partial"]:
                        item["reason"] = "partial window"
                        out["held"].append(item)
                        continue
                    ok, reason, agreed = TUNE.auto_check(sc, p, rid, tunings, reflections)
                    item["agreed"] = agreed
                    if ok and (repo, p["key"]) in reverting:
                        ok, reason = False, "a revert of %s comes first this Reflection" % p["key"]
                    if ok and e is not newest:
                        ok, reason = False, "not the repo's newest rollout ([[%s]] is)" % newest["rollout"]
                    if ok:
                        out["land"].append(item)
                    else:
                        item["reason"] = reason
                        out["held"].append(item)
        return out

    @staticmethod
    def newest_key(e):
        w = e.get("window") or {}
        return (_ts({"ts": w.get("activeEnd")}) or _ts({"ts": w.get("activeStart")}) or 0, e["rollout"])

    @staticmethod
    def now_values(e):
        try:
            with open(e["settingsFile"], encoding="utf-8") as f:
                doc = json.load(f)
            return {k: doc["settings"][k]["value"] for k in RS.KEYS}
        except (OSError, ValueError, KeyError, TypeError):
            return {}

    # -- grade accuracy (p25-4) ---------------------------------------------------------------------------------------

    def grades(self, records, since, until):
        """grades.py's block over every record: its flags prefixed `grades: `, its gaps in cannotShow. Never stops the
        span: a fault in the join is a flag and an empty block."""
        try:
            out, flags, cannot = GR.accuracy(self.grade_log, records, self.vault.find, date_in, mdate, since, until)
        except Stop:
            raise
        except Exception as e:
            out, flags, cannot = GR.block(self.grade_log), ["grade accuracy failed (%s: %s): an empty block"
                                                            % (type(e).__name__, e)], []
        for f in flags:
            self.flag("grades: %s" % f)
        for c in cannot:
            self.cannot_show(c)
        return out

    # -- the whole span -------------------------------------------------------------------------------------------------

    def run(self):
        ev = events_dir()
        reflections = read_reflections()
        tunings = read_tunings()
        since, until, previous = self.window(reflections)
        zone()
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        rid = "r-%s-%s" % (stamp, secrets.token_hex(3))
        try:
            os.makedirs(self.out_dir, exist_ok=True)
        except OSError as e:
            raise Stop("cannot make %s: %s" % (self.out_dir, e), 1)
        records = self.records(ev)
        self.grade_log = GR.load(ev)
        tunings_file = os.path.join(ev, RR.TUNINGS + ".jsonl")
        read, scores, entries = {}, {}, []
        for slug in sorted(records):
            lines = records[slug]
            if not any(since <= t <= until for t, _n, _d in lines):
                continue
            entry, sc = self.read_rollout(slug, lines, since, until, tunings_file)
            read[slug] = entry
            entries.append(entry)
            if sc is not None:
                scores[slug] = sc
        # A serial chain records only Lachy's acts, so a hands-off chain has no record line in the window (or no record
        # at all): it is read when its note's Leg log has a line in the window.
        for slug, note in self.serial_notes():
            key = slug.lower()  # a record's name is run_record's lowercased slug
            if key in read or not self.leg_log_in(note, since, until):
                continue
            entry, sc = self.read_rollout(slug, records.get(key, []), since, until, tunings_file)
            read[key] = entry
            entries.append(entry)
            if sc is not None:
                scores[slug] = sc
        swept = self.sweep(records, read, since, until)
        for slug in sorted(s for s in swept if s in read):
            read[slug]["friction"].extend(swept[slug])
        # A rollout not read this week is read light for its in-window evidence, from every record: the Escapes the
        # sweep traced to it, and the dated repair: lines of its note's ## Notes (date-only, so read by date whatever
        # the record holds, or a line on until's date would be lost when the next window has no line of the rollout).
        for slug in sorted(records):
            if slug in read:
                continue
            note = self.vault.rollout_note(slug)
            inw = [x for x in swept.get(slug) or [] if x["inWindow"]]
            reps = self.repairs(slug, note, since, until, flag_undated=False) if note is not None else []
            if not inw and not reps:
                continue
            root = project_root(note) if note else None
            entries.append({"rollout": slug, "mode": "escapes-only" if inw else "repairs-only",
                            "shape": shape_of(note) if note else "parallel", "note": str(note) if note else None,
                            "root": root, "repo": self.origin(root), "status": None, "closeLine": None, "score": None,
                            "window": None, "partial": None, "headline": None, "breached": [], "breachCounts": False,
                            "binding": None, "proposals": [], "flags": [], "friction": inw + reps})
        self.cannot_show("a repair run that writes no dated repair: line and records no event is not seen, nor is a "
                         "repair: line on a rollout with no Run record")
        fresh = self.fresh_review(ev, since, until)
        ws = watches(reflections, rid, until)
        knobs = self.knobs(entries, scores, rid, tunings, reflections)
        bugs, decision = [], None
        for p, rec in self.vault.open_root_notes(self.flag):
            if rec.scalar("bug_key"):
                bugs.append({"slug": p.stem, "bug_key": rec.scalar("bug_key"), "status": rec.status})
            if "decisions" in rec.tags and decision is None:
                decision = {"slug": p.stem, "scheduled": rec.scalar("scheduled") or None, "status": rec.status}
        grades = self.grades(records, since, until)
        doc = {"reflection": rid, "since": fmt(since), "until": fmt(until), "previous": previous,
               "rollouts": entries, "freshReview": fresh,
               "watches": sorted((w for w in ws.values() if w["open"] or w["declinedBefore"]), key=lambda w: w["id"]),
               "knobs": knobs, "bugsOpen": bugs, "decisionTask": decision, "grades": grades, "cannotShow": self.cannot,
               "flags": self.flags}
        out = expand(self.a.out)
        try:
            with open(out, "w", encoding="utf-8") as f:
                f.write(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
        except OSError as e:
            raise Stop("cannot write --out %s: %s" % (out, e), 1)
        n = {m: sum(1 for e in entries if e["mode"] == m) for m in ("read", "escapes-only", "repairs-only")}
        say("span %s %s .. %s: %d read, %d escapes-only, %d repairs-only, %d friction item(s), %d open Watch(es), "
            "knobs %d land / %d revert / %d held, %d cannot-show -> %s" % (
                rid, fmt(since), fmt(until), n["read"], n["escapes-only"], n["repairs-only"],
                sum(len(e["friction"]) for e in entries), len(doc["watches"]), len(knobs["land"]),
                len(knobs["revert"]), len(knobs["held"]), len(self.cannot), out))
        return 0


# ---- the writers -------------------------------------------------------------------------------------------------

def grade_rollouts(span):
    """The rollouts an in-window grade episode lists (grades.py's episodes[].rollouts): where a grade miss ran, read in
    the span or not, so `watch` can name it."""
    grades = span.get("grades") if isinstance(span.get("grades"), dict) else {}
    eps = grades.get("episodes") if isinstance(grades.get("episodes"), list) else []
    return {r for e in eps if isinstance(e, dict) and e.get("inWindow") is True
            for r in (e.get("rollouts") if isinstance(e.get("rollouts"), list) else []) if isinstance(r, str)}


def norm_rollouts(values, span, graded=False):
    allowed = span_rollouts(span) | (grade_rollouts(span) if graded else set())
    out = []
    for v in values:
        try:
            s = RR.normalise_slug(v, "rollout")
        except RR.Refused as e:
            raise Stop(str(e), 2)
        if s not in allowed:
            raise Stop("rollout %s is not in the span (%s)" % (s, ", ".join(sorted(x for x in allowed if x)) or "none"), 2)
        if s not in out:
            out.append(s)
    return sorted(out)


def cmd_watch(a):
    span = read_span(a.span)
    rid = span["reflection"]
    rollouts = norm_rollouts(a.rollout, span, graded=True)
    rule, shape = a.rule.strip(), a.shape.strip()
    wid = RR.watch_id(rule, shape)
    lines = read_reflections()
    refuse_closed(lines, rid)
    mine = [d for d in lines if d.get("kind") == "watch" and d.get("id") == wid and d.get("reflection") == rid]
    fields = {"id": wid, "rule": rule, "shape": shape, "rollouts": rollouts, "count": a.count, "reflection": rid}
    if mine:
        have = sorted(x for x in mine[-1].get("rollouts") or [] if isinstance(x, str))
        if set(rollouts) == set(have):
            print("exists %s" % wid)
            return 0
        if set(rollouts) > set(have):
            write_line("watch", fields, a.dry_run)
            done(a, "extended %s: +%s" % (wid, ", ".join(sorted(set(rollouts) - set(have)))))
            return 0
        union = sorted(set(have) | set(rollouts))
        raise Stop("watch %s: Reflection %s's line names [%s]; this call names [%s]; one line per Watch names every "
                   "rollout: re-run naming [%s]" % (wid, rid, ", ".join(have), ", ".join(rollouts), ", ".join(union)), 2)
    write_line("watch", fields, a.dry_run)
    done(a, "watched %s (%s): %s" % (wid, ", ".join(rollouts), rule))
    return 0


def cmd_raised(a):
    lines = read_reflections()
    via = "confirmed" if a.confirmed else "declined" if a.declined else "recurring"
    ws = watches(lines, a.reflection)
    w = ws.get(a.watch)
    if w is None:
        raise Stop("no Watch %s in reflections.jsonl" % a.watch, 2)
    if not w["open"]:
        cb = w["closedBy"]
        if cb["reflection"] == a.reflection and cb["via"] == via:
            print("exists %s" % a.watch)
            return 0
        raise Stop("Watch %s was closed by Reflection %s (%s)" % (a.watch, cb["reflection"], cb["via"]), 2)
    if via == "recurring" and len(w["rollouts"]) < 2:
        raise Stop("Watch %s is seen in one rollout (%s): a plain raise needs two; use --confirmed or --declined"
                   % (a.watch, ", ".join(w["rollouts"])), 2)
    write_line("watch-raised", {"id": a.watch, "reflection": a.reflection, "via": via}, a.dry_run)
    done(a, "raised %s (%s)" % (a.watch, via))
    return 0


def bug_text(slug, title, why, rule, shape, key, rid, rollouts, fixes, captured):
    fm = ["---", "tags: [task, ai]", "status: open", "priority: normal", "projects: %s" % PROJECTS, "contexts: []",
          "captured: %s" % captured, "launch: cc-thread", "bug_key: %s" % key]
    if fixes:
        fm.append('fixes: ["[[%s]]"]' % fixes)
    fm.append("---")
    seen = ", ".join("[[%s]]" % r for r in rollouts)
    body = [
        "", "# %s" % title, "", "## Notes", "", why.strip(), "",
        "Seen in %s. Found by Reflection %s (rule: %s; shape: %s)." % (seen, rid, rule, shape), "",
        "## Launch", "", "- **Launch:** `cc-thread`", "- **MCP:** none", "",
        "## Resume prompt", "", "Paste into a fresh agent session:", "", "```",
        "You're picking up \"%s\", a bug the weekly Reflection filed." % title,
        "Launch: cc-thread",
        "Context: %s" % " ".join(why.split()),
        "Read first: ~/repos/obsidian/Work/Tasks/%s.md" % slug,
        "Next move: reproduce it against its rule (%s), then fix it" % rule,
        "```", "",
    ]
    return "\n".join(fm + body)


def cmd_bug(a):
    span = read_span(a.span)
    rid = span["reflection"]
    rollouts = norm_rollouts(a.rollout, span)
    rule, shape = a.rule.strip(), a.shape.strip()
    if not rule or not shape:
        raise Stop("--rule and --shape must not be empty", 2)
    if not SLUG_WORDS_RE.match(a.slug):
        raise Stop("--slug %s is not one to five kebab words ([a-z0-9]+ joined by -)" % a.slug, 2)
    bad = [w for w in a.slug.split("-") if w.startswith(("reflect", "call"))]
    if bad:
        raise Stop("--slug %s: the words %s are refused (start no word with reflect or call)" % (a.slug, ", ".join(bad)), 2)
    fixes = None
    if a.fixes:
        fixes = _wikilink_slug(a.fixes)
        if not fixes:
            raise Stop("--fixes %s names no task" % a.fixes, 2)
    key = RR.watch_id(rule, shape)
    lines = read_reflections()
    refuse_closed(lines, rid)
    prior = [d for d in lines if d.get("kind") == "proposal" and d.get("altitude") == "bug" and d.get("id") == key
             and d.get("reflection") == rid]
    if prior:
        p = prior[0]
        print("%s %s" % ("filed" if p.get("filed") else "exists", p.get("vaultTask")))
        return 0
    vault = Vault(a.tasks_dir)
    found = None
    for path, rec in vault.open_root_notes():
        if rec.scalar("bug_key") == key:
            found = (path, rec)
            break
    if found is not None:
        path, rec = found
        mine = ("Found by Reflection %s" % rid) in (read_note(path).section_text(NOTES_SECTION) if read_note(path) else "")
        filed, slug = mine, path.stem
        if not mine:
            print("exists %s" % slug)
    else:
        slug, filed = "thread-skill-bug-%s" % a.slug, True
    fields = {"id": key, "altitude": "bug", "reflection": rid, "rollouts": rollouts, "rule": rule, "shape": shape,
              "vaultTask": slug, "filed": filed}
    if filed:
        fields["auto"] = True
    if fixes:
        fields["fixes"] = fixes
    check_line("proposal", fields)  # before the file: a refused line never leaves a task behind
    if found is None:
        held = vault.taken(slug)
        if held is not None:
            raise Stop("path exists: %s (%s); choose other slug words" % (slug, status_of(held)), 2)
        zone()
        text = bug_text(slug, a.title.strip(), a.why, rule, shape, key, rid, rollouts, fixes, mdate(now_ms()))
        if not vault.root.is_dir():
            raise Stop("--tasks-dir %s is not a directory" % vault.root, 1)
        create(str(vault.root / ("%s.md" % slug)), text, a.dry_run)
    write_line("proposal", fields, a.dry_run)
    if filed:
        done(a, "filed %s" % slug)
    return 0


def landed_line(tunings, rid, repo, key, rule, direction, proposers):
    for d in tunings:
        if d["_voided"] or d.get("auto") is not True or d.get("reflection") != rid or isinstance(d.get("reverts"), str):
            continue
        if d["repo"].lower() != repo.lower() or d.get("rollout") not in proposers:
            continue
        for e in d.get("applied") or []:
            if isinstance(e, dict) and e.get("key") == key and e.get("rule") == rule and \
                    isinstance(e.get("to"), int) and isinstance(e.get("from"), int) and \
                    SCORE._sign(e["to"] - e["from"]) == direction:
                return d
    return None


def knob_lines(span, tunings):
    """The `proposal` lines (altitude knob) `knobs` writes for span's Reflection, in order: one per knob_key over the
    read rollouts' proposals, then one per entry of each revert tune.py wrote for it. close checks each is written."""
    rid = span["reflection"]
    knobs = span.get("knobs") or {}
    land = {x["id"]: x for x in knobs.get("land") or []}
    held = {}
    for x in knobs.get("held") or []:
        held.setdefault(x["id"], {})[x.get("rollout")] = x
    groups = {}
    for e in span["rollouts"]:
        if e.get("mode") != "read" or not e.get("repo"):
            continue
        for p in e.get("proposals") or []:
            if p.get("knob_key"):
                groups.setdefault(p["knob_key"], []).append((e, p))
    out = []
    for kid in sorted(groups):
        members = groups[kid]
        e0, p0 = members[0]
        newest = max(members, key=lambda m: Span.newest_key(m[0]))
        src = land.get(kid) or {"from": newest[1].get("from"), "to": newest[1].get("to"), "ranAt": newest[1].get("ranAt")}
        proposers = sorted({e["rollout"] for e, _p in members})
        fields = {"id": kid, "altitude": "knob", "reflection": rid, "rollouts": proposers, "repo": e0["repo"],
                  "key": p0["key"], "rule": p0["rule"], "direction": p0["direction"], "from": src["from"],
                  "to": src["to"], "ranAt": src["ranAt"]}
        hit = landed_line(tunings, rid, e0["repo"], p0["key"], p0["rule"], p0["direction"], proposers)
        if hit is not None:
            fields.update(landed=True, auto=True, tuning=hit["id"])
        else:
            fields["landed"] = False
            if kid in land:
                fields["held"] = "eligible: tune.py --auto was not run"
            else:
                mine = held.get(kid) or {}
                why = (mine.get(newest[0]["rollout"]) or next(iter(mine.values()), {})).get("reason")
                fields["held"] = str(why or "not in span's knobs: re-run span")[:300]
        out.append(fields)
    for d in tunings:
        if d["_voided"] or d.get("auto") is not True or d.get("reflection") != rid or not isinstance(d.get("reverts"), str):
            continue
        for e in d.get("applied") or []:
            if not isinstance(e, dict) or not all(isinstance(e.get(k), int) for k in ("from", "to", "ranAt")) or \
                    not isinstance(e.get("key"), str) or not isinstance(e.get("rule"), str):
                say("revert line %s: an applied entry is not well formed: skipped" % d.get("id"))
                continue
            direction = SCORE._sign(e["to"] - e["from"])
            out.append({"id": RR.knob_key(d["repo"], e["key"], e["rule"], direction), "altitude": "knob", "reflection": rid,
                        "rollouts": [d.get("rollout")], "repo": d["repo"], "key": e["key"], "rule": e["rule"],
                        "direction": direction, "from": e["from"], "to": e["to"], "ranAt": e["ranAt"], "landed": True,
                        "auto": True, "reverts": d["reverts"], "tuning": d["id"]})
    return out


def cmd_knobs(a):
    span = read_span(a.span)
    rid = span["reflection"]
    lines = read_reflections()
    refuse_closed(lines, rid)
    out = knob_lines(span, read_tunings())
    for f in out:
        try:
            RR.check(None, "proposal", None, f)
        except RR.Refused as e:
            raise Stop("the run record refused knob %s: %s: nothing written" % (f["id"], e), 2)
    have = {d.get("id") for d in lines if d.get("kind") == "proposal" and d.get("altitude") == "knob"
            and d.get("reflection") == rid}
    for f in out:
        state = "landed %s" % f["tuning"] if f.get("landed") else "held: %s" % f.get("held")
        if f["id"] in have:
            print("exists %s %s" % (f["id"], f["key"]))
            continue
        write_line("proposal", f, a.dry_run)
        have.add(f["id"])
        done(a, "knob %s %s %s -> %s %s" % (f["id"], f["key"], f["from"], f["to"], state))
    if not out:
        print("no knob proposals")
    return 0


# ---- decide --------------------------------------------------------------------------------------------------------

def resolve_tomorrow(now):
    argv = [sys.executable, RESOLVE_DAY_PY] + (["--now", now] if now else [])
    rc, so, se = run(argv, 30)
    if rc != 0 or not so.strip():
        raise Stop("resolve-day.py exited %s: %s" % (rc, first_line(se)), 3 if rc == 3 else 1)
    return so.split()[0]


def decision_text(slug, title, scheduled, captured):
    return "\n".join([
        "---", "tags: [task, ai, decisions]", "status: open", "priority: high", "projects: %s" % PROJECTS, "contexts: []",
        "scheduled: %s" % scheduled, "captured: %s" % captured, "launch: cc-thread", "---", "",
        "# %s" % title, "", "## Notes", "",
        "Conversation-gated: the weekly Reflection's rule proposals, Watches to confirm and held trades (a knob ADR 0037 "
        "d1 leaves to Lachy), decided by Lachy at the top of a run through `/thread:reflect --decide [[%s]]`, never "
        "during one (ADR 0037 d5). Never schedule or reshuffle it." % slug, "",
        "## Launch", "", "- **Launch:** `cc-thread`", "- **MCP:** none", "",
        "## Resume prompt", "", "Paste into a fresh agent session:", "", "```",
        "You're picking up \"%s\", the weekly Reflection's decision task." % title,
        "Launch: cc-thread",
        "Context: one ## Reflection <id> section per Reflection below, and ## Still open.",
        "Next move: /thread:reflect --decide [[%s]]" % slug,
        "```", "",
    ])


def listed_elsewhere(note, rid):
    """The Watch ids an earlier `## Reflection <id>` section (not this Reflection's) lists as rule items."""
    out, inside = set(), False
    for line in note._body.split("\n"):
        if line.startswith("## "):
            inside = line.strip().startswith("## Reflection ") and line.strip() != "## Reflection %s" % rid
            continue
        if inside:
            m = re.match(r"^- ([0-9a-f]{8}): ", line)
            if m:
                out.add(m.group(1))
    return out


def fold(text, cap=TRADE_TEXT_MAX):
    """A free-text field on one line: newlines and runs of whitespace folded to one space, cut to `cap`."""
    return " ".join(str(text or "").split())[:cap]


def held_trades(span, tunings):
    """(trades, skipped): the knobs knob_lines() holds as Lachy's call (ADR 0037 d1: its held reason is tune.py
    auto_check's trade or caution), one per knob id. A trade on a repo and key a revert line of this Reflection moved is
    skipped as (kid, from, key): the revert comes first, and that from is stale. Each trade carries the newest
    proposer's (Span.newest_key, knob_lines' pick) evidence and caution, folded."""
    lines = knob_lines(span, tunings)
    reverted = {(f["repo"].lower(), f["key"]) for f in lines if f.get("reverts")}
    newest = {}
    for e in span["rollouts"]:
        if e.get("mode") != "read" or not e.get("repo"):
            continue
        for p in e.get("proposals") or []:
            kid = p.get("knob_key")
            if kid and (kid not in newest or Span.newest_key(e) > Span.newest_key(newest[kid][0])):
                newest[kid] = (e, p)
    trades, skipped = [], []
    for f in lines:
        if f.get("landed") or f.get("reverts") or not TRADE_HELD_RE.match(str(f.get("held") or "")):
            continue
        if not isinstance(f.get("from"), int) or isinstance(f.get("from"), bool):
            say("knob %s %s: held as Lachy's call with from %r, no integer: not listed"
                % (f["id"], f["key"], f.get("from")))
            continue
        if (f["repo"].lower(), f["key"]) in reverted:
            skipped.append((f["id"], f["from"], f["key"]))
            continue
        e, p = newest.get(f["id"], ({}, {}))
        trades.append({"kid": f["id"], "from": f["from"], "to": f["to"], "key": f["key"], "rule": f["rule"],
                       "repo": f["repo"], "held": f["held"], "rollouts": f["rollouts"],
                       "newest": e.get("rollout") or f["rollouts"][-1],
                       "evidence": fold(p.get("evidence")), "caution": fold(p.get("caution"))})
    return trades, skipped


def trade_listings(vault):
    """One record per held-trade line of every decision task (thread-skill-decisions-<date>[-N].md tagged decisions,
    Work/Tasks and Archive alike): {slug, status, root, section, where, rid, kid, from}. where is item (a `- trade`
    line under `## Reflection <rid>`), moot (a `moot` line there) or still (a `## Still open` line, its rid read from
    the line); section is the rid of the `## Reflection` section a line sits under, else None. An item is moot when its
    slug and section hold a moot line for its (kid, from). A note with no frontmatter is skipped on stderr."""
    out = []
    if not vault.root.is_dir():
        return out
    for p in sorted(vault.root.rglob("thread-skill-decisions-*.md")):
        if not DECISION_SLUG_RE.match(p.stem):
            continue
        rec = RP.Rec(p, "")
        if rec.fm is None:
            say("skipped %s: no frontmatter (%s)" % (p.name, rec.err))
            continue
        if "decisions" not in rec.tags:
            continue
        base = {"slug": p.stem, "status": rec.status, "root": p.parent == vault.root}
        heading = None
        for line in rec.body.split("\n"):
            if line.startswith("## "):
                heading = line.strip()
                continue
            section = heading[len("## Reflection "):].strip() if heading and heading.startswith("## Reflection ") else None
            for where, regex, ok in (("item", TRADE_LINE_RE, section), ("moot", TRADE_MOOT_RE, section),
                                     ("still", TRADE_STILL_RE, heading == "## Still open")):
                m = regex.match(line) if ok else None
                if m:
                    out.append(dict(base, section=section, where=where, rid=m.group(3) if where == "still" else section,
                                    kid=m.group(1), **{"from": int(m.group(2))}))
                    break
    moots = {(r["slug"], r["section"], r["kid"], r["from"]) for r in out if r["where"] == "moot"}
    for r in out:
        r["moot"] = r["where"] == "item" and (r["slug"], r["section"], r["kid"], r["from"]) in moots
    return out


def trade_line(tr):
    """A new trade's item line in the decision task."""
    return "- trade %s at %s: %s %s -> %s (%s); %s%s; evidence %s; repo %s; rollouts %s; a yes runs /thread:reflect " \
           "[[%s]] and picks %s (%s)" % (
               tr["kid"], tr["from"], tr["key"], tr["from"], tr["to"], tr["rule"], tr["held"],
               "; caution %s" % tr["caution"] if tr["caution"] else "", tr["evidence"] or "not given", tr["repo"],
               ", ".join("[[%s]]" % r for r in tr["rollouts"]), tr["newest"], tr["key"], tr["rule"])


def cmd_decide(a):
    span = read_span(a.span)
    rid = span["reflection"]
    lines = read_reflections()
    refuse_closed(lines, rid)
    zone()
    until = _ts({"ts": span.get("until")})
    if until is None:
        raise Stop("--span %s has no until" % a.span, 2)
    ws = watches(lines, rid, until)
    decisions = {}
    if a.decisions:
        try:
            with open(expand(a.decisions), encoding="utf-8") as f:
                decisions = json.load(f)
        except (OSError, ValueError) as e:
            raise Stop("--decisions %s cannot be read as JSON: %s" % (a.decisions, e), 1)
        if not isinstance(decisions, dict):
            raise Stop("--decisions must be a JSON object {<watch id>: {why, amends}}", 2)
        for wid in decisions:
            w = ws.get(wid)
            if w is None or not w["recurring"]:
                why = "unknown" if w is None else "closed" if not w["open"] else "not recurring in Reflection %s" % rid
                raise Stop("--decisions names Watch %s, which is %s: only a recurring open Watch is a rule item" % (wid, why), 2)
    rules = sorted((w for w in ws.values() if w["recurring"]), key=lambda w: w["id"])
    confirm = sorted((w for w in ws.values() if w["open"] and w["sighted"] and len(w["rollouts"]) == 1
                      and not w["declinedBefore"]), key=lambda w: w["id"])
    trades, skipped = held_trades(span, read_tunings())
    for kid, frm, key in skipped:
        print("trade %s at %s: a revert of %s comes first this Reflection" % (kid, frm, key))
    vault = Vault(a.tasks_dir)
    new_trades, still_trades = [], []  # still: (trade, the open task that lists it)
    if trades:
        if not vault.root.is_dir():
            raise Stop("--tasks-dir %s is not a directory" % vault.root, 1)
        listings = [r for r in trade_listings(vault) if r["where"] == "item" and not r["moot"]]
        for tr in trades:
            rows = [r for r in listings if (r["kid"], r["from"]) == (tr["kid"], tr["from"])]
            decided = sorted(r["slug"] for r in rows if r["status"] in DECIDED)
            if decided:
                print("trade %s at %s: decided in [[%s]]" % (tr["kid"], tr["from"], decided[0]))
                continue
            open_ = sorted(r["slug"] for r in rows if r["root"] and r["status"] not in LANDED and r["section"] != rid)
            if open_:
                still_trades.append((tr, open_[0]))
            else:
                new_trades.append(tr)
    if not rules and not new_trades and not still_trades:
        print("no rule proposal or held trade: no decision task")
        return 0
    for w in rules:  # every rule line passes run_record before the task is touched
        check_line("proposal", {"id": w["id"], "altitude": "rule", "reflection": rid, "rollouts": w["rollouts"],
                                "rule": w["rule"], "shape": w["shape"], "vaultTask": "thread-skill-decisions"})
    now = a.now
    now_t = to_ms(now, "--now") if now else now_ms()
    if not vault.root.is_dir():
        raise Stop("--tasks-dir %s is not a directory" % vault.root, 1)
    existing = [(p, rec) for p, rec in vault.open_root_notes() if "decisions" in rec.tags]
    if len(existing) > 1:
        say("%d open decision tasks (%s): the first is used" % (len(existing), ", ".join(p.stem for p, _r in existing)))
    tomorrow = resolve_tomorrow(now)
    tmp = None
    if existing:
        path, created = existing[0][0], False
        work = path
    else:
        day = mdate(now_t)
        slug = None
        for n in range(1, DECISION_SUFFIX_MAX + 1):
            cand = "thread-skill-decisions-%s%s" % (day, "" if n == 1 else "-%d" % n)
            if vault.taken(cand) is None:
                slug = cand
                break
        if slug is None:
            raise Stop("thread-skill-decisions-%s through -%d are all taken: a fault, not a new day" % (day, DECISION_SUFFIX_MAX), 2)
        text = decision_text(slug, "Thread Skill: the weekly Reflection's decisions (%s)" % day, tomorrow, day)
        path = vault.root / ("%s.md" % slug)
        if a.dry_run:
            tmp = tempfile.mkdtemp(prefix="thread-reflect-decide-")
            work = Path(tmp) / path.name
            work.write_text(text, encoding="utf-8")
        else:
            create(str(path), text, False)
            work = path
        created = True
    note = read_note(work)
    if note is None:
        raise Stop("cannot read %s" % work, 1)
    if REC._status(note) in LANDED:
        raise Stop("%s is %s: a done task is never written" % (path.stem, REC._status(note)), 2)
    heading = "## Reflection %s" % rid
    fresh = not note.has_heading(heading)
    old = REC._scalar(note.get("scheduled")) or None
    moved = None
    if fresh and not created and old != tomorrow:
        note.set("scheduled", tomorrow)
        moved = old
    before = listed_elsewhere(note, rid)
    seen_until = mdate(until)
    new_items = [w for w in rules if w["id"] not in before]
    still = [w for w in rules if w["id"] in before]
    body = []  # the rule part, only beside a rule item: a task a held trade alone writes lists no Watch to confirm
    if rules:
        for w in new_items:
            d = decisions.get(w["id"]) or {}
            body.append("- %s: rule %s; shape %s; rollouts %s; why %s; amends %s" % (
                w["id"], w["rule"], w["shape"], ", ".join("[[%s]]" % r for r in w["rollouts"]),
                d.get("why") or "not given", d.get("amends") or "not given"))
        if confirm:
            if body:
                body.append("")
            body.append("Watches to confirm (one rollout each; a yes files the rule's grill, a no records the decline):")
            body.extend("- confirm %s: rule %s; shape %s; rollout [[%s]]" % (w["id"], w["rule"], w["shape"], w["rollouts"][0])
                        for w in confirm)
        if not new_items:
            lead = "No new rule items; still open: %s (see ## Still open)" % ", ".join(w["id"] for w in still)
            body = [lead] + ([""] + body if body else [])
    part = []  # the trade part
    if new_trades:
        part = [TRADE_LEAD] + [trade_line(tr) for tr in new_trades]
    elif still_trades:
        part = ["No new trades; still open: %s (see ## Still open)" % ", ".join(
            "trade %s at %s" % (tr["kid"], tr["from"]) for tr, _s in still_trades)]
    if body and part:
        body.append("")
    note.append_section(heading, "\n".join(body + part))
    for w in still:
        note.append_line("## Still open", "%s still open %s: Reflection %s, rollouts %s" % (
            w["id"], seen_until, rid, ", ".join("[[%s]]" % r for r in w["rollouts"])))
    for tr, lister in still_trades:
        note.append_line("## Still open", "trade %s at %s still open %s: Reflection %s, rollouts %s%s" % (
            tr["kid"], tr["from"], seen_until, rid, ", ".join("[[%s]]" % r for r in tr["rollouts"]),
            "" if lister == path.stem else "; listed in [[%s]]" % lister))
    try:
        note.save(dry_run=a.dry_run)
    except OSError as e:
        raise Stop("cannot write %s: %s" % (path, e), 1)
    if a.dry_run:
        print("would write %s:\n%s" % (path, note.render()))
    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)
    slug = path.stem
    have = {d.get("id") for d in lines if d.get("kind") == "proposal" and d.get("altitude") == "rule"
            and d.get("reflection") == rid}
    for w in rules:
        if w["id"] in have:
            continue
        write_line("proposal", {"id": w["id"], "altitude": "rule", "reflection": rid, "rollouts": w["rollouts"],
                                "rule": w["rule"], "shape": w["shape"], "vaultTask": slug}, a.dry_run)
    sched = REC._scalar(note.get("scheduled"))
    done(a, "decision task %s: scheduled %s%s (%s)" % (slug, sched, " (was %s)" % moved if moved else "",
                                                       "new" if created else "appended"))
    return 0


# ---- close -----------------------------------------------------------------------------------------------------------

def cmd_close(a):
    span = read_span(a.span)
    rid = span["reflection"]
    lines = read_reflections()
    if closed(lines, rid):
        raise Stop("Reflection %s is closed: a second close is refused" % rid, 2)
    until = _ts({"ts": span.get("until")})
    since = _ts({"ts": span.get("since")})
    if until is None or since is None:
        raise Stop("--span %s has no since or until" % a.span, 2)
    ws = watches(lines, rid, until)
    sighted = {d.get("id") for d in lines if d.get("kind") == "watch" and d.get("reflection") == rid}
    mine = [d for d in lines if d.get("kind") == "proposal" and d.get("reflection") == rid]

    def ids(pred):
        return {d.get("id") for d in mine if pred(d)}

    # every writer refuses a closed Reflection, so a step skipped now is lost for good: name it, write nothing
    missing = []
    tunings = read_tunings()
    unknobbed = sorted({f["id"] for f in knob_lines(span, tunings)} - ids(lambda d: d.get("altitude") == "knob"))
    if unknobbed:
        missing.append("knob %s ha%s no knob proposal line: run knobs" % (", ".join(unknobbed),
                                                                         "s" if len(unknobbed) == 1 else "ve"))
    ruled = ids(lambda d: d.get("altitude") == "rule")
    unruled = sorted(w["id"] for w in ws.values() if w["recurring"] and w["id"] not in ruled)
    if unruled:
        missing.append("Watch %s recur%s in this Reflection with no rule proposal line: run decide"
                       % (", ".join(unruled), "s" if len(unruled) == 1 else ""))
    # a held trade (ADR 0037 d1) needs a line from this Reflection in a decision task that is not dropped, unless a
    # done one already decided it; with no held trade close reads no vault
    trades, _skipped = held_trades(span, tunings)
    listed_in = set()
    if trades:
        vault = Vault(a.tasks_dir)
        if not vault.root.is_dir():
            raise Stop("--tasks-dir %s is not a directory" % vault.root, 1)
        listings = trade_listings(vault)
        unlisted = []
        for tr in trades:
            rows = [r for r in listings if (r["kid"], r["from"]) == (tr["kid"], tr["from"])]
            decided = any(r["where"] == "item" and not r["moot"] and r["status"] in DECIDED for r in rows)
            here = {r["slug"] for r in rows if r["status"] != "dropped" and r["rid"] == rid
                    and r["where"] in ("item", "still")}
            listed_in |= here
            if not decided and not here:
                unlisted.append("%s at %s" % (tr["kid"], tr["from"]))
        if unlisted:
            missing.append("held trade %s ha%s no decision task line from this Reflection: run decide"
                           % (", ".join(unlisted), "s" if len(unlisted) == 1 else "ve"))
    if missing:
        raise Stop("Reflection %s is not closed: %s" % (rid, "; ".join(missing)), 2)

    knob = [d for d in mine if d.get("altitude") == "knob"]
    breaches = set()
    for e in span["rollouts"]:
        if e.get("breachCounts"):
            for g in e.get("breached") or []:
                breaches.add((e.get("rollout"), g))
    counts = {
        "sightings": len(sighted),
        "newWatches": sum(1 for w in sighted if (ws.get(w) or {}).get("new")),
        "rules": len(ids(lambda d: d.get("altitude") == "rule")),
        "bugs": len(ids(lambda d: d.get("altitude") == "bug")),
        "filed": len(ids(lambda d: d.get("altitude") == "bug" and d.get("filed") is True)),
        "knobs": len({d.get("id") for d in knob if not d.get("reverts")}),
        "landed": len({d.get("id") for d in knob if not d.get("reverts") and d.get("landed") is True}),
        "reverted": len({d.get("id") for d in knob if d.get("reverts")}),
        "breaches": len(breaches),
    }
    quiet = counts["newWatches"] == 0 and counts["rules"] == 0 and counts["bugs"] == 0 and counts["breaches"] == 0
    read = sorted(e["rollout"] for e in span["rollouts"] if e.get("mode") == "read")
    only = sorted(e["rollout"] for e in span["rollouts"] if e.get("mode") == "escapes-only")
    repairs_only = sorted(e["rollout"] for e in span["rollouts"] if e.get("mode") == "repairs-only")
    fields = {"id": rid, "since": fmt(since), "until": fmt(until), "rollouts": read, "escapesOnly": only,
              "counts": counts, "quiet": quiet}
    if repairs_only:
        fields["repairsOnly"] = repairs_only
    task = next((d.get("vaultTask") for d in mine if d.get("altitude") == "rule" and d.get("vaultTask")), None)
    task = task or (sorted(listed_in)[0] if listed_in else None)
    if task:
        fields["decisionTask"] = task
    was, _ = RR.cadence(lines)
    fields["cadence"], _ = RR.cadence(lines + [{"kind": "reflection", "id": rid, "quiet": quiet}])
    write_line("reflection", fields, a.dry_run)
    done(a, "closed %s: %s, %s%s" % (rid, "quiet" if quiet else "not quiet",
                                     ", ".join("%s %d" % (k, v) for k, v in counts.items()),
                                     "; cadence %d -> %d" % (was, fields["cadence"]) if was != fields["cadence"] else ""))
    return 0


# ---- moot ------------------------------------------------------------------------------------------------------------

def cmd_moot(a):
    why = fold(a.why)
    if not why:
        raise Stop("--why must not be empty: say why the yes cannot apply", 2)
    vault = Vault(a.tasks_dir)
    if not vault.root.is_dir():
        raise Stop("--tasks-dir %s is not a directory" % vault.root, 1)
    path = vault.root / ("%s.md" % a.task)
    if not path.is_file():
        raise Stop("no note %s.md directly under %s" % (a.task, vault.root), 2)
    rec = RP.Rec(path, "root")
    if rec.fm is None or "decisions" not in rec.tags:
        raise Stop("[[%s]] is no decision task (%s)" % (
            a.task, "no frontmatter" if rec.fm is None else "its tags hold no decisions"), 2)
    if rec.status in LANDED:
        raise Stop("%s is %s: a done task is never written" % (a.task, rec.status), 2)
    mine = [r for r in trade_listings(vault) if r["slug"] == a.task and r["where"] == "item"
            and (r["kid"], r["from"]) == (a.trade, a.from_)]
    if not mine:
        raise Stop("[[%s]] lists no trade %s at %s" % (a.task, a.trade, a.from_), 2)
    open_ = [r for r in mine if not r["moot"]]
    if not open_:
        print("exists moot %s at %s in [[%s]]" % (a.trade, a.from_, a.task))
        return 0
    zone()
    day = mdate(to_ms(a.now, "--now") if a.now else now_ms())
    heading = "## Reflection %s" % open_[-1]["section"]
    note = read_note(path)
    if note is None:
        raise Stop("cannot read %s" % path, 1)
    note.append_line(heading, "moot %s at %s %s: %s" % (a.trade, a.from_, day, why))
    try:
        note.save(dry_run=a.dry_run)
    except OSError as e:
        raise Stop("cannot write %s: %s" % (path, e), 1)
    if a.dry_run:
        print("would write %s:\n%s" % (path, note.render()))
    done(a, "moot trade %s at %s in [[%s]] (%s)" % (a.trade, a.from_, a.task, heading))
    return 0


# ---- rung ------------------------------------------------------------------------------------------------------------

def cmd_rung(_a):
    try:
        ladder = LADDER.load()
    except LADDER.LadderError as e:
        path = LADDER.default_path()
        where = path if e.line is None else "%s:%d" % (path, e.line)
        sys.stderr.write("ladder: %s: %s\n" % (where, e.reason))
        return e.code
    rungs = ladder["rungs"]
    top = rungs[-1]
    opus = [r for r in rungs if r["model"] == "opus"]
    if not opus:
        raise Stop("the ladder (%s) has no opus rung: ADR 0037 d4 names Opus at xhigh" % ladder["source"], 2)
    r = opus[-1]
    print(json.dumps({"rung": r["name"], "model": "opus", "effort": r["effort"], "judge": r["judge"],
                      "review": r["review"], "top": top["name"], "topModel": top["model"]}))
    if top["model"] != "opus":
        sys.stderr.write("rung: the ladder's top rung %s is %s; ADR 0037 d4 names Opus\n" % (top["name"], top["model"]))
    if r["effort"] != "xhigh":
        sys.stderr.write("rung: %s's effort is %s; ADR 0037 d4 names xhigh\n" % (r["name"], r["effort"]))
    return 0


# ---- the CLI ---------------------------------------------------------------------------------------------------------

class Parser(argparse.ArgumentParser):
    def error(self, message):
        say(message)
        sys.exit(2)


def positive(v):
    try:
        n = int(v)
    except ValueError:
        raise argparse.ArgumentTypeError("%r is not an integer" % v)
    if n < 1:
        raise argparse.ArgumentTypeError("%r is not >= 1" % v)
    return n


def main(argv):
    p = Parser(prog="reflect.py", description="The weekly reading's script half (ADR 0037 d3-d5).")
    sub = p.add_subparsers(dest="verb", parser_class=Parser)
    s = sub.add_parser("span")
    s.add_argument("--since")
    s.add_argument("--until")
    s.add_argument("--fold", action="store_true")
    s.add_argument("--tasks-dir")
    s.add_argument("--config")
    s.add_argument("--out", required=True)
    w = sub.add_parser("watch")
    w.add_argument("--span", required=True)
    w.add_argument("--rollout", action="append", required=True)
    w.add_argument("--rule", required=True)
    w.add_argument("--shape", required=True)
    w.add_argument("--count", type=positive, required=True)
    w.add_argument("--dry-run", action="store_true")
    r = sub.add_parser("raised")
    r.add_argument("--watch", required=True)
    r.add_argument("--reflection", required=True)
    g = r.add_mutually_exclusive_group()
    g.add_argument("--confirmed", action="store_true")
    g.add_argument("--declined", action="store_true")
    r.add_argument("--dry-run", action="store_true")
    b = sub.add_parser("bug")
    b.add_argument("--span", required=True)
    b.add_argument("--rule", required=True)
    b.add_argument("--shape", required=True)
    b.add_argument("--slug", required=True)
    b.add_argument("--title", required=True)
    b.add_argument("--why", required=True)
    b.add_argument("--rollout", action="append", required=True)
    b.add_argument("--fixes")
    b.add_argument("--tasks-dir")
    b.add_argument("--dry-run", action="store_true")
    k = sub.add_parser("knobs")
    k.add_argument("--span", required=True)
    k.add_argument("--dry-run", action="store_true")
    d = sub.add_parser("decide")
    d.add_argument("--span", required=True)
    d.add_argument("--decisions")
    d.add_argument("--tasks-dir")
    d.add_argument("--now", help="tests only: an aware ISO-8601 instant")
    d.add_argument("--dry-run", action="store_true")
    c = sub.add_parser("close")
    c.add_argument("--span", required=True)
    c.add_argument("--tasks-dir")
    c.add_argument("--dry-run", action="store_true")
    m = sub.add_parser("moot")
    m.add_argument("--task", required=True)
    m.add_argument("--trade", required=True)
    m.add_argument("--from", dest="from_", type=int, required=True)
    m.add_argument("--why", required=True)
    m.add_argument("--tasks-dir")
    m.add_argument("--now", help="tests only: an aware ISO-8601 instant")
    m.add_argument("--dry-run", action="store_true")
    sub.add_parser("rung")
    a = p.parse_args(argv)
    verbs = {"span": lambda x: Span(x).run(), "watch": cmd_watch, "raised": cmd_raised, "bug": cmd_bug,
             "knobs": cmd_knobs, "decide": cmd_decide, "close": cmd_close, "moot": cmd_moot, "rung": cmd_rung}
    if a.verb not in verbs:
        p.error("a verb is required: %s" % ", ".join(verbs))
    try:
        return verbs[a.verb](a)
    except Stop as e:
        say(str(e))
        return e.code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
