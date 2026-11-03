// The opener contract (ADR 0067 d6): hooks/vault-note-overlap.py names an engine agent's run from the opener window of
// its first user message (opener_links: the harness's preamble line dropped, each line stripped, the first three
// non-blank lines' links in order), so every task.workflow.js builder that dispatches a task agent must put its task
// link and then its rollout link there. A reworded opener would end the Note overlap records silently; this pins it.
//
// Each of the seven task-agent builders is rendered for task proj-fix-x of rollout proj-rollout-2026-11-03 (st from
// rungState and escalate, as prompt-invariants builds it; the integrator from integrate.test.mjs's mkI shape), framed
// the harness's way (tests/fixtures/note-overlap/harness-preamble.txt, then every line indented by two spaces), and
// read by the hook's own opener_links in one python3 call. The judges (planJudge, reviewJudge, integrationReview) are
// read-only and not covered, though the same rule names them as their task's run. Controls: a reviser opener reworded
// without links (a source variant, loadEngine's options.source) and an opener pushed below the window both fail.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadEngine, enginePath, VERIFY_SLOT } from '../lib/engine.mjs'
import { root } from '../lib/contract-text.mjs'

const HOOK = path.join(root, 'hooks', 'vault-note-overlap.py')
const PREAMBLE = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'note-overlap', 'harness-preamble.txt'), 'utf8').replace(/\n$/, '')
const TASK = 'proj-fix-x'
const ROLLOUT = 'proj-rollout-2026-11-03'
const BUILDERS = ['implementerPrompt', 'approvedPlanImplementerPrompt', 'reviserPrompt', 'readOnlyPrompt', 'integratorPrompt',
  'plannerPrompt', 'planReviserPrompt']

// Every builder's prompts: { name: [prompt, ...] }, from the engine source given (the file's by default).
function render(source) {
  const E = loadEngine([...BUILDERS, 'rungState', 'escalate'], source === undefined ? {} : { source })
  const tk = { slug: TASK, taskPath: `/vault/${TASK}.md`, maxIterations: 3, scope: 'cross-cutting' }
  const a = { repoPath: '/repo', verifier: 'make test', rolloutSlug: ROLLOUT, verifySlot: VERIFY_SLOT }
  const climbed = E.rungState(tk, a)
  E.escalate(climbed, tk.slug, 'implement')
  const states = [E.rungState(tk, a), climbed]
  const im = { prUrl: 'https://github.com/o/r/pull/7', worktreePath: `/repo/.claude/worktrees/${TASK}`, branch: 'audit-fix/fix-x' }
  const I = { prUrl: im.prUrl, branch: im.branch, worktreePath: im.worktreePath, headSha: 'a'.repeat(40), taskBase: 'b'.repeat(40),
    mainSha: 'c'.repeat(40), trouble: [], landed: [], reviewHistory: [], reviewRoundsUsed: 1, startedAt: '2026-11-03T10:00:00Z',
    rung: { startRung: 'opus-high', rung: 'opus-xhigh', climbs: [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }] } }
  const history = [{ round: 1, feedback: ['fix it'] }]
  return {
    implementerPrompt: states.map((st) => E.implementerPrompt(tk, a, st, '')),
    approvedPlanImplementerPrompt: states.map((st) => E.approvedPlanImplementerPrompt(tk, 'PLAN', a, st, '')),
    reviserPrompt: [E.reviserPrompt(tk, im, history, 2, a, ''), E.reviserPrompt(tk, im, [...history, { round: 2, feedback: ['keep it'] }], 3, a, 'PLAN')],
    readOnlyPrompt: states.map((st) => E.readOnlyPrompt(tk, a, st, '')),
    integratorPrompt: [E.integratorPrompt(tk, a, I), E.integratorPrompt(tk, a, { ...I, trouble: ['conflict'], reviewHistory: history })],
    plannerPrompt: states.map((st) => E.plannerPrompt(tk, a, st, '')),
    planReviserPrompt: [E.planReviserPrompt(tk, 'PLAN', history, 2, a)],
  }
}

// The harness's framing of a computed task: its preamble line, then every line indented by two spaces.
export const frame = (prompt) => `${PREAMBLE}\n${prompt.split('\n').map((l) => `  ${l}`).join('\n')}`

// The hook's opener_links over each text, in one python3 call.
function openerLinks(texts) {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'note-overlap-opener-')))
  try {
    const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("hook", sys.argv[1])',
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      'print(json.dumps([m.opener_links(t) for t in json.load(sys.stdin)]))'].join('\n')
    const r = spawnSync('python3', ['-B', '-c', body, HOOK], { encoding: 'utf8', cwd: tmp, input: JSON.stringify(texts),
      env: { PATH: process.env.PATH, HOME: tmp, PYTHONDONTWRITEBYTECODE: '1', THREAD_EVENTS_DIR: path.join(tmp, 'events'),
        THREAD_NOTE_OVERLAP_DIR: path.join(tmp, 'state') } })
    assert.equal(r.status, 0, r.stderr)
    assert.ok(!fs.existsSync(path.join(tmp, 'events')) && !fs.existsSync(path.join(tmp, 'state')), 'reading an opener writes nothing')
    return JSON.parse(r.stdout)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// The builders whose framed prompts' openers do not begin with the task link and then the rollout link; [] when all do.
export function failing(prompts) {
  const flat = Object.entries(prompts).flatMap(([name, ps]) => ps.map((p) => [name, frame(p)]))
  const links = openerLinks(flat.map(([, t]) => t))
  const bad = new Set()
  flat.forEach(([name], i) => {
    if (JSON.stringify(links[i].slice(0, 2)) !== JSON.stringify([TASK, ROLLOUT])) bad.add(name)
  })
  return [...bad]
}

test('every task-agent builder opens with its task link, then its rollout link, inside the hook\'s opener window', () => {
  const prompts = render()
  assert.deepEqual(Object.keys(prompts).sort(), [...BUILDERS].sort())
  for (const [name, ps] of Object.entries(prompts)) assert.ok(ps.length > 0 && ps.every((p) => typeof p === 'string' && p.length > 0), name)
  assert.deepEqual(failing(prompts), [])
})

test('the builders the contract covers are every task-agent builder: the rest are the read-only judges', () => {
  const src = fs.readFileSync(enginePath, 'utf8')
  const all = [...src.matchAll(/^function (\w+Prompt)\(/gm)].map((m) => m[1]).sort()
  assert.deepEqual(all, [...BUILDERS, 'planJudgePrompt', 'reviewJudgePrompt', 'integrationReviewPrompt'].sort())
})

// ---- controls ---------------------------------------------------------------------------------------------------

test('control: a reviser opener reworded without links fails the reviser alone', () => {
  const src = fs.readFileSync(enginePath, 'utf8')
  const from = 'on your prior pass for [[${task.slug}]]\n(rollout [[${a.rolloutSlug}]]).'
  assert.equal(src.split(from).length, 2, 'control setup: the reviser opener appears once')
  const reworded = src.replace(from, 'on your prior pass for ${task.slug} (rollout ${a.rolloutSlug}).')
  assert.deepEqual(failing(render(reworded)), ['reviserPrompt'])
})

test('control: an opener pushed below the window fails', () => {
  const prompts = render()
  prompts.implementerPrompt = prompts.implementerPrompt.map((p) => `One line.\nTwo lines.\nThree lines.\n${p}`)
  assert.deepEqual(failing(prompts), ['implementerPrompt'])
  const swapped = render()
  swapped.plannerPrompt = swapped.plannerPrompt.map((p) => p.replace(`[[${TASK}]] from the rollout at [[${ROLLOUT}]]`, `[[${ROLLOUT}]] for [[${TASK}]]`))
  assert.deepEqual(failing(swapped), ['plannerPrompt'], 'the rollout link before the task link fails too')
})
