// Shared helpers for the prose contract tests (tests/contracts/*.test.mjs) that read skill files as text.
// A missing file or section is null, so each test fails with a named assertion rather than crashing at load.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

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
