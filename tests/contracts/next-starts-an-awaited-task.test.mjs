// A wait on a task nobody builds starts that task (thread-skill-p47-4, ADR 0082). On 7 Nov 2026 a paused rollout's
// "once the fix lands" closed a session while no session or rollout built the fix. next and close now read each task a
// wait names and start an unstarted one, decided and never asked:
//   w1  close step 2's **Tasks a wait names.**, after **Rollouts this session wrote.** and before **Repo state.**: its
//       sources (only this session's own waits under next's close for an unwritten process record, and no THREAD.md-
//       only rollout note either), the one `unfinished-rollout.py awaited` read, `unstarted` → sub-step 7.11 unless
//       held, its rows (no "start it" for a note schedule never takes) and its holds (his not yet carries as a held
//       wait, in THREAD.md and in a paused rollout's Pause log; a live session, save and a Leg read fresh).
//   w2  close step 4's Waits bullet, directly after its Rollout handovers bullet: the wording rule and the one held
//       form.
//   w3  close sub-step 7.11, directly after 7.10 and before § Commit hygiene: the one-task schedule (a join ranked
//       first, or a note handed to a fresh lead), decided, after 7.10, its rows, the held wait it writes in a paused
//       rollout's Pause log and the plain wait that lifts it, skipped under save and a Leg; step 8 names the wait rows;
//       § Under a Leg skips 7.11.
//   w4  next: step 1's bullet just before the own-branch bullet (the prepared-rollout bullet stays step 1's last, its
//       own test's p1), step 3's paragraph directly after the prepared rollout's, step 4's bullet directly after the
//       launch's (with what his not yet after a start undoes), step 5's paragraph directly after **A launch first.**,
//       the archive dispatch's opening exception naming it, the close dispatch reading only this session's own waits,
//       and its § Don't line.
//   w5  /thread:status renders an unstarted wait on a paused rollout and routes it to no repair.
//   w6  ADR 0082's sections and d1-d6, d4's not yet carried where the wait lives.
// One pure function, check(files), returns the failed rule names; every rule has a control that fails it alone, and
// every control asserts its swap changed the text. Phrase checks run on collapsed text. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { collapse, root, section, slice } from '../lib/contract-text.mjs'

const NEXT = 'skills/next/SKILL.md'
const CLOSE = 'skills/close/SKILL.md'
const STATUS = 'skills/status/SKILL.md'
const ADR = 'docs/adr/0082-a-wait-on-a-task-nobody-builds-starts-that-task.md'
const FILES = [NEXT, CLOSE, STATUS, ADR]

const readTree = () => Object.fromEntries(FILES.map((f) => {
  const p = path.join(root, f)
  return [f, fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null]
}))

const C = (s) => collapse(s ?? '')
const linesOf = (text) => (text ?? '').split('\n')
const at = (lines, re) => lines.findIndex((l) => re.test(l))
// The index of the next non-blank line after i (-1 when none).
const nextLine = (lines, i) => { for (let k = i + 1; k < lines.length; k++) if (lines[k].trim()) return k; return -1 }

const READ = '`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py awaited [--rollout <slug>]... [--task <task>]...`'

function check(F) {
  const fails = new Map()
  const flag = (rule, why) => { if (!fails.has(rule)) fails.set(rule, []); fails.get(rule).push(why) }
  const need = (rule, name, text, phrases) => {
    const t = C(text)
    for (const p of phrases) if (!t.includes(p)) flag(rule, `${name} lacks ${p}`)
  }
  const cl = F[CLOSE] ?? ''
  const cll = linesOf(cl)

  // w1: close step 2's bullet, between Rollouts this session wrote. and Repo state.
  const iRw = at(cll, /^ {3}- \*\*Rollouts this session wrote\.\*\*/)
  const iWait = at(cll, /^ {3}- \*\*Tasks a wait names\.\*\*/)
  const iRepo = at(cll, /^ {3}- \*\*Repo state\.\*\*/)
  if (!(iRw >= 0 && iRw < iWait && iWait < iRepo)) flag('w1', `close step 2's wait bullet is out of place (${iRw}, ${iWait}, ${iRepo})`)
  const wait = cll.slice(iWait, iRepo < 0 ? undefined : iRepo).join('\n')
  need('w1', "close step 2's **Tasks a wait names.**", wait, ['ADR 0082',
    "in the active THREAD.md's Where we are, Next steps or Resume instructions, as they stood before this session's first write to it",
    'a task it filed to unblock itself included', 'for each paused rollout this session leads or the active THREAD.md names',
    'A rollout note is never an awaited task here', READ,
    '`unstarted <task> (<Project>)` → sub-step 7.11 starts it, unless a hold applies (item 3)',
    '`scheduled … (paused)` → no start', '`waits on [[<task>]]: no note`', '`waits on: check failed (<first stderr line>)`',
    'It never blocks the close',
    '`waits on [[<task>]]: nothing is building it (held: <why>); say "start it" to schedule it`',
    '`(held: not yet)`. It carries: step 4 writes the held wait again', '`(held: <session> may be building it)`',
    'off the Stage this check is skipped', '`(held: /thread:open save)`', "`(held: a Leg's close)`", 'Those three are read fresh.',
    'A task this transcript already started',
    "Under `next`'s close for an unwritten process record (next step 5: another session holds the thread), only a wait this session's own work names is read",
    'for `held <task> (archived)`, `(not a task)` or `(a decisions task)` the row ends at `(held: <why>)`',
    'so it holds in every later session on this thread until he says "start it"',
    'for each paused rollout whose own read (`awaited --rollout <r>`, read-only) names the task, sub-step 7.11 appends the held wait to its `## Pause log`',
    'every later read of that rollout prints `held <task> (not yet)`'])
  const rwLead = cll[iRw] ?? ''
  need('w1', "close step 2's **Rollouts this session wrote.**", rwLead, [
    "Under `next`'s close for an unwritten process record (next step 5: another session holds the thread), a note only THREAD.md names is not checked"])

  // w2: close step 4's Waits bullet, directly after Rollout handovers.
  const s4 = linesOf(slice(cl, /^4\. \*\*Compute the thread-update diff/, /^5\. /))
  const iRoll = at(s4, /^ {3}- Rollout handovers:/), iWaits = at(s4, /^ {3}- Waits:/)
  if (iRoll < 0 || iWaits !== iRoll + 1) flag('w2', `close step 4's Waits bullet is not right after Rollout handovers (${iRoll}, ${iWaits})`)
  need('w2', "close step 4's Waits bullet", s4[iWaits], [
    'only when the read printed `scheduled` (not paused) or `building` for it, or sub-step 7.11 will start it',
    '`close starts [[<task>]] (see the step-8 row)`', 'otherwise write `[[<task>]] is filed, not started`', 'ADR 0082 d5',
    'one fixed form, `waits on [[<task>]] (held: <why>)`', 'reads `(held: not yet)` as that hold again, and any other `<why>` fresh'])

  // w3: close sub-step 7.11, step 8's rows and § Under a Leg.
  const i10 = at(cll, /^ {3}10\. \*\*Launch the unstarted rollout\*\*/), i11 = at(cll, /^ {3}11\. \*\*Start the awaited task\*\*/)
  const iHyg = cll.indexOf('### Commit hygiene (both repos)')
  if (!(i10 >= 0 && i11 === i10 + 1 && iHyg > i11)) flag('w3', `sub-step 7.11 is not directly after 7.10 and before § Commit hygiene (${i10}, ${i11}, ${iHyg})`)
  need('w3', 'close sub-step 7.11', cll[i11], ['`${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md` with `--tasks <task>`, a one-task schedule (ADR 0082 d2)',
    "joins the task's project's running rollout in place, ranked first (ADR 0078 d6)", 'whose step 8 hands it to a fresh lead (ADR 0057)',
    'Decided, never asked (Owner *gate*', 'It runs after 7.10 and before step 8\'s report',
    '`waits on [[<task>]]: joined [[<rollout>]] (ranked first)`', '`waits on [[<task>]]: scheduled as [[<rollout>]], handed to a fresh lead`',
    "`waits on [[<task>]]: not started (<schedule's line>)`", 'Skipped under `/thread:open save` and under a Leg',
    "its held wait goes inside that rollout's `## Pause log`", '`- <ISO stamp> waits on [[<task>]] (held: not yet)`',
    'appends `- <ISO stamp> waits on [[<task>]]` there before its schedule', 'so the plain line lifts the hold'])
  const s8 = cll[at(cll, /^8\. \*\*Print the "What landed" report/)] ?? ''
  need('w3', 'close step 8', s8, ["the wait rows from step 2's **Tasks a wait names.** and sub-step 7.11",
    '`waits on [[<task>]]: joined [[<rollout>]] (ranked first)`', '`waits on [[<task>]]: its rollout [[<rollout>]] is paused`'])
  need('w3', 'close § Under a Leg', section(cl, /^## Under a Leg$/), ["Sub-step 7.11 is skipped too: a Leg's close starts no awaited task"])

  // w4: next.
  const nx = F[NEXT] ?? ''
  const s1 = linesOf(slice(nx, /^1\. \*\*Read the situation/, /^2\. /))
  const iTask = at(s1, /^\s*- \*\*A task a wait names, not started\*\*/), iOwn = at(s1, /^\s*- \*\*This session's own branch\*\*/)
  if (iTask < 0 || iOwn !== iTask + 1) flag('w4', `next step 1's wait bullet is not just before the own-branch bullet (${iTask}, ${iOwn})`)
  need('w4', "next step 1's wait bullet", s1[iTask], ["read exactly as close step 2's **Tasks a wait names.** reads it",
    'its one read-only `unfinished-rollout.py awaited` run (it writes nothing)', 'Only `unstarted <task> (<Project>)` with no hold counts',
    "While another session holds the thread, only a wait this session's own work names is checked here."])
  const s3 = linesOf(slice(nx, /^3\. \*\*Recommend ONE move/, /^4\. /))
  const iFirst = at(s3, /^\s*\*\*A rollout prepared, not started, starts first\.\*\*/), iStart = at(s3, /^\s*\*\*A task a wait names starts too\.\*\*/)
  if (iFirst < 0 || iStart !== nextLine(s3, iFirst)) flag('w4', `next step 3's paragraph is not right after the prepared rollout's (${iFirst}, ${iStart})`)
  need('w4', "next step 3's paragraph", s3[iStart], ['decided and never asked (Owner *gate*', 'ADR 0082',
    "step 5 runs it after any launch, then this session's own move, recommended as if nothing waited, in the same turn",
    'A held task gets no start'])
  const s4n = linesOf(slice(nx, /^4\. /, /^5\. /))
  const iLaunch = at(s4n, /^\s*- \*\*The launch, first in the line\.\*\*/), iWl = at(s4n, /^\s*- \*\*A started wait, in the line\.\*\*/)
  if (iLaunch < 0 || iWl !== iLaunch + 1) flag('w4', `next step 4's wait bullet is not right after the launch's (${iLaunch}, ${iWl})`)
  need('w4', "next step 4's wait bullet", s4n[iWl], ['`Next move: start [[<task>]], then <move>, because <the work> waits on it and nothing builds it, and <reason>.`',
    '`/thread:schedule --tasks <task> takes it; say "not yet" to hold it.`',
    'His "not yet" after the start undoes it the way it went: a new note\'s launch is withdrawn as a launch\'s is, and a join is deferred out of its rollout by `/thread:repair [[<rollout>]]` (its § 5)',
    '`[[<task>]] is filed, not started (<the hold>); say "start it" to schedule it.`',
    'a task is coming ("once [[<task>]] lands") only when step 1\'s read printed `scheduled` (not paused) or `building` for it, or step 5 starts it',
    'ADR 0082 d5', 'just before the menu'])
  const s5 = linesOf(slice(nx, /^5\. \*\*Dispatch\.\*\*/, /^## /))
  const iLF = at(s5, /^\s*\*\*A launch first\.\*\*/), iSA = at(s5, /^\s*\*\*A start, after the launches\.\*\*/)
  if (iLF < 0 || iSA !== nextLine(s5, iLF)) flag('w4', `next step 5's paragraph is not right after **A launch first.** (${iLF}, ${iSA})`)
  need('w4', "next step 5's paragraph", s5[iSA], ['`${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md` with `--tasks <task>`, exactly as close sub-step 7.11 runs it',
    "Its output never ends the turn: `next` then dispatches this session's own move",
    'close step 2 reads the task as started by this transcript, so close starts nothing more',
    'When the move is not clear, the start runs before the menu is asked'])
  need('w4', "next step 5's archive dispatch", s5[at(s5, /^\s*\*\*Archive this session, dispatched\.\*\*/)], [
    'Apart from **A launch first.** and **A start, after the launches.**, which run before it and are no part of this move, write nothing'])
  need('w4', "next step 5's close dispatch", s5[at(s5, /^\s*\*\*Close for an unwritten process record, dispatched\.\*\*/)], [
    "**Tasks a wait names.** reads only a wait this session's own work names",
    '**Rollouts this session wrote.** checks no note only THREAD.md names'])
  need('w4', "next § Don't", slice(nx, /^## Don't/, null), ["- Don't end a session with a wait on a task nothing builds (step 1)",
    'is never put to him as a question', 'no line says a task is coming unless something builds it'])

  // w5: status.
  need('w5', 'status **Waits on a task nobody builds:**', slice(F[STATUS] ?? '', /^- \*\*Waits on a task nobody builds:\*\*/, /^- \*\*/), [
    'only while `paused` is set', '`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/unfinished-rollout.py awaited --rollout <slug>`',
    '`WAITS ON [[<task>]]: nothing is building it (<Project>)`', 'it is never drift and status routes it to no repair',
    'It reads only the vault, so it holds offline too.'])

  // w6: ADR 0082.
  const adr = F[ADR] ?? ''
  for (const hd of ['## Context', '## Decision', '## Decided for him (overturnable)', '## Considered options', '## Consequences']) {
    if (!linesOf(adr).includes(hd)) flag('w6', `ADR 0082 has no ${hd}`)
  }
  need('w6', 'ADR 0082 Status', slice(adr, /^Status:/, /^\s*$/), ['thread-skill-p47-4-paused-rollout-waits-on-an-unstarted-task'])
  need('w6', 'ADR 0082 § Decision', section(adr, /^## Decision$/), ['**d1. One read says what builds each awaited task.**',
    '**d2. Close starts an unstarted one.**', '**d3. `next` starts it first, as it launches a prepared rollout.**', '**d4. The holds.**',
    '**d5. The wording rule.**', '**d6. Status shows the gap.**', 'It carries where the wait lives.',
    "close sub-step 7.11 also appends the held wait to that rollout's `## Pause log`"])

  return { rules: [...fails.keys()].sort(), details: [...fails.values()].flat() }
}

const real = readTree()

// A control's copy of `real` with `from` replaced by `to` in `file`, asserting the replacement happened.
function swap(file, from, to) {
  const text = (real[file] ?? '').replace(from, to)
  assert.notEqual(text, real[file], `control is vacuous: ${from} not found in ${file}`)
  return { ...real, [file]: text }
}
const only = (files, rule, label) => assert.deepEqual(check(files).rules, [rule], `control ${label}: ${JSON.stringify(check(files).details)}`)

test('next, close and status start or show a wait on a task nobody builds (ADR 0082)', () => {
  const { rules, details } = check(real)
  assert.deepEqual(rules, [], details.join('\n'))
})

test('controls: each rule fails alone', () => {
  only(swap(CLOSE, '→ sub-step 7.11 starts it, unless a hold applies (item 3)', '→ the `waits on` row'), 'w1', 'no start')
  only(swap(CLOSE, '`(held: not yet)`. It carries: step 4 writes the held wait again', '`(held: not yet)`.'), 'w1', 'not yet does not carry')
  only(swap(CLOSE, ', sub-step 7.11 appends the held wait to its `## Pause log`', ', nothing records it'), 'w1', 'not yet carried only by THREAD.md')
  only(swap(CLOSE, 'only a wait this session\'s own work names is read, as next step 1 reads it', 'every wait is read'), 'w1', 'close reads the other session\'s waits')
  only(swap(CLOSE, 'a note only THREAD.md names is not checked, as next step 1 does not check it', 'every note is checked'), 'w1', 'close checks the other session\'s rollout')
  only(swap(CLOSE, 'or `(a decisions task)` the row ends at `(held: <why>)`', 'or `(a decisions task)` the row is the same'), 'w1', 'start it offered for a note schedule never takes')
  only(swap(CLOSE, 'or sub-step 7.11 will start it', 'or it is filed'), 'w2', 'once-it-lands wording for a filed task')
  only(swap(CLOSE, 'Decided, never asked (Owner *gate*', 'Ask him first (Owner *yours*'), 'w3', '7.11 asks')
  only(swap(CLOSE, "Sub-step 7.11 is skipped too: a Leg's close starts no awaited task", 'Sub-step 7.11 runs'), 'w3', 'a Leg starts tasks')
  only(swap(CLOSE, 'so the plain line lifts the hold', 'so the hold stands'), 'w3', 'start it never lifts the Pause log hold')
  // Anchored on the start's own sentence before it: **A launch first.** opens the same "Its output never ends the turn".
  only(swap(NEXT, "since the line says it. Its output never ends the turn: `next` then dispatches this session's own move", 'since the line says it. Its output ends the turn'), 'w4', 'start ends the turn')
  only(swap(NEXT, 'decided and never asked (Owner *gate*: the work is technical', 'offered to him (Owner *yours*: the work is technical'), 'w4', 'start offered')
  only(swap(NEXT, 'and a join is deferred out of its rollout by `/thread:repair [[<rollout>]]` (its § 5)', 'and a join stays'), 'w4', 'a not yet after a join undoes nothing')
  only(swap(NEXT, '**Tasks a wait names.** reads only a wait this session\'s own work names', '**Tasks a wait names.** reads every wait'), 'w4', 'close dispatch reads the other session\'s waits')
  only(swap(NEXT, 'Apart from **A launch first.** and **A start, after the launches.**, which run before it and are no part of this move, write nothing', 'Apart from **A launch first.**, write nothing'), 'w4', 'archive dispatch forgets the start')
  only(swap(STATUS, 'it is never drift and status routes it to no repair', 'it is drift, routed to /thread:repair'), 'w5', 'routed to repair')
  only(swap(ADR, '**d5. The wording rule.**', '**d5. Wording.**'), 'w6', 'ADR d5')
  only(swap(ADR, 'It carries where the wait lives.', 'It carries in THREAD.md.'), 'w6', 'ADR d4 not yet only in THREAD.md')
})
