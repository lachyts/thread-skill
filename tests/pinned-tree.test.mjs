// p12-4 (ADR 0030): the read-only agents read the task's own pinned tree, never the shared checkout.
//
// The planner, plan judge, plan reviser, read-only investigator and review judge used to get
// `Project root: <repoPath>` and read that mutable checkout directly, so in --gated mode, before the first task call,
// or with a dirty/diverged checkout they planned and judged against a stale tree. Each task now has ONE
// worktree at worktreeDir(repoPath, slug), created by its first agent from a freshly fetched
// origin/<base> (detached for a read-only task, on audit-fix/<alias> for a code-writing one), and every
// read-only agent is handed that path. The implementer prompts (and worktreeSetup) are byte-unchanged.
//
// Pinned here: the rendered prompt text. tests/pinned-tree.test.sh executes the rendered setup blocks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadEngine } from './lib/engine.mjs'

const T = loadEngine([
  'taskTreeSetup', 'TASK_TREE_RULE', 'worktreeSetup', 'worktreeDir', 'envBootstrapStep', 'GIT_ENV_SCRUB',
  'plannerPrompt', 'planJudgePrompt', 'planReviserPrompt', 'readOnlyPrompt', 'reviewJudgePrompt',
  'implementerPrompt', 'approvedPlanImplementerPrompt', 'rungState',
])
const SCRUB = 'unset $(git rev-parse --local-env-vars 2>/dev/null);'
const ST = T.rungState({ slug: 'proj-fix-x' }, {}) // a bottom-rung first pass, as converge() builds it
const R = '/REPOROOT' // a sentinel: any unmapped repoPath read shows up as a bare match
const a = { repoPath: R, verifier: 'make test', rolloutSlug: 'r' }
const slug = 'proj-fix-x'
const wt = `${R}/.claude/worktrees/${slug}`
const mk = (scope) => ({ slug, scope, taskPath: '/vault/Tasks/proj-fix-x.md', maxIterations: 3 })
const code = mk('cross-cutting')
const ro = mk('read-only')
const feedback = [{ round: 1, feedback: ['fix it'] }]
const impl = { prUrl: 'https://github.com/o/r/pull/1', worktreePath: wt, branch: 'audit-fix/fix-x' }

// Each read-only builder, with the setup block it renders (null for the review judge: it has none).
function readOnlyBuilders(task, args = a) {
  return {
    plannerPrompt: [T.plannerPrompt(task, args, ST, ''), T.taskTreeSetup(args, task, true)],
    planJudgePrompt: [T.planJudgePrompt(task, 'PLAN', args), T.taskTreeSetup(args, task, false)],
    planReviserPrompt: [T.planReviserPrompt(task, 'PLAN', feedback, 2, args), T.taskTreeSetup(args, task, false)],
    readOnlyPrompt: [T.readOnlyPrompt(task, args, ST, ''), T.taskTreeSetup(args, task, true)],
    reviewJudgePrompt: [T.reviewJudgePrompt(task, impl, args, []), null],
  }
}

test('(a) the 5 read-only builders carry Task tree:, never Project root: or a bare repoPath', () => {
  assert.ok(!code.taskPath.includes('REPOROOT'))
  for (const task of [code, ro]) {
    for (const [name, [p, setup]] of Object.entries(readOnlyBuilders(task))) {
      if (name === 'readOnlyPrompt' && task === code) continue
      assert.ok(p.includes(`Task tree: ${wt}`), `${name}: Task tree: line`)
      assert.ok(!p.includes(`Project root: ${R}`), `${name}: no Project root: line`)
      let rest = p
      if (setup) {
        assert.equal(p.split(setup).length - 1, 1, `${name}: renders its setup block exactly once`)
        rest = p.replace(setup, '')
      }
      for (const m of rest.matchAll(/\/REPOROOT/g)) {
        assert.ok(rest.startsWith(`/REPOROOT/.claude/worktrees/${slug}`, m.index), `${name}: bare repoPath at ${m.index}: …${rest.slice(m.index - 40, m.index + 40)}…`)
      }
    }
  }
})

test('(a2) the review judge: the PR is authoritative, the tree is context only when it matches', () => {
  const p = T.reviewJudgePrompt(code, impl, a, [])
  for (const s of [
    'gh pr diff', 'headRefOid', `${SCRUB} git -C "${wt}" rev-parse HEAD`, `${SCRUB} git -C "${wt}" status --porcelain`,
    'authoritative', 'context only',
  ]) assert.ok(p.includes(s), s)
  assert.match(p, /mismatch, a non-empty status or a missing tree/)
  assert.match(p, /never[^.]*shared checkout/)
  assert.ok(!p.includes('First, enter this task'), 'no setup block')
})

test('(a3) TASK_TREE_RULE: tidy only what your own run added, re-run the setup on a vanished tree', () => {
  const r = T.TASK_TREE_RULE
  assert.ok(r.includes('appear in the after list but not the before list'))
  assert.ok(r.includes('Never delete or revert anything that was present before your run'))
  assert.ok(r.includes('env bootstrap'))
  assert.match(r, /disappears mid-run[^]*re-run the setup command above once/)
  assert.ok(!r.includes('leave the tree as found'))
  assert.ok(r.includes('~/repos/<repo>'))
  for (const name of ['plannerPrompt', 'planJudgePrompt', 'planReviserPrompt', 'readOnlyPrompt']) {
    assert.equal(readOnlyBuilders(name === 'readOnlyPrompt' ? ro : code)[name][0].split(r).length - 1, 1, `${name}: carries TASK_TREE_RULE once`)
  }
})

test('(b) mode: a code-writing task gets its branch, a read-only task a detached tree', () => {
  const attach = 'checkout --quiet -b "$BR"'
  for (const name of ['plannerPrompt', 'planJudgePrompt', 'planReviserPrompt']) {
    const p = readOnlyBuilders(code)[name][0]
    assert.ok(p.includes('-b "$BR"') && p.includes('BR="audit-fix/fix-x"') && p.includes(attach), `${name} (code): branch + attach`)
    assert.ok(!p.includes('--detach "$WT"'), `${name} (code): no detached add`)
  }
  for (const name of ['plannerPrompt', 'planJudgePrompt', 'planReviserPrompt', 'readOnlyPrompt']) {
    const p = readOnlyBuilders(ro)[name][0]
    assert.ok(p.includes('worktree add --detach "$WT" origin/main'), `${name} (read-only): detached add`)
    assert.ok(!p.includes('-b "$BR"') && !p.includes('BR=') && !p.includes(attach), `${name} (read-only): no branch, no attach`)
  }
})

test('(c) refresh: the planner and investigator fast-forward; the judge and reviser never move the tree', () => {
  const refreshBits = [
    'if ! git -C "$WT" fetch origin --quiet; then why="fetch failed"', '--untracked-files=no',
    'tree NOT refreshed: $why', 'as last fetched', 'merge --ff-only --quiet origin/main',
    'checkout --quiet --detach origin/main',
  ]
  const env = { ...a, envBootstrap: 'poetry install' }
  for (const task of [code, ro]) {
    const b = readOnlyBuilders(task, env)
    const refreshing = task === code ? ['plannerPrompt'] : ['plannerPrompt', 'readOnlyPrompt']
    for (const name of refreshing) {
      for (const s of refreshBits) assert.ok(b[name][0].includes(s), `${name}: ${s}`)
      // inside the guard, last: after `tree base:`, before its `fi`, never after the toplevel check
      const l = b[name][1].split('\n')
      const at = l.indexOf('    ' + T.envBootstrapStep(env).trimStart())
      assert.ok(at > 0, `${name}: env bootstrap line`)
      assert.ok(l[at - 1].startsWith('    echo "tree base:') && l[at + 1] === '  fi', `${name}: bootstrap inside the guard, after tree base:`)
      assert.ok(l[at + 2].startsWith('  git rev-parse --show-toplevel') && !l[at + 2].includes('poetry'), `${name}: nothing after the toplevel check`)
      assert.ok(b[name][0].includes(b[name][1]), `${name}: renders that setup`)
    }
    for (const name of ['planJudgePrompt', 'planReviserPrompt']) {
      for (const s of refreshBits) assert.ok(!b[name][0].includes(s), `${name}: no ${s}`)
      assert.ok(!b[name][0].includes('poetry install'), `${name}: no env bootstrap`)
    }
    for (const name of [...refreshing, 'planJudgePrompt', 'planReviserPrompt']) {
      assert.ok(b[name][0].includes('worktree lock --reason "pid $PPID'), `${name}: locks the tree`)
      assert.ok(b[name][0].includes('echo "tree base: $(git -C "$WT" rev-parse HEAD)"'), `${name}: prints tree base:`)
    }
    assert.ok(!b.reviewJudgePrompt[0].includes('worktree lock'), 'review judge: no setup')
  }
})

test('(c2) base pinning: Planned on: / Investigated on:, and the judge compares', () => {
  assert.match(T.plannerPrompt(code, a, ST, ''), /FIRST line is `Planned on: <sha/)
  assert.match(T.planReviserPrompt(code, 'PLAN', feedback, 2, a), /FIRST line is `Planned on: <sha/)
  const j = T.planJudgePrompt(code, 'PLAN', a)
  assert.match(j, /`tree base: <sha>`[^]*`Planned on:`/)
  assert.match(j, /differ, or the plan has none[^]*"changes"/)
  assert.match(T.readOnlyPrompt(ro, a, ST, ''), /`Investigated on: <sha/)
})

test('(d) the WT/BR lines and code-writing arms are worktreeSetup\'s; the base follows defaultBranch', () => {
  // taskTreeSetup: [1] WT/BR, [2] the self-heal, [3..5] the arms; worktreeSetup: [1] WT/BR, [2..4] the arms
  const tt = (s) => { const l = s.split('\n'); return [l[1], ...l.slice(3, 6)] }
  const ws = (s) => s.split('\n').slice(1, 5)
  for (const args of [a, { ...a, defaultBranch: 'master' }]) {
    assert.deepEqual(tt(T.taskTreeSetup(args, code, true)), ws(T.worktreeSetup(args, code)))
  }
  const m = T.taskTreeSetup({ ...a, defaultBranch: 'master' }, ro, true)
  assert.ok(m.includes('--detach "$WT" origin/master') && !m.includes('origin/main'))
  assert.throws(() => T.taskTreeSetup({ ...a, defaultBranch: 'a b' }, code, true), /defaultBranch/)
  assert.doesNotThrow(() => T.taskTreeSetup({ verifier: 'make test' }, code, true), 'no repoPath (the cap sweep) still renders')
})

test('(d2) a missing tree is unlocked and pruned before the arms; the guard needs the shell in the tree', () => {
  const heal = `  [ -d "$WT" ] || { git -C "${R}" worktree unlock "$WT" 2>/dev/null; git -C "${R}" worktree prune; }`
  for (const task of [code, ro]) {
    for (const refresh of [true, false]) {
      const l = T.taskTreeSetup(a, task, refresh).split('\n')
      assert.equal(l[2], heal, 'self-heal is line 2')
      assert.equal(l[3], '  if [ -d "$WT" ]; then cd "$WT";', 'the arms follow it')
      assert.ok(l.includes('  if [ -d "$WT" ] && [ "$(git -C "$WT" rev-parse --show-toplevel 2>/dev/null)" = "$(pwd -P)" ]; then'), 'guard')
    }
  }
})

test('(e) the first command line starts with the scrub', () => {
  for (const task of [code, ro]) {
    for (const refresh of [true, false]) {
      const l = T.taskTreeSetup(a, task, refresh).split('\n')
      assert.match(l[0], /Run exactly, as ONE Bash command/)
      assert.ok(l[1].startsWith(`  ${SCRUB} WT="${wt}"`), l[1])
    }
  }
})

test('(f) implementer prompts keep Project root: and worktreeSetup unchanged', () => {
  const b = { ...a, repoPath: '/repo' }
  const ws = T.worktreeSetup(b, code)
  for (const p of [T.implementerPrompt(code, b, ST, ''), T.approvedPlanImplementerPrompt(code, 'PLAN', b, ST, '')]) {
    assert.ok(p.includes('Project root: /repo') && p.includes(ws))
    assert.ok(!p.includes('Task tree:') && !p.includes('worktree lock'))
  }
})

test('(g) the investigator returns the task tree as worktreePath', () => {
  const p = T.readOnlyPrompt(ro, a, ST, '')
  assert.ok(p.includes(`worktreePath="${wt}"`))
  assert.ok(!p.includes('open no worktree'))
})
