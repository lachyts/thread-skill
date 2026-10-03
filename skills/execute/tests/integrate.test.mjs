// p12-6 (ADR 0030 decision 3): Integration's trouble path is its own small Workflow call.
//
// args.mode: 'integrate' runs the integrator (or, on P1, only the judge) in the task's worktree and returns
// ONE row: today's 20 keys plus `integration`. These fixtures run the WHOLE script through runTask() with a
// label-keyed stub that throws on any label it was not given (so a stray dispatch fails loudly) and
// records every dispatch's opts. The rendered steps themselves run in tests/integration-tree.test.sh; the
// note side of the stage markers runs in tests/integration-marker-roundtrip.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { runTask, loadEngine, enginePath } from '../../../tests/lib/engine.mjs'

const T = loadEngine([
  'parseIntegrationMarker', 'REVISE_MARKER', 'INTEGRATION_PREFIX', 'ANCHOR_RECIPE', 'TRANSIENT_DIAGNOSIS',
  'resumeArgsError', 'integrationArgsError', 'isoMinutes', 'integratorPrompt', 'integrationReviewPrompt',
  'reviserPrompt', 'coldEntryBlock', 'branchTreeSetup', 'integrationMergeStep', 'integrationJudgeCheck',
  'integrationVerify', 'markerHistory', 'GIT_ENV_SCRUB', 'ralphLoop', 'integrationMergeReads',
])

const ROW_KEYS = [
  'slug', 'scope', 'status', 'prUrl', 'branch', 'worktreePath', 'reviewRoundsUsed', 'planRoundsUsed',
  'blockerDiagnosis', 'reviewFeedback', 'reviewHistory', 'approvedAtCeiling', 'gatedInputs', 'summary',
  'startRung', 'rung', 'climbs', 'rungDrift', 'ran', 'plan',
]
const STATUSES = ['review', 'review-blocked', 'blocked', 'plan-blocked', 'gate-pending']
const sha = (c) => c.repeat(40)
const H0 = sha('a') // the anchor (the approved head)
const TB = sha('b') // the task's base
const B1 = sha('c') // origin/<default> after it moved
const M = sha('d') // the Integration merge commit
const F1 = sha('e') // a fix commit after the merge
const RH = sha('f') // a repair / revise head
const P = sha('1') // the commit before an own-run merge
const B2 = sha('2') // origin/<default> after it moved again, past the lead's read (mainSha = B1)
const M1 = sha('3') // an earlier Integration's merge, pushed but never judged
const M2 = sha('4') // the merge a re-entry makes on top of M1
const SLUG = 'proj-fix-a'
const PR = 'https://github.com/o/r/pull/7'
const BR = 'audit-fix/fix-a'
const WT = '/repo/.claude/worktrees/proj-fix-a'
const START = '2026-10-01T10:00:00Z'
const LANDED = [{ prUrl: 'https://github.com/o/r/pull/5', title: 'theirs: rename', files: ['a.js', 'b.js'], taskPath: '/vault/Tasks/proj-theirs.md' }]
const HIST2 = [{ round: 1, feedback: ['own-run fix'] }, { round: 2, feedback: ['keep their rename'], stage: 'integration' }]

const mkTask = (over = {}) => ({
  slug: SLUG, taskPath: `/vault/Tasks/${SLUG}.md`, scope: 'cross-cutting', planGate: true,
  maxIterations: 3, maxReviewRounds: 3, maxPlanRounds: 3, rung: 'opus-xhigh', ...over,
})
// The task's own rung record, as its approving row carried it.
const RUNG = { startRung: 'opus-high', rung: 'opus-xhigh', climbs: [{ stage: 'implement', from: 'opus-high', to: 'opus-xhigh' }] }
const mkI = (over = {}) => ({
  prUrl: PR, branch: BR, worktreePath: WT, headSha: H0, taskBase: TB, mainSha: B1, trouble: [], landed: [],
  plan: 'THE APPROVED PLAN', reviewHistory: [], reviewRoundsUsed: 1, rung: RUNG, startedAt: START, ...over,
})
const mkArgs = (I, over = {}, taskOver = {}) => ({
  rolloutSlug: 'proj-rollout-2026-10-01', repoPath: '/repo', verifier: 'make test', date: '2026-10-01',
  mode: 'integrate', task: mkTask(taskOver), integration: I, ...over,
})

// An integrator result whose merge log is what the merge step prints for that state.
function ir(o = {}) {
  const state = o.state || 'up-to-date'
  const taskHead = o.taskHead || H0
  const base = o.base || (state === 'up-to-date' ? TB : B1)
  const mc = state === 'up-to-date' ? '' : (o.merge || M)
  const head = o.head || (state === 'up-to-date' ? taskHead : mc)
  const conflicts = o.conflicts || []
  const line = o.mergeLine || (state === 'up-to-date' ? 'merge: up-to-date' : conflicts.length ? 'merge: conflict' : `merge: ${state} ${mc}`)
  const log = [
    ...(o.noAnchor ? [] : [`anchor: ${o.anchor || `${H0} base ${TB}`}`]), `task head: ${taskHead}`, `integration base: ${base}`,
    ...(o.files || ['a.js']).map((f) => `task file: ${f}`), ...(o.mainFiles || []).map((f) => `main file: ${f}`),
    line, ...(o.logConflicts || conflicts).map((f) => `conflict: ${f}`),
  ].join('\n')
  return {
    blocked: false, blockerDiagnosis: '', verified: o.verified === undefined ? state !== 'up-to-date' : o.verified,
    mergeLog: log, mergeState: state, mergeCommit: mc, taskHead, baseSha: base, headSha: head, pushedSha: o.pushed || head,
    conflictFiles: o.conflictFiles || conflicts, fixCommits: o.fix || [], summary: 'integrated',
    finishedAt: o.finishedAt || '2026-10-01T10:20:00Z', ...(o.extra || {}),
  }
}
const blockedIr = (diag, extra = {}) => ({ ...ir(), blocked: true, blockerDiagnosis: diag, mergeState: 'none', mergeLog: '', ...extra })
const jv = (verdict = 'approve', feedback = [], o = {}) => ({ verdict, feedback, unreadable: !!o.unreadable, finishedAt: o.finishedAt || '2026-10-01T10:31:00Z' })
const ILABEL = `integrate:${SLUG}`
const JLABEL = (r) => `integration-review:${SLUG} r${r}`

const allRuns = []
// Runs the engine once with a label-keyed stub: script[label] is a result, a function (prompt, opts) →
// result, an Error to throw, or a list consumed one per dispatch of that label. Any other label throws.
async function run(args, script = {}) {
  const unknown = []
  const opts = []
  const left = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]))
  const out = await runTask(args, async (prompt, o) => {
    opts.push(o)
    if (!(o.label in left)) { unknown.push(o.label); throw new Error('stub: unknown agent label ' + o.label) }
    let v = left[o.label]
    if (Array.isArray(v)) v = v.length > 1 ? v.shift() : v[0]
    if (v instanceof Error) throw v
    return typeof v === 'function' ? v(prompt, o) : v
  })
  const r = { ...out, unknown, opts, labels: out.calls.map((c) => c.label), row: out.result && out.result.tasks[0] }
  allRuns.push(r)
  return r
}
const promptOf = (r, label) => (r.calls.find((c) => c.label === label) || {}).prompt || ''
const clean = (r) => {
  assert.equal(r.error, undefined, String(r.error && r.error.stack))
  assert.deepEqual(r.unknown, [])
  assert.ok(r.logs.every((l) => !/\bwave\b/i.test(l)), r.logs.join('\n'))
}
const setAsideDiags = []
const setAside = (r, label) => {
  assert.equal(r.row.status, 'blocked', label)
  assert.equal(r.row.integration.outcome, 'set-aside', label)
  assert.notEqual(r.row.status, 'review')
  setAsideDiags.push([label, r.row.blockerDiagnosis])
}

// ---- (a) an unmoved base ------------------------------------------------------------------------------

test('a1: up-to-date with empty trouble → integrated, no judge, path integrator, row review', async () => {
  const r = await run(mkArgs(mkI()), { [ILABEL]: ir() })
  clean(r)
  assert.deepEqual(r.labels, [ILABEL])
  assert.equal(r.result.rolloutSlug, 'proj-rollout-2026-10-01')
  assert.equal(r.result.tasks.length, 1)
  assert.equal(r.row.status, 'review')
  assert.equal(r.row.blockerDiagnosis, '')
  assert.deepEqual(r.row.integration.triggers, [])
  assert.equal(r.row.integration.outcome, 'integrated')
  assert.equal(r.row.integration.path, 'integrator')
  assert.equal(r.row.integration.reReviewed, false)
  assert.equal(r.row.integration.headSha, H0)
  assert.equal(r.row.integration.baseSha, TB)
  assert.deepEqual(r.row.integration.anchor, { headSha: H0, taskBase: TB })
})

test('a2: red in trouble needs a green verify: unverified → set-aside, verified → integrated', async () => {
  const I = mkI({ trouble: ['red'] })
  const red = await run(mkArgs(I), { [ILABEL]: ir({ verified: false }) })
  clean(red)
  setAside(red, 'a2')
  assert.match(red.row.blockerDiagnosis, /^integration: the full verifier was required but did not go green/)
  const green = await run(mkArgs(I), { [ILABEL]: ir({ verified: true }) })
  clean(green)
  assert.equal(green.row.status, 'review')
  assert.deepEqual(green.labels, [ILABEL])
})

test('a3: the race case (up-to-date, base = taskBase, head unchanged, no red) integrates with no verify', async () => {
  const r = await run(mkArgs(mkI({ mainSha: B1 })), { [ILABEL]: ir({ verified: false }) })
  clean(r)
  assert.equal(r.row.status, 'review')
  assert.equal(r.row.integration.baseSha, TB)
  assert.deepEqual(r.labels, [ILABEL])
})

test('a4: up-to-date onto a base that is not the task base → set-aside', async () => {
  const r = await run(mkArgs(mkI()), { [ILABEL]: ir({ base: B1 }) })
  clean(r)
  setAside(r, 'a4')
  assert.match(r.row.blockerDiagnosis, /not the task's base/)
})

// ---- (b) a resolved conflict ----------------------------------------------------------------------------

test('b1-b3: a conflict from the log, from trouble, or from conflict: lines alone gets the judge', async () => {
  const cases = [
    ['b1 log', mkI(), ir({ state: 'merged', conflicts: ['a.js'], conflictFiles: [] })],
    ['b2 trouble', mkI({ trouble: ['conflict'] }), ir({ state: 'merged', files: ['z.js'] })],
    ['b3 conflict: lines', mkI(), ir({ state: 'merged', logConflicts: ['a.js'], conflictFiles: [], files: ['z.js'] })],
  ]
  for (const [name, I, res] of cases) {
    const r = await run(mkArgs(I), { [ILABEL]: res, [JLABEL(2)]: jv() })
    clean(r)
    assert.deepEqual(r.labels, [ILABEL, JLABEL(2)], name)
    assert.ok(r.row.integration.triggers.includes('conflict'), name)
    assert.equal(r.row.status, 'review', name)
    assert.equal(r.row.integration.mergeCommit, M, name)
  }
})

test('b4: the integrator prompt carries the landed PRs, the plan, the merge step, its anchor STOPs and the rules', async () => {
  const I = mkI({ trouble: ['conflict'], landed: LANDED, reviewHistory: [{ round: 1, feedback: ['own fix'] }] })
  const r = await run(mkArgs(I), { [ILABEL]: ir({ state: 'merged', conflicts: ['a.js'] }), [JLABEL(2)]: jv() })
  clean(r)
  const p = promptOf(r, ILABEL)
  for (const s of [
    'https://github.com/o/r/pull/5 — theirs: rename', 'files: a.js, b.js', 'task brief: /vault/Tasks/proj-theirs.md',
    'Read EVERY brief above', 'THE APPROVED PLAN', 'Round 1 rejection:\n- own fix', 'ANTI-REGRESSION',
    "the lead's trouble: conflict", 'keeping BOTH intents', 'merge --abort', 'VERBATIM into mergeLog',
    'stash push --quiet -m "$L"', 'echo "stashed: $L"', 'L="integration leftovers $(git -C "$WT" rev-parse HEAD)"',
    'never pop or apply it', `This list ends at ${B1}, origin/main as the lead read it`,
    `git -C "${WT}" log --first-parent ${B1}..<integration base>\` after the merge step`,
    'merge_stop() { echo "merge step STOP: $1"; exit 3; }',
    'merge_stop "stale anchor ref $X is not on $BR (branch recut or rewritten) — delete it: git update-ref -d $REF $X"',
    'merge_stop "anchor mismatch: recorded $X, passed $A — pass the recorded anchor"',
    'merge_stop "anchor $A carries a merge — ANCHOR_RECIPE gives $R"',
    "taskBase $TB is not merge-base($A, $D) = $MB", T.ANCHOR_RECIPE, `A="${H0}"; TB="${TB}"`,
    'update-ref "$REF" "$A" ""', 'Merge origin/main into $BR (Integration)', 'Max iterations: 3',
    'Write nothing to the task note (the engine records the diagnosis), and push nothing.',
    `push origin "${BR}"`, `ls-remote origin "refs/heads/${BR}"`, 'Before you push, run these preflight checks',
    '<integration base>...HEAD', 'Gated inputs (hard rule', 'never write the task note', 'date -u +%Y-%m-%dT%H:%M:%SZ',
  ]) assert.ok(p.includes(s), `integrator prompt: ${s}`)
  assert.ok(!p.includes('Also append that diagnosis'), 'integrator prompt: no note write')
  assert.ok(!p.includes('ONE-SHOT'), 'integrator prompt: the full loop, never the one-shot')
  assert.ok(!p.includes('tracked changes in $WT — commit or discard them'), 'integrator prompt: leftovers are stashed, not a STOP')
  assert.ok(!p.includes('tree NOT fast-forwarded'), 'integrator prompt: its setup never fast-forwards (the merge step does, after the stash)')
  // p14-2: the plan is reference only — the brief and the review history are the contract, and a deviation
  // the PR body declares (a step-back revise may make one) stands.
  for (const s of [
    'The approved plan, for reference only', 'a deviation from this plan that the PR body declares',
    'stands, and your resolution never undoes it', 'The task brief and the review history below are\nthe contract',
  ]) assert.ok(p.includes(s), `integrator prompt (p14-2): ${s}`)
  for (const s of ["the task's contract — your resolution keeps it", 'The approved plan and the review history below are the contract']) {
    assert.ok(!p.replace(/\n/g, ' ').includes(s), `integrator prompt (p14-2): no ${s}`)
  }
  assert.ok(!p.includes('(no plan:'), 'a plan was passed: no placeholder')
  const noPlan = T.integratorPrompt(mkTask(), mkArgs(mkI({ plan: '' })), mkI({ plan: '' }))
  assert.ok(noPlan.includes('---\n(no plan: the task was not plan-gated — the brief is the contract)\n---'), 'the no-plan placeholder keeps its bytes')
  const empty = await run(mkArgs(mkI()), { [ILABEL]: ir() })
  assert.match(promptOf(empty, ILABEL), new RegExp(`git -C "${WT}" log --first-parent ${TB}\\.\\.origin/main`))
  assert.match(promptOf(empty, ILABEL), /none reported \(a re-entry/)
  assert.ok(!promptOf(empty, ILABEL).includes('This list ends at'), 'no landed list: the taskBase..origin read already covers it')
  const j = promptOf(r, JLABEL(2))
  for (const s of [
    T.integrationMergeReads(mkArgs(I), mkTask(), I, { headSha: M }).split('\n').map((l) => '    ' + l).join('\n'),
    `A="${H0}"; HD="${M}"`, 'for C in $(git -C "$WT" log --first-parent --merges --format=%H "$A..$HD"); do',
    'show --cc "$C"', 'merge-tree --write-tree "$C^1" "$C^2"', 'not only the newest',
    `diff "${M}^1" ${M}`, `diff "${M}^2" ${M}`,
    `log -p --first-parent --no-merges ${H0}..${M}`, 'gh pr diff https://github.com/o/r/pull/5',
    'was anything of theirs (the landed PRs)', 'dropped or contradicted', 'anything of ours', 'Why you are here: conflict',
  ]) assert.ok(j.includes(s), `judge prompt: ${s}`)
  assert.ok(!j.includes(`log --first-parent ${B1}..`), 'judge prompt: base = mainSha, so no late-landed read')
})

test('b4b: the step-back reviser and the integrator agree — the plan is reference, the brief the contract', () => {
  const P = 'PLAN P: rename foo to bar'
  const resume = { stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, reviewHistory: HIST2, reviewRoundsUsed: 2, plan: P }
  const a = { rolloutSlug: 'r', repoPath: '/repo', verifier: 'make test', date: '2026-10-01', task: mkTask({ resume }) }
  const reviser = T.reviserPrompt(a.task, { prUrl: PR, branch: BR, worktreePath: WT }, HIST2, 3, a, P, { history: HIST2, roundsUsed: 2 })
  const I = mkI({ plan: P })
  const integrator = T.integratorPrompt(mkTask(), mkArgs(I), I)
  for (const p of [reviser, integrator]) {
    assert.ok(p.includes(P), 'both render the plan')
    const flat = p.replace(/\s+/g, ' ')
    assert.ok(!/plan[^.]{0,40}\bis (the|your) contract|the task's contract/i.test(flat), 'neither calls the plan the contract')
    assert.match(flat, /The (task )?brief (remains your contract|is the contract|and the review history below are the contract)/)
  }
  assert.ok(reviser.includes('STEP-BACK ROUND') && reviser.replace(/\s+/g, ' ').includes('the plan is reference, not law'))
  assert.ok(integrator.includes('The approved plan, for reference only'))
})

test('b5: an already-merged M integrates with that M', async () => {
  const r = await run(mkArgs(mkI()), {
    [ILABEL]: ir({ state: 'already-merged', taskHead: M, merge: M, head: M, verified: true }), [JLABEL(2)]: jv(),
  })
  clean(r)
  assert.deepEqual(r.row.integration.triggers, ['branch-moved'])
  assert.equal(r.row.integration.mergeCommit, M)
  assert.equal(r.row.status, 'review')
})

// ---- (c) triggers ------------------------------------------------------------------------------------

test('c1/c1b/c2: shared-file from a landed file, from main file: lines, and from the lead\'s trouble', async () => {
  const cases = [
    ['c1 landed', mkI({ landed: LANDED }), ir({ state: 'merged', files: ['a.js'] })],
    ['c1b main file:', mkI(), ir({ state: 'merged', files: ['a.js'], mainFiles: ['a.js', 'm.js'] })],
    ['c2 trouble', mkI({ trouble: ['shared-file'] }), ir({ state: 'merged', files: ['z.js'] })],
  ]
  for (const [name, I, res] of cases) {
    const r = await run(mkArgs(I), { [ILABEL]: res, [JLABEL(2)]: jv() })
    clean(r)
    assert.deepEqual(r.labels, [ILABEL, JLABEL(2)], name)
    assert.deepEqual(r.row.integration.triggers, ['shared-file'], name)
    assert.equal(r.row.integration.reReviewed, true, name)
  }
})

test('c3: branch-moved — repair commits send it to the judge, whose range starts at the anchor', async () => {
  const r = await run(mkArgs(mkI()), { [ILABEL]: ir({ taskHead: RH, verified: true }), [JLABEL(2)]: jv() })
  clean(r)
  assert.deepEqual(r.row.integration.triggers, ['branch-moved'])
  assert.ok(promptOf(r, JLABEL(2)).includes(`log -p --first-parent --no-merges ${H0}..${RH}`))
  assert.ok(promptOf(r, JLABEL(2)).includes('No new merge commit'))
})

test('c4: committed — head past the merge commit with fixCommits [] still gets the judge', async () => {
  const r = await run(mkArgs(mkI()), { [ILABEL]: ir({ state: 'merged', head: F1, fix: [], files: ['z.js'] }), [JLABEL(2)]: jv() })
  clean(r)
  assert.deepEqual(r.row.integration.triggers, ['committed'])
  assert.equal(r.row.integration.headSha, F1)
})

test('c5: a clean merge sharing no file integrates with no judge', async () => {
  const I = mkI({ landed: [{ ...LANDED[0], files: ['m.js'] }] })
  const r = await run(mkArgs(I), { [ILABEL]: ir({ state: 'merged', files: ['a.js'], mainFiles: ['m.js'] }) })
  clean(r)
  assert.deepEqual(r.labels, [ILABEL])
  assert.deepEqual(r.row.integration.triggers, [])
  assert.equal(r.row.integration.headSha, M)
  assert.equal(r.row.integration.baseSha, B1)
})

test('c6: P1 — a verified, clean, shared-file-only lead merge runs the judge only', async () => {
  const LM = sha('9')
  const I = mkI({ trouble: ['shared-file'], landed: LANDED, leadMerge: { mergeCommit: LM, headSha: LM, baseSha: B1, verified: true } })
  const r = await run(mkArgs(I), { [JLABEL(2)]: jv('approve', [], { finishedAt: '2026-10-01T10:12:00Z' }) })
  clean(r)
  assert.deepEqual(r.labels, [JLABEL(2)])
  assert.equal(r.row.status, 'review')
  assert.equal(r.row.integration.path, 'judge-only')
  assert.equal(r.row.integration.headSha, LM)
  assert.equal(r.row.integration.baseSha, B1)
  assert.equal(r.row.integration.mergeCommit, LM)
  assert.equal(r.row.integration.metrics.durationMinutes, 12)
  const j = promptOf(r, JLABEL(2))
  assert.ok(j.includes('the lead merged and verified; no integrator ran'))
  assert.ok(j.includes(`A="${H0}"; HD="${LM}"`) && j.includes('show --cc "$C"'), 'P1: every merge under the lead merge is read')
  assert.ok(j.includes(`diff "${LM}^1" ${LM}`))
})

test('c7: a lead merge with red (or unverified, or with fixes) goes to the integrator', async () => {
  const LM = sha('9')
  for (const [name, I] of [
    ['red', mkI({ trouble: ['shared-file', 'red'], leadMerge: { mergeCommit: LM, headSha: LM, baseSha: B1, verified: true } })],
    ['unverified', mkI({ trouble: ['shared-file'], leadMerge: { mergeCommit: LM, headSha: LM, baseSha: B1, verified: false } })],
    ['fixes', mkI({ trouble: ['shared-file'], leadMerge: { mergeCommit: LM, headSha: F1, baseSha: B1, verified: true } })],
    ['base unmoved', mkI({ trouble: ['shared-file'], leadMerge: { mergeCommit: LM, headSha: LM, baseSha: TB, verified: true } })],
  ]) {
    const r = await run(mkArgs(I), { [ILABEL]: ir({ state: 'merged', files: ['a.js'] }), [JLABEL(2)]: jv() })
    clean(r)
    assert.deepEqual(r.labels, [ILABEL, JLABEL(2)], name)
    assert.equal(r.row.integration.path, 'integrator', name)
  }
})

test('c8: a merge log with no task file: line is set aside', async () => {
  const r = await run(mkArgs(mkI()), { [ILABEL]: ir({ files: [] }) })
  clean(r)
  setAside(r, 'c8')
  assert.match(r.row.blockerDiagnosis, /no `task file:` line/)
})

test('c9: PRs that landed after the lead read main reach the judge; a base equal to mainSha adds nothing', async () => {
  const late = await run(mkArgs(mkI({ landed: LANDED, mainSha: B1 })), { [ILABEL]: ir({ state: 'merged', base: B2, files: ['a.js'] }), [JLABEL(2)]: jv() })
  clean(late)
  const j = promptOf(late, JLABEL(2))
  assert.ok(j.includes(`git -C "${WT}" log --first-parent ${B1}..${B2}\` — PRs that landed after the lead read origin/main at ${B1}`), 'judge: mainSha..base')
  assert.ok(j.includes("read each one's `gh pr diff` and brief too"))
  assert.ok(promptOf(late, ILABEL).includes(`log --first-parent ${B1}..<integration base>`), 'integrator: the same range, after its fetch')
  const same = await run(mkArgs(mkI({ landed: LANDED, mainSha: B1 })), { [ILABEL]: ir({ state: 'merged', base: B1, files: ['a.js'] }), [JLABEL(2)]: jv() })
  assert.ok(!promptOf(same, JLABEL(2)).includes(`log --first-parent ${B1}..`), 'base = mainSha: nothing landed past the list')
  const none = await run(mkArgs(mkI({ mainSha: B1 })), { [ILABEL]: ir({ state: 'merged', base: B2, files: ['a.js'], mainFiles: ['a.js'] }), [JLABEL(2)]: jv() })
  const jn = promptOf(none, JLABEL(2))
  assert.ok(jn.includes(`log --first-parent ${TB}..${B2}\` for what landed`) && !jn.includes(`${B1}..${B2}`), 'no landed list: taskBase..base already covers it')
})

test('c10: two merges — a judge that died after M1 was pushed, then a re-entry that merges M2: the judge reads both', async () => {
  const I = mkI({ landed: LANDED })
  const first = await run(mkArgs(I), { [ILABEL]: ir({ state: 'merged', merge: M1, conflicts: ['a.js'] }), [JLABEL(2)]: null })
  setAside(first, 'c10')
  const again = await run(mkArgs(I), {
    [ILABEL]: ir({ state: 'merged', taskHead: M1, merge: M2, head: M2, base: B2, files: ['a.js'] }), [JLABEL(2)]: jv(),
  })
  clean(again)
  assert.deepEqual(again.row.integration.mergeCommit, M2)
  const j = promptOf(again, JLABEL(2))
  // the loop over H0..M2 lists M1 as well as M2 (tests/integration-tree.test.sh runs it on a real two-merge branch)
  assert.ok(j.includes(T.integrationMergeReads(mkArgs(I), mkTask(), I, { headSha: M2 }).split('\n').map((l) => '    ' + l).join('\n')))
  assert.ok(j.includes(`A="${H0}"; HD="${M2}"`) && j.includes('--merges --format=%H "$A..$HD"'))
  assert.ok(j.includes('a merge an earlier\n  Integration pushed but never had judged is part of what you judge now'))
  assert.ok(j.includes(`diff "${M2}^1" ${M2}`), 'the newest merge as each side sees it')
  // P1: a lead merge on top of the unjudged M1 — the range runs from the anchor, so M1 is read too
  const LM = sha('9')
  const p1 = await run(mkArgs(mkI({ trouble: ['shared-file'], landed: LANDED, leadMerge: { mergeCommit: LM, headSha: LM, baseSha: B2, verified: true } })), { [JLABEL(2)]: jv() })
  assert.ok(promptOf(p1, JLABEL(2)).includes(`A="${H0}"; HD="${LM}"`))
})

// ---- (d) a rejection -----------------------------------------------------------------------------------

let d1Diag = ''
let s6Diag = ''
test('d1: a rejection with rounds left → blocked with the revise marker and the full history', async () => {
  const I = mkI({ landed: LANDED, reviewHistory: [{ round: 1, feedback: ['own fix'] }] })
  const r = await run(mkArgs(I), {
    [ILABEL]: ir({ state: 'merged', files: ['a.js'] }),
    [JLABEL(2)]: jv('changes', ['their rename of foo()\n  was reverted in a.js', 'restore b.js']),
  })
  clean(r)
  const row = r.row
  assert.equal(row.status, 'blocked')
  assert.notEqual(row.status, 'review')
  assert.equal(row.integration.outcome, 'rejected')
  assert.equal(row.blockerDiagnosis.split('\n')[0], T.REVISE_MARKER)
  assert.equal(row.reviewRoundsUsed, 2)
  assert.deepEqual(row.reviewFeedback, ['their rename of foo() was reverted in a.js', 'restore b.js'])
  assert.deepEqual(row.reviewHistory, [
    { round: 1, feedback: ['own fix'] },
    { round: 2, feedback: ['their rename of foo() was reverted in a.js', 'restore b.js'], stage: 'integration' },
  ])
  assert.deepEqual(row.integration.feedback, row.reviewFeedback)
  const parsed = T.parseIntegrationMarker(row.blockerDiagnosis)
  assert.equal(parsed.stage, 'revise')
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.history)), row.reviewHistory)
  assert.ok(row.blockerDiagnosis.includes('Round 2 (Integration) rejection:\n- their rename of foo() was reverted in a.js'))
  d1Diag = row.blockerDiagnosis
})

test('d2: a rejection on the last review round → review-blocked with the full history', async () => {
  const I = mkI({ reviewHistory: [{ round: 1, feedback: ['own fix'] }], reviewRoundsUsed: 1 })
  const r = await run(mkArgs(I, {}, { maxReviewRounds: 2 }), {
    [ILABEL]: ir({ state: 'merged', conflicts: ['a.js'] }), [JLABEL(2)]: jv('changes', ['theirs dropped']),
  })
  clean(r)
  assert.equal(r.row.status, 'review-blocked')
  assert.equal(r.row.reviewRoundsUsed, 2)
  assert.deepEqual(r.row.reviewHistory, [{ round: 1, feedback: ['own fix'] }, { round: 2, feedback: ['theirs dropped'], stage: 'integration' }])
  assert.deepEqual(r.row.reviewFeedback, ['theirs dropped'])
})

test('d3: a judge that cannot read the integration → set-aside at Integration, never approved', async () => {
  const r = await run(mkArgs(mkI()), {
    [ILABEL]: ir({ state: 'merged', conflicts: ['a.js'] }),
    [JLABEL(2)]: jv('changes', ['cannot read the integration: cannot read the integration commits: ' + M], { unreadable: true }),
  })
  clean(r)
  setAside(r, 'd3')
  assert.equal(T.parseIntegrationMarker(r.row.blockerDiagnosis).stage, 'integrate')
  assert.match(r.row.blockerDiagnosis, /^integration: judge could not read the integration — cannot read the integration: /)
  assert.equal(r.row.reviewRoundsUsed, 1, 'an infrastructure fault spends no review round')
})

test('d4: a task.resume built only from d1\'s diagnosis passes validation and dispatches revise then review', async () => {
  assert.ok(d1Diag, 'd1 ran')
  const parsed = T.parseIntegrationMarker(d1Diag)
  const resume = {
    stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, plan: 'THE APPROVED PLAN',
    reviewHistory: parsed.history, reviewRoundsUsed: parsed.history[parsed.history.length - 1].round,
  }
  const args = { rolloutSlug: 'r', repoPath: '/repo', verifier: 'make test', date: '2026-10-01', task: mkTask({ resume }) }
  assert.equal(T.resumeArgsError(args), '')
  const r = await run(args, {
    [`revise:${SLUG} r3`]: { verified: true, blocked: false, escalate: false, prUrl: PR, branch: BR, worktreePath: WT, blockerDiagnosis: '', summary: 'revised' },
    [`review:${SLUG} r3`]: { verdict: 'approve', feedback: [] },
  })
  clean(r)
  assert.deepEqual(r.labels, [`revise:${SLUG} r3`, `review:${SLUG} r3`])
  assert.equal(r.row.status, 'review')
})

// ---- (e) set-asides --------------------------------------------------------------------------------

test('e1: an unresolvable conflict → set-aside with its reason, no judge', async () => {
  const r = await run(mkArgs(mkI({ trouble: ['conflict'] })), {
    [ILABEL]: blockedIr('conflict in a.js and b.js cannot be resolved without dropping their rename'),
  })
  clean(r)
  assert.deepEqual(r.labels, [ILABEL])
  setAside(r, 'e1')
  assert.equal(r.row.blockerDiagnosis, 'integration: conflict in a.js and b.js cannot be resolved without dropping their rename')
  assert.equal(r.row.integration.reason, 'conflict in a.js and b.js cannot be resolved without dropping their rename')
})

test('e2: a dead integrator → a transient set-aside (one in-run retry)', async () => {
  const r = await run(mkArgs(mkI()), { [ILABEL]: null })
  clean(r)
  assert.deepEqual(r.labels, [ILABEL, ILABEL])
  setAside(r, 'e2')
  assert.equal(r.row.blockerDiagnosis, 'integration: ' + T.TRANSIENT_DIAGNOSIS)
})

test('e3: a result the engine cannot trust is set aside (table)', async () => {
  const cases = [
    ['bad sha', ir({ state: 'merged', extra: { headSha: 'xyz', pushedSha: 'xyz' } }), /headSha is not a 40-hex sha/],
    ['pushed ≠ head', ir({ state: 'merged', pushed: F1 }), /the push did not land/],
    ['required verify unrun', ir({ state: 'merged', verified: false }), /verifier was required/],
    ['disagreeing merge line', ir({ state: 'merged', mergeLine: `merge: merged ${F1}` }), /disagrees with mergeState/],
    ['state none', { ...ir(), mergeState: 'none' }, /mergeState is none/],
    ['no anchor line', ir({ noAnchor: true }), /no `anchor:` line/],
    ['wrong anchor line', ir({ anchor: `${M} base ${TB}` }), /is not the passed anchor/],
    ['task head disagrees', { ...ir(), taskHead: RH, headSha: RH, pushedSha: RH, verified: true }, /is not the merge log's task head/],
  ]
  for (const [name, res, re] of cases) {
    const r = await run(mkArgs(mkI()), { [ILABEL]: res })
    clean(r)
    assert.deepEqual(r.labels, [ILABEL], name)
    setAside(r, 'e3 ' + name)
    assert.match(r.row.blockerDiagnosis, re, name)
    assert.match(r.row.blockerDiagnosis, /^integration: /, name)
  }
})

test('e4: an unapproved gate → gate-pending; an approved one does not pause', async () => {
  const gate = 'spend: a paid API — cap $5'
  const r = await run(mkArgs(mkI()), { [ILABEL]: blockedIr('needs a paid API', { gatedInputs: [gate] }) })
  clean(r)
  assert.equal(r.row.status, 'gate-pending')
  assert.deepEqual(r.row.gatedInputs, [gate])
  assert.equal(r.row.integration.outcome, 'set-aside')
  assert.match(r.row.blockerDiagnosis, /^integration: gated inputs await human sign-off/)
  setAsideDiags.push(['e4', r.row.blockerDiagnosis])
  const ok = await run(mkArgs(mkI(), {}, { approvedGates: [gate] }), { [ILABEL]: { ...ir(), gatedInputs: [gate] } })
  clean(ok)
  assert.equal(ok.row.status, 'review')
})

let e5Diag = ''
test('e5: a stage that throws → a prefixed set-aside carrying the history, which the parser recovers', async () => {
  const r = await run(mkArgs(mkI({ reviewHistory: HIST2, reviewRoundsUsed: 3 })), { [ILABEL]: new Error('boom') })
  clean(r)
  setAside(r, 'e5')
  assert.equal(r.row.blockerDiagnosis.split('\n')[0], 'integration: workflow stage threw — see /workflows')
  assert.deepEqual(JSON.parse(JSON.stringify(T.parseIntegrationMarker(r.row.blockerDiagnosis).history)), HIST2)
  assert.deepEqual(r.row.reviewHistory, HIST2)
  assert.equal(r.row.reviewRoundsUsed, 3)
  assert.equal(r.row.integration.metrics.durationMinutes, null)
  assert.ok(r.logs.some((l) => l.startsWith(`integrate threw on ${SLUG}`)))
  e5Diag = r.row.blockerDiagnosis
  const bare = await run(mkArgs(mkI()), { [ILABEL]: new Error('boom') })
  assert.equal(bare.row.blockerDiagnosis, 'integration: workflow stage threw — see /workflows')
})

// ADR 0029 decision 7: a row records what the call actually ran. Integrate mode records each dispatch before
// it runs (as task mode does on st.ran), so an integrator or a judge that throws is still listed.
test('e5b: an integrator or a judge that throws is still in the row\'s ran and integration.agents', async () => {
  const r = await run(mkArgs(mkI()), { [ILABEL]: new Error('boom') })
  clean(r)
  setAside(r, 'e5b integrator')
  assert.deepEqual(r.labels, [ILABEL])
  assert.deepEqual(r.row.ran, [{ label: ILABEL, rung: 'opus-xhigh', model: 'opus', effort: 'xhigh' }])
  assert.deepEqual(r.row.integration.agents.map((g) => [g.role, g.label, g.rung, g.finishedAt]), [['integrator', ILABEL, 'opus-xhigh', '']])
  const j = await run(mkArgs(mkI({ trouble: ['conflict'] })), { [ILABEL]: ir({ state: 'merged', conflicts: ['a.js'] }), [JLABEL(2)]: new Error('boom') })
  clean(j)
  setAside(j, 'e5b judge')
  assert.deepEqual(j.labels, [ILABEL, JLABEL(2)])
  assert.deepEqual(j.row.ran.map((x) => [x.label, x.rung, x.effort]), [[ILABEL, 'opus-xhigh', 'xhigh'], [JLABEL(2), 'opus-xhigh', 'xhigh']])
  assert.deepEqual(j.row.integration.agents.map((g) => [g.role, g.label, g.finishedAt]), [
    ['integrator', ILABEL, '2026-10-01T10:20:00Z'], ['judge', JLABEL(2), ''],
  ], 'the judge that threw has no finishedAt; the integrator before it keeps its own')
  const p1 = { mergeCommit: M, headSha: M, baseSha: B1, verified: true }
  const jo = await run(mkArgs(mkI({ trouble: ['shared-file'], leadMerge: p1 })), { [JLABEL(2)]: new Error('boom') })
  clean(jo)
  setAside(jo, 'e5b judge-only')
  assert.equal(jo.row.integration.path, 'judge-only')
  assert.deepEqual(jo.row.ran.map((x) => x.label), [JLABEL(2)])
})

// ---- (f) re-entry --------------------------------------------------------------------------------------

test('f1: after the e1 set-aside, the same args re-enter at Integration and land integrated', async () => {
  const I = mkI({ trouble: ['conflict'] })
  const r = await run(mkArgs(I), { [ILABEL]: ir({ state: 'merged', conflicts: ['a.js'] }), [JLABEL(2)]: jv() })
  clean(r)
  assert.equal(r.row.status, 'review')
  assert.equal(r.row.integration.outcome, 'integrated')
})

test('f2: a judge death after the push, then a re-entry on the same anchor reaches the judge (branch-moved)', async () => {
  const I = mkI({ landed: LANDED })
  const first = await run(mkArgs(I), { [ILABEL]: ir({ state: 'merged', files: ['a.js'] }), [JLABEL(2)]: null })
  clean(first)
  setAside(first, 'f2')
  assert.equal(first.row.blockerDiagnosis, 'integration: ' + T.TRANSIENT_DIAGNOSIS)
  const again = await run(mkArgs(I), {
    [ILABEL]: ir({ state: 'already-merged', taskHead: M, merge: M, head: M, verified: true }), [JLABEL(2)]: jv(),
  })
  clean(again)
  assert.deepEqual(again.row.integration.triggers, ['branch-moved', 'shared-file'])
  assert.equal(again.row.status, 'review')
  assert.ok(promptOf(again, ILABEL).includes(`A="${H0}"; TB="${TB}"`), 'the same anchor')
})

test('f3: a refreshed anchor is never integrated; a lead merge passed as the anchor throws', async () => {
  const stop = `merge step STOP: anchor mismatch: recorded ${H0}, passed ${M} — pass the recorded anchor`
  const r = await run(mkArgs(mkI({ headSha: M })), { [ILABEL]: blockedIr(stop) })
  clean(r)
  assert.deepEqual(r.labels, [ILABEL])
  setAside(r, 'f3')
  assert.equal(r.row.blockerDiagnosis, 'integration: ' + stop)
  const p = promptOf(r, ILABEL)
  assert.ok(p.includes('anchor mismatch: recorded $X, passed $A') && p.includes('carries a merge — ANCHOR_RECIPE gives $R'))
  const thrown = await run(mkArgs(mkI({ trouble: ['shared-file'], leadMerge: { mergeCommit: H0, headSha: H0, baseSha: B1, verified: true } })))
  assert.match(String(thrown.error && thrown.error.message), /leadMerge\.mergeCommit is the passed anchor/)
  assert.equal(thrown.calls.length, 0)
})

test('f4: the second Integration after a seeded revise keeps the landed PRs and the anchor, and the judge confirms the rejection', async () => {
  const I = mkI({ landed: LANDED, reviewHistory: HIST2, reviewRoundsUsed: 3 })
  const r = await run(mkArgs(I), { [ILABEL]: ir({ state: 'already-merged', taskHead: RH, merge: M, head: RH, verified: true, files: ['a.js'] }), [JLABEL(4)]: jv() })
  clean(r)
  assert.deepEqual(r.labels, [ILABEL, JLABEL(4)])
  assert.ok(r.row.integration.triggers.includes('branch-moved') && r.row.integration.triggers.includes('shared-file'))
  const j = promptOf(r, JLABEL(4))
  assert.ok(j.includes('https://github.com/o/r/pull/5'))
  assert.ok(j.includes(`log -p --first-parent --no-merges ${H0}..${RH}`))
  assert.ok(j.includes('confirm each point is\nresolved; an open point is grounds for `changes`'))
  assert.ok(j.includes('Round 2 (Integration) rejection:\n- keep their rename'))
  assert.ok(promptOf(r, ILABEL).includes('https://github.com/o/r/pull/5 — theirs: rename'))
})

test('f5: an own-run diagnosis that looks like a marker is escaped as `own run: `', async () => {
  for (const diag of ['integration: the agent said so', T.REVISE_MARKER + ' (quoted)', 'INTEGRATION: shouting']) {
    const args = { rolloutSlug: 'r', repoPath: '/repo', verifier: 'make test', date: '2026-10-01', task: mkTask({ planGate: false }) }
    // a top-rung task: the block climbs as a recorded no-op and the same rung retries once, blocking again
    const blocked = { verified: false, blocked: true, escalate: false, prUrl: '', branch: '', worktreePath: WT, blockerDiagnosis: diag, summary: '' }
    const r = await run(args, { [`implement:${SLUG}`]: blocked, [`implement:${SLUG}@opus-xhigh`]: blocked })
    clean(r)
    assert.equal(r.row.status, 'blocked')
    assert.equal(r.row.blockerDiagnosis, 'own run: ' + diag)
    assert.equal(T.parseIntegrationMarker(r.row.blockerDiagnosis).stage, 'own')
  }
  const red = { verified: false, blocked: true, escalate: false, prUrl: '', branch: '', worktreePath: WT, blockerDiagnosis: 'red suite', summary: '' }
  const plain = await run({ rolloutSlug: 'r', repoPath: '/repo', verifier: 'make test', date: '2026-10-01', task: mkTask({ planGate: false }) }, {
    [`implement:${SLUG}`]: red, [`implement:${SLUG}@opus-xhigh`]: red,
  })
  assert.equal(plain.row.blockerDiagnosis, 'red suite', 'an ordinary diagnosis is untouched')
})

test('f6: the own run merged main — the approved head STOPs naming the recipe\'s anchor; the re-entry passes it', async () => {
  const HA = sha('7')
  const Bm = sha('8')
  const stop = `merge step STOP: anchor ${HA} carries a merge — ANCHOR_RECIPE gives ${P}`
  const first = await run(mkArgs(mkI({ headSha: HA, taskBase: Bm })), { [ILABEL]: blockedIr(stop) })
  clean(first)
  assert.deepEqual(first.labels, [ILABEL])
  setAside(first, 'f6')
  assert.ok(first.row.blockerDiagnosis.includes(P))
  assert.ok(promptOf(first, ILABEL).includes('carries a merge — ANCHOR_RECIPE gives $R'))
  const again = await run(mkArgs(mkI({ headSha: P, taskBase: TB })), {
    [ILABEL]: ir({ anchor: `${P} base ${TB}`, state: 'merged', taskHead: HA, merge: M, head: M, files: ['z.js'] }), [JLABEL(2)]: jv(),
  })
  clean(again)
  assert.ok(again.row.integration.triggers.includes('branch-moved'))
  assert.ok(promptOf(again, JLABEL(2)).includes(`log -p --first-parent --no-merges ${P}..${M}`))
  assert.equal(again.row.status, 'review')
})

test('f7: a stale anchor ref sets the task aside with the prefix repair routes on', async () => {
  const stop = `merge step STOP: stale anchor ref ${M} is not on ${BR} (branch recut or rewritten) — delete it: git update-ref -d refs/integration-anchor/${BR} ${M}`
  const r = await run(mkArgs(mkI()), { [ILABEL]: blockedIr(stop) })
  clean(r)
  setAside(r, 'f7')
  assert.ok(r.row.blockerDiagnosis.startsWith('integration: merge step STOP: stale anchor ref'))
})

test('f8: a cold history rebuild from an e5-style set-aside renders the confirm-resolved block', async () => {
  assert.ok(e5Diag, 'e5 ran')
  const parsed = T.parseIntegrationMarker(e5Diag)
  assert.equal(parsed.stage, 'integrate')
  const I = mkI({ landed: LANDED, reviewHistory: parsed.history, reviewRoundsUsed: 3 })
  const r = await run(mkArgs(I), { [ILABEL]: ir({ taskHead: RH, verified: true }), [JLABEL(4)]: jv() })
  clean(r)
  assert.ok(promptOf(r, JLABEL(4)).includes("The latest round is an earlier Integration re-review's rejection, since revised: confirm each point"))
})

// ---- (g) the judge's object check ------------------------------------------------------------------

test('g: the judge check is rendered on P1 and P2', async () => {
  const LM = sha('9')
  const p1 = await run(mkArgs(mkI({ trouble: ['shared-file'], leadMerge: { mergeCommit: LM, headSha: LM, baseSha: B1, verified: true } })), { [JLABEL(2)]: jv() })
  const p2 = await run(mkArgs(mkI()), { [ILABEL]: ir({ state: 'merged', conflicts: ['a.js'] }), [JLABEL(2)]: jv() })
  for (const [name, r, shas] of [['P1', p1, [LM, LM, H0, B1]], ['P2', p2, [M, M, H0, B1]]]) {
    const j = promptOf(r, JLABEL(2))
    for (const s of [
      `for s in ${shas.join(' ')}; do git -C "$WT" cat-file -e "$s^{commit}"`, 'fetch origin "$BR" --quiet',
      'check_fail "stale anchor ref $X is not on $BR', 'check_fail "anchor mismatch: recorded $X, passed $A"',
      `rev-list --first-parent --merges "$TB..$A")" ]; then check_fail "anchor $A carries a merge"`,
      'check_fail "cannot read the integration commits:$miss"', 'unreadable=true', '"cannot read the integration: <why>"',
      'Never approve what you could not read',
    ]) assert.ok(j.includes(s), `${name}: ${s}`)
    assert.ok(!j.includes('update-ref'), `${name}: the judge never writes the ref`)
  }
})

// ---- metrics -----------------------------------------------------------------------------------------

test('metrics: wait and duration in whole minutes, from the stamps passed in and the agents\' finishedAt', async () => {
  const both = await run(mkArgs(mkI({ readyAt: '2026-10-01T09:15:00Z' })), {
    [ILABEL]: ir({ state: 'merged', conflicts: ['a.js'], finishedAt: '2026-10-01T10:20:30Z' }), [JLABEL(2)]: jv('approve', [], { finishedAt: '2026-10-01T10:31:59Z' }),
  })
  assert.deepEqual(both.row.integration.metrics, {
    readyAt: '2026-10-01T09:15:00Z', startedAt: START, finishedAt: '2026-10-01T10:31:59Z', waitMinutes: 45, durationMinutes: 31,
  })
  assert.deepEqual(both.row.integration.agents.map((g) => [g.role, g.label, g.finishedAt]), [
    ['integrator', ILABEL, '2026-10-01T10:20:30Z'], ['judge', JLABEL(2), '2026-10-01T10:31:59Z'],
  ])
  const offset = await run(mkArgs(mkI({ startedAt: '2026-10-01T20:00+10:00', readyAt: '2026-10-02T14:05+10:00' })), { [ILABEL]: ir({ finishedAt: '2026-10-01T10:45:00Z' }) })
  assert.equal(offset.row.integration.metrics.durationMinutes, 45, '+10:00 against Z')
  assert.equal(offset.row.integration.metrics.waitMinutes, null, 'a ready stamp after the start is negative → null')
  const p8 = await run(mkArgs(mkI({ readyAt: '2026-10-02T14:05+10:00', startedAt: '2026-10-02T04:35:00Z' })), { [ILABEL]: ir({ finishedAt: '2026-10-02T04:36:00Z' }) })
  assert.equal(p8.row.integration.metrics.waitMinutes, 30, "p12-8's offset-minute stamp")
  assert.equal(p8.row.integration.metrics.durationMinutes, 1)
  for (const bad of ['yesterday', '2026-10-01T10:00', '2026-13-01T10:00Z', '2026-02-30T10:00Z', '2026-10-01 10:00Z']) {
    const r = await run(mkArgs(mkI({ startedAt: bad, readyAt: bad })), { [ILABEL]: ir() })
    assert.equal(r.row.integration.metrics.waitMinutes, null, bad)
    assert.equal(r.row.integration.metrics.durationMinutes, null, bad)
  }
  const none = await run(mkArgs(mkI({ startedAt: undefined })), { [ILABEL]: ir() })
  assert.deepEqual([none.row.integration.metrics.startedAt, none.row.integration.metrics.durationMinutes], [null, null])
  const neg = await run(mkArgs(mkI()), { [ILABEL]: ir({ finishedAt: '2026-10-01T09:00:00Z' }) })
  assert.equal(neg.row.integration.metrics.durationMinutes, null, 'finished before it started → null')
  assert.equal(T.isoMinutes('1970-01-01T00:01Z'), 1)
  assert.equal(T.isoMinutes('2024-02-29T00:00:00.123+00:00'), T.isoMinutes('2024-02-28T00:00Z') + 1440)
})

// ---- arg validation ------------------------------------------------------------------------------------

test('arg validation: every bad field throws before any dispatch', async () => {
  const LM = sha('9')
  const bad = [
    ['prUrl', mkI({ prUrl: 'github.com/o/r/7' })], ['branch', mkI({ branch: 'audit-fix/other' })],
    ['worktreePath', mkI({ worktreePath: '/elsewhere' })], ['headSha', mkI({ headSha: 'abc' })],
    ['taskBase', mkI({ taskBase: TB.toUpperCase() })], ['mainSha', mkI({ mainSha: undefined })],
    ['trouble', mkI({ trouble: ['merge'] })], ['trouble', mkI({ trouble: ['red', 'red'] })], ['trouble', mkI({ trouble: 'red' })],
    ['landed', mkI({ landed: [{ prUrl: 'x', title: 't', files: [], taskPath: '' }] })], ['landed', mkI({ landed: [{ ...LANDED[0], files: 'a.js' }] })],
    ['plan', mkI({ plan: null })],
    ['reviewHistory', mkI({ reviewHistory: [{ round: 2, feedback: ['x'] }, { round: 1, feedback: ['y'] }], reviewRoundsUsed: 2 })],
    ['reviewHistory', mkI({ reviewHistory: [{ round: 1, feedback: [3] }] })], ['reviewHistory', mkI({ reviewHistory: [{ round: 1, feedback: 'x' }] })],
    ['reviewHistory', mkI({ reviewHistory: [{ round: 1, feedback: ['x'], stage: 'run' }] })],
    ['reviewRoundsUsed', mkI({ reviewRoundsUsed: 0 })], ['reviewRoundsUsed', mkI({ reviewHistory: HIST2, reviewRoundsUsed: 1 })],
    ['rung', mkI({ rung: undefined })], ['rung', mkI({ rung: { model: 'haiku', escalated: false, escalatedAt: '', tierCapped: false, tierCappedAt: '' } })],
    ['rung', mkI({ rung: 'opus-xhigh' })], ['rung', mkI({ rung: { ...RUNG, rung: 'Opus-XHigh' } })],
    ['rung', mkI({ rung: { ...RUNG, climbs: [{ stage: 'integration', from: 'opus-high', to: 'opus-xhigh' }] } })],
    ['rung', mkI({ rung: { startRung: '', rung: '' } })],
    ['leadMerge', mkI({ leadMerge: { mergeCommit: 'x', headSha: LM, baseSha: B1, verified: true } })],
    ['leadMerge', mkI({ leadMerge: { mergeCommit: H0, headSha: H0, baseSha: B1, verified: true } })],
    ['readyAt', mkI({ readyAt: 5 })],
  ]
  for (const [name, I] of bad) {
    const r = await run(mkArgs(I))
    assert.match(String(r.error && r.error.message), new RegExp(`^args\\.integration: .*${name}`), name)
    assert.equal(r.calls.length, 0, name)
  }
  const shapes = [
    [mkArgs(mkI(), { repoPath: '' }), /repoPath/], [mkArgs(mkI(), {}, { scope: 'read-only' }), /read-only/],
    [mkArgs(mkI(), {}, { maxIterations: 0 }), /maxIterations/], [mkArgs(mkI(), {}, { maxReviewRounds: 0 }), /max_review_rounds = 0/],
    [mkArgs(mkI(), { mode: 'merge' }), /^args\.mode: refusing "merge"/], [mkArgs(undefined), /args\.integration: must be one object/],
    [{ ...mkArgs(mkI()), mode: undefined }, /only with args\.mode 'integrate'/],
    [mkArgs(mkI(), {}, { resume: { stage: 'revise' } }), /never mode 'integrate'/],
  ]
  for (const [args, re] of shapes) {
    const r = await run(args)
    assert.match(String(r.error && r.error.message), re)
    assert.equal(r.calls.length, 0)
  }
  const emptyHistory = await run(mkArgs(mkI({ reviewHistory: [] })), { [ILABEL]: ir() })
  assert.equal(emptyHistory.error, undefined, 'an empty history is allowed')
})

// ---- the rung -------------------------------------------------------------------------------------

test('rung: Integration runs on the top rung whatever rung the task reached; the task\'s own rung: and effort: do not apply', async () => {
  const res = { [ILABEL]: ir({ state: 'merged', conflicts: ['a.js'] }), [JLABEL(2)]: jv() }
  const L3 = { source: '/home/x/.config/thread/ladder.toml', rungs: [
    { name: 'r-low', model: 'opus', effort: 'low', judge: 'medium', review: 'high' },
    { name: 'r-top', model: 'fable', effort: 'high', judge: 'xhigh', review: 'max' },
  ] }
  const bottom = { startRung: 'r-low', rung: 'r-low', climbs: [] }
  const builtIn = await run(mkArgs(mkI(), {}, { rung: 'opus-high', effort: 'low' }), res)
  const file = await run(mkArgs(mkI({ rung: bottom }), { ladder: L3 }, { rung: 'r-low', effort: 'low' }), res)
  assert.deepEqual(builtIn.opts.map((o) => [o.model, o.effort, o.phase]), [['opus', 'xhigh', 'Integration'], ['opus', 'xhigh', 'Integration']])
  assert.deepEqual(file.opts.map((o) => [o.label, o.model, o.effort]), [[ILABEL, 'fable', 'high'], [JLABEL(2), 'fable', 'max']], "the integrator at the top rung's effort, the judge at its review effort")
  assert.deepEqual(builtIn.row.integration.agents.map((g) => [g.rung, g.effort]), [['opus-xhigh', 'xhigh'], ['opus-xhigh', 'xhigh']])
  assert.deepEqual(file.row.integration.agents.map((g) => [g.rung, g.model]), [['r-top', 'fable'], ['r-top', 'fable']])
  assert.deepEqual([builtIn.row.startRung, builtIn.row.rung, builtIn.row.climbs, builtIn.row.rungDrift], [RUNG.startRung, RUNG.rung, RUNG.climbs, ''], "the task's record passes through")
  assert.deepEqual([file.row.startRung, file.row.rung, file.row.climbs], ['r-low', 'r-low', []], 'never the top rung: the task\'s own')
  assert.deepEqual(file.row.ran.map((x) => [x.label, x.rung, x.model, x.effort]), [[ILABEL, 'r-top', 'fable', 'high'], [JLABEL(2), 'r-top', 'fable', 'max']])
})

// ---- seeded revise (task.resume) -----------------------------------------------------------------

const mkResume = (over = {}) => ({ stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, reviewHistory: HIST2, reviewRoundsUsed: 2, plan: 'THE APPROVED PLAN', ...over })
const resumeArgs = (resume, taskOver = {}, over = {}) => ({ rolloutSlug: 'r', repoPath: '/repo', verifier: 'make test', date: '2026-10-01', task: mkTask({ resume, ...taskOver }), ...over })
const implOk = { verified: true, blocked: false, escalate: false, prUrl: PR, branch: BR, worktreePath: WT, blockerDiagnosis: '', summary: 'revised' }

test('S1: a seeded revise dispatches revise r3 then review r3 and approves with 3 rounds used', async () => {
  const r = await run(resumeArgs(mkResume()), { [`revise:${SLUG} r3`]: implOk, [`review:${SLUG} r3`]: { verdict: 'approve', feedback: [] } })
  clean(r)
  assert.deepEqual(r.labels, [`revise:${SLUG} r3`, `review:${SLUG} r3`])
  assert.equal(r.row.status, 'review')
  assert.equal(r.row.reviewRoundsUsed, 3)
  assert.equal(r.row.prUrl, PR)
  assert.deepEqual(r.row.reviewHistory, HIST2)
  assert.equal(r.row.approvedAtCeiling, true)
  assert.deepEqual(Object.keys(r.row).sort(), [...ROW_KEYS].sort())
  assert.equal(r.row.plan, null, 'a seeded revise never settles the plan (p14-2)')
  assert.ok(promptOf(r, `review:${SLUG} r3`).includes('Round 2 rejection:\n- keep their rename'))
})

test('S2: the seeded prompt re-enters the tree; the unseeded prompt is byte-unchanged', async () => {
  const r = await run(resumeArgs(mkResume()), { [`revise:${SLUG} r3`]: implOk, [`review:${SLUG} r3`]: { verdict: 'approve', feedback: [] } })
  const seeded = promptOf(r, `revise:${SLUG} r3`)
  const a = resumeArgs(mkResume())
  const lines = [
    `[ -d "$WT" ] || { git -C "/repo" worktree unlock "$WT" 2>/dev/null; git -C "/repo" worktree prune; }`,
    `elif git -C "/repo" show-ref --verify --quiet "refs/heads/$BR"; then git -C "/repo" worktree add "$WT" "$BR" && cd "$WT";`,
    'worktree add --track -b "$BR" "$WT" "origin/$BR"', 'worktree lock --reason "pid $PPID thread:execute task tree"',
    'tree NOT attached: neither $BR nor origin/$BR exists — STOP', 'tree NOT on $BR: checkout failed — STOP',
    'Do not write the task note in this call — this overrides the verification loop\'s last step',
    "The latest round below is the Integration re-review's", 'never merge\norigin/main yourself — the lead re-integrates',
    'COLD ENTRY', '(round 2)',
    // the fast-forward to origin/$BR, STOPping on a divergence, and the no-force rule
    'if ! git -C "$WT" fetch origin --quiet; then echo "tree NOT fast-forwarded: fetch origin failed — STOP"',
    'elif ! git -C "$WT" merge-base --is-ancestor HEAD "origin/$BR" && ! git -C "$WT" merge-base --is-ancestor "origin/$BR" HEAD; then echo "tree NOT fast-forwarded: $BR has diverged from origin/$BR — never rebase or force-push; STOP"',
    'elif ! git -C "$WT" merge --ff-only --no-autostash --quiet "origin/$BR"; then',
    ', fast-forwards it to origin/audit-fix/fix-a (never past a divergence)',
    '\npush plainly; never rebase or force-push; a rejected push returns blocked.\n',
  ]
  for (const s of lines) assert.ok(seeded.includes(s), `seeded: ${s}`)
  const prev = { prUrl: PR, branch: BR, worktreePath: WT }
  const unseeded = T.reviserPrompt(a.task, prev, HIST2, 3, a, 'THE APPROVED PLAN')
  for (const s of lines) assert.ok(!unseeded.includes(s), `unseeded: no ${s}`)
  assert.equal(T.reviserPrompt(a.task, prev, HIST2, 3, a, 'THE APPROVED PLAN', null), unseeded)
  const block = T.coldEntryBlock(a, a.task, HIST2)
  assert.ok(block.startsWith('\n\nCOLD ENTRY'))
  assert.equal(seeded.replace(block, ''), unseeded)
})

test('S3: no review round left → review-blocked with the full history and zero dispatches', async () => {
  const hist = [...HIST2, { round: 3, feedback: ['their api'], stage: 'integration' }]
  const r = await run(resumeArgs(mkResume({ reviewHistory: hist, reviewRoundsUsed: 3 })))
  clean(r)
  assert.equal(r.calls.length, 0)
  assert.equal(r.row.status, 'review-blocked')
  assert.deepEqual(r.row.reviewHistory, hist)
  assert.deepEqual(r.row.reviewFeedback, ['their api'])
  assert.equal(r.row.reviewRoundsUsed, 3)
})

test('S4: changes at the ceiling → review-blocked including the seeded rounds', async () => {
  const r = await run(resumeArgs(mkResume()), { [`revise:${SLUG} r3`]: implOk, [`review:${SLUG} r3`]: { verdict: 'changes', feedback: ['still drops theirs'] } })
  clean(r)
  assert.equal(r.row.status, 'review-blocked')
  assert.deepEqual(r.row.reviewHistory, [...HIST2, { round: 3, feedback: ['still drops theirs'] }])
})

test('S5: bad resume args throw before any dispatch', async () => {
  const bad = [
    [mkResume({ stage: 'implement' }), /stage must be 'revise'/], [mkResume({ branch: 'audit-fix/x' }), /branch must be/],
    [mkResume({ worktreePath: '/x' }), /worktreePath must be/], [mkResume({ prUrl: 'nope' }), /prUrl/],
    [mkResume({ reviewHistory: [], reviewRoundsUsed: 0 }), /must be non-empty/],
    [mkResume({ reviewHistory: [{ round: 2, feedback: ['a'] }, { round: 2, feedback: ['b'] }] }), /strictly ascending/],
    [mkResume({ reviewRoundsUsed: 3 }), /must equal the history's last round/], [mkResume({ plan: undefined }), /plan must be a string/],
    ['not an object', /must be one object/],
  ]
  for (const [resume, re] of bad) {
    const r = await run(resumeArgs(resume))
    assert.match(String(r.error && r.error.message), /^args\.task\.resume: /)
    assert.match(String(r.error && r.error.message), re)
    assert.equal(r.calls.length, 0)
  }
  const ro = await run(resumeArgs(mkResume(), { scope: 'read-only' }))
  assert.match(String(ro.error && ro.error.message), /read-only/)
})

test('S6: a seeded call that stops resumes at revise — the marker first, a revise stopped: line, the history; a gate is gate-pending', async () => {
  const dead = await run(resumeArgs(mkResume()), { [`revise:${SLUG} r3`]: null })
  clean(dead)
  assert.equal(dead.row.status, 'blocked')
  const d = dead.row.blockerDiagnosis
  assert.equal(d.split('\n')[0], T.REVISE_MARKER)
  assert.equal(d.split('\n')[1], 'revise stopped: ' + T.TRANSIENT_DIAGNOSIS)
  const parsed = T.parseIntegrationMarker(d)
  assert.equal(parsed.stage, 'revise')
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.history)), HIST2)
  assert.equal(dead.row.reviewRoundsUsed, 2)
  s6Diag = d
  const deadJudge = await run(resumeArgs(mkResume()), { [`revise:${SLUG} r3`]: implOk, [`review:${SLUG} r3`]: null })
  assert.equal(deadJudge.row.blockerDiagnosis.split('\n')[0], T.REVISE_MARKER)
  const threw = await run(resumeArgs(mkResume()), { [`revise:${SLUG} r3`]: new Error('boom') })
  assert.equal(threw.row.blockerDiagnosis.split('\n').slice(0, 2).join('\n'), T.REVISE_MARKER + '\nrevise stopped: workflow stage threw — see /workflows')
  assert.deepEqual(JSON.parse(JSON.stringify(T.parseIntegrationMarker(threw.row.blockerDiagnosis).history)), HIST2)
  assert.equal(threw.row.prUrl, PR)
  const blocked = await run(resumeArgs(mkResume()), { [`revise:${SLUG} r3`]: { ...implOk, verified: false, blocked: true, blockerDiagnosis: 'red after 3\niterations' } })
  assert.equal(blocked.row.blockerDiagnosis.split('\n')[1], 'revise stopped: red after 3 iterations')
  const later = await run(resumeArgs(mkResume({}), { maxReviewRounds: 5 }), {
    [`revise:${SLUG} r3`]: implOk, [`review:${SLUG} r3`]: { verdict: 'changes', feedback: ['r3 point'] }, [`revise:${SLUG} r4`]: null,
  })
  assert.deepEqual(JSON.parse(JSON.stringify(T.parseIntegrationMarker(later.row.blockerDiagnosis).history)), [...HIST2, { round: 3, feedback: ['r3 point'] }])
  assert.equal(later.row.reviewRoundsUsed, 3)
  assert.ok(promptOf(later, `revise:${SLUG} r4`).includes('COLD ENTRY'), 'every revise in a seeded call keeps the cold entry')
  const gate = 'credential: the deploy key'
  const gated = await run(resumeArgs(mkResume()), { [`revise:${SLUG} r3`]: { ...implOk, verified: false, blocked: true, blockerDiagnosis: 'needs a key', gatedInputs: [gate] } })
  assert.equal(gated.row.status, 'gate-pending')
  assert.deepEqual(gated.row.gatedInputs, [gate])
})

test('S7: a seeded revise climbs its review stage from the stamped rung, per call; on the top rung a recorded no-op', async () => {
  const script = { [`revise:${SLUG} r3`]: implOk, [`review:${SLUG} r3`]: { verdict: 'approve', feedback: [] } }
  const up = await run(resumeArgs(mkResume(), { rung: 'opus-high' }), script)
  clean(up)
  assert.deepEqual([up.row.startRung, up.row.rung, up.row.climbs], ['opus-high', 'opus-xhigh', [{ stage: 'review', from: 'opus-high', to: 'opus-xhigh' }]])
  assert.deepEqual(up.opts.map((o) => [o.label, o.model, o.effort]), [[`revise:${SLUG} r3`, 'opus', 'xhigh'], [`review:${SLUG} r3`, 'opus', 'xhigh']], 'the revise and its judge on the reached rung')
  const top = await run(resumeArgs(mkResume(), { rung: 'opus-xhigh' }), script)
  clean(top)
  assert.deepEqual([top.row.startRung, top.row.rung, top.row.climbs], ['opus-xhigh', 'opus-xhigh', [{ stage: 'review', from: 'opus-xhigh', to: 'opus-xhigh' }]])
  assert.deepEqual(top.row.ran.map((x) => x.label), [`revise:${SLUG} r3`, `review:${SLUG} r3`])
})

// ---- empty-feedback rounds (a `changes` verdict with [] is valid; the live row passes verbatim) ---------

test('h1: a live own-run history with an empty round passes verbatim into args.integration and is dropped', async () => {
  // the engine's own run: review r1 says changes with [], the revise lands, review r2 approves
  const own = await run({ rolloutSlug: 'r', repoPath: '/repo', verifier: 'make test', date: '2026-10-01', task: mkTask({ planGate: false }) }, {
    [`implement:${SLUG}`]: { verified: true, blocked: false, escalate: false, prUrl: PR, branch: BR, worktreePath: WT, blockerDiagnosis: '', summary: '' },
    [`review:${SLUG} r1`]: { verdict: 'changes', feedback: [] },
    [`revise:${SLUG} r2`]: { verified: true, blocked: false, escalate: false, prUrl: PR, branch: BR, worktreePath: WT, blockerDiagnosis: '', summary: '' },
    [`review:${SLUG} r2`]: { verdict: 'approve', feedback: [] },
  })
  clean(own)
  assert.deepEqual(own.row.reviewHistory, [{ round: 1, feedback: [] }], 'the engine records the empty round')
  const I = mkI({ reviewHistory: own.row.reviewHistory, reviewRoundsUsed: own.row.reviewRoundsUsed, landed: LANDED })
  const ok = await run(mkArgs(I), { [ILABEL]: ir({ state: 'merged', files: ['a.js'] }), [JLABEL(3)]: jv() })
  clean(ok)
  assert.equal(ok.row.status, 'review')
  assert.deepEqual(ok.row.reviewHistory, [], 'the empty round is dropped')
  assert.ok(!promptOf(ok, ILABEL).includes('Round 1 rejection'), 'no empty round in the integrator prompt')
  const rej = await run(mkArgs(I, {}, { maxReviewRounds: 4 }), { [ILABEL]: ir({ state: 'merged', files: ['a.js'] }), [JLABEL(3)]: jv('changes', ['keep theirs']) })
  clean(rej)
  assert.equal(rej.row.status, 'blocked')
  assert.deepEqual(rej.row.reviewHistory, [{ round: 3, feedback: ['keep theirs'], stage: 'integration' }])
  assert.deepEqual(JSON.parse(JSON.stringify(T.parseIntegrationMarker(rej.row.blockerDiagnosis).history)), rej.row.reviewHistory)
  for (const [h, n] of [[[{ round: 1, feedback: ['  ', ''] }], 0], [[{ round: 1, feedback: ['x', ' '] }], 1]]) {
    const r = await run(mkArgs(mkI({ reviewHistory: h, reviewRoundsUsed: 1 })), { [ILABEL]: ir() })
    clean(r)
    assert.equal(r.row.reviewHistory.length, n, JSON.stringify(h))
  }
})

test('h2: a seeded revise whose live history ends in an empty round passes and revises the latest real round', async () => {
  const hist = [...HIST2, { round: 3, feedback: [] }]
  const resume = { stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, reviewHistory: hist, reviewRoundsUsed: 3, plan: 'P' }
  const args = { rolloutSlug: 'r', repoPath: '/repo', verifier: 'make test', date: '2026-10-01', task: mkTask({ resume, maxReviewRounds: 5 }) }
  assert.equal(T.resumeArgsError(args), '')
  const r = await run(args, {
    [`revise:${SLUG} r4`]: { verified: true, blocked: false, escalate: false, prUrl: PR, branch: BR, worktreePath: WT, blockerDiagnosis: '', summary: '' },
    [`review:${SLUG} r4`]: { verdict: 'approve', feedback: [] },
  })
  clean(r)
  assert.deepEqual(r.labels, [`revise:${SLUG} r4`, `review:${SLUG} r4`])
  assert.ok(promptOf(r, `revise:${SLUG} r4`).includes('Review feedback — ROUND 2 (your work order'))
  assert.deepEqual(r.row.reviewHistory, HIST2)
  const dead = await run(args, { [`revise:${SLUG} r4`]: null })
  assert.equal(dead.row.reviewRoundsUsed, 3, 'a stop keeps the seed\'s rounds used')
  assert.equal(dead.row.blockerDiagnosis.split('\n')[0], T.REVISE_MARKER)
  // an in-call judge's `changes` with [] is recorded on the row but never written as a bare marker header
  const implOk4 = { verified: true, blocked: false, escalate: false, prUrl: PR, branch: BR, worktreePath: WT, blockerDiagnosis: '', summary: '' }
  const later = await run(args, { [`revise:${SLUG} r4`]: implOk4, [`review:${SLUG} r4`]: { verdict: 'changes', feedback: [] }, [`revise:${SLUG} r5`]: null })
  clean(later)
  assert.equal(later.row.reviewRoundsUsed, 4)
  assert.ok(!/^Round 4/m.test(later.row.blockerDiagnosis), later.row.blockerDiagnosis)
  assert.deepEqual(JSON.parse(JSON.stringify(T.parseIntegrationMarker(later.row.blockerDiagnosis).history)), HIST2)
  const empty = await run({ ...args, task: mkTask({ resume: { ...resume, reviewHistory: [{ round: 1, feedback: [] }], reviewRoundsUsed: 1 } }) })
  assert.match(String(empty.error && empty.error.message), /^args\.task\.resume: reviewHistory must carry at least one round with feedback/)
  assert.equal(empty.calls.length, 0)
})

test('h3: a review-blocked run (`Round N:` from its first line) parses whole, for the seeded resume after the ceiling', () => {
  const run = 'Round 1:\n- own fix\n\nRound 2:\n- keep their rename\n- restore b.js'
  const p = T.parseIntegrationMarker(run)
  assert.equal(p.stage, 'own')
  assert.deepEqual(JSON.parse(JSON.stringify(p.history)), [{ round: 1, feedback: ['own fix'] }, { round: 2, feedback: ['keep their rename', 'restore b.js'] }])
  const resume = { stage: 'revise', prUrl: PR, branch: BR, worktreePath: WT, reviewHistory: p.history, reviewRoundsUsed: 2, plan: '' }
  assert.equal(T.resumeArgsError({ rolloutSlug: 'r', repoPath: '/repo', task: mkTask({ resume }) }), '')
})

// ---- static ----------------------------------------------------------------------------------------

test('static: no force, no PR merge, approvedGates-independent prompts, the row shape and the marker literals', async () => {
  const src = fs.readFileSync(enginePath, 'utf8')
  const FORCE = /--force|force-with-lease|push +-f\b|\+refs\/|\+HEAD/
  assert.ok(!FORCE.test(src), 'engine source: no force flag')
  const LM = sha('9')
  const L3 = { source: '/home/x/.config/thread/ladder.toml', rungs: [{ name: 'solo', model: 'fable', effort: 'high', judge: 'high', review: 'max' }] }
  for (const over of [{}, { ladder: L3 }, { defaultBranch: 'master', envBootstrap: 'poetry install', knownBaselineFailures: ['t — env'] }]) {
    const I = mkI({ landed: LANDED, reviewHistory: HIST2, reviewRoundsUsed: 2, trouble: ['conflict', 'red'] })
    const a = mkArgs(I, over)
    const j = { mergeCommit: M, headSha: F1, baseSha: B1, triggers: ['conflict'], path: 'integrator' }
    const renders = [
      T.integratorPrompt(a.task, a, I), T.integrationReviewPrompt(a.task, a, I, j), T.branchTreeSetup(a, a.task, true),
      T.integrationMergeStep(a, a.task, I), T.integrationJudgeCheck(a, a.task, I, j), T.ANCHOR_RECIPE,
      T.integrationReviewPrompt(a.task, a, I, { ...j, mergeCommit: LM, headSha: LM, path: 'judge-only' }),
      T.reviserPrompt(a.task, { prUrl: PR, branch: BR, worktreePath: WT }, HIST2, 3, a, 'P', { history: HIST2, roundsUsed: 2 }),
    ]
    for (const p of renders) {
      assert.ok(!FORCE.test(p), 'render: no force flag')
      for (const s of ['gh pr merge', '--admin', '--auto', 'update-branch']) assert.ok(!p.includes(s), `render: no ${s}`)
    }
    const gated = mkArgs(I, over, { approvedGates: ['spend: x — cap $1'] })
    assert.equal(T.integratorPrompt(gated.task, gated, I), T.integratorPrompt(a.task, a, I))
    assert.equal(T.integrationReviewPrompt(gated.task, gated, I, j), T.integrationReviewPrompt(a.task, a, I, j))
  }
  for (const r of allRuns.filter((x) => x.row && x.row.integration)) {
    assert.deepEqual(Object.keys(r.row).sort(), [...ROW_KEYS, 'integration'].sort())
    assert.ok(STATUSES.includes(r.row.status), r.row.status)
    assert.equal(r.row.plan, null, 'an integrate row never settles the plan (p14-2)')
  }
  const code = src.replace(/\/\/[^\n]*/g, '')
  assert.deepEqual(code.match(/['"`]revise: [^'"`]*/g), ["'revise: rejected at Integration re-review — revise on the branch, then re-integrate"])
  assert.deepEqual(code.match(/['"`]integration: [^'"`]*/g), ["'integration: "])
  assert.equal(T.REVISE_MARKER, 'revise: rejected at Integration re-review — revise on the branch, then re-integrate')
  assert.equal(T.INTEGRATION_PREFIX, 'integration: ')
})

// ---- properties over every fixture above (keep these last) ---------------------------------------

test('a5: every integrated row followed at least one agent call', () => {
  const integrated = allRuns.filter((r) => r.row && r.row.integration && r.row.integration.outcome === 'integrated')
  assert.ok(integrated.length >= 10, `${integrated.length} integrated fixtures`)
  for (const r of integrated) assert.ok(r.calls.length >= 1)
})

test('d5: no non-Integration marker starts `integration:`; every Integration set-aside does', () => {
  // mirrors p12-8's `.lower().startswith('integration:')` on the latest run's text
  const reads = (d) => d.trim().toLowerCase().startsWith('integration:')
  assert.ok(d1Diag && s6Diag)
  assert.ok(!reads(d1Diag), 'd1: the revise marker')
  assert.ok(!reads(s6Diag), 'S6: the seeded stop')
  assert.ok(d1Diag.startsWith('revise: ') && s6Diag.startsWith('revise: '))
  const names = setAsideDiags.map(([n]) => n.split(' ')[0])
  for (const want of ['e1', 'e2', 'e3', 'e4', 'e5', 'f2', 'f3', 'f6', 'f7']) assert.ok(names.includes(want), `${want} recorded`)
  for (const [name, d] of setAsideDiags) assert.ok(reads(d), `${name}: ${d}`)
})
