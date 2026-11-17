// p52-1 (ADR 0081 d1): a task declares an Unreachable surface, and the repo's path list backs it up.
//
// The plan declares it (PLAN_VERDICT's unreachable), the plan judge checks the declaration with its own reading of the
// plan's files (PLAN_JUDGE's), a task with no plan declares it in its code-writing agent's result (IMPL_RESULT's), and a
// changed path under args.unreachablePaths marks the task whatever its plan says. The row's `unreachable` carries the
// mark. These run the whole engine through tests/lib/engine.mjs runTask() with a scripted `agent`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runTask, loadEngine, VERIFY_SLOT } from '../../../tests/lib/engine.mjs'

const PLAN_TEXT = 'Planned on: abc\n### Files to modify\n- x\n### Gated inputs\nNone'
const mkArgs = (task, over = {}) => ({
  rolloutSlug: 'proj-rollout-2026-11-12', repoPath: '/repo', verifier: 'make test', date: '2026-11-12',
  verifySlot: VERIFY_SLOT,
  task: { slug: 'proj-fix-u', taskPath: '/vault/Tasks/proj-fix-u.md', scope: 'cross-cutting', planGate: false,
    maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, rung: 'opus-xhigh', ...task },
  ...over,
})
// s: { plan, judge, result, files }: what the planner, the plan judge and the implementer return for unreachable, and the
// implementer's changedFiles (absent ⇒ the key is left out, as an older agent returns it).
function agentOf(s) {
  return async (prompt, opts) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'plan') return { ready: true, blocked: false, blockerCause: '', plan: PLAN_TEXT, ...(s.plan === undefined ? {} : { unreachable: s.plan }) }
    if (kind === 'plan-judge') return { verdict: 'approve', feedback: [], ...(s.judge === undefined ? {} : { unreachable: s.judge }) }
    if (kind === 'review') return { verdict: 'approve', feedback: [] }
    if (kind === 'implement') {
      return {
        verified: true, blocked: false, escalate: false, prUrl: 'https://github.com/o/r/pull/1', branch: 'audit-fix/u',
        worktreePath: '/repo/.claude/worktrees/proj-fix-u', blockerDiagnosis: '', summary: 'done',
        ...(s.result === undefined ? {} : { unreachable: s.result }), ...(s.files === undefined ? {} : { changedFiles: s.files }),
      }
    }
    throw new Error('unscripted label ' + opts.label)
  }
}
const NOT = { marked: false, by: [], paths: [] }
const GLOBS = ['skills/codex/**', 'Apps/**/*.swift']

test('the row carries the mark: a declaring plan, its judge, a no-plan result, a listed diff; an unlisted, undeclared task is not', async () => {
  for (const [name, task, s, over, want] of [
    ['a plan that declares it', { planGate: true }, { plan: true, judge: false, files: ['x.js'] }, { unreachablePaths: GLOBS },
      { marked: true, by: ['plan'], paths: [] }],
    ['a silent plan its judge reads as unreachable', { planGate: true }, { plan: false, judge: true }, {},
      { marked: true, by: ['plan-judge'], paths: [] }],
    ['a task with no plan whose implementer declares it', {}, { result: true }, {}, { marked: true, by: ['result'], paths: [] }],
    ['a diff under a listed path, the plan silent', { planGate: true }, { plan: false, judge: false, files: ['README.md', 'skills/codex/cu.py', 'Apps/Panel/V.swift'] },
      { unreachablePaths: GLOBS }, { marked: true, by: ['paths'], paths: ['Apps/Panel/V.swift', 'skills/codex/cu.py'] }],
    ['an unlisted, undeclared task', { planGate: true }, { plan: false, judge: false, files: ['skills/codexx/a.py', 'Apps/a.js'] },
      { unreachablePaths: GLOBS }, NOT],
    ['an approved plan wins over its implementer\'s declaration', { planGate: true }, { plan: false, judge: false, result: true }, {}, NOT],
    ['no list: a changed path marks nothing', {}, { result: false, files: ['skills/codex/cu.py'] }, {}, NOT],
    ['an older agent that returns neither field', {}, {}, { unreachablePaths: GLOBS }, NOT],
  ]) {
    const r = await runTask(mkArgs(task, over), agentOf(s))
    assert.equal(r.error, undefined, name)
    const row = r.result.tasks[0]
    assert.equal(row.status, 'review', name)
    assert.deepEqual(row.unreachable, want, name)
    assert.equal(r.logs.some((l) => l.startsWith('unreachable surface: proj-fix-u')), want.marked, `${name}: the log line`)
  }
})

test('the declaration rides each schema: required of the planner, the plan judge and every code-writing agent', () => {
  const E = loadEngine(['PLAN_VERDICT', 'PLAN_JUDGE', 'PLAN_JUDGE_PRICED', 'IMPL_RESULT', 'IMPL_RESULT_SECURED'])
  for (const [name, schema, keys] of [
    ['PLAN_VERDICT', E.PLAN_VERDICT, ['unreachable']], ['PLAN_JUDGE', E.PLAN_JUDGE, ['unreachable']],
    ['PLAN_JUDGE_PRICED', E.PLAN_JUDGE_PRICED, ['unreachable']],
    ['IMPL_RESULT', E.IMPL_RESULT, ['unreachable', 'changedFiles']], ['IMPL_RESULT_SECURED', E.IMPL_RESULT_SECURED, ['unreachable', 'changedFiles']],
  ]) {
    for (const k of keys) {
      assert.ok(schema.required.includes(k), `${name} requires ${k}`)
      assert.match(schema.properties[k].description, k === 'changedFiles' ? /gh pr diff <your PR> --name-only/ : /Unreachable surface, ADR 0081/, `${name}.${k}`)
    }
  }
})
