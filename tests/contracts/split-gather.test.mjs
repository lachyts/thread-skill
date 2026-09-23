// Split/gather contracts: the two roadmap writers agree on how phases are numbered, split defers note
// shape to the add-writers spec instead of carrying its own copy, and gather's --light promise says what
// it actually does (bodies are rewritten for backlinks, so nothing is byte-untouched).
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

const split = read('skills/split/SKILL.md')
const gather = read('skills/gather/SKILL.md')

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

test('split carries no inline task template', () => {
  const templated = fencedBlocks(split).filter((b) => /^status: open$/m.test(b.join('\n')))
  assert.equal(templated.length, 0, 'a fenced block in split/SKILL.md still spells out task frontmatter')
})

test('split § 5 cites the writer spec and names only what split adds', () => {
  const s5 = collapse(section(split, /^### 5\./))
  for (const phrase of ['add-task.md', 'Step 4', 'Launch context', 'phase:', 'touches:', 'work_depth:',
    'Phase N · Task M', '**Verify:**', 'Resume prompt']) {
    assert.ok(s5.includes(phrase), `split § 5 is missing "${phrase}"`)
  }
  assert.match(s5, /Leave \*\*`wave:` unset\*\*/, 'split § 5 lost the wave: unset bullet')
  assert.match(s5, /Don't set `scope:`/, 'split § 5 lost the scope: bullet')
  assert.match(s5, /--regenerate/, 'split § 5 lost the --regenerate bullet')
})

test('split § 3 numbers inferred phases from N_max + 1', () => {
  const c = collapse(split)
  assert.doesNotMatch(c, /=\s*phase\s+0\b/i, 'split still infers a phase 0')
  assert.doesNotMatch(c, /phase-0\s+tasks/i, 'split still layers on phase-0 tasks')
  assert.ok(c.includes('N_max + 1'), 'split does not number from N_max + 1')
  assert.ok(c.includes('states phases'), 'split lost its stated-phases rule')
})

test("split's last Don't names both writer specs", () => {
  const donts = bullets(section(split, /^## Don'ts/))
  assert.ok(donts.length > 0, "no Don'ts bullets parsed")
  const last = donts[donts.length - 1]
  assert.ok(last.includes('add-task.md') && last.includes('add-phase.md'), `last Don't names only one spec: ${last}`)
})

test('gather promises nothing byte-untouched', () => {
  assert.doesNotMatch(collapse(gather), /byte-untouched/i)
})

test('every byte-identical in gather is qualified by the backlink rewrites', () => {
  const c = collapse(gather)
  const hits = [...c.matchAll(/byte-identical/g)]
  assert.ok(hits.length >= 3, `expected at least 3 byte-identical promises, found ${hits.length}`)
  for (const h of hits) {
    const after = c.slice(h.index + h[0].length, h.index + h[0].length + 60 + 'except backlink rewrites'.length)
    assert.ok(after.includes('except backlink rewrites'), `unqualified byte-identical: …${c.slice(h.index, h.index + 90)}…`)
  }
})

test("gather's --light invocation comment is qualified", () => {
  const inv = fencedBlocks(gather).find((b) => b.some((l) => l.includes('/thread:gather')))
  assert.ok(inv, 'no invocation fence in gather/SKILL.md')
  const light = inv.find((l) => l.includes('--light'))
  assert.ok(light, 'no --light line in the invocation fence')
  assert.ok(light.includes('except backlink rewrites'), `unqualified --light comment: ${light}`)
})

test('gather numbers new phases from N_max + 1', () => {
  const c = collapse(gather)
  assert.ok(c.includes('N_max + 1'), 'gather does not number from N_max + 1')
  const stale = [...c.matchAll(/continu\w*\s+from\s+`?N_max`?(?!\s*\+)/g)].map((m) => m[0])
  assert.deepEqual(stale, [], 'gather still continues from N_max')
})

test('split and gather agree on the phase base', () => {
  assert.ok(collapse(split).includes('N_max + 1') && collapse(gather).includes('N_max + 1'))
})
