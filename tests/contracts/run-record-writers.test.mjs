// No event is written by a model (ADR 0032; p29-10, ADR 0051). The time-lost ledger's kinds (stopped, lead-entry,
// suite-started, suite-ended, base-moved) are each emitted by a script under skills/**/scripts or hooks/, never by
// prose: no skill or doc tells an agent to run `run_record.py emit`. And recording never delays a result a caller waits
// on: lead-integrate.py verify writes its suite-ended only after the rc and outcome files, and verify-slot.py run only
// after its slot is released. Pure matchers, so the real tree and the controls run through the same code. Reads files
// only.
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
  const verify = defBody(li, 'cmd_verify')
  const end = verify.lastIndexOf('_suite_end(')
  const rcWrite = verify.indexOf('_write_atomic(rc_path')
  const outcomeWrite = verify.lastIndexOf('_write_atomic(outcome_path')
  if (end < 0 || rcWrite < 0 || outcomeWrite < 0 || end < rcWrite || end < outcomeWrite) bad.push('verify')
  const run = defBody(vs, '_run_recorded')
  const ended = run.indexOf('suite_ended(')
  const release = run.indexOf('slot.release()')
  if (ended < 0 || release < 0 || ended < release || !vs.includes('return _run_recorded(')) bad.push('run')
  return bad
}

test('each ledger kind is emitted by a script', () => {
  const files = scripts()
  for (const kind of LEDGER_KINDS) {
    const by = files.filter(({ text }) => emits(text, kind)).map(({ file }) => file)
    assert.ok(by.length > 0, `${kind}: emitted by a script under skills/*/scripts or hooks/`)
  }
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
  assert.ok(!emits('# writes a "stopped" line\n', 'stopped'), 'a comment is not an emit')
  assert.ok(!emits('    if d.get("kind") == "stopped":\n', 'stopped'), 'a read is not an emit')
  assert.ok(tellsEmit('Run `python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/run_record.py emit --kind stopped`.'))
  assert.ok(!tellsEmit('`run_record.py` is the one writer; every emitter goes through it.'))
})

test('control: an ended line written before the rc file, or before the slot is released, fails the order', () => {
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
})
