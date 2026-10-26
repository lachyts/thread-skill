// The Away state file is a cross-repo contract (p28-1, Chorus ADR 0104 d6): Chorus writes ~/.config/thread/away.json
// and reconcile-rollout.py `next` reads it, so skills/execute/away.md (the spec a writer's builder reads) must say what
// the code does. This guards the drift between the two, and the prose that says what holds a queued task back:
//   keys        away.md's key table lists exactly AWAY_KEYS, in order, then the optional AWAY_CAP_KEY (p29-8)
//   path        away.md names `~/.config/thread/away.json`, the code's AWAY_FILE_REL under the home dir
//   staleness   away.md's stale tests say 24 h and 5 minutes, the code's AWAY_STALE_AFTER and AWAY_FUTURE_SKEW,
//               and its size limit 64 KiB, AWAY_MAX_BYTES
//   default     away.md's default is Trickle <DEFAULT_TRICKLE>, in its readings and its no-writer default
//   refresh     the writer rewrites the file at least once every 24 h while a state holds
//   until       the `until` row says what it means in both states (it names not Away)
//   morning     the `morning` row is local wall-clock time
//   serial      serial rollouts are outside the count, said with its reason
//   warn        away.md's WARN line is the code's: AWAY_WARN, then `<stale|unreadable>: <why>`, then the reading
//   hold-back   every "only … holds one back" claim names the Trickle, the Away cap in its place while Away (ADR
//               0049) and (p28-2) the last starts: the rollout template's, schedule § 5's and CONTEXT.md's **Queue**
//   glossary    CONTEXT.md has **Trickle**, **Away** and (p28-2) **Last starts** entries, each citing its Chorus ADR 0104
//               decision (d2, d3, d4)
//   restart     § The Trickle says a restart waits on the ceiling alone, never `slotLimit`, and that a new start counts
//               every in_progress task of this rollout, live or stalled (the round-1 respawn deadlock)
//   no-lead     § The Trickle says a parallel rollout with no lead holds the Trickle for nobody, and its remedy: the
//               rollout named in `trickle.elsewhere`, a `paused:` stamp, a liveness signal left to a later task
//   sample      § Without a writer's hand-written `until` is the next 09:00 strictly after now, never tomorrow's always
//   away-cap    § Away (p29-8, ADR 0049) states the code's AWAY_CAP_DEFAULT and its lift above the Trickle, the
//               AWAY_CAP_PREFIX hold line, that it never halts, the meant wait and a dead lead's room; run_record.py's
//               idle-slots enum holds hold-away-cap
//   older-reader  an engine snapshot from before p29-8 (ADR 0043) ignores `away_cap`: the live AWAY_KEYS equals the
//               frozen p28-1 reader's (tests/fixtures/away-state/p28-1-reader.py), AWAY_CAP_KEY is never one of them,
//               and away.md says an older snapshot ignores the key
//   last-starts (p28-2) § The last starts states the code's numbers (LAST_START_FALLBACK, LAST_START_MIN_RUNS,
//               LAST_START_HISTORY, LAST_START_HORIZON) and its reason prefix, that `until` must be the Morning, that
//               restarts and revises are exempt and that the hold never halts
//   night-record (p28-2) § The night record names the code's NIGHT_KINDS, run_record.py's KINDS holds each, and
//               reflect's score.py skips the same NIGHT_KINDS (a night line is never a task's call activity)
// One function (checkAway) returns named failures, so the real files and each control (one mutation, exactly its
// rule) run through identical logic. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read } from '../lib/contract-text.mjs'

const real = {
  away: read('skills/execute/away.md'),
  code: read('skills/execute/scripts/reconcile-rollout.py'),
  runRecord: read('skills/_shared/scripts/run_record.py'),
  score: read('skills/reflect/scripts/score.py'),
  template: read('skills/schedule/rollout-template.md'),
  schedule: read('skills/schedule/SKILL.md'),
  context: read('CONTEXT.md'),
  older: read('tests/fixtures/away-state/p28-1-reader.py'),
}

const grab = (text, re) => (text.match(re) ?? [])[1]
// The `## Name` section of a markdown text, to the next `## ` heading.
function h2(text, name) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l === `## ${name}`)
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^## /.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}
// A CONTEXT.md glossary entry: its `- **Name** —` line through the line before the next `- **` entry.
function entry(text, name) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.startsWith(`- **${name}** —`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^- \*\*|^#/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}

const keysOf = (text) => (grab(text, /^AWAY_KEYS = \(([^)]*)\)/m) ?? '').match(/"[^"]*"/g)?.map((s) => s.slice(1, -1)) ?? []

function checkAway({ away, code, runRecord, score, template, schedule, context, older }) {
  const fails = []
  const keys = keysOf(code)
  const capKey = grab(code, /^AWAY_CAP_KEY = "([^"]*)"/m)
  const capDefault = grab(code, /^AWAY_CAP_DEFAULT = (\d+)/m)
  const capPrefix = grab(code, /^AWAY_CAP_PREFIX = "([^"]*)"/m)
  const fileRel = grab(code, /^AWAY_FILE_REL = "([^"]*)"/m)
  const staleH = grab(code, /^AWAY_STALE_AFTER = timedelta\(hours=(\d+)\)/m)
  const skewM = grab(code, /^AWAY_FUTURE_SKEW = timedelta\(minutes=(\d+)\)/m)
  const maxKiB = grab(code, /^AWAY_MAX_BYTES = (\d+) \* 1024$/m)
  const trickle = grab(code, /^DEFAULT_TRICKLE = (\d+)/m)
  const warn = grab(code, /^AWAY_WARN = "([^"]*)"/m)
  const warnPrint = code.split('\n').find((l) => l.includes('print(f"{AWAY_WARN} ')) ?? ''
  const file = h2(away, 'The state file')
  const reading = collapse(h2(away, 'Reading it'))
  const trickleS = collapse(h2(away, 'The Trickle'))
  const rows = file.split('\n').filter((l) => /^\| `[^`]+` \|/.test(l))
  const row = (k) => collapse(rows.find((l) => l.startsWith(`| \`${k}\` |`)) ?? '')

  if (!keys.length || !capKey ||
    JSON.stringify(rows.map((l) => l.match(/^\| `([^`]+)`/)[1])) !== JSON.stringify([...new Set([...keys, capKey])])) fails.push('keys')

  if (fileRel !== '.config/thread/away.json' || !collapse(file).includes('The file is `~/.config/thread/away.json`, under the home dir')) {
    fails.push('path')
  }

  if (!staleH || !skewM || !maxKiB || !reading.includes(`\`written_at\` is more than ${staleH} h before now`) ||
    !reading.includes(`\`written_at\` is more than ${skewM} minutes after now`) || !reading.includes('`until` is at or before now') ||
    !collapse(file).includes(`read as at most ${maxKiB} KiB of UTF-8`)) fails.push('staleness')

  if (!trickle || !reading.includes(`Not Away, Trickle ${trickle}.`) ||
    !collapse(h2(away, 'Without a writer')).includes(`a combined Trickle of ${trickle}, nights included`)) fails.push('default')

  if (!collapse(file).includes('rewrite it at least once every 24 h while a state holds')) fails.push('refresh')

  if (!/Not Away: /.test(row('until')) || !/\. Away: /.test(row('until')) || !row('until').includes('a passed `until` reads stale')) {
    fails.push('until')
  }

  if (!row('morning').includes('local wall-clock time')) fails.push('morning')

  if (!trickleS.includes('**Serial rollouts are outside the count.** A Leg') || !trickleS.includes('`next` never runs for a serial rollout')) {
    fails.push('serial')
  }

  const warnLine = away.split('\n').find((l) => l.startsWith('`WARN: ')) ?? ''
  // The number is the default rule's; this one pins the line's shape, so each control fails exactly one rule.
  if (!warn || !/^`.* — read as not Away, Trickle \d+`$/.test(warnLine) ||
    !warnLine.startsWith(`\`${warn} <stale|unreadable>: <why> — read as not Away, Trickle `) ||
    !warnPrint.includes('— read as not Away, Trickle {DEFAULT_TRICKLE}')) fails.push('warn')

  const tmplQueue = collapse(template.split('\n').find((l) => l.startsWith('Tasks run in parallel up to `parallel_ceiling`')) ?? '')
  const sched5 = collapse(schedule.split('\n').find((l) => l.startsWith('The rollout is a queue (ADR 0030 decision 1)')) ?? '')
  const awayClause = "holds one back (while Lachy is Away, the Away cap does in the Trickle's place, ADR 0049"
  const LAST_BACK = 'toward the Morning while Away, the last starts too)'
  if (!/a Solo task or, by day, the Trickle \(.*Chorus ADR 0104; execute `away\.md`\) holds one back/.test(tmplQueue) ||
    !sched5.includes('only a dependency, a Solo task or, by day, the Trickle (Chorus ADR 0104; execute `away.md`) holds one back') ||
    !entry(context, 'Queue').includes('**Solo** task and, by day, the **Trickle**') ||
    !tmplQueue.includes(awayClause) || !sched5.includes(awayClause) ||
    !entry(context, 'Queue').includes('Away, by the **Away cap** instead of the Trickle (ADR 0049)') ||
    !tmplQueue.includes(LAST_BACK) || !sched5.includes(LAST_BACK) ||
    !entry(context, 'Queue').includes('and, toward the Morning, the **Last starts**')) fails.push('hold-back')

  if (!entry(context, 'Trickle').includes('(Chorus ADR 0104 d2)') || !entry(context, 'Away').includes('(Chorus ADR 0104 d3)') ||
    !entry(context, 'Last starts').includes('(Chorus ADR 0104 d4)') || !entry(context, 'Night record').includes('_Avoid_: night log')) {
    fails.push('glossary')
  }

  if (!trickleS.includes('**A restart waits on the ceiling alone.**') || !trickleS.includes('never by `slotLimit`') ||
    !trickleS.includes('counting every `in_progress` task of this rollout, live or stalled')) fails.push('restart')

  if (!trickleS.includes('**A parallel rollout with no lead holds the Trickle for nobody.**') ||
    !trickleS.includes('`trickle.elsewhere` names the rollout') || !trickleS.includes('stamping it `paused:`') ||
    !trickleS.includes('takes it out of the count at once') || !trickleS.includes('A liveness signal')) fails.push('no-lead')

  const writer = h2(away, 'Without a writer')
  if (!writer.includes('until = now.replace(hour=9, minute=0, second=0, microsecond=0)') ||
    !writer.includes('if until <= now:\n    until += datetime.timedelta(days=1)') ||
    /now \+ datetime\.timedelta\(days=1\)/.test(writer)) fails.push('sample')

  const awayS = collapse(h2(away, 'Away'))
  const idleEnum = ((runRecord ?? '').match(/"idle-slots": \(False, \{"reason": _enum\(([^)]*)\)/) ?? [])[1] ?? ''
  if (!capDefault || !capPrefix || !awayS.includes(`With the key absent the built-in is ${capDefault}:`) ||
    !awayS.includes('lifts the built-in to `trickle` + 1, so the Away cap is always above the Trickle') ||
    !awayS.includes(`\`${capPrefix} <running>/<A> tasks running on this Mac\`, and it never halts`) ||
    !awayS.includes('a rollout the Away cap alone holds is a meant wait, never Stalled (ADR 0048)') ||
    !awayS.includes("the Run record's `idle-slots` reads `hold-away-cap`") ||
    !awayS.includes('holds its Away-cap room until the Watchdog recovers it (ADR 0048) or Lachy pauses it') ||
    !awayS.includes('the Companion has no pause') ||
    !/"hold-away-cap"/.test(idleEnum)) fails.push('away-cap')

  const frozen = keysOf(older)
  if (!frozen.length || JSON.stringify(frozen) !== JSON.stringify(keys) || keys.includes(capKey) ||
    !collapse(file).includes('An engine snapshot from before it ignores it as an extra key and runs Away to each rollout\'s own ceiling (ADR 0043)') ||
    !collapse(file).includes('The first five keys are required and `away_cap` is optional. Extra keys are ignored')) fails.push('older-reader')

  // last-starts: the numbers and the prefix are the code's, read from it, so a change on either side fails.
  const fallbackH = grab(code, /^LAST_START_FALLBACK = timedelta\(hours=(\d+)\)/m)
  const minRuns = grab(code, /^LAST_START_MIN_RUNS = (\d+)/m)
  const historyD = grab(code, /^LAST_START_HISTORY = timedelta\(days=(\d+)\)/m)
  const horizonH = grab(code, /^LAST_START_HORIZON = timedelta\(hours=(\d+)\)/m)
  const prefix = grab(code, /^LAST_START_PREFIX = "([^"]*)"/m)
  const lastS = collapse(h2(away, 'The last starts'))
  if (!fallbackH || !minRuns || !historyD || !horizonH || !prefix ||
    !lastS.includes(`With no history its length is ${fallbackH} h: it starts until exactly ${fallbackH} h before M.`) ||
    !lastS.includes(`with at least ${minRuns} past runs. Fewer than ${minRuns} is no history.`) ||
    !lastS.includes(`falls in the last ${historyD} days`) ||
    !lastS.includes(`at most ${horizonH} h ahead (now < M <= now + ${horizonH} h)`) ||
    !lastS.includes(`\`${prefix} <kind> usually takes <N> min (median of <k> past runs), past the Morning at <HH:MM>\``) ||
    !lastS.includes(`\`${prefix} no history for <kind> (<k> past runs, ${minRuns} needed), none starts in the ${fallbackH} h before the Morning at <HH:MM>\``) ||
    !lastS.includes('its `until` is the Morning: read in local wall-clock time') ||
    !lastS.includes('Restarts are exempt: a stalled `in_progress` task, a set-aside task handed back and a seeded revise') ||
    !lastS.includes('**It never halts.** While any row reads `last start:`')) fails.push('last-starts')

  // night-record: NIGHT_KINDS are the three, each named in § The night record and each one of run_record.py's KINDS,
  // and score.py's NIGHT_KINDS (the lines its pair() skips) are the same three.
  const kindsOf = (text) => (grab(text ?? '', /^NIGHT_KINDS = \(([^)]*)\)/m) ?? '').match(/"[^"]*"/g)?.map((s) => s.slice(1, -1)) ?? []
  const nightKinds = kindsOf(code)
  const nightS = h2(away, 'The night record')
  if (JSON.stringify(nightKinds) !== JSON.stringify(['away-night', 'last-start-held', 'ran-past-morning']) ||
    JSON.stringify(kindsOf(score)) !== JSON.stringify(nightKinds) ||
    nightKinds.some((k) => !nightS.includes(`- \`${k}\` `) || !(runRecord ?? '').includes(`    "${k}": (`))) fails.push('night-record')

  return fails
}

test('away.md, the code that reads the file and the hold-back prose agree', () => {
  assert.deepEqual(checkAway(real), [])
})

// ---- controls: each mutates one place and must fail with exactly its rule ---------------------------------------

const RULES = ['keys', 'path', 'staleness', 'default', 'refresh', 'until', 'morning', 'serial', 'warn', 'hold-back', 'glossary',
  'restart', 'no-lead', 'sample', 'away-cap', 'older-reader', 'last-starts', 'night-record']
const CONTROLLED = new Set()
function edit(text, from, to) {
  assert.ok(text.includes(from), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(from, to)
}
const only = (key, from, to, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(checkAway({ ...real, [key]: edit(real[key], from, to) }), [rule], label)
}

test('control: a key the code reads that the table lacks, or a reordered table, fails keys', () => {
  // A sixth required key in both readers (the frozen one too, so older-reader still holds): only the table lags.
  const six = ['AWAY_KEYS = ("away", "until", "morning", "trickle", "written_at")',
    'AWAY_KEYS = ("away", "until", "morning", "trickle", "written_at", "evening")']
  CONTROLLED.add('keys')
  assert.deepEqual(checkAway({ ...real, code: edit(real.code, ...six), older: edit(real.older, ...six) }), ['keys'], 'a sixth key')
  only('code', 'AWAY_CAP_KEY = "away_cap"', 'AWAY_CAP_KEY = "night_cap"', 'keys', 'another optional key')
  const t = real.away.split('\n').find((l) => l.startsWith('| `trickle` |'))
  const m = real.away.split('\n').find((l) => l.startsWith('| `morning` |'))
  only('away', `${m}\n${t}`, `${t}\n${m}`, 'keys', 'reordered')
  const c = real.away.split('\n').find((l) => l.startsWith('| `away_cap` |'))
  only('away', `${c}\n`, '', 'keys', 'no away_cap row')
  const w = real.away.split('\n').find((l) => l.startsWith('| `written_at` |'))
  only('away', `${w}\n${c}`, `${c}\n${w}`, 'keys', 'away_cap not last')
})
test('control: another path fails path', () => {
  only('code', 'AWAY_FILE_REL = ".config/thread/away.json"', 'AWAY_FILE_REL = ".config/chorus/away.json"', 'path', 'code path')
  only('away', 'The file is `~/.config/thread/away.json`', 'The file is `~/.config/chorus/away.json`', 'path', 'doc path')
})
test('control: a stale window the doc does not state fails staleness', () => {
  only('code', 'AWAY_STALE_AFTER = timedelta(hours=24)', 'AWAY_STALE_AFTER = timedelta(hours=36)', 'staleness', '36 h')
  only('code', 'AWAY_FUTURE_SKEW = timedelta(minutes=5)', 'AWAY_FUTURE_SKEW = timedelta(minutes=10)', 'staleness', '10 minutes')
  only('away', '3. `written_at` is more than 5 minutes after now.', '3. `written_at` is after now.', 'staleness', 'no 5 minutes')
  only('code', 'AWAY_MAX_BYTES = 64 * 1024', 'AWAY_MAX_BYTES = 128 * 1024', 'staleness', '128 KiB')
})
test('control: another default fails default', () => {
  only('code', 'DEFAULT_TRICKLE = 2 ', 'DEFAULT_TRICKLE = 3 ', 'default', 'default 3')
})
test('control: no 24 h refresh duty fails refresh', () => {
  only('away', 'and rewrite it at least once every 24 h while a state holds', 'and whenever it likes', 'refresh', 'no refresh')
})
test('control: an until row for one state only fails until', () => {
  only('away', ' Not Away: the next Evening\'s hour, or the start of the next Away block.', '', 'until', 'Away only')
})
test('control: a morning in UTC fails morning', () => {
  only('away', 'in local wall-clock time (the Mac\'s system time zone)', 'in UTC', 'morning', 'UTC')
})
test('control: serial rollouts in the count fails serial', () => {
  only('away', '**Serial rollouts are outside the count.**', '**Serial rollouts count too.**', 'serial', 'counted')
})
test('control: a WARN line the code does not print fails warn', () => {
  only('code', 'AWAY_WARN = "WARN: ~/.config/thread/away.json"', 'AWAY_WARN = "WARN: away.json"', 'warn', 'code prefix')
  only('away', '`WARN: ~/.config/thread/away.json <stale|unreadable>: <why> — read as not Away, Trickle 2`',
    '`WARN: ~/.config/thread/away.json <stale|unreadable>: <why>`', 'warn', 'doc tail')
})
test('control: a hold-back claim without the Trickle fails hold-back', () => {
  only('template', ', a Solo task or, by day, the Trickle (the machine-wide count of running Rollout tasks while Lachy is not Away, Chorus ADR 0104; execute `away.md`) holds one back',
    ' or a Solo task holds one back', 'hold-back', 'template')
  only('schedule', 'only a dependency, a Solo task or, by day, the Trickle (Chorus ADR 0104; execute `away.md`) holds one back',
    'only a dependency or a Solo task holds one back', 'hold-back', 'schedule § 5')
  only('context', '**Solo** task and, by day, the **Trickle**, never a shared file', '**Solo** task, never a shared file', 'hold-back', 'CONTEXT Queue')
  only('template', '; toward the Morning while Away, the last starts too), never', '), never', 'hold-back', 'template, last starts')
  only('schedule', '; toward the Morning while Away, the last starts too).', ').', 'hold-back', 'schedule § 5, last starts')
  only('context', ',\n  and, toward the Morning, the **Last starts**;', ';', 'hold-back', 'CONTEXT Queue, last starts')
})
test('control: a hold-back claim without the Away cap fails hold-back', () => {
  const clause = "while Lachy is Away, the Away cap does in the Trickle's place, ADR 0049; "
  only('template', `holds one back (${clause}toward`, 'holds one back (toward', 'hold-back', 'template')
  only('schedule', `holds one back (${clause}toward`, 'holds one back (toward', 'hold-back', 'schedule § 5')
  only('context', '; Away, by the **Away cap** instead of the Trickle (ADR 0049)', '', 'hold-back', 'CONTEXT Queue')
})
test('control: a glossary entry without its ADR fails glossary', () => {
  only('context', 'Chorus sets another (Chorus ADR 0104 d2)', 'Chorus sets another', 'glossary', 'Trickle')
  only('context', '**Parallel ceiling** (Chorus ADR 0104 d3)', '**Parallel ceiling**', 'glossary', 'Away')
  only('context', ' (Chorus\n  ADR 0104 d4). They apply', '. They apply', 'glossary', 'Last starts')
  only('context', '- **Night record** —', '- **Night log** —', 'glossary', 'no Night record entry')
})

test('control: a restart bounded by slotLimit, or starts that skip stalled tasks, fail restart', () => {
  only('away', '**A restart waits on the ceiling alone.**', '**A restart waits on the Trickle too.**', 'restart', 'no heading')
  only('away', 'never by `slotLimit`', 'and by `slotLimit`', 'restart', 'bounded by slotLimit')
  only('away', 'counting every `in_progress` task of this rollout, live or stalled, as every other lead counts them',
    'counting its live tasks only', 'restart', 'stalled tasks uncounted')
})
test('control: no word on a lead-less rollout, or no remedy, fails no-lead', () => {
  only('away', '**A parallel rollout with no lead holds the Trickle for nobody.**', '**Every lead is live.**', 'no-lead', 'no paragraph')
  only('away', 'stamping it `paused:` (execute', 'leaving it (execute', 'no-lead', 'no paused: remedy')
  only('away', 'A liveness signal (a lease the live lead refreshes, so a lapsed one stops counting) is a later task\'s.', '', 'no-lead', 'no follow-up')
})
test("control: a hand-written until that is always tomorrow's 09:00 fails sample", () => {
  const w = h2(real.away, 'Without a writer')
  const from = w.slice(w.indexOf('until = now.replace('), w.indexOf('path = os.path.expanduser'))
  only('away', from, 'until = (now + datetime.timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)\n', 'sample', 'always tomorrow')
})

test('control: § Away without its default, lift, hold, meant wait or dead-lead room fails away-cap', () => {
  only('code', 'AWAY_CAP_DEFAULT = 4 ', 'AWAY_CAP_DEFAULT = 6 ', 'away-cap', 'default 6 in the code')
  only('away', 'With the key absent the built-in is 4:', 'With the key absent the built-in is 6:', 'away-cap', 'default 6 in the doc')
  only('away', 'lifts the built-in to `trickle` + 1, so the Away cap is always above the Trickle', 'keeps the built-in', 'away-cap', 'no lift')
  only('code', 'AWAY_CAP_PREFIX = "away cap:"', 'AWAY_CAP_PREFIX = "night cap:"', 'away-cap', 'another hold prefix')
  only('away', ', and it never halts: a rollout', ', and it halts: a rollout', 'away-cap', 'it halts')
  only('away', 'a meant wait, never Stalled (ADR 0048)', 'Stalled (ADR 0048)', 'away-cap', 'Stalled')
  only('away', "and the Run record's `idle-slots` reads `hold-away-cap`", "and the Run record's `idle-slots` reads `hold-trickle`", 'away-cap', 'hold-trickle in the doc')
  only('away', 'until the Watchdog recovers it (ADR 0048) or Lachy pauses it', 'until its lead returns', 'away-cap', 'no dead-lead remedy')
  only('away', '; the Companion has no pause', '', 'away-cap', 'no word on the Companion')
  only('runRecord', '"hold-trickle",\n                                           "hold-away-cap", "hold-last-start"),',
    '"hold-trickle",\n                                           "hold-last-start"),', 'away-cap', 'the enum without hold-away-cap')
})
test('control: an older snapshot that would refuse the key fails older-reader', () => {
  only('code', 'AWAY_KEYS = ("away", "until", "morning", "trickle", "written_at")',
    'AWAY_KEYS = ("away", "until", "morning", "trickle", "written_at", "away_cap")', 'older-reader', 'away_cap required')
  only('older', 'AWAY_KEYS = ("away", "until", "morning", "trickle", "written_at")',
    'AWAY_KEYS = ("away", "until", "morning", "trickle")', 'older-reader', 'the frozen keys drift')
  only('away', 'An engine snapshot from before it ignores it as an extra key', 'An engine snapshot from before it refuses it', 'older-reader', 'refused')
  only('away', 'The first five keys are required and `away_cap` is optional.', 'All six keys are required.', 'older-reader', 'required')
})

test('control: a fallback, a run count or a rule the code and § The last starts disagree on fails last-starts', () => {
  only('code', 'LAST_START_FALLBACK = timedelta(hours=2)', 'LAST_START_FALLBACK = timedelta(hours=3)', 'last-starts', 'a 3 h fallback')
  only('away', 'with at least 3 past runs. Fewer than 3 is no history.', 'with at least 4 past runs. Fewer than 4 is no history.', 'last-starts', '4 past runs')
  only('code', 'LAST_START_HISTORY = timedelta(days=30)', 'LAST_START_HISTORY = timedelta(days=60)', 'last-starts', '60 days')
  only('code', 'LAST_START_HORIZON = timedelta(hours=24)', 'LAST_START_HORIZON = timedelta(hours=36)', 'last-starts', 'a 36 h horizon')
  only('code', 'LAST_START_PREFIX = "last start:"', 'LAST_START_PREFIX = "morning:"', 'last-starts', 'another prefix')
  const l = real.away.split('\n').find((x) => x.startsWith('- its `until` is the Morning:'))
  only('away', l + '\n', '', 'last-starts', 'the until rule dropped')
  only('away', 'Restarts are exempt: a stalled `in_progress` task, a set-aside task handed back and a seeded revise each re-enter a task already begun, and running tasks finish.',
    'Restarts are held too.', 'last-starts', 'no exemption')
  only('away', '**It never halts.** While any row reads `last start:`', '**It halts stuck.** While any row reads `last start:`', 'last-starts', 'it halts')
})
test('control: a night kind the doc, the writer or score.py lacks fails night-record', () => {
  only('away', '- `ran-past-morning` `{morning,', '- `ran-past` `{morning,', 'night-record', 'dropped from the doc')
  only('runRecord', '    "ran-past-morning": (', '    "ran-past": (', 'night-record', 'dropped from KINDS')
  only('code', 'NIGHT_KINDS = ("away-night", "last-start-held", "ran-past-morning")', 'NIGHT_KINDS = ("away-night", "last-start-held")',
    'night-record', 'dropped from NIGHT_KINDS')
  only('score', 'NIGHT_KINDS = ("away-night", "last-start-held", "ran-past-morning")', 'NIGHT_KINDS = ("away-night", "last-start-held")',
    'night-record', 'dropped from score.py\'s NIGHT_KINDS')
})

test('the rules are all named (18) and each has a control', () => {
  assert.equal(RULES.length, 18)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
