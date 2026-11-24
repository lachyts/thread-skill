// skills/reflect/scripts/reflect.py — the weekly reading's script half (p21-7, ADR 0037 d3-d5), part 1 of 4: span
// reads every rollout with a line in the window (score.py per rollout, the friction, the Escapes sweep over every
// record, the knob candidates, and the Grade log joined to outcomes through grades.py, whose own suite is
// tests/reflect-grades.test.mjs), and window_flags holds each block to its window. The writers (watch, raised, bug,
// knobs, decide, close and moot) write reflections.jsonl (and the bug and decision tasks) and rung reads the ladder,
// in the other three parts. Every rule lives in reflect.py's docstring and run_record.py's; this pins the behaviour.
// tests/lib/reflect-weekly-fixtures.mjs holds the fixtures the parts share, and says how each case stays hermetic
// and what each part pins.
// Reach (tests/fast-tier.map): each part names every script the unsplit file named, so each runs on the changes it
// did: arms.py attention.py gated_inputs.py grades.py land.sh lead-integrate.py ledger.py leg.py reflect.py
// rollout-settings.py run_record.py score.py serial-score.py tune.py vault-note-overlap.py.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { root, REFLECT, REAL_GIT, setup, git, reflect, ok, reflectionsFile, tuningsFile, rlines, sha, listing, emitAll,
  rolloutNote, taskNote, life, byTs, SINCE, UNTIL, W, span, entryOf, RID, pyOut, KSINCE, KUNTIL,
  saturated } from './lib/reflect-weekly-fixtures.mjs'

// The settings file span hands score.py is rollout-settings.py's CLI JSON, resolve()'s object as the CLI prints it. A
// retired [notify] (ADR 0075 d2) is named in `retired`, never read, so its topic reaches no settings file.
test('span writes each settings file as the CLI prints it: a retired [notify] named, never read, its topic nowhere', (t) => {
  const h = setup(t)
  fs.writeFileSync(path.join(h.home, 'rollouts.toml'), '[defaults]\nparallel_ceiling = 3\n\n[notify]\nntfy_topic = "span-topic-7"\n')
  emitAll(h, 'week-a', saturated('a', 10, 3))
  rolloutNote(h, 'week-a')
  const e = entryOf(span(h, [], { since: KSINCE, until: KUNTIL }), 'week-a')
  const text = fs.readFileSync(e.settingsFile, 'utf8')
  assert.deepEqual(JSON.parse(text).retired, ['notify'])
  assert.ok(!('notify' in JSON.parse(text)), 'no notify key')
  assert.equal(JSON.parse(text).settings.parallel_ceiling.value, 3, 'the rest is resolve()\'s, unchanged')
  assert.ok(!text.includes('span-topic-7'), 'the topic is in no settings file')
})

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

// ---- the Note overlaps (ADR 0067 d6): overlaps.jsonl, hooks/vault-note-overlap.py its one writer --------------------

const overlapsFile = (h) => path.join(h.ev, 'overlaps.jsonl')
// One note-overlap line: [ts, editing rollout, editing task, note, holder rollout, holder task]
const overlap = ([ts, r, task, note, hr, ht]) => [ts, 'note-overlap', task, { note, holderRollout: hr, holderTask: ht, tool: 'Edit', via: 'agent' }, r]
const DAYN = 'Days/2026/2026-09/2026-W36/2026-09-04 Fri.md'
const OVERLAP_CANNOT = ["a script's or shell write, or a Codex Leg's, passes no hook: no Note overlap from it is seen",
  "two tasks of one rollout in one note are not warned (another run is another rollout), nor is an edit by a session that is no run's task (an interactive session, a lead's own thread, a subagent a task agent spawns)"]

test('span: noteOverlaps counts the window\'s warnings by (note, run pair), names the notes and rollouts, and is never a rollout', (t) => {
  const h = setup(t)
  emitAll(h, null, [
    overlap([W(4, '01:00'), 'rb', 'b1', DAYN, 'ra', 'a1']),
    overlap([W(4, '03:00'), 'rb', 'b1', DAYN, 'ra', 'a1']),
    overlap([W(5, '02:00'), 'ra', 'a1', DAYN, 'rb', 'b1']),   // the same pair, the other way round: one overlap
    overlap([W(6, '02:00'), 'rc', 'c1', 'Notes/Shared.md', 'ra', 'a2']),
    overlap(['2026-09-01T00:00:00Z', 'rb', 'b1', 'Notes/Old.md', 'ra', 'a1']),   // before the window
    overlap(['2026-09-12T00:00:00Z', 'rb', 'b1', 'Notes/Late.md', 'ra', 'a1']),  // after it
  ])
  assert.deepEqual(fs.readdirSync(h.ev), ['overlaps.jsonl'], 'the lines sit in the reserved file alone')
  const s = span(h)
  const o = s.noteOverlaps
  assert.equal(o.warnings, 4)
  assert.equal(o.none, false)
  assert.deepEqual(o.overlaps.map((x) => [x.note, x.runs.map((r) => `${r.rollout}/${r.task}`), x.warnings, x.first, x.last]), [
    [DAYN, ['ra/a1', 'rb/b1'], 3, '2026-09-04T01:00:00.000Z', '2026-09-05T02:00:00.000Z'],
    ['Notes/Shared.md', ['ra/a2', 'rc/c1'], 1, '2026-09-06T02:00:00.000Z', '2026-09-06T02:00:00.000Z'],
  ])
  assert.deepEqual(o.notes, [DAYN, 'Notes/Shared.md'])
  assert.deepEqual(o.rollouts, ['ra', 'rb', 'rc'])
  assert.equal(o.previous, null, 'no reflection line yet')
  assert.deepEqual(s.rollouts, [], 'a record of only overlap lines reads no rollout')
  for (const c of OVERLAP_CANNOT) assert.ok(s.cannotShow.includes(c), `cannotShow: ${c}`)
})

test('span: an empty week\'s noteOverlaps is none; no overlaps.jsonl reads as 0; both cannot-show lines stand', (t) => {
  const h = setup(t)
  let s = span(h)
  assert.deepEqual(s.noteOverlaps, { warnings: 0, overlaps: [], notes: [], rollouts: [], none: true, previous: null }, 'no file yet')
  emitAll(h, null, [overlap(['2026-09-01T00:00:00Z', 'rb', 'b1', DAYN, 'ra', 'a1'])])
  s = span(h)
  assert.equal(s.noteOverlaps.warnings, 0)
  assert.equal(s.noteOverlaps.none, true, 'a line outside the window leaves the week none')
  for (const c of OVERLAP_CANNOT) assert.ok(s.cannotShow.includes(c), `cannotShow: ${c}`)
  assert.ok(!s.flags.some((f) => f.startsWith('noteOverlaps')), JSON.stringify(s.flags))
})

test('span: an unreadable overlaps.jsonl makes noteOverlaps a null block and a flag, never none; a torn line is a flag', (t) => {
  const h = setup(t)
  fs.mkdirSync(overlapsFile(h))
  let s = span(h)
  assert.equal(s.noteOverlaps, null, 'unread, never none')
  assert.ok(s.flags.some((f) => f.startsWith('noteOverlaps: overlaps.jsonl cannot be read (')), JSON.stringify(s.flags))
  fs.rmdirSync(overlapsFile(h))
  emitAll(h, null, [overlap([W(4, '01:00'), 'rb', 'b1', DAYN, 'ra', 'a1'])])
  fs.appendFileSync(overlapsFile(h), '{"torn')
  s = span(h)
  assert.equal(s.noteOverlaps.warnings, 1)
  assert.ok(s.flags.includes('noteOverlaps: overlaps.jsonl: 1 line(s) did not parse: skipped'), JSON.stringify(s.flags))
})

test('span: noteOverlaps.previous counts the last reflection line\'s window, so two weeks running can be named', (t) => {
  const h = setup(t)
  emitAll(h, null, [
    overlap(['2026-08-28T00:00:00Z', 'rb', 'b1', DAYN, 'ra', 'a1']),
    overlap(['2026-08-30T00:00:00Z', 'rb', 'b1', DAYN, 'ra', 'a1']),
    overlap(['2026-08-20T00:00:00Z', 'rb', 'b1', DAYN, 'ra', 'a1']),   // before the previous window too
    overlap([W(4, '01:00'), 'rc', 'c1', DAYN, 'ra', 'a1']),
  ])
  fs.writeFileSync(reflectionsFile(h), [
    JSON.stringify({ v: 1, ts: '2026-08-27T00:00:00.000Z', kind: 'reflection', id: RID(1), since: '2026-08-20T12:00:00.000Z', until: '2026-08-27T00:00:00.000Z' }),
    JSON.stringify({ v: 1, ts: '2026-09-03T00:00:00.000Z', kind: 'reflection', id: RID(2), since: '2026-08-27T00:00:00.000Z', until: '2026-09-02T14:00:00.000Z' }), ''].join('\n'))
  const o = span(h).noteOverlaps
  assert.deepEqual(o.previous, { since: '2026-08-27T00:00:00.000Z', until: '2026-09-02T14:00:00.000Z', warnings: 2 })
  assert.equal(o.warnings, 1)
})

// ---- master's full-suite runs (p54-7): master-runs.jsonl, written by the execute skill's master-runs verb alone ----

const mastersFile = (h) => path.join(h.ev, 'master-runs.jsonl')
// One master-run line: [ts, rollout, fields]; a line is placed by its `at`, never its ts
const master = ([ts, r, f]) => [ts, 'master-run', null, { repo: 'o/r', sha: 'a'.repeat(40), ...f }, r]

test('span: masterRuns counts each repo\'s reds, breaks (filed and healed apart) and the trail, by `at`, and reads no rollout', (t) => {
  const h = setup(t)
  emitAll(h, null, [
    master([W(4, '01:00'), 'ra', { outcome: 'unconfirmed', at: W(4, '00:30'), runId: 1, attempt: 1, suites: ['A'], redKind: 'suites', retest: 'next-run' }]),
    master([W(4, '02:00'), 'ra', { outcome: 'red', at: W(4, '01:30'), runId: 2, attempt: 2, suites: ['A'], newSuites: ['A'], followup: 'master-red-r-a-2', since: 'g'.repeat(40), retest: 'rerun', redKind: 'suites', merges: 2, prs: [1, 2] }]),
    // a second lead's copy of the same key: the first line is kept, so it adds nothing
    master([W(4, '02:05'), 'rb', { outcome: 'red', at: W(4, '01:30'), runId: 2, attempt: 2, suites: ['A'], newSuites: ['A'], followup: 'master-red-r-a-2', since: 'g'.repeat(40), retest: 'rerun', redKind: 'suites', merges: 2, prs: [1, 2] }]),
    master([W(5, '01:00'), 'ra', { outcome: 'red', at: W(5, '00:30'), runId: 3, attempt: 1, suites: ['A'], since: 'g'.repeat(40), retest: 'covered', redKind: 'suites', merges: null, prs: null }]),
    master([W(5, '02:00'), 'ra', { outcome: 'red', at: W(5, '01:30'), runId: 4, attempt: 1, suites: ['A', 'B'], newSuites: ['B'], healed: true, since: 'g'.repeat(40), retest: 'next-run', redKind: 'suites', merges: 1, prs: [3] }]),
    master([W(5, '03:00'), 'ra', { outcome: 'red', at: W(5, '02:30'), runId: 5, attempt: 2, suites: ['publish the Green tip'], newSuites: ['publish the Green tip'], followup: 'master-red-r-b-2', since: 'g'.repeat(40), retest: 'rerun', redKind: 'publisher', merges: null, prs: null }]),
    master([W(6, '01:00'), 'ra', { outcome: 'green', at: W(6, '00:30'), runId: 6, attempt: 1, since: 'g'.repeat(40), trailMinutes: 300, redRuns: 5, followups: ['master-red-r-a-2', 'master-red-r-b-2'] }]),
    master([W(7, '01:00'), 'ra', { outcome: 'rerun-pass', at: W(7, '00:30'), runId: 7, attempt: 2, publisherOnly: true }]),
    master([W(7, '02:00'), 'ra', { outcome: 'rerun-pass', at: W(7, '01:30'), runId: 8, attempt: 2 }]),
    master([W(8, '01:00'), 'ra', { outcome: 'green', at: W(8, '00:30'), runId: 9, attempt: 1, since: null, trailMinutes: 100, redRuns: 1, followups: [], trailFloor: true }]),
    master([W(8, '02:00'), 'ra', { outcome: 'unproven', at: W(8, '02:00'), sha: 'c'.repeat(40), ref: 'refs/thread/green', followup: 'master-green-unproven-r-cccccccccccc' }]),
    master([W(8, '03:00'), 'ra', { repo: 'o/other', outcome: 'green', at: W(8, '02:30'), runId: 1, attempt: 1, since: null, trailMinutes: 40, redRuns: 1, followups: [] }]),
  ])
  assert.deepEqual(fs.readdirSync(h.ev), ['master-runs.jsonl'], 'the lines sit in the reserved file alone')
  const s = span(h)
  assert.deepEqual(s.masterRuns.repos, [
    { repo: 'o/other', redRuns: 0, breaks: 0, filed: 0, healed: 0, publisherReds: 0, unconfirmed: 0, rerunPasses: 0, blips: 0,
      greens: 1, trailMinutes: { median: 40, max: 40 }, trailFloors: 0, unproven: 0, first: '2026-09-08T02:30:00.000Z', last: '2026-09-08T02:30:00.000Z' },
    { repo: 'o/r', redRuns: 5, breaks: 3, filed: 2, healed: 1, publisherReds: 1, unconfirmed: 1, rerunPasses: 2, blips: 1,
      greens: 2, trailMinutes: { median: 200, max: 300 }, trailFloors: 1, unproven: 1, first: '2026-09-04T00:30:00.000Z', last: '2026-09-08T02:00:00.000Z' },
  ])
  assert.deepEqual(s.rollouts, [], 'a record of only master-run lines reads no rollout')
  assert.ok(!s.flags.some((f) => f.startsWith('masterRuns')), JSON.stringify(s.flags))
})

test('span: masterRuns holds only lines whose `at` is in the window: a line written inside it about an older run adds nothing', (t) => {
  const h = setup(t)
  let s = span(h)
  assert.deepEqual(s.masterRuns, { repos: [] }, 'no file yet')
  emitAll(h, null, [
    // ts inside the window, at before it (a backfilled healed break, a late pass): no sum gains it
    master([W(4, '01:00'), 'ra', { outcome: 'red', at: '2026-09-01T00:00:00Z', runId: 1, attempt: 1, suites: ['A'], newSuites: ['A'], healed: true, since: 'g'.repeat(40), retest: 'next-run', redKind: 'suites', merges: 1, prs: [1] }]),
    master([W(4, '02:00'), 'ra', { outcome: 'green', at: '2026-09-01T01:00:00Z', runId: 2, attempt: 1, since: 'g'.repeat(40), trailMinutes: 9999, redRuns: 1, followups: [] }]),
    master([W(5, '01:00'), 'ra', { outcome: 'rerun-pass', at: W(5, '00:30'), runId: 3, attempt: 2 }]),
  ])
  s = span(h)
  assert.deepEqual(s.masterRuns.repos.map((r) => [r.repo, r.redRuns, r.breaks, r.healed, r.greens, r.trailMinutes, r.rerunPasses, r.first]),
    [['o/r', 0, 0, 0, 0, null, 1, '2026-09-05T00:30:00.000Z']])
})

test('span: an unreadable master-runs.jsonl makes masterRuns a null block and a flag; a torn line is a flag; window_flags holds a repo as one row', (t) => {
  const h = setup(t)
  fs.mkdirSync(mastersFile(h))
  let s = span(h)
  assert.equal(s.masterRuns, null, 'unread, never none')
  assert.ok(s.flags.some((f) => f.startsWith('masterRuns: master-runs.jsonl cannot be read (')), JSON.stringify(s.flags))
  fs.rmdirSync(mastersFile(h))
  emitAll(h, null, [master([W(4, '01:00'), 'ra', { outcome: 'rerun-pass', at: W(4, '00:30'), runId: 1, attempt: 2 }])])
  fs.appendFileSync(mastersFile(h), '{"torn')
  s = span(h)
  assert.equal(s.masterRuns.repos[0].rerunPasses, 1)
  assert.ok(s.flags.includes('masterRuns: master-runs.jsonl: 1 line(s) did not parse: skipped'), JSON.stringify(s.flags))
  const S0 = '2026-09-02T14:00:00.000Z'
  const U0 = '2026-09-09T14:00:00.000Z'
  const doc = (repos) => ({ since: S0, until: U0, rollouts: [], masterRuns: repos === null ? null : { repos }, cannotShow: [], flags: [] })
  const [bad, good, unread] = pyOut(h, 'print(json.dumps([m.window_flags(d, {}) for d in a]))', [REFLECT, [
    doc([{ repo: 'o/r', first: '2026-09-01T00:00:00.000Z', last: '2026-09-05T00:00:00.000Z' }]), doc([{ repo: 'o/r', first: S0, last: U0 }]), doc(null)]])
  assert.deepEqual(bad, [`window: masterRuns.repos holds 1 row(s) outside [${S0}, ${U0}], the first at 2026-09-01T00:00:00.000Z: a reader read past its window`])
  assert.deepEqual([good, unread], [[], []])
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
    // p39-14 (ADR 0070): an Overtime retry, then the take-out with its dependant; and a take-out before since
    [W(4, '08:10'), 'set-aside', 'taken', { stage: 'review', reasonClass: 'review-rounds', setAsideAt: 'run' }],
    [W(4, '08:20'), 'auto-retry', 'taken', { stage: 'review', setAsideAt: 'run', retryClass: 'agent', used: 2, budget: 2, overtime: 1,
      overtimeBudget: 3, raiseField: 'max_review_rounds', raiseTo: 5, reviewRounds: 5 }],
    [W(4, '08:40'), 'set-aside', 'taken', { stage: 'review', reasonClass: 'review-rounds', setAsideAt: 'run' }],
    [W(4, '08:50'), 'take-out', 'dep', { cause: 'dependant', fingerprint: 'abcdef012345', with: 'taken' }],
    [W(4, '08:50'), 'take-out', 'taken', { cause: 'spent', fingerprint: 'abcdef012345', stage: 'review', overtimeUsed: 3, overtimeBudget: 3 }],
    ['2026-09-02T10:00:00Z', 'take-out', 'old', { cause: 'spent', fingerprint: '0123456789ab', stage: 'plan', overtimeUsed: 3, overtimeBudget: 3 }],
    // p55-3 (ADR 0085 d8): a Lead error in the window, one of no task at its bound, and one before since
    [W(4, '09:00'), 'lead-error', 'redone', { site: 'merge-step', n: 1, bound: 3, call: 'integrate', row: { startedAt: '2026-09-04T08:55+00:00' },
      passed: 'a'.repeat(40), named: 'b'.repeat(40) }],
    [W(4, '09:10'), 'lead-error', null, { site: 'command', n: 3, bound: 3, over: true, evidence: 'usage: ladder.py' }],
    ['2026-09-02T11:00:00Z', 'lead-error', 'old', { site: 'args-refusal', n: 1, bound: 3 }],
  ]
  emitAll(h, 'demo', byTs(ev))
  rolloutNote(h, 'demo', { notes: ['- 2026-09-05 repair: [[stuck]] deferred: later'] })
  taskNote(h, 'landed', { body: '## Needs you\n\nPick a colour.\n\n## Decisions (asked ahead at schedule)\n\n- none' })
  taskNote(h, 'fixed', { archived: true })
  const s = span(h)
  const f = entryOf(s, 'demo').friction
  const kinds = [...new Set(f.map((x) => x.kind))].sort()
  assert.deepEqual(kinds, ['ask', 'churn', 'descope', 'lead-error', 'repair', 'retry', 'set-aside', 'takeout'])
  assert.deepEqual(f.filter((x) => x.kind === 'lead-error').map((x) => [x.task, x.site, x.n, x.over]),
    [['redone', 'merge-step', 1, false], [null, 'command', 3, true]], 'each in-window Lead error, listed; the one before since is absent')
  assert.deepEqual(f.filter((x) => x.kind === 'takeout').map((x) => [x.task, x.cause, x.stage, x.overtimeUsed, x.with]),
    [['dep', 'dependant', null, null, 'taken'], ['taken', 'spent', 'review', 3, null]], 'each in-window take-out; the one before since is absent')
  assert.deepEqual(f.filter((x) => x.task === 'taken' && x.kind !== 'takeout').map((x) => [x.kind, x.movedBy ?? x.overtime]),
    [['set-aside', 'auto-retry'], ['retry', 1], ['set-aside', 'take-out']], 'an Overtime retry carries overtime; a take-out moves its set-aside')
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

// p51-3: a gate Lachy signed mid-run that the sweep could have seen in its note is a miss the Reflection counts.
test('span: sweepMiss names a signed gate the sweep could have seen; gateMisses counts only the window\'s', (t) => {
  const h = setup(t)
  const signed = (ts, task) => [ts, 'gate-signed', task, { standing: false, gates: 1 }]
  emitAll(h, 'demo', byTs([
    ...life('anchor', W(4, '00:00'), W(4, '01:00')),
    ['2026-09-01T02:00:00Z', 'gate-signed', 'early', { standing: false, gates: 1 }],   // before the window
    signed(W(4, '02:00'), 'missed'), signed(W(4, '03:00'), 'unseen'), signed(W(4, '04:00'), 'recorded'),
    [W(4, '05:00'), 'gate-signed', 'standing', { standing: true, gates: 1 }],
    signed(W(4, '06:00'), 'scanned'), signed(W(4, '07:00'), 'noteless'),
  ]))
  rolloutNote(h, 'demo')
  const gates = (...lines) => `## Approved gates\n\n${lines.map((l) => `- ${l}`).join('\n')}`
  // its Verify names the services; the drop-table line was signed another day, so only the credential is this act's
  taskNote(h, 'missed', { body: ['**Verify:** first audio on fresh text (Cartesia and ElevenLabs); then drop table x.', '',
    gates('credential: CARTESIA_API_KEY into the Host (approved 2026-09-04)', 'irreversible: drop table x (approved 2026-08-01)'),
  ].join('\n') })
  // its note names nothing; the gate's own words sit only in the sections the run wrote
  taskNote(h, 'unseen', { body: ['**Verify:** the rig passes.', '', '## Approved plan', '', '- a scratch GitHub repo, then delete the repo', '',
    gates('irreversible: create and delete a scratch GitHub repo (approved 2026-09-04)')].join('\n') })
  // a declared test credential is recorded ahead and signed or asked at the stop by design
  taskNote(h, 'recorded', { body: ['Stripe test mode end to end.', '', '## Decisions (recorded 2026-09-01)', '',
    '- Planner: word each test-credential gate as one line', '', gates('credential: test-mode STRIPE_SECRET (sk_test_) (approved 2026-09-04)')].join('\n') })
  taskNote(h, 'early', { body: ['Read the Supabase table.', '', gates('credential: the Supabase key (approved 2026-09-01)')].join('\n') })
  taskNote(h, 'standing', { body: ['Stripe test mode.', '', gates('credential: x (approved 2026-09-04 under the standing approval: test credential X present in f, class from repo)')].join('\n') })
  // its only credential words sit in leg.py's ## Security check, a section the run wrote; noteless has no note at all
  taskNote(h, 'scanned', { body: ['**Verify:** the rig passes.', '', '## Security check', '',
    '- /w at abc123: secret: stripe-access-token in .env, commit abc1234, line 3; rewrite from abc123', 'Ask: rotate the secret', '',
    gates('credential: the probe key (approved 2026-09-04)')].join('\n') })
  const s = span(h)
  const asks = Object.fromEntries(entryOf(s, 'demo').friction.filter((x) => x.kind === 'ask').map((x) => [x.task, x.sweepMiss]))
  assert.deepEqual(asks, { missed: ['credential'], unseen: [], recorded: [], scanned: [], noteless: [] }, 'one signOff ask per in-window sign-off; standing is no ask')
  assert.deepEqual(s.cannotShow.filter((c) => c.includes('sweepMiss')),
    ['[[noteless]] (demo): a gate signed with no task note read (none in Work/Tasks or Archive, or unreadable): its sweepMiss cannot be read'],
    'only the sign-off with no note is named: its [] is no word-list miss')
  assert.deepEqual(s.gateMisses, { count: 1, items: [{ rollout: 'demo', task: 'missed', at: '2026-09-04T02:00:00.000Z', kinds: ['credential'] }] },
    'the sign-off before the window adds nothing, though its note names Supabase')
})

// gated_inputs.annotation()'s own wording for the standing approval's `## Approved gates` suffix (p22-7), through
// pyOut, so a change to it fails these fixtures.
const GATED_PY = path.join(root, 'skills', '_shared', 'scripts', 'gated_inputs.py')
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

// p28-7: span's `nights` (score.py's night_record over every record): two nights, one with holds and ran-past lines and
// one with only its marker, each ran-past line split fallback / underestimate / unchecked, across two records.
test('span: nights counts each night\'s held starts and ran-past tasks, a fallback overrun told from an underestimate (p28-7)', (t) => {
  const h = setup(t)
  const M1 = W(5, '09:00')
  const M2 = W(6, '09:00')
  const ran = (ts, task, S, history, usual) => [ts, 'ran-past-morning', task,
    { morning: M1, slotTakenAt: new Date(Date.parse(S)).toISOString(), scope: 'single-file', history, ...(usual ? { usualMinutes: usual } : {}) }]
  emitAll(h, 'night-a', byTs([
    [W(5, '05:00'), 'away-night', null, { morning: M1 }],
    [W(5, '07:30'), 'last-start-held', 'c1', { morning: M1, scope: 'cross-cutting', history: 3, usualMinutes: 110 }],
    [W(5, '07:30'), 'last-start-held', 'c2', { morning: M1, scope: 'read-only', history: 1 }],
    ran(W(5, '09:20'), 'f1', W(5, '06:30'), 1),
    ran(W(5, '09:21'), 'u1', W(5, '08:00'), 3, 25),
    [W(6, '05:00'), 'away-night', null, { morning: M2 }],
  ]))
  emitAll(h, 'night-b', [[W(5, '07:00'), 'away-night', null, { morning: M1 }], ran(W(5, '09:22'), 'd1', W(5, '05:00'), 3, 25)])
  const r = ok(h, ['span', '--tasks-dir', h.tasks, '--config', path.join(h.home, 'rollouts.toml'), '--out', path.join(h.out, 'span.json'),
    '--since', SINCE, '--until', UNTIL])
  assert.match(r.stderr, /, 2 night\(s\), /, 'the summary line counts the marked nights')
  const n = JSON.parse(fs.readFileSync(path.join(h.out, 'span.json'), 'utf8')).nights
  assert.deepEqual(n.nights.map((x) => [x.morning, x.marked, x.rollouts, x.held, x.heldBy, x.ranPast, x.ranPastBy]), [
    [new Date(Date.parse(M1)).toISOString(), true, ['night-a', 'night-b'], 2, { fallback: 1, history: 1 }, 3, { fallback: 1, underestimate: 1, unchecked: 1 }],
    [new Date(Date.parse(M2)).toISOString(), true, ['night-a'], 0, { fallback: 0, history: 0 }, 0, { fallback: 0, underestimate: 0, unchecked: 0 }]])
  assert.deepEqual(n.nights[0].ranPastTasks.map((e) => [e.task, e.class]), [['f1', 'fallback'], ['u1', 'underestimate'], ['d1', 'unchecked']])
  assert.deepEqual(n.totals, { nights: 2, zeroHold: 1, held: 2, ranPast: 3, fallback: 1, underestimate: 1, unchecked: 1 })
  assert.deepEqual(n.suggest, [])
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

// p29-13: the Integration lane's time comes from the rollout's task notes' ## Integration log lines, priced by each
// line's active figure (active=: the wall less the stalls the Run record logs inside it), never by its wall duration=.
test('span: laneTime prices the Integration lane by each log line\'s active figure, a stall never as lane work; a line from before p29-13 reads its wall; out-of-window and other rollouts\' lines are not read', (t) => {
  const h = setup(t)
  emitAll(h, 'demo', byTs([
    ...life('stalled', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '15:40')] }),
    ...life('old', W(6, '00:00'), W(6, '01:00'), { lane: [W(6, '01:00'), W(6, '01:45')] }),
    ...life('moved', W(6, '02:00'), W(6, '03:00'), { lane: [W(6, '03:00'), W(6, '03:15')] }),
    [W(6, '04:00'), 'lane-taken', 'unlogged', {}]]))
  rolloutNote(h, 'demo')
  const log = (lines) => `## Integration log\n\n${lines.join('\n')}\n`
  const L = (at, rest) => `${at} integrated path=integrator pr=7 anchor=- head=- base=- wait=1 ${rest}`
  taskNote(h, 'stalled', { fm: ['rollout: "[[demo]]"'], body: log([
    L('2026-09-01T11:00+10:00', 'duration=30 triggers=- active=30'), // before since: another week's
    L('2026-09-04T11:00+10:00', 'duration=876 triggers=conflict active=306'),
    L('-', 'duration=5 triggers=- active=5')]) }) // no startedAt: never placed in a window
  taskNote(h, 'old', { fm: ['rollout: "[[demo]]"'], archived: true, body: log([L('2026-09-06T11:00+10:00', 'duration=40 triggers=-')]) })
  taskNote(h, 'moved', { fm: ['rollout: "[[other]]"'], body: log([L('2026-09-06T13:00+10:00', 'duration=10 triggers=- active=10')]) })
  taskNote(h, 'unlogged', { fm: ['rollout: "[[demo]]"'] })
  const lt = entryOf(span(h), 'demo').laneTime
  assert.deepEqual(lt, {
    integrations: 2, minutes: 346, wallMinutes: 916, stalledMinutes: 570, wallOnly: 1, unmeasured: 0,
    lines: [
      { task: 'stalled', startedAt: '2026-09-04T11:00+10:00', outcome: 'integrated', path: 'integrator', wall: 876, active: 306, lane: 306 },
      { task: 'old', startedAt: '2026-09-06T11:00+10:00', outcome: 'integrated', path: 'integrator', wall: 40, active: null, lane: 40 }],
  }, '306 active of the 876-minute window, and the old line\'s 40 wall: the 9.5-hour stall is no lane time')
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

// p53-2: slot-taken's cap gains budget and weight, slot-freed a peak. span drives score.py (and its night record, which
// reads cap), ledger.py, attention.py, grades.py and arms.py, so one pair of runs shows no reader reads them: two
// setups with identical notes and lives, the second's lines carrying the new fields.
test('span: the slot fields p53-2 adds change no reader\'s reading', (t) => {
  const lives = byTs([...life('a', W(4, '00:00'), W(4, '02:00'), { lane: [W(4, '02:10'), W(4, '02:30')] }),
    ...life('b', W(5, '01:00'), W(5, '03:00'))])
  const cap = { away: false, n: 2, file: 'fresh' }
  const before = lives.map(([ts, kind, task, f]) => [ts, kind, task, kind === 'slot-taken' ? { ...f, cap } : f])
  const after = lives.map(([ts, kind, task, f]) => [ts, kind, task,
    kind === 'slot-taken' ? { ...f, cap: { ...cap, budget: { mem_gb: 12, cores: 8 }, weight: { mem_gb: 3, cores: 2 } } }
      : kind === 'slot-freed' ? { ...f, peak: { mem_gb: 3.1, cores: 2.4 } } : f])
  const read = (events) => {
    const h = setup(t)
    emitAll(h, 'demo', events)
    rolloutNote(h, 'demo')
    taskNote(h, 'a', { status: 'done' })
    taskNote(h, 'b', { status: 'review' })
    const s = span(h)
    const keys = ['rollouts', 'ledger', 'attention', 'grades', 'nights', 'arms', 'flags']
    // each setup's root and its Reflection's id (ids such as a ledger row's embed it) read as placeholders
    const text = JSON.stringify(Object.fromEntries(keys.map((k) => [k, s[k]])))
    return JSON.parse(text.split(h.home).join('<root>').split(s.reflection.slice(2)).join('<rid>'))
  }
  const [plain, carried] = [read(before), read(after)]
  assert.ok(carried.rollouts.length === 1 && carried.rollouts[0].rollout === 'demo', JSON.stringify(carried.rollouts))
  for (const k of Object.keys(plain)) assert.deepEqual(carried[k], plain[k], `${k} reads the same`)
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
      '- 2026-09-05 repair: ran on claude-fable-5-2 at high', // p46-6: repair § 6's What ran, metadata: no item
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
  ok(h, ['attention', '--span', path.join(h.out, 'span.json')]) // p30-7: the attention line comes before close
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

// The sweep's escape fixture: one rollout r with four landed tasks, each fixer dated against the default window.
function escapeFixture(h) {
  emitAll(h, 'r', byTs([...life('r-a', '2026-08-10T00:00:00Z', '2026-08-10T01:00:00Z', { lane: ['2026-08-10T01:00:00Z', '2026-08-10T01:10:00Z'], pr: 7 }),
    ...life('r-b', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')], pr: 8 }),
    ...life('r-c', W(5, '00:00'), W(5, '01:00'), { lane: [W(5, '01:00'), W(5, '01:10')], pr: 9 }),
    ...life('r-d', W(6, '00:00'), W(6, '01:00'), { lane: [W(6, '01:00'), W(6, '01:10')], pr: 10 })]))
  rolloutNote(h, 'r')
  taskNote(h, 'fix-r-a', { captured: '2026-08-20', fm: ['fixes: ["[[r-a]]"]'] }) // before since, its task landed by then: an earlier week's
  taskNote(h, 'fix-r-b', { captured: '2026-09-05', fm: ['fixes: ["[[r-b]]"]'] }) // this week's
  taskNote(h, 'fix-r-c', { captured: '2026-09-10', fm: ['fixes: ["[[r-c]]"]'] }) // until's Melbourne date: the next reading's
  taskNote(h, 'fix-r-d', { captured: '2026-08-25', fm: ['fixes: ["[[r-d]]"]'] }) // before since, its task landed in the window: lost
}
const LOST = "Escape(s) on a task landed in the window, dated before it or undated: in no week's friction: "

// A reading holds only its window's rows (CLAUDE.md's review rule): the sweep folds a read rollout's landed tasks of any
// age, so its friction lists only the Escapes dated in the window, and cannotShow names only the ones no week lists.
test('span: escape friction holds only Escapes dated in the window, on a read rollout too; cannotShow names only the lost ones, never one another week counts', (t) => {
  const h = setup(t)
  escapeFixture(h)
  const esc = (e) => e.friction.filter((x) => x.kind === 'escape').map((x) => [x.task, x.at, x.inWindow])
  const s = span(h)
  const r = entryOf(s, 'r')
  assert.equal(r.mode, 'read')
  assert.deepEqual(esc(r), [['r-b', '2026-09-05', true]], JSON.stringify([r.friction, s.cannotShow]))
  const inWindow = (at) => (/^\d{4}-\d\d-\d\d$/.test(at) ? at >= '2026-09-03' && at < '2026-09-10'
    : Date.parse(at) >= Date.parse(SINCE) && Date.parse(at) <= Date.parse(UNTIL))
  for (const x of r.friction) assert.ok(typeof x.at === 'string' && inWindow(x.at), `a friction row outside the window: ${JSON.stringify(x)}`)
  const named = s.cannotShow.filter((c) => c.startsWith('[[r]]: '))
  assert.deepEqual(named, [`[[r]]: 1 ${LOST}r-d 2026-08-25`], JSON.stringify(s.cannotShow))
  // r-a's Escape is the earlier week's friction, so this week never re-names it as lost; r-c's is the next week's
  const early = span(h, [], { since: '2026-08-17T00:00+10:00', until: '2026-08-24T00:00+10:00' })
  assert.deepEqual([entryOf(early, 'r').mode, esc(entryOf(early, 'r'))], ['escapes-only', [['r-a', '2026-08-20', true]]])
  assert.ok(!s.cannotShow.some((c) => c.includes('r-a 2026-08-20') || c.includes('r-c 2026-09-10')), JSON.stringify(s.cannotShow))
  const next = span(h, [], { since: UNTIL, until: '2026-09-17T00:00+10:00' })
  assert.deepEqual([entryOf(next, 'r').mode, esc(entryOf(next, 'r'))], ['escapes-only', [['r-c', '2026-09-10', true]]])
  assert.ok(!next.cannotShow.some((c) => c.startsWith('[[r]]: ')), JSON.stringify(next.cannotShow))
})

// The window check lands in span.json: a reader made to read past its window (window_escapes listing every Escape, of
// any date) is flagged in the flags span writes, not only by window_flags() called alone.
test('span writes the window check\'s flags to span.json: a friction reader made to read past its window is flagged there', (t) => {
  const h = setup(t)
  escapeFixture(h)
  const out = path.join(h.out, 'span.json')
  const rc = pyOut(h, ['m.Span.window_escapes = lambda self, slug, items, *rest: items  # a reader that reads past its window',
    'print(json.dumps(m.main(a)))'].join('\n'),
  [REFLECT, ['span', '--tasks-dir', h.tasks, '--config', path.join(h.home, 'rollouts.toml'), '--out', out, '--since', SINCE, '--until', UNTIL]])
  assert.equal(rc, 0)
  const s = JSON.parse(fs.readFileSync(out, 'utf8'))
  assert.deepEqual(entryOf(s, 'r').friction.filter((x) => x.kind === 'escape').map((x) => x.task), ['r-a', 'r-b', 'r-c', 'r-d'])
  assert.deepEqual(s.flags.filter((f) => f.startsWith('window: ')),
    [`window: rollouts[r].friction holds 3 row(s) outside [${s.since}, ${s.until}], the first at 2026-08-20: a reader read past its window`],
    JSON.stringify(s.flags))
})

test('span: rollouts holds only records with a line in the window: a record wholly before since or wholly after until is not read', (t) => {
  const h = setup(t)
  emitAll(h, 'in-r', byTs(life('in-a', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] })))
  emitAll(h, 'before-r', byTs(life('before-a', '2026-08-10T00:00:00Z', '2026-08-10T01:00:00Z', { lane: ['2026-08-10T01:00:00Z', '2026-08-10T01:10:00Z'] })))
  emitAll(h, 'after-r', byTs(life('after-a', '2026-09-12T00:00:00Z', '2026-09-12T01:00:00Z', { lane: ['2026-09-12T01:00:00Z', '2026-09-12T01:10:00Z'] })))
  for (const slug of ['in-r', 'before-r', 'after-r']) rolloutNote(h, slug)
  const s = span(h)
  assert.deepEqual(s.rollouts.map((e) => e.rollout), ['in-r'], JSON.stringify(s.rollouts.map((e) => [e.rollout, e.mode])))
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

test('span: a repo\'s default clone and a second project\'s clone (ADR 0064) are one family: no Project roots flag', (t) => {
  const h = setup(t)
  const d = path.join(h.home, 'repo-rollout'); const b = path.join(h.home, 'repo-b-rollout')
  for (const c of [d, b]) {
    fs.mkdirSync(c)
    execFileSync(REAL_GIT, ['init', '-q', c])
    execFileSync(REAL_GIT, ['-C', c, 'remote', 'add', 'origin', 'git@github.com:o/r.git'])
  }
  emitAll(h, 'r1', byTs(life('a', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] })))
  emitAll(h, 'r2', byTs(life('b', W(5, '00:00'), W(5, '01:00'), { lane: [W(5, '01:00'), W(5, '01:10')] })))
  rolloutNote(h, 'r1', { root: d })
  rolloutNote(h, 'r2', { root: b })
  const s = span(h)
  assert.ok(!s.flags.some((f) => f.includes('Project roots')), JSON.stringify(s.flags))
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
  ok(h, ['attention', '--span', path.join(h.out, 'span.json')]) // p30-7: the attention line comes before close
  ok(h, ['close', '--span', path.join(h.out, 'span.json')])
  const [line] = rlines(h).filter((l) => l.kind === 'reflection')
  assert.deepEqual([line.counts.breaches, line.quiet], [1, false])
})

// ---- freshReview: one entry per landing (ADR 0058 d5) ------------------------------------------------------------

// reviews.jsonl's review-round lines, deduped to the latest per (repo, doc), grouped by (repo, branch), each group
// kept when a line of it is in the window and read whole; a branchless (pre-ADR 0058) line groups as (repo, null),
// its in-window lines alone.
test('span: freshReview reports each landing: rounds, findings and blocking per code round, filed, open, reversals, size; a pending doc counts once, as consumed', (t) => {
  const h = setup(t)
  const rr = (ts, doc, fields, repo = 'o/r') => [ts, 'review-round', null, { repo, head: 'abc1234', digest: 'd', doc: `docs/reviews/${doc}.md`, ...fields }, null]
  const A = { branch: 'feat/a' }
  emitAll(h, null, [
    // landing A: a round reviewed before the window (not this window's), a simplify round, and a2 pending, then consumed
    rr('2026-09-01T10:00:00Z', 'a1', { ...A, mode: 'code', status: 'consumed', findings: 12, blocking: 3, open: 0, filed: 9, recurring: 0, reversal: 0, rejected: 0, regression: 1, lines: 400, files: 9 }),
    rr(W(4, '01:00'), 'a2', { ...A, mode: 'code', status: 'pending', findings: 10, lines: 420, files: 9 }),
    rr(W(4, '02:00'), 'as', { ...A, mode: 'simplify', status: 'consumed', findings: 5, filed: 5 }),
    rr(W(4, '03:00'), 'a2', { ...A, mode: 'code', status: 'consumed', findings: 10, blocking: 1, open: 1, filed: 7, recurring: 2, reversal: 1, rejected: 1, regression: 2, lines: 420, files: 10 }),
    // landing B: no mode reads as a code round; its doc's line after until is not read
    rr(W(6, '09:00'), 'b1', { branch: 'feat/b', status: 'consumed', findings: 4, blocking: 0, open: 0, filed: 4, lines: 30, files: 2 }),
    rr('2026-09-09T15:00:00Z', 'b1', { branch: 'feat/b', status: 'consumed', findings: 4, blocking: 4, open: 4 }),
    // the same branch name in another repo is another landing
    rr(W(7, '00:00'), 'x1', { ...A, mode: 'code', status: 'pending', findings: 2 }, 'o/other'),
    // a landing wholly outside the window, and legacy lines with no branch or disposition (one before the window)
    rr('2026-08-30T00:00:00Z', 'c1', { branch: 'feat/old', mode: 'code', status: 'consumed', findings: 3, blocking: 1 }),
    rr('2026-08-31T00:00:00Z', 'legacy-old', { mode: 'code', findings: 9, original: 9, regression: 0 }),
    rr(W(5, '00:00'), 'legacy', { mode: 'code', findings: 6, original: 4, regression: 2 }),
  ])
  const s = span(h)
  const at = (ts) => new Date(ts).toISOString()
  // regression is null where no line carries one (unknown, never 0); gradedRounds are the code rounds carrying both
  // blocking and findings, the ones blockingRate reads; no line here carries unconfirmed (all before the checker), so no
  // round is checked and confirmRate is null
  const UNCHECKED = { unconfirmed: null, checkedRounds: 0, candidates: null, confirmRate: null }
  assert.deepEqual(s.freshReview, [
    { repo: 'o/r', branch: 'feat/a', rounds: 2, codeRounds: 1, gradedRounds: 1, findings: [10], blocking: [1], filed: 12,
      recurring: 2, reversal: 1, rejected: 1, open: 1, regression: 2, lines: 420, files: 10, first: at(W(4, '01:00')),
      last: at(W(4, '02:00')), blockingRate: 0.1, ...UNCHECKED },
    { repo: 'o/r', branch: null, rounds: 1, codeRounds: 1, gradedRounds: 0, findings: [6], blocking: [null], filed: null,
      recurring: null, reversal: null, rejected: null, open: null, regression: 2, lines: null, files: null,
      first: at(W(5, '00:00')), last: at(W(5, '00:00')), blockingRate: null, ...UNCHECKED },
    { repo: 'o/r', branch: 'feat/b', rounds: 1, codeRounds: 1, gradedRounds: 1, findings: [4], blocking: [0], filed: 4,
      recurring: null, reversal: null, rejected: null, open: 0, regression: null, lines: 30, files: 2,
      first: at(W(6, '09:00')), last: at(W(6, '09:00')), blockingRate: 0, ...UNCHECKED },
    { repo: 'o/other', branch: 'feat/a', rounds: 1, codeRounds: 1, gradedRounds: 0, findings: [2], blocking: [null],
      filed: null, recurring: null, reversal: null, rejected: null, open: null, regression: null, lines: null, files: null,
      first: at(W(7, '00:00')), last: at(W(7, '00:00')), blockingRate: null, ...UNCHECKED },
  ], JSON.stringify(s.freshReview))
  // the branch-null group is no landing: three landings, not four
  assert.ok(s.cannotShow.includes('/fresh-review: 3 landing(s) reported, not traced to a rollout (reviews.jsonl names none)'),
    JSON.stringify(s.cannotShow))
  // The next window holds b1's later line, but its round was reviewed at W(6, '09:00'), in this window: a later line is
  // a disposition, not a later round, so the next window reports nothing.
  const next = span(h, [], { since: '2026-09-10T00:00+10:00', until: '2026-09-11T00:00+10:00' })
  assert.deepEqual(next.freshReview, [], JSON.stringify(next.freshReview))
})

// fresh-review ADR 0001: a checker gives every finding a verdict, so a line written since carries an unconfirmed count
// beside the six (the seven written together) and no verdict. A checked round is a code round whose line carries
// unconfirmed; confirmRate is Σblocking / (Σblocking + Σunconfirmed) over the checked rounds. freshReviewLevels is the
// precision per level: per (mode, effort), over the window's rounds whose line carries the disposition counts.
test('span: freshReview reads the checker\'s verdicts (unconfirmed, checkedRounds, confirmRate) over old lines and new, and freshReviewLevels reports precision per level; no flag', (t) => {
  const h = setup(t)
  const rr = (ts, doc, fields) => [ts, 'review-round', null, { repo: 'o/r', head: 'abc1234', digest: 'd', doc: `docs/reviews/${doc}.md`, status: 'consumed', ...fields }, null]
  const D = (findings, blocking, filed, { open = 0, recurring = 0, reversal = 0, rejected = 0, unconfirmed } = {}) =>
    ({ findings, blocking, open, filed, recurring, reversal, rejected, ...(unconfirmed === undefined ? {} : { unconfirmed }) })
  const code = (effort) => ({ mode: 'code', ...(effort ? { effort } : {}) })
  emitAll(h, null, [
    // feat/c: new lines alone, 1 of 5 candidates reproduced
    rr(W(4, '01:00'), 'c1', { branch: 'feat/c', ...code('xhigh'), ...D(8, 1, 4, { recurring: 1, unconfirmed: 3 }) }),
    rr(W(4, '02:00'), 'c2', { branch: 'feat/c', ...code('xhigh'), ...D(5, 0, 4, { unconfirmed: 1 }) }),
    // feat/m: an old line (a verdict, no unconfirmed) and a new one: only the new one is checked
    rr(W(5, '01:00'), 'm1', { branch: 'feat/m', ...code('high'), verdict: 'continue', ...D(6, 2, 4, { reversal: 1 }) }),
    rr(W(5, '02:00'), 'm2', { branch: 'feat/m', ...code('xhigh'), ...D(3, 1, 2, { open: 1, unconfirmed: 0 }) }),
    // feat/z: checked rounds with no candidate at all: a zero denominator
    rr(W(6, '01:00'), 'z1', { branch: 'feat/z', ...code('xhigh'), ...D(2, 0, 1, { rejected: 1, unconfirmed: 0 }) }),
    rr(W(6, '02:00'), 'z2', { branch: 'feat/z', ...code('low'), ...D(0, 0, 0, { unconfirmed: 0 }) }),
    // feat/o: old lines alone (a stop verdict, a simplify round, and a legacy round with no disposition)
    rr(W(7, '01:00'), 'o1', { branch: 'feat/o', ...code('high'), verdict: 'stop', ...D(4, 1, 1, { rejected: 2 }) }),
    rr(W(7, '02:00'), 'o2', { branch: 'feat/o', ...code('high'), verdict: 'continue', findings: 9 }),
    rr(W(7, '03:00'), 's1', { branch: 'feat/o', mode: 'simplify', effort: 'xhigh', verdict: 'continue', ...D(5, 0, 5) }),
    // a branchless round with no mode (a code round) and no effort, and a round reviewed before the window
    rr(W(8, '01:00'), 'n1', { ...D(4, 0, 3, { rejected: 1, unconfirmed: 0 }) }),
    rr('2026-09-01T00:00:00Z', 'p1', { branch: 'feat/c', ...code('xhigh'), ...D(10, 0, 1, { unconfirmed: 9 }) }),
  ])
  const s = span(h)
  // candidates: Σblocking + Σunconfirmed over the checked rounds alone (feat/m's old round, blocking 2, is none of
  // them), null with no checked round; the confirm-rate check reads it, never the entry's blocking list or unconfirmed
  const pick = (e) => [e.branch, e.codeRounds, e.gradedRounds, e.checkedRounds, e.blocking, e.unconfirmed, e.candidates, e.blockingRate, e.confirmRate]
  assert.deepEqual(s.freshReview.map(pick), [
    ['feat/c', 2, 2, 2, [1, 0], 4, 5, 0.08, 0.2],
    ['feat/m', 2, 2, 1, [2, 1], 0, 1, 0.33, 1],
    ['feat/z', 2, 2, 2, [0, 0], 0, 0, 0, null],
    ['feat/o', 2, 1, 0, [1, null], null, null, 0.25, null],
    [null, 1, 1, 1, [0], 0, 0, 0, null],
  ], JSON.stringify(s.freshReview))
  const L = (mode, effort, rounds, findings, blocking, unconfirmed, filed, recurring, reversal, rejected, precision) =>
    ({ mode, effort, rounds, findings, blocking, unconfirmed, filed, recurring, reversal, rejected, precision })
  // o2 carries no disposition counts, p1 was reviewed before the window: neither is in any level
  assert.deepEqual(s.freshReviewLevels, [
    L('code', 'high', 2, 10, 3, null, 5, 0, 1, 2, 0.8),
    L('code', 'low', 1, 0, 0, 0, 0, 0, 0, 0, null),
    L('code', 'xhigh', 4, 18, 2, 4, 11, 1, 0, 1, 0.94),
    L('code', null, 1, 4, 0, 0, 3, 0, 0, 1, 0.75),
    L('simplify', 'xhigh', 1, 5, 0, null, 5, 0, 0, 0, 1),
  ], JSON.stringify(s.freshReviewLevels))
  // old and new review-round lines read with no flag: the two left are this fixture's (no Grade log, no transcripts)
  assert.deepEqual(s.flags.filter((f) => !/^grades: no grade log$|^attention: no transcripts directory /.test(f)), [], JSON.stringify(s.flags))
  assert.deepEqual(span(h, [], { since: '2026-09-10T00:00+10:00', until: '2026-09-11T00:00+10:00' }).freshReviewLevels, [], 'no round in the window: no level')
})

// The shape c6f5bb9/ba8597 #6 found: a report that sums over a span wider than its window, which nothing automated
// reads, so nothing else catches it. Every round an entry holds was reviewed inside the window, so the default
// branch's entry (fresh-review chains on master record branch master) never grows with the record.
test('span: freshReview holds only rounds reviewed in the window, so the default branch\'s entry never folds in the record', (t) => {
  const h = setup(t)
  const rr = (ts, doc, fields) => [ts, 'review-round', null, { repo: 'o/r', head: 'abc1234', digest: 'd', doc: `docs/reviews/${doc}.md`, branch: 'master', mode: 'code', status: 'consumed', ...fields }, null]
  emitAll(h, null, [
    rr('2026-06-01T00:00:00Z', 'm-june', { findings: 15, blocking: 4, open: 0 }),                              // months back
    rr(W(4, '00:00'), 'm-swept', { reviewedAt: '2026-07-01T00:00:00.000Z', findings: 9, blocking: 2, open: 0 }), // swept now, reviewed then
    rr(W(5, '00:00'), 'm-now', { findings: 6, blocking: 1, open: 0 }),
  ])
  const at = (ts) => new Date(ts).toISOString()
  const s = span(h)
  assert.deepEqual(s.freshReview.map((e) => [e.branch, e.rounds, e.findings, e.first, e.last]),
    [['master', 1, [6], at(W(5, '00:00')), at(W(5, '00:00'))]], JSON.stringify(s.freshReview))
  for (const e of s.freshReview) assert.ok(e.first >= at(W(3, '00:00')) || e.first >= s.since, `entry starts before the window: ${e.first}`)
  // m-swept arrived in this window but was reviewed in July: counted in no window, and named here, its arrival week
  assert.ok(s.cannotShow.includes('/fresh-review: 1 round(s) first recorded in this window but reviewed before it: counted in no window'),
    JSON.stringify(s.cannotShow))
})

// p34-5 F11: a doc's consumed line can lack the branch (or reviewedAt) its pending line carried; the round keeps its
// landing, taking each from the newest line of its doc that carries it.
test('span: freshReview keeps a round in its landing when its consumed line lacks the branch its pending line carried', (t) => {
  const h = setup(t)
  const rr = (ts, doc, fields) => [ts, 'review-round', null, { repo: 'o/r', head: 'abc1234', digest: 'd', doc: `docs/reviews/${doc}.md`, mode: 'code', ...fields }, null]
  emitAll(h, null, [
    rr(W(4, '01:00'), 'f1', { branch: 'feat/f', status: 'pending', findings: 3 }),
    rr(W(4, '02:00'), 'f1', { status: 'consumed', findings: 3, blocking: 1, open: 0, filed: 2 }),
  ])
  const at = (ts) => new Date(ts).toISOString()
  assert.deepEqual(span(h).freshReview.map((e) => [e.branch, e.rounds, e.blocking, e.filed, e.first]),
    [['feat/f', 1, [1], 2, at(W(4, '01:00'))]])
})

// p34-5 F16: a loop continued in a worktree is one landing: an absolute path groups by its origin's owner/name.
test('span: freshReview groups by repo identity, so worktree paths and an owner/name line are one landing', (t) => {
  const h = setup(t)
  const [wa, wb] = ['wt-a', 'wt-b'].map((n) => {
    const p = path.join(h.home, n)
    fs.mkdirSync(p)
    git(h, ['init', '-q'], p)
    git(h, ['remote', 'add', 'origin', 'git@github.com:o/r.git'], p)
    return p
  })
  const rr = (ts, doc, repo) => [ts, 'review-round', null, { repo, head: 'abc1234', digest: 'd', doc: `docs/reviews/${doc}.md`, branch: 'feat/w', mode: 'code', status: 'consumed', findings: 2, blocking: 0, open: 0 }, null]
  emitAll(h, null, [rr(W(4, '01:00'), 'w1', wa), rr(W(4, '02:00'), 'w2', wb), rr(W(4, '03:00'), 'w3', 'O/R')])
  const s = span(h)
  assert.deepEqual(s.freshReview.map((e) => [e.repo, e.branch, e.rounds, e.gradedRounds]), [['o/r', 'feat/w', 3, 3]], JSON.stringify(s.freshReview))
  assert.ok(s.cannotShow.includes('/fresh-review: 1 landing(s) reported, not traced to a rollout (reviews.jsonl names none)'),
    JSON.stringify(s.cannotShow))
})

// p34-5 F28: lines with no branch are reported as their repo's branch-null group, never counted as a landing.
test('span: freshReview\'s branch-null group is reported but never counted as a landing', (t) => {
  const h = setup(t)
  emitAll(h, null, [[W(5, '00:00'), 'review-round', null, { repo: 'o/r', head: 'abc1234', digest: 'd', doc: 'docs/reviews/l.md', mode: 'code', findings: 6 }, null]])
  const s = span(h)
  assert.deepEqual(s.freshReview.map((e) => [e.repo, e.branch, e.rounds]), [['o/r', null, 1]])
  assert.ok(!s.cannotShow.some((c) => /landing\(s\) reported/.test(c)), JSON.stringify(s.cannotShow))
})

// land.sh's --branch-docs sweep records a landing's unrecorded docs at its end, out of round order and seconds apart:
// rounds are ordered by reviewedAt (when each was reviewed), never by the line's own ts, so open is the last round's.
test('span: freshReview orders a swept landing by reviewedAt, so open and first/last are the rounds\' own', (t) => {
  const h = setup(t)
  const rr = (ts, doc, fields) => [ts, 'review-round', null, { repo: 'o/r', head: 'abc1234', digest: 'd', doc: `docs/reviews/${doc}.md`, branch: 'feat/s', mode: 'code', status: 'consumed', ...fields }, null]
  emitAll(h, null, [
    rr(W(5, '12:01'), 'r2', { reviewedAt: W(3, '09:00'), findings: 9, blocking: 1, open: 1 }),
    rr(W(5, '12:02'), 'r1', { reviewedAt: W(3, '08:00'), findings: 14, blocking: 2, open: 0 }),
  ])
  const at = (ts) => new Date(ts).toISOString()
  const [e] = span(h).freshReview
  assert.deepEqual([e.findings, e.blocking, e.open, e.first, e.last],
    [[14, 9], [2, 1], 1, at(W(3, '08:00')), at(W(3, '09:00'))], JSON.stringify(e))
})

// The window check (reflect.py's header): span flags each reported block holding a row outside its window, each row by
// its own stamp (an instant parsed, a date-only one by date_in()), and a rollout's score by the score's own window,
// never by span's since (a rollout is scored whole).
test('window_flags: one flag per block holding a row outside its window; a score is held to its own window; rows on the boundaries flag nothing', (t) => {
  const h = setup(t)
  const S0 = '2026-09-02T14:00:00.000Z'
  const U0 = '2026-09-09T14:00:00.000Z'
  const ask = (at) => ({ kind: 'ask', rollout: 'r', task: 'a', at })
  const esc = (at, inWindow) => ({ kind: 'escape', rollout: 'r', task: 'a', source: 'fixes', at, inWindow })
  const repair = (at) => ({ kind: 'repair', rollout: 'r', task: 'a', at, date: at })
  const lane = (startedAt) => ({ integrations: 1, lines: [{ task: 'a', startedAt }] })
  const acts = (...ats) => ({ tasks: [{ task: 'a', acts: ats.map((at) => ({ kind: 'answer', at, detail: 'x' })) }] })
  const entry = (rollout, friction = [], laneTime = null) => ({ rollout, friction, laneTime })
  const doc = (o) => ({ since: S0, until: U0, rollouts: [], freshReview: [], grades: { episodes: [] },
    attention: { questions: { items: [] } }, nights: { nights: [] }, noteOverlaps: { overlaps: [] }, cannotShow: [], flags: [], ...o })
  const bad = doc({
    rollouts: [entry('r', [ask('2026-09-02T13:59:00.000Z'), esc('2026-09-05', false), repair('2026-09-10'), ask(null), ask(S0)],
      lane('2026-09-09T14:01:00.000Z')), entry('c')],
    freshReview: [{ repo: 'o/r', branch: 'feat/x', first: '2026-09-01T00:00:00.000Z', last: '2026-09-04T00:00:00.000Z' }],
    grades: { episodes: [{ task: 'g', inWindow: true, end: { kind: 'landed', at: '2026-09-09T15:00:00.000Z', date: null } }] },
    attention: { questions: { items: [{ id: 'q#0', at: '2026-09-01T00:00:00.000Z' }] } },
    nights: { nights: [{ morning: '2026-09-02T00:00:00.000Z' }] },
    // an overlap is one row: its first in the window, its last a second past until, printed as the one outside
    noteOverlaps: { overlaps: [{ note: 'n.md', runs: [], warnings: 2, first: '2026-09-05T00:00:00.000Z', last: '2026-09-09T14:00:01.000Z' }] },
    gateMisses: { count: 1, items: [{ rollout: 'r', task: 'a', at: '2026-09-01T00:00:00.000Z', kinds: ['credential'] }] },
    // until's own Melbourne date is outside under date_in() (the next reading says it)
    suite: { local: [], ci: [], retired: [{ repo: 'o/r', job: 'j', date: '2026-09-10', line: 'x' }] },
  })
  const CS = '2026-09-04T00:00:00.000Z' // chain c's Leg 1 began
  const badScores = {
    r: { window: { since: '2026-09-01T00:00:00.000Z', until: U0 }, handsOff: acts('2026-08-31T23:00:00.000Z'), // before the score's own since
      weights: { tasks: [{ task: 'a', at: '2026-08-31T22:00:00.000Z' }, { task: 'b', at: U0 }] } }, // p53-5: a peak read before it
    c: { shape: 'serial', window: { since: CS, until: U0 }, handsOff: acts('2026-09-09T14:01:30.000Z'), // past until's minute
      merges: { count: 1, tasks: [{ task: 'a', at: '2026-09-09T14:01:00.000Z' }] } },
  }
  const good = doc({
    rollouts: [entry('r', [ask(S0), ask(U0), repair('2026-09-03'), esc('2026-09-03', true), esc('2026-09-09', true)],
      lane('2026-09-10T00:00+10:00')), entry('c'), entry('n'), entry('w')], // until in another form: compared parsed
    freshReview: [{ repo: 'o/r', branch: 'feat/y', first: S0, last: U0 }],
    grades: { episodes: [{ task: 'g', inWindow: true, end: { kind: 'landed', at: U0, date: '2026-09-10' } },
      { task: 'k', inWindow: true, end: { kind: 'dropped', at: null, date: '2026-09-03' } }] },
    attention: { questions: { items: [{ id: 'q#0', at: S0 }] } },
    nights: { nights: [{ morning: U0 }] },
    noteOverlaps: { overlaps: [{ note: 'n.md', runs: [], warnings: 2, first: S0, last: U0 }] },
    gateMisses: { count: 2, items: [{ rollout: 'r', task: 'a', at: S0, kinds: ['credential'] }, { rollout: 'r', task: 'b', at: U0, kinds: ['irreversible'] }] },
    suite: { local: [], ci: [], retired: [{ repo: 'o/r', job: 'j', date: '2026-09-03', line: 'x' }] },
  })
  const goodScores = {
    // scored whole: an act weeks before span's since, inside the score's own window, is no flag
    r: { window: { since: '2026-08-01T00:00:00.000Z', until: U0 }, handsOff: acts('2026-08-02T00:00:00.000Z', U0),
      weights: { tasks: [{ task: 'a', at: '2026-08-01T00:00:00.000Z' }, { task: 'b', at: U0 }] } }, // on the score's own bounds
    c: { shape: 'serial', window: { since: CS, until: U0 }, handsOff: acts('2026-09-09T14:00:30.000Z'), merges: { count: 1, tasks: [{ task: 'a', at: U0 }] } },
    w: { window: null, handsOff: acts('2026-01-01T00:00:00.000Z') }, // no window: skipped, as n (no score) is
  }
  const [flags, none, unread] = pyOut(h, 'print(json.dumps([m.window_flags(d["doc"], d["scores"]) for d in a]))',
    [REFLECT, [{ doc: bad, scores: badScores }, { doc: good, scores: goodScores }, { doc: doc({ noteOverlaps: null }), scores: {} }]])
  const F = (block, k, bounds, first) => `window: ${block} holds ${k} row(s) outside ${bounds}, the first at ${first}: a reader read past its window`
  const SPAN = `[${S0}, ${U0}]`
  assert.deepEqual(flags, [
    F('rollouts[r].friction', 4, SPAN, '2026-09-02T13:59:00.000Z'),
    F('rollouts[r].laneTime', 1, SPAN, '2026-09-09T14:01:00.000Z'),
    F('rollouts[r].score.handsOff', 1, `[2026-09-01T00:00:00.000Z, ${U0}]`, '2026-08-31T23:00:00.000Z'),
    F('rollouts[r].score.weights.tasks', 1, `[2026-09-01T00:00:00.000Z, ${U0}]`, '2026-08-31T22:00:00.000Z'),
    F('rollouts[c].score.handsOff', 1, `[${CS}, ${U0} + 60 s)`, '2026-09-09T14:01:30.000Z'),
    F('rollouts[c].score.merges', 1, `[${CS}, ${U0}]`, '2026-09-09T14:01:00.000Z'),
    F('freshReview', 1, SPAN, '2026-09-01T00:00:00.000Z'),
    F('grades.episodes', 1, SPAN, '2026-09-09T15:00:00.000Z'),
    F('attention.questions', 1, SPAN, '2026-09-01T00:00:00.000Z'),
    F('nights.nights', 1, SPAN, '2026-09-02T00:00:00.000Z'),
    F('noteOverlaps.overlaps', 1, SPAN, '2026-09-09T14:00:01.000Z'),
    F('suite.retired', 1, SPAN, '2026-09-10'),
    F('gateMisses.items', 1, SPAN, '2026-09-01T00:00:00.000Z'),
  ])
  assert.deepEqual(none, [], 'rows on the boundaries, a stamp in another form and a score read by its own window flag nothing')
  assert.deepEqual(unread, [], 'an unread noteOverlaps (a null block) holds no row')
})
