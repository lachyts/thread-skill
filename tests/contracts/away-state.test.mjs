// The Away state file is a cross-repo contract (p28-1, Chorus ADR 0104 d6): Chorus writes ~/.config/thread/away.json
// and reconcile-rollout.py `next` reads it, so skills/execute/away.md (the spec a writer's builder reads) must say what
// the code does. This guards the drift between the two, and the prose that says what holds a queued task back:
//   keys        away.md's key table lists exactly AWAY_KEYS, in order
//   path        away.md names `~/.config/thread/away.json`, the code's AWAY_FILE_REL under the home dir
//   staleness   away.md's stale tests say 24 h and 5 minutes, the code's AWAY_STALE_AFTER and AWAY_FUTURE_SKEW,
//               and its size limit 64 KiB, AWAY_MAX_BYTES
//   default     away.md's default is Trickle <DEFAULT_TRICKLE>, in its readings and its no-writer default
//   refresh     the writer rewrites the file at least once every 24 h while a state holds
//   until       the `until` row says what it means in both states (it names not Away)
//   morning     the `morning` row is local wall-clock time
//   serial      serial rollouts are outside the count, said with its reason
//   warn        away.md's WARN line is the code's: AWAY_WARN, then `<stale|unreadable>: <why>`, then the reading
//   hold-back   every "only … holds one back" claim names the Trickle: the rollout template's, schedule § 5's and
//               CONTEXT.md's **Queue**
//   glossary    CONTEXT.md has **Trickle** and **Away** entries, each citing its Chorus ADR 0104 decision (d2, d3)
// One function (checkAway) returns named failures, so the real files and each control (one mutation, exactly its
// rule) run through identical logic. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read } from '../lib/contract-text.mjs'

const real = {
  away: read('skills/execute/away.md'),
  code: read('skills/execute/scripts/reconcile-rollout.py'),
  template: read('skills/schedule/rollout-template.md'),
  schedule: read('skills/schedule/SKILL.md'),
  context: read('CONTEXT.md'),
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

function checkAway({ away, code, template, schedule, context }) {
  const fails = []
  const keys = (grab(code, /^AWAY_KEYS = \(([^)]*)\)/m) ?? '').match(/"[^"]*"/g)?.map((s) => s.slice(1, -1)) ?? []
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

  if (!keys.length || JSON.stringify(rows.map((l) => l.match(/^\| `([^`]+)`/)[1])) !== JSON.stringify(keys)) fails.push('keys')

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
  if (!/a Solo task or, by day, the Trickle \(.*Chorus ADR 0104; execute `away\.md`\) holds one back/.test(tmplQueue) ||
    !sched5.includes('only a dependency, a Solo task or, by day, the Trickle (Chorus ADR 0104; execute `away.md`) holds one back') ||
    !entry(context, 'Queue').includes('**Solo** task and, by day, the **Trickle**')) fails.push('hold-back')

  if (!entry(context, 'Trickle').includes('(Chorus ADR 0104 d2)') || !entry(context, 'Away').includes('(Chorus ADR 0104 d3)')) fails.push('glossary')

  return fails
}

test('away.md, the code that reads the file and the hold-back prose agree', () => {
  assert.deepEqual(checkAway(real), [])
})

// ---- controls: each mutates one place and must fail with exactly its rule ---------------------------------------

const RULES = ['keys', 'path', 'staleness', 'default', 'refresh', 'until', 'morning', 'serial', 'warn', 'hold-back', 'glossary']
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
  only('code', 'AWAY_KEYS = ("away", "until", "morning", "trickle", "written_at")',
    'AWAY_KEYS = ("away", "until", "morning", "trickle", "written_at", "evening")', 'keys', 'a sixth key')
  const t = real.away.split('\n').find((l) => l.startsWith('| `trickle` |'))
  const m = real.away.split('\n').find((l) => l.startsWith('| `morning` |'))
  only('away', `${m}\n${t}`, `${t}\n${m}`, 'keys', 'reordered')
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
})
test('control: a glossary entry without its ADR fails glossary', () => {
  only('context', 'Away state file, else 2 (Chorus ADR 0104 d2)', 'Away state file, else 2', 'glossary', 'Trickle')
  only('context', '**Parallel ceiling** (Chorus ADR 0104 d3)', '**Parallel ceiling**', 'glossary', 'Away')
})

test('the rules are all named (11) and each has a control', () => {
  assert.equal(RULES.length, 11)
  assert.deepEqual(RULES.filter((r) => !CONTROLLED.has(r)), [])
})
