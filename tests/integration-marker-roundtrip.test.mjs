// p12-6 (ADR 0030 decision 4: a set-aside task resumes at the stage it stopped): the engine's stage markers
// survive the trip through reconcile onto a task note, and the queue reads them back. The engine side of the
// markers is pinned in skills/execute/tests/integrate.test.mjs; this file asserts the NOTE side against the real
// reconcile — p12-8's skills/execute/scripts/reconcile-rollout.py, whose per-run accumulation appends the
// engine's diagnosis as the latest `### Run` after any agent-written text, and whose `status` reads
// `setAsideAt` (any latest run starting `integration:` → integration) and `blockerSummary` (that latest run).
// p14-2: x13–x15 carry the approved plan from the plan-gate to Integration and a seeded revise through the note's
// `## Approved plan` (reconcile writes it from the own call's row; `lead-integrate.py plan` reads it back for the
// seeded revise, and the integrator reads it from the note itself, p27-1: the integrate args carry no plan).
// p12-16: reconcile also writes the Integration log — one `## Integration log` line per integrate row and the
// `ready:` stamp the lead passes back as integration.readyAt. x7–x12 read both back from engine-built rows.
//
// Until p12-8 is on the base, every case SKIPs visibly. Whichever of p12-6 and p12-8 lands second runs it
// against the other's real code; if p12-8's CLI changes (`reconcile --result --tasks-dir --now`, or the
// status keys), this test is the contract to update in that PR.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { runTask, loadEngine, VERIFY_SLOT } from './lib/engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RECONCILE = path.join(root, 'skills', 'execute', 'scripts', 'reconcile-rollout.py')
const LEAD_INTEGRATE = path.join(root, 'skills', 'execute', 'scripts', 'lead-integrate.py')
const PRESENT = fs.existsSync(RECONCILE)
const SKIP = 'p12-8 reconcile-rollout.py not on this base'
// The Run record (run_record.py, ADR 0032) the scripts may append lands in temp, never ~/.local/state.
const EVENTS = fs.mkdtempSync(path.join(os.tmpdir(), 'imr-events-'))
after(() => fs.rmSync(EVENTS, { recursive: true, force: true }))
const PY_ENV = { ...process.env, TZ: 'UTC', PYTHONDONTWRITEBYTECODE: '1', THREAD_EVENTS_DIR: process.env.THREAD_TEST_EVENTS_DIR || path.join(EVENTS, 'events') }
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
  reviewHistory: [{ round: 1, feedback: ['own-run fix'] }], reviewRoundsUsed: 1,
  rung: { startRung: 'opus-high', rung: 'opus-xhigh', climbs: [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }] }, ...over,
})
// args.verifySlot is required (estate ADR 0009 d4): every call carries one.
const base = { rolloutSlug: ROLLOUT, repoPath: '/repo', verifier: 'make test', date: '2026-10-01',
  verifySlot: VERIFY_SLOT }
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
// status resolves the rollout's absent parallel_ceiling through rollout-settings.py (~/.config/thread/rollouts.toml,
// p15-4): HOME is an empty dir of this suite's own, so the operator's file never reaches the assertions.
const SETTINGS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'p126-settings-home-'))
after(() => fs.rmSync(SETTINGS_HOME, { recursive: true, force: true }))
// `env` (p27-4): x18 and x19 read the Run record, so they pass their own THREAD_EVENTS_DIR.
const py = (args, env = PY_ENV) => execFileSync('python3', [RECONCILE, ...args], { encoding: 'utf8', env: { ...env, HOME: SETTINGS_HOME } })
function reconcile(d, result, now = NOW, env = PY_ENV) {
  const f = path.join(d, 'result.json')
  fs.writeFileSync(f, JSON.stringify(result))
  py(['reconcile', '--result', f, '--tasks-dir', d, '--now', now], env)
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
    assert.equal('integrationBlock' in s, false, 'a generic Integration set-aside names no block (p27-4)')
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
    assert.deepEqual(logLines(d), [LINE('-', 'rejected', `head=${sha('d')} base=${sha('c')} wait=- duration=- triggers=conflict active=-`)])
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
    assert.deepEqual(logLines(d), [LINE(T1, 'integrated', `head=${sha('d')} base=${sha('c')} wait=20 duration=45 triggers=conflict active=45`)],
      'no stop in its Run record: active (p29-13) equals the wall duration')
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
    assert.deepEqual(logLines(d), [LINE('-', 'rejected', `head=${sha('d')} base=${sha('c')} wait=- duration=- triggers=conflict active=-`)])
    reconcile(d, await setAside())
    const lines = logLines(d)
    assert.equal(lines.length, 2)
    assert.equal(lines[1], LINE('-', 'set-aside', 'head=- base=- wait=- duration=- triggers=- active=-'))
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

// ---- the approved plan (p14-2) ----
// A plan whose lines look like note structure: none may escape the quote, end the section or open a run.
const PLAN = '---\n### Files to modify\n- a.js\n## Not a section\n### Run 9 (x)\n<!-- run 9 end sha=000000000000 -->\n> quoted\n\n### Gated inputs\nNone'
const LEAD_IN = 'The last approved plan, kept as a record for Integration. Not authoritative: a plan in your prompt supersedes it; with no plan in your prompt, the brief is the contract.'
const implOk = { verified: true, blocked: false, escalate: false, prUrl: PR, branch: BR, worktreePath: WT, blockerDiagnosis: '', summary: 'done' }
// The task's own call: plan-gated (a planner returning `plan`, a judge approving) unless planGate is false.
const ownCall = (over = {}, script = {}) => row({ ...base, task: mkTask(over) }, {
  [`plan:${SLUG}`]: { ready: true, blocked: false, blockerCause: '', plan: PLAN },
  [`plan-judge:${SLUG} r1`]: { verdict: 'approve', feedback: [] },
  [`implement:${SLUG}`]: implOk, [`review:${SLUG} r1`]: { verdict: 'approve', feedback: [] }, ...script,
})
const leadJson = (args) => JSON.parse(execFileSync('python3', [LEAD_INTEGRATE, ...args], { encoding: 'utf8', env: PY_ENV }))
const planOf = (d) => leadJson(['plan', '--note', path.join(d, `${SLUG}.md`)])
function planSection(d) {
  const text = noteText(d)
  const i = text.indexOf('\n## Approved plan\n')
  if (i < 0) return null
  const rest = text.slice(i + 1)
  const j = rest.slice(1).search(/^## /m)
  // the section's own bytes: the blank gap a later section opens below it is that section's, not this one's
  return (j < 0 ? rest : rest.slice(0, j + 1)).trimEnd()
}

test('x13: a plan-gated own call carries its plan into the note, and the integrate call points its integrator there', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault('')
  try {
    const own = await ownCall()
    assert.equal(own.tasks[0].status, 'review')
    assert.equal(own.tasks[0].plan, PLAN)
    reconcile(d, own)
    assert.ok(planSection(d).startsWith(`## Approved plan\n\n${LEAD_IN}\n\n> ---\n> ### Files to modify\n`), planSection(d))
    const out = planOf(d)
    assert.deepEqual(Object.keys(out).sort(), ['plan', 'slug'])
    assert.equal(out.plan, PLAN, 'lead-integrate.py plan reads back the exact plan (the seeded revise still takes it)')
    const section = planSection(d)
    const I = mkI()
    const r = await runTask({ ...base, mode: 'integrate', task: mkTask(), integration: I }, async (prompt, o) => {
      if (o.label === `integrate:${SLUG}`) return merged
      if (o.label === `integration-review:${SLUG} r2`) return { verdict: 'changes', feedback: ['keep their rename'], unreadable: false, finishedAt: NOW }
      throw new Error('stub: unknown agent label ' + o.label)
    })
    assert.equal(r.error, undefined, String(r.error))
    const p = r.calls.find((c) => c.label === `integrate:${SLUG}`).prompt
    // p27-1: the integrate args carry no plan; the prompt sends the integrator to the note's section instead.
    assert.ok(p.includes(`Task note (the brief): /vault/Tasks/${SLUG}.md`), 'the prompt names the task note')
    assert.ok(p.includes('read the `## Approved plan` section'), "the prompt points at the note's approved plan")
    assert.ok(!p.includes(PLAN), 'the prompt never renders the plan')
    assert.ok(!p.includes('(no plan:'), 'not the old no-plan placeholder')
    const ir = JSON.parse(JSON.stringify(r.result))
    assert.equal(ir.tasks[0].plan, null)
    reconcile(d, ir)
    assert.equal(planSection(d), section, 'an integrate row leaves the section byte-identical')
    const s = status(d)
    assert.equal(s.queueState, 'set-aside')
    assert.equal(s.setAsideAt, 'run')
    assert.equal(s.blockerSummary.split('\n')[0], T.REVISE_MARKER, 'the plan never reads as the latest run')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

// p27-1: in thread-skill-rollout-2026-10-19 three plans of 40k to 71k characters had to be hand-copied into the
// integrate call's args, and one copy was cut off part-way. The integrate args now carry no plan at all: the
// integrator reads the note's `## Approved plan` from the path its prompt names.
test('x13b: a plan over 60k characters reaches its integrate call without the lead transcribing anything', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault('')
  try {
    const steps = Array.from({ length: 1500 }, (_, i) => `- step ${i}: ` + 'x'.repeat(40))
    const BIG = 'Planned on: abc\n### Files to modify\n' + steps.join('\n') + '\n### Gated inputs\nNone'
    assert.ok(BIG.length > 60000, `the plan is over 60k characters (${BIG.length})`)
    const own = await ownCall({}, { [`plan:${SLUG}`]: { ready: true, blocked: false, blockerCause: '', plan: BIG } })
    assert.equal(own.tasks[0].status, 'review')
    assert.equal(own.tasks[0].plan, BIG)
    reconcile(d, own)
    assert.ok(planSection(d).includes('> - step 1499: '), 'the whole plan is in the note')
    const section = planSection(d)
    // reconcile resolves <tasks-dir>/<slug>.md (engine rows carry no taskPath), so NOTE is the note it wrote.
    const NOTE = path.join(d, `${SLUG}.md`)
    // Built without a plan key whatever mkI's default is, so the base engine's `plan must be a string` fails it.
    const { plan: _p, ...I } = mkI()
    const args = { ...base, mode: 'integrate', task: mkTask({ taskPath: NOTE }), integration: I }
    assert.ok(!('plan' in args.integration), 'the integrate args carry no plan')
    assert.ok(JSON.stringify(args).length < 10000, `the integrate args stay small (${JSON.stringify(args).length})`)
    const r = await runTask(args, async (prompt, o) => {
      if (o.label === `integrate:${SLUG}`) return merged
      if (o.label === `integration-review:${SLUG} r2`) return { verdict: 'approve', feedback: [], unreadable: false, finishedAt: NOW }
      throw new Error('stub: unknown agent label ' + o.label)
    })
    assert.equal(r.error, undefined, String(r.error))
    const p = r.calls.find((c) => c.label === `integrate:${SLUG}`).prompt
    assert.ok(p.includes(`Task note (the brief): ${NOTE}`), 'the prompt names the note')
    assert.ok(p.includes('read the `## Approved plan` section of the task note above (' + NOTE + ')'), 'and sends the integrator to its plan')
    assert.ok(!p.includes('- step 0: ') && !p.includes('x'.repeat(40)), 'the prompt carries none of the plan')
    assert.ok(p.length < 40000, `the integrator prompt stays small (${p.length})`)
    const text = fs.readFileSync(NOTE, 'utf8')
    assert.ok(text.includes('\n## Approved plan\n') && text.includes('> - step 1499: '), 'the path the integrator is told to read holds the whole plan')
    const ir = JSON.parse(JSON.stringify(r.result))
    assert.equal(ir.tasks[0].plan, null)
    reconcile(d, ir)
    assert.equal(planSection(d), section, 'an integrate row leaves the section byte-identical')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('x14: a seeded revise takes resume.plan from the note; its step-back renders it; its row leaves it', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault('')
  try {
    reconcile(d, await ownCall())
    reconcile(d, await rejected())
    const section = planSection(d)
    assert.ok(section && section.includes('> ## Not a section'))
    const inputs = leadJson(['inputs', '--note', path.join(d, `${SLUG}.md`), '--repo', '/repo'])
    const resume = {
      stage: 'revise', prUrl: inputs.prUrl, branch: inputs.branch, worktreePath: inputs.worktreePath,
      reviewHistory: inputs.history, reviewRoundsUsed: inputs.lastRound, plan: planOf(d).plan,
    }
    assert.equal(resume.plan, PLAN)
    assert.equal(T.resumeArgsError({ ...base, task: mkTask({ resume }) }), '')
    assert.ok(resume.reviewRoundsUsed >= 2, 'the revise runs at round >= 3: the step-back round')
    const r = await runTask({ ...base, task: mkTask({ resume }) }, async (prompt, o) => {
      if (o.label === `revise:${SLUG} r3`) return implOk
      if (o.label === `review:${SLUG} r3`) return { verdict: 'approve', feedback: [] }
      throw new Error('stub: unknown agent label ' + o.label)
    })
    assert.equal(r.error, undefined, String(r.error))
    const p = r.calls.find((c) => c.label === `revise:${SLUG} r3`).prompt
    assert.ok(p.includes('STEP-BACK ROUND'))
    assert.ok(p.includes(`The ORIGINAL APPROVED PLAN, for reference:\n---\n${PLAN}\n---`), 'the step-back carries the plan')
    const res = JSON.parse(JSON.stringify(r.result))
    assert.equal(res.tasks[0].status, 'review')
    assert.equal(res.tasks[0].plan, null)
    reconcile(d, res)
    assert.equal(planSection(d), section, 'a seeded-revise row leaves the section byte-identical')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('x15: only a later own call settles the plan — no-outcome rows keep it, a non-gated call removes it', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault('')
  try {
    reconcile(d, await ownCall())
    const section = planSection(d)
    assert.ok(section)
    const planBlocked = await ownCall({ maxPlanRounds: 1 }, { [`plan-judge:${SLUG} r1`]: { verdict: 'changes', feedback: ['no'] } })
    assert.equal(planBlocked.tasks[0].status, 'plan-blocked')
    assert.equal(planBlocked.tasks[0].plan, null)
    reconcile(d, planBlocked)
    assert.equal(planSection(d), section, 'a plan-blocked row keeps the last approved plan')
    const gated = await ownCall({}, { [`plan:${SLUG}`]: { ready: true, blocked: false, blockerCause: '', plan: 'P2\n### Gated inputs\n- spend: an API — cap $5' } })
    assert.equal(gated.tasks[0].status, 'gate-pending')
    assert.equal(gated.tasks[0].plan, null)
    reconcile(d, gated)
    assert.equal(planSection(d), section, 'a plan-gate gate-pending row keeps it')
    const plain = await ownCall({ planGate: false })
    assert.equal(plain.tasks[0].status, 'review')
    assert.equal(plain.tasks[0].plan, '')
    reconcile(d, plain)
    assert.equal(planSection(d), null, "a non-gated own call's '' removes the stale plan")
    assert.ok(!noteText(d).includes(LEAD_IN))
    const out = planOf(d)
    assert.equal(out.plan, '')
    const I = mkI()
    const r = await runTask({ ...base, mode: 'integrate', task: mkTask({ planGate: false }), integration: I }, async (prompt, o) => {
      if (o.label === `integrate:${SLUG}`) return merged
      if (o.label === `integration-review:${SLUG} r2`) return { verdict: 'approve', feedback: [], unreadable: false, finishedAt: NOW }
      throw new Error('stub: unknown agent label ' + o.label)
    })
    assert.equal(r.error, undefined, String(r.error))
    // p27-1: the note has no section (asserted above), and the prompt says what that means.
    assert.ok(r.calls[0].prompt.includes('read the `## Approved plan` section'))
    assert.ok(r.calls[0].prompt.includes("No such section: the task's last own call"))
    assert.ok(!r.calls[0].prompt.includes('(no plan:'))
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

// ---- an Integration conflict and a verifier red at Integration, by name (p27-4) ----
// The engine builds both rows itself (integrate.test.mjs e1b / e1d pin the engine side); the real reconcile writes
// them, and the real status, lead-integrate.py inputs and the Run record read them back by name.
const LANDED = [{ prUrl: 'https://github.com/o/r/pull/5', title: 'theirs: rename', files: ['a.js', 'b.js'], taskPath: '/vault/Tasks/proj-theirs.md' }]
const CONFLICT_LOG = [`anchor: ${sha('a')} base ${sha('b')}`, `task head: ${sha('a')}`, `integration base: ${sha('c')}`,
  'task file: a.js', 'task file: b.js', 'merge: conflict', 'conflict: a.js', 'conflict: b.js'].join('\n')
const CONFLICT_DIAG = 'a.js: theirs renamed foo, ours edits foo; porting ours drops their guard\nb.js: theirs deleted the export ours calls'
const MARK = 'integration: conflict unresolved in a.js, b.js'
// An unresolvable conflict, aborted: blockKind conflict and the merge step's verbatim log (the evidence).
const conflictAside = () => row({ ...base, mode: 'integrate', task: mkTask(), integration: mkI({ landed: LANDED, reviewHistory: HIST2, reviewRoundsUsed: 2 }) }, {
  [`integrate:${SLUG}`]: {
    ...merged, blocked: true, blockKind: 'conflict', verified: false, mergeState: 'none', mergeCommit: '', headSha: sha('a'), pushedSha: '',
    mergeLog: CONFLICT_LOG, conflictFiles: ['a.js', 'b.js'], blockerDiagnosis: CONFLICT_DIAG,
  },
})
// A conflict resolved, then the verifier still red at the loop's end: red, never conflict.
const redAside = () => row({ ...base, mode: 'integrate', task: mkTask(), integration: mkI() }, {
  [`integrate:${SLUG}`]: { ...merged, blocked: true, blockKind: 'red', verified: false, blockerDiagnosis: 'make test still red after 3 iterations' },
})
const leadIn = (args) => JSON.parse(execFileSync('python3', [LEAD_INTEGRATE, ...args], { encoding: 'utf8', env: { ...PY_ENV, HOME: SETTINGS_HOME } }))
const NOTE_REASON = [
  'import importlib.util, json, sys', 'from pathlib import Path',
  'spec = importlib.util.spec_from_file_location("reconcile_rollout", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
  'print(json.dumps(m._note_reason(m.Note(Path(sys.argv[2])))))',
].join('\n')
const stampTask = (d, line) => {
  const p = path.join(d, `${SLUG}.md`)
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('---\ntags: [task]\n', `---\ntags: [task]\n${line}\n`))
}

test('x16: an Integration conflict reads back by name — status, inputs (markerReason, history, resumeAt) and _note_reason', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault(AGENT)
  stampTask(d, `pr: ${PR}`) // the approved PR, as a lane holder's note carries it (no pr: is repair's own class)
  try {
    const res = await conflictAside()
    assert.equal(res.tasks[0].blockerDiagnosis.split('\n')[0], MARK)
    reconcile(d, res)
    const s = status(d)
    assert.equal(s.queueState, 'set-aside')
    assert.equal(s.setAsideAt, 'integration')
    assert.equal(s.integrationBlock, 'conflict')
    assert.equal(s.blockerSummary.split('\n')[0], MARK)
    for (const k of ['Resolution brief (Integration conflict)', '- Conflicting paths: a.js, b.js',
      '- Theirs: https://github.com/o/r/pull/5 (theirs: rename) touched a.js, b.js; brief /vault/Tasks/proj-theirs.md',
      `- Theirs, in full: git log --first-parent ${sha('b')}..${sha('c')}`,
      '- The integrator:\n  - a.js: theirs renamed foo, ours edits foo; porting ours drops their guard\n  - b.js: theirs deleted the export ours calls\n- Next: ']) {
      assert.ok(s.blockerSummary.includes(k), `the brief is kept: ${k}`)
    }
    assert.ok(!s.blockerSummary.includes('missing fixture'), 'the latest run is the engine marker, not the agent text')
    // the cold read a re-entering lead makes (execute § 4.5 step 1.2, repair § 3b)
    const note = path.join(d, `${SLUG}.md`)
    const inputs = leadIn(['inputs', '--note', note])
    assert.equal(inputs.resumeAt, 'integration')
    assert.equal(inputs.markerStage, 'integrate')
    assert.equal(inputs.markerReason, 'conflict unresolved in a.js, b.js')
    assert.deepEqual(inputs.history, HIST2, 'round 2 keeps its Integration stage; no brief bullet leaks into the history')
    assert.equal(inputs.lastRound, 2)
    const kr = JSON.parse(execFileSync('python3', ['-c', NOTE_REASON, RECONCILE, note], { encoding: 'utf8', env: PY_ENV }))
    assert.deepEqual(kr, ['integration', 'conflict unresolved in a.js, b.js'])
    // humanFix for this block: fresh, it is the lead's automatic retry (status's example line); with the budget off
    // it is Lachy's, and the reason repair quotes beside humanFix is markerReason (the first line), the brief beneath.
    assert.equal(inputs.autoRetry, true, JSON.stringify([inputs.autoRetryWhy, inputs.autoRetryError]))
    assert.equal(inputs.humanFix, null)
    stampTask(d, 'auto_retries: 0')
    const off = leadIn(['inputs', '--note', note])
    assert.equal(off.autoRetry, false)
    assert.equal(off.humanFix && off.humanFix.act, 'hand back or defer', JSON.stringify(off.humanFix))
    assert.equal(off.markerReason, 'conflict unresolved in a.js, b.js')
    assert.equal(status(d).integrationBlock, 'conflict')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

test('x17: a verifier red at Integration reads back by name, distinct from a conflict', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const d = vault(AGENT)
  try {
    reconcile(d, await redAside())
    const s = status(d)
    assert.equal(s.setAsideAt, 'integration')
    assert.equal(s.integrationBlock, 'red')
    assert.ok(s.blockerSummary.split('\n')[0].startsWith('integration: verifier red: '), s.blockerSummary)
    const inputs = leadIn(['inputs', '--note', path.join(d, `${SLUG}.md`)])
    assert.ok(inputs.markerReason.startsWith('verifier red: '), inputs.markerReason)
    assert.equal(inputs.resumeAt, 'integration')
  } finally { fs.rmSync(d, { recursive: true, force: true }) }
})

// A lane holder (`review`, a PR, `ready:`), marked integrating, then the engine-built row reconciled, under its own
// events dir: this test reads the record, so it ignores THREAD_TEST_EVENTS_DIR (the record suite's rule). Returns
// the kinds after lane-taken, lane-freed and set-aside.
async function recordOf(result) {
  const ev = fs.mkdtempSync(path.join(os.tmpdir(), 'imr-record-'))
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p274-record-'))
  const env = { ...PY_ENV, THREAD_EVENTS_DIR: ev }
  try {
    fs.writeFileSync(path.join(d, `${ROLLOUT}.md`), '---\ntags: [task, rollout]\nstatus: in_progress\nprotocol_version: 5\n---\n\n## Notes\n')
    fs.writeFileSync(path.join(d, `${SLUG}.md`), '---\ntags: [task]\nstatus: review\nscope: cross-cutting\n' +
      `pr: ${PR}\nready: 2026-10-02T13:00+00:00\nrollout: "[[${ROLLOUT}]]"\n---\n\n## Notes\n\nbody\n`)
    py(['mark-integrating', '--tasks', SLUG, '--tasks-dir', d, '--now', NOW], env)
    reconcile(d, await result(), NOW, env)
    const evs = fs.readFileSync(path.join(ev, `${ROLLOUT}.jsonl`), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    const after = evs.slice(evs.findIndex((e) => e.kind === 'lane-taken') + 1)
    const pick = (e, ks) => Object.fromEntries(ks.filter((k) => k in e).map((k) => [k, e[k]]))
    return {
      kinds: after.map((e) => e.kind),
      laneFreed: pick(after.find((e) => e.kind === 'lane-freed') || {}, ['release', 'path', 'triggers', 'conflict']),
      setAside: pick(after.find((e) => e.kind === 'set-aside') || {}, ['stage', 'reasonClass', 'setAsideAt']),
      laneTaken: evs.some((e) => e.kind === 'lane-taken'),
    }
  } finally {
    fs.rmSync(d, { recursive: true, force: true })
    fs.rmSync(ev, { recursive: true, force: true })
  }
}

test('x18: the Run record names an Integration conflict — lane-freed conflict true, set-aside integration-conflict', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const r = await recordOf(conflictAside)
  assert.ok(r.laneTaken, 'mark-integrating took the lane')
  assert.deepEqual(r.kinds, ['lane-freed', 'set-aside'])
  assert.deepEqual(r.laneFreed, { release: 'set-aside', path: 'integrator', triggers: ['conflict'], conflict: true })
  assert.deepEqual(r.setAside, { stage: 'integrate', reasonClass: 'integration-conflict', setAsideAt: 'integration' })
})

test('x19: a verifier red at Integration is integration-red with conflict false; a generic set-aside stays integration-set-aside', async (t) => {
  if (!PRESENT) return t.skip(SKIP)
  const red = await recordOf(redAside)
  assert.deepEqual(red.kinds, ['lane-freed', 'set-aside'])
  assert.deepEqual(red.laneFreed, { release: 'set-aside', path: 'integrator', triggers: [], conflict: false })
  assert.deepEqual(red.setAside, { stage: 'integrate', reasonClass: 'integration-red', setAsideAt: 'integration' })
  const generic = await recordOf(setAside)
  assert.deepEqual(generic.kinds, ['lane-freed', 'set-aside'])
  assert.deepEqual(generic.laneFreed, { release: 'set-aside', path: 'integrator', triggers: [], conflict: false })
  assert.deepEqual(generic.setAside, { stage: 'integrate', reasonClass: 'integration-set-aside', setAsideAt: 'integration' })
})
