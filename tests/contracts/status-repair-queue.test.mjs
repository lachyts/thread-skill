// /thread:status and /thread:repair read the queue (ADR 0030, p12-11): the situational report groups a rollout's
// tasks by queue state and re-entry stage, and the conductor hands a set-aside task back at the stage it stopped
// (at Integration: Integration only), defers only its dependent closure, and never writes under a pause.
//
// Five fixtures run the landed scripts (reconcile-rollout.py, lead-integrate.py, unfinished-rollout.py) on temp
// vaults, the set-aside notes written through the real writers (engine rows from task.workflow.js via
// tests/lib/engine.mjs, the lead's set-aside rows, reconcile): A is a status fixture with every queue state and
// every set-aside stage; B is an at-Integration set-aside handed back (Integration retried, nothing else); C is B
// under a draining soft pause, the reason repair never hands back during a pause; D is a legacy rollout another
// rollout's supersedes: names, the reason the lineage is read before the version; E is a RACE under the lead and
// an UNVERIFIED set-aside, which `resume` holds (exit 3, both notes untouched) until Lachy's `RACE decided:`
// lines are recorded (p12-12). The fixtures pin data; the rules tie the prose to it.
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
// script reads, § 3's gh/git reads and the default-branch read.
import { test } from 'node:test'
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

const fxA = await buildA()
const dB0 = buildBBase()
const dBC = copyDir(dB0, path.join(tmp, 'B-pristine'))
const fx = { A: fxA, B: buildB(dB0), C: buildC(dBC), D: buildD(), E: buildE() }

// ---- the prose ------------------------------------------------------------------------------------------------

const real = { status: read('skills/status/SKILL.md'), repair: read('skills/repair/SKILL.md'), fx }

const IN_COUNT = ['merged', 'integrating', 'awaiting-integration', 'running', 'queued', 'set-aside']
const COUNT_KEY = { merged: 'merged', integrating: 'integrating', 'awaiting-integration': 'awaitingIntegration', running: 'running', queued: 'queued', 'set-aside': 'setAside' }
// Repair § 2's classes, first-match in this order: a RACE re-verify in flight first (the lead's own procedure), then
// RACE and a PR-less merge ahead of merged-never-marked and at Integration (both also match a RACE / UNVERIFIED
// task), PR CLOSED ahead of awaiting Integration.
const LABELS = ['RACE re-verify in flight', 'RACE', 'PR-less merge', 'merged into another base', 'merged, never marked', 'merge hold', 'live', 'PR CLOSED / branch missing',
  'awaiting Integration', 'queued', 'at Integration', 'revise (automatic)', 'revise stopped', 'review-blocked, rejected', 'own run', 'gate']
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
  // mode for the set-asides the lead never re-enters by itself.
  const items = numbered(labelledRaw(s4raw, 'Recommended action'))
  const liveItem = items[ACTIONS.indexOf('a live queue')] ?? ''
  const drainItem = items[ACTIONS.indexOf('`pause_requested`')] ?? ''
  const prec = labelled(s4raw, 'Precedence.')
  if (items.length !== ACTIONS.length || !ACTIONS.every((k, i) => (items[i] ?? '').toLowerCase().startsWith(k.toLowerCase())) ||
    !(items[RUN.escalation - 1] ?? '').includes('a possible PR-less merge → `/thread:repair [[<rollout>]]`') ||
    !prec.includes('The order is the precedence, with no override on top of it') || !prec.includes('Lineage (1, 2) comes before the version (3, 4)') ||
    !prec.includes(`An open escalation (${RUN.escalation}) comes before every reinstate, wait and resume (${RUN.escalation + 1} to ${RUN.nothing})`) ||
    !drainItem.includes('nothing is draining it, and `/thread:execute [[<rollout>]]` resumes the drain') ||
    !liveItem.includes('other than an `autoRevise: true` one is never re-entered by the live lead itself') ||
    !liveItem.includes('its live-queue mode hands those back')) fails.push('actions')

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

  // stages: the 16 classes, each once, and § 4's per-stage routes.
  if (JSON.stringify(clsRows.map((c) => c[0].slice(2, -2)).sort()) !== JSON.stringify([...LABELS].sort()) ||
    !ROUTES.every((l) => r4raw.split('\n').some((x) => x.startsWith(`- **${l}`))) ||
    !r4.includes('lead-integrate.py set-aside --note <task note> --kind integration')) fails.push('stages')

  // first-match: the classes are first-match in LABELS' order, and every resume (§ 3a, the hand-off) is held while
  // a RACE / UNVERIFIED escalation is undecided, i.e. until a dated `RACE decided:` line records Lachy's call;
  // status flags a RACE first, so it never also reads as merged, never marked.
  // The order is read over the known classes present (a missing or extra one is stages').
  const ho = labelled(r4raw, 'Hand-off', { item: true })
  const order = clsRows.map((c) => c[0].slice(2, -2)).filter((l) => LABELS.includes(l))
  if (JSON.stringify(order) !== JSON.stringify(LABELS.filter((l) => order.includes(l))) ||
    !collapse(r2raw).includes('Each unmerged task takes the **first** class in table order whose signal it matches') ||
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
  const cp = cls['PR CLOSED / branch missing'] ?? ''
  const cpr = labelled(r4raw, 'A CLOSED PR or a missing branch', { item: true })
  if (!cp.includes("input-gated: § 4's restore, recut, defer or leave; never left to the loop") || !cp.includes('awaiting Integration, integrating') ||
    !cpr.includes('A CLOSED PR keeps its `pr:`') || !cpr.includes('then `hand-back` **only when the task is set aside**') ||
    !cpr.includes('`prepare` never reads the PR state') || /refuses an at-Integration note with no `pr:`/.test(collapse(rb)) ||
    !flag('PR CLOSED:').includes('`prepare` never reads the PR state')) fails.push('closed-pr')

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
  if (!ho.includes('no lead is live and no pause stands') || !before(ho, 'execute § 2.5', '`reconcile-rollout.py resume`') ||
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

  // ---- both ----
  // no-wave: neither file reads the wave rollout, its frontmatter description included.
  if (BAN.test(status) || BAN.test(repair)) fails.push('no-wave')
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

// ---- the rules -------------------------------------------------------------------------------------------------

test('status and repair hold every queue rule', () => {
  assert.deepEqual(check(real), [])
})

// ---- controls: each mutates the real text (or a fixture verdict) in one place and must fail with exactly its rule ----

const RULES = ['states', 'set-aside', 'log-line', 'owner', 'drift', 'actions', 'lineage', 'read-only', 'reverse-lineage', 'integration-only',
  'stages', 'first-match', 'another-base', 'race-hold', 'race-in-flight', 'closed-pr', 'merged', 'live', 'raise', 'defer', 'anchor', 'recut', 'hand-off',
  'signed-gate', 'no-wave']
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
  only(st('its live-queue mode hands those back', 'it waits for the run, which hands those back'), 'actions', 'live-queue mode')
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

test('the rules are all named (25) and each has a control', () => {
  assert.equal(RULES.length, 25)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
