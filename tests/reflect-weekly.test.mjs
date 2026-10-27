// skills/reflect/scripts/reflect.py — the weekly reading's script half (p21-7, ADR 0037 d3-d5): span reads every
// rollout with a line in the window (score.py per rollout, the friction, the Escapes sweep over every record, the knob
// candidates, and the Grade log joined to outcomes through grades.py, whose own suite is tests/reflect-grades.test.mjs); watch, raised, bug, knobs, decide and close write reflections.jsonl (and the bug and decision tasks);
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
// The settings file span hands score.py is rollout-settings.py's CLI JSON, redacted as the CLI prints it (ADR 0038 d3):
// whether an ntfy topic is set, never the topic, which on ntfy.sh is its own read and publish credential.
test('span writes each settings file redacted, as the CLI prints it: the ntfy topic set, never the topic itself', (t) => {
  const h = setup(t)
  fs.writeFileSync(path.join(h.home, 'rollouts.toml'), '[defaults]\nparallel_ceiling = 3\n\n[notify]\nntfy_topic = "span-topic-7"\n')
  emitAll(h, 'week-a', saturated('a', 10, 3))
  rolloutNote(h, 'week-a')
  const e = entryOf(span(h, [], { since: KSINCE, until: KUNTIL }), 'week-a')
  const text = fs.readFileSync(e.settingsFile, 'utf8')
  assert.deepEqual(JSON.parse(text).notify, { ntfy_topic: { set: true, source: 'file:notify' } })
  assert.equal(JSON.parse(text).settings.parallel_ceiling.value, 3, 'the rest is resolve()\'s, unchanged')
  assert.ok(!text.includes('span-topic-7'), 'the topic is in no settings file')
})

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
function fakeSpan(h, rid, rollouts, { since = '2026-09-03T14:00:00.000Z', until = '2026-09-10T14:00:00.000Z', knobs = { revert: [], land: [], held: [] }, entries = {}, grades } = {}) {
  const p = path.join(h.out, `span-${++spanN}.json`)
  fs.writeFileSync(p, JSON.stringify({ reflection: rid, since, until, previous: null, knobs,
    rollouts: rollouts.map((r) => ({ rollout: r, mode: 'read', repo: 'o/r', breached: [], breachCounts: false, proposals: [], friction: [], ...(entries[r] || {}) })),
    ...(grades ? { grades } : {}) }))
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
  for (const f of ['reviews.jsonl', 'tunings.jsonl', 'grades.jsonl']) fs.writeFileSync(path.join(h.ev, f), '{"v":1,"ts":"2026-09-04T00:00:00.000Z","kind":"x"}\n')
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
  assert.deepEqual([fixed.mover, fixed.explainedIn], [{ kind: 'lane-taken', at: '2026-09-04T05:00:00.000Z' }, []], 'an empty note, and demo\'s Notes name only [[stuck]]')
  const stuck = f.find((x) => x.kind === 'set-aside' && x.task === 'stuck')
  assert.equal(stuck.movedBy, null, 'still set aside at until')
  assert.equal(stuck.taskNote, null)
  assert.equal(f.find((x) => x.kind === 'set-aside' && x.task === 'retried').movedBy, 'auto-retry')
  assert.deepEqual(f.filter((x) => x.kind === 'churn').map((x) => [x.task, x.regression]), [['retried', 2]])
  assert.ok(s.cannotShow.some((c) => c.startsWith('[[fixed]] (demo) moved on with no recorded act')), JSON.stringify(s.cannotShow))
})

// The writers' own wording (p22-7): tune.py's auto_check gives a held trade's reason, gated_inputs.annotation() the
// standing approval's `## Approved gates` suffix, so a change in either fails these fixtures.
function pyOut(h, body, input) {
  const r = spawnSync('python3', ['-B', '-c', ['import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("m", sys.argv[1])', 'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'a = json.load(sys.stdin)', body].join('\n'), input[0]], { encoding: 'utf8', cwd: h.home, env: env(h), input: JSON.stringify(input[1]) })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const TUNE_PY = path.join(root, 'skills', 'reflect', 'scripts', 'tune.py')
const GATED_PY = path.join(root, 'skills', '_shared', 'scripts', 'gated_inputs.py')
const heldReason = (h, proposal) => pyOut(h, 'print(json.dumps(m.auto_check({}, a, None, [], [])[1]))', [TUNE_PY, proposal])
const standingLine = (h, gate, date, usd, limit, source) => `- ${gate} ${pyOut(h, 'print(json.dumps(m.annotation(*a)))', [GATED_PY, [date, usd, limit, source]])}`

test('span: an unrecorded set-aside carries mover and explainedIn; a gate set-aside\'s ## Approved gates is read as the standing approval or a sign-off, a plan set-aside\'s is not; cannotShow names the signed-gate case', (t) => {
  const h = setup(t)
  const S = (start) => ({ settings: { parallel_ceiling: 2 }, start })
  const gate = { stage: 'gate', reasonClass: 'gate', setAsideAt: 'gate' }
  emitAll(h, 'demo', byTs([
    // gated: the p21-1 shape, a gate set-aside then a resume with no gate-signed line
    [W(4, '00:00'), 'slot-taken', 'gated', S('start')],
    [W(4, '00:30'), 'set-aside', 'gated', gate],
    [W(4, '00:30'), 'slot-freed', 'gated', { outcome: 'set-aside' }],
    [W(4, '02:00'), 'slot-taken', 'gated', S('resume')],
    // signed: the chorus-p18-7 shape, approve-gates' bare line and no gate-signed line
    [W(5, '00:00'), 'set-aside', 'signed', gate],
    [W(5, '01:00'), 'lane-taken', 'signed', {}],
    [W(5, '02:00'), 'set-aside', 'noted', { stage: 'implement', reasonClass: 'needs-human', setAsideAt: 'run' }],
    [W(5, '03:00'), 'lane-taken', 'noted', {}],
    [W(5, '04:00'), 'set-aside', 'both', gate],
    [W(5, '05:00'), 'lane-taken', 'both', {}],
    [W(6, '00:00'), 'set-aside', 'planned', { stage: 'plan', reasonClass: 'plan-rejected', setAsideAt: 'run' }],
    [W(6, '01:00'), 'lane-taken', 'planned', {}],
    [W(6, '02:00'), 'set-aside', 'postsign', gate],
    [W(6, '03:00'), 'gate-signed', 'postsign', { standing: true, gates: 1 }],
    [W(6, '04:00'), 'slot-taken', 'postsign', S('resume')],
    [W(7, '00:00'), 'set-aside', 'waiting', gate],
  ]))
  rolloutNote(h, 'demo', { notes: ['- 2026-09-04 lead: [[noted|the noted task]] resumed by hand'] })
  const standing = standingLine(h, 'spend: x — cap 8 USD total', '2026-09-04', 8, 30, 'task')
  assert.match(standing, /^- spend: x — cap 8 USD total \(approved 2026-09-04 under the standing approval: /)
  taskNote(h, 'gated', { body: `## Approved gates\n\n${standing}` })
  taskNote(h, 'signed', { body: '## Approved gates\n\n- spend: y (approved 2026-09-04)' })
  taskNote(h, 'noted')
  taskNote(h, 'both', { body: `## Needs you\n\nWhich card?\n\n## Approved gates\n\n- spend: w (approved 2026-09-05)\n${standing}\n- spend: v signed by hand` })
  taskNote(h, 'planned', { body: '## Approved gates\n\n- spend: z (approved 2026-09-04)' })
  taskNote(h, 'postsign', { body: `## Approved gates\n\n${standing}` })
  const s = span(h)
  const by = Object.fromEntries(entryOf(s, 'demo').friction.filter((x) => x.kind === 'set-aside').map((x) => [x.task, x]))
  const at = (d, hm) => `2026-09-0${d}T${hm}:00.000Z`
  assert.deepEqual([by.gated.movedBy, by.gated.mover, by.gated.explainedIn],
    ['unrecorded', { kind: 'slot-taken', at: at(4, '02:00'), start: 'resume' }, ['## Approved gates: standing approval']])
  assert.deepEqual([by.signed.movedBy, by.signed.mover, by.signed.explainedIn],
    ['unrecorded', { kind: 'lane-taken', at: at(5, '01:00') }, ['## Approved gates: sign-off']])
  assert.deepEqual([by.noted.movedBy, by.noted.explainedIn], ['unrecorded', ['rollout ## Notes']], 'an aliased link on a line that is no repair line')
  assert.deepEqual(by.both.explainedIn, ['## Needs you', '## Approved gates: standing approval', '## Approved gates: sign-off', '## Approved gates'],
    'each label once, standing first; a hand-written line is the bare label')
  assert.deepEqual([by.planned.movedBy, by.planned.explainedIn], ['unrecorded', []], 'gates are read only for a gate set-aside')
  assert.deepEqual([by.postsign.movedBy, by.postsign.mover, by.postsign.explainedIn], ['gate-signed', null, null])
  assert.deepEqual([by.waiting.movedBy, by.waiting.mover, by.waiting.explainedIn], [null, null, null])
  const c = s.cannotShow.find((x) => x.startsWith('[[gated]] (demo) '))
  assert.ok(c && c.startsWith('[[gated]] (demo) moved on with no recorded act: a Human fix, a gate signed on the note with no gate-signed line, or a hand edit'), JSON.stringify(s.cannotShow))
  assert.ok(c.includes('## Approved gates') && c.includes('[[demo]]\'s ## Notes'), c)
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

// The Grade log (p25-4): span joins grades.jsonl to the outcomes (grades.py) and writes the block as `grades`; an ask
// carries the grade in force for its task at the act, null for a task never graded.
test('span: grades carries the Grade log joined to outcomes, readyHandsOff first; an ask carries its task\'s grade, null when never graded', (t) => {
  const h = setup(t)
  const G = (task, ts, pass, f = {}) => [ts, 'grade', task, { pass, digest: '0123456789ab', project: 'P', grade: 'Ready',
    agentGrade: 'Ready', shape: 'parallel', size: 'S', decisions: 0, low: 0, held: false, gates: [], ...f }, null]
  const P1 = 'g-20260903T000000Z-000001'
  emitAll(h, 'demo', byTs([
    ...life('a', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] }),
    ...life('b', W(4, '02:00'), W(4, '03:00'), { lane: [W(4, '03:00'), W(4, '03:10')] }),
    [W(4, '02:30'), 'answer-recorded', 'b', { answerKind: 'decision' }],
    ...life('u', W(5, '00:00'), W(5, '01:00')),
    [W(5, '00:30'), 'answer-recorded', 'u', { answerKind: 'decision' }],
  ]))
  emitAll(h, null, [G('a', W(3, '00:00'), P1), G('b', W(3, '00:00'), P1),
    G('b', W(4, '02:40'), 'g-20260904T024000Z-000002', { grade: 'One call', decisions: 1 })])
  rolloutNote(h, 'demo')
  for (const slug of ['a', 'b']) taskNote(h, slug, { status: 'done' })
  const s = span(h)
  assert.deepEqual(s.grades.window.readyHandsOff, { rate: 0.5, handsOff: 1, dispatched: 2 })
  const outcomes = Object.fromEntries(s.grades.episodes.map((e) => [`${e.task}/${e.grade}`, [e.outcome, e.rollouts]]))
  assert.deepEqual(outcomes, { 'a/Ready': ['hands-off', ['demo']], 'b/Ready': ['bounced', ['demo']], 'b/One call': ['hands-off', ['demo']] })
  const asks = entryOf(s, 'demo').friction.filter((x) => x.kind === 'ask')
  assert.deepEqual(asks.map((x) => [x.task, x.grade && x.grade.grade]), [['b', 'Ready'], ['u', null]])
  assert.deepEqual(asks[0].grade, { grade: 'Ready', agentGrade: 'Ready', raised: [], gates: [], pass: P1 })
  assert.ok(!s.flags.some((f) => f.startsWith('grades: ')), JSON.stringify(s.flags))
  // no grades.jsonl: an empty block and the flag, and span goes on
  fs.rmSync(path.join(h.ev, 'grades.jsonl'))
  const bare = span(h)
  assert.ok(bare.flags.includes('grades: no grade log'), JSON.stringify(bare.flags))
  assert.deepEqual([bare.grades.episodes, bare.grades.window.readyHandsOff.rate], [[], null])
  assert.equal(entryOf(bare, 'demo').friction.find((x) => x.kind === 'ask').grade, null)
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

// p29-10 (ADR 0051): the time-lost ledger's lines are never read as a rollout's (score.py's LEDGER_KINDS), so a rollout
// whose only in-window lines are ledger lines (a heartbeat's lead-entries, a stop) is not read this week; one with a real
// line is. p29-11: the Time-lost ledger still counts it.
test('span: a rollout whose only in-window lines are ledger lines (p29-10) is not read', (t) => {
  const h = setup(t)
  const before = byTs(life('a', '2026-08-20T00:00:00Z', '2026-08-20T01:00:00Z', { lane: ['2026-08-20T01:00:00Z', '2026-08-20T01:10:00Z'] }))
  emitAll(h, 'ledger-only', [...before,
    [W(4, '00:00'), 'lead-entry', null, { by: 'heartbeat' }],
    [W(4, '00:20'), 'stopped', null, { cause: 'halt', inferred: false, calls: [] }],
    [W(4, '00:30'), 'suite-ended', 'a', { suite: 's-0000000000000001', by: 'task', runner: 'agent', outcome: 'green', seconds: 5 }]])
  emitAll(h, 'live-r', [...byTs(life('b', '2026-08-20T00:00:00Z', '2026-08-20T01:00:00Z')), [W(4, '00:00'), 'idle-slots', null,
    { reason: 'queue-tail', free: 1, settings: { parallel_ceiling: 2 } }]])
  rolloutNote(h, 'ledger-only')
  rolloutNote(h, 'live-r')
  const s = span(h)
  assert.equal(entryOf(s, 'ledger-only'), undefined, 'ledger lines alone never make a rollout read')
  assert.equal(entryOf(s, 'live-r')?.mode, 'read', 'a real in-window line does')
  // p29-11: counted in the ledger, still not read: its open halt (no reason) runs to until on its live note
  assert.ok(s.ledger.row.rollouts.stalls.some(([slug]) => slug === 'ledger-only'), JSON.stringify(s.ledger.row.rollouts))
  assert.ok(s.ledger.row.byCause.stalls.halt > 0, JSON.stringify(s.ledger.row.byCause))
})

// p29-10: span drops the ledger's lines as it lists the records, so grades.py never sees them either: a task whose only
// in-span record lines are ledger lines (a suite, why main moved) is no `record` dispatch, and the grades block is
// byte-equal with or without them, whichever record carries them.
test('span: the grades block is byte-equal with or without ledger lines (p29-10); a ledger line alone dispatches nothing', (t) => {
  const h = setup(t)
  const G = (task, ts, pass) => [ts, 'grade', task, { pass, digest: '0123456789ab', project: 'P', grade: 'Ready',
    agentGrade: 'Ready', shape: 'parallel', size: 'S', decisions: 0, low: 0, held: false, gates: [] }, null]
  const P1 = 'g-20260903T000000Z-000001'
  emitAll(h, 'demo', byTs(life('a', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] })))
  emitAll(h, null, [G('a', W(3, '00:00'), P1), G('c', W(3, '00:00'), P1)])
  rolloutNote(h, 'demo')
  taskNote(h, 'a', { status: 'done' })
  taskNote(h, 'c', { status: 'done', fm: ['completed: 2026-09-05'] })
  const before = span(h).grades
  const suite = { suite: 's-0123456789abcdef', by: 'task', runner: 'agent' }
  const ledger = [
    [W(4, '05:00'), 'lead-entry', null, { by: 'heartbeat', session: 'A' }],
    [W(4, '05:10'), 'stopped', null, { cause: 'halt', inferred: false, calls: [] }],
    [W(4, '05:20'), 'suite-started', 'c', { ...suite, sha: 'a'.repeat(40), dirty: false }],
    [W(4, '05:30'), 'suite-ended', 'c', { ...suite, outcome: 'green', seconds: 5 }],
    [W(4, '05:40'), 'base-moved', 'c', { repo: 'o/r', pr: 9, base: 'b'.repeat(40), main: 'c'.repeat(40), inertOnly: false, moversTotal: 0, movers: [] }],
  ]
  emitAll(h, 'demo', ledger)
  emitAll(h, 'ledger-only', ledger)
  const s = span(h)
  assert.equal(JSON.stringify(s.grades), JSON.stringify(before), 'the grades block is byte-equal')
  assert.ok(!s.grades.episodes.some((e) => e.task === 'c'), JSON.stringify(s.grades.episodes))
  assert.equal(s.grades.window.byGrade.Ready.byHand, 1, 'c, landed with no record line of its own, is by hand')
  assert.equal(entryOf(s, 'ledger-only'), undefined, 'a record of ledger lines alone is never read')
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

test('span: repair lines: dated in-window ones by shape, since\'s date counted and until\'s left to the next Reflection, others not read', (t) => {
  const h = setup(t)
  emitAll(h, 'demo', byTs([...life('a', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] }),
    ...life('next', '2026-09-12T00:00:00Z', '2026-09-12T01:00:00Z', { lane: ['2026-09-12T01:00:00Z', '2026-09-12T01:10:00Z'] })]))
  rolloutNote(h, 'demo', {
    notes: ['- 2026-09-03 repair: [[s]] deferred: on since\'s date',
      '- 2026-09-05 repair: [[a]] RACE decided: keep',
      '- 2026-09-05 repair: [[a]], [[b]] git-env trip, acked at abc1234: restored',
      '- 2026-09-09 repair: [[g]] max_review_rounds raised to 5, one round',
      '- 2026-09-10 repair: [[u]] deferred: on until\'s date',
      '- 2026-09-01 repair: [[c]] deferred: x',
      '- 2026-09-05T10:00+10:00 auto-retry: [[d]] 1/2 (plan; feedback x)',
      '- 2026-09-05 descope: [[e]] the follow-up',
      '- repair: [[h]] undated'],
    extra: '## Completion log\n\n- 2026-09-05 repair: [[z]] merged, never marked: flipped done\n',
  })
  const s = span(h)
  const reps = (x) => entryOf(x, 'demo').friction.filter((f) => f.kind === 'repair').map((f) => [f.date, f.tasks, f.shape])
  assert.deepEqual(reps(s), [['2026-09-03', ['s'], 'deferred'], ['2026-09-05', ['a'], 'race-decided'], ['2026-09-05', ['a', 'b'], 'git-env'], ['2026-09-09', ['g'], 'raise']])
  assert.ok(s.flags.some((f) => /an undated repair line in ## Notes: - repair: \[\[h\]\] undated/.test(f)), JSON.stringify(s.flags))
  // the next Reflection's since is this until: until's date is read there, once, and nothing before it again
  assert.deepEqual(reps(span(h, [], { since: UNTIL, until: '2026-09-17T00:00+10:00' })), [['2026-09-10', ['u'], 'deferred']])
})

// A repair, then the rollout finishing earlier on the day the Reflection runs: every record line is on until's
// Melbourne date, before until, and so is the repair line. The first span reads the rollout but not the line (until's
// date is the next Reflection's); the next span has no line of the rollout in its window, so it reads the line from
// the swept note, repairs-only, exactly once. A record of any age with an in-window repair line is read the same way.
test('span: a repair line on until\'s date is read once, by the next span, repairs-only, though that span has no line of the rollout; close names it', (t) => {
  const h = setup(t)
  const S1 = '2026-09-03T18:00+10:00'
  const S2 = '2026-09-10T18:00+10:00'
  const S3 = '2026-09-17T18:00+10:00'
  const S4 = '2026-09-24T18:00+10:00'
  // 08:00 to 09:10 Melbourne on 2026-09-10
  emitAll(h, 'demo', byTs(life('a', '2026-09-09T22:00:00Z', '2026-09-09T23:00:00Z', { lane: ['2026-09-09T23:00:00Z', '2026-09-09T23:10:00Z'] })))
  rolloutNote(h, 'demo', { notes: ['- 2026-09-10 repair: [[a]] merged, never marked: flipped done'] })
  // a record a month old: its repair line falls in the second span, its undated one is no unread rollout's flag
  emitAll(h, 'old', byTs(life('o', '2026-08-10T00:00:00Z', '2026-08-10T01:00:00Z', { lane: ['2026-08-10T01:00:00Z', '2026-08-10T01:10:00Z'] })))
  rolloutNote(h, 'old', { status: 'done', archived: true, notes: ['- 2026-09-12 repair: [[o]] deferred: a late follow-up', '- repair: [[o]] undated'] })
  const reps = (x, slug) => (entryOf(x, slug)?.friction || []).filter((f) => f.kind === 'repair').map((f) => [f.date, f.tasks, f.shape])

  const s1 = span(h, [], { since: S1, until: S2 })
  assert.equal(entryOf(s1, 'demo').mode, 'read')
  assert.deepEqual(reps(s1, 'demo'), [], 'until\'s date waits for the next span')
  assert.equal(entryOf(s1, 'old'), undefined)

  const s2 = span(h, [], { since: S2, until: S3 })
  const demo = entryOf(s2, 'demo')
  assert.ok(demo, 'the next span reads the line though it has no line of demo')
  assert.deepEqual([demo.mode, demo.score, demo.breachCounts, demo.proposals], ['repairs-only', null, false, []])
  assert.deepEqual(reps(s2, 'demo'), [['2026-09-10', ['a'], 'flipped']], 'read exactly once')
  assert.deepEqual(demo.friction.map((f) => f.kind), ['repair'])
  assert.equal(entryOf(s2, 'old').mode, 'repairs-only')
  assert.deepEqual(reps(s2, 'old'), [['2026-09-12', ['o'], 'deferred']])
  assert.ok(!s2.flags.some((f) => /undated repair line/.test(f)), 'an unread rollout\'s undated line is not flagged weekly')
  ok(h, ['ledger', '--span', path.join(h.out, 'span.json')]) // p29-11: the Time-lost ledger's line comes before close
  assert.match(ok(h, ['close', '--span', path.join(h.out, 'span.json')]).stdout, /^closed r-/)
  const line = rlines(h).filter((l) => l.kind === 'reflection').pop()
  assert.deepEqual([line.rollouts, line.escapesOnly, line.repairsOnly], [[], [], ['demo', 'old']])

  const s3 = span(h, [], { since: S3, until: S4 })
  assert.deepEqual([entryOf(s3, 'demo'), entryOf(s3, 'old')], [undefined, undefined], 'and never again')
})

test('span: the Escapes sweep reads an old, never-read record: an in-window revert or fixes: note makes it escapes-only, its in-window repair lines riding along; pre-window evidence and an unresolvable record do not', (t) => {
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
  rolloutNote(h, 'old-r', { status: 'done', archived: true, notes: ['- 2026-09-07 repair: [[old-b]] deferred: its fixer'] })
  taskNote(h, 'fix-old-b', { captured: '2026-09-06', fm: ['fixes: ["[[old-b]]"]'] })
  // a pre-window fixer, and a record with no note at all
  emitAll(h, 'older-r', byTs(life('older-a', '2026-08-01T00:00:00Z', '2026-08-01T01:00:00Z', { lane: ['2026-08-01T01:00:00Z', '2026-08-01T01:10:00Z'], pr: 3 })))
  rolloutNote(h, 'older-r', { status: 'done', archived: true })
  taskNote(h, 'fix-older-a', { captured: '2026-08-02', fm: ['fixes: ["[[older-a]]"]'] })
  emitAll(h, 'lost-r', byTs(life('lost-a', '2026-08-01T00:00:00Z', '2026-08-01T01:00:00Z', { lane: ['2026-08-01T01:00:00Z', '2026-08-01T01:10:00Z'] })))
  const s = span(h)
  const old = entryOf(s, 'old-r')
  assert.equal(old.mode, 'escapes-only')
  assert.deepEqual(old.friction.filter((x) => x.kind === 'escape').map((x) => [x.task, x.source, x.inWindow]).sort(), [['old-a', 'revert', true], ['old-b', 'fixes', true]], JSON.stringify([s.flags, s.cannotShow]))
  assert.deepEqual(old.friction.filter((x) => x.kind === 'repair').map((x) => [x.date, x.tasks, x.shape]), [['2026-09-07', ['old-b'], 'deferred']])
  assert.equal(old.friction.find((x) => x.source === 'revert').at, '2026-09-05T00:00:00.000Z')
  assert.equal(old.friction.find((x) => x.source === 'fixes').at, '2026-09-06')
  assert.equal(entryOf(s, 'older-r'), undefined, 'pre-window evidence adds nothing')
  assert.ok(s.cannotShow.some((c) => c.startsWith('record lost-r: no rollout note')), JSON.stringify(s.cannotShow))
  assert.equal(old.breachCounts, false)
})

test('span: a clone-rooted record whose in-place twin is fresher reads the twin, and dates the revert only the twin has (ADR 0042)', (t) => {
  const h = setup(t)
  h.gitEnv = { GIT_AUTHOR_DATE: '2026-08-09T00:00:00Z', GIT_COMMITTER_DATE: '2026-08-09T00:00:00Z' }
  git(h, ['commit', '-q', '--allow-empty', '-m', 'init'])
  fs.writeFileSync(path.join(h.repo, 'f.txt'), 'one\n')
  git(h, ['add', '.'])
  h.gitEnv = { GIT_AUTHOR_DATE: '2026-08-10T00:00:00Z', GIT_COMMITTER_DATE: '2026-08-10T00:00:00Z' }
  git(h, ['commit', '-q', '-m', 'old a (#7)'])
  const shaA = git(h, ['rev-parse', 'HEAD'])
  // the rollout clone, cloned before the revert: its object store never holds it
  const clone = path.join(h.home, 'repo-rollout')
  execFileSync(REAL_GIT, ['clone', '-q', h.repo, clone], { env: { PATH: process.env.PATH, HOME: h.home } })
  git(h, ['remote', 'set-url', 'origin', 'https://github.com/o/r.git'], clone)
  git(h, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], clone)
  h.gitEnv = { GIT_AUTHOR_DATE: '2026-09-05T00:00:00Z', GIT_COMMITTER_DATE: '2026-09-05T00:00:00Z' }
  git(h, ['revert', '--no-edit', shaA])
  h.gitEnv = {}
  git(h, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  git(h, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
  assert.equal(git(h, ['rev-parse', 'refs/remotes/origin/main'], clone), shaA, 'fixture: the clone root is behind its twin')
  emitAll(h, 'clone-r', byTs(life('cl-a', '2026-08-10T00:00:00Z', '2026-08-10T01:00:00Z', { lane: ['2026-08-10T01:00:00Z', '2026-08-10T01:10:00Z'], pr: 7 })))
  rolloutNote(h, 'clone-r', { status: 'done', archived: true, root: clone })
  const s = span(h)
  const r = entryOf(s, 'clone-r')
  assert.ok(r, JSON.stringify([s.flags, s.cannotShow]))
  const rv = r.friction.find((x) => x.kind === 'escape' && x.source === 'revert')
  assert.ok(rv, JSON.stringify(r.friction))
  assert.deepEqual([rv.task, rv.at, rv.inWindow], ['cl-a', '2026-09-05T00:00:00.000Z', true])
  assert.ok(s.flags.some((f) => f.includes(`ref read from the in-place checkout ${h.repo}: fresher than the Project root's`)), JSON.stringify(s.flags))
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
  // p29-10: a late ledger line (a heartbeat's lead-entry) in the older root's record never makes it the newest
  emitAll(h, 'r1', [[W(6, '00:00'), 'lead-entry', null, { by: 'heartbeat', session: 'A' }]])
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
  ok(h, ['ledger', '--span', path.join(h.out, 'span.json')]) // p29-11: the Time-lost ledger's line comes before close
  ok(h, ['close', '--span', path.join(h.out, 'span.json')])
  const [line] = rlines(h).filter((l) => l.kind === 'reflection')
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

// A grade miss is watched where it ran (p25-4): an in-window grade episode's rollouts are watch's to name, read in the
// span or not (a serial chain dispatched by link, a regraded task's earlier run); an out-of-window episode's are not,
// and bug, which a grade miss never becomes, takes the read rollouts alone.
test('watch: a rollout an in-window grade episode lists is accepted though the span did not read it; bug still refuses it', (t) => {
  const h = setup(t)
  const [wid] = ids(h, [['w', 'readiness-grade.md § The grade', 'a Ready serial chain bounced']])
  const ep = (task, rollouts, inWindow = true) => ({ task, grade: 'Ready', outcome: 'regraded', dispatchedBy: 'link', rollouts, inWindow })
  const sp = fakeSpan(h, RID(1), ['a'], { grades: { episodes: [ep('t1', ['chain-x']), ep('t2', ['old-y'], false)] } })
  const args = (rollouts) => watchArgs(sp, rollouts, { rule: 'readiness-grade.md § The grade', shape: 'a Ready serial chain bounced' })
  const r = ok(h, args(['a', '[[chain-x]]']))
  assert.equal(r.stdout, `watched ${wid} (a, chain-x): readiness-grade.md § The grade\n`)
  assert.deepEqual(rlines(h).map((l) => l.rollouts), [['a', 'chain-x']])
  const out = reflect(h, args(['old-y']))
  assert.equal(out.status, 2, 'an episode outside the window lists nothing watch takes')
  assert.equal(out.stderr, 'reflect: rollout old-y is not in the span (a, chain-x)\n')
  const bug = reflect(h, ['bug', '--span', sp, '--rule', 'readiness-grade.md § The grade', '--shape', 'x', '--slug', 'grade-miss',
    '--title', 'Thread Skill: x', '--why', 'w', '--rollout', 'chain-x', '--tasks-dir', h.tasks])
  assert.equal(bug.status, 2)
  assert.equal(bug.stderr, 'reflect: rollout chain-x is not in the span (a)\n')
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
  assert.equal(ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks]).stdout, 'no rule proposal or held trade: no decision task\n', 'one rollout in two weeks')
  ok(h, ['close', '--span', sp2])
  const sp3 = fakeSpan(h, RID(3), ['b'])
  ok(h, watchArgs(sp3, ['b']))
  const span3 = (() => { ok(h, ['decide', '--span', sp3, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00']); return rlines(h).filter((l) => l.kind === 'proposal') })()
  assert.deepEqual(span3.map((l) => [l.id, l.rollouts]), [[wid, ['a', 'b']]], 'a and b in one cycle: recurring')
  ok(h, ['raised', '--watch', wid, '--reflection', RID(3)])
  ok(h, ['close', '--span', sp3])
  const sp4 = fakeSpan(h, RID(4), ['c'], { until: '2026-11-30T00:00:00.000Z' })
  ok(h, watchArgs(sp4, ['c']))
  assert.equal(ok(h, ['decide', '--span', sp4, '--tasks-dir', h.tasks]).stdout, 'no rule proposal or held trade: no decision task\n', 'a new cycle starts empty')
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
  assert.equal(ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-17T09:00+10:00']).stdout, 'no rule proposal or held trade: no decision task\n')
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

// ---- knobs end to end: a real span's land[], held[] and revert[] ------------------------------------------------------------

const TUNE = path.join(root, 'skills', 'reflect', 'scripts', 'tune.py')
const KSINCE = '2026-10-09T00:00+11:00'
const KUNTIL = '2026-10-15T12:00+11:00'

// c tasks all in their Slots from 00:00 on 2026-10-<day>, at ceiling c: Slot-bound, so score.py proposes a ceiling raise.
function saturated(prefix, day, c) {
  const V = (hm) => `2026-10-${day}T${hm}:00Z`
  const out = []
  for (let i = 0; i < c; i++) out.push(...life(`${prefix}${i + 1}`, V('00:00'), V(`04:${i}0`), { c, lane: [V(`04:${i}0`), V(`04:${i}5`)] }))
  return byTs(out)
}

// A closed earlier Reflection whose knob line names one other rollout (the Agreement rule counts each).
function agreeingReflection(h, rid, kid, rollout, ts) {
  const L = (o) => JSON.stringify({ v: 1, ts, host: 'h', rollout: null, task: null, ...o })
  fs.appendFileSync(reflectionsFile(h), `${L({ kind: 'proposal', id: kid, altitude: 'knob', reflection: rid, rollouts: [rollout], repo: 'o/r', key: 'parallel_ceiling',
    rule: 'slot-bound-raise', direction: 1, landed: false, held: 'agreement 1 of 3' })}\n${L({ kind: 'reflection', id: rid })}\n`)
}

function tune(h, args) {
  return spawnSync('python3', ['-B', TUNE, ...args], { encoding: 'utf8', cwd: h.home, env: env(h) })
}

test('knobs end to end: two agreeing earlier Reflections make the newest rollout\'s raise a land item, an older one held; tune.py --auto lands it, knobs records it, close counts it', (t) => {
  const h = setup(t)
  const config = path.join(h.home, 'rollouts.toml')
  fs.writeFileSync(config, '[defaults]\nparallel_ceiling = 3\n')
  const [kid] = ids(h, [['k', 'o/r', 'parallel_ceiling', 'slot-bound-raise', 1]])
  agreeingReflection(h, RID(1), kid, 'old-1', '2026-10-01T00:00:00.000Z')
  agreeingReflection(h, RID(2), kid, 'old-2', '2026-10-02T00:00:00.000Z')
  emitAll(h, 'week-a', saturated('a', 10, 3))
  emitAll(h, 'week-b', saturated('b', 12, 3))
  rolloutNote(h, 'week-a')
  rolloutNote(h, 'week-b')
  const s = span(h, [], { since: KSINCE, until: KUNTIL }) // span's --config is <home>/rollouts.toml
  assert.deepEqual(s.knobs.land.map((k) => [k.id, k.rollout, k.key, k.from, k.to, k.agreed]), [[kid, 'week-b', 'parallel_ceiling', 3, 4, 3]], JSON.stringify(s.knobs))
  assert.deepEqual(s.knobs.held.map((k) => [k.id, k.rollout, k.reason]), [[kid, 'week-a', 'not the repo\'s newest rollout ([[week-b]] is)']])
  assert.deepEqual(s.knobs.revert, [])
  const out = path.join(h.out, 'span.json')
  const early = reflect(h, ['close', '--span', out])
  assert.equal(early.status, 2)
  assert.match(early.stderr, new RegExp(`knob ${kid} has no knob proposal line: run knobs\\n$`))
  const scores = [...new Set(s.knobs.land.map((k) => k.scores))]
  assert.equal(scores.length, 1)
  ok(h, ['ledger', '--span', out]) // p29-11: tune.py --auto holds a ceiling raise until the ledger's line is in
  const r = tune(h, ['--scores', scores[0], '--auto', '--repo', s.knobs.land[0].root, '--reflection', s.reflection, '--config', config])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^applied parallel_ceiling 3 → 4 for o\/r: /m)
  const [tl] = fs.readFileSync(tuningsFile(h), 'utf8').trim().split('\n').map(parse)
  assert.deepEqual([tl.auto, tl.reflection, tl.rollout, tl.applied[0].agreed], [true, s.reflection, 'week-b', 3])
  ok(h, ['knobs', '--span', out])
  const k = rlines(h).filter((l) => l.kind === 'proposal' && l.reflection === s.reflection)
  assert.deepEqual(k.map((l) => [l.id, l.rollouts, l.landed, l.auto, l.tuning]), [[kid, ['week-a', 'week-b'], true, true, tl.id]])
  ok(h, ['close', '--span', out])
  const c = rlines(h).at(-1)
  assert.deepEqual([c.kind, c.counts.knobs, c.counts.landed, c.counts.reverted], ['reflection', 1, 1, 0])
})

test('knobs end to end: an auto line a later finished run breaches at its to is a revert item, and the raise on its key is held behind it; --revert, knobs and close record it', (t) => {
  const h = setup(t)
  const config = path.join(h.home, 'rollouts.toml')
  fs.writeFileSync(config, '[defaults]\nparallel_ceiling = 4\n')
  const [kid] = ids(h, [['k', 'o/r', 'parallel_ceiling', 'slot-bound-raise', 1]])
  // RID(1)'s auto line moved the ceiling 3 -> 4; two later Reflections agree on raising it again
  fs.writeFileSync(tuningsFile(h), `${JSON.stringify({ v: 2, ts: '2026-10-08T00:00:00.000Z', host: 'h', rollout: 'old-1', task: null, kind: 'tuning', id: 't-auto', repo: 'o/r',
    window: { since: '2026-10-07T00:00:00.000Z', until: '2026-10-08T00:00:00.000Z' }, scores: {}, auto: true, reflection: RID(1),
    applied: [{ key: 'parallel_ceiling', from: 3, to: 4, ranAt: 3, rule: 'slot-bound-raise', evidence: 'e', agreeing: 0, agreed: 3 }] })}\n`)
  agreeingReflection(h, RID(2), kid, 'old-2', '2026-10-08T06:00:00.000Z')
  agreeingReflection(h, RID(3), kid, 'old-3', '2026-10-08T07:00:00.000Z')
  // rev-x ran at 4 and stalled on quota (a risk of slot-bound-raise); rev-y ran at 4, Slot-bound, clean
  emitAll(h, 'rev-x', byTs([...life('x1', '2026-10-10T00:00:00Z', '2026-10-10T01:00:00Z', { c: 4, lane: ['2026-10-10T01:00:00Z', '2026-10-10T01:10:00Z'] }),
    ['2026-10-10T00:30:00Z', 'quota-stall', null, { stage: 'implement' }]]))
  emitAll(h, 'rev-y', saturated('y', 12, 4))
  rolloutNote(h, 'rev-x')
  rolloutNote(h, 'rev-y')
  const s = span(h, [], { since: KSINCE, until: KUNTIL }) // span's --config is <home>/rollouts.toml
  assert.deepEqual(s.knobs.revert.map((k) => [k.tuning, k.key, k.rollout, k.breached]), [['t-auto', 'parallel_ceiling', 'rev-x', ['quotaStalls']]], JSON.stringify(s.knobs))
  assert.deepEqual(s.knobs.land, [])
  const held = s.knobs.held.find((k) => k.id === kid && k.rollout === 'rev-y')
  assert.equal(held.reason, 'a revert of parallel_ceiling comes first this Reflection')
  assert.equal(held.agreed, 3, 'the raise passed tune.py\'s own checks')
  const rv = s.knobs.revert[0]
  const out = path.join(h.out, 'span.json')
  ok(h, ['ledger', '--span', out]) // p29-11: the Time-lost ledger's line comes before tune.py and knobs
  const r = tune(h, ['--scores', rv.scores, '--revert', rv.tuning, '--repo', rv.root, '--reflection', s.reflection, '--config', config])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /^applied parallel_ceiling 4 → 3 for o\/r: /m)
  ok(h, ['knobs', '--span', out])
  const mine = rlines(h).filter((l) => l.kind === 'proposal' && l.reflection === s.reflection)
  assert.equal(mine.find((l) => l.id === kid).held, 'a revert of parallel_ceiling comes first this Reflection')
  assert.deepEqual(mine.filter((l) => l.reverts).map((l) => [l.reverts, l.key, l.direction, l.landed]), [['t-auto', 'parallel_ceiling', -1, true]])
  ok(h, ['close', '--span', out])
  assert.equal(rlines(h).at(-1).counts.reverted, 1)
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
  assert.equal(ok(h, ['decide', '--span', sp0, '--tasks-dir', h.tasks]).stdout, 'no rule proposal or held trade: no decision task\n', 'Watches to confirm alone write nothing')
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
  // ADR 0040 retired orient's batches: the decision task's note names only schedule and the reshuffle.
  assert.ok(text.includes('Never schedule or reshuffle it.'))
  assert.doesNotMatch(text, /batch or reshuffle/)
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

test('close: exactly one line with quiet and cadence computed; a second close is refused; --cadence is no flag (the rule sets it)', (t) => {
  const h = setup(t)
  const sp = fakeSpan(h, RID(1), ['a'], { entries: { a: { breached: ['setAsideRate'], breachCounts: false } } })
  const r = ok(h, ['close', '--span', sp])
  assert.match(r.stdout, /^closed r-\S+: quiet, sightings 0, /)
  const [l] = rlines(h)
  assert.deepEqual([l.kind, l.id, l.since, l.until, l.rollouts, l.escapesOnly, l.quiet, l.cadence, 'decisionTask' in l],
    ['reflection', RID(1), '2026-09-03T14:00:00.000Z', '2026-09-10T14:00:00.000Z', ['a'], [], true, 7, false])
  const again = reflect(h, ['close', '--span', sp])
  assert.equal(again.status, 2)
  assert.match(again.stderr, /a second close is refused/)
  for (const w of [watchArgs(sp, ['a']), ['knobs', '--span', sp], ['decide', '--span', sp, '--tasks-dir', h.tasks]]) {
    const x = reflect(h, w)
    assert.equal(x.status, 2, w[0])
    assert.match(x.stderr, /is closed: nothing written/, w[0])
  }
  const flag = reflect(h, ['close', '--span', fakeSpan(h, RID(2), ['a']), '--cadence', '14'])
  assert.equal(flag.status, 2)
  assert.match(flag.stderr, /unrecognized arguments: --cadence 14/)
  assert.equal(rlines(h).length, 1, 'nothing written')
})

// Every writer refuses a closed Reflection, so close refuses while decide or knobs still has a line to write.
test('close: a recurring Watch with no rule line is exit 2 naming decide, nothing written; once decide runs, close writes', (t) => {
  const h = setup(t)
  const [wid] = ids(h, [['w', RULE, SHAPE]])
  const sp1 = fakeSpan(h, RID(1), ['a'])
  ok(h, watchArgs(sp1, ['a']))
  ok(h, ['close', '--span', sp1])
  // R2 sees W in b: the cycle {a, b} recurs, a rule item only in a Reflection that sights it
  const sp2 = fakeSpan(h, RID(2), ['b'])
  ok(h, watchArgs(sp2, ['b']))
  const before = bytes(reflectionsFile(h))
  const r = reflect(h, ['close', '--span', sp2])
  assert.equal(r.status, 2)
  assert.equal(r.stderr, `reflect: Reflection ${RID(2)} is not closed: Watch ${wid} recurs in this Reflection with no rule proposal line: run decide\n`)
  assert.deepEqual(bytes(reflectionsFile(h)), before, 'nothing written')
  assert.equal(reflect(h, ['close', '--span', sp2, '--dry-run']).status, 2, 'a dry run is refused alike')
  ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-17T09:00+10:00'])
  ok(h, ['close', '--span', sp2])
  const c = rlines(h).at(-1)
  assert.deepEqual([c.kind, c.id, c.counts.rules, c.quiet], ['reflection', RID(2), 1, false])
})

test('close: a span knob or a revert tune.py wrote with no knob line is exit 2 naming knobs; both missing steps named at once', (t) => {
  const h = setup(t)
  const [kid, kidRevert, wid] = ids(h, [['k', 'o/r', 'parallel_ceiling', 'slot-bound-raise', 1], ['k', 'o/r', 'max_review_rounds', 'revert:review-rounds-raise', -1],
    ['w', RULE, SHAPE]])
  const entries = { a: { window: { activeEnd: '2026-09-05T00:00:00.000Z' }, proposals: [{ key: 'parallel_ceiling', rule: 'slot-bound-raise', direction: 1, from: 3, to: 4, ranAt: 3, knob_key: kid }] } }
  const sp = fakeSpan(h, RID(1), ['a', 'b'], { entries, knobs: { revert: [], land: [], held: [{ id: kid, rollout: 'a', reason: 'agreement 1 of 3' }] } })
  fs.writeFileSync(tuningsFile(h), `${JSON.stringify({ v: 2, ts: '2026-09-08T01:00:00.000Z', host: 'h', rollout: 'a', task: null, kind: 'tuning', id: 't-rev', repo: 'o/r',
    window: { since: '2026-09-07T00:00:00.000Z', until: '2026-09-08T00:00:00.000Z' }, scores: {}, auto: true, reflection: RID(1), reverts: 't-old',
    applied: [{ key: 'max_review_rounds', from: 5, to: 4, ranAt: 5, rule: 'revert:review-rounds-raise', evidence: 'e', agreeing: 0 }] })}\n`)
  ok(h, watchArgs(sp, ['a', 'b']))
  const both = reflect(h, ['close', '--span', sp])
  assert.equal(both.status, 2)
  const knobsMsg = `knob ${[kid, kidRevert].sort().join(', ')} have no knob proposal line: run knobs`
  assert.equal(both.stderr, `reflect: Reflection ${RID(1)} is not closed: ${knobsMsg}; Watch ${wid} recurs in this Reflection with no rule proposal line: run decide\n`)
  ok(h, ['decide', '--span', sp, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00'])
  const one = reflect(h, ['close', '--span', sp])
  assert.equal(one.stderr, `reflect: Reflection ${RID(1)} is not closed: ${knobsMsg}\n`)
  assert.equal(rlines(h).filter((l) => l.kind === 'reflection').length, 0)
  ok(h, ['knobs', '--span', sp])
  ok(h, ['close', '--span', sp])
  const c = rlines(h).at(-1)
  assert.deepEqual([c.kind, c.counts.knobs, c.counts.landed, c.counts.reverted, c.counts.rules], ['reflection', 1, 0, 1, 1])
})

// ---- held trades (p22-7, ADR 0037 d1 and d5) ---------------------------------------------------------------------------------
// A knob held as Lachy's call (a trade or a caution) goes into the decision task once per (knob id, from); close refuses
// while one has no line there from this Reflection; a yes that cannot apply is answered moot.

const TRADE_KEY = ['k', 'o/r', 'max_plan_rounds', 'plan-rejected-raise', 1]
const TRADE_LEAD = 'Trades for Lachy (ADR 0037 d1: a knob that trades one headline against the other, or a caution, is his call; a yes runs the by-hand Reflection, a no is recorded when this task is done):'
const tradeProp = (kid, over = {}) => ({ key: 'max_plan_rounds', rule: 'plan-rejected-raise', direction: 1, from: 3, to: 4, ranAt: 3, knob_key: kid,
  evidence: 'e1', trade: { gains: ['handsOffRate'], costs: ['quality'] }, caution: null, ...over })
// A span whose one read rollout proposes `prop`, held in knobs with `reason`.
function tradeSpan(h, rid, kid, { prop, reason, until, rollout = 'b', rollouts = [rollout], entries = {} }) {
  return fakeSpan(h, rid, rollouts, { until, entries: { [rollout]: { window: { activeEnd: '2026-09-07T00:00:00.000Z' }, proposals: [prop] }, ...entries },
    knobs: { revert: [], land: [], held: [{ id: kid, rollout, reason }] } })
}
const tradeItem = (kid, reason, { from = 3, to = 4, rollout = 'b', caution = '' } = {}) =>
  `- trade ${kid} at ${from}: max_plan_rounds ${from} -> ${to} (plan-rejected-raise); ${reason}${caution ? `; caution ${caution}` : ''}; evidence e1; repo o/r; rollouts [[${rollout}]]; a yes runs /thread:reflect [[${rollout}]] and picks max_plan_rounds (plan-rejected-raise)`
const setStatus = (p, status) => fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\nstatus: \w+\n/, `\nstatus: ${status}\n`))
const notesOf = (text) => text.slice(text.indexOf('## Notes'), text.indexOf('## Launch'))

test('decide: a held trade alone writes the decision task with a trade item and no rule line; a re-run is byte-identical; a later week keeps it open once; a done task decides it; a new from is a new item; a dropped task decides nothing', (t) => {
  const h = setup(t)
  const [kid] = ids(h, [TRADE_KEY])
  const prop = tradeProp(kid)
  const reason = heldReason(h, prop)
  assert.equal(reason, 'a trade (gains handsOffRate, costs quality): Lachy decides')
  const dec = path.join(h.home, 'decisions.json')
  fs.writeFileSync(dec, '{}')
  const decide = (sp, now) => ok(h, ['decide', '--span', sp, '--decisions', dec, '--tasks-dir', h.tasks, '--now', now])
  // R1: the trade alone writes the task
  const sp1 = tradeSpan(h, RID(1), kid, { prop, reason })
  ok(h, ['knobs', '--span', sp1])
  assert.equal(decide(sp1, '2026-09-10T09:00+10:00').stdout, 'decision task thread-skill-decisions-2026-09-10: scheduled 2026-09-11 (new)\n')
  const p = path.join(h.tasks, 'thread-skill-decisions-2026-09-10.md')
  const first = fs.readFileSync(p, 'utf8')
  assert.ok(first.endsWith(`## Reflection ${RID(1)}\n\n${TRADE_LEAD}\n${tradeItem(kid, reason)}\n`), first)
  for (const not of ['- confirm ', 'Watches to confirm (', 'No new rule items', '\n## Still open\n']) assert.ok(!first.includes(not), not)
  assert.ok(notesOf(first).includes('held trades'), notesOf(first))
  assert.deepEqual(rlines(h).filter((l) => l.kind === 'proposal' && l.altitude === 'rule'), [], 'a trade writes no proposal line')
  decide(sp1, '2026-09-11T00:10+10:00')
  assert.equal(fs.readFileSync(p, 'utf8'), first, 'a re-run is byte-identical (its own section is skipped)')
  ok(h, ['close', '--span', sp1, '--tasks-dir', h.tasks])
  // R2: still open, listed once, a ## Still open line
  const sp2 = tradeSpan(h, RID(2), kid, { prop, reason, until: '2026-09-17T14:00:00.000Z' })
  ok(h, ['knobs', '--span', sp2])
  assert.equal(decide(sp2, '2026-09-17T23:50+10:00').stdout, 'decision task thread-skill-decisions-2026-09-10: scheduled 2026-09-18 (was 2026-09-11) (appended)\n')
  const second = fs.readFileSync(p, 'utf8')
  assert.ok(second.includes(`## Reflection ${RID(2)}\n\nNo new trades; still open: trade ${kid} at 3 (see ## Still open)\n`), second)
  assert.ok(second.includes(`## Still open\n\ntrade ${kid} at 3 still open 2026-09-18: Reflection ${RID(2)}, rollouts [[b]]\n`), second)
  assert.equal(second.split(`- trade ${kid} at 3: `).length, 2, 'listed once')
  decide(sp2, '2026-09-18T00:10+10:00')
  assert.equal(fs.readFileSync(p, 'utf8'), second, 'a Still open re-run is byte-identical')
  ok(h, ['close', '--span', sp2, '--tasks-dir', h.tasks])
  // R3: the task is done, so the trade at 3 is decided and never offered again
  setStatus(p, 'done')
  const files = listing(h.tasks)
  const doneSha = sha(p)
  const rb = bytes(reflectionsFile(h))
  const sp3 = tradeSpan(h, RID(3), kid, { prop, reason, until: '2026-09-24T14:00:00.000Z' })
  assert.equal(decide(sp3, '2026-09-24T09:00+10:00').stdout,
    `trade ${kid} at 3: decided in [[thread-skill-decisions-2026-09-10]]\nno rule proposal or held trade: no decision task\n`)
  assert.deepEqual([listing(h.tasks), sha(p), bytes(reflectionsFile(h))], [files, doneSha, rb], 'nothing written')
  // R4: the same knob at a new from is a new item
  const p4 = tradeProp(kid, { from: 4, to: 5, ranAt: 4 })
  const sp4 = tradeSpan(h, RID(4), kid, { prop: p4, reason, until: '2026-09-24T14:00:00.000Z' })
  assert.equal(decide(sp4, '2026-09-24T09:00+10:00').stdout, 'decision task thread-skill-decisions-2026-09-24: scheduled 2026-09-25 (new)\n')
  assert.ok(fs.readFileSync(path.join(h.tasks, 'thread-skill-decisions-2026-09-24.md'), 'utf8').includes(`${TRADE_LEAD}\n${tradeItem(kid, reason, { from: 4, to: 5 })}\n`))
  // a dropped task decides nothing: the trade is listed anew
  const h2 = setup(t)
  const d1 = tradeSpan(h2, RID(1), kid, { prop, reason })
  ok(h2, ['decide', '--span', d1, '--tasks-dir', h2.tasks, '--now', '2026-09-10T09:00+10:00'])
  setStatus(path.join(h2.tasks, 'thread-skill-decisions-2026-09-10.md'), 'dropped')
  const d2 = tradeSpan(h2, RID(2), kid, { prop, reason, until: '2026-09-17T14:00:00.000Z' })
  assert.equal(ok(h2, ['decide', '--span', d2, '--tasks-dir', h2.tasks, '--now', '2026-09-17T23:50+10:00']).stdout,
    'decision task thread-skill-decisions-2026-09-17: scheduled 2026-09-18 (new)\n')
  assert.ok(fs.readFileSync(path.join(h2.tasks, 'thread-skill-decisions-2026-09-17.md'), 'utf8').endsWith(`## Reflection ${RID(2)}\n\n${TRADE_LEAD}\n${tradeItem(kid, reason)}\n`))
})

test('decide: only the two Lachy-decides holds are listed: a caution with its text; agreement, partial-window and not-newest holds are not; an older rollout\'s trade names that rollout; a key this Reflection\'s revert moved waits', (t) => {
  const [kid] = ids(setup(t), [TRADE_KEY])
  const NOW = '2026-09-10T09:00+10:00'
  const task = (h) => fs.readFileSync(path.join(h.tasks, 'thread-skill-decisions-2026-09-10.md'), 'utf8')
  // a caution
  const h = setup(t)
  const caution = 'risks quality, breached (40 against 30): a Guardrail against a Guardrail, Lachy decides'
  const cprop = tradeProp(kid, { trade: null, caution })
  const creason = heldReason(h, cprop)
  assert.equal(creason, 'a caution: Lachy decides')
  ok(h, ['decide', '--span', tradeSpan(h, RID(1), kid, { prop: cprop, reason: creason }), '--tasks-dir', h.tasks, '--now', NOW])
  assert.ok(task(h).includes(`${TRADE_LEAD}\n${tradeItem(kid, creason, { caution })}\n`), task(h))
  // holds that are no trade: span gives `not the repo's newest rollout` only once auto_check passes, so a trade keeps
  // its own reason; decide reads the two Lachy-decides reasons alone
  for (const reason of ['agreement 1 of 3', 'partial window', 'not the repo\'s newest rollout ([[c]] is)']) {
    const hx = setup(t)
    const before = listing(hx.tasks)
    const r = ok(hx, ['decide', '--span', tradeSpan(hx, RID(1), kid, { prop: tradeProp(kid, { trade: null }), reason }), '--tasks-dir', hx.tasks, '--now', NOW])
    assert.equal(r.stdout, 'no rule proposal or held trade: no decision task\n', reason)
    assert.deepEqual(listing(hx.tasks), before, reason)
  }
  // a trade only the older rollout a proposes (the newer c proposes nothing for it) is offered on a
  const ho = setup(t)
  const prop = tradeProp(kid)
  const reason = heldReason(ho, prop)
  const older = fakeSpan(ho, RID(1), ['a', 'c'], {
    entries: { a: { window: { activeEnd: '2026-09-05T00:00:00.000Z' }, proposals: [prop] }, c: { window: { activeEnd: '2026-09-08T00:00:00.000Z' }, proposals: [] } },
    knobs: { revert: [], land: [], held: [{ id: kid, rollout: 'a', reason }] } })
  ok(ho, ['decide', '--span', older, '--tasks-dir', ho.tasks, '--now', NOW])
  assert.ok(task(ho).includes(tradeItem(kid, reason, { rollout: 'a' })), task(ho))
  // a revert of the same key this Reflection: the trade's from is stale, so it waits for the next reading
  const hr = setup(t)
  fs.writeFileSync(tuningsFile(hr), `${JSON.stringify({ v: 2, ts: '2026-09-08T01:00:00.000Z', host: 'h', rollout: 'b', task: null, kind: 'tuning', id: 't-rev', repo: 'o/r',
    window: { since: '2026-09-07T00:00:00.000Z', until: '2026-09-08T00:00:00.000Z' }, scores: {}, auto: true, reflection: RID(1), reverts: 't-old',
    applied: [{ key: 'max_plan_rounds', from: 4, to: 3, ranAt: 4, rule: 'revert:plan-rejected-raise', evidence: 'e', agreeing: 0 }] })}\n`)
  const sp = tradeSpan(hr, RID(1), kid, { prop, reason })
  const before = listing(hr.tasks)
  assert.equal(ok(hr, ['decide', '--span', sp, '--tasks-dir', hr.tasks, '--now', NOW]).stdout,
    `trade ${kid} at 3: a revert of max_plan_rounds comes first this Reflection\nno rule proposal or held trade: no decision task\n`)
  assert.deepEqual(listing(hr.tasks), before)
  ok(hr, ['knobs', '--span', sp])
  ok(hr, ['close', '--span', sp, '--tasks-dir', path.join(hr.home, 'no-such-dir')]) // close checks no skipped trade, so reads no vault
})

test('decide: a trade beside a rule item gives the rule item, the confirm block, then the trade block; close\'s decisionTask is the rule line\'s', (t) => {
  const h = setup(t)
  const [kid] = ids(h, [TRADE_KEY])
  const [wid, one] = ids(h, [['w', RULE, SHAPE], ['w', 'grill-fit § How a fork comes back', 'a fork routed no gate']])
  const prop = tradeProp(kid)
  const reason = heldReason(h, prop)
  const sp = tradeSpan(h, RID(1), kid, { prop, reason, rollouts: ['a', 'b'] })
  twoWatches(h, RID(1), sp)
  ok(h, ['decide', '--span', sp, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00'])
  const text = fs.readFileSync(path.join(h.tasks, 'thread-skill-decisions-2026-09-10.md'), 'utf8')
  assert.equal(text.slice(text.indexOf(`## Reflection ${RID(1)}`)), [`## Reflection ${RID(1)}`, '',
    `- ${wid}: rule ${RULE}; shape ${SHAPE}; rollouts [[a]], [[b]]; why not given; amends not given`, '',
    'Watches to confirm (one rollout each; a yes files the rule\'s grill, a no records the decline):',
    `- confirm ${one}: rule grill-fit § How a fork comes back; shape a fork routed no gate; rollout [[a]]`, '',
    TRADE_LEAD, tradeItem(kid, reason), ''].join('\n'))
  ok(h, ['knobs', '--span', sp])
  ok(h, ['close', '--span', sp, '--tasks-dir', h.tasks])
  const c = rlines(h).at(-1)
  assert.deepEqual([c.kind, c.counts.rules, c.decisionTask], ['reflection', 1, 'thread-skill-decisions-2026-09-10'])
})

test('decide: with no recurring Watch, a decisions.json of {} prints the no-task line and writes nothing; close then closes', (t) => {
  const h = setup(t)
  const sp = fakeSpan(h, RID(1), ['a', 'b'])
  ok(h, watchArgs(sp, ['a']))
  const dec = path.join(h.out, 'decisions.json')
  fs.writeFileSync(dec, '{}')
  const files = listing(h.tasks)
  const before = bytes(reflectionsFile(h))
  assert.equal(ok(h, ['decide', '--span', sp, '--decisions', dec, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00']).stdout,
    'no rule proposal or held trade: no decision task\n')
  assert.deepEqual([listing(h.tasks), bytes(reflectionsFile(h))], [files, before], 'nothing written')
  ok(h, ['close', '--span', sp])
  const c = rlines(h).at(-1)
  assert.deepEqual([c.kind, c.counts.rules, c.counts.sightings, 'decisionTask' in c], ['reflection', 0, 1, false])
})

test('close: a held trade with no decision task line from this Reflection is exit 2 naming decide, nothing written; after decide, close writes decisionTask', (t) => {
  const h = setup(t)
  const [kid] = ids(h, [TRADE_KEY])
  const prop = tradeProp(kid)
  const reason = heldReason(h, prop)
  const close = (hh, sp, extra = []) => reflect(hh, ['close', '--span', sp, '--tasks-dir', hh.tasks, ...extra])
  const refusal = (rid) => `reflect: Reflection ${rid} is not closed: held trade ${kid} at 3 has no decision task line from this Reflection: run decide\n`
  const sp1 = tradeSpan(h, RID(1), kid, { prop, reason })
  ok(h, ['knobs', '--span', sp1])
  const before = bytes(reflectionsFile(h))
  const r = close(h, sp1)
  assert.deepEqual([r.status, r.stderr], [2, refusal(RID(1))])
  assert.deepEqual(bytes(reflectionsFile(h)), before, 'nothing written')
  assert.deepEqual([close(h, sp1, ['--dry-run']).status, bytes(reflectionsFile(h))], [2, before], 'a dry run is refused alike')
  ok(h, ['decide', '--span', sp1, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00'])
  assert.equal(close(h, sp1).status, 0)
  const c1 = rlines(h).at(-1)
  assert.deepEqual([c1.kind, c1.quiet, c1.counts.rules, c1.decisionTask], ['reflection', true, 0, 'thread-skill-decisions-2026-09-10'], 'a trade leaves the week quiet')
  // R2: still open; refused before decide, then its Still open line in the R1 task names this Reflection
  const sp2 = tradeSpan(h, RID(2), kid, { prop, reason, until: '2026-09-17T14:00:00.000Z' })
  ok(h, ['knobs', '--span', sp2])
  assert.deepEqual([close(h, sp2).stderr], [refusal(RID(2))])
  ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-17T23:50+10:00'])
  assert.equal(close(h, sp2).status, 0)
  assert.equal(rlines(h).at(-1).decisionTask, 'thread-skill-decisions-2026-09-10')
  // R3: the task is done, so close needs no decide, and names no task
  setStatus(path.join(h.tasks, 'thread-skill-decisions-2026-09-10.md'), 'done')
  const sp3 = tradeSpan(h, RID(3), kid, { prop, reason, until: '2026-09-24T14:00:00.000Z' })
  ok(h, ['knobs', '--span', sp3])
  assert.equal(close(h, sp3).status, 0, 'decided')
  assert.ok(!('decisionTask' in rlines(h).at(-1)))
  // a trade listed only in a dropped task is refused until decide lists it anew
  const h2 = setup(t)
  const d1 = tradeSpan(h2, RID(1), kid, { prop, reason })
  ok(h2, ['decide', '--span', d1, '--tasks-dir', h2.tasks, '--now', '2026-09-10T09:00+10:00'])
  setStatus(path.join(h2.tasks, 'thread-skill-decisions-2026-09-10.md'), 'dropped')
  ok(h2, ['knobs', '--span', d1])
  assert.deepEqual([close(h2, d1).status, close(h2, d1).stderr], [2, refusal(RID(1))], 'a dropped task\'s listing does not count')
  ok(h2, ['decide', '--span', d1, '--tasks-dir', h2.tasks, '--now', '2026-09-10T10:00+10:00'])
  assert.equal(close(h2, d1).status, 0)
  assert.equal(rlines(h2).at(-1).decisionTask, 'thread-skill-decisions-2026-09-10-2')
  // a held trade and no tasks dir: exit 1
  const h3 = setup(t)
  const d3 = tradeSpan(h3, RID(1), kid, { prop, reason })
  ok(h3, ['knobs', '--span', d3])
  const x = reflect(h3, ['close', '--span', d3, '--tasks-dir', path.join(h3.home, 'nope')])
  assert.equal(x.status, 1)
  assert.match(x.stderr, /--tasks-dir \S+nope is not a directory/)
})

test('moot: a yes that cannot apply is recorded under its section; the task can be done; the trade is offered again at the same from; a repeat exists; done, unknown or empty targets are exit 2', (t) => {
  const h = setup(t)
  const [kid] = ids(h, [TRADE_KEY])
  const prop = tradeProp(kid)
  const reason = heldReason(h, prop)
  const slug = 'thread-skill-decisions-2026-09-10'
  const p = path.join(h.tasks, `${slug}.md`)
  const mootArgs = ({ task = slug, trade = kid, from = 3, why = 'tune.py: from 3 is stale', now = '2026-09-11T08:00+10:00' } = {}) =>
    ['moot', '--task', task, '--trade', trade, '--from', String(from), '--why', why, '--tasks-dir', h.tasks, '--now', now]
  ok(h, ['decide', '--span', tradeSpan(h, RID(1), kid, { prop, reason }), '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00'])
  const pre = fs.readFileSync(p, 'utf8')
  const dry = ok(h, [...mootArgs(), '--dry-run'])
  assert.match(dry.stdout, new RegExp(`^dry run, nothing written: moot trade ${kid} at 3 in \\[\\[${slug}\\]\\]`, 'm'))
  assert.equal(fs.readFileSync(p, 'utf8'), pre, '--dry-run writes nothing')
  assert.equal(ok(h, mootArgs()).stdout, `moot trade ${kid} at 3 in [[${slug}]] (## Reflection ${RID(1)})\n`)
  const text = fs.readFileSync(p, 'utf8')
  assert.equal(text, `${pre.trimEnd()}\nmoot ${kid} at 3 2026-09-11: tune.py: from 3 is stale\n`, 'the R1 section ends with the moot line')
  assert.equal(ok(h, mootArgs()).stdout, `exists moot ${kid} at 3 in [[${slug}]]\n`)
  assert.equal(fs.readFileSync(p, 'utf8'), text, 'a repeat is byte-identical')
  taskNote(h, 'plain-task', { tags: '[task, ai]' })
  for (const [over, re] of [[{ trade: 'deadbeef' }, `\\[\\[${slug}\\]\\] lists no trade deadbeef at 3`], [{ from: 4 }, `lists no trade ${kid} at 4`],
    [{ why: '  ' }, '--why'], [{ task: 'plain-task' }, 'decisions'], [{ task: 'thread-skill-decisions-2099-01-01' }, 'no note']]) {
    const x = reflect(h, mootArgs(over))
    assert.equal(x.status, 2, JSON.stringify(over))
    assert.match(x.stderr, new RegExp(re), JSON.stringify(over))
    assert.equal(fs.readFileSync(p, 'utf8'), text, JSON.stringify(over))
  }
  // R2, the same trade at 3: the moot item decides nothing, so the open task lists it anew under R2
  const sp2 = tradeSpan(h, RID(2), kid, { prop, reason, until: '2026-09-17T14:00:00.000Z' })
  ok(h, ['knobs', '--span', sp2])
  ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-17T23:50+10:00'])
  const t2 = fs.readFileSync(p, 'utf8')
  assert.ok(t2.endsWith(`## Reflection ${RID(2)}\n\n${TRADE_LEAD}\n${tradeItem(kid, reason)}\n`), t2)
  assert.ok(!t2.includes('\n## Still open\n'), 'a new item, not a Still open line')
  ok(h, ['close', '--span', sp2, '--tasks-dir', h.tasks])
  // the next moot goes to the last section without one; with both moot the done task decides nothing
  assert.equal(ok(h, mootArgs({ why: 'the fresh score\nno longer proposes it', now: '2026-09-18T08:00+10:00' })).stdout,
    `moot trade ${kid} at 3 in [[${slug}]] (## Reflection ${RID(2)})\n`)
  assert.ok(fs.readFileSync(p, 'utf8').endsWith(`\nmoot ${kid} at 3 2026-09-18: the fresh score no longer proposes it\n`))
  setStatus(p, 'done')
  const sp3 = tradeSpan(h, RID(3), kid, { prop, reason, until: '2026-09-24T14:00:00.000Z' })
  assert.equal(ok(h, ['decide', '--span', sp3, '--tasks-dir', h.tasks, '--now', '2026-09-24T09:00+10:00']).stdout,
    'decision task thread-skill-decisions-2026-09-24: scheduled 2026-09-25 (new)\n', 'offered again at the same from')
  assert.ok(fs.readFileSync(path.join(h.tasks, 'thread-skill-decisions-2026-09-24.md'), 'utf8').includes(tradeItem(kid, reason)))
  const dn = reflect(h, mootArgs())
  assert.equal(dn.status, 2)
  assert.match(dn.stderr, new RegExp(`${slug} is done: a done task is never written`))
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
  ok(h, ['ledger', '--span', out]) // p29-11: step 13a, before tune.py and knobs
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
  assert.equal(ok(h2, ['decide', '--span', sp, '--tasks-dir', h2.tasks]).stdout, 'no rule proposal or held trade: no decision task\n')
})

// ---- span over a serial chain (p27-2, ADR 0040) -------------------------------------------------------------------
// A `shape: serial` note is scored through serial-score.py (no fold, no settings, no score.py), never a knob
// candidate, and its friction comes from leg.py status beside the record's acts; a parallel rollout in the same window
// is read as before (the control). The Leg log is written in leg.py's line forms, its stamps in Melbourne's +11:00.

const CAT = (hm) => `2026-10-12T${hm}+11:00`
const CZ = (hm) => new Date(CAT(hm)).toISOString()

// A serial note and its task notes under h.tasks: its Queue (one row per slug) and its Leg log.
function serialNote(h, slug, rows, log, { archived = false } = {}) {
  const queue = rows.map((s, i) => `| ${i + 1} | [[${s}\\|${s}]] | \`cc-demo\` from \`/work\` | \`ext:x\` |`)
  const p = path.join(archived ? path.join(h.tasks, 'Archive', 'Rollouts') : h.tasks, `${slug}.md`)
  fs.writeFileSync(p, ['---', 'tags:', '  - task', '  - rollout', 'status: open', 'priority: high', 'projects:', '  - "[[Demo]]"',
    'captured: 2026-10-12', 'protocol_version: 5', 'shape: serial', 'surfaces:', '  - "ext:x"', '---', '', '## Notes', '',
    'Serial-rollout plan.', '', '## Queue', '', '| # | Task | Launch | Surfaces |', '|---|---|---|---|', ...queue, '',
    '## Post-rollout', '', 'Rollout-specific items go here:', '', '## Leg log', '', ...log, ''].join('\n'))
  return p
}
function chainTask(h, rollout, slug, extra = []) {
  fs.writeFileSync(path.join(h.tasks, `${slug}.md`), ['---', 'tags: [task]', 'status: done', 'captured: 2026-10-12', 'projects:',
    '  - "[[Demo]]"', `rollout: "[[${rollout}]]"`, ...extra, '---', '', '## Notes', '', `Do ${slug}.`, ''].join('\n'))
}

// chain-a: c2 set aside (blocked) and picked up by Leg 2 with no act; c4 set aside at a gate and signed in the record;
// Leg 1 halts holding c3, the halt is cleared, repair restarts Leg 2 (repair § 7 (e)'s two lines: step 2's pending,
// step 3's started), Leg 2 takes c3 over; c1's smoke fails and its fix names c1 in fixes:, an Escape captured in the
// window.
const CHAIN_A = [
  `- ${CAT('10:00')} Leg 1 began: leg-1 session s1 in cc-demo from /work`,
  `- ${CAT('10:05')} Leg 1 claimed [[c1]]`, `- ${CAT('10:20')} Leg 1 done [[c1]] (verify pass)`,
  `- ${CAT('10:21')} Leg 1 claimed [[c2]]`, `- ${CAT('10:30')} Leg 1 set aside [[c2]] (blocked): needs a hand`,
  `- ${CAT('10:31')} Leg 1 claimed [[c4]]`, `- ${CAT('10:33')} Leg 1 set aside [[c4]] (gate-pending): a spend gate`,
  `- ${CAT('10:34')} Leg 1 claimed [[c3]]`, `- ${CAT('10:40')} Leg 1 closed: halted: a revert conflict`,
  `- ${CAT('10:45')} halt cleared: resolved by hand`,
  `- ${CAT('10:49')} restart: Leg 2 pending (session r1)`,
  `- ${CAT('10:50')} restart: Leg 2 started s2`,
  `- ${CAT('11:00')} Leg 2 began: leg-2 session s2 in cc-demo from /work`,
  `- ${CAT('11:01')} Leg 2 took [[c3]] (inherited from Leg 1)`, `- ${CAT('11:20')} Leg 2 done [[c3]] (verify pass)`,
  `- ${CAT('11:21')} Leg 2 claimed [[c2]]`, `- ${CAT('11:40')} Leg 2 done [[c2]] (verify pass)`,
  `- ${CAT('11:41')} Leg 2 claimed [[c4]]`, `- ${CAT('11:50')} Leg 2 done [[c4]] (verify pass)`,
  `- ${CAT('11:51')} Leg 2 smoke: [[c1]] fail: a.txt is wrong`,
  `- ${CAT('11:52')} Leg 2 filed [[c1-fix]] (verifies [[c1]]; cause own)`,
  `- ${CAT('11:53')} Leg 2 claimed [[c1-fix]]`, `- ${CAT('11:59')} Leg 2 done [[c1-fix]] (verify pass)`,
]
function chainA(h) {
  const rows = ['c1', 'c2', 'c4', 'c3', 'c1-fix']
  for (const s of rows) chainTask(h, 'chain-a', s, s === 'c1-fix' ? ['verifies: "[[c1]]"', 'fixes: "[[c1]]"'] : [])
  emitAll(h, 'chain-a', [[CZ('10:55'), 'gate-signed', 'c4', { standing: false, gates: 1 }]])
  return serialNote(h, 'chain-a', rows, CHAIN_A)
}

test('span scores a serial chain through serial-score.py (no fold, settings or score.py) and a parallel rollout as before', (t) => {
  const h = setup(t)
  fs.writeFileSync(path.join(h.home, 'rollouts.toml'), '[defaults]\nparallel_ceiling = 3\n') // span's --config
  emitAll(h, 'week-p', saturated('p', 10, 3))
  rolloutNote(h, 'week-p')
  chainA(h)
  const s = span(h, ['--fold'], { since: KSINCE, until: KUNTIL })
  assert.deepEqual(s.rollouts.map((r) => [r.rollout, r.mode, r.shape]), [['chain-a', 'read', 'serial'], ['week-p', 'read', 'parallel']])
  const c = entryOf(s, 'chain-a')
  const sc = JSON.parse(fs.readFileSync(c.score, 'utf8'))
  assert.equal(sc.shape, 'serial', 'serial-score.py wrote the score')
  assert.ok(!('guardrails' in sc) && !('load' in sc), 'no score.py output for the chain')
  assert.equal(c.settingsFile, undefined, 'no settings resolve')
  assert.ok(!fs.existsSync(path.join(h.out, 'chain-a.settings.json')))
  assert.deepEqual([c.root, c.repo, c.binding, c.proposals, c.breached], [null, null, null, [], []])
  assert.ok(c.flags.some((f) => f.startsWith('a serial chain (ADR 0040): scored by serial-score.py')), c.flags.join('\n'))
  assert.ok(!c.flags.some((f) => /fold-journals|score\.py exited|rollout-settings|Project root/.test(f)), c.flags.join('\n'))
  assert.equal(c.chain, sc.chain)
  assert.equal(sc.handsOff.notCounted.restarts, 1, 'serial-score folds repair § 7\'s two lines into one restart, as span does')
  assert.deepEqual([c.headline.handsOffRate, c.headline.quality, c.headline.reviewChurn], [0.6, 0.8, null],
    'c4 signed and c3 behind a cleared halt: 3 of 5 hands-off; one Escape (c1) of five')
  assert.equal(c.headline.throughput, sc.headline.throughput)
  // the parallel control: settings, score.py, and a knob candidate
  const p = entryOf(s, 'week-p')
  assert.ok(p.settingsFile && fs.existsSync(p.settingsFile))
  const psc = JSON.parse(fs.readFileSync(p.score, 'utf8'))
  assert.ok('guardrails' in psc && psc.shape !== 'serial', 'score.py scored the parallel rollout')
  assert.ok(p.proposals.length > 0 && p.proposals.every((q) => typeof q.knob_key === 'string'))
  const named = [...s.knobs.land, ...s.knobs.held, ...s.knobs.revert].map((k) => k.rollout)
  assert.ok(named.includes('week-p'), JSON.stringify(s.knobs))
  assert.ok(!named.includes('chain-a'), 'a serial chain is never a knob candidate')
})

test('span reads a chain\'s friction from leg.py status: set-asides, a halt clear as an ask, a restart, its fixes: Escape', (t) => {
  const h = setup(t)
  chainA(h)
  const c = entryOf(span(h, [], { since: KSINCE, until: KUNTIL }), 'chain-a')
  const by = (k) => c.friction.filter((x) => x.kind === k)
  const asides = Object.fromEntries(by('set-aside').map((x) => [x.task, x]))
  assert.deepEqual(Object.keys(asides).sort(), ['c2', 'c4'])
  assert.deepEqual([asides.c2.at, asides.c2.leg, asides.c2.stage, asides.c2.status, asides.c2.movedBy, asides.c2.mover],
    [CZ('10:30'), 1, 'block', 'blocked', 'unrecorded', { kind: 'claimed', at: CZ('11:21'), leg: 2 }])
  assert.deepEqual(asides.c2.explainedIn, [], 'its note holds no ## Needs you or ## Integration log')
  assert.equal(asides.c2.taskNote, path.join(h.tasks, 'c2.md'))
  assert.deepEqual([asides.c4.stage, asides.c4.movedBy, asides.c4.mover], ['gate', 'gate-signed', null])
  const asks = by('ask').map((x) => [x.act, x.task, x.at])
  assert.deepEqual(asks.sort(), [['haltCleared', 'c3', CZ('10:45')], ['signOff', 'c4', CZ('10:55')]].sort())
  const cleared = by('ask').find((x) => x.act === 'haltCleared')
  assert.match(cleared.detail, /^Leg 1's halt cleared: resolved by hand$/)
  assert.equal(cleared.halted, 'a revert conflict', 'the halted Leg\'s own close reason, where the trace starts')
  assert.equal(by('ask').find((x) => x.act === 'signOff').halted, undefined, 'a record ask carries no halted')
  assert.deepEqual(by('restart').map((x) => [x.leg, x.how, x.started, x.manual, x.session, x.began, x.at]),
    [[2, 'started', 's2', null, 'r1', CZ('11:00'), CZ('10:49')]], 'one restart for its pending and started lines, at the pending one')
  assert.deepEqual(by('escape').map((x) => [x.task, x.source, x.at, x.inWindow]), [['c1', 'fixes', '2026-10-12', true]])
})

test('span reads a hands-off chain with no Run record through its Leg log; one whose log is outside the window is not read', (t) => {
  const h = setup(t)
  chainTask(h, 'chain-b', 'b1')
  serialNote(h, 'chain-b', ['b1'], [`- ${CAT('09:00')} Leg 1 began: leg-1 session s1 in cc-demo from /work`,
    `- ${CAT('09:05')} Leg 1 claimed [[b1]]`, `- ${CAT('09:30')} Leg 1 done [[b1]] (verify pass)`], { archived: true })
  chainTask(h, 'chain-old', 'o1')
  serialNote(h, 'chain-old', ['o1'], [`- 2026-09-01T09:00+10:00 Leg 1 began: leg-1 session s1 in cc-demo from /work`,
    `- 2026-09-01T09:05+10:00 Leg 1 claimed [[o1]]`, `- 2026-09-01T09:30+10:00 Leg 1 done [[o1]] (verify pass)`])
  const s = span(h, [], { since: KSINCE, until: KUNTIL })
  assert.deepEqual(s.rollouts.map((r) => [r.rollout, r.mode, r.shape]), [['chain-b', 'read', 'serial']])
  const b = entryOf(s, 'chain-b')
  assert.equal(b.note, path.join(h.tasks, 'Archive', 'Rollouts', 'chain-b.md'))
  assert.deepEqual([b.headline.handsOffRate, b.friction], [1, []])
  assert.equal(JSON.parse(fs.readFileSync(b.score, 'utf8')).merges.count, 1)
})

test('a chain set-aside\'s act counts through the minute of the Leg-log pick-up that follows it, and no later', (t) => {
  // A Leg-log stamp is a minute floor and a record act is ms, so a sign-off 20 s into the minute its re-claim is
  // stamped in came first (legs.md: approve-gates, then the claim): it moved the task, not the claim. An act a full
  // minute after the pick-up came after it, so the pick-up moved the task with no act before it.
  const h = setup(t)
  for (const s of ['g1', 'g2']) chainTask(h, 'chain-c', s)
  serialNote(h, 'chain-c', ['g1', 'g2'], [
    `- ${CAT('10:00')} Leg 1 began: leg-1 session s1 in cc-demo from /work`,
    `- ${CAT('10:01')} Leg 1 claimed [[g1]]`, `- ${CAT('10:02')} Leg 1 set aside [[g1]] (gate-pending): a spend gate`,
    `- ${CAT('10:03')} Leg 1 claimed [[g1]]`, `- ${CAT('10:10')} Leg 1 done [[g1]] (verify pass)`,
    `- ${CAT('10:11')} Leg 1 claimed [[g2]]`, `- ${CAT('10:12')} Leg 1 set aside [[g2]] (gate-pending): a spend gate`,
    `- ${CAT('10:13')} Leg 1 claimed [[g2]]`, `- ${CAT('10:20')} Leg 1 done [[g2]] (verify pass)`,
  ])
  const at = (hms) => new Date(`2026-10-12T${hms}+11:00`).toISOString()
  emitAll(h, 'chain-c', [[at('10:03:20'), 'gate-signed', 'g1', { standing: true, gates: 1 }],
    [at('10:14:05'), 'gate-signed', 'g2', { standing: true, gates: 1 }]])
  const c = entryOf(span(h, [], { since: KSINCE, until: KUNTIL }), 'chain-c')
  const asides = Object.fromEntries(c.friction.filter((x) => x.kind === 'set-aside').map((x) => [x.task, x]))
  assert.deepEqual([asides.g1.movedBy, asides.g1.mover], ['gate-signed (standing)', null])
  assert.deepEqual([asides.g2.movedBy, asides.g2.mover], ['unrecorded', { kind: 'claimed', at: CZ('10:13'), leg: 1 }])
})

test('a chain\'s restarts fold per restart: a lone pending reads pending, a --replace re-mark is a second restart, serial-score counts them alike', (t) => {
  // repair § 7 (e) writes step 2's `pending` line, then step 3's `started` or step 4's `manual`: one restart. A pending
  // with nothing after it is a restart marked and never started; a `--replace` re-mark (after a pending, or after an
  // answered restart whose Session died before `begin`) is a restart of its own. Only the restart standing when the Leg
  // began carries `began`.
  const h = setup(t)
  chainTask(h, 'chain-d', 'd1')
  serialNote(h, 'chain-d', ['d1'], [
    `- ${CAT('10:00')} Leg 1 began: leg-1 session s1 in cc-demo from /work`,
    `- ${CAT('10:01')} Leg 1 claimed [[d1]]`, `- ${CAT('10:05')} Leg 1 done [[d1]] (verify pass)`,
    `- ${CAT('10:06')} Leg 1 closed: stopped: out of time`,
    `- ${CAT('10:10')} restart: Leg 2 pending (session r9)`,
  ])
  for (const s of ['e1', 'e2']) chainTask(h, 'chain-e', s)
  serialNote(h, 'chain-e', ['e1', 'e2'], [
    `- ${CAT('10:00')} Leg 1 began: leg-1 session s1 in cc-demo from /work`,
    `- ${CAT('10:01')} Leg 1 claimed [[e1]]`, `- ${CAT('10:05')} Leg 1 done [[e1]] (verify pass)`,
    `- ${CAT('10:06')} Leg 1 closed: stopped: out of time`,
    `- ${CAT('10:10')} restart: Leg 2 pending (session r1)`, `- ${CAT('10:11')} restart: Leg 2 started s2`,
    `- ${CAT('10:30')} restart: Leg 2 pending (session r2)`,
    `- ${CAT('10:35')} restart: Leg 2 pending (session r3)`, `- ${CAT('10:36')} restart: Leg 2 manual (no host tool)`,
    `- ${CAT('10:40')} Leg 2 began: leg-2 session s4 in cc-demo from /work`,
    `- ${CAT('10:41')} Leg 2 claimed [[e2]]`, `- ${CAT('10:50')} Leg 2 done [[e2]] (verify pass)`,
  ])
  const s = span(h, [], { since: KSINCE, until: KUNTIL })
  const restarts = (slug) => entryOf(s, slug).friction.filter((x) => x.kind === 'restart')
    .map((x) => [x.leg, x.how, x.started, x.manual, x.session, x.began, x.at])
  const counted = (slug) => JSON.parse(fs.readFileSync(entryOf(s, slug).score, 'utf8')).handsOff.notCounted.restarts
  assert.deepEqual(restarts('chain-d'), [[2, 'pending', null, null, 'r9', null, CZ('10:10')]],
    'a lone pending is one restart, marked and never started')
  assert.equal(counted('chain-d'), 1)
  assert.deepEqual(restarts('chain-e'), [
    [2, 'started', 's2', null, 'r1', null, CZ('10:10')],
    [2, 'pending', null, null, 'r2', null, CZ('10:30')],
    [2, 'manual', null, 'no host tool', 'r3', CZ('10:40'), CZ('10:35')],
  ], 'each re-mark is a restart of its own; only the last one started the Leg')
  assert.equal(counted('chain-e'), 3, 'serial-score counts the folded restarts, never the six lines')
})

test('a chain restart is read as the Leg log stood at until, and its pending line decides its window', (t) => {
  // chain-a's restart: pending at 10:49, started at 10:50, Leg 2 began at 11:00.
  const h = setup(t)
  chainA(h)
  const at = (until, since = KSINCE) => entryOf(span(h, [], { since, until }), 'chain-a').friction
    .filter((x) => x.kind === 'restart').map((x) => [x.how, x.started, x.began, x.at])
  assert.deepEqual(at(CAT('10:49')), [['pending', null, null, CZ('10:49')]], 'a reading before step 3 sees it pending')
  assert.deepEqual(at(KUNTIL, CAT('10:50')), [], 'its started line is in the window, its pending line is not: last week\'s')
})

test('a chain read through an early record line keeps leg.py status\'s chain state when serial-score.py exits non-zero', (t) => {
  // The record has a line in the window, the Leg log only after until: serial-score.py's --until is before Leg 1 began
  // (exit 2), so there is no score, and chain falls back to the status read the friction uses.
  const h = setup(t)
  chainTask(h, 'chain-g', 'g1')
  emitAll(h, 'chain-g', [[CZ('10:55'), 'answer-recorded', 'g1', { answerKind: 'decision', form: 'hand-back' }]])
  serialNote(h, 'chain-g', ['g1'], [`- 2026-10-16T09:00+11:00 Leg 1 began: leg-1 session s1 in cc-demo from /work`,
    `- 2026-10-16T09:05+11:00 Leg 1 claimed [[g1]]`])
  const g = entryOf(span(h, [], { since: KSINCE, until: KUNTIL }), 'chain-g')
  assert.equal(g.shape, 'serial')
  assert.equal(g.score, null, 'no score')
  assert.ok(g.flags.some((f) => /^serial-score\.py exited 2: /.test(f)), g.flags.join('\n'))
  assert.equal(g.chain, 'live', 'the leg.py status read\'s chain state')
  assert.deepEqual(g.friction.filter((x) => x.kind === 'ask').map((x) => [x.act, x.task]), [['answer', 'g1']])
})
