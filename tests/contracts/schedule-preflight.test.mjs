// Schedule runs a Pre-flight (ADR 0047, p29-5): skills/schedule/SKILL.md § 1.5 grades every task still to start and
// settles the decisions it hides with Lachy in one round, before anything writes a rollout note, and runs no plan gate.
// Its script half is tests/estate-dispatch.test.mjs (D17-D21), tests/estate-rank.test.mjs (R6),
// tests/estate-scan.test.mjs (18) and tests/engine-snapshot.test.sh (G4); this file pins the prose. Twelve rules:
//   p1  § 1.5 sits between steps 1 and 2 and names its commands: estate-scan.py with --deadline 0, `slices --tasks
//       <graded set>` with `--superseding <prior>`, estate-rank.py rank, readiness-grade.md § The grading agents,
//       `estate-dispatch.py preflight` and `record ... --by schedule`.
//   p2  the sets: a carried task that has started is kept (never graded) and passed as --kept; a carried task still
//       queued is graded; every preflight call passes the same --rank, --scan, --tasks (every candidate) and --kept.
//   p3  the round: no question for a Ready, Orient or kept task, nor for a task already out through an Orient
//       dependency; one question per call, its recommendation first; each One call's and Grill's answer recorded
//       before step 6; a One call or Grill whose record refuses stays undecided; the ungraded question recommends
//       `Leave it out`, and its answer is never recorded (`Leave it out` decides nothing; the next schedule asks
//       again), as ADR 0047 § Build rulings says too.
//   p4  what leaves: Orient tasks with their Dependent closure; a task left out unstamped, or, carried and queued,
//       through step 6's `reconcile-rollout.py defer`; step 8's left-out block points an Orient one at /thread:orient.
//   p5  under orient-all: no grading agent, no round, no log; --tasks is step 1's candidates and --decided
//       the prompt line's slugs among them, and the fork writes its queue's ruled calls (`decided-for-you`, ADR 0054); orient-all § 6 answers it in item 16 and its prompt carries the line (the
//       decided slugs among entry.members); orient-all § 8 lists each leaver by its why (waiting on your answer, its
//       /thread:orient pointer, depends on [[<via>]]); no § 1.5 or S3.5 line names --regenerate.
//   p6  § 1.5 runs no plan gate (ADR 0030) and names no Workflow and no task.workflow.js.
//   p7  the Grade log: § 1.5's log runs on every run that grades, all but an orient-all fork, and never says
//       "standalone"; CONTEXT.md **Grade log** names schedule's Pre-flight; run_record.py's Grade log paragraph names
//       schedule § 1.5.
//   p8  step 8's report blocks are `Checklist —`: no `Pre-flight —`, "step 8's pre-flight" or "gated pre-flight" is
//       left in schedule, and CONTEXT.md **Pre-flight**'s Avoid clause names `Checklist —`.
//   p9  readiness-grade.md and vault-grammar.md state the exception: a carried task still queued is gradeable at the
//       Pre-flight, and one that has started stays in flight.
//   p10 the serial path: S3.5 sits between S3 and S4, runs step 1.5, and a leaver re-runs S2 and S3; S7 lists the
//       Pre-flight line and its left-out tasks with /thread:orient.
//   p11 the empty queue stops before step 2, keeps the `## Decisions` bullets and the Grade log lines, and names
//       § 0's **Put back**.
//   p12 cross-version (ADR 0043; ADR 0047 § Build rulings): every span that runs a prior-root verb in schedule uses
//       only the flags every snapshot a live prior can name has (carry --from/--to/--dry-run, defer --tasks/--rollout,
//       resume --rollout, the canary's check-all and retire --rollout, close-score --rollout/--close), each verb seen
//       with flags at least once; § 0's *The prior's root* says "ten commands" and names `defer`; step 6's defer runs
//       from "the same prior's root" "before the carry".
// One pure function, check(files), returns the failing rules; every control mutates one place and fails exactly its
// rule. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, FENCE, readIf, section, slice } from '../lib/contract-text.mjs'

const SCHEDULE = 'skills/schedule/SKILL.md'
const ORIENT_ALL = 'skills/orient-all/SKILL.md'
const CONTEXT = 'CONTEXT.md'
const RUN_RECORD = 'skills/_shared/scripts/run_record.py'
const GRADE = 'skills/_shared/readiness-grade.md'
const GRAMMAR = 'skills/_shared/vault-grammar.md'
const ADR = 'docs/adr/0047-schedule-runs-a-pre-flight.md'
const FILES = Object.fromEntries([SCHEDULE, ORIENT_ALL, CONTEXT, RUN_RECORD, GRADE, GRAMMAR, ADR].map((f) => [f, readIf(f)]))

// The flags each prior-root command has had since the first Engine snapshot (ADR 0047 § Build rulings).
const PRIOR_VERBS = [
  { name: 'carry', re: /reconcile-rollout\.py carry\b/, flags: ['--from', '--to', '--dry-run'] },
  { name: 'defer', re: /reconcile-rollout\.py defer\b/, flags: ['--tasks', '--rollout'] },
  { name: 'resume', re: /reconcile-rollout\.py resume\b/, flags: ['--rollout'] },
  { name: 'check-all', re: /git-env-canary\.py check-all\b/, flags: ['--rollout'] },
  { name: 'retire', re: /git-env-canary\.py retire\b/, flags: ['--rollout'] },
  { name: 'close-score', re: /close-score\.py\b/, flags: ['--rollout', '--close'] },
]

const C = (s) => (s == null ? '' : collapse(s))
const sec = (text, re) => section(text ?? '', re) ?? ''
const lineIndex = (text, re) => (text ?? '').split('\n').findIndex((l) => re.test(l))
// Every command span: each inline code span outside a fence, and each fenced line whole.
function spans(text) {
  const out = []
  let fence = false
  for (const l of (text ?? '').split('\n')) {
    if (FENCE.test(l)) { fence = !fence; continue }
    if (fence) out.push(l)
    else for (const m of l.matchAll(/`([^`]+)`/g)) out.push(m[1])
  }
  return out
}

// { fails: sorted rule names, details }; fails [] means every rule holds.
function check(files) {
  const fails = new Set()
  const details = []
  const flag = (rule, why) => { fails.add(rule); details.push(`${rule}: ${why}`) }
  const need = (rule, name, text, patterns) => {
    if (!text) return flag(rule, `${name} is missing`)
    for (const p of patterns) {
      const hit = typeof p === 'string' ? text.includes(p) : p.test(text)
      if (!hit) flag(rule, `${name} does not contain ${p}`)
    }
  }
  const never = (rule, name, text, patterns) => {
    for (const p of patterns) {
      const hit = typeof p === 'string' ? (text ?? '').includes(p) : p.test(text ?? '')
      if (hit) flag(rule, `${name} contains ${p}`)
    }
  }
  const sch = files[SCHEDULE] ?? ''
  const pfRaw = sec(sch, /^### 1\.5\. Pre-flight/)
  const pf = C(pfRaw)
  const para = (label) => C(pfRaw.split(/\n\s*\n/).find((p) => p.startsWith(label)) ?? '')
  const round = para('**The round.**')
  const record = para('**Record each answer at once**')
  const final = para('**The final call.**')
  const empty = para('**An empty queue.**')
  const form = para('**The orient-all form.**')
  const s0 = C(sec(sch, /^### 0\. /))
  const s6 = C(sec(sch, /^### 6\. /))
  const s8 = C(sec(sch, /^### 8\. /))
  const serialRaw = sec(sch, /^## Serial path$/)
  const serial = C(serialRaw)
  const s35 = C(serialRaw.split(/\n\s*\n/).find((p) => p.startsWith('**S3.5. Pre-flight.**')) ?? '')
  const s7 = C(serialRaw.split(/\n\s*\n/).find((p) => p.startsWith('**S7. Summary.**')) ?? '')

  // p1: where it sits, and its commands.
  const i1 = lineIndex(sch, /^### 1\. /)
  const i15 = lineIndex(sch, /^### 1\.5\. Pre-flight \(ADR 0047\)$/)
  const i2 = lineIndex(sch, /^### 2\. /)
  if (i1 < 0 || i15 < 0 || i2 < 0 || !(i1 < i15 && i15 < i2)) flag('p1', `§ 1.5 is not between steps 1 and 2 (${i1}, ${i15}, ${i2})`)
  need('p1', '§ 1.5', pf, ['estate-scan.py --deadline 0', 'estate-dispatch.py slices', '--tasks <graded set>',
    '[--superseding <prior>]', 'estate-rank.py rank', 'readiness-grade.md` § The grading agents', 'estate-dispatch.py preflight',
    'estate-dispatch.py record', '--by schedule'])

  // p2: the sets, and the same four flags on every preflight call.
  need('p2', '§ 1.5', pf, ['line whose state is not `queued`', 'a carried task still queued is graded like any other',
    '--tasks <every candidate> [--kept <each kept slug>]',
    'Every later `preflight` call in this run passes the same `--rank`, `--scan`, `--tasks` and `--kept`'])

  // p3: the round and the records.
  need('p3', '§ 1.5 **The round.**', round, ['one question per call', 'its recommendation first',
    'A Ready, Orient or kept task gets no question',
    'a task already out through an Orient dependency (directly or through others) is never asked'])
  need('p3', '§ 1.5 **Record each answer at once**', record, ["a One call's or a Grill's, before step 6 writes anything",
    'A One call or Grill whose `record` refuses stays undecided', "An ungraded task's answer is never recorded",
    '`Leave it out` (recommended) decides nothing, so the next schedule asks again'])
  const adrRulings = C(sec(files[ADR], /^## Build rulings$/))
  need('p3', 'ADR 0047 § Build rulings', adrRulings, ['**A task already out through an Orient dependency is never asked.**',
    'is asked `Leave it out` (recommended) or `Queue it as it stands`', 'The answer governs this run alone and is never recorded'])
  never('p3', 'ADR 0047 § Build rulings', adrRulings, ['the answer is recorded through `record --by schedule`'])

  // p4: what leaves, and how.
  need('p4', '§ 1.5', pf, ['Orient tasks stay out with their Dependent closure'])
  need('p4', '§ 1.5 **The final call.**', final, ['leaves now: no `rollout:` stamp, no `## Queue` row, no `## File-sets` line',
    "A carried `queued` task in `out[]` leaves through step 6's `defer`"])
  need('p4', 'step 6', s6, ['reconcile-rollout.py defer --tasks'])
  const left = C(slice(sec(sch, /^### 8\. /), /^\*\*Pre-flight's left-out tasks\.\*\*/, /^\*\*Checklist — /) ?? '')
  need('p4', "step 8's **Pre-flight's left-out tasks.**", left, ['/thread:orient [[<home>]]', 'depends on [[x]]',
    'waiting on your answer', 'deferred out of it at step 6'])

  // p5: under orient-all.
  need('p5', '§ 1.5 **The orient-all form.**', form, ['no grading agent', 'no round', 'no `log`',
    '--tasks <step 1\'s candidates>', 'among them', 'Pre-flight: rank <R>, scan <S>, decided <slugs or none>',
    'estate-dispatch.py decided-for-you --rank <R> --tasks <its queue[]> --by orient-all --write'])
  const oa = files[ORIENT_ALL] ?? ''
  const answers = slice(sec(oa, /^### 6\. /), /^3\. \*\*Schedule's questions, answered\.\*\*/, /^4\. /) ?? ''
  const item16 = C(slice(answers, /^ {3}16\. /, /^ {3}\d+\. /) ?? '')
  need('p5', 'orient-all § 6 answer 16', item16, ["schedule's Pre-flight", 'no grading agent, no round and no Grade log line',
    'among them'])
  need('p5', 'orient-all § 6', C(sec(oa, /^### 6\. /)), ['Pre-flight: rank $S/rank.json, scan $S/scan.json',
    'among entry.members'])
  need('p5', 'orient-all § 8', C(sec(oa, /^### 8\. /)), ['waiting on your answer', 'listed by the `why` the fork returns',
    '`/thread:orient [[<home>]]`', 'depends on [[<via>]]'])
  for (const [name, text] of [['§ 1.5', pfRaw], ['S3.5', s35]]) never('p5', name, text, ['--regenerate'])

  // p6: no plan gate.
  need('p6', '§ 1.5', pf, ['runs no plan gate', 'ADR 0030'])
  never('p6', '§ 1.5', pf, ['Workflow', 'task.workflow.js'])

  // p7: the Grade log.
  need('p7', '§ 1.5', pf, ['On every run that grades, all but an orient-all fork,'])
  never('p7', '§ 1.5', pf, [/standalone/i])
  const context = files[CONTEXT] ?? ''
  need('p7', 'CONTEXT.md **Grade log**', C(slice(context, /^- \*\*Grade log\*\*/, /^(- \*\*|#)/)), ['schedule Pre-flight',
    '`estate-dispatch.py log`'])
  const rr = C((files[RUN_RECORD] ?? '').split(/\n\s*\n/).find((p) => p.startsWith('grades.jsonl holds the Grade log')) ?? '')
  need('p7', 'run_record.py Grade log paragraph', rr, ['schedule § 1.5'])

  // p8: Checklist.
  never('p8', SCHEDULE, sch, ['Pre-flight —', "step 8's pre-flight", 'gated pre-flight'])
  need('p8', SCHEDULE, sch, ['**Checklist — gated tasks.**', '⚠️ Checklist — '])
  need('p8', 'CONTEXT.md **Pre-flight**', C(slice(context, /^- \*\*Pre-flight\*\*/, /^(- \*\*|#)/)), ['"Checklist —"'])

  // p9: the exception, stated where the grading and the grammar live.
  const gradeable = C(sec(files[GRADE], /^## Gradeable tasks$/))
  need('p9', 'readiness-grade.md § Gradeable tasks', gradeable, ["At schedule's Pre-flight on a supersede, a carried task still queued",
    '(`--superseding`, ADR 0047)', 'one that has started stays `in flight`'])
  const inFlight = C(sec(files[GRAMMAR], /^## In flight$/))
  need('p9', 'vault-grammar.md § In flight', inFlight, ['a carried task still queued', 'one that has started stays in flight',
    '`still_to_start`'])

  // p10: the serial path.
  const iS3 = serialRaw.indexOf('**S3. Live chains.**')
  const iS35 = serialRaw.indexOf('**S3.5. Pre-flight.**')
  const iS4 = serialRaw.indexOf('**S4. Gates.**')
  if (iS3 < 0 || iS35 < 0 || iS4 < 0 || !(iS3 < iS35 && iS35 < iS4)) flag('p10', `S3.5 is not between S3 and S4 (${iS3}, ${iS35}, ${iS4})`)
  need('p10', 'S3.5', s35, ['runs step 1.5', 're-runs S2 and S3', "§ 1.5's orient-all form"])
  need('p10', 'S7', s7, ['the Pre-flight line and its left-out tasks', '/thread:orient [[<project>]]'])
  if (!serial) flag('p10', '§ Serial path is missing')

  // p11: the empty queue.
  need('p11', '§ 1.5 **An empty queue.**', empty, ['stop before step 2', '`## Decisions (asked ahead <date>)` bullets',
    'the Grade log lines `log` wrote', "§ 0's **Put back**"])

  // p12: cross-version.
  const seen = Object.fromEntries(PRIOR_VERBS.map((v) => [v.name, 0]))
  for (const sp of spans(sch)) {
    for (const v of PRIOR_VERBS) {
      const m = sp.match(v.re)
      if (!m) continue
      const rest = sp.slice(m.index + m[0].length)
      const flags = [...rest.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)].map((x) => x[0])
      if (flags.length) seen[v.name]++
      for (const f of flags) if (!v.flags.includes(f)) flag('p12', `${v.name} runs with ${f}, which a prior's snapshot may lack: ${sp}`)
    }
  }
  for (const v of PRIOR_VERBS) if (!seen[v.name]) flag('p12', `no span runs ${v.name} with its flags`)
  const root = C(sch.split(/\n\s*\n/).find((p) => p.startsWith("**The prior's root (ADR 0043).**")) ?? '')
  need('p12', "§ 0's *The prior's root*", root, ['the ten commands that name it', "step 6's `check-all`, `defer`",
    'ADR 0047 § Build rulings'])
  const deferAt = s6.indexOf('reconcile-rollout.py defer --tasks')
  const deferSentence = deferAt < 0 ? '' : s6.slice(s6.lastIndexOf('. ', deferAt), s6.indexOf('`', s6.indexOf('`', deferAt) + 1))
  need('p12', "step 6's defer sentence", deferSentence, ["the same prior's root", 'before the carry'])
  if (!s0) flag('p12', '§ 0 is missing')

  return { fails: [...fails].sort(), details }
}

// Mutate one place: `from` must be present (inside `within`'s section when given), so a control never passes vacuously.
function swap(files, rel, from, to, within) {
  const text = files[rel] ?? ''
  if (!within) {
    assert.ok(text.includes(from), `${rel} no longer holds ${JSON.stringify(from)}: update this control`)
    return { ...files, [rel]: text.replace(from, to) }
  }
  const s = section(text, within)
  assert.ok(s?.includes(from), `${rel} ${within} no longer holds ${JSON.stringify(from)}: update this control`)
  return { ...files, [rel]: text.replace(s, s.replace(from, to)) }
}
const only = (files, rules, what) => {
  const r = check(files)
  assert.deepEqual(r.fails, rules, `${what}: ${r.details.join('\n')}`)
}
const PF = /^### 1\.5\. Pre-flight/
const S6 = /^### 6\. /

test('schedule runs a Pre-flight, and orient-all, the grammar, the brief and the glossary agree (p1-p12)', () => {
  const r = check(FILES)
  assert.deepEqual(r.fails, [], r.details.join('\n'))
})

test('control p1: § 1.5 without the ranker fails p1 alone', () => {
  only(swap(FILES, SCHEDULE, 'estate-rank.py rank --scan', 'estate-rank.py --scan', PF), ['p1'], 'ranker')
})

test('control p2: a started carried task graded fails p2 alone', () => {
  only(swap(FILES, SCHEDULE, 'line whose state is not `queued`', 'line, whatever its state', PF), ['p2'], 'kept')
})

test('control p3: a batched round, an asked closure task or a recorded ungraded answer fails p3 alone', () => {
  only(swap(FILES, SCHEDULE, 'one question per call', 'up to four questions per call', PF), ['p3'], 'batched')
  only(swap(FILES, SCHEDULE, 'is never asked, whatever its grade', 'is asked like any other', PF), ['p3'], 'closure asked')
  only(swap(FILES, SCHEDULE, "An ungraded task's answer is never recorded", "An ungraded task's answer is recorded", PF), ['p3'],
    'ungraded recorded')
  only(swap(FILES, ADR, 'The answer governs this run alone and is never recorded', 'the answer is recorded through `record --by schedule`'),
    ['p3'], 'ADR records it')
})

test('control p4: a left-out Orient task with no pointer to its orient fails p4 alone', () => {
  only(swap(FILES, SCHEDULE, '/thread:orient [[<home>]]', 'orient it later', /^### 8\. /), ['p4'], 'pointer')
})

test('control p5: the orient-all form passing every decided slug fails p5 alone', () => {
  only(swap(FILES, SCHEDULE, ' that is among them', '', PF), ['p5'], 'among them')
})

test('control p5: orient-all § 8 listing every leaver as waiting on your answer fails p5 alone', () => {
  only(swap(FILES, ORIENT_ALL, '`dependency` as "depends on [[<via>]], which is left out"; ', '', /^### 8\. /), ['p5'], 'dependency why')
})

test('control p6: a plan gate at schedule fails p6 alone', () => {
  only(swap(FILES, SCHEDULE, 'runs no plan gate', 'runs the plan gate through `task.workflow.js`', PF), ['p6'], 'plan gate')
})

test('control p7: the Grade log on a standalone run only fails p7 alone', () => {
  only(swap(FILES, SCHEDULE, 'On every run that grades, all but an orient-all fork,', 'On a standalone run only,', PF), ['p7'], 'standalone')
})

test('control p8: a report block named Pre-flight again fails p8 alone', () => {
  only(swap(FILES, SCHEDULE, '**Checklist — ladder refused.**', '**Pre-flight — ladder refused.**'), ['p8'], 'renamed back')
})

test('control p9: the brief without the exception fails p9 alone', () => {
  only(swap(FILES, GRADE, "At schedule's Pre-flight on a supersede, a carried task still queued", 'A carried task'), ['p9'], 'brief')
})

test('control p10: S7 without the Pre-flight line fails p10 alone', () => {
  only(swap(FILES, SCHEDULE, 'the Pre-flight line and its left-out tasks', 'the queue'), ['p10'], 'S7')
})

test('control p11: an empty queue that drops the Grade log lines fails p11 alone', () => {
  only(swap(FILES, SCHEDULE, 'the Grade log lines `log` wrote', 'nothing else', PF), ['p11'], 'grade log')
})

test('control p12: a new flag on the prior\'s carry, nine commands, or the defer after the carry fails p12 alone', () => {
  only(swap(FILES, SCHEDULE, '--to ~/repos/obsidian/Work/Tasks/<this-slug>.md', '--to ~/repos/obsidian/Work/Tasks/<this-slug>.md --leave <slug>', S6),
    ['p12'], 'new flag')
  only(swap(FILES, SCHEDULE, 'the ten commands that name it', 'the nine commands that name it'), ['p12'], 'nine')
  only(swap(FILES, SCHEDULE, 'before the carry, `python3', 'after the carry, `python3', S6), ['p12'], 'after the carry')
})
