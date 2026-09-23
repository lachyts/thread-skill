// skills/_shared/scripts/resolve-day.py — the portable day resolver behind task-writer § 3 (defer).
//
// It replaced the BSD-only `date -v +1d`, which GNU date and Git Bash reject. The clock is injected with
// --now so each case pins an instant, including three around Melbourne's DST change (AEST +10 → AEDT +11
// at 02:00 on Sun 2026-10-04) that catch the two naive approaches: adding 86,400 s to the instant, and
// taking the date in UTC or at a fixed offset. Hermetic: python3 on the shipped file, nothing written.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'resolve-day.py')

function run(args, { env = {}, pyFlags = [] } = {}) {
  const r = spawnSync('python3', [...pyFlags, SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function assertResolves(args, expected) {
  const r = run(args)
  assert.equal(r.stderr, '', `stderr for ${JSON.stringify(args)}`)
  assert.equal(r.status, 0, `status for ${JSON.stringify(args)}`)
  assert.equal(r.stdout, `${expected}\n`)
}

function assertRefused(args) {
  const r = run(args)
  assert.equal(r.status, 2, `status for ${JSON.stringify(args)}; stderr: ${r.stderr}`)
  assert.equal(r.stdout, '', 'nothing on stdout on failure')
  assert.match(r.stderr, /^resolve-day: \S.*\n$/, 'one prefixed line on stderr')
}

const WED_NOON = '2026-09-23T02:00:00Z' // Wed 2026-09-23 12:00 AEST

// [name, --now, argv after --now, expected]
const CASES = [
  ['DST eve, no day: adding 86,400 s to the instant would give Mon', '2026-10-03T13:30:00Z', [], '2026-10-04 Sun'],
  ["just after Melbourne midnight, no day: UTC's date (still Sat) would give Sun", '2026-10-03T14:30:00Z', [], '2026-10-05 Mon'],
  ['first night of AEDT, no day: a fixed +10 offset (Sun 23:30) would give Mon', '2026-10-04T13:30:00Z', [], '2026-10-06 Tue'],
  ['sunday said on DST eve (Sat 23:30)', '2026-10-03T13:30:00Z', ['sunday'], '2026-10-04 Sun'],
  ['saturday said on a Saturday is +7, never today', '2026-10-03T13:30:00Z', ['saturday'], '2026-10-10 Sat'],
  ['fri on Wed 2026-09-23 (E2E verb 12 parity)', WED_NOON, ['fri'], '2026-09-25 Fri'],
  ['Wednesday said on a Wednesday is +7', WED_NOON, ['Wednesday'], '2026-09-30 Wed'],
  ['next tue means the same as tue', WED_NOON, ['next tue'], '2026-09-29 Tue'],
  ['ISO date', WED_NOON, ['2026-12-24'], '2026-12-24 Thu'],
  ['D mon', WED_NOON, ['24 dec'], '2026-12-24 Thu'],
  ['mon D', WED_NOON, ['dec 24'], '2026-12-24 Thu'],
  // Beyond the note's table.
  ['tomorrow is the same as no day', WED_NOON, ['tomorrow'], '2026-09-24 Thu'],
  ['next tue as two argv words (unquoted call)', WED_NOON, ['next', 'tue'], '2026-09-29 Tue'],
  ['case and surrounding whitespace are ignored', WED_NOON, ['  FRI '], '2026-09-25 Fri'],
]

for (const [name, now, args, expected] of CASES) {
  test(`resolves: ${name}`, () => assertResolves(['--now', now, ...args], expected))
}

const REFUSALS = [
  ['a past ISO date', ['--now', WED_NOON, '2026-09-01']],
  ['a D mon date already past this year', ['--now', WED_NOON, '20 jul']],
  ['an unknown day', ['--now', WED_NOON, 'blursday']],
  ['a naive --now', ['--now', '2026-09-23T12:00:00', 'fri']],
  ['an invalid calendar date', ['--now', WED_NOON, '2026-02-30']],
]

for (const [name, args] of REFUSALS) {
  test(`refuses with exit 2: ${name}`, () => assertRefused(args))
}

test('exit 3 when there is no tz data for Australia/Melbourne — never a local or UTC fallback', () => {
  // -S keeps a pip-installed tzdata off sys.path; PYTHONTZPATH points the system lookup at nothing.
  const r = run(['--now', WED_NOON, 'fri'], { env: { PYTHONTZPATH: '/nonexistent' }, pyFlags: ['-S'] })
  assert.equal(r.status, 3, `stderr: ${r.stderr}`)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^resolve-day: .*install tzdata: python3 -m pip install tzdata/)
})

test('smoke: the real clock resolves to one YYYY-MM-DD Ddd line', () => {
  const r = run([])
  assert.equal(r.stderr, '')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /^\d{4}-\d{2}-\d{2} (Mon|Tue|Wed|Thu|Fri|Sat|Sun)\n$/)
})
