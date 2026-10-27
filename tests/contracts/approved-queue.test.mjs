// The approved queue (p30-4; skills/_shared/vault-grammar.md § Approved queue): a queue Lachy approved with its gating
// PR is regenerated and started at the merge with no confirm, one undo line each. The script half is pinned by
// skills/execute/tests/reconcile-rollout-approved-queue.test.sh (the verbs, the verdict, the room-stop rule) and
// tests/unfinished-rollout.test.sh (C28, C29, K9, R6); this file pins the prose that wires it, one rule each:
//   grammar        vault-grammar § Approved queue names the key, writer, reader, members and project filter, "never
//                  carried", "only at the merge", the Integration wait, the room-stop rule, approved_unrun's readers and
//                  the windows; the script's ON_MERGE_KEY and ON_MERGE_REGENERATE equal the key and value.
//   route          execute § 4.5's **Approved queue** route: CronDelete before the schedule run, one turn with the agents
//                  in the foreground, `--regenerate --tasks <onMerge.members`, `Under the chain`, `stamp-start`,
//                  `state=done` and the halt reason; no AskUserQuestion, no plain-text ask, and no `paused:` but its own
//                  "writes no `paused:`" (R1's choice: the room stops are read through approved_unrun instead).
//   step15         the halt guard routes `superseded` (ends `state=done`, never § 7) and `regenerate`, and its `held`
//                  branch ends `waiting` on `waits: integration` or `waits: room-stop` (`approved queue waits:`).
//   room-stop-7    § Room stop item 7 says a room stop is no run mark on an approved queue.
//   lineage        *Cold resume* ends on a valued `superseded_by:`; heartbeat clause (1) stops on one; § 1 resolves an
//                  archived note; § 7's not-a-halt paragraph names the write-and-stamp.
//   relay          step 1.1 relays each `WARN: on_merge:` line, and an `onMerge` released is an (f) item.
//   invocation     § Invocation forms runs `approve-queue` and names its old-engine line.
//   i8             the I8 exception in execute § 2, status § 1 and repair § 1.
//   callers        orient § 9 and schedule step 8 run `approve-queue` on his words naming the PR.
//   chain          schedule's **Under the chain.** asks nothing, answers 1–9, answer 3 names approved_unrun and the room
//                  stops; no line of schedule pairs `--regenerate` with orient-all.
//   status         /thread:status names `onMerge`, `chainStart` and its **Approved queue, unstamped:** flag.
//   adr            ADR 0054's Decided for him names p30-4's rows 8 and 11.
//   guard          neither new verb is in reconcile-rollout.py's GUARD_EXEMPT.
//   rr-names       unfinished-rollout.py loads approved_unrun (RR_NAMES).
// check(files) returns the names of the failed rules; every rule has a mutation control. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section, slice } from '../lib/contract-text.mjs'

const real = {
  grammar: read('skills/_shared/vault-grammar.md'),
  execute: read('skills/execute/SKILL.md'),
  schedule: read('skills/schedule/SKILL.md'),
  status: read('skills/status/SKILL.md'),
  repair: read('skills/repair/SKILL.md'),
  orient: read('skills/orient/SKILL.md'),
  adr: read('docs/adr/0054-a-question-gate-before-every-ask.md'),
  rr: read('skills/execute/scripts/reconcile-rollout.py'),
  ur: read('skills/_shared/scripts/unfinished-rollout.py'),
}
// question-gate.test.mjs's plain-text ask, word for word.
const PLAIN_ASK = /(?<!\b(?:had|used) to )\b(?:and ask|ask (?:which|him|lachy|the user|in plain text|once)|asks? lachy for|confirm with the user|offer to create)\b/i
const C = (s) => collapse(s ?? '')
const para = (text, label) => C((text ?? '').split(/\n\s*\n/).find((p) => p.trimStart().startsWith(label)) ?? '')
const has = (text, wants) => wants.every((w) => text.includes(w))

function check(f) {
  const fails = []
  const fail = (name, ok) => { if (!ok && !fails.includes(name)) fails.push(name) }

  // grammar
  const aq = C(section(f.grammar, /^## Approved queue$/))
  const key = aq.match(/The key is `([a-z_]+): ([a-z]+)`/)
  const cst = (name) => (f.rr.match(new RegExp(`^${name} = "([^"]*)"$`, 'm')) ?? [])[1]
  fail('grammar', !!key && cst('ON_MERGE_KEY') === key[1] && cst('ON_MERGE_REGENERATE') === key[2] && has(aq, [
    '**Writer**', 'approve-queue', '**Reader**', '`reconcile-rollout.py next`', 'members', 'the project filter',
    '**Never carried.**', '**Fails closed, only at the merge.**', '`waits: integration`', 'a room stop is no run mark',
    'A room stop that stands makes the verdict wait', '`approved_unrun`', '`carry`', 'unfinished-rollout.py',
    'the I8 window', 'Two crashes in a row lose only the start intent']))

  // route
  const s45 = section(f.execute, /^### 4\.5\. /) ?? ''
  const routeRaw = slice(s45, /^\*\*Approved queue \(vault-grammar § Approved queue\)\.\*\*/, /^\*\*Cold resume\.\*\*/) ?? ''
  const route = C(routeRaw)
  const iDel = route.indexOf('`CronDelete`')
  const iRun = route.indexOf('/thread:schedule --regenerate --tasks <onMerge.members')
  fail('route', !!routeRaw && iDel >= 0 && iRun > iDel && has(route, ['one turn', 'in the foreground', 'Under the chain: [[<rollout>]], <pr> merged',
    '`stamp-start`', 'state=done reason="superseded by [[<new>]] when <pr> merged"',
    'reason="approved queue: regenerate stopped: <its stop line, double quotes as single>"', 'The route writes no `paused:`',
    '`approved_unrun`']) && !route.includes('AskUserQuestion') && !PLAIN_ASK.test(route) &&
    route.split('`paused:`').length === route.split('writes no `paused:`').length)

  // step15
  const guard = C((s45.split('\n').find((l) => /^ {3}5\. \*\*Halt guard/.test(l))) ?? '')
  fail('step15', has(guard, ['`superseded` →', 'nothing to run here; /thread:execute [[<supersededBy>]] runs its queue',
    'end the turn `state=done` with `reason="superseded by [[<supersededBy>]]"`, never § 7', '`regenerate` →',
    'the **Approved queue** route below', '`waits: integration` or `waits: room-stop`',
    'end the turn `waiting` with `reason="approved queue waits: <onMerge.why>"`, never § 7']))

  // room-stop-7
  const rs = section(f.execute, /^## Room stop/) ?? ''
  const it7 = C((rs.split('\n').find((l) => /^7\. \*\*Never\.\*\*/.test(l))) ?? '')
  fail('room-stop-7', it7.includes('On an approved queue a room stop is no run mark: its regenerate runs at the merge once the room stop has ended'))

  // lineage
  const cold = para(s45, '**Cold resume.**')
  const hb = f.execute.split('\n').find((l) => l.startsWith('> ROLLOUT-HEARTBEAT')) ?? ''
  const s1 = C(section(f.execute, /^### 1\. Read the rollout note/))
  const s7 = C(section(f.execute, /^### 7\. /))
  fail('lineage', cold.includes("Before `record-entry`, § 2.5, `verify_timeout` or `check-all`, read the note at its path") &&
    cold.includes("a valued `superseded_by:` ends the entry as step 1.5's `superseded` does") &&
    hb.includes('(or the rollout note is archived or carries `superseded_by:`)') &&
    s1.includes('else `Work/Tasks/Archive/Rollouts/<slug>.md`') && s7.includes("An approved queue's write-and-stamp is not a halt"))

  // relay
  const step11 = C((s45.split('\n').find((l) => /^ {3}1\. Run `python3/.test(l))) ?? '')
  const kindF = C((f.execute.split('\n').find((l) => l.startsWith('- (f) '))) ?? '')
  fail('relay', step11.includes('Each `WARN: on_merge:` line on its stderr') && step11.includes('an `onMerge` whose `action` is `released` is an (f) item') &&
    kindF.includes('`[[<rollout>]] approved queue released as a plain hold: <why>`'))

  // invocation
  const inv = C(section(f.execute, /^## Invocation forms/))
  fail('invocation', has(inv, ['`start [[<rollout>]] when <owner/repo>#<N> merges`', 'reconcile-rollout.py approve-queue --rollout <rollout-note> --pr <owner/repo>#<N>',
    "`invalid choice: 'approve-queue'`", "engine predates approved queues: /thread:schedule <project> --regenerate first, then approve the new note"]))

  // i8
  const s2 = C(section(f.execute, /^### 2\. Protocol-version gate/))
  fail('i8', s2.includes("an approved queue's I8 window") && C(f.status).includes("the chain's I8 window") && C(f.repair).includes("the chain's I8"))

  // callers
  const o9 = C(section(f.orient, /^### 9\. /))
  const s8 = C(section(f.schedule, /^### 8\. /))
  fail('callers', o9.includes('reconcile-rollout.py approve-queue --rollout <the note>') &&
    s8.includes('`reconcile-rollout.py approve-queue --rollout <this note> --pr <it>`'))

  // chain
  const chainRaw = f.schedule.split(/\n\s*\n/).find((p) => p.startsWith('**Under the chain.**')) ?? ''
  const nums = chainRaw.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => Number(l.split('.')[0]))
  const chain = C(chainRaw)
  fail('chain', chain.includes('so the run asks nothing') && JSON.stringify(nums) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9]) &&
    chain.includes('`approved_unrun`') && chain.includes("the Stage's room stops, each one ended") && !chain.includes('AskUserQuestion') &&
    !PLAIN_ASK.test(chain) && !f.schedule.split('\n').some((l) => l.includes('--regenerate') && /orient-all/.test(l)))

  // status
  const st = C(f.status)
  fail('status', st.includes('`onMerge`') && st.includes('`chainStart`') && /^- \*\*Approved queue, unstamped:\*\* /m.test(f.status) &&
    st.includes('ON_MERGE UNREADABLE: <why>'))

  // adr
  const dfh = C(section(f.adr, /^## Decided for him/))
  fail('adr', dfh.includes("p30-4's standalone schedule") && dfh.includes('row 8') && dfh.includes('row 11'))

  // guard
  const exempt = (f.rr.match(/^GUARD_EXEMPT = \(([^)]*)\)/m) ?? [])[1]
  fail('guard', exempt != null && !/approve-queue|stamp-start/.test(exempt) && f.rr.includes('sub.add_parser("approve-queue"') &&
    f.rr.includes('sub.add_parser("stamp-start"'))

  // rr-names
  const names = (f.ur.match(/^RR_NAMES = \(([\s\S]*?)\)/m) ?? [])[1] ?? ''
  fail('rr-names', names.includes('"approved_unrun"'))
  return fails
}

test('the approved queue is wired: the grammar, the route, the guard, the lineage, the callers, status and the ADR', () => {
  assert.deepEqual(check(real), [])
})

// ---- controls: each mutates one file in one place and must fail with exactly its rule --------------------------
function only(file, from, to, rule) {
  assert.ok(real[file].includes(from), `control setup: ${from.slice(0, 80)} not in ${file}`)
  assert.deepEqual(check({ ...real, [file]: real[file].replace(from, to) }), [rule])
}

test('control: a drifted key, or the room-stop rule dropped, fails grammar', () => {
  only('grammar', 'The key is `on_merge: regenerate`', 'The key is `on_merge: rebuild`', 'grammar')
  only('grammar', 'a room stop is no run mark', 'a room stop is a run mark', 'grammar')
  only('rr', 'ON_MERGE_REGENERATE = "regenerate"', 'ON_MERGE_REGENERATE = "rebuild"', 'grammar')
})

test('control: the route deleting the heartbeat late, asking, or stamping paused: fails route', () => {
  only('execute', '2. `CronList`, then `CronDelete` this rollout\'s `ROLLOUT-HEARTBEAT`, before the schedule run. ', '2. ', 'route')
  only('execute', '5. When schedule stopped anywhere: halt (§ 7)', '5. When schedule stopped anywhere: ask Lachy for a retry, else halt (§ 7)', 'route')
  only('execute', 'The route writes no `paused:`: the Stage', 'The route stamps `paused:` on this note first. The route writes no `paused:`: the Stage', 'route')
  only('execute', '`Under the chain: [[<rollout>]], <pr> merged`', '`Under orient-all`', 'route')
})

test('control: a superseded halt that goes to § 7, or a held clause dropped, fails step15', () => {
  only('execute', 'end the turn `state=done` with `reason="superseded by [[<supersededBy>]]"`, never § 7', 'go to § 7', 'step15')
  only('execute', 'First, a rollout entry with `waits: integration` or `waits: room-stop` is an approved queue\'s waiting verdict', 'First, nothing', 'step15')
})

test('control: § Room stop item 7 without its approved-queue sentence fails room-stop-7', () => {
  only('execute', ' On an approved queue a room stop is no run mark: its regenerate runs at the merge once the room stop has ended (vault-grammar § Approved queue).', '', 'room-stop-7')
})

test('control: a Cold resume, a heartbeat or a § 1 that misses the superseded note fails lineage', () => {
  only('execute', '(or the rollout note is archived or carries `superseded_by:`)', '(or the rollout note is archived)', 'lineage')
  only('execute', "a valued `superseded_by:` ends the entry as step 1.5's `superseded` does", 'a valued `superseded_by:` is ignored', 'lineage')
  only('execute', ', else `Work/Tasks/Archive/Rollouts/<slug>.md` (a rollout closed out there', ' (a rollout closed out there', 'lineage')
})

test('control: step 1.1 dropping the on_merge WARN, or (f) without the released item, fails relay', () => {
  only('execute', 'Each `WARN: on_merge:` line on its stderr', 'Each other stderr line', 'relay')
  only('execute', '`[[<rollout>]] approved queue released as a plain hold: <why>`', '`[[<rollout>]] released`', 'relay')
})

test('control: § Invocation forms without its old-engine line fails invocation', () => {
  only('execute', "`invalid choice: 'approve-queue'`", '`invalid choice`', 'invocation')
})

test('control: the I8 exception dropped from execute, status or repair fails i8', () => {
  only('execute', "One exception, an approved queue's I8 window", 'One more case', 'i8')
  only('status', "it is\n  the chain's I8 window instead", 'it is\n  the same instead', 'i8')
  only('repair', "it is the chain's I8", 'it is the same', 'i8')
})

test('control: orient § 9 or schedule step 8 without approve-queue fails callers', () => {
  only('orient', 'reconcile-rollout.py approve-queue --rollout <the note>', 'reconcile-rollout.py next --rollout <the note>', 'callers')
  only('schedule', '`reconcile-rollout.py approve-queue --rollout <this note> --pr <it>`', 'the bare stamp', 'callers')
})

test('control: a chain that asks, a tenth answer, or answer 3 without approved_unrun fails chain', () => {
  only('schedule', 'so the run asks nothing', 'so the run asks Lachy for the members', 'chain')
  only('schedule', '9. Step 8: no To-execute block', '9. Nothing else.\n10. Step 8: no To-execute block', 'chain')
  only('schedule', 'as never started (`approved_unrun`, vault-grammar § Approved queue)', 'as never started', 'chain')
})

test('control: status without chainStart or its flag fails status', () => {
  only('status', '- **Approved queue, unstamped:**', '- **Chain:**', 'status')
})

test('control: ADR 0054 without the rows 8 and 11 departure fails adr', () => {
  only('adr', "p30-4's standalone schedule", "The standalone schedule", 'adr')
})

test('control: a verb in GUARD_EXEMPT fails guard', () => {
  only('rr', 'GUARD_EXEMPT = ("status", "fold-journals")', 'GUARD_EXEMPT = ("status", "fold-journals", "approve-queue")', 'guard')
})

test('control: unfinished-rollout.py without approved_unrun in RR_NAMES fails rr-names', () => {
  only('ur', '"never_started", "approved_unrun", "incomplete"', '"never_started", "incomplete"', 'rr-names')
})
