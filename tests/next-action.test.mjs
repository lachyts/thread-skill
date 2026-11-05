// skills/_shared/scripts/next-action.py — the next-action slot's one writer and reader (estate ADR 0008;
// task-writer § 4b). Each case builds a throwaway vault under a temp dir and runs the shipped script on it
// with --vault, so nothing touches the real vault. The frontmatter checks are byte-level: a set-down
// changes exactly one line per note and leaves every other byte alone.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root } from './lib/contract-text.mjs'
import { REVERSED_WALK } from './lib/reversed-walk.mjs'

const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'next-action.py')

// Every throwaway vault lives under one temp dir, removed when the file's tests end.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'next-action-'))
after(() => fs.rmSync(scratch, { recursive: true, force: true }))

function vault(files) {
  const dir = fs.mkdtempSync(path.join(scratch, 'vault-'))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')
const snapshot = (dir) => Object.fromEntries(
  fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => [f, read(dir, f)]))

function run(dir, args, { cwd, input, pyFlags = [], env } = {}) {
  return spawnSync('python3', [...pyFlags, SCRIPT, '--vault', dir, ...args],
    { encoding: 'utf8', cwd, input, env: env ? { ...process.env, ...env } : undefined })
}
function ok(dir, args, opts) {
  const r = run(dir, args, opts)
  assert.equal(r.stderr, '', `stderr for ${args.join(' ')}`)
  assert.equal(r.status, 0)
  return r.stdout.trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
}
function refused(dir, args, pattern, opts) {
  const before = snapshot(dir)
  const r = run(dir, args, opts)
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
    ['project', 'Alpha', 'next_task', 'written', `${P}/A/Alpha.md`],
    ['project', 'Beta', 'next_task', 'written', `${P}/B/Beta.md`],
    ['skip', 'Area', `area note (${P}/Area/Area.md)`],
    ['skip', 'Old', 'archived'],
    ['skip', 'Vault', 'no note'],
    ['skip', 'Loose', 'not a project note (Notes/Loose.md)'],
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
  assert.deepEqual(rows.slice(1), [['project', 'Alpha', 'next_task', 'written', `${P}/Alpha.md`], ['skip', 'Area', `area note (${P}/Area.md)`]])
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
  refused(arch, ['set-down', `${T}/Archive/old.md`, '--action', 'Go'], /not directly under Work\/Tasks/)
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

test('read: a live slot task whose frontmatter does not parse is unparseable, never live with its step lost', () => {
  const dir = vault({
    [`${T}/broken.md`]: task('tags: [task]\nstatus: open\nnext_action: Build A2 from the board: the name first'),
    [`${P}/Broke.md`]: task('tags: [project]\nnext_task: "[[broken]]"'),
  })
  // The why names the line (the file's own, 1-based) and its top-level key, so a reader can go straight to it.
  assert.deepEqual(ok(dir, ['read', 'Broke']).map((r) => [r[1], r[2], r[3], r[4]]), [
    ['Broke', 'unparseable:frontmatter does not parse (line 4, next_action)', 'broken', 'broken'],
  ])
})

test('read: every way a slot task can be unreadable is named with its cause and place; a note with none reads live', () => {
  fs.mkdirSync(path.join(scratch, 'gone'), { recursive: true })
  const dir = vault({
    // A bare quote inside quotes: the problem mark (line 4), never the context mark (the mapping's start, line 2).
    [`${T}/quote.md`]: task('tags: [task]\nstatus: open\ntitle: "A "B" C"'),
    // A value that scans but will not construct: a ValueError with no mark, never a traceback.
    [`${T}/date.md`]: task('tags: [task]\nstatus: open\ndue: 2026-02-30'),
    // A ConstructorError carries its mark.
    [`${T}/tag.md`]: task('tags: [task]\nstatus: open\nx: !foo bar'),
    // A run-on value: the mark sits on the continuation line, named by the top-level key it belongs to.
    [`${T}/runon.md`]: task('tags: [task]\nstatus: open\nnext_action: Build A2 from\n  the board: the name first'),
    // A flow list that never closes: named on its own line, though the mark falls past the end of the block.
    [`${T}/flow.md`]: task('tags: [task'),
    [`${T}/unclosed.md`]: '---\ntags: [task]\nstatus: open\n\n# Never closed\n',
    [`${T}/plain.md`]: '# Plain\n\nJust a markdown note.\n',
    [`${T}/empty.md`]: '',
    [`${T}/broken.md`]: task('tags: [task]\nstatus: open\nnext_action: a: b'),
    [`${T}/good.md`]: task('tags: [task]\nstatus: open\nnext_action: Ring the council'),
    [`${P}/Quote.md`]: task('tags: [project]\nnext_task: "[[quote]]"'),
    [`${P}/Date.md`]: task('tags: [project]\nnext_task: "[[date]]"'),
    [`${P}/Tag.md`]: task('tags: [project]\nnext_task: "[[tag]]"'),
    [`${P}/Runon.md`]: task('tags: [project]\nnext_task: "[[runon]]"'),
    [`${P}/Flow.md`]: task('tags: [project]\nnext_task: "[[flow]]"'),
    [`${P}/Unclosed.md`]: task('tags: [project]\nnext_task: "[[unclosed]]"'),
    [`${P}/Gone.md`]: task('tags: [project]\nnext_task: "[[dangling]]"'),
    [`${P}/Plain.md`]: task('tags: [project]\nnext_task: "[[plain]]"'),
    [`${P}/Empty.md`]: task('tags: [project]\nnext_task: "[[empty]]"'),
    [`${P}/Pair.md`]: task('tags: [project]\nnext_task: ["[[broken]]", "[[good]]"]'),
    [`${P}/Both.md`]: task('tags: [project]\nnext_task: ["[[broken]]", "[[quote]]"]'),
  })
  fs.symlinkSync(path.join(scratch, 'gone', 'nothing.md'), path.join(dir, T, 'dangling.md'))  // a moved file
  const names = ['Quote', 'Date', 'Tag', 'Runon', 'Flow', 'Unclosed', 'Gone', 'Plain', 'Empty', 'Pair', 'Both']
  assert.deepEqual(ok(dir, ['read', ...names]).map((r) => r.slice(1, 5)), [
    ['Quote', 'unparseable:frontmatter does not parse (line 4, title)', 'quote', 'quote'],
    ['Date', 'unparseable:frontmatter does not parse (line 4, due)', 'date', 'date'],
    ['Tag', 'unparseable:frontmatter does not parse (line 4, x)', 'tag', 'tag'],
    ['Runon', 'unparseable:frontmatter does not parse (line 5, next_action)', 'runon', 'runon'],
    ['Flow', 'unparseable:frontmatter does not parse (line 2, tags)', 'flow', 'flow'],
    ['Unclosed', 'unparseable:no closed frontmatter', 'unclosed', 'unclosed'],
    ['Gone', 'unparseable:unreadable', 'dangling', 'dangling'],
    // No frontmatter at all is out of scope, never broken (an empty Untitled.md included): it reads live.
    ['Plain', 'live', 'plain', 'plain'],
    ['Empty', 'live', 'empty', 'empty'],
    // A broken link first, a readable one after: the readable one is the slot; all broken, the first one's why.
    ['Pair', 'live', 'good', 'Ring the council'],
    ['Both', 'unparseable:frontmatter does not parse (line 4, next_action)', 'broken', 'broken'],
  ])
})

// ---- mend: quote the plain value a frontmatter's YAML error names, re-parsed before anything is saved ------------
test('mend quotes a free-text value holding `: `, and the note differs on that one line only', () => {
  // chorus-p95-2's shape (2026-11-04): block lists, empty values, and one unquoted `: ` in next_action.
  const fm = 'tags:\n  - task\n  - ai\nstatus: open\nprojects:\n  - "[[Chorus]]"\nscheduled: \ndue: \n' +
    'next_action: Build A2 from the mockup board: the name first\ncaptured: 2026-11-04'
  const before = task(fm)
  const dir = vault({ [`${T}/p95.md`]: before })
  assert.deepEqual(ok(dir, ['mend', 'p95']), [['mend', 'p95', 'mended:next_action']])
  const after = read(dir, `${T}/p95.md`)
  const a = before.split('\n')
  const b = after.split('\n')
  assert.equal(a.length, b.length)
  assert.deepEqual(a.map((l, i) => [l, b[i]]).filter(([x, y]) => x !== y),
    [['next_action: Build A2 from the mockup board: the name first', 'next_action: "Build A2 from the mockup board: the name first"']])
  // It reads back as exactly the text that was written, and a second mend finds nothing to do.
  const p = vault({ [`${T}/p95.md`]: after, [`${P}/C.md`]: task('tags: [project]\nnext_task: "[[p95]]"') })
  assert.deepEqual(ok(p, ['read', 'C']), [['slot', 'C', 'live', 'p95', 'Build A2 from the mockup board: the name first']])
  assert.deepEqual(ok(dir, ['mend', 'p95']), [['mend', 'p95', 'parses']])
  assert.equal(read(dir, `${T}/p95.md`), after)
})

test('mend quotes a bare-quoted value whole, and mends two broken lines in one call', () => {
  const dir = vault({
    [`${T}/quote.md`]: task('tags: [task]\nstatus: open\ntitle: "A "B" C"'),
    [`${T}/two.md`]: task('tags: [task]\nstatus: open\ntitle: Plan: the first\nnext_action: Ring: the council'),
  })
  assert.deepEqual(ok(dir, ['mend', 'quote']), [['mend', 'quote', 'mended:title']])
  assert.equal(read(dir, `${T}/quote.md`), task('tags: [task]\nstatus: open\ntitle: "\\"A \\"B\\" C\\""'))
  assert.deepEqual(ok(dir, ['mend', 'two']), [['mend', 'two', 'mended:title,next_action']])
  assert.equal(read(dir, `${T}/two.md`),
    task('tags: [task]\nstatus: open\ntitle: "Plan: the first"\nnext_action: "Ring: the council"'))
})

test('mend reads its result back through compose, nested keys and a recursive alias included', () => {
  const dir = vault({
    [`${T}/nested.md`]: task('tags: [task]\nmeta:\n  note: a: b\nstatus: open'),
    // An anchor holding an alias to itself composes to a node that contains itself: the readback walk never loops.
    [`${T}/loop.md`]: task('tags: [task]\nloop: &x [*x]\nnext_action: a: b'),
    // A quoted top-level key is outside TOP_KEY's class, so the key sets differ: refused, never guessed.
    [`${T}/qkey.md`]: task('tags: [task]\n"quoted key": x\nnext_action: a: b'),
  })
  assert.deepEqual(ok(dir, ['mend', 'nested']), [['mend', 'nested', 'mended:note']])
  assert.equal(read(dir, `${T}/nested.md`), task('tags: [task]\nmeta:\n  note: "a: b"\nstatus: open'))
  const r = spawnSync('python3', [SCRIPT, '--vault', dir, 'mend', 'loop'], { encoding: 'utf8', timeout: 20000 })
  assert.deepEqual([r.status, r.stderr, r.stdout], [0, '', 'mend\tloop\tmended:next_action\n'])
  assert.equal(read(dir, `${T}/loop.md`), task('tags: [task]\nloop: &x [*x]\nnext_action: "a: b"'))
  const before = read(dir, `${T}/qkey.md`)
  assert.deepEqual(ok(dir, ['mend', 'qkey']), [['mend', 'qkey', 'unmendable:mending would change other frontmatter']])
  assert.equal(read(dir, `${T}/qkey.md`), before)
})

test('mend reports a note that parses, or has no frontmatter, and writes nothing', () => {
  const dir = vault({
    [`${T}/fine.md`]: task('tags: [task]\nstatus: open\nnext_action: Ring the council'),
    [`${T}/plain.md`]: '# Plain\n',
    [`${T}/empty.md`]: '',
  })
  const before = snapshot(dir)
  assert.deepEqual(ok(dir, ['mend', 'fine']), [['mend', 'fine', 'parses']])
  assert.deepEqual(ok(dir, ['mend', 'plain']), [['mend', 'plain', 'parses']])
  assert.deepEqual(ok(dir, ['mend', 'empty']), [['mend', 'empty', 'parses']])
  assert.deepEqual(snapshot(dir), before)
  assert.equal(fs.statSync(path.join(dir, T, 'empty.md')).size, 0, 'the empty note stays 0 bytes')
})

test('mend refuses anything quoting cannot mend, and leaves its bytes alone', () => {
  const cases = {
    // A flow list that never closes: quoting `[task` would change what tags holds.
    flow: [task('tags: [task\nstatus: open'), /^unmendable:frontmatter does not parse \(line 2, tags\)$/],
    // A value that scans but will not construct (step 4): quoting would change a date into text.
    date: [task('tags: [task]\nstatus: open\ndue: 2026-02-30'), /^unmendable:frontmatter does not parse \(line 4, due\)$/],
    // A ConstructorError: its value starts with `!`, which quoting never touches (step 5, NOT_PLAIN).
    tag: [task('tags: [task]\nstatus: open\nx: !foo bar'), /^unmendable:frontmatter does not parse \(line 4, x\)$/],
    // A lone CR is a YAML line break a "\n" split does not see (the cell escapes the why's backslash).
    cr: [task('tags: [task]\nstatus: open\nnext_action: a: b\rc: d'), /^unmendable:frontmatter has line breaks other than \\\\n$/],
    // A run-on value is never quoted: its continuation would be lost.
    runon: [task('tags: [task]\nstatus: open\nnext_action: Build A2 from\n  the board: the name first'),
      /^unmendable:frontmatter does not parse \(line 5, next_action\)$/],
    // The first quote mends next_action; a constructor error is left behind it, so nothing is saved.
    after: [task('tags: [task]\nstatus: open\nnext_action: a: b\ndue: 2026-02-30'),
      /^unmendable:frontmatter does not parse \(line 5, due\)$/],
    unclosed: ['---\ntags: [task]\nstatus: open\n', /^unmendable:no closed frontmatter$/],
    list: [task('- task\n- open'), /^unmendable:frontmatter is not a mapping$/],
  }
  const dir = vault(Object.fromEntries(Object.entries(cases).map(([k, [text]]) => [`${T}/${k}.md`, text])))
  const before = snapshot(dir)
  for (const [k, [, want]] of Object.entries(cases)) {
    const rows = ok(dir, ['mend', k])
    assert.equal(rows.length, 1, k)
    assert.deepEqual(rows[0].slice(0, 2), ['mend', k], k)
    assert.match(rows[0][2], want, k)
  }
  assert.deepEqual(snapshot(dir), before, 'an unmendable note is never written')
})

test('mend keeps CRLF endings, and finds only a task directly under Work/Tasks', () => {
  const crlf = task('tags: [task]\nstatus: open\nnext_action: Ring: the council').replace(/\n/g, '\r\n')
  const dir = vault({
    [`${T}/crlf.md`]: crlf,
    [`${T}/Archive/old.md`]: task('tags: [task]\nstatus: open\nnext_action: a: b'),
    ['Notes/loose.md']: task('tags: [task]\nstatus: open\nnext_action: a: b'),
  })
  assert.deepEqual(ok(dir, ['mend', 'crlf']), [['mend', 'crlf', 'mended:next_action']])
  assert.equal(read(dir, `${T}/crlf.md`), crlf.replace('next_action: Ring: the council', 'next_action: "Ring: the council"'))
  refused(dir, ['mend', 'old'], /no task note 'old' directly under Work\/Tasks/)
  refused(dir, ['mend', `${T}/Archive/old.md`], /is not directly under Work\/Tasks/)
  refused(dir, ['mend', 'Notes/loose.md'], /is not directly under Work\/Tasks/)
})

test('mend takes the task column of a read slot row as it is, a path-form link included (orient § 4)', () => {
  const dir = vault({
    [`${T}/foo.md`]: task('tags: [task]\nstatus: open\nnext_action: Ring the council: the clerk first'),
    [`${P}/Alpha.md`]: task('tags: [project]\nnext_task: "[[Work/Tasks/foo|Foo]]"'),
    [`${T}/Archive/old.md`]: task('tags: [task]\nstatus: open\nnext_action: a: b'),
  })
  const [slot] = ok(dir, ['read', 'Alpha'])
  assert.deepEqual(slot, ['slot', 'Alpha', 'unparseable:frontmatter does not parse (line 4, next_action)',
    `${T}/foo`, `${T}/foo`])
  assert.deepEqual(ok(dir, ['mend', slot[3]]), [['mend', 'foo', 'mended:next_action']])
  assert.deepEqual(ok(dir, ['read', 'Alpha']), [['slot', 'Alpha', 'live', `${T}/foo`, 'Ring the council: the clerk first']])
  // Any case, as Obsidian resolves a link; a path that names no note, or names one with `.md` that is not there, is
  // still refused, and one outside Work/Tasks is held to the directly-under check after it resolves.
  assert.deepEqual(ok(dir, ['mend', 'work/tasks/FOO']), [['mend', 'foo', 'parses']])
  refused(dir, ['mend', `${T}/nothing`], /no note at Work\/Tasks\/nothing\n$/)
  refused(dir, ['mend', `${T}/nothing.md`], /no note at Work\/Tasks\/nothing\.md\n$/)
  refused(dir, ['mend', `${T}/Archive/old`], /Work\/Tasks\/Archive\/old\.md is not directly under Work\/Tasks/)
})

test('mend names a key quoted on two lines once, in line order', () => {
  const dir = vault({ [`${T}/dup.md`]: task('tags: [task]\nnext_action: a: b\nstatus: open\nnext_action: c: d\ntitle: e: f') })
  assert.deepEqual(ok(dir, ['mend', 'dup']), [['mend', 'dup', 'mended:next_action,title']])
  assert.equal(read(dir, `${T}/dup.md`),
    task('tags: [task]\nnext_action: "a: b"\nstatus: open\nnext_action: "c: d"\ntitle: "e: f"'))
})

test('captures: open, thread-tagged tasks in either tag form, with their slug and thread-file matches', () => {
  const dir = vault({
    [`${T}/inline.md`]: task('tags: [task, thread]\nstatus: open'),
    [`${T}/block.md`]: task('tags:\n  - task\n  - thread\nstatus: in_progress'),
    [`${T}/rollout.md`]: task('tags: [task]\nstatus: in_progress', '\nThread: /Users/x/Projects/A/THREAD.md\n'),
    [`${T}/named.md`]: task('tags: [task]\nstatus: open'),
    [`${T}/mine.md`]: task('tags: [task, thread]\nstatus: open', '\n**Thread:** /Users/x/Projects/A/THREAD.md\n'),
    [`${T}/closed.md`]: task('tags: [task, thread]\nstatus: done'),
    [`${T}/shelved.md`]: task('tags: [task, thread, archived]\nstatus: open'),
    [`${T}/Archive/old.md`]: task('tags: [task, thread]\nstatus: open'),
    [`${T}/unrelated.md`]: task('tags: [task]\nstatus: open'),
  })
  const args = ['captures', '--slug', 'inline', '--thread-file', '/Users/x/Projects/A/THREAD.md']
  // A follow-up or rollout task that merely names the thread (no `thread` tag) is never a capture.
  assert.deepEqual(ok(dir, args), [
    ['capture', 'block', 'in_progress', 'thread-tag'],
    ['capture', 'inline', 'open', 'thread-tag,slug'],
    ['capture', 'mine', 'open', 'thread-tag,thread-file'],
  ])
  // --for-close: close's concrete match needs the slug or the thread file as well as the tag.
  assert.deepEqual(ok(dir, [...args, '--for-close']), [
    ['capture', 'inline', 'open', 'thread-tag,slug'],
    ['capture', 'mine', 'open', 'thread-tag,thread-file'],
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

// ---- Round-2 review regressions (fresh-review 9c5f0eb/42e222) ---------------------------------------

test('links resolve as Obsidian resolves them: path-qualified, .md, other case — and an exact case wins', () => {
  const dir = vault({
    [`${T}/live.md`]: task('tags: [task]\nstatus: open\nnext_action: Go'),
    [`${T}/rec.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Work/Projects/Pathy]]", "[[CASED]]", "[[Suffix.md]]"]'),
    [`${P}/Pathy.md`]: task('tags: [project]\nnext_task: "[[Work/Tasks/live]]"'),
    [`${P}/Cased.md`]: task('tags: [project]\nnext_task: "[[LIVE]]"'),
    [`${P}/Suffix.md`]: task('tags: [project]\nnext_task: "[[live.md]]"'),
  })
  assert.deepEqual(ok(dir, ['read', 'Pathy', 'Cased', 'Suffix']).map((r) => r[2]), ['live', 'live', 'live'])
  // fill keeps all three: none of them is blank or dead.
  assert.deepEqual(ok(dir, ['fill', 'rec']).slice(1).map((r) => [r[0], r[3]]), [['project', 'kept'], ['project', 'kept'], ['project', 'kept']])
})

test('mixed line endings: each line keeps its own, and no key is ever duplicated', () => {
  const dir = vault({
    [`${T}/cap.md`]: '---\ntags: [task]\r\nstatus: open\nnext_action: Old\nprojects: ["[[Alpha]]"]\n---\nBody\r\n',
    [`${P}/Alpha.md`]: '---\r\ntags: [project]\nnext_task: "[[x]]"\r\n---\n',
  })
  ok(dir, ['set-down', 'cap', '--action', 'New'])
  assert.equal(read(dir, `${T}/cap.md`), '---\ntags: [task]\r\nstatus: open\nnext_action: "New"\nprojects: ["[[Alpha]]"]\n---\nBody\r\n')
  assert.equal(read(dir, `${P}/Alpha.md`), '---\r\ntags: [project]\nnext_task: "[[cap]]"\r\n---\n')
})

test('a task is found in the vault, never in the working directory, and never outside the vault', () => {
  const dir = estate()
  const decoy = fs.mkdtempSync(path.join(scratch, 'cwd-'))
  fs.writeFileSync(path.join(decoy, 'cap.md'), task('tags: [task]\nstatus: open'))
  ok(dir, ['set-down', 'cap.md', '--action', 'Draft'], { cwd: decoy })
  assert.equal(read(decoy, 'cap.md'), task('tags: [task]\nstatus: open'), 'the decoy in the cwd is untouched')
  assert.match(read(dir, `${T}/cap.md`), /^next_action: "Draft"$/m)
  refused(dir, ['set-down', path.join(decoy, 'cap.md'), '--action', 'Go'], /outside the vault/)
  refused(dir, ['set-down', '../outside.md', '--action', 'Go'], /outside the vault/)
})

test('--action - reads the line from stdin, apostrophes and all', () => {
  const dir = estate()
  ok(dir, ['set-down', 'cap', '--action', '-'], { input: "Find the council's phone number\n" })
  assert.match(read(dir, `${T}/cap.md`), /^next_action: "Find the council's phone number"$/m)
  refused(dir, ['set-down', 'cap', '--action', '-'], /one line/, { input: 'one\ntwo\n' })
  refused(dir, ['set-down', 'cap', '--action', '-'], /blank/, { input: '' })
})

test('a write is in place: the file keeps its inode', () => {
  const dir = estate()
  const before = fs.statSync(path.join(dir, `${P}/A/Alpha.md`)).ino
  ok(dir, ['set-down', 'cap', '--action', 'Go'])
  assert.equal(fs.statSync(path.join(dir, `${P}/A/Alpha.md`)).ino, before)
})

test('frontmatter is read by YAML: null and plain text are blank, block scalars read whole', () => {
  const dir = vault({
    [`${T}/folded.md`]: task('tags: [task]\nstatus: open\nnext_action: >-\n  Ring the\n  council'),
    [`${P}/Null.md`]: task('tags: [project]\nnext_task: null'),
    [`${P}/Plain.md`]: task('tags: [project]\nnext_task: folded'),
    [`${P}/Folded.md`]: task('tags: [project]\nnext_task: "[[folded]]"  # set by stash'),
  })
  assert.deepEqual(ok(dir, ['read', 'Null', 'Plain', 'Folded']).map((r) => [r[2], r[4] ?? '']), [
    ['blank', ''], ['blank', ''], ['live', 'Ring the council'],
  ])
})

test('captures accepts both spellings of in-progress', () => {
  const dir = vault({
    [`${T}/hyphen.md`]: task('tags: [task, thread]\nstatus: in-progress'),
    [`${T}/under.md`]: task('tags: [task, thread]\nstatus: in_progress'),
  })
  assert.deepEqual(ok(dir, ['captures', '--slug', 'hyphen', '--for-close']), [['capture', 'hyphen', 'in_progress', 'thread-tag,slug']])
  assert.deepEqual(ok(dir, ['captures', '--slug', 'under', '--for-close']), [['capture', 'under', 'in_progress', 'thread-tag,slug']])
})

test('read takes a vault-relative path, whatever the working directory', () => {
  const dir = vault({
    [`${T}/t.md`]: task('tags: [task]\nstatus: open'),
    [`${P}/A/Same.md`]: task('tags: [project]\nnext_task: "[[t]]"'),
    [`${P}/B/Same.md`]: task('tags: [project]'),
  })
  const rows = ok(dir, ['read', `${P}/A/Same.md`, `${P}/B/Same.md`, 'Same'], { cwd: scratch })
  assert.deepEqual(rows.map((r) => [r[0], r[2]]), [['slot', 'live'], ['slot', 'blank'], ['skip', `ambiguous (${P}/A/Same.md, ${P}/B/Same.md)`]])
})

test("a name's notes list in one order, whatever order the file system walks them", () => {
  const dir = vault({
    [`${P}/Same.md`]: task('tags: [project]'),
    [`${P}/A/Same.md`]: task('tags: [project]'),
    [`${P}/B/Same.md`]: task('tags: [project]'),
  })
  const want = [['skip', 'Same', `ambiguous (${P}/Same.md, ${P}/A/Same.md, ${P}/B/Same.md)`]]
  assert.deepEqual(ok(dir, ['read', 'Same']), want)
  assert.deepEqual(ok(dir, ['read', 'Same'], { pyFlags: REVERSED_WALK }), want, 'a reversed walk lists them the same')
})

test('a block list after a blank line is replaced whole', () => {
  const dir = vault({
    [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Alpha]]"]'),
    [`${P}/Alpha.md`]: task('tags: [project]\nnext_task:\n\n  - "[[gone]]"\n\nstatus: queued'),
  })
  ok(dir, ['set-down', 'cap', '--action', 'Go'])
  assert.equal(read(dir, `${P}/Alpha.md`), task('tags: [project]\nnext_task: "[[cap]]"\n\nstatus: queued'))
})

test('an edit that would change any other key is refused: the note is skipped, untouched', () => {
  const alias = task('tags: [project]\nnext_task: &p "[[old]]"\nmirror: *p')
  const dir = vault({
    [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Alias]]"]'),
    [`${P}/Alias.md`]: alias,
  })
  const rows = ok(dir, ['set-down', 'cap', '--action', 'Go'])
  assert.equal(rows[1][0], 'skip')
  assert.match(rows[1][2], /frontmatter not editable/)
  assert.equal(read(dir, `${P}/Alias.md`), alias)
})

test('output cells escape tab, newline and backslash', () => {
  const dir = vault({
    [`${T}/t.md`]: task('tags: [task]\nstatus: open\nnext_action: "a\\tb\\\\c"'),
    [`${P}/X.md`]: task('tags: [project]\nnext_task: "[[t]]"'),
  })
  const r = run(dir, ['read', 'X'])
  assert.equal(r.stdout, 'slot\tX\tlive\tt\ta\\tb\\\\c\n')
})

test('exit 3 when PyYAML is missing — the set-down reports it, never falls back to a hand parser', () => {
  const dir = estate()
  const before = snapshot(dir)
  // -S drops site-packages (system and user), leaving only the standard library.
  const r = run(dir, ['set-down', 'cap', '--action', 'Go'], { pyFlags: ['-S'] })
  assert.equal(r.status, 3, r.stderr)
  assert.match(r.stderr, /^next-action: PyYAML is required: python3 -m pip install pyyaml\n$/)
  assert.deepEqual(snapshot(dir), before)
})

// ---- Simplify-round regressions (fresh-review a7c7447/1ca644) ---------------------------------------

test('the key is found by the YAML parser: quoted keys, comments and block scalars are replaced whole', () => {
  const cases = [
    ['a double-quoted key', '"next_task": "[[old]]"', 'next_task: "[[cap]]"'],
    ['a single-quoted key', "'next_task': \"[[old]]\"", 'next_task: "[[cap]]"'],
    ['a trailing comment', 'next_task: "[[old]]"  # set by stash', 'next_task: "[[cap]]"'],
    ['a folded block scalar', 'next_task: >-\n  [[old]]', 'next_task: "[[cap]]"'],
    ['an empty value', 'next_task:', 'next_task: "[[cap]]"'],
  ]
  for (const [name, before, after] of cases) {
    const dir = vault({
      [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[P]]"]'),
      [`${P}/P.md`]: task(`tags: [project]\n${before}\nstatus: queued`),
    })
    ok(dir, ['set-down', 'cap', '--action', 'Go'])
    assert.equal(read(dir, `${P}/P.md`), task(`tags: [project]\n${after}\nstatus: queued`), name)
  }
})

test('a frontmatter line break YAML counts but "\\n" splitting would not is refused, never mis-edited', () => {
  const odd = task('tags: [project]\nnote: "a\u2028b"\nnext_task: "[[old]]"')
  const dir = vault({ [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[P]]"]'), [`${P}/P.md`]: odd })
  const rows = ok(dir, ['set-down', 'cap', '--action', 'Go'])
  assert.equal(rows[1][0], 'skip')
  assert.match(rows[1][2], /line breaks other than/)
  assert.equal(read(dir, `${P}/P.md`), odd)
})

test('read shows the live copy when a link names a done copy and a live one', () => {
  const dir = vault({
    [`${T}/dup.md`]: task('tags: [task]\nstatus: open\nnext_action: The live one'),
    ['Notes/A/dup.md']: task('tags: [task]\nstatus: done\nnext_action: The done one'),
    [`${P}/P.md`]: task('tags: [project]\nnext_task: "[[dup]]"'),
  })
  assert.deepEqual(ok(dir, ['read', 'P']), [['slot', 'P', 'live', 'dup', 'The live one']])
})

test('read by path applies the same project checks as read by name', () => {
  const dir = vault({
    [`${P}/Area.md`]: task('tags: [area]'),
    [`${P}/Archive/Old.md`]: task('tags: [project]'),
    ['Notes/Loose.md']: task('tags: [note]'),
  })
  assert.deepEqual(ok(dir, ['read', `${P}/Area.md`, `${P}/Archive/Old.md`, 'Notes/Loose.md']).map((r) => [r[0], r[2]]), [
    ['skip', `area note (${P}/Area.md)`], ['skip', 'archived'], ['skip', 'not a project note (Notes/Loose.md)'],
  ])
})

// p19-8: stash and defer stamp `capture: continuation` (task-writer § 4); the query reports it as `marked`, and
// handoff's Open captures supersedes only a marked capture. The 2026-09-25 Chorus case: a backlog task carrying
// the `thread` tag and the thread's `**Thread:**` link (chorus-misstep-walk-and-knob) matched deterministically.
test('captures marks a capture its writer stamped `capture: continuation`; an unmarked one that links the thread is not', () => {
  const THREAD = '/Users/x/repos/tools/chorus/THREAD.md'
  const dir = vault({
    [`${T}/chorus-next.md`]: task('tags: [task, ai, thread]\nstatus: open\ncapture: continuation',
      `\n## Notes\n\n**Thread:** [THREAD.md](${THREAD}) · state: parked\n`),
    [`${T}/chorus-misstep-walk-and-knob.md`]: task('tags: [task, ai, thread]\nstatus: open',
      `\n## Notes\n\n**Thread:** [THREAD.md](${THREAD}) · state: active\n`),
    [`${T}/chorus.md`]: task('tags: [task, thread]\nstatus: open\ncapture: "continuation"'),
    [`${T}/other-marker.md`]: task('tags: [task, thread]\nstatus: open\ncapture: backlog',
      `\n**Thread:** [THREAD.md](${THREAD})\n`),
    [`${T}/untagged.md`]: task('tags: [task]\nstatus: open\ncapture: continuation', `\n**Thread:** [THREAD.md](${THREAD})\n`),
  })
  const args = ['captures', '--slug', 'chorus', '--thread-file', THREAD]
  assert.deepEqual(ok(dir, args), [
    ['capture', 'chorus-misstep-walk-and-knob', 'open', 'thread-tag,thread-file'],
    ['capture', 'chorus-next', 'open', 'thread-tag,marked,thread-file'],
    ['capture', 'chorus', 'open', 'thread-tag,marked,slug'],
    ['capture', 'other-marker', 'open', 'thread-tag,thread-file'],
  ])
  // The marker alone is no concrete match for close: --for-close still needs the slug or the thread file.
  assert.deepEqual(ok(dir, ['captures', '--for-close']), [])
  assert.deepEqual(ok(dir, ['captures', '--thread-file', THREAD, '--for-close']).map((r) => r[1]),
    ['chorus-misstep-walk-and-knob', 'chorus-next', 'other-marker'])
})

// ---- now: close's Now refresh (task-writer § 4b, Close's Now) --------------------------------------------------
// The close agent writes the block; the script places it in the `## Now` of each project note the task links, and
// only where that section names the closing thread's file. The thread files are real files outside the vault.
function threadFile(rel) {
  const p = path.join(scratch, 'threads', rel, 'THREAD.md')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, '# A thread\n')
  return p
}
const OPT = threadFile('opt')
const SEO = threadFile('seo')

const BLOCK = 'As of 2026-11-05, from the thread:\n- **Large-file routes are decided.** Keep the premium engine.\n' +
  '- **Paid tier:** pricing is on hold; the grill is next.'
const RUN = 'As of 2026-11-01, from the thread:\n- **Old bullet one.**\n- **Old bullet two.**'
// A decoy `## Now` inside a ```base fence, as the live project notes carry one above their sections.
const BASE = '```base\nfilters:\n  and:\n    - file.hasTag("task")\n## Now\n```\n'
const closingLine = (thread) => '**Next task:** the `next_task` property at the top (thread closes keep it current). ' +
  `**Thread:** [opt THREAD.md](vscode://file${thread}) (the running record). **History:** [[Alpha log]].`
// The Animately App shape: frontmatter, a base fence, a goal, the Now (an As-of run and its closing line), notes.
const dash = (now, notes = 'Keep me.') => '---\ntags:\n  - project\nstatus: active\nnext_task: "[[old]]"\n---\n\n' +
  `${BASE}\n## Goal\n\nShip the thing.\n\n## Now\n\n${now}\n\n## Notes\n\n${notes}\n`
const nowOf = (thread, run = RUN) => `${run}\n\n${closingLine(thread)}`
// The GifLab shape: a standing preamble, the As-of run, and a closing line with a `**Reference:**` mid-line.
const gifNow = (ref, run = RUN) => `GifLab sits outside the Backlog: it runs on its own phases.\n\n${run}\n\n` +
  `**Next task:** the \`next_task\` property. **Thread:** ${ref}. **Reference:** [[GifLab reference]] (programme map). ` +
  '**History:** [[GifLab log]].'
const nowArgs = (thread, taskName = 'cap') => ['now', taskName, '--thread-file', thread, '--text', '-']

// One task linking one project note `Pr` holding `note`; the refresh run once.
function oneNow(note, { thread = OPT, block = BLOCK } = {}) {
  const dir = vault({
    [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Pr]]"]'),
    [`${P}/Pr.md`]: note,
  })
  const before = snapshot(dir)
  const rows = ok(dir, nowArgs(thread), { input: `${block}\n` })
  return { dir, rows, before, text: read(dir, `${P}/Pr.md`) }
}

test("now rewrites only the Now body of each linked project note whose Now names the thread file; another thread's Now and a note without ## Now are byte-identical", () => {
  const files = {
    [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Area]]", "[[Alpha]]", "[[Seo]]", "[[Beta]]", "[[Old]]", "[[Alpha]]"]'),
    [`${P}/A/Alpha.md`]: dash(nowOf(OPT)),
    // SEO's own thread in its Now; the closing thread named only in its Notes, which the guard never reads.
    [`${P}/S/Seo.md`]: dash(nowOf(SEO), `See also [the optimizer thread](vscode://file${OPT}).`),
    [`${P}/B/Beta.md`]: `---\ntags: [project]\n---\n\n## Now / Next (2026-08-28)\n\nStale lines; the thread is ${OPT}.\n`,
    [`${P}/Area/Area.md`]: task('tags: [area]', `\n## Now\n\n${nowOf(OPT)}\n`),
    [`${P}/Archive/Old.md`]: task('tags: [project]', `\n## Now\n\n${nowOf(OPT)}\n`),
  }
  const dir = vault(files)
  const rows = ok(dir, nowArgs(OPT), { input: `${BLOCK}\n` })
  assert.deepEqual(rows, [
    ['skip', 'Area', `area note (${P}/Area/Area.md)`],
    ['project', 'Alpha', 'now', 'written', `${P}/A/Alpha.md`],
    ['skip', 'Seo', "not this thread's Now"],
    ['project', 'Beta', 'now', 'absent', `${P}/B/Beta.md`],
    ['skip', 'Old', 'archived'],
  ])
  // Only the As-of run changes: the frontmatter, the fence's decoy, the closing line and every other section stay.
  assert.equal(read(dir, `${P}/A/Alpha.md`), dash(nowOf(OPT, BLOCK)))
  for (const rel of [`${T}/cap.md`, `${P}/S/Seo.md`, `${P}/B/Beta.md`, `${P}/Area/Area.md`, `${P}/Archive/Old.md`]) {
    assert.equal(read(dir, rel), files[rel], `${rel} is byte-identical`)
  }
  // A second identical run reports unchanged and rewrites nothing.
  const before = snapshot(dir)
  assert.deepEqual(ok(dir, nowArgs(OPT), { input: `${BLOCK}\n` })[1], ['project', 'Alpha', 'now', 'unchanged', `${P}/A/Alpha.md`])
  assert.deepEqual(snapshot(dir), before)
})

test('now keeps a standing preamble and a closing line with other links, and replaces only the As-of run', () => {
  const ref = `[giflab THREAD.md](vscode://file${OPT})`
  const { rows, text } = oneNow(dash(gifNow(ref)))
  assert.deepEqual(rows, [['project', 'Pr', 'now', 'written', `${P}/Pr.md`]])
  assert.equal(text, dash(gifNow(ref, BLOCK)))
})

test('now leaves a Now it cannot place byte-identical: no thread named, no As-of line, a preamble with no run', () => {
  const website = (thread) => "Last moved on 2026-08-25. From the log's latest lines:\n" +
    '- **The focus item is the `/api` pilot cycle.**\n- **Waiting on your call.**\n\n' +
    (thread ? `**Thread:** [THREAD.md](vscode://file${thread}). ` :
      '**Thread:** none yet; the next session that works here opens one (`/thread:open`), and history goes there. ') +
    '**History:** [[Website log]].'
  const preAsOf = 'GifLab sits outside the Backlog: it runs on its own phases.\n\n' +
    'CI is back and the rollout merged four of four.\n\n' + `**Thread:** [giflab THREAD.md](vscode://file${OPT}).`
  for (const [name, now, why] of [
    ['a Now naming no thread file', website(null), "not this thread's Now"],
    ['a Now with hand text and no As-of line', website(OPT), 'Now has no "As of" line'],
    ['a preamble and a status paragraph, no As-of line', preAsOf, 'Now has no "As of" line'],
  ]) {
    const { rows, before, dir } = oneNow(dash(now))
    assert.deepEqual(rows, [['skip', 'Pr', why]], name)
    assert.deepEqual(snapshot(dir), before, `${name} is byte-identical`)
  }
})

test('now puts the block above a Now that holds only its closing line', () => {
  const line = closingLine(OPT)
  assert.equal(oneNow(dash(line)).text, dash(nowOf(OPT, BLOCK)), 'heading, blank, closing line')
  const tight = `---\ntags: [project]\n---\n\n## Now\n${line}\n\n## Notes\n\nKeep me.\n`
  const { rows, text } = oneNow(tight)
  assert.deepEqual(rows, [['project', 'Pr', 'now', 'written', `${P}/Pr.md`]])
  assert.equal(text, `---\ntags: [project]\n---\n\n## Now\n\n${BLOCK}\n\n${line}\n\n## Notes\n\nKeep me.\n`, 'heading, closing line')
})

test('now stops the run at a closing line or a blank line: what follows it is kept', () => {
  const line = closingLine(OPT)
  // A closing line straight after the bullets, no blank between.
  assert.equal(oneNow(dash(`${RUN}\n${line}`)).text, dash(`${BLOCK}\n${line}`))
  // A hand paragraph after a blank line survives untouched.
  const hand = 'A paragraph Lachy wrote by hand.'
  assert.equal(oneNow(dash(`${RUN}\n\n${hand}\n\n${line}`)).text, dash(`${BLOCK}\n\n${hand}\n\n${line}`))
})

test('now replaces a run at the end of the file and keeps the missing final newline', () => {
  // The thread is named above the run, in a line the write keeps: the run itself names nothing.
  const head = `---\ntags: [project]\n---\n\n## Now\n\nRuns on its own phases; see [THREAD.md](vscode://file${OPT}).\n\n`
  const { rows, text } = oneNow(`${head}As of 2026-11-01, from the thread:\n- **Old bullet**, the last line`)
  assert.deepEqual(rows, [['project', 'Pr', 'now', 'written', `${P}/Pr.md`]])
  assert.equal(text, `${head}${BLOCK}`)
})

test("now's thread guard reads only the lines it keeps: a path in the run it replaces never passes it", () => {
  // X's closing line names OPT; its As-of run names SEO's path. The run is what the write replaces, so it never counts.
  const run = `As of 2026-11-01, from the thread:\n- **Old bullet.** See [seo THREAD.md](vscode://file${SEO}) for it.`
  const note = dash(nowOf(OPT, run))
  const seo = oneNow(note, { thread: SEO })
  assert.deepEqual(seo.rows, [['skip', 'Pr', "not this thread's Now"]])
  assert.deepEqual(snapshot(seo.dir), seo.before, 'the note is byte-identical')
  const opt = oneNow(note, { thread: OPT })
  assert.deepEqual(opt.rows, [['project', 'Pr', 'now', 'written', `${P}/Pr.md`]])
  assert.equal(opt.text, dash(nowOf(OPT, BLOCK)))
  // A run that runs to the section's end, naming the thread only inside itself, is no Now of this thread either.
  const only = oneNow(dash(`As of 2026-11-01, from the thread:\n- See [THREAD.md](vscode://file${OPT}) for more`))
  assert.deepEqual(only.rows, [['skip', 'Pr', "not this thread's Now"]])
  assert.deepEqual(snapshot(only.dir), only.before, 'the run-only Now is byte-identical')
})

test('now anchors only on the dated opener: a hand paragraph opening `As of ` is no run, and never a second one', () => {
  const line = closingLine(OPT)
  const lastWeek = 'As of last week, Lachy wrote this by hand.\nIt is still true.'
  for (const [name, now] of [
    ['a hand `As of last week` paragraph', `${lastWeek}\n\n${line}`],
    ['an `As of the August cut` paragraph', `As of the August cut, Lachy wrote this by hand.\n- One.\n\n${line}`],
    ['a dated hand line that is not the opener', `As of 2026-08-01 Lachy wrote this by hand.\n\n${line}`],
  ]) {
    const { rows, before, dir } = oneNow(dash(now))
    assert.deepEqual(rows, [['skip', 'Pr', 'Now has no "As of" line']], name)
    assert.deepEqual(snapshot(dir), before, `${name} is byte-identical`)
  }
  // Beside a dated run, the hand paragraph is no second anchor: the run alone is replaced, before or after it.
  for (const [name, now, want] of [
    ['hand paragraph first', `${lastWeek}\n\n${RUN}\n\n${line}`, `${lastWeek}\n\n${BLOCK}\n\n${line}`],
    ['hand paragraph after', `${RUN}\n\n${lastWeek}\n\n${line}`, `${BLOCK}\n\n${lastWeek}\n\n${line}`],
  ]) {
    const { rows, text } = oneNow(dash(now))
    assert.deepEqual(rows, [['project', 'Pr', 'now', 'written', `${P}/Pr.md`]], name)
    assert.equal(text, dash(want), name)
  }
  // The block's own rule is the same: a later `As of last week` line is plain text, and the next run finds it again.
  const block = `${BLOCK}\nAs of last week, the CI was red.`
  const first = oneNow(dash(nowOf(OPT)), { block })
  assert.equal(first.text, dash(nowOf(OPT, block)))
  assert.equal(oneNow(first.text).text, dash(nowOf(OPT, BLOCK)), 'a later run replaces the whole block')
})

test('now ignores a ## Now inside a fence: absent', () => {
  const note = `---\ntags: [project]\n---\n\n~~~\n\`\`\`\n## Now\n\n${nowOf(OPT)}\n~~~\n\n## Notes\n`
  const { rows, before, dir } = oneNow(note)
  assert.deepEqual(rows, [['project', 'Pr', 'now', 'absent', `${P}/Pr.md`]])
  assert.deepEqual(snapshot(dir), before)
})

test('now skips a Now it cannot edit safely, and leaves it byte-identical', () => {
  const line = closingLine(OPT)
  for (const [name, note, why] of [
    ['two ## Now sections', `${dash(nowOf(OPT))}\n## Now\n\nAgain.\n`, 'Now not editable (two ## Now sections)'],
    ['two As-of lines', dash(`${RUN}\n\nAs of 2026-10-01, from the thread:\n- Older.\n\n${line}`), 'Now not editable (two As of lines)'],
    ['a ### heading in the run', dash(`As of 2026-11-01, from the thread:\n### Sub\n- a\n\n${line}`),
      'Now not editable (heading or fence in its As of run)'],
    ['a fence in the run', dash(`As of 2026-11-01, from the thread:\n\`\`\`\ncode\n\`\`\`\n\n${line}`),
      'Now not editable (heading or fence in its As of run)'],
    ['a lone CR in the section', dash(`${RUN}\rx\n\n${line}`), 'Now not editable (line breaks other than \\\\n)'],
  ]) {
    const { rows, before, dir } = oneNow(note)
    assert.deepEqual(rows, [['skip', 'Pr', why]], name)
    assert.deepEqual(snapshot(dir), before, `${name} is byte-identical`)
  }
})

test('now keeps CRLF on the lines it writes, and writes in place (the inode kept)', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n')
  const dir = vault({
    [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Pr]]"]'),
    [`${P}/Pr.md`]: crlf(dash(nowOf(OPT))),
  })
  const ino = fs.statSync(path.join(dir, P, 'Pr.md')).ino
  ok(dir, nowArgs(OPT), { input: `${BLOCK}\n` })
  assert.equal(read(dir, `${P}/Pr.md`), crlf(dash(nowOf(OPT, BLOCK))))
  assert.equal(fs.statSync(path.join(dir, P, 'Pr.md')).ino, ino)
})

// One task linking a project note per `refs` entry, each with the GifLab-shaped Now naming its own ref; one run.
function forms(threadArg, refs, opts) {
  const names = Object.keys(refs)
  const files = { [`${T}/cap.md`]: task(`tags: [task]\nstatus: open\nprojects: [${names.map((n) => `"[[${n}]]"`).join(', ')}]`) }
  for (const [n, ref] of Object.entries(refs)) files[`${P}/${n}.md`] = dash(gifNow(ref))
  const dir = vault(files)
  const rows = ok(dir, nowArgs(threadArg), { input: `${BLOCK}\n`, ...opts })
  for (const [n, ref] of Object.entries(refs)) {
    const row = rows.find((r) => r[1] === n)
    assert.equal(read(dir, `${P}/${n}.md`), row[0] === 'project' ? dash(gifNow(ref, BLOCK)) : files[`${P}/${n}.md`], n)
  }
  return Object.fromEntries(rows.map((r) => [r[1], r[0] === 'skip' ? r[2] : r[3]]))
}

test('now matches the thread file raw, ~-expanded, percent-encoded or spaces-only, never as a longer path', () => {
  // `~` forms: HOME moved for the run, its user site pinned so PyYAML still loads (tests/run.sh does the same).
  const home = path.join(scratch, 'home')
  const tilde = path.join(home, 'threads', 'opt', 'THREAD.md')
  fs.mkdirSync(path.dirname(tilde), { recursive: true })
  fs.writeFileSync(tilde, '# A thread\n')
  const userBase = process.env.PYTHONUSERBASE ??
    spawnSync('python3', ['-c', 'import site; print(site.getuserbase())'], { encoding: 'utf8' }).stdout.trim()
  assert.deepEqual(forms('~/threads/opt/THREAD.md', {
    Expanded: `[THREAD.md](vscode://file${tilde})`,
    Raw: '[THREAD.md](~/threads/opt/THREAD.md)',
  }, { env: { HOME: home, PYTHONUSERBASE: userBase } }), { Expanded: 'written', Raw: 'written' })

  // Spaces: the house link rule writes %20; an angle-bracket link keeps the raw space.
  const ur = threadFile('user research')
  assert.deepEqual(forms(ur, {
    Encoded: `[THREAD.md](vscode://file${ur.replace(/ /g, '%20')})`,
    Angle: `[x](<vscode://file${ur}>)`,
    Other: `[THREAD.md](vscode://file${path.join(scratch, 'threads')}/other%20research/THREAD.md)`,
  }), { Encoded: 'written', Angle: 'written', Other: "not this thread's Now" })

  // Both encodings: a full quote encodes the parentheses too; a spaces-only link leaves them raw.
  const paren = threadFile('user research (2026)')
  assert.deepEqual(forms(paren, {
    Full: `[THREAD.md](vscode://file${paren.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29')})`,
    Spaces: `[THREAD.md](vscode://file${paren.replace(/ /g, '%20')})`,
  }), { Full: 'written', Spaces: 'written' })

  // The trailing guard: no further path character after the needle; a sentence-ending `.` is fine, and a false
  // occurrence never hides a true one later in the section.
  assert.deepEqual(forms(OPT, {
    Bak: `[backup](vscode://file${OPT}.bak)`,
    Longer: `[x](vscode://file${OPT}x)`,
    BakThenTrue: `[backup](vscode://file${OPT}.bak), then [THREAD.md](vscode://file${OPT})`,
    Sentence: `see ${OPT}`,
  }), { Bak: "not this thread's Now", Longer: "not this thread's Now", BakThenTrue: 'written', Sentence: 'written' })
})

test('now refuses a block that breaks the shape, a bad task or a bad --thread-file, and writes nothing', () => {
  const dir = vault({
    [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Pr]]"]'),
    [`${T}/broken.md`]: task('tags: [task]\nstatus: open\nnext_action: a: b'),
    [`${P}/Pr.md`]: dash(nowOf(OPT)),
  })
  const opener = 'As of 2026-11-05, from the thread:'
  for (const [block, why] of [
    [`${opener}\n- 1\n- 2\n- 3\n- 4\n- 5`, /at most 5 lines/],
    ['', /empty/],
    [`${opener}\n\n- a`, /blank line/],
    ['As at 2026-11-05, from the thread:\n- a', /must open/],
    ['As of 2026-02-30, from the thread:\n- a', /2026-02-30 is no date/],
    [`${opener}\nAs of 2026-11-04, from the thread:`, /second `As of YYYY-MM-DD, from the thread:` line/],
    [`${opener}\n# Heading`, /heading or fence/],
    [`${opener}\n\`\`\`\n- a`, /heading or fence/],
    [`${opener}\n**Next task:** x`, /closing line/],
    [`${opener}\n  **Thread:** x`, /closing line/],
    [`${opener}\n**History:** x`, /closing line/],
    [`${opener}\n- a\u2028b`, /line breaks other than/],
    [`${opener}\n- a\rb`, /line breaks other than/],
  ]) refused(dir, nowArgs(OPT), why, { input: `${block}\n` })
  refused(dir, nowArgs(OPT, 'nope'), /no task note/, { input: `${BLOCK}\n` })
  refused(dir, nowArgs(OPT, 'broken'), /frontmatter does not parse/, { input: `${BLOCK}\n` })
  refused(dir, ['now', 'cap', '--text', '-'], /--thread-file/, { input: `${BLOCK}\n` })
  refused(dir, nowArgs('THREAD.md'), /--thread-file must be an absolute path/, { input: `${BLOCK}\n` })
  refused(dir, nowArgs(path.join(scratch, 'threads', 'nowhere', 'THREAD.md')), /no thread file at /, { input: `${BLOCK}\n` })
})

test("now's --text - takes the block from stdin byte-exact, and --text takes it inline", () => {
  const block = 'As of 2026-11-05, from the thread:\n- Lachy\'s "call" on C:\\temp waits, with [[a-task|its link]] & *star*.'
  assert.equal(oneNow(dash(nowOf(OPT)), { block }).text, dash(nowOf(OPT, block)))
  const dir = vault({ [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Pr]]"]'), [`${P}/Pr.md`]: dash(nowOf(OPT)) })
  ok(dir, ['now', 'cap', '--thread-file', OPT, '--text', BLOCK])
  assert.equal(read(dir, `${P}/Pr.md`), dash(nowOf(OPT, BLOCK)))
})

test('now plans every note before it saves: a written note lands beside a skipped one left byte-identical', () => {
  const skipped = dash(`${RUN}\n\nAs of 2026-10-01, from the thread:\n- Older.\n\n${closingLine(OPT)}`)
  const dir = vault({
    [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Good]]", "[[Twice]]"]'),
    [`${P}/Good.md`]: dash(nowOf(OPT)),
    [`${P}/Twice.md`]: skipped,
  })
  const r = run(dir, [...nowArgs(OPT), '--json'], { input: `${BLOCK}\n` })
  assert.equal(r.status, 0, r.stderr)
  // --json returns the same rows as objects.
  assert.deepEqual(JSON.parse(r.stdout), [
    { kind: 'project', name: 'Good', field: 'now', result: 'written', path: `${P}/Good.md` },
    { kind: 'skip', name: 'Twice', result: 'Now not editable (two As of lines)' },
  ])
  assert.equal(read(dir, `${P}/Good.md`), dash(nowOf(OPT, BLOCK)))
  assert.equal(read(dir, `${P}/Twice.md`), skipped)
})

test('set-down, fill and now name their rows by link in projects: order, a resolve skip first, a duplicate once', () => {
  const fixture = () => vault({
    [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Area]]", "[[Work/Projects/A/Alpha]]", "[[Alpha]]"]'),
    [`${P}/A/Alpha.md`]: dash(nowOf(OPT)),
    [`${P}/Area/Area.md`]: task('tags: [area]'),
  })
  const area = ['skip', 'Area', `area note (${P}/Area/Area.md)`]
  const alpha = `${P}/A/Alpha`
  assert.deepEqual(ok(fixture(), ['set-down', 'cap', '--action', 'Go']), [
    ['task', 'cap', 'next_action', 'written'], area, ['project', alpha, 'next_task', 'written', `${alpha}.md`],
  ])
  assert.deepEqual(ok(fixture(), ['fill', 'cap', '--action', 'Go']), [
    // Alpha's `[[old]]` names no note: a dead slot, so fill writes it too.
    ['task', 'cap', 'next_action', 'written'], area, ['project', alpha, 'next_task', 'written', `${alpha}.md`],
  ])
  assert.deepEqual(ok(fixture(), nowArgs(OPT), { input: `${BLOCK}\n` }), [area, ['project', alpha, 'now', 'written', `${alpha}.md`]])
})

test('set-down then now on one note: next_task and the Now both land, and nothing else changes', () => {
  const dir = vault({
    [`${T}/cap.md`]: task('tags: [task]\nstatus: open\nprojects: ["[[Alpha]]"]'),
    [`${P}/A/Alpha.md`]: dash(nowOf(OPT)),
  })
  ok(dir, ['set-down', 'cap', '--action', 'Go'])
  ok(dir, nowArgs(OPT), { input: `${BLOCK}\n` })
  assert.equal(read(dir, `${P}/A/Alpha.md`), dash(nowOf(OPT, BLOCK)).replace('next_task: "[[old]]"', 'next_task: "[[cap]]"'))
})
