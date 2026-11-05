// The Capacity (p36-7, ADR 0067 d8): skills/execute/away.md § Capacity is the spec Chorus's writer (chorus-p96-28)
// follows, and capacity.py, reconcile-rollout.py and rollout-settings.py hold its numbers. They must agree, or the
// writer writes to a contract the reader does not keep. One checker (checkCapacity) returns named failures, so the real
// files and each control (one mutation, exactly its rule) run through identical logic. Reads files only.
//   path       § Capacity names the code's CAPACITY_FILE_REL (`~/.config/thread/capacity.json`) and both required keys
//   staleness  it states the code's CAPACITY_STALE_AFTER (10 minutes), CAPACITY_FUTURE_SKEW (5 minutes) and
//              CAPACITY_MAX_BYTES (64 KiB), and the writer's 2-minute rewrite
//   login      it names the code's CAPACITY_PRIMARY_LOGIN (`dummy`), the pin CLAUDE_ACCOUNT_PINNED and the
//              CLAUDE_CODE_SESSION_ID gate, the reason a Codex caller is never held
//   warn       its WARN lines are the code's CAPACITY_WARN plus the tail `next` prints, ` — read as the Trickle`
//   fallback   it says a reading not in force falls back to the Trickle and the Away cap, never to open
//   max        capacity_max's built-in is one number in rollout-settings.py's BUILT_IN, § Capacity and execute
//              SKILL.md's settings row, and the row says it is a schema-4 [defaults]-only key
//   lease      it states the code's LEG_LEASE_LAPSE (90) and LEG_WAIT_LAPSE (180) and that close deletes the lease
//   glossary   CONTEXT.md's **Capacity** and **Rollout** entries no longer call it "not yet built"
//   legs       legs.md names `leg.py next` at § Verify's renewal point and the `wait` kinds `capacity` and `quota`
//   stop       § Capacity reads `signals` for the code's CAPACITY_STOP_KEY (`stop_suites`, p36-10) and no longer calls it
//              "never read here yet"
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collapse, read } from '../lib/contract-text.mjs'

const real = {
  away: read('skills/execute/away.md'),
  cap: read('skills/execute/scripts/capacity.py'),
  code: read('skills/execute/scripts/reconcile-rollout.py'),
  settings: read('skills/_shared/scripts/rollout-settings.py'),
  skill: read('skills/execute/SKILL.md'),
  legs: read('skills/execute/legs.md'),
  context: read('CONTEXT.md'),
}

const grab = (text, re) => (text.match(re) ?? [])[1]
function h2(text, name) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l === `## ${name}`)
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^## /.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}
function entry(text, name) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.startsWith(`- **${name}** —`))
  if (i < 0) return ''
  const j = lines.findIndex((l, k) => k > i && /^- \*\*|^#/.test(l))
  return collapse(lines.slice(i, j < 0 ? undefined : j).join('\n'))
}

function checkCapacity({ away, cap, code, settings, skill, legs, context }) {
  const fails = []
  const s = collapse(h2(away, 'Capacity'))
  const fileRel = grab(cap, /^CAPACITY_FILE_REL = "([^"]*)"/m)
  const staleM = grab(cap, /^CAPACITY_STALE_AFTER = timedelta\(minutes=(\d+)\)/m)
  const skewM = grab(cap, /^CAPACITY_FUTURE_SKEW = timedelta\(minutes=(\d+)\)/m)
  const maxKiB = grab(cap, /^CAPACITY_MAX_BYTES = (\d+) \* 1024/m)
  const primary = grab(cap, /^CAPACITY_PRIMARY_LOGIN = "([^"]*)"/m)
  const warn = grab(cap, /^CAPACITY_WARN = "([^"]*)"/m)
  const stopKey = grab(cap, /^CAPACITY_STOP_KEY = "([^"]*)"/m)
  const keys = (grab(cap, /^CAPACITY_KEYS = \(([^)]*)\)/m) ?? '').match(/"[^"]*"/g)?.map((k) => k.slice(1, -1)) ?? []
  const legLapse = grab(code, /^LEG_LEASE_LAPSE = timedelta\(minutes=(\d+)\)/m)
  const waitLapse = grab(code, /^LEG_WAIT_LAPSE = timedelta\(minutes=(\d+)\)/m)
  const builtIn = grab(settings, /"capacity_max": (\d+)\}/)
  const row = collapse(skill.split('\n').find((l) => l.startsWith('| `capacity_max` |')) ?? '')

  if (!fileRel || !s.includes(`\`~/${fileRel}\``) || keys.join() !== 'capacity,written_at' ||
    !keys.every((k) => s.includes(`| \`${k}\` | required;`))) fails.push('path')
  if (staleM !== '10' || !s.includes('more than 10 minutes old') || skewM !== '5' || !s.includes('more than 5 minutes ahead') ||
    maxKiB !== '64' || !s.includes('at most 64 KiB') || !s.includes('at least every 2 minutes')) fails.push('staleness')
  if (!primary || !s.includes(`else \`${primary}\``) || !s.includes('`CLAUDE_ACCOUNT_PINNED`') ||
    !s.includes('`CLAUDE_CODE_SESSION_ID` set') || !s.includes('a Codex or any other caller is never held')) fails.push('login')
  const tail = ' — read as the Trickle'
  if (!warn || !s.includes(`\`${warn} <stale|unreadable>: <why>${tail}\``) ||
    !s.includes(`\`${warn} capacity_max unresolved: <why>${tail}\``) ||
    !code.includes('prefix} {state[\'file\']}: {state[\'why\']} — read as the Trickle"')) fails.push('warn')
  if (!s.includes('falls back to today\'s Trickle and Away cap, exactly, never to open')) fails.push('fallback')
  if (!builtIn || !s.includes(`built-in ${builtIn}, minimum 1, schema 4`) || !row.startsWith(`| \`capacity_max\` | \`${builtIn}\` |`) ||
    !row.includes('`[defaults]` only') || !row.includes('schema-4 key')) fails.push('max')
  if (legLapse !== '90' || waitLapse !== '180' || !s.includes('lapses 90 minutes (LEG_LEASE_LAPSE)') ||
    !s.includes('180 minutes (LEG_WAIT_LAPSE)') || !s.includes('`close`, any outcome, deletes it')) fails.push('lease')
  if (/not yet built/.test(entry(context, 'Capacity')) || /not yet built/.test(entry(context, 'Rollout')) ||
    !entry(context, 'Rollout').includes('**Capacity** is the limit (ADR 0067 d8)')) fails.push('glossary')
  const verify = collapse(legs.split('\n').find((l) => l.startsWith('**Verify.**')) ?? '')
  if (!verify.includes('Run `leg.py next` before each re-run of the wait after a `verify-slot: still running` line') ||
    !legs.includes('- `wait` of kind `capacity` or `quota`')) fails.push('legs')
  const signalsRow = collapse(away.split('\n').find((l) => l.startsWith('| `signals` |')) ?? '')
  if (stopKey !== 'stop_suites' || !signalsRow.includes(`Read for \`${stopKey}\` only`) ||
    !s.includes(`\`CAPACITY_STOP_KEY = "${stopKey}"\``) || /never read here yet/.test(s)) fails.push('stop')
  return fails
}

test('away.md § Capacity, capacity.py, reconcile-rollout.py, the settings and legs.md agree', () => {
  assert.deepEqual(checkCapacity(real), [])
})

// ---- controls: each mutates one place and must fail with exactly its rule ---------------------------------------

const RULES = ['path', 'staleness', 'login', 'warn', 'fallback', 'max', 'lease', 'glossary', 'legs', 'stop']
const CONTROLLED = new Set()
function edit(text, from, to) {
  assert.ok(text.includes(from), `control setup: ${from.slice(0, 80)} not found`)
  return text.replace(from, to)
}
const only = (key, from, to, rule, label) => {
  CONTROLLED.add(rule)
  assert.deepEqual(checkCapacity({ ...real, [key]: edit(real[key], from, to) }), [rule], label)
}

test('controls: each mutation fails exactly its rule', () => {
  only('cap', 'CAPACITY_FILE_REL = ".config/thread/capacity.json"', 'CAPACITY_FILE_REL = ".config/thread/cap.json"', 'path', 'another path')
  only('cap', 'CAPACITY_KEYS = ("capacity", "written_at")', 'CAPACITY_KEYS = ("capacity", "written_at", "signals")', 'path', 'a third required key')
  only('cap', 'CAPACITY_STALE_AFTER = timedelta(minutes=10)', 'CAPACITY_STALE_AFTER = timedelta(minutes=15)', 'staleness', 'another stale bound')
  only('away', 'at least every 2 minutes', 'every so often', 'staleness', 'no rewrite cadence')
  only('cap', 'CAPACITY_PRIMARY_LOGIN = "dummy"', 'CAPACITY_PRIMARY_LOGIN = "primary"', 'login', 'another primary Login')
  only('away', 'a Codex or any other caller is never held', 'a Codex caller is held too', 'login', 'Codex held')
  only('cap', 'CAPACITY_WARN = "WARN: ~/.config/thread/capacity.json"', 'CAPACITY_WARN = "WARN: capacity"', 'warn', 'another WARN prefix')
  only('code', "{prefix} {state['file']}: {state['why']} — read as the Trickle\"", "{prefix} {state['file']}: {state['why']}\"", 'warn', 'no tail in the code')
  only('away', "falls back to today's Trickle and Away cap, exactly, never to open", 'falls back to an open Mac', 'fallback', 'open on failure')
  only('settings', '"verify_slots": 2, "capacity_max": 6}', '"verify_slots": 2, "capacity_max": 8}', 'max', 'another built-in in the code')
  only('skill', '| `capacity_max` | `6` |', '| `capacity_max` | `5` |', 'max', 'another built-in in the settings row')
  only('code', 'LEG_LEASE_LAPSE = timedelta(minutes=90)', 'LEG_LEASE_LAPSE = timedelta(minutes=60)', 'lease', 'another Leg lapse')
  only('away', '`close`, any outcome, deletes it', '`close` keeps it', 'lease', 'close keeps the lease')
  only('context', '**Capacity** is the limit (ADR 0067 d8)', '**Capacity** is the limit, not yet built (ADR 0067 d8)', 'glossary', 'not yet built again')
  only('legs', 'Run `leg.py next` before each re-run of the wait after a `verify-slot: still running` line',
    'Re-run the wait after a `verify-slot: still running` line', 'legs', 'no renewal point')
  only('legs', '- `wait` of kind `capacity` or `quota`', '- `wait` of kind `room`', 'legs', 'no Capacity kinds')
  only('away', 'Read for `stop_suites` only', 'Carried, never read here yet', 'stop', 'the row back to carried-only')
  only('cap', 'CAPACITY_STOP_KEY = "stop_suites"', 'CAPACITY_STOP_KEY = "suites_stop"', 'stop', 'another stop key in the code')
})

test('every rule has a control', () => {
  assert.deepEqual([...CONTROLLED].sort(), [...RULES].sort())
})
