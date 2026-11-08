// p43-2 (ADR 0073 d1): Thread Skill declares its fast tier, and nothing in the engine has to change for it.
// - W1: the engine renders the rollout's `verifier:` at both Checkpoints, an agent's (the implementer, the approved-plan
//   implementer, a reviser) and Integration's (the integrator, with the slot's priority), so `make test-fast` reaches
//   all four through slotted(), and the full `make test` reaches none of them.
// - W2: the engine never reads completion_verifier: the completion verify is the lead's (execute § 4.5 step 5).
// - W3: the real CLAUDE.md declares `Verifier: \`make test-fast\`` and `Completion verifier: \`make test\`` at column 0
//   (schedule § 2.5 reads "a line starting `Verifier:`"), never as list items, and estate-scan.py's VERIFIER_LINE reads
//   the fast tier from it.
// - W4: the rollout template stamped as schedule step 6 does it (`verifier: make test-fast`, `completion_verifier:
//   "make test"`) passes step 6's *Check the stamped commands*: `reconcile-rollout.py verify-timeout` exits 0 with one
//   JSON line.
// tests/fast-tier.test.sh pins the selector and run.sh's modes. Reads the tree; W4 writes one note in an mkdtemp dir.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadEngine, enginePath, VERIFY_SLOT } from './lib/engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const text = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const FAST = 'make test-fast'

const T = loadEngine(['implementerPrompt', 'approvedPlanImplementerPrompt', 'reviserPrompt', 'integratorPrompt', 'slotted', 'rungState'])
const task = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', maxIterations: 3, scope: 'cross-cutting' }
const a = { repoPath: '/repo', rolloutSlug: 'proj-rollout-2026-11-08', verifier: FAST, verifySlot: VERIFY_SLOT }
const st = T.rungState({ ...task, rung: 'opus-high' }, {})
const impl = { prUrl: 'https://github.com/o/r/pull/1', worktreePath: '/repo/.claude/worktrees/proj-fix-x', branch: 'audit-fix/fix-x' }
const H = (c) => c.repeat(40)
const I = {
  prUrl: impl.prUrl, branch: impl.branch, worktreePath: impl.worktreePath, headSha: H('a'), taskBase: H('b'), mainSha: H('c'),
  trouble: ['conflict'], landed: [], reviewHistory: [{ round: 1, feedback: ['fix it'] }], reviewRoundsUsed: 1,
  rung: { startRung: 'opus-high', rung: 'opus-high', climbs: [] },
}

test('W1: the four Checkpoint prompts run the fast tier through slotted(), never the full suite', () => {
  const agent = T.slotted(FAST, VERIFY_SLOT)
  const integration = T.slotted(FAST, { ...VERIFY_SLOT, priority: true })
  assert.notEqual(agent, integration, 'the integrator\'s line differs by --priority')
  const prompts = {
    implementerPrompt: [T.implementerPrompt(task, a, st, ''), agent],
    approvedPlanImplementerPrompt: [T.approvedPlanImplementerPrompt(task, 'PLAN', a, st, ''), agent],
    reviserPrompt: [T.reviserPrompt(task, impl, [{ round: 1, feedback: ['fix it'] }], 2, a, ''), agent],
    integratorPrompt: [T.integratorPrompt(task, a, I), integration],
  }
  for (const [name, [p, line]] of Object.entries(prompts)) {
    assert.ok(p.includes(line), `${name} runs ${line}`)
    assert.ok(!p.includes("bash -c 'make test'"), `${name} never runs the full make test`)
  }
})

test('W2: the engine never reads completion_verifier (the completion verify is the lead\'s)', () => {
  const src = fs.readFileSync(enginePath, 'utf8')
  assert.equal((src.match(/completion_verifier|completionVerifier/g) || []).length, 0)
})

test('W3: CLAUDE.md declares both verifiers at column 0, and estate-scan reads the fast tier', () => {
  const md = text('CLAUDE.md')
  assert.equal(md.match(/^Verifier: `([^`\n]+)`/m)?.[1], FAST)
  assert.equal(md.match(/^Completion verifier: `([^`\n]+)`/m)?.[1], 'make test')
  assert.equal(md.split('\n').filter((l) => /^\s*[-*+]\s+(Completion v|V)erifier:/.test(l)).length, 0, 'no list-item verifier line')
  const loader = [
    'import importlib.util, sys',
    's = importlib.util.spec_from_file_location("estate_scan", sys.argv[1]); m = importlib.util.module_from_spec(s)',
    's.loader.exec_module(m)',
    'print(m.VERIFIER_LINE.search(open(sys.argv[2]).read()).group(1))',
  ].join('\n')
  const r = spawnSync('python3', ['-B', '-c', loader, path.join(root, 'skills/_shared/scripts/estate-scan.py'), path.join(root, 'CLAUDE.md')],
    { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout.trim(), FAST)
})

test('W4: the template stamped as step 6 does it passes verify-timeout', () => {
  const RECONCILE = path.join(root, 'skills', 'execute', 'scripts', 'reconcile-rollout.py')
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-tier-wiring-'))
  try {
    const home = path.join(d, 'home')
    fs.mkdirSync(home)
    const vals = {
      PROJECT_NAME: 'Thread Skill', DATE: '2026-11-08', VERIFIER: FAST, MAX_ITERATIONS: '3', MAX_REVIEW_ROUNDS: '4',
      MAX_PLAN_ROUNDS: '3', PARALLEL_CEILING: '4', REPO_PATH: '/repo', ROLLOUT_SLUG: 'thread-skill-rollout-2026-11-08',
      THREAD_LINE: 'Thread: `/repo/THREAD.md`', QUEUE_TABLE: '| # | Task | Scope | Mode |\n|---|---|---|---|\n| 1 | [[a]] | cross-cutting | — |',
      QUEUE_RATIONALE: 'One task.', FILE_SETS: '- a: tests/run.sh', KNOWN_BASELINE_FAILURES: 'none', POST_ROLLOUT_ITEMS: 'none',
    }
    let note = text('skills/schedule/rollout-template.md')
    for (const [k, v] of Object.entries(vals)) note = note.split(`{{${k}}}`).join(v)
    const lines = note.split('\n')
    const i = lines.findIndex((l) => l.startsWith('# completion_verifier:'))
    assert.ok(i > -1, 'the template has its # completion_verifier: line')
    lines[i] = 'completion_verifier: "make test"'
    note = lines.join('\n')
    assert.ok(!note.includes('{{'), 'every placeholder is stamped')
    assert.match(note, /^verifier: make test-fast$/m)
    const file = path.join(d, 'thread-skill-rollout-2026-11-08.md')
    fs.writeFileSync(file, note)
    const r = spawnSync('python3', ['-B', RECONCILE, 'verify-timeout', '--rollout', file], {
      encoding: 'utf8',
      env: {
        ...process.env, HOME: home, PYTHONDONTWRITEBYTECODE: '1', THREAD_EVENTS_DIR: path.join(d, 'events'),
        THREAD_VERIFY_SLOTS_DIR: path.join(d, 'verify-slots'), THREAD_HEAT_LEVEL: '0',
      },
    })
    assert.equal(r.status, 0, r.stderr)
    const out = r.stdout.trim().split('\n')
    assert.equal(out.length, 1, r.stdout)
    assert.equal(typeof JSON.parse(out[0]).verifyTimeout, 'number')
  } finally {
    fs.rmSync(d, { recursive: true, force: true })
  }
})
