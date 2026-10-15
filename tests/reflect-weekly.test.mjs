// skills/reflect/scripts/reflect.py — the weekly reading's script half (p21-7, ADR 0037 d3-d5): span reads every
// rollout with a line in the window (score.py per rollout, the friction, the Escapes sweep over every record, the knob
// candidates); watch, raised, bug, knobs, decide and close write reflections.jsonl (and the bug and decision tasks);
// rung reads the ladder. Every rule lives in reflect.py's docstring and run_record.py's; this pins the behaviour.
//
// Hermetic: each case gets its own mkdtemp HOME, THREAD_EVENTS_DIR and tasks dir (with Archive/2026/ and
// Archive/Rollouts/), TZ pinned to Melbourne, an env built from scratch that every spawn passes, and temp git repos
// whose origin is https://github.com/o/r.git (land.sh reads it locally, no network). Record lines go through
// run_record.emit in one python process per fixture. The writers' cases build span.json by hand (span's output
// shape), so they never wait on score.py; span's own cases and the Verify week run the real span.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REFLECT = path.join(root, 'skills', 'reflect', 'scripts', 'reflect.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
const REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()

// ---- helpers ----------------------------------------------------------------------------------------------

function setup(t, { origin = 'https://github.com/o/r.git' } = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-weekly-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const tasks = path.join(home, 'Tasks')
  for (const d of ['Archive/2026', 'Archive/Rollouts']) fs.mkdirSync(path.join(tasks, d), { recursive: true })
  fs.mkdirSync(path.join(home, 'events'), { recursive: true })
  fs.mkdirSync(path.join(home, 'out'), { recursive: true })
  const h = { home, tasks, ev: path.join(home, 'events'), out: path.join(home, 'out'), repo: path.join(home, 'repo') }
  fs.mkdirSync(h.repo)
  git(h, ['init', '-q', '-b', 'main'])
  if (origin) git(h, ['remote', 'add', 'origin', origin])
  return h
}

const env = (h, extra = {}) => ({ PATH: process.env.PATH, HOME: h.home, PYTHONDONTWRITEBYTECODE: '1', TZ: 'Australia/Melbourne',
  THREAD_EVENTS_DIR: h.ev, GIT_CONFIG_GLOBAL: path.join(h.home, 'gitconfig'), ...extra })
const git = (h, args, repo = h.repo) => execFileSync(REAL_GIT, ['-C', repo, ...args], { encoding: 'utf8',
  env: { PATH: process.env.PATH, HOME: h.home, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x', ...(h.gitEnv || {}) } }).trim()

function reflect(h, args, extra = {}) {
  const r = spawnSync('python3', ['-B', REFLECT, ...args], { encoding: 'utf8', cwd: h.home, env: env(h, extra) })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
function ok(h, args, extra) {
  const r = reflect(h, args, extra)
  assert.equal(r.status, 0, `${args[0]}: ${r.stderr}`)
  return r
}

const reflectionsFile = (h) => path.join(h.ev, 'reflections.jsonl')
const tuningsFile = (h) => path.join(h.ev, 'tunings.jsonl')
const parse = (l) => { try { return JSON.parse(l) } catch { return null } } // a torn line reads as nothing
const rlines = (h) => (fs.existsSync(reflectionsFile(h)) ? fs.readFileSync(reflectionsFile(h), 'utf8').split('\n').map(parse).filter(Boolean) : [])
const bytes = (f) => (fs.existsSync(f) ? fs.readFileSync(f) : null)
const sha = (f) => (fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'absent')
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

// run_record's own ids, so a test never restates a hash
function ids(h, calls) {
  const body = ['import importlib.util, json, sys', 'spec = importlib.util.spec_from_file_location("rr", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'print(json.dumps([m.watch_id(*c[1:]) if c[0] == "w" else m.knob_key(*c[1:]) for c in json.load(sys.stdin)]))'].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', env: env(h), input: JSON.stringify(calls) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

// A rollout note under Tasks (or Archive/Rollouts), with its Project root and a ## Notes section.
function rolloutNote(h, slug, { status = 'in_progress', archived = false, notes = [], root = h.repo, extra = '' } = {}) {
  const dir = archived ? path.join(h.tasks, 'Archive', 'Rollouts') : h.tasks
  const p = path.join(dir, `${slug}.md`)
  fs.writeFileSync(p, ['---', 'tags: [rollout]', `status: ${status}`, 'protocol_version: 5', '---', '', `# ${slug}`, '',
    root ? `Project root: \`${root}\`` : '', '', '## Notes', '', ...notes, '', extra].join('\n'))
  return p
}

function taskNote(h, slug, { status = 'open', tags = '[task, ai]', captured = '2026-09-01', body = '', fm = [], archived = false } = {}) {
  const p = path.join(archived ? path.join(h.tasks, 'Archive', '2026') : h.tasks, `${slug}.md`)
  fs.writeFileSync(p, ['---', `tags: ${tags}`, `status: ${status}`, `captured: ${captured}`, ...fm, '---', '', `# ${slug}`, '', body, ''].join('\n'))
  return p
}

// One task's life: a Slot from..to, ready, then a lane holding and its merge.
function life(slug, from, to, { lane = null, c = 2, pr = 7, merged = true } = {}) {
  const out = [[from, 'slot-taken', slug, { settings: { parallel_ceiling: c, max_review_rounds: 4, max_iterations: 3, max_plan_rounds: 3 }, start: 'start' }],
    [to, 'slot-freed', slug, { outcome: 'ready' }], [to, 'ready', slug, { pr }]]
  if (lane) {
    out.push([lane[0], 'lane-taken', slug, {}], [lane[1], 'lane-freed', slug, { release: 'merge', path: 'lead', triggers: [], conflict: false }])
    if (merged) out.push([lane[1], 'merged', slug, { pr }])
  }
  return out
}
const byTs = (ev) => [...ev].sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))

// The default window for span's own cases: a past week, never clamped.
const SINCE = '2026-09-03T00:00+10:00'
const UNTIL = '2026-09-10T00:00+10:00'
const W = (d, hm) => `2026-09-0${d}T${hm}:00Z` // a UTC stamp inside the window for d in 3..9

function span(h, extra = [], { since = SINCE, until = UNTIL } = {}) {
  const out = path.join(h.out, 'span.json')
  const args = ['span', '--tasks-dir', h.tasks, '--config', path.join(h.home, 'rollouts.toml'), '--out', out, ...extra]
  if (since) args.push('--since', since)
  if (until) args.push('--until', until)
  const r = ok(h, args)
  assert.match(r.stderr, /^reflect: span r-\d{8}T\d{6}Z-[0-9a-f]{6} /, 'one summary line')
  return JSON.parse(fs.readFileSync(out, 'utf8'))
}
const entryOf = (s, slug) => s.rollouts.find((r) => r.rollout === slug)

// A span.json written by hand in span's shape (the writers read reflection, since, until and rollouts only, plus
// knobs for `knobs`).
let spanN = 0
function fakeSpan(h, rid, rollouts, { since = '2026-09-03T14:00:00.000Z', until = '2026-09-10T14:00:00.000Z', knobs = { revert: [], land: [], held: [] }, entries = {} } = {}) {
  const p = path.join(h.out, `span-${++spanN}.json`)
  fs.writeFileSync(p, JSON.stringify({ reflection: rid, since, until, previous: null, knobs,
    rollouts: rollouts.map((r) => ({ rollout: r, mode: 'read', repo: 'o/r', breached: [], breachCounts: false, proposals: [], friction: [], ...(entries[r] || {}) })) }))
  return p
}
const RID = (n) => `r-2026090${n}T000000Z-00000${n}`

// ---- span ------------------------------------------------------------------------------------------------------

test('reflect.py parses as python 3.9 and imports nothing outside the stdlib and the plugin', () => {
  const r = spawnSync('python3', ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 9))', REFLECT], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})

test('span: the default since is the last reflection line\'s until, else until - 7 days; a future until is clamped; reserved files are no rollouts', (t) => {
  const h = setup(t)
  emitAll(h, 'demo', byTs(life('a', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] })))
  for (const f of ['reviews.jsonl', 'tunings.jsonl']) fs.writeFileSync(path.join(h.ev, f), '{"v":1,"ts":"2026-09-04T00:00:00.000Z","kind":"x"}\n')
  rolloutNote(h, 'demo')
  const s = span(h, [], { since: null })
  assert.equal(s.until, '2026-09-09T14:00:00.000Z')
  assert.equal(s.since, '2026-09-02T14:00:00.000Z', 'until - 7 days')
  assert.deepEqual(s.rollouts.map((r) => r.rollout), ['demo'])
  fs.appendFileSync(reflectionsFile(h), `${JSON.stringify({ v: 1, ts: '2026-09-05T00:00:00.000Z', kind: 'reflection', id: RID(1), until: '2026-09-04T00:00:00.000Z' })}\n{"torn`)
  const s2 = span(h, [], { since: null })
  assert.equal(s2.since, '2026-09-04T00:00:00.000Z', 'the last reflection line\'s until')
  assert.equal(s2.previous, RID(1))
  const s3 = span(h, [], { since: null, until: '2999-01-01T00:00Z' })
  assert.ok(s3.flags.some((f) => /^--until 2999-01-01T00:00:00\.000Z is in the future: clamped to now/.test(f)), JSON.stringify(s3.flags))
  const bad = reflect(h, ['span', '--out', path.join(h.out, 'x.json'), '--since', '2026-09-10T00:00Z', '--until', '2026-09-03T00:00Z'])
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /^reflect: --since .* is after --until/)
  const naive = reflect(h, ['span', '--out', path.join(h.out, 'x.json'), '--until', '2026-09-03T00:00'])
  assert.equal(naive.status, 2, naive.stderr)
})

test('span: every friction kind, a Human fix as movedBy unrecorded with its taskNote, and null while still set aside', (t) => {
  const h = setup(t)
  const ev = [
    ...life('landed', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] }),
    [W(4, '00:30'), 'answer-recorded', 'landed', { answerKind: 'decision', form: 'hand-back' }],
    [W(4, '02:00'), 'slot-taken', 'stuck', { settings: { parallel_ceiling: 2 }, start: 'start' }],
    [W(4, '02:30'), 'set-aside', 'stuck', { stage: 'implement', reasonClass: 'needs-human', setAsideAt: 'run' }],
    [W(4, '02:30'), 'slot-freed', 'stuck', { outcome: 'set-aside' }],
    [W(4, '03:00'), 'slot-taken', 'fixed', { settings: { parallel_ceiling: 2 }, start: 'start' }],
    [W(4, '03:30'), 'set-aside', 'fixed', { stage: 'integrate', reasonClass: 'integration-set-aside', setAsideAt: 'integration' }],
    [W(4, '03:30'), 'slot-freed', 'fixed', { outcome: 'set-aside' }],
    [W(4, '05:00'), 'lane-taken', 'fixed', {}],
    [W(4, '06:00'), 'slot-taken', 'retried', { settings: { parallel_ceiling: 2 }, start: 'start' }],
    [W(4, '06:10'), 'set-aside', 'retried', { stage: 'plan', reasonClass: 'plan-rejected', setAsideAt: 'run' }],
    [W(4, '06:20'), 'auto-retry', 'retried', { stage: 'plan', setAsideAt: 'run', retryClass: 'agent', used: 1, budget: 2 }],
    [W(4, '06:30'), 'handed-back', 'retried', { via: 'descope', arm: 'run' }],
    [W(4, '06:40'), 'review-verdict', 'retried', { round: 2, verdict: 'changes', findings: 3, original: 1, regression: 2, digest: 'd1' }],
    [W(4, '07:00'), 'hold-started', null, { hold: 'git-env' }],
  ]
  emitAll(h, 'demo', byTs(ev))
  rolloutNote(h, 'demo', { notes: ['- 2026-09-05 repair: [[stuck]] deferred: later'] })
  taskNote(h, 'landed', { body: '## Needs you\n\nPick a colour.\n\n## Decisions (asked ahead at schedule)\n\n- none' })
  taskNote(h, 'fixed', { archived: true })
  const s = span(h)
  const f = entryOf(s, 'demo').friction
  const kinds = [...new Set(f.map((x) => x.kind))].sort()
  assert.deepEqual(kinds, ['ask', 'churn', 'descope', 'repair', 'retry', 'set-aside'])
  const ask = f.find((x) => x.kind === 'ask' && x.task === 'landed')
  assert.deepEqual([ask.act, ask.askedAhead, ask.needsYou], ['answer', true, 'Pick a colour.'])
  assert.ok(f.some((x) => x.kind === 'ask' && x.act === 'gitEnvHold' && x.task === null), 'a git-env hold is an ask')
  const fixed = f.find((x) => x.kind === 'set-aside' && x.task === 'fixed')
  assert.equal(fixed.movedBy, 'unrecorded')
  assert.equal(fixed.taskNote, path.join(h.tasks, 'Archive', '2026', 'fixed.md'))
  const stuck = f.find((x) => x.kind === 'set-aside' && x.task === 'stuck')
  assert.equal(stuck.movedBy, null, 'still set aside at until')
  assert.equal(stuck.taskNote, null)
  assert.equal(f.find((x) => x.kind === 'set-aside' && x.task === 'retried').movedBy, 'auto-retry')
  assert.deepEqual(f.filter((x) => x.kind === 'churn').map((x) => [x.task, x.regression]), [['retried', 2]])
  assert.ok(s.cannotShow.some((c) => c.startsWith('[[fixed]] (demo) moved on with no recorded act')), JSON.stringify(s.cannotShow))
})

// score.py's handsOff lists landed tasks only: span reads the asks from the record, so an act on a task still waiting
// at until, or on one that lands next week, is an item in the week it happened, and only then.
test('span: an ask on a task that has not landed by until is an item, read straight from the record, in its week only', (t) => {
  const h = setup(t)
  const N1 = (d, hm) => `2026-09-${d}T${hm}:00Z` // a UTC stamp in the week after the window, d in 10..16
  emitAll(h, 'demo', byTs([
    ...life('landed', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] }),
    [W(4, '00:20'), 'answer-recorded', 'landed', { answerKind: 'needs-you' }],
    // waiting: ready, never merged
    ...life('waiting', W(5, '00:00'), W(5, '01:00')),
    [W(5, '01:10'), 'answer-recorded', 'waiting', { answerKind: 'decision', form: 'hand-back' }],
    [W(5, '01:20'), 'gate-signed', 'waiting', { standing: false, gates: 2 }],
    [W(5, '01:25'), 'gate-signed', 'waiting', { standing: true, gates: 1 }], // a Standing approval: no ask
    [W(5, '01:30'), 'handed-back', 'waiting', { via: 'retry', arm: 'run' }],
    [W(5, '01:35'), 'handed-back', 'waiting', { via: 'descope', arm: 'run' }], // automatic: no ask
    [W(5, '01:40'), 'race-decided', 'waiting', { mark: 'RACE', by: 'resume' }],
    [W(5, '01:50'), 'hold-started', 'waiting', { hold: 'merge' }],
    [W(5, '01:55'), 'hold-started', 'waiting', { hold: 'merge' }], // the same hold, still open
    [W(5, '02:00'), 'hold-ended', 'waiting', { hold: 'merge' }],
    [W(5, '02:10'), 'hold-started', 'waiting', { hold: 'merge' }],
    [W(5, '02:20'), 'hold-started', 'waiting', { hold: 'race' }], // a RACE hold is no act
    // later: asked this week, landed next week
    ...life('later', W(6, '00:00'), W(6, '01:00')),
    [W(6, '00:30'), 'answer-recorded', 'later', { answerKind: 'decision', form: 'hand-back' }],
    [N1(11, '00:00'), 'lane-taken', 'later', {}],
    [N1(11, '00:10'), 'lane-freed', 'later', { release: 'merge', path: 'lead', triggers: [], conflict: false }],
    [N1(11, '00:10'), 'merged', 'later', { pr: 9 }],
  ]))
  rolloutNote(h, 'demo')
  taskNote(h, 'waiting', { body: '## Needs you\n\nWhich colour?' })
  const asks = (s) => entryOf(s, 'demo').friction.filter((x) => x.kind === 'ask').map((x) => [x.task, x.act, x.at])
  const s = span(h)
  assert.deepEqual(asks(s), [
    ['landed', 'answer', '2026-09-04T00:20:00.000Z'],
    ['waiting', 'answer', '2026-09-05T01:10:00.000Z'],
    ['waiting', 'signOff', '2026-09-05T01:20:00.000Z'],
    ['waiting', 'retry', '2026-09-05T01:30:00.000Z'],
    ['waiting', 'raceDecided', '2026-09-05T01:40:00.000Z'],
    ['waiting', 'mergeHold', '2026-09-05T01:50:00.000Z'],
    ['waiting', 'mergeHold', '2026-09-05T02:10:00.000Z'],
    ['later', 'answer', '2026-09-06T00:30:00.000Z'],
  ])
  const w = entryOf(s, 'demo').friction.find((x) => x.kind === 'ask' && x.task === 'waiting' && x.act === 'answer')
  assert.deepEqual([w.detail, w.needsYou], ['decision answer (hand-back)', 'Which colour?'])
  const sc = JSON.parse(fs.readFileSync(entryOf(s, 'demo').score, 'utf8'))
  assert.deepEqual(sc.handsOff.tasks.map((x) => x.task), ['landed'], 'the Hands-off rate lists the landed task only')
  // next week: later lands, and its ask (before since) is not read again
  const s2 = span(h, [], { since: UNTIL, until: '2026-09-17T00:00+10:00' })
  assert.deepEqual(asks(s2), [])
})

test('span: a missing note is scored by slug and flagged; without --fold the events and tasks dirs are unchanged', (t) => {
  const h = setup(t)
  emitAll(h, 'orphan', byTs(life('a', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] })))
  const before = [listing(h.ev), listing(h.tasks), sha(path.join(h.ev, 'orphan.jsonl'))]
  const s = span(h)
  const e = entryOf(s, 'orphan')
  assert.equal(e.note, null)
  assert.ok(e.flags.includes('no rollout note: scored by slug, never a knob candidate'))
  assert.ok(e.score && fs.existsSync(e.score), 'scored all the same')
  assert.deepEqual([listing(h.ev), listing(h.tasks), sha(path.join(h.ev, 'orphan.jsonl'))], before)
  assert.deepEqual(listing(h.out).filter((f) => !/^(span\.json|orphan\.score\.json)$/.test(f)), [], 'span writes only under --out\'s dir')
})

test('span: close lines: a completed rollout\'s is read, a running one\'s null passes, a dropped or archived one with none is flagged; tunings.jsonl untouched', (t) => {
  const h = setup(t)
  for (const s of ['done-r', 'run-r', 'drop-r', 'arch-r']) emitAll(h, s, byTs(life(`${s}-t`, W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] })))
  rolloutNote(h, 'done-r', { status: 'done' })
  rolloutNote(h, 'run-r')
  rolloutNote(h, 'drop-r', { status: 'dropped' })
  rolloutNote(h, 'arch-r', { status: 'done', archived: true })
  const T = (rollout, id, over = {}) => JSON.stringify({ v: 2, ts: '2026-09-05T00:00:00.000Z', host: 'h', rollout, task: null, kind: 'tuning', id, repo: 'o/r',
    window: { since: '2026-09-04T00:00:00.000Z', until: '2026-09-05T00:00:00.000Z' }, scores: {}, applied: [], ...over })
  fs.writeFileSync(tuningsFile(h), [T('done-r', 't-done', { close: 'completion' }), T('arch-r', 't-arch', { close: 'completion' }), T('arch-r', 't-void', { voids: 't-arch' }), ''].join('\n'))
  const before = sha(tuningsFile(h))
  const s = span(h)
  assert.deepEqual(entryOf(s, 'done-r').closeLine, { id: 't-done', close: 'completion' })
  assert.ok(!entryOf(s, 'done-r').flags.includes('closed with no close line: no baseline'))
  assert.equal(entryOf(s, 'run-r').closeLine, null)
  assert.ok(!entryOf(s, 'run-r').flags.includes('closed with no close line: no baseline'))
  for (const slug of ['drop-r', 'arch-r']) {
    const e = entryOf(s, slug)
    assert.equal(e.closeLine, null, slug)
    assert.ok(e.flags.includes('closed with no close line: no baseline'), slug)
    assert.ok(e.score && e.friction, `${slug} is read and scored`)
    assert.ok(s.cannotShow.some((c) => c.startsWith(`[[${slug}]] is closed`)), slug)
  }
  assert.equal(sha(tuningsFile(h)), before, 'span writes no tunings.jsonl line')
})

test('span: repair lines: dated in-window ones by shape, the boundary date counted, others not read', (t) => {
  const h = setup(t)
  emitAll(h, 'demo', byTs(life('a', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] })))
  rolloutNote(h, 'demo', {
    notes: ['- 2026-09-05 repair: [[a]] RACE decided: keep',
      '- 2026-09-05 repair: [[a]], [[b]] git-env trip, acked at abc1234: restored',
      '- 2026-09-09 repair: [[g]] max_review_rounds raised to 5, one round',
      '- 2026-09-01 repair: [[c]] deferred: x',
      '- 2026-09-05T10:00+10:00 auto-retry: [[d]] 1/2 (plan; feedback x)',
      '- 2026-09-05 descope: [[e]] the follow-up',
      '- repair: [[h]] undated'],
    extra: '## Completion log\n\n- 2026-09-05 repair: [[z]] merged, never marked: flipped done\n',
  })
  const s = span(h)
  const reps = entryOf(s, 'demo').friction.filter((x) => x.kind === 'repair')
  assert.deepEqual(reps.map((x) => [x.date, x.tasks, x.shape]), [['2026-09-05', ['a'], 'race-decided'], ['2026-09-05', ['a', 'b'], 'git-env'], ['2026-09-09', ['g'], 'raise']])
  assert.ok(s.flags.some((f) => /an undated repair line in ## Notes: - repair: \[\[h\]\] undated/.test(f)), JSON.stringify(s.flags))
})

test('span: the Escapes sweep reads an old, never-read record: an in-window revert or fixes: note makes it escapes-only; pre-window evidence and an unresolvable record do not', (t) => {
  const h = setup(t)
  // three weeks before the window: old-r landed two tasks through squash commits (#7, #8) on main
  h.gitEnv = { GIT_AUTHOR_DATE: '2026-08-09T00:00:00Z', GIT_COMMITTER_DATE: '2026-08-09T00:00:00Z' }
  git(h, ['commit', '-q', '--allow-empty', '-m', 'init'])
  fs.writeFileSync(path.join(h.repo, 'f.txt'), 'one\n')
  git(h, ['add', '.'])
  h.gitEnv = { GIT_AUTHOR_DATE: '2026-08-10T00:00:00Z', GIT_COMMITTER_DATE: '2026-08-10T00:00:00Z' }
  git(h, ['commit', '-q', '-m', 'old a (#7)'])
  const shaA = git(h, ['rev-parse', 'HEAD'])
  fs.writeFileSync(path.join(h.repo, 'g.txt'), 'two\n')
  git(h, ['add', '.'])
  git(h, ['commit', '-q', '-m', 'old b (#8)'])
  h.gitEnv = { GIT_AUTHOR_DATE: '2026-09-05T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-05T00:00:00Z' }
  git(h, ['revert', '--no-edit', shaA])
  h.gitEnv = {}
  emitAll(h, 'old-r', byTs([...life('old-a', '2026-08-10T00:00:00Z', '2026-08-10T01:00:00Z', { lane: ['2026-08-10T01:00:00Z', '2026-08-10T01:10:00Z'], pr: 7 }),
    ...life('old-b', '2026-08-10T02:00:00Z', '2026-08-10T03:00:00Z', { lane: ['2026-08-10T03:00:00Z', '2026-08-10T03:10:00Z'], pr: 8 })]))
  rolloutNote(h, 'old-r', { status: 'done', archived: true })
  taskNote(h, 'fix-old-b', { captured: '2026-09-06', fm: ['fixes: ["[[old-b]]"]'] })
  // a pre-window fixer, and a record with no note at all
  emitAll(h, 'older-r', byTs(life('older-a', '2026-08-01T00:00:00Z', '2026-08-01T01:00:00Z', { lane: ['2026-08-01T01:00:00Z', '2026-08-01T01:10:00Z'], pr: 3 })))
  rolloutNote(h, 'older-r', { status: 'done', archived: true })
  taskNote(h, 'fix-older-a', { captured: '2026-08-02', fm: ['fixes: ["[[older-a]]"]'] })
  emitAll(h, 'lost-r', byTs(life('lost-a', '2026-08-01T00:00:00Z', '2026-08-01T01:00:00Z', { lane: ['2026-08-01T01:00:00Z', '2026-08-01T01:10:00Z'] })))
  const s = span(h)
  const old = entryOf(s, 'old-r')
  assert.equal(old.mode, 'escapes-only')
  assert.deepEqual(old.friction.map((x) => [x.task, x.source, x.inWindow]).sort(), [['old-a', 'revert', true], ['old-b', 'fixes', true]], JSON.stringify([s.flags, s.cannotShow]))
  assert.equal(old.friction.find((x) => x.source === 'revert').at, '2026-09-05T00:00:00.000Z')
  assert.equal(old.friction.find((x) => x.source === 'fixes').at, '2026-09-06')
  assert.equal(entryOf(s, 'older-r'), undefined, 'pre-window evidence adds nothing')
  assert.ok(s.cannotShow.some((c) => c.startsWith('record lost-r: no rollout note')), JSON.stringify(s.cannotShow))
  assert.equal(old.breachCounts, false)
})

test('span: two Project roots for one repo: the newest is read, flagged', (t) => {
  const h = setup(t)
  const second = path.join(h.home, 'clone')
  fs.mkdirSync(second)
  execFileSync(REAL_GIT, ['init', '-q', second])
  execFileSync(REAL_GIT, ['-C', second, 'remote', 'add', 'origin', 'git@github.com:o/r.git'])
  emitAll(h, 'r1', byTs(life('a', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] })))
  emitAll(h, 'r2', byTs(life('b', W(5, '00:00'), W(5, '01:00'), { lane: [W(5, '01:00'), W(5, '01:10')] })))
  rolloutNote(h, 'r1')
  rolloutNote(h, 'r2', { root: second })
  const s = span(h)
  assert.ok(s.flags.some((f) => f.startsWith('repo o/r has 2 Project roots') && f.endsWith(`the newest, ${second}, is read`)), JSON.stringify(s.flags))
})

// Running time over 1.5 h for one task breaches Throughput. A breach counts only in a read, non-partial rollout whose
// run ends in the window.
test('span and close: breaches count once per (rollout, Guardrail) only for a finished in-window run; a partial one is reported, not counted', (t) => {
  const h = setup(t)
  emitAll(h, 'slow', byTs(life('a', W(4, '00:00'), W(4, '03:00'), { lane: [W(4, '03:00'), W(4, '03:10')] })))
  rolloutNote(h, 'slow')
  // partial: a Slot still busy at until (its last record line 5 minutes before), three hours long
  emitAll(h, 'tail', [['2026-09-09T11:00:00Z', 'slot-taken', 'p', { settings: { parallel_ceiling: 2 }, start: 'start' }],
    ['2026-09-09T11:00:00Z', 'run-bound', 'p', { runId: 'wf1', journalDir: '/x', call: 'task' }],
    ['2026-09-09T13:55:00Z', 'run-bound', 'p', { runId: 'wf2', journalDir: '/x', call: 'task' }]])
  rolloutNote(h, 'tail')
  const s = span(h)
  assert.deepEqual([entryOf(s, 'slow').breached, entryOf(s, 'slow').breachCounts], [['throughput'], true])
  const tail = entryOf(s, 'tail')
  assert.deepEqual([tail.partial, tail.breached, tail.breachCounts], [true, ['throughput'], false])
  ok(h, ['close', '--span', path.join(h.out, 'span.json')])
  const [line] = rlines(h)
  assert.deepEqual([line.counts.breaches, line.quiet], [1, false])
})

// ---- watch, raised and the Watch reader -----------------------------------------------------------------------------

const RULE = 'orient § 5 grill'
const SHAPE = 'a design fork asked mid-run'
const watchArgs = (sp, rollouts, { rule = RULE, shape = SHAPE, count = rollouts.length } = {}) =>
  ['watch', '--span', sp, ...rollouts.flatMap((r) => ['--rollout', r]), '--rule', rule, '--shape', shape, '--count', String(count)]

test('watch: one line naming both rollouts; a rollout outside the span is exit 2; the id is watch_id of the stripped rule and shape', (t) => {
  const h = setup(t)
  const [wid] = ids(h, [['w', RULE, SHAPE]])
  const sp = fakeSpan(h, RID(1), ['a', 'b'])
  const r = ok(h, watchArgs(sp, ['b', '[[a]]'], { rule: `  ${RULE} `, shape: ` ${SHAPE}` }))
  assert.equal(r.stdout, `watched ${wid} (a, b): ${RULE}\n`)
  const [l] = rlines(h)
  assert.deepEqual([l.kind, l.id, l.rule, l.shape, l.rollouts, l.count, l.reflection], ['watch', wid, RULE, SHAPE, ['a', 'b'], 2, RID(1)])
  const out = reflect(h, watchArgs(sp, ['zzz']))
  assert.equal(out.status, 2)
  assert.match(out.stderr, /^reflect: rollout zzz is not in the span \(a, b\)\n$/)
  assert.equal(rlines(h).length, 1)
})

test('watch repeat calls: the same set exists; a dropped rollout is exit 2 naming the union; a superset writes one extending line', (t) => {
  const h = setup(t)
  const [wid] = ids(h, [['w', RULE, SHAPE]])
  const sp = fakeSpan(h, RID(1), ['a', 'b', 'c'])
  ok(h, watchArgs(sp, ['a']))
  const same = ok(h, watchArgs(sp, ['a'], { count: 5 }))
  assert.equal(same.stdout, `exists ${wid}\n`, '(i) the same set, another count: nothing written')
  const before = bytes(reflectionsFile(h))
  const drop = reflect(h, watchArgs(sp, ['b']))
  assert.equal(drop.status, 2, '(ii)')
  assert.equal(drop.stderr, `reflect: watch ${wid}: Reflection ${RID(1)}'s line names [a]; this call names [b]; one line per Watch names every rollout: re-run naming [a, b]\n`)
  assert.deepEqual(bytes(reflectionsFile(h)), before, 'byte-identical')
  const ext = ok(h, watchArgs(sp, ['a', 'b']))
  assert.equal(ext.stdout, `extended ${wid}: +b\n`, '(iii)')
  assert.equal(rlines(h).length, 2)
  const wide = reflect(h, watchArgs(sp, ['a', 'c']))
  assert.equal(wide.status, 2, '(iv)')
  assert.match(wide.stderr, /re-run naming \[a, b, c\]\n$/)
  // (iii) continued: the reader gives {a, b}, recurring; decide lists it; close counts one sighting, new
  ok(h, ['decide', '--span', sp, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00'])
  const rule = rlines(h).filter((l) => l.kind === 'proposal')
  assert.deepEqual(rule.map((l) => [l.altitude, l.id, l.rollouts]), [['rule', wid, ['a', 'b']]])
  ok(h, ['close', '--span', sp])
  const close = rlines(h).at(-1)
  assert.deepEqual([close.counts.sightings, close.counts.newWatches, close.counts.rules], [1, 1, 1])
})

test('the Watch reader: recurring needs two rollouts in the cycle, not one rollout read in two weeks; raised closes and a later sighting reopens; stale; torn lines', (t) => {
  const h = setup(t)
  const [wid] = ids(h, [['w', RULE, SHAPE]])
  ok(h, watchArgs(fakeSpan(h, RID(1), ['a']), ['a']))
  ok(h, ['close', '--span', fakeSpan(h, RID(1), ['a'])])
  fs.appendFileSync(reflectionsFile(h), '{"kind": "watch", "id": "torn\n')
  const sp2 = fakeSpan(h, RID(2), ['a'])
  ok(h, watchArgs(sp2, ['a']))
  assert.equal(ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks]).stdout, 'no rule proposal: no decision task\n', 'one rollout in two weeks')
  ok(h, ['close', '--span', sp2])
  const sp3 = fakeSpan(h, RID(3), ['b'])
  ok(h, watchArgs(sp3, ['b']))
  const span3 = (() => { ok(h, ['decide', '--span', sp3, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00']); return rlines(h).filter((l) => l.kind === 'proposal') })()
  assert.deepEqual(span3.map((l) => [l.id, l.rollouts]), [[wid, ['a', 'b']]], 'a and b in one cycle: recurring')
  ok(h, ['raised', '--watch', wid, '--reflection', RID(3)])
  ok(h, ['close', '--span', sp3])
  const sp4 = fakeSpan(h, RID(4), ['c'], { until: '2026-11-30T00:00:00.000Z' })
  ok(h, watchArgs(sp4, ['c']))
  assert.equal(ok(h, ['decide', '--span', sp4, '--tasks-dir', h.tasks]).stdout, 'no rule proposal: no decision task\n', 'a new cycle starts empty')
  // stale: span's watches[] marks a Watch with no line for 28 days before until (lines written by hand, back-dated)
  const h2 = setup(t)
  const wl = (ts, rid, rollouts) => JSON.stringify({ v: 1, ts, host: 'h', rollout: null, task: null, kind: 'watch', id: wid, rule: RULE, shape: SHAPE, rollouts, count: 1, reflection: rid })
  fs.writeFileSync(reflectionsFile(h2), `${wl('2026-08-01T00:00:00.000Z', RID(1), ['old'])}\n{"torn\n`)
  emitAll(h2, 'demo', byTs(life('x', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] })))
  rolloutNote(h2, 'demo')
  const s = span(h2)
  const w = s.watches.find((x) => x.id === wid)
  assert.deepEqual([w.open, w.rollouts, w.stale, w.new, w.recurring], [true, ['old'], true, false, false])
})

test('raised: --confirmed and --declined are exclusive; a plain raise of a one-rollout Watch is exit 2; --declined writes via declined', (t) => {
  const h = setup(t)
  const [wid] = ids(h, [['w', RULE, SHAPE]])
  ok(h, watchArgs(fakeSpan(h, RID(1), ['a']), ['a']))
  const both = reflect(h, ['raised', '--watch', wid, '--reflection', RID(1), '--confirmed', '--declined'])
  assert.equal(both.status, 2)
  const plain = reflect(h, ['raised', '--watch', wid, '--reflection', RID(1)])
  assert.equal(plain.status, 2)
  assert.match(plain.stderr, /a plain raise needs two; use --confirmed or --declined/)
  assert.equal(ok(h, ['raised', '--watch', wid, '--reflection', RID(1), '--declined']).stdout, `raised ${wid} (declined)\n`)
  assert.deepEqual(rlines(h).at(-1), { ...rlines(h).at(-1), kind: 'watch-raised', id: wid, reflection: RID(1), via: 'declined' })
  const unknown = reflect(h, ['raised', '--watch', 'deadbeef', '--reflection', RID(1)])
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /no Watch deadbeef/)
})

// ---- declines (Lachy's no is recorded) -------------------------------------------------------------------------------

test('declines: a no closes the cycle; one later rollout is neither new nor offered nor a rule item; two new rollouts recur again', (t) => {
  const h = setup(t)
  const [wid, other] = ids(h, [['w', RULE, SHAPE], ['w', 'schedule § 3.5', 'a spend gate missed']])
  // R1: W in a and b, decided no
  const sp1 = fakeSpan(h, RID(1), ['a', 'b'])
  ok(h, watchArgs(sp1, ['a', 'b']))
  ok(h, ['decide', '--span', sp1, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00'])
  ok(h, ['close', '--span', sp1])
  assert.equal(ok(h, ['raised', '--watch', wid, '--reflection', RID(1), '--declined']).stdout, `raised ${wid} (declined)\n`)
  assert.equal(ok(h, ['raised', '--watch', wid, '--reflection', RID(1), '--declined']).stdout, `exists ${wid}\n`, 'a repeat')
  const yes = reflect(h, ['raised', '--watch', wid, '--reflection', RID(1)])
  assert.equal(yes.status, 2)
  assert.equal(yes.stderr, `reflect: Watch ${wid} was closed by Reflection ${RID(1)} (declined)\n`)
  // R2: W seen again in c only: not new, not a rule item, no task, a quiet week
  const sp2 = fakeSpan(h, RID(2), ['c'])
  ok(h, watchArgs(sp2, ['c']))
  emitAll(h, 'c', byTs(life('x', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] })))
  rolloutNote(h, 'c')
  const files = listing(h.tasks)
  assert.equal(ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-17T09:00+10:00']).stdout, 'no rule proposal: no decision task\n')
  assert.deepEqual(listing(h.tasks), files, 'no file written')
  ok(h, ['close', '--span', sp2])
  const c2 = rlines(h).at(-1)
  assert.deepEqual([c2.counts.rules, c2.counts.newWatches, c2.counts.sightings, c2.quiet], [0, 0, 1, true])
  // R2': with another rule item, W is not a Watch to confirm
  const sp2b = fakeSpan(h, RID(5), ['c', 'd'])
  ok(h, watchArgs(sp2b, ['c']))
  ok(h, watchArgs(sp2b, ['c', 'd'], { rule: 'schedule § 3.5', shape: 'a spend gate missed' }))
  ok(h, ['decide', '--span', sp2b, '--tasks-dir', h.tasks, '--now', '2026-09-17T09:00+10:00'])
  const task = fs.readdirSync(h.tasks).find((f) => f.startsWith('thread-skill-decisions-'))
  const text = fs.readFileSync(path.join(h.tasks, task), 'utf8')
  const sec = text.slice(text.indexOf(`## Reflection ${RID(5)}`))
  assert.ok(sec.includes(`- ${other}: rule schedule § 3.5`), sec)
  assert.ok(!sec.includes(wid), 'a declined Watch is never a Watch to confirm')
  ok(h, ['close', '--span', sp2b])
  // R3: W in d too: the cycle {c, d} recurs, a rule item again
  const sp3 = fakeSpan(h, RID(3), ['d'])
  ok(h, watchArgs(sp3, ['d']))
  ok(h, ['decide', '--span', sp3, '--tasks-dir', h.tasks, '--now', '2026-09-24T09:00+10:00'])
  ok(h, ['close', '--span', sp3])
  const rules = rlines(h).filter((l) => l.kind === 'proposal' && l.reflection === RID(3))
  assert.deepEqual(rules.map((l) => [l.id, l.rollouts]), [[wid, ['c', 'd']]])
  const c3 = rlines(h).at(-1)
  assert.deepEqual([c3.counts.rules, c3.quiet], [1, false])
})

// ---- bug ---------------------------------------------------------------------------------------------------------------

const bugArgs = (h, sp, { slug = 'grill-misses-gates', rollouts = ['a', 'b'], fixes, rule = RULE, shape = SHAPE } = {}) =>
  ['bug', '--span', sp, '--rule', rule, '--shape', shape, '--slug', slug, '--title', 'Thread Skill: the grill misses gates',
    '--why', 'Two rollouts asked mid-run what the grill should have.', ...rollouts.flatMap((r) => ['--rollout', r]),
    '--tasks-dir', h.tasks, ...(fixes ? ['--fixes', fixes] : [])]

test('bug: files once in task-writer § 4\'s shape, dedupes against an open task, refuses reflect/call words, writes fixes:', (t) => {
  const h = setup(t)
  const [key] = ids(h, [['w', RULE, SHAPE]])
  const sp = fakeSpan(h, RID(1), ['a', 'b'])
  const bad = reflect(h, bugArgs(h, sp, { slug: 'reflection-loses-asks' }))
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /the words reflection are refused/)
  assert.equal(reflect(h, bugArgs(h, sp, { slug: 'callers-drop' })).status, 2)
  const long = reflect(h, bugArgs(h, sp, { slug: 'long-rule', rule: 'r'.repeat(121) }))
  assert.equal(long.status, 2, 'a line run_record refuses is refused before the file')
  assert.match(long.stderr, /nothing written/)
  assert.ok(!fs.existsSync(path.join(h.tasks, 'thread-skill-bug-long-rule.md')))
  const r = ok(h, bugArgs(h, sp, { fixes: '[[p1-1-landed]]' }))
  assert.equal(r.stdout, 'filed thread-skill-bug-grill-misses-gates\n')
  const p = path.join(h.tasks, 'thread-skill-bug-grill-misses-gates.md')
  const text = fs.readFileSync(p, 'utf8')
  const fm = text.split('---')[1]
  assert.match(fm, /^tags: \[task, ai\]$/m)
  assert.doesNotMatch(fm, /decisions/)
  for (const line of ['status: open', 'priority: normal', 'projects: ["[[Thread Skill]]", "[[AI]]"]', 'contexts: []', 'launch: cc-thread', `bug_key: ${key}`, 'fixes: ["[[p1-1-landed]]"]']) {
    assert.ok(fm.includes(`\n${line}\n`), line)
  }
  assert.doesNotMatch(fm, /^scheduled:/m)
  const heads = text.split('\n').filter((l) => l.startsWith('## '))
  assert.deepEqual(heads, ['## Notes', '## Launch', '## Resume prompt'])
  assert.ok(text.includes(`Found by Reflection ${RID(1)}`))
  assert.ok(text.includes('- **Launch:** `cc-thread`'))
  assert.doesNotMatch(text, /mark the capture done/)
  const [line] = rlines(h)
  assert.deepEqual([line.kind, line.altitude, line.id, line.vaultTask, line.filed, line.auto, line.fixes], ['proposal', 'bug', key, 'thread-skill-bug-grill-misses-gates', true, true, 'p1-1-landed'])
  assert.equal(ok(h, bugArgs(h, sp)).stdout, 'filed thread-skill-bug-grill-misses-gates\n', 'a repeat prints the first outcome')
  assert.equal(rlines(h).length, 1)
  // the next Reflection finds the open task by its bug_key: exists, filed false, no auto
  const sp2 = fakeSpan(h, RID(2), ['c'])
  assert.equal(ok(h, bugArgs(h, sp2, { rollouts: ['c'] })).stdout, 'exists thread-skill-bug-grill-misses-gates\n')
  const l2 = rlines(h).at(-1)
  assert.deepEqual([l2.filed, 'auto' in l2, l2.vaultTask], [false, false, 'thread-skill-bug-grill-misses-gates'])
  assert.equal(fs.readFileSync(p, 'utf8'), text, 'the open task is untouched')
})

test('bug: a re-run after a failed line write records filed from Found by Reflection; taken paths are refused byte-identical; other words file', { skip: process.getuid?.() === 0 && 'root ignores the mode' }, (t) => {
  const h = setup(t)
  const sp = fakeSpan(h, RID(1), ['a', 'b'])
  // a failed line write: the events dir cannot be written (reflections.jsonl reads as absent)
  fs.chmodSync(h.ev, 0o500)
  let first
  try { first = reflect(h, bugArgs(h, sp)) } finally { fs.chmodSync(h.ev, 0o755) }
  assert.equal(first.status, 1, first.stderr)
  assert.match(first.stderr, /run_record: warning: cannot write/)
  assert.ok(fs.existsSync(path.join(h.tasks, 'thread-skill-bug-grill-misses-gates.md')), 'the file went first')
  assert.equal(ok(h, bugArgs(h, sp)).stdout, 'filed thread-skill-bug-grill-misses-gates\n')
  assert.deepEqual(rlines(h).map((l) => [l.filed, l.auto]), [[true, true]])
  // a done task at the path, an archived namesake: refused, nothing written
  const h2 = setup(t)
  const sp2 = fakeSpan(h2, RID(1), ['a'])
  const done = taskNote(h2, 'thread-skill-bug-grill-misses-gates', { status: 'done', fm: ['bug_key: 0000000a'] })
  const before = fs.readFileSync(done)
  const r = reflect(h2, bugArgs(h2, sp2, { rollouts: ['a'] }))
  assert.equal(r.status, 2)
  assert.equal(r.stderr, 'reflect: path exists: thread-skill-bug-grill-misses-gates (done); choose other slug words\n')
  assert.deepEqual(fs.readFileSync(done), before)
  assert.deepEqual(rlines(h2), [])
  taskNote(h2, 'thread-skill-bug-other-words', { status: 'done', archived: true })
  assert.equal(reflect(h2, bugArgs(h2, sp2, { rollouts: ['a'], slug: 'other-words' })).status, 2, 'an archived namesake')
  assert.equal(ok(h2, bugArgs(h2, sp2, { rollouts: ['a'], slug: 'grill-skips-gates' })).stdout, 'filed thread-skill-bug-grill-skips-gates\n')
  assert.equal(rlines(h2).length, 1)
  // a done task at another slug with the same key: dedupe skips it, so the bug files anew
  const h3 = setup(t)
  const [key] = ids(h3, [['w', RULE, SHAPE]])
  taskNote(h3, 'thread-skill-bug-old-fix', { status: 'done', fm: [`bug_key: ${key}`] })
  assert.equal(ok(h3, bugArgs(h3, fakeSpan(h3, RID(1), ['a']), { rollouts: ['a'] })).stdout, 'filed thread-skill-bug-grill-misses-gates\n')
})

// ---- knobs ---------------------------------------------------------------------------------------------------------------

test('knobs: one line per knob_key, held with its reason; two proposers make ONE line with the newer values; landed only by a matching auto line; a revert line; re-runs write only what is missing', (t) => {
  const h = setup(t)
  const [kid, kidLower, kidRevert] = ids(h, [['k', 'o/r', 'parallel_ceiling', 'slot-bound-raise', 1], ['k', 'o/r', 'parallel_ceiling', 'quota-bound-lower', -1],
    ['k', 'o/r', 'max_review_rounds', 'revert:review-rounds-raise', -1]])
  const prop = (over) => ({ key: 'parallel_ceiling', rule: 'slot-bound-raise', direction: 1, from: 3, to: 4, ranAt: 3, knob_key: kid, ...over })
  const entries = {
    a: { window: { activeEnd: '2026-09-05T00:00:00.000Z' }, proposals: [prop({})] },
    b: { window: { activeEnd: '2026-09-07T00:00:00.000Z' }, proposals: [prop({ from: 4, to: 5, ranAt: 4 })] },
  }
  const knobs = { revert: [], land: [], held: [{ id: kid, rollout: 'b', reason: 'agreement 1 of 3' }, { id: kid, rollout: 'a', reason: 'not the repo\'s newest rollout ([[b]] is)' }] }
  const sp = fakeSpan(h, RID(1), ['a', 'b'], { entries, knobs })
  const r = ok(h, ['knobs', '--span', sp])
  assert.match(r.stdout, new RegExp(`^knob ${kid} parallel_ceiling 4 -> 5 held: agreement 1 of 3$`, 'm'))
  const [l] = rlines(h)
  assert.deepEqual([l.altitude, l.id, l.rollouts, l.from, l.to, l.ranAt, l.landed, l.held, 'auto' in l], ['knob', kid, ['a', 'b'], 4, 5, 4, false, 'agreement 1 of 3', false])
  assert.equal(ok(h, ['knobs', '--span', sp]).stdout, `exists ${kid} parallel_ceiling\n`, 'a re-run writes nothing new')
  // landed: an auto line of this Reflection on b with the same rule and direction; another rule, direction or rollout is not
  const h2 = setup(t)
  const tl = (id, over, entry = {}) => JSON.stringify({ v: 2, ts: '2026-09-08T00:00:00.000Z', host: 'h', rollout: 'b', task: null, kind: 'tuning', id, repo: 'O/R',
    window: { since: '2026-09-07T00:00:00.000Z', until: '2026-09-08T00:00:00.000Z' }, scores: {}, auto: true, reflection: RID(1),
    applied: [{ key: 'parallel_ceiling', from: 4, to: 5, ranAt: 4, rule: 'slot-bound-raise', evidence: 'e', agreeing: 0, agreed: 3, ...entry }], ...over })
  fs.writeFileSync(tuningsFile(h2), [tl('t-other-rule', {}, { rule: 'quota-bound-lower' }), tl('t-other-dir', {}, { from: 5, to: 4 }), tl('t-other-rollout', { rollout: 'zz' }),
    tl('t-land', {}), JSON.stringify({ v: 2, ts: '2026-09-08T01:00:00.000Z', host: 'h', rollout: 'b', task: null, kind: 'tuning', id: 't-rev', repo: 'o/r',
      window: { since: '2026-09-07T00:00:00.000Z', until: '2026-09-08T00:00:00.000Z' }, scores: {}, auto: true, reflection: RID(1), reverts: 't-old',
      applied: [{ key: 'max_review_rounds', from: 5, to: 4, ranAt: 5, rule: 'revert:review-rounds-raise', evidence: 'e', agreeing: 0 }] }), ''].join('\n'))
  const tbefore = sha(tuningsFile(h2))
  const sp2 = fakeSpan(h2, RID(1), ['a', 'b'], { entries, knobs: { revert: [], land: [{ id: kid, rollout: 'b', from: 4, to: 5, ranAt: 4 }], held: [] } })
  ok(h2, ['knobs', '--span', sp2])
  const [k, rev] = rlines(h2)
  assert.deepEqual([k.id, k.landed, k.auto, k.tuning, 'held' in k], [kid, true, true, 't-land', false])
  assert.deepEqual([rev.id, rev.landed, rev.auto, rev.reverts, rev.tuning, rev.key, rev.direction], [kidRevert, true, true, 't-old', 't-rev', 'max_review_rounds', -1])
  assert.equal(sha(tuningsFile(h2)), tbefore, 'knobs never writes tunings.jsonl')
  ok(h2, ['close', '--span', sp2])
  assert.deepEqual([rlines(h2).at(-1).counts.knobs, rlines(h2).at(-1).counts.landed, rlines(h2).at(-1).counts.reverted], [1, 1, 1])
  // a land candidate tune.py --auto never landed reads as eligible
  const h3 = setup(t)
  ok(h3, ['knobs', '--span', fakeSpan(h3, RID(1), ['a', 'b'], { entries, knobs: { revert: [], land: [{ id: kid, rollout: 'b', from: 4, to: 5, ranAt: 4 }], held: [] } })])
  assert.equal(rlines(h3)[0].held, 'eligible: tune.py --auto was not run')
  assert.ok(kidLower)
})

test('knobs: a check() refusal writes nothing (exit 2)', (t) => {
  const h = setup(t)
  const [kid, kid2] = ids(h, [['k', 'o/r', 'parallel_ceiling', 'slot-bound-raise', 1], ['k', 'o/r', 'max_plan_rounds', 'plan-rejected-raise', 1]])
  const entries = { a: { proposals: [
    { key: 'max_plan_rounds', rule: 'plan-rejected-raise', direction: 1, from: 3, to: 4, ranAt: 3, knob_key: kid2 },
    { key: 'parallel_ceiling', rule: 'slot-bound-raise', direction: 1, from: 0, to: 1, ranAt: 0, knob_key: kid },
  ] } }
  const r = reflect(h, ['knobs', '--span', fakeSpan(h, RID(1), ['a'], { entries })])
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stderr, new RegExp(`^reflect: the run record refused knob ${kid}: .*from must be an integer >= 1: nothing written\\n$`))
  assert.deepEqual(rlines(h), [])
})

// ---- decide ----------------------------------------------------------------------------------------------------------------

function twoWatches(h, rid, sp) {
  ok(h, watchArgs(sp, ['a', 'b']))
  ok(h, watchArgs(sp, ['a'], { rule: 'grill-fit § How a fork comes back', shape: 'a fork routed no gate' }))
}

test('decide: no task without a rule item; one task for the next Melbourne morning in task-writer § 5\'s shape; entries checked; a left-out Watch still listed', (t) => {
  const h = setup(t)
  const [wid, one] = ids(h, [['w', RULE, SHAPE], ['w', 'grill-fit § How a fork comes back', 'a fork routed no gate']])
  const sp0 = fakeSpan(h, RID(1), ['a', 'b'])
  ok(h, watchArgs(sp0, ['a'], { rule: 'grill-fit § How a fork comes back', shape: 'a fork routed no gate' }))
  assert.equal(ok(h, ['decide', '--span', sp0, '--tasks-dir', h.tasks]).stdout, 'no rule proposal: no decision task\n', 'Watches to confirm alone write nothing')
  assert.deepEqual(listing(h.tasks), ['Archive', 'Archive/2026', 'Archive/Rollouts'])
  ok(h, watchArgs(sp0, ['a', 'b']))
  const bad = path.join(h.home, 'bad.json')
  fs.writeFileSync(bad, JSON.stringify({ [one]: { why: 'x', amends: 'y' } }))
  const refused = reflect(h, ['decide', '--span', sp0, '--decisions', bad, '--tasks-dir', h.tasks])
  assert.equal(refused.status, 2)
  assert.match(refused.stderr, new RegExp(`Watch ${one}, which is not recurring`))
  const dec = path.join(h.home, 'decisions.json')
  fs.writeFileSync(dec, JSON.stringify({}))
  const r = ok(h, ['decide', '--span', sp0, '--decisions', dec, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00'])
  assert.equal(r.stdout, 'decision task thread-skill-decisions-2026-09-10: scheduled 2026-09-11 (new)\n')
  const text = fs.readFileSync(path.join(h.tasks, 'thread-skill-decisions-2026-09-10.md'), 'utf8')
  const fm = text.split('---')[1]
  for (const line of ['tags: [task, ai, decisions]', 'status: open', 'priority: high', 'scheduled: 2026-09-11', 'captured: 2026-09-10', 'launch: cc-thread']) assert.ok(fm.includes(`\n${line}\n`), line)
  assert.deepEqual(text.split('\n').filter((l) => /^## /.test(l)), ['## Notes', '## Launch', '## Resume prompt', `## Reflection ${RID(1)}`])
  assert.ok(text.includes('Conversation-gated'))
  assert.ok(text.includes('- **Launch:** `cc-thread`'))
  assert.ok(text.includes('Next move: /thread:reflect --decide [[thread-skill-decisions-2026-09-10]]'))
  assert.doesNotMatch(text, /mark the capture done/)
  assert.ok(text.includes(`- ${wid}: rule ${RULE}; shape ${SHAPE}; rollouts [[a]], [[b]]; why not given; amends not given`), 'a Watch the decisions file left out')
  assert.ok(text.includes(`- confirm ${one}: rule grill-fit § How a fork comes back`), 'a Watch to confirm rides along')
  assert.deepEqual(rlines(h).filter((l) => l.kind === 'proposal').map((l) => [l.altitude, l.id, l.vaultTask]), [['rule', wid, 'thread-skill-decisions-2026-09-10']])
})

test('decide: an open task gets a new section, scheduled: moved; a listed Watch goes under ## Still open dated by until; re-runs after midnight are byte-identical', (t) => {
  const h = setup(t)
  const sp1 = fakeSpan(h, RID(1), ['a', 'b'])
  twoWatches(h, RID(1), sp1)
  ok(h, ['decide', '--span', sp1, '--tasks-dir', h.tasks, '--now', '2026-09-10T23:50+10:00'])
  const p = path.join(h.tasks, 'thread-skill-decisions-2026-09-10.md')
  const first = fs.readFileSync(p, 'utf8')
  ok(h, ['decide', '--span', sp1, '--tasks-dir', h.tasks, '--now', '2026-09-11T00:10+10:00'])
  assert.equal(fs.readFileSync(p, 'utf8'), first, 'a new task: byte-identical after midnight')
  ok(h, ['close', '--span', sp1])
  // R2 sees the same Watch again in c: the open task is appended to, its scheduled: moved
  const sp2 = fakeSpan(h, RID(2), ['c'], { until: '2026-09-17T14:00:00.000Z' })
  ok(h, watchArgs(sp2, ['c']))
  const r = ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-17T23:50+10:00'])
  assert.equal(r.stdout, 'decision task thread-skill-decisions-2026-09-10: scheduled 2026-09-18 (was 2026-09-11) (appended)\n')
  const second = fs.readFileSync(p, 'utf8')
  const keep = (s) => s.split('---')[1].split('\n').filter((l) => !l.startsWith('scheduled:'))
  assert.deepEqual(keep(second), keep(first), 'every frontmatter line but scheduled: is byte-identical')
  const [wid] = ids(h, [['w', RULE, SHAPE]])
  assert.ok(second.includes(`## Reflection ${RID(2)}\n\nNo new rule items; still open: ${wid} (see ## Still open)`), second)
  assert.ok(second.includes(`## Still open\n\n${wid} still open 2026-09-18: Reflection ${RID(2)}, rollouts [[a]], [[b]], [[c]]`), second)
  ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-18T00:10+10:00'])
  assert.equal(fs.readFileSync(p, 'utf8'), second, 'an existing task: byte-identical after midnight')
})

test('decide: a done task at today\'s path stays byte-identical and the new task is -2; an archived namesake is skipped; --dry-run writes nothing', (t) => {
  const h = setup(t)
  const sp = fakeSpan(h, RID(1), ['a', 'b'])
  twoWatches(h, RID(1), sp)
  const done = taskNote(h, 'thread-skill-decisions-2026-09-10', { status: 'done', tags: '[task, ai, decisions]' })
  taskNote(h, 'thread-skill-decisions-2026-09-10-2', { status: 'done', tags: '[task, ai, decisions]', archived: true })
  const before = fs.readFileSync(done)
  const files = listing(h.tasks)
  const dry = ok(h, ['decide', '--span', sp, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00', '--dry-run'])
  assert.match(dry.stdout, /^would write \S+thread-skill-decisions-2026-09-10-3\.md:/m)
  assert.deepEqual(listing(h.tasks), files, '--dry-run writes no file')
  assert.equal(rlines(h).filter((l) => l.kind === 'proposal').length, 0, '--dry-run writes no line')
  assert.equal(ok(h, ['decide', '--span', sp, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00']).stdout, 'decision task thread-skill-decisions-2026-09-10-3: scheduled 2026-09-11 (new)\n')
  assert.deepEqual(fs.readFileSync(done), before)
})

// ---- close ---------------------------------------------------------------------------------------------------------------

test('close: exactly one line with quiet computed; a second close is refused; --cadence 14 is written, 10 refused, none absent', (t) => {
  const h = setup(t)
  const sp = fakeSpan(h, RID(1), ['a'], { entries: { a: { breached: ['setAsideRate'], breachCounts: false } } })
  const r = ok(h, ['close', '--span', sp])
  assert.match(r.stdout, /^closed r-\S+: quiet, sightings 0, /)
  const [l] = rlines(h)
  assert.deepEqual([l.kind, l.id, l.since, l.until, l.rollouts, l.escapesOnly, l.quiet, 'cadence' in l, 'decisionTask' in l],
    ['reflection', RID(1), '2026-09-03T14:00:00.000Z', '2026-09-10T14:00:00.000Z', ['a'], [], true, false, false])
  const again = reflect(h, ['close', '--span', sp])
  assert.equal(again.status, 2)
  assert.match(again.stderr, /a second close is refused/)
  for (const w of [watchArgs(sp, ['a']), ['knobs', '--span', sp], ['decide', '--span', sp, '--tasks-dir', h.tasks]]) {
    const x = reflect(h, w)
    assert.equal(x.status, 2, w[0])
    assert.match(x.stderr, /is closed: nothing written/, w[0])
  }
  ok(h, ['close', '--span', fakeSpan(h, RID(2), ['a']), '--cadence', '14'])
  assert.equal(rlines(h).at(-1).cadence, 14)
  assert.equal(reflect(h, ['close', '--span', fakeSpan(h, RID(3), ['a']), '--cadence', '10']).status, 2)
})

// ---- rung ------------------------------------------------------------------------------------------------------------------

const hasTomllib = spawnSync('python3', ['-c', 'import tomllib']).status === 0

test('rung: the built-in ladder is opus-xhigh with no note; no opus rung is exit 2', (t) => {
  const h = setup(t)
  const r = ok(h, ['rung'])
  assert.deepEqual(JSON.parse(r.stdout), { rung: 'opus-xhigh', model: 'opus', effort: 'xhigh', judge: 'high', review: 'xhigh', top: 'opus-xhigh', topModel: 'opus' })
  assert.equal(r.stderr, '')
})

test('rung: an operator ladder whose top is fable and whose opus rung is high: both notes; no opus rung is exit 2', { skip: !hasTomllib && 'no tomllib' }, (t) => {
  const h = setup(t)
  const p = path.join(h.home, '.config', 'thread', 'ladder.toml')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const rung = (name, model, effort) => `[[rung]]\nname = "${name}"\nmodel = "${model}"\neffort = "${effort}"\njudge = "high"\nreview = "xhigh"\n`
  fs.writeFileSync(p, rung('opus-high', 'opus', 'high') + rung('fable-xhigh', 'fable', 'xhigh'))
  const r = ok(h, ['rung'])
  assert.deepEqual(JSON.parse(r.stdout), { rung: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh', top: 'fable-xhigh', topModel: 'fable' })
  assert.equal(r.stderr, 'rung: the ladder\'s top rung fable-xhigh is fable; ADR 0037 d4 names Opus\nrung: opus-high\'s effort is high; ADR 0037 d4 names xhigh\n')
  fs.writeFileSync(p, rung('fable-xhigh', 'fable', 'xhigh'))
  const none = reflect(h, ['rung'])
  assert.equal(none.status, 2)
  assert.match(none.stderr, /has no opus rung/)
  fs.writeFileSync(p, 'nonsense = [\n')
  const bad = reflect(h, ['rung'])
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /^ladder: \S+ladder\.toml:\d+: /)
})

// ---- the Verify week, end to end -------------------------------------------------------------------------------------------
// Three rollouts in 2026-10-09 .. 10-15: a and b each carry the same mid-run ask (one Watch naming both), the same bug,
// one repair line; a is Slot-bound at ceiling 3 with rollouts.toml at 3, so it proposes a knob, held at agreement 1 of 3.

test('the Verify week: one watch line per Watch, a rule line and the decision task, one bug task and line, a repair item, each knob held 1 of 3, tunings.jsonl unchanged', (t) => {
  const h = setup(t)
  const config = path.join(h.home, 'rollouts.toml')
  fs.writeFileSync(config, '[defaults]\nparallel_ceiling = 3\n')
  const V = (d, hm) => `2026-10-${d}T${hm}:00Z`
  const sat = []
  for (const [i, s] of ['a1', 'a2', 'a3'].entries()) {
    const free = `0${4 + Math.floor(i / 6)}:${i}0`
    sat.push(...life(s, V(10, '00:00'), V(10, free), { c: 3, lane: [V(10, free), V(10, `0${4 + Math.floor(i / 6)}:${i}5`)] }))
  }
  sat.push([V(10, '00:30'), 'answer-recorded', 'a1', { answerKind: 'decision', form: 'hand-back' }])
  emitAll(h, 'week-a', byTs(sat))
  emitAll(h, 'week-b', byTs([...life('b1', V(12, '00:00'), V(12, '01:00'), { lane: [V(12, '01:00'), V(12, '01:10')] }),
    [V(12, '00:30'), 'answer-recorded', 'b1', { answerKind: 'decision', form: 'hand-back' }]]))
  emitAll(h, 'week-c', byTs(life('c1', V(13, '00:00'), V(13, '01:00'), { lane: [V(13, '01:00'), V(13, '01:10')] })))
  rolloutNote(h, 'week-a', { notes: ['- 2026-10-11 repair: [[a2]] max_review_rounds raised to 5, one round'] })
  rolloutNote(h, 'week-b')
  rolloutNote(h, 'week-c')
  fs.writeFileSync(tuningsFile(h), '')
  const tbefore = sha(tuningsFile(h))
  const out = path.join(h.out, 'span.json')
  ok(h, ['span', '--since', '2026-10-09T00:00+11:00', '--until', '2026-10-15T12:00+11:00', '--tasks-dir', h.tasks, '--config', config, '--out', out])
  const s = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.deepEqual(s.rollouts.map((r) => r.rollout), ['week-a', 'week-b', 'week-c'])
  assert.equal(s.rollouts.flatMap((r) => r.friction).filter((f) => f.kind === 'repair').length, 1)
  const asks = s.rollouts.flatMap((r) => r.friction).filter((f) => f.kind === 'ask')
  assert.deepEqual(asks.map((a) => a.rollout), ['week-a', 'week-b'])
  assert.deepEqual(s.knobs.held.map((k) => [k.rollout, k.key, k.reason]), [['week-a', 'parallel_ceiling', 'agreement 1 of 3']])
  // the model's half: one Watch for the shared ask, one bug seen in both
  ok(h, watchArgs(out, ['week-a', 'week-b']))
  ok(h, bugArgs(h, out, { rollouts: ['week-a', 'week-b'], rule: 'execute § 4.5', shape: 'a hand-back loses its answer' }))
  ok(h, bugArgs(h, out, { rollouts: ['week-a', 'week-b'], rule: 'execute § 4.5', shape: 'a hand-back loses its answer' }))
  const tune = spawnSync('python3', ['-B', path.join(root, 'skills', 'reflect', 'scripts', 'tune.py'), '--scores', s.knobs.held[0].scores, '--auto', '--repo', h.repo,
    '--reflection', s.reflection, '--config', config], { encoding: 'utf8', cwd: h.home, env: env(h) })
  assert.equal(tune.status, 0, tune.stderr)
  assert.equal(tune.stdout, 'held parallel_ceiling: agreement 1 of 3\n')
  ok(h, ['knobs', '--span', out])
  ok(h, ['decide', '--span', out, '--tasks-dir', h.tasks, '--now', '2026-10-15T23:00+11:00'])
  ok(h, ['close', '--span', out])
  const L = rlines(h)
  assert.equal(L.filter((l) => l.kind === 'watch').length, 1, 'one watch line per Watch')
  const props = L.filter((l) => l.kind === 'proposal')
  assert.deepEqual(props.map((l) => l.altitude).sort(), ['bug', 'knob', 'rule'], 'one line per Tuning')
  assert.equal(props.find((l) => l.altitude === 'knob').held, 'agreement 1 of 3')
  assert.equal(fs.readdirSync(h.tasks).filter((f) => f.startsWith('thread-skill-bug-')).length, 1, 'one task per distinct bug')
  assert.ok(fs.existsSync(path.join(h.tasks, 'thread-skill-decisions-2026-10-15.md')), 'a decision task with the rule proposal')
  assert.equal(sha(tuningsFile(h)), tbefore, 'no knob landed')
  const close = L.at(-1)
  assert.deepEqual([close.kind, close.quiet, close.counts.rules, close.counts.bugs, close.counts.knobs, close.counts.landed], ['reflection', false, 1, 1, 1, 0])
  assert.equal(close.decisionTask, 'thread-skill-decisions-2026-10-15')
  // with no recurring Watch, no task: the same week with the Watch in one rollout
  const h2 = setup(t)
  const sp = fakeSpan(h2, RID(1), ['week-a', 'week-b'])
  ok(h2, watchArgs(sp, ['week-a']))
  assert.equal(ok(h2, ['decide', '--span', sp, '--tasks-dir', h2.tasks]).stdout, 'no rule proposal: no decision task\n')
})
