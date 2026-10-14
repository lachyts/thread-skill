// The grill-fit check (skills/_shared/grill-fit.md): when orient composes a batch prompt or handoff composes its
// paste-ready prompt, every fork the cold downstream session could hit is either marked resolvable ("decide X
// from Y") or gated back to Lachy (grill-me), and a prompt with no forks carries no grill language. A fork a
// batch child meets comes back in the one record orient already reads: the mandatory end line, as
// `partial: fork for Lachy: …`, which § 2's pinned body read finds, § 3 and § 7 surface (§ 7 keeps the task
// out of batches until he decides), and the close-out line and `--debrief` report as a decision for Lachy,
// never as a task to spawn. Handoff's consumer is interactive, so it stops at the fork and asks.
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
// The fork form of orient's end line: one literal, carried identically by the fragment and orient's
// End-of-run bullet, so the two homes cannot drift apart unnoticed.
const FORK_END = 'partial: fork for Lachy: <fork>; evidence: <…>'
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
    /no grill language/i, /returns to Lachy/i, /resolvable/i, 'decide X from Y',
    'do NOT spawn a remediation fix task directly', FORK_END, /--debrief/, 'stops at the fork and asks',
    /conversation-gated/, /mid-work/, 'ADR 0008',
  ])
  const quote = collapse(lines.filter((l) => /^>/.test(l)).map((l) => l.replace(/^>\s?/, '')).join(' '))
  if (!quote.includes(GATE)) fails.push(`${FRAG}: the example quote is not the verbatim gate line`)
  if (/orient fork:/.test(text)) fails.push(`${FRAG}: names an "orient fork:" line kind`)
  return fails
}

function orientFails(text) {
  const fails = []
  const spec = slice(text, /^\*\*Every batch prompt must carry\*\*/, /^Close the dispatch/)
  if (!(spec ?? '').split('\n').some((l) => l.startsWith('- **Grill-fit gates**'))) {
    fails.push('emission spec: no - **Grill-fit gates** bullet')
  }
  need(fails, 'Grill-fit gates bullet', C(slice(spec, /^- \*\*Grill-fit gates\*\*/, /^- \*\*/)), [
    CITE, /no grill language/, /never resolving it or spawning a task/,
  ])
  need(fails, 'End-of-run updates bullet', C(slice(text, /^- \*\*End-of-run updates\*\*/, /^- \*\*/)), [
    'orient end: run <Run:>, job <Job:>', FORK_END, 'status: open', /never spawns a task/,
  ])

  // § 2's pinned body read, taken from the text itself, must find a fork end line: that read is how § 3, § 7
  // and § 10 see the fork, with no new line kind and no rg change.
  const vault = C(slice(slice(text, /^### 2\./, /^### 3\./), /^- \*\*Vault\*\*/, /^- /))
  const rg = vault.match(/rg -n '([^']+)'/)?.[1]
  if (rg == null) fails.push('§ 2 Vault: no rg body-read pattern')
  else if (!new RegExp(rg).test(`- 2026-10-15T00:00:00Z orient end: run /r, job j, ${FORK_END}`)) {
    fails.push(`§ 2 Vault: its rg pattern /${rg}/ misses a fork end line`)
  }

  need(fails, '§ 7 Exclusions', C(slice(text, /^- \*\*Exclusions\*\*/, /^(- \*\*|#{2,4} )/)), [
    /latest orient end line[^.]*carries `fork for Lachy`/, /until Lachy decides/,
    /new run's end line supersedes the fork/,
  ])
  need(fails, '§ 8 step 5', C(slice(text, /^5\. \*\*Collect and accept\.\*\*/, /^\*\*Every batch prompt must carry\*\*/)), [
    /fork for Lachy/, /never as a follow-up task/,
  ])
  need(fails, 'Close the dispatch', C(slice(text, /^Close the dispatch/, /^#### /)), [
    'fork for Lachy: [[<task>]] <fork> (grill-me)',
  ])
  need(fails, '§ 10', C(section(text, /^### 10\./)), [/fork for Lachy/, /decision for Lachy/])
  need(fails, '§ 3 Balls in the air', C(slice(text, /^- \*\*Balls in the air\*\*/, /^- \*\*/)), [/fork for Lachy/])
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
  const lines = sec.split('\n')
  const open = lines.findIndex((l) => FENCE.test(l))
  const close = open < 0 ? -1 : lines.findIndex((l, k) => k > open && FENCE.test(l))
  need(fails, 'prose before the template', C(lines.slice(0, open < 0 ? undefined : open).join('\n')), [CITE])
  need(fails, 'prose after the template', C(close < 0 ? '' : lines.slice(close + 1).join('\n')), [
    /one line per Lachy-owned fork, omitted when there is none/, 'stops at the fork and asks',
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

test('the grill-fit fragment carries the check, the verbatim example, both return paths and what it is not', () => {
  assert.deepEqual(fragmentFails(frag), [])
})

test('orient and handoff both cite the fragment by plugin path', () => {
  for (const [name, text] of [[ORIENT, orient], [HANDOFF, handoff]]) {
    assert.ok(text.includes(CITE), `${name} does not cite ${CITE}`)
  }
})

test('orient gates forks in every batch prompt and surfaces a reported fork as a decision for Lachy', () => {
  assert.deepEqual(orientFails(orient), [])
})

test('handoff runs the check, carries an optional Gates: line in its template and names the fork in What remains', () => {
  assert.deepEqual(handoffFails(handoff), [])
})

test('control: orient without the Grill-fit gates bullet fails', () => {
  const lines = orient.split('\n')
  const i = lines.findIndex((l) => l.startsWith('- **Grill-fit gates**'))
  assert.ok(i >= 0, 'control precondition: no Grill-fit gates bullet')
  const j = lines.findIndex((l, k) => k > i && /^- \*\*/.test(l))
  const cut = [...lines.slice(0, i), ...lines.slice(j)].join('\n')
  assert.ok(orientFails(cut).some((f) => f.startsWith('emission spec')))
})

test('control: orient with "fork for Lachy" reduced to "fork" fails', () => {
  assert.notDeepEqual(orientFails(mutate(orient, 'fork for Lachy', 'fork', 'g')), [])
})

test('control: an Exclusions clause that no longer names the end line fails', () => {
  const bad = mutate(orient, "latest orient end line (§ 2's body read) carries", 'Notes mention')
  assert.ok(orientFails(bad).some((f) => f.startsWith('§ 7 Exclusions')))
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

test('control: the fragment without "no grill language" fails', () => {
  assert.notDeepEqual(fragmentFails(mutate(frag ?? '', 'no grill language', 'no extra wording', 'gi')), [])
})

test('control: a fragment whose fork end line drifts from orient\'s fails', () => {
  const bad = mutate(frag ?? '', 'partial: fork for Lachy: <fork>', 'partial: fork: <fork>', 'g')
  assert.ok(fragmentFails(bad).some((f) => f.includes(FORK_END)))
})
