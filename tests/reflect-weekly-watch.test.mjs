// skills/reflect/scripts/reflect.py's weekly reading, part 2 of 4 (p49-3): watch, raised and the Watch reader,
// declines, the suite readings (the Suite budget and CI headroom on the week's median), bug, knobs, and knobs end to
// end (a real span's land[], held[] and revert[], through tune.py --auto). tests/lib/reflect-weekly-fixtures.mjs
// holds the fixtures the parts share, and says how each case stays hermetic and what each part pins.
// Reach (tests/fast-tier.map): each part names every script the unsplit file named, so each runs on the changes it
// did: arms.py attention.py gated_inputs.py grades.py land.sh lead-integrate.py ledger.py leg.py reflect.py
// rollout-settings.py run_record.py score.py serial-score.py tune.py vault-note-overlap.py.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { setup, reflect, ok, reflectionsFile, tuningsFile, parse, rlines, bytes, sha, listing, emitAll, ids,
  rolloutNote, taskNote, life, byTs, UNTIL, W, span, fakeSpan, RID, RULE, SHAPE, watchArgs, bugArgs, KSINCE, KUNTIL,
  saturated, tune } from './lib/reflect-weekly-fixtures.mjs'

// ---- watch, raised and the Watch reader -----------------------------------------------------------------------------

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
  ok(h, ['close', '--span', fakeSpan(h, RID(1), ['a']), '--model', 'claude-fable-5-2', '--effort', 'high'])
  fs.appendFileSync(reflectionsFile(h), '{"kind": "watch", "id": "torn\n')
  const sp2 = fakeSpan(h, RID(2), ['a'])
  ok(h, watchArgs(sp2, ['a']))
  assert.equal(ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks]).stdout, 'no rule proposal or held trade: no decision task\n', 'one rollout in two weeks')
  ok(h, ['close', '--span', sp2])
  // p46-6 (ADR 0079 decision 5): the reflection line records the model and effort it ran on, only when close is told
  assert.deepEqual(rlines(h).filter((l) => l.kind === 'reflection').map((l) => [l.model, l.effort]),
    [['claude-fable-5-2', 'high'], [undefined, undefined]])
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

// ---- the suite readings (ADR 0073 d5): the Suite budget and CI headroom, on the week's median ------------------------

const TS_ORIGIN = 'https://github.com/lachyts/thread-skill.git'
let suiteN = 0
// One suite-ended line: a completion suite names no task.
const suiteEnded = (ts, by, seconds, outcome = 'green') => [ts, 'suite-ended', by === 'completion' ? null : 't1',
  { suite: `s-${(++suiteN).toString(16).padStart(16, '0')}`, by, runner: by === 'task' ? 'agent' : 'lead', outcome, seconds }]
// One ci-headroom line (lead-integrate.py ci-headroom's shape).
const ciRow = (ts, job, seconds, { limit = 60, conclusion = 'success', repo = 'lachyts/thread-skill' } = {}) =>
  [ts, 'ci-headroom', 't1', { repo, pr: 7, job, seconds, conclusion, timeoutMinutes: limit, limitSource: 'workflow', runId: 11 }]
const MAC = 'make test (macos-latest)'
const UBU = 'make test (ubuntu-latest)'
// A week of suites and CI jobs, each reader's row planted outside the window too (2026-08-20): absent from every group.
const suiteWeek = () => byTs([
  ...life('t1', W(4, '00:00'), W(4, '01:00'), { lane: [W(4, '01:00'), W(4, '01:10')] }),
  suiteEnded(W(4, '00:30'), 'task', 400), suiteEnded(W(4, '01:05'), 'integration', 200), suiteEnded(W(5, '00:00'), 'race', 260),
  suiteEnded(W(5, '01:00'), 'integration', 9000, 'stopped'),          // no verdict: no time
  suiteEnded(W(6, '00:00'), 'completion', 1500),
  suiteEnded('2026-08-20T00:00:00Z', 'integration', 5000),             // outside: the median would be 330, past 300
  ciRow(W(4, '01:08'), MAC, 2880), ciRow(W(5, '02:00'), MAC, 3000), ciRow(W(6, '02:00'), MAC, 2950),
  ciRow(W(4, '01:08'), UBU, 1800), ciRow(W(5, '02:00'), UBU, 1850), ciRow(W(6, '02:00'), UBU, 3600, { conclusion: 'cancelled' }),
  ciRow('2026-08-20T00:00:00Z', MAC, 10),                              // outside: the median would be 2915
])

test('span: suite reads local suites against the Suite budget and CI jobs against 80 % of their limit, the window\'s rows alone', (t) => {
  const h = setup(t, { origin: TS_ORIGIN })
  emitAll(h, 'suite-a', suiteWeek())
  rolloutNote(h, 'suite-a')
  const s = span(h)
  const at = (ts) => new Date(ts).toISOString()
  assert.deepEqual(s.suite.local.map((g) => [g.repo, g.tier, g.runs, g.medianSeconds, g.budgetSeconds, g.breach, g.first, g.last, g.rollouts]), [
    ['lachyts/thread-skill', 'full', 1, 1500, 1200, true, at(W(6, '00:00')), at(W(6, '00:00')), ['suite-a']],
    ['lachyts/thread-skill', 'integration', 3, 260, 300, false, at(W(4, '00:30')), at(W(5, '00:00')), ['suite-a']],
  ], JSON.stringify(s.suite.local))
  assert.deepEqual(s.suite.ci.map((g) => [g.job, g.runs, g.timed, g.medianSeconds, g.timeoutMinutes, g.share, g.breach, g.cancelled, g.first]), [
    [MAC, 3, 3, 2950, 60, 0.82, true, 0, at(W(4, '01:08'))],
    [UBU, 3, 3, 1850, 60, 0.51, false, 1, at(W(4, '01:08'))],
  ], JSON.stringify(s.suite.ci))
  assert.deepEqual(s.suite.breaches, [
    'lachyts/thread-skill: the full suite\'s week\'s median 1500 s is past its 1200 s Suite budget (1 run(s))',
    `lachyts/thread-skill: ${MAC}'s week's median 2950 s is 82 % of its 60 min limit, past 80 % (3 run(s))`,
  ])
  assert.deepEqual([s.suite.audit.repo, s.suite.audit.due, s.suite.audit.open], ['lachyts/thread-skill', true, null])
  assert.deepEqual(s.suite.budget, { integrationSeconds: 300, fullSeconds: 1200, ciShare: 0.8 })
})

test('span: a median at exactly 80 % of the limit, or within the budget, breaches nothing; another repo\'s breach is reported, never due', (t) => {
  const h = setup(t)   // origin o/r: not Thread Skill's
  emitAll(h, 'suite-o', byTs([...life('t1', W(4, '00:00'), W(4, '01:00')), ciRow(W(4, '01:08'), MAC, 2880, { repo: 'o/r' }),
    ciRow(W(4, '02:00'), UBU, 3500, { repo: 'o/r' }), suiteEnded(W(4, '00:30'), 'integration', 300)]))
  rolloutNote(h, 'suite-o')
  const s = span(h)
  assert.deepEqual(s.suite.ci.map((g) => [g.repo, g.job, g.share, g.breach]), [['o/r', MAC, 0.8, false], ['o/r', UBU, 0.97, true]])
  assert.deepEqual(s.suite.local.map((g) => [g.repo, g.tier, g.breach]), [['o/r', 'integration', false]])
  assert.equal(s.suite.audit.due, false, 'o/r is not Thread Skill\'s repo')
  assert.equal(ok(h, ['suite-audit', '--span', path.join(h.out, 'span.json'), '--tasks-dir', h.tasks]).stdout,
    'no suite budget breach on lachyts/thread-skill: no audit task\n')
  assert.deepEqual(listing(h.tasks).filter((f) => f.endsWith('.md')), ['suite-o.md'], 'no task filed')
})

test('suite-audit: a week whose median crosses 80 % files one audit task; the next week cites it, never filing twice', (t) => {
  const h = setup(t, { origin: TS_ORIGIN })
  emitAll(h, 'suite-a', suiteWeek())
  rolloutNote(h, 'suite-a')
  const s1 = span(h)
  const sp1 = path.join(h.out, 'span-week1.json')
  fs.copyFileSync(path.join(h.out, 'span.json'), sp1)
  const slug = 'thread-skill-suite-audit-2026-09-10'
  assert.equal(ok(h, ['suite-audit', '--span', sp1, '--tasks-dir', h.tasks]).stdout, `filed ${slug}\n`)
  const p = path.join(h.tasks, `${slug}.md`)
  const text = fs.readFileSync(p, 'utf8')
  assert.ok(text.includes(`\nbug_key: ${s1.suite.audit.key}\n`), text)
  assert.ok(text.includes(`${MAC}'s week's median 2950 s is 82 % of its 60 min limit`), 'its why names the breach')
  assert.equal(ok(h, ['suite-audit', '--span', sp1, '--tasks-dir', h.tasks]).stdout, `filed ${slug}\n`, 'a repeat prints the first outcome')
  // the next week: the macOS job is past 80 % again
  emitAll(h, 'suite-a', [ciRow('2026-09-11T00:00:00Z', MAC, 3100), ciRow('2026-09-12T00:00:00Z', MAC, 3050)])
  const s2 = span(h, [], { since: UNTIL, until: '2026-09-17T00:00+10:00' })
  assert.deepEqual(s2.suite.ci.map((g) => [g.job, g.runs, g.breach]), [[MAC, 2, true]], 'last week\'s rows are not this week\'s')
  assert.deepEqual(s2.suite.audit.open, { slug, status: 'open' })
  assert.equal(ok(h, ['suite-audit', '--span', path.join(h.out, 'span.json'), '--tasks-dir', h.tasks]).stdout, `cites ${slug}\n`)
  assert.deepEqual(listing(h.tasks).filter((f) => f.startsWith('thread-skill-suite-audit-')), [`${slug}.md`], 'one audit task')
  assert.equal(fs.readFileSync(p, 'utf8'), text, 'the open audit is untouched')
  const lines = rlines(h).filter((l) => l.kind === 'proposal' && l.id === s1.suite.audit.key)
  assert.deepEqual(lines.map((l) => [l.reflection, l.filed, l.vaultTask]), [[s1.reflection, true, slug], [s2.reflection, false, slug]])
})

// p54-2 (ADR 0084 d3): make test (macos-latest) left Thread Skill's required checks on 2026-11-16 (reflect.py's
// CI_RETIRED). The 2026-09 tests above are the control: a reading before that date still breaches on it and files.
test('span: CI headroom says once that make test (macos-latest) left the required checks, and never flags it from that week on', (t) => {
  const h = setup(t, { origin: TS_ORIGIN })
  const N = (d, hm) => `2026-11-${d}T${hm}:00+11:00`
  const NOW = ['--now', '2026-12-01T00:00+11:00']   // both readings are past: neither until is clamped
  emitAll(h, 'suite-r', byTs([
    ...life('t1', N(11, '09:00'), N(11, '10:00')),
    ciRow(N(11, '10:08'), MAC, 2950), ciRow(N(12, '10:00'), MAC, 2950), ciRow(N(13, '10:00'), MAC, 2950), // 82 %: breached before
    ciRow(N(11, '10:08'), UBU, 1850),
    ciRow(N(12, '11:00'), MAC, 3000, { repo: 'o/r' }),                       // another repo's job: never retired
    ciRow(N('01', '10:00'), MAC, 10),                                        // outside: the median would be 2950 still, runs 4
  ]))
  rolloutNote(h, 'suite-r')
  const a = span(h, NOW, { since: N(10, '00:00'), until: N(17, '00:00') })
  assert.deepEqual(a.suite.ci.map((g) => [g.repo, g.job, g.runs, g.breach, g.retired]), [
    ['lachyts/thread-skill', MAC, 3, false, '2026-11-16'],
    ['lachyts/thread-skill', UBU, 1, false, null],
    ['o/r', MAC, 1, true, null],
  ], JSON.stringify(a.suite.ci))
  assert.deepEqual(a.suite.breaches, [`o/r: ${MAC}'s week's median 3000 s is 83 % of its 60 min limit, past 80 % (1 run(s))`])
  assert.equal(a.suite.audit.due, false, 'a retired job files no audit')
  assert.deepEqual(a.suite.retired, [{ repo: 'lachyts/thread-skill', job: MAC, date: '2026-11-16',
    line: `lachyts/thread-skill: ${MAC} left the required checks on 2026-11-16 (ADR 0084 d3): CI headroom has no series for it from that day, and its rows never breach` }])
  assert.equal(ok(h, ['suite-audit', '--span', path.join(h.out, 'span.json'), '--tasks-dir', h.tasks]).stdout,
    'no suite budget breach on lachyts/thread-skill: no audit task\n')
  // the next week: a stray macOS row (a PR still on the old workflow) is retired and never breaches; nothing is said again
  emitAll(h, 'suite-r', byTs([...life('t2', N(18, '09:00'), N(18, '10:00')), ciRow(N(18, '10:08'), MAC, 3500)]))
  const b = span(h, NOW, { since: N(17, '00:00'), until: N(24, '00:00') })
  assert.deepEqual(b.suite.ci.map((g) => [g.repo, g.job, g.runs, g.breach, g.retired]), [['lachyts/thread-skill', MAC, 1, false, '2026-11-16']])
  assert.deepEqual([b.suite.breaches, b.suite.retired, b.suite.audit.due], [[], [], false])
})

// ---- bug ---------------------------------------------------------------------------------------------------------------

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

// A closed earlier Reflection whose knob line names one other rollout (the Agreement rule counts each).
function agreeingReflection(h, rid, kid, rollout, ts) {
  const L = (o) => JSON.stringify({ v: 1, ts, host: 'h', rollout: null, task: null, ...o })
  fs.appendFileSync(reflectionsFile(h), `${L({ kind: 'proposal', id: kid, altitude: 'knob', reflection: rid, rollouts: [rollout], repo: 'o/r', key: 'parallel_ceiling',
    rule: 'slot-bound-raise', direction: 1, landed: false, held: 'agreement 1 of 3' })}\n${L({ kind: 'reflection', id: rid })}\n`)
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
  ok(h, ['attention', '--span', out]) // p30-7: step 13b, before decide and close
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
  ok(h, ['attention', '--span', out]) // p30-7: step 13b, before decide and close
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
