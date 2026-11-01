// skills/reflect/scripts/attention.py and reflect.py's attention ledger (p30-7, ADR 0056): the Question ledger read from
// the session transcripts (each question of the ask tool, its outcome, the recommended pick and the hours it held work),
// the Review trails (the /fresh-review rounds keyed per PR by landing, branch or path run), each rollout's Wait to start,
// and the circling detector (W1 a work item three Sessions touch with no rollout holding it, W2 a rollout open 48 hours
// with nothing merged), whose Watches count readings. `reflect.py attention` writes one `attention` line per Reflection
// with the reading's Owner labels, and decide and close wait for it. Every rule lives in attention.py's docstring,
// reflect.py's and run_record.py's; this pins the behaviour.
//
// Hermetic: each case gets its own mkdtemp HOME, THREAD_EVENTS_DIR, tasks dir (with Archive/2026/ and Archive/Rollouts/)
// and THREAD_TRANSCRIPTS_DIR (fixture `<dir>/<project>/<session>.jsonl` files), TZ pinned to Melbourne, an env built
// from scratch that every spawn passes, and a temp git repo whose origin is https://github.com/o/r.git (read locally; no
// remote is reached: origin/main is written with update-ref). Record lines go through run_record.emit. The block's cases
// run attention.py's span-block (no score.py); the writers' cases run the real span with no record, or a span.json built
// by hand in span's shape.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { section } from './lib/contract-text.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REFLECT = path.join(root, 'skills', 'reflect', 'scripts', 'reflect.py')
const ATTENTION = path.join(root, 'skills', 'reflect', 'scripts', 'attention.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()

// ---- helpers ----------------------------------------------------------------------------------------------

function setup(t) {
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
const git = (h, args, repo = h.repo) => execFileSync(REAL_GIT, ['-C', repo, ...args], { encoding: 'utf8',
  env: { PATH: process.env.PATH, HOME: h.home, GIT_CONFIG_GLOBAL: path.join(h.home, 'gitconfig'), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim()
// a commit of `files` ({path: text}) on the checked-out branch of `repo`; its short sha
function commit(h, files, msg, repo = h.repo) {
  for (const [p, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, p)), { recursive: true })
    fs.writeFileSync(path.join(repo, p), text)
  }
  git(h, ['add', '-A'], repo)
  git(h, ['commit', '-q', '-m', msg], repo)
  return git(h, ['rev-parse', '--short=7', 'HEAD'], repo)
}

function run(h, script, args, extra = {}) {
  const r = spawnSync('python3', ['-B', script, ...args], { encoding: 'utf8', cwd: h.home, env: env(h, extra) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
const reflect = (h, args, extra) => run(h, REFLECT, args, extra)
function ok(h, args, extra) {
  const r = reflect(h, args, extra)
  assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`)
  return r
}
function refused(h, args, re) {
  const before = sha(reflectionsFile(h))
  const r = reflect(h, args)
  assert.equal(r.status, 2, `${args[0]}: ${r.stdout}${r.stderr}`)
  assert.match(r.stderr, re)
  assert.equal(sha(reflectionsFile(h)), before, `${args[0]}: nothing written`)
  return r
}

const reflectionsFile = (h) => path.join(h.ev, 'reflections.jsonl')
const parse = (l) => { try { return JSON.parse(l) } catch { return null } }
const rlines = (h) => (fs.existsSync(reflectionsFile(h)) ? fs.readFileSync(reflectionsFile(h), 'utf8').split('\n').map(parse).filter(Boolean) : [])
const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent')
const writeJson = (dir, name, doc) => { fs.mkdirSync(dir, { recursive: true }); const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(doc)); return p }
const listing = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).sort() : [])

// Every event through run_record.emit(strict=True): [ts, kind, task, fields, rollout?].
function emitAll(h, rollout, events) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, fields, r in json.load(sys.stdin):', '    assert m.emit(r, kind, task, fields, ts=ts, strict=True), (kind, task, ts)'].join('\n')
  const rows = events.map(([ts, kind, task = null, fields = {}, r = rollout]) => [ts, kind, task, fields, r])
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(rows) })
  assert.equal(r.status, 0, r.stderr)
}

// A python expression over a module loaded by path as `m` (its stdin JSON as `a`), printed as JSON.
function py(h, script, expr, input = null) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("m", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)', 'a = json.load(sys.stdin)', `print(json.dumps(${expr}))`].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, script], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(input) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

// ---- the window, the transcripts, the notes -----------------------------------------------------------------------------

const SINCE = '2026-10-20T13:00:00.000Z' // Melbourne 21 October
const UNTIL = '2026-10-25T13:00:00.000Z' // Melbourne 26 October
const T = (d, hm) => `2026-10-${String(d).padStart(2, '0')}T${hm}:00.000Z`
const SID = (c, n = 1) => `${c.repeat(8)}-0000-0000-0000-${String(n).padStart(12, '0')}`

// attention.py's span-block over the window: {attention, flags, cannotShow}
function block(h, since = SINCE, until = UNTIL, extra) {
  const out = path.join(h.out, `blk-${crypto.randomBytes(3).toString('hex')}.json`)
  const r = run(h, ATTENTION, ['span-block', '--since', since, '--until', until, '--tasks-dir', h.tasks, '--out', out], extra)
  assert.equal(r.status, 0, r.stderr)
  return { out, ...JSON.parse(fs.readFileSync(out, 'utf8')) }
}
let N = 0
// the real span over the window, in its own directory
function span(h, since = SINCE, until = UNTIL, extra) {
  const dir = path.join(h.out, `s${++N}`)
  const out = path.join(dir, 'span.json')
  const r = reflect(h, ['span', '--since', since, '--until', until, '--now', until, '--tasks-dir', h.tasks, '--config', path.join(h.home, 'rollouts.toml'),
    '--out', out], extra)
  assert.equal(r.status, 0, r.stderr)
  return { out, dir, s: JSON.parse(fs.readFileSync(out, 'utf8')), stderr: r.stderr }
}

function transcript(h, proj, sid, entries, { file = sid, mtime = null, dir = null } = {}) {
  const d = dir ?? path.join(h.tx, proj)
  fs.mkdirSync(d, { recursive: true })
  const p = path.join(d, `${file}.jsonl`)
  fs.appendFileSync(p, entries.map((e) => `${JSON.stringify({ sessionId: sid, ...e })}\n`).join(''))
  if (mtime) fs.utimesSync(p, mtime, mtime)
  return p
}
const Q = (question, labels, { header = 'Pick', multi = false } = {}) => ({ question, header, multiSelect: multi,
  options: labels.map((label) => ({ label, description: `${label}: what it does` })) })
const askE = (ts, id, questions, { cwd, sidechain = false } = {}) => ({ type: 'assistant', timestamp: ts, cwd, gitBranch: 'main', isSidechain: sidechain,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] } })
const resultE = (ts, id, text, { error = false, tur = null } = {}) => ({ type: 'user', timestamp: ts, isSidechain: false,
  message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: text, ...(error ? { is_error: true } : {}) }] },
  ...(tur ? { toolUseResult: tur } : {}) })
const promptE = (ts, text, { cwd = '/x', sidechain = false } = {}) => ({ type: 'user', timestamp: ts, cwd, isSidechain: sidechain, message: { role: 'user', content: text } })
const bashE = (ts, command, { sidechain = false } = {}) => ({ type: 'assistant', timestamp: ts, isSidechain: sidechain,
  message: { role: 'assistant', content: [{ type: 'tool_use', id: `toolu_b${crypto.randomBytes(4).toString('hex')}`, name: 'Bash', input: { command } }] } })
const answered = (pairs) => `Your questions have been answered: ${pairs.map(([q, a]) => `"${q}"="${a}"`).join(', ')}. You can now continue with these answers in mind.`

function taskNote(h, slug, { status = 'open', tags = '[task, ai]', captured = '2026-10-18', fm = ['phase: 1'], body = '', dir = h.tasks } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const p = path.join(dir, `${slug}.md`)
  fs.writeFileSync(p, ['---', `tags: ${tags}`, `status: ${status}`, ...(captured ? [`captured: ${captured}`] : []), ...fm, '---', '', `# ${slug}`, '', body, ''].join('\n'))
  return p
}
function rolloutNote(h, slug, { status = 'in_progress', archived = false, captured = '2026-10-21', fm = ['protocol_version: 5'], queue = null, tags = '[task, rollout]', body = '' } = {}) {
  const dir = archived ? path.join(h.tasks, 'Archive', 'Rollouts') : h.tasks
  const rows = queue ? ['## Queue', '', '| # | Task | Scope | Mode |', '|---|---|---|---|', ...queue.map(([t, mode], i) => `| ${i + 1} | [[${t}\\|${t} label]] | narrow | ${mode} |`), ''] : []
  fs.writeFileSync(path.join(dir, `${slug}.md`), ['---', `tags: ${tags}`, `status: ${status}`, ...(captured ? [`captured: ${captured}`] : []), ...fm, '---', '',
    `# ${slug}`, '', `Project root: \`${h.repo}\``, '', ...rows, '## Notes', '', body, ''].join('\n'))
}

// ---- L1: the Question ledger, and tally ------------------------------------------------------------------------------

const A = SID('a')
const B = SID('b', 1)
const E = SID('b', 2) // shares B's first 8 characters
const C = SID('c')

function questionsFixture(h) {
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

test('L1: the Question ledger reads each question once, with its outcome, recommended pick, own words, note, held hours and repo', (t) => {
  const h = setup(t)
  questionsFixture(h)
  const { attention: at } = block(h)
  const items = at.questions.items
  const by = Object.fromEntries(items.map((x) => [x.id, x]))
  assert.deepEqual(items.map((x) => [x.id, x.outcome]), [['c1#0', 'answered'], ['c2#0', 'answered'], ['c3#0', 'answered'], ['c3#1', 'answered'],
    ['c4#0', 'dismissed'], ['c5#0', 'dropped'], ['c6#0', 'failed'], ['c8#0', 'answered'], ['c7#0', 'open']])
  assert.deepEqual([by['c1#0'].session, by['c1#0'].pickedRecommended, by['c1#0'].recommended, by['c1#0'].heldHours], [A, true, 'Yes (Recommended)', 1], 'the earliest copy')
  assert.deepEqual([by['c2#0'].pickedRecommended, by['c2#0'].note, by['c2#0'].ownWords], [false, 'it confuses me', false])
  assert.deepEqual([by['c3#0'].answer, by['c3#0'].ownWords, by['c3#0'].pickedRecommended], ['my own idea', true, false], 'read from the text alone')
  assert.deepEqual([by['c3#1'].answer, by['c3#1'].multiSelect, by['c3#1'].pickedRecommended, by['c3#1'].ownWords], ['X, Y (Recommended)', true, true, false], 'a multi-select by presence')
  assert.deepEqual([by['c3#0'].heldHours, by['c3#0'].callQuestions], [4, 2])
  assert.deepEqual([by['c7#0'].heldHours, by['c7#0'].answeredAt], [3, null], 'open: held to until')
  assert.deepEqual([by['c1#0'].repo, by['c3#0'].repo, by['c4#0'].repo], ['o/r', 'o/r', 'proj'], 'a worktree folded; a gone cwd by its folded basename')
  const c = at.questions.counts
  assert.deepEqual([c.asked, c.calls, c.answered, c.dismissed, c.dropped, c.open, c.failed, c.unparsed], [8, 7, 5, 1, 1, 1, 1, 0], 'failed is never asked')
  assert.deepEqual(c.recommended, { offered: 4, picked: 2 }, 'offered counts answered questions only')
  assert.deepEqual([c.notes, c.ownWords, c.hoursHeld], [1, 1, 9.3])
  assert.deepEqual(c.byRepo, { 'o/r': 7, proj: 1 })
  assert.deepEqual(c.longest.map((x) => [x.call, x.hours]).slice(0, 2), [['c3', 4], ['c7', 3]])
  assert.equal(c.byOwner, undefined, 'span carries no Owner')
})

test('L1: tally counts the questions of the named Sessions, joins the owners, equals question_counts(); a short, unmatched or ambiguous prefix is exit 2', (t) => {
  const h = setup(t)
  questionsFixture(h)
  const b = block(h)
  const owners = writeJson(h.out, 'owners.json', { 'c1#0': 'yours', 'c2#0': 'technical', 'c3#0': 'priorities', 'c3#1': 'yours', 'c4#0': 'gate',
    'c5#0': 'unknown', 'c7#0': 'yours', 'c8#0': 'technical' })
  const r = run(h, ATTENTION, ['tally', '--span', b.out, '--session', 'aaaaaaaa', '--session', B])
  assert.equal(r.status, 0, r.stderr)
  const t1 = JSON.parse(r.stdout)
  assert.deepEqual(Object.keys(t1.sessions), [A, B])
  assert.deepEqual([t1.sessions[A].asked, t1.sessions[B].asked, t1.total.asked], [3, 3, 6])
  const r2 = run(h, ATTENTION, ['tally', '--span', b.out, '--owners', owners, '--session', 'aaaaaaaa', '--session', B])
  const t2 = JSON.parse(r2.stdout)
  assert.deepEqual(t2.total.byOwner, { yours: 3, priorities: 1, technical: 1, gate: 0, unknown: 1 })
  assert.deepEqual([t2.total.hoursByOwner.yours, t2.total.hoursByOwner.priorities, t2.total.unlabelled], [6, 2, 0], 'a call\'s hours split over its questions')
  const mine = b.attention.questions.items.filter((x) => [A, B].includes(x.session))
  assert.deepEqual(t2.total, py(h, ATTENTION, 'm.question_counts(a["items"], a["owners"])', { items: mine, owners: JSON.parse(fs.readFileSync(owners, 'utf8')) }))
  for (const [p, re] of [['aaaaaaa', /at least 8 characters/], ['zzzzzzzz', /matches no Session/], ['bbbbbbbb', /matches 2 Sessions/]]) {
    const x = run(h, ATTENTION, ['tally', '--span', b.out, '--session', p])
    assert.equal(x.status, 2, p)
    assert.match(x.stderr, re)
  }
})

// ---- L2: the writer -----------------------------------------------------------------------------------------------------

test('L2: attention refuses a bad owners file with nothing written; labels by Owner; an unknown remainder is flagged, never blocks; reruns', (t) => {
  const h = setup(t)
  questionsFixture(h)
  const sp = span(h)
  const rid = sp.s.reflection
  const ids = sp.s.attention.questions.items.filter((x) => x.outcome !== 'failed').map((x) => x.id)
  assert.equal(ids.length, 8)
  const full = Object.fromEntries(ids.map((i) => [i, i.startsWith('c3') ? 'yours' : 'technical']))
  const att = (extra) => ['attention', '--span', sp.out, ...extra]
  for (const rest of [[], ['--rest-unknown']]) {
    refused(h, att(['--owners', writeJson(sp.dir, 'extra.json', { ...full, 'zz#0': 'yours' }), ...rest]), /names 1 id\(s\) the span lacks: zz#0/)
    refused(h, att(['--owners', writeJson(sp.dir, 'bad.json', { ...full, 'c1#0': 'mine' }), ...rest]), /an owner outside yours, priorities, technical, gate, unknown: c1#0='mine'/)
    refused(h, att(['--owners', writeJson(sp.dir, 'list.json', []), ...rest]), /no JSON object/)
  }
  const partial = writeJson(sp.dir, 'partial.json', Object.fromEntries(Object.entries(full).slice(0, 5)))
  refused(h, att(['--owners', partial]), /leaves out 3 asked question\(s\)/)
  refused(h, att([]), /8 questions and no --owners/)
  // --dry-run writes nothing
  const dry = ok(h, att(['--owners', writeJson(sp.dir, 'full.json', full), '--dry-run']))
  assert.match(dry.stdout, /^would write attention: /m)
  assert.equal(sha(reflectionsFile(h)), 'absent')
  // all unknown: no remainder, no flag
  const unk = ok(h, att(['--owners', writeJson(sp.dir, 'unknown.json', Object.fromEntries(ids.map((i) => [i, 'unknown'])))]))
  assert.ok(!/^flag:/m.test(unk.stdout), unk.stdout)
  assert.match(unk.stdout, new RegExp(`^attention ${rid}: 8 questions \\(0 yours, 0 unlabelled\\), 0 trails, 0 circling; attention line written\\n$`))
  let line = rlines(h).filter((l) => l.kind === 'attention').at(-1)
  assert.deepEqual([line.v, line.rollout, line.task, line.questions.byOwner.unknown, line.questions.unlabelled], [1, null, null, 8, 0])
  assert.equal(ok(h, att(['--owners', path.join(sp.dir, 'unknown.json')])).stdout, `exists attention ${rid}\n`)
  // no owners at all with --rest-unknown: every question unlabelled
  const none = ok(h, att(['--rest-unknown']))
  assert.match(none.stdout, /^flag: 8 of 8 questions unlabelled, written as unknown$/m)
  assert.equal(rlines(h).filter((l) => l.kind === 'attention').at(-1).questions.unlabelled, 8)
  // a partial file with --rest-unknown: the remainder unlabelled, flagged
  const part = ok(h, att(['--owners', partial, '--rest-unknown']))
  assert.match(part.stdout, /^flag: 3 of 8 questions unlabelled, written as unknown$/m)
  // the full labels: byOwner and the split hours; a fuller re-run appends one line and readers take the last
  ok(h, att(['--owners', path.join(sp.dir, 'full.json')]))
  const all = rlines(h).filter((l) => l.kind === 'attention')
  assert.equal(all.length, 4)
  line = all.at(-1)
  assert.deepEqual(line.questions.byOwner, { yours: 2, priorities: 0, technical: 6, gate: 0, unknown: 0 })
  assert.deepEqual([line.questions.hoursByOwner.yours, line.questions.unlabelled], [4, 0], 'c3\'s 4 hours, split over its two questions')
  assert.deepEqual(py(h, ATTENTION, 'm.trend(a, None)', rlines(h)).map((x) => [x.reflection, x.yours, x.unlabelled]), [[rid, 2, 0]])
  // the reading closes; then attention refuses the closed Reflection
  ok(h, ['ledger', '--span', sp.out])
  ok(h, ['close', '--span', sp.out])
  refused(h, att(['--owners', path.join(sp.dir, 'full.json')]), /is closed: nothing written/)
})

test('L2: zero questions need no --owners; a maximal line passes run_record.check under 16 KiB', (t) => {
  const h = setup(t)
  const sp = span(h)
  const r = ok(h, ['attention', '--span', sp.out])
  assert.match(r.stdout, /0 questions \(0 yours, 0 unlabelled\)/)
  // every cap at once: 12 repos and other, 5 longest at 60-character headers, 5 trails at 120-character labels and 8
  // handed ids, 16 waits and 32 + 32 circling items on 64-character slugs
  const slug = (c, i) => `${c}${String(i).padStart(2, '0')}`.padEnd(64, 'x')
  const stamp = '2026-10-25T13:00:00.000Z'
  const owners = { yours: 1, priorities: 1, technical: 1, gate: 1, unknown: 296 }
  const f = { reflection: 'r-20261025T130000Z-abcdef', since: SINCE, until: UNTIL,
    questions: { asked: 300, calls: 290, answered: 280, dismissed: 10, dropped: 5, open: 3, failed: 2, unparsed: 2, notes: 30, ownWords: 3, unlabelled: 296,
      recommended: { offered: 250, picked: 200 }, hoursHeld: 1234.567,
      longest: Array.from({ length: 5 }, (_, i) => ({ call: `toolu_01${'A'.repeat(22)}${i}`, session: 'abcdef12', repo: 'owner-name/repository-name-long',
        header: 'h'.repeat(60), hours: 99.999, outcome: 'answered' })),
      byRepo: { ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`owner-name/repository-${i}`.padEnd(40, 'r'), 20])), other: 60 },
      byOwner: owners, hoursByOwner: { yours: 1.5, priorities: 2.5, technical: 3.5, gate: 4.5, unknown: 1222.567 } },
    trails: { count: 40, rounds: 120, codeRounds: 100, simplifyRounds: 20, stopRounds: 50, stops: 30, stopsHanded: 12, findings: 999, regression: 333, engineStops: 4,
      docsOnly: { trails: 3, rounds: 9 },
      longest: Array.from({ length: 5 }, () => ({ label: 'l'.repeat(120), rounds: 12, stopRounds: 6, stops: 2, stopsHanded: 4, docsOnly: null,
        handedAfterStop: Array.from({ length: 8 }, (_, j) => `toolu_01${'B'.repeat(22)}${j}#1`) })) },
    waits: Array.from({ length: 16 }, (_, i) => ({ rollout: slug('w', i), ask: stamp, scheduled: stamp, started: stamp, hours: 123.456, scheduleHours: 23.456, open: false })),
    circling: { W1: Array.from({ length: 32 }, (_, i) => ({ slug: slug('a', i), sessions: 12, questions: 34 })),
      W2: Array.from({ length: 32 }, (_, i) => ({ slug: slug('b', i), sessions: 12, questions: 34, hours: 123.456 })) } }
  const [size, checked] = py(h, RUN_RECORD, '[m.line_bytes("attention", a), m.check(None, "attention", None, a)]', f)
  assert.ok(size > 14000 && size <= 16384, `the maximal line is ${size} bytes`)
  assert.equal(checked, null)
})

// ---- L3: Review trails --------------------------------------------------------------------------------------------------

function round(h, ts, repo, head, { verdict = 'continue', mode = 'code', doc = null, branch = null, extra = {} } = {}) {
  return [ts, 'review-round', null, { repo, head, digest: crypto.createHash('sha1').update(`${repo}${head}${ts}`).digest('hex').slice(0, 6),
    doc: doc ?? `docs/reviews/${ts.slice(0, 10)}-${head}-${crypto.randomBytes(2).toString('hex')}.md`, mode, effort: 'xhigh',
    findings: 3, original: 2, regression: 1, verdict, ...(branch ? { branch } : {}), ...extra }, null]
}

test('L3: Review trails key each round by landing, then branch, then path run; count stops, STOP entries handed to Lachy and docs-only diffs', (t) => {
  const h = setup(t)
  const wt = (name, at) => { const p = path.join(h.home, name); git(h, ['worktree', 'add', '-q', '--detach', p, at]); return p }
  commit(h, { 'README.md': 'x\n' }, 'base')
  // #1 (docs only) and #2 (skills) land from one checkout by --no-ff merges
  git(h, ['checkout', '-q', '-b', 'b1'])
  const x1 = commit(h, { 'docs/a.md': 'a\n', 'README.md': 'y\n' }, 'b1')
  git(h, ['checkout', '-q', 'main'])
  git(h, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from o/b1', 'b1'])
  git(h, ['checkout', '-q', '-b', 'b2'])
  const x2 = commit(h, { 'skills/x.md': 'x\n' }, 'b2')
  git(h, ['checkout', '-q', 'main'])
  git(h, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #2 from o/b2', 'b2'])
  // #3: one PR reviewed in two worktrees
  git(h, ['checkout', '-q', '-b', 'b3'])
  const y1 = commit(h, { 'docs/b.md': 'b\n' }, 'b3 one')
  const y2 = commit(h, { 'docs/c.md': 'c\n' }, 'b3 two')
  git(h, ['checkout', '-q', 'main'])
  const wt3a = wt('wt3a', y1)
  const wt3b = wt('wt3b', y2)
  git(h, ['merge', '-q', '--no-ff', '-m', 'Merge pull request #3 from o/b3', 'b3'])
  // a branch the line names, never merged
  git(h, ['checkout', '-q', '-b', 'bx'])
  const z1 = commit(h, { 'skills/z.md': 'z1\n' }, 'bx one')
  const z2 = commit(h, { 'skills/z.md': 'z2\n' }, 'bx two')
  git(h, ['checkout', '-q', 'main'])
  // b5: only a remote-tracking branch, squash-landed on main
  git(h, ['checkout', '-q', '-b', 'b5'])
  const w1 = commit(h, { 'docs/d.md': 'd\n' }, 'b5 one')
  const w2 = commit(h, { 'docs/e.md': 'e\n' }, 'b5 two')
  git(h, ['update-ref', 'refs/remotes/origin/b5', 'b5'])
  git(h, ['checkout', '-q', 'main'])
  git(h, ['branch', '-q', '-D', 'b5'])
  commit(h, { 'docs/d.md': 'd\n', 'docs/e.md': 'e\n' }, 'b5 squashed (#5)')
  // a head on two branches
  git(h, ['checkout', '-q', '-b', 'b6'])
  const v1 = commit(h, { 'skills/v.md': 'v\n' }, 'b6')
  git(h, ['branch', 'b6copy', 'b6'])
  git(h, ['checkout', '-q', 'main'])
  // straight onto main: no merge commit
  const k1 = commit(h, { 'docs/k.md': 'k1\n' }, 'k1')
  const k2 = commit(h, { 'docs/k.md': 'k2\n' }, 'k2')
  // the stops' branch
  git(h, ['checkout', '-q', '-b', 'bs'])
  const s1 = commit(h, { 'skills/s.md': 's\n' }, 'bs')
  git(h, ['checkout', '-q', 'main'])
  git(h, ['update-ref', 'refs/remotes/origin/main', 'main'])
  const [wtx1, wtx2, wt5a, wt5b, two, gap, desc, cross, wts, ha, hb, hc, wtp] = [['wtx1', z1], ['wtx2', z2], ['wt5a', w1], ['wt5b', w2], ['run-two', v1],
    ['run-gap', k2], ['run-desc', k2], ['run-cross', k2], ['wts', s1], ['hand-a', s1], ['hand-b', s1], ['hand-c', s1], ['wtp', s1]].map(([n, at]) => wt(n, at))
  const goneSibling = path.join(h.home, 'repo-x')
  const goneRepo = path.join(h.home, 'zzz-y')
  emitAll(h, null, [
    round(h, T(21, '01:00'), h.repo, x1), round(h, T(21, '02:00'), h.repo, x2),
    round(h, T(21, '03:00'), wt3a, y1), round(h, T(21, '04:00'), wt3b, y2, { mode: 'simplify' }),
    round(h, T(21, '05:00'), wtx1, z1, { branch: 'feat/x' }), round(h, T(21, '06:00'), wtx2, z2, { branch: 'feat/x' }),
    round(h, T(21, '07:00'), wt5a, w1), round(h, T(21, '08:00'), wt5b, w2),
    round(h, T(21, '09:00'), two, v1),
    round(h, T(22, '00:00'), gap, k1), round(h, T(22, '13:00'), gap, k2),
    round(h, T(23, '00:00'), desc, k1), round(h, T(23, '01:00'), desc, k2),
    round(h, T(23, '02:00'), cross, v1), round(h, T(23, '03:00'), cross, k1),
    round(h, T(23, '04:00'), goneSibling, k1), round(h, T(23, '05:00'), goneRepo, 'deadbee'),
    ...['continue', 'stop', 'stop', 'continue', 'stop'].map((v, i) => round(h, T(24, `0${i}:00`), wts, s1, { verdict: v, branch: 'feat/s' })),
    round(h, T(24, '10:00'), ha, s1, { verdict: 'stop', branch: 'feat/ha' }), round(h, T(24, '10:00'), hb, s1, { verdict: 'stop', branch: 'feat/hb' }),
    round(h, T(24, '10:00'), hc, s1, { verdict: 'stop', branch: 'feat/hc' }),
    round(h, T(18, '00:00'), wtp, s1, { branch: 'feat/old' }),
    // pending then consumed: one round, at its reviewedAt
    round(h, T(24, '20:00'), wtp, s1, { branch: 'feat/p', doc: 'docs/reviews/p.md', extra: { status: 'pending' } }),
    round(h, T(24, '21:00'), wtp, s1, { branch: 'feat/p', doc: 'docs/reviews/p.md', extra: { status: 'consumed', reviewedAt: T(24, '19:30') } }),
  ])
  emitAll(h, 'eng', [[T(22, '00:00'), 'set-aside', 'e1', { stage: 'review', reasonClass: 'review-rounds' }]])
  const ask = (sid, ts, id, cwd) => transcript(h, 'hands', sid, [askE(ts, id, [Q('Stop here?', ['Yes (Recommended)', 'No'])], { cwd })])
  ask(SID('1'), T(24, '10:10'), 'ha1', ha)
  ask(SID('2'), T(24, '10:40'), 'hb1', hb)
  ask(SID('3'), T(24, '10:10'), 'hc1', path.join(h.home, 'elsewhere'))
  const b = block(h)
  const items = b.attention.trails.items
  const one = (label) => { const xs = items.filter((x) => x.label === label); assert.equal(xs.length, 1, `${label}: ${JSON.stringify(items.map((x) => x.label))}`); return xs[0] }
  assert.deepEqual([one('#1').key, one('#1').rounds, one('#1').docsOnly, one('#2').rounds, one('#2').docsOnly], ['landing', 1, true, 1, false], 'two landings from one checkout are two trails')
  assert.deepEqual([one('#3').checkouts, one('#3').rounds, one('#3').simplifyRounds, one('#3').docsOnly], [[wt3a, wt3b], 2, 1, true])
  assert.deepEqual([one('feat/x').key, one('feat/x').checkouts.length, one('feat/x').rounds, one('feat/x').docsOnly], ['branch', 2, 2, false], 'the line\'s branch')
  assert.deepEqual([one('origin/b5').checkouts, one('origin/b5').rounds, one('origin/b5').docsOnly], [[wt5a, wt5b], 2, true], 'one remote-tracking branch; a squash reads by its branch')
  assert.deepEqual([one('run-two').key, one('run-two').rounds], ['path', 1], 'a head on two branches is a path run')
  assert.deepEqual(items.filter((x) => x.label === 'run-gap').map((x) => x.rounds), [1, 1], '13 h apart: two runs')
  assert.deepEqual([one('run-desc').rounds, one('run-desc').docsOnly], [2, null], 'an hour apart and descending: one run; a fast-forward\'s docs-only is unknown')
  assert.deepEqual(items.filter((x) => x.label === 'run-cross').map((x) => x.rounds), [1, 1], 'a head that does not descend: two runs')
  assert.deepEqual([one('repo-x').identity, one('repo-x').checkouts], ['o/r', [goneSibling]], 'a gone sibling resolves to its repo')
  assert.deepEqual([one('zzz-y').identity, one('zzz-y').docsOnly], [goneRepo, null])
  assert.ok(b.attention.cannotShow.some((c) => c.includes(`checkout ${goneRepo} resolves to no repo`)), JSON.stringify(b.attention.cannotShow))
  assert.ok(b.attention.cannotShow.some((c) => c.startsWith('Review trail run-desc: docs-only is unknown')))
  assert.deepEqual([one('feat/s').rounds, one('feat/s').stopRounds, one('feat/s').stops], [5, 3, 2], '[continue, stop, stop, continue, stop]')
  assert.deepEqual([one('feat/ha').stopsHanded, one('feat/ha').handedAfterStop, one('feat/hb').stopsHanded, one('feat/hc').stopsHanded], [1, ['ha1#0'], 0, 0])
  assert.ok(!items.some((x) => x.label === 'feat/old'), 'a trail with no round in the window is not read')
  assert.deepEqual([one('feat/p').rounds, one('feat/p').first, one('feat/p').last], [1, T(24, '19:30'), T(24, '19:30')], 'pending then consumed is one round, at reviewedAt')
  const c = b.attention.trails.counts
  assert.deepEqual([c.count, c.rounds, c.stops, c.stopsHanded, c.engineStops], [items.length, items.reduce((n, x) => n + x.rounds, 0), 5, 1, 1])
  assert.deepEqual(c.docsOnly, { trails: 3, rounds: 5 })
  const q = Object.fromEntries(b.attention.questions.items.map((x) => [x.id, x.handedAfterStop]))
  assert.deepEqual(q, { 'ha1#0': true, 'hb1#0': false, 'hc1#0': false })
})

// A branch `bs` off main with origin/main at main, and a detached worktree at its head: a round there with a `branch` keys
// by that branch.
function branchCheckout(h, name) {
  commit(h, { 'README.md': 'x\n' }, 'base')
  git(h, ['checkout', '-q', '-b', 'bs'])
  const s1 = commit(h, { 'skills/s.md': 's\n' }, 'bs')
  git(h, ['checkout', '-q', 'main'])
  git(h, ['update-ref', 'refs/remotes/origin/main', 'main'])
  const wt = path.join(h.home, name)
  git(h, ['worktree', 'add', '-q', '--detach', wt, s1])
  return [wt, s1]
}

// p34-5: the trails read through score.py's read_review_rounds, the one copy of run_record's reader rule: a doc's
// consumed line with no branch keeps its pending line's, and a round is timed by a UTC Z reviewedAt only.
test('L3: a round takes its branch from the newest line of its doc that carries one, and is timed by a UTC Z reviewedAt, else its arrival', (t) => {
  const h = setup(t)
  const [wq, s1] = branchCheckout(h, 'wtq')
  emitAll(h, null, [
    round(h, T(24, '01:00'), wq, s1, { branch: 'feat/q', doc: 'docs/reviews/q.md', extra: { status: 'pending' } }),
    round(h, T(24, '02:00'), wq, s1, { doc: 'docs/reviews/q.md', extra: { status: 'consumed' } }),
  ])
  // fresh-review's ledger writes its lines itself (run_record's mirror contract): one with an offset reviewedAt
  fs.appendFileSync(path.join(h.ev, 'reviews.jsonl'), `${JSON.stringify({ v: 1, ts: T(24, '20:00'), host: 'h', rollout: null, task: null,
    kind: 'review-round', repo: wq, head: s1, digest: 'n00001', doc: 'docs/reviews/n.md', mode: 'code', effort: 'xhigh', findings: 1,
    original: 1, regression: 0, verdict: 'continue', branch: 'feat/n', reviewedAt: '2026-10-24T18:00:00+00:00' })}\n`)
  const items = block(h).attention.trails.items
  assert.deepEqual(items.map((x) => [x.label, x.key, x.rounds, x.first]),
    [['feat/q', 'branch', 1, T(24, '01:00')], ['feat/n', 'branch', 1, T(24, '20:00')]], JSON.stringify(items))
})

test('L3: the transcripts\' floor is the first round of a trail read: a round in no trail read never moves it, one before the window in a trail read does, and none older than 28 days before the window is keyed', (t) => {
  // A: an old round on a gone repo, its trail with no round in the window, and a round 50 days back on the branch of a
  // trail read. A transcript last written between the old round and the floor (until - 14 days) is never read, so its
  // ask, a question in the window 10 minutes after the trail's stop, is neither in the Question ledger nor handed.
  const h = setup(t)
  const [wa, s1] = branchCheckout(h, 'wa')
  const goneOld = path.join(h.home, 'gone-old')
  emitAll(h, null, [
    round(h, '2026-09-01T00:00:00.000Z', wa, s1, { verdict: 'stop', branch: 'feat/a' }),
    round(h, T(10, '00:00'), goneOld, 'deadbee'),
    round(h, T(24, '10:00'), wa, s1, { verdict: 'stop', branch: 'feat/a' }),
  ])
  transcript(h, 'early', SID('1'), [askE(T(24, '10:10'), 'a1', [Q('Stop here?', ['Yes', 'No'])], { cwd: wa })], { mtime: new Date(T(11, '00:00')) })
  const a = block(h)
  assert.deepEqual(a.attention.trails.items.map((x) => [x.label, x.rounds, x.first, x.stopsHanded, x.handedAfterStop]),
    [['feat/a', 1, T(24, '10:00'), 0, []]], 'the September round is not keyed; the gone repo\'s trail is not read')
  assert.deepEqual(a.attention.questions.items, [], 'the early transcript is not read')
  assert.ok(!a.attention.cannotShow.some((c) => c.includes(goneOld)), 'a trail not read names no checkout')
  // B: a trail read whose first round, a stop, is 15 days before the window: the transcripts are read back to it, so a
  // question 10 minutes after that stop, in a file last written then, is handed (and is no question of the window).
  const h2 = setup(t)
  const [wr, r1] = branchCheckout(h2, 'wr')
  emitAll(h2, null, [round(h2, T(5, '00:00'), wr, r1, { verdict: 'stop', branch: 'feat/r' }), round(h2, T(22, '00:00'), wr, r1, { branch: 'feat/r' })])
  transcript(h2, 'early', SID('2'), [askE(T(5, '00:10'), 'r1', [Q('Stop here?', ['Yes', 'No'])], { cwd: wr })], { mtime: new Date(T(5, '00:10')) })
  const b = block(h2)
  assert.deepEqual(b.attention.trails.items.map((x) => [x.label, x.rounds, x.first, x.stopsHanded, x.handedAfterStop]),
    [['feat/r', 2, T(5, '00:00'), 1, ['r1#0']]])
  assert.deepEqual(b.attention.questions.items, [])
})

// ---- L4: waits to start -------------------------------------------------------------------------------------------------

test('L4: a rollout\'s wait runs from the earliest captured: of its queue\'s tasks (carried rows skipped), else its own; open while unstarted', (t) => {
  const h = setup(t)
  taskNote(h, 't1', { captured: '2026-10-18', dir: path.join(h.tasks, 'Archive', '2026') })
  taskNote(h, 't2', { captured: '2026-10-20' })
  taskNote(h, 't3', { captured: '2026-10-01' })
  taskNote(h, 't4', { captured: null })
  rolloutNote(h, 'r-started', { captured: '2026-10-22', queue: [['t1', '—'], ['t2', 'solo'], ['t3', 'carried (queued)']] })
  emitAll(h, 'r-started', [[T(23, '00:00'), 'slot-taken', 't1', { settings: { parallel_ceiling: 2 }, start: 'start' }],
    [T(23, '01:00'), 'slot-freed', 't1', { outcome: 'ready' }], [T(23, '02:00'), 'merged', 't1', { pr: 1 }]])
  rolloutNote(h, 'r-open', { captured: '2026-10-25', queue: [['t4', '—'], ['t-missing', '—']] })
  rolloutNote(h, 'r-serial', { captured: '2026-10-22', fm: ['protocol_version: 5', 'shape: serial'] })
  rolloutNote(h, 'r-old', { captured: '2026-10-01', status: 'done', archived: true, fm: ['protocol_version: 5', 'completed: 2026-10-05'] })
  // a captured: no calendar holds reads as none, named, and never costs the block
  taskNote(h, 't5', { captured: '2026-02-30' })
  rolloutNote(h, 'r-badtask', { captured: '2026-10-23', queue: [['t5', '—']] })
  rolloutNote(h, 'r-badown', { captured: '2026-13-01', queue: [['t2', '—']] })
  const b = block(h)
  const w = Object.fromEntries(b.attention.waits.map((x) => [x.rollout, x]))
  assert.deepEqual(Object.keys(w).sort(), ['r-badown', 'r-badtask', 'r-open', 'r-started'])
  assert.deepEqual([w['r-badtask'].ask, w['r-badtask'].scheduled, w['r-badtask'].hours], [T(22, '13:00'), T(22, '13:00'), 72], 'the task\'s bad date: the note\'s own')
  assert.deepEqual([w['r-badown'].ask, w['r-badown'].scheduled, w['r-badown'].scheduleHours], [T(19, '13:00'), null, null], 'the note\'s bad date: no scheduled')
  for (const n of ['t5.md: captured: 2026-02-30', 'r-badown.md: captured: 2026-13-01']) {
    assert.ok(b.attention.cannotShow.includes(`${n} is no calendar date: read as none`), JSON.stringify(b.attention.cannotShow))
  }
  assert.deepEqual([w['r-started'].ask, w['r-started'].scheduled, w['r-started'].started, w['r-started'].hours, w['r-started'].scheduleHours, w['r-started'].open],
    [T(17, '13:00'), T(21, '13:00'), T(23, '00:00'), 131, 35, false], 'the Archive task\'s date wins; the carried row is skipped')
  assert.deepEqual([w['r-open'].ask, w['r-open'].started, w['r-open'].hours, w['r-open'].open], [T(24, '13:00'), null, 24, true], 'no linked date: the note\'s own')
  assert.ok(b.flags.includes('attention: wait of [[r-open]]: its queue links [[t-missing]], which has no note'), JSON.stringify(b.flags))
  assert.ok(b.attention.cannotShow.some((c) => c.startsWith('a serial chain has no wait to start') && c.includes('[[r-serial]]')))
})

// ---- L5: W1, a work item circling across Sessions -------------------------------------------------------------------------

const S = (n) => SID(String(n))
function touch(h, sid, slugs, ts = T(22, '00:00'), opts = {}) {
  transcript(h, 'touch', sid, [promptE(ts, `look at ${slugs.map((s) => `[[${s}]]`).join(' and ')} please`, opts)])
}

test('L5: W1 lists an unmerged work item three Sessions touched while no rollout holds it; held, merged or no-work-item notes are not listed', (t) => {
  const h = setup(t)
  const listed = ['w-merged-after', 'w-slot-after', 'w-aside-plan', 'w-aside-int', 'w-carried', 'w-arch-done', 'w-arch-open']
  const notListed = ['w-merged-before', 'w-in-slot', 'w-in-lane', 'w-retried', 'w-merged-line', 'w-no-keys', 'r-note', 'big-item']
  for (const n of [1, 2, 3]) touch(h, S(n), [...listed, ...notListed])
  touch(h, S(4), ['w-two'])
  touch(h, S(5), ['w-two'])
  transcript(h, 'touch', S(1), [askE(T(22, '01:00'), 'q1', [Q('Which?', ['A', 'B'])], { cwd: h.repo }), resultE(T(22, '01:05'), 'q1', answered([['Which?', 'A']]))])
  for (const s of ['w-slot-after', 'w-aside-plan', 'w-aside-int', 'w-carried', 'w-in-slot', 'w-in-lane', 'w-retried', 'w-merged-line', 'w-two']) taskNote(h, s)
  taskNote(h, 'w-merged-after', { status: 'done', fm: ['phase: 1', 'merged: 2026-10-26T10:00+11:00'] })
  taskNote(h, 'w-merged-before', { status: 'done', fm: ['phase: 1', 'merged: 2026-10-24T10:00+11:00'] })
  taskNote(h, 'w-arch-done', { status: 'done', fm: ['phase: 1', 'merged: 2026-10-27T10:00+11:00', 'completed: 2026-10-27'], dir: path.join(h.tasks, 'Archive', '2026') })
  taskNote(h, 'w-arch-open', { fm: ['rollout: "[[roll-a]]"'], dir: path.join(h.tasks, 'Archive', '2026') })
  taskNote(h, 'w-no-keys', { fm: [] })
  taskNote(h, 'r-note', { tags: '[task, rollout]' })
  taskNote(h, 'Big-Item')
  const ST = (task, ts, start = 'start') => [ts, 'slot-taken', task, { settings: { parallel_ceiling: 2 }, start }]
  emitAll(h, 'roll-a', [
    ST('w-in-slot', T(22, '00:00')),
    ST('w-in-lane', T(22, '00:00')), [T(22, '01:00'), 'slot-freed', 'w-in-lane', { outcome: 'ready' }], [T(22, '01:00'), 'ready', 'w-in-lane', { pr: 3 }],
    [T(22, '02:00'), 'lane-taken', 'w-in-lane', {}],
    ST('w-retried', T(21, '00:00')), [T(21, '01:00'), 'set-aside', 'w-retried', { stage: 'implement', reasonClass: 'transient' }],
    [T(21, '01:30'), 'auto-retry', 'w-retried', { stage: 'implement', setAsideAt: 'run', retryClass: 'infra', used: 1, budget: 2 }],
    ST('w-retried', T(21, '02:00'), 'hand-back'),
    ST('w-aside-plan', T(21, '03:00')), [T(21, '04:00'), 'set-aside', 'w-aside-plan', { stage: 'plan', reasonClass: 'plan-rejected' }],
    ST('w-aside-int', T(21, '03:00')), [T(21, '05:00'), 'set-aside', 'w-aside-int', { stage: 'integrate', reasonClass: 'integration-conflict', setAsideAt: 'integration' }],
    ST('w-carried', T(21, '03:00')), [T(21, '06:00'), 'set-aside', 'w-carried', { stage: 'gate', reasonClass: 'gate' }],
    ST('w-merged-line', T(21, '03:00')), [T(21, '07:00'), 'merged', 'w-merged-line', { pr: 9 }],
    ST('w-slot-after', T(26, '00:00')),
  ])
  emitAll(h, 'roll-b', [[T(22, '00:00'), 'carried', 'w-carried', { from: 'roll-a', to: 'roll-b' }]])
  rolloutNote(h, 'roll-a')
  rolloutNote(h, 'roll-b')
  const b = block(h)
  const w1 = b.attention.circling.W1
  assert.deepEqual(w1.map((x) => x.slug), [...listed].sort())
  assert.ok(w1.every((x) => x.sessions === 3 && x.questions === 1), JSON.stringify(w1))
  const held = Object.fromEntries(w1.map((x) => [x.slug, x.heldBy && [x.heldBy.rollout, x.heldBy.reasonClass, x.heldBy.stage]]))
  assert.deepEqual(held, { 'w-arch-done': null, 'w-arch-open': null, 'w-aside-int': ['roll-a', 'integration-conflict', 'integrate'],
    'w-aside-plan': ['roll-a', 'plan-rejected', 'plan'], 'w-carried': ['roll-a', 'gate', 'gate'], 'w-merged-after': null, 'w-slot-after': null })
  const cannot = b.attention.cannotShow.join('\n')
  assert.match(cannot, /no note is named exactly so: \[\[big-item\]\]/)
  assert.match(cannot, /its note is no task \(a rollout, phase or project note\): \[\[r-note\]\]/)
  assert.match(cannot, /carries no phase:, pr: or rollout: \(no work item\): \[\[w-no-keys\]\]/)
})

test('L5: a reading\'s own Sessions never count as touches; a grep, rung, a sidechain or a prompt that quotes the command marks nothing', (t) => {
  const h = setup(t)
  const P = '${CLAUDE_PLUGIN_ROOT}/skills/reflect/scripts'
  const readers = { 'x-span': `python3 ${P}/reflect.py span --since ${SINCE} --out /tmp/w/span.json`, 'x-decide': `python3 /p/skills/reflect/scripts/reflect.py decide --span /tmp/w/span.json`,
    'x-tally': `python3 -B /p/skills/reflect/scripts/attention.py tally --span F --session abcdefgh`, 'x-score': `python3 ${P}/score.py --rollout r --note n` }
  const controls = { 'y-plain': null, 'y-grep': 'grep -n x skills/reflect/scripts/reflect.py', 'y-rung': 'python3 skills/reflect/scripts/reflect.py rung' }
  const all = [...Object.keys(readers), 'x-late', ...Object.keys(controls), 'y-side', 'y-prompt']
  for (const s of all) taskNote(h, s)
  touch(h, S(1), [...all, 'rl-w2'])
  touch(h, S(2), all)
  const third = {}
  let n = 10
  for (const [slug, cmd] of Object.entries(readers)) {
    third[slug] = SID(String.fromCharCode(97 + n++))
    transcript(h, 'r', third[slug], [promptE(T(22, '02:00'), `go [[${slug}]]`), bashE(T(22, '02:01'), cmd)])
  }
  third['x-late'] = SID('u')
  transcript(h, 'r', third['x-late'], [promptE(T(22, '02:00'), 'go [[x-late]] and [[rl-w2]]'), bashE(T(26, '02:00'), readers['x-span'])])
  for (const [slug, cmd] of Object.entries(controls)) {
    third[slug] = SID(String.fromCharCode(97 + n++))
    transcript(h, 'r', third[slug], [promptE(T(22, '02:00'), `go [[${slug}]]`), ...(cmd ? [bashE(T(22, '02:01'), cmd)] : [])])
  }
  third['y-side'] = SID('v')
  transcript(h, 'r', third['y-side'], [promptE(T(22, '02:00'), 'go [[y-side]]'), bashE(T(22, '02:01'), readers['x-span'], { sidechain: true })])
  third['y-prompt'] = SID('w')
  transcript(h, 'r', third['y-prompt'], [promptE(T(22, '02:00'), `go [[y-prompt]] then run ${readers['x-span']}`)])
  // W2: a rollout three days open, touched by one Session and a reading
  rolloutNote(h, 'rl-w2')
  emitAll(h, 'rl-w2', [[T(22, '00:00'), 'slot-taken', 'z', { settings: { parallel_ceiling: 2 }, start: 'start' }]])
  const b = block(h)
  const c = b.attention.circling
  assert.deepEqual(c.W1.map((x) => [x.slug, x.sessions]), ['y-grep', 'y-plain', 'y-prompt', 'y-rung', 'y-side'].map((s) => [s, 3]))
  assert.deepEqual(c.readings, [...Object.keys(readers), 'x-late'].map((s) => third[s].slice(0, 8)).sort())
  assert.deepEqual(c.W2.map((x) => [x.slug, x.sessions]), [['rl-w2', 1]], 'W2 leaves the reading out too')
  const re = py(h, ATTENTION, '[bool(m.READING_RE.search(x)) for x in a]', [...Object.values(readers), ...Object.values(controls).filter(Boolean),
    'python3 skills/reflect/scripts/reflect.py raised --watch x --reflection r', 'python3 "$P/skills/reflect/scripts/reflect.py" span --out x',
    'python3 skills/reflect/scripts/reflect.py moot --task t --trade k --from 3 --why w', 'python3 /c/scripts/companion/reflect.py span'])
  assert.deepEqual(re, [true, true, true, true, false, false, false, true, false, false])
})

// ---- L6: W2, a rollout open 48 hours with nothing merged ------------------------------------------------------------------

test('L6: W2 lists an open rollout 48 hours in with no merge, a real rollout note with no record from its captured day; closed, young, merged or not-rollout notes are not listed', (t) => {
  const h = setup(t)
  const line = (task, ts) => [ts, 'slot-taken', task, { settings: { parallel_ceiling: 2 }, start: 'start' }]
  emitAll(h, 'w2-old', [line('a', T(22, '00:00'))])
  rolloutNote(h, 'w2-old')
  emitAll(h, 'w2-superseded', [line('b', T(21, '00:00'))])
  rolloutNote(h, 'w2-superseded', { status: 'superseded', archived: true, fm: ['protocol_version: 5', 'superseded_by: "[[w2-next]]"'] })
  taskNote(h, 'w2-next', { captured: '2026-10-26', fm: [] })
  rolloutNote(h, 'w2-noted', { captured: '2026-10-21' })
  rolloutNote(h, 'w2-queue', { captured: '2026-10-22', fm: [], queue: [] })
  rolloutNote(h, 'w2-paused', { status: 'paused', captured: '2026-10-20' })
  emitAll(h, 'w2-merged', [line('c', T(21, '00:00')), [T(21, '05:00'), 'merged', 'c', { pr: 4 }]])
  rolloutNote(h, 'w2-merged')
  emitAll(h, 'w2-young', [line('d', T(24, '00:00'))])
  rolloutNote(h, 'w2-young')
  emitAll(h, 'w2-completed', [line('e', T(21, '00:00'))])
  rolloutNote(h, 'w2-completed', { status: 'done', fm: ['protocol_version: 5', 'completed: 2026-10-23'] })
  emitAll(h, 'w2-closeline', [line('f', T(21, '00:00')), [T(23, '00:00'), 'tuning', null, { id: 't-close', repo: 'o/r',
    window: { since: T(21, '00:00'), until: T(23, '00:00'), activeStart: T(21, '00:00'), activeEnd: T(23, '00:00'), partial: false },
    scores: { throughput: null, runningHours: null, merges: 0, tokensPerMerge: null, setAsideRate: null, conflictRate: null, quotaStalls: 0, handsOffRate: null, quality: null, reviewChurn: null },
    applied: [], close: 'completion' }]])
  rolloutNote(h, 'w2-closeline')
  emitAll(h, 'w2-serial', [[T(21, '00:00'), 'answer-recorded', 'g', { answerKind: 'decision' }]])
  rolloutNote(h, 'w2-serial', { fm: ['protocol_version: 5', 'shape: serial'], body: '## Leg log\n\n- 2026-10-22T10:00+11:00 Leg 1 done [[g]] (verify pass)\n' })
  emitAll(h, 'w2-dropped', [line('i', T(21, '00:00')), [T(22, '00:00'), 'slot-freed', 'i', { outcome: 'stopped' }]])
  rolloutNote(h, 'w2-dropped', { status: 'dropped', archived: true })
  emitAll(h, 'w2-nonote', [line('j', T(21, '00:00'))])
  fs.writeFileSync(path.join(h.tasks, 'Archive', 'Rollouts', 'Rollouts.md'), '---\ntags: [reference, rollout]\ncaptured: 2026-06-12\n---\n\n# Rollouts\n')
  rolloutNote(h, 'Big-Rollout', { status: 'open' })
  rolloutNote(h, 'w2-plain', { status: 'open', fm: [] })
  rolloutNote(h, 'w2-sup-silent', { status: 'superseded', captured: '2026-10-20' })
  rolloutNote(h, 'w2-sup-next', { status: 'superseded', captured: '2026-10-20', fm: ['protocol_version: 5', 'superseded_by: "[[w2-next]]"'] })
  // a captured: no calendar holds reads as none, named, and never costs the block
  rolloutNote(h, 'w2-baddate', { captured: '2026-02-30' })
  emitAll(h, 'w2-sup-bad', [line('k', T(21, '00:00'))])
  rolloutNote(h, 'w2-sup-bad', { status: 'superseded', archived: true, fm: ['protocol_version: 5', 'superseded_by: "[[w2-next-bad]]"'] })
  taskNote(h, 'w2-next-bad', { captured: '2026-02-30', fm: [] })
  const b = block(h)
  const w2 = b.attention.circling.W2
  assert.deepEqual(w2.map((x) => x.slug).sort(), ['w2-noted', 'w2-old', 'w2-paused', 'w2-queue', 'w2-superseded'])
  const hrs = Object.fromEntries(w2.map((x) => [x.slug, x.hours]))
  assert.deepEqual([hrs['w2-old'], hrs['w2-noted'], hrs['w2-queue'], hrs['w2-superseded']], [85, 120, 96, 109])
  const cannot = b.attention.cannotShow
  assert.ok(cannot.includes('record w2-nonote has no rollout note: never a circling rollout or a wait to start'), JSON.stringify(cannot))
  assert.ok(cannot.includes('Big-Rollout.md: tagged rollout but not a rollout note (its name is no slug)'))
  assert.ok(cannot.includes('w2-plain.md: tagged rollout but not a rollout note (no protocol_version: and no ## Queue)'))
  assert.ok(!cannot.some((c) => /Rollouts\.md|w2-sup-/.test(c)), 'the hub and a closed note-only rollout are skipped silently')
  assert.ok(cannot.includes('w2-baddate.md: captured: 2026-02-30 is no calendar date: read as none'), JSON.stringify(cannot))
  assert.ok(cannot.includes('w2-baddate.md: a rollout note with no record and no captured: date: never a circling rollout'))
  assert.ok(cannot.includes('w2-next-bad.md: captured: 2026-02-30 is no calendar date: read as none'), 'a superseding note\'s bad date')
  // the verb writes its line from that block, and the reading closes
  const sp = handSpan(h, RID(1), { attention: b.attention })
  const r = ok(h, ['attention', '--span', sp.out])
  assert.match(r.stdout, /attention line, watch \S+ \(W2, 5 items\) written/)
  ok(h, ['close', '--span', sp.out])
})

// ---- L7: the circling Watches into decide, close and the cadence ---------------------------------------------------------

const RID = (k) => `r-202610${String(k).padStart(2, '0')}T000000Z-${String(k).padStart(6, '0')}`
const ZERO_TRAILS = { count: 0, rounds: 0, codeRounds: 0, simplifyRounds: 0, stopRounds: 0, stops: 0, stopsHanded: 0, findings: 0, regression: 0,
  docsOnly: { trails: 0, rounds: 0 }, engineStops: 0, longest: [] }
const attBlock = ({ W1 = [], W2 = [], readings = [] } = {}) => ({ questions: { items: [], counts: {} }, trails: { items: [], counts: ZERO_TRAILS }, waits: [],
  circling: { W1: W1.map((slug) => ({ slug, sessions: 3, questions: 0 })), W2: W2.map((slug) => ({ slug, sessions: 1, questions: 0, hours: 60 })), readings },
  watches: {}, trend: [], flags: [], cannotShow: [] })
// a span.json in span's shape: the reading k (week k of September), with an attention block (`attention` as given; none
// with noAttention, a span from before p30-7)
function handSpan(h, rid, { attention = attBlock(), noAttention = false, rollouts = [], ledger = undefined, k = null, extra = {} } = {}) {
  const kk = k ?? Number(rid.slice(8, 10))
  const since = new Date(Date.UTC(2026, 8, 1 + 7 * (kk - 1))).toISOString()
  const until = new Date(Date.UTC(2026, 8, 8 + 7 * (kk - 1))).toISOString()
  const dir = path.join(h.out, rid)
  const doc = { reflection: rid, since, until, previous: null, knobs: { revert: [], land: [], held: [] },
    rollouts: rollouts.map((r) => ({ rollout: r, mode: 'read', repo: 'o/r', breached: [], breachCounts: false, proposals: [], friction: [] })), ...extra }
  if (!noAttention) doc.attention = attention
  if (ledger !== undefined) doc.ledger = ledger
  return { dir, out: writeJson(dir, 'span.json', doc), until }
}
const W = (h) => py(h, ATTENTION, '{k: [v, m.RULES[k][0], m.RULES[k][1]] for k, v in m.CIRCLING_IDS.items()}')
const closeLine = (h, rid) => rlines(h).find((l) => l.kind === 'reflection' && l.id === rid)
const decide = (h, sp, extra = []) => ok(h, ['decide', '--span', sp.out, '--decisions', writeJson(sp.dir, 'd.json', {}), '--tasks-dir', h.tasks, '--now', sp.until, ...extra])

test('L7: decide and close wait for attention; with a ledger block, ledger is named first', (t) => {
  const h = setup(t)
  const sp = handSpan(h, RID(1), { attention: attBlock({ W2: ['x'] }) })
  const before = listing(h.tasks)
  refused(h, ['decide', '--span', sp.out, '--tasks-dir', h.tasks], new RegExp(`^reflect: Reflection ${RID(1)} has no attention line: run attention \\(its circling Watches reach the decision task through it\\): nothing written\\n$`))
  assert.deepEqual(listing(h.tasks), before, 'the vault untouched')
  refused(h, ['close', '--span', sp.out], new RegExp(`^reflect: Reflection ${RID(1)} is not closed: no attention line from this Reflection: run attention\\n$`))
  const row = { id: 'tl-record-x', source: 'record', reflection: RID(2), since: '2026-09-08T00:00:00.000Z', until: '2026-09-15T00:00:00.000Z', month: '2026-09',
    hours: { stalls: 0, 'quota-bound': 0, load: 0, 'lane-bound': 0, rework: 0, 'plan-rejected': 0 }, top: null, byCause: {}, rollouts: {}, other: {}, events: {}, streak: 0 }
  const sp2 = handSpan(h, RID(2), { ledger: { row, watch: {}, audit: { due: false, month: '2026-09' } } })
  refused(h, ['close', '--span', sp2.out], /: no Time-lost ledger line from this Reflection: run ledger; no attention line from this Reflection: run attention\n$/)
  refused(h, ['decide', '--span', sp2.out, '--tasks-dir', h.tasks], /has no Time-lost ledger line: run ledger/)
})

test('L7: a lone W2 item opens its Watch in readings, recurs the next reading into a rule item; a no holds it; a partial overlap writes its fresh item alone', (t) => {
  const h = setup(t)
  const [wid, ruleText, shape] = W(h).W2
  // R1: new, not quiet, no decision task
  const r1 = handSpan(h, RID(1), { attention: attBlock({ W2: ['x'] }) })
  const a1 = ok(h, ['attention', '--span', r1.out])
  assert.match(a1.stdout, new RegExp(`attention line, watch ${wid} \\(W2, 1 item\\) written`))
  const w = rlines(h).filter((l) => l.kind === 'watch')
  assert.deepEqual(w.map((l) => [l.id, l.rule, l.shape, l.circling, l.rollouts, l.count]), [[wid, ruleText, shape, 'W2', ['x'], 1]])
  assert.equal(decide(h, r1).stdout, 'no rule proposal or held trade: no decision task\n')
  ok(h, ['close', '--span', r1.out])
  assert.deepEqual([closeLine(h, RID(1)).counts.newWatches, closeLine(h, RID(1)).counts.rules, closeLine(h, RID(1)).quiet], [1, 0, false])
  // R2: the same item recurs in readings
  const r2 = handSpan(h, RID(2), { attention: attBlock({ W2: ['x'] }) })
  ok(h, ['attention', '--span', r2.out])
  refused(h, ['close', '--span', r2.out], new RegExp(`Watch ${wid} recurs in this Reflection with no rule proposal line: run decide`))
  assert.match(decide(h, r2).stdout, /^decision task thread-skill-decisions-/)
  const task = fs.readdirSync(h.tasks).find((f) => f.startsWith('thread-skill-decisions-'))
  assert.match(fs.readFileSync(path.join(h.tasks, task), 'utf8'), new RegExp(`^- ${wid}: rule ${ruleText}; shape ${shape}; rollouts \\[\\[x\\]\\]`, 'm'))
  ok(h, ['raised', '--watch', wid, '--reflection', RID(2), '--declined'])
  ok(h, ['close', '--span', r2.out])
  assert.deepEqual([closeLine(h, RID(2)).counts.rules, closeLine(h, RID(2)).quiet], [1, false])
  fs.writeFileSync(path.join(h.tasks, task), fs.readFileSync(path.join(h.tasks, task), 'utf8').replace('status: open', 'status: done'))
  // R3..R5: every item was in a closed cycle: held, no watch line, quiet; the cadence relaxes at R5
  for (const k of [3, 4, 5]) {
    const r = handSpan(h, RID(k), { attention: attBlock({ W2: ['x'] }) })
    const out = ok(h, ['attention', '--span', r.out]).stdout
    assert.match(out, new RegExp(`^held ${wid}: every item was in a closed cycle$`, 'm'))
    assert.equal(rlines(h).filter((l) => l.kind === 'watch' && l.reflection === RID(k)).length, 0)
    const c = ok(h, ['close', '--span', r.out]).stdout
    assert.equal(closeLine(h, RID(k)).quiet, true, `R${k}`)
    if (k === 5) assert.match(c, /cadence 7 -> 14\n$/)
  }
  // R6: x and y: y alone is written, in a new cycle: not new, not recurring, never a Watch to confirm: quiet
  const r6 = handSpan(h, RID(6), { attention: attBlock({ W2: ['x', 'y'] }) })
  ok(h, ['attention', '--span', r6.out])
  assert.deepEqual(rlines(h).filter((l) => l.kind === 'watch' && l.reflection === RID(6)).map((l) => l.rollouts), [['y']])
  assert.equal(decide(h, r6).stdout, 'no rule proposal or held trade: no decision task\n')
  ok(h, ['close', '--span', r6.out])
  assert.deepEqual([closeLine(h, RID(6)).counts.newWatches, closeLine(h, RID(6)).counts.rules, closeLine(h, RID(6)).quiet], [0, 0, true])
  // R7: y again: a rule item
  const r7 = handSpan(h, RID(7), { attention: attBlock({ W2: ['y'] }) })
  ok(h, ['attention', '--span', r7.out])
  assert.match(decide(h, r7).stdout, /^decision task /)
  ok(h, ['close', '--span', r7.out])
  assert.deepEqual([closeLine(h, RID(7)).counts.rules, closeLine(h, RID(7)).quiet], [1, false])
  // the model never writes a circling Watch
  for (const [, text, sh] of Object.values(W(h))) {
    const r8 = handSpan(h, RID(8), { rollouts: ['x'] })
    refused(h, ['watch', '--span', r8.out, '--rollout', 'x', '--rule', text, '--shape', sh, '--count', '1'], /a circling Watch \(rule .*\) is reflect\.py attention's alone: nothing written/)
  }
})

test('L7: two W1 items open one Watch in one reading (new, not recurring); the second reading recurs with the union; reruns print exists or extend', (t) => {
  const h = setup(t)
  const [wid] = W(h).W1
  const r1 = handSpan(h, RID(1), { attention: attBlock({ W1: ['a', 'b'] }) })
  ok(h, ['attention', '--span', r1.out])
  assert.equal(ok(h, ['attention', '--span', r1.out]).stdout, `exists attention ${RID(1)}\nexists ${wid}\n`, 'the same set')
  const sup = writeJson(r1.dir, 'span.json', { ...JSON.parse(fs.readFileSync(r1.out, 'utf8')), attention: attBlock({ W1: ['a', 'b', 'c'] }) })
  const ext = ok(h, ['attention', '--span', sup])
  assert.match(ext.stdout, new RegExp(`attention line, watch ${wid} \\(W1, 3 items\\) written`))
  const mine = rlines(h).filter((l) => l.kind === 'watch' && l.reflection === RID(1))
  assert.deepEqual(mine.map((l) => l.rollouts), [['a', 'b'], ['a', 'b', 'c']], 'a superset writes one extending line')
  const sub = writeJson(r1.dir, 'span.json', { ...JSON.parse(fs.readFileSync(r1.out, 'utf8')), attention: attBlock({ W1: ['a'] }) })
  assert.match(ok(h, ['attention', '--span', sub]).stdout, new RegExp(`^held ${wid}: this reading's line names \\[a, b, c\\]`, 'm'))
  ok(h, ['attention', '--span', sup])
  assert.equal(decide(h, r1).stdout, 'no rule proposal or held trade: no decision task\n')
  ok(h, ['close', '--span', r1.out])
  assert.deepEqual([closeLine(h, RID(1)).counts.newWatches, closeLine(h, RID(1)).counts.rules], [1, 0], 'one reading: new, not recurring')
  const r2 = handSpan(h, RID(2), { attention: attBlock({ W1: ['a', 'b'] }) })
  ok(h, ['attention', '--span', r2.out])
  decide(h, r2)
  const task = fs.readdirSync(h.tasks).find((f) => f.startsWith('thread-skill-decisions-'))
  assert.match(fs.readFileSync(path.join(h.tasks, task), 'utf8'), new RegExp(`^- ${wid}: rule .*; rollouts \\[\\[a\\]\\], \\[\\[b\\]\\], \\[\\[c\\]\\];`, 'm'))
  ok(h, ['close', '--span', r2.out])
  assert.equal(closeLine(h, RID(2)).counts.rules, 1)
})

test('L7: a non-slug item is dropped with a flag, never refused; the line carries no readings; null or absent attention; a circling Watch to confirm sits in the readings block', (t) => {
  const h = setup(t)
  const [wid2] = W(h).W2
  const r1 = handSpan(h, RID(1), { attention: attBlock({ W2: ['Rollouts', 'x'], readings: ['abcdef12'] }) })
  const out = ok(h, ['attention', '--span', r1.out]).stdout
  assert.match(out, /^flag: dropped Rollouts from W2: not a rollout slug$/m)
  const line = rlines(h).find((l) => l.kind === 'attention')
  assert.deepEqual([line.circling.W2.map((x) => x.slug), Object.keys(line.circling).sort()], [['x'], ['W1', 'W2']])
  assert.deepEqual(rlines(h).filter((l) => l.kind === 'watch').map((l) => l.rollouts), [['x']])
  const r2 = handSpan(h, RID(2), { attention: attBlock({ W2: ['Rollouts'] }) })
  ok(h, ['attention', '--span', r2.out])
  assert.equal(rlines(h).filter((l) => l.kind === 'watch' && l.reflection === RID(2)).length, 0)
  ok(h, ['close', '--span', r2.out])
  // no attention key closes as before; null closes and the verb refuses it
  ok(h, ['close', '--span', handSpan(h, RID(3), { noAttention: true }).out])
  const nul = handSpan(h, RID(4), { attention: null })
  refused(h, ['attention', '--span', nul.out], /has no attention block/)
  ok(h, ['close', '--span', nul.out])
  // a rule item beside a new circling Watch: it is a Watch to confirm, in the readings block
  const r5 = handSpan(h, RID(5), { attention: attBlock({ W1: ['m'] }), rollouts: ['a', 'b'] })
  ok(h, ['watch', '--span', r5.out, '--rollout', 'a', '--rollout', 'b', '--rule', 'orient § 5 grill', '--shape', 'a fork asked mid-run', '--count', '2'])
  ok(h, ['attention', '--span', r5.out])
  decide(h, r5)
  const task = fs.readdirSync(h.tasks).find((f) => f.startsWith('thread-skill-decisions-'))
  const sec = section(fs.readFileSync(path.join(h.tasks, task), 'utf8'), new RegExp(`^## Reflection ${RID(5)}$`))
  const [w1id] = W(h).W1
  assert.match(sec, /^Watches to confirm in readings \(the Time-lost ledger's and the circling detector's: one reading each; a yes files the rule's grill, a no records the decline\):$/m)
  assert.match(sec, new RegExp(`^- confirm ${w1id}: rule Circling: three or more Sessions touch a work item without it merging; shape a work item circles across Sessions; rollouts \\[\\[m\\]\\]$`, 'm'))
  assert.ok(!sec.includes(wid2))
})

test('L7: a real reading labelled with --rest-unknown closes', (t) => {
  const h = setup(t)
  questionsFixture(h)
  const sp = span(h)
  ok(h, ['ledger', '--span', sp.out])
  ok(h, ['attention', '--span', sp.out, '--rest-unknown'])
  decide(h, { ...sp, until: UNTIL })
  ok(h, ['close', '--span', sp.out])
  assert.equal(rlines(h).find((l) => l.kind === 'attention').questions.unlabelled, 8)
})

// ---- L8: hermetic ------------------------------------------------------------------------------------------------------

test('L8: with no transcripts the block is empty and flagged; span\'s stderr opens with its summary; reruns are byte-equal but for the id; no bytecode', (t) => {
  const h = setup(t)
  const a = span(h, SINCE, UNTIL, { THREAD_TRANSCRIPTS_DIR: null })
  assert.deepEqual(a.s.attention.questions.items, [])
  assert.ok(a.s.flags.includes(`attention: no transcripts directory under ${h.home}: no questions or touches read`), JSON.stringify(a.s.flags))
  assert.match(a.stderr.split('\n')[0], /^reflect: span r-\S+ 2026-10-20T13:00:00\.000Z \.\. 2026-10-25T13:00:00\.000Z: /)
  questionsFixture(h)
  const x = span(h)
  const y = span(h)
  const strip = (s) => JSON.stringify(s).replaceAll(s.reflection.slice(2), 'X')
  assert.equal(strip(x.s), strip(y.s))
  assert.ok(x.s.attention.questions.items.length > 0)
  const caches = listing(path.join(root, 'skills')).filter((p) => p.split(path.sep).includes('__pycache__'))
  assert.deepEqual(caches, [])
})
