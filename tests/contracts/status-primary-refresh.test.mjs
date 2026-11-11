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
// and § 4's **The Carried line** (ADR 0078 d1: a fix is done only once Proven):
//   carried-line   it sits after **The Hold line** and before **The queue-state table**, runs `reconcile-rollout.py prove
//                  --rollout <rollout-note> … --json`, prints `Carried: not read (<its last stderr line>)` on a non-zero
//                  exit, and names what shows these notes on an older-snapshot rollout (the Stage line, reflect § 17,
//                  close's rows)
//   carried-writes its read carries `--dry-run --no-gh`, never `--land` or `--seen`
//   carried-root   it runs from the session's own root, never `<root>` (prove is guard-exempt and works across versions)
//   carried-done   its three wording lines, each `landed, …`, and no `Carried:` line ever says done
//   carried-scope  § Scope and the Don'ts list the read with `--dry-run --no-gh`
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

  // The Carried line (ADR 0078 d1).
  const craw = paragraph(status, 'The Carried line')
  const cpara = collapse(craw)
  const iHold = s4.indexOf('**The Hold line**')
  const iCarried = s4.indexOf('**The Carried line**')
  const iTable = s4.indexOf('**The queue-state table.**')
  const cspans = [...craw.matchAll(/`([^`]+)`/g)].map((m) => m[1])
  const prove = cspans.filter((sp) => sp.includes('reconcile-rollout.py prove'))
  if (!(iHold >= 0 && iHold < iCarried && iCarried < iTable) ||
    !prove.some((sp) => sp.includes('prove --rollout <rollout-note>') && sp.includes('--json')) ||
    !cpara.includes('A non-zero exit prints `Carried: not read (<its last stderr line>)`') ||
    !cpara.includes('there these notes show on the Stage line (`carried-fixes.json`), in reflect § 17 and in close\'s rows')) {
    fails.push('carried-line')
  }
  if (!prove.length || prove.some((sp) => !sp.includes('--dry-run --no-gh') || /--land|--seen/.test(sp))) fails.push('carried-writes')
  if (!cpara.includes("with the session's own root in place") || !cpara.includes('never `<root>`') ||
    !cpara.includes('prove is exempt from the engine guard and works across versions')) fails.push('carried-root')
  const CARRIED_LINES = ['Carried: [[t]] landed, carried (<waits>)', 'Carried: [[t]] landed, carry-back owed (<why>)',
    'Carried: [[t]] landed, carry-back waits[, archived] (<waits>)']
  if (!CARRIED_LINES.every((l) => cspans.includes(l)) || cspans.some((sp) => sp.startsWith('Carried:') && /\bdone\b/.test(sp)) ||
    !cpara.includes('An entry is never called done')) fails.push('carried-done')
  const cscope = collapse(section(status, SCOPE) ?? '')
  const clist = donts.slice(0, donts.indexOf('are the only Python scripts status runs'))
  if (!cscope.includes("It also runs `reconcile-rollout.py prove` with `--dry-run --no-gh` for § 4's Carried line, a read that writes nothing and calls no gh") ||
    !clist.includes("`reconcile-rollout.py prove` with `--dry-run --no-gh` (§ 4's Carried line, a read that writes nothing and calls no gh; never without `--dry-run`, never with `--land` or `--seen`)")) {
    fails.push('carried-scope')
  }
  return [...new Set(fails)]
}

test('status § 4, § Scope and the Don\'ts hold the Primary refresh line', () => {
  assert.deepEqual(checkLine(real), [])
})

// ---- controls: each mutates the real text in one place and must fail with exactly its rule ---------

const RULES = ['line', 'scope', 'donts', 'point-in-time', 'carried-line', 'carried-writes', 'carried-root', 'carried-done',
  'carried-scope']
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

test('control: the Carried line moved, its read, not-read form or old-snapshot surfaces dropped, fails carried-line', () => {
  const para = paragraph(real, 'The Carried line')
  assert.ok(para, 'control setup: no Carried line paragraph')
  const without = edit(real, para, '')
  const hold = paragraph(without, 'The Hold line')
  only(edit(without, hold, `${para}${hold}`), 'carried-line', 'moved above the Hold line')
  only(edit(real, 'A non-zero exit prints `Carried: not read (<its last stderr line>)`', 'A non-zero exit prints nothing'), 'carried-line', 'the not-read form dropped')
  only(edit(real, "in reflect § 17 and in close's rows", 'and nowhere else'), 'carried-line', 'the old-snapshot surfaces dropped')
})

test('control: the Carried read without --dry-run fails carried-writes', () => {
  only(edit(real, 'prove --rollout <rollout-note> --dry-run --no-gh --json', 'prove --rollout <rollout-note> --no-gh --json'), 'carried-writes', '--dry-run dropped')
})

test('control: the Carried read from <root> fails carried-root', () => {
  only(edit(real, "with the session's own root in place", 'with `<root>` in place'), 'carried-root', '<root> in place of the session root')
})

test('control: an owed entry worded done fails carried-done', () => {
  only(edit(real, '`Carried: [[t]] landed, carry-back owed (<why>)`', '`Carried: [[t]] landed done (<why>)`'), 'carried-done', 'the owed line reads landed done')
})

test('control: § Scope without the Carried read fails carried-scope', () => {
  only(edit(real, " It also runs `reconcile-rollout.py prove` with `--dry-run --no-gh` for § 4's Carried line, a read that writes nothing and calls no gh (ADR 0078 d1).", ''),
    'carried-scope', 'the scope sentence dropped')
})

test('the rules are all named (9) and each has a control', () => {
  assert.equal(RULES.length, 9)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
