// skills/reflect/scripts/reflect.py's weekly reading, part 4 of 4 (p49-3): moot (a yes that cannot apply), rung (the
// ladder's reference rung), the Verify week end to end, and span over a serial chain (serial-score.py, and its
// friction from leg.py status). tests/lib/reflect-weekly-fixtures.mjs holds the fixtures the parts share, and says
// how each case stays hermetic and what each part pins.
// Reach (tests/fast-tier.map): each part names every script the unsplit file named, so each runs on the changes it
// did: arms.py attention.py gated_inputs.py grades.py land.sh lead-integrate.py ledger.py leg.py reflect.py
// rollout-settings.py run_record.py score.py serial-score.py tune.py vault-note-overlap.py.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root, setup, env, reflect, ok, tuningsFile, rlines, sha, emitAll, ids, rolloutNote, taskNote, life, byTs,
  span, entryOf, fakeSpan, RID, heldReason, watchArgs, bugArgs, KSINCE, KUNTIL, saturated, TRADE_KEY, TRADE_LEAD,
  tradeProp, tradeSpan, tradeItem, setStatus } from './lib/reflect-weekly-fixtures.mjs'

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
    'decision task thread-skill-decisions-2026-09-24 (new)\n', 'offered again at the same from')
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

test('rung: an operator ladder whose top is fable and whose opus rung is high: no note, the rung is a reference only (ADR 0079 d5); no opus rung is exit 2', { skip: !hasTomllib && 'no tomllib' }, (t) => {
  const h = setup(t)
  const p = path.join(h.home, '.config', 'thread', 'ladder.toml')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const rung = (name, model, effort) => `[[rung]]\nname = "${name}"\nmodel = "${model}"\neffort = "${effort}"\njudge = "high"\nreview = "xhigh"\n`
  fs.writeFileSync(p, rung('opus-high', 'opus', 'high') + rung('fable-xhigh', 'fable', 'xhigh'))
  const r = ok(h, ['rung'])
  assert.deepEqual(JSON.parse(r.stdout), { rung: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh', top: 'fable-xhigh', topModel: 'fable' })
  assert.equal(r.stderr, '', 'the Reflection runs on the lock\'s model, so no rung effort is noted')
  fs.writeFileSync(p, rung('fable-xhigh', 'fable', 'xhigh'))
  const none = reflect(h, ['rung'])
  assert.equal(none.status, 2)
  assert.match(none.stderr, /has no opus rung to report/)
  assert.doesNotMatch(none.stderr, /xhigh/, 'no rule the lock retired is cited')
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
  ok(h, ['attention', '--span', out]) // p30-7: step 13b, before decide and close
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
  // a fixer of c2 (done at 11:40) captured before the window: serial-score's escapes block holds it, the friction does not
  fs.writeFileSync(path.join(h.tasks, 'c2-old-fix.md'), ['---', 'tags: [task]', 'status: done', 'captured: 2026-10-05', 'projects:',
    '  - "[[Demo]]"', 'fixes: "[[c2]]"', '---', '', '## Notes', '', 'Fix c2.', ''].join('\n'))
  const s = span(h, [], { since: KSINCE, until: KUNTIL })
  const c = entryOf(s, 'chain-a')
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
  assert.ok(s.cannotShow.includes("[[chain-a]]: 1 Escape(s) dated outside the window, every one: most are another week's friction, one dated in a week that did not read the chain is in none: c2 2026-10-05"),
    JSON.stringify(s.cannotShow))
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
