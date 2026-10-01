// Schedule orders a queue (ADR 0030 decision 1, p12-10): no colouring and no wave anywhere in the
// schedule skill or its template, protocol 5, the queue's stamps (`solo: true`, `depends-on:`), and the
// one-unfinished-rollout-per-repo rule wired into § 0 (the check, the supersede's `resume`, the `file`
// and `interrupted` finishes, the `incomplete: true` stamp and the pinned "is incomplete" report), the
// carry preview in step 1, Solo and dependency proposals for queued tasks only (step 5), step 6's
// Advance/Cancel-only naming, and orient leaving the rule to schedule.
//
// Every rule lives in one pure function, checkSchedule, that returns named failures, so the real files
// and the control cases run through identical logic and the matcher can't pass vacuously. Each control
// mutates the real text in one place and must fail with exactly the rule(s) it names. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section, walk } from '../lib/contract-text.mjs'

const real = {
  schedule: read('skills/schedule/SKILL.md'),
  template: read('skills/schedule/rollout-template.md'),
  orient: read('skills/orient/SKILL.md'),
  manifests: [read('.claude-plugin/plugin.json'), read('.claude-plugin/marketplace.json')],
}
const others = walk('skills/schedule').filter((f) => !/\/(SKILL|rollout-template)\.md$/.test(f)).map(read)

const s = (text, re) => collapse(section(text, re) ?? '')
const S0 = /^### 0\./
const S1 = /^### 1\. /
const S5 = /^### 5\. /
const S6 = /^### 6\. /
const S7 = /^### 7\. /
const S8 = /^### 8\. /
// Sentences of a collapsed text: split after `.`/`!`/`?` (and a closing quote) before whitespace.
const sentences = (text) => text.split(/(?<=[.!?]["”]?)\s+/)
const spans = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1])
// The text with `wave-shaped` (the CONTEXT term, p12-12's to rename) and backticked legacy `wave:`
// mentions stripped: what is left must name no wave.
const waveLines = (text) => text.replace(/wave-shaped/gi, '').replace(/`wave:`/g, '').split('\n')
  .filter((l) => /wave/i.test(l))
const description = (text) => (text.match(/^description: (.*)$/m) ?? [])[1] ?? ''

// Named failures for the schedule skill, its template and orient; [] means every rule holds.
function checkSchedule({ schedule, template, orient, manifests = [], extra = [] }) {
  const fails = []
  const s0 = s(schedule, S0)

  if (/conflict graph|core invariant|compute waves/i.test(schedule)) fails.push('no-colouring')

  if ([schedule, template, ...extra].some((t) => waveLines(t).length > 0)) fails.push('no-wave')

  const s7 = s(schedule, S7)
  if (!s7.includes('`solo: true`') || !s7.includes('`depends-on:`') || /Add `wave:/.test(s7)) fails.push('step7-stamps')

  if (!template.includes('protocol_version: 5') || !schedule.includes('protocol_version: 5') ||
    /protocol_version: 3\b/.test(template + schedule)) fails.push('protocol-5')

  // § 0 runs the check (with --regenerate in the same call) and then the supersede's resume.
  const check = spans(s0).find((x) => x.includes('unfinished-rollout.py check'))
  const at = (needle) => s0.indexOf(needle)
  if (!check || !check.includes('--regenerate') || at('reconcile-rollout.py resume --rollout') < 0 ||
    at('reconcile-rollout.py resume --rollout') < at('unfinished-rollout.py check')) fails.push('s0-check')

  if (!s0.includes('`file <slug> <path>`') || !s0.includes('`interrupted <prior> <new>`') ||
    !/reconcile-rollout\.py carry --from/.test(s0)) fails.push('s0-outcomes')

  // The pinned report: one § 0 sentence says the new note is incomplete because its run died before
  // closing out the prior rollout (a crash after step 7 leaves it fully stamped), names --regenerate and
  // forbids executing it as written.
  if (!sentences(s0).some((x) => x.includes('is incomplete') && x.includes('--regenerate') &&
    x.includes('died before closing out') && !/before step 7 stamped/.test(x) &&
    /never `\/thread:execute`d as written/.test(x))) fails.push('interrupted-incomplete')

  // The interrupted finish stamps `incomplete: true` on the new note before its carry and close-out, so a
  // cancel after the finish leaves a note `next` refuses (p12-10 round 2).
  const mark = s0.indexOf('Stamp `incomplete: true` in `<new>`')
  if (mark < 0 || mark > s0.indexOf('reconcile-rollout.py carry --from')) fails.push('interrupted-marker')

  if (!spans(s(schedule, S1)).some((x) => x.includes('carry --from') && x.includes('--dry-run'))) {
    fails.push('step1-carry-preview')
  }

  // Step 6 offers Advance or Cancel only, every time: each **Overwrite** it names is a "never".
  const s6 = s(schedule, S6)
  if (!/only \*\*Advance\*\* or \*\*Cancel\*\*, never \*\*Overwrite\*\*/.test(s6) ||
    [...s6.matchAll(/\*\*Overwrite\*\*/g)].some((m) => !/never $/.test(s6.slice(Math.max(0, m.index - 6), m.index)))) {
    fails.push('step6-advance-cancel')
  }

  // Step 5: Solo and dependency proposals are for queued tasks only (step 7 writes nothing to a started one).
  if (!sentences(s(schedule, S5)).some((x) => /Solo and dependency proposals apply only to tasks in the `queued` state/.test(x))) {
    fails.push('step5-queued-only')
  }

  const d = description(schedule)
  if (!d.includes('queue') || !d.includes('`protocol_version: 5`') || /stamps wave/i.test(d)) fails.push('description')

  // The plugin manifests describe schedule as ordering a queue, not clustering waves (execute's
  // per-wave auto-merge and the wave-shaped term are p12-12's to rename).
  if (manifests.some((m) => /parallel-safe waves|clusters tasks into/i.test(m))) fails.push('manifests')

  // Orient leaves the one-per-repo rule to schedule § 0: it reads no rollout state itself.
  const o6 = s(orient, /^### 6\./)
  if (o6.includes('reconcile-rollout.py status') || !o6.includes('unfinished-rollout check')) fails.push('orient-defers')
  return fails
}

test('schedule, its template and orient hold every queue rule', () => {
  assert.deepEqual(checkSchedule({ ...real, extra: others }), [])
})

test('the § 0 report text is the one pinned sentence (not split across sentences)', () => {
  const hit = sentences(s(real.schedule, S0)).filter((x) => x.includes('is incomplete'))
  assert.equal(hit.length, 1, `expected one § 0 sentence saying "is incomplete", got ${hit.length}`)
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule(s) -----

// Replace `from` with `to` once, inside the section starting at `re` (or the whole text when re is null).
function edit(text, re, from, to) {
  if (re == null) {
    assert.ok(text.includes(from), `control setup: ${from} not found`)
    return text.replace(from, to)
  }
  const sec = section(text, re)
  assert.ok(sec != null && sec.includes(from), `control setup: ${from} not in ${re}`)
  return text.replace(sec, sec.replace(from, to))
}
const only = (mut, rules, label) => assert.deepEqual(checkSchedule({ ...real, ...mut }), rules, label)

test('control: a conflict graph is colouring', () => {
  only({ schedule: `${real.schedule}\nBuild a conflict graph over every editing task.\n` }, ['no-colouring'], 'colouring')
})

test('control: a wave anywhere in the template fails, wave-shaped and `wave:` do not', () => {
  only({ template: `${real.template}\nEach wave fans out across subagents.\n` }, ['no-wave'], 'template wave')
  only({ template: `${real.template}\nA **wave-shaped** cluster clears any legacy \`wave:\`.\n` }, [], 'allowed forms')
})

test('control: step 7 without solo: true, or stamping wave:, fails', () => {
  only({ schedule: edit(real.schedule, S7, 'add `solo: true`', 'add `solo`') }, ['step7-stamps'], 'no solo')
  only({ schedule: edit(real.schedule, S7, 'For each task in the rollout:\n', 'For each task in the rollout:\n\n- Add `wave: <N>`\n') },
    ['no-wave', 'step7-stamps'], 'wave stamp')
})

test('control: a protocol 3 template fails', () => {
  only({ template: real.template.replace('protocol_version: 5', 'protocol_version: 3') }, ['protocol-5'], 'protocol 3')
})

test('control: § 0 without --regenerate on the check, or without resume, fails', () => {
  only({ schedule: edit(real.schedule, S0, ' [--regenerate]`', '`') }, ['s0-check'], 'no --regenerate')
  only({ schedule: edit(real.schedule, S0, 'reconcile-rollout.py resume --rollout', 'reconcile-rollout.py status --rollout') },
    ['s0-check'], 'no resume')
})

test('control: § 0 that drops the file outcome fails', () => {
  only({ schedule: edit(real.schedule, S0, '`file <slug> <path>`', '`moved <slug>`') }, ['s0-outcomes'], 'no file')
})

test('control: the pinned report blaming step 7 (the old wording) fails', () => {
  only({ schedule: edit(real.schedule, S0, 'died before closing out [[<prior>]], so its tasks may be unstamped and',
    'died before step 7 stamped its tasks, so') }, ['interrupted-incomplete'], 'old wording')
})

test('control: an interrupted finish without the incomplete stamp, or stamping after the carry, fails', () => {
  const s0 = section(real.schedule, S0)
  const step = s0.split('\n').find((l) => l.includes('Stamp `incomplete: true` in `<new>`'))
  only({ schedule: edit(real.schedule, S0, step, '  1. Note the new rollout.') }, ['interrupted-marker'], 'no stamp')
  const carry = s0.split('\n').find((l) => l.includes('reconcile-rollout.py carry --from'))
  only({ schedule: edit(edit(real.schedule, S0, step, '  1. Note the new rollout.'), S0, carry, `${carry}\n${step}`) },
    ['interrupted-marker'], 'stamp after the carry')
})

test('control: step 5 without the queued-only rule fails', () => {
  only({ schedule: edit(real.schedule, S5, 'Solo and dependency proposals apply only to tasks in the `queued` state',
    'Solo and dependency proposals apply to every candidate') }, ['step5-queued-only'], 'any candidate')
})

test('control: the pinned report without "never", without "is incomplete", or moved to step 8 fails', () => {
  only({ schedule: edit(real.schedule, S0, 'never `/thread:execute`d as written', '`/thread:execute`d as written') },
    ['interrupted-incomplete'], 'no never')
  only({ schedule: edit(real.schedule, S0, '**[[<new>]] is incomplete**', '**[[<new>]] was written**') },
    ['interrupted-incomplete'], 'no is incomplete')
  const s0 = section(real.schedule, S0)
  const line = s0.split('\n').find((l) => l.includes('is incomplete'))
  const moved = edit(real.schedule.replace(line, '  3. Print the pinned report.'), S8, '### 8. Print summary\n',
    `### 8. Print summary\n\n${line.trim()}\n`)
  only({ schedule: moved }, ['interrupted-incomplete'], 'moved to step 8')
})

test('control: step 1 without the carry preview fails', () => {
  only({ schedule: edit(real.schedule, S1, '<prior>.md --dry-run`', '<prior>.md`') }, ['step1-carry-preview'], 'no dry run')
})

test('control: step 6 that offers Overwrite fails, even beside an Advance/Cancel-only supersede', () => {
  only({ schedule: edit(real.schedule, S6, 'offer only **Advance** or **Cancel**, never **Overwrite**',
    'offer **Overwrite**, **Advance** or **Cancel**') }, ['step6-advance-cancel'], 'overwrite offered')
  only({ schedule: edit(real.schedule, S6, 'When today\'s name is taken, offer only',
    'To replace a note you just wrote in error, offer **Overwrite** (replace the same-day note). When this run supersedes, offer only') },
  ['step6-advance-cancel'], 'the old same-day Overwrite branch')
})

test('control: a description that drops the queue fails', () => {
  const d = description(real.schedule)
  only({ schedule: real.schedule.replace(d, d.replaceAll('queue', 'plan')) }, ['description'], 'no queue')
})

test('control: a manifest that still has schedule cluster parallel-safe waves fails', () => {
  only({ manifests: [real.manifests[0].replace('orders tasks into a queue', 'clusters tasks into parallel-safe waves'),
    real.manifests[1]] }, ['manifests'], 'plugin.json')
  only({ manifests: [real.manifests[0], real.manifests[1].replace('a queue of tasks', 'parallel-safe waves')] },
    ['manifests'], 'marketplace.json')
})

test('control: orient reading rollout state itself fails', () => {
  only({ orient: edit(real.orient, /^### 6\./, 'unfinished-rollout check', 'reconcile-rollout.py status read') },
    ['orient-defers'], 'orient reads status')
})
