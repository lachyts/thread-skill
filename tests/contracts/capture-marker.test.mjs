// The capture marker (p19-8). stash and defer stamp `capture: continuation` on the captures they write
// (task-writer § 4); `next-action.py captures` reports it as the `marked` match (its behaviour is
// tests/next-action.test.mjs); handoff's **Open captures.** supersedes only a marked capture that also
// matches the thread deterministically. An unmarked hit (every capture written before the marker, or a
// backlog task that merely carries the thread link, like chorus-misstep-walk-and-knob on the 2026-09-25
// Chorus handoff) is left open and reported, never closed: the safe failure is a leftover task, not a
// lost one. Reads files only; a missing file or section is a named assertion failure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIf, slice, assertHas, fencedBlocks } from '../lib/contract-text.mjs'

const WRITER = 'skills/_shared/task-writer.md'
const HANDOFF = 'skills/handoff/SKILL.md'
const LIFECYCLE = 'skills/_shared/handoff-lifecycle.md'
const CLOSE = 'skills/close/SKILL.md'
const CONTEXT = 'CONTEXT.md'
const SCRIPT = 'skills/_shared/scripts/next-action.py'

const openCaptures = () => slice(readIf(HANDOFF), /^\*\*Open captures\.\*\*/, /^(\*\*[A-Z]|## )/)

test('task-writer § 4 stamps the marker in the capture template, and § 2 names the query\'s `marked` match', () => {
  const s4 = slice(readIf(WRITER), /^## 4\./, /^## 4b\./)
  assertHas(s4, `${WRITER} § 4`, [/`capture: continuation`/, /thread:handoff/])
  const yaml = fencedBlocks(s4 ?? '').find((b) => b.includes('---'))
  assert.ok(yaml?.some((l) => /^capture: continuation\b/.test(l)), `${WRITER} § 4's template must stamp capture: continuation`)
  assertHas(slice(readIf(WRITER), /^## 2\./, /^## 3\./), `${WRITER} § 2`, [/`marked`/])
  assertHas(readIf(SCRIPT), SCRIPT, [/^CAPTURE_MARKER = "continuation"/m])
})

test('handoff supersedes only a marked capture; an unmarked one linking the thread stays open and is reported', () => {
  const oc = openCaptures()
  assertHas(oc, `${HANDOFF} **Open captures.**`, [
    /`capture: continuation`/,
    // The marker and a deterministic match, both.
    /`marked`/,
    /\*\*Thread:\*\*/,
    // An unmarked deterministic hit: left open, reported, never written.
    /unmarked/,
    /never closed/,
    'capture left open (unmarked): [[<slug>]]',
    'capture left open (fuzzy match only): [[<slug>]]',
    'capture closed: [[<slug>]] (superseded)',
  ])
  const row = slice(readIf(LIFECYCLE), /^## Thread state/, /^## /)?.split('\n').find((l) => l.startsWith('| `handoff`'))
  assertHas(row, `${LIFECYCLE} § Thread state's handoff row`, [/marked/])
})

test('a follow-up filed at close never carries the marker, and the glossary names it', () => {
  assertHas(readIf(CLOSE), CLOSE, [/omit the `thread` marker tag and the `capture:` marker/])
  const cap = slice(readIf(CONTEXT), /^- \*\*Capture\*\*/, /^- \*\*/)
  assertHas(cap, `${CONTEXT} **Capture**`, [/`capture: continuation`/])
})
