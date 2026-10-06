// skills/retro/scripts/tune.py — the only writer of rollouts.toml and tunings.jsonl (p15-5, ADR 0032): it edits
// only the picked keys, records one `tuning` line per Retro, and writes nothing when anything is refused.
//
// Hermetic: each case gets its own mkdtemp HOME (so rollouts.toml is <HOME>/.config/thread/rollouts.toml), its own
// THREAD_EVENTS_DIR, an env built from scratch with that HOME as cwd, and a temp git repo whose origin is
// https://github.com/o/r.git (land.sh --origin-slug reads it locally, no network). The scores are built by hand in
// score.py's shape, except where the replace-failure case reads the record back through score.py itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TUNE = path.join(root, 'skills', 'retro', 'scripts', 'tune.py')
const SCORE = path.join(root, 'skills', 'retro', 'scripts', 'score.py')
const SETTINGS = path.join(root, 'skills', '_shared', 'scripts', 'rollout-settings.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
const TAKES_EFFECT = 'takes effect at the next /thread:schedule (or --regenerate); a rollout note already stamped keeps its own values'

// ---- helpers ----------------------------------------------------------------------------------------------

function tmpHome(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'retro-tune-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

const evDir = (home) => path.join(home, 'events')
const env = (home, extra = {}) => ({ PATH: process.env.PATH, HOME: home, PYTHONDONTWRITEBYTECODE: '1', THREAD_EVENTS_DIR: evDir(home), ...extra })
const tomlPath = (home) => path.join(home, '.config', 'thread', 'rollouts.toml')
const tuningsPath = (home) => path.join(evDir(home), 'tunings.jsonl')
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

function gitRepo(home, url = 'https://github.com/o/r.git', name = 'repo') {
  const dir = path.join(home, name)
  fs.mkdirSync(dir, { recursive: true })
  execFileSync(REAL_GIT, ['init', '-q', dir])
  if (url) execFileSync(REAL_GIT, ['-C', dir, 'remote', 'add', 'origin', url])
  return dir
}

function writeToml(home, text) {
  const p = tomlPath(home)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
  return p
}

const WINDOW = { since: '2026-10-05T00:00:00.000Z', until: '2026-10-05T12:00:00.000Z', activeStart: '2026-10-05T00:00:00.000Z', activeEnd: '2026-10-05T09:00:00.000Z', partial: false }
const HEADLINE = { throughput: 0.857, runningHours: 7, merges: 6, tokensPerMerge: 100000, setAsideRate: 0, conflictRate: 0, quotaStalls: 0 }
const P = (id, key, from, to, extra = {}) => ({ id, key, from, to, ranAt: from, ranAtCause: null, rule: `${key}-rule`, direction: Math.sign(to - from), evidence: `evidence for ${key}`, agreeing: 0, ...extra })

function writeScores(home, { repo = 'o/r', proposals = [], withheld = [] } = {}) {
  const p = path.join(home, 'score.json')
  fs.writeFileSync(p, JSON.stringify({ rollout: 'demo-rollout', repo, window: WINDOW, headline: HEADLINE, binding: { constraint: 'slot-bound', why: 'x' }, proposals, withheld, flags: [] }))
  return p
}

function tune(home, args, { extra = {} } = {}) {
  const r = spawnSync('python3', ['-B', TUNE, ...args], { encoding: 'utf8', cwd: home, env: env(home, extra) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function resolved(home, repo) {
  const r = spawnSync('python3', ['-B', SETTINGS, '--repo', repo], { encoding: 'utf8', cwd: home, env: env(home) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

// Refused (exit `code`): one `tune: ` line on stderr, the config bytes (or its absence) unchanged, no record.
function refusedNothingWritten(home, args, code, re, before) {
  const r = tune(home, args)
  assert.equal(r.status, code, `stderr: ${r.stderr}`)
  assert.match(r.stderr, re)
  assert.equal(r.stdout, '')
  if (before === null) assert.ok(!fs.existsSync(tomlPath(home)), 'no config created')
  else assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), before, 'the config is byte-identical')
  assert.ok(!fs.existsSync(tuningsPath(home)), 'no tunings.jsonl')
  return r
}

const CONFIG = [
  '# operator settings',
  '[defaults]',
  'parallel_ceiling = 4',
  '',
  '[guardrails]',
  'quota_stalls = 0',
  '',
  '[repo."o/r"]',
  'parallel_ceiling = 3   # hand-raised for the Chorus run',
  'max_review_rounds = 4',
  '',
].join('\n')

// ---- picks --------------------------------------------------------------------------------------------------

test('pick p1 of p1, p2: only that key changes, its comment kept, and one tuning line lands', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  writeToml(home, CONFIG)
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 3, 4, { ranAt: 3, rule: 'slot-bound-raise' }), P('p2', 'max_review_rounds', 4, 5)] })
  const r = tune(home, ['--scores', scores, '--pick', 'p1', '--repo', repo])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), CONFIG.replace('parallel_ceiling = 3   # hand', 'parallel_ceiling = 4   # hand'))
  const [l, ...rest] = lines(tuningsPath(home))
  assert.equal(rest.length, 0)
  assert.equal(l.kind, 'tuning')
  assert.equal(l.rollout, 'demo-rollout')
  assert.equal(l.task, null)
  assert.match(l.id, /^t-\d{8}T\d{6}Z-[0-9a-f]{6}$/)
  assert.equal(l.repo, 'o/r')
  assert.deepEqual(l.window, WINDOW)
  assert.deepEqual(l.scores, HEADLINE)
  assert.equal(l.binding, 'slot-bound')
  assert.deepEqual(l.applied, [{ key: 'parallel_ceiling', from: 3, to: 4, ranAt: 3, rule: 'slot-bound-raise', evidence: 'evidence for parallel_ceiling', agreeing: 0 }])
  assert.equal(r.stdout.split('\n').filter(Boolean).at(-1), `applied parallel_ceiling 3 → 4 for o/r: ${TAKES_EFFECT}`)
  assert.match(r.stdout, new RegExp(`^recorded ${l.id} in `))
  assert.deepEqual(resolved(home, repo).settings.parallel_ceiling, { value: 4, source: 'file:repo' })
})

test('two picks: one line carrying both applied entries; a repeated id counts once', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  writeToml(home, CONFIG)
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 3, 4), P('p2', 'max_review_rounds', 4, 5)] })
  const r = tune(home, ['--scores', scores, '--pick', 'p1,p2,p1', '--repo', repo])
  assert.equal(r.status, 0, r.stderr)
  const all = lines(tuningsPath(home))
  assert.equal(all.length, 1)
  assert.deepEqual(all[0].applied.map((a) => [a.key, a.from, a.to]), [['parallel_ceiling', 3, 4], ['max_review_rounds', 4, 5]])
  const s = resolved(home, repo).settings
  assert.deepEqual([s.parallel_ceiling, s.max_review_rounds], [{ value: 4, source: 'file:repo' }, { value: 5, source: 'file:repo' }])
  assert.equal(r.stdout.split('\n').filter((x) => x.startsWith('applied ')).length, 2)
})

test('the first Tuning on a repo: no config, a [defaults]-only one, a comment-only one', (t) => {
  for (const [name, text, from, expected] of [
    ['no config', null, 4, '[repo."o/r"]\nparallel_ceiling = 5\n'],
    ['[defaults] only', '[defaults]\nparallel_ceiling = 2\n', 2, '[defaults]\nparallel_ceiling = 2\n\n[repo."o/r"]\nparallel_ceiling = 3\n'],
    ['comment only', '# nothing yet\n', 4, '# nothing yet\n\n[repo."o/r"]\nparallel_ceiling = 5\n'],
  ]) {
    const home = tmpHome(t)
    const repo = gitRepo(home)
    if (text !== null) writeToml(home, text)
    const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', from, from + 1)] })
    const r = tune(home, ['--scores', scores, '--pick', 'p1', '--repo', repo])
    assert.equal(r.status, 0, `${name}: ${r.stderr}`)
    assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), expected, name)
    assert.deepEqual(resolved(home, repo).settings.parallel_ceiling, { value: from + 1, source: 'file:repo' }, name)
    assert.equal(lines(tuningsPath(home)).length, 1, name)
  }
})

test('a table without the key gets it inserted after its last key; the repo key matches ignoring case', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  const text = '[repo."O/R"]\nmax_review_rounds = 4  # kept\n\n[repo."o/other"]\nparallel_ceiling = 9\n'
  writeToml(home, text)
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 4, 5)] })
  const r = tune(home, ['--scores', scores, '--pick', 'p1', '--repo', repo])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), '[repo."O/R"]\nmax_review_rounds = 4  # kept\nparallel_ceiling = 5\n\n[repo."o/other"]\nparallel_ceiling = 9\n')
})

test('an O/R origin is accepted for scores on o/r', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home, 'git@github.com:O/R.git')
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 4, 5)] })
  const r = tune(home, ['--scores', scores, '--pick', 'p1', '--repo', repo])
  assert.equal(r.status, 0, r.stderr)
  assert.match(fs.readFileSync(tomlPath(home), 'utf8'), /^\[repo\."o\/r"\]\nparallel_ceiling = 5\n$/)
})

test('a symlinked config: the target is edited and the link kept', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  const target = path.join(home, 'dotfiles', 'rollouts.toml')
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, CONFIG)
  fs.mkdirSync(path.dirname(tomlPath(home)), { recursive: true })
  fs.symlinkSync(target, tomlPath(home))
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 3, 4)] })
  const r = tune(home, ['--scores', scores, '--pick', 'p1', '--repo', repo])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(fs.lstatSync(tomlPath(home)).isSymbolicLink(), 'the link stays a link')
  assert.match(fs.readFileSync(target, 'utf8'), /^parallel_ceiling = 4 {3}# hand-raised/m)
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['rollouts.toml'], 'no temp file left beside the target')
})

test('--dry-run prints the diff and the line it would write, and writes nothing', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 4, 5)] })
  const r = tune(home, ['--scores', scores, '--pick', 'p1', '--repo', repo, '--dry-run'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^\+parallel_ceiling = 5$/m)
  assert.match(r.stdout, /^would record t-\S+ in \S+tunings\.jsonl: \{/m)
  assert.ok(!fs.existsSync(path.join(home, '.config')), 'no config, no directory')
  assert.ok(!fs.existsSync(evDir(home)))
})

// ---- identity -----------------------------------------------------------------------------------------------

test('identity: no origin, another repo, or a --repo that is no directory is refused, nothing written', (t) => {
  const home = tmpHome(t)
  writeToml(home, CONFIG)
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 3, 4)] })
  refusedNothingWritten(home, ['--scores', scores, '--pick', 'p1', '--repo', gitRepo(home, null, 'bare')], 2, /^tune: --repo \S+ has no GitHub origin \(land\.sh exit 4\)/, CONFIG)
  refusedNothingWritten(home, ['--scores', scores, '--pick', 'p1', '--repo', gitRepo(home, 'https://github.com/o/other.git', 'other')], 2, /^tune: --repo \S+ is o\/other, but the scores are for o\/r\n$/, CONFIG)
  refusedNothingWritten(home, ['--scores', scores, '--pick', 'p1', '--repo', path.join(home, 'nope')], 2, /^tune: --repo \S+ is not a directory\n$/, CONFIG)
  refusedNothingWritten(home, ['--scores', scores, '--pick', 'p1'], 2, /^tune: --pick needs --repo/, CONFIG)
})

// ---- refusals -----------------------------------------------------------------------------------------------

test('refused with exit 2 and nothing written: stale from, unknown, withheld and same-key picks, dotted and inline forms', (t) => {
  const cases = [
    ['a stale from', CONFIG, [P('p1', 'parallel_ceiling', 4, 5)], [], 'p1', /^tune: p1's from is stale: parallel_ceiling is 3 now, not 4/],
    ['an unknown id', CONFIG, [P('p1', 'parallel_ceiling', 3, 4)], [], 'p9', /^tune: p9 is no proposal in the scores/],
    ['a withheld id', CONFIG, [P('p1', 'parallel_ceiling', 3, 4)], [{ ...P('p2', 'max_plan_rounds', 3, 3), reason: 'already at 3' }], 'p2', /^tune: p2 is withheld \(already at 3\)/],
    ['two picks on one key', CONFIG, [P('p1', 'parallel_ceiling', 3, 4), P('p2', 'parallel_ceiling', 3, 2)], [], 'p1,p2', /^tune: two picks on one key \(parallel_ceiling\)/],
    ['a dotted key under [repo]', '[repo]\n"o/r".parallel_ceiling = 3\n', [P('p1', 'parallel_ceiling', 3, 4)], [], 'p1', /dotted or inline-table form/],
    ['a top-level dotted key', 'repo."o/r".parallel_ceiling = 3\n', [P('p1', 'parallel_ceiling', 3, 4)], [], 'p1', /dotted or inline-table form/],
    ['an inline table', 'repo = { "o/r" = { parallel_ceiling = 3 } }\n', [P('p1', 'parallel_ceiling', 3, 4)], [], 'p1', /dotted or inline-table form/],
    ['a refused config', '[defaults]\nparallel_ceiling = 0\n', [P('p1', 'parallel_ceiling', 3, 4)], [], 'p1', /^tune: rollout-settings: \S+rollouts\.toml:2: \[defaults\] parallel_ceiling must be an integer >= 1/],
  ]
  for (const [name, text, proposals, withheld, pick, re] of cases) {
    const home = tmpHome(t)
    const repo = gitRepo(home)
    writeToml(home, text)
    const scores = writeScores(home, { proposals, withheld })
    refusedNothingWritten(home, ['--scores', scores, '--pick', pick, '--repo', repo], 2, re, text)
  }
})

test('usage: --pick and --record-only are exclusive and one is required', (t) => {
  const home = tmpHome(t)
  const scores = writeScores(home)
  for (const args of [['--scores', scores], ['--scores', scores, '--pick', 'p1', '--record-only']]) {
    const r = tune(home, args)
    assert.equal(r.status, 2)
    assert.match(r.stderr, /^tune: /)
  }
})

// ---- partial failure ----------------------------------------------------------------------------------------

test('an unwritable events dir: exit 1, the config untouched (an absent one stays absent, no dir left)', (t) => {
  for (const text of [CONFIG, null]) {
    const home = tmpHome(t)
    const repo = gitRepo(home)
    if (text !== null) writeToml(home, text)
    fs.writeFileSync(path.join(home, 'afile'), '')
    const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', text ? 3 : 4, text ? 4 : 5)] })
    const r = tune(home, ['--scores', scores, '--pick', 'p1', '--repo', repo], { extra: { THREAD_EVENTS_DIR: path.join(home, 'afile', 'events') } })
    assert.equal(r.status, 1, r.stderr)
    assert.match(r.stderr, /run_record: warning: cannot write/)
    assert.match(r.stderr, /^tune: nothing applied: the Retro's line could not be written/m)
    if (text === null) assert.ok(!fs.existsSync(path.join(home, '.config')), 'the created directory is removed again')
    else {
      assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), text)
      assert.deepEqual(fs.readdirSync(path.dirname(tomlPath(home))), ['rollouts.toml'], 'no temp file left')
    }
  }
})

// One Slot-bound run at ceiling 3 through run_record's own emit, for score.py to read back.
function slotBoundRecord(home) {
  const ev = []
  for (const [i, s] of ['a', 'b', 'c'].entries()) {
    const free = `2026-10-05T04:${i}0:00Z`
    const done = `2026-10-05T04:${i}5:00Z`
    ev.push(['2026-10-05T00:00:00Z', 'slot-taken', s, { settings: { parallel_ceiling: 3, max_review_rounds: 4, max_iterations: 3, max_plan_rounds: 3 } }],
      [free, 'slot-freed', s, { outcome: 'ready' }], [free, 'ready', s, {}], [free, 'lane-taken', s, {}],
      [done, 'lane-freed', s, { release: 'merge' }], [done, 'merged', s, {}])
  }
  ev.sort((x, y) => Date.parse(x[0]) - Date.parse(y[0]))
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("rr", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, f in json.load(sys.stdin):', '    assert m.emit("demo-rollout", kind, task, f, ts=ts, strict=True)'].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', cwd: home, env: env(home), input: JSON.stringify(ev) })
  assert.equal(r.status, 0, r.stderr)
}

test('a replace failure after the line landed: exit 1, the config unchanged, a voids line; score.py ignores the void', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  writeToml(home, CONFIG)
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 3, 4, { ranAt: 3, rule: 'slot-bound-raise' })] })
  const harness = [
    'import importlib.util, sys',
    'spec = importlib.util.spec_from_file_location("tune", sys.argv[1])',
    'tune = importlib.util.module_from_spec(spec); spec.loader.exec_module(tune)',
    'def boom(*a, **k):',
    '    raise OSError(28, "No space left on device")',
    'tune.os.replace = boom',
    'sys.exit(tune.main(sys.argv[2:]))',
  ].join('\n')
  const r = spawnSync('python3', ['-B', '-c', harness, TUNE, '--scores', scores, '--pick', 'p1', '--repo', repo], { encoding: 'utf8', cwd: home, env: env(home) })
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /^tune: rollouts\.toml was not written \(.*No space left on device\): nothing applied; t-\S+ voided by t-\S+\n$/)
  assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), CONFIG)
  assert.deepEqual(fs.readdirSync(path.dirname(tomlPath(home))), ['rollouts.toml'])
  const [applied, voids] = lines(tuningsPath(home))
  assert.equal(applied.applied.length, 1)
  assert.equal(voids.voids, applied.id)
  assert.deepEqual(voids.applied, [])
  assert.deepEqual(voids.scores, applied.scores)
  // score.py: the voided Tuning neither agrees with a new proposal nor serves as its cause
  slotBoundRecord(home)
  const sj = path.join(home, 'settings.json')
  fs.writeFileSync(sj, JSON.stringify(resolved(home, repo)))
  const s = spawnSync('python3', ['-B', SCORE, '--rollout', 'demo-rollout', '--until', '2026-10-05T06:00:00Z', '--settings', sj], { encoding: 'utf8', cwd: home, env: env(home) })
  assert.equal(s.status, 0, s.stderr)
  const out = JSON.parse(s.stdout)
  assert.equal(out.binding.constraint, 'slot-bound')
  assert.deepEqual(out.proposals.map((p) => [p.key, p.from, p.to, p.agreeing]), [['parallel_ceiling', 3, 4, 0]])
})

// ---- record-only --------------------------------------------------------------------------------------------

test('--record-only writes one line with applied [] and never reads the config (a refused one included)', (t) => {
  const home = tmpHome(t)
  const bad = writeToml(home, '[defaults]\nparallel_ceiling = 0\n')
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 3, 4)] })
  const r = tune(home, ['--scores', scores, '--record-only'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const [l, ...rest] = lines(tuningsPath(home))
  assert.equal(rest.length, 0)
  assert.deepEqual(l.applied, [])
  assert.deepEqual(l.scores, HEADLINE)
  assert.match(r.stdout, new RegExp(`^recorded ${l.id} in \\S+: no Tuning applied`))
  assert.equal(fs.readFileSync(bad, 'utf8'), '[defaults]\nparallel_ceiling = 0\n')
})

test('null repo: --record-only writes nothing and says so (exit 0); --pick is exit 2', (t) => {
  const home = tmpHome(t)
  const scores = writeScores(home, { repo: null })
  const r = tune(home, ['--scores', scores, '--record-only'])
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'tune: not recorded: the scores carry no repo (no GitHub origin), so no baseline is kept\n')
  assert.ok(!fs.existsSync(evDir(home)))
  refusedNothingWritten(home, ['--scores', scores, '--pick', 'p1', '--repo', gitRepo(home)], 2, /^tune: p1 is no proposal in the scores \(proposals: none\)/, null)
})

test('tune.py parses as python 3.8', () => {
  const r = spawnSync('python3', ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 8))', TUNE], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
