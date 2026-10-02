// /thread:status and /thread:repair read the queue (ADR 0030, p12-11): the situational report groups a rollout's
// tasks by queue state and re-entry stage, and the conductor hands a set-aside task back at the stage it stopped
// (at Integration: Integration only), defers only its dependent closure, and never writes under a pause.
//
// Three fixtures run the landed scripts (reconcile-rollout.py, lead-integrate.py) on temp vaults, the set-aside
// notes written through the real writers (engine rows from task.workflow.js via tests/lib/engine.mjs, the lead's
// set-aside rows, reconcile): A is a status fixture with every queue state and every set-aside stage; B is an
// at-Integration set-aside handed back (Integration retried, nothing else); C is B under a draining soft pause,
// the reason repair never hands back during a pause. The fixtures pin data; the rules tie the prose to it.
//
// Every rule lives in one function, check({ status, repair, fx }), that returns named failures, so the real text
// and the controls run through identical logic: each control mutates the real text (or the fixture verdict) in one
// place and must fail with exactly its rule. Writes only under os.tmpdir().
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { collapse, fencedBlocks, read, root, section } from '../lib/contract-text.mjs'
import { runTask } from '../lib/engine.mjs'

// ---- the scripts ------------------------------------------------------------------------------------------------

const SCRIPTS = path.join(root, 'skills', 'execute', 'scripts')
const RECONCILE = path.join(SCRIPTS, 'reconcile-rollout.py')
const LEAD = path.join(SCRIPTS, 'lead-integrate.py')
const ENV = { ...process.env, TZ: 'UTC', PYTHONDONTWRITEBYTECODE: '1' }

function py(script, args, input) {
  const r = spawnSync('python3', [script, ...args], { encoding: 'utf8', env: ENV, input })
  return { rc: r.status, out: r.stdout, err: r.stderr }
}
function must(script, args, input) {
  const r = py(script, args, input)
  if (r.rc !== 0) throw new Error(`${path.basename(script)} ${args[0]} exited ${r.rc}: ${r.err}`)
  return r.out
}

// ---- engine rows (the integration-marker-roundtrip shapes, one slug each) ----------------------------------------

const NOW = '2026-10-02T14:05:00Z'
const sha = (c) => c.repeat(40)
const prOf = (n) => `https://github.com/o/r/pull/${n}`
const alias = (slug) => slug.slice(slug.indexOf('-') + 1)
const mkTask = (slug, over = {}) => ({ slug, taskPath: `/vault/Tasks/${slug}.md`, scope: 'cross-cutting', planGate: true, maxIterations: 3, maxReviewRounds: 4, maxPlanRounds: 3, model: 'fable', ...over })
const mkI = (slug, n) => ({
  prUrl: prOf(n), branch: `audit-fix/${alias(slug)}`, worktreePath: `/repo/.claude/worktrees/${slug}`, headSha: sha('a'), taskBase: sha('b'),
  mainSha: sha('c'), trouble: [], landed: [], plan: 'PLAN', reviewHistory: [{ round: 1, feedback: ['own-run fix'] }], reviewRoundsUsed: 1,
  rung: { model: 'fable', escalated: false, escalatedAt: '', tierCapped: false, tierCappedAt: '' },
})
const base = (rolloutSlug) => ({ rolloutSlug, repoPath: '/repo', verifier: 'make test', date: '2026-10-01' })
const integrateStep = {
  blocked: false, blockerDiagnosis: '', verified: true, mergeState: 'merged', mergeCommit: sha('d'), taskHead: sha('a'),
  baseSha: sha('c'), headSha: sha('d'), pushedSha: sha('d'), conflictFiles: ['a.js'], fixCommits: [], summary: 's', finishedAt: NOW,
  mergeLog: `anchor: ${sha('a')} base ${sha('b')}\ntask head: ${sha('a')}\nintegration base: ${sha('c')}\ntask file: a.js\nmerge: conflict\nconflict: a.js`,
}
async function engineRow(args, script) {
  const r = await runTask(args, async (_prompt, o) => {
    if (!(o.label in script)) throw new Error('stub: unknown agent label ' + o.label)
    return script[o.label]
  })
  if (r.error) throw r.error
  return r.result
}
// A plain rejection at Integration (x1); with maxReviewRounds 2, the x6 review-blocked shape.
const rejectedRow = (R, slug, n, over = {}) => engineRow({ ...base(R), mode: 'integrate', task: mkTask(slug, over), integration: mkI(slug, n) }, {
  [`integrate:${slug}`]: integrateStep,
  [`integration-review:${slug} r2`]: { verdict: 'changes', feedback: ['keep their rename'], unreadable: false, finishedAt: NOW },
})
// The integrator sets the task aside at Integration (x2).
const setAsideRow = (R, slug, n) => engineRow({ ...base(R), mode: 'integrate', task: mkTask(slug), integration: mkI(slug, n) }, {
  [`integrate:${slug}`]: { ...integrateStep, blocked: true, mergeState: 'none', mergeLog: '', blockerDiagnosis: 'conflict in a.js cannot be resolved' },
})
// A seeded revise that stopped (x3).
const seededStopRow = (R, slug, n) => {
  const I = mkI(slug, n)
  const hist = [{ round: 1, feedback: ['own-run fix'] }, { round: 2, feedback: ['keep their rename'], stage: 'integration' }]
  return engineRow({ ...base(R), task: mkTask(slug, { resume: { stage: 'revise', prUrl: I.prUrl, branch: I.branch, worktreePath: I.worktreePath, reviewHistory: hist, reviewRoundsUsed: 2, plan: 'PLAN' } }) }, {
    [`revise:${slug} r3`]: { verified: false, blocked: true, escalate: false, prUrl: I.prUrl, branch: I.branch, worktreePath: I.worktreePath, blockerDiagnosis: 'red after three iterations', summary: '' },
  })
}

// ---- vault writers ------------------------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p12-11-status-repair-'))
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

function writeTask(dir, slug, fm, body = '') {
  fs.writeFileSync(path.join(dir, `${slug}.md`), ['---', 'tags: [task]', ...fm, '---', '', '## Notes', '', `body ${slug}`, ''].join('\n') + body)
}
function writeRollout(dir, slug, slugs, fm = []) {
  const rows = slugs.map((s, i) => `| ${i + 1} | [[${s}]] | normal |`)
  fs.writeFileSync(path.join(dir, `${slug}.md`), ['---', 'tags: [task, rollout]', 'status: in_progress', 'protocol_version: 5', 'parallel_ceiling: 4',
    'projects:', '  - "[[Proj]]"', ...fm, '---', '', 'Project root: `/repo`', '', '## Queue', '', '| # | Task | Priority |', '|---|---|---|', ...rows, '',
    '## Notes', ''].join('\n'))
}
const fmOf = (text) => text.slice(0, text.indexOf('\n---\n') + 5)
const bodyOfNote = (text) => text.slice(text.indexOf('\n---\n') + 5)
const fmKey = (text, key) => (fmOf(text).match(new RegExp(`^${key}: (.*)$`, 'm')) || [])[1]
const copyDir = (from, to) => { fs.cpSync(from, to, { recursive: true }); return to }
const reconcileIn = (d, result, now = NOW) => must(RECONCILE, ['reconcile', '--result', '-', '--tasks-dir', d, '--now', now], JSON.stringify(result))
const statusOf = (d, R) => JSON.parse(must(RECONCILE, ['status', '--rollout', path.join(d, `${R}.md`), '--tasks-dir', d, '--now', NOW]))
const nextOf = (d, R) => JSON.parse(must(RECONCILE, ['next', '--rollout', path.join(d, `${R}.md`), '--tasks-dir', d, '--running', '', '--dry-run', '--now', NOW]))
const inputsOf = (d, slug) => JSON.parse(must(LEAD, ['inputs', '--note', path.join(d, `${slug}.md`), '--max-review-rounds', '4', '--repo', '/repo']))
const handBack = (d, slugs, now = '2026-10-02T13:00:00Z') => py(RECONCILE, ['hand-back', '--tasks', slugs, '--tasks-dir', d, '--now', now])

// ---- fixture A: every queue state, every set-aside stage --------------------------------------------------------

const RA = 'proj-rollout-2026-10-01'
const A = {
  merged: 'proj-merged', running: 'proj-running', integrating: 'proj-integrating', awaiting: 'proj-awaiting', queued: 'proj-queued',
  folded: 'proj-folded', other: 'proj-dropped', atIntegration: 'proj-at-integration', rejected: 'proj-rejected',
  reviseStopped: 'proj-revise-stopped', reviewBlocked: 'proj-review-blocked', planBlocked: 'proj-plan-blocked', gate: 'proj-gate', noPr: 'proj-no-pr',
}
const OWNER = 'owner: execute-2026-10-02-ab12cd34'

async function buildA() {
  const d = path.join(tmp, 'A')
  fs.mkdirSync(d)
  const link = `rollout: "[[${RA}]]"`
  const S = 'scope: cross-cutting'
  const st = (hm) => `started: 2026-10-02T${hm}+00:00`
  writeRollout(d, RA, Object.values(A))
  writeTask(d, A.merged, ['status: done', S, link, `pr: ${prOf(1)}`, st('09:00'), 'merged: 2026-10-02T09:32+00:00'])
  writeTask(d, A.running, ['status: in_progress', S, link, OWNER, st('12:00')])
  writeTask(d, A.integrating, ['status: review', S, link, `pr: ${prOf(3)}`, OWNER, st('10:00'), 'ready: 2026-10-02T13:00+00:00', 'integrating: 2026-10-02T13:50+00:00'])
  writeTask(d, A.awaiting, ['status: review', S, link, `pr: ${prOf(4)}`, st('10:30'), 'ready: 2026-10-02T13:30+00:00'])
  writeTask(d, A.queued, ['status: open', S, link, 'depends-on:', `  - "[[${A.atIntegration}]]"`])
  writeTask(d, A.folded, ['status: merged', S, link, `merged_into: "[[${A.merged}]]"`])
  writeTask(d, A.other, ['status: dropped', S, link])
  for (const [k, n] of [['atIntegration', 8], ['rejected', 9], ['reviseStopped', 10], ['reviewBlocked', 11]]) {
    writeTask(d, A[k], ['status: review', S, link, `pr: ${prOf(n)}`, st('11:00'), 'ready: 2026-10-02T12:00+00:00'])
  }
  for (const k of ['planBlocked', 'gate', 'noPr']) writeTask(d, A[k], ['status: in_progress', S, link, st('11:30')])
  reconcileIn(d, await setAsideRow(RA, A.atIntegration, 8))
  reconcileIn(d, await rejectedRow(RA, A.rejected, 9))
  reconcileIn(d, await rejectedRow(RA, A.reviseStopped, 10), '2026-10-02T13:00:00Z')
  reconcileIn(d, await seededStopRow(RA, A.reviseStopped, 10))
  reconcileIn(d, await rejectedRow(RA, A.reviewBlocked, 11, { maxReviewRounds: 2 }))
  reconcileIn(d, { rolloutSlug: RA, tasks: [{ slug: A.planBlocked, scope: 'cross-cutting', status: 'plan-blocked', blockerDiagnosis: 'the plan judge wants the schema decided first' }] })
  reconcileIn(d, { rolloutSlug: RA, tasks: [{ slug: A.gate, scope: 'cross-cutting', status: 'gate-pending', gatedInputs: ['spend: a paid API — cap USD 5'] }] })
  reconcileIn(d, { rolloutSlug: RA, tasks: [{ slug: A.noPr, scope: 'cross-cutting', status: 'review', prUrl: '', reviewRoundsUsed: 1 }] })

  const status = statusOf(d, RA)
  const inputs = Object.fromEntries(Object.values(A).map((s) => [s, inputsOf(d, s)]))
  const bySlug = Object.fromEntries(status.tasks.map((t) => [t.slug, t]))
  const triples = status.tasks.filter((t) => t.queueState === 'set-aside')
    .map((t) => ({ slug: t.slug, setAsideAt: t.setAsideAt, resumeAt: inputs[t.slug].resumeAt, autoRevise: inputs[t.slug].autoRevise }))

  // A running task's note is never swept to done: mark-done refuses it (on a copy).
  const md = copyDir(d, path.join(tmp, 'A-mark-done'))
  const mdRun = py(RECONCILE, ['mark-done', '--tasks', A.running, '--tasks-dir', md, '--now', NOW])
  const markDone = { rc: mdRun.rc, status: fmKey(fs.readFileSync(path.join(md, `${A.running}.md`), 'utf8'), 'status') }

  // Companions (on a copy): a revise stopped and an own run hand back to a restart; a gate never hands back.
  const hb = copyDir(d, path.join(tmp, 'A-hand-back'))
  const hbRun = handBack(hb, `${A.reviseStopped},${A.noPr}`)
  const hbGate = handBack(hb, A.gate)
  const companions = {
    rc: hbRun.rc, gateRc: hbGate.rc, gateStatus: fmKey(fs.readFileSync(path.join(hb, `${A.gate}.md`), 'utf8'), 'status'),
    restart: nextOf(hb, RA).restart, resumeAt: { [A.reviseStopped]: inputsOf(hb, A.reviseStopped).resumeAt, [A.noPr]: inputsOf(hb, A.noPr).resumeAt },
  }
  return {
    dir: d, status, inputs, bySlug, triples, markDone, companions,
    states: [...new Set(status.tasks.map((t) => t.queueState))].sort(), counts: status.counts, progress: status.progress,
  }
}

// ---- fixture B: an at-Integration set-aside retries Integration, nothing else ---------------------------------

const RB = 'proj-rollout-2026-10-02'
const B = { merged: 'proj-b-merged', target: 'proj-b-target', dep: 'proj-b-dep' }
const B_BODY = '\n## Plan\n\nPlanned on: ' + sha('b') + '\n\n- touch a.js\n\n## Review history (approved at ceiling)\n\nRound 1 rejection:\n- name the flag\n'

function buildBBase() {
  const d = path.join(tmp, 'B')
  fs.mkdirSync(d)
  const link = `rollout: "[[${RB}]]"`
  const S = 'scope: cross-cutting'
  writeRollout(d, RB, Object.values(B))
  writeTask(d, B.merged, ['status: done', S, link, `pr: ${prOf(20)}`, 'started: 2026-10-02T08:00+00:00', 'merged: 2026-10-02T08:40+00:00'])
  writeTask(d, B.target, ['status: review', S, link, `pr: ${prOf(21)}`, OWNER, 'model: fable', 'review_rounds_used: 2', 'plan_rounds_used: 1',
    'started: 2026-10-02T09:00+00:00', 'ready: 2026-10-02T10:40+00:00'], B_BODY)
  writeTask(d, B.dep, ['status: open', S, link, 'depends-on:', `  - "[[${B.target}]]"`])
  const note = path.join(d, `${B.target}.md`)
  must(RECONCILE, ['log-integration', '--tasks', B.target, '--started', '2026-10-02T11:00+00:00', '--anchor', sha('a'), '--head', sha('d'), '--base', sha('c'),
    '--tasks-dir', d, '--now', '2026-10-02T11:20:00Z'])
  const row = must(LEAD, ['set-aside', '--note', note, '--kind', 'integration'], 'merge declined at the --gated hold')
  reconcileIn(d, JSON.parse(row), '2026-10-02T12:00:00Z')
  return d
}

function buildB(d) {
  const fails = []
  const note = path.join(d, `${B.target}.md`)
  const before = fs.readFileSync(note, 'utf8')
  const s0 = statusOf(d, RB).tasks.find((t) => t.slug === B.target)
  const i0 = inputsOf(d, B.target)
  if (s0.queueState !== 'set-aside' || s0.setAsideAt !== 'integration') fails.push(`before: ${s0.queueState}/${s0.setAsideAt}`)
  if (i0.resumeAt !== 'integration' || i0.lastIntegration?.outcome !== 'integrated') fails.push(`before: inputs ${i0.resumeAt}/${i0.lastIntegration?.outcome}`)
  const hb = handBack(d, B.target)
  if (hb.rc !== 0) fails.push(`hand-back exited ${hb.rc}: ${hb.err}`)
  const after = fs.readFileSync(note, 'utf8')
  if (fmKey(after, 'status') !== 'review') fails.push(`status ${fmKey(after, 'status')}`)
  for (const k of ['pr', 'review_rounds_used', 'plan_rounds_used', 'model', 'started']) {
    if (fmKey(after, k) !== fmKey(before, k)) fails.push(`${k} changed`)
  }
  if (fmKey(after, 'ready') !== '2026-10-02T13:00+00:00') fails.push(`ready ${fmKey(after, 'ready')}`)
  if (bodyOfNote(after) !== bodyOfNote(before)) fails.push('the body changed')
  const nx = nextOf(d, RB)
  if (JSON.stringify(nx.awaitingIntegration) !== JSON.stringify([B.target])) fails.push(`awaitingIntegration ${JSON.stringify(nx.awaitingIntegration)}`)
  const elsewhere = [...nx.start, ...nx.restart, ...nx.running, ...nx.integrating, ...nx.setAside.map((x) => x.slug), ...nx.hold.map((x) => x.slug)]
  if (elsewhere.includes(B.target)) fails.push('listed outside awaitingIntegration')
  const held = nx.hold.find((x) => x.slug === B.dep)
  if (!held || !held.reason.includes(`[[${B.target}]]`)) fails.push('the dependant is not held')
  return { fails, before: { s0, i0 } }
}

// ---- fixture C: the drain (why repair never hands back during a pause) ------------------------------------------

function buildC(dB0) {
  const fails = []
  const d = copyDir(dB0, path.join(tmp, 'C'))
  const rollout = path.join(d, `${RB}.md`)
  fs.writeFileSync(rollout, fs.readFileSync(rollout, 'utf8').replace('parallel_ceiling: 4\n', 'parallel_ceiling: 4\npause_requested: true\n'))
  const n0 = nextOf(d, RB)
  if (n0.pausedNow !== true) fails.push(`before the hand-back pausedNow is ${n0.pausedNow}`)
  const hb = handBack(d, B.target)
  if (hb.rc !== 0) fails.push(`hand-back exited ${hb.rc}`)
  const n1 = nextOf(d, RB)
  if (n1.pausedNow !== false) fails.push(`after the hand-back pausedNow is ${n1.pausedNow}`)
  if (JSON.stringify(n1.awaitingIntegration) !== JSON.stringify([B.target])) fails.push(`after: awaitingIntegration ${JSON.stringify(n1.awaitingIntegration)}`)
  return { fails }
}

const fxA = await buildA()
const dB0 = buildBBase()
const dBC = copyDir(dB0, path.join(tmp, 'B-pristine'))
const fx = { A: fxA, B: buildB(dB0), C: buildC(dBC) }

// ---- the prose ------------------------------------------------------------------------------------------------

const real = { status: read('skills/status/SKILL.md'), repair: read('skills/repair/SKILL.md'), fx }

const IN_COUNT = ['merged', 'integrating', 'awaiting-integration', 'running', 'queued', 'set-aside']
const COUNT_KEY = { merged: 'merged', integrating: 'integrating', 'awaiting-integration': 'awaitingIntegration', running: 'running', queued: 'queued', 'set-aside': 'setAside' }
const LABELS = ['merged, never marked', 'PR-less merge', 'RACE', 'merge hold', 'live', 'awaiting Integration', 'queued', 'at Integration',
  'revise (automatic)', 'revise stopped', 'review-blocked, rejected', 'own run', 'gate']
const ROUTES = ['Stale anchor ref', 'The raise', 'A `merge-task:` own-run set-aside', 'Missing branch or CLOSED PR', 'Recut', 'Leash', 'Hand-off']
const ACTIONS = ['predates the queue', 'unsupported protocol version', '`incomplete`', '`superseded_by:`', 'every task merged', '`paused`',
  '`pause_requested`', 'a live queue', 'any drift flag', 'awaiting integration', 'nothing started']
const CAVEAT = 'drift is invisible offline; re-run with the live check before resuming'
const ANCHOR = 'update-ref -d refs/integration-anchor/<inputs.branch> <X>'
const WRITER = /reconcile-rollout\.py (next|resume|hand-back|defer|reconcile|mark-|approve-gates|clear-pause|carry)/
const BAN = /\bwaves?\b|merged_through_wave|resume-filter|mark-dispatched|cursor behind|advance the cursor|smart-halt|single-wave|re-?wave|protocol 4/i

const bodyOf = (t) => { const m = t.match(/^---\n[\s\S]*?\n---\n/); return m ? t.slice(m[0].length) : t }
const raw = (text, re) => section(text, re) ?? ''
// A bold-labelled block, raw: from the line starting `**<label>` (an item: `- **<label>`) to the next bold label at
// column 0 (an item: the next `- **` item too), or a heading.
function labelledRaw(text, label, { item = false } = {}) {
  const lines = (text ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(item ? `- **${label}` : `**${label}`))
  if (i < 0) return ''
  const stop = item ? /^(- \*\*|\*\*\S|#{2,3} )/ : /^(\*\*\S|#{2,3} )/
  const j = lines.findIndex((l, k) => k > i && stop.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}
const labelled = (text, label, opts) => collapse(labelledRaw(text, label, opts))
// Every `| … |` row but the separator, as trimmed cells.
const tableRows = (text) => (text ?? '').split('\n').filter((l) => /^\|.*\|\s*$/.test(l) && !/^\|\s*-/.test(l))
  .map((l) => l.trim().slice(1, -1).split(' | ').map((c) => c.trim()))
const ticks = (cell) => [...(cell ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1])
// `N. ` items with their indented continuation lines joined.
function numbered(text) {
  const out = []
  for (const l of (text ?? '').split('\n')) {
    const m = l.match(/^\d+\. (.*)$/)
    if (m) out.push(m[1])
    else if (out.length && /^\s+\S/.test(l)) out[out.length - 1] += ' ' + l.trim()
    else if (out.length && l.trim()) break
  }
  return out
}
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)

// Named failures for both skills against the fixtures; [] means every rule holds.
function check({ status, repair, fx }) {
  const fails = []
  const sb = bodyOf(status)
  const rb = bodyOf(repair)
  const s1 = collapse(raw(status, /^### 1\. /))
  const s2 = collapse(raw(status, /^### 2\. /))
  const s3raw = raw(status, /^### 3\. /)
  const s3 = collapse(s3raw)
  const s4raw = raw(status, /^### 4\. /)
  const s4 = collapse(s4raw)
  const sDonts = raw(status, /^## Don'ts/)
  const r1raw = raw(repair, /^### 1\. /)
  const r1 = collapse(r1raw)
  const r2raw = raw(repair, /^### 2\. /)
  const r3raw = raw(repair, /^### 3\. /)
  const r4raw = raw(repair, /^### 4\. /)
  const r5 = collapse(raw(repair, /^### 5\. /))
  const r6 = collapse(raw(repair, /^### 6\. /))

  // ---- status ----
  // states: six queue-state rows, one per in-count state, each with an example group header carrying fixture A's
  // count; folded and other only in the footer; the example headline is fixture A's progress line.
  const qRows = tableRows(s4raw).filter((c) => /^`[a-z-]+`$/.test(c[0]) && /^\*\*[^*]+\*\*$/.test(c[1] ?? ''))
  const group = Object.fromEntries(qRows.map((c) => [c[0].slice(1, -1), c[1].slice(2, -2)]))
  const example = fencedBlocks(s4raw).find((b) => b.includes('Drift:')) ?? []
  const outside = labelled(s4raw, 'Outside the count.')
  const headers = IN_COUNT.filter((s) => fx.A.states.includes(s)).every((s) => group[s] && example.includes(`${group[s]} (${fx.A.counts[COUNT_KEY[s]]})`))
  if (qRows.length !== 6 || JSON.stringify(Object.keys(group).sort()) !== JSON.stringify([...IN_COUNT].sort()) || !headers ||
    !outside.includes('`folded`') || !outside.includes('`other`') || !outside.includes('no group and no row') ||
    JSON.stringify(fx.A.states) !== JSON.stringify([...IN_COUNT, 'folded', 'other'].sort()) ||
    !(example[0] ?? '').endsWith(fx.A.progress)) fails.push('states')

  // set-aside: every (setAsideAt, resumeAt, autoRevise) fixture A emits has a re-entry row, and each row says where.
  const reRows = tableRows(labelledRaw(s4raw, 'Set-aside re-entry.')).filter((c) => c.length === 5 && /^`(integration|run|gate)`$/.test(c[0]))
  const rowFor = (t) => reRows.find((c) => c[0] === `\`${t.setAsideAt}\`` && ticks(c[1]).includes(t.resumeAt) && ticks(c[2]).includes(String(t.autoRevise)))
  const says = (pred, ...words) => reRows.some((c) => pred(c) && words.every((w) => c.join(' | ').includes(w)))
  if (!fx.A.triples.length || !fx.A.triples.every(rowFor) ||
    !says((c) => c[0] === '`integration`', 'retries Integration only') ||
    !says((c) => ticks(c[2]).includes('true'), 'launches the seeded revise itself') ||
    !says((c) => c[3].includes('`revise stopped:`'), '`hand-back`, then a seeded revise') ||
    !says((c) => c[3].includes('`review-blocked`') && c[3].includes('`rejected`'), 'one-round raise') ||
    !says((c) => c[0] === '`run`' && ticks(c[1]).includes('own'), 'its own call') ||
    !says((c) => c[0] === '`gate`', '`approve-gates`', 'never `hand-back`')) fails.push('set-aside')

  // log-line: the Integration log is read as its LAST line, through inputs' lastIntegration.
  if (!s2.includes("`lastIntegration` is the `## Integration log`'s LAST line as fields, never a search or a count")) fails.push('log-line')

  // owner: the tag is grepped from the note; "no run" counts only in the owner session, for a live queue.
  const qual = labelled(s4raw, 'Owner-session qualifier.')
  if (!s4.includes("`grep -m1 '^owner:' ~/repos/obsidian/Work/Tasks/<slug>.md`") || !qual.includes('a live queue') ||
    !qual.includes('`/workflows`') || !qual.includes('**in that owner session**') || !qual.includes('known to have ended')) fails.push('owner')

  // drift: D1 merged-never-marked names resume; D2 inputs covers running and started PR-less tasks; D3 one guarded
  // gh pr list matched on inputs.branch; D4 the offline caveat; D5 the example Drift block.
  const flag = (label) => labelled(s3raw, label, { item: true })
  const pl = flag('Possible PR-less merge:')
  // The example's Drift block: the lines after `Drift:` up to the next blank line.
  const afterDrift = example.includes('Drift:') ? example.slice(example.indexOf('Drift:') + 1) : []
  const blank = afterDrift.findIndex((l) => !l.trim())
  const driftLines = blank < 0 ? afterDrift : afterDrift.slice(0, blank)
  const D = [
    flag('Merged, never marked:').includes('`resume` is the sanctioned path'),
    s2.includes('lead-integrate.py inputs --note') && s2.includes('`running`') && s2.includes('plus any other unmerged task that has `started` and no `pr`'),
    (s3.match(/gh pr list/g) ?? []).length === 1 && s3.includes('and only when a task with `started` has no `pr`') &&
      pl.includes('`headRefName`') && pl.includes('`inputs.branch`') && pl.includes('`started:`'),
    s3.includes(CAVEAT) && s3.includes('every resume or reinstate recommendation') &&
      labelled(s4raw, 'Precedence.').includes('Offline, every resume or reinstate recommendation carries'),
    driftLines.some((l) => l.includes('merged, never marked')) && driftLines.some((l) => l.includes('possible PR-less merge')),
  ]
  if (!D.every(Boolean)) fails.push('drift')

  // actions: the first-match order, and a possible PR-less merge overriding every wait, reinstate and resume.
  const items = numbered(labelledRaw(s4raw, 'Recommended action'))
  if (items.length !== ACTIONS.length || !ACTIONS.every((k, i) => (items[i] ?? '').toLowerCase().startsWith(k.toLowerCase())) ||
    !labelled(s4raw, 'Precedence.').includes('A possible PR-less merge overrides 6, 8, 10 and 11')) fails.push('actions')

  // lineage (status § 1 and repair § 1): a legacy note gets execute § 2's remedy; any other non-5 version is
  // unsupported; incomplete and supersede are stops.
  const stops = labelled(r1raw, 'Stops.')
  if (!s1.includes('Absent, `2` or `3`') || !s1.includes('hard-pause it') || !s1.includes('/thread:schedule <project> --regenerate') ||
    !s1.includes('"unsupported protocol version <N>; the queue reads protocol_version: 5"') || !s1.includes('`incomplete`') ||
    !s1.includes('`superseded_by:`') ||
    !stops.includes('absent, `2` or `3`') || !stops.includes("execute § 2's remedy") || !stops.includes('"unsupported protocol version <N>') ||
    !stops.includes('`incomplete`') || !stops.includes('/thread:schedule <project> --regenerate') || !stops.includes('`superseded_by:`')) fails.push('lineage')

  // read-only: status invokes no writer verb outside its Don'ts, and the Don'ts name next.
  if (WRITER.test(sb.replace(sDonts, '')) || !collapse(sDonts).includes('`reconcile-rollout.py next`')) fails.push('read-only')

  // ---- repair ----
  const clsRows = tableRows(r2raw).filter((c) => /^\*\*[^*]+\*\*$/.test(c[0]))
  const cls = Object.fromEntries(clsRows.map((c) => [c[0].slice(2, -2), c.slice(1).join(' | ')]))

  // integration-only: at Integration hands back to Integration alone, and fixture B shows that is all it does.
  const atI = cls['at Integration'] ?? ''
  if (!atI.includes('`reconcile-rollout.py hand-back --tasks <slug>`') || !atI.includes('Integration only') || !atI.includes('nothing redone') ||
    fx.B.fails.length) fails.push('integration-only')

  // stages: the 13 classes, in order, and § 4's per-stage routes.
  if (JSON.stringify(clsRows.map((c) => c[0].slice(2, -2))) !== JSON.stringify(LABELS) ||
    !ROUTES.every((l) => r4raw.split('\n').some((x) => x.startsWith(`- **${l}`))) ||
    !collapse(r4raw).includes('lead-integrate.py set-aside --note <task note> --kind integration')) fails.push('stages')

  // merged: M1 resume, never resolve; M2 the ancestry check; M3 the vault history; M4 never the status; M5 a dated
  // ## Notes record; M6 copied to the Completion log; M7 pr: only on Lachy's word.
  const c3 = labelled(r3raw, '3c')
  const M = [
    (cls['merged, never marked'] ?? '').includes('`reconcile-rollout.py resume`') && !/reconcile-rollout\.py resolve/.test(repair) &&
      !/reconcile-rollout\.py resolve/.test(status),
    c3.includes('merge-base --is-ancestor <mergeCommit.oid> origin/<default branch>'),
    c3.includes('log -p -n 3 -- Work/Tasks/<slug>.md'),
    c3.includes("never writes that task's `status:`"),
    c3.includes('append a dated `## Notes` line'),
    r6.includes('`## Completion log`') && r6.includes('copied from the dated `## Notes` records'),
    c3.includes("On Lachy's confirmation that the PR is this task's, write `pr: <url>`"),
  ]
  if (!M.every(Boolean)) fails.push('merged')

  // live: L1 no hand-back during a drain, with why; L2 none under a stamp, which stays; L3 a live queue gets no
  // resume and no write to a running or integrating note; L4 /workflows in the owner session; and fixture C.
  const pz = labelled(r1raw, 'Pause, drained or stamped.')
  const lv = labelled(r1raw, 'Live queue, not paused.')
  const L = [
    pz.includes('never runs `hand-back`') && pz.includes('A hand-back during the drain would put a task back into exactly those states') &&
      pz.includes('after Lachy asked to pause'),
    pz.includes('never clears the stamp or the flag') && pz.includes('Under a stamped pause, the reinstate decides what restarts'),
    lv.includes('never runs `resume`') && lv.includes('never enters the loop') && lv.includes('never writes a running or integrating note'),
    r1.includes('`/workflows`') && r1.includes('owner session'),
  ]
  if (!L.every(Boolean) || fx.C.fails.length) fails.push('live')

  // raise: one round, only at the ceiling, announced and recorded; a second block asks.
  const rz = labelled(r4raw, 'The raise', { item: true })
  const incs = [...rb.matchAll(/lastRound \+ (\d+)/g)].map((m) => m[1])
  if (!rz.includes('`max_review_rounds: <lastRound + 1>`') || !rz.includes('is ≤ `lastRound`') || !rz.includes('Announce it') ||
    !rz.includes('`## Notes`') || !rz.includes('ask Lachy instead of raising again') || !incs.length || incs.some((n) => n !== '1')) fails.push('raise')

  // defer: the dependent closure only (transitive, through tombstones), never a file-overlap reading.
  if (!r5.includes('transitive') || !r5.includes('`depends-on:`') || !r5.includes('`blocked-by:`') || !r5.includes('`merged_into:`') ||
    !r5.includes('`## Queue` row') || !r5.includes('never write it') || /file-overlap|successor/i.test(r5)) fails.push('defer')

  // anchor: the guarded anchor-ref delete, for a stale ref and in the retire block.
  if (!labelled(r4raw, 'Stale anchor ref', { item: true }).includes(ANCHOR) || !r5.includes(ANCHOR)) fails.push('anchor')

  // recut: only on Lachy's ask, through the register check, the retire block and an own-run relabel.
  const rc = labelled(r4raw, 'Recut', { item: true })
  if (!rc.startsWith("- **Recut, only on Lachy's explicit ask:**") ||
    !['landing-register check', "§ 5's retire block", 'branch -D', '--kind own', '`hand-back`'].every((k) => rc.includes(k))) fails.push('recut')

  // hand-off: no live lead and no pause; execute § 2.5, then resume, then the loop with --running ""; no § 2.7.
  const ho = labelled(r4raw, 'Hand-off', { item: true })
  if (!ho.includes('no lead is live and no pause stands') || !before(ho, 'execute § 2.5', '`reconcile-rollout.py resume`') ||
    !before(ho, '`reconcile-rollout.py resume`', '`--running ""`') || !ho.includes('§4.5 resume') || !ho.includes('§ 2.7') ||
    !ho.includes('does not run')) fails.push('hand-off')

  // ---- both ----
  // no-wave: neither body reads the wave rollout (the frontmatter descriptions are p12-12's).
  if (BAN.test(sb) || BAN.test(rb)) fails.push('no-wave')
  return [...new Set(fails)]
}

// ---- the fixtures ------------------------------------------------------------------------------------------

test('fixture A: every queue state, each set-aside stage and its re-entry inputs', () => {
  const { bySlug: t, inputs: i, status } = fx.A
  const q = Object.fromEntries(Object.entries(A).map(([k, s]) => [k, t[s]?.queueState]))
  assert.deepEqual(q, {
    merged: 'merged', running: 'running', integrating: 'integrating', awaiting: 'awaiting-integration', queued: 'queued', folded: 'folded',
    other: 'other', atIntegration: 'set-aside', rejected: 'set-aside', reviseStopped: 'set-aside', reviewBlocked: 'set-aside',
    planBlocked: 'set-aside', gate: 'set-aside', noPr: 'set-aside',
  })
  assert.deepEqual(fx.A.counts, { merged: 1, running: 1, integrating: 1, awaitingIntegration: 1, queued: 1, setAside: 7, setAsideAtIntegration: 1, folded: 1, other: 1, total: 12 })
  const setAside = ['atIntegration', 'rejected', 'reviseStopped', 'reviewBlocked', 'planBlocked', 'gate', 'noPr']
  assert.deepEqual(setAside.map((k) => t[A[k]].setAsideAt), ['integration', 'run', 'run', 'run', 'run', 'gate', 'run'])
  assert.deepEqual(setAside.map((k) => i[A[k]].resumeAt), ['integration', 'revise', 'revise', 'revise', 'own', 'own', 'own'])
  assert.deepEqual(Object.values(A).filter((s) => i[s].autoRevise), [A.rejected], 'autoRevise only on the plain rejection')
  assert.equal(i[A.atIntegration].lastIntegration.outcome, 'set-aside')
  assert.equal(i[A.rejected].lastIntegration.outcome, 'rejected')
  assert.equal(i[A.reviseStopped].lastIntegration.outcome, 'rejected', 'a revise stopped keeps its rejected line last')
  assert.equal(i[A.reviewBlocked].lastIntegration.outcome, 'rejected')
  assert.equal(i[A.merged].lastIntegration, null, 'no log: null')
  assert.ok(t[A.reviseStopped].blockerSummary.split('\n').some((l) => l.startsWith('revise stopped: ')))
  assert.equal(t[A.reviewBlocked].status, 'review-blocked')
  assert.equal(t[A.noPr].status, 'review')
  assert.equal(t[A.noPr].pr, null)
  assert.deepEqual(t[A.queued].waitingOn, [`depends on [[${A.atIntegration}]] (blocked)`])
  // inputs is read-only on a running note too, and names its branch with no pr (the PR-less merge match).
  assert.equal(i[A.running].branch, `audit-fix/${alias(A.running)}`)
  assert.equal(i[A.running].pr, null)
  assert.equal(i[A.running].worktreePath, `/repo/.claude/worktrees/${A.running}`)
  assert.equal(i[A.running].status, 'in_progress')
  assert.ok(status.tasks.every((x) => !('owner' in x)), 'no owner key: status greps the note')
  assert.equal(status.incomplete, null)
  // mark-done never sweeps a running note to done.
  assert.notEqual(fx.A.markDone.rc, 0)
  assert.equal(fx.A.markDone.status, 'in_progress')
})

test('fixture A companions: a revise stopped and an own run hand back to a restart; a gate never hands back', () => {
  const c = fx.A.companions
  assert.equal(c.rc, 0)
  assert.ok(c.restart.includes(A.reviseStopped) && c.restart.includes(A.noPr), JSON.stringify(c.restart))
  assert.deepEqual(c.resumeAt, { [A.reviseStopped]: 'revise', [A.noPr]: 'own' })
  assert.equal(c.gateRc, 1)
  assert.equal(c.gateStatus, 'gate-pending')
})

test('fixture B: an at-Integration set-aside hands back to Integration only, nothing redone', () => {
  assert.deepEqual(fx.B.fails, [])
})

test('fixture C: a hand-back during a drain would undo it (pausedNow true, then false with the task awaiting Integration)', () => {
  assert.deepEqual(fx.C.fails, [])
})

// ---- the rules -------------------------------------------------------------------------------------------------

test('status and repair hold every queue rule', () => {
  assert.deepEqual(check(real), [])
})

// ---- controls: each mutates the real text (or a fixture verdict) in one place and must fail with exactly its rule ----

const RULES = ['states', 'set-aside', 'log-line', 'owner', 'drift', 'actions', 'lineage', 'read-only', 'integration-only', 'stages',
  'merged', 'live', 'raise', 'defer', 'anchor', 'recut', 'hand-off', 'no-wave']
const CONTROLLED = new Set()

// Replaces the first match of `from`. Whitespace inside it matches any run of whitespace, so a reflowed line still
// matches; its leading and trailing whitespace match literally.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function edit(text, from, to) {
  const core = from.trim()
  const at = from.indexOf(core)
  const re = new RegExp(esc(from.slice(0, at)) + core.split(/\s+/).map(esc).join('\\s+') + esc(from.slice(at + core.length)))
  assert.ok(core && re.test(text), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(re, () => to)
}
const only = (mut, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(check({ ...real, ...mut }), [rule], label)
}
const st = (from, to) => ({ status: edit(real.status, from, to) })
const rp = (from, to) => ({ repair: edit(real.repair, from, to) })
const lineWith = (text, needle) => {
  const l = text.split('\n').find((x) => x.includes(needle))
  assert.ok(l, `control setup: no line with ${needle}`)
  return l
}

test('control: no queued row fails states', () => {
  only(st(lineWith(real.status, '| `queued` | **Queued** |') + '\n', ''), 'states', 'no queued row')
})
test('control: a folded row fails states', () => {
  const q = lineWith(real.status, '| `queued` | **Queued** |')
  only(st(q, q + '\n| `folded` | **Folded** | the task it was folded into |'), 'states', 'folded row')
})
test('control: other dropped from the footer fails states', () => {
  only(st('**Outside the count.** `folded` (an affine tombstone) and `other` (dropped, parked)', '**Outside the count.** `folded` (an affine tombstone)'), 'states', 'no other')
})
test('control: an autoRevise row that says false fails set-aside', () => {
  const l = lineWith(real.status, '| `run` | `revise` | `true` |')
  only(st(l, l.replace('`true`', '`false`')), 'set-aside', 'no autoRevise row')
})
test('control: a gate row that hands back fails set-aside', () => {
  only(st('then `approve-gates` (execute § 3.7); never `hand-back`', 'then `hand-back`'), 'set-aside', 'gate hand-back')
})
test('control: a log read by search fails log-line', () => {
  only(st("`lastIntegration` is the `## Integration log`'s LAST line as fields, never a search or a count", "`lastIntegration` is the `## Integration log`'s latest `integrated` line"), 'log-line', 'search')
})
test('control: no owner grep fails owner', () => {
  only(st("`grep -m1 '^owner:' ~/repos/obsidian/Work/Tasks/<slug>.md`", 'the status JSON'), 'owner', 'no grep')
})
test('control D1: merged-never-marked without resume fails drift', () => {
  only(st('`resume` is the sanctioned path', 'a fresh call is the path'), 'drift', 'D1')
})
test('control D2: inputs without the started PR-less tasks fails drift', () => {
  only(st(', plus any other unmerged task that has `started` and no `pr`', ''), 'drift', 'D2')
})
test('control D3: an unguarded gh pr list fails drift', () => {
  only(st(', and only when a task with `started` has no `pr`', ''), 'drift', 'D3')
})
test('control D4: no offline caveat fails drift', () => {
  only(st(CAVEAT, 'the report is vault-only'), 'drift', 'D4')
})
test('control D5: no PR-less line in the example Drift block fails drift', () => {
  only(st(lineWith(real.status, 'possible PR-less merge: PR') + '\n', ''), 'drift', 'D5')
})
test('control: the PR-less precedence dropped fails actions', () => {
  only(st('A possible PR-less merge overrides 6, 8, 10 and 11', 'A possible PR-less merge overrides 10 and 11'), 'actions', 'precedence')
})
test('control: two recommended actions swapped fails actions', () => {
  const two = lineWith(real.status, '2. Unsupported protocol version')
  const three = lineWith(real.status, '3. `incomplete`')
  only({ status: real.status.replace(two, '\u0000').replace(three, two.replace(/^2\./, '3.')).replace('\u0000', three.replace(/^3\./, '2.')) }, 'actions', 'swap')
})
test('control: no unsupported-version stop in status fails lineage', () => {
  only(st('"unsupported protocol version <N>; the queue reads protocol_version: 5"', '"unknown version"'), 'lineage', 'status')
})
test('control: no unsupported-version stop in repair fails lineage', () => {
  only(rp('"unsupported protocol version <N>', '"unknown version <N>'), 'lineage', 'repair')
})
test('control: a hand-back invoked by status fails read-only', () => {
  only(st('**Outside the count.**', 'Run `reconcile-rollout.py hand-back --tasks <slug>` first.\n\n**Outside the count.**'), 'read-only', 'writer')
})
test('control: at Integration re-dispatched fails integration-only', () => {
  only(rp('`reconcile-rollout.py hand-back --tasks <slug>` → `review`', 'a fresh dispatch'), 'integration-only', 'redispatch')
})
test('control: fixture B failing fails integration-only', () => {
  only({ fx: { ...real.fx, B: { ...real.fx.B, fails: ['the body changed'] } } }, 'integration-only', 'fixture B')
})
test('control: no queued class fails stages', () => {
  only(rp(lineWith(real.repair, '| **queued** |') + '\n', ''), 'stages', 'no queued class')
})
test('control M1: merged-never-marked resolved fails merged', () => {
  only(rp('`reconcile-rollout.py resume` (§ 3a)', '`reconcile-rollout.py resolve` (§ 3a)'), 'merged', 'M1')
})
test('control M2: no ancestry check fails merged', () => {
  only(rp('merge-base --is-ancestor <mergeCommit.oid>', 'merge-base <mergeCommit.oid>'), 'merged', 'M2')
})
test('control M3: no vault history fails merged', () => {
  only(rp('log -p -n 3 -- Work/Tasks/<slug>.md', 'show <slug>'), 'merged', 'M3')
})
test("control M4: writing the task's status fails merged", () => {
  only(rp("never writes that task's `status:`", "writes that task's `status:` once confirmed"), 'merged', 'M4')
})
test('control M5: no dated Notes record fails merged', () => {
  only(rp('append a dated `## Notes` line', 'mention it in the report'), 'merged', 'M5')
})
test('control M6: no Completion-log copy fails merged', () => {
  only(rp('copied from the dated `## Notes` records', 'from memory'), 'merged', 'M6')
})
test('control M7: pr: written without confirmation fails merged', () => {
  only(rp("On Lachy's confirmation that the PR is this task's, write `pr: <url>`", 'Write `pr: <url>`'), 'merged', 'M7')
})
test('control L1: a hand-back allowed during the drain fails live', () => {
  only(rp('A hand-back during the drain would put a task back into exactly those states', 'A hand-back during the drain is harmless'), 'live', 'L1')
})
test('control L2: clearing the stamp fails live', () => {
  only(rp('never clears the stamp or the flag', 'may clear the stamp'), 'live', 'L2')
})
test('control L3: a resume under a live queue fails live', () => {
  only(rp('It never runs `resume`, never enters the loop', 'It runs `resume`, never enters the loop'), 'live', 'L3')
})
test('control L4: no /workflows check fails live', () => {
  only(rp('check `/workflows` in that owner session', 'check the run list'), 'live', 'L4')
})
test('control: fixture C failing fails live', () => {
  only({ fx: { ...real.fx, C: { fails: ['pausedNow stays true'] } } }, 'live', 'fixture C')
})
test('control: a raise of two rounds fails raise', () => {
  only(rp('`max_review_rounds: <lastRound + 1>`', '`max_review_rounds: <lastRound + 2>`'), 'raise', '+ 2')
})
test('control: a second raise without asking fails raise', () => {
  only(rp('ask Lachy instead of raising again', 'raise it once more'), 'raise', 'no ask')
})
test('control: a file-overlap successor reading fails defer', () => {
  only(rp('1. **Compute the dependent closure.**', '1. **Compute the dependent closure** and note file-overlap successors.'), 'defer', 'file overlap')
})
test('control: an unguarded anchor-ref delete fails anchor', () => {
  const l = lineWith(real.repair, `git -C <repoPath> ${ANCHOR}`)
  only(rp(l, l.replace(' <X>', '')), 'anchor', 'unguarded')
})
test('control: a recut without the ask fails recut', () => {
  only(rp("- **Recut, only on Lachy's explicit ask:**", '- **Recut, when the branch is missing:**'), 'recut', 'no ask')
})
test('control: a hand-off under a pause fails hand-off', () => {
  only(rp('- **Hand-off, when no lead is live and no pause stands:**', '- **Hand-off, when no lead is live:**'), 'hand-off', 'pause')
})
test('control: a wave in status fails no-wave', () => {
  only(st('**Outside the count.**', 'Group by wave.\n\n**Outside the count.**'), 'no-wave', 'status wave')
})
test('control: a wave in repair fails no-wave', () => {
  only(rp('### 5. ', 'Defer it out of the wave.\n\n### 5. '), 'no-wave', 'repair wave')
})

test('the rules are all named (18) and each has a control', () => {
  assert.equal(RULES.length, 18)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
