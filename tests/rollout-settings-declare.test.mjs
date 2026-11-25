// skills/_shared/scripts/rollout-settings.py `declare` and `undo` — the one writer of a ruled declaration (p56-5; ADR
// 0063's 2026-11-24 amendment). The resolver's own suite is tests/rollout-settings.test.mjs.
//
// An agent writes a declaration Lachy has ruled on, through `rollout-settings.py declare` and no other edit: his words
// and their date are required, the edit is ONE line, the reader check runs at every write, and one line in
// rollouts.declarations.jsonl beside the file records what it replaced, so `undo --id` takes it back.
//
// Hermetic: every case runs under its own mkdtemp HOME with --tasks-dir given, so the real settings file and the vault
// are never read, and python3 runs with -B and PYTHONDONTWRITEBYTECODE so no __pycache__ lands next to the script (D4
// drops both on purpose). Dates: every spawned case passes a fixed past --said and never builds "today" (the machine's
// local date) in JavaScript; a date after today is two days out in UTC, after the local date in every time zone; the
// exact boundary is pinned in process with `_today` patched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'rollout-settings.py')
const SCRIPTS = path.dirname(SCRIPT)
const NO_LOGINS = { value: [], source: 'built-in' }
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()

// ---- helpers (the resolver suite's, copied: tmpHome, settingsPath, writeSettings, gitRepo, run, resolves, escapeRe) ----

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-settings-declare-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

const settingsPath = (home) => path.join(home, '.config', 'thread', 'rollouts.toml')

function writeSettings(home, lines) {
  const p = settingsPath(home)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, Array.isArray(lines) ? lines.join('\n') + '\n' : lines)
  return p
}

// A git repo under home whose origin is `url` (no origin when url is null).
function gitRepo(home, name, url) {
  const dir = path.join(home, name)
  fs.mkdirSync(dir, { recursive: true })
  execFileSync(REAL_GIT, ['init', '-q', dir])
  if (url) execFileSync(REAL_GIT, ['-C', dir, 'remote', 'add', 'origin', url])
  return dir
}

function run(home, args = [], { env = {}, argv } = {}) {
  const r = spawnSync('python3', argv || ['-B', SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PYTHONDONTWRITEBYTECODE: '1', ...env },
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function resolves(home, args = [], opts = {}) {
  const r = run(home, args, opts)
  assert.equal(r.stderr, '', 'nothing on stderr on success')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^\{.*\}\n$/, 'exactly one JSON line on stdout')
  return JSON.parse(r.stdout)
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const logPath = (home) => path.join(home, '.config', 'thread', 'rollouts.declarations.jsonl')
const SAID = '2026-11-24'
const WORDS = 'Agents make any ruled edit'
const RULING = ['--words', WORDS, '--said', SAID]
const LOGINS = ['--key', 'test_logins', '--value', '["dummy"]']
const body = (home) => fs.readFileSync(settingsPath(home), 'utf8')
const readLog = (home) => (fs.existsSync(logPath(home))
  ? fs.readFileSync(logPath(home), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

function tasksDir(home) {
  const d = path.join(home, 'tasks')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// verb(home, ['declare' | 'undo', ...]): the CLI with an empty --tasks-dir (no live rollout, so no reader to ask).
const verb = (home, args, opts) => run(home, [args[0], '--tasks-dir', tasksDir(home), ...args.slice(1)], opts)

function wrote(home, args, opts) {
  const r = verb(home, args, opts)
  assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`)
  assert.equal(r.stderr, '', 'nothing on stderr on success')
  return r.stdout
}

// Refused: exit `code`, nothing on stdout, one `rollout-settings: <verb>: <reason>` line, the file and the log as they were.
function verbRefused(home, args, why, { code = 2, was, logged = 0 } = {}) {
  const r = verb(home, args)
  assert.equal(r.status, code, `${args.join(' ')}: exit ${r.status}: ${r.stderr}`)
  assert.equal(r.stdout, '', 'nothing on stdout on a refusal')
  assert.match(r.stderr, new RegExp(`^rollout-settings: ${args[0]}: .+\\n$`), `one line; got ${r.stderr}`)
  assert.match(r.stderr, why)
  if (was !== undefined) assert.equal(body(home), was, `${args.join(' ')}: the file is byte-identical`)
  assert.equal(readLog(home).length, logged, `${args.join(' ')}: no log line`)
}

// main(argv) in process with `patch` run on module m first and `post` after it (the verbs' seams: _today, _reader_check).
function verbInProcess(home, patch, args, post = '') {
  return run(home, [], {
    argv: ['-B', '-c', `import importlib.util, json, os, sys
spec = importlib.util.spec_from_file_location('rs', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
${patch}
rc = m.main(sys.argv[2:])
${post}
sys.exit(rc)`, SCRIPT, args[0], '--tasks-dir', tasksDir(home), ...args.slice(1)],
  })
}

test('D1 no ruling, no write: his words and their date are required, and the date is never after today', (t) => {
  const home = tmpHome(t)
  const was = '[defaults]\nspend_approval_usd = 200\n'
  writeSettings(home, was)
  const future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  for (const [extra, why] of [
    [['--said', SAID], /no ruling: --words .*his words/],
    [['--words', '  \t ', '--said', SAID], /no ruling: --words .*his words/],
    [['--words', 'make it\u0007so', '--said', SAID], /--words holds a control character/],
    [['--words', 'x'.repeat(2001), '--said', SAID], /--words is 2001 characters \(at most 2000\)/],
    [['--words', WORDS], /no ruling: --said/],
    [['--words', WORDS, '--said', '2026-13-40'], /--said 2026-13-40 is no date/],
    [['--words', WORDS, '--said', '\u0662\u0660\u0662\u0666-\u0661\u0661-\u0662\u0660'], /--said \S+ is no date/], // Arabic-Indic digits: ASCII only
    [['--words', WORDS, '--said', future], new RegExp(`--said ${future} is after today`)],
  ]) verbRefused(home, ['declare', ...LOGINS, ...extra], why, { was })
  assert.ok(!fs.existsSync(logPath(home)), 'no log file')
  // the boundary, with today fixed: the day itself is allowed, the next day is not
  const today = 'import datetime; m._today = lambda: datetime.date(2026, 11, 24)'
  const dry = verbInProcess(home, today, ['declare', ...LOGINS, '--words', WORDS, '--said', '2026-11-24', '--dry-run'])
  assert.equal(dry.status, 0, dry.stderr)
  const next = verbInProcess(home, today, ['declare', ...LOGINS, '--words', WORDS, '--said', '2026-11-25'])
  assert.equal(next.status, 2)
  assert.match(next.stderr, /^rollout-settings: declare: --said 2026-11-25 is after today \(2026-11-24/)
  assert.equal(body(home), was)
  const real = verbInProcess(home, today, ['declare', ...LOGINS, '--words', WORDS, '--said', '2026-11-24'])
  assert.equal(real.status, 0, real.stderr)
  assert.match(body(home), /^test_logins = \["dummy"\]  # declared 2026-11-24 by an agent on his words of 2026-11-24: /m)
  assert.equal(readLog(home)[0].declared, '2026-11-24')
})

test('D2 declare writes ONE line and ONE log line, raises the schema in the same edit, and reports it in one line', (t) => {
  const home = tmpHome(t)
  const p = writeSettings(home, '[defaults]\nspend_approval_usd = 200\n')
  const out = wrote(home, ['declare', ...LOGINS, ...RULING])
  const lines = body(home).split('\n')
  assert.deepEqual([lines.slice(0, 4), lines.slice(5)], [['schema = 5', '', '[defaults]', 'spend_approval_usd = 200'], ['']])
  const m = lines[4].match(/^test_logins = \["dummy"\]  # declared (\d{4}-\d{2}-\d{2}) by an agent on his words of 2026-11-24: rollouts\.declarations\.jsonl (d-\S+)$/)
  assert.ok(m, lines[4])
  assert.deepEqual(resolves(home).test_logins, { value: ['dummy'], source: 'file:defaults' })
  const log = readLog(home)
  assert.equal(log.length, 1, 'exactly one log line')
  const e = log[0]
  assert.match(e.id, /^d-\d{8}T\d{6}Z-[0-9a-f]{4}$/)
  assert.match(e.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  assert.deepEqual({ ...e, ts: null }, { id: m[2], ts: null, declared: m[1], verb: 'declare', table: 'defaults', key: 'test_logins',
    value: ['dummy'], was: null, words: WORDS, said: SAID, source: null, line: lines[4], replaced: null, schema: { from: 1, to: 5 } })
  assert.equal(out, `declared [defaults] test_logins = ["dummy"] in ${p} (was: not set); his words, ${SAID}: "${WORDS}"; ` +
    `logged ${e.id} in ${logPath(home)}; undo: rollout-settings.py undo --id ${e.id} --words "<his words>" --said <YYYY-MM-DD>\n`)
  // the value already set: nothing to change, no second log line
  assert.match(wrote(home, ['declare', ...LOGINS, ...RULING]), /^rollout-settings: nothing to change: /)
  assert.equal(readLog(home).length, 1)
  // no file and no ~/.config yet: the directory and the file are made, holding the schema, the table and the line
  const bare = tmpHome(t)
  wrote(bare, ['declare', ...LOGINS, ...RULING])
  assert.equal(body(bare), `schema = 5\n\n[defaults]\n${readLog(bare)[0].line}\n`)
})

const HIS_LINE = 'test_logins = ["dummy"]  # his comment'
const WITH_HIS_LINE = `schema = 5\n\n[defaults]\nparallel_ceiling = 4\n${HIS_LINE}\nspend_approval_usd = 200\n`

test('D3 a replaced line is logged whole and undone from the log: back byte-identical, an added line goes, and a line a Tuning moved is left alone', (t) => {
  const home = tmpHome(t)
  writeSettings(home, WITH_HIS_LINE)
  const replacing = wrote(home, ['declare', '--key', 'test_logins', '--value', '["dummy", "spare"]', ...RULING])
  const [e] = readLog(home)
  const declared = body(home)
  // only that line differs, and the log keeps the old line whole, comment included
  assert.equal(declared, WITH_HIS_LINE.replace(HIS_LINE, e.line))
  assert.match(e.line, /^test_logins = \["dummy", "spare"\]  # declared /)
  assert.deepEqual([e.replaced, e.was, e.value, e.schema], [HIS_LINE, ['dummy'], ['dummy', 'spare'], { from: 5, to: 5 }])
  assert.ok(replacing.includes(`(was: ${HIS_LINE})`), replacing)
  verbRefused(home, ['undo', '--id', e.id], /no ruling: --words/, { was: declared, logged: 1 })
  verbRefused(home, ['undo', '--id', 'd-20261124T000000Z-0000', ...RULING], /d-20261124T000000Z-0000 is no declaration in /, { was: declared, logged: 1 })
  const out = wrote(home, ['undo', '--id', e.id, '--words', 'take that back', '--said', SAID])
  assert.equal(body(home), WITH_HIS_LINE, 'byte-identical to before the declare')
  const u = readLog(home)[1]
  assert.deepEqual([u.verb, u.undoes, u.key, u.table, u.words, u.line, u.replaced, u.value, u.was],
    ['undo', e.id, 'test_logins', 'defaults', 'take that back', HIS_LINE, e.line, ['dummy'], ['dummy', 'spare']])
  assert.match(out, new RegExp(`^undone ${e.id}: \\[defaults\\] test_logins in .*; logged ${u.id} in `))
  verbRefused(home, ['undo', '--id', e.id, ...RULING], /is already undone \(by /, { was: WITH_HIS_LINE, logged: 2 })
  verbRefused(home, ['undo', '--id', u.id, ...RULING], /is an undo line/, { was: WITH_HIS_LINE, logged: 2 })

  // a declare that added a line (and raised the schema): the line goes, `schema = 5` stays
  const home2 = tmpHome(t)
  writeSettings(home2, '[defaults]\nspend_approval_usd = 200\n')
  wrote(home2, ['declare', ...LOGINS, ...RULING])
  wrote(home2, ['undo', '--id', readLog(home2)[0].id, ...RULING])
  assert.equal(body(home2), 'schema = 5\n\n[defaults]\nspend_approval_usd = 200\n')
  assert.deepEqual(resolves(home2).test_logins, NO_LOGINS)

  // a Tuning moves a declared Tuning key: tune.py's _edit_table replaces the value in place and keeps the comment
  // (tests/reflect-tune.test.mjs pins that), so the line is no longer the one logged and undo leaves it alone
  const home3 = tmpHome(t)
  writeSettings(home3, '[defaults]\nspend_approval_usd = 200\n')
  wrote(home3, ['declare', '--key', 'parallel_ceiling', '--value', '5', ...RULING])
  const [pc] = readLog(home3)
  const tuned = body(home3).replace(pc.line, pc.line.replace('parallel_ceiling = 5', 'parallel_ceiling = 6'))
  assert.notEqual(tuned, body(home3))
  writeSettings(home3, tuned)
  verbRefused(home3, ['undo', '--id', pc.id, ...RULING], /the parallel_ceiling line in \[defaults\] has changed since /, { was: tuned, logged: 1 })
})

// The reader check: a fixture plugin repo P whose commit 1 holds a rollout-settings.py stub that refuses any file
// holding "probe" and whose commit 2 holds copies of the real scripts, named one by one. The Primary P sits at commit
// 1; the verb runs from a linked worktree W at commit 2, with a live rollout note in --tasks-dir (the shape of
// tests/inert-paths.test.mjs's pluginFixture).
const PLUGIN_SCRIPTS = ['rollout-settings.py', 'ladder.py', 'engine-snapshot.py', 'inert-paths.py', 'run_record.py', 'land.sh']

function pluginFixture(home) {
  const env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  const git = (cwd, ...args) => execFileSync(REAL_GIT, ['-c', 'init.defaultBranch=main', '-C', cwd, ...args], { encoding: 'utf8', env }).trim()
  const P = path.join(home, 'plugin')
  const dir = path.join(P, 'skills', '_shared', 'scripts')
  fs.mkdirSync(dir, { recursive: true })
  git(P, 'init', '-q')
  fs.writeFileSync(path.join(dir, 'rollout-settings.py'), 'class SettingsError(Exception):\n    pass\n\n' +
    'def resolve(repo=None, path=None):\n    if \'"probe"\' in open(path).read():\n' +
    '        raise SettingsError("this reader cannot read a probe")\n    return {}\n')
  fs.copyFileSync(path.join(SCRIPTS, 'engine-snapshot.py'), path.join(dir, 'engine-snapshot.py'))
  git(P, 'add', '-A'); git(P, 'commit', '-qm', 'an older reader')
  const c1 = git(P, 'rev-parse', 'HEAD')
  for (const f of PLUGIN_SCRIPTS) fs.copyFileSync(path.join(SCRIPTS, f), path.join(dir, f))
  git(P, 'add', '-A'); git(P, 'commit', '-qm', 'this reader')
  const c2 = git(P, 'rev-parse', 'HEAD')
  git(P, 'checkout', '-q', c1)
  const W = path.join(home, 'plugin-w')
  git(P, 'worktree', 'add', '-q', '--detach', W, c2)
  const td = tasksDir(home)
  fs.writeFileSync(path.join(td, 'ro.md'), '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n---\n\n## Queue\n')
  return { P, W, c2, td, git }
}

test('D4 the reader check runs at every write: a live engine root that cannot read the edited file refuses it (exit 1)', (t) => {
  const home = tmpHome(t)
  const pf = pluginFixture(home)
  const was = 'schema = 5\n\n[defaults]\nspend_approval_usd = 200\n'
  writeSettings(home, was)
  // no -B and no PYTHONDONTWRITEBYTECODE: the verb itself must keep bytecode out of both checkouts
  const from = (args) => {
    const env = { ...process.env, HOME: home }
    delete env.PYTHONDONTWRITEBYTECODE
    const r = spawnSync('python3', [path.join(pf.W, 'skills', '_shared', 'scripts', 'rollout-settings.py'), 'declare', '--tasks-dir', pf.td,
      '--key', 'test_logins', ...args, ...RULING], { encoding: 'utf8', env })
    return { status: r.status, stdout: r.stdout, stderr: r.stderr }
  }
  let r = from(['--value', '["probe"]'])
  assert.equal(r.status, 1, r.stderr)
  assert.equal(r.stdout, '')
  // the file is already at schema 5, so this also pins that the check runs with no schema raise
  assert.match(r.stderr, new RegExp(`^rollout-settings: \\[\\[ro\\]\\] runs on ${escapeRe(fs.realpathSync(pf.P))}, whose rollout-settings\\.py refuses the new file \\(this reader cannot read a probe\\)`, 'm'))
  assert.match(r.stderr, /^rollout-settings: declare: nothing written: a live rollout's engine cannot read the new file$/m)
  assert.equal(body(home), was, 'byte-identical')
  assert.equal(readLog(home).length, 0, 'no log line')
  // the Primary moved to commit 2: its reader reads the file, and the write goes on with no WARN
  pf.git(pf.P, 'checkout', '-q', pf.c2)
  r = from(['--value', '["probe"]'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  assert.deepEqual(resolves(home).test_logins.value, ['probe'])
  for (const d of [pf.P, pf.W]) {
    assert.ok(!fs.existsSync(path.join(d, 'skills', '_shared', 'scripts', '__pycache__')), `no __pycache__ beside the scripts in ${d}`)
  }
  // a missing tasks dir: one WARN, and the write goes on
  const home2 = tmpHome(t)
  writeSettings(home2, was)
  const w = run(home2, ['declare', '--tasks-dir', path.join(home2, 'no-tasks'), ...LOGINS, ...RULING])
  assert.equal(w.status, 0, w.stderr)
  assert.match(w.stderr, /^WARN: rollout-settings: no tasks dir at .*\n$/)
  assert.equal(readLog(home2).length, 1)
})

const CLASS_JSON = '{"file": "~/repos/x/.env.local", "keys": [{"name": "STRIPE_SECRET", "prefix": "sk_test_"}]}'
const CLASS_TOML = 'test_credentials = { file = "~/repos/x/.env.local", keys = [{ name = "STRIPE_SECRET", prefix = "sk_test_" }] }'

test('D5 repo scope: --repo picks the origin\'s table (ignoring case), one line after its last key, or appends the table', (t) => {
  const home = tmpHome(t)
  const clone = gitRepo(home, 'clone', 'https://github.com/o/r.git')
  const head = ['schema = 3', '', '[defaults]', 'parallel_ceiling = 4', '', '[repo."O/R"]', 'max_iterations = 2']
  const tail = ['', '[repo."x/y"]', 'max_iterations = 5']
  writeSettings(home, [...head, ...tail])
  wrote(home, ['declare', '--repo', clone, '--key', 'test_credentials', '--value', CLASS_JSON, ...RULING])
  const [e] = readLog(home)
  assert.equal(body(home), [...head, e.line, ...tail].join('\n') + '\n', 'one line after the table\'s last key; every other line byte-identical')
  assert.ok(e.line.startsWith(CLASS_TOML + '  # declared '), e.line)
  assert.equal(e.table, 'repo."O/R"')
  const out = resolves(home, ['--repo', clone])
  assert.deepEqual(out.test_credentials, { value: JSON.parse(CLASS_JSON), source: 'file:repo' })
  assert.equal(out.settings.max_iterations.value, 2)
  // a rollout key goes to the repo table with --repo, to [defaults] without it
  wrote(home, ['declare', '--repo', clone, '--key', 'spend_approval_usd', '--value', '50', ...RULING])
  wrote(home, ['declare', '--key', 'spend_approval_usd', '--value', '20', ...RULING])
  assert.deepEqual(resolves(home, ['--repo', clone]).settings.spend_approval_usd, { value: 50, source: 'file:repo' })
  assert.deepEqual(resolves(home).settings.spend_approval_usd, { value: 20, source: 'file:defaults' })
  // no table for the repo yet: the table is appended
  const home2 = tmpHome(t)
  const clone2 = gitRepo(home2, 'clone', 'https://github.com/o/r.git')
  writeSettings(home2, ['schema = 3', '', '[defaults]', 'parallel_ceiling = 4'])
  wrote(home2, ['declare', '--repo', clone2, '--key', 'test_credentials', '--value', CLASS_JSON, ...RULING])
  assert.equal(body(home2), ['schema = 3', '', '[defaults]', 'parallel_ceiling = 4', '', '[repo."o/r"]', readLog(home2)[0].line].join('\n') + '\n')
  assert.equal(resolves(home2, ['--repo', clone2]).test_credentials.source, 'file:repo')
  // placement is derived, never chosen
  const was = body(home2)
  const plain = gitRepo(home2, 'plain', null)
  verbRefused(home2, ['declare', '--key', 'test_credentials', '--value', CLASS_JSON, ...RULING], /test_credentials is per repo: it needs --repo/, { was, logged: 1 })
  verbRefused(home2, ['declare', '--repo', clone2, ...LOGINS, ...RULING], /test_logins is machine-wide: it takes no --repo/, { was, logged: 1 })
  verbRefused(home2, ['declare', '--repo', plain, '--key', 'test_credentials', '--value', CLASS_JSON, ...RULING], /has no GitHub origin/, { was, logged: 1 })
})

test('D6 refusals: a value the reader refuses, a key it never writes, a bad --value or --source, a form it will not edit', (t) => {
  const home = tmpHome(t)
  const clone = gitRepo(home, 'clone', 'https://github.com/o/r.git')
  const was = 'schema = 7\n\n[defaults]\nparallel_ceiling = 4\n\n[repo."o/r"]\nunreachable_paths = [\n  "a/**",\n]\n'
  const p = writeSettings(home, was)
  const live = CLASS_JSON.replace('STRIPE_SECRET', 'STRIPE_LIVE_SECRET')
  for (const [args, why] of [
    [['--key', 'test_logins', '--value', '[]'], new RegExp(`the edit does not validate \\(${escapeRe(p)}:\\d+: \\[defaults\\] test_logins is empty`)],
    [['--key', 'test_logins', '--value', '["claude"]'], /does not validate \(.*holds the reserved name "claude"/],
    [['--repo', clone, '--key', 'test_credentials', '--value', live], /does not validate \(.*name holds a LIVE or PROD segment/],
    [['--repo', clone, '--key', 'inert_paths', '--value', '["a/**"]'], /inert_paths is never declared: inert-paths\.py/],
    [['--key', 'schema', '--value', '9'], /schema is never declared/],
    [['--key', 'test_login', '--value', '["dummy"]'], /unknown key "test_login" \(a near-miss of "test_logins"\)/],
    [['--key', 'test_logins', '--value', '[dummy]'], /--value is not JSON/],
    [['--key', 'test_logins', '--value', 'null'], /--value null/],
    [['--key', 'test_logins', '--value', '["dummy"]', '--remove'], /exactly one of --value and --remove/],
    [['--key', 'test_logins'], /exactly one of --value and --remove/],
    [[...LOGINS, '--source', '  '], /--source is empty/],
    [[...LOGINS, '--source', 'the\ngrill'], /--source holds a control character/],
    [[...LOGINS, '--source', 's'.repeat(301)], /--source is 301 characters \(at most 300\)/],
    [['--repo', clone, '--key', 'unreachable_paths', '--value', '["b/**"]'], /the unreachable_paths line in \[repo\."o\/r"\] spans lines \(line 7\): edit it by hand/],
  ]) verbRefused(home, ['declare', ...args, ...RULING], why, { was })
  for (const form of ['defaults.parallel_ceiling = 3\n', 'defaults = { parallel_ceiling = 3 }\n']) {
    writeSettings(home, form)
    verbRefused(home, ['declare', '--key', 'max_iterations', '--value', '2', ...RULING],
      /\[defaults\] is set in dotted or inline-table form in the config: edit it by hand/, { was: form })
  }
  assert.ok(!fs.existsSync(logPath(home)), 'no log file')
  // no ~/.config yet and a value the reader refuses: the directory made for the temp file is removed again
  const bare = tmpHome(t)
  verbRefused(bare, ['declare', '--key', 'test_logins', '--value', '["claude"]', ...RULING], /holds the reserved name "claude"/)
  assert.ok(!fs.existsSync(path.join(bare, '.config')), 'no ~/.config left behind')
  // a valid --source goes into the log line and the report line
  writeSettings(home, was)
  const out = wrote(home, ['declare', ...LOGINS, ...RULING, '--source', '[[orient grill]]'])
  assert.equal(readLog(home)[0].source, '[[orient grill]]')
  assert.ok(out.includes(`; his words, ${SAID}: "${WORDS}", [[orient grill]]; logged `), out)
})

test('D7 --dry-run prints the diff and the would-be log line, and leaves the file, the log and the directory as they were', (t) => {
  const home = tmpHome(t)
  const was = '[defaults]\nspend_approval_usd = 200\n'
  writeSettings(home, was)
  const r = verbInProcess(home, `import tempfile
made, real_mkstemp = [], tempfile.mkstemp
def recording(*a, **k):
    got = real_mkstemp(*a, **k)
    made.append(got[1])
    return got
tempfile.mkstemp = recording`, ['declare', ...LOGINS, ...RULING, '--dry-run'],
  'print("MADE " + json.dumps([[os.path.dirname(p), os.path.exists(p)] for p in made]))')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^\+schema = 5$/m)
  assert.match(r.stdout, /^\+test_logins = \["dummy"\]  # declared /m)
  const would = r.stdout.split('\n').find((l) => l.startsWith('would log in '))
  assert.ok(would && would.startsWith(`would log in ${logPath(home)}: {`), r.stdout)
  assert.deepEqual(JSON.parse(would.slice(would.indexOf(': {') + 2)).value, ['dummy'])
  assert.equal(body(home), was)
  assert.ok(!fs.existsSync(logPath(home)), 'no log file')
  const made = JSON.parse(r.stdout.split('\n').find((l) => l.startsWith('MADE ')).slice(5))
  assert.deepEqual(made, [[fs.realpathSync(path.dirname(settingsPath(home))), false]], 'one temp file, beside the config, gone again')
})

test('D8 --remove from the middle of a table, and its undo: back between its neighbours, or at the end of its table when they changed', (t) => {
  const home = tmpHome(t)
  writeSettings(home, WITH_HIS_LINE)
  const gone = WITH_HIS_LINE.replace(HIS_LINE + '\n', '')
  const out = wrote(home, ['declare', '--key', 'test_logins', '--remove', ...RULING])
  assert.equal(body(home), gone, 'that one line is deleted')
  const [e] = readLog(home)
  assert.deepEqual([e.verb, e.value, e.was, e.line, e.replaced, e.above, e.below],
    ['remove', null, ['dummy'], null, HIS_LINE, 'parallel_ceiling = 4', 'spend_approval_usd = 200'])
  assert.match(out, new RegExp(`^removed \\[defaults\\] test_logins from .* \\(was: ${escapeRe(HIS_LINE)}\\); .*; undo: rollout-settings\\.py undo --id ${e.id} --words "<his words>" --said <YYYY-MM-DD>\\n$`))
  assert.doesNotMatch(wrote(home, ['undo', '--id', e.id, ...RULING]), /restored at the end/)
  assert.equal(body(home), WITH_HIS_LINE, 'byte-identical: the line is back between its two neighbours')
  // the line above changed by hand since: the line goes back at the end of its table, and the report says so
  wrote(home, ['declare', '--key', 'test_logins', '--remove', ...RULING])
  const moved = gone.replace('parallel_ceiling = 4', 'parallel_ceiling = 5')
  writeSettings(home, moved)
  const second = wrote(home, ['undo', '--id', readLog(home)[2].id, ...RULING])
  assert.equal(body(home), moved + HIS_LINE + '\n')
  assert.ok(second.endsWith('; restored at the end of [defaults]: the lines around its old place have changed\n'), second)
  assert.deepEqual(resolves(home).test_logins, { value: ['dummy'], source: 'file:defaults' })
  // a remove whose key has been set again is not undone
  wrote(home, ['declare', '--key', 'test_logins', '--remove', ...RULING])
  const again = moved + 'test_logins = ["other"]\n'
  writeSettings(home, again)
  verbRefused(home, ['undo', '--id', readLog(home)[4].id, ...RULING], /test_logins is set again in \[defaults\]/, { was: again, logged: 5 })
  // a guardrail key has one table, and takes no --repo
  wrote(home, ['declare', '--key', 'hours_per_task', '--value', '2', ...RULING])
  assert.ok(body(home).startsWith(again + '\n[guardrails]\nhours_per_task = 2  # declared '), body(home))
  assert.deepEqual(resolves(home).guardrails.hours_per_task, { value: 2, source: 'file:guardrails' })
  const clone = gitRepo(home, 'clone', 'https://github.com/o/r.git')
  verbRefused(home, ['declare', '--repo', clone, '--key', 'hours_per_task', '--value', '3', ...RULING],
    /hours_per_task is machine-wide: it takes no --repo/, { logged: 6 })
})

test('D9 failure order: the compare-and-swap, the log before the file, and a failed replace voided', (t) => {
  // another writer changes the file while the reader check runs: refused, the other edit kept, no log line
  let home = tmpHome(t)
  const was = '[defaults]\nspend_approval_usd = 200\n'
  let p = writeSettings(home, was)
  let r = verbInProcess(home, `def other(tmp, tasks_dir):
    with open(${JSON.stringify(p)}, "a") as f:
        f.write("# another edit\\n")
    return [], []
m._reader_check = other`, ['declare', ...LOGINS, ...RULING])
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /^rollout-settings: declare: .* changed while checking: re-run\n$/)
  assert.equal(body(home), was + '# another edit\n')
  assert.ok(!fs.existsSync(logPath(home)), 'no log line')
  // the log cannot be written: nothing is declared, the file untouched
  home = tmpHome(t)
  writeSettings(home, was)
  fs.mkdirSync(logPath(home))
  r = verb(home, ['declare', ...LOGINS, ...RULING])
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /^rollout-settings: declare: the log line could not be written \(.*\): nothing declared, rollouts\.toml is unchanged\n$/)
  assert.equal(body(home), was)
  // the replace fails after the log line landed: a void line follows
  home = tmpHome(t)
  writeSettings(home, was)
  r = verbInProcess(home, `def failing(a, b):
    raise OSError("no replace today")
m.os.replace = failing`, ['declare', ...LOGINS, ...RULING])
  assert.equal(r.status, 1, r.stderr)
  assert.equal(body(home), was)
  const log = readLog(home)
  assert.deepEqual(log.map((d) => d.verb), ['declare', 'void'])
  assert.equal(log[1].voids, log[0].id)
  assert.match(r.stderr, new RegExp(`^rollout-settings: declare: rollouts\\.toml was not written \\(no replace today\\): nothing declared; ${log[0].id} voided by ${log[1].id}\\n$`))
  verbRefused(home, ['undo', '--id', log[0].id, ...RULING], /was voided/, { was, logged: 2 })
})
