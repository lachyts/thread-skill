// The grill-fit check (skills/_shared/grill-fit.md): when handoff composes its paste-ready prompt, every fork the
// cold downstream session could hit is either marked resolvable ("decide X from Y") or gated back to Lachy
// (grill-me), and a prompt with no forks carries no grill language, meaning no gate lines and no "decide X from Y"
// lines. Orient composes no cold prompts since ADR 0040 retired its batches (pinned in
// execution-fit-shapes.test.mjs), so it no longer runs the check.
//
// Orient still reads what a retired batch left behind: its single end line, `partial: fork for Lachy: …` naming
// every fork, which § 2's pinned body read finds. A fork stays open (§ 2 Open forks) until an `orient ruling:`
// line timed after that end line rules on it: § 5 counts a task with an open fork as unclear, so the reshuffle
// grill puts the fork to Lachy and writes his ruling into the note, and § 3, § 6 and § 7 stop holding back or
// reporting a ruled fork. Handoff's consumer is interactive, so it stops at the fork and asks; a resolvable fork
// lands in its Context: or Next move: line.
//
// Three pure checks, fragmentFails / orientFails / handoffFails, each returning a failure list: the real files
// and the controls run through them, so a control proves its check is not vacuous. Every phrase check runs
// on collapsed text, so a reflowed line can neither hide nor fake a match. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FENCE, collapse, fencedBlocks, lineOf, read, readIf, section, slice } from '../lib/contract-text.mjs'

const FRAG = 'skills/_shared/grill-fit.md'
const ORIENT = 'skills/orient/SKILL.md'
const HANDOFF = 'skills/handoff/SKILL.md'

const CITE = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/grill-fit.md'
// The fork form of a retired orient batch's end line: one literal, carried identically by the fragment and
// orient's § 2 Open forks definition, so the two homes cannot drift apart unnoticed. A run wrote one end line, so
// each further fork is appended to it (FORK_MORE), never written as a second end line.
const FORK_END = 'partial: fork for Lachy: <fork>; evidence: <…>'
const FORK_MORE = '`; fork for Lachy: <fork>; evidence: <…>` appended for each further fork'
// Lachy's ruling on one fork, the line § 5 writes and § 2's definition reads.
const RULING = 'orient ruling: <fork> → <ruling>'
// What marks a fork open, restated where it is used (§ 3, § 7) after the § 2 definition.
const OPEN = /\(§ 2 Open forks: named by `fork for Lachy` in its latest orient end line, with no `orient ruling:` line for it timed after that end line\)/
// What "no grill language" means, in both homes: no gate lines and no "decide X from Y" lines.
const NO_GRILL = /no grill language[^.]*no gate lines and no "decide X from Y" lines/
// The Smart Slider gate line the fragment quotes as its example, verbatim (its source note no longer exists).
const GATE = collapse(`Gates: NO optimizer edits — diagnosis only. The remediation decision that follows your findings
(ceiling vs deadline fix vs UX copy vs park for Patrick) returns to Lachy for a grill-me session —
do NOT spawn a remediation fix task directly; report the fork and its evidence instead.`)
const HANDOFF_GATES =
  'Gates: <fork> returns to Lachy via grill-me — report the fork and its evidence, do not resolve it downstream'
const MAX_LINES = 40

const C = (s) => (s == null ? '' : collapse(s))
const has = (text, p) => (typeof p === 'string' ? text.includes(p) : p.test(text))
// Pushes `name: <pattern>` for each pattern `text` does not match (a string is a substring check).
const need = (fails, name, text, patterns) => {
  for (const p of patterns) if (!has(text, p)) fails.push(`${name}: ${p}`)
}

function fragmentFails(text) {
  if (text == null) return [`${FRAG} is missing`]
  const fails = []
  const lines = text.trimEnd().split('\n')
  if (lines.length > MAX_LINES) fails.push(`${FRAG} has ${lines.length} lines (> ${MAX_LINES})`)
  need(fails, FRAG, C(text), [
    /today handoff § Build the handoff prompt/, NO_GRILL, /returns to Lachy/i, /resolvable/i, 'decide X from Y',
    'do NOT spawn a remediation fix task directly', FORK_END, /one end line naming every fork/,
    'stops at the fork and asks', /conversation-gated/, /mid-work/, 'ADR 0008',
    /orient § 5\) and writes his ruling into the task note as an `orient ruling:` line/,
  ])
  const quote = collapse(lines.filter((l) => /^>/.test(l)).map((l) => l.replace(/^>\s?/, '')).join(' '))
  if (!quote.includes(GATE)) fails.push(`${FRAG}: the example quote is not the verbatim gate line`)
  if (/orient fork:/.test(text)) fails.push(`${FRAG}: names an "orient fork:" line kind`)
  return fails
}

function orientFails(text) {
  const fails = []
  // § 2's pinned body read, taken from the text itself, must find a two-fork end line and a ruling line:
  // that read is how § 3 and § 7 tell an open fork from a ruled one.
  const s2 = slice(text, /^### 2\./, /^### 3\./)
  const vault = C(slice(s2, /^- \*\*Vault\*\*/, /^- /))
  const rgs = [...vault.matchAll(/rg -n '([^']+)'/g)].map((m) => new RegExp(m[1]))
  const endLine = `- 2026-10-15T00:00:00Z orient end: run /r, job j, ${FORK_END}; fork for Lachy: b; evidence: c`
  const ruling = `- 2026-10-16T00:00:00Z ${RULING.replace('<fork>', 'a').replace('<ruling>', 'b')}`
  if (!rgs.length) fails.push('§ 2 Vault: no rg body-read pattern')
  else if (!rgs[0].test(endLine)) fails.push(`§ 2 Vault: its run-line rg ${rgs[0]} misses a fork end line`)
  if (!rgs.some((re) => re.test(ruling))) fails.push('§ 2 Vault: no rg body-read pattern finds a ruling line')
  need(fails, '§ 2 Open forks', C(slice(s2, /^- \*\*Open forks\*\*/, /^- /)), [
    /the one definition; §§ 3, 5, 6 and 7 use it/,
    FORK_END, FORK_MORE,
    "each fork a task's latest orient end line names (`fork for Lachy: <fork>`)",
    `stays open until an \`${RULING}\` line in its \`## Notes\`, timed after that end line, rules on it.`,
    /A ruled fork is decided: it is never reported, excluded or grilled again/,
  ])

  need(fails, '§ 3 Balls in the air', C(slice(text, /^- \*\*Balls in the air\*\*/, /^- \*\*/)), [
    OPEN, /name every open fork/, /A ruled fork is not listed/,
  ])
  need(fails, '§ 5', C(section(text, /^### 5\./)), [
    /open fork \(§ 2 Open forks\) counts as \*\*unclear\*\* for R2 whatever its body says/,
    /puts each open fork and its evidence to Lachy/, /written into the task note at R5, after the gate/,
    `\`- <UTC ISO> ${RULING}\``, /marks that fork decided/,
  ])
  need(fails, '§ 6', C(section(text, /^### 6\./)), [/open fork \(§ 2\) is left out of `--tasks` until Lachy rules on it/])
  need(fails, '§ 7 Exclusions', C(slice(text, /^- \*\*Exclusions\*\*/, /^(- \*\*|#{2,4} )/)), [
    OPEN, /counts as conversation-gated at any age/, /until Lachy rules on every open fork in a reshuffle grill \(§ 5\)/,
    /the ruling lines keep it decided/,
  ])
  if (/orient fork:/.test(text)) fails.push(`${ORIENT}: names an "orient fork:" line kind`)
  return fails
}

function handoffFails(text) {
  const fails = []
  const sec = section(text, /^## Build the handoff prompt/)
  if (sec == null) return ['handoff: no ## Build the handoff prompt']
  const block = fencedBlocks(sec)[0] ?? []
  const at = (re) => block.findIndex((l) => re.test(l))
  const gates = block.indexOf(HANDOFF_GATES)
  const skills = at(/^Suggested skills:/)
  const next = at(/^Next move:/)
  if (gates < 0) fails.push('template: no Gates: line')
  else if (!(skills >= 0 && next >= 0 && skills < gates && gates < next)) {
    fails.push('template: the Gates: line is not between Suggested skills: and Next move:')
  }
  if (at(/^Context:/) < 0) fails.push('template: no Context: line for a resolvable fork')
  const lines = sec.split('\n')
  const open = lines.findIndex((l) => FENCE.test(l))
  const close = open < 0 ? -1 : lines.findIndex((l, k) => k > open && FENCE.test(l))
  need(fails, 'prose before the template', C(lines.slice(0, open < 0 ? undefined : open).join('\n')), [CITE])
  need(fails, 'prose after the template', C(close < 0 ? '' : lines.slice(close + 1).join('\n')), [
    /one line per Lachy-owned fork, omitted when there is none/, 'stops at the fork and asks',
    /A fork the consumer can settle \(step 2\(a\)\) goes into `Context:` or `Next move:` as "decide X from Y"/,
  ])
  need(fails, 'body item 2', lineOf(text, '2. **What remains**') ?? '', [/fork the grill-fit check returned to Lachy/])
  return fails
}

const frag = readIf(FRAG)
const orient = read(ORIENT)
const handoff = read(HANDOFF)

// Replace `phrase` (whitespace-tolerant, so a reflowed line still matches) and fail loudly when it is absent,
// so a control can never pass by mutating nothing.
function mutate(text, phrase, replacement, flags = '') {
  const re = new RegExp(phrase.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), flags)
  assert.ok(re.test(text), `control precondition: ${JSON.stringify(phrase)} is not in the text`)
  return text.replace(re, replacement)
}

// `mutate`, confined to the lines from `start` up to the next `stop` line, so a phrase several sections share
// is changed in that one place only.
function mutateIn(text, start, stop, phrase, replacement) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => start.test(l))
  assert.ok(i >= 0, `control precondition: no line matches ${start}`)
  const j = lines.findIndex((l, k) => k > i && stop.test(l))
  const end = j < 0 ? lines.length : j
  const part = mutate(lines.slice(i, end).join('\n'), phrase, replacement)
  return [...lines.slice(0, i), part, ...lines.slice(end)].join('\n')
}

test('the grill-fit fragment carries the check, the verbatim example, both return paths and what it is not', () => {
  assert.deepEqual(fragmentFails(frag), [])
})

test('handoff cites the fragment by plugin path', () => {
  assert.ok(handoff.includes(CITE), `${HANDOFF} does not cite ${CITE}`)
})

test('orient grills each open fork and keeps a ruled fork decided', () => {
  assert.deepEqual(orientFails(orient), [])
})

test('handoff runs the check, carries an optional Gates: line, places a resolvable fork and names the fork in What remains', () => {
  assert.deepEqual(handoffFails(handoff), [])
})

test('control: orient with "fork for Lachy" reduced to "fork" fails', () => {
  assert.notDeepEqual(orientFails(mutate(orient, 'fork for Lachy', 'fork', 'g')), [])
})

test('control: an Exclusions clause that no longer lets a ruling decide the fork fails', () => {
  const bad = mutateIn(orient, /^- \*\*Exclusions\*\*/, /^(- \*\*|#{2,4} )/,
    ', with no `orient ruling:` line for it timed after that end line', '')
  assert.ok(orientFails(bad).some((f) => f.startsWith('§ 7 Exclusions')))
})

test('control: an Open forks definition with no ruling fails', () => {
  const bad = mutateIn(orient, /^- \*\*Open forks\*\*/, /^(- |#{2,4} )/, 'stays open until an', 'stays open; an')
  assert.ok(orientFails(bad).some((f) => f.startsWith('§ 2 Open forks')))
})

test('control: a § 2 body read that cannot find a ruling line fails', () => {
  const bad = mutate(orient, "and a second for Lachy's fork rulings (`rg -n 'orient ruling: '`, the lines § 5 writes)", '')
  assert.ok(orientFails(bad).includes('§ 2 Vault: no rg body-read pattern finds a ruling line'))
})

test('control: a § 5 that never puts an open fork to Lachy fails', () => {
  const bad = mutate(orient, 'counts as **unclear** for R2 whatever its body says', 'stays as it is')
  assert.ok(orientFails(bad).some((f) => f.startsWith('§ 5')))
})

test('control: a § 3 that still reports a ruled fork fails', () => {
  const s3 = mutateIn(orient, /^- \*\*Balls in the air\*\*/, /^- \*\*/, 'A ruled fork is not listed.', '')
  assert.ok(orientFails(s3).some((f) => f.startsWith('§ 3')))
})

test('control: an Open forks definition without the appended-forks clause fails', () => {
  const bad = mutateIn(orient, /^- \*\*Open forks\*\*/, /^(- |#{2,4} )/,
    ', with `; fork for Lachy: <fork>; evidence: <…>` appended for each further fork', '')
  assert.ok(orientFails(bad).some((f) => f.startsWith('§ 2 Open forks') && f.includes(FORK_MORE)))
})

test('control: handoff without the Gates: line fails', () => {
  const bad = handoff.split('\n').filter((l) => l !== HANDOFF_GATES).join('\n')
  assert.ok(bad !== handoff, 'control precondition: no Gates: line')
  assert.ok(handoffFails(bad).some((f) => f.startsWith('template: no Gates')))
})

test('control: handoff with the Gates: line after Next move: fails', () => {
  assert.ok(handoff.split('\n').includes(HANDOFF_GATES), 'control precondition: no Gates: line')
  const lines = handoff.split('\n').filter((l) => l !== HANDOFF_GATES)
  const n = lines.findIndex((l) => /^Next move:/.test(l))
  assert.ok(n >= 0, 'control precondition: no Next move: line')
  lines.splice(n + 1, 0, HANDOFF_GATES)
  assert.ok(handoffFails(lines.join('\n')).some((f) => f.includes('not between')))
})

test('control: handoff with no home for a resolvable fork fails', () => {
  const bad = mutate(handoff, 'A fork the consumer can settle (step 2(a)) goes into `Context:` or `Next move:` as "decide X from Y".', '')
  assert.ok(handoffFails(bad).some((f) => f.startsWith('prose after the template')))
})

test('control: the fragment without "no grill language" fails', () => {
  assert.notDeepEqual(fragmentFails(mutate(frag ?? '', 'no grill language', 'no extra wording', 'gi')), [])
})

test('control: a fragment whose "no grill language" drops "no gate lines" fails', () => {
  const bad = mutate(frag ?? '', 'no gate lines and no "decide X from Y" lines', 'nothing about forks')
  assert.ok(fragmentFails(bad).some((f) => f.includes('no gate lines')))
})

test('control: a fragment whose fork end line drifts from orient\'s fails', () => {
  const bad = mutate(frag ?? '', 'partial: fork for Lachy: <fork>', 'partial: fork: <fork>', 'g')
  assert.ok(fragmentFails(bad).some((f) => f.includes(FORK_END)))
})
