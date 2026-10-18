// skills/reflect/scripts/tune.py — the only writer of rollouts.toml and tunings.jsonl (p15-5, ADR 0032): it edits
// only the picked keys, records one `tuning` line per by-hand Reflection, lands and reverts the weekly reading's knobs
// (p21-7, --auto and --revert), and writes nothing when anything is refused.
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
const TUNE = path.join(root, 'skills', 'reflect', 'scripts', 'tune.py')
const SCORE = path.join(root, 'skills', 'reflect', 'scripts', 'score.py')
const SETTINGS = path.join(root, 'skills', '_shared', 'scripts', 'rollout-settings.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
const TAKES_EFFECT = 'takes effect at the next /thread:schedule (or --regenerate); a rollout note already stamped keeps its own values'

// ---- helpers ----------------------------------------------------------------------------------------------

function tmpHome(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-tune-')))
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
// score.py's ten scores (p21-2): the old seven, then the Hands-off rate and the Quality and Review churn slots
const HEADLINE = { throughput: 0.857, runningHours: 7, merges: 6, tokensPerMerge: 100000, setAsideRate: 0, conflictRate: 0, quotaStalls: 0,
  handsOffRate: 0.8333, quality: null, reviewChurn: null }
const P = (id, key, from, to, extra = {}) => ({ id, key, from, to, ranAt: from, ranAtCause: null, rule: `${key}-rule`, direction: Math.sign(to - from), evidence: `evidence for ${key}`, agreeing: 0, ...extra })

function writeScores(home, { repo = 'o/r', proposals = [], withheld = [], headline = HEADLINE, window = WINDOW, guardrails, ranAt, rollout = 'demo-rollout' } = {}) {
  const p = path.join(home, 'score.json')
  fs.writeFileSync(p, JSON.stringify({ rollout, repo, window, headline, binding: { constraint: 'slot-bound', why: 'x' }, proposals, withheld, flags: [],
    ...(guardrails ? { guardrails } : {}), ...(ranAt ? { ranAt } : {}) }))
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
  assert.equal(l.v, 2, 'a tuning line is v2: its ten scores')
  assert.equal(l.repo, 'o/r')
  assert.deepEqual(l.window, WINDOW)
  assert.deepEqual(l.scores, HEADLINE)
  assert.equal(l.binding, 'slot-bound')
  assert.deepEqual(l.applied, [{ key: 'parallel_ceiling', from: 3, to: 4, ranAt: 3, rule: 'slot-bound-raise', evidence: 'evidence for parallel_ceiling', agreeing: 0 }])
  assert.equal(r.stdout.split('\n').filter(Boolean).at(-1), `applied parallel_ceiling 3 → 4 for o/r: ${TAKES_EFFECT}`)
  assert.match(r.stdout, new RegExp(`^recorded ${l.id} in `))
  assert.deepEqual(resolved(home, repo).settings.parallel_ceiling, { value: 4, source: 'file:repo' })
})

test('a proposal carrying a trade and a caution (p21-2) is pickable: they are Lachy\'s call, not a withhold', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  writeToml(home, CONFIG)
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 3, 2, { rule: 'quota-bound-lower', serves: ['quotaStalls'], risks: ['throughput'],
    trade: null, caution: 'risks throughput, breached (4.667 running h against 4.0 h, <= 1 running h per task): a Guardrail against a Guardrail, Lachy decides' }),
  P('p2', 'max_review_rounds', 4, 5, { rule: 'review-rounds-raise', serves: ['handsOffRate'], risks: ['quality'], trade: { gains: ['handsOffRate'], costs: ['quality'] }, caution: null })] })
  const r = tune(home, ['--scores', scores, '--pick', 'p1,p2', '--repo', repo])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(lines(tuningsPath(home))[0].applied.map((a) => [a.key, a.from, a.to, a.rule]),
    [['parallel_ceiling', 3, 2, 'quota-bound-lower'], ['max_review_rounds', 4, 5, 'review-rounds-raise']])
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

// [notify] (ADR 0038 d3) is machine-wide: a Tuning never touches it. tune.py edits rollouts.toml line by line, so the table
// survives byte for byte, and a guard beside the Guardrails' refuses any edit whose result resolves another [notify].
const NOTIFY_CONFIG = '[defaults]\nparallel_ceiling = 4\n\n[notify]\nntfy_topic = "t"   # the needs-you fallback\n'

test('a config ending in [notify] gains [repo."o/r"] after a Tuning, the [notify] lines byte for byte', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  writeToml(home, NOTIFY_CONFIG)
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 4, 5)] })
  const r = tune(home, ['--scores', scores, '--pick', 'p1', '--repo', repo])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), `${NOTIFY_CONFIG}\n[repo."o/r"]\nparallel_ceiling = 5\n`)
  assert.deepEqual(resolved(home, repo).notify, { ntfy_topic: { value: 't', source: 'file:notify' } })
})

test('an edit that would change [notify] is refused: exit 2, nothing written', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  writeToml(home, NOTIFY_CONFIG)
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 4, 5)] })
  // A future edit path that drops the topic: edit_text's result with the ntfy_topic line removed.
  const r = spawnSync('python3', ['-B', '-c', `import importlib.util, sys
spec = importlib.util.spec_from_file_location('tune', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
real = m.edit_text
m.edit_text = lambda *a: '\\n'.join(l for l in real(*a).split('\\n') if not l.startswith('ntfy_topic'))
sys.exit(m.main(sys.argv[2:]))`, TUNE, '--scores', scores, '--pick', 'p1', '--repo', repo], { encoding: 'utf8', cwd: home, env: env(home) })
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, /^tune: the edit changes \[notify\]: nothing written\n$/)
  assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), NOTIFY_CONFIG, 'the config is byte-identical')
  assert.ok(!fs.existsSync(tuningsPath(home)), 'no tunings.jsonl')
  assert.deepEqual(fs.readdirSync(path.dirname(tomlPath(home))), ['rollouts.toml'], 'no temp file left')
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

test('usage: --pick and --record-only are exclusive and one is required (--auto and --revert too)', (t) => {
  const home = tmpHome(t)
  const scores = writeScores(home)
  for (const args of [['--scores', scores], ['--scores', scores, '--pick', 'p1', '--record-only'],
    ['--scores', scores, '--auto', '--revert', 't-x', '--reflection', 'r-x']]) {
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
    assert.match(r.stderr, /^tune: nothing applied: the Reflection's line could not be written/m)
    if (text === null) assert.ok(!fs.existsSync(path.join(home, '.config')), 'the created directory is removed again')
    else {
      assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), text)
      assert.deepEqual(fs.readdirSync(path.dirname(tomlPath(home))), ['rollouts.toml'], 'no temp file left')
    }
  }
})

test('a config directory that cannot be made: exit 1 with one tune: line, no traceback, nothing written', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  const locked = path.join(home, 'locked')
  fs.mkdirSync(locked)
  const config = path.join(locked, 'thread', 'rollouts.toml')
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 4, 5)] })
  fs.chmodSync(locked, 0o555)
  let r
  try {
    r = tune(home, ['--scores', scores, '--pick', 'p1', '--repo', repo, '--config', config])
  } finally {
    fs.chmodSync(locked, 0o755)
  }
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /^tune: cannot write next to .*rollouts\.toml: .*Permission denied.*\n$/)
  assert.doesNotMatch(r.stderr, /Traceback/)
  assert.equal(r.stdout, '')
  assert.deepEqual(fs.readdirSync(locked), [], 'no directory made')
  assert.ok(!fs.existsSync(tuningsPath(home)), 'no tunings.jsonl')
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

test('--record-only from a stale seven-score headline (a v1 score.json) records the three new keys as null', (t) => {
  const home = tmpHome(t)
  const { handsOffRate, quality, reviewChurn, ...seven } = HEADLINE
  const r = tune(home, ['--scores', writeScores(home, { headline: seven }), '--record-only'])
  assert.equal(r.status, 0, r.stderr)
  const [l] = lines(tuningsPath(home))
  assert.equal(l.v, 2)
  assert.deepEqual(l.scores, { ...seven, handsOffRate: null, quality: null, reviewChurn: null })
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

// ---- --close (p21-6, ADR 0037 d4): close-score.py's record-only line, one per rollout ----------------------------

// A tunings.jsonl line written by hand in run_record's shape (the guard reads lines, it never re-validates them).
const handLine = (over = {}) => JSON.stringify({ v: 2, ts: '2026-10-05T12:00:00.000Z', host: 'h', rollout: 'demo-rollout', task: null,
  kind: 'tuning', id: 't-hand', repo: 'o/r', window: WINDOW, scores: HEADLINE, applied: [], ...over })

test('--record-only --close completion stamps close; a second run writes nothing and names the first line', (t) => {
  const home = tmpHome(t)
  const scores = writeScores(home)
  const r = tune(home, ['--scores', scores, '--record-only', '--close', 'completion'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const [l, ...rest] = lines(tuningsPath(home))
  assert.equal(rest.length, 0)
  assert.equal(l.close, 'completion')
  assert.deepEqual(l.applied, [])
  assert.match(r.stdout, new RegExp(`^recorded ${l.id} in \\S+: no Tuning applied`))
  const again = tune(home, ['--scores', scores, '--record-only', '--close', 'completion'])
  assert.equal(again.status, 0, again.stderr)
  assert.equal(again.stdout, `already recorded ${l.id} (completion) in ${tuningsPath(home)}: nothing written\n`)
  assert.equal(again.stderr, '')
  const sup = tune(home, ['--scores', scores, '--record-only', '--close', 'supersede'])
  assert.equal(sup.stdout, `already recorded ${l.id} (completion) in ${tuningsPath(home)}: nothing written\n`, 'one close line per rollout, whatever the kind')
  assert.equal(lines(tuningsPath(home)).length, 1)
})

test('--close is not blocked by a by-hand line, another rollout\'s close line, a voided close line or a malformed line', (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(evDir(home), { recursive: true })
  fs.writeFileSync(tuningsPath(home), [
    handLine({ id: 't-byhand' }),
    handLine({ id: 't-other', rollout: 'other-rollout', close: 'completion' }),
    handLine({ id: 't-void', close: 'completion' }),
    handLine({ id: 't-voider', voids: 't-void' }),
    '{"kind": "tuning", "rollout": "demo-rollout", "close": "completion", "id": "t-cut',
    '',
  ].join('\n'))
  const r = tune(home, ['--scores', writeScores(home), '--record-only', '--close', 'supersede'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^recorded t-\S+ in /)
  const raw = fs.readFileSync(tuningsPath(home), 'utf8').split('\n').filter(Boolean)
  assert.equal(raw.length, 6, 'the five seeded lines and the new one')
  const last = JSON.parse(raw.at(-1))
  assert.equal(last.close, 'supersede')
  assert.equal(last.rollout, 'demo-rollout')
})

test('--close over a tunings.jsonl that cannot be read: exit 1, nothing written', { skip: process.getuid?.() === 0 && 'root ignores the mode' }, (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(evDir(home), { recursive: true })
  fs.writeFileSync(tuningsPath(home), `${handLine({ id: 't-byhand' })}\n`)
  fs.chmodSync(tuningsPath(home), 0o000)
  t.after(() => { try { fs.chmodSync(tuningsPath(home), 0o644) } catch { /* gone */ } })
  const r = tune(home, ['--scores', writeScores(home), '--record-only', '--close', 'completion'])
  fs.chmodSync(tuningsPath(home), 0o644)
  assert.equal(r.status, 1, r.stderr)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^tune: tunings\.jsonl cannot be read: .*Permission denied.*: nothing written\n$/)
  assert.equal(lines(tuningsPath(home)).length, 1)
})

test('--close needs --record-only; a bad --close value is refused; both write nothing', (t) => {
  const home = tmpHome(t)
  writeToml(home, CONFIG)
  const scores = writeScores(home, { proposals: [P('p1', 'parallel_ceiling', 3, 4, { ranAt: 3, rule: 'slot-bound-raise' })] })
  refusedNothingWritten(home, ['--scores', scores, '--pick', 'p1', '--repo', gitRepo(home), '--close', 'completion'], 2, /^tune: --close needs --record-only\n$/, CONFIG)
  refusedNothingWritten(home, ['--scores', scores, '--record-only', '--close', 'weekly'], 2, /^tune: argument --close: invalid choice/, CONFIG)
})

test('a null repo with --close still writes nothing (exit 0); --dry-run --close prints the line with its close and writes nothing', (t) => {
  const home = tmpHome(t)
  const r = tune(home, ['--scores', writeScores(home, { repo: null }), '--record-only', '--close', 'completion'])
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'tune: not recorded: the scores carry no repo (no GitHub origin), so no baseline is kept\n')
  assert.ok(!fs.existsSync(evDir(home)))
  const d = tune(home, ['--scores', writeScores(home), '--record-only', '--close', 'completion', '--dry-run'])
  assert.equal(d.status, 0, d.stderr)
  assert.match(d.stdout, /^would record t-\S+ in \S+: \{.*"close": "completion"\}\n$/)
  assert.ok(!fs.existsSync(evDir(home)))
})

// ---- --auto and --revert (p21-7, ADR 0037 d5): the weekly reading's own landings ------------------------------------
// reflections.jsonl's lines are written by hand in run_record's shape; the knob id comes from run_record.knob_key itself.

const R0 = 'r-20261001T000000Z-000000'
const R1 = 'r-20261002T000000Z-111111'
const R2 = 'r-20261003T000000Z-222222'
const RNOW = 'r-20261006T000000Z-aaaaaa'
const reflectionsPath = (home) => path.join(evDir(home), 'reflections.jsonl')
const RAISE = () => P('p1', 'parallel_ceiling', 3, 4, { ranAt: 3, rule: 'slot-bound-raise', direction: 1 })
const OK_GUARDS = { throughput: { breached: false }, tokensPerMerge: { breached: false }, setAsideRate: { breached: false },
  conflictRate: { breached: false }, quotaStalls: { breached: false }, reviewChurn: { breached: false } }

function knobKey(repo, key, rule, direction) {
  const body = ['import importlib.util, sys', 'spec = importlib.util.spec_from_file_location("rr", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(m.knob_key(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])))'].join('\n')
  return execFileSync('python3', ['-B', '-c', body, RUN_RECORD, repo, key, rule, String(direction)], { encoding: 'utf8', env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1' } }).trim()
}
const KID = knobKey('o/r', 'parallel_ceiling', 'slot-bound-raise', 1)

const rline = (ts, kind, f) => JSON.stringify({ v: 1, ts, host: 'h', rollout: null, task: null, kind, ...f })
const knobLine = (ts, reflection, rollouts, over = {}) => rline(ts, 'proposal', { id: KID, altitude: 'knob', reflection, rollouts, repo: 'o/r',
  key: 'parallel_ceiling', rule: 'slot-bound-raise', direction: 1, from: 3, to: 4, ranAt: 3, landed: false, held: 'agreement 1 of 3', ...over })
const closeLine = (ts, id) => rline(ts, 'reflection', { id, since: '2026-09-24T00:00:00.000Z', until: ts, rollouts: [], escapesOnly: [],
  counts: { sightings: 0, newWatches: 0, rules: 0, bugs: 0, filed: 0, knobs: 1, landed: 0, reverted: 0, breaches: 0 }, quiet: true })
function writeReflections(home, rows) {
  fs.mkdirSync(evDir(home), { recursive: true })
  fs.writeFileSync(reflectionsPath(home), rows.map((r) => `${r}\n`).join(''))
}
// two closed earlier Reflections, one knob line each, on rollouts a and b
const TWO_AGREE = [knobLine('2026-10-01T01:00:00.000Z', R0, ['a']), closeLine('2026-10-01T02:00:00.000Z', R0),
  knobLine('2026-10-02T01:00:00.000Z', R1, ['b']), closeLine('2026-10-02T02:00:00.000Z', R1)]
const autoArgs = (scores, repo, reflection = RNOW) => ['--scores', scores, '--auto', '--repo', repo, '--reflection', reflection]

// Held (exit 0): the reason printed, nothing written (no tunings line, the config byte-identical).
function held(home, args, re, configBefore) {
  const r = tune(home, args)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, re)
  assert.ok(!fs.existsSync(tuningsPath(home)), 'no tunings.jsonl')
  assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), configBefore)
  return r
}

test('--auto lands a knob three Reflections agree on: one auto line with reflection, agreeing and agreed, the config edited', (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  writeToml(home, CONFIG)
  writeReflections(home, TWO_AGREE)
  const r = tune(home, autoArgs(writeScores(home, { proposals: [RAISE()], guardrails: OK_GUARDS }), repo))
  assert.equal(r.status, 0, r.stderr)
  const [l, ...rest] = lines(tuningsPath(home))
  assert.equal(rest.length, 0)
  assert.deepEqual([l.auto, l.reflection, l.close, l.reverts], [true, RNOW, undefined, undefined])
  assert.deepEqual(l.applied, [{ key: 'parallel_ceiling', from: 3, to: 4, ranAt: 3, rule: 'slot-bound-raise', evidence: 'evidence for parallel_ceiling', agreeing: 0, agreed: 3 }])
  assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), CONFIG.replace('parallel_ceiling = 3   # hand', 'parallel_ceiling = 4   # hand'))
  assert.match(r.stdout, /^applied parallel_ceiling 3 → 4 for o\/r: /m)
})

test('--auto holds, exit 0 and nothing written, below three agreeing Reflections', (t) => {
  const cases = [
    ['no earlier Reflection', [], /^held parallel_ceiling: agreement 1 of 3$/m],
    ['one closed earlier Reflection', TWO_AGREE.slice(0, 2), /^held parallel_ceiling: agreement 2 of 3$/m],
    ['an earlier Reflection with no close line', [TWO_AGREE[0], TWO_AGREE[1], TWO_AGREE[2]], /^held parallel_ceiling: agreement 2 of 3$/m],
    ['an earlier line naming only a counted rollout', [knobLine('2026-10-01T01:00:00.000Z', R0, ['a']), closeLine('2026-10-01T02:00:00.000Z', R0),
      knobLine('2026-10-02T01:00:00.000Z', R1, ['a']), closeLine('2026-10-02T02:00:00.000Z', R1)], /^held parallel_ceiling: agreement 2 of 3$/m],
    ['this rollout named earlier', [knobLine('2026-10-01T01:00:00.000Z', R0, ['a']), closeLine('2026-10-01T02:00:00.000Z', R0),
      knobLine('2026-10-02T01:00:00.000Z', R1, ['demo-rollout']), closeLine('2026-10-02T02:00:00.000Z', R1)], /^held parallel_ceiling: agreement 2 of 3$/m],
    ['this Reflection\'s own earlier line', [...TWO_AGREE.slice(0, 2), knobLine('2026-10-02T01:00:00.000Z', RNOW, ['b'])], /^held parallel_ceiling: agreement 2 of 3$/m],
    ['a missing reflections.jsonl (no file at all)', null, /^held parallel_ceiling: agreement 1 of 3$/m],
  ]
  for (const [name, rows, re] of cases) {
    const home = tmpHome(t)
    const repo = gitRepo(home)
    writeToml(home, CONFIG)
    if (rows !== null) writeReflections(home, rows)
    held(home, autoArgs(writeScores(home, { proposals: [RAISE()], guardrails: OK_GUARDS }), repo), re, CONFIG)
  }
})

test('--auto: the key\'s last move (a pick, an auto landing or a revert) resets the count; a voided move or a close line does not', (t) => {
  const tl = (ts, id, over = {}) => JSON.stringify({ v: 2, ts, host: 'h', rollout: 'x', task: null, kind: 'tuning', id, repo: 'O/R', window: WINDOW, scores: HEADLINE,
    applied: [{ key: 'parallel_ceiling', from: 2, to: 3, ranAt: 2, rule: 'other-rule', evidence: 'e', agreeing: 0 }], ...over })
  const after = '2026-10-02T12:00:00.000Z'
  const moves = [
    ['a pick', [tl(after, 't-pick')], false],
    ['an auto landing', [tl(after, 't-auto', { auto: true, reflection: R2, applied: [{ key: 'parallel_ceiling', from: 2, to: 3, ranAt: 2, rule: 'x', evidence: 'e', agreeing: 0, agreed: 3 }] })], false],
    ['a revert', [tl(after, 't-rev', { auto: true, reflection: R2, reverts: 't-old' })], false],
    ['a voided pick', [tl(after, 't-v'), tl(after, 't-vv', { applied: [], voids: 't-v' })], true],
    ['a close line', [tl(after, 't-close', { applied: [], close: 'completion' })], true],
  ]
  for (const [name, tunings, lands] of moves) {
    const home = tmpHome(t)
    const repo = gitRepo(home)
    writeToml(home, CONFIG)
    writeReflections(home, TWO_AGREE)
    fs.writeFileSync(tuningsPath(home), tunings.map((x) => `${x}\n`).join(''))
    const r = tune(home, autoArgs(writeScores(home, { proposals: [RAISE()], guardrails: OK_GUARDS }), repo))
    assert.equal(r.status, 0, `${name}: ${r.stderr}`)
    const added = lines(tuningsPath(home)).length - tunings.length
    if (lands) assert.equal(added, 1, `${name}: lands`)
    else {
      assert.match(r.stdout, /^held parallel_ceiling: agreement 1 of 3$/m, name)
      assert.equal(added, 0, name)
    }
  }
})

test('--auto holds a trade, a caution, a breach, a partial window, ranAt != from, and a key this Reflection already moved', (t) => {
  const prior = JSON.stringify({ v: 2, ts: '2026-10-05T13:00:00.000Z', host: 'h', rollout: 'x', task: null, kind: 'tuning', id: 't-mine', repo: 'o/r', window: WINDOW,
    scores: HEADLINE, auto: true, reflection: RNOW, reverts: 't-z', applied: [{ key: 'parallel_ceiling', from: 4, to: 3, ranAt: 4, rule: 'revert:x', evidence: 'e', agreeing: 0 }] })
  const cases = [
    ['a trade', { proposals: [RAISE()].map((p) => ({ ...p, trade: { gains: ['handsOffRate'], costs: ['quality'] } })) }, /^held parallel_ceiling: a trade \(gains handsOffRate, costs quality\): Lachy decides$/m],
    ['a caution', { proposals: [RAISE()].map((p) => ({ ...p, caution: 'risks throughput' })) }, /^held parallel_ceiling: a caution: Lachy decides$/m],
    ['a breach', { guardrails: { ...OK_GUARDS, conflictRate: { breached: true } } }, /^held parallel_ceiling: a Guardrail is breached \(conflictRate\)$/m],
    ['a partial window', { window: { ...WINDOW, partial: true } }, /^held parallel_ceiling: a partial window/m],
    ['ranAt != from', { proposals: [P('p1', 'parallel_ceiling', 3, 6, { ranAt: 5, rule: 'slot-bound-raise', direction: 1 })] }, /^held parallel_ceiling: from 3 is not the value the run ran at \(5\)$/m],
    ['already moved', {}, /^held parallel_ceiling: Reflection r-20261006T000000Z-aaaaaa already moved parallel_ceiling \(t-mine\)$/m, prior],
  ]
  for (const [name, over, re, tunings] of cases) {
    const home = tmpHome(t)
    const repo = gitRepo(home)
    writeToml(home, CONFIG)
    writeReflections(home, TWO_AGREE)
    if (tunings) fs.writeFileSync(tuningsPath(home), `${tunings}\n`)
    const r = tune(home, autoArgs(writeScores(home, { proposals: [RAISE()], guardrails: OK_GUARDS, ...over }), repo))
    assert.equal(r.status, 0, `${name}: ${r.stderr}`)
    assert.match(r.stdout, re, name)
    assert.equal(fs.existsSync(tuningsPath(home)) ? lines(tuningsPath(home)).length : 0, tunings ? 1 : 0, `${name}: nothing written`)
    assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), CONFIG, name)
  }
})

test('--auto reads: torn lines skipped; an unreadable reflections.jsonl is exit 1; a closed --reflection is exit 2', { skip: process.getuid?.() === 0 && 'root ignores the mode' }, (t) => {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  writeToml(home, CONFIG)
  writeReflections(home, [...TWO_AGREE, '{"kind": "proposal", "id": "torn'])
  const scores = writeScores(home, { proposals: [RAISE()], guardrails: OK_GUARDS })
  const ok = tune(home, [...autoArgs(scores, repo), '--dry-run'])
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /^would record t-\S+ in \S+: \{.*"agreed": 3.*"auto": true, "reflection": "r-20261006T000000Z-aaaaaa"\}$/m)
  fs.chmodSync(reflectionsPath(home), 0o000)
  t.after(() => { try { fs.chmodSync(reflectionsPath(home), 0o644) } catch { /* gone */ } })
  const bad = tune(home, autoArgs(scores, repo))
  fs.chmodSync(reflectionsPath(home), 0o644)
  assert.equal(bad.status, 1, bad.stderr)
  assert.match(bad.stderr, /^tune: reflections\.jsonl cannot be read: .*Permission denied.*: nothing written\n$/)
  assert.ok(!fs.existsSync(tuningsPath(home)))
  fs.appendFileSync(reflectionsPath(home), `${closeLine('2026-10-06T02:00:00.000Z', RNOW)}\n`)
  refusedNothingWritten(home, autoArgs(scores, repo), 2, /^tune: Reflection r-20261006T000000Z-aaaaaa is closed: nothing written\n$/, CONFIG)
  refusedNothingWritten(home, ['--scores', scores, '--revert', 't-x', '--repo', repo, '--reflection', RNOW], 2, /^tune: Reflection r-20261006T000000Z-aaaaaa is closed/, CONFIG)
})

// ---- --revert ----------------------------------------------------------------------------------------------

const AUTO_LINE = (over = {}) => JSON.stringify({ v: 2, ts: '2026-10-05T13:00:00.000Z', host: 'h', rollout: 'older', task: null, kind: 'tuning', id: 't-auto', repo: 'o/r',
  window: WINDOW, scores: HEADLINE, auto: true, reflection: R2,
  applied: [{ key: 'parallel_ceiling', from: 3, to: 4, ranAt: 3, rule: 'slot-bound-raise', evidence: 'e', agreeing: 0, agreed: 3 }], ...over })
const LATER = { since: '2026-10-06T00:00:00.000Z', until: '2026-10-06T12:00:00.000Z', activeStart: '2026-10-06T00:00:00.000Z', activeEnd: '2026-10-06T09:00:00.000Z', partial: false }
const AT4 = CONFIG.replace('parallel_ceiling = 3   # hand', 'parallel_ceiling = 4   # hand')
const BREACH = { ...OK_GUARDS, tokensPerMerge: { breached: true } }
const RAN4 = { parallel_ceiling: 4, max_review_rounds: 4, max_iterations: 3, max_plan_rounds: 3 }

function revertCase(t, { tunings = [AUTO_LINE()], toml = AT4, scores = {} } = {}) {
  const home = tmpHome(t)
  const repo = gitRepo(home)
  writeToml(home, toml)
  fs.mkdirSync(evDir(home), { recursive: true })
  fs.writeFileSync(tuningsPath(home), tunings.map((x) => `${x}\n`).join(''))
  const sc = writeScores(home, { window: LATER, guardrails: BREACH, ranAt: RAN4, ...scores })
  return { home, repo, sc, args: ['--scores', sc, '--revert', 't-auto', '--repo', repo, '--reflection', RNOW] }
}

test('--revert lands the reverse as one auto line: revert:<rule>, reverts, no agreed, no close', (t) => {
  const { home, args } = revertCase(t)
  const r = tune(home, args)
  assert.equal(r.status, 0, r.stderr)
  const all = lines(tuningsPath(home))
  assert.equal(all.length, 2)
  const l = all[1]
  assert.deepEqual([l.auto, l.reflection, l.reverts, l.close], [true, RNOW, 't-auto', undefined])
  assert.equal(l.applied.length, 1)
  const [e] = l.applied
  assert.deepEqual([e.key, e.from, e.to, e.ranAt, e.rule, e.agreeing, 'agreed' in e], ['parallel_ceiling', 4, 3, 4, 'revert:slot-bound-raise', 0, false])
  assert.match(e.evidence, /^revert t-auto: breaches tokensPerMerge, which slot-bound-raise risks$/)
  assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), CONFIG)
  // a second revert of the same line is refused: already reverted
  const again = tune(home, args)
  assert.equal(again.status, 2, again.stderr)
  assert.match(again.stderr, /^tune: t-auto is not reverted: t-auto's parallel_ceiling is already reverted: nothing written\n$/)
  assert.equal(lines(tuningsPath(home)).length, 2)
  assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), CONFIG)
})

test('--revert refuses, exit 2 and nothing written: no auto line, reverted, a revert, a stale value, another repo, an earlier run, a partial window, a breach outside the rule\'s risks', (t) => {
  const cases = [
    ['a pick line', { tunings: [AUTO_LINE({ auto: undefined, reflection: undefined })] }, /not a standing auto line/],
    ['a voided auto line', { tunings: [AUTO_LINE(), JSON.stringify({ kind: 'tuning', ts: '2026-10-05T13:01:00.000Z', id: 't-v', repo: 'o/r', voids: 't-auto', applied: [] })] }, /not a standing auto line/],
    ['already reverted', { tunings: [AUTO_LINE(), AUTO_LINE({ id: 't-rev', reverts: 't-auto', ts: '2026-10-05T14:00:00.000Z',
      applied: [{ key: 'parallel_ceiling', from: 4, to: 3, ranAt: 4, rule: 'revert:slot-bound-raise', evidence: 'e', agreeing: 0 }] })], toml: CONFIG }, /already reverted|no longer holds/],
    ['a revert line', { tunings: [AUTO_LINE({ reverts: 't-zero' })] }, /itself a revert/],
    ['a stale value (a hand edit since)', { toml: CONFIG }, /no longer holds t-auto's parallel_ceiling 4 \(it is 3 now\)/],
    ['another repo', { tunings: [AUTO_LINE({ repo: 'o/other' })] }, /is o\/other's, but the scores are for o\/r/],
    ['a run that started before the auto line', { scores: { window: WINDOW } }, /started before t-auto landed/],
    ['a partial window', { scores: { window: { ...LATER, partial: true } } }, /a partial window/],
    ['a breach outside the rule\'s risks', { scores: { guardrails: { ...OK_GUARDS, throughput: { breached: true } } } }, /no breached Guardrail is among slot-bound-raise's risks \(breached: throughput\)/],
    ['a run at another value', { scores: { ranAt: { ...RAN4, parallel_ceiling: 5 } } }, /did not run at t-auto's parallel_ceiling 4/],
  ]
  for (const [name, opts, re] of cases) {
    const { home, args } = revertCase(t, opts)
    const before = fs.readFileSync(tuningsPath(home), 'utf8')
    const toml = fs.readFileSync(tomlPath(home), 'utf8')
    const r = tune(home, args)
    assert.equal(r.status, 2, `${name}: ${r.stderr}`)
    assert.match(r.stderr, /^tune: t-auto is not reverted: /, name)
    assert.match(r.stderr, re, name)
    assert.equal(fs.readFileSync(tuningsPath(home), 'utf8'), before, `${name}: tunings.jsonl unchanged`)
    assert.equal(fs.readFileSync(tomlPath(home), 'utf8'), toml, `${name}: the config unchanged`)
  }
})

test('usage: --auto and --revert are exclusive with --pick and --record-only; --reflection rules; --close needs --record-only', (t) => {
  const home = tmpHome(t)
  writeToml(home, CONFIG)
  const repo = gitRepo(home)
  const scores = writeScores(home, { proposals: [RAISE()] })
  for (const [args, re] of [
    [['--scores', scores, '--auto', '--record-only', '--reflection', RNOW], /not allowed with argument/],
    [['--scores', scores, '--revert', 't-x', '--pick', 'p1', '--reflection', RNOW], /not allowed with argument/],
    [['--scores', scores, '--reflection', RNOW], /one of the arguments/],
    [['--scores', scores, '--auto', '--repo', repo], /^tune: --auto and --revert need --reflection <id>/],
    [['--scores', scores, '--record-only', '--reflection', RNOW], /^tune: --reflection goes with --auto or --revert only\n$/],
    [['--scores', scores, '--pick', 'p1', '--repo', repo, '--reflection', RNOW], /^tune: --reflection goes with --auto or --revert only\n$/],
    [['--scores', scores, '--auto', '--repo', repo, '--reflection', 'week-1'], /^tune: --reflection week-1 is no r- id\n$/],
    [['--scores', scores, '--auto', '--repo', repo, '--reflection', RNOW, '--close', 'completion'], /^tune: --close needs --record-only\n$/],
    [['--scores', scores, '--revert', 't-x', '--repo', repo, '--reflection', RNOW, '--close', 'supersede'], /^tune: --close needs --record-only\n$/],
  ]) {
    refusedNothingWritten(home, args, 2, re, CONFIG)
  }
})

test('tune.py and the score.py it loads parse as python 3.8', () => {
  for (const script of [TUNE, SCORE]) {
    const r = spawnSync('python3', ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 8))', script], { encoding: 'utf8' })
    assert.equal(r.status, 0, `${path.basename(script)}: ${r.stderr}`)
  }
})
