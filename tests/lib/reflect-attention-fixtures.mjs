// The shared fixtures of the attention ledger's suite (skills/reflect/scripts/attention.py and reflect.py, p30-7),
// one suite in two files since p49-3 so node's files at a time and the full suite's shards spread it:
// tests/reflect-attention.test.mjs (L1-L3: the Question ledger and tally, the writer, the Review trails) and
// tests/reflect-attention-watch.test.mjs (L4-L8: waits to start, the circling detector's W1 and W2, its Watches into
// decide and close, and a reading with no transcripts). Each part imports from here what it uses of the fixtures,
// and every engine-script bind with the spawner that runs it and the env it passes, so
// tests/contracts/run-record-hermetic.test.mjs reads them together.
//
// Hermetic: each case gets its own mkdtemp HOME, THREAD_EVENTS_DIR, tasks dir (with Archive/2026/ and
// Archive/Rollouts/) and THREAD_TRANSCRIPTS_DIR (fixture `<dir>/<project>/<session>.jsonl` files), TZ pinned to
// Melbourne, an env built from scratch that every spawn passes, and a temp git repo whose origin is
// https://github.com/o/r.git (read locally; no remote is reached: origin/main is written with update-ref). Record
// lines go through run_record.emit. The block's cases run attention.py's span-block (no score.py); the writers'
// cases run the real span with no record, or a span.json built by hand in span's shape.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const REFLECT = path.join(root, 'skills', 'reflect', 'scripts', 'reflect.py')
export const ATTENTION = path.join(root, 'skills', 'reflect', 'scripts', 'attention.py')
export const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()

// ---- helpers ----------------------------------------------------------------------------------------------

export function setup(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-attention-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const tasks = path.join(home, 'Tasks')
  for (const d of ['Archive/2026', 'Archive/Rollouts']) fs.mkdirSync(path.join(tasks, d), { recursive: true })
  for (const d of ['events', 'out', 'repo', 'transcripts']) fs.mkdirSync(path.join(home, d), { recursive: true })
  const h = { home, tasks, ev: path.join(home, 'events'), out: path.join(home, 'out'), repo: path.join(home, 'repo'), tx: path.join(home, 'transcripts') }
  git(h, ['init', '-q', '-b', 'main'])
  git(h, ['remote', 'add', 'origin', 'https://github.com/o/r.git'])
  return h
}

// the env every spawn passes; a key set to null in `extra` is left out
function env(h, extra = {}) {
  const e = { PATH: process.env.PATH, HOME: h.home, PYTHONDONTWRITEBYTECODE: '1', TZ: 'Australia/Melbourne', THREAD_EVENTS_DIR: h.ev,
    GIT_CONFIG_GLOBAL: path.join(h.home, 'gitconfig'), THREAD_TRANSCRIPTS_DIR: h.tx, ...extra }
  for (const k of Object.keys(e)) if (e[k] === null) delete e[k]
  return e
}
export const git = (h, args, repo = h.repo) => execFileSync(REAL_GIT, ['-C', repo, ...args], { encoding: 'utf8',
  env: { PATH: process.env.PATH, HOME: h.home, GIT_CONFIG_GLOBAL: path.join(h.home, 'gitconfig'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim()
// a commit of `files` ({path: text}) on the checked-out branch of `repo`; its short sha
export function commit(h, files, msg, repo = h.repo) {
  for (const [p, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true })
    fs.writeFileSync(path.join(repo, p), text)
  }
  git(h, ['add', '-A'], repo)
  git(h, ['commit', '-q', '-m', msg], repo)
  return git(h, ['rev-parse', '--short=7', 'HEAD'], repo)
}

export function run(h, script, args, extra = {}) {
  const r = spawnSync('python3', ['-B', script, ...args], { encoding: 'utf8', cwd: h.home, env: env(h, extra) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
const reflect = (h, args, extra) => run(h, REFLECT, args, extra)
export function ok(h, args, extra) {
  const r = reflect(h, args, extra)
  assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`)
  return r
}
export function refused(h, args, re) {
  const before = sha(reflectionsFile(h))
  const r = reflect(h, args)
  assert.equal(r.status, 2, `${args[0]}: ${r.stdout}${r.stderr}`)
  assert.match(r.stderr, re)
  assert.equal(sha(reflectionsFile(h)), before, `${args[0]}: nothing written`)
  return r
}

export const reflectionsFile = (h) => path.join(h.ev, 'reflections.jsonl')
const parse = (l) => { try { return JSON.parse(l) } catch { return null } }
export const rlines = (h) => (fs.existsSync(reflectionsFile(h)) ? fs.readFileSync(reflectionsFile(h), 'utf8').split('\n').map(parse).filter(Boolean) : [])
export const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent')
export const writeJson = (dir, name, doc) => { fs.mkdirSync(dir, { recursive: true }); const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(doc)); return p }
export const listing = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).sort() : [])

// Every event through run_record.emit(strict=True): [ts, kind, task, fields, rollout?].
export function emitAll(h, rollout, events) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, fields, r in json.load(sys.stdin):', '    assert m.emit(r, kind, task, fields, ts=ts, strict=True), (kind, task, ts)'].join('\n')
  const rows = events.map(([ts, kind, task = null, fields = {}, r = rollout]) => [ts, kind, task, fields, r])
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(rows) })
  assert.equal(r.status, 0, r.stderr)
}

// A python expression over a module loaded by path as `m` (its stdin JSON as `a`), printed as JSON.
export function py(h, script, expr, input = null) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("m", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)', 'a = json.load(sys.stdin)', `print(json.dumps(${expr}))`].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, script], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(input) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

// ---- the window, the transcripts, the notes -----------------------------------------------------------------------------

export const SINCE = '2026-10-20T13:00:00.000Z' // Melbourne 21 October
export const UNTIL = '2026-10-25T13:00:00.000Z' // Melbourne 26 October
export const T = (d, hm) => `2026-10-${String(d).padStart(2, '0')}T${hm}:00.000Z`
export const SID = (c, n = 1) => `${c.repeat(8)}-0000-0000-0000-${String(n).padStart(12, '0')}`

// attention.py's span-block over the window: {attention, flags, cannotShow}
export function block(h, since = SINCE, until = UNTIL, extra) {
  const out = path.join(h.out, `blk-${crypto.randomBytes(3).toString('hex')}.json`)
  const r = run(h, ATTENTION, ['span-block', '--since', since, '--until', until, '--tasks-dir', h.tasks, '--out', out], extra)
  assert.equal(r.status, 0, r.stderr)
  return { out, ...JSON.parse(fs.readFileSync(out, 'utf8')) }
}
let N = 0
// the real span over the window, in its own directory
export function span(h, since = SINCE, until = UNTIL, extra) {
  const dir = path.join(h.out, `s${++N}`)
  const out = path.join(dir, 'span.json')
  const r = reflect(h, ['span', '--since', since, '--until', until, '--now', until, '--tasks-dir', h.tasks, '--config', path.join(h.home, 'rollouts.toml'),
    '--out', out], extra)
  assert.equal(r.status, 0, r.stderr)
  const s = JSON.parse(fs.readFileSync(out, 'utf8'))
  // the window check (reflect.py's header): a `window: ` flag is a reader that read past its window, in any reading
  assert.ok(!s.flags.some((f) => f.startsWith('window: ')), JSON.stringify(s.flags))
  return { out, dir, s, stderr: r.stderr }
}

export function transcript(h, proj, sid, entries, { file = sid, mtime = null, dir = null } = {}) {
  const d = dir ?? path.join(h.tx, proj)
  fs.mkdirSync(d, { recursive: true })
  const p = path.join(d, `${file}.jsonl`)
  fs.appendFileSync(p, entries.map((e) => `${JSON.stringify({ sessionId: sid, ...e })}\n`).join(''))
  if (mtime) fs.utimesSync(p, mtime, mtime)
  return p
}
export const Q = (question, labels, { header = 'Pick', multi = false } = {}) => ({ question, header, multiSelect: multi,
  options: labels.map((label) => ({ label, description: `${label}: what it does` })) })
export const askE = (ts, id, questions, { cwd, sidechain = false } = {}) => ({ type: 'assistant', timestamp: ts, cwd, gitBranch: 'main', isSidechain: sidechain,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] } })
export const resultE = (ts, id, text, { error = false, tur = null } = {}) => ({ type: 'user', timestamp: ts, isSidechain: false,
  message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: text, ...(error ? { is_error: true } : {}) }] },
  ...(tur ? { toolUseResult: tur } : {}) })
export const promptE = (ts, text, { cwd = '/x', sidechain = false } = {}) => ({ type: 'user', timestamp: ts, cwd, isSidechain: sidechain, message: { role: 'user', content: text } })
export const bashE = (ts, command, { sidechain = false } = {}) => ({ type: 'assistant', timestamp: ts, isSidechain: sidechain,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_b${crypto.randomBytes(4).toString('hex')}`, name: 'Bash', input: { command } }] } })
export const answered = (pairs) => `Your questions have been answered: ${pairs.map(([q, a]) => `"${q}"="${a}"`).join(', ')}. You can now continue with these answers in mind.`

export function taskNote(h, slug, { status = 'open', tags = '[task, ai]', captured = '2026-10-18', fm = ['phase: 1'], body = '', dir = h.tasks } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, `${slug}.md`)
  fs.writeFileSync(p, ['---', `tags: ${tags}`, `status: ${status}`, ...(captured ? [`captured: ${captured}`] : []), ...fm, '---', '', `# ${slug}`, '', body, ''].join('\n'))
  return p
}
export function rolloutNote(h, slug, { status = 'in_progress', archived = false, captured = '2026-10-21', fm = ['protocol_version: 5'], queue = null, tags = '[task, rollout]', body = '' } = {}) {
  const dir = archived ? path.join(h.tasks, 'Archive', 'Rollouts') : h.tasks
  const rows = queue ? ['## Queue', '', '| # | Task | Scope | Mode |', '|---|---|---|---|', ...queue.map(([t, mode], i) => `| ${i + 1} | [[${t}\\|${t} label]] | narrow | ${mode} |`), ''] : []
  fs.writeFileSync(path.join(dir, `${slug}.md`), ['---', `tags: ${tags}`, `status: ${status}`, ...(captured ? [`captured: ${captured}`] : []), ...fm, '---', '',
    `# ${slug}`, '', `Project root: \`${h.repo}\``, '', ...rows, '## Notes', '', body, ''].join('\n'))
}

// ---- L1: the Question ledger, and tally ------------------------------------------------------------------------------

export const A = SID('a')
export const B = SID('b', 1)
const E = SID('b', 2) // shares B's first 8 characters
const C = SID('c')

export function questionsFixture(h) {
  const wt = path.join(h.repo, '.claude', 'worktrees', 'wt1')
  const gone = '/nonexistent/proj/.claude/worktrees/x'
  const ship = [Q('Ship it?', ['Yes (Recommended)', 'No'])]
  transcript(h, 'p1', A, [
    askE(T(21, '00:00'), 'c1', ship, { cwd: h.repo }),
    resultE(T(21, '01:00'), 'c1', answered([['Ship it?', 'Yes (Recommended)']]), { tur: { questions: ship, answers: { 'Ship it?': 'Yes (Recommended)' } } }),
    askE(T(21, '02:00'), 'c2', [Q('Keep the flag?', ['Keep (Recommended)', 'Drop'])], { cwd: h.repo }),
    resultE(T(21, '02:30'), 'c2', 'The user answered: "Keep the flag?"="Drop" notes: it confuses me. Read the answers carefully.',
      { tur: { questions: [], answers: { 'Keep the flag?': 'Drop' }, annotations: { 'Keep the flag?': { notes: 'it confuses me' } } } }),
    askE(T(23, '00:00'), 'c5', [Q('Go on?', ['Go (Recommended)', 'Stop'])], { cwd: h.repo }),
    resultE(T(23, '00:30'), 'c5', 'the Turn ended', { error: true }),
    askE(T(23, '01:00'), 'c6', [Q('One way?', ['Only'])], { cwd: h.repo }),
    resultE(T(23, '01:00'), 'c6', '<tool_use_error>InputValidationError: [too_small]</tool_use_error>', { error: true }),
    askE(T(19, '00:00'), 'c12', [Q('Before the window?', ['A', 'B'])], { cwd: h.repo }),
    askE(T(25, '14:00'), 'c14', [Q('After the window?', ['A', 'B'])], { cwd: h.repo }), // an hour past UNTIL: read by no item or count
    { type: 'api-request', timestamp: T(21, '03:00'), message: { content: [{ type: 'tool_use', id: 'c9', name: 'AskUserQuestion', input: { questions: [Q('A copy?', ['A', 'B'])] } }] } },
    askE(T(21, '04:00'), 'c10', [Q('A subagent asks?', ['A', 'B'])], { cwd: h.repo, sidechain: true }),
  ])
  transcript(h, 'p2', B, [
    askE(T(22, '00:00'), 'c3', [Q('Which way?', ['A (Recommended)', 'B']), Q('Which parts?', ['X', 'Y (Recommended)', 'Z'], { multi: true })], { cwd: wt }),
    resultE(T(22, '04:00'), 'c3', answered([['Which way?', 'my own idea'], ['Which parts?', 'X, Y (Recommended)']])),
    askE(T(25, '10:00'), 'c7', [Q('Still there?', ['Yes', 'No'])], { cwd: wt }),
  ])
  transcript(h, 'p2', E, [askE(T(24, '00:00'), 'c8', [Q('Plain?', ['A', 'B'])], { cwd: h.repo }),
    resultE(T(24, '00:12'), 'c8', answered([['Plain?', 'A']]), { tur: { questions: [], answers: { 'Plain?': 'A' } } })])
  transcript(h, 'p3', C, [askE(T(22, '05:00'), 'c4', [Q('Send the mail?', ['Send (Recommended)', 'Hold'])], { cwd: gone }),
    resultE(T(22, '05:06'), 'c4', '[User dismissed — do not proceed, wait for next instruction]', { error: true })])
  // a forked copy of c1 a minute later in another Session's file: the same call, read once
  transcript(h, 'p1', SID('d'), [askE(T(21, '00:01'), 'c1', ship, { cwd: h.repo }), resultE(T(21, '01:01'), 'c1', answered([['Ship it?', 'No']]))])
  // a subagent's own file, and a file last written before the floor: neither read
  transcript(h, 'p1', A, [askE(T(21, '05:00'), 'c11', [Q('Sub?', ['A', 'B'])], { cwd: h.repo })], { dir: path.join(h.tx, 'p1', A, 'subagents'), file: 'agent-1' })
  transcript(h, 'p4', SID('f'), [askE(T(21, '06:00'), 'c13', [Q('Old file?', ['A', 'B'])], { cwd: h.repo })], { mtime: new Date('2026-09-01T00:00:00Z') })
}
