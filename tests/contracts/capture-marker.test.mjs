// The capture marker (p19-8). stash and defer stamp `capture: continuation` on the captures they write
// (task-writer § 4); `next-action.py captures` reports it as the `marked` match (its behaviour is
// tests/next-action.test.mjs); handoff's **Open captures.** supersedes only a marked capture that also
// matches the thread deterministically. An unmarked hit (every capture written before the marker, or a
// backlog task that merely carries the thread link, like chorus-misstep-walk-and-knob on the 2026-09-25
// Chorus handoff) is left open and reported, never closed: the safe failure is a leftover task, not a
// lost one. task-writer § 2's re-capture holds the same line: it updates in place only a marked capture,
// leaves every unmarked match untouched and reports each one, and writes one fresh marked capture only when
// it found no open marked capture, never one per unmarked match (with a marked and an unmarked match found
// together, an unconditional fresh write would leave two marked captures for the thread). Nothing ever
// upgrades an unmarked task to marked (that migration would let the next stash or defer stamp backlog, and
// the handoff after it close it). Reads files only; a missing file or section is a named assertion failure.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readIf, slice, assertHas, fencedBlocks, collapse, lineOf } from '../lib/contract-text.mjs'

const WRITER = 'skills/_shared/task-writer.md'
const HANDOFF = 'skills/handoff/SKILL.md'
const LIFECYCLE = 'skills/_shared/handoff-lifecycle.md'
const CLOSE = 'skills/close/SKILL.md'
const CONTEXT = 'CONTEXT.md'
const SCRIPT = 'skills/_shared/scripts/next-action.py'
const STASH = 'skills/stash/SKILL.md'
const DEFER = 'skills/defer/SKILL.md'

const openCaptures = () => slice(readIf(HANDOFF), /^\*\*Open captures\.\*\*/, /^(\*\*[A-Z]|## )/)

test('task-writer § 4 stamps the marker in the capture template, and § 2 names the query\'s `marked` match', () => {
  const s4 = slice(readIf(WRITER), /^## 4\./, /^## 4b\./)
  assertHas(s4, `${WRITER} § 4`, [/`capture: continuation`/, /thread:handoff/])
  const yaml = fencedBlocks(s4 ?? '').find((b) => b.includes('---'))
  assert.ok(yaml?.some((l) => /^capture: continuation\b/.test(l)), `${WRITER} § 4's template must stamp capture: continuation`)
  assertHas(slice(readIf(WRITER), /^## 2\./, /^## 3\./), `${WRITER} § 2`, [/`marked`/])
  assertHas(readIf(SCRIPT), SCRIPT, [/^CAPTURE_MARKER = "continuation"/m])
})

test('task-writer § 2 updates in place only a marked capture, leaves each unmarked match untouched and reported, and writes one fresh capture only when none is marked', () => {
  const s2 = slice(readIf(WRITER), /^## 2\./, /^## 3\./)
  const flat = s2 == null ? null : collapse(s2)
  assertHas(flat, `${WRITER} § 2`, [
    // In place only when the row's match includes `marked`.
    /Found, and its match includes `marked`\*\* → \*\*update it in place\*\*/,
    /Only a marked capture is ever updated in place/,
    // Each unmarked match (pre-marker capture, or backlog with the tag and link): untouched and reported.
    /Each unmarked match\*\*/,
    /\*\*untouched\*\*/,
    'capture left open (unmarked): [[<slug>]]',
    /Several unmarked matches .* each one is left untouched and reported on its own line/,
    /nothing upgrades an unmarked task to a marked one/,
    // The capture is written once per run: the marked one updated, or one fresh one only when none is open.
    /The capture, exactly one per run/,
    /in-place update is the capture, whatever unmarked matches sit beside it/,
    /No open marked capture found\*\* → write one fresh marked capture/,
    /written only when the search above found no open marked capture for this thread/,
    /a run writes at most one fresh marked capture, never one per unmarked match/,
    // The one-capture rule is narrowed to marked captures, so a fresh capture beside unmarked ones keeps it.
    /Never write a second marked capture for the same thread/,
  ])
  // The per-match step never writes: the fresh write lives only in the once-per-run step, behind its condition,
  // so a marked and an unmarked match found together cannot yield a second marked capture.
  const unmarked = flat?.match(/\*\*Each unmarked match\*\*(.*?)\*\*The capture, exactly one per run/)?.[1]
  assert.ok(unmarked != null, `${WRITER} § 2's unmarked step must come before its once-per-run capture step`)
  assert.match(unmarked, /No unmarked match ever causes a write/, `${WRITER} § 2's unmarked step must say it never writes`)
  assert.doesNotMatch(unmarked, /fresh/, `${WRITER} § 2's unmarked step must not write a fresh capture`)
  // The migration path that reopened the Chorus bug stays gone: § 2 never stamps the marker on an existing task.
  assert.doesNotMatch(flat ?? '', /add `capture: continuation` if it lacks it/, `${WRITER} § 2 must not add the marker to an unmarked task`)
  assert.doesNotMatch(flat ?? '', /Never write a second task for the same thread/, `${WRITER} § 2's one-capture rule must name marked captures`)
  const s4 = collapse(slice(readIf(WRITER), /^## 4\./, /^## 4b\./) ?? '')
  assert.doesNotMatch(s4, /re-capture adds it/, `${WRITER} § 4 must not say a § 2 re-capture adds the marker`)
  assertHas(s4, `${WRITER} § 4`, [/Only a fresh stash or defer write stamps it/])
  // § 7's confirmation carries the report line; stash and defer summarise § 2 with the same condition.
  assertHas(slice(readIf(WRITER), /^## 7\./, null), `${WRITER} § 7`, ['capture left open (unmarked): [[<slug>]]'])
  for (const [file, step] of [[STASH, /^\s+- § 2 dedup/], [DEFER, /^2\. \*\*Write the capture task\*\*/]]) {
    assertHas(lineOf(readIf(file), step), `${file} § 2 dedup summary`, [
      /open marked capture/,
      /Each unmarked match is left untouched and reported/i,
      /a fresh marked capture is written only when no open marked capture exists, one at most/,
    ])
  }
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
