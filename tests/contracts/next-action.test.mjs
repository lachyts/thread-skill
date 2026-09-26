// The next-action slot (estate ADR 0008, decisions 4 and 7 — ~/repos/workspaces/_shared/docs/adr/
// 0008-next-action-slot.md; not this repo's ADR 0008). task-writer § 4b is the one set-down write: the
// capture's `next_action:` from the resume prompt's `Next move`, and `next_task:` on every project note
// the capture links, overwriting (most recent set-down wins, stash exactly like defer); close writes only
// for a concrete next task it never invents. stash, defer and close cite § 4b; open's pickup leaves both
// fields alone (a dead link reads as blank; nothing rewrites it); orient reads the slot first, frames its one
// recommendation as a proposal against it, and fills it only when blank. Reads files only; a missing
// file or section is a named assertion failure, never a crash at load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const readIf = (p) => (fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p), 'utf8') : null)
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]))
  .sort()

const WRITER = 'skills/_shared/task-writer.md'
const CLOSE = 'skills/close/SKILL.md'
const STASH = 'skills/stash/SKILL.md'
const DEFER = 'skills/defer/SKILL.md'
const OPEN = 'skills/open/SKILL.md'
const ORIENT = 'skills/orient/SKILL.md'
const ESTATE_ADR = '~/repos/workspaces/_shared/docs/adr/0008-next-action-slot.md'

// The slice of `text` from the line matching `start` to the next line matching `stop` (exclusive), or
// null. A null `stop` runs to the end of the text.
function slice(text, start, stop) {
  if (text == null) return null
  const lines = text.split('\n')
  const i = lines.findIndex((l) => start.test(l))
  if (i < 0) return null
  const j = stop == null ? -1 : lines.findIndex((l, k) => k > i && stop.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}

// Asserts `section` exists, then that it matches each pattern (a string is a substring check).
function assertHas(section, name, patterns) {
  assert.ok(section != null, `${name} is missing`)
  for (const p of patterns) {
    const ok = typeof p === 'string' ? section.includes(p) : p.test(section)
    assert.ok(ok, `${name} does not contain ${p}`)
  }
}

const s4b = () => slice(readIf(WRITER), /^## 4b\./, /^## 5\./)

test('task-writer § 4b is the set-down write', () => {
  assertHas(s4b(), `${WRITER} § 4b`, [
    ESTATE_ADR,
    /\*\*the most recent\s+set-down wins\.\*\*/,
    // Stash is not a weaker writer: it overwrites exactly as defer does.
    /Stash runs this\s+exactly as defer does/,
    // The task's line: grain rule, sourced from the resume prompt.
    /`next_action:` on the task/,
    /verb-first, one physical\s+action/,
    /resume\s+prompt's `Next move:` line/,
    // The project pointer: every linked project note, never an area note.
    /for every link in the task's\s+`projects:`/,
    'next_task: "[[<task-basename>]]"',
    /`tags:` include `project`/,
    /area landing note/,
    /touch nothing else in the note/,
    // The pointer never lands before its target.
    /the task file first, then the project notes/i,
  ])
})

test('task-writer § 4b gives close a no-invention form', () => {
  const close = slice(s4b(), /^\*\*Close's form\.\*\*/, /^$/)
  assertHas(close, `${WRITER} § 4b "Close's form"`, [
    /never invents one/,
    /found as § 2 finds a capture/,
    /a loose end never qualifies/,
    /write neither field and leave every\s+project slot as it is/,
  ])
})

test('task-writer § 4 frontmatter and § 2 re-capture carry next_action', () => {
  const s4 = slice(readIf(WRITER), /^## 4\./, /^## 4b\./)
  assertHas(s4, `${WRITER} § 4`, [/^next_action: .*4b below$/m])
  const s2 = slice(readIf(WRITER), /^## 2\./, /^## 3\./)
  assertHas(s2, `${WRITER} § 2`, [/rewrite § 4b's two fields/])
  const s7 = slice(readIf(WRITER), /^## 7\./, null)
  assertHas(s7, `${WRITER} § 7`, [/Next action: <the § 4b line>/, /next task on <Project>/])
})

test('the overwrite rule has one home under skills/', () => {
  const hits = walk('skills')
    .map((file) => ({ file, text: readIf(file) }))
    .filter(({ text }) => text != null && !text.includes('\0') && /most recent\s+set-down wins/.test(text))
    .map(({ file }) => file)
  assert.deepEqual(hits, [WRITER], `"most recent set-down wins" should occur only in ${WRITER}, found in: ${JSON.stringify(hits)}`)
})

test('stash, defer and close cite task-writer § 4b', () => {
  for (const [file, step] of [
    [STASH, /^1\. \*\*Write the capture task\*\*/],
    [DEFER, /^2\. \*\*Write the capture task\*\*/],
  ]) {
    const write = slice(readIf(file), step, /^\d+\. /)
    assertHas(write, `${file} "Write the capture task" step`, [
      'skills/_shared/task-writer.md', /§ 4b\b/, /`next_action:`/, /`next_task:`/, /estate ADR 0008/,
    ])
  }
  const close = readIf(CLOSE)
  const sub6 = close == null ? null : (close.split('\n').find((l) => /^ {3}6\. Approved vault tasks/.test(l)) ?? null)
  assertHas(sub6, `${CLOSE} step 7.6`, [
    'skills/_shared/task-writer.md', /§ 4b, close's form/, /estate ADR 0008/,
    /no concrete next task, write nothing and leave every project slot alone/,
  ])
  const step8 = close == null ? null : (close.split('\n').find((l) => /^8\. \*\*Print the "What landed" report/.test(l)) ?? null)
  assertHas(step8, `${CLOSE} step 8`, [/`next task: \[\[<task>\]\] on <Project>/, /`next task: none \(no concrete next task/])
})

test('open pickup leaves both fields alone', () => {
  const pickup = slice(readIf(OPEN), /^### `\/thread:open \[\[<task>\]\]`/, /^### /)
  const step3 = slice(pickup, /^3\. \*\*Complete the capture\*\*/, /^4\. /)
  assertHas(step3, `${OPEN} pickup step 3`, [
    /Leave the capture's `next_action:` and every project's `next_task:` untouched/,
    /dead link/,
    /every reader treats as blank and nothing rewrites/,
  ])
  assert.doesNotMatch(step3, /sweep/i, `${OPEN} pickup step 3 must not promise a sweep (estate ADR 0008 d5, amended)`)
  assert.doesNotMatch(step3, /\bclear/i, `${OPEN} pickup step 3 must not clear a next-action field`)
})

test('orient reads the slot first, proposes against it, fills only blanks', () => {
  const orient = readIf(ORIENT)
  const s2 = slice(orient, /^### 2\./, /^### 3\./)
  const first = s2 == null ? null : (s2.split('\n').find((l) => l.startsWith('- ')) ?? null)
  assertHas(first, `${ORIENT} § 2 first bullet`, [/^- \*\*Next-action slots, first\*\*/])
  assertHas(slice(s2, /^- \*\*Next-action slots/, /^- /), `${ORIENT} § 2 slot bullet`, [
    /`next_task:`/, /`next_action:`/, /\*\*dead link\*\*/, /reads as a blank slot/,
  ])
  assertHas(slice(orient, /^### 3\./, /^### 4\./), `${ORIENT} § 3`, [
    /`No next action`/, /\*\*proposal against the slot\*\*/, /never read as competing answers/,
  ])
  const write = slice(slice(orient, /^### 5\./, /^### 6\./), /^- \*\*The slot write\*\*/, /^- /)
  assertHas(write, `${ORIENT} § 5 slot write`, [
    /fill-blank only/, /estate ADR 0008/, /whose slot is\s+blank/, /only\s+if it is blank/,
    /A set slot is never overwritten/, /task-writer\.md`\s+§ 4b/,
  ])
  assertHas(slice(orient, /^### 5\./, /^### 6\./), `${ORIENT} § 5`, [/\*\*Report-only\*\* → done, no writes \(the slot write included\)/])
})

test('CONTEXT.md defines the next-action vocabulary', () => {
  const ctx = readIf('CONTEXT.md')
  assertHas(ctx, 'CONTEXT.md', [
    /^- \*\*Set-down\*\* — /m, /^- \*\*Next action\*\* — /m, /^- \*\*Next task\*\* — /m,
    '~/repos/workspaces/_shared/CONTEXT.md` § Next action',
  ])
})
