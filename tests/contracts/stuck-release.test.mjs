// A stuck rollout holds only what it waits on (ADR 0060, p33-2). The behaviour is pinned by tests/unfinished-rollout.test.sh
// X1-X12 and tests/leg.test.sh L14; this pins the prose each reader follows, one rule per piece:
//   context   CONTEXT.md **Unfinished rollout** says a stuck chain holds only its unlanded rows' surfaces, a waiting
//             parallel rollout holds no Project root against serial chains, and each reclaims on resume and waits its
//             turn; **Surface** points at it
//   adr       ADR 0060 exists, accepted, with its five decisions, the deadlock argument and its Limits; ADRs 0040, 0048
//             and 0059 each carry an "Amended by ADR 0060" line
//   execute   execute § 4.5's *Surface re-check (ADR 0060)* paragraph: every loop entry, after record-entry, the check's
//             --resume form, exit 3 and exit 2 halting; § 7 lists the halt and *Whole-rollout halts kept* keeps it
//   legs      legs.md § Begin's exit 3 names the surface stand: push it once, end on its status_line, no create_thread
//   status    status § 5's **Hold** block, S12's "holds only", the restart's `surface held by` blocker and § 4's Hold
//             line from `unfinished-rollout.py hold`
//   repair    repair § 7 (e) step 1's `surface held by` branch (never restart), (b)'s reclaim note and the refusal
//             section's released case
//   schedule  schedule S3's stuck-chain note and S7's amended closing line, and the serial template's legend
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

function check(f) {
  const fails = []
  const fail = (rule, bad) => { if (bad && !fails.includes(rule)) fails.push(rule) }

  // context
  const unfinished = collapse(section(f.context, /^- \*\*Unfinished rollout\*\*/, /^- \*\*/))
  const surface = collapse(section(f.context, /^- \*\*Surface\*\*/, /^- \*\*/))
  fail('context', !all(unfinished, ["A stuck chain (no Leg open, nothing claimable: every unlanded row set aside or held behind one) holds only its unlanded rows' surfaces",
    'A parallel rollout awaiting sign-off, or halted with nothing able to start, holds no Project root against serial chains',
    'Each reclaims its whole claim on resume, and waits its turn for a place another rollout took meanwhile', '(ADR 0060)']) ||
    !surface.includes("A stuck chain holds only its unlanded rows' surfaces (**Unfinished rollout**, ADR 0060)"))

  // adr
  const a60 = collapse(f.adr60)
  fail('adr', !/^Status: accepted\./m.test(f.adr60) ||
    !['1. **What a stuck chain is.**', '2. **What a stuck chain still holds.**', '3. **Reclaim on resume, and why there is no deadlock.**',
      '4. **Parallel release.**', '5. **What a released parallel rollout gives up.**'].every((d) => a60.includes(d)) ||
    !a60.includes('The asymmetric rule makes whoever released a place yield it.') || !a60.includes('- **Limits.**') ||
    ![f.adr40, f.adr48, f.adr59].every((t) => t.includes('Amended by ADR 0060')))

  // execute
  const ex = f.execute.split('\n')
  const recheck = collapse(ex.find((l) => l.startsWith('**Surface re-check (ADR 0060).**')) ?? '')
  const s7raw = section(f.execute, /^### 7\. /, /^### 8\. /)
  const kept = collapse(section(s7raw, /^\*\*Whole-rollout halts kept \(ADR 0048\)\.\*\*/, /^The end-of-run verdicts/))
  fail('execute', !all(recheck, ['Every entry into this loop', 'right after `record-entry`',
    'unfinished-rollout.py check --shape parallel --repo <repoPath> --resume <rollout-slug>', "unlanded rows' surfaces, never a chain's whole claim",
    'Exit 3 (`refuse <chains>`)', 'halt with `reason="surface held: [[<chain>]] writes <token>"` (§ 7)', 'Exit 2: print its line and halt with `reason="surface re-check failed"`']) ||
    !collapse(s7raw).includes('- the *Surface re-check* (§ 4.5) finds a serial chain') ||
    !all(kept, ['`reason="surface held: [[<chain>]] writes <token>"`', '`reason="surface re-check failed"`', 'every task writes the Project root a chain now holds']))

  // legs
  const begin = collapse(section(f.legs, /^## Begin/, /^## (?!Begin)/))
  fail('legs', !all(begin, ['- **3, a surface stand** (ADR 0060', 'the chain waits its turn', 'push it once (§ Needs you), and end on its `status_line`',
    '`halted reason="surface held: [[<B>]] holds <token>"`', 'Never call `create_thread` on it']))

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
    !s7.includes("After a hand-back or a sign-off the chain is no longer stuck, so it reclaims its whole claim for new schedules") ||
    !collapse(f.repair).includes("A stuck serial chain (ADR 0060) holds only its unlanded rows' surfaces"))

  // schedule
  const sched = collapse(f.schedule)
  fail('schedule', !sched.includes("A stuck chain (every unlanded row set aside, or held behind one) holds only its unlanded rows' surfaces") ||
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

test('control: ADR 0060 proposed, or an amended ADR without its line, fails adr', () => {
  only('adr60', 'Status: accepted.', 'Status: proposed.', 'adr')
  only('adr48', 'Amended by ADR 0060', 'See ADR 0060', 'adr')
})

test('control: execute without the re-check or its kept halt fails execute', () => {
  only('execute', 'right after `record-entry` (*Run record*)', 'at the end of the entry', 'execute')
  only('execute', '; `reason="surface held: [[<chain>]] writes <token>"` and `reason="surface re-check failed"` (§ 4.5 *Surface re-check*', '; (§ 4.5 *Surface re-check*', 'execute')
})

test('control: legs § Begin calling create_thread on the stand fails legs', () => {
  only('legs', 'Never call `create_thread` on it, and run no `/thread:close`.', 'Then call `create_thread`.', 'legs')
})

test('control: status without its Hold block or Hold line fails status', () => {
  only('status', '- **Hold** (ADR 0060), from `hold`.', '- **Holdings.**', 'status')
  only('status', '**The Hold line** (ADR 0060)', '**The line**', 'status')
})

test('control: repair restarting over a held surface fails repair', () => {
  only('repair', '→ never restart (ADR 0060): the chain waits its turn.', '→ restart it.', 'repair')
})

test('control: schedule S7 claiming the whole surfaces fails schedule', () => {
  only('schedule', " (while it is stuck, only its unlanded rows', ADR 0060)", '', 'schedule')
  only('template', " (while it is stuck, only its unlanded rows' surfaces: ADR 0060)", '', 'schedule')
})
