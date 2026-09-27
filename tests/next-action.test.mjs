// skills/_shared/scripts/next-action.py — the next-action slot's one writer and reader (estate ADR 0008;
// task-writer § 4b). Each case builds a throwaway vault under a temp dir and runs the shipped script on it
// with --vault, so nothing touches the real vault. The frontmatter checks are byte-level: a set-down
// changes exactly one line per note and leaves every other byte alone.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'next-action.py')

function vault(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-action-'))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')
const snapshot = (dir) => Object.fromEntries(
  fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => [f, read(dir, f)]))

function run(dir, args) {
  const r = spawnSync('python3', [SCRIPT, '--vault', dir, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
function ok(dir, args) {
  const r = run(dir, args)
  assert.equal(r.stderr, '', `stderr for ${args.join(' ')}`)
  assert.equal(r.status, 0)
  return r.stdout.trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
}
function refused(dir, args, pattern) {
  const before = snapshot(dir)
  const r = run(dir, args)
  assert.equal(r.status, 2, `status for ${args.join(' ')}; stderr: ${r.stderr}`)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^next-action: \S.*\n$/)
  if (pattern) assert.match(r.stderr, pattern)
  assert.deepEqual(snapshot(dir), before, 'a refusal writes nothing')
}

const task = (fm, body = '\n## Notes\n\nBody.\n') => `---\n${fm}\n---\n${body}`
const T = 'Work/Tasks'
const P = 'Work/Projects'

// A vault with one project of each kind the set-down meets.
function estate() {
  return vault({
    [`${T}/cap.md`]: task('tags: [task, vault, thread]\nstatus: open\nprojects: ["[[Alpha]]", "[[Beta]]", "[[Area]]", "[[Old]]", "[[Vault]]", "[[Loose]]"]\ncaptured: 2026-09-01\nnext_action: Old step'),
    [`${T}/live.md`]: task('tags: [task]\nstatus: open\nnext_action: Ring the council'),
    [`${T}/finished.md`]: task('tags: [task]\nstatus: done'),
    [`${P}/A/Alpha.md`]: task('tags:\n  - project\nstatus: queued\nnext_task: "[[live]]"\ndone: false', '\n# Alpha\n\nKeep me.\n'),
    [`${P}/B/Beta.md`]: task('tags: [project]\nstatus: crowned'),
    [`${P}/Area/Area.md`]: task('tags: [area]'),
    [`${P}/Archive/Old.md`]: task('tags: [project]'),
    ['Notes/Loose.md']: task('tags: [note]'),
  })
}

test('set-down overwrites next_action, points every project note at the task, skips the rest', () => {
  const dir = estate()
  const rows = ok(dir, ['set-down', `${T}/cap.md`, '--action', 'Draft the schema'])
  assert.deepEqual(rows, [
    ['task', 'cap', 'next_action', 'written'],
    ['skip', 'Area', `area note (${P}/Area/Area.md)`],
    ['skip', 'Old', 'archived'],
    ['skip', 'Vault', 'no note'],
    ['skip', 'Loose', 'not a project note (Notes/Loose.md)'],
    ['project', 'Alpha', 'next_task', 'written', `${P}/A/Alpha.md`],
    ['project', 'Beta', 'next_task', 'written', `${P}/B/Beta.md`],
  ])
  assert.match(read(dir, `${T}/cap.md`), /^next_action: "Draft the schema"$/m)
  assert.doesNotMatch(read(dir, `${T}/cap.md`), /Old step/)
  // A set slot is overwritten in place; every other byte of the note is untouched.
  assert.equal(read(dir, `${P}/A/Alpha.md`),
    '---\ntags:\n  - project\nstatus: queued\nnext_task: "[[cap]]"\ndone: false\n---\n\n# Alpha\n\nKeep me.\n')
  // An absent slot is added as the last frontmatter line.
  assert.equal(read(dir, `${P}/B/Beta.md`), '---\ntags: [project]\nstatus: crowned\nnext_task: "[[cap]]"\n---\n\n## Notes\n\nBody.\n')
  assert.equal(read(dir, `${P}/Area/Area.md`), task('tags: [area]'), 'an area note is never written')
  assert.equal(read(dir, `${P}/Archive/Old.md`), task('tags: [project]'), 'an archived project is never written')
})

test('a second identical set-down reports unchanged and rewrites nothing', () => {
  const dir = estate()
  ok(dir, ['set-down', 'cap', '--action', 'Draft the schema'])
  const before = snapshot(dir)
  const rows = ok(dir, ['set-down', 'cap', '--action', 'Draft the schema'])
  assert.deepEqual(rows.filter((r) => r[0] !== 'skip').map((r) => r[3]), ['unchanged', 'unchanged', 'unchanged'])
  assert.deepEqual(snapshot(dir), before)
})

test('any one-line action survives as valid YAML: always double-quoted, JSON-escaped', () => {
  for (const action of ['Ask the council:', 'Fix #12 then ship', 'Say "hi" to C:\\temp', "- don't start with a dash", 'Tab\there', '[bracket] {brace} & *star']) {
    const dir = estate()
    ok(dir, ['set-down', 'cap', '--action', action])
    const line = read(dir, `${T}/cap.md`).split('\n').find((l) => l.startsWith('next_action: '))
    assert.equal(JSON.parse(line.slice('next_action: '.length)), action, `round-trip of ${JSON.stringify(action)}`)
  }
})

test('block-form tags and projects are read like inline ones', () => {
  const dir = vault({
    [`${T}/cap.md`]: task('tags:\n  - task\n  - thread\nstatus: open\nprojects:\n  - "[[Alpha]]"\n  - "[[Area]]"'),
    [`${P}/Alpha.md`]: task('tags:\n- project\nnext_task:\n  - "[[gone]]"\nstatus: queued'),
    [`${P}/Area.md`]: task('tags:\n  - area'),
  })
  const rows = ok(dir, ['set-down', 'cap', '--action', 'Go'])
  assert.deepEqual(rows.slice(1), [['skip', 'Area', `area note (${P}/Area.md)`], ['project', 'Alpha', 'next_task', 'written', `${P}/Alpha.md`]])
  // A block-list value is replaced whole by the one line.
  assert.equal(read(dir, `${P}/Alpha.md`), task('tags:\n- project\nnext_task: "[[cap]]"\nstatus: queued'))
})

test('CRLF notes keep CRLF', () => {
  const dir = vault({
    [`${T}/cap.md`]: '---\r\ntags: [task]\r\nstatus: open\r\nprojects: ["[[Alpha]]"]\r\n---\r\nBody\r\n',
    [`${P}/Alpha.md`]: '---\r\ntags: [project]\r\n---\r\n',
  })
  ok(dir, ['set-down', 'cap', '--action', 'Go'])
  assert.equal(read(dir, `${T}/cap.md`), '---\r\ntags: [task]\r\nstatus: open\r\nprojects: ["[[Alpha]]"]\r\nnext_action: "Go"\r\n---\r\nBody\r\n')
  assert.equal(read(dir, `${P}/Alpha.md`), '---\r\ntags: [project]\r\nnext_task: "[[cap]]"\r\n---\r\n')
})

test('fill writes only blanks: a live slot is kept, a blank or dead one is filled, a set next_action stays', () => {
  const dir = vault({
    [`${T}/rec.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Live]]", "[[Blank]]", "[[Dead]]"]\nnext_action: Mine'),
    [`${T}/other.md`]: task('tags: [task]\nstatus: in_progress'),
    [`${T}/finished.md`]: task('tags: [task]\nstatus: merged'),
    [`${P}/Live.md`]: task('tags: [project]\nnext_task: "[[other]]"'),
    [`${P}/Blank.md`]: task('tags: [project]\nnext_task:'),
    [`${P}/Dead.md`]: task('tags: [project]\nnext_task: "[[finished]]"'),
  })
  const rows = ok(dir, ['fill', 'rec', '--action', 'Theirs'])
  assert.deepEqual(rows.map((r) => [r[1], r[3]]), [['rec', 'kept'], ['Live', 'kept'], ['Blank', 'written'], ['Dead', 'written']])
  assert.match(read(dir, `${T}/rec.md`), /^next_action: Mine$/m)
  assert.match(read(dir, `${P}/Live.md`), /^next_task: "\[\[other\]\]"$/m)
  assert.match(read(dir, `${P}/Blank.md`), /^next_task: "\[\[rec\]\]"$/m)
  assert.match(read(dir, `${P}/Dead.md`), /^next_task: "\[\[rec\]\]"$/m)
})

test('fill writes a blank next_action, and without --action leaves it alone', () => {
  const dir = vault({ [`${T}/rec.md`]: task('tags: [task]\nstatus: open\nnext_action: ""') })
  assert.deepEqual(ok(dir, ['fill', 'rec']), [['task', 'rec', 'next_action', 'kept']])
  assert.deepEqual(ok(dir, ['fill', 'rec', '--action', 'Start']), [['task', 'rec', 'next_action', 'written']])
  assert.match(read(dir, `${T}/rec.md`), /^next_action: "Start"$/m)
})

test('refusals exit 2 and write nothing', () => {
  const dir = estate()
  refused(dir, ['set-down', 'finished', '--action', 'Go'], /is done; a pointer to it would be dead/)
  refused(dir, ['set-down', 'nope', '--action', 'Go'], /no task note/)
  refused(dir, ['set-down', 'cap', '--action', 'one\ntwo'], /one line/)
  refused(dir, ['set-down', 'cap', '--action', '   '], /blank/)
  refused(dir, ['set-down', 'cap'], /--action/)
  const dup = vault({ [`${T}/dup.md`]: task('tags: [task]\nstatus: open\nnext_action: a\nnext_action: b') })
  refused(dup, ['set-down', 'dup', '--action', 'Go'], /more than once/)
  const bare = vault({ [`${T}/bare.md`]: 'no frontmatter\n' })
  refused(bare, ['set-down', 'bare', '--action', 'Go'], /no closed frontmatter/)
  const arch = vault({ [`${T}/Archive/old.md`]: task('tags: [task]\nstatus: open') })
  refused(arch, ['set-down', `${T}/Archive/old.md`, '--action', 'Go'], /archived/)
})

test('a project note whose slot cannot be edited safely is skipped, the rest still written', () => {
  const dir = vault({
    [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Twice]]", "[[Fine]]"]'),
    [`${P}/Twice.md`]: task('tags: [project]\nnext_task: a\nnext_task: b'),
    [`${P}/Fine.md`]: task('tags: [project]'),
  })
  const rows = ok(dir, ['set-down', 'cap', '--action', 'Go'])
  assert.deepEqual(rows.slice(1).map((r) => [r[0], r[1]]), [['skip', 'Twice'], ['project', 'Fine']])
  assert.match(rows[1][2], /frontmatter not editable/)
})

test('read: a slot is live, blank, or dead by the shared rule', () => {
  const dir = vault({
    [`${T}/open.md`]: task('tags: [task]\nstatus: open\nnext_action: Ring the council'),
    [`${T}/untitled.md`]: task('tags: [task]\nstatus: in_progress'),
    [`${T}/done.md`]: task('tags: [task]\nstatus: done'),
    [`${T}/tagged.md`]: task('tags: [task, archived]\nstatus: open'),
    [`${T}/Archive/moved.md`]: task('tags: [task]\nstatus: open'),
    [`${P}/Live.md`]: task('tags: [project]\nnext_task: "[[open]]"'),
    [`${P}/Titled.md`]: task('tags: [project]\nnext_task: "[[untitled]]"'),
    [`${P}/Blank.md`]: task('tags: [project]'),
    [`${P}/Done.md`]: task('tags: [project]\nnext_task: "[[done]]"'),
    [`${P}/Tagged.md`]: task('tags: [project]\nnext_task: "[[tagged]]"'),
    [`${P}/Moved.md`]: task('tags: [project]\nnext_task: "[[moved]]"'),
    [`${P}/Missing.md`]: task('tags: [project]\nnext_task: "[[nowhere]]"'),
    [`${P}/Unquoted.md`]: task('tags: [project]\nnext_task: [[open]]'),
  })
  const rows = ok(dir, ['read', 'Live', 'Titled', 'Blank', 'Done', 'Tagged', 'Moved', 'Missing', 'Unquoted'])
  assert.deepEqual(rows.map((r) => [r[1], r[2], r[4] ?? '']), [
    ['Live', 'live', 'Ring the council'],
    ['Titled', 'live', 'untitled'],
    ['Blank', 'blank', ''],
    ['Done', 'dead:done done', ''],
    ['Tagged', 'dead:tagged archived', ''],
    ['Moved', 'dead:moved archived', ''],
    ['Missing', 'dead:nowhere missing', ''],
    ['Unquoted', 'live', 'Ring the council'],
  ])
})

test('captures: open or in_progress tasks, either tag form, by thread tag, slug or thread file', () => {
  const dir = vault({
    [`${T}/inline.md`]: task('tags: [task, thread]\nstatus: open'),
    [`${T}/block.md`]: task('tags:\n  - task\n  - thread\nstatus: in_progress'),
    [`${T}/rollout.md`]: task('tags: [task]\nstatus: in_progress', '\nThread: /Users/x/Projects/A/THREAD.md\n'),
    [`${T}/named.md`]: task('tags: [task]\nstatus: open'),
    [`${T}/closed.md`]: task('tags: [task, thread]\nstatus: done'),
    [`${T}/shelved.md`]: task('tags: [task, thread, archived]\nstatus: open'),
    [`${T}/Archive/old.md`]: task('tags: [task, thread]\nstatus: open'),
    [`${T}/unrelated.md`]: task('tags: [task]\nstatus: open'),
  })
  const rows = ok(dir, ['captures', '--slug', 'named', '--thread-file', '/Users/x/Projects/A/THREAD.md'])
  assert.deepEqual(rows, [
    ['capture', 'block', 'in_progress', 'thread-tag'],
    ['capture', 'inline', 'open', 'thread-tag'],
    ['capture', 'named', 'open', 'slug'],
    ['capture', 'rollout', 'in_progress', 'thread-file'],
  ])
})

test('--json emits the same rows as objects', () => {
  const dir = estate()
  const r = run(dir, ['read', 'Alpha', '--json'])
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), [{ kind: 'slot', name: 'Alpha', result: 'live', task: 'live', next_action: 'Ring the council' }])
})

test('exit 3 when the vault is missing', () => {
  const r = run('/nonexistent/vault', ['read', 'Alpha'])
  assert.equal(r.status, 3)
  assert.match(r.stderr, /^next-action: no vault at /)
})
