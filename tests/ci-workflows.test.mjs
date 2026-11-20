// p43-3 (ADR 0073 d3, ADR 0025): the CI workflows. A PR's one required check runs the fast tier against the PR's base,
// on ubuntu alone (macOS left the PR checks by ADR 0084 d3, p54-2, and runs only in master's shards); every push to
// master runs the full suite as a matrix of shards on both OSes, split by tests/lib/shard.py.
// - W1: test.yml's job `test` reports the one required-check name, `make test (ubuntu-latest)`, as a literal name with no
//   matrix: a roll-up (ADR 0084 d4, p54-12) that needs only `shard`, runs under `if: ${{ always() }}` and nothing else
//   (never skipped: a skipped required job reports success), on ubuntu under a whole-number limit, on pull_request only.
// - W2: the job `shard` runs the fast tier as PR_SHARDS shards, `bash tests/run.sh --fast --shard K/N` with the same N
//   as its matrix, fail-fast off, THREAD_VERIFY_BASE the PR's base sha, THREAD_SKIP_SLOW=1 (it leaves the Slow tier
//   out, ADR 0084 d3), on a full-history checkout, under one plain timeout-minutes (lead-integrate's CI headroom reads a
//   roll-up's slowest needed job against that job's own whole-number limit, p54-11; the value is measured, test.yml).
// - W3: no other job in any workflow takes the required-check name, by expansion or by merge-gate.py's rules 1-3 (the
//   shards' `fast tier (shard K/N)` names included); no job in a workflow triggered by pull_request runs on a macos-*
//   runner (ADR 0084 d3); and full-suite.yml runs on push to master only.
// - W4: full-suite.yml's shard matrix and its run line agree on N, and each OS has its own timeout-minutes (p43-6's
//   audit: about twice that OS's slowest shard); its shards never set THREAD_SKIP_SLOW, so master runs the Slow tier.
// - W5: every .github/workflows/*.yml parses (PyYAML) to a mapping with `jobs` (check-workflow-parse.sh covers only
//   the *.workflow.js scripts).
// - W6 (p54-5, ADR 0084 Decided for you 11): full-suite.yml's job `green-tip`, named `publish the Green tip` (p54-7's
//   marker), needs every other job, runs only on success(), on ubuntu under 5 minutes, and alone holds
//   `contents: write`; its checkout keeps its credentials on full history, and its script reads only GITHUB_SHA,
//   GITHUB_REF and GREEN_REF (refs/thread/green), with no `${{ }}`, so G1 runs exactly the deployed text.
// - W7: both workflows read only at the workflow level, no other job holds a write permission, and full-suite.yml's
//   runs coalesce in one workflow-level concurrency group, keyed by the branch alone (a group per commit or per run
//   never coalesces), that never cancels a run in flight (Decided for you 4).
// - W9 (p49-4): every actions/setup-node step in every workflow pins node-version NODE_LINE (24 LTS), and each
//   workflow's shard job has one, so CI runs one node line (tests/lib/node-run.mjs pins the spec reporter).
// - G1: that script, run as GitHub's `shell: bash` runs it, against a fixture origin (a bare repo, the run's checkout
//   and a second clone for other merges): it creates the ref, fetches master and the ref before every check (so a
//   force-push that took the run's commit off master during a failed push stops the next one), never moves the ref
//   back or off master, never forces, rereads after a rejected push, and goes red only when the ref is still behind
//   after its third failed push, with the push's own stderr in the log.
// - W8 (p54-12): the roll-up's script, run as GitHub's `shell: bash` runs it, passes only when SHARDS
//   (`needs.shard.result`) is success, and fails with a last `::error::` line for failure, cancelled, skipped and empty;
//   and lead-integrate.py's own line reader, on the real test.yml, reads job `test` as the check's roll-up whose needs
//   closure is `shard`, with the shard's limit a plain number and its run names matching the shard job alone.
// - S1: `bash tests/run.sh --shard-plan N` on the real tree puts every collected test (fast-tier.py's COLLECTED, which
//   tests/fast-tier.test.sh C3 pins to run.sh's globs) and the merge-task self-tests in exactly one shard.
// tests/fast-tier.test.sh pins run.sh's --shard and --shard-plan modes on a fixture. Reads the tree; writes only under
// an os.tmpdir() mkdtemp dir, removed after G1.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WF = '.github/workflows'
const REQUIRED = ['make test (ubuntu-latest)']
// PR_SHARDS: test.yml's shard count (W2, W3, W8) and PR_SHARD_LIMIT its shards' timeout-minutes (the comment above
// it in test.yml holds the rule and the measured minutes). FULL_OSES: full-suite.yml's shard matrix (W4, limits()),
// which keeps macOS.
const PR_SHARDS = 3
const PR_SHARD_LIMIT = 35
const FULL_OSES = ['ubuntu-latest', 'macos-latest']
const SELF_TESTS = '@merge-task-self-tests'

const py = (code, args = []) => {
  const r = spawnSync('python3', ['-B', '-c', code, ...args], { cwd: root, encoding: 'utf8' })
  assert.equal(r.status, 0, `python3 failed: ${r.stderr}`)
  return r.stdout
}
// YAML 1.1 reads the `on` key as true, so json.dumps writes it as "true"; on() reads either.
const LOAD = `import json, sys
try:
    import yaml
except ImportError:
    sys.exit("PyYAML is missing: python3 -m pip install pyyaml")
print(json.dumps({p: yaml.safe_load(open(p)) for p in sys.argv[1:]}))`
const files = fs.readdirSync(path.join(root, WF)).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => `${WF}/${f}`)
const parsed = JSON.parse(py(LOAD, files))
const on = (wf) => wf.on ?? wf.true
const TEST = `${WF}/test.yml`
const FULL = `${WF}/full-suite.yml`

// expand(name, matrix): the name for each combination of the matrix's list values (`${{ matrix.<k> }}` replaced).
const expand = (name, matrix = {}) => {
  let out = [name]
  for (const [k, vals] of Object.entries(matrix)) {
    if (!Array.isArray(vals)) continue
    const re = new RegExp(`\\$\\{\\{\\s*matrix\\.${k}\\s*\\}\\}`, 'g')
    out = out.flatMap((n) => vals.map((v) => n.replace(re, String(v))))
  }
  return out
}
const steps = (job) => job.steps || []
const runSteps = (job) => steps(job).filter((s) => typeof s.run === 'string')
const checkout = (job) => steps(job).find((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'))

// merge-gate.py's rules 1-3 (its header): does `job` (id, job) take the required context `ctx`?
const EXPR = /\$\{\{.*?\}\}/g
const takes = (id, job, ctx) => {
  const name = typeof job.name === 'string' ? job.name : null
  const targets = [ctx]
  const stripped = ctx.replace(/\s\([^()]*\)$/, '')
  if (stripped !== ctx) targets.push(stripped)
  for (const t of targets) if (name === t || (name === null && id === t)) return true
  if (!name || !name.includes('${{') || !name.replace(EXPR, '').trim()) return false
  const parts = name.split(EXPR).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(`^${parts.join('.+')}$`, 's').test(ctx)
}

test('W5: every workflow file parses to a mapping that has jobs', () => {
  assert.ok(files.includes(TEST) && files.includes(FULL), `both workflows exist: ${files}`)
  for (const f of files) {
    const wf = parsed[f]
    assert.ok(wf && typeof wf === 'object' && !Array.isArray(wf), `${f} is a mapping`)
    assert.ok(wf.jobs && typeof wf.jobs === 'object' && Object.keys(wf.jobs).length > 0, `${f} has jobs`)
    assert.ok(on(wf), `${f} has an on: trigger`)
  }
})

test('W1: test.yml\'s job `test` is the one required check, a roll-up of the shards that never skips, on pull_request only (ADR 0025, 0084)', () => {
  const wf = parsed[TEST]
  const job = wf.jobs.test
  assert.ok(job, 'job id test')
  assert.equal(job.name, REQUIRED[0], 'a literal name, so the context is byte-identical to the ruleset\'s')
  assert.equal(job.strategy, undefined, 'no matrix, so the literal name is the one context it reports')
  assert.deepEqual([job.needs ?? []].flat(), ['shard'])
  assert.equal(String(job.if ?? '').replace(/\$\{\{|\}\}|\s/g, ''), 'always()', 'it runs whatever the shards concluded, and nothing else can skip it')
  assert.equal(job['runs-on'], 'ubuntu-latest')
  assert.equal(job['timeout-minutes'], 5)
  const trig = on(wf)
  assert.ok(trig && typeof trig === 'object' && 'pull_request' in trig, 'on: holds pull_request')
  assert.ok(!('push' in trig), 'on: holds no push (the full suite runs on master in full-suite.yml)')
})

test('W2: the shards run the fast tier against the PR\'s base, N ways, on full-history checkouts', () => {
  const job = parsed[TEST].jobs.shard
  assert.ok(job, 'test.yml has the job shard')
  assert.equal(job.if, undefined, 'a shard carries no if:')
  assert.equal(job.strategy['fail-fast'], false, 'one shard\'s red never cancels the others into a false timeout')
  assert.deepEqual(Object.keys(job.strategy.matrix), ['shard'], 'no matrix.os: ubuntu alone')
  assert.deepEqual(job.strategy.matrix.shard, Array.from({ length: PR_SHARDS }, (_, i) => i + 1))
  assert.equal(job['runs-on'], 'ubuntu-latest')
  assert.equal(job['timeout-minutes'], PR_SHARD_LIMIT)
  const last = runSteps(job).at(-1)
  assert.equal(last.run.trim(), `bash tests/run.sh --fast --shard \${{ matrix.shard }}/${PR_SHARDS}`)
  assert.equal(last.env.THREAD_VERIFY_BASE, '${{ github.event.pull_request.base.sha }}')
  assert.equal(last.env.THREAD_TEST_JOBS, '4')
  assert.equal(last.env.THREAD_SKIP_SLOW, '1', 'the PR check leaves the Slow tier out (ADR 0084 d3)')
  assert.equal(checkout(job)?.with?.['fetch-depth'], 0, 'fetch-depth: 0, so the base sha and merge-base resolve')
  assert.equal(checkout(job)?.with?.['persist-credentials'], false)
})

test('W3: no other job takes the required-check name, no PR job runs on macOS; full-suite.yml runs on push to master only', () => {
  for (const f of files) {
    // on: is a mapping, a list or one event name.
    const trig = on(parsed[f])
    const onPr = Array.isArray(trig) ? trig.includes('pull_request')
      : trig && typeof trig === 'object' ? 'pull_request' in trig : trig === 'pull_request'
    for (const [id, job] of Object.entries(parsed[f].jobs)) {
      if (onPr) {
        const runners = expand(String(job['runs-on'] ?? ''), job.strategy?.matrix)
        assert.deepEqual(runners.filter((r) => r.startsWith('macos-')), [], `${f} job ${id} runs a PR check on macOS (ADR 0084 d3)`)
      }
      if (f === TEST && id === 'test') continue
      const names = typeof job.name === 'string' ? expand(job.name, job.strategy?.matrix) : [id]
      for (const ctx of REQUIRED) {
        assert.ok(!names.includes(ctx), `${f} job ${id} expands to ${ctx}`)
        assert.ok(!takes(id, job, ctx), `${f} job ${id} matches ${ctx} by merge-gate's rules`)
      }
    }
  }
  const shard = parsed[TEST].jobs.shard
  const shardNames = expand(shard.name, shard.strategy.matrix)
  assert.deepEqual(shardNames, Array.from({ length: PR_SHARDS }, (_, i) => `fast tier (shard ${i + 1}/${PR_SHARDS})`))
  for (const ctx of REQUIRED) assert.ok(!shardNames.includes(ctx) && !takes('shard', shard, ctx), `no shard takes ${ctx}`)
  const trig = on(parsed[FULL])
  assert.deepEqual(Object.keys(trig), ['push'], 'full-suite.yml runs on push only, no PR event')
  assert.deepEqual(trig.push.branches, ['master'])
})

// W8(b)'s probe: lead-integrate.py's own line reader (p54-11), loaded by spec, on the real test.yml.
const ROLLUP = `import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("li", "skills/execute/scripts/lead-integrate.py")
li = importlib.util.module_from_spec(spec); spec.loader.exec_module(li)
_, jobs = li._workflow_jobs(open(".github/workflows/test.yml").read())
roll = li._rollup(jobs, sys.argv[1])
closure, readable = li._needs_closure(jobs, roll) if roll else ([], False)
shard = next((j for j in jobs if j["key"] == "shard"), None)
print(json.dumps({"roll": roll and roll["key"], "closure": [j["key"] for j in closure], "readable": readable,
                  "limit": list(li._job_limit(shard)), "matches": {n: li._job_matches(shard, n) for n in sys.argv[2:]}}))`

test('W8: the roll-up passes only on every shard\'s success, and the engine reads test.yml as that roll-up', (t) => {
  const job = parsed[TEST].jobs.test
  const step = steps(job).at(-1)
  assert.equal(step?.shell, 'bash')
  assert.equal(step.env?.SHARDS, '${{ needs.shard.result }}')
  assert.ok(!step.run.includes('${{'), 'no ${{ }} in the script, so this test runs the deployed text')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-rollup-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const script = path.join(tmp, 'rollup.sh')
  fs.writeFileSync(script, step.run)
  for (const [shards, status] of [['success', 0], ['failure', 1], ['cancelled', 1], ['skipped', 1], ['', 1]]) {
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
      cwd: tmp, encoding: 'utf8', env: { PATH: process.env.PATH, SHARDS: shards },
    })
    const out = r.stdout + r.stderr
    assert.equal(r.status, status, `SHARDS=${JSON.stringify(shards)}: ${out}`)
    if (status) assert.match(out.trimEnd().split('\n').at(-1), /^::error::/, `SHARDS=${JSON.stringify(shards)}: ${out}`)
  }
  const one = `fast tier (shard 1/${PR_SHARDS})`
  const read = JSON.parse(py(ROLLUP, [REQUIRED[0], one, REQUIRED[0]]))
  assert.deepEqual(read, {
    roll: 'test', closure: ['shard'], readable: true, limit: [PR_SHARD_LIMIT, 'workflow'],
    matches: { [one]: true, [REQUIRED[0]]: false },
  })
})

// The shard count N: full-suite.yml's matrix, which the run line must repeat.
const shardJob = () => {
  const job = parsed[FULL].jobs.shard
  assert.ok(job, 'full-suite.yml has the job shard, the shard matrix')
  return job
}
const shardN = () => shardJob().strategy.matrix.shard.length
// limits(job): each OS's timeout-minutes. A whole number holds for both OSes; the one other form is
// `${{ matrix.os == '<os>' && <a> || <b> }}`, <a> for <os> and <b> for the other. Anything else fails, showing the value.
const LIMIT_EXPR = /^\$\{\{\s*matrix\.os\s*==\s*'([^']+)'\s*&&\s*(\d+)\s*\|\|\s*(\d+)\s*\}\}$/
const limits = (job) => {
  const v = job['timeout-minutes']
  if (Number.isInteger(v)) return Object.fromEntries(FULL_OSES.map((os) => [os, v]))
  const m = typeof v === 'string' ? LIMIT_EXPR.exec(v) : null
  assert.ok(m && FULL_OSES.includes(m[1]), `timeout-minutes is a whole number or the matrix.os form: ${JSON.stringify(v)}`)
  return Object.fromEntries(FULL_OSES.map((os) => [os, Number(os === m[1] ? m[2] : m[3])]))
}

test('W4: the shard matrix covers both OSes and shards 1..N, and the run line names the same N', () => {
  const job = shardJob()
  const n = shardN()
  assert.ok(n >= 2, `N is at least 2, got ${n}`)
  assert.deepEqual(job.strategy.matrix.os, FULL_OSES)
  assert.deepEqual(job.strategy.matrix.shard, Array.from({ length: n }, (_, i) => i + 1))
  assert.equal(job.strategy['fail-fast'], false)
  assert.deepEqual(limits(job), { 'ubuntu-latest': 30, 'macos-latest': 35 })
  assert.equal(job['runs-on'], '${{ matrix.os }}')
  const last = runSteps(job).at(-1)
  assert.equal(last.run.trim(), `bash tests/run.sh --shard \${{ matrix.shard }}/${n}`)
  assert.equal(last.env.THREAD_TEST_JOBS, '4')
  assert.equal(last.env.THREAD_SKIP_SLOW, undefined, 'master\'s shards run the Slow tier')
  assert.equal(job.env?.THREAD_SKIP_SLOW, undefined, 'nor at the job level')
  assert.equal(parsed[FULL].env?.THREAD_SKIP_SLOW, undefined, 'nor at the workflow level')
  assert.equal(checkout(job)?.with?.['persist-credentials'], false)
})

const GREEN = 'green-tip'

test('W6: full-suite.yml\'s job green-tip publishes the Green tip once every shard has passed', () => {
  const jobs = parsed[FULL].jobs
  const job = jobs[GREEN]
  assert.ok(job, 'full-suite.yml has the job green-tip')
  assert.equal(job.name, 'publish the Green tip', 'p54-7 reads a red whose only failed job has this name')
  const needs = [job.needs ?? []].flat()
  assert.deepEqual([...needs].sort(), Object.keys(jobs).filter((id) => id !== GREEN).sort(), 'it needs every other job')
  assert.equal(String(job.if ?? '').replace(/\$\{\{|\}\}|\s/g, ''), 'success()', 'it runs only once every shard passed')
  assert.equal(job['runs-on'], 'ubuntu-latest')
  assert.equal(job['timeout-minutes'], 5)
  assert.deepEqual(job.permissions, { contents: 'write' })
  const co = checkout(job)
  assert.equal(co?.with?.['fetch-depth'], 0, 'full history, so its ancestor checks are exact')
  assert.notEqual(co?.with?.['persist-credentials'], false, 'its fetch and push authenticate with GITHUB_TOKEN')
  const last = runSteps(job).at(-1)
  assert.equal(last?.shell, 'bash')
  assert.equal(last.env?.GREEN_REF, 'refs/thread/green')
  assert.ok(!last.run.includes('${{'), 'no ${{ }} in the script, so G1 runs the deployed text')
})

test('W7: only green-tip writes, and full-suite.yml\'s runs coalesce without cancelling a run in flight', () => {
  for (const f of files) {
    assert.deepEqual(parsed[f].permissions, { contents: 'read' }, `${f}'s workflow-level permissions`)
    for (const [id, job] of Object.entries(parsed[f].jobs)) {
      const perms = job.permissions
      assert.notEqual(perms, 'write-all', `${f} job ${id} holds write-all`)
      if (f === FULL && id === GREEN) continue
      const writes = perms && typeof perms === 'object' ? Object.keys(perms).filter((k) => perms[k] === 'write') : []
      assert.deepEqual(writes, [], `${f} job ${id} holds no write permission`)
    }
  }
  const c = parsed[FULL].concurrency
  assert.equal(c?.group, 'full-suite-${{ github.ref }}', 'one workflow-level group per branch, never per commit or run')
  assert.equal(c['cancel-in-progress'], false, 'a run in flight is never cancelled')
  for (const [id, job] of Object.entries(parsed[FULL].jobs)) {
    assert.equal(job.concurrency, undefined, `full-suite.yml job ${id} has no concurrency of its own`)
  }
})

// NODE_LINE: the node major every workflow's setup-node pins (W9); a pinned major, never `lts/*`, so it never moves
// silently. `--test-rerun-failures` needs 24.7, which `24` resolves to.
const NODE_LINE = '24'

test('W9: every setup-node step pins node 24, and each workflow\'s shard job has one', () => {
  for (const f of files) {
    for (const [id, job] of Object.entries(parsed[f].jobs)) {
      const nodes = steps(job).filter((s) => typeof s.uses === 'string' && s.uses.startsWith('actions/setup-node@'))
      if (id === 'shard') assert.ok(nodes.length > 0, `${f} job shard sets up node`)
      for (const s of nodes) {
        assert.equal(String(s.with?.['node-version']), NODE_LINE, `${f} job ${id}'s setup-node pins node ${NODE_LINE}`)
      }
    }
  }
})

// G1's fixture: a bare origin, the run's checkout W (the script's cwd) and a second clone X standing for other merges.
// Every commit is commit-tree on the empty tree, and every spawn's env is built from scratch, so no inherited GIT_*
// variable reaches it. The cases are successive states of one origin, in order.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const ID = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }

test('G1: the green-tip script moves refs/thread/green only forward, on master, unforced, on a fixture origin', (t) => {
  const job = parsed[FULL].jobs[GREEN]
  assert.ok(job, 'full-suite.yml has the job green-tip')
  const step = runSteps(job).at(-1)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-green-tip-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
  const basePath = process.env.PATH
  const home = path.join(tmp, 'home')
  fs.mkdirSync(home)
  const env = (extra = {}) => ({
    PATH: basePath, HOME: home, TMPDIR: tmp, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...ID, ...extra,
  })
  const git = (cwd, ...args) =>
    execFileSync(realGit, ['-C', cwd, ...args], { encoding: 'utf8', env: env(), stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const ok = (cwd, ...args) => spawnSync(realGit, ['-C', cwd, ...args], { encoding: 'utf8', env: env() })
  const bare = path.join(tmp, 'origin.git')
  const w = path.join(tmp, 'w')
  const x = path.join(tmp, 'x')
  const commit = (cwd, msg, parent) => git(cwd, 'commit-tree', EMPTY_TREE, '-p', parent, '-m', msg)
  const green = () => ok(bare, 'rev-parse', '-q', '--verify', 'refs/thread/green').stdout.trim()
  const lacks = (sha) => ok(w, 'cat-file', '-e', `${sha}^{commit}`).status !== 0
  const script = path.join(tmp, 'green-tip.sh')
  fs.writeFileSync(script, step.run)
  const log = path.join(tmp, 'run.log')
  // runGreen(sha): the script as GitHub's `shell: bash` runs it, stdout and stderr in one log as the job's.
  const runGreen = (sha, opts = {}) => {
    const fd = fs.openSync(log, 'w')
    let r
    try {
      r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
        cwd: w, stdio: ['ignore', fd, fd],
        env: env({ PATH: opts.path || basePath, GITHUB_SHA: sha, GITHUB_REF: 'refs/heads/master', GREEN_REF: step.env.GREEN_REF }),
      })
    } finally {
      fs.closeSync(fd)
    }
    return { status: r.status, out: fs.readFileSync(log, 'utf8') }
  }

  git(tmp, 'init', '-q', '--bare', '-b', 'master', bare)
  git(tmp, 'init', '-q', '-b', 'master', w)
  git(w, 'remote', 'add', 'origin', bare)
  const c1 = git(w, 'commit-tree', EMPTY_TREE, '-m', 'c1')
  const c2 = commit(w, 'c2', c1)
  git(w, 'push', '-q', 'origin', `${c2}:refs/heads/master`)
  git(tmp, 'clone', '-q', bare, x)

  // (1) No ref yet: ls-remote's exit 2 is told apart from a read error, and the push creates the ref.
  let r = runGreen(c1)
  assert.equal(r.status, 0, r.out)
  assert.equal(green(), c1, r.out)

  // (2) Origin's master moved on to c3, which the checkout lacks: the script fetches it before any check.
  const c3 = commit(x, 'c3', c2)
  git(x, 'push', '-q', 'origin', `${c3}:refs/heads/master`)
  assert.ok(lacks(c3), 'precondition: the checkout lacks c3')
  r = runGreen(c2)
  assert.equal(r.status, 0, r.out)
  assert.equal(green(), c2, r.out)

  // (3) Out of order: an older run finishes after a newer one moved the ref.
  r = runGreen(c1)
  assert.equal(r.status, 0, r.out)
  assert.equal(green(), c2, r.out)
  assert.match(r.out, /nothing to move/)

  // (4) A re-run of the published commit.
  r = runGreen(c2)
  assert.equal(r.status, 0, r.out)
  assert.equal(green(), c2, r.out)

  // (5) A commit no longer on master that fast-forwards from the ref: only the off-branch check stops its push.
  const s = commit(w, 's', c2)
  r = runGreen(s)
  assert.equal(r.status, 0, r.out)
  assert.equal(green(), c2, r.out)
  assert.match(r.out, /::warning::.*no longer on/)

  // (5b) Diverged: the ref sits off master, at s, and the run's commit c3 is on master.
  git(w, 'push', '-q', 'origin', `${s}:refs/thread/green`)
  r = runGreen(c3)
  assert.equal(r.status, 0, r.out)
  assert.equal(green(), s, r.out)
  assert.match(r.out, /::warning::.*diverged/)
  git(bare, 'update-ref', 'refs/thread/green', c2)

  // wrapGit(name, onPush): a PATH dir whose git runs the sh lines onPush before a `git push`, then the real git.
  const wrapGit = (name, onPush) => {
    const dir = path.join(tmp, name)
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'git'), [
      '#!/bin/sh', 'if [ "$1" = push ]; then', ...onPush.map((l) => `  ${l}`), 'fi', `exec '${realGit}' "$@"`, '',
    ].join('\n'), { mode: 0o755 })
    return `${dir}:${basePath}`
  }

  // (6) The race off master: at the first push a force-push takes master off c3, and the push fails with the ref still
  // behind. Only a fresh read of master stops the second push, which would otherwise fast-forward the ref to c3.
  const off = commit(x, 'off', c2)
  git(x, 'push', '-q', 'origin', `${off}:refs/heads/forced`)
  const pushed = path.join(tmp, 'pushed')
  r = runGreen(c3, { path: wrapGit('wrap-forced', [
    `if [ ! -e '${pushed}' ]; then`,
    `  : > '${pushed}'`,
    `  '${realGit}' -C '${bare}' update-ref refs/heads/master ${off} || exit 1`,
    "  echo 'fatal: the remote end hung up unexpectedly' >&2",
    '  exit 1',
    'fi',
  ]) })
  assert.equal(r.status, 0, r.out)
  assert.equal(green(), c2, r.out)
  assert.equal(r.out.match(/push \d of /g)?.length, 1, r.out)
  assert.match(r.out, /push 1 of [\s\S]*::warning::.*no longer on/)
  git(bare, 'update-ref', 'refs/heads/master', c3)

  // (7) The race: at the push, master and the ref move to c4, which the checkout lacks. The rejected push is reread,
  // never forced, and never turns the green run red.
  const c4 = commit(x, 'c4', c3)
  git(x, 'push', '-q', 'origin', `${c4}:refs/heads/next`)
  assert.ok(lacks(c4), 'precondition: the checkout lacks c4')
  r = runGreen(c3, { path: wrapGit('wrap', [
    `'${realGit}' -C '${bare}' update-ref refs/heads/master ${c4} || exit 1`,
    `'${realGit}' -C '${bare}' update-ref refs/thread/green ${c4} || exit 1`,
  ]) })
  assert.equal(r.status, 0, r.out)
  assert.equal(green(), c4, r.out)
  assert.match(r.out, /push 1 of [\s\S]*nothing to move/)

  // (8) The push itself fails while the ref stays behind (GitHub's workflows refusal, as a pre-receive hook): red only
  // after the third failed push, with the refusal's own words in the log. The base PATH: no race wrapper runs.
  const c5 = commit(w, 'c5', c4)
  git(w, 'push', '-q', 'origin', `${c5}:refs/heads/master`)
  fs.writeFileSync(path.join(bare, 'hooks', 'pre-receive'), [
    '#!/bin/sh',
    'echo "refusing to allow a GitHub App to create or update workflow without workflows permission" >&2',
    'exit 1',
    '',
  ].join('\n'), { mode: 0o755 })
  r = runGreen(c5)
  assert.equal(r.status, 1, r.out)
  assert.match(r.out.trimEnd().split('\n').at(-1), /^::error::/, r.out)
  assert.equal(r.out.match(/push \d of /g)?.length, 3, r.out)
  assert.match(r.out, /refusing to allow/)
  assert.equal(green(), c4, r.out)

  // (9) An unreadable origin: red, and nothing moves.
  git(w, 'remote', 'set-url', 'origin', path.join(tmp, 'missing.git'))
  r = runGreen(c5)
  assert.notEqual(r.status, 0, r.out)
  assert.match(r.out, /::error::/)
  assert.equal(green(), c4, r.out)
})

const COLLECT = `import glob, importlib.util, sys
spec = importlib.util.spec_from_file_location("ft", "tests/lib/fast-tier.py"); ft = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ft)
print("\\n".join(sorted({p for g in ft.COLLECTED for p in glob.glob(g)})))`

test('S1: --shard-plan N puts every collected test and the self-tests in exactly one shard', () => {
  const expected = new Set([SELF_TESTS, ...py(COLLECT).split('\n').filter(Boolean)])
  assert.ok(expected.size > 50, `the collected set is the real tree's (${expected.size})`)
  const wfN = shardN()
  for (const n of [...new Set([1, 3, wfN])]) {
    const plan = () => {
      const r = spawnSync('bash', ['tests/run.sh', '--shard-plan', String(n)], { cwd: root, encoding: 'utf8' })
      assert.equal(r.status, 0, `--shard-plan ${n} exits 0: ${r.stderr}`)
      return r.stdout
    }
    const out = plan()
    assert.equal(plan(), out, `--shard-plan ${n} is deterministic`)
    const seen = new Map()
    for (const line of out.split('\n').filter(Boolean)) {
      const m = /^(\d+)\t(.+)$/.exec(line)
      assert.ok(m, `--shard-plan ${n}: a <k>\\t<entry> line: ${JSON.stringify(line)}`)
      const k = Number(m[1])
      assert.ok(k >= 1 && k <= n, `--shard-plan ${n}: ${m[2]} in shard ${k}, out of 1..${n}`)
      assert.ok(!seen.has(m[2]), `--shard-plan ${n}: ${m[2]} appears once`)
      assert.ok(expected.has(m[2]), `--shard-plan ${n}: ${m[2]} is a collected test`)
      seen.set(m[2], k)
    }
    assert.deepEqual([...expected].filter((e) => !seen.has(e)), [], `--shard-plan ${n}: every collected test is in a shard`)
    assert.equal(seen.get(SELF_TESTS), 1, `--shard-plan ${n}: the self-tests run in shard 1`)
    if (n === wfN) {
      for (let k = 1; k <= n; k++) {
        assert.ok([...seen].some(([e, s]) => s === k && e !== SELF_TESTS), `shard ${k}/${n} holds at least one test file`)
      }
    }
  }
})
