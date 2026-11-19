// The landings line (p11-7, ADR 0028 § 7): a landing the landing carrier cannot move for a day is seen at the next open in
// its repo and at a /thread:status sitting, off the Stage too. Both read `land-carrier.py stuck`: open filtered to the
// thread's repo through --slug, status estate-wide. Pins the prose an LLM follows:
//   open-section       skills/open/SKILL.md § The landings line says: the line verbatim when not null, nothing when
//                      null, no line on any non-zero exit of --origin-slug, the not-read form on a non-zero exit of the
//                      read, repo threads only, and that it writes nothing (its `# thread:open-landings` snippet is run,
//                      not pinned: tests/land-carrier.test.sh C15 runs it under bash and zsh -f)
//   open-callers       `<slug>` step 2, the `[[<task>]]` pickup's step 2 and the handoff-doc pickup's step 3 each cite it
//   status-line        status § 4's **The Landings line** sits after **The Primary refresh line** and before **The
//                      Trickle line**, runs `land-carrier.py stuck` with no --slug, prints its `line` verbatim, nothing
//                      when it is null and the not-read form on a non-zero exit, and quotes no part of the printed line
//                      (no fenced block, no `Landings: ` span but the not-read form): status's read-only rule reads
//                      every span as a command status runs
//   status-scope       § Scope names the read and the file it reads
//   status-donts       the Don'ts' list of the only Python scripts status runs names the read
//   carrier-consumers  land-carrier.py's docstring names both readers among the verb's Consumers
// The same shape as status-primary-refresh.test.mjs: every rule lives in one function, check(texts), that returns named
// failures, so the real text and the controls run through identical logic; each control mutates the real text in one
// place and must fail with exactly its rule. Reads files only. The verb itself, and open's snippet, are
// tests/land-carrier.test.sh C15.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read, section, slice } from '../lib/contract-text.mjs'

const OPEN = 'skills/open/SKILL.md'
const STATUS = 'skills/status/SKILL.md'
const CARRIER = 'skills/_shared/scripts/land-carrier.py'
const real = { open: read(OPEN), status: read(STATUS), carrier: read(CARRIER) }

const NOT_READ = 'Landings: not read (<its last stderr line>)'
const CITE = '§ The landings line'
const S4 = /^### 4\. /
const SCRIPTS = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts'

// A bold-labelled paragraph inside status § 4, raw: from its label line to the next bold label at column 0, or ''.
function paragraph(text, label) {
  const lines = (section(text, S4) ?? '').split('\n')
  const i = lines.findIndex((l) => l.startsWith(`**${label}`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^\*\*[A-Z`]/.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}

// The numbered step `n` of an open mode, collapsed, or ''.
function step(text, mode, n) {
  const body = slice(text, mode, /^##+ /) ?? ''
  return collapse(slice(body, new RegExp(`^${n}\\. `), /^\d+\. |^$/) ?? '')
}

// Named failures; [] means every rule holds.
function check({ open, status, carrier }) {
  const fails = []

  // open-section: its prose rules (its snippet is run by tests/land-carrier.test.sh C15).
  const prose = collapse(section(open, /^## The landings line$/) ?? '')
  if (!prose.includes("Print its JSON's `line` verbatim when it is not null") ||
    !prose.includes('Print nothing when it is null') ||
    !prose.includes('Any non-zero exit of `--origin-slug` (4: no GitHub origin) prints no line, and the read never runs') ||
    !prose.includes(`A non-zero exit of the read prints \`${NOT_READ}\``) ||
    !prose.includes('Repo threads only: a shared or project thread gets no line') ||
    !prose.includes('it writes nothing')) fails.push('open-section')

  // open-callers: each briefing step cites the section.
  const callers = [
    step(open, /^### `\/thread:open <slug>`/, 2),
    step(open, /^### `\/thread:open \[\[<task>\]\]`/, 2),
    step(open, /^### `\/thread:open <path-to-handoff-doc>`/, 3),
  ]
  if (callers.some((c) => !c.includes(CITE))) fails.push('open-callers')

  // status-line: placed after the Primary refresh line and before the Trickle line; its read, with no --slug; its three
  // print rules; and no part of the printed line quoted.
  const s4 = section(status, S4) ?? ''
  const raw = paragraph(status, 'The Landings line')
  const para = collapse(raw)
  const iRefresh = s4.indexOf('**The Primary refresh line**')
  const iLine = s4.indexOf('**The Landings line**')
  const iTrickle = s4.indexOf('**The Trickle line**')
  const spans = [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  if (!(iRefresh >= 0 && iRefresh < iLine && iLine < iTrickle) ||
    !para.includes(`\`python3 ${SCRIPTS}/land-carrier.py stuck\``) ||
    !para.includes('with no `--slug`: the line is estate-wide') ||
    spans.some((sp) => /land-carrier\.py stuck .*--slug/.test(sp)) ||
    !para.includes("The JSON's `line` prints verbatim, on a line of its own, when it is not null") ||
    !para.includes('nothing prints when it is null') ||
    !para.includes(`A non-zero exit prints \`${NOT_READ}\``) ||
    !para.includes('a point-in-time read with no freshness check') ||
    /^\s*(```|~~~)/m.test(raw) ||
    spans.some((sp) => sp.startsWith('Landings: ') && sp !== NOT_READ)) fails.push('status-line')

  // status-scope: § Scope names the read and its file.
  const scope = collapse(section(status, /^## Scope/) ?? '')
  if (!scope.includes("It also runs `land-carrier.py stuck` for § 4's Landings line, a read of `${XDG_STATE_HOME:-~/.local/state}/thread/landings.json` that writes nothing.")) {
    fails.push('status-scope')
  }

  // status-donts: the list of the only Python scripts status runs names the read.
  const donts = collapse(section(status, /^## Don'ts/) ?? '')
  const end = donts.indexOf('are the only Python scripts status runs')
  if (end < 0 || !donts.slice(0, end).includes("`land-carrier.py stuck` (§ 4's Landings line, a read that writes nothing)")) {
    fails.push('status-donts')
  }

  // carrier-consumers: the verb's docstring names both readers.
  const doc = collapse(carrier.split('"""')[1] ?? '')
  if (!doc.includes("Consumers (the Stage's machinery-health read, /thread:status's Landings line, /thread:open's landings line through --slug, any later reader)")) {
    fails.push('carrier-consumers')
  }
  return fails
}

test('open, status and the carrier\'s docstring hold the landings line', () => {
  assert.deepEqual(check(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['open-section', 'open-callers', 'status-line', 'status-scope', 'status-donts', 'carrier-consumers']
const CONTROLLED = new Set()

function edit(texts, file, from, to) {
  assert.equal(texts[file].split(from).length, 2, `control setup: ${from.slice(0, 80)} must occur exactly once`)
  return { ...texts, [file]: texts[file].replace(from, () => to) }
}
const only = (texts, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(check(texts), [rule], label)
}

test('control: one of open\'s rules changed fails open-section', () => {
  only(edit(real, 'open', "Print its JSON's `line` verbatim when it is not null", 'Summarise its JSON when it is not null'), 'open-section', 'not verbatim')
  only(edit(real, 'open', `prints \`${NOT_READ}\``, 'prints nothing'), 'open-section', 'the not-read form dropped')
  only(edit(real, 'open', 'Repo threads only: a shared or project thread gets no line', 'Every thread gets the line'), 'open-section', 'every thread')
})

test('control: a briefing step without the cite fails open-callers', () => {
  only(edit(real, 'open', `top open question) and ${CITE} for a repo thread,`, 'top open question),'), 'open-callers', '<slug> step 2')
  only(edit(real, 'open', `goes \`active\`). A repo thread's briefing adds ${CITE}.`, 'goes `active`).'), 'open-callers', '[[<task>]] step 2')
  only(edit(real, 'open', `pickup row to it. A repo thread's briefing adds ${CITE}.`, 'pickup row to it.'), 'open-callers', 'handoff-doc step 3')
})

test('control: the Landings line moved, filtered, its print rules dropped, or an example quoted, fails status-line', () => {
  const para = paragraph(real.status, 'The Landings line')
  assert.ok(para, 'control setup: no Landings line paragraph')
  const without = edit(real, 'status', para, '')
  const refresh = paragraph(without.status, 'The Primary refresh line')
  only(edit(without, 'status', refresh, `${para}${refresh}`), 'status-line', 'moved above the Primary refresh line')
  only(edit(real, 'status', 'land-carrier.py stuck` with `<root>`', 'land-carrier.py stuck --slug <slug>` with `<root>`'), 'status-line', 'filtered by --slug')
  only(edit(real, 'status', "The JSON's `line` prints verbatim, on a line of its own,", "A summary of the JSON prints, on a line of its own,"),
    'status-line', 'not verbatim')
  only(edit(real, 'status', 'and nothing prints when it is null (no', 'and `Landings: none` prints when it is null (no'),
    'status-line', 'the null case prints')
  only(edit(real, 'status', `A non-zero exit prints \`${NOT_READ}\``, 'A non-zero exit prints nothing'), 'status-line', 'the not-read form dropped')
  only(edit(real, 'status', "The line is the carrier's last recorded state,",
    "It reads like `Landings: o/x#1: waiting for its checks (unmoved since 2026-11-17T10:00)`. The line is the carrier's last recorded state,"),
  'status-line', 'an example line quoted in backticks')
})

test('control: § Scope without the read fails status-scope', () => {
  only(edit(real, 'status', " It also runs `land-carrier.py stuck` for § 4's Landings line, a read of `${XDG_STATE_HOME:-~/.local/state}/thread/landings.json` that writes nothing.", ''),
    'status-scope', 'the scope sentence dropped')
})

test('control: the Don\'ts without the read fails status-donts', () => {
  only(edit(real, 'status', "`land-carrier.py stuck` (§ 4's\n  Landings line, a read that writes nothing), ", ''), 'status-donts', 'the read dropped from the list')
})

test('control: the docstring without a reader fails carrier-consumers', () => {
  only(edit(real, 'carrier', "/thread:status's Landings line, ", '/thread:status, '), 'carrier-consumers', 'status unnamed')
  only(edit(real, 'carrier', "/thread:open's\nlandings line through --slug, ", ''), 'carrier-consumers', 'open unnamed')
})

test('the rules are all named (6) and each has a control', () => {
  assert.equal(RULES.length, 6)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
