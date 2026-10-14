// Orient runs a project's declared check (ADR 0036 d6; CONTEXT.md **Declared check**). § 2 runs
// skills/_shared/scripts/declared-check.py once for a project target (its behaviour is tests/declared-check.test.mjs),
// reads its whole output as entries, keeps the header's digest and never blocks on a failure; § 3 Shape counts the
// entries as loose items. reshuffle.md § Declared check states the contract a declared command meets and the hold
// rule; R2 proposes each entry, R4 carries the declared-check footer, and R5 advances last, only through
// `advance --expect <digest>`, which re-runs the plain command and holds unless its output is byte-identical.
//
// One pure function, check(orient, reshuffle), over the real files: the real text and the controls run through it,
// and each control mutates the real text in one place and must fail with exactly its rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, collapse, section, slice } from '../lib/contract-text.mjs'

const ORIENT = 'skills/orient/SKILL.md'
const RESHUFFLE = 'skills/orient/reshuffle.md'
const realOrient = read(ORIENT)
const realReshuffle = read(RESHUFFLE)
const SCRIPT = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/declared-check.py'

function check(orient, reshuffle) {
  const fails = []
  const s2 = section(orient, /^### 2\./) ?? ''
  // A bullet, from its `- **<label>` line to the next top-level bullet or blank line.
  const bullet = (text, label) => collapse(slice(text, new RegExp(`^- \\*\\*${label}`), /^- |^$/) ?? '')
  const dc = bullet(s2, 'Declared check')
  const shape = bullet(section(orient, /^### 3\./) ?? '', 'Shape')
  const own = collapse(section(reshuffle, /^## Declared check/) ?? '')
  const R = (n) => collapse(section(reshuffle, new RegExp(`^## R${n}\\.`)) ?? '')
  const surface = collapse(slice(reshuffle, /^\*\*Write surface\.\*\*/, /^$/) ?? '')
  const donts = collapse(section(reshuffle, /^## Don'ts/) ?? '')

  if (!dc.includes(`python3 ${SCRIPT} run "<note>"`) || !dc.includes('a 300-second command timeout (`timeout: 300000`)') ||
    !/for a project target only/.test(dc) ||
    !/A plain run changes nothing/.test(dc)) fails.push('call')
  if (!dc.includes(`python3 ${SCRIPT} advance "<note>" --expect <digest>\`, also with \`timeout: 300000\``) ||
    !/Keep the header's `digest`/.test(dc)) fails.push('advance')
  if (!/its one `audit` line/.test(dc) || !/never a blocker/.test(dc)) fails.push('blocker')
  if (!/An area or scoped target and `--debrief` run no check/.test(dc)) fails.push('reach')
  if (!/read all `bytes`/.test(dc) || !/saves to a file is read whole from that file, never from its preview/.test(dc)) fails.push('whole')
  if (!/the declared check's entries \(§ 2\), each a loose item/.test(shape)) fails.push('shape')

  if (!own.includes('`orient_check: <command>`') || !/A plain run changes nothing/.test(own) || !/the same bytes for the same readings/.test(own) ||
    !own.includes('`<command> --advance` moves the record') || !/One simple command/.test(own) ||
    !own.includes('no quote that does not start a word') ||
    !own.includes('no backslash, backtick or `$` other than `$NAME` or `${NAME}` (so no `$(…)`), quoted or not') ||
    !/orient runs no git/.test(own)) fails.push('contract')
  if (!/Hold by default/.test(own) || !/the grill did not reach/.test(own) || !/Steer only, Look only and a dry run all hold/.test(own) ||
    !/Nothing newer means no footer and no advance/.test(own)) fails.push('hold')
  if (!/re-runs the plain command/.test(own) || !/byte-identical/.test(own) || !/otherwise the record is held/.test(own)) fails.push('digest')
  if (!/^- \*\*Declared check\*\* — each entry: .*\*\*seen\*\*/.test(slice(reshuffle, /^- \*\*Declared check\*\*/, /^- |^$/) ?? '') ||
    !R(2).includes('**Declared check**')) fails.push('propose')
  if (!R(4).includes('**declared-check footer**') || !R(4).includes('; advance after the writes`') ||
    !R(4).includes('`declared check: hold (<unresolved>)`') || !/He may turn advance into hold/.test(R(4))) fails.push('gate')
  if (!/\*\*The declared check advances, last\.\*\*/.test(R(5)) || !/every write above landed/.test(R(5)) ||
    !/orient § 2's `advance` call with the § 2 `digest`/.test(R(5)) || !R(5).includes('its `timeout: 300000`')) fails.push('write')
  if (!surface.includes("a declared check's own `--advance` moves its record") || !/orient still runs no git/.test(surface)) fails.push('surface')
  if (!donts.includes("**Don't advance a declared check** except through `advance --expect <digest>`") ||
    !/never run its `--advance` by hand/.test(donts)) fails.push('dont')
  return fails
}

// Replace the first `from` in the text after `anchor` (the whole text when anchor is null). A space in `from`
// matches any run of whitespace, so a reflowed line still meets its control.
function edit(text, from, to, anchor = null, file = '') {
  const i = anchor == null ? 0 : text.indexOf(anchor)
  assert.ok(i >= 0, `no ${anchor} in ${file}`)
  const re = new RegExp(from.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
  const m = re.exec(text.slice(i))
  assert.ok(m, `control: no ${JSON.stringify(from)} in ${file}`)
  const at = i + m.index
  return text.slice(0, at) + to + text.slice(at + m[0].length)
}
const o = (from, to, anchor = '- **Declared check**') => [edit(realOrient, from, to, anchor, ORIENT), realReshuffle]
const r = (from, to, anchor = null) => [realOrient, edit(realReshuffle, from, to, anchor, RESHUFFLE)]

test('orient § 2 runs the declared check, and the reshuffle proposes, gates and advances it', () => {
  assert.deepEqual(check(realOrient, realReshuffle), [])
})

test('each control fails with exactly its rule', () => {
  const own = '## Declared check'
  const controls = {
    call: o('for a project target only', 'for every target'),
    advance: o('advance "<note>" --expect <digest>', 'advance "<note>"'),
    blocker: o('never a blocker', 'a blocker'),
    reach: o('An area or scoped target and `--debrief` run no check', 'Every target runs it'),
    whole: o('never from its preview', 'or its preview'),
    shape: o("the declared check's entries (§ 2), each a loose item", 'the declared check', '- **Shape**'),
    contract: r('quoted or not', 'unquoted', own),
    hold: r('Steer only, Look only and a dry run all hold', 'Steer only holds', own),
    digest: r('byte-identical', 'similar', own),
    propose: r('or **seen** (nothing to do)', 'or dropped', '## R2.'),
    gate: r('He may turn advance into hold', 'It always advances', '## R4.'),
    write: r('every write above landed', 'the gate passed', '## R5.'),
    surface: r("a declared check's own `--advance` moves its record", 'a declared check moves its record', '**Write surface.**'),
    dont: r('never run its `--advance` by hand', 'run it by hand when stuck', "## Don'ts"),
  }
  for (const [rule, [orient, reshuffle]] of Object.entries(controls)) assert.deepEqual(check(orient, reshuffle), [rule], rule)
  // The run call loses its plain-run promise, or its time limit; the advance call loses its digest.
  assert.deepEqual(check(...o('A plain run changes nothing', 'A run may write')), ['call'])
  assert.deepEqual(check(...o('`timeout: 300000`', 'the default timeout')), ['call'])
  assert.deepEqual(check(...o("Keep the header's `digest`", 'Drop the header')), ['advance'])
  assert.deepEqual(check(...o('also with `timeout: 300000`', 'with the default timeout')), ['advance'])
  // The contract loses its stable-output rule, its $(…) refusal or its no-git line.
  assert.deepEqual(check(...r('the same bytes for the same readings', 'something like the readings', own)), ['contract'])
  assert.deepEqual(check(...r('`$` other than `$NAME` or `${NAME}` (so no `$(…)`), quoted or not', '`$(…)`', own)), ['contract'])
  assert.deepEqual(check(...r('no backslash, backtick', 'no backtick', own)), ['contract'])
  assert.deepEqual(check(...r('no quote that does not start a word, and', 'and', own)), ['contract'])
  assert.deepEqual(check(...r('orient runs no git', 'orient commits it', own)), ['contract'])
  // The hold rule loses the unreached entries; the advance stops re-running.
  assert.deepEqual(check(...r('the grill did not reach', 'he dropped', own)), ['hold'])
  assert.deepEqual(check(...r('re-runs the plain command', 'trusts the first run', own)), ['digest'])
  // R4's hold footer, R5's digest-bound call.
  assert.deepEqual(check(...r('`declared check: hold (<unresolved>)`', '`declared check: skipped`', '## R4.')), ['gate'])
  assert.deepEqual(check(...r("orient § 2's `advance` call with the § 2 `digest`", "the check's `--advance`", '## R5.')), ['write'])
  assert.deepEqual(check(...r('and its `timeout: 300000`', 'and no time limit', '## R5.')), ['write'])
})
