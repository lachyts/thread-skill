// skills/reflect/scripts/attention.py and reflect.py's attention ledger (p30-7, ADR 0056), part 1 of 2: the Question
// ledger read from the session transcripts (each question of the ask tool, its outcome, the recommended pick and the
// hours it held work) and tally (L1); `reflect.py attention`, which writes one `attention` line per Reflection with
// the reading's Owner labels (L2); and the Review trails (the /fresh-review rounds keyed per PR by landing, branch
// or path run, L3). Each rollout's Wait to start and the circling detector, whose Watches count readings and which
// decide and close wait for, are the -watch part's. Every rule lives in attention.py's docstring, reflect.py's and
// run_record.py's; this pins the behaviour. tests/lib/reflect-attention-fixtures.mjs holds the fixtures both parts
// use, and says how each case stays hermetic.
// Reach (tests/fast-tier.map): each part names every script the unsplit file named, so each runs on the changes it
// did: attention.py contract-text.mjs reflect.py run_record.py score.py.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ATTENTION, RUN_RECORD, setup, git, commit, run, ok, refused, reflectionsFile, rlines, sha, writeJson, emitAll,
  py, SINCE, UNTIL, T, SID, block, span, transcript, Q, askE, A, B,
  questionsFixture } from './lib/reflect-attention-fixtures.mjs'

// ---- L1: the Question ledger, and tally ------------------------------------------------------------------------------

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
  const unk = ok(h, att(['--owners', writeJson(sp.dir, 'unknown.json', Object.fromEntries(ids.map((i) => [i, 'unknown']))), '--model', 'claude-opus-5-5', '--effort', 'xhigh']))
  assert.ok(!/^flag:/m.test(unk.stdout), unk.stdout)
  assert.match(unk.stdout, new RegExp(`^attention ${rid}: 8 questions \\(0 yours, 0 unlabelled\\), 0 trails, 0 circling; attention line written\\n$`))
  let line = rlines(h).filter((l) => l.kind === 'attention').at(-1)
  assert.deepEqual([line.v, line.rollout, line.task, line.questions.byOwner.unknown, line.questions.unlabelled], [1, null, null, 8, 0])
  // p46-6 (ADR 0079 decision 5): the line records the model and effort the labels were made on; a re-run with the same
  // labels is no change, whatever it names as ran
  assert.deepEqual([line.model, line.effort], ['claude-opus-5-5', 'xhigh'])
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
  // every cap at once: 12 repos and other, 5 longest at 60-character headers, 5 trails at 120-character labels, 16 waits
  // and 32 + 32 circling items on 64-character slugs
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
    trails: { count: 40, rounds: 120, codeRounds: 100, findings: 999, regression: 333, engineStops: 4,
      docsOnly: { trails: 3, rounds: 9 },
      longest: Array.from({ length: 5 }, () => ({ label: 'l'.repeat(120), rounds: 12, docsOnly: null })) },
    waits: Array.from({ length: 16 }, (_, i) => ({ rollout: slug('w', i), ask: stamp, scheduled: stamp, started: stamp, hours: 123.456, scheduleHours: 23.456, open: false })),
    circling: { W1: Array.from({ length: 32 }, (_, i) => ({ slug: slug('a', i), sessions: 12, questions: 34 })),
      W2: Array.from({ length: 32 }, (_, i) => ({ slug: slug('b', i), sessions: 12, questions: 34, hours: 123.456 })) } }
  const [size, checked] = py(h, RUN_RECORD, '[m.line_bytes("attention", a), m.check(None, "attention", None, a)]', f)
  assert.ok(size > 14000 && size <= 16384, `the maximal line is ${size} bytes`)
  assert.equal(checked, null)
})

// fresh-review ADR 0001 retired the stop verdict and the simplify round, so the attention line lost their counts; a line
// written before that still sits in reflections.jsonl and still reads: trend reads each line's keys as they stand, and
// no reader puts an earlier line through run_record's check.
test('L2: an attention line from before fresh-review ADR 0001 (its stop and simplify counts) still reads in trend, with no flag; the new line carries none and the reading closes', (t) => {
  const h = setup(t)
  const [wn, s1] = branchCheckout(h, 'wn')
  emitAll(h, null, [round(h, T(22, '00:00'), wn, s1, { verdict: 'stop', branch: 'feat/n' }), round(h, T(22, '01:00'), wn, s1, { ...NEW_ROUND, branch: 'feat/n' })])
  const rid = 'r-20261020T130000Z-0a1b2c'
  const [since, until] = ['2026-10-13T13:00:00.000Z', '2026-10-20T13:00:00.000Z']
  const old = { v: 1, ts: '2026-10-20T13:00:05.000Z', host: 'h', rollout: null, task: null, kind: 'attention', reflection: rid, since, until,
    questions: { asked: 7, calls: 6, answered: 5, dismissed: 1, dropped: 0, open: 1, failed: 1, unparsed: 0, notes: 1, ownWords: 1, unlabelled: 1,
      recommended: { offered: 4, picked: 3 }, hoursHeld: 9.5, longest: [], byRepo: { 'o/r': 7 },
      byOwner: { yours: 2, priorities: 1, technical: 3, gate: 0, unknown: 1 }, hoursByOwner: { yours: 2, priorities: 1, technical: 6, gate: 0, unknown: 0.5 } },
    trails: { count: 2, rounds: 7, codeRounds: 6, simplifyRounds: 1, stopRounds: 3, stops: 2, stopsHanded: 1, findings: 20, regression: 5, engineStops: 0,
      docsOnly: { trails: 1, rounds: 2 }, longest: [{ label: '#211', rounds: 5, stopRounds: 3, stops: 1, stopsHanded: 1, docsOnly: false, handedAfterStop: ['toolu_9#0'] }] },
    waits: [], circling: { W1: [{ slug: 'a-task', sessions: 3, questions: 2 }], W2: [] } }
  fs.writeFileSync(reflectionsFile(h), `${JSON.stringify(old)}\n`)
  const want = [{ reflection: rid, since, until, asked: 7, yours: 2, unlabelled: 1, trails: 2, rounds: 7, W1: 1, W2: 0 }]
  assert.deepEqual(py(h, ATTENTION, 'm.trend(a, None)', rlines(h)), want, 'the old line reads; trend carries no stops')
  const sp = span(h)
  assert.deepEqual(sp.s.attention.trend, want)
  assert.deepEqual([sp.s.attention.flags, sp.s.flags.filter((f) => f.startsWith('attention'))], [[], []])
  assert.deepEqual(sp.s.attention.trails.items.map((x) => [x.label, x.rounds, x.codeRounds, RETIRED.filter((k) => k in x)]), [['feat/n', 2, 2, []]])
  // the writer: run_record takes the new line, which carries no retired key; decide and close read past the old one
  ok(h, ['attention', '--span', sp.out])
  const line = rlines(h).filter((l) => l.kind === 'attention').at(-1)
  assert.equal(line.reflection, sp.s.reflection)
  assert.deepEqual(Object.keys(line.trails).sort(), ['codeRounds', 'count', 'docsOnly', 'engineStops', 'findings', 'longest', 'regression', 'rounds'])
  assert.deepEqual(line.trails.longest, [{ label: 'feat/n', rounds: 2, docsOnly: false }])
  assert.deepEqual(py(h, ATTENTION, 'm.trend(a, None)', rlines(h)).map((x) => [x.reflection, x.trails, x.rounds, 'stops' in x]), [[rid, 2, 7, false], [sp.s.reflection, 1, 2, false]])
  ok(h, ['ledger', '--span', sp.out])
  ok(h, ['close', '--span', sp.out])
})

// ---- L3: Review trails --------------------------------------------------------------------------------------------------

// verdict null leaves the key out: a line written after fresh-review ADR 0001 retired the ledger's stop rule
function round(h, ts, repo, head, { verdict = 'continue', mode = 'code', doc = null, branch = null, extra = {} } = {}) {
  return [ts, 'review-round', null, { repo, head, digest: crypto.createHash('sha1').update(`${repo}${head}${ts}`).digest('hex').slice(0, 6),
    doc: doc ?? `docs/reviews/${ts.slice(0, 10)}-${head}-${crypto.randomBytes(2).toString('hex')}.md`, mode, effort: 'xhigh',
    findings: 3, original: 2, regression: 1, ...(verdict ? { verdict } : {}), ...(branch ? { branch } : {}), ...extra }, null]
}
// what a trail and its counts no longer carry (fresh-review ADR 0001 retired the stop verdict and the simplify round)
const RETIRED = ['simplifyRounds', 'stopRounds', 'stops', 'stopsHanded', 'handedAfterStop']
const NEW_ROUND = { verdict: null, extra: { status: 'consumed', blocking: 1, open: 0, filed: 1, recurring: 0, reversal: 0, rejected: 0, unconfirmed: 1 } }

test('L3: Review trails key each round by landing, then branch, then path run; count rounds, code rounds and docs-only diffs, never a stop', (t) => {
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
  // the stop rounds' branch (lines from before fresh-review ADR 0001), and the new lines' with no verdict
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
    round(h, T(24, '11:00'), hb, s1, { ...NEW_ROUND, branch: 'feat/hb' }), round(h, T(24, '12:00'), hb, s1, { ...NEW_ROUND, branch: 'feat/hb' }),
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
  assert.deepEqual([one('#3').checkouts, one('#3').rounds, one('#3').codeRounds, one('#3').docsOnly], [[wt3a, wt3b], 2, 1, true], 'a simplify round is a round, never a code round')
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
  assert.deepEqual([one('feat/s').rounds, one('feat/s').codeRounds, one('feat/s').findings], [5, 5, 15], '[continue, stop, stop, continue, stop]: an old verdict is never read')
  assert.deepEqual([one('feat/hb').rounds, one('feat/hb').codeRounds, one('feat/hb').findings], [3, 3, 9], 'an old stop round and two new rounds with no verdict')
  for (const x of items) assert.deepEqual(RETIRED.filter((k) => k in x), [], `${x.label} carries a retired key`)
  assert.deepEqual(Object.keys(items[0]).sort(), ['checkouts', 'codeRounds', 'docsOnly', 'findings', 'first', 'identity', 'key', 'label', 'last', 'regression', 'rounds'])
  assert.ok(!items.some((x) => x.label === 'feat/old'), 'a trail with no round in the window is not read')
  assert.deepEqual([one('feat/p').rounds, one('feat/p').first, one('feat/p').last], [1, T(24, '19:30'), T(24, '19:30')], 'pending then consumed is one round, at reviewedAt')
  const c = b.attention.trails.counts
  assert.deepEqual([c.count, c.rounds, c.codeRounds, c.engineStops], [items.length, items.reduce((n, x) => n + x.rounds, 0), items.reduce((n, x) => n + x.codeRounds, 0), 1])
  assert.deepEqual(Object.keys(c).sort(), ['codeRounds', 'count', 'docsOnly', 'engineStops', 'findings', 'longest', 'regression', 'rounds'])
  assert.deepEqual(c.docsOnly, { trails: 3, rounds: 5 })
  assert.deepEqual(c.longest.map((x) => Object.keys(x).sort()), c.longest.map(() => ['docsOnly', 'label', 'rounds']))
  assert.deepEqual(c.longest[0], { label: 'feat/s', rounds: 5, docsOnly: false }, 'the most rounds first')
  // a question after a stop round is a question, never a handed stop
  assert.deepEqual(b.attention.questions.items.map((x) => [x.id, 'handedAfterStop' in x]), [['ha1#0', false], ['hc1#0', false], ['hb1#0', false]])
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

test('L3: the transcripts\' floor is the earlier of since and until - 14 days: a trail\'s first round never moves it, and none older than 28 days before the window is keyed', (t) => {
  // A: an old round on a gone repo, its trail with no round in the window, and a round 50 days back on the branch of a
  // trail read. A transcript last written before the floor (until - 14 days) is never read, so its ask, a question in
  // the window, is not in the Question ledger.
  const h = setup(t)
  const [wa, s1] = branchCheckout(h, 'wa')
  const goneOld = path.join(h.home, 'gone-old')
  emitAll(h, null, [
    round(h, '2026-09-01T00:00:00.000Z', wa, s1, { verdict: 'stop', branch: 'feat/a' }),
    round(h, T(10, '00:00'), goneOld, 'deadbee'),
    round(h, T(24, '10:00'), wa, s1, { ...NEW_ROUND, branch: 'feat/a' }),
  ])
  transcript(h, 'early', SID('1'), [askE(T(24, '10:10'), 'a1', [Q('Stop here?', ['Yes', 'No'])], { cwd: wa })], { mtime: new Date(T(11, '00:00')) })
  const a = block(h)
  assert.deepEqual(a.attention.trails.items.map((x) => [x.label, x.rounds, x.first]),
    [['feat/a', 1, T(24, '10:00')]], 'the September round is not keyed; the gone repo\'s trail is not read')
  assert.deepEqual(a.attention.questions.items, [], 'the early transcript is not read')
  assert.ok(!a.attention.cannotShow.some((c) => c.includes(goneOld)), 'a trail not read names no checkout')
  // B: a trail read whose first round is 15 days before the window reads back to it, but the transcripts do not: a file
  // last written then (after that round, before until - 14 days) is not read, so its in-window ask is no question.
  const h2 = setup(t)
  const [wr, r1] = branchCheckout(h2, 'wr')
  emitAll(h2, null, [round(h2, T(5, '00:00'), wr, r1, { verdict: 'stop', branch: 'feat/r' }), round(h2, T(22, '00:00'), wr, r1, { ...NEW_ROUND, branch: 'feat/r' })])
  transcript(h2, 'early', SID('2'), [askE(T(22, '00:10'), 'r1', [Q('Stop here?', ['Yes', 'No'])], { cwd: wr })], { mtime: new Date(T(6, '00:00')) })
  const b = block(h2)
  assert.deepEqual(b.attention.trails.items.map((x) => [x.label, x.rounds, x.first]), [['feat/r', 2, T(5, '00:00')]])
  assert.deepEqual(b.attention.questions.items, [], 'a trail\'s first round never moves the floor')
})
