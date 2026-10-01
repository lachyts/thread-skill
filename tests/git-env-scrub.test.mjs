// p12-3: the engine-level GIT_* scrub. On 2026-09-23 an agent ran a test under an exported GIT_DIR that
// pointed at its worktree's gitdir; through commondir that is the shared repository, so the fixture's
// commits, `core.bare=true` and `git push origin` all landed on the real repo and its GitHub remote.
//
// Pinned here:
// - every engine-rendered command that runs git or the verifier starts with GIT_ENV_SCRUB (the land.sh form);
// - every agent prompt carries GIT_ENV_RULE exactly once, ahead of any verifier command it renders;
// - the edit-noop-repro diagnostic scrubs every git command its probe runs.
// tests/git-env-scrub.test.sh executes the rendered verifier and the lead's § 4 check under a real GIT_DIR.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { loadEngine, enginePath } from './lib/engine.mjs'

const T = loadEngine([
  'GIT_ENV_SCRUB', 'GIT_ENV_RULE', 'scrubbed', 'worktreeSetup', 'ralphLoop', 'oneShotVerify',
  'implementerPrompt', 'approvedPlanImplementerPrompt', 'reviserPrompt', 'readOnlyPrompt', 'plannerPrompt',
  'planReviserPrompt', 'planJudgePrompt', 'reviewJudgePrompt', 'integratorPrompt', 'integrationReviewPrompt',
  'branchTreeSetup', 'integrationMergeStep', 'integrationJudgeCheck', 'integrationMergeReads', 'ANCHOR_RECIPE',
])
const SCRUB = 'unset $(git rev-parse --local-env-vars 2>/dev/null);'

const ST_OPUS = { tier: 'opus', cap: 'fable', escalated: false, capSuppressed: false }
const ST_FABLE = { tier: 'fable', cap: 'fable', escalated: true, capSuppressed: false }
const ST_CAPPED = { tier: 'opus', cap: 'opus', escalated: false, capSuppressed: true }
const task = { slug: 'proj-fix-x', taskPath: '/vault/proj-fix-x.md', maxIterations: 3, scope: 'cross-cutting' }
const impl = { prUrl: 'https://github.com/o/r/pull/1', worktreePath: '/repo/.claude/worktrees/proj-fix-x', branch: 'audit-fix/fix-x' }
const feedback = [{ round: 1, feedback: ['fix it'] }]
// p12-6: the Integration call's inputs (a cross-cutting task with an open PR on audit-fix/fix-x).
const H = (c) => c.repeat(40)
const I = {
  prUrl: impl.prUrl, branch: impl.branch, worktreePath: impl.worktreePath, headSha: H('a'), taskBase: H('b'), mainSha: H('c'),
  trouble: ['conflict'], landed: [{ prUrl: 'https://github.com/o/r/pull/2', title: 't', files: ['a.js'], taskPath: '/vault/t.md' }],
  plan: 'PLAN', reviewHistory: [{ round: 1, feedback: ['fix it'] }, { round: 2, feedback: ['keep theirs'], stage: 'integration' }],
  reviewRoundsUsed: 2, rung: { model: 'fable', escalated: false, escalatedAt: '', tierCapped: false, tierCappedAt: '' },
}
const J = { mergeCommit: H('d'), headSha: H('e'), baseSha: H('c'), triggers: ['conflict'], path: 'integrator' }

// Every builder, keyed by name, each as a list of rendered prompts (the implementers at every tier).
function builders(a) {
  const tiers = [ST_OPUS, ST_FABLE, ST_CAPPED]
  return {
    implementerPrompt: tiers.map((st) => T.implementerPrompt(task, a, st, '')),
    approvedPlanImplementerPrompt: tiers.map((st) => T.approvedPlanImplementerPrompt(task, 'PLAN', a, st, '')),
    reviserPrompt: [T.reviserPrompt(task, impl, feedback, 2, a, ''), T.reviserPrompt(task, impl, I.reviewHistory, 3, a, '', { history: I.reviewHistory, roundsUsed: 2 })],
    readOnlyPrompt: [T.readOnlyPrompt(task, a, ST_OPUS, '')],
    plannerPrompt: [T.plannerPrompt(task, a, ST_OPUS, '')],
    planReviserPrompt: [T.planReviserPrompt(task, 'PLAN', feedback, 2, a)],
    planJudgePrompt: [T.planJudgePrompt(task, 'PLAN', a)],
    reviewJudgePrompt: [T.reviewJudgePrompt(task, impl, a, [])],
    integratorPrompt: [T.integratorPrompt(task, a, I), T.integratorPrompt(task, a, { ...I, landed: [], reviewHistory: [], trouble: [] })],
    integrationReviewPrompt: [T.integrationReviewPrompt(task, a, I, J), T.integrationReviewPrompt(task, a, { ...I, landed: [] }, { ...J, mergeCommit: '', path: 'judge-only' })],
  }
}
const VERIFYING = ['implementerPrompt', 'approvedPlanImplementerPrompt', 'reviserPrompt', 'readOnlyPrompt', 'plannerPrompt', 'integratorPrompt']
const count = (s, sub) => s.split(sub).length - 1

test('(a) GIT_ENV_SCRUB is the land.sh form, exactly', () => {
  assert.equal(T.GIT_ENV_SCRUB, SCRUB)
})

test('(b) the worktree setup block starts with the scrub, in every variant', () => {
  for (const a of [{ repoPath: '/repo' }, { repoPath: '/repo', envBootstrap: 'poetry install' }, { repoPath: '/repo', defaultBranch: 'master' }]) {
    const lines = T.worktreeSetup(a, { slug: 'proj-fix-x' }).split('\n')
    assert.match(lines[0], /Run exactly, as ONE Bash command/)
    assert.ok(lines[1].startsWith(`  ${SCRUB} WT="`), lines[1])
    assert.ok(T.worktreeSetup(a, { slug: 'proj-fix-x' }).includes(`\`${SCRUB} git -C "$WT" diff\``))
  }
})

test('(c) the verifier line is scrubbed in both verify templates, with and without a baseline', () => {
  for (const base of [undefined, [], ['test_x — env']]) {
    for (const block of [T.ralphLoop('make test', 3, base), T.oneShotVerify('make test', base)]) {
      const line = block.split('\n').find((l) => l.startsWith('- Verifier:'))
      assert.equal(line, `- Verifier: ${SCRUB} make test`)
    }
  }
})

test('(d) scrubbed() never double-prefixes', () => {
  for (const v of ['make test', 'FOO=1 make test', 'cd sub && make', `${SCRUB} make test`, `  ${SCRUB} make test`]) {
    assert.equal(T.scrubbed(T.scrubbed(v)), T.scrubbed(v))
    assert.equal(count(T.scrubbed(v), SCRUB), 1, v)
  }
})

test('(e) every agent prompt carries GIT_ENV_RULE once, ahead of any verifier command', () => {
  assert.ok(T.GIT_ENV_RULE.includes(SCRUB) && /NEVER set or export GIT_DIR/.test(T.GIT_ENV_RULE) && /mktemp -d/.test(T.GIT_ENV_RULE))
  for (const a of [{ repoPath: '/repo', verifier: 'make test' }, { repoPath: '/repo', verifier: 'make test', knownBaselineFailures: ['t — env'] }]) {
    const all = builders(a)
    assert.equal(Object.keys(all).length, 10)
    for (const [name, prompts] of Object.entries(all)) {
      for (const p of prompts) {
        assert.equal(count(p, T.GIT_ENV_RULE), 1, `${name}: GIT_ENV_RULE once`)
        if (VERIFYING.includes(name)) {
          const v = p.indexOf(`${SCRUB} make test`)
          assert.ok(v > -1, `${name}: renders the scrubbed verifier`)
          assert.ok(p.indexOf(T.GIT_ENV_RULE) < v, `${name}: the rule precedes the verifier command`)
        }
      }
    }
  }
})

test('(e2) every runAgent call site uses one of the 10 covered builders', () => {
  const orch = fs.readFileSync(enginePath, 'utf8')
  const covered = Object.keys(builders({ repoPath: '/repo', verifier: 'make test' }))
  // The implementer arm passes a `prompt` closure; its builders are chosen just above it.
  const calls = [...orch.matchAll(/runAgent\((\w+)\(/g)]
  assert.ok(calls.length >= 12, `found ${calls.length} runAgent call sites`)
  for (const m of calls) {
    assert.ok(m[1] === 'prompt' || covered.includes(m[1]), `runAgent(${m[1]}(…)) is a covered builder`)
  }
  assert.match(orch, /\? approvedPlanImplementerPrompt\(/)
  assert.match(orch, /: implementerPrompt\(/)
})

test('(f) every inline code span that runs git starts with the scrub', () => {
  const a = { repoPath: '/repo', verifier: 'git status && make test' }
  for (const [name, prompts] of Object.entries(builders(a))) {
    for (const p of prompts) {
      for (const [, span] of p.matchAll(/`([^`\n]*)`/g)) {
        if (/(^|[\s;&|(])git\s/.test(span)) assert.ok(span.startsWith(SCRUB), `${name}: \`${span}\``)
      }
    }
  }
  const all = builders(a)
  for (const name of ['readOnlyPrompt', 'plannerPrompt']) {
    assert.ok(all[name][0].includes(`${SCRUB} git status && make test`), `${name} renders the scrubbed verifier`)
  }
})

test('(b2) the four Integration steps start with the scrub on their first command line', () => {
  for (const a of [{ repoPath: '/repo' }, { repoPath: '/repo', defaultBranch: 'master', envBootstrap: 'poetry install' }]) {
    for (const [bootstrap, ff] of [[true, false], [false, false], [true, true]]) {
      const setup = T.branchTreeSetup(a, task, bootstrap, ff).split('\n')
      assert.match(setup[0], /Run exactly, as ONE Bash command/)
      assert.ok(setup[1].startsWith(`  ${SCRUB} WT="`), setup[1])
    }
    for (const step of [T.integrationMergeStep(a, task, I), T.integrationJudgeCheck(a, task, I, J), T.integrationMergeReads(a, task, I, J)]) {
      assert.ok(step.split('\n')[0].startsWith(`${SCRUB} WT="`), step.split('\n')[0])
    }
  }
  // the recipe is embedded in the scrubbed merge step and run by the lead after its own scrub
  assert.ok(T.integrationMergeStep({ repoPath: '/repo' }, task, I).includes(T.ANCHOR_RECIPE))
})

test('(g) the edit-noop-repro diagnostic scrubs every git command its probe runs', () => {
  const file = path.join(path.dirname(enginePath), 'diagnostics', 'edit-noop-repro.workflow.js')
  const src = fs.readFileSync(file, 'utf8')
  const lit = src.match(/^const GIT_ENV_SCRUB = '([^']*)'$/m)
  assert.ok(lit, 'the diagnostic declares its own GIT_ENV_SCRUB literal')
  assert.equal(lit[1], T.GIT_ENV_SCRUB, 'the diagnostic literal equals the engine constant')
  const body = src.slice(src.indexOf('function buildPrompt'), src.indexOf('\nconst a ='))
  const ctx = {}
  vm.createContext(ctx)
  vm.runInContext(`${lit[0]}\n${body}\nvar __b = buildPrompt`, ctx)
  const p = ctx.__b(0, '/r', 'origin/main')
  const lines = p.split('\n')
  const s1 = lines.findIndex((l) => l.startsWith('STEP 1'))
  assert.match(lines[s1], /Run exactly, as ONE Bash command/)
  assert.ok(lines[s1 + 1].startsWith(`  ${SCRUB} RP="`), lines[s1 + 1])
  const s2 = lines.findIndex((l) => l.startsWith('STEP 2'))
  const rest = lines.slice(s2).join('\n')
  const hits = [...rest.matchAll(/git -C/g)]
  assert.equal(hits.length, 4, 'four git -C commands in STEPs 2-4')
  for (const h of hits) assert.equal(rest.slice(h.index - SCRUB.length - 1, h.index), SCRUB + ' ', `scrubbed at ${h.index}`)
})
