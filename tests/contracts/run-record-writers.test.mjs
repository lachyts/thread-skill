// No event is written by a model (ADR 0032; p29-10, ADR 0051). The time-lost ledger's kinds (stopped, lead-entry,
// suite-started, suite-ended, base-moved) are each emitted by a script under skills/**/scripts or hooks/, never by
// prose: no skill or doc tells an agent to run `run_record.py emit`. And recording never delays a result a caller waits
// on: lead-integrate.py verify writes its suite-ended only after the rc and outcome files, and verify-slot.py run only
// after its slot is released, a heat-stopped run's (_heat_run_ended) too. Session-run work names the model that ran
// (p46-6). Pure matchers, so the real tree and the controls run through the same code. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { read, textFiles } from '../lib/contract-text.mjs'

export const LEDGER_KINDS = ['stopped', 'lead-entry', 'suite-started', 'suite-ended', 'base-moved']

// The scripts: every .py and .sh under skills/*/scripts and hooks/.
const scripts = () => [...textFiles('skills'), ...textFiles('hooks')]
  .filter(({ file }) => /^(skills\/[^/]+\/scripts|hooks)\/[^/]+\.(py|sh)$/.test(file))
// A kind is emitted when a script passes it to an emitter: reconcile-rollout.py's _event (directly, through its RR or rr
// alias, or through suite_started / suite_ended, which name it themselves).
export const emits = (text, kind) => new RegExp(`(?:_event|\\.emit)\\([^)\\n]*["']${kind}["']`).test(text)

// Prose: every .md file. A line that tells an agent to run the writer's CLI is a model write.
export const tellsEmit = (text) => /run_record\.py["']?\s+emit\b/.test(text)

// The body of a python def (to the next top-level def or class).
export function defBody(text, name) {
  const i = text.indexOf(`\ndef ${name}(`)
  if (i < 0) return ''
  const rest = text.slice(i + 1)
  const j = rest.slice(1).search(/\n(?:def |class )/)
  return j < 0 ? rest : rest.slice(0, j + 1)
}

export function checkOrder({ li, vs }) {
  const bad = []
  // cmd_verify writes <out>.pid and runs its body, _verify, inside a try whose finally drops it (p54-15).
  const verify = defBody(li, '_verify')
  const end = verify.lastIndexOf('_suite_end(')
  const rcWrite = verify.indexOf('_write_atomic(rc_path')
  const outcomeWrite = verify.lastIndexOf('_write_atomic(outcome_path')
  if (end < 0 || rcWrite < 0 || outcomeWrite < 0 || end < rcWrite || end < outcomeWrite) bad.push('verify')
  const run = defBody(vs, '_run_recorded')
  const ended = run.indexOf('suite_ended(')
  const release = run.indexOf('slot.release()')
  if (ended < 0 || release < 0 || ended < release || !vs.includes('return _run_recorded(')) bad.push('run')
  // The Heat hold's stop (contract item 7): the heat-stopped run's suite ends in _heat_run_ended, after its release.
  const heat = defBody(vs, '_heat_run_ended')
  const heatEnded = heat.indexOf('suite_ended(')
  const heatRelease = heat.indexOf('slot.release()')
  if (heatEnded < 0 || heatRelease < 0 || heatEnded < heatRelease || !run.includes('_heat_run_ended(')) bad.push('heat')
  return bad
}

test('each ledger kind is emitted by a script', () => {
  const files = scripts()
  for (const kind of LEDGER_KINDS) {
    const by = files.filter(({ text }) => emits(text, kind)).map(({ file }) => file)
    assert.ok(by.length > 0, `${kind}: emitted by a script under skills/*/scripts or hooks/`)
  }
})

// ADR 0067 d6: the Note overlap's kind has one writer, the PreToolUse hook, and no prose emits it.
test('note-overlap is emitted by the PreToolUse hook alone, never by prose', () => {
  const by = scripts().filter(({ text }) => emits(text, 'note-overlap')).map(({ file }) => file)
  assert.deepEqual(by, ['hooks/vault-note-overlap.py'])
  const md = [...textFiles('skills'), ...textFiles('docs'), ...textFiles('hooks')].filter(({ file }) => file.endsWith('.md'))
  assert.deepEqual(md.filter(({ text }) => /run_record\.py["']?\s+emit\b[^\n]*note-overlap/.test(text)).map(({ file }) => file), [])
})

// p46-2 (ADR 0079 decision 8): role-call is written after the fact, from a call's journal, by fold-journals alone.
test('role-call is emitted by reconcile-rollout.py alone, inside cmd_fold_journals, never by prose', () => {
  const by = scripts().filter(({ text }) => emits(text, 'role-call')).map(({ file }) => file)
  assert.deepEqual(by, ['skills/execute/scripts/reconcile-rollout.py'])
  const rr = read('skills/execute/scripts/reconcile-rollout.py')
  const fold = defBody(rr, 'cmd_fold_journals')
  assert.ok(emits(fold, 'role-call'), 'the emit sits inside cmd_fold_journals')
  assert.ok(!emits(rr.replace(fold, ''), 'role-call'), 'and nowhere else in the file')
  const md = [...textFiles('skills'), ...textFiles('docs'), ...textFiles('hooks')].filter(({ file }) => file.endsWith('.md'))
  assert.deepEqual(md.filter(({ text }) => /run_record\.py["']?\s+emit\b[^\n]*role-call/.test(text)).map(({ file }) => file), [])
})

// p46-3 (ADR 0079 decision 6): fable-share is written at each arms draw, by reconcile-rollout.py's two draw helpers alone.
test('fable-share is emitted by reconcile-rollout.py alone, inside _start_arms and _lead_arm, never by prose', () => {
  const by = scripts().filter(({ text }) => emits(text, 'fable-share')).map(({ file }) => file)
  assert.deepEqual(by, ['skills/execute/scripts/reconcile-rollout.py'])
  const rr = read('skills/execute/scripts/reconcile-rollout.py')
  const helpers = ['_start_arms', '_lead_arm'].map((name) => defBody(rr, name))
  assert.ok(helpers.every((b) => emits(b, 'fable-share')), 'each draw helper emits it')
  assert.ok(!emits(helpers.reduce((t, b) => t.replace(b, ''), rr), 'fable-share'), 'and nowhere else in the file')
  const md = [...textFiles('skills'), ...textFiles('docs'), ...textFiles('hooks')].filter(({ file }) => file.endsWith('.md'))
  assert.deepEqual(md.filter(({ text }) => /run_record\.py["']?\s+emit\b[^\n]*fable-share/.test(text)).map(({ file }) => file), [])
})

// p54-7 (ADR 0084 Decided for you 3): master-run has one writer, master-runs' locked write (_master_locked), on one line.
test('master-run is emitted by reconcile-rollout.py alone, inside _master_locked, never by prose', () => {
  const by = scripts().filter(({ text }) => emits(text, 'master-run')).map(({ file }) => file)
  assert.deepEqual(by, ['skills/execute/scripts/reconcile-rollout.py'])
  const rr = read('skills/execute/scripts/reconcile-rollout.py')
  const locked = defBody(rr, '_master_locked')
  assert.ok(/_event\(ro, "master-run", None, fields, args\)/.test(locked), 'the emit sits inside _master_locked, on one line')
  assert.ok(!emits(rr.replace(locked, ''), 'master-run'), 'and nowhere else in the file')
  const md = [...textFiles('skills'), ...textFiles('docs'), ...textFiles('hooks')].filter(({ file }) => file.endsWith('.md'))
  assert.deepEqual(md.filter(({ text }) => /run_record\.py["']?\s+emit\b[^\n]*master-run/.test(text)).map(({ file }) => file), [])
})

// p46-4 (ADR 0079 d9): the arms line is the Reflection's own, written once by reflect.py close before its reflection line.
export const armsWriters = (rx) => {
  const close = defBody(rx, 'cmd_close')
  const at = close.indexOf('write_line("arms"')
  return { inClose: at >= 0 && at < close.indexOf('write_line("reflection"'), elsewhere: rx.replace(close, '').includes('write_line("arms"') }
}

test('the arms line is written by reflect.py cmd_close alone, before its reflection line', () => {
  assert.deepEqual(armsWriters(read('skills/reflect/scripts/reflect.py')), { inClose: true, elsewhere: false })
})

test('control: an arms write outside cmd_close, or after the reflection line, fails', () => {
  const rx = read('skills/reflect/scripts/reflect.py')
  const close = defBody(rx, 'cmd_close')
  const late = close.replace('        write_line("arms", arms_fields, a.dry_run)\n    write_line("reflection", fields, a.dry_run)\n',
    '    write_line("reflection", fields, a.dry_run)\n    if arms_fields is not None:\n        write_line("arms", arms_fields, a.dry_run)\n')
  assert.notEqual(late, close, 'the mutation applied')
  assert.equal(armsWriters(rx.replace(close, late)).inClose, false)
  const decide = defBody(rx, 'cmd_decide')
  assert.equal(armsWriters(rx.replace(decide, `${decide}    write_line("arms", {}, False)\n`)).elsewhere, true)
})

// p46-6 (ADR 0079 decision 5): session-run work records the model and effort that ran beside the result it already
// writes, through the script that writes it (never an emit) or on its own vault note: the graders' grade lines
// (orient-all, schedule), the Monthly audit's line, the owner labels' attention line and the Reflection's own (reflect),
// each task orient shapes and each repair run's rollout note. The model is named by the session (a skill cannot read
// or set it), so the prose is the pin.
const EFFORT = '--effort "${CLAUDE_EFFORT:-}"'
const RAN_ON = [
  ['skills/orient-all/SKILL.md', `--scan "$S/scan.json" --model <model id> ${EFFORT}\``],
  ['skills/schedule/SKILL.md', `--scan "$S/scan.json" --model <model id> ${EFFORT}\``],
  ['skills/reflect/SKILL.md', `audit.json --model <model id> ${EFFORT}]`],
  ['skills/reflect/SKILL.md', `owners.json --model <model id> ${EFFORT}\n`],
  ['skills/reflect/SKILL.md', `span.json --model <model id> ${EFFORT}\n`],
  ['skills/orient/reshuffle.md', '`- <UTC ISO> orient ran on <model id> at <effort>`'],
  ['skills/repair/SKILL.md', '`- <YYYY-MM-DD> repair: ran on <model id> at <effort>`'],
]

test('session-run work names the model and effort that ran on the result it writes', () => {
  assert.deepEqual(RAN_ON.filter(([file, needle]) => !read(file).includes(needle)), [])
})

test('no skill or doc tells an agent to run run_record.py emit', () => {
  const md = [...textFiles('skills'), ...textFiles('docs'), ...textFiles('hooks')].filter(({ file }) => file.endsWith('.md'))
  for (const f of ['README.md', 'CONTEXT.md']) md.push({ file: f, text: read(f) })
  assert.deepEqual(md.filter(({ text }) => tellsEmit(text)).map(({ file }) => file), [])
})

test('recording never delays a result: verify ends its suite after the rc and outcome files, run after the release', () => {
  assert.deepEqual(checkOrder({ li: read('skills/execute/scripts/lead-integrate.py'), vs: read('skills/execute/scripts/verify-slot.py') }), [])
})

// ---- controls ------------------------------------------------------------------------------------------------

test('control: the matchers', () => {
  assert.ok(emits('    _event(rollout, "stopped", None, fields, args)\n', 'stopped'))
  assert.ok(emits('        RR._event(stem, "stopped", None, {"cause": "usage-limit"})\n', 'stopped'))
  assert.ok(emits('            return _event(rollout, "suite-ended", task, fields)\n', 'suite-ended'))
  assert.ok(emits('                RR.emit(editor["rollout"], "note-overlap", editor["task"], fields)\n', 'note-overlap'), 'the hook\'s one-line emit')
  assert.ok(!emits('# writes a "stopped" line\n', 'stopped'), 'a comment is not an emit')
  assert.ok(!emits('    if d.get("kind") == "stopped":\n', 'stopped'), 'a read is not an emit')
  assert.ok(tellsEmit('Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/run_record.py emit --kind stopped`.'))
  assert.ok(!tellsEmit('`run_record.py` is the one writer; every emitter goes through it.'))
})

test('control: an ended line written before the rc file, or before the slot is released (a heat stop too), fails the order', () => {
  const li = read('skills/execute/scripts/lead-integrate.py')
  const vs = read('skills/execute/scripts/verify-slot.py')
  const early = li.replace('    try:\n        for s in SIGNALS:   # inside the try', '    _suite_end(rec, rc, result, log_path, args)\n    try:\n        for s in SIGNALS:   # inside the try')
    .replace(/\n {8}if rec is not None:\n {12}_suite_end\(rec, rc, result, log_path, args\)/, '')
  assert.notEqual(early, li, 'the mutation applied')
  assert.deepEqual(checkOrder({ li: early, vs }), ['verify'])
  const held = vs.replace('    finally:\n        if slot is not None:\n            slot.release()\n    try:\n        if written.get("started")',
    '        rr.suite_ended(*common, "red", 0)\n    finally:\n        if slot is not None:\n            slot.release()\n    try:\n        if written.get("started")')
    .replace(/\n {16}rr\.suite_ended\(\*common, "stopped"[^\n]*/, '').replace(/\n {16}rr\.suite_ended\(\*common, outcome[^\n]*/, '')
  assert.notEqual(held, vs, 'the mutation applied')
  assert.deepEqual(checkOrder({ li, vs: held }), ['run'])
  const hot = vs.replace(/\n {4}slot\.release\(\)\n( {4}if written\.get\("started"\):\n {8}rr\.suite_ended\([^)]*\))/, '\n$1\n    slot.release()')
  assert.notEqual(hot, vs, 'the mutation applied')
  assert.deepEqual(checkOrder({ li, vs: hot }), ['heat'])
})
