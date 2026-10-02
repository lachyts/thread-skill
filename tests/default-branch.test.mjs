// args.defaultBranch — the worktree base for repos whose origin default branch is not `main`.
//
// The fresh-worktree arm used to hardcode `origin/main`, so a rollout on a `master` repo failed at its
// first worktree. The fix must keep the resume-cache invariant: every rollout that does not pass
// `defaultBranch` (or passes 'main') renders BYTE-IDENTICAL worktree setup to the pre-fix engine, pinned
// here by the sha256 of the pre-fix output. The value is interpolated into bash, so it is validated,
// never quoted. The argument is deliberately NOT named `baseBranch`: the protocol 4 redesign already
// uses that name with a different contract (it requires `baseRef` alongside).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { loadEngine, enginePath } from './lib/engine.mjs'
import fs from 'node:fs'

const T = loadEngine(['worktreeSetup', 'implementerPrompt', 'approvedPlanImplementerPrompt'])
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const task = { slug: 'proj-fix-x' }

// Originally recorded from the 2.5.1 engine (HEAD 1c87bd4) before the defaultBranch edit. Re-pinned ON
// PURPOSE by p12-3: the GIT_* scrub prefixes the setup's first line (and its `git -C "$WT" diff` span) with
// GIT_ENV_SCRUB, and GIT_ENV_RULE joins every agent prompt, so the p12-3 engine deliberately breaks the
// resume-cache invariant for every agent prompt: a resumeFromRunId resume of a pre-p12-3 run re-runs its
// agents, judges included. From here on the pins guard the scrubbed bytes the same way. Re-pinned ON PURPOSE
// by p12-12: the fresh-worktree sentence now reads "every task that has already merged" (an old-vs-new render
// diff showed that one line and nothing else).
const GOLDEN_PLAIN = '9eb595aa7877dff24e996710b01024de1a56bdb7537c74fe246d2a746b828143'
const GOLDEN_ENV = '0cf14921edb400ab40dc593da053944d1e16c5c9fc1a04a0877115d78a0c72dd'

test('unset renders the pinned bytes (resume-cache invariant, re-pinned by p12-3)', () => {
  assert.equal(sha(T.worktreeSetup({ repoPath: '/repo' }, task)), GOLDEN_PLAIN)
  assert.equal(sha(T.worktreeSetup({ repoPath: '/repo', envBootstrap: 'poetry install' }, task)), GOLDEN_ENV)
})

test("'main' renders identically to unset", () => {
  const unset = T.worktreeSetup({ repoPath: '/repo' }, task)
  assert.equal(T.worktreeSetup({ repoPath: '/repo', defaultBranch: 'main' }, task), unset)
  assert.equal(T.worktreeSetup({ repoPath: '/repo', defaultBranch: '' }, task), unset)
})

test("'master' differs from unset only by the base ref", () => {
  const unset = T.worktreeSetup({ repoPath: '/repo' }, task)
  const master = T.worktreeSetup({ repoPath: '/repo', defaultBranch: 'master' }, task)
  assert.ok(master.includes('origin/master'))
  assert.ok(!master.includes('origin/main'))
  assert.equal(master.replaceAll('origin/master', 'origin/main'), unset)
})

const t = { ...task, taskPath: '/vault/proj-fix-x.md', maxIterations: 3 }
const st = { tier: 'opus', cap: 'fable', escalated: false, capSuppressed: false }
const prompts = (a) => [T.implementerPrompt(t, a, st, ''), T.approvedPlanImplementerPrompt(t, 'PLAN', a, st, '')]

test('the base reaches both worktree-creating prompts', () => {
  for (const p of prompts({ repoPath: '/repo', defaultBranch: 'trunk', verifier: 'make test' })) {
    assert.ok(p.includes('worktree add "$WT" -b "$BR" origin/trunk'))
    assert.ok(!p.includes('origin/main'))
  }
})

test("'main' and unset render identical implementer prompts; PRs take gh's default base", () => {
  const unset = prompts({ repoPath: '/repo', verifier: 'make test' })
  assert.deepEqual(prompts({ repoPath: '/repo', verifier: 'make test', defaultBranch: 'main' }), unset)
  // One source: the base is the repo's GitHub default, which `gh pr create` targets on its own.
  for (const p of prompts({ repoPath: '/repo', verifier: 'make test', defaultBranch: 'trunk' })) assert.ok(!p.includes('--base'))
})

test('branch names that could reach bash are refused', () => {
  const injection = ['-rf', 'x;rm -rf ~', '$(id)', 'a b', '`id`', 'a"b', 'feat\nx', 42]
  const gitInvalid = ['a..b', 'foo.lock', 'rel/x.lock', 'foo/', '/foo', 'a//b', '.hidden', 'a/.b', 'x.']
  for (const bad of [...injection, ...gitInvalid]) {
    assert.throws(() => T.worktreeSetup({ repoPath: '/repo', defaultBranch: bad }, task), /defaultBranch/, String(bad))
  }
  for (const good of ['master', 'trunk', 'develop', 'release/2.x', 'dev_1', 'v1.2', 'a.lockx', 'x.y/z']) {
    assert.doesNotThrow(() => T.worktreeSetup({ repoPath: '/repo', defaultBranch: good }, task), good)
  }
})

test('the engine never reads a.baseBranch (protocol 4 owns that name)', () => {
  assert.ok(!/\ba\.baseBranch\b/.test(fs.readFileSync(enginePath, 'utf8')))
})
