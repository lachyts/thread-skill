// ADR 0040 (p24-1): the execution-fit test is three-way, the old name of its parallel outcome survives only as
// the glossary's alias, and orient's child-agent batches retire. Six rules:
//   s1  execution-fit.md runs the test in order: 1. Session lane, 2. Parallel-shaped, 3. Serial-shaped, each with
//       its test. An external publish is serial-shaped and never parallel-shaped (ruling a), a measurement window
//       or delayed verification waits on a date (ruling b), there are no serial self-rollouts (ruling c: orient § 6
//       applies it, and schedule's serial path enforces it through serial-chains.py), and a shared surface makes
//       work serial-shaped only alongside a failed parallel clause or sign.
//   s2  the retired term (/rollout-?\s*shaped/i on collapsed text, so a wrapped or capitalised form still counts)
//       appears once in CONTEXT.md, after `_Avoid_:` in its **Parallel-shaped** entry, and in no other product
//       file (skills/** outside skills/*/tests/, hooks/**, README.md, CONTEXT.md, .claude-plugin/*.json) and no
//       test file (tests/**, skills/*/tests/**).
//   s3  orient § 6 steers serial-shaped and session-lane work, Autonomous and Mixed schedule a serial rollout
//       (§ 7, one schedule call per project, one serial rollout note per chain) and Mixed keeps its handed item out
//       of it; § 9 offers on a parallel note § 6 or § 7 wrote, makes no offer on a serial note (Leg 1 starts by hand), and
//       names a surface overlap among its no-offer reasons; §§ 8 and 10 are retired tombstones, and `--debrief`
//       stops at the top of § 1, before the resolver, and appears nowhere else but § 10 and the invocation forms;
//       the description drops the fan-out trigger and `--debrief`; and none of the batch machinery survives.
//   s4  the vault grammar's In flight drops the `dispatched:` stamp and the start claim; CONTEXT.md retires the
//       stamp and the Dispatch artefact, keeps the Decision task off orient's batches and states both shapes
//       (**Serial-shaped** with the no-machine-check clause).
//   s5  schedule § 0 routes only session-lane misfits to the session lane, never a serial-shaped member save
//       ruling (c)'s plugin-repo work, lists the no-machine-check clause among its serial-shaped members, and
//       routes an all-serial set to its ## Serial path before it resolves the target repo.
//   s6  the other retired-batch surfaces: reflect's decision text and SKILL.md, grill-fit.md, the README's orient
//       row and § Runtime support, and execution-fit.md's opening.
//
// One pure function, check(files), over { relPath: text }: the real tree passes, and each control mutates one
// place in memory (through swap or swapIn, which fail loudly when their `from` is absent) and must fail with
// exactly its rule. Phrase checks run on collapsed text; slices are taken before collapsing. __pycache__,
// .DS_Store and any file holding a NUL byte are skipped; this file is excluded by path. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { collapse, root, section, slice } from '../lib/contract-text.mjs'

const SELF = 'tests/contracts/execution-fit-shapes.test.mjs'
const FIT = 'skills/_shared/execution-fit.md'
const ORIENT = 'skills/orient/SKILL.md'
const SCHEDULE = 'skills/schedule/SKILL.md'
const GRAMMAR = 'skills/_shared/vault-grammar.md'
const GRILL_FIT = 'skills/_shared/grill-fit.md'
const REFLECT = 'skills/reflect/SKILL.md'
const REFLECT_PY = 'skills/reflect/scripts/reflect.py'
const CONTEXT = 'CONTEXT.md'
const README = 'README.md'

// The retired term, any case, hyphen optional, any whitespace between (a line wrap included once collapsed).
const RETIRED = /rollout-?\s*shaped/gi
// Schedule § 0's route for an all-serial set: its ## Serial path, taken before the target repo is resolved.
const ROUTE = 'this run takes **## Serial path** below'
const STEER = '- **Serial-shaped and session-lane work → steer.**'

const SKILL_TESTS = /^skills\/[^/]+\/tests\//
const isTest = (rel) => rel.startsWith('tests/') || SKILL_TESTS.test(rel)
const isProduct = (rel) => (rel.startsWith('skills/') && !SKILL_TESTS.test(rel)) || rel.startsWith('hooks/') ||
  rel === README || rel === CONTEXT || /^\.claude-plugin\/[^/]+\.json$/.test(rel)

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
  for (const f of [README, CONTEXT]) add(f)
  for (const f of fs.readdirSync(path.join(root, '.claude-plugin'))) if (f.endsWith('.json')) add(`.claude-plugin/${f}`)
  delete files[SELF]
  return files
}

const C = (s) => (s == null ? '' : collapse(s))
const count = (text) => (C(text).match(RETIRED) ?? []).length
const sentences = (text) => C(text).split(/(?<=[.!?])\s+/)
// A CONTEXT.md entry: its `- **<name>**` line up to the next top-level entry.
const entry = (text, name) => slice(text, new RegExp(`^- \\*\\*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*\\*`), /^- \*\*/)

// { fails: sorted rule names, details: one line per finding }; fails [] means every rule holds.
function check(files) {
  const fails = new Set()
  const details = []
  const flag = (rule, why) => { fails.add(rule); details.push(`${rule}: ${why}`) }
  const need = (rule, name, text, patterns) => {
    if (text == null || text === '') return flag(rule, `${name} is missing`)
    for (const p of patterns) {
      const ok = typeof p === 'string' ? text.includes(p) : p.test(text)
      if (!ok) flag(rule, `${name} does not contain ${p}`)
    }
  }
  const never = (rule, name, text, patterns) => {
    for (const p of patterns) {
      const hit = typeof p === 'string' ? text.includes(p) : p.test(text)
      if (hit) flag(rule, `${name} still contains ${p}`)
    }
  }

  // ---- s1: execution-fit.md states the three outcomes, in order, with their tests and rulings ----
  const fit = files[FIT] ?? ''
  const lines = fit.split('\n')
  const at = (re) => lines.findIndex((l) => re.test(l))
  const iS = at(/^1\. \*\*Session lane\*\*/)
  const iP = at(/^2\. \*\*Parallel-shaped\*\*/)
  const iR = at(/^3\. \*\*Serial-shaped\*\*/)
  if (!(iS >= 0 && iP > iS && iR > iP)) {
    flag('s1', `${FIT} does not number 1. Session lane, 2. Parallel-shaped, 3. Serial-shaped in that order`)
  } else {
    need('s1', `${FIT} step 1`, C(slice(fit, /^1\. \*\*Session lane\*\*/, /^2\. /)),
      ['conversation-gated', 'measurement window', 'days or weeks later'])
    need('s1', `${FIT} step 2`, C(slice(fit, /^2\. \*\*Parallel-shaped\*\*/, /^3\. /)), [
      '**One repo**', '**PR-per-task**', '**In-run verification**', 'its core action is not an external publish',
      'needs no external tool or launch profile the lead lacks', 'a parallel rollout',
    ])
    need('s1', `${FIT} step 3`, C(slice(fit, /^3\. \*\*Serial-shaped\*\*/, /^\*\*Rulings/)), [
      'no PR per task', 'external publish', 'launch profile the lead lacks', 'a serial rollout', /shared surface[^.]*only when/,
    ])
  }
  need('s1', `${FIT} Rulings`, C(slice(fit, /^\*\*Rulings/, /^\*\*Mixed sets split/)), [
    /\(a\) \*\*An external publish is serial-shaped\*\*/, 'sets the task aside', 'waits on a date',
    /\(b\)[^.]*measurement window/, /\(c\) \*\*No serial self-rollouts\.\*\*/,
  ])
  const rulingC = C(slice(fit, /^- \(c\) /, /^(- |$)/))
  need('s1', `${FIT} ruling (c)`, rulingC, ['Orient § 6 applies this ruling now', "schedule's serial path enforces it"])
  never('s1', `${FIT} ruling (c)`, rulingC, [/schedule enforces/])
  need('s1', FIT, C(fit), ['Mixed sets split', 'Count is never a criterion'])
  if (!lines.includes('## Dispatch blockers — parallel-shaped but not yet runnable')) {
    flag('s1', `${FIT} has no ## Dispatch blockers — parallel-shaped but not yet runnable heading`)
  }
  for (const s of sentences(fit)) {
    if (/external publish[^.]*\b(is|counts as|stays) parallel-shaped/i.test(s)) flag('s1', `${FIT} lets an external publish be parallel-shaped: ${s}`)
  }

  // ---- s2: the retired term lives only in CONTEXT.md's alias ----
  for (const [rel, text] of Object.entries(files)) {
    if (rel === SELF || !(isProduct(rel) || isTest(rel))) continue
    const n = count(text)
    const want = rel === CONTEXT ? 1 : 0
    if (n !== want) flag('s2', `${rel} has ${n} rollout-shaped hit(s), not ${want}`)
  }
  const par = C(entry(files[CONTEXT], 'Parallel-shaped'))
  const avoid = par.indexOf('_Avoid_:')
  const alias = par.search(new RegExp(RETIRED.source, 'i'))
  if (count(par) !== 1 || avoid < 0 || alias < avoid) flag('s2', `${CONTEXT}'s one hit is not the _Avoid_ alias of **Parallel-shaped**`)

  // ---- s3: orient routes serial-shaped work to a serial rollout and keeps none of the batch machinery ----
  const orient = files[ORIENT] ?? ''
  const s6 = section(orient, /^### 6\./) ?? ''
  if (!s6.split('\n').some((l) => l.startsWith(STEER))) flag('s3', `${ORIENT} § 6 has no top-level ${STEER} bullet`)
  need('s3', `${ORIENT} § 6 steer bullet`, C(slice(s6, /^- \*\*Serial-shaped and session-lane work → steer\.\*\*/, /^- /)), [
    'If any serial-shaped or session-lane work is left', 'no serial-shaped cluster → recommend Hands-on',
  ])
  need('s3', `${ORIENT} § 6 Autonomous`, C(slice(s6, /^\s+- \*\*Autonomous\*\*/, /^\s*- \*\*(?!Autonomous)/)), [
    'serial rollout', '(§ 7)', 'offered only when a serial-shaped cluster exists',
  ])
  need('s3', `${ORIENT} § 6 Mixed`, C(slice(s6, /^\s+- \*\*Mixed\*\*/, /^\s*- \*\*(?!Mixed)/)), ['left out of the serial `--tasks` list'])
  const olines = orient.split('\n')
  if (!olines.includes('### 7. Autonomous: a serial rollout')) flag('s3', `${ORIENT} has no ### 7. Autonomous: a serial rollout`)
  need('s3', `${ORIENT} § 7`, C(section(orient, /^### 7\./)), [
    '`${CLAUDE_PLUGIN_ROOT}/skills/schedule/SKILL.md`', '`--tasks', 'once per project', 'one serial rollout note per chain',
  ])
  const s9 = C(section(orient, /^### 9\./))
  need('s3', `${ORIENT} § 9`, s9, ['When § 6 or § 7 wrote a rollout note',
    'a serial note (`shape: serial`) gets no offer: name it, its chain, each row\'s launch and Leg 1\'s start line, and never stamp `start: unattended` on it'])
  need('s3', `${ORIENT} § 9 closing line`, sentences(s9).find((x) => x.startsWith('No rollout written')) ?? '', ['a surface overlap with a live chain'])
  for (const n of ['8', '10']) {
    if (!olines.some((l) => new RegExp(`^### ${n}\\. .*\\(retired\\)$`).test(l))) flag('s3', `${ORIENT} § ${n} heading does not end (retired)`)
  }
  const description = orient.match(/^description: (.*)$/m)?.[1] ?? ''
  never('s3', `${ORIENT} description`, description, [/fan out background session/i, '--debrief'])
  const s1o = section(orient, /^### 1\./) ?? ''
  const debriefAt = C(s1o).indexOf('**`--debrief` stops first.**')
  const resolverAt = C(s1o).indexOf('resolve-target.py')
  if (debriefAt < 0 || resolverAt < 0 || debriefAt > resolverAt) {
    flag('s3', `${ORIENT} § 1 does not stop on \`--debrief\` before the resolver (${debriefAt}, ${resolverAt})`)
  }
  never('s3', `${ORIENT} § 1`, C(s1o), [/own flags \(`--debrief`/])
  const s10 = section(orient, /^### 10\./) ?? ''
  need('s3', `${ORIENT} § 10`, C(s10), ['before the resolver runs or anything is asked', 'the arguments as given'])
  const forms = section(orient, /^## Invocation forms/) ?? ''
  const debriefRest = orient.replace(/^description: .*$/m, '').replace(s1o, '').replace(s10, '').replace(forms, '')
  never('s3', `${ORIENT} outside § 1, § 10 and the invocation forms`, debriefRest, ['--debrief'])
  const s8 = section(orient, /^### 8\./) ?? ''
  never('s3', `${ORIENT} outside § 8`, orient.replace(s8, ''), [/\bdispatched\b/i])
  never('s3', ORIENT, C(orient), ['native_workflow', /Double-dispatch guard/i, /Twin check/i, 'run_in_background',
    /orient (dispatch|start): run/, /\bre-batch/, /Every batch prompt must carry/])

  // ---- s4: the vault grammar and the glossary retire the stamp ----
  const inFlight = C(section(files[GRAMMAR], /^## In flight$/))
  if (!inFlight) flag('s4', `${GRAMMAR} has no ## In flight`)
  never('s4', `${GRAMMAR} § In flight`, inFlight, ['`dispatched:`', 'start claim'])
  const ctx = files[CONTEXT] ?? ''
  need('s4', `${CONTEXT} **\`dispatched:\` stamp**`, C(entry(ctx, '`dispatched:` stamp')), ['Retired 2026-10-19'])
  need('s4', `${CONTEXT} **Dispatch artefact**`, C(entry(ctx, 'Dispatch artefact')), ['Retired 2026-10-19'])
  const decision = C(entry(ctx, 'Decision task'))
  if (!decision) flag('s4', `${CONTEXT} has no **Decision task**`)
  never('s4', `${CONTEXT} **Decision task**`, decision, ["orient's batches"])
  need('s4', `${CONTEXT} **Parallel-shaped**`, par, ['no external publish'])
  need('s4', `${CONTEXT} **Serial-shaped**`, C(entry(ctx, 'Serial-shaped')), ['only alongside', 'no machine check inside the run'])

  // ---- s5: schedule § 0 never sends a serial-shaped member to the session lane, and stops an all-serial set early ----
  const s0 = C(section(files[SCHEDULE], /^### 0\./))
  need('s5', `${SCHEDULE} § 0`, s0, ['If session-lane misfits dominate', 'no machine check inside the run',
    "save ruling (c)'s plugin-repo work"])
  never('s5', `${SCHEDULE} § 0`, s0, [/If misfits dominate/])
  if (!sentences(s0).some((x) => x.includes('serial-shaped') && x.includes('never routed to the session lane'))) {
    flag('s5', `${SCHEDULE} § 0 has no sentence keeping a serial-shaped member out of the session lane`)
  }
  const routeAt = s0.indexOf(ROUTE)
  const resolveAt = s0.indexOf('After the misfit scan, resolve')
  if (routeAt < 0 || resolveAt < 0 || routeAt > resolveAt) {
    flag('s5', `${SCHEDULE} § 0 does not route an all-serial set to ## Serial path before "After the misfit scan, resolve" (${routeAt}, ${resolveAt})`)
  }

  // ---- s6: the other retired-batch surfaces ----
  const py = files[REFLECT_PY] ?? ''
  need('s6', REFLECT_PY, py, ['Never schedule or reshuffle it.'])
  never('s6', REFLECT_PY, py, [/batch or reshuffle/])
  never('s6', REFLECT, C(files[REFLECT] ?? ''), [/schedule,\s+batch or reshuffle/, /orient § 7 \(Batch\)/])
  never('s6', GRILL_FIT, C(files[GRILL_FIT] ?? ''), ['orient § 8', '--debrief', /every orient batch prompt/])
  const readme = files[README] ?? ''
  const row = readme.split('\n').find((l) => l.startsWith('| `/thread:orient` |')) ?? ''
  need('s6', `${README} orient row`, row, ['ADR 0040'])
  never('s6', `${README} orient row`, row, [/native child agents/])
  const runtime = C(section(readme, /^## Runtime support/))
  if (!runtime) flag('s6', `${README} has no ## Runtime support`)
  never('s6', `${README} § Runtime support`, runtime, [/native child/])
  never('s6', FIT, C(fit), [/native batches/])

  return { fails: [...fails].sort(), details }
}

const real = readTree()

test('the execution-fit test is three-way, the old term is only an alias, and orient\'s batches are retired', () => {
  const { fails, details } = check(real)
  assert.deepEqual(fails, [], details.join('\n'))
})

test('the scan reads the product, the tests and the manifests, and skips itself', () => {
  for (const f of [FIT, ORIENT, SCHEDULE, GRAMMAR, GRILL_FIT, REFLECT, REFLECT_PY, CONTEXT, README, '.claude-plugin/plugin.json',
    'tests/contracts/orient-reshuffle.test.mjs', 'skills/execute/tests/task-engine.test.mjs']) {
    assert.ok(f in real, `${f} is not scanned`)
  }
  assert.ok(!(SELF in real), 'this file excludes itself')
})

// ---- controls: each mutates the real files in memory and must fail with exactly its rule ----------------

// A whitespace-tolerant pattern for `from`, so a reflowed line still matches.
const loose = (from) => new RegExp(from.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'))
const only = (mut, rules, label) => {
  const { fails, details } = check({ ...real, ...mut })
  assert.deepEqual(fails, rules, `${label}\n${details.join('\n')}`)
}
// Replace the first `from` in `rel` (whitespace-tolerant); fails loudly when it is absent.
const swap = (rel, from, to) => {
  const re = loose(from)
  assert.ok(re.test(real[rel] ?? ''), `control setup: ${from.slice(0, 60)} not in ${rel}`)
  return { [rel]: real[rel].replace(re, to) }
}
// `swap`, confined to the lines from `start` up to the next `stop` line.
const swapIn = (rel, start, stop, from, to) => {
  const part = slice(real[rel], start, stop)
  assert.ok(part != null, `control setup: no line matches ${start} in ${rel}`)
  const re = loose(from)
  assert.ok(re.test(part), `control setup: ${from.slice(0, 60)} not in ${rel} from ${start}`)
  return { [rel]: real[rel].replace(part, part.replace(re, to)) }
}
const append = (rel, text) => ({ [rel]: `${real[rel]}\n${text}\n` })

test('control: execution-fit.md without its serial-shaped step fails s1', () => {
  const item = slice(real[FIT], /^3\. \*\*Serial-shaped\*\*/, /^\*\*Rulings/)
  assert.ok(item, 'control setup: no 3. **Serial-shaped** step')
  only({ [FIT]: real[FIT].replace(item, '') }, ['s1'], 'no step 3')
})

test('control: ruling (a) that makes an external publish session lane fails s1', () => {
  only(swap(FIT, '**An external publish is serial-shaped**', '**An external publish is session lane**'), ['s1'], 'ruling a flipped')
})

test('control: execution-fit.md without ruling (c) fails s1', () => {
  const c = slice(real[FIT], /^- \(c\) /, /^(- |$)/)
  assert.ok(c, 'control setup: no - (c) ruling')
  only({ [FIT]: real[FIT].replace(`${c}\n`, '') }, ['s1'], 'no ruling c')
})

test('control: ruling (c) without schedule\'s serial path as its enforcer fails s1', () => {
  only(swap(FIT, "Orient § 6 applies this ruling now, before it calls schedule; schedule's serial path enforces it",
    'Schedule enforces this'), ['s1'], 'ruling c enforcer')
})

test('control: a parallel step without its publish clause fails s1', () => {
  only(swap(FIT, 'its core action is not an external publish, and', 'and'), ['s1'], 'no publish clause')
})

test('control: a parallel step that lets an external publish be parallel-shaped fails s1', () => {
  only(swap(FIT, 'Parallel-shaped → a parallel rollout',
    'A one-repo, PR-per-task task whose core action is an external publish is parallel-shaped. Parallel-shaped → a parallel rollout'),
  ['s1'], 'publish parallel-shaped')
})

test('control: a shared-surface sentence without "only when" fails s1', () => {
  only(swap(FIT, 'make work serial-shaped only when one of these already holds', 'make work serial-shaped'), ['s1'], 'shared surface')
})

test('control: the retired term in orient fails s2', () => {
  only(append(ORIENT, 'A rollout-shaped cluster goes to schedule.'), ['s2'], 'orient')
})

test('control: the retired term wrapped across a line in schedule fails s2', () => {
  only(append(SCHEDULE, 'a Rollout-\nshaped cluster'), ['s2'], 'wrapped')
})

test('control: CONTEXT.md without its alias fails s2', () => {
  only(swap(CONTEXT, '_Avoid_: rollout-shaped (its name until 2026-10-19, when "rollout" came to cover both shapes).', ''), ['s2'], 'no alias')
})

test('control: the old session-lane steer trigger fails s3', () => {
  only(swap(ORIENT, STEER, '- **Everything else → the session lane.**'), ['s3'], 'old trigger')
})

test('control: a Mixed option that lets its handed item into the serial rollout fails s3', () => {
  only(swap(ORIENT, 'left out of the serial `--tasks` list', 'kept in the serial `--tasks` list'), ['s3'], 'Mixed exclusion')
})

test('control: the fan-out trigger back in the description fails s3', () => {
  only(swap(ORIENT, '"split/break this plan into numbered, phased tasks",',
    '"split/break this plan into numbered, phased tasks", "fan out background sessions on <project>",'), ['s3'], 'fan-out')
})

test('control: a § 1 that strips `--debrief` and runs the resolver fails s3', () => {
  const stop = slice(real[ORIENT], /^\*\*`--debrief` stops first\.\*\*/, /^$/)
  assert.ok(stop, 'control setup: no --debrief stop paragraph')
  const stripped = swap(ORIENT, "orient's own flags (`--steer`,", "orient's own flags (`--debrief`, `--steer`,")[ORIENT]
  only({ [ORIENT]: stripped.replace(`${stop}\n\n`, '') }, ['s3'], 'debrief resolved')
})

test('control: `--debrief` back as a § 2 reach clause fails s3', () => {
  only(swap(ORIENT, 'A scoped target runs none.', 'A scoped target and `--debrief` run none.'), ['s3'], 'debrief § 2')
})

test('control: a § 9 that offers only on § 6\'s note fails s3', () => {
  only(swap(ORIENT, 'When § 6 or § 7 wrote a rollout note', 'When § 6 wrote a rollout note'), ['s3'], '§ 9')
})

test('control: a § 7 without "once per project" fails s3', () => {
  only(swapIn(ORIENT, /^### 7\./, /^### 8\./, 'once per project', ''), ['s3'], 'per project')
})

test('control: an In flight that still reads the stamp fails s4', () => {
  only(swapIn(GRAMMAR, /^## In flight$/, /^## (?!In flight)/, 'is still live', 'is still live, a `dispatched:` stamp'), ['s4'], 'In flight')
})

test('control: a `dispatched:` stamp entry that is not retired fails s4', () => {
  only(swapIn(CONTEXT, /^- \*\*`dispatched:` stamp\*\*/, /^- \*\*(?!`dispatched)/, 'Retired 2026-10-19', 'Live'), ['s4'], 'stamp')
})

test('control: a Dispatch artefact entry that is not retired fails s4', () => {
  only(swapIn(CONTEXT, /^- \*\*Dispatch artefact\*\*/, /^- \*\*(?!Dispatch artefact)/, 'Retired 2026-10-19', 'Live'), ['s4'], 'artefact')
})

test('control: a Decision task that orient\'s batches still skip fails s4', () => {
  only(swapIn(CONTEXT, /^- \*\*Decision task\*\*/, /^- \*\*(?!Decision task)/, 'schedule (either shape) and the reshuffle never take it',
    "schedule, the reshuffle and orient's batches never take it"), ['s4'], 'decision task')
})

test('control: a Parallel-shaped entry without its publish clause fails s4', () => {
  only(swapIn(CONTEXT, /^- \*\*Parallel-shaped\*\*/, /^- \*\*(?!Parallel)/, 'with no external publish and', 'with'), ['s4'], 'parallel')
})

test('control: a Serial-shaped entry without the no-machine-check clause fails s4', () => {
  only(swapIn(CONTEXT, /^- \*\*Serial-shaped\*\*/, /^- \*\*(?!Serial)/, 'no machine check inside the run,', ''), ['s4'], 'serial machine check')
})

test('control: a Serial-shaped entry that lets a shared surface decide alone fails s4', () => {
  only(swapIn(CONTEXT, /^- \*\*Serial-shaped\*\*/, /^- \*\*(?!Serial)/, 'only alongside one of these', 'on its own'), ['s4'], 'serial')
})

test('control: a § 0 that routes every misfit to the session lane fails s5', () => {
  only(swap(SCHEDULE, 'If session-lane misfits dominate', 'If misfits dominate'), ['s5'], 'widened')
})

test('control: a § 0 without the never-routed clause fails s5', () => {
  only(swap(SCHEDULE, "; a serial-shaped member is never routed to the session lane, save ruling (c)'s plugin-repo work (the fit doc's **Rulings**)", ''),
    ['s5'], 'never routed')
})

test('control: a § 0 without ruling (c)\'s carve-out fails s5', () => {
  only(swap(SCHEDULE, ", save ruling (c)'s plugin-repo work (the fit doc's **Rulings**)", ''), ['s5'], 'carve-out')
})

test('control: a § 0 serial-shaped list without the no-machine-check clause fails s5', () => {
  only(swap(SCHEDULE, '(vault notes, several repos) or no machine check inside the run,', '(vault notes, several repos),'), ['s5'], 'machine check')
})

test('control: a § 0 without the route to its ## Serial path fails s5', () => {
  only(swap(SCHEDULE, ROUTE, 'this run stops here'), ['s5'], 'no route')
})

test('control: the route after "After the misfit scan, resolve" fails s5', () => {
  const s0 = section(real[SCHEDULE], /^### 0\./)
  const para = s0.split('\n\n').find((p) => collapse(p).includes(ROUTE))
  assert.ok(para, 'control setup: no § 0 paragraph holds the route')
  const moved = real[SCHEDULE].replace(`${para}\n\n`, '').replace(/After the misfit scan, resolve[^.]*\./, (m) => `${m} ${para}`)
  assert.notEqual(moved, real[SCHEDULE], 'control setup: nothing moved')
  only({ [SCHEDULE]: moved }, ['s5'], 'route moved')
})

test('control: an orient § 7 that writes one note per project fails s3', () => {
  only(swapIn(ORIENT, /^### 7\./, /^### 8\./, 'one serial rollout note per chain', 'one note per project'), ['s3'], '§ 7 note per chain')
})

test('control: an orient § 9 that offers on a serial note fails s3', () => {
  only(swap(ORIENT, 'a serial note (`shape: serial`) gets no offer: name it',
    'a serial note (`shape: serial`) gets the same offer: name it'), ['s3'], '§ 9 serial offer')
})

test('control: an orient § 9 closing line without the surface overlap fails s3', () => {
  only(swap(ORIENT, 'or a surface overlap with a live chain', 'or a refusal'), ['s3'], '§ 9 closing')
})

test('control: reflect.py\'s old decision sentence fails s6', () => {
  only(swap(REFLECT_PY, 'Never schedule or reshuffle it.', 'Never schedule, batch or reshuffle it.'), ['s6'], 'reflect.py')
})

test('control: reflect SKILL.md citing orient § 7 (Batch) fails s6', () => {
  only(swap(REFLECT, 'orient § 7 (Autonomous)', 'orient § 7 (Batch)'), ['s6'], 'reflect SKILL')
})

test('control: grill-fit.md citing orient § 8 fails s6', () => {
  only(swap(GRILL_FIT, 'today handoff § Build the handoff prompt', "today orient § 8's batch prompts and handoff § Build the handoff prompt"),
    ['s6'], 'grill-fit')
})

test('control: a README orient row back on native child agents fails s6', () => {
  const row = real[README].split('\n').find((l) => l.startsWith('| `/thread:orient` |'))
  assert.ok(row, 'control setup: no orient row')
  only({ [README]: real[README].replace(row, row.replace('ADR 0040', 'native child agents of its own session, ADR 0023')) }, ['s6'], 'row')
})

test('control: a README § Runtime support back on native children fails s6', () => {
  only(swapIn(README, /^## Runtime support/, /^## (?!Runtime)/, 'orient spawns no child agents', 'orient spawns native child agents'),
    ['s6'], 'runtime')
})

test('control: execution-fit.md naming native batches fails s6', () => {
  only(swap(FIT, 'a task\'s `## Launch` block via `open`', 'a task\'s `## Launch` block via `open`, or orient\'s native batches'), ['s6'], 'fit')
})
