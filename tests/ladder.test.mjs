// skills/_shared/scripts/ladder.py — the loader for the operator's ladder file (ADR 0029 decisions 1 and 2).
//
// The file is `~/.config/thread/ladder.toml`: named rungs, bottom first, each a model (a tier alias) plus the
// efforts of the code-writing roles, the plan judge and the master review. No file gives the built-in ladder,
// two Opus rungs and nothing above Opus. A present file that does not validate is refused with one
// `ladder: <path>:<line>: <reason>` line, never a silent fall back to the built-in ladder.
//
// Hermetic: each case gets its own HOME under mkdtemp, so the script's `~` resolves there. python3 runs with
// -B and PYTHONDONTWRITEBYTECODE so no __pycache__ lands next to the script, even outside tests/run.sh.
// Fixtures are built line by line, so each asserted line number is the line the fixture puts the bad key on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadEngine } from './lib/engine.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'ladder.py')
const FIELDS = ['name', 'model', 'effort', 'judge', 'review']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const BUILT_IN = [
  { name: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh' },
  { name: 'opus-xhigh', model: 'opus', effort: 'xhigh', judge: 'high', review: 'xhigh' },
]

// ---- helpers ------------------------------------------------------------------------------------------

// beforeRemove(home) runs first in the same after-hook, so a case that locks a directory can unlock it.
function tmpHome(t, beforeRemove = () => {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ladder-'))
  t.after(() => {
    beforeRemove(home)
    fs.rmSync(home, { recursive: true, force: true })
  })
  return home
}

const ladderPath = (home) => path.join(home, '.config', 'thread', 'ladder.toml')

function writeLadder(home, content) {
  const p = ladderPath(home)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

// argv after `python3`; the default runs the script itself with no arguments.
function run(home, argv = ['-B', SCRIPT]) {
  const r = spawnSync('python3', argv, {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PYTHONDONTWRITEBYTECODE: '1' },
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function loads(home) {
  const r = run(home)
  assert.equal(r.stderr, '', 'nothing on stderr on success')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^\{.*\}\n$/, 'exactly one JSON line on stdout')
  return JSON.parse(r.stdout)
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Refused: exit `code`, nothing on stdout, one `ladder: <path>[:<line>]: <reason>` line on stderr.
function refused(home, { line = null, reason, code = 2, argv } = {}) {
  const r = run(home, argv)
  const p = escapeRe(ladderPath(home))
  assert.equal(r.status, code, `exit ${code}; stderr: ${r.stderr}`)
  assert.equal(r.stdout, '', 'nothing on stdout on failure')
  assert.doesNotMatch(r.stderr, /Traceback/)
  const where = line === null ? p : `${p}:${line}`
  assert.match(r.stderr, new RegExp(`^ladder: ${where}: .+\\n$`), `one line naming ${line === null ? 'no line' : `line ${line}`}`)
  if (reason) assert.match(r.stderr, reason)
  return r.stderr
}

// A rung as written, in key order. A string value is written as a TOML string; raw(...) is written verbatim.
const R = (name, model = 'opus', effort = 'high', judge = 'high', review = 'xhigh') => ({ name, model, effort, judge, review })
const raw = (text) => ({ raw: text })

// One comment line, then each rung as a [[rung]] table, a blank line between rungs. With that one-line head:
// rung 1's header is line 2 and its keys lines 3-7 (name, model, effort, judge, review in R's order);
// rung 2's header is line 9 and its keys lines 10-14; rung 3's header is line 16.
function render(rungs, head = ['# the ladder, bottom first']) {
  const lines = [...head]
  rungs.forEach((r, i) => {
    if (i) lines.push('')
    lines.push('[[rung]]')
    for (const [k, v] of Object.entries(r)) lines.push(`${k} = ${typeof v === 'string' ? JSON.stringify(v) : v.raw}`)
  })
  return lines.join('\n') + '\n'
}

const withKey = (rung, key, value) => ({ ...rung, [key]: value })
const without = (rung, key) => Object.fromEntries(Object.entries(rung).filter(([k]) => k !== key))
const renamed = (rung, from, to) => Object.fromEntries(Object.entries(rung).map(([k, v]) => [k === from ? to : k, v]))

// ---- L1: absent file ----------------------------------------------------------------------------------

function assertBuiltIn(ladder) {
  assert.deepEqual(ladder, { source: 'built-in', rungs: BUILT_IN })
  // ADR 0029 decision 2: the built-in ladder names no model above Opus and no `max`.
  for (const r of ladder.rungs) {
    assert.notEqual(r.model, 'fable', `${r.name} names Fable`)
    for (const k of ['effort', 'judge', 'review']) assert.notEqual(r[k], 'max', `${r.name}.${k} is max`)
  }
}

test('L1 absent file: no ~/.config gives the built-in ladder', (t) => {
  assertBuiltIn(loads(tmpHome(t)))
})

test('L1 absent file: ~/.config/thread/ without ladder.toml gives the built-in ladder', (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(path.join(home, '.config', 'thread'), { recursive: true })
  assertBuiltIn(loads(home))
})

test('L1 absent file: ~/.config/thread as a plain file (a step on the way is no directory) gives the built-in ladder', (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(path.join(home, '.config'))
  fs.writeFileSync(path.join(home, '.config', 'thread'), 'not a directory\n')
  assertBuiltIn(loads(home))
})

// ---- L2-L4: files that load ---------------------------------------------------------------------------

test('L2 a three-rung file naming Fable loads as written, bottom first, from its path', (t) => {
  const home = tmpHome(t)
  const rungs = [R('opus-high'), R('opus-xhigh', 'opus', 'xhigh'), R('fable-high', 'fable')]
  writeLadder(home, render(rungs))
  const ladder = loads(home)
  assert.equal(ladder.source, path.join(home, '.config/thread/ladder.toml'))
  assert.deepEqual(ladder.rungs, rungs)
})

test('L2 rung keys come out in name, model, effort, judge, review order whatever order they were written in', (t) => {
  const home = tmpHome(t)
  writeLadder(home, render([{ review: 'xhigh', judge: 'high', effort: 'high', model: 'opus', name: 'opus-high' }]))
  const ladder = loads(home)
  assert.deepEqual(ladder.rungs, [R('opus-high')])
  assert.deepEqual(Object.keys(ladder), ['source', 'rungs'])
  assert.deepEqual(Object.keys(ladder.rungs[0]), FIELDS)
})

test('L3 one rung is a ladder', (t) => {
  const home = tmpHome(t)
  writeLadder(home, render([R('opus-xhigh', 'opus', 'xhigh')]))
  assert.deepEqual(loads(home).rungs, [R('opus-xhigh', 'opus', 'xhigh')])
})

test('L3 the order is the operator\'s: a non-monotone ladder and `max` load unclamped', (t) => {
  const home = tmpHome(t)
  const rungs = [R('opus-max', 'opus', 'max', 'max', 'max'), R('opus-low', 'opus', 'low', 'low', 'low'), R('same-as-low', 'opus', 'low', 'low', 'low')]
  writeLadder(home, render(rungs))
  assert.deepEqual(loads(home).rungs, rungs)
})

test('L3 CRLF line endings load', (t) => {
  const home = tmpHome(t)
  writeLadder(home, render(BUILT_IN).replace(/\n/g, '\r\n'))
  assert.deepEqual(loads(home).rungs, BUILT_IN)
})

// The inline form: the head lines, then `rung = [`, then one inline table per line, then `]`. With the
// default one-line head, `rung = [` is line 2 and rung N is line 2 + N; with no head, rung N is line 1 + N.
const inlineTable = (r) => `{ ${Object.entries(r).map(([k, v]) => `${k} = ${typeof v === 'string' ? JSON.stringify(v) : v.raw}`).join(', ')} }`
const inline = (rungs, head = ['# the ladder, bottom first']) =>
  [...head, 'rung = [', ...rungs.map((r) => `  ${inlineTable(r)},`), ']', ''].join('\n')

test('L4 the inline-array form loads the same as [[rung]] tables', (t) => {
  const a = tmpHome(t)
  const b = tmpHome(t)
  writeLadder(a, inline(BUILT_IN))
  writeLadder(b, render(BUILT_IN))
  assert.deepEqual(loads(a).rungs, loads(b).rungs)
  assert.deepEqual(loads(a).rungs, BUILT_IN)
})

test('L4 an inline-array error names the bad rung\'s own line, not the `rung =` line', (t) => {
  const home = tmpHome(t)
  writeLadder(home, inline([R('opus-high'), R('opus-xhigh', 'gpt-5', 'xhigh')], []))
  refused(home, { line: 3, reason: /rung 2 \("opus-xhigh"\): unknown model "gpt-5"/ })
})

test('L4 an inline table on the `rung = [` line is rung 1\'s line, the next table rung 2\'s', (t) => {
  const home = tmpHome(t)
  writeLadder(home, `rung = [${inlineTable(R('opus-high'))},\n  ${inlineTable(R('opus-xhigh', 'opus', 'extreme'))}]\n`)
  refused(home, { line: 2, reason: /rung 2 \("opus-xhigh"\): effort "extreme"/ })
})

test('L4 an inline-array missing key names the rung\'s own line, and a duplicate names the first one\'s', (t) => {
  const a = tmpHome(t)
  writeLadder(a, inline([R('opus-high'), without(R('opus-xhigh', 'opus', 'xhigh'), 'judge')]))
  refused(a, { line: 4, reason: /rung 2 \("opus-xhigh"\): missing "judge"/ })
  const b = tmpHome(t)
  writeLadder(b, inline([R('opus-high'), R('opus-high', 'opus', 'xhigh')]))
  refused(b, { line: 4, reason: /rung 2 \("opus-high"\): duplicate name "opus-high" \(first at line 3\)/ })
})

test('L4 brackets, braces and quotes inside the array\'s comments and strings are not rungs', (t) => {
  const home = tmpHome(t)
  writeLadder(home, ['rung = [ # [ { """ \'\'\'', '  # { not a rung }', `  ${inlineTable(R('opus-high'))}, # } ]`,
    `  ${inlineTable(R('opus-xhigh', 'gpt-5', 'xhigh'))},`, ']', ''].join('\n'))
  refused(home, { line: 4, reason: /rung 2 \("opus-xhigh"\): unknown model "gpt-5"/ })
})

// ---- L5: invalid files --------------------------------------------------------------------------------

const TWO = [R('opus-high'), R('opus-xhigh', 'opus', 'xhigh')]

// [label, file content, line, reason]
const INVALID = [
  ['(a) a duplicate rung name names the second and the first',
    render([R('opus-high'), R('opus-high', 'opus', 'xhigh')]), 10, /rung 2 \("opus-high"\): duplicate name "opus-high" \(first at line 3\)/],
  ['(b) an unknown model lists the known ones',
    render([TWO[0], withKey(TWO[1], 'model', 'gpt-5')]), 11, /rung 2 \("opus-xhigh"\): unknown model "gpt-5".*opus, fable/],
  ['(b) a model is matched exactly: "Opus"',
    render([withKey(TWO[0], 'model', 'Opus'), TWO[1]]), 4, /unknown model "Opus"/],
  ['(b) a model is matched exactly: " opus"',
    render([withKey(TWO[0], 'model', ' opus'), TWO[1]]), 4, /unknown model " opus"/],
  ['(c) a model version is refused: a tier alias, never a version',
    render([withKey(TWO[0], 'model', 'claude-opus-5-5'), TWO[1]]), 4, /unknown model "claude-opus-5-5".*never a version/],
  ['(d) a bad effort',
    render([TWO[0], withKey(TWO[1], 'effort', 'extreme')]), 12, /rung 2 \("opus-xhigh"\): effort "extreme" .*low, medium, high, xhigh, max/],
  ['(d) a bad judge',
    render([TWO[0], withKey(TWO[1], 'judge', 'maximum')]), 13, /rung 2 \("opus-xhigh"\): judge "maximum" .*low, medium, high, xhigh, max/],
  ['(d) a bad review',
    render([TWO[0], withKey(TWO[1], 'review', 'ultra')]), 14, /rung 2 \("opus-xhigh"\): review "ultra" .*low, medium, high, xhigh, max/],
  ['(e) a missing review names the rung\'s [[rung]] line',
    render([TWO[0], without(TWO[1], 'review')]), 9, /rung 2 \("opus-xhigh"\): missing "review"/],
  ['(f) an unknown rung key is reported before the missing key it implies',
    render([TWO[0], renamed(TWO[1], 'review', 'reveiw')]), 14, /rung 2 \("opus-xhigh"\): unknown key "reveiw"/],
  ['(g) a [[rungs]] typo is an unknown top-level key at its header',
    render(TWO).replace(/\n\n\[\[rung\]\]\n/, '\n\n[[rungs]]\n'), 9, /unknown top-level key "rungs"/],
  ['(h) a TOML syntax error names tomllib\'s line',
    render([withKey(TWO[0], 'model', raw('opus')), TWO[1]]), 4, /invalid TOML/],
  ['(i) an array value is not a string',
    render([withKey(TWO[0], 'model', raw('["opus"]')), TWO[1]]), 4, /rung 1 \("opus-high"\): model must be a string, not an array/],
  ['(i) an integer value is not a string',
    render([TWO[0], withKey(TWO[1], 'effort', raw('3'))]), 12, /rung 2 \("opus-xhigh"\): effort must be a string, not an integer/],
  ['(i) a boolean name is not a string',
    render([withKey(TWO[0], 'name', raw('true')), TWO[1]]), 3, /rung 1: name must be a string, not a boolean/],
  ['(j) an uppercase name', render([withKey(TWO[0], 'name', 'Opus-High'), TWO[1]]), 3, /rung 1: name "Opus-High" /],
  ['(j) an empty name', render([withKey(TWO[0], 'name', ''), TWO[1]]), 3, /rung 1: name "" /],
  ['(j) a name starting with a digit', render([withKey(TWO[0], 'name', '1'), TWO[1]]), 3, /rung 1: name "1" /],
  ['(j) a name holding ": "', render([withKey(TWO[0], 'name', 'opus: high'), TWO[1]]), 3, /rung 1: name "opus: high" /],
  ['(j) a YAML boolean word as a name', render([withKey(TWO[0], 'name', 'true'), TWO[1]]), 3, /rung 1: name "true" .*YAML/],
  ['(j) a YAML boolean word as a name: yes', render([TWO[0], withKey(TWO[1], 'name', 'yes')]), 10, /rung 2: name "yes" .*YAML/],
  ['(k) a single [rung] table is not an array of tables',
    render([TWO[0]]).replace('[[rung]]', '[rung]'), 2, /array of tables/],
  ['(m) a key written twice in one rung names tomllib\'s line',
    ['# the ladder, bottom first', '[[rung]]', 'name = "opus-high"', 'model = "opus"', 'model = "fable"',
      'effort = "high"', 'judge = "high"', 'review = "xhigh"', ''].join('\n'), 5, /invalid TOML/],
  ['an unknown top-level key before the first rung',
    ['version = 1', ...render(TWO).split('\n')].join('\n'), 1, /unknown top-level key "version"/],
  ['a key after a rung\'s keys belongs to that rung',
    render(TWO) + 'top = "x"\n', 15, /rung 2 \("opus-xhigh"\): unknown key "top"/],
  // The order errors are found in, which is not always file order. With no head line, rung 1's header is
  // line 1 and its keys lines 2-6, so the bad model is line 3.
  ['(n) order: an unknown top-level table (line 8) is reported ahead of an earlier rung\'s bad model (line 3)',
    render([withKey(TWO[0], 'model', 'gpt')], []) + '\n[other]\nx = 1\n', 8, /unknown top-level key "other"/],
  ['(n) order: a rung\'s unknown key (line 7) is reported ahead of its earlier bad model (line 3)',
    render([{ ...withKey(TWO[0], 'model', 'gpt'), extra: 'x' }], []), 7, /rung 1 \("opus-high"\): unknown key "extra"/],
  ['(o) TOML that ends inside an open array names the last line, at end of document',
    render([withKey(TWO[0], 'review', raw('['))]), 7, /invalid TOML: .*end of document/],
  // The line scan skips comments and strings, and carries multi-line strings and arrays over line ends.
  ['(p) a triple quote in a comment opens no string: the bad line after it is still named',
    render([withKey(withKey(TWO[0], 'name', raw('"opus-high"  # don\'t use \'\'\' here')), 'effort', 'bad'), TWO[1]], []), 4,
    /rung 1 \("opus-high"\): effort "bad"/],
  ['(p) a triple quote in a comment after a multi-line string\'s close reopens nothing',
    render([withKey(withKey(TWO[0], 'model', raw('"""\nopus""" # not """ a new string')), 'effort', 'bad'), TWO[1]]), 6,
    /rung 1 \("opus-high"\): effort "bad"/],
  ['(p) a multi-line array\'s `[...]` line is no table header: the rung\'s keys after it are still placed',
    render([withKey(TWO[0], 'model', raw('[\n  ["opus"]\n]')), TWO[1]]).replace('review = "xhigh"\n', 'review = "xhigh"\nextra = 1\n'), 10,
    /rung 1 \("opus-high"\): unknown key "extra"/],
]

for (const [label, content, line, reason] of INVALID) {
  test(`L5 refused, exit 2: ${label}`, (t) => {
    const home = tmpHome(t)
    writeLadder(home, content)
    refused(home, { line, reason })
  })
}

test('L5 (f) the unknown key is reported, not the missing one', (t) => {
  const home = tmpHome(t)
  writeLadder(home, render([TWO[0], renamed(TWO[1], 'review', 'reveiw')]))
  assert.doesNotMatch(refused(home, { line: 14 }), /missing/)
})

test('L5 (l) non-UTF-8 bytes name the line they are on', (t) => {
  const home = tmpHome(t)
  const lines = render(TWO).split('\n')
  const [before, after] = [lines.slice(0, 2).join('\n') + '\nname = "opus-', '"\n' + lines.slice(3).join('\n')]
  writeLadder(home, Buffer.concat([Buffer.from(before), Buffer.from([0xff]), Buffer.from(after)]))
  refused(home, { line: 3, reason: /UTF-8/ })
})

test('L5 CRLF line endings keep the line numbers', (t) => {
  const home = tmpHome(t)
  writeLadder(home, render([withKey(TWO[0], 'model', 'gpt-5'), TWO[1]]).replace(/\n/g, '\r\n'))
  refused(home, { line: 4, reason: /unknown model "gpt-5"/ })
})

// ---- L6: no rungs -------------------------------------------------------------------------------------

test('L6 an empty file is refused: the operator wrote it, so it is never the built-in ladder', (t) => {
  const home = tmpHome(t)
  writeLadder(home, '')
  refused(home, { reason: /at least one rung/ })
})

test('L6 a comment-only file is refused', (t) => {
  const home = tmpHome(t)
  writeLadder(home, '# rungs go here, bottom first\n')
  refused(home, { reason: /at least one rung/ })
})

test('L6 `rung = []` is refused at its line', (t) => {
  const home = tmpHome(t)
  writeLadder(home, '# the ladder, bottom first\nrung = []\n')
  refused(home, { line: 2, reason: /at least one rung/ })
})

// ---- L7: a present path that cannot be read -----------------------------------------------------------

test('L7 ladder.toml as a directory is refused', (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(ladderPath(home), { recursive: true })
  refused(home, { reason: /: cannot read it: Is a directory\n$/ })
})

test('L7 a dangling ladder.toml symlink is refused, never read as absent', (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(path.dirname(ladderPath(home)), { recursive: true })
  fs.symlinkSync(path.join(home, 'nowhere.toml'), ladderPath(home))
  refused(home, { reason: new RegExp(`: cannot read it: a symlink to a missing file \\(${escapeRe(path.join(home, 'nowhere.toml'))}\\)\\n$`) })
})

test('L7 a dangling symlink on the way (~/.config/thread) is refused, never read as absent', (t) => {
  const home = tmpHome(t)
  fs.mkdirSync(path.join(home, '.config'))
  const link = path.join(home, '.config', 'thread')
  fs.symlinkSync(path.join(home, 'dotfiles', 'thread'), link)
  refused(home, { reason: new RegExp(`: cannot read it: ${escapeRe(link)} is a symlink to a missing directory \\(`) })
})

// lstat fails with EACCES, not ENOENT, under a directory that cannot be searched: present, unreadable. Root
// searches any directory, so the case cannot arise for it.
test('L7 a valid ladder.toml under a directory that cannot be searched is refused, never read as absent',
  { skip: process.getuid?.() === 0 && 'root can search any directory' }, (t) => {
    const config = (home) => path.join(home, '.config')
    const home = tmpHome(t, (h) => { if (fs.existsSync(config(h))) fs.chmodSync(config(h), 0o755) })
    writeLadder(home, render(TWO))
    fs.chmodSync(config(home), 0o000)
    refused(home, { reason: /: cannot read it: Permission denied\n$/ })
  })

// ---- L8: python without tomllib (< 3.11) --------------------------------------------------------------

// tomllib arrived in python 3.11; a None entry in sys.modules makes `import tomllib` raise ImportError.
const NO_TOMLLIB = ['-B', '-c',
  "import sys, runpy; s = sys.argv[1]; sys.modules['tomllib'] = None; sys.argv = ['ladder.py']; runpy.run_path(s, run_name='__main__')",
  SCRIPT]

test('L8 without tomllib an absent file still gives the built-in ladder', (t) => {
  const r = run(tmpHome(t), NO_TOMLLIB)
  assert.equal(r.stderr, '')
  assert.equal(r.status, 0)
  assertBuiltIn(JSON.parse(r.stdout))
})

test('L8 without tomllib a present file exits 3', (t) => {
  const home = tmpHome(t)
  writeLadder(home, render(TWO))
  refused(home, { code: 3, reason: /python >= 3\.11/, argv: NO_TOMLLIB })
})

// ---- L9: the loader and the engine agree on the model set ---------------------------------------------

// Pins ladder.py's MODELS to the engine's LADDER_MODELS (p13-2: the engine climbs rungs and validates
// args.ladder against that set), and its EFFORTS and built-in rungs to the engine's LADDER_EFFORTS and
// BUILT_IN_LADDER, so a machine with no ladder file runs the same ladder whether or not the lead passed one.
test('L9 MODELS equals the engine\'s LADDER_MODELS', (t) => {
  const r = run(tmpHome(t), ['-B', '-c',
    "import json, runpy, sys; g = runpy.run_path(sys.argv[1]); print(json.dumps(list(g['MODELS'])))", SCRIPT])
  assert.equal(r.stderr, '')
  assert.equal(r.status, 0)
  const engine = JSON.parse(JSON.stringify(loadEngine(['LADDER_MODELS']).LADDER_MODELS))
  assert.deepEqual(JSON.parse(r.stdout), engine)
  for (const model of engine) {
    const home = tmpHome(t)
    writeLadder(home, render([R(`${model}-high`, model)]))
    assert.deepEqual(loads(home).rungs, [R(`${model}-high`, model)])
  }
})

test('L9 the importable EFFORTS, FIELDS and BUILT_IN are the ones these tests pin', (t) => {
  const r = run(tmpHome(t), ['-B', '-c',
    "import json, runpy, sys; g = runpy.run_path(sys.argv[1]); print(json.dumps([list(g['EFFORTS']), list(g['FIELDS']), g['BUILT_IN']]))", SCRIPT])
  assert.equal(r.status, 0, r.stderr)
  const [efforts, fields, builtIn] = JSON.parse(r.stdout)
  assert.deepEqual(efforts, EFFORTS)
  assert.deepEqual(fields, FIELDS)
  assert.deepEqual(builtIn, BUILT_IN)
})

test('L9 the engine\'s LADDER_EFFORTS and BUILT_IN_LADDER equal ladder.py\'s, and the engine accepts its output', (t) => {
  const E = loadEngine(['LADDER_EFFORTS', 'BUILT_IN_LADDER', 'ladderArgsError'])
  assert.deepEqual(JSON.parse(JSON.stringify(E.LADDER_EFFORTS)), EFFORTS)
  assert.deepEqual(JSON.parse(JSON.stringify(E.BUILT_IN_LADDER)), loads(tmpHome(t)), 'the built-in ladder, source and rungs')
  const home = tmpHome(t)
  writeLadder(home, render([R('opus-high', 'opus'), R('fable-max', 'fable')]))
  assert.equal(E.ladderArgsError(loads(home)), '', "the engine accepts ladder.py's output for a file")
})

// ---- L10: CLI usage -----------------------------------------------------------------------------------

test('L10 an extra argument is a one-line usage error, exit 2', (t) => {
  const r = run(tmpHome(t), ['-B', SCRIPT, '--file', 'x.toml'])
  assert.equal(r.status, 2)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^ladder: .+\n$/)
})
