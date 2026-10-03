// Schedule orders a queue (ADR 0030 decision 1, p12-10): no colouring and no wave anywhere in the
// schedule skill or its template, protocol 5, the queue's stamps (`solo: true`, `depends-on:`), and the
// one-unfinished-rollout-per-repo rule wired into § 0 (the check, the supersede's `resume`, the `file`
// and `interrupted` finishes, the `incomplete: true` stamp and the pinned "is incomplete" report), the
// carry preview in step 1, a release gate's drop decided before step 6 (or, at step 8, taken out with its
// row), Solo and dependency proposals for queued tasks only (step 5), step 6's Advance/Cancel-only naming,
// a note born `incomplete: true` (the template) that only step 7's last write clears, and orient leaving
// the rule to schedule. Schedule speaks rungs, never tiers (ADR 0029, p13-3): § 4.7 offers a starting rung read
// from ladder.py and never lowers one, step 1's carry preview lists its `restamp` lines and stops on a refusal
// (a refused ladder included), step 7 stamps `rung:` and leaves a top-mapping legacy stamp under a refused
// ladder for step 8 to list, and the template's budget prices a top-rung start.
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
  manifests: [read('.claude-plugin/plugin.json'), read('.claude-plugin/marketplace.json'),
    read('README.md').split('\n').find((l) => l.startsWith('| `/thread:schedule`')) ?? ''],
}
const others = walk('skills/schedule').filter((f) => !/\/(SKILL|rollout-template)\.md$/.test(f)).map(read)

const s = (text, re) => collapse(section(text, re) ?? '')
const S0 = /^### 0\./
const S47 = /^### 4\.7\. /
const S1 = /^### 1\. /
const S35 = /^### 3\.5\. /
const S5 = /^### 5\. /
const S6 = /^### 6\. /
const S7 = /^### 7\. /
const S8 = /^### 8\. /
// Sentences of a collapsed text: split after `.`/`!`/`?` (and a closing quote) before whitespace.
const sentences = (text) => text.split(/(?<=[.!?]["”]?)\s+/)
const spans = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1])
// The text with backticked legacy `wave:` mentions stripped (the ADR 0030 migration strip): what is left
// must name no wave.
const waveLines = (text) => text.replace(/`wave:`/g, '').split('\n')
  .filter((l) => /wave/i.test(l))
const TIER_WORDS = ['max_tier', 'tier_capped', 'Opus 4.8', 'err toward fable']   // the tier vocabulary (ADR 0029): this file's one line of it
const description = (text) => (text.match(/^description: (.*)$/m) ?? [])[1] ?? ''
const frontmatter = (text) => (text.match(/^---\n([\s\S]*?)\n---\n/) ?? [])[1] ?? ''

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
  // The supersede's resume holds an undecided RACE or UNVERIFIED on the prior (exit 3): § 0 stops there, before
  // step 1, prints its HOLD lines and names repair; any other non-zero exit is still no stop.
  const prep = sentences(s0).find((x) => x.includes('Exit 3 (an undecided RACE or UNVERIFIED on the prior)')) ?? ''
  if (!check || !check.includes('--regenerate') || at('reconcile-rollout.py resume --rollout') < 0 ||
    at('reconcile-rollout.py resume --rollout') < at('unfinished-rollout.py check') ||
    !['is a stop: before step 1', '`HOLD:` lines', '`/thread:repair [[<prior>]]`'].every((k) => prep.includes(k)) ||
    !s0.includes('Any other non-zero exit (a gh failure) is no stop') || s0.includes('no § 0 stop follows it')) fails.push('s0-check')

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

  // Every rollout note is born incomplete: the template's frontmatter carries `incomplete: true`, and
  // step 7's last write (after every task stamp, before step 7.5) removes it. A run that stops anywhere
  // in between leaves a note `next` refuses (p12-10 round 3: the stamp replaces the link-back rule).
  if (!/^incomplete: true\b/m.test(frontmatter(template))) fails.push('born-incomplete')
  if (!sentences(s(schedule, S7)).some((x) => /\bremove\b/i.test(x) && x.includes('`incomplete: true`') &&
    x.includes('last write'))) fails.push('step7-clears-stamp')

  // A release gate's drop is decided before step 6, so a dropped task never gets a row; a drop at step 8
  // takes the task out whole (its `rollout:`, its `## Queue` row and its `## File-sets` line).
  if (!sentences(s(schedule, S35)).some((x) => /drop/i.test(x) && x.includes('before step 6') &&
    x.includes('no `## Queue` row'))) fails.push('gate-drop-before-write')
  if (!sentences(s(schedule, S8)).some((x) => /drop/i.test(x) && x.includes('`rollout:`') &&
    x.includes('`## Queue` row') && x.includes('`## File-sets` line'))) fails.push('gate-drop-whole')

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

  // The plugin manifests and README's schedule row describe schedule as ordering a queue, not
  // clustering or computing waves.
  if (manifests.some((m) => /parallel-safe waves|clusters tasks into|wave structure/i.test(m)) ||
    !(manifests[2] ?? '').includes('`protocol_version: 5`')) fails.push('manifests')

  // starting-rung: § 4.7 reads the rung names from ladder.py and offers `rung: <name>`; step 7 stamps `rung:` and
  // has no bullet adding a `model: fable` or an `effort:`.
  const s47 = s(schedule, S47)
  if (!s47.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/ladder.py`') || !s47.includes('Offer `rung: <name>` only for a task in the `queued` state') ||
    !s47.includes('The default offer is the rung just above the bottom') || !s7.includes('add `rung: <name>`') ||
    /add `model: fable`|add `effort:/.test(s7)) fails.push('starting-rung')

  // rung-no-lower: no offer for a task with a `rung:` or a `restamp … rung=<name>` preview line; it shows as kept and
  // changes only on Lachy's explicit naming.
  const noLower = sentences(s47).find((x) => x.includes('It makes no offer for a task that already has a non-empty `rung:`')) ?? ''
  if (!s47.includes('**§ 4.7 never lowers a rung.**') || !noLower.includes('`restamp <slug> rung=<name>`') ||
    !s47.includes('`<slug>: rung <name> (kept)`') || !s47.includes('Only Lachy explicitly naming a different listed rung changes it') ||
    !s47.includes('no default and no batch "y" ever writes a lower rung over it')) fails.push('rung-no-lower')

  // ladder-refused-preflight: under a refused ladder, step 7 still drops the drop-only keys but leaves a top-mapping
  // legacy stamp for execute's compat read; step 8's block shows ladder.py's stderr and the left-in-place tasks.
  const s8 = section(schedule, S8) ?? ''
  const pre = s8.slice(s8.indexOf('**Pre-flight — ladder refused.**'))
  if (!s7.includes('When `ladder.py` refused at schedule time, still remove the drop-only keys') ||
    !s7.includes('leave a top-mapping legacy stamp in place, unmapped') || !s7.includes("execute's compat read") ||
    s8.indexOf('**Pre-flight — ladder refused.**') < 0 || !collapse(pre).includes('show its stderr line verbatim') ||
    !pre.includes("— model: fable left for execute's compat read")) fails.push('ladder-refused-preflight')

  // no-tier: the skill and the template speak no tier: none of the tier words, no "step-up", no `model:` in the
  // template's frontmatter.
  if ([schedule, template].some((x) => TIER_WORDS.some((w) => x.toLowerCase().includes(w.toLowerCase()))) ||
    /step-ups?\b/i.test(schedule + template) || /^model:/m.test(frontmatter(template))) fails.push('no-tier')

  // step1-carry-refusal: a non-zero preview exit stops the run with its stderr, naming the refused ladder and its
  // remedy; the confirm lists the `restamp` lines with the carried list.
  const s1 = s(schedule, S1)
  if (!s1.includes('A non-zero preview exit stops the run before this run writes a rollout note or a task stamp: print its stderr verbatim') ||
    !s1.includes('a refused ladder file when a carried task needs the top rung') || !s1.includes('`~/.config/thread/ladder.toml` at the line named') ||
    !s1.includes('the carried list with its `restamp` lines')) fails.push('step1-carry-refusal')

  // rung-budget: the template prices a task whose implement stage starts on the top rung at max_iterations + 2,
  // one that climbs there during implement at 1 + max_iterations, with the review-loop caveat.
  const tb = collapse(template)
  if (!tb.includes("A task whose implement stage starts on the ladder's top rung costs more there") ||
    !tb.includes('spends `max_iterations + 2` on implement, against `1 + max_iterations` for a task that climbs to the top during implement') ||
    !tb.includes('`max_iterations + 2 + (max_review_rounds − 1) × max_iterations`')) fails.push('rung-budget')

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

test('control: a wave anywhere in the template fails, a legacy `wave:` does not', () => {
  only({ template: `${real.template}\nEach wave fans out across subagents.\n` }, ['no-wave'], 'template wave')
  only({ template: `${real.template}\nA **wave-shaped** cluster rolls out.\n` }, ['no-wave'], 'the retired term')
  only({ template: `${real.template}\nStep 7 clears any legacy \`wave:\`.\n` }, [], 'a legacy wave: strip')
})

test('control: step 7 without solo: true, or stamping wave:, fails', () => {
  only({ schedule: edit(real.schedule, S7, 'add `solo: true`', 'add `solo`') }, ['step7-stamps'], 'no solo')
  only({ schedule: edit(real.schedule, S7, 'For each task in the rollout:\n', 'For each task in the rollout:\n\n- Add `wave: <N>`\n') },
    ['no-wave', 'step7-stamps'], 'wave stamp')
})

test('control: a protocol 3 template fails', () => {
  only({ template: real.template.replace('protocol_version: 5', 'protocol_version: 3') }, ['protocol-5'], 'protocol 3')
})

test('control: a supersede prep that goes on past an undecided RACE fails s0-check', () => {
  only({ schedule: edit(real.schedule, S0, 'is a stop: before step 1 and\nbefore this run writes anything,', 'is no stop either:') }, ['s0-check'], 'RACE not a stop')
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

test('control: a template not born incomplete fails', () => {
  only({ template: real.template.replace(/^incomplete: true/m, '# incomplete: true') }, ['born-incomplete'], 'commented out')
})

test('control: step 7 that never clears the stamp, or clears it in step 7.5, fails', () => {
  const s7 = section(real.schedule, S7)
  const para = s7.split('\n').find((l) => l.includes('`incomplete: true`') && l.includes('last write'))
  assert.ok(para, 'control setup: the step-7 clear paragraph')
  only({ schedule: real.schedule.replace(para, '') }, ['step7-clears-stamp'], 'never cleared')
  const moved = edit(real.schedule.replace(para, ''), /^### 7\.5\. /, '### 7.5. Close out a superseded rollout\n',
    `### 7.5. Close out a superseded rollout\n\n${para}\n`)
  only({ schedule: moved }, ['step7-clears-stamp'], 'moved to step 7.5')
})

test('control: a gate dropped only at step 8, or dropped without its row, fails', () => {
  only({ schedule: edit(real.schedule, S35, 'leaves the candidate set before step 6', 'is dropped at step 8') },
    ['gate-drop-before-write'], 'dropped at step 8')
  only({ schedule: edit(real.schedule, S8, 'delete its `## Queue` row and its `## File-sets` line', 'leave the rest') },
    ['gate-drop-whole'], 'row left behind')
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

test('control: a manifest or README row that still has schedule build waves fails', () => {
  only({ manifests: [real.manifests[0].replace('orders tasks into a queue', 'clusters tasks into parallel-safe waves'),
    ...real.manifests.slice(1)] }, ['manifests'], 'plugin.json')
  only({ manifests: [real.manifests[0], real.manifests[1].replace('a queue of tasks', 'parallel-safe waves'),
    real.manifests[2]] }, ['manifests'], 'marketplace.json')
  only({ manifests: [real.manifests[0], real.manifests[1], real.manifests[2].replace('Orders the backlog into a queue',
    'Computes wave structure from file-overlap')] }, ['manifests'], 'README wave structure')
  only({ manifests: [...real.manifests.slice(0, 2), real.manifests[2].replace('`protocol_version: 5`', '`protocol_version: 3`')] },
    ['manifests'], 'README protocol 3')
})

test('control: step 7 that stamps model: fable again fails starting-rung', () => {
  only({ schedule: edit(real.schedule, S7, 'For each task in the rollout:\n',
    'For each task in the rollout:\n\n- For tasks the user confirmed as hard in step 4.7, add `model: fable`\n') }, ['starting-rung'], 'model: fable bullet')
})

test('control: § 4.7 without its never-lower sentence fails rung-no-lower', () => {
  only({ schedule: edit(real.schedule, S47, "It makes no offer for a task that already has a non-empty `rung:`, for one step 1's preview lists as " +
    '`restamp <slug> rung=<name>` (a name, not `-` or `kept`: carry writes that rung), or for a non-carried candidate whose legacy stamps map ' +
    'to the top rung (step 7). ', '') }, ['rung-no-lower'], 'no sentence')
})

test('control: step 8 without the ladder-refused block fails ladder-refused-preflight', () => {
  only({ schedule: edit(real.schedule, S8, '**Pre-flight — ladder refused.**', '**Pre-flight — other.**') }, ['ladder-refused-preflight'], 'no block')
})

test('control: a tier word in § 4.7 fails no-tier', () => {
  only({ schedule: edit(real.schedule, S47, 'Every task starts on', `${TIER_WORDS[2]} runs by default. Every task starts on`) }, ['no-tier'], 'tier word')
})

test('control: step 1 without its refusal sentence fails step1-carry-refusal', () => {
  only({ schedule: edit(real.schedule, S1, 'A non-zero preview exit stops the run before this run writes a rollout note or a task stamp: print its stderr verbatim.', '') },
    ['step1-carry-refusal'], 'no refusal')
})

test("control: the template's round-2 budget wording fails rung-budget", () => {
  only({ template: real.template.replace("A task whose implement stage starts on the ladder's top rung costs more there, not less",
    'A task on the top rung (stamped there, or climbed there) costs more there, not less') }, ['rung-budget'], 'round 2 wording')
})

test('control: orient reading rollout state itself fails', () => {
  only({ orient: edit(real.orient, /^### 6\./, 'unfinished-rollout check', 'reconcile-rollout.py status read') },
    ['orient-defers'], 'orient reads status')
})
