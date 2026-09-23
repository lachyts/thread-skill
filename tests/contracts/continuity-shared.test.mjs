// Continuity contracts stated once: the category-7 process scan lives in skills/_shared/process-scan.md
// and the handoff-doc lifecycle (with the thread-state transitions) in skills/_shared/handoff-lifecycle.md.
// Every writer cites them instead of restating them — the audit found the scan byte-duplicated across
// stash and defer and the lifecycle written out in five places, and the E2E baseline found the thread
// states specified per route (verb 11: a pickup never un-parked its thread). A restatement creeping back,
// a lost citation, or a state row drifting fails here. Reads files only; a missing file is a named
// assertion failure, never a crash at load.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const readIf = (p) => (fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p), 'utf8') : null)
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]))
  .sort()

const SCAN = 'skills/_shared/process-scan.md'
const LIFECYCLE = 'skills/_shared/handoff-lifecycle.md'
const SCAN_CITE = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/process-scan.md'
const LIFECYCLE_CITE = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/handoff-lifecycle.md'

// Every text file under skills/ (a NUL byte marks a binary, skipped).
const skillFiles = walk('skills')
  .map((file) => ({ file, text: readIf(file) }))
  .filter(({ text }) => text != null && !text.includes('\0'))

// The slice of `text` from the line matching `start` to the next line matching `stop` (exclusive), or null.
function slice(text, start, stop) {
  if (text == null) return null
  const lines = text.split('\n')
  const i = lines.findIndex((l) => start.test(l))
  if (i < 0) return null
  const j = lines.findIndex((l, k) => k > i && stop.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}

test('both shared continuity specs exist', () => {
  assert.ok(readIf(SCAN) != null, `${SCAN} is missing`)
  assert.ok(readIf(LIFECYCLE) != null, `${LIFECYCLE} is missing`)
})

test('each continuity phrase lives in exactly one file under skills/, its home', () => {
  assert.ok(skillFiles.filter(({ file }) => file.endsWith('/SKILL.md')).length >= 13,
    'walked fewer than 13 SKILL.md files — the scan is vacuous')
  const phrases = [
    ['never hand-roll a row or a ledger', SCAN],
    ['Which ledger a row goes to', SCAN],
    [/^#{2,3} Project directory resolution/m, SCAN],
    ['One doc, one consumer', LIFECYCLE],
    ['whoever marked it', LIFECYCLE],
    // How the scan reads `status:` sits beside the scan snippet (the procedure), not in the lifecycle.
    ['so a body that mentions `status: pending` does not count', 'skills/close/SKILL.md'],
  ]
  for (const [phrase, home] of phrases) {
    const hits = skillFiles
      .filter(({ text }) => (typeof phrase === 'string' ? text.includes(phrase) : phrase.test(text)))
      .map(({ file }) => file)
    assert.deepEqual(hits, [home], `"${phrase}" should occur only in ${home}, found in: ${JSON.stringify(hits)}`)
  }
})

test('close no longer carries a Project directory resolution heading', () => {
  const close = readIf('skills/close/SKILL.md')
  assert.ok(close != null, 'skills/close/SKILL.md is missing')
  assert.ok(!/^#{1,6}\s+Project directory resolution/m.test(close),
    'close still has a Project directory resolution heading (it lives in process-scan.md)')
})

test('the writers cite the shared specs by plugin path', () => {
  for (const skill of ['close', 'stash', 'defer']) {
    const text = readIf(`skills/${skill}/SKILL.md`)
    assert.ok(text != null && text.includes(SCAN_CITE), `${skill} does not cite ${SCAN_CITE}`)
  }
  for (const skill of ['close', 'handoff', 'open']) {
    const text = readIf(`skills/${skill}/SKILL.md`)
    assert.ok(text != null && text.includes(LIFECYCLE_CITE), `${skill} does not cite ${LIFECYCLE_CITE}`)
  }
})

test('handoff-lifecycle.md carries every heading later tasks cite', () => {
  const text = readIf(LIFECYCLE)
  assert.ok(text != null, `${LIFECYCLE} is missing`)
  for (const h of ['Front matter', 'States', 'Pickup', 'While pending', 'Close-out', 'Withdrawn', 'Thread state']) {
    assert.match(text, new RegExp(`^## ${h}\\s*$`, 'm'), `${LIFECYCLE} has no "## ${h}" heading`)
  }
})

test('§ Thread state maps each route to its state and INDEX group', () => {
  const section = slice(readIf(LIFECYCLE), /^## Thread state\s*$/, /^## /)
  assert.ok(section != null, `${LIFECYCLE} has no ## Thread state section`)
  const plain = (c) => c.replace(/[`*]/g, '').trim()
  const rows = section.split('\n')
    .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
    .map((l) => l.split('|').slice(1, -1).map(plain))
  const data = rows.slice(1)  // the first pipe row is the header
  // [route prefix, label, the `Sets state:` cell's leading word, the INDEX cell's leading group]
  const expect = [
    ['stash', 'stash', 'parked', '## Parked'],
    ['defer', 'defer', 'paused', '## Paused'],
    ['handoff', 'handoff', 'active', '## Active'],
    ['pickup', 'pickup', 'active', '## Active'],
    ['close', 'close / save', 'unchanged', '## Done'],
    ['creation', 'creation', 'active', '## Active'],
  ]
  assert.equal(data.length, expect.length,
    `expected ${expect.length} state rows, found ${data.length}: ${JSON.stringify(data.map((r) => r[0]))}`)
  for (const [prefix, label, state, group] of expect) {
    const hits = data.filter((cells) => cells[0].toLowerCase().startsWith(prefix))
    assert.equal(hits.length, 1, `expected one ${label} row in § Thread state, found ${hits.length}`)
    const [, stateCell = '', groupCell = ''] = hits[0]
    assert.match(stateCell, new RegExp(`^${state}\\b`), `${label} row's Sets state: cell does not lead with ${state}: ${stateCell}`)
    assert.ok(groupCell.startsWith(group), `${label} row does not move the INDEX line to ${group}: ${groupCell}`)
  }
  const close = data.find((cells) => cells[0].toLowerCase().startsWith('close'))
  assert.match(close[0], /\/thread:open save/, 'the close row does not name /thread:open save')
})

test('open pickups and task-writer § 6 apply § Thread state', () => {
  const open = readIf('skills/open/SKILL.md')
  const writer = readIf('skills/_shared/task-writer.md')
  const cite = /handoff-lifecycle\.md`?\s*§ Thread state/
  const slices = [
    ['open <slug> resume', slice(open, /^### `\/thread:open <slug>`/, /^### /)],
    ['open [[<task>]] pickup', slice(open, /^### `\/thread:open \[\[<task>\]\]`/, /^### /)],
    ['open handoff-doc pickup', slice(open, /^### `\/thread:open <path-to-handoff-doc>`/, /^### /)],
    ['task-writer § 6', slice(writer, /^## 6\./, /^## 7\./)],
  ]
  for (const [label, text] of slices) {
    assert.ok(text != null, `${label}: section not found`)
    assert.match(text, cite, `${label} does not cite handoff-lifecycle.md § Thread state`)
  }
})

test('handoff, close and § Withdrawn each run their § Thread state duty', () => {
  const cite = /handoff-lifecycle\.md`?\s*§ Thread state/
  // handoff § Handoff document applies the handoff row in its own **Thread state.** paragraph.
  const doc = slice(readIf('skills/handoff/SKILL.md'), /^## Handoff document/, /^## /)
  assert.ok(doc != null, 'handoff has no ## Handoff document section')
  const para = doc.split('\n').find((l) => l.startsWith('**Thread state.**'))
  assert.ok(para, 'handoff § Handoff document has no **Thread state.** paragraph')
  assert.match(para, cite, 'handoff\'s **Thread state.** paragraph does not cite handoff-lifecycle.md § Thread state')
  assert.match(para, /handoff row/, 'handoff\'s **Thread state.** paragraph does not name the handoff row')
  // handoff's withdrawal undoes that row.
  const lifecycle = doc.split('\n').find((l) => l.startsWith('**Lifecycle.**'))
  assert.ok(lifecycle && /undo the handoff row/.test(lifecycle) && /Resume instructions/.test(lifecycle),
    'handoff\'s withdrawal does not undo the handoff row (rewrite Resume instructions)')
  const withdrawn = slice(readIf(LIFECYCLE), /^## Withdrawn\s*$/, /^## /)
  assert.ok(withdrawn != null && /undoes the handoff row/.test(withdrawn) && /Resume instructions/.test(withdrawn),
    `${LIFECYCLE} § Withdrawn does not undo the handoff row (rewrite Resume instructions)`)
  // close step 4 applies the close row (which /thread:open save shares).
  const step4 = slice(readIf('skills/close/SKILL.md'), /^4\. \*\*Compute the thread-update diff/, /^5\. /)
  assert.ok(step4 != null, 'close has no Process step 4')
  assert.match(step4, cite, 'close step 4 does not cite handoff-lifecycle.md § Thread state')
  assert.match(step4, /close row/, 'close step 4 does not name § Thread state\'s close row')
})

test('open § Index updates lists the groups Active, Paused, Parked, Done in order', () => {
  const section = slice(readIf('skills/open/SKILL.md'), /^## Index updates/, /^## /)
  assert.ok(section != null, 'open has no ## Index updates section')
  // The prose after the INDEX-line example block names the groups; the example's enum is not the order.
  const prose = section.split(/```[\s\S]*?```/).slice(-1)[0]
  const at = ['Active', 'Paused', 'Parked', 'Done'].map((g) => [g, prose.indexOf(g)])
  for (const [g, i] of at) assert.ok(i >= 0, `open § Index updates does not name the ${g} group`)
  for (let k = 1; k < at.length; k++) {
    assert.ok(at[k - 1][1] < at[k][1], `open § Index updates: ${at[k - 1][0]} should come before ${at[k][0]}`)
  }
})

test('the close handoff-scan markers survive the extraction, once each', () => {
  const close = readIf('skills/close/SKILL.md') || ''
  assert.equal(close.split('\n').filter((l) => l.startsWith('# thread:handoff-scan')).length, 1)
  assert.equal(close.split('\n').filter((l) => l === '# end thread:handoff-scan').length, 1)
})
