// Schedule supersede contract: when `--regenerate` replaces an earlier rollout, schedule step 7.5 stamps
// the prior note (`status: done` + `superseded_by:`) and then moves it into Work/Tasks/Archive/Rollouts/
// itself. Left in the Work/Tasks/ root at `status: done`, the daily sweep's archiver files it into
// Work/Tasks/Archive/ (TaskNotes auto-archives only `merged`, never `done`), the wrong folder for a
// rollout. The planner runs no git (its Don'ts), so the plain `mv` is committed by the daily sweep.
//
// Every paragraph rule lives in one pure function, checkSupersede, that returns named failures, so the
// real paragraph and the control cases run through identical logic and the matcher can't pass
// vacuously. Phrase checks run on whitespace-collapsed text; the paragraph is sliced fence-aware.
// Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const schedule = read('skills/schedule/SKILL.md')
const execute = read('skills/execute/SKILL.md')
const template = read('skills/schedule/rollout-template.md')

const collapse = (s) => s.replace(/\s+/g, ' ').trim()
// The fence rule refs.test uses: a line opening with ``` or ~~~ (after whitespace) toggles.
const FENCE = /^\s*(```|~~~)/

const LABEL = '**Superseding a prior rollout.**'
const ROLLOUTS = 'Work/Tasks/Archive/Rollouts/'

// From the line containing `label` up to (not including) the next blank line or `##`/`###` heading
// outside a fence.
function paragraph(text, label) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.includes(label))
  assert.ok(start >= 0, `no line contains ${label}`)
  const out = [lines[start]]
  let inFence = false
  for (const l of lines.slice(start + 1)) {
    if (FENCE.test(l)) inFence = !inFence
    else if (!inFence && (/^\s*$/.test(l) || /^#{2,3} /.test(l))) break
    out.push(l)
  }
  return out.join('\n')
}

// Clauses of a collapsed paragraph: split on `;` and on sentence ends (`. ` before a capital, a
// backtick or `*`). Each clause keeps its start offset in the paragraph.
function clauses(para) {
  const out = []
  const SPLIT = /;\s*|\.\s+(?=[A-Z`*])/g
  let from = 0
  let m
  while ((m = SPLIT.exec(para)) !== null) {
    out.push({ text: para.slice(from, m.index), at: from })
    from = m.index + m[0].length
  }
  out.push({ text: para.slice(from), at: from })
  return out
}

const BARE = /Work\/Tasks\/Archive\/(?!Rollouts)/g
const MOVE = /\bmv\b|\bmove\b/i

// Named failures for a supersede paragraph; [] means it holds every rule.
function checkSupersede(raw) {
  const para = collapse(raw)
  const cs = clauses(para)
  const fails = []

  // stamps: the new note's back-pointer and the prior note's close-out stamps.
  if (!['supersedes:', 'status: done', 'superseded_by:'].every((k) => para.includes(k))) fails.push('stamps')

  // move-dest: one clause both moves the note and names Archive/Rollouts/ as where it goes.
  const moveDest = cs.find((c) => MOVE.test(c.text) && c.text.includes(ROLLOUTS))
  if (!moveDest) fails.push('move-dest')

  // no-wrong-dest: bare Work/Tasks/Archive/ appears only as the daily sweep's filing target or as a move
  // source ("from `Work/Tasks/Archive/…`"), never as the move's destination.
  const wrong = cs.some((c) => [...c.text.matchAll(BARE)].some((m) => {
    if (/daily sweep/i.test(c.text)) return false
    return !/\bfrom\b/.test(c.text.slice(Math.max(0, m.index - 12), m.index))
  }))
  if (wrong) fails.push('no-wrong-dest')

  // order: stamps before the move, so a half-done step leaves a stamped note the reconciler can see.
  const stampAt = para.indexOf('superseded_by:')
  if (!moveDest || stampAt < 0 || stampAt >= moveDest.at) fails.push('order')

  // mechanism: the daily sweep is named, and no auto-archive claim (TaskNotes' or anyone's) remains.
  if (!/daily sweep/i.test(para) || /auto-archiv/i.test(para)) fails.push('mechanism')

  // no-git: the planner's Don'ts forbid git, so the move is a plain `mv` the daily sweep commits. Every
  // commit instruction in the paragraph is attributed to the daily sweep in its own clause, and some
  // clause names the daily sweep as the committer ("Then commit the vault." is the copy-paste risk).
  const commits = cs.filter((c) => /\bcommit/i.test(c.text))
  if (/\bgit\s+(mv|add|commit|push)\b/.test(para) || commits.length === 0 ||
    !commits.every((c) => /daily sweep/i.test(c.text))) fails.push('no-git')

  // mkdir: the destination folder is created in the move's own clause when absent.
  if (!cs.some((c) => c.text.includes('`mkdir -p`') && c.text.includes('Archive/Rollouts/'))) fails.push('mkdir')

  // pickup: a prior note the daily sweep already filed into bare Archive/ is moved on from there (the
  // chorus-rollout-2026-09-21 incident).
  if (!cs.some((c) => c.text.includes('Work/Tasks/Archive/<prior-slug>.md') && MOVE.test(c.text) &&
    /\bfrom there\b/.test(c.text))) fails.push('pickup')

  // leave-in-place: a prior note already in Archive/Rollouts/ is left where it is.
  if (!cs.some((c) => /already in `[^`]*Archive\/Rollouts\/`/.test(c.text) && /\bleave it\b/i.test(c.text))) {
    fails.push('leave-in-place')
  }

  // no-overwrite: a same-named file already archived is never clobbered; the negation sits in the same
  // clause as the Rollouts folder or "same-named", so inverted wording fails.
  if (!cs.some((c) => /\b(never|don't|do not)\s+overwrite\b/i.test(c.text) &&
    (c.text.includes('Archive/Rollouts/') || /same-named/i.test(c.text)))) fails.push('no-overwrite')

  // collision: a collision skips only the move and the run continues (step 7 must still re-stamp the
  // tasks); no clause about the collision halts the run.
  const coll = cs.filter((c) => /collision/i.test(c.text))
  if (!coll.some((c) => /\bskip\b/i.test(c.text) && /\bcontinue\b/i.test(c.text)) ||
    coll.some((c) => /\b(stop|halt|abort)\b/i.test(c.text))) fails.push('collision')

  // overwrite-excluded: the same-day **Overwrite** path (same slug) stamps and moves nothing, or the
  // vault ends up with two same-named notes and the filename-based wikilinks break.
  if (!cs.some((c) => c.text.includes('**Overwrite**') && /stamp nothing/i.test(c.text) &&
    /move nothing/i.test(c.text))) fails.push('overwrite-excluded')
  return fails
}

const real = paragraph(schedule, LABEL)

test('schedule step 7.5: the supersede paragraph stamps, then moves the prior note into Archive/Rollouts/', () => {
  assert.deepEqual(checkSupersede(real), [])
})

test('schedule Don\'ts still forbid git from the planner (the supersede move relies on it)', () => {
  assert.ok(collapse(schedule).includes("Don't run `git` operations"),
    'schedule lost its no-git Don\'t; the supersede paragraph and the Don\'ts must change together')
})

test('schedule, execute and the rollout template agree on the rollout archive folder', () => {
  for (const [name, text] of [['schedule supersede paragraph', real], ['execute SKILL.md', execute],
    ['rollout-template.md', template]]) {
    assert.ok(collapse(text).includes(ROLLOUTS), `${name} no longer names ${ROLLOUTS}`)
  }
})

// ---- controls: the matcher must reject each known-bad shape ------------------------------------

// A synthetic paragraph that holds every rule; each control below breaks exactly one clause of it and
// must fail with exactly the rule that clause pins.
const GOOD = [
  `${LABEL} When \`--regenerate\` replaces an earlier rollout, stamp \`supersedes: "[[<prior>]]"\` in this note's ` +
    'frontmatter, and close out the prior rollout, stamps first and then the move.',
  'None of this applies on the same-day **Overwrite** path: when the prior rollout is the note being overwritten ' +
    '(same slug), stamp nothing and move nothing.',
  'Set `status: done` + `superseded_by: "[[<this>]]"` on the prior note.',
  'Then move it with a plain `mv` into `~/repos/obsidian/Work/Tasks/Archive/Rollouts/`, running `mkdir -p` on ' +
    'that folder first if it is absent.',
  'Left in `Work/Tasks/` the daily sweep would file it into `Work/Tasks/Archive/`, the wrong folder.',
  'Find the prior note wherever it sits: `Work/Tasks/<prior-slug>.md` is the normal case; at ' +
    '`Work/Tasks/Archive/<prior-slug>.md` the daily sweep already filed it, so move it on from there; already in ' +
    '`Work/Tasks/Archive/Rollouts/`, leave it where it is.',
  'Never overwrite a same-named file already in `Archive/Rollouts/`: on a collision skip only the move, report the ' +
    'collision and continue the run.',
  'Schedule leaves the commit to the daily sweep (the planner runs no git).',
]
const para = (...parts) => parts.join(' ')
const swap = (i, text) => para(...GOOD.map((p, j) => (j === i ? text : p)))
const drop = (i) => para(...GOOD.filter((_, j) => j !== i))

test('control baseline: the synthetic paragraph holds every rule', () => {
  assert.deepEqual(checkSupersede(para(...GOOD)), [])
})

const onlyFails = (text, rules, label) => assert.deepEqual(checkSupersede(text), rules, `${label}`)

test('control A: the old wording (auto-archive claim, no move) fails', () => {
  const text = `${LABEL} When \`--regenerate\` replaces an earlier rollout, stamp \`supersedes: "[[<prior>]]"\` in ` +
    `this note's frontmatter, and close out the prior rollout: set \`status: done\` (TaskNotes only knows \`open\` / ` +
    `\`in-progress\` / \`done\`, and \`done\` auto-archives it out of the open list) + \`superseded_by: "[[<this>]]"\` ` +
    'to record *why* it closed. Its already-landed tasks stay `done`; its still-open tasks are re-planned into this rollout.'
  const fails = checkSupersede(text)
  for (const f of ['move-dest', 'mechanism', 'no-overwrite', 'pickup', 'leave-in-place']) {
    assert.ok(fails.includes(f), `control A missed ${f}: ${fails}`)
  }
})

test('control B: moving into bare Work/Tasks/Archive/ fails', () => {
  onlyFails(swap(3, 'Then move it with a plain `mv` into `Work/Tasks/Archive/`, running `mkdir -p` on ' +
    '`Archive/Rollouts/` first if it is absent.'), ['move-dest', 'no-wrong-dest', 'order'], 'control B')
})

test('control C: the right folder via git fails', () => {
  onlyFails(swap(7, 'Then `git commit` the move; the daily sweep does the rest.'), ['no-git'], 'control C')
})

test('control D: an unattributed "Then commit the vault." fails no-git', () => {
  onlyFails(swap(7, 'Then commit the vault.'), ['no-git'], 'control D')
})

test('control E: a valid Rollouts move placed before the superseded_by: stamp fails order', () => {
  const text = para(GOOD[0], GOOD[1], GOOD[3], GOOD[2], ...GOOD.slice(4))
  onlyFails(text, ['order'], 'control E')
})

test('control F: inverted overwrite wording fails no-overwrite', () => {
  onlyFails(swap(6, 'Overwrite any same-named file already in `Archive/Rollouts/`: on a collision skip only the ' +
    'move, report the collision and continue the run.'), ['no-overwrite'], 'control F')
})

test('control G: no pickup from bare Archive/ fails pickup', () => {
  onlyFails(swap(5, 'Find the prior note wherever it sits: `Work/Tasks/<prior-slug>.md` is the normal case; ' +
    'already in `Work/Tasks/Archive/Rollouts/`, leave it where it is.'), ['pickup'], 'control G')
})

test('control H: no leave-in-place for a note already in Archive/Rollouts/ fails leave-in-place', () => {
  onlyFails(swap(5, 'Find the prior note wherever it sits: `Work/Tasks/<prior-slug>.md` is the normal case; at ' +
    '`Work/Tasks/Archive/<prior-slug>.md` the daily sweep already filed it, so move it on from there.'),
  ['leave-in-place'], 'control H')
})

test('control I: no mkdir -p for the destination fails mkdir', () => {
  onlyFails(swap(3, 'Then move it with a plain `mv` into `~/repos/obsidian/Work/Tasks/Archive/Rollouts/`.'),
    ['mkdir'], 'control I')
})

test('control J: a collision that halts the run fails collision', () => {
  onlyFails(swap(6, 'Never overwrite a same-named file already in `Archive/Rollouts/`: stop and report the ' +
    'collision instead.'), ['collision'], 'control J')
})

test('control K: a supersede on the same-day Overwrite path fails overwrite-excluded', () => {
  onlyFails(drop(1), ['overwrite-excluded'], 'control K')
})

// ---- order: write, carry, stamp, then close out (p12-10) -----------------------------------------
// A supersede writes the new note in step 6 and only then carries the prior note's unlanded tasks
// into it (`reconcile-rollout.py carry`), so no task ever points at a missing rollout; step 7 stamps the
// tasks; the prior note closes out last (step 7.5, the LABEL paragraph), so an interrupted run always
// leaves it open for § 0's unfinished-rollout check to pair with the new one. Pure, like checkSupersede.

// The lines of the `###`-headed section whose heading line matches `re`, up to the next `##`/`###`
// heading outside a fence ('' when absent).
function sectionOf(text, re) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => re.test(l))
  if (start < 0) return ''
  const out = [lines[start]]
  let inFence = false
  for (const l of lines.slice(start + 1)) {
    if (FENCE.test(l)) inFence = !inFence
    else if (!inFence && /^#{2,3} /.test(l)) break
    out.push(l)
  }
  return out.join('\n')
}

function checkSupersedeOrder(text) {
  const fails = []
  // carry-in-6: one step-6 sentence runs the carry (not the --dry-run preview) once the note is written.
  const six = collapse(sectionOf(text, /^### 6\. /))
  if (!six.split(/(?<=[.!?])\s+/).some((x) => /reconcile-rollout\.py carry --from/.test(x) && !/--dry-run/.test(x) &&
    /\bwritten\b/.test(x))) fails.push('carry-in-6')
  // close-out-last: the LABEL paragraph sits after the step-7 heading and says it runs after step 7.
  const lines = text.split('\n')
  const seven = lines.findIndex((l) => /^### 7\. /.test(l))
  const label = lines.findIndex((l) => l.includes(LABEL))
  if (seven < 0 || label < seven || !/after step 7\b/.test(collapse(paragraph(text, LABEL)))) fails.push('close-out-last')
  return fails
}

test('schedule writes the new note, carries into it, stamps, then closes out the prior rollout last', () => {
  assert.deepEqual(checkSupersedeOrder(schedule), [])
})

const ORDER_GOOD = [
  '### 6. Write the rollout note', '',
  'Once this note is written, run `python3 x/reconcile-rollout.py carry --from <prior>.md --to <this>.md`. It re-points the tasks.', '',
  '### 7. Update each task\'s frontmatter', '', 'Stamp every task.', '',
  '### 7.5. Close out a superseded rollout', '',
  `${LABEL} Close out the prior rollout last, after step 7 has stamped this rollout's tasks.`, '',
  '### 8. Print summary', '',
].join('\n')

test('control baseline: the synthetic order holds every rule', () => {
  assert.deepEqual(checkSupersedeOrder(ORDER_GOOD), [])
})

test('control: no carry in step 6 fails carry-in-6', () => {
  assert.deepEqual(checkSupersedeOrder(ORDER_GOOD.replace(/Once this note is written, run `[^`]*`\./, 'Write it.')), ['carry-in-6'])
})

test('control: a carry that does not wait for the written note fails carry-in-6', () => {
  assert.deepEqual(checkSupersedeOrder(ORDER_GOOD.replace('Once this note is written, run', 'Run')), ['carry-in-6'])
})

test('control: the close-out paragraph inside step 6 fails close-out-last', () => {
  const para = `${LABEL} Close out the prior rollout last, after step 7 has stamped this rollout's tasks.`
  const moved = ORDER_GOOD.replace(`${para}\n`, '').replace('It re-points the tasks.\n', `It re-points the tasks.\n\n${para}\n`)
  assert.deepEqual(checkSupersedeOrder(moved), ['close-out-last'])
})

test('control: a close-out paragraph that does not say "after step 7" fails close-out-last', () => {
  assert.deepEqual(checkSupersedeOrder(ORDER_GOOD.replace(', after step 7 has stamped this rollout\'s tasks', '')), ['close-out-last'])
})
