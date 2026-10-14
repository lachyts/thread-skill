// A gate never holds an unattended rollout (ADR 0034, p18-2): the prose an LLM lead and planner follow.
//
// Pins, in skills/execute/SKILL.md: § 3.7's *Standing approval* (total exposure as the task's ceiling, never a target;
// credential and irreversible gates never pass; a gate it cannot price asks); § 4.5 step 1.2's Standing approval
// sub-step (first in the step, skipped under a pause, judged once per session key, before the turn's needs-you items,
// counted as launched); the halt guard (awaiting-sign-off goes to step 5's sign-off form; only an UNVERIFIED stops a
// cool-down); step 5's sign-off form (await-sign-off, no `status: done`, no retire, no archive move, a `not landed`
// waiting bullet with the dependants counted, why reconcile-project never misreads it, a phase-close follow-on's
// re-run commands on the live note path that a later full ceremony re-points, and no question tool); § 6.5's
// halted-turn exception and (e) exclusion; § 7's designed awaiting-sign-off stop and a stuck bullet with no gate
// reason; *Reinstate* under a sign-off pause. In skills/schedule/SKILL.md: § 3.6's sweep (the recall floor, never the
// verdict, every dismissal listed) and its ask-ahead, § 7's `## Decisions (asked ahead <date>)` section and its
// Planner line, the sanctioned exceptions, and § 0's sign-off sentence. In orient's reshuffle.md: R3's ask-ahead and
// R5.2's write. Status recommendation 8's sign-off clause, README and CONTEXT.md.
//
// Same shape as execute-signed-gate.test.mjs: every rule lives in one function, checkStanding(files), returning named
// failures, so the real text and the controls run through identical logic; each control mutates the real text in one
// place and must fail with exactly its rule. Reads files only. The scripts' behaviour is pinned by
// skills/execute/tests/reconcile-rollout-standing.test.sh and tests/gated-inputs.test.mjs (which also prices schedule's
// Planner example).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section } from '../lib/contract-text.mjs'

const real = {
  execute: read('skills/execute/SKILL.md'),
  schedule: read('skills/schedule/SKILL.md'),
  reshuffle: read('skills/orient/reshuffle.md'),
  status: read('skills/status/SKILL.md'),
  readme: read('README.md'),
  context: read('CONTEXT.md'),
}

const S0 = /^### 0\. /
const S36 = /^### 3\.6\. /
const S37 = /^### 3\.7\. /
const S45 = /^### 4\.5\. /
const S65 = /^### 6\.5\. /
const S7 = /^### 7\. /
const SCH7 = /^### 7\. /
const R3 = /^## R3\. /
const R5 = /^## R5\. /
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)
const lineOf = (text, prefix) => collapse(text.split('\n').find((l) => l.startsWith(prefix)) ?? '')

// A bold-labelled paragraph inside a section, to the next bold label at column 0, collapsed.
function labelled(text, sectionRe, label) {
  const lines = (section(text, sectionRe) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z`]/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}

function checkStanding(f) {
  const fails = []
  const s45raw = section(f.execute, S45) ?? ''
  const sub2 = collapse(s45raw.split('\n').find((l) => /^ {3}2\. \*\*/.test(l)) ?? '').trim()
  const guard = collapse(s45raw.split('\n').find((l) => /^ {3}5\. \*\*Halt guard/.test(l)) ?? '').trim()
  const step5 = collapse(s45raw.slice(Math.max(0, s45raw.indexOf('5. **Completion.**')), s45raw.indexOf('**Lost call.**')))
  const form = step5.slice(Math.max(0, step5.indexOf('**Completion awaiting sign-off (ADR 0034).**')))
  const ceremony = step5.slice(0, Math.max(0, step5.indexOf('**Completion awaiting sign-off (ADR 0034).**')))
  const standing = labelled(f.execute, S37, 'Standing approval (ADR 0034).')
  const reinstate = labelled(f.execute, S45, 'Reinstate (resuming a paused rollout).')
  const turn = labelled(f.execute, S65, 'The turn.')
  const items = labelled(f.execute, S65, 'Needs-you items.')
  const stuck7 = lineOf(section(f.execute, S7) ?? '', '- `next` reports `halt: stuck`')
  const signOff7 = lineOf(section(f.execute, S7) ?? '', '- `next` reports `halt: awaiting-sign-off`')
  const s36 = collapse(section(f.schedule, S36) ?? '')
  const sch7raw = section(f.schedule, SCH7) ?? ''
  const sch7 = collapse(sch7raw)
  const sch0 = collapse(section(f.schedule, S0) ?? '')
  const r3 = collapse(section(f.reshuffle, R3) ?? '')
  const r5 = collapse(section(f.reshuffle, R5) ?? '')

  // step12: the Standing approval opens step 1.2, before the seeded revises, skipped under a pause, judged once per
  // session key, run before the turn derives its needs-you items, and counted as "sub-step 2 launched".
  if (!sub2.startsWith('2. **Standing approval (ADR 0034), first.**') || !before(sub2, '**Standing approval', '**Seeded revises') ||
    !sub2.includes('Skip it when `paused` or `pauseRequested` is set. For each `setAside` entry with status `gate-pending`') ||
    !sub2.includes('whose key this session has not yet judged') || !sub2.includes("held for the session's life") ||
    !sub2.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py approve-gates --standing --tasks <slug> --rollout <rollout-note>`') ||
    !sub2.includes('it counts as "sub-step 2 launched"') ||
    !sub2.includes("Exit 3: the gates it left stay (a) items (§ 6.5), each with its `ASK:` reason as the item's `→` detail") ||
    !sub2.includes("It runs before this turn's needs-you items are derived from `next`, so a covered gate is never pushed")) {
    fails.push('step12')
  }

  // halt-guard: awaiting-sign-off goes to step 5's form; only an UNVERIFIED stops a cool-down; a gate never does.
  if (!guard.includes("`awaiting-sign-off` → step 5's *Completion awaiting sign-off* form") ||
    !guard.includes('and no UNVERIFIED task among the set-aside entries, ends the turn `waiting`') ||
    !guard.includes('A gate-pending task never stops a cool-down') || guard.includes('gated inputs await sign-off')) {
    fails.push('halt-guard')
  }

  // form: the sign-off form closes the run but leaves the rollout open and paused: await-sign-off, no done stamp, no
  // retire, no archive move; its waiting bullet carries `not landed`, the dependants are counted, not named, and its
  // rationale says why reconcile-project never misreads the log, now or once a later ceremony archives it. A phase-close
  // follow-on the form files points its re-run commands' `--rollout` at the live note (the form never moves it, so the
  // full ceremony's archive path would exit 1), and the full ceremony re-points them when it archives the note.
  if (!form.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py await-sign-off --rollout <rollout-note>`') ||
    !form.includes("It skips the `status: done` stamp, the Post-rollout follow-ons, the canary's `retire` and the archive move") ||
    !form.includes('`- [[<slug>]] not landed: awaiting your sign-off: <gate verbatim>`') ||
    !form.includes('`- and <n> queued task(s) that wait on them (named in ## Pause log): sign off, then /thread:execute [[<rollout>]]`') ||
    !form.includes('The dependants are counted, not named') || !form.includes('never reads this log') ||
    !form.includes('A later full ceremony archives the note') ||
    !form.includes('schedule picks up only `status: open` tasks, so an archived rollout would strand the gate-pending task') ||
    !form.includes("a follow-on filed or appended to here (*Failure*) points each re-run command's `--rollout` at the live `Work/Tasks/<rollout-slug>.md`, never the archive path, because this form never moves the note (a later full ceremony re-points it at the post-move path)") ||
    !ceremony.includes('The full ceremony (never the sign-off form below) also re-points at the post-move path every re-run command whose `--rollout` still names the live `Work/Tasks/<rollout-slug>.md`') ||
    !before(form, 'the phase close', 'await-sign-off --rollout') || !before(form, 'await-sign-off --rollout', '`/thread:close`')) {
    fails.push('form')
  }

  // question-tool: the form never calls it, live work or not; § 6.5's turn names the exception.
  if (!form.includes('**the sign-off form never calls the question tool**, live work or not') ||
    !form.includes('the turn ends on its `ROLLOUT-STATUS … state=halted reason="awaiting sign-off: [[<slug>]]"` line') ||
    !turn.includes("The sign-off form's halt is the one `halted` turn that never asks through the question tool (§ 4.5 step 5)") ||
    /may put the sign-off to Lachy through the question tool/.test(form)) {
    fails.push('question-tool')
  }

  // standing-37: § 3.7's paragraph: total exposure, the task's ceiling never a target, credential and irreversible
  // never pass, a gate it cannot price asks; the sign-off flow says a covered gate never reaches Lachy.
  if (!standing.includes('**total exposure**') || !standing.includes("it records the total exposure as the task's ceiling, never a target") ||
    !standing.includes('Credential and irreversible gates never pass under it') || !standing.includes('a gate it cannot price asks') ||
    !standing.includes('`(approved <date> under the standing approval: …)`') ||
    !collapse(section(f.execute, S37) ?? '').includes("A spend gate the standing approval covers never reaches you: step 1.2's *Standing approval* signs it before the turn derives its needs-you items (ADR 0034).")) {
    fails.push('standing-37')
  }

  // s7: § 7's awaiting-sign-off bullet is a designed stop with its reason, and the stuck bullet names no gate reason.
  if (!signOff7.includes('`reason="awaiting sign-off: [[task]]"` — a **designed** stop (ADR 0034), not a failure') ||
    !signOff7.includes("The halted turn lists each gate in the report's `Needs you:` block") ||
    !stuck7 || stuck7.includes('gated inputs await sign-off') || !stuck7.includes('the gate as an (a) item')) {
    fails.push('s7')
  }

  // reinstate: under `paused_for: sign-off`, the standing approval runs, then clear-pause; its exit 3 halts with both
  // stamps kept and no resume, loop, ceremony or heartbeat.
  if (!reinstate.includes('`paused_for: sign-off`') || !before(reinstate, 'approve-gates --standing', 'then `clear-pause`') ||
    !reinstate.includes('on its exit 3, print `[[<rollout>]] still awaiting sign-off:` with each `STILL-AWAITING` line') ||
    !reinstate.includes('leave both stamps, run no `resume`, loop, ceremony or heartbeat') ||
    !reinstate.includes('state=halted reason="awaiting sign-off: [[<slug>]]"')) {
    fails.push('reinstate')
  }

  // exclusion-e: (e) never doubles the sign-off halt's items, which are (a).
  if (!items.includes('not the awaiting-sign-off halt, whose items are (a)')) fails.push('exclusion-e')

  // schedule-sweep: § 3.6 runs the script; the output is the recall floor, never the verdict; a currency amount is never
  // dismissed; each dismissal is listed at step 8.
  if (!s36.includes('python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/gated_inputs.py sweep <note>...') ||
    !s36.includes('**The sweep is the recall floor, never the verdict**') ||
    !s36.includes('a currency amount, or a spend word about something the task buys or runs, is never dismissed') ||
    !s36.includes('step 8 lists each dismissal on one line (`swept, dismissed: [[task]] <word> (<why>)`)') ||
    !s36.includes('never a shell variable') || !collapse(f.schedule).includes('swept, dismissed: [[task-u]]')) {
    fails.push('schedule-sweep')
  }

  // ask-ahead: § 3.6 asks the total exposure against the standing approval (or says it is off), never re-asks a
  // recorded answer, and step 7 records it: the stamp above the standing approval, the Decisions section with both
  // lines (the Planner line's example and its per-item rule), and the sanctioned-exceptions sentence naming them.
  const planner = sch7raw.split('\n').find((l) => l.startsWith('- Planner:')) ?? ''
  if (!s36.includes('"standing approval off (built-in 0)"') || !s36.includes('is not asked again unless he changes it') ||
    !s36.includes('An answer above <t> is stamped at step 7 as `spend_approval_usd: <N>`') ||
    !sch7raw.includes('## Decisions (asked ahead <YYYY-MM-DD>)') ||
    !sch7raw.includes('- Spend: Lachy approved up to <N> USD total exposure for this task at /thread:schedule') ||
    !planner.includes('`spend: <what> — cap 50 USD per Login per month across 3 Logins`') ||
    !planner.includes('(never "every push" or "each image")') ||
    !sch7.includes('the § 3.6 ask-ahead answer: `spend_approval_usd: <N>` above the standing approval, the `## Decisions (asked ahead <date>)` section, and a credential or irreversible sign-off\'s `## Approved gates` bullet')) {
    fails.push('ask-ahead')
  }

  // reshuffle: R3 asks ahead in the grill; R5.2 writes the answer as schedule step 7 does.
  if (!r3.includes('**(c) gates asked ahead** (ADR 0034)') || !r3.includes("§ 3.6's ask-ahead question") ||
    !r5.includes('exactly as schedule step 7 does') || !r5.includes('`## Decisions (asked ahead <date>)`')) {
    fails.push('reshuffle')
  }

  // one-unfinished: a sign-off pause is still the repo's one unfinished rollout, and schedule and status name the path.
  if (!sch0.includes('A rollout awaiting sign-off (`paused_for: sign-off`') ||
    !sch0.includes('sign off, then `/thread:execute`, or `/thread:repair` to defer them') ||
    !collapse(f.status).includes('With `pausedFor: sign-off` → "sign off each waiting gate (or /thread:repair to defer), then /thread:execute [[<rollout>]]; until then it is this repo\'s one unfinished rollout"')) {
    fails.push('one-unfinished')
  }

  // docs: README and CONTEXT.md name the key; the Gated input entry sets the task aside, never the rollout.
  if (!collapse(f.readme).includes('sets `spend_approval_usd` (whole US dollars) under `[defaults]`') ||
    !collapse(f.readme).includes('pause the task for sign-off, never the rollout') ||
    !collapse(f.context).includes('Sets its task aside for sign-off, never the rollout (ADR 0008, ADR 0034).') ||
    !collapse(f.context).includes('the Rollout settings key `spend_approval_usd`')) {
    fails.push('docs')
  }
  return fails
}

test('execute, schedule, reshuffle, status, README and CONTEXT.md hold every standing-approval rule', () => {
  assert.deepEqual(checkStanding(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['step12', 'halt-guard', 'form', 'question-tool', 'standing-37', 's7', 'reinstate', 'exclusion-e',
  'schedule-sweep', 'ask-ahead', 'reshuffle', 'one-unfinished', 'docs']
const CONTROLLED = new Set()

function edit(text, from, to) {
  assert.ok(text.includes(from), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(from, to)
}
const only = (file, from, to, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(checkStanding({ ...real, [file]: edit(real[file], from, to) }), [rule], label)
}

test('control: the Standing approval after the seeded revises fails step12', () => {
  const l = real.execute.split('\n').find((x) => /^ {3}2\. \*\*Standing approval/.test(x))
  const sa = l.slice(0, l.indexOf(' **Seeded revises'))
  const rest = l.slice(l.indexOf('**Seeded revises'))
  CONTROLLED.add('step12')
  assert.deepEqual(checkStanding({ ...real, execute: real.execute.replace(l, `   2. ${rest} ${sa.replace(/^ {3}2\. /, '')}`) }), ['step12'])
  only('execute', 'it counts as "sub-step 2 launched", so', 'so', 'step12', 'not counted as launched')
})

test('control: a halt guard that sends awaiting-sign-off to § 7 fails halt-guard', () => {
  only('execute', "`awaiting-sign-off` → step 5's *Completion awaiting sign-off* form; ", '', 'halt-guard', 'no form route')
})

test('control: a waiting bullet without `not landed` fails form', () => {
  only('execute', '`- [[<slug>]] not landed: awaiting your sign-off: <gate verbatim>`', '`- [[<slug>]] awaiting your sign-off: <gate verbatim>`',
    'form', 'landing evidence')
  only('execute', "It skips the `status: done` stamp, the Post-rollout follow-ons, the canary's `retire` and the archive move",
    "It also stamps `status: done` and archives the note", 'form', 'archived')
})

test("control: a sign-off form whose phase-close follow-on uses the archive path, or a ceremony that never re-points it, fails form", () => {
  only('execute', "points each re-run command's `--rollout` at the live `Work/Tasks/<rollout-slug>.md`, never the archive path",
    "points each re-run command's `--rollout` at `Work/Tasks/Archive/Rollouts/<rollout-slug>.md`", 'form', 'archive path in the form')
  only('execute', ' The full ceremony (never the sign-off form below) also re-points at the post-move path every re-run command whose `--rollout` still names the live `Work/Tasks/<rollout-slug>.md` (the sign-off form writes them so), since the move below archives the note.',
    '', 'form', 'no re-point in the full ceremony')
})

test('control: a form that asks through the question tool fails question-tool', () => {
  only('execute', '**the sign-off form never calls the question tool**, live work or not',
    'the sign-off form may put the sign-off to Lachy through the question tool', 'question-tool', 'asks')
})

test('control: an exposure read as a target fails standing-37', () => {
  only('execute', "it records the total exposure as the task's ceiling, never a target", 'it records the total exposure as the budget to spend',
    'standing-37', 'a target')
})

test('control: an awaiting-sign-off stop read as a failure fails s7', () => {
  only('execute', '— a **designed** stop (ADR 0034), not a failure', '— a failure', 's7', 'not designed')
})

test('control: a reinstate that clears the pause before the standing approval fails reinstate', () => {
  only('execute', 'first runs `reconcile-rollout.py approve-gates --standing --tasks <slug> --rollout <rollout-note>` for each gate-pending task (a limit raised meanwhile, or a task stamp, now applies), then `clear-pause`',
    'first runs `clear-pause`, then `reconcile-rollout.py approve-gates --standing --tasks <slug> --rollout <rollout-note>` for each gate-pending task', 'reinstate', 'order')
})

test('control: (e) that also lists the sign-off halt fails exclusion-e', () => {
  only('execute', ' not the awaiting-sign-off halt, whose items are (a), §4.5 step 5;', '', 'exclusion-e', 'doubled')
})

test('control: § 3.6 dropping the dismissal listing fails schedule-sweep', () => {
  only('schedule', '- step 8 lists each dismissal on one line (`swept, dismissed: [[task]] <word> (<why>)`), so nothing drops silently;\n', '',
    'schedule-sweep', 'silent dismissals')
})

test('control: § 7 dropping the Planner line fails ask-ahead', () => {
  const l = real.schedule.split('\n').find((x) => x.startsWith('- Planner:'))
  only('schedule', l + '\n', '', 'ask-ahead', 'no Planner line')
})

test('control: R5.2 without the ask-ahead write fails reshuffle', () => {
  only('reshuffle', 'exactly as schedule step 7 does', 'as the task-writer prefers', 'reshuffle', 'no write')
})

test('control: schedule § 0 without the sign-off sentence fails one-unfinished', () => {
  only('schedule', 'A rollout awaiting sign-off (`paused_for: sign-off`', 'A rollout (`paused_for: sign-off`', 'one-unfinished', 'no § 0 sentence')
})

test('control: a README without the key fails docs', () => {
  only('readme', 'sets\n`spend_approval_usd` (whole US dollars) under `[defaults]`', 'sets it', 'docs', 'no README line')
})

test('the rules are all named (13) and each has a control', () => {
  assert.equal(RULES.length, 13)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
