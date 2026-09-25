// Lean capture and project multi-match (thread-skill-p2-5). task-writer § 5 carries the one Lean capture
// rule: a 10-non-empty-line ceiling on `## Notes`, no research-family section on the task note, and at
// most one research pointer whose landing is offered in the route's own confirmation (task-writer § 7
// for stash and defer, close's "What landed" report for close). task-writer § 1.1 and process-scan rung 2
// both handle a `repos:` lookup that matches more than one project note. A lost clause, a restated
// ceiling or a dropped offer channel fails here. The file also pins the one project-note glob shared by
// the three `repos:` lookup sites (task-writer § 1.1, process-scan rung 2, orient § 1), so a nested
// sub-project note is seen by all of them, rejects any shallower `Work/Projects/` glob under skills/, and
// pins orient's sweep of project-tagged notes at any depth and its area source (`area:` frontmatter
// first, as process-scan rung 3). Reads files only; a missing file or section is a named
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
const STASH = 'skills/stash/SKILL.md'
const DEFER = 'skills/defer/SKILL.md'
const ORIENT = 'skills/orient/SKILL.md'
// The project-note set every `repos:` lookup greps: every depth, so nested sub-project notes are seen.
const PROJECT_GLOB = '~/repos/obsidian/Work/Projects/**'

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

// The backticked glob after "`repos:` frontmatter across" in `section`, or null.
function globOf(section) {
  const m = section == null ? null : section.match(/`repos:` frontmatter across\s+`([^`]+)`/)
  return m == null ? null : m[1]
}

test('task-writer § 5 carries the Lean capture rule', () => {
  // Sliced from the rule's own paragraph, so a clause elsewhere in § 5 cannot stand in for it.
  const lean = slice(readIf(WRITER), /^\*\*Lean capture\.\*\*/, /^## 6\./)
  assertHas(lean, `${WRITER} § 5 Lean capture`, [
    '10 non-empty lines',
    'add-writers/research-landing.md',
    /No research-family section goes on the task\s+note/,
    /no tables of results, no\s+logs, no transcripts/,
    /never blocks the exit/,
    /Superseded by handoff/,
    /What landed/,
    // The ceiling names the vault hook's scope without claiming it polices Notes.
    /the\s+hook does not police `## Notes`, this spec does/,
    // A re-capture never destroys a pre-existing research section; it offers the landing instead.
    /leaves any pre-existing\s+research-family section untouched/,
    /never deleted, moved\s+or\s+condensed/,
    // The landing offer fires only for research not yet landed.
    /Only research not yet landed earns the\s+landing offer/,
    /never for an\s+already-landed digest/,
  ])
  assert.doesNotMatch(lean, /git history/, `${WRITER} § 5 Lean capture must not point research at vault git history`)
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
  // (b) close step 8 carries the research-landing offer, for unlanded research only.
  const step8 = close == null ? null : (close.split('\n').find((l) => /^8\. \*\*Print the "What landed" report/.test(l)) ?? null)
  assertHas(step8, `${CLOSE} step 8`, [
    'research-landing offer', /`task-writer\.md` § 5/, 'unlanded', /never for an already-landed digest/,
  ])
  // (c) task-writer § 7 is the offer channel for stash and defer, for unlanded research only.
  const s7 = slice(readIf(WRITER), /^## 7\./, null)
  assertHas(s7, `${WRITER} § 7`, [/research-landing offer/, /§ 5/, /unlanded/, /never\s+for\s+an\s+already-landed digest/])
  // (d) stash and defer inherit the rule by citing task-writer § 5 (the body) and § 7 (the confirmation).
  for (const [file, body, confirm] of [
    [STASH, /^1\. \*\*Write the capture task\*\*/, /^3\. \*\*Confirm\*\* per § 7/],
    [DEFER, /^2\. \*\*Write the capture task\*\*/, /^4\. \*\*Confirm\*\* per § 7/],
  ]) {
    const text = readIf(file)
    const write = slice(text, body, /^\d+\. /)
    assertHas(write, `${file} "Write the capture task" step`, ['skills/_shared/task-writer.md', /§ 5\b/])
    const conf = text == null ? null : (text.split('\n').find((l) => confirm.test(l)) ?? null)
    assert.ok(conf != null, `${file} has no "Confirm per § 7" step`)
  }
})

test('the three repos: lookup sites share one project-note glob', () => {
  const sites = [
    [`${WRITER} § 1 item 1`, slice(slice(readIf(WRITER), /^## 1\./, /^## 2\./), /^1\. /, /^2\. /)],
    [`${SCAN} § Project directory resolution rung 2`,
      slice(slice(readIf(SCAN), /^## Project directory resolution/, /^## (?!Project directory resolution)/), /^2\. /, /^3\. /)],
    [`${ORIENT} § 1 "Bare invocation" bullet`,
      slice(slice(readIf(ORIENT), /^### 1\. Resolve the target/, /^### 2\./), /^- \*\*Bare invocation\*\*/, /^- /)],
  ]
  for (const [name, section] of sites) {
    assert.ok(section != null, `${name} is missing`)
    const glob = globOf(section)
    assert.equal(glob, PROJECT_GLOB, `${name} greps \`repos:\` across ${JSON.stringify(glob)}, expected ${PROJECT_GLOB}`)
  }
})

// Every `Work/Projects/…` path token in `text` that is a glob (has a `*`) but never descends (no `**`),
// e.g. `Work/Projects/*.md`, `Work/Projects/<Area>/*.md` or `Work/Projects/*/*.md`. A literal path such
// as split's write path `Work/Projects/<Area>/<Project>.md` has no `*` and is not a hit.
function shallowGlobs(text) {
  return (text.match(/Work\/Projects\/[^\s`'")\]]*/g) ?? []).filter((t) => t.includes('*') && !t.includes('**'))
}

test('no skill greps a Work/Projects glob that stops short of every depth', () => {
  const hits = walk('skills')
    .map((file) => ({ file, text: readIf(file) }))
    .filter(({ text }) => text != null && !text.includes('\0'))
    .flatMap(({ file, text }) => shallowGlobs(text).map((glob) => `${file}: ${glob}`))
  assert.deepEqual(hits, [], `depth-limited Work/Projects glob (a single-\`*\` segment, no \`**\`) found in: ${JSON.stringify(hits)}`)
})

test('the glob check rejects every shallow shape and passes literal paths', () => {
  for (const bad of ['Work/Projects/*.md', 'Work/Projects/<Area>/*.md', '`~/repos/obsidian/Work/Projects/*/*.md`']) {
    assert.equal(shallowGlobs(bad).length, 1, `${bad} should be flagged`)
  }
  for (const ok of ['`~/repos/obsidian/Work/Projects/**`', '`~/repos/obsidian/Work/Projects/<Area>/<Project>.md`']) {
    assert.deepEqual(shallowGlobs(ok), [], `${ok} should pass`)
  }
})

test('orient § 2 Vault sweeps project notes at any depth', () => {
  const s2 = slice(readIf(ORIENT), /^### 2\./, /^### 3\./)
  const vault = slice(s2, /^- \*\*Vault\*\*/, /^- /)
  assertHas(vault, `${ORIENT} § 2 "Vault" bullet`, [
    /at any\s+depth/,
    // A sub-project note is a project-tagged note, so the sweep skips reference and garden notes.
    /frontmatter `tags:` includes `project`/,
    'the vault folder',
  ])
  const threads = slice(s2, /^- \*\*Threads\*\*/, /^- /)
  assertHas(threads, `${ORIENT} § 2 "Threads" bullet`, ['`~/Projects/<Area>/*/THREAD.md`'])
})

test('orient § 1 and process-scan rung 3 agree on the area source', () => {
  const rung3 = slice(slice(readIf(SCAN), /^## Project directory resolution/, /^## (?!Project directory resolution)/),
    /^3\. /, /^\d+\. |^$/)
  assertHas(rung3, `${SCAN} § Project directory resolution rung 3`, [
    /its `area:` frontmatter, else the `Work\/Projects\/<Area>\/` folder it sits in/,
  ])
  const s1 = slice(readIf(ORIENT), /^### 1\. Resolve the target/, /^### 2\./)
  const rule = slice(s1, /^- \*\*Vault folder and area\*\*/, /^- /)
  assertHas(rule, `${ORIENT} § 1 "Vault folder and area" bullet`, [
    /for a note matched by either route/,
    /top-level `Work\/Projects\/<Folder>\/` the note sits in, at any\s+depth, never its parent folder/,
    /The area is the note's `area:` frontmatter,\s+else that folder/,
    /process-scan rung 3/,
  ])
  assert.doesNotMatch(s1, /never[^.]*`area:` frontmatter/, `${ORIENT} § 1 must not rule out the \`area:\` frontmatter`)
})
