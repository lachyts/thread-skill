// Shared helpers for the prose contract tests (tests/contracts/*.test.mjs) that read skill files as text.
// A missing file or section is null, so each test fails with a named assertion rather than crashing at load.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// The file's text; throws when it does not exist. `p` is repo-relative.
export const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

// The file's text, or null when it does not exist. `p` is repo-relative.
export const readIf = (p) => (fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p), 'utf8') : null)

// Every file under the repo-relative directory `d`, repo-relative and sorted.
export const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]))
  .sort()

// The slice of `text` from the line matching `start` to the next line matching `stop` (exclusive), or
// null. A null `stop`, or no later match, runs to the end of the text.
export function slice(text, start, stop) {
  if (text == null) return null
  const lines = text.split('\n')
  const i = lines.findIndex((l) => start.test(l))
  if (i < 0) return null
  const j = stop == null ? -1 : lines.findIndex((l, k) => k > i && stop.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}

// Asserts `section` exists, then that it matches each pattern (a string is a substring check).
export function assertHas(section, name, patterns) {
  assert.ok(section != null, `${name} is missing`)
  for (const p of patterns) {
    const ok = typeof p === 'string' ? section.includes(p) : p.test(section)
    assert.ok(ok, `${name} does not contain ${p}`)
  }
}

// Every text file under the repo-relative directory `d`, with its text (a NUL byte marks a binary, skipped).
export const textFiles = (d) => walk(d)
  .map((file) => ({ file, text: readIf(file) }))
  .filter(({ text }) => text != null && !text.includes('\0'))

// The first line of `text` matching `re` (a string matches as a prefix), or null — null text included.
export const lineOf = (text, re) =>
  text?.split('\n').find((l) => (typeof re === 'string' ? l.startsWith(re) : re.test(l))) ?? null

// Whitespace collapsed to single spaces, so a reflowed line can neither hide nor fake a match.
export const collapse = (s) => s.replace(/\s+/g, ' ')

// The fence rule refs.test uses: a line opening with ``` or ~~~ (after whitespace) toggles.
export const FENCE = /^\s*(```|~~~)/

// Fenced blocks as arrays of their inner lines.
export function fencedBlocks(text) {
  const blocks = []
  let cur = null
  for (const l of text.split('\n')) {
    if (FENCE.test(l)) {
      if (cur) { blocks.push(cur); cur = null } else cur = []
      continue
    }
    if (cur) cur.push(l)
  }
  return blocks
}

// From the first line matching `startRe` up to (not including) the next `##`/`###` heading outside a
// fence, so a fenced example with a `## …` line inside it can't cut the section short. Null if absent.
export function section(text, startRe) {
  if (text == null) return null
  const lines = text.split('\n')
  const start = lines.findIndex((l) => startRe.test(l))
  if (start < 0) return null
  const out = [lines[start]]
  let inFence = false
  for (const l of lines.slice(start + 1)) {
    if (FENCE.test(l)) inFence = !inFence
    else if (!inFence && /^#{2,3} /.test(l)) break
    out.push(l)
  }
  return out.join('\n')
}

// How many skills the plugin ships: directories under skills/ holding a SKILL.md (`_shared` holds none).
export const skillCount = () => fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, 'skills', e.name, 'SKILL.md'))).length
