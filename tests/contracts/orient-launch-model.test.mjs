// Orient's launch-model history: ADR 0023 superseded ADR 0010's cmux launches with native child batches, and ADR
// 0040 has since retired orient's batches altogether (pinned in execution-fit-shapes.test.mjs: the steering, the
// § 8 and § 10 tombstones, and no batch machinery left in orient). What this file still pins: the ADR chain (0023
// accepted, 0010 superseded, 0003's status paragraph pointing on), the retired cmux-era launch vocabulary kept out
// of orient, and README and execution-fit free of cmux and cc-* batches with README's ADR 0010 lineage intact.
// Every phrase check runs on collapsed text, so a reflowed line can neither hide nor fake a match. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertHas, collapse, lineOf, read, section, slice, walk } from '../lib/contract-text.mjs'

const ORIENT = 'skills/orient/SKILL.md'
const README = 'README.md'
const FIT = 'skills/_shared/execution-fit.md'
const ADR10 = 'docs/adr/0010-orient-launches-its-own-batches.md'
const ADR03 = 'docs/adr/0003-orient-is-project-altitude-next.md'

const orient = read(ORIENT)
const C = (s) => (s == null ? null : collapse(s))

// The retired launch vocabulary: none of it may survive in orient (case-insensitive, on collapsed text, since
// two of the old sites wrapped across lines).
const FORBIDDEN = [
  /background scoped session/i,
  /cc-\*`?\s*batch/i,
  /fire-and-forget/i,
  /\*\*Profile fit\*\*/i,
  /\(ADR 0010\)/i,
  /profile's MCP namespaces/i,
  /\*\*`git status` first\*\*/i,
  /limited to bare `cc`/i,
  /background batch/i,
  /-newermt/i,
  /no end line of (the same|its) run and job after it/i,
  /`find <path> -path '\*\/\.git'/i,
]
const forbidden = (text) => FORBIDDEN.filter((re) => re.test(collapse(text))).map(String)

test('ADR 0023 exists once, accepted, superseding ADR 0010, in the house format', () => {
  const files = walk('docs/adr').filter((f) => /^docs\/adr\/0023-[^/]*\.md$/.test(f))
  assert.equal(files.length, 1, `expected exactly one docs/adr/0023-*.md, found ${JSON.stringify(files)}`)
  const t = read(files[0])
  assert.match(t, /^Status: accepted, shipped in 3\.1\.0\b[^(\n]*\(supersedes ADR 0010; amends ADR 0003\)/m)
  for (const h of ['Context', 'Decision', 'Rejected', 'Consequences']) {
    assert.match(t, new RegExp(`^## ${h}$`, 'm'), `ADR 0023 has no ## ${h}`)
  }
  const consequences = C(section(t, /^## Consequences$/))
  assertHas(consequences, 'ADR 0023 § Consequences', ['CONTEXT.md', /config dir/, /no task owns the rewrite yet/])
  assert.doesNotMatch(consequences, /follow-up task owns the rewrite/)
  assertHas(C(section(t, /^## Decision$/)), 'ADR 0023 § Decision', [
    /narrows the grilled rule that `git status`/,
    /`--debrief` collects and accepts only in the lead's own session/,
    /`claude --resume <id>`/,
    /`--fork-session`/,
    /uncollected envelopes are lost/,
    'ADR 0029',
    /top rung/,
    /names the same run and job, in any order/,
    /`run_in_background: true`/,
    /a note that already holds that run and job's end line gets none/,
    /`issued:` instant \(UTC, whole seconds\)/,
    /`find -H <path> -path '\*\/\.git' -prune -o -newer <ref> -print`/,
    /`-H` follows an owned path that is a symlink to a directory/,
    /A probe that errors is a stop/,
  ])
  assert.doesNotMatch(C(section(t, /^## Decision$/)), /`find <path> -path/, 'ADR 0023 still names the probe without `-H`')
})

test('ADR 0010 is superseded by 0023 on its Status line, with its body kept', () => {
  const t = read(ADR10)
  const status = lineOf(t, 'Status:')
  assertHas(status, `${ADR10} Status line`, [/^Status: superseded by ADR 0023/, /ADR 0003/])
  assertHas(t, ADR10, ['## Decision', 'cmux workspace create'])
})

test("ADR 0003's status paragraph points on to ADR 0023", () => {
  assertHas(slice(read(ADR03), /^Status:/, /^$/), `${ADR03} status paragraph`, [/ADR 0023/])
})

test('orient carries none of the retired launch vocabulary', () => {
  assert.deepEqual(forbidden(orient), [])
})

test('README and execution-fit carry no cmux or cc-* batch, and README keeps the ADR 0010 lineage', () => {
  const readme = read(README)
  const fit = read(FIT)
  for (const [name, text] of [[README, readme], [FIT, fit]]) {
    assert.ok(!/cmux/i.test(collapse(text)), `${name} mentions cmux`)
    assert.ok(!/cc-\*`?\s*batch/i.test(collapse(text)), `${name} mentions cc-* batches`)
  }
  assertHas(collapse(readme), README, [/`0010` — [^.]*superseded by `?0023/])
  const row = lineOf(readme, '| `/thread:orient` |')
  assert.ok(row != null, `${README} has no orient row`)
  assert.doesNotMatch(row, /ADR 0010/, `${README} orient row still cites ADR 0010 for the launch`)
  assert.doesNotMatch(row, /launches itself/, `${README} orient row still has orient launch its own sessions`)
})

test('control: the forbidden matcher flags each retired phrase, wrapped or backticked', () => {
  for (const bad of ['Fire-and-forget remains the default', 'cc-* batches', '`cc-*` batches', 'cc-*\n  batches',
    '(ADR 0010)', '**Profile fit**', "verify the profile's MCP namespaces", '**`git status` first**',
    'background\n    scoped sessions', 'limited to bare `cc`/project-root launchers', 'fan out\n  background batches',
    'If `find <path> -newermt <issued:>` lists an owned path',
    'with no end line of the same run and job after it', 'with no end line of\n  its run and job after it',
    "run `find <path> -path '*/.git' -prune -o -newer \"$ref\" -print`"]) {
    assert.equal(forbidden(bad).length, 1, `expected exactly one forbidden hit for: ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(forbidden('native child agents of this session (ADR 0023)'), [])
})
