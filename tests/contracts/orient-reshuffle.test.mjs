// Orient-reshuffle contracts (ADR 0027): the reshape step orient runs, carrying the retired split and
// gather verbs' machinery. It numbers phases from one base, defers note shape to the add-writers spec
// instead of carrying its own copy, never reshuffles in-flight work, rewrites backlinks without touching
// the vault's caches, and orient wires the drift step (ADR 0026) around it: dry run in the audit, one
// Drift line in the report, the unambiguous list applied only on a Reshuffle answer.
//
// Every phrase-level check runs on whitespace-collapsed text, so a reflowed line can't hide a match (or
// a regression). Sections are sliced fence-aware, so a fenced example with a `## …` line inside it can't
// cut a slice short. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const reshuffle = read('skills/orient/reshuffle.md')
const orient = read('skills/orient/SKILL.md')

const collapse = (s) => s.replace(/\s+/g, ' ')
// The fence rule refs.test uses: a line opening with ``` or ~~~ (after whitespace) toggles.
const FENCE = /^\s*(```|~~~)/

// Fenced blocks as arrays of their inner lines.
function fencedBlocks(text) {
  const blocks = []
  let cur = null
  for (const l of text.split('\n')) {
    if (FENCE.test(l)) {
      if (cur) { blocks.push(cur); cur = null } else cur = []
      continue
    }
    if (cur) cur.push(l)
  }
  return blocks
}

// From the first line matching startRe up to (not including) the next `##`/`###` heading outside a fence.
function section(text, startRe) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => startRe.test(l))
  assert.ok(start >= 0, `no line matches ${startRe}`)
  const out = [lines[start]]
  let inFence = false
  for (const l of lines.slice(start + 1)) {
    if (FENCE.test(l)) inFence = !inFence
    else if (!inFence && /^#{2,3} /.test(l)) break
    out.push(l)
  }
  return out.join('\n')
}

// Top-level `- ` bullets with their indented continuation lines, each collapsed.
function bullets(sectionText) {
  const out = []
  for (const l of sectionText.split('\n')) {
    if (/^- /.test(l)) out.push(l)
    else if (out.length && /^\s+\S/.test(l)) out[out.length - 1] += `\n${l}`
  }
  return out.map(collapse)
}

test('the reshape step carries no inline task template', () => {
  const templated = fencedBlocks(reshuffle).filter((b) => /^status: open$/m.test(b.join('\n')))
  assert.equal(templated.length, 0, 'a fenced block in reshuffle.md still spells out task frontmatter')
})

test('R5 cites the writer specs and names only what the reshuffle adds', () => {
  const r5 = collapse(section(reshuffle, /^## R5\./))
  for (const phrase of ['add-task.md', 'Step 4', 'Launch context', 'add-phase.md', 'phase: N', 'touches:',
    'work_depth:', 'Phase N · Task M', '**Verify:**', 'Resume prompt']) {
    assert.ok(r5.includes(phrase), `R5 is missing "${phrase}"`)
  }
  assert.match(r5, /Leave \*\*`wave:` unset\*\*/, 'R5 lost the wave: unset bullet')
  assert.match(r5, /Don't set `scope:`/, 'R5 lost the scope: bullet')
})

test('phases number from N_max + 1, never from phase 0', () => {
  const c = collapse(reshuffle)
  assert.doesNotMatch(c, /=\s*phase\s+0\b/i, 'the reshuffle still infers a phase 0')
  assert.doesNotMatch(c, /phase-0\s+tasks/i, 'the reshuffle still layers on phase-0 tasks')
  assert.ok(c.includes('N_max + 1'), 'the reshuffle does not number from N_max + 1')
  assert.ok(c.includes('states phases'), 'the reshuffle lost its stated-phases rule')
  const stale = [...c.matchAll(/continu\w*\s+from\s+`?N_max`?(?!\s*\+)/g)].map((m) => m[0])
  assert.deepEqual(stale, [], 'the reshuffle still continues from N_max')
})

test("the last Don't names both writer specs", () => {
  const donts = bullets(section(reshuffle, /^## Don'ts/))
  assert.ok(donts.length > 0, "no Don'ts bullets parsed")
  const last = donts[donts.length - 1]
  assert.ok(last.includes('add-task.md') && last.includes('add-phase.md'), `last Don't names only one spec: ${last}`)
})

test('in-flight work is frozen', () => {
  const r1 = collapse(section(reshuffle, /^## R1\./))
  assert.match(r1, /\*\*In flight — frozen\.\*\*/, 'R1 lost the frozen tier')
  assert.match(r1, /scope, phase and body never change/, 'R1 no longer freezes in-flight scope, phase and body')
  assert.match(collapse(section(orient, /^## Don't/)), /Don't reshuffle in-flight work/)
})

test('the grill is invoked by name and can stop at any point', () => {
  const r3 = collapse(section(reshuffle, /^## R3\./))
  assert.match(r3, /invoke \*\*`grill-with-docs`\*\*/, 'R3 no longer invokes grill-with-docs')
  assert.match(r3, /\*\*`grill-me`\*\*/, 'R3 no longer falls back to grill-me')
  assert.match(r3, /can stop at any point/, 'R3 lost the stoppable grill')
  assert.match(r3, /Clear items are not grilled/, 'R3 grills clear items')
})

test('backlink rewrites skip the vault caches', () => {
  const rename = collapse(section(reshuffle, /^## R5\./))
  for (const dir of ['`.git`', '`.obsidian`', '`.smart-env`', '`.trash`']) {
    assert.ok(rename.includes(dir), `the backlink rewrite does not exclude ${dir}`)
  }
  assert.match(rename, /\/usr\/bin\/grep -rlF/, 'the backlink search is not a real binary')
})

test('orient wires the drift step around the reshuffle', () => {
  const s2 = collapse(section(orient, /^### 2\./))
  assert.match(s2, /reconcile-project\.py --project <slug>/, 'orient § 2 does not run the reconcile step')
  assert.match(s2, /dry run/, 'orient § 2 reconcile is not a dry run')
  assert.match(collapse(section(orient, /^### 3\./)), /\*\*Drift\*\*: one line/, 'orient § 3 lost the Drift line')
  const s5 = collapse(section(orient, /^### 5\./))
  assert.match(s5, /with `--apply`/, 'orient § 5 does not apply the unambiguous drift')
  assert.match(s5, /Ambiguous items are listed for Lachy and never applied/, 'orient § 5 applies ambiguous drift')
})

test('orient schedules, supersedes and offers execute', () => {
  const s6 = collapse(section(orient, /^### 6\./))
  assert.match(s6, /At most one rollout is live per repo/, 'orient § 6 lost the one-live-rollout rule')
  assert.match(s6, /--regenerate/, 'orient § 6 does not supersede through --regenerate')
  const s9 = collapse(section(orient, /^### 9\./))
  for (const opt of ['**Fresh session**', '**Here**', '**Not yet**']) assert.ok(s9.includes(opt), `execute offer lacks ${opt}`)
})
