// Repair stops on a complete rollout, and execute's completion ceremony runs once (p19-14, found by the 3.0.0
// live E2E's row 7). Repair's `resume` can flip a merged, never marked task on a rollout whose ceremony already
// ran (the note reads `status: done` and sits in Archive/Rollouts/); § 4's hand-off into execute's Cold resume
// would then re-run the ceremony (a second Completion log, thread close, cron delete, archive move). Two layers:
//   - repair § 1 resolves an archived rollout, § 3a's complete-rollout stop, its exclusion from § 4's hand-off
//     and its Don't;
//   - execute's idempotence guard: `next` halts "done" on a done, archived note (the behaviour is pinned in
//     skills/execute/tests/reconcile-rollout-queue.test.sh, scenario halt-done), and the halt guard's `done`
//     route runs none of step 5 but its last bullet, the thread close (close-handoff-chorus-words.test.mjs pins
//     why that one runs again).
// check() returns named failures, so the real text and each control run through identical logic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section } from '../lib/contract-text.mjs'

const REPAIR = read('skills/repair/SKILL.md')
const EXECUTE = read('skills/execute/SKILL.md')

function check({ repair, execute }) {
  const fails = []
  const s1 = collapse(section(repair, /^### 1\. /) ?? '')
  if (!s1.includes("else `Work/Tasks/Archive/Rollouts/<slug>.md`, a rollout whose completion ceremony already ran (§ 3a's complete-rollout stop)"))
    fails.push('repair-resolve')
  const s3 = collapse(section(repair, /^### 3\. /) ?? '')
  const stop = s3.slice(Math.max(0, s3.indexOf('**The complete-rollout stop')))
  if (!s3.includes('**The complete-rollout stop') ||
      !['`status: done`', 'Archive/Rollouts/', 'rollout complete', 'no § 4 hand-off and no § 6',
        'write a dated `## Notes` line', 'merged, never marked: flipped done'].every((k) => stop.includes(k)))
    fails.push('repair-stop')
  const s4 = collapse(section(repair, /^### 4\. /) ?? '')
  const handOff = s4.slice(Math.max(0, s4.indexOf('**Hand-off')))
  if (!s4.includes('**Hand-off') || !handOff.includes("never on a rollout whose ceremony already ran (§ 3a's complete-rollout stop"))
    fails.push('repair-hand-off')
  if (!collapse(repair).includes("**Don't hand a finished rollout back to execute.**")) fails.push('repair-dont')

  const ex = collapse(execute)
  const guard = ex.slice(Math.max(0, ex.indexOf('**Halt guard (last).**')))
  if (!/`complete` → step 5; `done` → the completion ceremony already ran through its archive move[^;]*`Archive\/Rollouts\/`[^;]*: report "already complete and archived: the completion ceremony is not re-run", run none of step 5 but its last bullet \(no second Completion log, cron delete, `retire` or move\)/.test(guard))
    fails.push('execute-halt-done')
  const s5 = ex.slice(Math.max(0, ex.indexOf('5. **Completion.**')))
  if (!/\*\*Idempotence guard \(p19-14\)\.\*\* The ceremony runs once per rollout\. `next` reports `halt: "done"`/.test(s5))
    fails.push('execute-guard')
  return fails
}

test('repair stops on a complete rollout and execute runs its ceremony once', () => {
  assert.deepEqual(check({ repair: REPAIR, execute: EXECUTE }), [])
})

test('control: a resolve that never looks in Archive/Rollouts/ fails repair-resolve', () => {
  const repair = REPAIR.replace('else\n`Work/Tasks/Archive/Rollouts/<slug>.md`', 'never\n`Work/Tasks/Archive/Rollouts/<slug>.md`')
  assert.deepEqual(check({ repair, execute: EXECUTE }), ['repair-resolve'])
})

test('control: no complete-rollout stop in repair § 3a fails repair-stop', () => {
  const repair = REPAIR.replace('**The complete-rollout stop (p19-14).**', '**A note (p19-14).**')
  assert.deepEqual(check({ repair, execute: EXECUTE }), ['repair-stop'])
})

test('control: a stop that writes no dated Notes record fails repair-stop', () => {
  const repair = REPAIR.replace('write a dated `## Notes` line to the rollout note', 'mention it in the report')
  assert.deepEqual(check({ repair, execute: EXECUTE }), ['repair-stop'])
})

test('control: a hand-off that runs on a finished rollout fails repair-hand-off', () => {
  const repair = REPAIR.replace('never on a rollout whose ceremony already ran', 'also on a rollout whose ceremony already ran')
  assert.deepEqual(check({ repair, execute: EXECUTE }), ['repair-hand-off'])
})

test("control: no Don't fails repair-dont", () => {
  const repair = REPAIR.replace("**Don't hand a finished rollout back to execute.**", '**Hand a finished rollout back.**')
  assert.deepEqual(check({ repair, execute: EXECUTE }), ['repair-dont'])
})

test('control: a halt guard that sends done to the ceremony fails execute-halt-done', () => {
  const execute = EXECUTE.replace('run none of step 5 but its last bullet', 'then step 5')
  assert.deepEqual(check({ repair: REPAIR, execute }), ['execute-halt-done'])
})

test('control: no idempotence guard in step 5 fails execute-guard', () => {
  const execute = EXECUTE.replace('**Idempotence guard (p19-14).**', '**Guard.**')
  assert.deepEqual(check({ repair: REPAIR, execute }), ['execute-guard'])
})
