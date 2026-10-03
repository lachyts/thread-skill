// p12-6 (ADR 0030 decision 4: a set-aside task resumes at the stage it stopped): the engine's stage markers
// survive the trip through reconcile onto a task note, and the queue reads them back. The engine side of the
// markers is pinned in skills/execute/tests/integrate.test.mjs; this file asserts the NOTE side against the real
// reconcile — p12-8's skills/execute/scripts/reconcile-rollout.py, whose per-run accumulation appends the
// engine's diagnosis as the latest `### Run` after any agent-written text, and whose `status` reads
// `setAsideAt` (any latest run starting `integration:` → integration) and `blockerSummary` (that latest run).
// p12-16: reconcile also writes the Integration log — one `## Integration log` line per integrate row and the
// `ready:` stamp the lead passes back as integration.readyAt. x7–x12 read both back from engine-built rows.
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
const mkTask = (over = {}) => ({ slug: SLUG, taskPath: `/vault/Tasks/${SLUG}.md`, scope: 'cross-cutting', planGate: true, maxIterations: 3, maxReviewRounds: 4, maxPlanRounds: 3, rung: 'opus-xhigh', ...over })
const mkI = (over = {}) => ({
  prUrl: PR, branch: BR, worktreePath: WT, headSha: sha('a'), taskBase: sha('b'), mainSha: sha('c'), trouble: [], landed: [],
  plan: 'PLAN', reviewHistory: [{ round: 1, feedback: ['own-run fix'] }], reviewRoundsUsed: 1,
  rung: { startRung: 'opus-high', rung: 'opus-xhigh', climbs: [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }] }, ...over,
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
  fs.writeFileSync(path.join(d, `${ROLLOUT}.md`), '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\n---\n\n## Notes\n')
  fs.writeFileSync(path.join(d, `${SLUG}.md`), '---\ntags: [task]\nstatus: in_progress\nscope: cross-cutting\n' +
    `rollout: "[[${ROLLOUT}]]"\n---\n\n## Notes\n\nbody\n` + (agentParagraph ? `\n## Blocker diagnosis\n\n${agentParagraph}\n` : ''))
  return d
}
const py = (args) => execFileSync('python3', [RECONCILE, ...args], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC', PYTHONDONTWRITEBYTECODE: '1' } })
function reconcile(d, result, now = NOW) {
  const f = path.join(d, 'result.json')
  fs.writeFileSync(f, JSON.stringify(result))
  py(['reconcile', '--result', f, '--tasks-dir', d, '--now', now])
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

test('x6: a rejection on the last round reads back as review-blocked, its history parseable for the seeded resume', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault('')
  try {
    const res = await row({ ...base, mode: 'integrate', task: mkTask({ maxReviewRounds: 2 }), integration: mkI() }, {
      [`integrate:${SLUG}`]: merged, [`integration-review:${SLUG} r2`]: { verdict: 'changes', feedback: ['keep their rename'], unreadable: false, finishedAt: NOW },
    })
    const r = res.tasks[0]
    assert.equal(r.status, 'review-blocked')
    assert.equal(r.integration.outcome, 'rejected', 'the live row says Integration; the note alone does not (the Integration log does)')
    reconcile(d, res)
    // The record the engine header's review-blocked seeded-resume rule reads: the latest log line is `rejected`.
    assert.deepEqual(logLines(d), [LINE('-', 'rejected', `head=${sha('d')} base=${sha('c')} wait=- duration=- triggers=conflict`)])
    const note = fs.readFileSync(path.join(d, `${SLUG}.md`), 'utf8')
    const from = note.slice(note.indexOf('## Review-blocked feedback'))
    const next = from.indexOf('\n## ')
    const sec = next < 0 ? from : from.slice(0, next)
    const run = sec.slice(sec.lastIndexOf('### Run'))
    assert.ok(!run.includes('## Integration log'), 'the run ends at the next ## section, not EOF')
    assert.ok(!run.includes('(Integration)'), 'reconcile writes plain Round N: groups (the stage is dropped)')
    const parsed = T.parseIntegrationMarker(run)
    assert.deepEqual(JSON.parse(JSON.stringify(parsed.history)), r.reviewHistory.map(({ round, feedback }) => ({ round, feedback })))
    const resume = { stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, reviewHistory: parsed.history, reviewRoundsUsed: 2, plan: 'PLAN' }
    assert.equal(T.resumeArgsError({ ...base, task: mkTask({ resume }) }), '')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

// ---- the Integration log (p12-16) ----
const integrated = (I = mkI()) => row({ ...base, mode: 'integrate', task: mkTask(), integration: I }, {
  [`integrate:${SLUG}`]: merged, [`integration-review:${SLUG} r2`]: { verdict: 'approve', feedback: [], unreadable: false, finishedAt: NOW },
})
const rejectedI = (I) => row({ ...base, mode: 'integrate', task: mkTask(), integration: I }, {
  [`integrate:${SLUG}`]: merged, [`integration-review:${SLUG} r2`]: { verdict: 'changes', feedback: ['keep their rename', 'restore b.js'], unreadable: false, finishedAt: NOW },
})
const setAsideI = (I, extra = {}) => row({ ...base, mode: 'integrate', task: mkTask(), integration: I }, {
  [`integrate:${SLUG}`]: { ...merged, blocked: true, mergeState: 'none', mergeLog: '', blockerDiagnosis: 'conflict in a.js cannot be resolved', ...extra },
})
const noteText = (d) => fs.readFileSync(path.join(d, `${SLUG}.md`), 'utf8')
function logLines(d) {
  const text = noteText(d)
  const i = text.indexOf('\n## Integration log\n')
  if (i < 0) return []
  const rest = text.slice(i + '\n## Integration log\n'.length)
  const j = rest.search(/^## /m)
  return (j < 0 ? rest : rest.slice(0, j)).split('\n').filter((l) => l.trim())
}
const fm = (d, key) => (noteText(d).match(new RegExp(`^${key}: (.*)$`, 'm')) || [])[1]
const LINE = (start, outcome, rest) => `${start} ${outcome} path=integrator pr=7 anchor=${sha('a')} ${rest}`
const T1 = '2026-10-02T13:20+00:00'
const T2 = '2026-10-02T13:40+00:00'

test('x7: an integrated row writes its exact log line; readyAt round-trips from the ready: stamp', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault('')
  try {
    reconcile(d, await integrated(mkI({ readyAt: '2026-10-02T13:00+00:00', startedAt: T1 })))
    assert.deepEqual(logLines(d), [LINE(T1, 'integrated', `head=${sha('d')} base=${sha('c')} wait=20 duration=45 triggers=conflict`)])
    assert.equal(fm(d, 'status'), 'review')
    assert.equal(fm(d, 'ready'), undefined, 'an Integration row never stamps ready:')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
  const d2 = vault('')
  try {
    reconcile(d2, { rolloutSlug: ROLLOUT, tasks: [{ slug: SLUG, scope: 'cross-cutting', status: 'review', prUrl: PR, reviewRoundsUsed: 1, planRoundsUsed: 0 }] }, '2026-10-02T13:00:00Z')
    const readyAt = fm(d2, 'ready')
    assert.equal(readyAt, '2026-10-02T13:00+00:00')
    const res = await integrated(mkI({ readyAt, startedAt: T1 }))
    assert.equal(typeof res.tasks[0].integration.metrics.waitMinutes, 'number', "isoMinutes parses _stamp's form")
    assert.equal(res.tasks[0].integration.metrics.waitMinutes, 20)
    reconcile(d2, res)
    assert.match(logLines(d2)[0], / wait=20 duration=45 /)
    assert.equal(fm(d2, 'ready'), readyAt, 'the integrated row leaves ready: alone')
  } finally { fs.rmSync(d2, { recursive: true, force: true }) }
})

test('x8: a rejected and a set-aside row each append one line; the x2 sequence ends set-aside', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault('')
  try {
    reconcile(d, await rejected())
    assert.deepEqual(logLines(d), [LINE('-', 'rejected', `head=${sha('d')} base=${sha('c')} wait=- duration=- triggers=conflict`)])
    reconcile(d, await setAside())
    const lines = logLines(d)
    assert.equal(lines.length, 2)
    assert.equal(lines[1], LINE('-', 'set-aside', 'head=- base=- wait=- duration=- triggers=-'))
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('x9: a gate-pending set-aside reads back as gate-pending with a latest set-aside line', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault('')
  try {
    const res = await setAsideI(mkI({ startedAt: T1 }), { blockerDiagnosis: 'needs a paid API', gatedInputs: ['spend: a paid API — cap $5'] })
    assert.equal(res.tasks[0].status, 'gate-pending')
    reconcile(d, res)
    assert.equal(fm(d, 'status'), 'gate-pending')
    const lines = logLines(d)
    assert.ok(lines[lines.length - 1].startsWith(`${T1} set-aside `), lines.join('\n'))
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('x10: re-reconciling an integrated row leaves the note byte-identical, one line', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault(AGENT)
  try {
    const res = await integrated(mkI({ startedAt: T1 }))
    reconcile(d, res)
    const once = noteText(d)
    reconcile(d, res, '2026-10-03T09:00:00Z')
    assert.equal(noteText(d), once)
    assert.equal(logLines(d).length, 1)
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test("x11: with no startedAt (today's default) set-aside, integrated, set-aside keeps three lines", async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault('')
  try {
    reconcile(d, await setAside())
    reconcile(d, await integrated())
    reconcile(d, await setAside())
    const lines = logLines(d)
    assert.deepEqual(lines.map((l) => l.split(' ').slice(0, 2).join(' ')), ['- set-aside', '- integrated', '- set-aside'])
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('x12: with startedAt, an older row replayed after a newer one adds no log line', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault('')
  try {
    const rej = await rejectedI(mkI({ startedAt: T1 }))
    reconcile(d, rej)
    reconcile(d, await setAsideI(mkI({ startedAt: T2 })))
    const before = logLines(d)
    assert.equal(before.length, 2)
    reconcile(d, rej)
    // The log is byte-identical. The note as a whole is not: `## Blocker diagnosis` keeps p6-4's A/B/A rule
    // (a replayed marker is appended again as the latest run) — the reason p12-9's lead reconciles in order.
    assert.deepEqual(logLines(d), before)
    assert.ok(logLines(d)[1].startsWith(`${T2} set-aside `))
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})
