// skills/reflect/scripts/reflect.py's weekly reading, part 3 of 4 (p49-3): decide (the decision task in task-writer
// § 5's shape), close (quiet, the cadence and the steps it waits for) and held trades (a knob held as Lachy's call,
// in the decision task once per knob id and from). tests/lib/reflect-weekly-fixtures.mjs holds the fixtures the
// parts share, and says how each case stays hermetic and what each part pins.
// Reach (tests/fast-tier.map): each part names every script the unsplit file named, so each runs on the changes it
// did: arms.py attention.py gated_inputs.py grades.py land.sh lead-integrate.py ledger.py leg.py reflect.py
// rollout-settings.py run_record.py score.py serial-score.py tune.py vault-note-overlap.py.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { setup, reflect, ok, reflectionsFile, tuningsFile, rlines, bytes, sha, listing, ids, taskNote, fakeSpan, RID,
  heldReason, RULE, SHAPE, watchArgs, TRADE_KEY, TRADE_LEAD, tradeProp, tradeSpan, tradeItem,
  setStatus } from './lib/reflect-weekly-fixtures.mjs'

// ---- decide ----------------------------------------------------------------------------------------------------------------

function twoWatches(h, rid, sp) {
  ok(h, watchArgs(sp, ['a', 'b']))
  ok(h, watchArgs(sp, ['a'], { rule: 'grill-fit § How a fork comes back', shape: 'a fork routed no gate' }))
}

test('decide: no task without a rule item; one unscheduled task in task-writer § 5\'s shape; entries checked; a left-out Watch still listed', (t) => {
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
  assert.equal(r.stdout, 'decision task thread-skill-decisions-2026-09-10 (new)\n')
  const text = fs.readFileSync(path.join(h.tasks, 'thread-skill-decisions-2026-09-10.md'), 'utf8')
  const fm = text.split('---')[1]
  for (const line of ['tags: [task, ai, decisions]', 'status: open', 'priority: high', 'captured: 2026-09-10', 'launch: cc-thread']) assert.ok(fm.includes(`\n${line}\n`), line)
  assert.doesNotMatch(fm, /^scheduled:/m, 'no scheduled: key: the Reflection Routine asks it, never a day page')
  assert.deepEqual(text.split('\n').filter((l) => /^## /.test(l)), ['## Notes', '## Launch', '## Resume prompt', `## Reflection ${RID(1)}`])
  assert.ok(text.includes('Conversation-gated'))
  const notes = text.slice(text.indexOf('## Notes'), text.indexOf('## Launch'))
  assert.ok(notes.includes('Reflection Routine'), notes)
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

test('decide: an open task gets a new section, frontmatter untouched; a listed Watch goes under ## Still open dated by until; re-runs after midnight are byte-identical', (t) => {
  const h = setup(t)
  const sp1 = fakeSpan(h, RID(1), ['a', 'b'])
  twoWatches(h, RID(1), sp1)
  ok(h, ['decide', '--span', sp1, '--tasks-dir', h.tasks, '--now', '2026-09-10T23:50+10:00'])
  const p = path.join(h.tasks, 'thread-skill-decisions-2026-09-10.md')
  const first = fs.readFileSync(p, 'utf8')
  ok(h, ['decide', '--span', sp1, '--tasks-dir', h.tasks, '--now', '2026-09-11T00:10+10:00'])
  assert.equal(fs.readFileSync(p, 'utf8'), first, 'a new task: byte-identical after midnight')
  ok(h, ['close', '--span', sp1])
  // R2 sees the same Watch again in c: the open task is appended to, its frontmatter untouched
  const sp2 = fakeSpan(h, RID(2), ['c'], { until: '2026-09-17T14:00:00.000Z' })
  ok(h, watchArgs(sp2, ['c']))
  const r = ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-17T23:50+10:00'])
  assert.equal(r.stdout, 'decision task thread-skill-decisions-2026-09-10 (appended)\n')
  const second = fs.readFileSync(p, 'utf8')
  assert.equal(second.split('---')[1], first.split('---')[1], 'the frontmatter is byte-identical')
  const [wid] = ids(h, [['w', RULE, SHAPE]])
  assert.ok(second.includes(`## Reflection ${RID(2)}\n\nNo new rule items; still open: ${wid} (see ## Still open)`), second)
  assert.ok(second.includes(`## Still open\n\n${wid} still open 2026-09-18: Reflection ${RID(2)}, rollouts [[a]], [[b]], [[c]]`), second)
  ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-18T00:10+10:00'])
  assert.equal(fs.readFileSync(p, 'utf8'), second, 'an existing task: byte-identical after midnight')
})

// A task written before the Reflection Routine took the decision task (2026-11-03) still carries scheduled:, with a line
// on that day's page: the next fresh section drops the key once and names the date, so the agent removes the line.
test('decide: a legacy task\'s scheduled: is dropped on its next fresh section and named in the outcome; --dry-run shows it dropped and writes nothing; a re-run is byte-identical', (t) => {
  const h = setup(t)
  const sp1 = fakeSpan(h, RID(1), ['a', 'b'])
  twoWatches(h, RID(1), sp1)
  ok(h, ['decide', '--span', sp1, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00'])
  ok(h, ['close', '--span', sp1])
  const p = path.join(h.tasks, 'thread-skill-decisions-2026-09-10.md')
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('\ncaptured: 2026-09-10\n', '\nscheduled: 2026-09-11\ncaptured: 2026-09-10\n'))
  const legacy = fs.readFileSync(p, 'utf8')
  assert.match(legacy.split('---')[1], /^scheduled: 2026-09-11$/m)
  const sp2 = fakeSpan(h, RID(2), ['c'], { until: '2026-09-17T14:00:00.000Z' })
  ok(h, watchArgs(sp2, ['c']))
  const dry = ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-17T09:00+10:00', '--dry-run'])
  assert.match(dry.stdout, /^would write \S+thread-skill-decisions-2026-09-10\.md:/m)
  assert.doesNotMatch(dry.stdout, /^scheduled:/m, 'the would-write text has the key dropped')
  assert.match(dry.stdout, /\(appended; scheduled 2026-09-11 dropped\)\n$/)
  assert.equal(fs.readFileSync(p, 'utf8'), legacy, '--dry-run leaves the task unchanged')
  const r = ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-17T09:00+10:00'])
  assert.equal(r.stdout, 'decision task thread-skill-decisions-2026-09-10 (appended; scheduled 2026-09-11 dropped)\n')
  const second = fs.readFileSync(p, 'utf8')
  const fmLines = (s) => s.split('---')[1].split('\n')
  assert.doesNotMatch(second.split('---')[1], /^scheduled:/m)
  assert.deepEqual(fmLines(second), fmLines(legacy).filter((l) => !l.startsWith('scheduled:')), 'every other frontmatter line unchanged')
  assert.ok(second.includes(`## Reflection ${RID(2)}\n`), second)
  assert.equal(ok(h, ['decide', '--span', sp2, '--tasks-dir', h.tasks, '--now', '2026-09-18T00:10+10:00']).stdout,
    'decision task thread-skill-decisions-2026-09-10 (appended)\n')
  assert.equal(fs.readFileSync(p, 'utf8'), second, 'a re-run is byte-identical')
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
  assert.equal(ok(h, ['decide', '--span', sp, '--tasks-dir', h.tasks, '--now', '2026-09-10T09:00+10:00']).stdout, 'decision task thread-skill-decisions-2026-09-10-3 (new)\n')
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
  assert.equal(decide(sp1, '2026-09-10T09:00+10:00').stdout, 'decision task thread-skill-decisions-2026-09-10 (new)\n')
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
  assert.equal(decide(sp2, '2026-09-17T23:50+10:00').stdout, 'decision task thread-skill-decisions-2026-09-10 (appended)\n')
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
  assert.equal(decide(sp4, '2026-09-24T09:00+10:00').stdout, 'decision task thread-skill-decisions-2026-09-24 (new)\n')
  assert.ok(fs.readFileSync(path.join(h.tasks, 'thread-skill-decisions-2026-09-24.md'), 'utf8').includes(`${TRADE_LEAD}\n${tradeItem(kid, reason, { from: 4, to: 5 })}\n`))
  // a dropped task decides nothing: the trade is listed anew
  const h2 = setup(t)
  const d1 = tradeSpan(h2, RID(1), kid, { prop, reason })
  ok(h2, ['decide', '--span', d1, '--tasks-dir', h2.tasks, '--now', '2026-09-10T09:00+10:00'])
  setStatus(path.join(h2.tasks, 'thread-skill-decisions-2026-09-10.md'), 'dropped')
  const d2 = tradeSpan(h2, RID(2), kid, { prop, reason, until: '2026-09-17T14:00:00.000Z' })
  assert.equal(ok(h2, ['decide', '--span', d2, '--tasks-dir', h2.tasks, '--now', '2026-09-17T23:50+10:00']).stdout,
    'decision task thread-skill-decisions-2026-09-17 (new)\n')
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
