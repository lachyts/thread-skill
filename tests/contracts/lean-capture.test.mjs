// Lean capture and project multi-match (thread-skill-p2-5). task-writer § 5 carries the one Lean capture
// rule: a 10-non-empty-line ceiling on `## Notes`, no research-family section on the task note, and at
// most one research pointer whose landing is offered in the route's own confirmation (task-writer § 7
// for stash and defer, close's "What landed" report for close). task-writer § 1.1 and process-scan rung 2
// both handle a `repos:` lookup that matches more than one project note. A lost clause, a restated
// ceiling or a dropped offer channel fails here. Reads files only; a missing file or section is a named
// assertion failure, never a crash at load.
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
const SCAN = 'skills/_shared/process-scan.md'
const CLOSE = 'skills/close/SKILL.md'

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

test('task-writer § 5 carries the Lean capture rule', () => {
  const s5 = slice(readIf(WRITER), /^## 5\./, /^## 6\./)
  assertHas(s5, `${WRITER} § 5`, [
    /^\*\*Lean capture\.\*\*/m,
    '10 non-empty lines',
    'add-writers/research-landing.md',
    '## Findings',
    /never blocks the exit/,
    /Superseded by handoff/,
    /What landed/,
    /written before this rule/,
  ])
})

test('the "10 non-empty lines" ceiling has one home under skills/', () => {
  const hits = walk('skills')
    .map((file) => ({ file, text: readIf(file) }))
    .filter(({ text }) => text != null && !text.includes('\0') && text.includes('10 non-empty lines'))
    .map(({ file }) => file)
  assert.deepEqual(hits, [WRITER], `"10 non-empty lines" should occur only in ${WRITER}, found in: ${JSON.stringify(hits)}`)
})

test('task-writer § 1 item 1 handles more than one repos: match', () => {
  const item1 = slice(slice(readIf(WRITER), /^## 1\./, /^## 2\./), /^1\. /, /^2\. /)
  assertHas(item1, `${WRITER} § 1 item 1`, [
    /exactly one match/i,
    /more than one match/i,
    /§ 1\.2–1\.4/,
    /among the matches/,
    /no match → § 1\.2/i,
  ])
})

test('process-scan rung 2 narrows a multi-match silently', () => {
  const rung2 = slice(slice(readIf(SCAN), /^## Project directory resolution/, /^## (?!Project directory resolution)/),
    /^2\. /, /^3\. /)
  assertHas(rung2, `${SCAN} § Project directory resolution rung 2`, [
    /more than one match/i,
    /THREAD\.md/,
    /conversation/,
    /never ask/i,
    /no project directory/,
    /skips its project step/,
  ])
})

test('every exit route carries the rule and the offer channel', () => {
  const close = readIf(CLOSE)
  // (a) close's follow-up task row obeys Lean capture.
  const dest = slice(close, /^## Destinations/, /^## (?!Destinations)/)
  const row = dest == null ? null : (dest.split('\n').find((l) => l.startsWith('| Concrete follow-up actions')) ?? null)
  assertHas(row, `${CLOSE} § Destinations "Concrete follow-up actions" row`, [
    'task-writer.md', /§§ 1 & 4/, /§ 5\b/, 'Lean capture',
  ])
  // (b) close step 8 carries the research-landing offer.
  const step8 = close == null ? null : (close.split('\n').find((l) => /^8\. \*\*Print the "What landed" report/.test(l)) ?? null)
  assertHas(step8, `${CLOSE} step 8`, ['research-landing offer', /`task-writer\.md` § 5/])
  // (c) task-writer § 7 is the offer channel for stash and defer.
  const s7 = slice(readIf(WRITER), /^## 7\./, null)
  assertHas(s7, `${WRITER} § 7`, [/research-landing offer/, /§ 5/])
})
