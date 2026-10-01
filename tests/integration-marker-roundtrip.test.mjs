// p12-6 (R2-1, R2-5): the engine's stage markers survive the trip through reconcile onto a task note, and
// the queue reads them back. This is the lead action L3 made mechanical: the engine side of the markers is
// pinned in skills/execute/tests/integrate.test.mjs; this file asserts the NOTE side against the real
// reconcile — p12-8's skills/execute/scripts/reconcile-rollout.py, whose per-run accumulation appends the
// engine's diagnosis as the latest `### Run` after any agent-written text, and whose `status` reads
// `setAsideAt` (any latest run starting `integration:` → integration) and `blockerSummary` (that latest run).
//
// Until p12-8 is on the base, every case SKIPs visibly. Whichever of p12-6 and p12-8 lands second runs it
// against the other's real code; if p12-8's CLI changes (`reconcile --result --tasks-dir --now`, or the
// status keys), this test is the contract to update in that PR.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runTask, loadEngine } from './lib/engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RECONCILE = path.join(root, 'skills', 'execute', 'scripts', 'reconcile-rollout.py')
const PRESENT = fs.existsSync(RECONCILE)
const SKIP = 'p12-8 reconcile-rollout.py not on this base'
const T = loadEngine(['parseIntegrationMarker', 'resumeArgsError', 'REVISE_MARKER'])

const sha = (c) => c.repeat(40)
const SLUG = 'proj-fix-a'
const ROLLOUT = 'proj-rollout-2026-10-01'
const PR = 'https://github.com/o/r/pull/7'
const BR = 'audit-fix/fix-a'
const WT = '/repo/.claude/worktrees/proj-fix-a'
const NOW = '2026-10-02T14:05:00Z'
const HIST2 = [{ round: 1, feedback: ['own-run fix'] }, { round: 2, feedback: ['keep their rename'], stage: 'integration' }]
const mkTask = (over = {}) => ({ slug: SLUG, taskPath: `/vault/Tasks/${SLUG}.md`, scope: 'cross-cutting', planGate: true, maxIterations: 3, maxReviewRounds: 4, maxPlanRounds: 3, model: 'fable', ...over })
const mkI = (over = {}) => ({
  prUrl: PR, branch: BR, worktreePath: WT, headSha: sha('a'), taskBase: sha('b'), mainSha: sha('c'), trouble: [], landed: [],
  plan: 'PLAN', reviewHistory: [{ round: 1, feedback: ['own-run fix'] }], reviewRoundsUsed: 1,
  rung: { model: 'fable', escalated: false, escalatedAt: '', tierCapped: false, tierCappedAt: '' }, ...over,
})
const base = { rolloutSlug: ROLLOUT, repoPath: '/repo', verifier: 'make test', date: '2026-10-01' }
const merged = {
  blocked: false, blockerDiagnosis: '', verified: true, mergeState: 'merged', mergeCommit: sha('d'), taskHead: sha('a'),
  baseSha: sha('c'), headSha: sha('d'), pushedSha: sha('d'), conflictFiles: ['a.js'], fixCommits: [], summary: 's', finishedAt: NOW,
  mergeLog: `anchor: ${sha('a')} base ${sha('b')}\ntask head: ${sha('a')}\nintegration base: ${sha('c')}\ntask file: a.js\nmerge: conflict\nconflict: a.js`,
}
async function row(args, script) {
  const r = await runTask(args, async (prompt, o) => {
    if (!(o.label in script)) throw new Error('stub: unknown agent label ' + o.label)
    return script[o.label]
  })
  assert.equal(r.error, undefined, String(r.error))
  return r.result
}
// The engine rows, built by the engine itself (the d1, e1 and S6 shapes of integrate.test.mjs).
const rejected = () => row({ ...base, mode: 'integrate', task: mkTask(), integration: mkI() }, {
  [`integrate:${SLUG}`]: merged, [`integration-review:${SLUG} r2`]: { verdict: 'changes', feedback: ['keep their rename', 'restore b.js'], unreadable: false, finishedAt: NOW },
})
const setAside = () => row({ ...base, mode: 'integrate', task: mkTask(), integration: mkI() }, {
  [`integrate:${SLUG}`]: { ...merged, blocked: true, mergeState: 'none', mergeLog: '', blockerDiagnosis: 'conflict in a.js cannot be resolved' },
})
const seededStop = () => row({
  ...base, task: mkTask({ resume: { stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, reviewHistory: HIST2, reviewRoundsUsed: 2, plan: 'PLAN' } }),
}, { [`revise:${SLUG} r3`]: { verified: false, blocked: true, escalate: false, prUrl: PR, branch: BR, worktreePath: WT, blockerDiagnosis: 'red after three iterations', summary: '' } })

// A temp tasks dir: the rollout note and one in-progress task linked to it (optionally carrying an
// agent-written `## Blocker diagnosis` paragraph, as the Ralph-loop and planner prompts leave one).
function vault(agentParagraph) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p126-roundtrip-'))
  fs.writeFileSync(path.join(d, `${ROLLOUT}.md`), '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 3\n---\n\n## Notes\n')
  fs.writeFileSync(path.join(d, `${SLUG}.md`), '---\ntags: [task]\nstatus: in_progress\nscope: cross-cutting\n' +
    `rollout: "[[${ROLLOUT}]]"\n---\n\n## Notes\n\nbody\n` + (agentParagraph ? `\n## Blocker diagnosis\n\n${agentParagraph}\n` : ''))
  return d
}
const py = (args) => execFileSync('python3', [RECONCILE, ...args], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', PYTHONDONTWRITEBYTECODE: '1' } })
function reconcile(d, result) {
  const f = path.join(d, 'result.json')
  fs.writeFileSync(f, JSON.stringify(result))
  py(['reconcile', '--result', f, '--tasks-dir', d, '--now', NOW])
  fs.rmSync(f)
}
function status(d) {
  const out = JSON.parse(py(['status', '--rollout', path.join(d, `${ROLLOUT}.md`), '--tasks-dir', d, '--now', NOW]))
  return out.tasks.find((t) => t.slug === SLUG)
}
const AGENT = 'The verifier went red on the own run: a missing fixture. Re-run after adding it.'

test('x1: a rejection reconciled over an agent paragraph reads back as setAsideAt run with the revise marker', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault(AGENT)
  try {
    const res = await rejected()
    const r = res.tasks[0]
    assert.equal(r.status, 'blocked')
    reconcile(d, res)
    const s = status(d)
    assert.equal(s.queueState, 'set-aside')
    assert.equal(s.setAsideAt, 'run')
    assert.equal(s.blockerSummary.split('\n')[0], T.REVISE_MARKER)
    assert.ok(!s.blockerSummary.includes('missing fixture'), 'the latest run is the engine marker, not the agent text')
    assert.ok(fs.readFileSync(path.join(d, `${SLUG}.md`), 'utf8').includes(AGENT), 'the agent text is kept')
    const parsed = T.parseIntegrationMarker(s.blockerSummary)
    assert.equal(parsed.stage, 'revise')
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.history)), r.reviewHistory)
    const last = parsed.history[parsed.history.length - 1]
    const resume = { stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, reviewHistory: parsed.history, reviewRoundsUsed: last.round, plan: 'PLAN' }
    assert.equal(T.resumeArgsError({ ...base, task: mkTask({ resume }) }), '')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('x2: an Integration set-aside reconciled on top reads back as setAsideAt integration', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault(AGENT)
  try {
    reconcile(d, await rejected())
    reconcile(d, await setAside())
    const s = status(d)
    assert.equal(s.setAsideAt, 'integration')
    assert.ok(s.blockerSummary.startsWith('integration: conflict in a.js cannot be resolved'))
    assert.equal(T.parseIntegrationMarker(s.blockerSummary).stage, 'integrate')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('x3: a seeded revise that stopped reads back as setAsideAt run, stage revise, with its revise stopped: line', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault(AGENT)
  try {
    reconcile(d, await seededStop())
    const s = status(d)
    assert.equal(s.setAsideAt, 'run')
    const parsed = T.parseIntegrationMarker(s.blockerSummary)
    assert.equal(parsed.stage, 'revise')
    assert.equal(parsed.reason, 'red after three iterations')
    assert.ok(s.blockerSummary.split('\n').includes('revise stopped: red after three iterations'))
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.history)), HIST2)
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('x4: a rejection after an integration: run goes back to setAsideAt run', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault('')
  try {
    reconcile(d, await setAside())
    assert.equal(status(d).setAsideAt, 'integration')
    reconcile(d, await rejected())
    const s = status(d)
    assert.equal(s.setAsideAt, 'run')
    assert.equal(T.parseIntegrationMarker(s.blockerSummary).stage, 'revise')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('x5: re-reconciling the same row leaves the note byte-identical', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault(AGENT)
  try {
    const res = await rejected()
    reconcile(d, res)
    const note = path.join(d, `${SLUG}.md`)
    const once = fs.readFileSync(note, 'utf8')
    reconcile(d, res)
    assert.equal(fs.readFileSync(note, 'utf8'), once)
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})
