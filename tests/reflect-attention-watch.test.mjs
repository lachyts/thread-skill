// skills/reflect/scripts/attention.py and reflect.py's attention ledger (p30-7, ADR 0056), part 2 of 2 (p49-3): each
// rollout's Wait to start (L4); the circling detector, W1 a work item three Sessions touch with no rollout holding
// it (L5) and W2 a rollout open 48 hours with nothing merged (L6); its Watches, which count readings, into decide,
// close and the cadence (L7); and a reading with no transcripts (L8). tests/lib/reflect-attention-fixtures.mjs holds
// the fixtures both parts use, and says how each case stays hermetic.
// Reach (tests/fast-tier.map): each part names every script the unsplit file named, so each runs on the changes it
// did: attention.py contract-text.mjs reflect.py run_record.py score.py.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { section } from './lib/contract-text.mjs'
import { root, ATTENTION, setup, ok, refused, rlines, writeJson, listing, emitAll, py, SINCE, UNTIL, T, SID, block,
  span, transcript, Q, askE, resultE, promptE, bashE, answered, taskNote, rolloutNote,
  questionsFixture } from './lib/reflect-attention-fixtures.mjs'

// ---- L4: waits to start -------------------------------------------------------------------------------------------------

test('L4: a rollout\'s wait runs from the earliest captured: of its queue\'s tasks (carried and joined rows skipped), else its own; open while unstarted', (t) => {
  const h = setup(t)
  taskNote(h, 't1', { captured: '2026-10-18', dir: path.join(h.tasks, 'Archive', '2026') })
  taskNote(h, 't2', { captured: '2026-10-20' })
  taskNote(h, 't3', { captured: '2026-10-01' })
  taskNote(h, 't4', { captured: null })
  // a task a later schedule joined to the running queue (ADR 0078 d6) was asked after it started: its earlier date
  // never moves the ask (an unskipped t6 would read 2026-08-31T13:00)
  taskNote(h, 't6', { captured: '2026-09-01' })
  taskNote(h, 't7', { captured: '2026-09-02' })
  rolloutNote(h, 'r-started', { captured: '2026-10-22', queue: [['t1', '—'], ['t2', 'solo'], ['t3', 'carried (queued)'], ['t6', 'joined 2026-10-23'], ['t7', 'joined 2026-10-23, solo']] })
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
    [T(17, '13:00'), T(21, '13:00'), T(23, '00:00'), 131, 35, false], 'the Archive task\'s date wins; the carried and joined rows are skipped')
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
const ZERO_TRAILS = { count: 0, rounds: 0, codeRounds: 0, findings: 0, regression: 0, docsOnly: { trails: 0, rounds: 0 }, engineStops: 0, longest: [] }
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
