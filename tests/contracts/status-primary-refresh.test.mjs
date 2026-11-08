// /thread:status's Primary refresh line (ADR 0075 d2, P41-5). No rollout code notifies Lachy, so a checkout the
// Primary refresh cannot catch up is seen at a sitting: status § 4 prints the line `primary-refresh.py stuck` reads from
// the job's state file, right under the engine line and above the Trickle line. Pins the prose an LLM status follows in
// skills/status/SKILL.md:
//   line           § 4's **The Primary refresh line** sits after **The engine line** and before **The Trickle line**, runs
//                  `primary-refresh.py stuck`, prints its JSON's `line` verbatim, nothing when it is null, and
//                  `Primary refresh: not read (<its last stderr line>)` on a non-zero exit; and it quotes no part of the
//                  printed line (no fenced block, no code span holding `git `, `.sh`, `install` or another
//                  `Primary refresh: ` form), because status's read-only rule reads every span as a command status runs
//                  (status-repair-queue.test.mjs's `read-only`)
//   scope          § Scope names the read and the state file it reads
//   donts          § Don'ts lists `primary-refresh.py stuck` among the only Python scripts status runs, beside
//                  `engine-snapshot.py resolve` and `unfinished-rollout.py hold`
//   point-in-time  § 4 says the line is the job's last recorded state, with no freshness check
// The same shape as execute-needs-you.test.mjs: every rule lives in one function, checkLine(status), that returns named
// failures, so the real text and the controls run through identical logic; each control mutates the real text in one
// place and must fail with exactly its rule. Reads files only. The verb itself is tests/primary-refresh.test.sh ST1-ST7.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section } from '../lib/contract-text.mjs'

const real = read('skills/status/SKILL.md')

const S4 = /^### 4\. /
const SCOPE = /^## Scope/
const DONTS = /^## Don'ts/
const NOT_READ = 'Primary refresh: not read (<its last stderr line>)'

// A bold-labelled paragraph inside § 4, raw: from its label line to the next bold label at column 0, or ''.
function paragraph(text, label) {
  const lines = (section(text, S4) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z`]/.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}

// Named failures for status's Primary refresh line; [] means every rule holds.
function checkLine(status) {
  const fails = []
  const s4 = section(status, S4) ?? ''
  const raw = paragraph(status, 'The Primary refresh line')
  const para = collapse(raw)
  const iEngine = s4.indexOf('**The engine line**')
  const iLine = s4.indexOf('**The Primary refresh line**')
  const iTrickle = s4.indexOf('**The Trickle line**')
  const spans = [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  const quoted = spans.filter((sp) => /git |\.sh\b|install/.test(sp) || (sp.startsWith('Primary refresh: ') && sp !== NOT_READ))

  // line: placed between the engine line and the Trickle line; runs the read; prints its `line` verbatim, nothing when
  // null, and the not-read form on a non-zero exit; and quotes no part of the printed line.
  if (!(iEngine >= 0 && iEngine < iLine && iLine < iTrickle) ||
    !para.includes('`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/primary-refresh.py stuck`') ||
    !para.includes("Print its JSON's `line` verbatim when it is not null") ||
    !para.includes('Print nothing when it is null') ||
    !para.includes(`A non-zero exit prints \`${NOT_READ}\``) ||
    /^\s*(```|~~~)/m.test(raw) || quoted.length) {
    fails.push('line')
  }

  // scope: § Scope names the read and the file it reads, and that it writes nothing.
  const scope = collapse(section(status, SCOPE) ?? '')
  if (!scope.includes("It also runs `primary-refresh.py stuck` for § 4's Primary refresh line, a read of `${XDG_STATE_HOME:-~/.local/state}/thread/primary-refresh.json` that writes nothing.")) {
    fails.push('scope')
  }

  // donts: the Don'ts' list of the only Python scripts status runs names the read, with § 1's and § 4's other reads.
  const donts = collapse(section(status, DONTS) ?? '')
  const list = donts.slice(0, donts.indexOf('are the only Python scripts status runs'))
  if (!donts.includes('are the only Python scripts status runs') ||
    !list.includes("`primary-refresh.py stuck` (§ 4's Primary refresh line, a read that writes nothing)") ||
    !list.includes('`engine-snapshot.py resolve` (§ 1, a read)') ||
    !list.includes("`unfinished-rollout.py hold` (§ 4's Hold line, a read)")) {
    fails.push('donts')
  }

  // point-in-time: the line is the job's last recorded state, read with no freshness check, so a spell can be old.
  if (!para.includes("The line is the Primary refresh job's last recorded state, a point-in-time read with no freshness check") ||
    !para.includes('with the job unloaded or dead it can be old')) {
    fails.push('point-in-time')
  }
  return [...new Set(fails)]
}

test('status § 4, § Scope and the Don\'ts hold the Primary refresh line', () => {
  assert.deepEqual(checkLine(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['line', 'scope', 'donts', 'point-in-time']
const CONTROLLED = new Set()

function edit(text, from, to) {
  assert.equal(text.split(from).length, 2, `control setup: ${from.slice(0, 80)} must occur exactly once`)
  return text.replace(from, () => to)
}
const only = (status, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(checkLine(status), [rule], label)
}

test('control: the line moved, its read, verbatim print, null case or not-read form dropped, or an example quoted, fails line', () => {
  const para = paragraph(real, 'The Primary refresh line')
  assert.ok(para, 'control setup: no Primary refresh line paragraph')
  const without = edit(real, para, '')
  const trickle = paragraph(without, 'The Trickle line')
  only(edit(without, trickle, `${trickle}${para}`), 'line', 'moved below the Trickle line')
  only(edit(real, '`python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/primary-refresh.py stuck`', 'the job\'s state file'), 'line', 'the read dropped')
  only(edit(real, "Print its JSON's `line` verbatim when it is not null", "Print a summary of its JSON when it is not null"), 'line', 'not verbatim')
  only(edit(real, 'Print nothing when it is null', 'Print `Primary refresh: ok` when it is null'), 'line', 'the null case prints')
  only(edit(real, `A non-zero exit prints \`${NOT_READ}\``, 'A non-zero exit prints nothing'), 'line', 'the not-read form dropped')
  only(edit(real, 'The line is the Primary refresh job\'s last recorded state', 'It reads like `Primary refresh: agents: diverged (stuck since 2026-11-07T10:00; git -C <d> status)`. The line is the Primary refresh job\'s last recorded state'),
    'line', 'an example line quoted in backticks')
})

test('control: § Scope without the read fails scope', () => {
  only(edit(real, " It also runs `primary-refresh.py stuck` for § 4's Primary refresh line, a read of `${XDG_STATE_HOME:-~/.local/state}/thread/primary-refresh.json` that writes nothing.", ''),
    'scope', 'the scope sentence dropped')
})

test('control: the Don\'ts without the read fails donts', () => {
  only(edit(real, "`primary-refresh.py stuck` (§ 4's Primary refresh line, a read that writes nothing), ", ''), 'donts', 'the read dropped from the list')
  only(edit(real, '`engine-snapshot.py resolve` (§ 1, a read), ', ''), 'donts', 'the engine read dropped from the list')
})

test('control: the line without its point-in-time rule fails point-in-time', () => {
  only(edit(real, "The line is the Primary refresh job's last recorded state, a point-in-time read with no freshness check", 'The line is fresh'),
    'point-in-time', 'the freshness rule dropped')
  only(edit(real, 'with the job unloaded or dead it can be old', 'it is always current'), 'point-in-time', 'never old')
})

test('the rules are all named (4) and each has a control', () => {
  assert.equal(RULES.length, 4)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
