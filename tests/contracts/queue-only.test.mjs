// The queue is the only rollout (ADR 0030: one engine, no alias; p12-12). Nothing of the retired grouped
// rollout survives in code or docs except what this file lists, and every surviving mention is pinned by
// file, pattern and a maximum, in one of five categories:
//   refusal         names a retired form in order to refuse it;
//   migration       ADR 0030's strip of the legacy `wave:` task key, still on open vault tasks;
//   history         a record of what was (the glossary's retired entry, the README's lineage);
//   enforcement     a ban regex, a control or a negative assertion (test files only);
//   legacy fixture  a protocol-3 input a test migrates (test files only).
//
// (a) The task's Verify regex has no hit over skills/ (tests included), hooks/ and README.md.
// (b) Product files (skills/** outside skills/*/tests/, hooks/**, README.md, CONTEXT.md, .claude-plugin/*.json):
//     every /wave/i line matches an entry for its file, and no entry matches more lines than its max.
// (b2) Test files (tests/** and skills/*/tests/**) carry an exact /wave/i line count each; an unlisted one has none.
// (c) Every product entry still matches a line, so a stale exemption fails.
// (d) The retired files are gone, with no alias. (e) CONTEXT.md defines **Rollout-shaped**.
//
// One pure function, check(files), over { relPath: text }: the real tree and the controls run through it, and
// each control mutates the real files in memory and must fail with exactly its rules. __pycache__, .DS_Store and
// any file holding a NUL byte are skipped; this file is excluded by path. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { root } from '../lib/contract-text.mjs'

const SELF = 'tests/contracts/queue-only.test.mjs'
const VERIFY = /merged_through_wave|WAVE-STATUS|smart-halt|wave_[0-9]+_(dispatched|merged)/i
const WAVE = /wave/i
const RETIRED = ['hooks/wave-stop-driver.py', 'skills/execute/wave-execute.workflow.js',
  'skills/execute/scripts/reconcile-wave.py', 'skills/execute/scripts/merge-wave.sh']

// Product entries: file, the line pattern, the most lines it may match, and why it survives.
const PRODUCT = [
  { id: 'P1', file: 'skills/execute/SKILL.md', re: /^\*\*A wave number is refused\.\*\*/, max: 1, why: 'refusal' },
  { id: 'P2', file: 'skills/execute/task.workflow.js', re: /`waves` \(the pre-p12-5 shape\)/, max: 1, why: 'refusal (the args doc)' },
  { id: 'P3', file: 'skills/execute/task.workflow.js', re: /pre-p12-5 `waves` args shape/, max: 1, why: 'refusal (the guard comment)' },
  { id: 'P4', file: 'skills/execute/task.workflow.js', re: /a\.waves !== undefined\) throw new Error\('task\.workflow\.js takes one args\.task, not args\.waves/, max: 1, why: 'refusal (the guard)' },
  { id: 'P5', file: 'skills/execute/scripts/reconcile-rollout.py', re: /legacy `wave:`/, max: 3, why: 'migration (defer and carry docstrings, defer\'s printed line)' },
  { id: 'P6', file: 'skills/execute/scripts/reconcile-rollout.py', re: /"wave"/, max: 2, why: 'migration (defer\'s and carry\'s key tuples)' },
  { id: 'P7', file: 'skills/schedule/SKILL.md', re: /legacy `wave:`/, max: 5, why: 'migration (tombstones, carry, step 7, Verification)' },
  { id: 'P8', file: 'skills/orient/reshuffle.md', re: /legacy `wave:`/, max: 1, why: 'migration (R5)' },
  { id: 'P9', file: 'CONTEXT.md', re: /^- \*\*Wave\*\* — /, max: 1, why: 'history (the retired entry)' },
  { id: 'P10', file: 'CONTEXT.md', re: /\*\*Wave-shaped\*\* is now \*\*Rollout-shaped\*\*/, max: 1, why: 'history (the renamed term)' },
  { id: 'P11', file: 'CONTEXT.md', re: /a legacy `wave:`/, max: 1, why: 'migration (Clean defer)' },
  { id: 'P12', file: 'README.md', re: /the separate `wave` plugin/, max: 1, why: 'history' },
  { id: 'P13', file: 'README.md', re: /`lachyts\/wave-skill`/, max: 1, why: 'history' },
  { id: 'P14', file: 'README.md', re: /`0009` — thread absorbs wave|`docs\/wave-THREAD-archive\.md`/, max: 2, why: 'history (ADR 0009, the archive)' },
  { id: 'P15', file: 'README.md', re: /were the `wave` plugin|8 waves, 14 PRs/, max: 2, why: 'history (Lineage)' },
]

// Test files: the exact /wave/i line count of each; any test file not listed must have none.
const TESTS = [
  { id: 'T1', file: 'skills/execute/tests/task-engine.test.mjs', count: 7, why: 'refusal (the `waves`-shape test, the static a.waves pin)' },
  { id: 'T2', file: 'skills/execute/tests/reconcile-rollout.test.sh', count: 3, why: 'migration (defer strips a legacy `wave:`)' },
  { id: 'T3', file: 'skills/execute/tests/integrate.test.mjs', count: 1, why: 'enforcement (no engine log line names one)' },
  { id: 'T4', file: 'tests/schedule-queue.test.sh', count: 5, why: 'enforcement (Q1/Q2 negative greps)' },
  { id: 'T5', file: 'tests/unfinished-rollout.test.sh', count: 22, why: 'legacy fixture (C11 legacy, C12, K3, M1-M12)' },
  { id: 'T6', file: 'tests/contracts/execute-queue.test.mjs', count: 19, why: 'enforcement' },
  { id: 'T7', file: 'tests/contracts/schedule-queue.test.mjs', count: 22, why: 'enforcement' },
  { id: 'T8', file: 'tests/contracts/status-repair-queue.test.mjs', count: 10, why: 'enforcement' },
  { id: 'T9', file: 'tests/fixtures/reconcile/vault/Work/Tasks/Archive/Rollouts/demo-rollout-2026-01-10.md', count: 1, why: 'legacy fixture (an archived Completion log)' },
]

const SKILL_TESTS = /^skills\/[^/]+\/tests\//
const isTest = (rel) => rel.startsWith('tests/') || SKILL_TESTS.test(rel)
const isProduct = (rel) => (rel.startsWith('skills/') && !SKILL_TESTS.test(rel)) || rel.startsWith('hooks/') ||
  rel === 'README.md' || rel === 'CONTEXT.md' || /^\.claude-plugin\/[^/]+\.json$/.test(rel)
const inVerify = (rel) => rel.startsWith('skills/') || rel.startsWith('hooks/') || rel === 'README.md'

// Every text file the scan reads, as { relPath: text }.
function readTree() {
  const files = {}
  const add = (rel) => {
    const buf = fs.readFileSync(path.join(root, rel))
    if (!buf.includes(0)) files[rel] = buf.toString('utf8')
  }
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.name === '__pycache__' || e.name === '.DS_Store') continue
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) walk(rel)
      else if (e.isFile()) add(rel)
    }
  }
  for (const d of ['skills', 'hooks', 'tests']) walk(d)
  for (const f of ['README.md', 'CONTEXT.md']) add(f)
  for (const f of fs.readdirSync(path.join(root, '.claude-plugin'))) if (f.endsWith('.json')) add(`.claude-plugin/${f}`)
  delete files[SELF]
  return files
}

// { fails: sorted rule names, details: one line per finding }; fails [] means every rule holds.
function check(files) {
  const fails = new Set()
  const details = []
  const flag = (rule, why) => { fails.add(rule); details.push(`${rule}: ${why}`) }
  const used = new Map(PRODUCT.map((e) => [e.id, 0]))
  for (const [rel, text] of Object.entries(files)) {
    if (rel === SELF) continue
    const lines = text.split('\n')
    lines.forEach((l, i) => { if (inVerify(rel) && VERIFY.test(l)) flag('a', `${rel}:${i + 1} ${l.trim()}`) })
    if (isProduct(rel)) {
      const entries = PRODUCT.filter((e) => e.file === rel)
      lines.forEach((l, i) => {
        if (!WAVE.test(l)) return
        const e = entries.find((x) => x.re.test(l))
        if (e) used.set(e.id, used.get(e.id) + 1)
        else flag('b', `${rel}:${i + 1} is no listed refusal, migration or history line: ${l.trim()}`)
      })
    } else if (isTest(rel)) {
      const n = lines.filter((l) => WAVE.test(l)).length
      const want = TESTS.find((t) => t.file === rel)?.count ?? 0
      if (n !== want) flag('b2', `${rel} has ${n} /wave/i line(s), not ${want}`)
    }
  }
  for (const e of PRODUCT) {
    if (used.get(e.id) > e.max) flag('b', `${e.id} (${e.file}) matches ${used.get(e.id)} lines, over its max ${e.max}`)
    if (!(files[e.file] ?? '').split('\n').some((l) => e.re.test(l))) flag('c', `${e.id} (${e.file}) matches no line: a stale exemption`)
  }
  for (const t of TESTS) if (!(t.file in files)) flag('b2', `${t.id} (${t.file}) is missing`)
  for (const p of RETIRED) if (p in files) flag('d', `${p} exists`)
  if (!/^- \*\*Rollout-shaped\*\* — /m.test(files['CONTEXT.md'] ?? '')) flag('e', 'CONTEXT.md has no **Rollout-shaped** entry')
  return { fails: [...fails].sort(), details }
}

const real = readTree()

test('the queue is the only rollout: every surviving wave mention is listed, and the retired names are gone', () => {
  const { fails, details } = check(real)
  assert.deepEqual(fails, [], details.join('\n'))
})

test('the scan reads the product, the tests and the engine tests', () => {
  for (const f of ['skills/execute/SKILL.md', 'skills/execute/task.workflow.js', 'hooks/rollout-stop-driver.py', 'README.md',
    'CONTEXT.md', '.claude-plugin/plugin.json', 'tests/unfinished-rollout.test.sh', 'skills/execute/tests/task-engine.test.mjs']) {
    assert.ok(f in real, `${f} is not scanned`)
  }
  assert.ok(!(SELF in real), 'this file excludes itself')
  assert.ok(Object.keys(real).every((f) => !f.includes('__pycache__') && !f.endsWith('.DS_Store')), 'caches are skipped')
})

// ---- controls: each mutates the real files in memory and must fail with exactly its rules --------------

const only = (mut, rules, label) => assert.deepEqual(check({ ...real, ...mut }).fails, rules, label)
const swap = (rel, from, to) => {
  assert.ok(real[rel]?.includes(from), `control setup: ${from.slice(0, 60)} not in ${rel}`)
  return { [rel]: real[rel].replace(from, to) }
}

test('control: a WAVE-STATUS line in hooks fails (a) and (b)', () => {
  only({ 'hooks/rollout-stop-driver.py': `${real['hooks/rollout-stop-driver.py']}\n# the old WAVE-STATUS line\n` }, ['a', 'b'], 'hooks')
})

test('control: a README wave sentence outside the listed lines fails (b)', () => {
  only({ 'README.md': `${real['README.md']}\nThe lead merges each wave at once.\n` }, ['b'], 'README')
})

test('control: wave-shaped in CONTEXT outside the Wave entry fails (b)', () => {
  only(swap('CONTEXT.md', '- **Rollout-shaped** — passes the fit test', '- **Rollout-shaped** — wave-shaped work: passes the fit test'), ['b'], 'CONTEXT')
})

test('control: a third "wave" tuple in reconcile-rollout.py fails (b), over its max', () => {
  const f = 'skills/execute/scripts/reconcile-rollout.py'
  only({ [f]: `${real[f]}\nfor key in ("wave",):\n    pass\n` }, ['b'], 'third tuple')
})

test('control: a removed refusal line in execute SKILL.md fails (c)', () => {
  const f = 'skills/execute/SKILL.md'
  const line = real[f].split('\n').find((l) => PRODUCT[0].re.test(l))
  only(swap(f, `${line}\n`, ''), ['c'], 'no refusal')
})

test('control: a new wave line in an unlisted test file fails (b2)', () => {
  const f = 'tests/contracts/manifest.test.mjs'
  only({ [f]: `${real[f]}\n// a wave of checks\n` }, ['b2'], 'unlisted test')
})

test('control: T5 at 21 lines fails (b2)', () => {
  const f = 'tests/unfinished-rollout.test.sh'
  const line = real[f].split('\n').find((l) => WAVE.test(l))
  only(swap(f, `${line}\n`, ''), ['b2'], 'T5 at 21')
})

test('control: a recreated retired file fails (d)', () => {
  only({ 'hooks/wave-stop-driver.py': '#!/usr/bin/env python3\n' }, ['d'], 'alias')
})

test('control: a removed Rollout-shaped entry fails (e)', () => {
  only(swap('CONTEXT.md', '- **Rollout-shaped** — ', '- **Fit** — '), ['e'], 'no entry')
})
