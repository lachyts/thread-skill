// Orient's launch model (ADR 0023, superseding ADR 0010): orient dispatches its session-lane batches as
// native child agents of its own session, through the shared exchange, and a batch lands once. The checks
// pin the retired launch vocabulary out of orient, the README and the execution-fit doc; the ADR chain
// (0023 accepted, 0010 superseded, 0003's status paragraph pointing on); and the double-dispatch guard's
// rule phrases at both ends, orient's dispatch step and each batch prompt's Twin check. Every phrase check
// runs on collapsed text, so a reflowed line can neither hide nor fake a match. Reads files only.
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
]
const forbidden = (text) => FORBIDDEN.filter((re) => re.test(collapse(text))).map(String)

// The Twin check's step 3 order: the mtime probe, then its STOP, then the aborted-partial reading.
const TWIN_ORDER = /-newermt <issued:>[\s\S]*?STOP[\s\S]*?only before `issued:`[\s\S]*?aborted partial/

// § 10's stamp-clearing rule: "never launched" needs a journal that exists; a stamp with none is unknown.
const DEBRIEF_NEVER_LAUNCHED = [
  /dispatch line names a run whose journal exists and records no bound child/,
  /A stamp with no dispatch line, or whose named journal is missing[^.]*is unknown[^.]*keeps its 7 days/,
]
const debriefFails = (s10) => DEBRIEF_NEVER_LAUNCHED.filter((re) => !re.test(collapse(s10))).map(String)

test('ADR 0023 exists once, accepted, superseding ADR 0010, in the house format', () => {
  const files = walk('docs/adr').filter((f) => /^docs\/adr\/0023-[^/]*\.md$/.test(f))
  assert.equal(files.length, 1, `expected exactly one docs/adr/0023-*.md, found ${JSON.stringify(files)}`)
  const t = read(files[0])
  assert.match(t, /^Status: accepted \(supersedes ADR 0010\)/m)
  for (const h of ['Context', 'Decision', 'Rejected', 'Consequences']) {
    assert.match(t, new RegExp(`^## ${h}$`, 'm'), `ADR 0023 has no ## ${h}`)
  }
  assertHas(C(section(t, /^## Consequences$/)), 'ADR 0023 § Consequences', ['CONTEXT.md', /config dir/])
  assertHas(C(section(t, /^## Decision$/)), 'ADR 0023 § Decision', [
    /narrows the grilled rule that `git status`/,
    /`--debrief` collects and accepts only in the lead's own session/,
    /`claude --resume <id>`/,
    /`--fork-session`/,
    /uncollected envelopes are lost/,
    'ADR 0029',
    /top rung/,
  ])
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

test('orient cites ADR 0023, carries the guard and the Twin check, and names tier and effort', () => {
  assertHas(orient, ORIENT, ['ADR 0023', /double-dispatch guard/i, /twin check/i])
  assertHas(C(slice(orient, /^- \*\*Header\*\*/, /^- \*\*(?!Header)/)), `${ORIENT} emission Header`, [
    '`Dispatch:`', '`issued:`', '`Run:`', '`Job:`', '`Lead:`', '`Covers:`', '`Owns:`',
    /<harness> <config dir> <peer name> \[<ref>\]/,
    '${CLAUDE_CONFIG_DIR:-$HOME/.claude}',
  ])
  assertHas(C(section(orient, /^### 8\./)), `${ORIENT} § 8`, ['ladder.py', 'ADR 0029', /no child inherits a default silently/])
  assertHas(C(slice(orient, /^- \*\*Preflight\*\*/, /^- \*\*/)), `${ORIENT} Preflight`, [/inherited from the lead session/])
  assertHas(C(slice(orient, /^## Don't/, null)), `${ORIENT} § Don't`, [/another session's run journal/])
})

test('orient § 2 reads the run lines from note bodies and counts an open start claim as in flight', () => {
  const s2 = slice(orient, /^### 2\./, /^### 3\./)
  assertHas(C(slice(s2, /^- \*\*Vault\*\*/, /^- /)), `${ORIENT} § 2 Vault`, ["rg -n 'orient (start|dispatch|end): run'"])
  assertHas(C(slice(s2, /^- \*\*In flight\*\*/, /^- /)), `${ORIENT} § 2 In flight`, [
    /`dispatched:` stamp or an orient start claim ≤7 days old/,
    /Vault body read finds them/,
  ])
})

test('the Double-dispatch guard has four rules and each rule phrase', () => {
  const guard = slice(orient, /^#### Double-dispatch guard/, /^#{2,4} /)
  assert.ok(guard != null, `${ORIENT} has no #### Double-dispatch guard`)
  const numbered = guard.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.match(/^(\d+)\./)[1])
  assert.deepEqual(numbered, ['1', '2', '3', '4'])
  assertHas(collapse(guard), 'Double-dispatch guard', [
    /`options\.label` equals its key/,
    /`requests\[\]\.key` is an engine path and is never matched/,
    /no request, or only `pending` ones, was never claimed/,
    /`accepted`, `interrupted`, `blocked` or `denied` is settled/,
    /append `-2`, `-3`/,
    /never reused or overwritten/,
    /names it again/,
    /override of <prior run dir>/,
    /an abandoned verdict never frees work on its own before that window/,
    /A peer list shows only its own config dir's sessions/,
    /no peer list, no ref, another config dir/,
    /the clock decides[^;]*≤7 days old/,
    /a listed ref is a live lead/,
    /a missing one is gone/,
    /Never a second `init`, never a replacement spawn/,
    /Never call a helper on, edit, move or advance a foreign run/,
    /_shared\/\.scratch\/orient\/<area-slug>\//,
    /check-ignore -q/,
    /Check from the anchor, which always exists/,
    /Never `git -C <home>`/,
    /git -C <anchor> rev-parse --is-inside-work-tree/,
    /git -C <anchor> check-ignore -q <home below the anchor>\/runs\/x\/run\.json/,
    /never creates the run dir: `init` makes it private \(mode 700\)/,
    /Immediately after a batch's `bind`, before the next spawn/,
    /`dispatched:` stamp or an orient start claim ≤7 days old/,
  ])
})

test('the Twin check stops on a live twin before any git probe and reconciles only older partials', () => {
  const twin = C(slice(orient, /^- \*\*Twin check/, /^- \*\*(?!Twin)/))
  assert.ok(twin != null, `${ORIENT} has no Twin check bullet`)
  const stop = twin.indexOf('STOP')
  const git = twin.indexOf('git status')
  assert.ok(stop >= 0 && git >= 0 && stop < git, 'the first STOP does not come before the first `git status`')
  assertHas(twin, `${ORIENT} Twin check`, [
    TWIN_ORDER,
    /own `Run:` and `Job:`/,
    /`Owns:` only, never a `Covers:` note/,
    /never the Obsidian vault/,
    /git log --all --since=<issued:>/,
    /never by `checkout`, `reset`, `clean` or `stash`/,
    /orient start: run <Run:>, job <Job:>/,
  ])
})

test('§ 10 --debrief recovers only its own runs and never calls a journal-less stamp never launched', () => {
  const s10 = C(section(orient, /^### 10\./))
  assertHas(s10, `${ORIENT} § 10`, [
    /claude --resume <id>/,
    /--fork-session/,
    /uncollected envelopes are lost/,
    /A stamp inside its 7 days stays, an abandoned run's included/,
  ])
  assert.deepEqual(debriefFails(s10), [])
  assert.doesNotMatch(s10, /fire-and-forget/i)
})

test('README and execution-fit carry the native model and no cmux or cc-* batch', () => {
  const readme = read(README)
  const fit = read(FIT)
  for (const [name, text] of [[README, readme], [FIT, fit]]) {
    assert.ok(!/cmux/i.test(collapse(text)), `${name} mentions cmux`)
    assert.ok(!/cc-\*`?\s*batch/i.test(collapse(text)), `${name} mentions cc-* batches`)
  }
  assertHas(collapse(readme), README, ['ADR 0023', /`0010` — [^.]*superseded by `?0023/])
  assertHas(C(section(readme, /^## Runtime support/)), `${README} § Runtime support`, [/native child/, /blocked/])
  assertHas(collapse(fit), FIT, [/orient's parallel-safe native batches \(ADR 0023\)/])
})

test('control: the forbidden matcher flags each retired phrase, wrapped or backticked', () => {
  for (const bad of ['Fire-and-forget remains the default', 'cc-* batches', '`cc-*` batches', 'cc-*\n  batches',
    '(ADR 0010)', '**Profile fit**', "verify the profile's MCP namespaces", '**`git status` first**',
    'background\n    scoped sessions']) {
    assert.equal(forbidden(bad).length, 1, `expected exactly one forbidden hit for: ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(forbidden('native child agents of this session (ADR 0023)'), [])
})

test('control: the Twin check order rejects a STOP placed before the mtime probe', () => {
  assert.doesNotMatch('STOP if `find <path> -newermt <issued:>` lists it … only before `issued:` … aborted partial', TWIN_ORDER)
  assert.match('if `find <path> -newermt <issued:>` lists it: STOP. Modified only before `issued:`: an aborted partial', TWIN_ORDER)
})

test('control: the § 10 check rejects the old journal-free "never launched" sentence', () => {
  const old = 'Clear a stale `dispatched:`: older than 7 days with no progress line, or never launched (no bound child ' +
    "in its journal). A stamp inside its 7 days stays, an abandoned run's included."
  assert.equal(debriefFails(old).length, 2)
})
