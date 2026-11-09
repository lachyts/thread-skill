// A stuck rollout holds only what it waits on (ADR 0060, p33-2). The behaviour is pinned by tests/unfinished-rollout.test.sh
// X1-X16, WL11 and WL12, tests/leg.test.sh L14 and skills/execute/tests/reconcile-rollout-origin-lane.test.sh L21-L23; this
// pins the prose each reader follows, one rule per piece:
//   context   CONTEXT.md **Unfinished rollout** says a stuck chain holds only its unlanded rows' surfaces, a waiting
//             parallel rollout holds no Project root against serial chains, and each reclaims on resume and waits its
//             turn; **Surface** points at it; P41-3's S1, S2 and S3 (a surface wait's idle release, the legacy reader
//             rule, the unanswered window) and the **Origin lane** entry's surface-wait holder rule
//   adr       ADR 0060 exists, accepted, with its five decisions, the deadlock argument and its Limits; ADRs 0040, 0048
//             and 0059 each carry an "Amended by ADR 0060" line; ADR 0060 carries S1, S2 and S3, unfinished-rollout.py
//             S1, and ADR 0064 d5 the P41-3 amendment (O1)
//   execute   execute § 4.5's *Surface re-check (ADR 0060)* paragraph: every loop entry, right after the canary's
//             check-all and still before resume, clear-pause, next or any stamp (the *Landing-register re-check* names it
//             next), the check's --resume --surface-wait --running form, exit 3 or 4 a surface wait (never § 7), exit 5
//             and exit 2 halting; § 7 lists the halt and says a surface wait is none, *Whole-rollout halts kept* keeps it;
//             step 1.2, *Lost call* and step 3's *Surface wait at Integration* hold under it (P41-3)
//   legs      legs.md § Begin's exit 3: a begin wait (`waiting`, no create_thread; a needs-you item only when `listed`
//             is false, a standing Leg session keeping it off the Waiting list, P41-3; with `listed` true, held or
//             unanswered alike, it ends its session, no poll, P44-3) and a failed re-check (listed, `halted`)
//   status    status § 5's **Hold** block, S12's "holds only", the restart's `surface held by` blocker and § 4's Hold
//             line from `unfinished-rollout.py hold`
//   repair    repair § 7 (e) step 1's `surface held by` branch (never restart) and its `surface re-check unanswered`
//             branch (restart it, P41-3), (b)'s reclaim note and the refusal section's released case
//   schedule  schedule § 0's parallel-path prose (a chain's hold, a stuck chain's released place a WARN, not a refusal),
//             S3's stuck-chain note (a surface wait's idle release included, P41-3) and S7's amended closing line, and
//             the serial template's legend
// check() returns named failures, so the real text and each control run through identical logic. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read } from '../lib/contract-text.mjs'

const FILES = {
  context: read('CONTEXT.md'),
  adr60: read('docs/adr/0060-a-stuck-rollout-holds-only-what-it-waits-on.md'),
  adr40: read('docs/adr/0040-a-rollout-is-parallel-or-serial.md'),
  adr48: read('docs/adr/0048-no-single-cause-holds-the-whole-queue.md'),
  adr59: read('docs/adr/0059-vault-chains-claim-their-own-project-places.md'),
  adr64: read('docs/adr/0064-two-projects-parallel-rollouts-share-a-repo.md'),
  ur: read('skills/_shared/scripts/unfinished-rollout.py'),
  execute: read('skills/execute/SKILL.md'),
  legs: read('skills/execute/legs.md'),
  status: read('skills/status/SKILL.md'),
  repair: read('skills/repair/SKILL.md'),
  schedule: read('skills/schedule/SKILL.md'),
  template: read('skills/schedule/serial-rollout-template.md'),
}

// The slice of `text` from the line matching `start` to the next line matching `stop` (exclusive), or ''.
function section(text, start, stop) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => start.test(l))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && stop.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}
const all = (text, keys) => keys.every((k) => text.includes(k))
// P41-3's verbatim sentences (CONTEXT, ADR 0060; S1 also in unfinished-rollout.py's docstring) and ADR 0064 d5's O1.
const S1 = 'A parallel rollout idle in a surface wait (no call in flight that its marker lists, no task integrating) holds no Project root against serial chains that read the marker: it launches nothing until its own Surface re-check passes, so no cycle forms.'
const S2 = 'A serial chain stamped with an engine snapshot from before P41-3 keeps it until one of its Legs closes `stopped:` (ADR 0043\'s move rule), and reads no surface-wait marker meanwhile: every serial resume read of such a chain (begin\'s re-check, `check --resume`, the Waiting list) reads each parallel rollout by the old rule, never the marker\'s release. So while such a chain reaches a parallel rollout\'s Project root, that rollout\'s Surface re-check halts on a refusal as it did before (exit 5, `surface held: …`, § 7) instead of waiting, and the old rule skips a halted, idle rollout: no cycle forms.'
const S3 = 'the Waiting list then holds a chain on an engine snapshot from before P41-3 that reaches it'
const ORIGIN_SW = 'and, in a **Surface wait**, only while that task\'s Integration has begun (`integrating:`)'
const O1 = 'nor does a holder or a waiter count while a surface-wait marker stands on its rollout'

function check(f) {
  const fails = []
  const fail = (rule, bad) => { if (bad && !fails.includes(rule)) fails.push(rule) }

  // context
  const unfinished = collapse(section(f.context, /^- \*\*Unfinished rollout\*\*/, /^- \*\*/))
  const surface = collapse(section(f.context, /^- \*\*Surface\*\*/, /^- \*\*/))
  fail('context', !all(unfinished, ["A stuck chain (no Leg open, nothing claimable: every unlanded row set aside or held behind one) holds only its unlanded rows' surfaces",
    'A parallel rollout awaiting sign-off, or halted with nothing able to start, holds no Project root against serial chains',
    'Each reclaims its whole claim on resume, and waits its turn for a place another rollout took meanwhile', '(ADR 0060)']) ||
    !surface.includes("A stuck chain holds only its unlanded rows' surfaces (**Unfinished rollout**, ADR 0060)") ||
    !all(collapse(f.context), [S1, S2, S3]) ||
    !collapse(section(f.context, /^- \*\*Origin lane\*\*/, /^- \*\*/)).includes(ORIGIN_SW))

  // adr
  const a60 = collapse(f.adr60)
  fail('adr', !/^Status: accepted\./m.test(f.adr60) ||
    !['1. **What a stuck chain is.**', '2. **What a stuck chain still holds.**', '3. **Reclaim on resume, and why there is no deadlock.**',
      '4. **Parallel release.**', '5. **What a released parallel rollout gives up.**'].every((d) => a60.includes(d)) ||
    !a60.includes('The asymmetric rule makes whoever released a place yield it.') || !a60.includes('- **Limits.**') ||
    ![f.adr40, f.adr48, f.adr59].every((t) => t.includes('Amended by ADR 0060')) ||
    !all(a60, [S1, S2, S3]) || !collapse(f.ur).includes(S1) || !collapse(f.adr64).includes(O1))

  // execute
  const ex = f.execute.split('\n')
  const recheck = collapse(ex.find((l) => l.startsWith('**Surface re-check (ADR 0060).**')) ?? '')
  const landing = collapse(ex.find((l) => l.startsWith('**Landing-register re-check.**')) ?? '')
  const s7raw = section(f.execute, /^### 7\. /, /^### 8\. /)
  const kept = collapse(section(s7raw, /^\*\*Whole-rollout halts kept \(ADR 0048\)\.\*\*/, /^The end-of-run verdicts/))
  const exAll = collapse(f.execute)
  fail('execute', !landing.includes("goes on. The *Surface re-check* below comes next.") ||
    !all(recheck, ['Every entry into this loop', "right after the canary's `check-all`", 'still before `resume`, `clear-pause`, `next` or any stamp',
    'unfinished-rollout.py check --shape parallel --repo <repoPath> --resume <rollout-slug>', "unlanded rows' surfaces, never a chain's whole claim",
    'Exit 3 (`refuse <chains>`)', 'halt with `reason="surface held: [[<chain>]] writes <token>"` (§ 7)', 'Exit 2: print its line and halt with `reason="surface re-check failed"`',
    // P41-3: exit 3 or 4 is a surface wait, never § 7; a legacy chain's exit 5 halts as before
    'Exit 3 (`refuse <chains>`) or exit 4 (`unanswered`): a surface wait, never § 7.', '`waiting reason="surface wait: <surfaceWait.why>"`',
    'Only calls in flight and an Integration already begun go on', '--surface-wait --running', 'A pause still wins',
    'Exit 5 (`refuse <chains>` and a `legacy:` line)']) ||
    !all(exAll, ['engine snapshot from before P41-3 reaches that root (its exit 5), or the check itself fails',
      'A **surface wait** (§ 4.5 *Surface re-check*, its exit 3 or 4) is not a halt',
      'While a surface wait stands (`next`\'s `surfaceWait`), none of step 1.2 runs',
      'Under a surface wait, a task call\'s or seeded revise\'s *Lost call* writes nothing and resumes nothing',
      '**Surface wait at Integration.**', 'integrate nothing (no `prepare`, never a *Set aside*)',
      'no other rollout waits on or yields its turn to a task of this rollout not yet integrating']) ||
    !collapse(s7raw).includes('- the *Surface re-check* (§ 4.5) finds a serial chain') ||
    !all(kept, ['`reason="surface held: [[<chain>]] writes <token>"`', '`reason="surface re-check failed"`', 'every task writes the Project root a chain now holds']))

  // legs
  const begin = collapse(section(f.legs, /^## Begin/, /^## (?!Begin)/))
  fail('legs', !all(begin, ['- **3, a begin wait** (ADR 0060', 'the chain waits its turn', 'It is no needs-you item',
    '`waiting reason="begin wait: surface held: [[<B>]] holds <token>"`', '`waiting reason="begin wait: surface re-check unanswered: …"`',
    'Never call `create_thread` on it', '- **3, a failed re-check**', 'list it (§ Needs you), and end on its `status_line`',
    // P41-3: an unlisted begin wait (a standing Leg session keeps it off the Waiting list) is a needs-you item
    'With `listed` false, nothing begins it again, so list it (§ Needs you)',
    '`waiting` keeps a chain with a standing Leg session off the list and counts that session against the room (ADR 0076 d3)',
    // P44-3: a listed begin wait, held or unanswered, ends its session, with no poll; the Stage begins the next Leg in
    // a fresh one. An unlisted wait keeps the needs-you remedy above, in this session.
    'With `listed` true, the begin wait (`held` or `unanswered` alike) ends this session (ADR 0076 d2): this turn is its last, so run nothing more in it, never `begin` again here and no background wait or poll.',
    'An unanswered re-check ends it too, as a held place does (ADR 0076 d2: a timed-out check is a hold in this sense).',
    'The Stage begins the next Leg in a fresh session from the list']) ||
    begin.includes('`halted reason="surface held: [[<B>]] holds <token>"`') || begin.includes('The chain stays listed'))

  // status
  const s5 = collapse(section(f.status, /^### 5\. A serial chain/, /^## /))
  const s4 = collapse(section(f.status, /^### 4\. Render the situational report/, /^### 5\. /))
  fail('status', !all(s5, ['- **Hold** (ADR 0060), from `hold`.', 'Scope `stuck`: `Holds only <held>`', 'Released <released>',
    'A `surface held by [[<B>]] (<token>)` blocker (ADR 0060) reads "waits its turn',
    'Meanwhile it holds only the surfaces its Hold block lists (ADR 0060)']) ||
    !all(s4, ['**The Hold line** (ADR 0060)', 'unfinished-rollout.py hold --rollout <rollout-slug>', 'Scope `released`']))

  // repair
  const s7 = collapse(section(f.repair, /^### 7\. A serial chain/, /^## /))
  const step1 = s7.slice(s7.indexOf('1. **Restartable?**'), s7.indexOf('2. **Mark it.**'))
  fail('repair', !step1.includes('- `surface held by [[B]] (<token>)` → never restart (ADR 0060): the chain waits its turn.') ||
    !step1.includes('- `surface re-check unanswered: <why>` → restart it: no hold is known') ||
    !s7.includes("After a hand-back or a sign-off the chain is no longer stuck, so it reclaims its whole claim for new schedules") ||
    !collapse(f.repair).includes("A stuck serial chain (ADR 0060) holds only its unlanded rows' surfaces"))

  // schedule
  const sched = collapse(f.schedule)
  const s0 = collapse(section(f.schedule, /^Pushed-base and unfinished-rollout run after/, /^- `none` → go on\./))
  fail('schedule', !all(s0, ['the check refuses a parallel run whose root overlaps what an unfinished serial chain holds',
    "a stuck one (every unlanded row set aside, or held behind one) holds only its unlanded rows' surfaces (ADR 0060)",
    'a root that overlaps only a place a stuck chain released gives a `WARN: … released …` line instead of a refusal']) ||
    s0.includes('a surface of an unfinished serial chain') || !sched.includes("A stuck chain (every unlanded row set aside, or held behind one) holds only its unlanded rows' surfaces") ||
    !sched.includes('awaiting sign-off or halted on its set-asides, or idle in a surface wait (P41-3') ||
    !sched.includes("it holds its surfaces (while it is stuck, only its unlanded rows', ADR 0060)") ||
    !f.template.includes("(while it is stuck, only its unlanded rows' surfaces: ADR 0060)"))
  return fails
}

// Each control mutates one file in one place and must fail exactly its rule.
function only(file, from, to, rule) {
  assert.ok(FILES[file].includes(from), `the control's text is in ${file}: ${from.slice(0, 60)}`)
  assert.deepEqual(check({ ...FILES, [file]: FILES[file].replace(from, to) }), [rule])
}

test('each doc names its piece of the stuck release (ADR 0060)', () => {
  assert.deepEqual(check(FILES), [])
})

test('control: CONTEXT.md without the stuck chain or the reclaim fails context', () => {
  only('context', "every unlanded row set aside or held behind one) holds only its", "every unlanded row set aside) holds its", 'context')
  only('context', 'waits its turn for a place another rollout took meanwhile', 'collides', 'context')
})

// P41-3's sentences: each dropped or reworded in one file fails exactly that file's rule.
const firstLine = (text, phrase) => text.split('\n').find((l) => l.includes(phrase)) ?? ''
test('control: CONTEXT.md without S1, with S2 freeing a legacy chain, or without the Origin-lane holder rule fails context', () => {
  const ctx = collapse(FILES.context)
  assert.ok(ctx.includes(S1), 'control setup: S1 in CONTEXT.md')
  assert.deepEqual(check({ ...FILES, context: ctx.replace(S1, '') }), ['context'])
  only('context', "never the marker's release", "and the marker's release", 'context')
  only('context', 'stamp, and, in a **Surface wait**, only', 'stamp, and only', 'context')
})
test('control: ADR 0060 without S2 or S3, or ADR 0064 naming only the waiter, fails adr', () => {
  const a60 = collapse(FILES.adr60)
  assert.ok(a60.includes(S2) && a60.includes(S3), 'control setup: S2 and S3 in ADR 0060')
  assert.deepEqual(check({ ...FILES, adr60: a60.replace(S2, '') }), ['adr'])
  assert.deepEqual(check({ ...FILES, adr60: a60.replace(S3, '') }), ['adr'])
  only('adr64', 'nor does a holder or a waiter count', 'nor does a waiter count', 'adr')
})

test('control: ADR 0060 proposed, or an amended ADR without its line, fails adr', () => {
  only('adr60', 'Status: accepted.', 'Status: proposed.', 'adr')
  only('adr48', 'Amended by ADR 0060', 'See ADR 0060', 'adr')
})

test('control: execute without the re-check or its kept halt fails execute', () => {
  only('execute', "right after the canary's `check-all`", 'right after `record-entry`', 'execute')
  only('execute', 'goes on. The *Surface re-check* below comes next.', 'goes on.', 'execute')
  only('execute', '; `reason="surface held: [[<chain>]] writes <token>"` and `reason="surface re-check failed"` (§ 4.5 *Surface re-check*', '; (§ 4.5 *Surface re-check*', 'execute')
})

test('control: execute turning the surface wait back into a halt, or dropping a P41-3 hold, fails execute', () => {
  only('execute', 'a surface wait, never § 7.', 'halt (§ 7).', 'execute')                                        // (i)
  only('execute', ' A **surface wait** (§ 4.5 *Surface re-check*, its exit 3 or 4) is not a halt: it ends `waiting`, and `next` launches nothing until a check passes (ADR 0075 d1).', '', 'execute')  // (ii)
  only('execute', ' While a surface wait stands (`next`\'s `surfaceWait`), none of step 1.2 runs', '', 'execute')  // (iii)
  const lost = firstLine(FILES.execute, 'Under a surface wait, a task call\'s or seeded revise\'s *Lost call*')
  only('execute', lost + '\n', '', 'execute')                                                                     // (iv)
  only('execute', 'Exit 5 (`refuse <chains>` and a `legacy:` line)', 'Exit 5', 'execute')                        // (v)
  only('execute', 'reaches that root (its exit 5), or the check itself fails', 'reaches that root, or the check itself fails', 'execute')  // (vi)
  only('execute', 'never a *Set aside*', 'then a *Set aside*', 'execute')                                        // (vii)
  const sentence = firstLine(FILES.execute, '**Surface wait at Integration.**')
  const drop = sentence.slice(sentence.indexOf(' The refusal also drops'), sentence.indexOf(' In `prepare`'))
  assert.ok(drop.startsWith(' The refusal also drops') && drop.endsWith('amends it).'), 'control setup: the origin-lane sentence')
  only('execute', drop, '', 'execute')                                                                           // (viii)
  only('execute', 'waits on or yields its turn', 'yields its turn', 'execute')                                   // (ix)
})

test('control: legs § Begin calling create_thread on the stand fails legs', () => {
  only('legs', 'Never call `create_thread` on it, and run no `/thread:close`.', 'Then call `create_thread`.', 'legs')
})
test('control: legs § Begin halting on a begin wait fails legs (P41-3)', () => {
  only('legs', '`waiting reason="begin wait: surface held: [[<B>]] holds <token>"`', '`halted reason="surface held: [[<B>]] holds <token>"`', 'legs')
})
test('control: legs § Begin calling every begin wait listed fails legs (P41-3)', () => {
  only('legs', 'With `listed` false, nothing begins it again, so list it (§ Needs you)', 'The chain stays listed (`start: unattended`, ADR 0076 d2)', 'legs')
})
test('control: legs § Begin polling a listed begin wait in its session fails legs (P44-3)', () => {
  only('legs', 'With `listed` true, the begin wait (`held` or `unanswered` alike) ends this session (ADR 0076 d2): this turn is its last, so run nothing more in it, never `begin` again here and no background wait or poll.',
    'With `listed` true, the begin wait (`held` or `unanswered` alike) waits in this session: launch `leg.py wait` in the background and run `begin` again on its notification.', 'legs')
})
test('control: legs § Begin ending every begin wait\'s session, listed or not, fails legs (P44-3)', () => {
  only('legs', 'With `listed` true, the begin wait (`held` or `unanswered` alike) ends this session',
    'The begin wait (`held` or `unanswered` alike) ends this session', 'legs')
})
test('control: legs § Begin ending only a held begin wait\'s session fails legs (P44-3)', () => {
  only('legs', 'With `listed` true, the begin wait (`held` or `unanswered` alike) ends this session',
    'With `listed` true, a `held` begin wait ends this session', 'legs')
  only('legs', ' An unanswered re-check ends it too, as a held place does (ADR 0076 d2: a timed-out check is a hold in this sense).', '', 'legs')
})
test('control: repair stopping on an unanswered re-check fails repair (P41-3)', () => {
  only('repair', '- `surface re-check unanswered: <why>` → restart it: no hold is known', '- `surface re-check unanswered: <why>` → report it, and stop: no hold is known', 'repair')
})
test('control: schedule S3 without the surface wait\'s release fails schedule (P41-3)', () => {
  only('schedule', 'awaiting sign-off or halted on its set-asides, or idle in a surface wait (P41-3', 'awaiting sign-off or halted on its set-asides (', 'schedule')
})

test('control: status without its Hold block or Hold line fails status', () => {
  only('status', '- **Hold** (ADR 0060), from `hold`.', '- **Holdings.**', 'status')
  only('status', '**The Hold line** (ADR 0060)', '**The line**', 'status')
})

test('control: repair restarting over a held surface fails repair', () => {
  only('repair', '→ never restart (ADR 0060): the chain waits its turn.', '→ restart it.', 'repair')
})

test('control: schedule § 0 refusing on a stuck chain\'s whole claim fails schedule', () => {
  only('schedule', 'that overlaps only a place a stuck chain released gives', 'that overlaps a place a stuck chain claims gives', 'schedule')
  only('schedule', 'whose root overlaps what an unfinished serial chain holds', 'whose root overlaps a surface of an unfinished serial chain', 'schedule')
})

test('control: schedule S7 claiming the whole surfaces fails schedule', () => {
  only('schedule', " (while it is stuck, only its unlanded rows', ADR 0060)", '', 'schedule')
  only('template', " (while it is stuck, only its unlanded rows' surfaces: ADR 0060)", '', 'schedule')
})
