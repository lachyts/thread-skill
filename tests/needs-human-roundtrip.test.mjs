// p16-3: the engine declares when a stop needs a human. A plan judge's (or review judge's, implementer's,
// investigator's, reviser's) `needsHuman` question rides the row, reconcile upserts it under the task note's
// `## Needs you`, and the queue reads it back: `next` on the task's setAside entry and `status` on its task row,
// each only when the note holds a question. A later own-call row with none ('' needsHuman) settles it. The engine
// side is pinned in skills/execute/tests/task-engine.test.mjs, the reconcile tri-state in reconcile-rollout.test.sh;
// this file runs the real engine into the real reconcile, end to end.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runTask } from './lib/engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RECONCILE = path.join(root, 'skills', 'execute', 'scripts', 'reconcile-rollout.py')
// The Run record (run_record.py, ADR 0032) the scripts append lands in temp; HOME is an empty dir of this
// suite's own, so the operator's rollouts.toml never reaches the assertions (the rollout pins its ceiling too).
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'p163-needs-human-'))
after(() => fs.rmSync(SCRATCH, { recursive: true, force: true }))
const HOME = path.join(SCRATCH, 'home')
fs.mkdirSync(HOME)
const PY_ENV = {
  ...process.env, TZ: 'UTC', PYTHONDONTWRITEBYTECODE: '1', HOME,
  THREAD_EVENTS_DIR: process.env.THREAD_TEST_EVENTS_DIR || path.join(SCRATCH, 'events'),
}

const SLUG = 'proj-fix-a'
const QUEUED = 'proj-fix-b'
const ROLLOUT = 'proj-rollout-2026-10-09'
const NOW = '2026-10-09T03:00:00Z'
const Q = 'Which retention window should the cache use: 7 or 30 days?'
const PLAN_TEXT = 'Planned on: abc\n### Files to modify\n- x\n### Gated inputs\nNone'
const mkArgs = (over = {}) => ({
  rolloutSlug: ROLLOUT, repoPath: '/repo', verifier: 'make test', date: '2026-10-09',
  task: { slug: SLUG, taskPath: `/vault/Tasks/${SLUG}.md`, scope: 'cross-cutting', planGate: true, maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, rung: 'opus-xhigh', ...over },
})

// A scripted agent: the plan judge asks Q (or approves when `ask` is false); everything else goes green.
function agentFor(ask) {
  return async (prompt, opts) => {
    const kind = opts.label.split(':')[0]
    if (kind === 'plan' || kind === 'plan-revise') return { ready: true, blocked: false, blockerCause: '', plan: PLAN_TEXT }
    if (kind === 'plan-judge') return ask ? { verdict: 'changes', feedback: ['the brief leaves the window open'], needsHuman: Q } : { verdict: 'approve', feedback: [] }
    if (kind === 'review') return { verdict: 'approve', feedback: [] }
    if (kind === 'implement') {
      return { verified: true, blocked: false, escalate: false, prUrl: 'https://github.com/o/r/pull/7', branch: 'audit-fix/fix-a', worktreePath: '/repo/.claude/worktrees/proj-fix-a', blockerDiagnosis: '', summary: 'done' }
    }
    throw new Error('stub: unknown agent label ' + opts.label)
  }
}
async function engineRow(ask) {
  const r = await runTask(mkArgs(), agentFor(ask))
  assert.equal(r.error, undefined, String(r.error))
  return r.result
}

function vault() {
  const d = fs.mkdtempSync(path.join(SCRATCH, 'vault-'))
  fs.writeFileSync(path.join(d, `${ROLLOUT}.md`), '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\nparallel_ceiling: 2\n---\n\n' +
    `## Queue\n\n- [[${SLUG}]]\n- [[${QUEUED}]]\n`)
  for (const s of [SLUG, QUEUED]) {
    fs.writeFileSync(path.join(d, `${s}.md`), `---\ntags: [task]\nstatus: ${s === SLUG ? 'in_progress' : 'open'}\nscope: cross-cutting\n` +
      `rollout: "[[${ROLLOUT}]]"\n---\n\n## Notes\n\nbody of ${s}\n`)
  }
  return d
}
const py = (args) => execFileSync('python3', [RECONCILE, ...args], { encoding: 'utf8', env: PY_ENV })
function reconcile(d, result) {
  const f = path.join(d, 'result.json')
  fs.writeFileSync(f, JSON.stringify(result))
  py(['reconcile', '--result', f, '--tasks-dir', d, '--now', NOW])
  fs.rmSync(f)
}
const next = (d) => JSON.parse(py(['next', '--rollout', path.join(d, `${ROLLOUT}.md`), '--tasks-dir', d, '--now', NOW, '--running', '']))
const status = (d) => JSON.parse(py(['status', '--rollout', path.join(d, `${ROLLOUT}.md`), '--tasks-dir', d, '--now', NOW]))
const note = (d) => fs.readFileSync(path.join(d, `${SLUG}.md`), 'utf8')

test('n1: a plan judge question lands in the note, in next\'s setAside entry and in status\'s task row', async () => {
  const d = vault()
  const res = await engineRow(true)
  const row = res.tasks[0]
  assert.equal(row.status, 'plan-blocked')
  assert.equal(row.needsHuman, Q)
  reconcile(d, res)
  assert.ok(note(d).includes(`\n## Needs you\n\n${Q}\n`), note(d))
  assert.match(note(d), /status: plan-blocked/)
  const n = next(d)
  assert.deepEqual(n.setAside, [{ slug: SLUG, status: 'plan-blocked', setAsideAt: 'run', needsHuman: Q }])
  const s = status(d)
  const mine = s.tasks.find((t) => t.slug === SLUG)
  const queued = s.tasks.find((t) => t.slug === QUEUED)
  assert.equal(mine.queueState, 'set-aside')
  assert.equal(mine.needsHuman, Q)
  assert.equal(queued.queueState, 'queued')
  assert.ok(!('needsHuman' in queued), 'a task with no question carries no key')
})

test('n2: a later own-call row with no question settles it: the section goes, next and status carry no key', async () => {
  const d = vault()
  reconcile(d, await engineRow(true))
  assert.ok(note(d).includes('## Needs you'))
  const later = await engineRow(false)
  assert.equal(later.tasks[0].status, 'review')
  assert.equal(later.tasks[0].needsHuman, '')
  reconcile(d, later)
  assert.ok(!note(d).includes('## Needs you'), note(d))
  const n = next(d)
  assert.ok(n.setAside.every((e) => !('needsHuman' in e)), JSON.stringify(n.setAside))
  assert.ok(status(d).tasks.every((t) => !('needsHuman' in t)))
})

test('n3: a question on a task that is not set aside is never reported', async () => {
  const d = vault()
  reconcile(d, await engineRow(true))
  // A human answered on the note and handed it back: in_progress again, the section still there.
  fs.writeFileSync(path.join(d, `${SLUG}.md`), note(d).replace('status: plan-blocked', 'status: in_progress'))
  assert.ok(note(d).includes('## Needs you'))
  assert.ok(next(d).setAside.every((e) => e.slug !== SLUG))
  assert.ok(!('needsHuman' in status(d).tasks.find((t) => t.slug === SLUG)))
})
