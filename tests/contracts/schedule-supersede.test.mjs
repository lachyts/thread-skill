// Schedule supersede contract: when `--regenerate` replaces an earlier rollout, schedule step 6 stamps
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

  // no-git: the planner's Don'ts forbid git, so the move is a plain `mv` the sweep commits.
  if (/git (mv|add|commit)\b/.test(para)) fails.push('no-git')

  // no-overwrite: a same-named file already archived is never clobbered.
  if (!cs.some((c) => /overwrite/i.test(c.text) && (c.text.includes('Archive/Rollouts/') || /same-named/i.test(c.text)))) {
    fails.push('no-overwrite')
  }
  return fails
}

const real = paragraph(schedule, LABEL)

test('schedule step 6: the supersede paragraph stamps, then moves the prior note into Archive/Rollouts/', () => {
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

const PRE = `${LABEL} When \`--regenerate\` replaces an earlier rollout, stamp \`supersedes: "[[<prior>]]"\` in this ` +
  `note's frontmatter, and close out the prior rollout: set \`status: done\` + \`superseded_by: "[[<this>]]"\`.`

test('control A: the old wording (auto-archive claim, no move) fails', () => {
  const para = `${LABEL} When \`--regenerate\` replaces an earlier rollout, stamp \`supersedes: "[[<prior>]]"\` in ` +
    `this note's frontmatter, and close out the prior rollout: set \`status: done\` (TaskNotes only knows \`open\` / ` +
    `\`in-progress\` / \`done\`, and \`done\` auto-archives it out of the open list) + \`superseded_by: "[[<this>]]"\` ` +
    'to record *why* it closed. Its already-landed tasks stay `done`; its still-open tasks are re-planned into this rollout.'
  const fails = checkSupersede(para)
  for (const f of ['move-dest', 'mechanism', 'no-overwrite']) assert.ok(fails.includes(f), `control A missed ${f}: ${fails}`)
})

test('control B: moving into bare Work/Tasks/Archive/ fails even with Rollouts named elsewhere', () => {
  const para = `${PRE} Then \`mv\` it into \`Work/Tasks/Archive/\`. Never overwrite a same-named file in ` +
    '`Work/Tasks/Archive/Rollouts/`. The daily sweep commits the vault.'
  const fails = checkSupersede(para)
  for (const f of ['move-dest', 'no-wrong-dest']) assert.ok(fails.includes(f), `control B missed ${f}: ${fails}`)
})

test('control C: the right folder via git fails', () => {
  const para = `${PRE} Then \`git mv\` it into \`Work/Tasks/Archive/Rollouts/\` and \`git commit\`. Never overwrite a ` +
    'same-named file in `Archive/Rollouts/`. The daily sweep does the rest.'
  assert.ok(checkSupersede(para).includes('no-git'))
})
