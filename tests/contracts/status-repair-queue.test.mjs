// /thread:status and /thread:repair read the queue (ADR 0030, p12-11): the situational report groups a rollout's
// tasks by queue state and re-entry stage, and the conductor hands a set-aside task back at the stage it stopped
// (at Integration: Integration only), defers only its dependent closure, and never writes under a pause.
//
// Six fixtures run the landed scripts (reconcile-rollout.py, lead-integrate.py, unfinished-rollout.py) on temp
// vaults, the set-aside notes written through the real writers (engine rows from task.workflow.js via
// tests/lib/engine.mjs, the lead's set-aside rows, reconcile): A is a status fixture with every queue state and
// every set-aside stage; B is an at-Integration set-aside handed back (Integration retried, nothing else); C is B
// under a draining soft pause, the reason repair never hands back during a pause; D is a legacy rollout another
// rollout's supersedes: names, the reason the lineage is read before the version; E is a RACE under the lead and
// an UNVERIFIED set-aside, which `resume` holds (exit 3, both notes untouched) until Lachy's `RACE decided:`
// lines are recorded (p12-12); F is the automatic retry's verdict (ADR 0033) on every set-aside kind repair and status
// read, and repair's needs-you answer, recorded and re-entered once (p16-5). The fixtures pin data; the rules tie the
// prose to it.
//
// Every rule lives in one function, check({ status, repair, fx }), that returns named failures, so the real text
// and the controls run through identical logic: each control mutates the real text (or the fixture verdict) in one
// place and must fail with exactly its rule. Writes only under os.tmpdir().
//
// Repair's classes are first-match: a RACE / UNVERIFIED task also matches merged-never-marked and at Integration,
// so the class order and the hold on every `resume` until Lachy's RACE decision is recorded are pinned
// (first-match), as are a merge into another base (another-base), a CLOSED PR (closed-pr) and a rollout another
// rollout's `supersedes:` names (reverse-lineage). An undecided RACE holds every reinstate and resume on both
// sides (`resume` itself skips it, exit 3), and its record is allowed in every mode (race-hold). A signed task is
// the lead's while its session holds the signed-gate handle (signed-gate). A RACE whose re-verify
// the lead still runs (integrating under a live owner) is no escalation: both sides wait on it, and its fallback
// is repair, never a resume (race-in-flight). Status's read-only rule is positive: it may invoke only its two
// script reads, § 3's gh/git reads and the default-branch read. Both speak rungs, never tiers (ADR 0029, p13-3):
// status shows each task's rung and flags a Rung drift on unlanded tasks only and a refused ladder file, which
// reorders no action; repair never edits the file and stops short of the hand-off under it (rung). Agent-fixable is
// execute's (ADR 0033): repair leaves an `autoRetry: true` or cooling set-aside to the lead's automatic retry, judging
// a descope first, and asks every other one on its verdict, never on its feedback (auto-retry); status shows each
// set-aside's retry count (retries) and a Needs you block, and repair answers a `## Needs you` question into
// `## Repair input`, removes it in every mode and hands back once (needs-you).
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { FENCE, collapse, fencedBlocks, read, root, section } from '../lib/contract-text.mjs'
import { runTask } from '../lib/engine.mjs'

// ---- the scripts ------------------------------------------------------------------------------------------------

const SCRIPTS = path.join(root, 'skills', 'execute', 'scripts')
const RECONCILE = path.join(SCRIPTS, 'reconcile-rollout.py')
const LEAD = path.join(SCRIPTS, 'lead-integrate.py')
const UNFINISHED = path.join(root, 'skills', '_shared', 'scripts', 'unfinished-rollout.py')
// The Run record (run_record.py, ADR 0032) the scripts may append lands in temp, never ~/.local/state.
const EVENTS = fs.mkdtempSync(path.join(os.tmpdir(), 'srq-events-'))
after(() => fs.rmSync(EVENTS, { recursive: true, force: true }))
const ENV = { ...process.env, TZ: 'UTC', PYTHONDONTWRITEBYTECODE: '1', THREAD_EVENTS_DIR: process.env.THREAD_TEST_EVENTS_DIR || path.join(EVENTS, 'events') }

function py(script, args, input, env = ENV) {
  const r = spawnSync('python3', [script, ...args], { encoding: 'utf8', env, input })
  return { rc: r.status, out: r.stdout, err: r.stderr }
}
function must(script, args, input, env = ENV) {
  const r = py(script, args, input, env)
  if (r.rc !== 0) throw new Error(`${path.basename(script)} ${args[0]} exited ${r.rc}: ${r.err}`)
  return r.out
}

// ---- engine rows (the integration-marker-roundtrip shapes, one slug each) ----------------------------------------

const NOW = '2026-10-02T14:05:00Z'
const sha = (c) => c.repeat(40)
const prOf = (n) => `https://github.com/o/r/pull/${n}`
const alias = (slug) => slug.slice(slug.indexOf('-') + 1)
const mkTask = (slug, over = {}) => ({ slug, taskPath: `/vault/Tasks/${slug}.md`, scope: 'cross-cutting', planGate: true, maxIterations: 3, maxReviewRounds: 4, maxPlanRounds: 3, rung: 'opus-xhigh', ...over })
const mkI = (slug, n) => ({
  prUrl: prOf(n), branch: `audit-fix/${alias(slug)}`, worktreePath: `/repo/.claude/worktrees/${slug}`, headSha: sha('a'), taskBase: sha('b'),
  mainSha: sha('c'), trouble: [], landed: [], plan: 'PLAN', reviewHistory: [{ round: 1, feedback: ['own-run fix'] }], reviewRoundsUsed: 1,
  rung: { startRung: 'opus-high', rung: 'opus-xhigh', climbs: [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }] },
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
// status reads the operator's ladder file (its `ladder` key and each task's rungDrift): HOME is an empty dir here,
// so it reads the built-in ladder and the operator's file never reaches the assertions.
const STATUS_ENV = { ...ENV, HOME: path.join(tmp, 'status-home') }

function writeTask(dir, slug, fm, body = '') {
  fs.writeFileSync(path.join(dir, `${slug}.md`), ['---', 'tags: [task]', ...fm, '---', '', '## Notes', '', `body ${slug}`, ''].join('\n') + body)
}
function writeRollout(dir, slug, slugs, fm = [], { version = 5, repo = '/repo' } = {}) {
  const rows = slugs.map((s, i) => `| ${i + 1} | [[${s}]] | normal |`)
  fs.writeFileSync(path.join(dir, `${slug}.md`), ['---', 'tags: [task, rollout]', 'status: in_progress', `protocol_version: ${version}`, 'parallel_ceiling: 4',
    'projects:', '  - "[[Proj]]"', ...fm, '---', '', `Project root: \`${repo}\``, '', '## Queue', '', '| # | Task | Priority |', '|---|---|---|', ...rows, '',
    '## Notes', ''].join('\n'))
}
const fmOf = (text) => text.slice(0, text.indexOf('\n---\n') + 5)
const bodyOfNote = (text) => text.slice(text.indexOf('\n---\n') + 5)
const fmKey = (text, key) => (fmOf(text).match(new RegExp(`^${key}: (.*)$`, 'm')) || [])[1]
const copyDir = (from, to) => { fs.cpSync(from, to, { recursive: true }); return to }
const reconcileIn = (d, result, now = NOW) => must(RECONCILE, ['reconcile', '--result', '-', '--tasks-dir', d, '--now', now], JSON.stringify(result))
const statusOf = (d, R) => JSON.parse(must(RECONCILE, ['status', '--rollout', path.join(d, `${R}.md`), '--tasks-dir', d, '--now', NOW], undefined, STATUS_ENV))
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
  // Rungs: an off-ladder `rung:` drifts on the queued task only, never on the merged one; an on-ladder one never.
  writeTask(d, A.merged, ['status: done', S, link, `pr: ${prOf(1)}`, st('09:00'), 'merged: 2026-10-02T09:32+00:00', 'rung: gone'])
  writeTask(d, A.running, ['status: in_progress', S, link, OWNER, st('12:00')])
  writeTask(d, A.integrating, ['status: review', S, link, `pr: ${prOf(3)}`, OWNER, st('10:00'), 'ready: 2026-10-02T13:00+00:00', 'integrating: 2026-10-02T13:50+00:00'])
  writeTask(d, A.awaiting, ['status: review', S, link, `pr: ${prOf(4)}`, st('10:30'), 'ready: 2026-10-02T13:30+00:00', 'rung: opus-xhigh'])
  writeTask(d, A.queued, ['status: open', S, link, 'rung: gone', 'depends-on:', `  - "[[${A.atIntegration}]]"`])
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
  writeTask(d, B.target, ['status: review', S, link, `pr: ${prOf(21)}`, OWNER, 'rung: opus-xhigh', 'review_rounds_used: 2', 'plan_rounds_used: 1',
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
  for (const k of ['pr', 'review_rounds_used', 'plan_rounds_used', 'rung', 'started']) {
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

// ---- fixture D: a legacy rollout another rollout's supersedes: names (why the lineage comes before the version) --

// P is protocol_version 3 and paused, its landed task still linked; N supersedes it through an aliased,
// differently cased link and has run. Schedule's check (unfinished-rollout.py) then refuses even a --regenerate
// run, naming P as an interrupted supersede's prior, so a version check that answered "--regenerate" first would
// loop; the close-out (status: done, superseded_by:, the move into Archive/Rollouts/) is what clears it. On a copy
// where N never ran, N is incomplete and the same check pairs the two as `interrupted`.
const RP = 'proj-rollout-2026-09-01'
const RN = 'proj-rollout-2026-09-20'
const D = { landed: 'proj-p-landed', running: 'proj-n-running' }
const unfinished = (d, repo) => py(UNFINISHED, ['check', '--repo', repo, '--project', 'Proj', '--regenerate', '--tasks-dir', d])

function buildD() {
  const fails = []
  const d = path.join(tmp, 'D')
  const repo = path.join(tmp, 'D-repo')
  fs.mkdirSync(d)
  fs.mkdirSync(repo)
  writeRollout(d, RP, [D.landed], ['paused: 2026-09-19T10:00+00:00'], { version: 3, repo })
  writeRollout(d, RN, [D.running], [`supersedes: "[[${RP.replace('proj-rollout', 'Proj-Rollout')}|the legacy rollout]]"`], { repo })
  writeTask(d, D.landed, ['status: done', 'scope: cross-cutting', `rollout: "[[${RP}]]"`, `pr: ${prOf(30)}`, 'started: 2026-09-18T09:00+00:00', 'merged: 2026-09-18T09:40+00:00'])
  writeTask(d, D.running, ['status: in_progress', 'scope: cross-cutting', `rollout: "[[${RN}]]"`, OWNER, 'started: 2026-09-20T09:00+00:00'])

  // N has run: schedule refuses the repo, naming P, even with --regenerate; N's incomplete is null.
  const r0 = unfinished(d, repo)
  if (r0.rc !== 3 || r0.out !== `refuse ${RP},${RN}\n`) fails.push(`check: rc ${r0.rc}, ${JSON.stringify(r0.out)}`)
  if (!r0.err.includes(`${RP} is named by the supersedes: of ${RN}, which has since run`)) fails.push('check: no named-by refusal')
  if (statusOf(d, RN).incomplete !== null) fails.push('N has run but reads incomplete')
  if (statusOf(d, RP).counts.merged !== 1) fails.push('the legacy note reads no landed task')

  // N never ran (a copy, its task's owner: gone): N is incomplete and the check pairs the two as interrupted.
  const n0 = copyDir(d, path.join(tmp, 'D-never-ran'))
  const runningNote = path.join(n0, `${D.running}.md`)
  fs.writeFileSync(runningNote, fs.readFileSync(runningNote, 'utf8').replace(`${OWNER}\n`, ''))
  if (!statusOf(n0, RN).incomplete) fails.push('N never ran but reads complete')
  const r1 = unfinished(n0, repo)
  if (r1.rc !== 0 || r1.out !== `interrupted ${RP} ${RN}\n`) fails.push(`never ran: rc ${r1.rc}, ${JSON.stringify(r1.out)}`)

  // The close-out (a copy): the stamps, then the move. Schedule's check no longer counts P.
  const c = copyDir(d, path.join(tmp, 'D-closed'))
  const pNote = path.join(c, `${RP}.md`)
  fs.writeFileSync(pNote, fs.readFileSync(pNote, 'utf8').replace('status: in_progress\n', `status: done\nsuperseded_by: "[[${RN}]]"\n`))
  fs.mkdirSync(path.join(c, 'Archive', 'Rollouts'), { recursive: true })
  fs.renameSync(pNote, path.join(c, 'Archive', 'Rollouts', `${RP}.md`))
  const r2 = unfinished(c, repo)
  if (r2.out !== `refuse ${RN}\n` || r2.err.includes('is named by the supersedes')) fails.push(`closed out: ${JSON.stringify(r2.out)}`)
  return { fails, dir: d, successor: path.join(d, `${RN}.md`) }
}

// ---- fixture E: a RACE under the lead, and an UNVERIFIED set-aside (why no resume runs until Lachy decides) ------

// R hit merge-task's exit 5: the lead appended its `## Race log` line and holds the lane while it re-verifies, so
// R reads `review` + `pr:` + `owner:` + `integrating:`, exactly as it still reads after a red re-verify halts the
// lead (no writer runs on a halt): only the owner session tells the two apart. U's merge-task exit 8 ran out
// (`UNVERIFIED:`), and the lead set it aside at Integration. Both PRs read MERGED into the default branch (a gh
// stub answers it), yet `resume`, which a reinstate and every *Cold resume* run first, holds both: exit 3, one
// `HOLD:` line each, both notes byte-identical. Once Lachy's two `RACE decided:` lines are in `## Notes`, it
// exits 0 and flips both done.
const RE = 'proj-rollout-2026-10-03'
const E = { race: 'proj-e-race', unverified: 'proj-e-unverified' }
const UNVERIFIED = `merge-task exit 8 three times: UNVERIFIED: PR #41 merged as ${sha('e')}; not verifiable yet; re-run to verify`

function buildE() {
  const fails = []
  const d = path.join(tmp, 'E')
  fs.mkdirSync(d)
  const link = `rollout: "[[${RE}]]"`
  const S = 'scope: cross-cutting'
  writeRollout(d, RE, Object.values(E))
  const rollout = path.join(d, `${RE}.md`)
  fs.appendFileSync(rollout, `\n## Race log\n\n- 2026-10-02T13:55+00:00 [[${E.race}]] RACE: PR #40 merged as ${sha('f')} on parent ${sha('c')} at head ${sha('a')}, not the integrated pair; re-verify it\n`)
  writeTask(d, E.race, ['status: review', S, link, `pr: ${prOf(40)}`, OWNER, 'started: 2026-10-02T09:00+00:00', 'ready: 2026-10-02T13:00+00:00',
    'integrating: 2026-10-02T13:30+00:00'])
  writeTask(d, E.unverified, ['status: review', S, link, `pr: ${prOf(41)}`, OWNER, 'started: 2026-10-02T09:30+00:00', 'ready: 2026-10-02T12:00+00:00'])
  reconcileIn(d, JSON.parse(must(LEAD, ['set-aside', '--note', path.join(d, `${E.unverified}.md`), '--kind', 'integration'], UNVERIFIED)), '2026-10-02T13:40:00Z')

  const s = statusOf(d, RE)
  const t = Object.fromEntries(s.tasks.map((x) => [x.slug, x]))
  if (t[E.race]?.queueState !== 'integrating' || !t[E.race]?.integrating) fails.push(`the RACE task reads ${t[E.race]?.queueState}`)
  if (!/^owner: /m.test(fmOf(fs.readFileSync(path.join(d, `${E.race}.md`), 'utf8')))) fails.push('the RACE task lost its owner:')
  if (t[E.unverified]?.queueState !== 'set-aside' || t[E.unverified]?.setAsideAt !== 'integration' || !(t[E.unverified]?.blockerSummary ?? '').includes('UNVERIFIED:')) {
    fails.push(`the UNVERIFIED task reads ${t[E.unverified]?.queueState}/${t[E.unverified]?.setAsideAt}`)
  }

  // resume (on a copy) holds both until Lachy's `RACE decided:` lines are recorded, then flips both done.
  const c = copyDir(d, path.join(tmp, 'E-resumed'))
  const gh = path.join(tmp, 'E-gh')
  fs.writeFileSync(gh, '#!/usr/bin/env bash\ncase "$1 $2" in\n  "pr view") printf \'{"state":"MERGED","mergedAt":"2026-10-02T13:55:00Z","baseRefName":"main","url":"%s"}\\n\' "$3" ;;\n  "repo view") echo main ;;\n  *) exit 2 ;;\nesac\n')
  fs.chmodSync(gh, 0o755)
  const resume = () => py(RECONCILE, ['resume', '--rollout', path.join(c, `${RE}.md`), '--tasks-dir', c, '--gh-bin', gh, '--now', NOW])
  const notes = Object.fromEntries(Object.values(E).map((slug) => [slug, fs.readFileSync(path.join(c, `${slug}.md`), 'utf8')]))
  const r = resume()
  const hold = r.err.split('\n').filter((l) => l.startsWith('HOLD: '))
  if (r.rc !== 3) fails.push(`resume exited ${r.rc}, not 3: ${r.err}`)
  if (hold.length !== 2 || !hold.some((l) => l.startsWith(`HOLD: [[${E.race}]] RACE undecided`)) ||
    !hold.some((l) => l.startsWith(`HOLD: [[${E.unverified}]] UNVERIFIED undecided`))) fails.push(`resume's HOLD lines: ${JSON.stringify(hold)}`)
  for (const slug of Object.values(E)) {
    if (fs.readFileSync(path.join(c, `${slug}.md`), 'utf8') !== notes[slug]) fails.push(`resume wrote the held ${slug}`)
  }
  const ro = path.join(c, `${RE}.md`)
  fs.writeFileSync(ro, fs.readFileSync(ro, 'utf8').replace('## Notes\n\n', `## Notes\n\n- 2026-10-02 repair: [[${E.race}]] RACE decided: the merge stands\n` +
    `- 2026-10-02 repair: [[${E.unverified}]] RACE decided: re-verified by hand, the merge stands\n`))
  const r2 = resume()
  if (r2.rc !== 0) fails.push(`resume with both decided exited ${r2.rc}: ${r2.err}`)
  for (const slug of Object.values(E)) {
    const st = fmKey(fs.readFileSync(path.join(c, `${slug}.md`), 'utf8'), 'status')
    if (st !== 'done') fails.push(`resume with both decided left ${slug} ${st}`)
  }
  return { fails }
}

// ---- fixture F: the automatic retry's verdict, as repair and status read it (p16-5, ADR 0033) --------------------

// RF's set-asides each read one verdict from `inputs`: retry (true, budget left), spent (`budget: 2/2 used`), same
// (an identical re-block), asks (a `## Needs you` question once the budget is spent), cooling (an infra cool-down),
// quota (a quota cool-down) and gate (gate-pending with a question). RF2 holds an UNVERIFIED set-aside, which a Drift
// line routes (kept off RF so `next` there never meets its hold), and an at-Integration set-aside with no `pr:`. Both
// rollouts stamp auto_retries and max_review_rounds, so no verdict reads the operator's settings; their Project root
// is gone on purpose (a copy with the stamp stripped reads the budget as unresolved). The blocks are real reconcile
// rows, the retries the real `auto-retry`, the lead's rows `lead-integrate.py set-aside`. `answer` is repair § 3b on
// copies: a stale question blocks every retry; an answer recorded for the current block, a question's or any other
// ask's (a spent budget, answered under a pause), reads as answered until the task is re-entered: a hand-back
// (`auto_retry_sha` then equals its fingerprint, so an identical re-block is a fresh ask), a later run, or a later
// automatic retry (an earlier block's text that comes back, by a new run or, in another section, by `auto_retry_at`
// alone); and the live lead's retry can win the race to a hand-back.
const RF = 'proj-rollout-2026-10-04'
const RF2 = 'proj-rollout-2026-10-04-2'
const F = { retry: 'proj-f-retry', spent: 'proj-f-spent', same: 'proj-f-same', asks: 'proj-f-asks', cooling: 'proj-f-cooling', quota: 'proj-f-quota', gate: 'proj-f-gate' }
const F2 = { unverified: 'proj-f-unverified', nopr: 'proj-f-nopr' }
const F_NOW = '2026-10-04T09:00:00Z'
const F_OWNER = 'execute-2026-10-04-ab12cd34'
const FA = 'Round 1: the plan misses the migration step'
const FB = 'Round 1: the plan still misses the rollback path'
const FC = 'Round 1: the plan names no test for the rollback'
const FQ = 'Which migration tool: alembic or yoyo?'
const FQG = 'Which billing account pays for the API?'
const F_ANSWER = 'use the v2 schema'
const F_ASK = 'budget: 2/2 used: hand it back for a fresh stretch?'
const F_SPENT_ANSWER = 'yes: cover the rollback path in the plan'
// An answer's stamp: after every block's run (the last at 08:00) and before F_NOW's hand-back.
const F_STAMP = '2026-10-04T08:50+00:00'
const TRANSIENT = 'transient infrastructure failure — the agent process died mid-run on a terminal API/connection error'
const QUOTA = 'workflow call failed: API Error: usage limit reached'
const fPath = (d, slug) => path.join(d, `${slug}.md`)
const fRead = (d, slug) => fs.readFileSync(fPath(d, slug), 'utf8')
// Sets (or, with null, drops) one frontmatter key.
function setKey(d, slug, key, value) {
  const t = fRead(d, slug)
  const end = t.indexOf('\n---\n')
  const head = t.slice(0, end).split('\n')
  const i = head.findIndex((l) => l.startsWith(`${key}:`))
  if (value == null) { if (i >= 0) head.splice(i, 1) } else if (i >= 0) head[i] = `${key}: ${value}`
  else head.push(`${key}: ${value}`)
  fs.writeFileSync(fPath(d, slug), head.join('\n') + t.slice(end))
}
// Every F call runs hermetic (HOME empty, the Run record in temp).
const fRun = (script, args, input) => py(script, args, input, STATUS_ENV)
const fMust = (script, args, input) => must(script, args, input, STATUS_ENV)
const fReconcile = (d, result, now) => fMust(RECONCILE, ['reconcile', '--result', '-', '--tasks-dir', d, '--now', now], JSON.stringify(result))
const fBlock = (d, R, slug, status, diagnosis, now, extra = {}) =>
  fReconcile(d, { rolloutSlug: R, tasks: [{ slug, scope: 'cross-cutting', status, prUrl: '', blockerDiagnosis: diagnosis, ...extra }] }, now)
const fLead = (d, slug, kind, reason, now) => fReconcile(d, JSON.parse(fMust(LEAD, ['set-aside', '--note', fPath(d, slug), '--kind', kind], reason)), now)
const inputsAt = (d, slug, now = F_NOW) => JSON.parse(fMust(LEAD, ['inputs', '--note', fPath(d, slug), '--max-review-rounds', '4', '--repo', '/repo', '--now', now]))
const fAutoRetry = (d, R, slug, now, extra = []) => fRun(RECONCILE, ['auto-retry', '--tasks', slug, '--rollout', fPath(d, R), '--tasks-dir', d, '--now', now, ...extra])
const fHandBack = (d, slug, now = F_NOW) => fRun(RECONCILE, ['hand-back', '--tasks', slug, '--tasks-dir', d, '--now', now])
// A restart before a re-block: mark-started, then the call's owner: line.
const fRestart = (d, slug, now) => { fMust(RECONCILE, ['mark-started', '--tasks', slug, '--tasks-dir', d, '--now', now]); setKey(d, slug, 'owner', F_OWNER) }
const fStatus = (d, R) => JSON.parse(fMust(RECONCILE, ['status', '--rollout', fPath(d, R), '--tasks-dir', d, '--now', F_NOW]))
const fNext = (d, R) => JSON.parse(fMust(RECONCILE, ['next', '--rollout', fPath(d, R), '--tasks-dir', d, '--running', '', '--dry-run', '--now', F_NOW]))
const runCount = (text) => (text.match(/^### Run /gm) ?? []).length
// Status's Needs you predicate (status § 4's **Needs you.**): a set-aside at its run or at Integration whose verdict
// is false with no cool-down, not the seeded revise's (unless its pr: is refused), and, with `drift`, one no Drift
// line routes (an undecided UNVERIFIED here: the RACE / UNVERIFIED flag).
const needsYouItem = (t, i, { drift = true } = {}) => ['run', 'integration'].includes(t.setAsideAt) && i.autoRetry === false && !i.autoRetryAfter &&
  (!i.autoRevise || !!i.prUrlError) && !(drift && (t.blockerSummary ?? '').includes('UNVERIFIED:'))
// Repair § 3b's answer's entry, as its template renders: `- <stamp> <kind> (block <fingerprint>): "<ask>" → <answer>`.
const entryOf = (stamp, kind, fp, ask, answer) => `- ${stamp} ${kind} (block ${fp}): "${ask}" → ${answer}`
// Repair § 3b's *Answer already recorded*, read off the note: an entry keyed on the block, stamped later than the
// note's last re-entry (its latest `### Run <n> (<stamp>)` heading and its `auto_retry_at:`), while `auto_retry_sha`
// differs. `runs` / `retryAt` false drop that half of the last re-entry, to show what each one catches.
function answeredIn(d, slug, fp, { runs = true, retryAt = true } = {}) {
  if (!fp) return false
  const text = fRead(d, slug)
  const lines = text.split('\n')
  const marks = lines.flatMap((l) => {
    const r = runs && l.match(/^### Run \d+ \(([^)]*)\)/)
    const a = retryAt && l.match(/^auto_retry_at: (.*)$/)
    return r ? [r[1]] : a ? [a[1]] : []
  }).map(Date.parse)
  const last = Math.max(-Infinity, ...marks)
  return lines.some((l) => l.includes(`(block ${fp})`) && Date.parse(l.split(' ')[1]) > last) && fmKey(text, 'auto_retry_sha') !== fp
}
// Repair § 3b's needs-you flow, by hand: the answer into `## Repair input`, then the `## Needs you` section removed.
function answerNote(d, slug, entry) {
  let t = fRead(d, slug)
  const s = t.indexOf('\n## Needs you\n')
  if (s >= 0) {
    const e = t.indexOf('\n## ', s + 1)
    t = t.slice(0, s) + (e < 0 ? '\n' : t.slice(e))
  }
  t = t.includes('\n## Repair input\n') ? t.replace('\n## Repair input\n\n', `\n## Repair input\n\n${entry}\n`) : `${t.replace(/\n*$/, '\n')}\n## Repair input\n\n${entry}\n`
  fs.writeFileSync(fPath(d, slug), t)
}

function buildF() {
  const d = path.join(tmp, 'F')
  fs.mkdirSync(d)
  const repo = path.join(tmp, 'F-root-gone')
  const budget = ['auto_retries: 2', 'max_review_rounds: 4']
  writeRollout(d, RF, Object.values(F), budget, { repo })
  writeRollout(d, RF2, Object.values(F2), budget, { repo })
  const task = (R, slug, fm = []) => writeTask(d, slug, ['status: in_progress', 'scope: cross-cutting', `rollout: "[[${R}]]"`, `owner: ${F_OWNER}`,
    'started: 2026-10-04T06:00+00:00', ...fm])
  for (const slug of Object.values(F)) task(RF, slug)
  const plan = (slug, fb, now, extra) => fBlock(d, RF, slug, 'plan-blocked', fb, now, extra)
  const retried = (slug, now) => { const r = fAutoRetry(d, RF, slug, now); if (r.rc !== 0) throw new Error(`F: auto-retry ${slug} exited ${r.rc}: ${r.err}`) }
  plan(F.retry, FA, '2026-10-04T07:00:00Z')
  // spent and asks: FA → retry → FB → retry → FC (asks' FC carries a question); same: FA → retry → FA again.
  for (const slug of [F.spent, F.asks, F.same]) {
    plan(slug, FA, '2026-10-04T07:00:00Z')
    retried(slug, '2026-10-04T07:05:00Z')
    fRestart(d, slug, '2026-10-04T07:06:00Z')
  }
  plan(F.same, FA, '2026-10-04T07:30:00Z')
  for (const slug of [F.spent, F.asks]) {
    plan(slug, FB, '2026-10-04T07:30:00Z')
    retried(slug, '2026-10-04T07:35:00Z')
    fRestart(d, slug, '2026-10-04T07:36:00Z')
  }
  plan(F.spent, FC, '2026-10-04T08:00:00Z')
  plan(F.asks, FC, '2026-10-04T08:00:00Z', { needsHuman: FQ })
  fBlock(d, RF, F.cooling, 'blocked', TRANSIENT, '2026-10-04T08:58:00Z')
  fLead(d, F.quota, 'own', QUOTA, '2026-10-04T08:58:00Z')
  fReconcile(d, { rolloutSlug: RF, tasks: [{ slug: F.gate, scope: 'cross-cutting', status: 'gate-pending', gatedInputs: ['spend: a paid API — cap USD 5'], needsHuman: FQG }] },
    '2026-10-04T08:00:00Z')
  // RF2: an UNVERIFIED set-aside at Integration, and an Integration set-aside whose pr: is then lost.
  for (const [slug, n] of [[F2.unverified, 50], [F2.nopr, 51]]) {
    writeTask(d, slug, ['status: review', 'scope: cross-cutting', `rollout: "[[${RF2}]]"`, `pr: ${prOf(n)}`, `owner: ${F_OWNER}`, 'started: 2026-10-04T06:00+00:00',
      'ready: 2026-10-04T07:00+00:00'])
  }
  fLead(d, F2.unverified, 'integration', UNVERIFIED, '2026-10-04T08:00:00Z')
  fLead(d, F2.nopr, 'integration', 'conflict in a.js cannot be resolved', '2026-10-04T08:00:00Z')
  setKey(d, F2.nopr, 'pr', null)

  const all = [...Object.values(F), ...Object.values(F2)]
  const I = Object.fromEntries(all.map((s) => [s, inputsAt(d, s)]))
  const T = Object.fromEntries([...fStatus(d, RF).tasks, ...fStatus(d, RF2).tasks].map((t) => [t.slug, t]))
  const fp = (slug) => I[slug].fingerprint

  // split: each set-aside reads its verdict, and the Needs you predicate picks exactly the three Lachy owns.
  const split = []
  const r = I[F.retry]
  if (r.autoRetry !== true || r.autoRetriesUsed !== 0 || r.autoRetryBudget?.autoRetries?.value !== 2 || r.autoRetryBudget?.autoRetries?.source !== 'rollout') {
    split.push(`retry: ${JSON.stringify([r.autoRetry, r.autoRetriesUsed, r.autoRetryBudget])}`)
  }
  if (I[F.spent].autoRetry !== false || I[F.spent].autoRetryWhy !== 'budget: 2/2 used') split.push(`spent: ${I[F.spent].autoRetryWhy}`)
  if (I[F.same].autoRetry !== false || I[F.same].autoRetryWhy !== 'same feedback as the block last re-entered' || !fp(F.same) ||
    fmKey(fRead(d, F.same), 'auto_retry_sha') !== fp(F.same)) split.push(`same: ${I[F.same].autoRetryWhy}`)
  const a = I[F.asks]
  if (a.autoRetry !== false || !a.autoRetryWhy.startsWith('needs a human') || T[F.asks]?.needsHuman !== FQ || a.autoRetryClass == null || a.autoRetryBudget !== null) {
    split.push(`asks: ${JSON.stringify([a.autoRetryWhy, T[F.asks]?.needsHuman, a.autoRetryClass, a.autoRetryBudget])}`)
  }
  const c = I[F.cooling]
  if (c.autoRetry !== false || c.autoRetryClass !== 'infra' || !c.autoRetryAfter) split.push(`cooling: ${JSON.stringify([c.autoRetryClass, c.autoRetryAfter])}`)
  const gCopy = copyDir(d, path.join(tmp, 'F-gate'))
  const gHb = fHandBack(gCopy, F.gate)
  if (T[F.gate]?.setAsideAt !== 'gate' || T[F.gate]?.needsHuman !== FQG || !I[F.gate].autoRetryWhy.startsWith('gate-pending') ||
    gHb.rc !== 1 || fmKey(fRead(gCopy, F.gate), 'status') !== 'gate-pending') split.push(`gate: ${JSON.stringify([T[F.gate]?.setAsideAt, I[F.gate].autoRetryWhy, gHb.rc])}`)
  const picked = Object.values(F).filter((s) => T[s]?.queueState === 'set-aside' && needsYouItem(T[s], I[s])).sort()
  if (JSON.stringify(picked) !== JSON.stringify([F.spent, F.same, F.asks].sort())) split.push(`needs you picks ${JSON.stringify(picked)}`)

  // render: a count shows only where the verdict reached the budget; `?` only for an unresolved one.
  const render = []
  const q = I[F.quota]
  if (!r.autoRetryBudget) render.push('retry: no budget')
  if (a.autoRetryBudget !== null || a.autoRetryWhy.startsWith('auto_retries unresolved')) render.push('asks: a budget')
  if (q.autoRetryClass !== 'quota' || !q.autoRetryBudget || !q.autoRetryAfter || q.quotaRetriesUsed !== 0) {
    render.push(`quota: ${JSON.stringify([q.autoRetryClass, q.autoRetryBudget, q.autoRetryAfter, q.quotaRetriesUsed])}`)
  }
  const u = copyDir(d, path.join(tmp, 'F-unresolved'))
  const ro = fPath(u, RF)
  fs.writeFileSync(ro, fs.readFileSync(ro, 'utf8').replace('auto_retries: 2\n', ''))
  const ur = inputsAt(u, F.retry)
  if (!ur.autoRetryWhy.startsWith('auto_retries unresolved') || ur.autoRetryBudget !== null) render.push(`unresolved: ${ur.autoRetryWhy}`)

  // held: an undecided UNVERIFIED set-aside is refused, and only the Drift exclusion keeps it out of the block.
  const held = []
  const uv = I[F2.unverified]
  if (T[F2.unverified]?.setAsideAt !== 'integration' || uv.autoRetry !== false || !uv.autoRetryWhy.startsWith('UNVERIFIED undecided')) held.push(`unverified: ${uv.autoRetryWhy}`)
  if (!needsYouItem(T[F2.unverified], uv, { drift: false }) || needsYouItem(T[F2.unverified], uv)) held.push('the Drift exclusion')

  // nopr: an at-Integration set-aside with no pr: is refused by the verdict and by hand-back.
  const nopr = []
  const n = I[F2.nopr]
  if (T[F2.nopr]?.setAsideAt !== 'integration' || T[F2.nopr]?.pr != null || !n.autoRetryWhy.startsWith('set aside at Integration with no pr:')) {
    nopr.push(`nopr: ${JSON.stringify([T[F2.nopr]?.setAsideAt, T[F2.nopr]?.pr, n.autoRetryWhy])}`)
  }
  const nCopy = copyDir(d, path.join(tmp, 'F-nopr'))
  const nBefore = fRead(nCopy, F2.nopr)
  const nHb = fHandBack(nCopy, F2.nopr)
  if (nHb.rc !== 1 || !nHb.err.includes('set aside at Integration with no pr:') || fRead(nCopy, F2.nopr) !== nBefore) nopr.push(`hand-back: ${nHb.rc} ${nHb.err}`)

  return { split: { fails: split }, render: { fails: render }, held: { fails: held }, nopr: { fails: nopr }, answer: answerF(d, fp(F.asks), fp(F.spent)) }
}

// Repair § 3b on copies of F's `asks` (its budget spent, a `## Needs you` question open), `spent` (its budget spent, no
// question) and `retry` (budget left).
function answerF(d0, fp, spentFp) {
  const fails = []
  const slug = F.asks
  const entry = entryOf(F_STAMP, 'needs you', fp, FQ, F_ANSWER)
  if (!fp || !spentFp) fails.push('asks or spent has no fingerprint')
  // (i) A stale question: a hand-back that leaves `## Needs you`, a restart, then a lead-written dead call. The lead's
  // row clears no question, so the verdict still reads needs a human: why repair removes the section.
  const i = copyDir(d0, path.join(tmp, 'F-stale'))
  if (fHandBack(i, slug).rc !== 0) fails.push('(i) hand-back refused')
  fRestart(i, slug, '2026-10-04T09:01:00Z')
  fLead(i, slug, 'own', 'workflow call failed: no result row', '2026-10-04T09:10:00Z')
  if (!inputsAt(i, slug, '2026-10-04T12:00:00Z').autoRetryWhy.startsWith('needs a human')) fails.push('(i) a stale question reads answered')

  // (ii) Answered: the entry, the section removed; the verdict reads the spent budget and the entry reads answered;
  // hand-back starts the fresh stretch, stamping auto_retry_sha with this block. An identical re-block then writes no
  // run and is a fresh ask.
  const answered = copyDir(d0, path.join(tmp, 'F-answered'))
  answerNote(answered, slug, entry)
  const t0 = fStatus(answered, RF).tasks.find((t) => t.slug === slug)
  const v0 = inputsAt(answered, slug)
  if (!t0 || 'needsHuman' in t0) fails.push('(ii) status still carries needsHuman')
  if (v0.autoRetryWhy !== 'budget: 2/2 used' || v0.fingerprint !== fp || !answeredIn(answered, slug, fp)) {
    fails.push(`(ii) answered: ${JSON.stringify([v0.autoRetryWhy, v0.fingerprint, fmKey(fRead(answered, slug), 'auto_retry_sha')])}`)
  }
  const answeredDir = copyDir(answered, path.join(tmp, 'F-answered-snapshot'))
  const hb = fHandBack(answered, slug)
  const after = fRead(answered, slug)
  if (hb.rc !== 0) fails.push(`(ii) hand-back exited ${hb.rc}: ${hb.err}`)
  if (!fNext(answered, RF).restart.includes(slug)) fails.push('(ii) next does not restart it')
  if (fmKey(after, 'auto_retries_used') !== undefined || fmKey(after, 'auto_retry_sha') !== fp || !after.includes(entry)) {
    fails.push(`(ii) after the hand-back: ${JSON.stringify([fmKey(after, 'auto_retries_used'), fmKey(after, 'auto_retry_sha'), after.includes(entry)])}`)
  }
  const runs = runCount(after)
  fRestart(answered, slug, '2026-10-04T09:01:00Z')
  fBlock(answered, RF, slug, 'plan-blocked', FC, '2026-10-04T09:30:00Z')
  const re = fRead(answered, slug)
  const v1 = inputsAt(answered, slug, '2026-10-04T09:30:00Z')
  if (runCount(re) !== runs || v1.fingerprint !== fp || v1.autoRetryWhy !== 'same feedback as the block last re-entered' ||
    fmKey(re, 'auto_retry_sha') !== fp || !re.includes(entry) || answeredIn(answered, slug, fp)) {
    fails.push(`(ii) re-blocked: ${JSON.stringify([runCount(re), runs, v1.fingerprint, v1.autoRetryWhy, fmKey(re, 'auto_retry_sha')])}`)
  }
  const reblockedDir = answered

  // (iii) The race: with budget left once the section is gone, the live lead's retry re-enters it first; hand-back
  // then refuses a running note, and the retry spent a budget slot instead of a fresh stretch.
  const race = copyDir(d0, path.join(tmp, 'F-race'))
  setKey(race, slug, 'auto_retries', 3)
  answerNote(race, slug, entry)
  const at0 = fmKey(fRead(race, slug), 'auto_retry_at')
  const v2 = inputsAt(race, slug)
  if (v2.autoRetry !== true) fails.push(`(iii) the verdict reads ${v2.autoRetryWhy}`)
  const ar = fAutoRetry(race, RF, slug, F_NOW, ['--auto-retries', '3', '--fingerprint', fp])
  if (ar.rc !== 0 || fmKey(fRead(race, slug), 'auto_retry_at') === at0) fails.push(`(iii) auto-retry exited ${ar.rc}: ${ar.err}`)
  const hb3 = fHandBack(race, slug)
  const t3 = fRead(race, slug)
  if (hb3.rc !== 1 || !hb3.err.includes("status is 'in_progress'") || !t3.includes(entry) || fmKey(t3, 'auto_retries_used') !== '3') {
    fails.push(`(iii) hand-back after the retry: ${JSON.stringify([hb3.rc, hb3.err, fmKey(t3, 'auto_retries_used')])}`)
  }

  // (iv) A spent budget with no question, answered under a pause: repair writes the `decision` entry and hands
  // nothing back. Reinstated, the verdict still reads the spent budget, so the lead never re-enters it, and the entry
  // reads answered: the next repair run hands it back without asking, once (the entry is spent by that hand-back).
  const spent = F.spent
  const spentEntry = entryOf(F_STAMP, 'decision', spentFp, F_ASK, F_SPENT_ANSWER)
  const sp = copyDir(d0, path.join(tmp, 'F-spent-paused'))
  setKey(sp, RF, 'paused', '2026-10-04T08:40+00:00')
  answerNote(sp, spent, spentEntry)
  if (fNext(sp, RF).paused == null) fails.push('(iv) the rollout reads no pause')
  setKey(sp, RF, 'paused', null)
  const v4 = inputsAt(sp, spent)
  if (v4.autoRetry !== false || v4.autoRetryWhy !== 'budget: 2/2 used' || v4.fingerprint !== spentFp || !answeredIn(sp, spent, spentFp)) {
    fails.push(`(iv) reinstated: ${JSON.stringify([v4.autoRetry, v4.autoRetryWhy, v4.fingerprint, answeredIn(sp, spent, spentFp)])}`)
  }
  const spentAnsweredDir = copyDir(sp, path.join(tmp, 'F-spent-answered'))
  const hb4 = fHandBack(sp, spent)
  if (hb4.rc !== 0 || !fNext(sp, RF).restart.includes(spent) || answeredIn(sp, spent, spentFp)) {
    fails.push(`(iv) handed back: ${JSON.stringify([hb4.rc, hb4.err, answeredIn(sp, spent, spentFp)])}`)
  }
  const spentHandedDir = copyDir(sp, path.join(tmp, 'F-spent-handed'))

  // (v) The block comes back: answered and handed back (sha = FC), then FA and FB retried automatically (sha = FB),
  // then FC again with the budget spent. FC's entry still matches the fingerprint and auto_retry_sha differs, so only
  // its stamp, older than the later runs, keeps it from handing back on the old answer.
  const retried = (d, s, now) => { const r = fAutoRetry(d, RF, s, now); if (r.rc !== 0) fails.push(`auto-retry ${s} at ${now} exited ${r.rc}: ${r.err}`) }
  fRestart(sp, spent, '2026-10-04T09:01:00Z')
  fBlock(sp, RF, spent, 'plan-blocked', FA, '2026-10-04T09:10:00Z')
  retried(sp, spent, '2026-10-04T09:15:00Z')
  fRestart(sp, spent, '2026-10-04T09:16:00Z')
  fBlock(sp, RF, spent, 'plan-blocked', FB, '2026-10-04T09:20:00Z')
  retried(sp, spent, '2026-10-04T09:25:00Z')
  fRestart(sp, spent, '2026-10-04T09:26:00Z')
  fBlock(sp, RF, spent, 'plan-blocked', FC, '2026-10-04T09:30:00Z')
  const v5 = inputsAt(sp, spent, '2026-10-04T09:30:00Z')
  if (v5.autoRetryWhy !== 'budget: 2/2 used' || v5.fingerprint !== spentFp || fmKey(fRead(sp, spent), 'auto_retry_sha') === spentFp ||
    !answeredIn(sp, spent, spentFp, { runs: false, retryAt: false }) || answeredIn(sp, spent, spentFp, { retryAt: false }) || answeredIn(sp, spent, spentFp)) {
    fails.push(`(v) returned: ${JSON.stringify([v5.autoRetryWhy, v5.fingerprint, answeredIn(sp, spent, spentFp, { retryAt: false })])}`)
  }
  const returnedDir = sp

  // (v') The same with every retry off: FC answered and handed back, FA blocked and handed back by "retry [[task]]"
  // (no entry, no auto_retry_at), then FC again. Only the newer runs read the re-entry.
  const mn = copyDir(spentHandedDir, path.join(tmp, 'F-spent-manual'))
  setKey(mn, spent, 'auto_retries', 0)
  fRestart(mn, spent, '2026-10-04T09:01:00Z')
  fBlock(mn, RF, spent, 'plan-blocked', FA, '2026-10-04T09:10:00Z')
  if (fHandBack(mn, spent, '2026-10-04T09:15:00Z').rc !== 0) fails.push("(v') hand-back refused")
  fRestart(mn, spent, '2026-10-04T09:16:00Z')
  fBlock(mn, RF, spent, 'plan-blocked', FC, '2026-10-04T09:30:00Z')
  const v5m = inputsAt(mn, spent, '2026-10-04T09:30:00Z')
  if (v5m.autoRetry !== false || v5m.fingerprint !== spentFp || fmKey(fRead(mn, spent), 'auto_retry_at') !== fmKey(fRead(spentHandedDir, spent), 'auto_retry_at') ||
    !answeredIn(mn, spent, spentFp, { runs: false }) || answeredIn(mn, spent, spentFp)) {
    fails.push(`(v') manual: ${JSON.stringify([v5m.autoRetryWhy, v5m.fingerprint, answeredIn(mn, spent, spentFp, { runs: false })])}`)
  }
  const manualDir = mn

  // (vi) The same, across sections: FA plan-blocked, retried, a red verifier (blocked), retried, FA plan-blocked again
  // (that section's top run is FA, so no run is written), answered and handed back, the red verifier again (no run),
  // retried with a one-retry budget, then FA again with the budget spent. No run is newer than the answer, so only
  // `auto_retry_at` reads the re-entry.
  const RED = 'verifier red: test_rollback fails'
  const cr = copyDir(d0, path.join(tmp, 'F-crossed'))
  const rs = F.retry
  retried(cr, rs, '2026-10-04T07:05:00Z')
  fRestart(cr, rs, '2026-10-04T07:06:00Z')
  fBlock(cr, RF, rs, 'blocked', RED, '2026-10-04T07:30:00Z')
  retried(cr, rs, '2026-10-04T07:35:00Z')
  fRestart(cr, rs, '2026-10-04T07:36:00Z')
  fBlock(cr, RF, rs, 'plan-blocked', FA, '2026-10-04T08:00:00Z')
  const crFp = inputsAt(cr, rs).fingerprint
  const crRuns = runCount(fRead(cr, rs))
  answerNote(cr, rs, entryOf(F_STAMP, 'decision', crFp, F_ASK, F_SPENT_ANSWER))
  if (!crFp || inputsAt(cr, rs).autoRetryWhy !== 'budget: 2/2 used' || crRuns !== 2 || !answeredIn(cr, rs, crFp)) {
    fails.push(`(vi) answered: ${JSON.stringify([crFp, inputsAt(cr, rs).autoRetryWhy, crRuns])}`)
  }
  if (fHandBack(cr, rs).rc !== 0) fails.push('(vi) hand-back refused')
  setKey(cr, rs, 'auto_retries', 1)
  fRestart(cr, rs, '2026-10-04T09:01:00Z')
  fBlock(cr, RF, rs, 'blocked', RED, '2026-10-04T09:10:00Z')
  retried(cr, rs, '2026-10-04T09:15:00Z')
  fRestart(cr, rs, '2026-10-04T09:16:00Z')
  fBlock(cr, RF, rs, 'plan-blocked', FA, '2026-10-04T09:30:00Z')
  const v6 = inputsAt(cr, rs, '2026-10-04T09:30:00Z')
  if (runCount(fRead(cr, rs)) !== crRuns || v6.autoRetryWhy !== 'budget: 1/1 used' || v6.fingerprint !== crFp ||
    !answeredIn(cr, rs, crFp, { retryAt: false }) || answeredIn(cr, rs, crFp)) {
    fails.push(`(vi) crossed: ${JSON.stringify([runCount(fRead(cr, rs)), crRuns, v6.autoRetryWhy, v6.fingerprint, answeredIn(cr, rs, crFp, { retryAt: false })])}`)
  }
  const crossedDir = cr

  return {
    fails, fp, q: FQ, a: F_ANSWER, stamp: F_STAMP, slug, entry, answeredDir, reblockedDir,
    spent: { slug: spent, fp: spentFp, ask: F_ASK, a: F_SPENT_ANSWER, entry: spentEntry, answeredDir: spentAnsweredDir, handedDir: spentHandedDir, returnedDir, manualDir },
    crossed: { slug: rs, fp: crFp, dir: crossedDir },
  }
}

const fxA = await buildA()
const dB0 = buildBBase()
const dBC = copyDir(dB0, path.join(tmp, 'B-pristine'))
const fx = { A: fxA, B: buildB(dB0), C: buildC(dBC), D: buildD(), E: buildE(), F: buildF() }

// ---- the prose ------------------------------------------------------------------------------------------------

const real = { status: read('skills/status/SKILL.md'), repair: read('skills/repair/SKILL.md'), fx }

const IN_COUNT = ['merged', 'integrating', 'awaiting-integration', 'running', 'queued', 'set-aside']
const COUNT_KEY = { merged: 'merged', integrating: 'integrating', 'awaiting-integration': 'awaitingIntegration', running: 'running', queued: 'queued', 'set-aside': 'setAside' }
// Repair § 2's classes, first-match in this order: a RACE re-verify in flight first (the lead's own procedure), then
// RACE and a PR-less merge ahead of merged-never-marked and at Integration (both also match a RACE / UNVERIFIED
// task), PR CLOSED ahead of awaiting Integration, a plan-block after a descope ahead of the descopable one, and both
// ahead of the automatic retry (a descope is judged first, as execute's step 1.2 judges it) and of the own run they
// also match; the automatic retry and a `## Needs you` question ahead of at Integration and every class below it.
const LABELS = ['RACE re-verify in flight', 'RACE', 'PR-less merge', 'merged into another base', 'merged, never marked', 'merge hold', 'live', 'PR CLOSED / branch missing',
  'awaiting Integration', 'queued', 'plan-blocked after a descope', 'plan-blocked, descopable', 'retry (automatic)', 'needs you', 'at Integration',
  'revise (automatic)', 'revise stopped', 'review-blocked, rejected', 'own run', 'gate']
const ROUTES = ['Stale anchor ref', 'The raise', 'A `merge-task:` own-run set-aside', 'A CLOSED PR or a missing branch', 'Recut', 'Leash', 'Hand-off']
// Status's recommended actions, first-match in this order: the lineage before the version (a legacy note can be
// a close-out), and an open escalation before every reinstate, wait and resume.
const ACTIONS = ['`superseded_by:`', "named by another rollout's `supersedes:`", 'predates the queue', 'unsupported protocol version', '`incomplete`',
  'every task merged', 'an open escalation', '`paused`', '`pause_requested`', 'a live queue', 'any drift flag', 'awaiting integration', 'nothing started']
const RUN = { escalation: ACTIONS.indexOf('an open escalation') + 1, nothing: ACTIONS.length }
const CAVEAT = 'drift is invisible offline; re-run with the live check before resuming'
const ANCHOR = 'update-ref -d refs/integration-anchor/<inputs.branch> <X>'
// The only commands status may invoke: its two script reads, § 3's gh/git reads and execute § 4's default-branch
// resolver (the grep reads are no command).
const READS = ['reconcile-rollout.py status', 'lead-integrate.py inputs', 'gh pr view', 'gh pr list', 'git worktree list', 'git remote get-url',
  'default-branch.sh']
const BAN = /\bwaves?\b|merged_through_wave|resume-filter|mark-dispatched|cursor behind|advance the cursor|smart-halt|single-wave|re-?wave|protocol 4/i
const TIER_WORDS = [['max', 'tier'].join('_'), ['tier', 'capped'].join('_'), ['Opus', '4.8'].join(' '), ['err toward', 'fable'].join(' ')]   // the tier vocabulary (ADR 0029), built from parts so this file stays out of the Verify grep
const UNLANDED = 'queued, running, awaiting-integration, integrating or set-aside'

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
// `- ` items with their indented continuation lines joined (a line at column 0 ends the list).
function bullets(text) {
  const out = []
  for (const l of (text ?? '').split('\n')) {
    if (l.startsWith('- ')) out.push(l.slice(2))
    else if (out.length && /^\s+\S/.test(l)) out[out.length - 1] += ' ' + l.trim()
    else if (out.length && l.trim()) break
  }
  return out
}
const before = (hay, a, b) => hay.indexOf(a) >= 0 && hay.indexOf(b) >= 0 && hay.indexOf(a) < hay.indexOf(b)
// Every command the text invokes, read from its fenced blocks (shell comments dropped) and inline code spans (an
// escaped \` is a literal, never a delimiter; prose invokes nothing): a script verb (`<x>.py <verb>`), a `.sh`
// script, a `gh` or `git` subcommand, and a file writer (mv, rm, …).
function invocations(text) {
  const fenced = []
  const prose = []
  let inFence = false
  for (const l of (text ?? '').split('\n')) {
    if (FENCE.test(l)) { inFence = !inFence; continue }
    if (inFence) fenced.push(l.replace(/\s#\s.*$/, ''))
    else prose.push(l)
  }
  const spans = [...fenced, ...[...prose.join('\n').replace(/\\`/g, "'").matchAll(/`([^`]+)`/g)].map((m) => m[1])]
  const out = []
  for (const s of spans) {
    for (const m of s.matchAll(/([\w-]+\.py)\s+([a-z][\w-]*)/g)) out.push(`${m[1]} ${m[2]}`)
    for (const m of s.matchAll(/([\w-]+\.sh)\b/g)) out.push(m[1])
    for (const m of s.matchAll(/\bgh\s+([a-z]+)\s+([a-z-]+)/g)) out.push(`gh ${m[1]} ${m[2]}`)
    for (const m of s.matchAll(/\bgit\s+(?:-C\s+\S+\s+)?([a-z-]+)(?:\s+([a-z-]+))?/g)) out.push(`git ${m[1]}${m[2] ? ' ' + m[2] : ''}`)
    for (const m of s.matchAll(/(?:^|[|;&]\s*)(mv|rm|mkdir|cp|touch|tee|sed\s+-i)\b/gm)) out.push(m[1])
  }
  return out
}

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
  // gh pr list matched on inputs.branch; D4 the offline caveat; D5 the example Drift block; D6 review required
  // reads both review decisions merge-task's exit 7 fires on.
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
    flag('Review required:').includes('`reviewDecision: REVIEW_REQUIRED` or `CHANGES_REQUESTED`'),
  ]
  if (!D.every(Boolean)) fails.push('drift')

  // actions: the first-match order is the precedence, with no override on top: the lineage before the version,
  // and the open escalation (an undecided RACE or a possible PR-less merge) before every reinstate, wait and
  // resume, the drain's included; a drain nothing is draining resumes; a live queue points at repair's live-queue
  // mode for the set-asides the lead never re-enters by itself (ADR 0033: its automatic retry re-enters the rest).
  const items = numbered(labelledRaw(s4raw, 'Recommended action'))
  const liveItem = items[ACTIONS.indexOf('a live queue')] ?? ''
  const drainItem = items[ACTIONS.indexOf('`pause_requested`')] ?? ''
  const prec = labelled(s4raw, 'Precedence.')
  if (items.length !== ACTIONS.length || !ACTIONS.every((k, i) => (items[i] ?? '').toLowerCase().startsWith(k.toLowerCase())) ||
    !(items[RUN.escalation - 1] ?? '').includes('a possible PR-less merge → `/thread:repair [[<rollout>]]`') ||
    !prec.includes('The order is the precedence, with no override on top of it') || !prec.includes('Lineage (1, 2) comes before the version (3, 4)') ||
    !prec.includes(`An open escalation (${RUN.escalation}) comes before every reinstate, wait and resume (${RUN.escalation + 1} to ${RUN.nothing})`) ||
    !drainItem.includes('nothing is draining it, and `/thread:execute [[<rollout>]]` resumes the drain') ||
    !liveItem.includes('Every other set-aside task is never re-entered by the live lead itself') ||
    !liveItem.includes('its live-queue mode asks you those and hands each back on your answer')) fails.push('actions')

  // lineage (status § 1 and repair § 1): a legacy note gets execute § 2's remedy; any other non-5 version is
  // unsupported; incomplete and supersede are stops.
  const stops = labelled(r1raw, 'Stops**')
  if (!s1.includes('Absent, `2` or `3`') || !s1.includes('hard-pause it') || !s1.includes('/thread:schedule <project> --regenerate') ||
    !s1.includes('"unsupported protocol version <N>; the queue reads protocol_version: 5"') || !s1.includes('`incomplete`') ||
    !s1.includes('`superseded_by:`') ||
    !stops.includes('absent, `2` or `3`') || !stops.includes("execute § 2's remedy") || !stops.includes('"unsupported protocol version <N>') ||
    !stops.includes('`incomplete`') || !stops.includes('/thread:schedule <project> --regenerate') || !stops.includes('`superseded_by:`')) fails.push('lineage')

  // read-only, pinned positively: outside its Don'ts, status invokes its two script reads and § 3's gh/git reads,
  // and nothing else (no other script verb, no .sh, no gh or git writer, no file writer); the Don'ts name next.
  const calls = invocations(sb.replace(sDonts, ''))
  if (!calls.includes('reconcile-rollout.py status') || !calls.includes('lead-integrate.py inputs') || calls.some((c) => !READS.includes(c)) ||
    !collapse(sDonts).includes('`reconcile-rollout.py next`')) fails.push('read-only')

  // reverse-lineage: status § 1 reads the lineage before the version and finds a rollout whose supersedes: names
  // this one, as unfinished-rollout.py reads the link (its grep, run on fixture D, finds N's aliased, differently
  // cased link), splitting it on that successor's incomplete; the headline names the interrupted close-out;
  // repair's stops put the lineage before the version and finish schedule step 7.5's close-out on Lachy's
  // confirmation (the stamps, then the move); schedule's refusal line routes to that stop; fixture D holds.
  const s1raw = raw(status, /^### 1\. /)
  const actionRL = items.find((i) => i.startsWith("Named by another rollout's `supersedes:`")) ?? ''
  const rl = (stops.match(/- \*\*Close-out interrupted\*\*.*/) ?? [''])[0]
  const sent = labelled(r1raw, "Sent here by schedule's unfinished-rollout refusal.")
  const gm = s1raw.match(/`grep (-[a-zA-Z]+) '([^']+)' ~\/repos\/obsidian\/Work\/Tasks\/ --include='\*\.md'`/)
  const found = gm ? spawnSync('grep', [gm[1], gm[2].replaceAll('<slug>', RP), fx.D.dir, '--include=*.md'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean) : []
  if (!s1.includes("look for a rollout whose `supersedes:` names this one") || JSON.stringify(found) !== JSON.stringify([fx.D.successor]) ||
    !before(s1raw, '**Reverse lineage.**', '**Protocol version.**') || !s1.includes('**Lineage first, then the version.**') ||
    !before(stops, '**Close-out interrupted**', '`protocol_version` absent') || !stops.includes('at any `protocol_version`') ||
    fx.D.fails.length ||
    !s1.includes('headline `superseded by [[N]], close-out interrupted`') || !s1.includes("Read N's `incomplete`") ||
    !s1.includes('must never be reinstated or resumed') || !actionRL.includes('never reinstate or resume it') ||
    !actionRL.includes("`/thread:repair [[<rollout>]]`, which finishes schedule step 7.5's close-out") ||
    !rl.includes("finish step 7.5's close-out, **on Lachy's confirmation**") ||
    !['`status: done`', '`superseded_by: "[[N]]"`', 'Archive/Rollouts/', 'plain `mv`', 'skip the move', 'Never reinstate, resume or hand back here']
      .every((k) => rl.includes(k)) ||
    !sent.includes('`<P> is named by the supersedes: of <N>, which has since run`') || !sent.includes('**Close-out interrupted** stop')) {
    fails.push('reverse-lineage')
  }

  // ---- repair ----
  const clsRows = tableRows(r2raw).filter((c) => /^\*\*[^*]+\*\*$/.test(c[0]))
  const cls = Object.fromEntries(clsRows.map((c) => [c[0].slice(2, -2), c.slice(1).join(' | ')]))
  const r3a = labelled(r3raw, '3a')
  const c3 = labelled(r3raw, '3c')
  const r4 = collapse(r4raw)

  // integration-only: at Integration hands back to Integration alone, and fixture B shows that is all it does.
  // Case (ii) is conditional: it holds only when main has not moved since the recorded Integration.
  const atI = cls['at Integration'] ?? ''
  if (!atI.includes('`reconcile-rollout.py hand-back --tasks <slug>`') || !atI.includes('Integration only') ||
    !atI.includes('nothing before Integration is redone') || /case \(ii\) with nothing redone/.test(collapse(rb)) ||
    !r4.includes('it merges through case (ii) when main has not moved since that Integration; otherwise `prepare` integrates it again') ||
    !labelled(r4raw, 'A `merge-task:` own-run set-aside', { item: true }).includes('it merges through case (ii) when main has not moved') ||
    fx.B.fails.length) fails.push('integration-only')

  // stages: the 20 classes, each once, and § 4's per-stage routes.
  if (JSON.stringify(clsRows.map((c) => c[0].slice(2, -2)).sort()) !== JSON.stringify([...LABELS].sort()) ||
    !ROUTES.every((l) => r4raw.split('\n').some((x) => x.startsWith(`- **${l}`))) ||
    !r4.includes('lead-integrate.py set-aside --note <task note> --kind integration')) fails.push('stages')

  // first-match: the classes are first-match in LABELS' order, and every resume (§ 3a, the hand-off) is held while
  // a RACE / UNVERIFIED escalation is undecided, i.e. until a dated `RACE decided:` line records Lachy's call;
  // status flags a RACE first, so it never also reads as merged, never marked. § 2's intro names where the automatic
  // retry and a question sit: ahead of at Integration and every class below it, not ahead of every class that asks.
  // The order is read over the known classes present (a missing or extra one is stages').
  const ho = labelled(r4raw, 'Hand-off', { item: true })
  const order = clsRows.map((c) => c[0].slice(2, -2)).filter((l) => LABELS.includes(l))
  if (JSON.stringify(order) !== JSON.stringify(LABELS.filter((l) => order.includes(l))) ||
    !collapse(r2raw).includes('Each unmerged task takes the **first** class in table order whose signal it matches') ||
    !collapse(r2raw).includes('**retry (automatic)** and **needs you** come before **at Integration** and every class below it') ||
    !(cls.RACE ?? '').includes('with no decision recorded (§ 3c)') || !(cls.RACE ?? '').includes('no `resume` runs at all') ||
    !r3a.includes('no RACE / UNVERIFIED escalation is undecided') || !ho.includes('never while a RACE / UNVERIFIED escalation is undecided') ||
    !c3.includes('`- <YYYY-MM-DD> repair: [[<slug>]] RACE decided: <his decision, verbatim>`') ||
    !c3.includes('neither § 3a nor § 4\'s hand-off runs') ||
    !collapse(raw(repair, /^## Don'ts/)).includes("Don't run `resume` while a RACE / UNVERIFIED escalation is undecided.") ||
    !s3.includes('The first three flags are first-match') || !before(s3raw, '- **RACE / UNVERIFIED:**', '- **Merged, never marked:**') ||
    !flag('RACE / UNVERIFIED:').includes('`repair: [[<slug>]] RACE decided: …`')) fails.push('first-match')

  // another-base: a PR merged into another base is its own class, escalated with § 3c's evidence and never handed
  // back, deferred or flipped; § 6 copies it to the Completion log; status's flag says the same, and reads the
  // base against the default branch, as repair's class and `resume` do (one guarded resolver read in § 3's budget).
  const ab = cls['merged into another base'] ?? ''
  if (!ab.includes('escalate with evidence (§ 3c); never hand it back or defer it') || !ab.includes('`resume` leaves it unchanged') ||
    !ab.includes('MERGED into a branch other than the default') ||
    !c3.includes('**Merged into another base.** `resume` leaves it unchanged, and repair never hands it back, defers it or re-calls merge-task') ||
    !r6.includes('and merges into another base (task + PR + base)') ||
    !flag('Merged into another base:').includes('escalated, never flipped') ||
    !flag('Merged into another base:').includes("whose `baseRefName` is not the default branch (the resolver's answer)") ||
    !flag('Merged, never marked:').includes('whose PR is MERGED into the default branch') ||
    !s3.includes('at most one default-branch read, and only when one of those PRs reads MERGED: execute § 4\'s resolver') ||
    (s3.match(/default-branch\.sh/g) ?? []).length !== 1) fails.push('another-base')

  // race-hold: an undecided RACE / UNVERIFIED holds every reinstate and resume, and its decision is recorded in
  // every mode. Status: the open escalation sends it to repair and forbids /thread:execute until its `RACE decided:`
  // line. Repair: the line is an every-mode write (no pause or live lead holds it back); a reinstate or a
  // drain's resume is advised only once every decision is recorded; a does-not-stand defer is a lead-held note.
  const escItem = items.find((i) => i.startsWith('An open escalation')) ?? ''
  const every = labelled(r1raw, 'In every mode')
  const held = labelled(r1raw, 'Lead-held notes.')
  const raceC3 = labelled(r3raw, 'RACE / UNVERIFIED.', { item: true })
  if (!escItem.startsWith('An open escalation, an undecided RACE / UNVERIFIED') ||
    !escItem.includes('Never reinstate or resume with `/thread:execute` until each RACE / UNVERIFIED task has its `RACE decided:` line') ||
    !prec.includes('so status never sends an undecided RACE to `/thread:execute`') ||
    !collapse(sDonts).includes(`until its \`RACE decided:\` line is recorded: § 4's action ${RUN.escalation} comes first`) ||
    !every.includes("§ 3c's escalation and its record") || !every.includes('its `RACE decided:` line') ||
    !every.includes('neither a pause nor a live lead holds it back') ||
    !labelled(r1raw, 'Pause, drained or stamped.').includes('only once every RACE / UNVERIFIED task has its `RACE decided:` line') ||
    !held.includes('defer of a RACE / UNVERIFIED task') || !held.includes('or under a stamped pause') ||
    !raceC3.includes('repair writes it in every mode (§ 1)') || !raceC3.includes('never as `RACE decided:`')) fails.push('race-hold')

  // race-in-flight: execute's RACE procedure appends the Race log line, then re-verifies with the lane held, so a
  // RACE that still reads integrating under an owner not known to have ended (no pause, its verdict not red) is
  // the lead's, not an escalation. Status: § 3 orders the three states (decided, in flight, undecided) and flags
  // only an undecided one; action 7 excludes it, and the live queue (and the drain) wait on it; the owner-session
  // qualifier's RACE exception sends it to repair, never to /thread:execute, once its session shows the halt or no
  // run, or has ended. Repair: an in-flight class does nothing and never asks; the RACE class excludes it; the
  // live-queue mode waits on it; § 3c shows the re-verify verdict. Fixture E: the RACE reads integrating, and
  // resume flips both it and an UNVERIFIED set-aside done.
  const three = labelledRaw(s3raw, 'A RACE has three states.')
  const inFlight = labelled(s3raw, 'In flight:', { item: true })
  const fallback = `the next step is \`/thread:repair [[<rollout>]]\` (action ${RUN.escalation}), never \`/thread:execute\``
  const rif = cls['RACE re-verify in flight'] ?? ''
  // The live-queue and drain items by their lead words, not their place (the order is actions').
  const itemBy = (k) => items.find((i) => i.toLowerCase().startsWith(k.toLowerCase())) ?? ''
  const liveByName = itemBy('a live queue')
  const drainByName = itemBy('`pause_requested`')
  if (!collapse(three).includes('`<repoPath>/.claude/integration/race-<slug>.rc`') ||
    !before(three, '- **Decided:**', '- **In flight:**') || !before(three, '- **In flight:**', '- **Undecided:**') ||
    !['still reads `integrating` with an `owner:` whose session is not known to have ended', 'no `paused:` stamp stands',
      'its verdict file is absent or reads `0`', 'not drift', 'flag nothing', 'treat it as the live queue',
      'once that session shows the `RACE: …` halt or no run, or has ended'].every((k) => inFlight.includes(k)) ||
    !flag('RACE / UNVERIFIED:').startsWith('- **RACE / UNVERIFIED:** a RACE that is undecided (above)') ||
    !s3.includes('and a RACE in flight takes none of them') ||
    !escItem.includes('A RACE re-verify in flight (§ 3) is not an open escalation') ||
    !qual.includes('**The RACE exception:** with a RACE re-verify in flight (§ 3), the owner session\'s answer never leads to `/thread:execute`') ||
    !qual.includes(fallback.replace('the next step is', 'and the next step is')) ||
    !liveByName.includes('A RACE re-verify in flight (§ 3) waits here too') || !liveByName.includes(fallback) ||
    !drainByName.includes('if a RACE re-verify was in flight, the same answer makes it undecided') || !drainByName.includes(fallback) ||
    !rif.startsWith("status's in-flight RACE (status § 3)") ||
    !['still reads `integrating` with an `owner:` whose session is not known to have ended', 'no `paused:` stamp stands',
      "nothing: execute's RACE procedure owns it", 'never escalate it or ask Lachy mid-re-verify',
      'Once its owner session shows the `RACE: …` halt or no run, or has ended, it is **RACE**'].every((k) => rif.includes(k)) ||
    !(cls.RACE ?? '').includes('(a `## Race log` line names it) and not in flight') ||
    !labelled(r1raw, 'Live queue, not paused.').includes("A RACE re-verify in flight (§ 2) is the lead's: report it and wait") ||
    !c3.includes('for a RACE only, the lead\'s re-verify verdict, so Lachy decides with it on screen') ||
    !c3.includes('`<repoPath>/.claude/integration/race-<slug>.rc`') || !c3.includes('`RACE: origin/<default> fails the verifier`') ||
    fx.E.fails.length) fails.push('race-in-flight')

  // closed-pr: a CLOSED PR (or a missing branch) on an awaiting-Integration, integrating or at-Integration task is
  // input-gated, never left to the loop; it keeps its pr:, so hand-back follows a restore only when it is set aside.
  // An at-Integration set-aside with no pr: (which hand-back refuses, fixture F) is the same class: its restore
  // finds its branch's PR first and writes `pr:` wherever hand-back may run, a live queue included (no live call owns
  // a set-aside note, so it is no lead-held note); at Integration and status's row route it there.
  const cp = cls['PR CLOSED / branch missing'] ?? ''
  const cpr = labelled(r4raw, 'A CLOSED PR or a missing branch', { item: true })
  const intRow = reRows.find((c) => c[0] === '`integration`') ?? []
  if (!cp.includes("input-gated: § 4's restore, recut, defer or leave; never left to the loop") || !cp.includes('awaiting Integration, integrating') ||
    !cp.includes('set aside at Integration with no `pr:`') || !cp.includes('which `hand-back` refuses') ||
    !cpr.includes('A CLOSED PR keeps its `pr:`') || !cpr.includes('then `hand-back` **only when the task is set aside**') ||
    !cpr.includes('`prepare` never reads the PR state') || /refuses an at-Integration note with no `pr:`/.test(collapse(rb)) ||
    !cpr.includes('--head <inputs.branch> --state all') || !cpr.includes('wherever `hand-back` may (§ 1), a live queue included') ||
    !cpr.includes('no live call owns a set-aside note') || /lead-held/.test(cpr) || /§ 4's/.test(held) ||
    !labelled(r1raw, 'Live queue, not paused.').includes("write the `pr:` § 4's restore finds for an at-Integration set-aside with no `pr:`") ||
    !atI.includes("One with no `pr:` is **PR CLOSED / branch missing**'s") || !(intRow[4] ?? '').includes('with no `pr:`') ||
    !flag('PR CLOSED:').includes('`prepare` never reads the PR state') || fx.F.nopr.fails.length) fails.push('closed-pr')

  // merged: M1 resume, never resolve; M2 the ancestry check; M3 the vault history; M4 never the status; M5 a dated
  // ## Notes record; M6 copied to the Completion log; M7 pr: only on Lachy's word.
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

  // raise: one round, only at the ceiling, announced and recorded; past the automatic retry's own raise, only on
  // Lachy's word.
  const rz = labelled(r4raw, 'The raise', { item: true })
  const incs = [...rb.matchAll(/lastRound \+ (\d+)/g)].map((m) => m[1])
  if (!rz.includes('`max_review_rounds: <lastRound + 1>`') || !rz.includes('is ≤ `lastRound`') || !rz.includes('Announce it') ||
    !rz.includes('`## Notes`') || !rz.includes("a further raise is only on Lachy's word") || !incs.length || incs.some((n) => n !== '1')) fails.push('raise')

  // defer: the dependent closure only (transitive, through tombstones), never a file-overlap reading.
  if (!r5.includes('transitive') || !r5.includes('`depends-on:`') || !r5.includes('`blocked-by:`') || !r5.includes('`merged_into:`') ||
    !r5.includes('`## Queue` row') || !r5.includes('never write it') || /file-overlap|successor/i.test(r5)) fails.push('defer')

  // anchor: the guarded anchor-ref delete, for a stale ref and in the retire block.
  if (!labelled(r4raw, 'Stale anchor ref', { item: true }).includes(ANCHOR) || !r5.includes(ANCHOR)) fails.push('anchor')

  // recut: only on Lachy's ask, through the register check, the retire block and an own-run relabel.
  const rc = labelled(r4raw, 'Recut', { item: true })
  if (!rc.startsWith("- **Recut, only on Lachy's explicit ask:**") ||
    !['landing-register check', "§ 5's retire block", 'branch -D', '--kind own', '`hand-back`'].every((k) => rc.includes(k))) fails.push('recut')

  // hand-off: no live lead and no pause; execute § 2.5, then execute § 3's verify_timeout check (p14-2: the hand-off
  // enters § 4.5 directly, past execute's § 3), then resume, then the loop with --running ""; no § 2.7.
  if (!ho.includes('no lead is live and no pause stands') || !before(ho, 'execute § 2.5', '`reconcile-rollout.py resume`') ||
    !before(ho, 'execute § 2.5', "execute § 3's `verify_timeout` check") ||
    !before(ho, "execute § 3's `verify_timeout` check", '`reconcile-rollout.py resume`') ||
    !before(ho, '`reconcile-rollout.py resume`', '`--running ""`') || !ho.includes('§4.5 resume') || !ho.includes('§ 2.7') ||
    !ho.includes('does not run')) fails.push('hand-off')

  // signed-gate: a task approve-gates signed is the lead's while its session holds the signed-gate handle (execute
  // § 3.7): right after § 2's table, repair never hands it back, recuts, defers or re-plans it and writes it no
  // `## Repair input`; with no lead live it takes a fresh call behind § 3.7's warning; a Don't says the same.
  const signed = labelled(r2raw, "A signed task is the lead's.")
  if (!before(r2raw, '| **gate** |', "**A signed task is the lead's.**") ||
    !['`approve-gates`', '`gates_signed:`', 'signed-gate handle (execute § 3.7)', 'Repair never hands it back, recuts, defers or re-plans it',
      'writes no `## Repair input` to it', "takes a fresh call behind § 3.7's warning"].every((k) => signed.includes(k)) ||
    !collapse(raw(repair, /^## Don'ts/)).includes("Don't touch a signed task while its lead is live.")) fails.push('signed-gate')

  // descope (p14-4): a plan-block the notes settle is descoped without asking. Repair: its class names the verb (§ 3d)
  // and routes a refusal to § 3b; § 3d runs the verb, hands back on exit 0 (§ 4), asks on exit 3 (§ 3b), never under
  // a pause, tells Lachy afterwards and names the rollout's `## Notes` line; § 6 copies automatic descopes; a Don't.
  // Status: the plan-blocked re-entry row names `descope`; a **Descoped.** paragraph shows the first entry by grep;
  // action 10 leaves the descope the verb refused to repair. The undo lists every record (repair § 3d, status's
  // **Descoped.**): the marker, the follow-up set `status: dropped` and the `## Notes` line.
  const dCls = cls['plan-blocked, descopable'] ?? ''
  const d3 = labelled(r3raw, '3d')
  const dRow = reRows.find((c) => c[3].startsWith('`plan-blocked`, no `## Scope decision (automatic)`'))
  const undo = (t) => ['`<!-- descope run=… -->` marker', '`descope_armed:`', '`status: dropped`', '`descope undone:`', 'a second one'].every((k) => t.includes(k))
  const descoped = labelled(s4raw, 'Descoped.')
  if (!dCls.includes('`reconcile-rollout.py descope` (§ 3d)') || !dCls.includes('exit 3 → § 3b') ||
    !d3.includes('reconcile-rollout.py descope --tasks <slug> --rollout <rollout-note>') || !d3.includes('Exit 0 → § 4\'s `hand-back`') ||
    !d3.includes('Exit 3 → § 3b') || !d3.includes('never under a pause') || !d3.includes('tell Lachy afterwards') ||
    !d3.includes("the rollout's `## Notes` line") ||
    !dRow || !ticks(dRow[4]).includes('descope') || !dRow[4].includes('then `hand-back`, then its own call') ||
    !descoped.includes("`grep -m1 '^- descoped (automatic)' ~/repos/obsidian/Work/Tasks/<slug>.md`") ||
    !descoped.includes('every automatic descope, and any wrong owner') ||
    !liveByName.includes("A `plan-blocked` one whose descope the verb refused (exit 3) is repair's too") ||
    !undo(d3) || !undo(descoped) || !d3.includes('verbatim only') || !d3.includes('only the caller\'s judgement guards that case') ||
    !r6.includes('automatic descopes (task + part + follow-up or owner)') ||
    !collapse(raw(repair, /^## Don'ts/)).includes("Don't descope by hand, or twice.")) fails.push('descope')

  // second-block (p14-4): a plan-block after an automatic descope (a `## Scope decision (automatic)`, no
  // `descope_armed:`) is its own class, input-gated (§ 3b), never a silent own-run hand-back; the descopable class
  // excludes it; status's re-entry rows and action 10 say the same, and a Don't.
  const sbCls = cls['plan-blocked after a descope'] ?? ''
  const sbRow = reRows.find((c) => c[3].includes('with a `## Scope decision (automatic)` and no `descope_armed:`'))
  if (!sbCls.includes('`## Scope decision (automatic)` section and no `descope_armed:`') || !sbCls.includes('input-gated: § 3b') ||
    !sbCls.includes('never a silent hand-back') ||
    !dCls.includes('with no `## Scope decision (automatic)` section, or one whose `descope_armed:` still stands') ||
    !sbRow || !sbRow[4].includes("Lachy's decision (repair § 3), then `hand-back`") || !sbRow[4].includes('never a silent hand-back') ||
    !dRow || !dRow[4].includes("otherwise the automatic retry, then Lachy's decision (repair § 3)") ||
    !liveByName.includes("is always Lachy's decision, never a silent hand-back") ||
    !collapse(raw(repair, /^## Don'ts/)).includes('never an own run handed back silently')) fails.push('second-block')

  // ---- both ----
  // no-wave: neither file reads the wave rollout, its frontmatter description included.
  if (BAN.test(status) || BAN.test(repair)) fails.push('no-wave')

  // rung (ADR 0029, p13-3): (1) fixture A's JSON: the queued task's off-ladder rung drifts, the merged task's never,
  // an on-ladder one never, on the built-in ladder; (2) § 2 names the three keys; (3) § 3's Rung drift flag is
  // scoped to the five unlanded states, the Ladder refused flag names execute's halt, and both hold offline;
  // (4) the Offline paragraph keeps them rendering; (5) action 11 sends neither to repair; (6) a refused ladder
  // reorders no action and never routes to repair on its own account; (7) repair: a Rung drift is never
  // input-gated, a refused ladder leaves § 3, § 4's hand-backs and § 5 running and stops at the Hand-off;
  // (8) neither skill speaks tiers.
  const by = fx.A.bySlug
  const rd = flag('Rung drift:')
  const lr = flag('Ladder refused:')
  const action11 = items[ACTIONS.indexOf('any drift flag')] ?? ''
  const refusedP = labelled(s4raw, 'A refused ladder.')
  const rRung = labelled(r2raw, 'Rungs (ADR 0029).')
  const rRefused = labelled(r2raw, 'A refused ladder** (status')
  const lower = (status + repair).toLowerCase()
  const R = [
    by[A.queued]?.rung === 'gone' && by[A.queued]?.rungDrift === 'gone' && by[A.merged]?.rung === 'gone' && by[A.merged]?.rungDrift === '' &&
      by[A.awaiting]?.rung === 'opus-xhigh' && by[A.awaiting]?.rungDrift === '' && fx.A.status.ladder?.source === 'built-in' &&
      fx.A.status.ladder?.error === null && fx.A.status.tasks.every((x) => x.rungDrift === '' || ['queued', 'running', 'awaiting-integration', 'integrating', 'set-aside'].includes(x.queueState)),
    s2.includes('`progress`, `timeline` and `ladder`') && s2.includes('`blockerSummary`, `rung` and `rungDrift`') &&
      s2.includes(`the task is unlanded (\`queueState\` ${UNLANDED})`),
    rd.includes(`only for a task whose \`queueState\` is ${UNLANDED}`) && rd.includes('A merged, folded or other task is never flagged') &&
      rd.includes('It needs no write: the engine reads it as the top rung') && rd.includes("a re-stamp or a ladder edit is Lachy's choice") &&
      rd.includes('so it holds offline too') && lr.includes('Execute halts `ladder file refused`') && lr.includes('so it holds offline too'),
    labelled(s3raw, 'Offline.').includes('the RACE / UNVERIFIED, Rung drift and Ladder refused flags still render'),
    action11.startsWith('Any drift flag but a Rung drift, a refused ladder,'),
    refusedP.includes('reorders nothing') && refusedP.includes(`from ${RUN.escalation} to ${RUN.nothing}`) && refusedP.includes('`ladder file refused`') &&
      refusedP.includes('Status never routes a refused ladder to `/thread:repair` on its own account, because repair never edits the file') &&
      prec.includes('A refused ladder adds its fix ahead of whichever action matches and moves none of them'),
    rRung.includes('A Rung drift (status § 3) is never input-gated and needs no write') &&
      rRefused.includes('Repair never edits `~/.config/thread/ladder.toml`') &&
      rRefused.includes("§ 3's vault work, § 4's hand-back routes") && rRefused.includes("§ 5's defers (on Lachy's choice) still run") &&
      rRefused.includes("Repair stops at § 4's **Hand-off**: no execute loop and no § 6") && ho.includes('or the ladder file is refused'),
    !TIER_WORDS.some((w) => lower.includes(w.toLowerCase())),
  ]
  if (!R.every(Boolean)) fails.push('rung')

  // settings (p15-4, the operator's rollout settings): (1) § 2 names `ceilingError` and `ceilingCause` and the K
  // resolver's "rollout settings refused" task flag; (2) § 3's Ceiling unresolved flag gives one remedy per cause:
  // the note's own stamp (no file), the file at its line, a stamp for a gone root (whether or not a file exists), a
  // stamp for a resolver that will not run; (3) the Rollout settings refused flag tells a file line from a `--repo`
  // one; (4) both render offline; (5) action 11 sends neither to repair; (6) § 4 adds their fix ahead and never
  // routes them to repair; (7) the Don'ts allow `rollout-settings.py` and count its `remote get-url`, and Scope says
  // status runs it; (8) repair makes no raise when the resolver refuses, names the fix by the line, and never edits
  // the file.
  const cu = flag('Ceiling unresolved:')
  const rsr = flag('Rollout settings refused:')
  const scope = collapse(raw(status, /^## Scope/))
  const sDontsC = collapse(sDonts)
  const SET = [
    s2.includes('`ceilingCause` (what that error needs: `stamp`, `file`, `root` or `resolver`; null otherwise)') &&
      s2.includes('flag "rollout settings refused: <its stderr line>" on the task'),
    cu.includes("`stamp`: the rollout note's own `parallel_ceiling:` is invalid") && cu.includes('fix that stamp to an integer >= 1. No settings file is involved.') &&
      cu.includes('`file`: `~/.config/thread/rollouts.toml` was refused: fix it at the line `ceilingError` names, or stamp `parallel_ceiling:` on the rollout note') &&
      cu.includes("`root`: the note's Project root is gone (or its origin cannot be read), whether or not a rollouts.toml exists: stamp `parallel_ceiling:` on the rollout note") &&
      cu.includes('`resolver`: `rollout-settings.py` would not run: stamp `parallel_ceiling:`') && cu.includes('Until it resolves `next` exits 1'),
    rsr.includes("the fix is Lachy's edit at that line, or a `max_review_rounds:` stamp") && rsr.includes('when it names `--repo` (the Project root is gone or its origin unreadable), the fix is that stamp'),
    s3.includes('The Ceiling unresolved and Rollout settings refused flags render offline too'),
    action11.includes(', an unresolved ceiling or refused rollout settings, or a set-aside task'),
    refusedP.includes('An unresolved ceiling and refused rollout settings are handled the same way: they reorder nothing') &&
      refusedP.includes('are never routed to `/thread:repair` on their own account') && refusedP.includes('action 11 skips them') &&
      prec.includes('and so do an unresolved ceiling and refused rollout settings'),
    sDontsC.includes('`lead-integrate.py inputs` and `rollout-settings.py` (§ 2, a read) are the only Python scripts status runs') &&
      sDontsC.includes('plus the local one `rollout-settings.py` makes per resolve') &&
      scope.includes('Status itself runs `rollout-settings.py`') && !scope.includes('invokes nothing new'),
    rz.includes('make no raise') && rz.includes('A line naming `~/.config/thread/rollouts.toml` is fixed at that line') &&
      rz.includes('a line naming `--repo` (the Project root is gone or its origin unreadable) only by that stamp') && rz.includes('Repair never edits that file'),
  ]
  if (!SET.every(Boolean)) fails.push('settings')

  // queued-solo (p17-2): the Queued row's "behind solo [[x]]" matches `next`: a started Solo task, or the first queued
  // task in rank order that carries `solo` and has no `waitingOn` (the head Solo task) ranked above the row. A Solo
  // task its dependency holds holds nothing. A missing row is states' failure, not this rule's.
  const queuedRow = sb.split('\n').find((l) => l.startsWith('| `queued` | **Queued** |'))
  if (queuedRow != null && (!queuedRow.includes('the first queued task in rank order that carries `solo` and has no `waitingOn`') ||
    !queuedRow.includes('a Solo task with a `waitingOn` holds nothing'))) fails.push('queued-solo')

  // ---- the automatic retry (p16-5, ADR 0033) ----
  const rDontsC = collapse(raw(repair, /^## Don'ts/))
  const row = (label) => clsRows.find((c) => c[0] === `**${label}**`) ?? []
  const THREE = 'the auto-retry budget is spent, the fingerprint repeated, or `needsHuman` is set'
  const r3b = labelled(r3raw, '3b')
  const r3bRaw = labelledRaw(r3raw, '3b')

  // auto-retry (repair): agent-fixable is execute's now. A set-aside `inputs` reads as `autoRetry: true` or cooling
  // is the lead's (a hand-back would reset its budget); every other one reaches repair because its automatic retry
  // is over (the three causes) or `autoRetryWhy` names a cause that is his, and is asked (§ 3b), never judged from
  // its feedback. Classes are judged before the answer, so the hand-back his answer earns is never skipped. The
  // Leash: every hand-back but § 3d's follows his answer and starts a fresh stretch; the description and a Don't
  // say the same. Fixture F: each verdict, and the predicate picks exactly the three he owns.
  const ra = row('retry (automatic)')
  const agentFix = labelled(r2raw, "Agent-fixable is execute's now (ADR 0033).")
  const classed = labelled(r2raw, 'Classed before the answer.')
  const leash = labelled(r4raw, 'Leash', { item: true })
  const desc = (repair.match(/^description: (.*)$/m) ?? [])[1] ?? ''
  if (!(ra[1] ?? '').includes('`autoRetry: true`') || !(ra[1] ?? '').includes('`autoRetryAfter`') ||
    !(ra[2] ?? '').startsWith('nothing: the lead re-enters it') || !(ra[2] ?? '').includes('never a hand-back') ||
    ![THREE, '`autoRetryWhy`', '`autoRetryError`', 'A usage limit that kills an agent mid-run is an infra block, never a quota block'].every((k) => agentFix.includes(k)) ||
    !classed.includes('never re-class a task after recording his answer') || !classed.includes('fresh automatic-retry stretch he chose') ||
    /judged from the feedback/.test(collapse(rb)) || !r3b.includes(THREE) || /a second block, a second raise/.test(r3b) ||
    !['at Integration', 'revise stopped', 'review-blocked, rejected', 'own run'].every((l) => (cls[l] ?? '').includes('§ 3b') && !(cls[l] ?? '').includes('agent-fixable → hand back')) ||
    !rDontsC.includes("Don't hand back what the lead retries.") || rDontsC.includes('Hand them back silently') ||
    !leash.includes("every other hand-back follows Lachy's answer (§ 3b)") || !leash.includes('fresh automatic-retry stretch') ||
    desc.includes('auto-retries agent-fixable blocks') || fx.F.split.fails.length) fails.push('auto-retry')

  // retries (status): § 2 reads the verdict; **Automatic retry first** (before the re-entry table) shows a count only
  // where the verdict reached the budget, in disjoint forms (off, then quota, then n/N), `?` only for an unresolved
  // budget, and the cool-down; the set-aside cell, the example and action 12 say the same. Fixture F: which verdicts
  // carry a budget.
  const reIn = labelled(raw(status, /^### 2\. /), 'Re-entry inputs.')
  const arf = labelled(s4raw, 'Automatic retry first (ADR 0033).')
  const FORMS = ['only when `autoRetryBudget` is non-null', '`auto-retry off`', '`quota <quotaRetriesUsed>/5`', '`auto-retry <autoRetriesUsed>/<autoRetryBudget.autoRetries.value>`']
  const setAsideCell = (tableRows(s4raw).find((c) => c[0] === '`set-aside`') ?? [])[2] ?? ''
  const exLines = example.slice(example.findIndex((l) => /^Set aside \(\d+\)$/.test(l)) + 1)
  const setAsideGroup = exLines.slice(0, Math.max(0, exLines.findIndex((l) => !l.startsWith('  '))))
  const action12 = items[ACTIONS.indexOf('awaiting integration')] ?? ''
  if (!['autoRetry', 'autoRetryWhy', 'autoRetryAfter', 'autoRetryError', 'autoRetryClass', 'autoRetryBudget', 'autoRetriesUsed', 'quotaRetriesUsed', 'fingerprint', 'prUrlError']
    .every((k) => reIn.includes(`\`${k}\``)) ||
    !before(s4raw, '**Automatic retry first (ADR 0033).**', '**Set-aside re-entry.**') ||
    !FORMS.every((k, i) => i === 0 || before(arf, FORMS[i - 1], k)) ||
    !['`autoRetryClass` alone never shows a count', 'only when `autoRetryBudget` is null and `autoRetryWhy` starts `auto_retries unresolved`',
      '`cooling until <autoRetryAfter>`', '`autoRetry: true`', '`autoRetryAfter`'].every((k) => arf.includes(k)) ||
    !setAsideCell.includes('**Automatic retry first**') || !setAsideGroup.some((l) => /auto-retry \d\/\d/.test(l)) ||
    !action12.includes('`autoRetry: true`') || fx.F.render.fails.length) fails.push('retries')

  // needs-you (both): status lists the decisions that are Lachy's and that no Drift line routes, each set-aside line
  // pointing at repair and carrying its question; an answered block, whatever was asked, reads `answered` until the
  // task is re-entered (status's three reads, run on fixture F's notes: answered, then re-blocked identically; a spent
  // budget answered under a pause, then handed back; the block that comes back after two retries, after a manual
  // hand-back (new runs alone), and across sections (`auto_retry_at` alone)), and a `-` entry never counts. Repair writes every answer for a set-aside at its run or at
  // Integration as the block-keyed entry fixture F's entries render from, asks a `## Needs you` question (never on a
  // gate), removes the section in every mode, hands back at its stage, and treats the live lead's winning retry as no
  // error.
  const ny = labelledRaw(s4raw, 'Needs you.')
  const nyC = collapse(ny)
  const nyItems = bullets(ny)
  const gateItem = nyItems.find((b) => b.startsWith('each gate-pending gate')) ?? ''
  const setItem = nyItems.find((b) => b.startsWith('each set-aside task')) ?? ''
  const nyRow = row('needs you')
  const gateCls = cls.gate ?? ''
  const A_ = fx.F.answer
  const S_ = A_.spent ?? {}
  const C_ = A_.crossed ?? {}
  const tpl = (r3bRaw.match(/`(- <stamp> <kind> \(block <fingerprint>\): [^`]*)`/) ?? [])[1] ?? ''
  const render = (kind, fp, ask, answer) => tpl.replace('<stamp>', A_.stamp).replace('<kind>', kind).replace('<fingerprint>', fp)
    .replace('<the ask, verbatim>', ask).replace('<his answer, verbatim>', answer)
  const NOTE_AT = " ~/repos/obsidian/Work/Tasks/<slug>.md`"
  const nyFlat = ny.replace(/\s*\n\s*/g, ' ')
  const fNeedle = (nyFlat.match(/`grep -F '([^']+)' ~\/repos\/obsidian\/Work\/Tasks\/<slug>\.md`/) ?? [])[1]
  const eNeedle = (nyFlat.match(/`grep -E '([^']+)' ~\/repos\/obsidian\/Work\/Tasks\/<slug>\.md`/) ?? [])[1]
  const shaGrep = nyC.includes("`grep -m1 '^auto_retry_sha:'" + NOTE_AT)
  const grepIn = (args, dir, slug) => spawnSync('grep', [...args, path.join(dir, `${slug}.md`)], { encoding: 'utf8' }).stdout.trim()
  // Status's three reads on one fixture note, as its prose words them: an entry the -F read prints, stamped later than
  // every stamp the -E read prints, and an auto_retry_sha other than the fingerprint.
  const reads = (dir, slug, fp) => {
    const out = (args) => grepIn(args, dir, slug).split('\n').filter(Boolean)
    const last = Math.max(-Infinity, ...out(['-E', eNeedle]).map((l) => Date.parse((l.match(/\(([^)]*)\)\s*$/) ?? [])[1] ?? l.replace(/^auto_retry_at:\s*/, ''))))
    return out(['-F', fNeedle.replace('<fingerprint>', fp)]).some((l) => Date.parse(l.split(' ')[1]) > last) &&
      grepIn(['-m1', '^auto_retry_sha:'], dir, slug) !== `auto_retry_sha: ${fp}`
  }
  const greps = !!(fNeedle && eNeedle && shaGrep) &&
    reads(A_.answeredDir, A_.slug, A_.fp) && !reads(A_.reblockedDir, A_.slug, A_.fp) &&
    reads(S_.answeredDir, S_.slug, S_.fp) && !reads(S_.handedDir, S_.slug, S_.fp) && !reads(S_.returnedDir, S_.slug, S_.fp) &&
    !reads(S_.manualDir, S_.slug, S_.fp) &&
    !reads(C_.dir, C_.slug, C_.fp)
  if (!s2.includes('`needsHuman`') ||
    !['`autoRetry: false`', 'no `autoRetryAfter`', '`autoRevise: false`', 'or `prUrlError` for an `autoRevise: true` row', 'a code-writing `review` with no `pr:`',
      'answered: awaiting /thread:repair', 'whatever was asked', 'no line or a value other than `<fingerprint>`', 'A `-` entry never counts',
      'is later than every stamp that', 'a run recorded or an automatic retry made after the answer means the task was re-entered since',
      'A set-aside task the RACE / UNVERIFIED, Merged into another base, Merged never marked, PR CLOSED or Possible PR-less merge flag names is no item',
      '(action 7 or 11; under a live queue, action 10 adds it)', 'A Rung drift excludes nothing', 'Offline, only the RACE / UNVERIFIED flag renders, so only it excludes',
      'A merge hold is no item', 'A cooling task is no item'].every((k) => nyC.includes(k)) ||
    !setItem.includes('`→ asks:`') || !gateItem.includes('`→ asks:`') || !greps ||
    !action11.includes('a Needs you item or a `plan-blocked` one (repair § 3 judges its descope first)') ||
    !liveByName.includes('a set-aside task the Needs you block leaves to its Drift line') ||
    !example.some((l) => /^Needs you \(\d+\)$/.test(l)) || !example.some((l) => l.includes('→ asks:')) ||
    !(nyRow[1] ?? '').includes('(`setAsideAt: run` or `integration`, never a gate)') ||
    !['§ 3b', '`## Repair input`', 'hands back at its stage'].every((k) => (nyRow[2] ?? '').includes(k)) ||
    !['`→ asks:`', 'before any sign-off', 'never hand back'].every((k) => gateCls.includes(k)) ||
    !['`- <stamp> <kind> (block <fingerprint>): "<the ask, verbatim>" → <his answer, verbatim>`', 'Remove the `## Needs you` section, in every mode',
      '`<kind>` is `needs you` for a `## Needs you` question and `decision` for every other ask', 'whatever was asked',
      "stamped later than the note's last re-entry",
      "The last re-entry is the latest of the note's `### Run <n> (<stamp>)` headings, in any section, and its `auto_retry_at:`",
      "the note's `auto_retry_sha:` is absent or differs from it", 'A `-` entry never counts', 'hands back without asking again',
      "re-read the note's `auto_retry_at:`", 'absent counts as a value', "`hand-back` then exits 1 with `status is 'in_progress'`", 'That is no error',
      'a signed task takes no `## Repair input`'].every((k) => r3b.includes(k)) ||
    !(cls['own run'] ?? '').includes('A code-writing `review` with no `pr:` is asked too') ||
    !rDontsC.includes("Don't hand back an answered question with its `## Needs you` still in place.") ||
    !tpl || render('needs you', A_.fp, A_.q, A_.a) !== A_.entry || render('decision', S_.fp, S_.ask, S_.a) !== S_.entry ||
    A_.fails.length || fx.F.held.fails.length) fails.push('needs-you')
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

test('fixture E: a RACE under the lead reads integrating, and resume holds it and an UNVERIFIED set-aside until both are decided', () => {
  assert.deepEqual(fx.E.fails, [])
})

test('fixture F: each set-aside reads its automatic-retry verdict, and a needs-you answer re-enters once, then asks afresh', () => {
  assert.deepEqual({ split: fx.F.split.fails, render: fx.F.render.fails, held: fx.F.held.fails, nopr: fx.F.nopr.fails, answer: fx.F.answer.fails },
    { split: [], render: [], held: [], nopr: [], answer: [] })
})

// ---- the rules -------------------------------------------------------------------------------------------------

test('status and repair hold every queue rule', () => {
  assert.deepEqual(check(real), [])
})

// ---- controls: each mutates the real text (or a fixture verdict) in one place and must fail with exactly its rule ----

const RULES = ['states', 'set-aside', 'log-line', 'owner', 'drift', 'actions', 'lineage', 'read-only', 'reverse-lineage', 'integration-only',
  'stages', 'first-match', 'another-base', 'race-hold', 'race-in-flight', 'closed-pr', 'merged', 'live', 'raise', 'defer', 'anchor', 'recut', 'hand-off',
  'signed-gate', 'no-wave', 'rung', 'descope', 'second-block', 'settings', 'queued-solo', 'auto-retry', 'retries', 'needs-you']
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
// Swaps status § 4's recommended actions a and b (1-based), each with its indented continuation lines, keeping
// the numbers in place.
function swapItems(text, a, b) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.startsWith('**Recommended action**'))
  const block = (n) => {
    const i = lines.findIndex((l, k) => k > start && l.startsWith(`${n}. `))
    assert.ok(i > 0, `control setup: no action ${n}`)
    let j = i + 1
    while (j < lines.length && /^\s+\S/.test(lines[j])) j++
    return [i, j]
  }
  const [ai, aj] = block(a)
  const [bi, bj] = block(b)
  assert.ok(aj <= bi, 'control setup: swap a before b')
  const renum = (ls, n) => [ls[0].replace(/^\d+\./, `${n}.`), ...ls.slice(1)]
  return [...lines.slice(0, ai), ...renum(lines.slice(bi, bj), a), ...lines.slice(aj, bi), ...renum(lines.slice(ai, aj), b), ...lines.slice(bj)].join('\n')
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
test('control D6: review required on REVIEW_REQUIRED alone fails drift', () => {
  only(st('`reviewDecision: REVIEW_REQUIRED` or `CHANGES_REQUESTED`', '`reviewDecision: REVIEW_REQUIRED`'), 'drift', 'D6')
})
test('control: an open escalation without the PR-less merge fails actions', () => {
  only(st('an undecided RACE / UNVERIFIED or a possible PR-less merge →', 'an undecided RACE / UNVERIFIED →'), 'actions', 'no PR-less')
})
test('control: the open escalation below the live queue (the override dropped) fails actions', () => {
  only({ status: swapItems(real.status, RUN.escalation, ACTIONS.indexOf('a live queue') + 1) }, 'actions', 'escalation late')
})
test('control: an override on top of the order fails actions', () => {
  only(st('The order is the precedence, with no override on top of it.', 'A possible PR-less merge overrides 8 and 9.'), 'actions', 'override')
})
test('control: a drain nothing is draining left to wait fails actions', () => {
  only(st('nothing is draining it, and `/thread:execute [[<rollout>]]` resumes the drain', 'it drains'), 'actions', 'stalled drain')
})
test('control (legacy P): the version stop ahead of the reverse lineage in status fails actions', () => {
  only({ status: swapItems(real.status, 2, 3) }, 'actions', 'legacy P, status')
})
test("control: a live queue that never points at repair's live-queue mode fails actions", () => {
  only(st('its live-queue mode asks you those and hands each back on your answer', 'it waits for the run, which hands those back'), 'actions', 'live-queue mode')
})
test('control: two recommended actions swapped fails actions', () => {
  only({ status: swapItems(real.status, 4, 5) }, 'actions', 'swap')
})
test('control: no unsupported-version stop in status fails lineage', () => {
  only(st('"unsupported protocol version <N>; the queue reads protocol_version: 5"', '"unknown version"'), 'lineage', 'status')
})
test('control: no unsupported-version stop in repair fails lineage', () => {
  only(rp('"unsupported protocol version <N>', '"unknown version <N>'), 'lineage', 'repair')
})
// Each injects one invocation into status's § 4, outside its Don'ts.
const inject = (cmd) => st('**Outside the count.**', `Run \`${cmd}\` first.\n\n**Outside the count.**`)
test('control: a hand-back invoked by status fails read-only', () => {
  only(inject('reconcile-rollout.py hand-back --tasks <slug>'), 'read-only', 'hand-back')
})
test('control: a lead-integrate.py prepare invoked by status fails read-only', () => {
  only(inject('python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/lead-integrate.py prepare --repo <repoPath> --slug <slug> --default main --note <task note>'), 'read-only', 'prepare')
})
test('control: merge-task.sh invoked by status fails read-only', () => {
  only(inject('${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/merge-task.sh <repoPath> <pr> <head> <base>'), 'read-only', 'merge-task')
})
test('control: a gh pr reopen invoked by status fails read-only', () => {
  only(inject('gh pr reopen <pr>'), 'read-only', 'gh pr reopen')
})
test('control: a git update-ref -d invoked by status fails read-only', () => {
  only(inject(`git -C <repoPath> ${ANCHOR}`), 'read-only', 'update-ref')
})
test('control: a status that no longer runs its status read fails read-only', () => {
  only({ status: real.status.replaceAll('reconcile-rollout.py status', 'reconcile-rollout.py') }, 'read-only', 'no status read')
})
test('control: no close-out headline in status § 1 fails reverse-lineage', () => {
  only(st('headline `superseded by [[N]], close-out interrupted`', 'headline `superseded by [[N]]`'), 'reverse-lineage', 'headline')
})
test("control: a close-out without Lachy's confirmation fails reverse-lineage", () => {
  only(rp("finish step 7.5's close-out, **on Lachy's confirmation**", "finish step 7.5's close-out"), 'reverse-lineage', 'no confirmation')
})
test('control (legacy P): the version stop ahead of the close-out in repair fails reverse-lineage', () => {
  const first = lineWith(real.repair, '- `protocol_version` absent')
  const legacy = first + '\n' + real.repair.split('\n')[real.repair.split('\n').indexOf(first) + 1]
  assert.ok(/^\s+\S/.test(legacy.split('\n')[1]) && real.repair.split('- **Close-out interrupted**').length === 2, 'control setup: the stops')
  only({ repair: real.repair.replace(legacy + '\n', '').replace('- **Close-out interrupted**', legacy + '\n- **Close-out interrupted**') }, 'reverse-lineage', 'legacy P, repair')
})
test('control (legacy P): status § 1 reading the version before the lineage fails reverse-lineage', () => {
  const s1 = raw(real.status, /^### 1\. /)
  const version = labelledRaw(s1, 'Protocol version.')
  only({ status: real.status.replace(version + '\n', '').replace('**Lineage first, then the version.**', version + '\n**Lineage first, then the version.**') },
    'reverse-lineage', 'legacy P, status § 1')
})
test('control: a case-sensitive reverse-lineage grep fails reverse-lineage', () => {
  only(st("`grep -rliE '^supersedes:", "`grep -rlE '^supersedes:"), 'reverse-lineage', 'no -i')
})
test('control: a reverse-lineage grep blind to an aliased link fails reverse-lineage', () => {
  only(st('\\[\\[<slug>([|][^]]*)?\\]\\]', '\\[\\[<slug>\\]\\]'), 'reverse-lineage', 'no alias')
})
test('control: fixture D failing fails reverse-lineage', () => {
  only({ fx: { ...real.fx, D: { ...real.fx.D, fails: ['the legacy P is not refused'] } } }, 'reverse-lineage', 'fixture D')
})
test("control: no route from schedule's refusal line fails reverse-lineage", () => {
  only(rp('`<P> is named by the supersedes: of <N>, which has since run`', '`refuse <P>`'), 'reverse-lineage', 'refusal line')
})
test('control: a reverse-lineage action that reinstates fails reverse-lineage', () => {
  only(st("(§ 1's reverse lineage) → never reinstate or resume it.", "(§ 1's reverse lineage) → reinstate it."), 'reverse-lineage', 'reinstate')
})
test('control: at Integration re-dispatched fails integration-only', () => {
  only(rp('`reconcile-rollout.py hand-back --tasks <slug>` → `review`', 'a fresh dispatch'), 'integration-only', 'redispatch')
})
test('control: fixture B failing fails integration-only', () => {
  only({ fx: { ...real.fx, B: { ...real.fx.B, fails: ['the body changed'] } } }, 'integration-only', 'fixture B')
})
test('control: an unconditional case (ii) on hand-back fails integration-only', () => {
  only(rp('it merges through case (ii) when main has not moved since that Integration; otherwise `prepare` integrates it again (verify or trouble)',
    'it merges through case (ii) with nothing redone'), 'integration-only', 'hand-back case (ii)')
})
test('control: an unconditional case (ii) on the merge-task relabel fails integration-only', () => {
  only(rp('it merges through case (ii) when main has not moved. A code', 'it merges through case (ii) with nothing redone. A code'), 'integration-only', 'relabel case (ii)')
})
test('control: no queued class fails stages', () => {
  only(rp(lineWith(real.repair, '| **queued** |') + '\n', ''), 'stages', 'no queued class')
})
test('control: RACE classed after merged, never marked fails first-match', () => {
  const race = lineWith(real.repair, '| **RACE** |')
  const merged = lineWith(real.repair, '| **merged, never marked** |')
  only({ repair: real.repair.replace(race + '\n', '').replace(merged, merged + '\n' + race) }, 'first-match', 'RACE late')
})
test('control: the in-flight RACE classed after RACE fails first-match', () => {
  const inFlight = lineWith(real.repair, '| **RACE re-verify in flight** |')
  const race = lineWith(real.repair, '| **RACE** |')
  only({ repair: real.repair.replace(inFlight + '\n', '').replace(race, race + '\n' + inFlight) }, 'first-match', 'in flight late')
})
test('control: PR CLOSED classed after awaiting Integration fails first-match', () => {
  const closed = lineWith(real.repair, '| **PR CLOSED / branch missing** |')
  const awaiting = lineWith(real.repair, '| **awaiting Integration** |')
  only({ repair: real.repair.replace(closed + '\n', '').replace(awaiting, awaiting + '\n' + closed) }, 'first-match', 'CLOSED late')
})
test('control: no first-match declaration fails first-match', () => {
  only(rp('Each unmerged task takes the **first** class in table order whose signal it matches', 'Each unmerged task takes a class'), 'first-match', 'declaration')
})
test('control: § 3a resume not held behind an undecided RACE fails first-match', () => {
  only(rp(', and **no RACE / UNVERIFIED escalation is undecided** (§ 3c)', ''), 'first-match', '3a')
})
test('control: the hand-off not held behind an undecided RACE fails first-match', () => {
  only(rp(', and never while a RACE / UNVERIFIED escalation is undecided', ''), 'first-match', 'hand-off')
})
test('control: no recorded RACE decision fails first-match', () => {
  only(rp('`- <YYYY-MM-DD> repair: [[<slug>]] RACE decided: <his decision, verbatim>`', 'his decision'), 'first-match', 'record')
})
test('control: status flagging merged-never-marked before RACE fails first-match', () => {
  const race = labelledRaw(raw(real.status, /^### 3\. /), 'RACE / UNVERIFIED:', { item: true })
  const merged = labelledRaw(raw(real.status, /^### 3\. /), 'Merged, never marked:', { item: true })
  only({ status: real.status.replace(race + '\n', '').replace(merged, merged + '\n' + race) }, 'first-match', 'status order')
})
test('control: a merge into another base handed back fails another-base', () => {
  only(rp('escalate with evidence (§ 3c); never hand it back or defer it', 'hand it back (§ 4)'), 'another-base', 'hand-back')
})
test('control: no Completion-log record of a merge into another base fails another-base', () => {
  only(rp('and merges into another base (task + PR + base)', 'and the rest'), 'another-base', 'completion log')
})
test('control: no § 3c route for a merge into another base fails another-base', () => {
  only(rp('- **Merged into another base.** `resume` leaves it unchanged', '- **Other.** `resume` leaves it unchanged'), 'another-base', '3c')
})
test("control: another base read against the other PRs' base fails another-base", () => {
  only(st("whose `baseRefName` is not the default branch (the resolver's answer)", "whose `baseRefName` is not the base the rollout's other PRs target"), 'another-base', 'other PRs')
})
test('control: an unguarded default-branch read fails another-base', () => {
  only(st(', and only when one of those PRs reads MERGED:', ':'), 'another-base', 'unguarded')
})
test('control: an open escalation without the RACE fails race-hold', () => {
  only(st('An open escalation, an undecided RACE / UNVERIFIED or a possible PR-less merge', 'An open escalation, a possible PR-less merge'), 'race-hold', 'no RACE')
})
test("control: status's Don'ts losing the RACE hold fails race-hold", () => {
  only(st("until its `RACE decided:` line is recorded: § 4's action 7 comes first", 'when ready'), 'race-hold', 'donts')
})
test('control: status allowing a reinstate before the RACE decision fails race-hold', () => {
  only(st('Never reinstate or resume with `/thread:execute` until each RACE / UNVERIFIED task has its `RACE decided:` line:', 'Reinstate or resume when ready:'), 'race-hold', 'status reinstate')
})
test('control: repair holding the RACE record behind a pause fails race-hold', () => {
  only(rp(', and, once Lachy decides a RACE / UNVERIFIED, its `RACE decided:` line. That line is what lifts the hold on `resume` (§ 3c), so neither a pause nor a live lead holds it back; only a decision that the merge does not stand waits, for its defer (a lead-held note, below).', '.'),
    'race-hold', 'every mode')
})
test('control: repair advising a reinstate before the RACE decision fails race-hold', () => {
  only(rp('Either way, point at `/thread:execute` only once every RACE / UNVERIFIED task has its `RACE decided:` line: its *Cold resume* runs `resume` first.', ''), 'race-hold', 'repair reinstate')
})
test('control: a does-not-stand decision recorded as decided while a lead is live fails race-hold', () => {
  only(rp('(never as `RACE decided:`)', '(as `RACE decided:`)'), 'race-hold', 'pending')
})
test('control: a RACE flag that fires during the re-verify fails race-in-flight', () => {
  only(st('a RACE that is undecided (above)', 'a `## Race log` line names a task that is not done'), 'race-in-flight', 'status flag')
})
test('control: an in-flight RACE flagged as drift fails race-in-flight', () => {
  only(st('flag\nnothing, and treat it as the live queue', 'flag it as an open escalation'), 'race-in-flight', 'status in flight')
})
test('control: an open escalation that takes an in-flight RACE fails race-in-flight', () => {
  only(st(' A RACE re-verify in flight (§ 3) is not an open escalation: the lead decides it itself, so it waits under 9 or 10, and nobody asks Lachy mid-re-verify.', ''),
    'race-in-flight', 'action 7')
})
test('control: an owner-session fallback that resumes an in-flight RACE fails race-in-flight', () => {
  const q = labelledRaw(raw(real.status, /^### 4\. /), 'Owner-session qualifier.')
  const i = q.indexOf('**The RACE exception:**')
  assert.ok(i > 0, 'control setup: the RACE exception')
  only({ status: real.status.replace(q, q.slice(0, i).trimEnd()) }, 'race-in-flight', 'qualifier')
})
test('control: a live queue that resumes an in-flight RACE fails race-in-flight', () => {
  only(st('applies to it: once the owner session shows the `RACE: …` halt or no run, or has ended, the next step is `/thread:repair [[<rollout>]]` (action 7), never `/thread:execute`.',
    'applies to it: once the owner session shows the `RACE: …` halt or no run, or has ended, `/thread:execute [[<rollout>]]` resumes.'), 'race-in-flight', 'action 10')
})
test('control: a RACE class that takes the re-verify in flight fails race-in-flight', () => {
  only(rp('(a `## Race log` line names it) and not in flight,', '(a `## Race log` line names it),'), 'race-in-flight', 'repair RACE class')
})
test('control: an in-flight class that escalates fails race-in-flight', () => {
  only(rp("nothing: execute's RACE procedure owns it", 'escalate (§ 3c) at once'), 'race-in-flight', 'repair in-flight class')
})
test('control: § 3c without the re-verify verdict fails race-in-flight', () => {
  only(rp("5. for a RACE only, the lead's re-verify verdict, so Lachy decides with it on screen:", '5. for a RACE only:'), 'race-in-flight', 'verdict')
})
test('control: fixture E failing fails race-in-flight', () => {
  only({ fx: { ...real.fx, E: { fails: ['resume wrote the held proj-e-race'] } } }, 'race-in-flight', 'fixture E')
})
test('control: a restore that hands back unconditionally fails closed-pr', () => {
  only(rp('then `hand-back` **only when the task is set aside**', 'then `hand-back`'), 'closed-pr', 'restore')
})
test('control: the old hand-back parenthetical fails closed-pr', () => {
  only(rp('A CLOSED PR keeps its `pr:`', '`hand-back` refuses an at-Integration note with no `pr:`; a CLOSED PR'), 'closed-pr', 'parenthetical')
})
test('control: a CLOSED PR left to the loop fails closed-pr', () => {
  only(rp('never left to the loop, which would integrate it', 'or left to the loop, which integrates it'), 'closed-pr', 'loop')
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
test("control: a raise without Lachy's word fails raise", () => {
  only(rp("a further raise is only on Lachy's word", 'repair raises once more'), 'raise', 'no word')
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
test("control: a hand-off without execute § 3's verify_timeout check fails hand-off", () => {
  only(rp("then execute § 3's `verify_timeout` check (a halt there\n  writes nothing), then", 'then'), 'hand-off', 'no verify_timeout check')
})

test('control: a hand-off under a pause fails hand-off', () => {
  only(rp('- **Hand-off, when no lead is live and no pause stands**', '- **Hand-off, when no lead is live**'), 'hand-off', 'pause')
})
test('control: a wave in status fails no-wave', () => {
  only(st('**Outside the count.**', 'Group by wave.\n\n**Outside the count.**'), 'no-wave', 'status wave')
})
test('control: a wave in repair fails no-wave', () => {
  only(rp('### 5. ', 'Defer it out of the wave.\n\n### 5. '), 'no-wave', 'repair wave')
})
test('control: a wave in a description fails no-wave', () => {
  only(st("description: 'Use to see the present situation of a rollout queue", "description: 'Use to see the present situation of a wave rollout"), 'no-wave', 'description')
})
test('control: a signed task repair may hand back fails signed-gate', () => {
  only(rp('Repair never hands it back, recuts, defers or re-plans it', 'Repair may hand it back once'), 'signed-gate', 'hand-back')
})
test("control: no signed-gate Don't fails signed-gate", () => {
  only(rp("- **Don't touch a signed task while its lead is live.**", '- **Mind signed tasks.**'), 'signed-gate', 'donts')
})

test('control: a merged row with a rung drift fails rung', () => {
  const merged = { ...fx.A.bySlug[A.merged], rungDrift: 'gone' }
  only({ fx: { ...fx, A: { ...fx.A, bySlug: { ...fx.A.bySlug, [A.merged]: merged } } } }, 'rung', 'merged drift')
})
test('control: § 2 without rungDrift fails rung', () => {
  only(st('`blockerSummary`, `rung` and `rungDrift`.', '`blockerSummary` and `rung`.'), 'rung', 'no rungDrift key')
})
test('control: a Rung drift flag without its state scope fails rung', () => {
  only(st('only for a task whose `queueState` is queued, running, awaiting-integration, integrating or set-aside, with a non-empty `rungDrift`',
    'for any task with a non-empty `rungDrift`'), 'rung', 'unscoped')
})
test('control: a Rung drift flag that says no write fixes it fails rung', () => {
  only(st("It needs no write: the engine reads it as the top rung. A re-stamp to a listed rung, or restoring that rung in `~/.config/thread/ladder.toml`, clears it; a re-stamp or a ladder edit is Lachy's choice, and",
    'Advisory: no write fixes it and'), 'rung', 'advisory wording')
})
test('control: an Offline paragraph that drops the local flags fails rung', () => {
  only(st(' It skips the live reads only: the RACE / UNVERIFIED, Rung drift and Ladder refused flags still render, from § 2\'s data and the local files.', ''), 'rung', 'offline')
})
test('control: action 11 routing a refused ladder to repair fails rung', () => {
  only(st('Any drift flag but a Rung drift, a refused ladder,', 'Any drift flag (a refused ladder included),'), 'rung', 'action 11')
})
test('control: a refused ladder routed to repair on its own fails rung', () => {
  only(st('Status never routes a refused ladder to `/thread:repair` on its own account, because repair never edits the file;',
    'Status routes a refused ladder to `/thread:repair`, which fixes the file;'), 'rung', 'routing paragraph')
})
test('control: repair handing off to execute under a refused ladder fails rung', () => {
  only(rp("Repair stops at § 4's **Hand-off**: no execute loop and no § 6.", "Then § 4's **Hand-off** runs execute's loop as usual."), 'rung', 'hand-off')
})
test('control: tier vocabulary in status fails rung', () => {
  only(st('**Outside the count.**', `A ${TIER_WORDS[0]} rollout is capped.\n\n**Outside the count.**`), 'rung', 'tier word')
})

// descope (p14-4)
test('control: § 3d handing back on exit 3 fails descope', () => {
  only(rp('Exit 3 → § 3b', "Exit 3 → § 4's `hand-back` anyway"), 'descope', 'exit 3 handed back')
})
test('control: the plan-blocked re-entry row without descope fails descope', () => {
  const l = lineWith(real.status, '| `plan-blocked`, no `## Scope decision (automatic)`')
  const cells = l.split(' | ')
  only(st(l, [...cells.slice(0, 4), "otherwise the automatic retry, then Lachy's decision (repair § 3), then `hand-back`, then its own call |"].join(' | ')),
    'descope', 'no descope in the row')
})
test('control: the descopable class after own run fails first-match', () => {
  const row = lineWith(real.repair, '| **plan-blocked, descopable** |')
  const ownRow = lineWith(real.repair, '| **own run** |')
  only({ repair: real.repair.replace(row + '\n', '').replace(ownRow, ownRow + '\n' + row) }, 'first-match', 'descopable after own run')
})

test('control: an undo that leaves the follow-up open fails descope', () => {
  only(rp('the follow-up note set to `status: dropped`', 'the follow-up note left as it is'), 'descope', 'follow-up left open')
})

// second-block (p14-4)
test('control: a plan-block after a descope handed back silently fails second-block', () => {
  only(rp('input-gated: § 3b, quoting the new feedback and the automatic descope; never a silent hand-back',
    'agent-fixable → hand back (§ 4) → its own call'), 'second-block', 'silent hand-back')
})
test("control: status's after-descope row without Lachy's decision fails second-block", () => {
  only(st("Lachy's decision (repair § 3), then `hand-back`, then its own call; never a silent hand-back", '`hand-back`, then its own call'),
    'second-block', 'status row')
})
test('control: the after-descope class after the descopable one fails first-match', () => {
  const row = lineWith(real.repair, '| **plan-blocked after a descope** |')
  const dRow = lineWith(real.repair, '| **plan-blocked, descopable** |')
  only({ repair: real.repair.replace(row + '\n', '').replace(dRow, dRow + '\n' + row) }, 'first-match', 'after-descope late')
})

test('control: a stamp-cause remedy that points at rollouts.toml fails settings', () => {
  only(st('fix that stamp\n    to an integer >= 1. No settings file is involved.', 'fix `~/.config/thread/rollouts.toml` at the named line.'), 'settings', 'stamp remedy')
})
test('control: a root-cause remedy that edits the file fails settings', () => {
  only(st('whether or not a rollouts.toml\n    exists: stamp `parallel_ceiling:` on the rollout note', 'fix `~/.config/thread/rollouts.toml`'), 'settings', 'root remedy')
})
test('control: a Rollout settings refused flag with no --repo case fails settings', () => {
  only(st('; when it names\n  `--repo` (the Project root is gone or its origin unreadable), the fix is that stamp', ''), 'settings', 'no --repo case')
})
test('control: action 11 routing refused rollout settings to repair fails settings', () => {
  only(st('a refused ladder, an unresolved ceiling or refused rollout settings, or a', 'a refused ladder, or a'), 'settings', 'action 11')
})
test('control: refused rollout settings routed to repair on their own fail settings', () => {
  only(st('are never routed to `/thread:repair` on their own account', 'are routed to `/thread:repair`'), 'settings', 'routing')
})
test("control: Don'ts without rollout-settings.py fail settings", () => {
  only(st('`lead-integrate.py inputs` and `rollout-settings.py`\n  (§ 2, a read) are the only', '`lead-integrate.py inputs` are the only'), 'settings', 'donts')
})
test('control: a Scope that still says status invokes nothing new fails settings', () => {
  only(st('Status itself runs\n`rollout-settings.py`', 'Status itself invokes nothing new; it runs\n`rollout-settings.py`'), 'settings', 'scope')
})
test('control: repair raising when the resolver refuses fails settings', () => {
  only(rp('make no raise: report its stderr line', 'raise to `lastRound + 1` anyway: report its stderr line'), 'settings', 'repair raise')
})

// queued-solo (p17-2)
test("control: the Queued row's old started-only solo rule fails queued-solo", () => {
  const l = lineWith(real.status, '| `queued` | **Queued** |')
  only(st(l, '| `queued` | **Queued** | `waitingOn`, else "behind solo [[x]]" when a started task carries `solo`, else "next free slot" |'),
    'queued-solo', 'started-only')
})

// auto-retry (p16-5)
test('control: § 3b asking only on a second block or raise fails auto-retry', () => {
  only(rp('a set-aside whose automatic retry is over (the auto-retry budget is spent, the fingerprint repeated, or `needsHuman` is set)', 'a second block, a second raise'),
    'auto-retry', '3b')
})
test('control: an own run handed back as agent-fixable fails auto-retry', () => {
  only(rp('input-gated (§ 3b): ask why it is his (`autoRetryWhy`), then on his word hand back (§ 4) → its own call.',
    'agent-fixable → hand back (§ 4) → its own call; input-gated → § 3b first.'), 'auto-retry', 'own run')
})
test('control: a retry (automatic) class that hands back fails auto-retry', () => {
  only(rp('nothing: the lead re-enters it', 'hand back (§ 4): the lead re-enters it'), 'auto-retry', 'retry class')
})
test("control: the old silent hand-back Don't fails auto-retry", () => {
  only(rp("- **Don't hand back what the lead retries.**", "- **Don't ask the user about agent-fixable blocks.** Hand them back silently (once)."), 'auto-retry', 'donts')
})
test('control: the old description fails auto-retry', () => {
  only(rp('leaves agent-fixable blocks to execute', 'auto-retries agent-fixable blocks'), 'auto-retry', 'description')
})
test('control: a Leash with no fresh stretch fails auto-retry', () => {
  only(rp('`hand-back` starts a fresh automatic-retry stretch', '`hand-back` re-enters it'), 'auto-retry', 'leash')
})
test('control: no infra reading of a usage limit fails auto-retry', () => {
  only(rp(' A usage limit that kills an agent mid-run is an infra block, never a quota block: it gets the infra cool-downs and the budget, then Lachy.', ''),
    'auto-retry', 'infra')
})
test('control: a class re-read after the answer fails auto-retry', () => {
  only(rp('never re-class a task after recording his answer', 're-class a task after recording his answer'), 'auto-retry', 're-class')
})
test('control: fixture F split failing fails auto-retry', () => {
  only({ fx: { ...real.fx, F: { ...real.fx.F, split: { fails: ['retry: no budget'] } } } }, 'auto-retry', 'fixture F split')
})

// retries (p16-5)
test('control: no auto-retry n/N form fails retries', () => {
  only(st('`auto-retry <autoRetriesUsed>/<autoRetryBudget.autoRetries.value>`', '`auto-retry <autoRetriesUsed>`'), 'retries', 'no n/N')
})
test('control: a ? on any null budget fails retries', () => {
  only(st('only when `autoRetryBudget` is null and `autoRetryWhy` starts `auto_retries unresolved`', 'when `autoRetryBudget` is null'), 'retries', '?')
})
test('control: a count from autoRetryClass alone fails retries', () => {
  only(st('`autoRetryClass` alone never shows a count', '`autoRetryClass` shows the quota count'), 'retries', 'class alone')
})
test('control: an example with no retry count fails retries', () => {
  only({ status: real.status.replace(/ · auto-retry \d\/\d/g, '') }, 'retries', 'example')
})
test('control: action 12 without the automatic retry fails retries', () => {
  only(st("an `autoRetry: true` or cooling set-aside (the lead's automatic retry re-enters it; a `plan-blocked` one is action 11's), ", ''), 'retries', 'action 12')
})
test('control: § 2 without autoRetryWhy fails retries', () => {
  only(st('`autoRetry`, `autoRetryWhy`, `autoRetryAfter`', '`autoRetry`, `autoRetryAfter`'), 'retries', '§ 2')
})
test('control: fixture F render failing fails retries', () => {
  only({ fx: { ...real.fx, F: { ...real.fx.F, render: { fails: ['asks: a budget'] } } } }, 'retries', 'fixture F render')
})

// needs-you (p16-5)
test('control: an answered question left in place fails needs-you', () => {
  only(rp('Remove the `## Needs you` section, in every mode', 'Leave the `## Needs you` section, in every mode'), 'needs-you', 'leave')
})
test('control: a section removed only where hand-back may run fails needs-you', () => {
  only(rp('Remove the `## Needs you` section, in every mode', 'Remove the `## Needs you` section where hand-back may run (§ 1)'), 'needs-you', 'mode')
})
test('control: the lost race read as an error fails needs-you', () => {
  only(rp('That is no error', 'Report it as an error'), 'needs-you', 'race')
})
test('control: an answer recorded on any block fails needs-you', () => {
  only(rp(" while the note's `auto_retry_sha:` is absent or differs from it", ''), 'needs-you', 'repair sha')
})
test('control: status without the auto_retry_sha grep fails needs-you', () => {
  only(st("`grep -m1 '^auto_retry_sha:' ~/repos/obsidian/Work/Tasks/<slug>.md`", "the note's `auto_retry_sha:`"), 'needs-you', 'status sha')
})
test('control: repair counting a - entry fails needs-you', () => {
  const r3 = labelledRaw(raw(real.repair, /^### 3\. /), '3b')
  only({ repair: real.repair.replace(r3, edit(r3, 'A `-` entry never counts.', '')) }, 'needs-you', 'repair -')
})
test('control: status without the exclusion sentence fails needs-you', () => {
  only(st('A set-aside task the RACE / UNVERIFIED, Merged into another base, Merged never marked, PR CLOSED or Possible PR-less merge flag names is no item',
    'A set-aside task a drift flag names is still an item'), 'needs-you', 'exclusion')
})
test('control: status without the offline exclusion fails needs-you', () => {
  only(st('Offline, only the RACE / UNVERIFIED flag renders, so only it excludes', 'Offline, every flag renders'), 'needs-you', 'offline')
})
test('control: a cooling task as an item fails needs-you', () => {
  only(st('no `autoRetryAfter` and', 'and'), 'needs-you', 'cooling')
})
test("control: the seeded revise's prUrlError dropped fails needs-you", () => {
  only(st(', or `prUrlError` for an `autoRevise: true` row', ''), 'needs-you', 'prUrlError')
})
test('control: action 10 without the Drift-line set-asides fails needs-you', () => {
  only(st('a set-aside task the Needs you block leaves to its Drift line, ', ''), 'needs-you', 'action 10')
})
test('control: an example with no question line fails needs-you', () => {
  only(st(lineWith(real.status, '→ asks: Which') + '\n', ''), 'needs-you', 'example')
})
test('control: a needs-you class that takes a gate fails needs-you', () => {
  only(rp(' (`setAsideAt: run` or `integration`, never a gate)', ''), 'needs-you', 'signal')
})
test("control: a gate class without its question fails needs-you", () => {
  only(rp('beneath them on a `→ asks:` line', 'beneath them'), 'needs-you', 'gate')
})
test('control: an answer written to a signed task fails needs-you', () => {
  only(rp('a signed task takes no `## Repair input`', 'a signed task takes it too'), 'needs-you', 'signed')
})
test('control: a PR-less review handed back without asking fails needs-you', () => {
  only(rp('A code-writing `review` with no `pr:` is asked too', 'A code-writing `review` with no `pr:` is handed back without asking'), 'needs-you', 'no-PR review')
})
test("control: status's needle on another entry fails needs-you", () => {
  only(st("`grep -F '(block <fingerprint>)'", "`grep -F 'needs you (block <fingerprint>)'"), 'needs-you', 'needle')
})
test("control: status's stamp read without auto_retry_at fails needs-you", () => {
  only(st("'^(### Run [0-9]+ \\(|auto_retry_at:)'", "'^### Run [0-9]+ \\('"), 'needs-you', 'stamp: auto_retry_at')
})
test("control: status's stamp read without the runs fails needs-you", () => {
  only(st("'^(### Run [0-9]+ \\(|auto_retry_at:)'", "'^auto_retry_at:'"), 'needs-you', 'stamp: runs')
})
test('control: repair counting an entry of any age fails needs-you', () => {
  only(rp("`fingerprint`, stamped later than the note's last re-entry, while", '`fingerprint`, while'), 'needs-you', 'repair stamp')
})
test('control: repair keying only a question fails needs-you', () => {
  only(rp('`decision` for every other ask', '`-` for every other ask'), 'needs-you', 'repair kind')
})
test('control: an entry with a date, not a stamp, fails needs-you', () => {
  only(rp('`- <stamp> <kind> (block <fingerprint>):', '`- <YYYY-MM-DD> <kind> (block <fingerprint>):'), 'needs-you', 'repair date')
})
test('control: no answered line in status fails needs-you', () => {
  only(st('answered: awaiting /thread:repair', 'answered'), 'needs-you', 'answered')
})
test('control: fixture F answer failing fails needs-you', () => {
  only({ fx: { ...real.fx, F: { ...real.fx.F, answer: { ...real.fx.F.answer, fails: ['(i) a stale question reads answered'] } } } }, 'needs-you', 'fixture F answer')
})
test('control: fixture F held failing fails needs-you', () => {
  only({ fx: { ...real.fx, F: { ...real.fx.F, held: { fails: ['the Drift exclusion'] } } } }, 'needs-you', 'fixture F held')
})

// closed-pr (p16-5)
test("control: the no-pr: restore's pr: write held for the lead fails closed-pr", () => {
  only(rp('wherever `hand-back` may (§ 1), a live queue included', 'as a lead-held note (§ 1), never under a live queue'), 'closed-pr', 'lead-held')
})
test('control: the live-queue mode without the restore\'s pr: write fails closed-pr', () => {
  only(rp(", and write the `pr:` § 4's restore finds for an at-Integration set-aside with no\n  `pr:`: no live call owns a set-aside note, so that write goes with the hand-back that follows it (§ 4).", '.'),
    'closed-pr', 'live queue')
})
test('control: a no-pr: Integration set-aside outside the CLOSED class fails closed-pr', () => {
  only(rp('; or set aside at Integration with no `pr:` (`autoRetryWhy` `set aside at Integration with no pr: …`), which `hand-back` refuses', ''), 'closed-pr', 'no pr:')
})
test('control: fixture F nopr failing fails closed-pr', () => {
  only({ fx: { ...real.fx, F: { ...real.fx.F, nopr: { fails: ['hand-back: 0'] } } } }, 'closed-pr', 'fixture F nopr')
})

// first-match (p16-5): a descope is judged before the automatic retry, and both before the classes that ask.
test('control: the descopable class after retry (automatic) fails first-match', () => {
  const row = lineWith(real.repair, '| **plan-blocked, descopable** |')
  const ra = lineWith(real.repair, '| **retry (automatic)** |')
  only({ repair: real.repair.replace(row + '\n', '').replace(ra, ra + '\n' + row) }, 'first-match', 'descopable after retry')
})
test('control: retry (automatic) after own run fails first-match', () => {
  const ra = lineWith(real.repair, '| **retry (automatic)** |')
  const ownRow = lineWith(real.repair, '| **own run** |')
  only({ repair: real.repair.replace(ra + '\n', '').replace(ownRow, ownRow + '\n' + ra) }, 'first-match', 'retry after own run')
})
test('control: the automatic retry ahead of every class that asks fails first-match', () => {
  only(rp('come before **at Integration** and every\nclass below it', 'come before every class that asks or\nhands back'), 'first-match', 'intro')
})
test('control: needs you after at Integration fails first-match', () => {
  const nyr = lineWith(real.repair, '| **needs you** |')
  const atRow = lineWith(real.repair, '| **at Integration** |')
  only({ repair: real.repair.replace(nyr + '\n', '').replace(atRow, atRow + '\n' + nyr) }, 'first-match', 'needs you late')
})

test('the rules are all named (33) and each has a control', () => {
  assert.equal(RULES.length, 33)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
