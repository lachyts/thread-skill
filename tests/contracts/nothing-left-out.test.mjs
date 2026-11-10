// Nothing is left out silently (ADR 0078 d7, p45-5). Orient, schedule and orient-all each name every task they keep out
// of a rollout, and a cross-project `depends-on:` nothing holds is written on the dependant's rollout note, as
// `waits on [[x]] (<Project>, not scheduled)` (skills/_shared/scripts/waits-on.py), which the next estate pass lists.
//   n1 the prose: orient § 6's Left-out list and its reasons, § 7's exclusions and § 6's stop report feed it; schedule
//      passes `clone --tasks`, prints the refusal's task line, and runs waits-on before clearing `incomplete:` (step 7
//      and S6); orient-all § 3 and § 8 list `rounds.waitsOn[]`.
//   n2 `unfinished-rollout.py`'s refusal names the tasks the run would have taken, by the run's own selection, for
//      each kind of refusal (a table over the parallel check, the serial check and `clone`).
//   n3 waits-on.py writes only a live dependant's unheld other-project dependency, follows a fold to its unit, and
//      rewrites the section as it stands.
// Spawns git once and each script a handful of times; it reads no real vault.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collapse, read, root, section } from '../lib/contract-text.mjs'

const CHECK = path.join(root, 'skills/_shared/scripts/unfinished-rollout.py')
const WAITS = path.join(root, 'skills/_shared/scripts/waits-on.py')
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nothing-left-out-')))
after(() => fs.rmSync(TMP, { recursive: true, force: true }))
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
Object.assign(ENV, { HOME: TMP, THREAD_EVENTS_DIR: path.join(TMP, 'events'), THREAD_NOTE_LOCK_DIR: path.join(TMP, 'locks') })

const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text) }
const links = (key, list) => (list.length ? `${key}:\n${list.map((x) => `  - "[[${x}]]"`).join('\n')}\n` : '')
const taskNote = (status, projects, { rollout, deps = [], tags = ['task'], extra = '' } = {}) =>
  `---\ntags: [${tags.join(', ')}]\nstatus: ${status}\n${links('projects', projects)}` +
  `${rollout ? `rollout: "[[${rollout}]]"\n` : ''}${links('depends-on', deps)}${extra}---\n\n# Task\n`
const rolloutNote = (projects, rootLine, body = '') =>
  `---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n${links('projects', projects)}---\n\n## Notes\n\n` +
  `Project root: \`${rootLine}\`\n\n## Queue\n\n| # | Task |\n|---|---|\n${body}\n## Post-rollout\n\n1. Move it.\n`

const flat = (text, heading) => collapse(section(text, heading) ?? '')

test('n1. the prose carries every listing', () => {
  const orient = read('skills/orient/SKILL.md')
  const schedule = read('skills/schedule/SKILL.md')
  const orientAll = read('skills/orient-all/SKILL.md')
  const route = flat(orient, /^### 6\. Route/)
  const serial = flat(orient, /^### 7\. Autonomous/)
  const s0 = flat(schedule, /^### 0\. /)
  const s7 = flat(schedule, /^### 7\. Update/)
  const s8 = flat(schedule, /^### 8\. Print/)
  const serialPath = flat(schedule, /^## Serial path/)
  const rows = [
    ['orient § 6', route, ['**The left-out list', 'Left out of the rollout:', 'open fork:', 'conversation-gated', 'in flight',
      'handed to you (Mixed)', 'Not now', 'would have taken']],
    ['orient § 7', serial, ['§ 6\'s left-out list']],
    ['schedule § 0', s0, ['clone --repo <the Local: path> --project <§ 0\'s project> [--tasks <this run\'s --tasks list>]',
      '`this run would have taken:`']],
    ['schedule step 7', s7, ['scripts/waits-on.py write --rollout', 'waits on [[x]] (<Project>, not scheduled)']],
    ['schedule step 8', s8, ['Waits on:']],
    ['schedule S6', serialPath, ['**S6. Stamp.**', 'scripts/waits-on.py write --rollout']],
    ['orient-all § 3', flat(orientAll, /^### 3\. /), ['`rounds.waitsOn[]`']],
    ['orient-all § 8', flat(orientAll, /^### 8\. /), ['`rounds.waitsOn[]`', 'not scheduled']],
    ['vault-grammar', read('skills/_shared/vault-grammar.md'), ['## Waits on', '`waits-on.py write`']],
  ]
  for (const [name, text, patterns] of rows) {
    for (const p of patterns) assert.ok(text.includes(p), `${name} does not name ${p}`)
  }
  // Each schedule site writes the lines before its note's `incomplete: true` comes off (a stop in between keeps the stamp).
  for (const text of [s7, serialPath]) {
    const write_ = text.indexOf('scripts/waits-on.py write --rollout')
    const clear = text.indexOf('`incomplete: true`', write_)
    assert.ok(write_ >= 0 && clear > write_, 'waits-on runs before `incomplete: true` is removed')
  }
})

// One vault: another project's unfinished rollout rooted in the repo refuses every kind of run.
const R = path.join(TMP, 'repo')
fs.mkdirSync(R, { recursive: true })
execFileSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', R], { env: ENV })
execFileSync('git', ['-C', R, 'remote', 'add', 'origin', 'https://github.com/demo/repo.git'], { env: ENV })
const T = path.join(TMP, 'vault/Work/Tasks')
write(path.join(T, 'ro-o.md'), rolloutNote(['Other'], R))
write(path.join(T, 'o-t.md'), taskNote('in_progress', ['Other'], { rollout: 'ro-o', extra: 'owner: lead-x\n' }))
write(path.join(T, 'demo-a.md'), taskNote('open', ['Demo']))
write(path.join(T, 'demo-b.md'), taskNote('open', ['Demo']))
write(path.join(T, 'demo-done.md'), taskNote('done', ['Demo']))
write(path.join(T, 'demo-held.md'), taskNote('open', ['Demo'], { rollout: 'ro-o' }))
write(path.join(T, 'demo-decide.md'), taskNote('open', ['Demo'], { tags: ['task', 'decisions'] }))
write(path.join(T, 'o-open.md'), taskNote('open', ['Other']))

test('n2. a refusal names the tasks the run would have taken', () => {
  const both = 'this run would have taken: [[demo-a]], [[demo-b]]'
  const one = 'this run would have taken: [[demo-b]]'
  const rows = [
    ['parallel check, --project', ['check', '--repo', R, '--project', 'Demo'], 'refuse ro-o', both],
    ['parallel check, --tasks', ['check', '--repo', R, '--tasks', 'demo-b'], 'refuse ro-o', one],
    ['serial check, --project', ['check', '--shape', 'serial', '--surface', `repo:${R}`, '--project', 'Demo'], 'refuse ro-o', both],
    ['clone, --project', ['clone', '--repo', R, '--project', 'Demo'], 'refuse ro-o', both],
    ['clone, --tasks', ['clone', '--repo', R, '--project', 'Demo', '--tasks', 'demo-b'], 'refuse ro-o', one],
  ]
  for (const [name, args, line, taken] of rows) {
    const r = spawnSync('python3', [CHECK, args[0], '--tasks-dir', T, ...args.slice(1)], { encoding: 'utf8', env: ENV })
    assert.equal(r.status, 3, `${name}: ${r.stderr}`)
    assert.equal(r.stdout.trim(), line, name)
    const lines = r.stderr.split('\n')
    assert.ok(lines.includes(taken), `${name}: stderr lacks "${taken}": ${r.stderr}`)
    assert.ok(!r.stderr.includes('[[demo-done]]') && !r.stderr.includes('[[demo-held]]') && !r.stderr.includes('[[demo-decide]]'),
      `${name}: names a task step 1 would not take: ${r.stderr}`)
  }
})

test('n3. waits-on writes one line per unheld other-project dependency of a live dependant, and tracks the note', () => {
  const V = path.join(TMP, 'waits/Work/Tasks')
  const ro = path.join(V, 'ro-d.md')
  write(ro, rolloutNote(['Demo'], '/tmp/root'))
  write(path.join(V, 'd-t.md'), taskNote('open', ['Demo'], { rollout: 'ro-d',
    deps: ['x-other', 'same-proj', 'held-dep', 'landed-dep', 'folded', 'no-such'] }))
  write(path.join(V, 'd-dropped.md'), taskNote('dropped', ['Demo'], { rollout: 'ro-d', deps: ['x-other'] }))
  write(path.join(V, 'x-other.md'), taskNote('open', ['Other']))
  write(path.join(V, 'same-proj.md'), taskNote('open', ['Demo']))
  write(path.join(V, 'held-dep.md'), taskNote('open', ['Other'], { rollout: 'ro-live' }))
  write(path.join(V, 'ro-live.md'), rolloutNote(['Other'], '/tmp/other'))
  write(path.join(V, 'landed-dep.md'), taskNote('done', ['Other']))
  write(path.join(V, 'folded.md'), taskNote('merged', ['Other'], { extra: 'merged_into: "[[fold-unit]]"\n' }))
  write(path.join(V, 'fold-unit.md'), taskNote('open', ['Far']))
  const run = () => {
    const r = spawnSync('python3', [WAITS, 'write', '--rollout', ro, '--tasks-dir', V], { encoding: 'utf8', env: ENV })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout
  }
  const first = run()
  const lines = fs.readFileSync(ro, 'utf8').split('\n').filter((l) => l.includes('waits on'))
  assert.deepEqual(lines, ['- [[d-t]] waits on [[x-other]] (Other, not scheduled)',
    '- [[d-t]] waits on [[fold-unit]] (Far, not scheduled)'])
  assert.match(first, /2 waits/)
  assert.ok(fs.readFileSync(ro, 'utf8').includes('## Post-rollout'), 'the note keeps its other sections')
  const once = fs.readFileSync(ro, 'utf8')
  run()
  assert.equal(fs.readFileSync(ro, 'utf8'), once, 'a re-run is byte-identical')
  write(path.join(V, 'x-other.md'), taskNote('open', ['Other'], { rollout: 'ro-live' }))
  write(path.join(V, 'fold-unit.md'), taskNote('done', ['Far']))
  assert.match(run(), /none/)
  assert.ok(!fs.readFileSync(ro, 'utf8').includes('## Waits on'), 'nothing waiting removes the section')
})
