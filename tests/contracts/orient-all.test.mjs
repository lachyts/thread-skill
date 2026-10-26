// The estate pass's lead (p25-3; ADR 0041): skills/orient-all/SKILL.md runs estate-scan.py, the grading and status
// agents, estate-rank.py and estate-dispatch.py, asks the decision round, forks the schedules and starts the sessions.
// Its script half is tests/estate-dispatch.test.mjs; this file pins the prose to the scripts, to the siblings it cites,
// and to the docs that name it. Eleven rules:
//   o1  the headings, in order, and none of the retired or forbidden words.
//   o2  § 2 runs estate-scan.py, `estate-dispatch.py slices` and `estate-rank.py rank`, cites readiness-grade.md
//       § The grading agents, and briefs the status agents to run /thread:status and return the number of the status
//       § 4 Recommended action rule that matched; no ranking rule is restated.
//   o3  § 1's budget options; § 3 runs `rounds --budget` and ends with each asked sign-off's gateText and bounce
//       verbatim; § 4 passes `asks` verbatim, prints a later sign-off's gates again before its call, maps a label to
//       its full text through texts[], and cites repair § 3's "presented verbatim"; § 5 is in conversation, "stop"
//       ends it, and record folds line breaks.
//   o4  §§ 4-5 record through estate-dispatch.py, each call spelled out from its decision (§ 4's from
//       `rounds.oneCalls[]`, the bare question): --question <decision.question>, --recommended
//       <decision.options[0]> and [--fork <decision.fork>], `--fork` exactly when the decision carries one; and
//       DECISIONS_HEADING and RULING_LINE are schedule step 7's heading and orient § 5's ruling line (a python child
//       loads them).
//   o5  § 4's Unpark and sign-off writes: estate-rank.py unpark, snooze --ready and kill, and approve-gates --tasks,
//       run from the task's rollout's engine root (`engine-snapshot.py resolve`, ADR 0043), never this session's.
//   o6  § 6 runs `plan`, forks `/thread:schedule <entry.args>` with the projectSlug line, one batch at a time, and
//       answers schedule's questions in exactly 15 items, § 0's clone question (ADR 0042) with the No, since no fork
//       holds Lachy's yes; schedule's **Under orient-all.** paragraph cites orient-all § 6 and routes nothing, S1 and S4
//       name orient-all, and nothing pairs orient-all with --regenerate.
//   o7  § 7 runs `sessions` with --wrote and --status and starts exactly items[]; its table's numbers; the Session
//       tools in order, state from the list only, identity-only reads; orient and repair candidates by the item's
//       exact `title` alone (sessions cuts it); row 8 needs plan.reinstate[] and canExecute; create_thread, the
//       paste-ready prompts, orients last with the note line; its cites; and `start: unattended` only in the Don't.
//   o8  § 9 asks nothing, writes only under $S, runs `plan --rounds --assume-answered` and `sessions` with no --wrote,
//       runs no `estate-dispatch.py log`, and names every command it never runs.
//   o9  plugin-root.md, CONTEXT.md (**Decision round**, **Dispatch plan**), ADR 0041's p25-3 ruling and the README
//       row name the skill.
//   o10 status parity: estate-dispatch.py's STATUS_ACTIONS opens each of status § 4's thirteen numbered
//       **Recommended action** rules, the set that starts something is exactly {6, 7, 8, 11, 13}, and § 7's table
//       names the same numbers.
//   o11 the Grade log (p25-4): § 2 step 7 runs `estate-dispatch.py log --rank` with `--scan`, guarded "Unless this is a
//       dry run"; § 9 runs §§ 2–3 without that step and names the verb among the commands it never runs; the Scope
//       lists it among the writes; and CONTEXT.md § Run record and tuning has **Grade log**, naming the writer.
// One pure function, check(files, consts), returns the failing rules; every control mutates one place and fails exactly
// its rule. Reads files only (the python child imports estate-dispatch.py, which runs nothing at import).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { collapse, readIf, root, section, slice, FENCE } from '../lib/contract-text.mjs'

const SKILL = 'skills/orient-all/SKILL.md'
const SCHEDULE = 'skills/schedule/SKILL.md'
const STATUS = 'skills/status/SKILL.md'
const ORIENT = 'skills/orient/SKILL.md'
const PLUGIN_ROOT = 'skills/_shared/plugin-root.md'
const CONTEXT = 'CONTEXT.md'
const ADR = 'docs/adr/0041-orient-all-runs-the-estate-pass.md'
const README = 'README.md'
const SCRIPT = 'skills/_shared/scripts/estate-dispatch.py'

const HEADINGS = ['## Scope', '## Invocation forms', '## Process', '### 1. The budget', '### 2. Scan, status and grade',
  '### 3. The Ranked slate', '### 4. The One-call round', '### 5. Grill rounds', '### 6. Schedule', '### 7. Start',
  '### 8. Report', '### 9. Dry run', "## Don't"]
// Words the skill must not use, built from parts where the word itself is pinned elsewhere in tests/ (queue-only,
// rung-vocabulary and execution-fit-shapes count every hit).
const FORBIDDEN = [new RegExp(['wa', 've'].join(''), 'i'), new RegExp(['rollout', '-?\\s*', 'shaped'].join(''), 'i'),
  new RegExp(['max', 'tier'].join('_')), /\$\{?\d/, /native child/, /done, merged/]
const STARTS = [6, 7, 8, 11, 13]

const PY = `
import importlib.util, json, sys
sys.dont_write_bytecode = True
s = importlib.util.spec_from_file_location("thread_estate_dispatch", sys.argv[1])
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)
print(json.dumps({"STATUS_ACTIONS": {str(k): list(v) for k, v in m.STATUS_ACTIONS.items()},
                  "DECISIONS_HEADING": m.DECISIONS_HEADING, "RULING_LINE": m.RULING_LINE, "LABEL_MAX": m.LABEL_MAX}))
`
function constants() {
  const r = spawnSync('python3', ['-c', PY, path.join(root, SCRIPT)], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

const C = (s) => (s == null ? '' : collapse(s))
const sec = (text, re) => section(text ?? '', re) ?? ''
// The `##`/`###` headings outside fences.
function headings(text) {
  const out = []
  let fence = false
  for (const l of (text ?? '').split('\n')) {
    if (FENCE.test(l)) { fence = !fence; continue }
    if (!fence && /^#{2,3} /.test(l)) out.push(l.trim())
  }
  return out
}
// status § 4's **Recommended action** rules: { n: text } from the numbered items after the label.
function statusRules(text) {
  const s4 = slice(sec(text, /^### 4\. Render the situational report/), /^\*\*Recommended action\*\*/, /^\*\*A refused ladder\.\*\*/) ?? ''
  const out = {}
  for (const l of s4.split('\n')) {
    const m = l.match(/^(\d+)\. (.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}
// § 7's allow-list table: [{ nums, item }] from each body row's first two cells.
function tableRows(s7) {
  return s7.split('\n').filter((l) => /^\s*\| *\d/.test(l)).map((l) => {
    const cells = l.split('|').slice(1, -1).map((c) => c.trim())
    const nums = []
    for (const part of cells[0].split(',')) {
      const r = part.trim().match(/^(\d+)(?:–(\d+))?/)
      if (!r) continue
      const a = Number(r[1])
      const b = r[2] ? Number(r[2]) : a
      for (let n = a; n <= b; n++) nums.push(n)
    }
    return { nums, item: cells[1] ?? '' }
  })
}

// { fails: sorted rule names, details }; fails [] means every rule holds.
function check(files, consts) {
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
  const skill = files[SKILL] ?? ''
  const all = C(skill)
  const S = (re) => C(sec(skill, re))
  const s1 = S(/^### 1\. /)
  const s2 = S(/^### 2\. /)
  const s3 = S(/^### 3\. /)
  const s4 = S(/^### 4\. /)
  const s5 = S(/^### 5\. /)
  const s6raw = sec(skill, /^### 6\. /)
  const s6 = C(s6raw)
  const s7raw = sec(skill, /^### 7\. /)
  const s7 = C(s7raw)
  const s9 = S(/^### 9\. /)
  const dont = S(/^## Don't/)

  // o1: the headings, and the words.
  const heads = headings(skill)
  if (JSON.stringify(heads) !== JSON.stringify(HEADINGS)) flag('o1', `headings are ${JSON.stringify(heads)}`)
  for (const re of FORBIDDEN) if (re.test(skill)) flag('o1', `${SKILL} holds ${re}`)

  // o2: § 2.
  need('o2', '§ 2', s2, ['estate-scan.py', 'estate-dispatch.py slices', 'estate-rank.py rank',
    'readiness-grade.md` § The grading agents', '/thread:status', 'the number (1–13) of the status § 4 **Recommended action** rule'])
  if (/Parked homes last/.test(all)) flag('o2', 'the skill restates the ranking key')

  // o3: the budget, the slate's sign-offs, the round, the grills.
  need('o3', '§ 1', s1, ['`15 minutes`', '`30 minutes (Recommended)`', '`60 minutes`', '`No decisions now`'])
  need('o3', '§ 3', s3, ['estate-dispatch.py rounds', '--budget <N>', 'its `gateText` verbatim', 'its `bounce` verbatim',
    "immediately before § 4's first call"])
  need('o3', '§ 4', s4, ['`rounds.asks[i]` to AskUserQuestion\'s `questions` verbatim',
    /a sign-off whose `gateText` was not printed since the last call, print it \(and its bounce\) again/,
    'no sign-off is ever asked unseen', '`texts[]`', 'a gate is presented verbatim, repair § 3', 'Sign-offs are always asked'])
  need('o3', '§ 5', s5, ['in conversation', 'Lachy\'s "stop" ends the rounds', '`record` folds their line breaks'])

  // o4: the decision write, spelled out from the decision, and pinned to schedule step 7 and orient § 5.
  const RECORD = ['estate-dispatch.py record', '--question <decision.question>', '--recommended <decision.options[0]>',
    '[--fork <decision.fork>]', '`--fork` exactly when the decision carries one']
  need('o4', '§ 4', s4, [...RECORD, '`rounds.oneCalls[]`', '`decision.question` is the bare question'])
  need('o4', '§ 5', s5, [...RECORD, '--answer <his words>'])
  const heading = (consts.DECISIONS_HEADING ?? '').replace('{date}', '<YYYY-MM-DD>')
  const ruling = (consts.RULING_LINE ?? '').replace('{stamp}', '<UTC ISO>').replace('{fork}', '<fork>').replace('{answer}', '<ruling>')
  if (!heading || !sec(files[SCHEDULE], /^### 7\. Update each task's frontmatter/).includes(`\n${heading}\n`)) {
    flag('o4', `schedule step 7 does not hold DECISIONS_HEADING ${heading}`)
  }
  if (!ruling || !C(sec(files[ORIENT], /^### 5\. Reshuffle/)).includes(`\`${ruling}\``)) flag('o4', `orient § 5 does not hold RULING_LINE ${ruling}`)

  // o5: the Unpark and sign-off writes.
  need('o5', '§ 4', s4, ['estate-rank.py unpark <note>', 'estate-rank.py snooze <note> --ready', 'estate-rank.py kill <note>',
    'reconcile-rollout.py approve-gates --tasks <slug>', "engine-snapshot.py resolve --rollout <the index entry's rollout>",
    '`python3 <root>/skills/execute/scripts/reconcile-rollout.py approve-gates --tasks <slug> --rollout <rollout-note>`'])

  // o6: the schedule forks and their answers.
  need('o6', '§ 6', s6, ['estate-dispatch.py plan', '/thread:schedule <entry.args>', 'name the note with slug <entry.projectSlug>',
    'never two batches at once'])
  const answers = slice(s6raw, /^3\. \*\*Schedule's questions, answered\.\*\*/, /^4\. /) ?? ''
  const items = answers.split('\n').filter((l) => /^ {3}\d+\. /.test(l)).map((l) => Number(l.trim().split('.')[0]))
  if (JSON.stringify(items) !== JSON.stringify(Array.from({ length: 15 }, (_, i) => i + 1))) flag('o6', `the answers are numbered ${JSON.stringify(items)}`)
  need('o6', "§ 6's answers", C(answers), ['routes nothing', '`none`', 'Advance', 'kebab', '`projectSlug`', '`plan_approval: required`',
    "§ 0's clone question (exit 4)", 'the fork takes the No'])
  const schedule = files[SCHEDULE] ?? ''
  const under = C(schedule.split(/\n\s*\n/).find((p) => p.startsWith('**Under orient-all.**')) ?? '')
  need('o6', "schedule's **Under orient-all.**", under, ['orient-all § 6', 'routes nothing', 'the slug its prompt gives'])
  if ((C(schedule).match(/under orient § 7 or orient-all § 6/gi) ?? []).length !== 2) flag('o6', 'S1 and S4 do not both name orient-all § 6')
  for (const t of [skill, schedule]) {
    for (const l of t.split('\n')) {
      if (l.includes('--regenerate') && /orient-all/.test(l)) flag('o6', `a line pairs orient-all with --regenerate: ${l.trim()}`)
    }
  }
  if (skill.split('\n').some((l) => l.includes('--regenerate') && !dont.includes(C(l).trim()))) flag('o6', '--regenerate outside the Don\'t')

  // o7: the sessions.
  need('o7', '§ 7', s7, ['estate-dispatch.py sessions', '--wrote', '--status', 'Start exactly `items[]`, never another',
    'never from a read', 'asking only whether it is that rollout\'s lead or Leg',
    "An orient item's only candidates are Sessions named exactly the item's `title`",
    "a repair item's only Sessions named exactly its `title`", 'the name `create_thread` was given',
    'No other Session ever holds an orient or repair item', '`create_thread`', 'paste-ready prompt', 'then orient last',
    'Child orients start after every execute', "the orient prompt's second line names the note",
    '`skills/execute/legs.md` § Hand over', 'handoff § Success contract'])
  const order = ['list_sessions', 'read_session', 'relay_session'].map((t) => s7.indexOf(`\`${t}\``))
  if (order.some((i) => i < 0) || !(order[0] < order[1] && order[1] < order[2])) flag('o7', `the Session tools are out of order: ${order}`)
  need('o7', 'the skill', all, ['whatever the budget'])
  const rows = tableRows(s7raw)
  const starts = rows.filter((r) => !/^nothing/.test(r.item)).flatMap((r) => r.nums).sort((a, b) => a - b)
  const nothing = rows.filter((r) => /^nothing/.test(r.item)).flatMap((r) => r.nums).sort((a, b) => a - b)
  if (JSON.stringify(starts) !== JSON.stringify(STARTS)) flag('o7', `§ 7's table starts on ${JSON.stringify(starts)}`)
  if (JSON.stringify(nothing) !== JSON.stringify([1, 2, 3, 4, 5, 9, 10, 12])) flag('o7', `§ 7's nothing row is ${JSON.stringify(nothing)}`)
  const row8 = rows.find((r) => r.nums.includes(8))?.item ?? ''
  if (!/plan\.reinstate\[\]/.test(row8) || !row8.includes('`canExecute`')) flag('o7', 'row 8 does not name plan.reinstate[] and `canExecute`')
  const stamps = skill.split('\n').filter((l) => l.includes('start: unattended'))
  if (stamps.length !== 1 || !dont.includes(C(stamps[0]).replace(/^- /, '').trim())) flag('o7', '`start: unattended` outside the Don\'t')

  // o8: the dry run.
  need('o8', '§ 9', s9, ['It asks nothing', 'writes only under `$S`', '--rank "$S/rank.json"', '--scan "$S/scan.json"',
    '--rounds "$S/rounds.json" --assume-answered', 'estate-dispatch.py sessions', 'with no `--wrote`'])
  const never = s9.slice(s9.indexOf('It never runs'))
  need('o8', '§ 9 never-runs', never, ['`record`', '`approve-gates`', '`estate-rank.py snooze`', '`unpark`', '`kill`',
    'schedule fork', '`list_sessions`', '`read_session`', '`relay_session`', '`create_thread`'])
  const dryCmds = s9.slice(0, s9.indexOf('It never runs'))
  if (/--wrote </.test(dryCmds)) flag('o8', 'the dry run passes --wrote')
  if (/estate-dispatch\.py log\b/.test(dryCmds)) flag('o8', 'the dry run logs the grades')

  // o9: the docs that name the skill.
  need('o9', PLUGIN_ROOT, C(files[PLUGIN_ROOT]), ['orient-all → schedule (its forks), status, execute, repair or orient',
    '`readiness-grade.md` (orient-all)'])
  const context = files[CONTEXT] ?? ''
  for (const term of ['Decision round', 'Dispatch plan']) {
    need('o9', `CONTEXT.md **${term}**`, C(slice(context, new RegExp(`^- \\*\\*${term}\\*\\*`), /^(- \*\*|#)/)), ['estate pass'])
  }
  need('o9', `${ADR} § Build rulings`, C(section(files[ADR], /^## Build rulings$/)), ['How the pass asks and starts work',
    '`skills/orient-all/SKILL.md` is canonical', "status's actions 6, 7, 8"])
  if (!(files[README] ?? '').split('\n').some((l) => l.startsWith('| `/thread:orient-all` |'))) flag('o9', 'README has no /thread:orient-all row')

  // o10: status parity.
  const rules = statusRules(files[STATUS])
  const actions = consts.STATUS_ACTIONS ?? {}
  if (Object.keys(rules).length !== 13) flag('o10', `status § 4 has ${Object.keys(rules).length} numbered rules, not 13`)
  for (let n = 1; n <= 13; n++) {
    const a = actions[String(n)]
    if (!a) { flag('o10', `STATUS_ACTIONS has no ${n}`); continue }
    if (!(rules[String(n)] ?? '').startsWith(a[1])) flag('o10', `rule ${n} does not open "${a[1]}": ${rules[String(n)]}`)
  }
  const started = Object.entries(actions).filter(([, a]) => a[0]).map(([n]) => Number(n)).sort((a, b) => a - b)
  if (JSON.stringify(started) !== JSON.stringify(STARTS)) flag('o10', `the started set is ${JSON.stringify(started)}`)
  if (JSON.stringify(starts) !== JSON.stringify(started)) flag('o10', `§ 7's table ${JSON.stringify(starts)} ≠ STATUS_ACTIONS ${JSON.stringify(started)}`)

  // o11: the Grade log.
  if (!/Unless this is a dry run, `[^`]*estate-dispatch\.py log --rank "\$S\/rank\.json" --scan "\$S\/scan\.json"`/.test(s2)) {
    flag('o11', '§ 2 does not run `estate-dispatch.py log --rank ... --scan ...` guarded "Unless this is a dry run"')
  }
  need('o11', '§ 9', s9, ['Runs §§ 2–3 (not § 2 step 7)'])
  need('o11', '§ 9 never-runs', never, ['`estate-dispatch.py log`'])
  need('o11', 'the Scope', S(/^## Scope/), ['`estate-dispatch.py log`, the grades into the Grade log (never on a dry run)'])
  const runRecord = section(context, /^## Run record and tuning$/) ?? ''
  need('o11', 'CONTEXT.md **Grade log**', C(slice(runRecord, /^- \*\*Grade log\*\*/, /^(- \*\*|#)/)), ['`grades.jsonl`',
    '`estate-dispatch.py log`'])

  return { fails: [...fails].sort(), details }
}

const FILES = Object.fromEntries([SKILL, SCHEDULE, STATUS, ORIENT, PLUGIN_ROOT, CONTEXT, ADR, README].map((f) => [f, readIf(f)]))
const CONSTS = constants()

// Mutate one place: `from` must be present, so a control never passes vacuously.
function swap(files, rel, from, to) {
  assert.ok(files[rel]?.includes(from), `${rel} no longer holds ${JSON.stringify(from)}: update this control`)
  return { ...files, [rel]: files[rel].replace(from, to) }
}
const only = (files, consts, rules, what) => {
  const r = check(files, consts)
  assert.deepEqual(r.fails, rules, `${what}: ${r.details.join('\n')}`)
}

test('the skill, its scripts, schedule, status and the docs agree (o1-o11)', () => {
  const r = check(FILES, CONSTS)
  assert.deepEqual(r.fails, [], r.details.join('\n'))
})

test('control o1: a renamed heading, or a retired word, fails o1 alone', () => {
  only(swap(FILES, SKILL, '### 9. Dry run', '### 9. Rehearsal'), CONSTS, ['o1'], 'heading')
  only(swap(FILES, SKILL, 'It runs no git', 'It runs no git, and spawns no native children'), CONSTS, ['o1'], 'word')
})

test('control o2: a status brief without the rule number, or a restated ranking key, fails o2 alone', () => {
  only(swap(FILES, SKILL, 'the number (1–13) of the status § 4', 'the gist of the status § 4'), CONSTS, ['o2'], 'brief')
  only(swap(FILES, SKILL, '- the warnings, and the ungraded', '- Parked homes last, then\n- the warnings, and the ungraded'), CONSTS, ['o2'], 'key')
})

test('control o3: the gates no longer verbatim in § 3, or the re-print before a later call dropped, fails o3 alone', () => {
  only(swap(FILES, SKILL, '- its `gateText` verbatim:', '- its `gateText`:'), CONSTS, ['o3'], 'verbatim')
  only(swap(FILES, SKILL, 'Before any call that holds\na sign-off whose `gateText` was not printed since the last call, print it (and its bounce) again in that message:\nno sign-off is ever asked unseen',
    'Ask each call'), CONSTS, ['o3'], 're-print')
})

test('control o4: a decision heading that drifts from schedule step 7, a Grill record without its fork, or the index text as the question fails o4 alone', () => {
  only(FILES, { ...CONSTS, DECISIONS_HEADING: '## Decisions ({date})' }, ['o4'], 'heading')
  only(FILES, { ...CONSTS, RULING_LINE: '- {stamp} ruling: {fork} → {answer}' }, ['o4'], 'ruling')
  only(swap(FILES, SKILL, '--answer <his words> --recommended <decision.options[0]> [--fork <decision.fork>]`',
    '--answer <his words> --recommended <decision.options[0]>`'), CONSTS, ['o4'], 'grill fork')
  only(swap(FILES, SKILL, '--question <decision.question> --answer <the full option text', '--question <q> --answer <the full option text'),
    CONSTS, ['o4'], 'one-call question')
})

test('control o5: the kill write gone, or a sign-off run from the session root, fails o5 alone', () => {
  only(swap(FILES, SKILL, 'estate-rank.py kill <note>', 'by hand'), CONSTS, ['o5'], 'kill')
  only(swap(FILES, SKILL, '`python3 <root>/skills/execute/scripts/reconcile-rollout.py approve-gates',
    '`python3 ${CLAUDE_PLUGIN_ROOT}/skills/execute/scripts/reconcile-rollout.py approve-gates'), CONSTS, ['o5'], 'session root')
})

test('control o6: a sixteenth answer, a fork that makes the clone, or schedule routing for orient-all, fails o6 alone', () => {
  only(swap(FILES, SKILL, '   15. Serial S1 and S4', '   15. Nothing else.\n   16. Serial S1 and S4'), CONSTS, ['o6'], 'count')
  only(swap(FILES, SKILL, 'the fork takes the No', 'the fork takes the Yes'), CONSTS, ['o6'], 'clone')
  only(swap(FILES, SCHEDULE, 'It routes nothing: § 0\'s session-lane routing', 'It routes the misfits: § 0\'s session-lane routing'),
    CONSTS, ['o6'], 'schedule')
})

test('control o7: any Session in the project holding an orient, a repair matched on its uncut name, state read from a Session, or a reinstate past a hold fails o7 alone', () => {
  only(swap(FILES, SKILL, "An orient item's only candidates are Sessions named exactly the item's `title`",
    "An orient item's candidates are any Session in the project"), CONSTS, ['o7'], 'orient candidates')
  only(swap(FILES, SKILL, "a repair item's only Sessions named exactly its `title`",
    "a repair item's only Sessions named `Repair: <rollout>`"), CONSTS, ['o7'], 'repair by uncut name')
  only(swap(FILES, SKILL, 'never from a read', 'from a read when unsure'), CONSTS, ['o7'], 'read for state')
  only(swap(FILES, SKILL, ' and `plan` holds nothing else on it (`canExecute`)', ''), CONSTS, ['o7'], 'row 8 canExecute')
})

test('control o8: a dry run that relays, or one that logs the grades, fails o8 alone', () => {
  only(swap(FILES, SKILL, '`read_session`, `relay_session` or\n`create_thread`.', '`read_session` or\n`create_thread`.'), CONSTS, ['o8'], 'relay')
  only(swap(FILES, SKILL, 'with no `--wrote`. It assumes', 'with no `--wrote`, then `estate-dispatch.py log --rank "$S/rank.json"`. It assumes'),
    CONSTS, ['o8'], 'log')
})

test('control o9: CONTEXT.md without **Dispatch plan** fails o9 alone', () => {
  only(swap(FILES, CONTEXT, '- **Dispatch plan**', '- **Launch list**'), CONSTS, ['o9'], 'context')
})

test('control o11: the log run with no dry-run guard, the dry run naming no log, or CONTEXT.md without **Grade log** fails o11 alone', () => {
  only(swap(FILES, SKILL, '7. Unless this is a dry run, `python3', '7. `python3'), CONSTS, ['o11'], 'guard')
  only(swap(FILES, SKILL, 'It never runs `record`, `estate-dispatch.py log`, ', 'It never runs `record`, '), CONSTS, ['o11'], 'never-runs')
  only(swap(FILES, CONTEXT, '- **Grade log**', '- **Grade history**'), CONSTS, ['o11'], 'context')
})

test('control o10: status rules 9 and 10 swapped, or a map that starts on 12, fails o10 alone', () => {
  const rules = statusRules(FILES[STATUS])
  const swapped = FILES[STATUS].replace(`\n9. ${rules[9]}`, '\n9. SWAP_NINE').replace(`\n10. ${rules[10]}`, `\n10. ${rules[9]}`)
    .replace('\n9. SWAP_NINE', `\n9. ${rules[10]}`)
  assert.notEqual(swapped, FILES[STATUS], 'control is vacuous: rules 9 and 10 not found')
  only({ ...FILES, [STATUS]: swapped }, CONSTS, ['o10'], 'swapped')
  only(FILES, { ...CONSTS, STATUS_ACTIONS: { ...CONSTS.STATUS_ACTIONS, 12: ['execute', CONSTS.STATUS_ACTIONS['12'][1]] } }, ['o10'], 'started set')
})
