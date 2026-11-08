// p43-3 (ADR 0073 d3, ADR 0025): the CI workflows. A PR's two required checks run the fast tier against the PR's base;
// every push to master runs the full suite as a matrix of shards, split by tests/lib/shard.py.
// - W1: test.yml's job `test` expands, over its matrix, to exactly the two required-check names, carries no job-level
//   `if:` (a skipped required job reports success), and runs on pull_request only.
// - W2: that job runs `make test-fast` with THREAD_VERIFY_BASE the PR's base sha, on a full-history checkout, under one
//   plain timeout-minutes (merge-task's CI headroom record reads only a whole number; the value is p43-6's audit's).
// - W3: no other job in any workflow takes a required-check name, by expansion or by merge-gate.py's rules 1-3; and
//   full-suite.yml runs on push to master only.
// - W4: full-suite.yml's shard matrix and its run line agree on N, and each OS has its own timeout-minutes (p43-6's
//   audit: about twice that OS's slowest shard).
// - W5: every .github/workflows/*.yml parses (PyYAML) to a mapping with `jobs` (check-workflow-parse.sh covers only
//   the *.workflow.js scripts).
// - S1: `bash tests/run.sh --shard-plan N` on the real tree puts every collected test (fast-tier.py's COLLECTED, which
//   tests/fast-tier.test.sh C3 pins to run.sh's globs) and the merge-task self-tests in exactly one shard.
// tests/fast-tier.test.sh pins run.sh's --shard and --shard-plan modes on a fixture. Reads the tree; writes nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WF = '.github/workflows'
const REQUIRED = ['make test (ubuntu-latest)', 'make test (macos-latest)']
const OSES = ['ubuntu-latest', 'macos-latest']
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

test('W1: test.yml\'s job `test` is the two required checks, unskippable, on pull_request only (ADR 0025)', () => {
  const wf = parsed[TEST]
  const job = wf.jobs.test
  assert.ok(job, 'job id test')
  assert.equal(job.name, 'make test (${{ matrix.os }})')
  assert.deepEqual(job.strategy.matrix.os, OSES)
  assert.deepEqual(expand(job.name, job.strategy.matrix), REQUIRED)
  assert.equal(job.strategy['fail-fast'], false)
  assert.equal(job.if, undefined, 'no job-level if: a skipped required job reports success')
  const trig = on(wf)
  assert.ok(trig && typeof trig === 'object' && 'pull_request' in trig, 'on: holds pull_request')
  assert.ok(!('push' in trig), 'on: holds no push (the full suite runs on master in full-suite.yml)')
})

test('W2: the PR job runs the fast tier against the PR\'s base, on a full-history checkout', () => {
  const job = parsed[TEST].jobs.test
  const last = runSteps(job).at(-1)
  assert.equal(last.run.trim(), 'make test-fast')
  assert.equal(last.env.THREAD_VERIFY_BASE, '${{ github.event.pull_request.base.sha }}')
  assert.equal(last.env.THREAD_TEST_JOBS, '4')
  assert.equal(checkout(job)?.with?.['fetch-depth'], 0, 'fetch-depth: 0, so the base sha and merge-base resolve')
  assert.equal(job['timeout-minutes'], 55)
})

test('W3: no other job takes a required-check name; full-suite.yml runs on push to master only', () => {
  for (const f of files) {
    for (const [id, job] of Object.entries(parsed[f].jobs)) {
      if (f === TEST && id === 'test') continue
      const names = typeof job.name === 'string' ? expand(job.name, job.strategy?.matrix) : [id]
      for (const ctx of REQUIRED) {
        assert.ok(!names.includes(ctx), `${f} job ${id} expands to ${ctx}`)
        assert.ok(!takes(id, job, ctx), `${f} job ${id} matches ${ctx} by merge-gate's rules`)
      }
    }
  }
  const trig = on(parsed[FULL])
  assert.deepEqual(Object.keys(trig), ['push'], 'full-suite.yml runs on push only, no PR event')
  assert.deepEqual(trig.push.branches, ['master'])
})

// The shard count N: full-suite.yml's matrix, which the run line must repeat.
const shardJob = () => {
  const jobs = Object.values(parsed[FULL].jobs)
  assert.equal(jobs.length, 1, 'full-suite.yml has one job, the shard matrix')
  return jobs[0]
}
const shardN = () => shardJob().strategy.matrix.shard.length
// limits(job): each OS's timeout-minutes. A whole number holds for both OSes; the one other form is
// `${{ matrix.os == '<os>' && <a> || <b> }}`, <a> for <os> and <b> for the other. Anything else fails, showing the value.
const LIMIT_EXPR = /^\$\{\{\s*matrix\.os\s*==\s*'([^']+)'\s*&&\s*(\d+)\s*\|\|\s*(\d+)\s*\}\}$/
const limits = (job) => {
  const v = job['timeout-minutes']
  if (Number.isInteger(v)) return Object.fromEntries(OSES.map((os) => [os, v]))
  const m = typeof v === 'string' ? LIMIT_EXPR.exec(v) : null
  assert.ok(m && OSES.includes(m[1]), `timeout-minutes is a whole number or the matrix.os form: ${JSON.stringify(v)}`)
  return Object.fromEntries(OSES.map((os) => [os, Number(os === m[1] ? m[2] : m[3])]))
}

test('W4: the shard matrix covers both OSes and shards 1..N, and the run line names the same N', () => {
  const job = shardJob()
  const n = shardN()
  assert.ok(n >= 2, `N is at least 2, got ${n}`)
  assert.deepEqual(job.strategy.matrix.os, OSES)
  assert.deepEqual(job.strategy.matrix.shard, Array.from({ length: n }, (_, i) => i + 1))
  assert.equal(job.strategy['fail-fast'], false)
  assert.deepEqual(limits(job), { 'ubuntu-latest': 20, 'macos-latest': 35 })
  assert.equal(job['runs-on'], '${{ matrix.os }}')
  const last = runSteps(job).at(-1)
  assert.equal(last.run.trim(), `bash tests/run.sh --shard \${{ matrix.shard }}/${n}`)
  assert.equal(last.env.THREAD_TEST_JOBS, '4')
  assert.equal(checkout(job)?.with?.['persist-credentials'], false)
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
