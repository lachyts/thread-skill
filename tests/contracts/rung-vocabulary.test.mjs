// Nothing in skills/ or tests/ speaks tiers (ADR 0029, p13-3): the tier ceiling, the cap stamp, the old default
// model's name and the old step-up advice are gone, but for the compat sites that must still name a legacy key, each
// pinned at an exact line count. Those are: execute's one ignored-ceiling warning (p13-2), the one constant naming
// the legacy keys a supersede's carry maps, and the tests that feed those keys to the compat paths, each test file
// keeping its tier words on as few lines as it needs (one constant line where it only names them).
//
// One pure function, countHits(files), counts the matching lines per file; the real tree and the controls run
// through it, so the matcher can't pass vacuously. Reads files only. The words are built from parts here, so this
// file never matches the task's Verify grep itself (its hits are exactly ALLOW); it is left out of the walk too.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { read, walk } from '../lib/contract-text.mjs'

// The ceiling key, the cap stamp's key, the old default model's name and the old step-up advice.
const WORDS = { ceiling: ['max', 'tier'].join('_'), cap: ['tier', 'capped'].join('_'), model: ['Opus', '4.8'].join(' '), advice: ['err toward', 'fable'].join(' ') }
const TIER = new RegExp(Object.values(WORDS).map((w) => w.replace('.', '\\.')).join('|'), 'i')
const SELF = `tests/contracts/${path.basename(fileURLToPath(import.meta.url))}`

// Every file allowed a hit, with its exact count of matching lines. Any file not listed must have none.
const ALLOW = {
  'skills/execute/SKILL.md': 1,                         // p13-2's ignored-ceiling warning
  'skills/execute/scripts/reconcile-rollout.py': 1,     // LEGACY_KEYS, the keys carry maps
  'skills/execute/tests/reconcile-rollout.test.sh': 3,  // reconcile leaves a stale cap stamp alone
  'tests/lead-integrate.test.sh': 2,                    // C12: stale stamps give the neutral rung record
  'tests/contracts/execute-queue.test.mjs': 6,          // the ladder and integrate-args rules and their control
  'tests/engine-ladder.test.mjs': 3,                    // p13-2's static check of skills/execute
  'tests/contracts/schedule-queue.test.mjs': 1,         // its TIER_WORDS constant
  'tests/contracts/status-repair-queue.test.mjs': 1,    // its TIER_WORDS constant
  'tests/unfinished-rollout.test.sh': 1,                // K6's TIER_KEY constant
}

// { file: text } for every file under skills/ and tests/, minus __pycache__ and this file.
function tree() {
  const files = {}
  for (const f of [...walk('skills'), ...walk('tests')]) {
    if (f.split('/').includes('__pycache__') || f === SELF) continue
    files[f] = read(f)
  }
  return files
}

// { file: count } of the lines matching the tier vocabulary, files with none left out.
function countHits(files) {
  const hits = {}
  for (const [f, text] of Object.entries(files)) {
    const n = text.split('\n').filter((l) => TIER.test(l)).length
    if (n) hits[f] = n
  }
  return hits
}

const real = tree()

test('the tier vocabulary appears only at the named compat sites, each at its exact line count', () => {
  assert.deepEqual(countHits(real), ALLOW)
})

test('the walk reaches the files it counts (skills, tests and the allowlisted sites)', () => {
  for (const f of Object.keys(ALLOW)) assert.ok(f in real, `${f} is walked`)
  assert.ok('skills/status/SKILL.md' in real && 'skills/schedule/rollout-template.md' in real)
})

// ---- controls: each mutates the in-memory tree in one place and must fail the exact-count check ----

const fails = (files) => assert.notDeepEqual(countHits(files), ALLOW)

test('control: a ceiling line injected into status fails', () => {
  fails({ ...real, 'skills/status/SKILL.md': `${real['skills/status/SKILL.md']}\nSet \`${WORDS.ceiling}: opus\` to cap the rollout.\n` })
})

test('control: a second cap-key comment in reconcile-rollout.py fails', () => {
  const f = 'skills/execute/scripts/reconcile-rollout.py'
  fails({ ...real, [f]: `${real[f]}\n# a stale ${WORDS.cap}: stamp is dropped\n` })
})

test('control: a tier word on a second line of an allowlisted test file fails', () => {
  const f = 'tests/unfinished-rollout.test.sh'
  fails({ ...real, [f]: `${real[f]}\n# the old default was ${WORDS.model}\n` })
})

test('control: a removed compat site fails too (the count is exact, not a ceiling)', () => {
  const f = 'skills/execute/SKILL.md'
  fails({ ...real, [f]: real[f].split('\n').filter((l) => !TIER.test(l)).join('\n') })
})
