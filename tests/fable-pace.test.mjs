// p46-3 (ADR 0079 decision 6): skills/execute/scripts/fable_pace.py, the Fable share's pace per Login. The share is the
// role's Fable ceiling times a pace read from the quota store's row for the Login, so the Fable and general weekly
// windows run down together: half the ceiling when even, less when Fable is further used, more when it is behind,
// nothing when it is spent, and nothing (with a why) when the reading is missing, stale or not the Login's.
//
// Runs `python3 -B fable_pace.py` under a temp HOME, CLAUDE_* and AGENT_QUOTAS_STORE stripped, --now fixed, the store
// in its real { version, accounts: [...] } shape. Temp dirs only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(root, 'skills', 'execute', 'scripts', 'fable_pace.py')
const NOW = '2026-11-13T10:00:00Z'
const T = Date.parse(NOW) / 1000
const CEILING = { 'master-review': 0.5, builder: 1, lead: 0.2 }

// A store row in the poller's shape: the general (seven_day) and Fable (custom) windows, each with its own fetched_at.
function row(profile, fable, general, over = {}) {
  const at = over.at ?? T - 600
  const reset = over.reset === undefined ? T + 3 * 86400 : over.reset
  return {
    provider: 'anthropic', account: `${profile}@example.invalid`, profile, surface: 'Claude Code', fetched_at: at, status: 'ok', note: null,
    windows: [
      { kind: 'seven_day', utilization: general, resets_at: reset, is_enabled: true, fetched_at: over.generalAt ?? at, source: 'oauth' },
      ...(fable === undefined ? [] : [{ kind: 'custom', utilization: fable, resets_at: reset, is_enabled: true, custom_kind: 'claude-weekly-scoped-fable', display_name: 'Fable', fetched_at: at, source: 'oauth' }]),
    ],
  }
}

function home(t) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'fable-pace-'))
  t.after(() => fs.rmSync(h, { recursive: true, force: true }))
  return h
}
function store(h, rows, raw) {
  const p = path.join(h, '.claude', 'state', 'agent-quotas.json')
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, raw ?? JSON.stringify({ version: 1, written_at: T, accounts: rows }))
  return p
}
function pace(h, login, extraEnv = {}, ceiling = CEILING) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE') && k !== 'AGENT_QUOTAS_STORE'))
  const args = ['-B', SCRIPT, '--now', NOW, '--ceiling', JSON.stringify(ceiling), ...(login === null ? [] : ['--login', login])]
  const r = spawnSync('python3', args, { encoding: 'utf8', env: { ...env, HOME: h, PYTHONDONTWRITEBYTECODE: '1', ...extraEnv } })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  return JSON.parse(r.stdout)
}

test('the curve: even gives half the ceiling; Fable ahead lower, behind higher, capped at the ceiling; Fable spent none, general spent all', (t) => {
  for (const [name, fable, general, want] of [
    ['even', 40, 40, 0.5], ['Fable ahead', 60, 20, 0.25], ['Fable behind', 30, 50, 0.7], ['far behind, capped', 20, 60, 1],
    ['Fable spent', 100, 40, 0], ['general spent', 50, 100, 1], ['over 100 is clamped', 120, 40, 0],
  ]) {
    const h = home(t)
    store(h, [row('login-a', fable, general)])
    const out = pace(h, 'login-a')
    assert.equal(out.pace, want, name)
    assert.deepEqual(out.share, { 'master-review': Math.round(0.5 * want * 1000) / 1000, builder: want, lead: Math.round(0.2 * want * 1000) / 1000 }, name)
    assert.equal(out.why, null, name)
    assert.deepEqual([out.login, out.fable, out.general, out.fetchedAt], ['login-a', Math.min(100, fable), general, '2026-11-13T09:50:00Z'], name)
  }
})

test('a null resets_at with a fresh fetched_at still holds (the store\'s ends_at rule)', (t) => {
  for (const reset of [null, 0]) {
    const h = home(t)
    store(h, [row('login-a', 40, 40, { reset })])
    assert.deepEqual([pace(h, 'login-a').pace, pace(h, 'login-a').why], [0.5, null], String(reset))
  }
})

test('each reading it cannot use gives a share of nothing with its why', (t) => {
  for (const [name, setup, login, why] of [
    ['no store', () => {}, 'login-a', 'no store'],
    ['unreadable JSON', (h) => store(h, [], '{not json'), 'login-a', 'unreadable'],
    ['accounts not a list', (h) => store(h, [], '{"version": 1, "accounts": {}}'), 'login-a', 'unreadable'],
    ['a stale Fable window (3 h)', (h) => store(h, [row('login-a', 40, 40, { at: T - 3 * 3600, generalAt: T - 60 })]), 'login-a', 'stale (fable fetched 3h 0m ago)'],
    ['a dated reset that has passed', (h) => store(h, [row('login-a', 40, 40, { reset: T - 60 })]), 'login-a', 'reset passed'],
    ['a stamp ahead', (h) => store(h, [row('login-a', 40, 40, { at: T + 3600 })]), 'login-a', 'stamp ahead'],
    ['no Fable window', (h) => store(h, [row('login-a', undefined, 40)]), 'login-a', 'no Fable window'],
    ['no row for the Login', (h) => store(h, [row('login-b', 40, 40)]), 'login-a', 'no row for login-a'],
    ['no Login', (h) => store(h, [row('login-a', 40, 40)]), null, 'no Login'],
  ]) {
    const h = home(t)
    setup(h)
    const out = pace(h, login)
    assert.equal(out.why, why, name)
    assert.equal(out.pace, 0, name)
    assert.deepEqual(out.share, { 'master-review': 0, builder: 0, lead: 0 }, name)
    assert.deepEqual([out.fable, out.general, out.fetchedAt], [null, null, null], name)
  }
})

test('five Logins each pace from their own row, a sixth reads no row; two rows for one Login, the freshest wins', (t) => {
  const h = home(t)
  const logins = { 'login-a': [40, 40, 0.5], 'login-b': [60, 20, 0.25], 'login-c': [30, 50, 0.7], 'login-d': [100, 10, 0], 'login-e': [0, 99.5, 1] }
  store(h, [
    ...Object.entries(logins).map(([l, [f, g]]) => row(l, f, g)),
    row('login-a', 90, 10, { at: T - 1800 }),   // an older row for login-a: the freshest (above) wins
    { provider: 'openai', account: 'x', profile: 'login-f', windows: [] },
  ])
  for (const [l, [, , want]] of Object.entries(logins)) assert.equal(pace(h, l).pace, want, l)
  assert.equal(pace(h, 'login-f').why, 'no row for login-f', 'a sixth Login (an openai row is no Claude Login)')
})

test('AGENT_QUOTAS_STORE is honoured, and a role absent from the ceiling is absent from the share', (t) => {
  const h = home(t)
  const elsewhere = path.join(h, 'other.json')
  fs.writeFileSync(elsewhere, JSON.stringify({ version: 1, accounts: [row('login-a', 60, 20)] }))
  store(h, [row('login-a', 40, 40)])
  assert.equal(pace(h, 'login-a', { AGENT_QUOTAS_STORE: elsewhere }).pace, 0.25)
  assert.equal(pace(h, 'login-a', { AGENT_QUOTAS_STORE: '' }).pace, 0.5, 'an empty value counts as unset')
  assert.deepEqual(pace(h, 'login-a', {}, { builder: 0.5 }).share, { builder: 0.25 })
})
