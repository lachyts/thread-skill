// skills/reflect/scripts/escapes.py through score.py (p21-4, ADR 0037 d7): a rollout's Escapes are the task notes
// whose `fixes:` names one of its landed tasks, the reverts of its merges and the later review findings against its
// lines, deduped per landed task; Quality = 1 - Escapes / landed.
//
// Hermetic: each case gets its own mkdtemp HOME and THREAD_EVENTS_DIR, an env built from scratch (no inherited GIT_*),
// an empty global git config (GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM) and a pinned identity, with every commit's
// author and committer dates pinned by a per-repo clock. The work repo's only remote is a local bare `origin.git`
// (push, fetch, `git remote set-head origin main`), and the vault is a temp `vault/Work/Tasks` with an `Archive/`.
// Record lines go through run_record.py's own emit. A "squash merge" is a commit on main whose subject ends ` (#N)`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCORE = path.join(root, 'skills', 'reflect', 'scripts', 'score.py')
const RUN_RECORD = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')

// ---- helpers ----------------------------------------------------------------------------------------------

function tmpHome(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-escapes-')))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  fs.writeFileSync(path.join(home, 'gitconfig'), '')
  return home
}

const baseEnv = (home, extra = {}) => ({
  PATH: process.env.PATH, HOME: home, PYTHONDONTWRITEBYTECODE: '1', TZ: 'UTC', THREAD_EVENTS_DIR: path.join(home, 'events'),
  GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no',
  GIT_AUTHOR_NAME: 'escapes', GIT_AUTHOR_EMAIL: 'escapes@example.invalid',
  GIT_COMMITTER_NAME: 'escapes', GIT_COMMITTER_EMAIL: 'escapes@example.invalid',
  ...extra,
})

const D = (day, hm) => `2026-10-0${day}T${hm}:00Z`

// A work repo and its bare origin under `home`. Every git call takes the next minute of the repo's clock (or `at`).
class Repo {
  constructor(home, name = 'work') {
    this.home = home
    this.dir = path.join(home, name)
    this.origin = path.join(home, `${name}-origin.git`)
    this.clock = Date.parse('2026-10-05T00:00:00Z')
    this.g(['init', '-q', '--bare', '-b', 'main', this.origin], { cwd: home })
    this.g(['init', '-q', '-b', 'main', this.dir], { cwd: home })
    this.g(['remote', 'add', 'origin', this.origin])
  }

  g(args, { cwd = this.dir, at } = {}) {
    this.clock += 60000
    const stamp = at || new Date(this.clock).toISOString()
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: baseEnv(this.home, { GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp }) })
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout.trim()
  }

  commit(subject, files = {}, { body, at } = {}) {
    for (const [f, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(this.dir, f)), { recursive: true })
      fs.writeFileSync(path.join(this.dir, f), text)
    }
    this.g(['add', '-A'])
    this.g(['commit', '-q', '--allow-empty', '-m', subject, ...(body ? ['-m', body] : [])], { at })
    return this.g(['rev-parse', 'HEAD'])
  }

  // `git revert`'s change under a chosen subject; the body names the reverted sha unless `named` is false.
  revert(sha, subject, { named = true, at } = {}) {
    this.g(['revert', '--no-commit', sha])
    return this.commit(subject, {}, { body: named ? `This reverts commit ${sha}.` : undefined, at })
  }

  merge(branch, message) {
    this.g(['merge', '-q', '--no-ff', branch, '-m', message])
    return this.g(['rev-parse', 'HEAD'])
  }

  checkout(...args) { this.g(['checkout', '-q', ...args]) }

  publish() {
    this.g(['push', '-q', '--all', 'origin'])
    this.g(['fetch', '-q', 'origin'])
    this.g(['remote', 'set-head', 'origin', 'main'])
  }
}

const tasksDir = (home) => path.join(home, 'vault', 'Work', 'Tasks')

// A task note at `<Tasks>/<rel>.md` with these frontmatter lines.
function note(home, rel, fm = ['status: done']) {
  const p = path.join(tasksDir(home), `${rel}.md`)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, ['---', 'tags: [task]', ...fm, '---', '', `# ${path.basename(rel)}`, ''].join('\n'))
}

// Every event through run_record.emit(strict=True) in one python process: [ts, kind, task, fields].
function emitAll(home, rollout, events) {
  const body = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("run_record", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'for ts, kind, task, fields in json.load(sys.stdin):',
    `    assert m.emit(${JSON.stringify(rollout)}, kind, task, fields, ts=ts, strict=True), (kind, task, ts)`,
  ].join('\n')
  const r = spawnSync('python3', ['-B', '-c', body, RUN_RECORD], { encoding: 'utf8', cwd: home, env: baseEnv(home), input: JSON.stringify(events) })
  assert.equal(r.status, 0, r.stderr)
}

const merged = (ts, task, fields = {}) => [ts, 'merged', task, fields]

function run(home, rollout, { repo, tasks = tasksDir(home), slug = 'o/r', since = '2026-10-01T00:00:00Z', until = '2026-10-31T00:00:00Z', env = {} } = {}) {
  const args = ['-B', SCORE, '--rollout', rollout, '--since', since, '--until', until]
  if (repo) args.push('--repo', repo)
  if (tasks) args.push('--tasks-dir', tasks)
  if (slug) args.push('--repo-slug', slug)
  const r = spawnSync('python3', args, { cwd: home, encoding: 'utf8', env: baseEnv(home, env) })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stderr, /^score: \S+: .*\n$/, 'one summary line on stderr')
  return JSON.parse(r.stdout)
}

const has = (list, re) => list.some((x) => re.test(x))
const task = (out, slug) => out.escapes.tasks.find((x) => x.task === slug)
const fixers = (out, slug) => (task(out, slug)?.evidence ?? []).filter((e) => e.source === 'fixes').map((e) => e.note).sort()
const READ = { fixes: 'read', reverts: 'read', reviews: 'read' }

// ---- E1: the task's Verify --------------------------------------------------------------------------------

test('E1: a later fixes: note and a revert give rollout A 2 Escapes and Quality 0; rollout B none', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n' })
  const s1 = w.commit('a1: add a (#1)', { 'a.txt': 'a1\n' })
  const s2 = w.commit('a2: add b (#2)', { 'b.txt': 'b1\n' })
  w.commit('b1: fix a (#3)', { 'a.txt': 'a1 fixed\n' })
  const rv = w.revert(s2, 'Revert "a2: add b (#2)" (#4)')
  w.publish()
  note(home, 'a1'); note(home, 'a2'); note(home, 'b1', ['status: done', 'fixes: "[[a1]]"'])
  emitAll(home, 'ra', [merged(D(5, '01:00'), 'a1', { pr: 1 }), merged(D(5, '02:00'), 'a2', { pr: 2 })])
  emitAll(home, 'rb', [merged(D(6, '01:00'), 'b1', { pr: 3 })])

  const a = run(home, 'ra', { repo: w.dir })
  assert.equal(a.escapes.count, 2)
  assert.equal(a.escapes.landed, 2)
  assert.equal(a.escapes.landed, a.merges.count, 'the landed set is the merges count')
  assert.equal(a.escapes.quality, 0)
  assert.equal(a.headline.quality, 0)
  assert.deepEqual(a.escapes.bySource, { fixes: 1, reverts: 1, reviews: 0 })
  assert.deepEqual(a.escapes.sources, READ, 'a repo that never had docs/reviews/ reads as reviews read')
  assert.equal(a.escapes.reviewDocs, 0)
  assert.equal(a.escapes.partial, false)
  assert.deepEqual(a.escapes.tasks, [
    { task: 'a1', pr: 1, commits: [s1], evidence: [{ source: 'fixes', note: 'b1', status: 'done' }] },
    { task: 'a2', pr: 2, commits: [s2], evidence: [{ source: 'revert', commit: rv, subject: 'Revert "a2: add b (#2)" (#4)' }] },
  ])
  assert.equal(a.escapes.ref.name, 'origin/main')
  assert.equal(a.escapes.ref.tip, rv)
  assert.ok(!has(a.flags, /^escapes: /), a.flags.join('\n'))

  const b = run(home, 'rb', { repo: w.dir })
  assert.equal(b.escapes.count, 0)
  assert.equal(b.escapes.landed, 1)
  assert.equal(b.escapes.quality, 1)
  assert.equal(b.headline.quality, 1)
  assert.deepEqual(b.escapes.tasks, [])
})

// ---- E2: dedupe ---------------------------------------------------------------------------------------------

test('E2: a task fixed and also reverted is one Escape with two pieces of evidence', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n' })
  const s1 = w.commit('a1: add a (#1)', { 'a.txt': 'a1\n' })
  w.commit('a2: add b (#2)', { 'b.txt': 'b1\n' })
  const rv = w.revert(s1, 'Revert "a1: add a (#1)" (#3)')
  w.publish()
  note(home, 'a1'); note(home, 'a2'); note(home, 'fix-a1', ['status: open', 'fixes: "[[a1]]"'])
  emitAll(home, 'ra', [merged(D(5, '01:00'), 'a1', { pr: 1 }), merged(D(5, '02:00'), 'a2', { pr: 2 })])
  const a = run(home, 'ra', { repo: w.dir })
  assert.equal(a.escapes.count, 1)
  assert.equal(a.escapes.quality, 0.5)
  assert.deepEqual(a.escapes.bySource, { fixes: 1, reverts: 1, reviews: 0 })
  assert.deepEqual(task(a, 'a1').evidence, [
    { source: 'fixes', note: 'fix-a1', status: 'open' },
    { source: 'revert', commit: rv, subject: 'Revert "a1: add a (#1)" (#3)' },
  ])
})

// ---- E3: fixes: forms and slugs -------------------------------------------------------------------------------

test('E3: every fixes: form and slug spelling counts, a folded member resolves through merged_into:, and the ignored ones are listed', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n' })
  w.commit('a1: add a (#1)', { 'a.txt': 'a1\n' })
  w.commit('c: combined (#5)', { 'c.txt': 'c\n' })
  w.publish()
  note(home, 'a1', ['status: done', 'fixes: "[[a1]]"'])                           // names itself: self-named
  note(home, 'f-scalar', ['status: open', 'fixes: "[[a1]]"'])
  note(home, 'f-inline', ['status: open', 'fixes: ["[[a1]]", "[[nobody]]"]'])
  note(home, 'f-block', ['status: open', 'fixes:', '  - "[[a1]]"'])
  note(home, 'f-alias', ['status: open', 'fixes: "[[a1|the first]]"'])
  note(home, 'f-case', ['status: open', 'fixes: "[[A1]]"'])
  note(home, 'f-md', ['status: open', 'fixes: a1.md'])
  note(home, 'Archive/f-arch', ['status: done', 'fixes: "[[a1]]"'])
  note(home, 'Archive/f-tomb', ['status: merged', 'merged_into: "[[f-comb]]"', 'fixes: "[[a1]]"'])
  note(home, 'f-comb', ['status: done', 'fixes: "[[a1]]"'])                        // the tombstone's combined note too
  note(home, 'f-dropped', ['status: dropped', 'fixes: "[[a1]]"'])
  note(home, 'f-other', ['status: open', 'fixes: "[[nobody]]"'])
  note(home, 'f-phase', ['status: open', 'fixes: "[[demo-p3-some-phase]]"'])
  note(home, 'c', ['status: done', 'fixes: "[[m1]]"'])                             // a combined note naming its own member
  note(home, 'Archive/M1', ['status: merged', 'merged_into: "[[c]]"'])
  note(home, 'fix-m1', ['status: open', 'fixes: "[[m1]]"'])
  emitAll(home, 'ra', [merged(D(5, '01:00'), 'a1', { pr: 1 })])
  emitAll(home, 'rc', [merged(D(6, '01:00'), 'c', { pr: 5 })])

  const a = run(home, 'ra', { repo: w.dir })
  assert.equal(a.escapes.count, 1)
  assert.deepEqual(fixers(a, 'a1'), ['f-alias', 'f-arch', 'f-block', 'f-case', 'f-comb', 'f-inline', 'f-md', 'f-scalar', 'f-tomb'])
  assert.deepEqual(task(a, 'a1').evidence.find((e) => e.note === 'f-tomb'), { source: 'fixes', note: 'f-tomb', status: 'merged' })
  assert.deepEqual(a.escapes.excluded.selfNamed, [{ note: 'a1', task: 'a1' }])
  assert.deepEqual(a.escapes.excluded.dropped, [{ note: 'f-dropped', task: 'a1' }])
  assert.equal(a.escapes.excluded.unreadNotes, 0)
  assert.ok(!task(a, 'c'), 'fix-m1 names a member of c, which rollout A did not land')

  const c = run(home, 'rc', { repo: w.dir })
  assert.equal(c.escapes.count, 1)
  assert.deepEqual(task(c, 'c').evidence, [{ source: 'fixes', note: 'fix-m1', status: 'open', via: '[[m1]] merged_into [[c]]' }])
  assert.deepEqual(c.escapes.excluded.selfNamed, [{ note: 'c', task: 'c' }], 'c naming its own member is self-named after the fold')
  assert.deepEqual(c.escapes.excluded.dropped, [])
})

// ---- E4: a merge-commit landing ---------------------------------------------------------------------------

test('E4: a revert landed through a Merge pull request commit counts, and a task merged with a merge commit resolves', (t) => {
  // a3's PR (#8, merged with a merge commit) reverts one of its own commits on the way: that is no Escape
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n' })
  const s2 = w.commit('a2: add b (#2)', { 'b.txt': 'b1\n' })
  w.checkout('-b', 'feat')
  const x = w.commit('a3: add d', { 'd.txt': 'd1\n' })
  const y = w.commit('a3: try e', { 'e.txt': 'e1\n' })
  const yr = w.revert(y, 'Revert "a3: try e"')
  w.checkout('main')
  const m8 = w.merge('feat', 'Merge pull request #8 from o/feat')
  w.checkout('-b', 'revert-a2')
  const r2 = w.revert(s2, 'Revert "a2: add b (#2)"')
  w.checkout('main')
  w.merge('revert-a2', 'Merge pull request #9 from o/revert-a2')
  const r3 = w.revert(x, 'Revert "a3: add d" (#10)')
  w.publish()
  note(home, 'a2'); note(home, 'a3')
  emitAll(home, 'ra', [merged(D(5, '01:00'), 'a2', { pr: 2 }), merged(D(5, '02:00'), 'a3', { pr: 8 })])
  const a = run(home, 'ra', { repo: w.dir })
  assert.equal(a.escapes.count, 2)
  assert.deepEqual(task(a, 'a2').evidence, [{ source: 'revert', commit: r2, subject: 'Revert "a2: add b (#2)"' }])
  assert.deepEqual(task(a, 'a3').commits, [m8, yr, y, x], 'the merge commit, then the commits it brought in')
  assert.deepEqual(task(a, 'a3').evidence, [{ source: 'revert', commit: r3, subject: 'Revert "a3: add d" (#10)' }])
  assert.equal(a.escapes.partial, false)
})

// ---- E5: revert variants ----------------------------------------------------------------------------------

test('E5: a subject-only revert counts; a Reapply and a revert origin/main does not reach add nothing', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n' })
  const s1 = w.commit('a1: add a (#1)', { 'a.txt': 'a1\n' })
  const s2 = w.commit('a2: add b (#2)', { 'b.txt': 'b1\n' })
  const s3 = w.commit('a3: add c (#3)', { 'c.txt': 'c1\n' })
  const s4 = w.commit('a4: add e (#4)', { 'e.txt': 'e1\n' })
  const r1 = w.revert(s1, 'Revert "a1: add a (#1)" (#7)', { named: false })
  const r4 = w.revert(s4, 'Revert "a4: add e"', { named: false })
  w.checkout('-b', 'side')
  w.revert(s2, 'Revert "a2: add b (#2)"')
  w.checkout('main')
  const r3 = w.revert(s3, 'Revert "a3: add c (#3)" (#11)')
  w.g(['revert', '--no-commit', r3])
  w.commit('Reapply "a3: add c (#3)" (#12)', {}, { body: `This reverts commit ${r3}.` })
  w.publish()
  for (const s of ['a1', 'a2', 'a3', 'a4']) note(home, s)
  emitAll(home, 'ra', ['a1', 'a2', 'a3', 'a4'].map((s, i) => merged(D(5, `0${i + 1}:00`), s, { pr: i + 1 })))
  const a = run(home, 'ra', { repo: w.dir })
  assert.equal(a.escapes.count, 3)
  assert.deepEqual(task(a, 'a1').evidence, [{ source: 'revert', commit: r1, subject: 'Revert "a1: add a (#1)" (#7)' }], 'subject with its (#N)')
  assert.deepEqual(task(a, 'a4').evidence, [{ source: 'revert', commit: r4, subject: 'Revert "a4: add e"' }], 'subject without its (#N)')
  assert.deepEqual(task(a, 'a3').evidence, [{ source: 'revert', commit: r3, subject: 'Revert "a3: add c (#3)" (#11)' }], 'the Reapply adds nothing')
  assert.ok(!task(a, 'a2'), 'a revert only on origin/side never counts')
})

// ---- E6: the chorus shape ---------------------------------------------------------------------------------

test('E6: a squash reachable only through a second parent still resolves, and its revert counts', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n' })
  w.checkout('-b', 'topic')
  w.commit('topic work', { 't.txt': 't\n' })
  w.checkout('main')
  const s1 = w.commit('a1: add a (#1)', { 'a.txt': 'a1\n' })
  w.checkout('topic')
  w.merge('main', "Merge branch 'main' into topic")
  w.checkout('main')
  w.g(['merge', '-q', '--ff-only', 'topic'])
  const r1 = w.revert(s1, 'Revert "a1: add a (#1)" (#6)')
  w.publish()
  assert.ok(!w.g(['rev-list', '--first-parent', 'origin/main']).split('\n').includes(s1), 'fixture: (#1) is off the first-parent line')
  note(home, 'a1')
  emitAll(home, 'ra', [merged(D(5, '01:00'), 'a1', { pr: 1 })])
  const a = run(home, 'ra', { repo: w.dir })
  assert.equal(a.escapes.count, 1)
  assert.deepEqual(task(a, 'a1').commits, [s1])
  assert.deepEqual(task(a, 'a1').evidence, [{ source: 'revert', commit: r1, subject: 'Revert "a1: add a (#1)" (#6)' }])
})

// ---- E7: the landed map -------------------------------------------------------------------------------------

test('E7: a pr URL resolves, another repo\'s is unresolved and partial, repeated merged lines are one task, read-only never unresolved', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n' })
  w.commit('a1: add a (#1)', { 'a.txt': 'a1\n' })
  w.commit('x: add b (#2)', { 'b.txt': 'b1\n' })
  w.publish()
  note(home, 'a1'); note(home, 'x'); note(home, 'ro'); note(home, 'fix-x', ['status: open', 'fixes: "[[x]]"'])
  emitAll(home, 'r7', [
    merged(D(5, '01:00'), 'a1', { pr: 'https://github.com/o/r/pull/1' }),
    merged(D(5, '01:30'), 'a1', { pr: 'https://github.com/O/R/pull/1' }),
    merged(D(5, '02:00'), 'x', { pr: 'https://github.com/x/other/pull/2' }),
    merged(D(5, '03:00'), 'ro', { readOnly: true }),
  ])
  const a = run(home, 'r7', { repo: w.dir })
  assert.equal(a.merges.count, 3)
  assert.equal(a.escapes.landed, 3)
  assert.equal(a.escapes.count, 1, 'fixes evidence still counts for an unresolved task')
  assert.equal(a.escapes.quality, 0.6667)
  assert.equal(a.escapes.partial, true)
  assert.deepEqual(a.escapes.excluded.unresolved.map((u) => u.task), ['x'])
  assert.match(a.escapes.excluded.unresolved[0].why, /^pr https:\/\/github\.com\/x\/other\/pull\/2 is not o\/r's$/)
  assert.deepEqual(task(a, 'x').commits, [])
  assert.ok(has(a.flags, /^escapes: Quality misses git evidence for 1 landed task\(s\): \[\[x\]\]/), a.flags.join('\n'))
  assert.ok(!has(a.flags.filter((f) => f.startsWith('escapes: ')), /partial Reflection|no baseline/), 'reflect-score keys on these phrases')

  const open = run(home, 'r7', { repo: w.dir, slug: null })
  assert.equal(open.escapes.partial, false, 'with no repo identity a URL is read by its number')
  assert.deepEqual(open.escapes.excluded.unresolved, [])
  assert.ok(has(open.flags, /^escapes: no repo identity: pr URLs are read by their number, unchecked$/), open.flags.join('\n'))
})

// ---- E8: later review findings ------------------------------------------------------------------------------

function reviewDoc(head, status, rows, disposition) {
  const lines = ['---', 'repo: /somewhere/else', `head: ${head}`, 'engine: code-review', 'mode: code', `status: ${status}`, '---', '',
    'Review, verbatim summaries.', '', '| # | file:line | summary | verdict | category |', '|---|---|---|---|---|',
    ...rows.map(([n, cite, verdict]) => `| ${n} | ${cite} | a finding | ${verdict} | — |`), '']
  if (disposition) lines.push('| # | disposition |', '|---|---|', ...disposition.map(([n, d]) => `| ${n} | ${d} |`), '')
  return lines.join('\n')
}

test('E8: a landed later review finding on a landed line counts; the reviewer\'s own lines, rejected rows, pre-merge and unlanded reviews do not', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  const base = w.commit('init', { 'README.md': 'demo\n', 'sub/x.txt': 'x\n' })
  const s3 = w.commit('b1: add c (#3)', { 'c.txt': 'c1\nc2\nc3\nc4\n' })
  // the PR's own branch before its squash, reviewed there: the squash leaves its head off main
  w.checkout('-b', 'b1-pr', base)
  const pre = w.commit('b1 wip', { 'c.txt': 'c1\nc2\nc3\nc4\n' })
  w.commit('review b1 pre-merge', { 'docs/reviews/2026-10-05-pre.md': reviewDoc(pre.slice(0, 7), 'consumed', [[1, 'c.txt:1', '—']]) })
  // a later branch, reviewed after #3 landed and then merged: it rewrote line 3 itself
  w.checkout('main')
  w.checkout('-b', 'rev1')
  const h1 = w.commit('later work', { 'c.txt': 'c1\nc2\nc3 changed\nc4\n' })
  w.commit('review rev1', {
    'docs/reviews/2026-10-06-rev1.md': reviewDoc(h1.slice(0, 7), 'pending',
      [[1, 'c.txt:1', '—'], [2, 'c.txt:3', '—'], [3, 'c.txt:2', '**skip**: not a bug'], [4, 'c.txt:4', '—']],
      [[4, '**deliberate** — kept by design'], [1, 'held for later']]),
  })
  // PR #107's shape: a later branch, reviewed after #3 landed, closed unmerged; its finding cites a line b1 wrote
  w.checkout('main')
  w.checkout('-b', 'closed')
  const hc = w.commit('closed work: renumber', { 'c.txt': 'c1\nc2\nc3\nc4\nc5\n' })
  w.commit('review closed', { 'docs/reviews/2026-10-06-closed.md': reviewDoc(hc.slice(0, 7), 'consumed', [[1, 'c.txt:2', '—']]) })
  w.checkout('main')
  w.merge('rev1', 'Merge pull request #4 from o/rev1')
  w.commit('a review whose head is gone', { 'docs/reviews/2026-10-07-gone.md': reviewDoc('feedface', 'pending', [[1, 'c.txt:1', '—']]) })
  w.publish()
  assert.equal(w.g(['blame', '-L', '2,2', '--porcelain', hc, '--', 'c.txt']).split(' ')[0], s3, 'fixture: the closed review cites a line b1 wrote')
  note(home, 'b1')
  emitAll(home, 'rb', [merged(D(5, '01:00'), 'b1', { pr: 3 })])
  const b = run(home, 'rb', { repo: w.dir })
  assert.equal(b.escapes.count, 1)
  assert.deepEqual(b.escapes.bySource, { fixes: 0, reverts: 0, reviews: 1 })
  assert.equal(b.escapes.reviewDocs, 4)
  assert.deepEqual(task(b, 'b1').commits, [s3])
  assert.deepEqual(task(b, 'b1').evidence, [{
    source: 'review', doc: 'docs/reviews/2026-10-06-rev1.md', head: h1, row: 1, cite: 'c.txt:1', status: 'pending', disposition: 'held for later',
  }])
  assert.equal(b.escapes.excluded.rejectedRows, 2, 'the skip verdict and the deliberate disposition')
  assert.deepEqual(b.escapes.excluded.unresolvedDocs.map((d) => [d.doc, d.head]), [['docs/reviews/2026-10-07-gone.md', 'feedface']])
  assert.deepEqual(b.escapes.excluded.unlandedDocs, [
    { doc: 'docs/reviews/2026-10-05-pre.md', head: pre },
    { doc: 'docs/reviews/2026-10-06-closed.md', head: hc },
  ], 'a review of work origin/main never reached adds nothing')
  assert.deepEqual(b.escapes.excluded.unresolvedRows, [])
  assert.equal(b.escapes.partial, false)

  const sub = run(home, 'rb', { repo: path.join(w.dir, 'sub') })
  assert.deepEqual(sub.escapes, b.escapes, '--repo may be any directory in the clone')
})

test('E8: through a merge-commit landing, a later finding counts, the PR\'s own pre-merge review on main does not, and a failed blame makes Quality partial', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n', 'd.txt': 'd0\n' })
  w.checkout('-b', 'feat')
  const x = w.commit('a3: add d', { 'd.txt': 'd0\nd1\nd2\n' })
  // reviewed on its branch before merging: the merge commit brings the head onto main, but it does not descend from it
  w.commit('review a3 pre-merge', { 'docs/reviews/2026-10-05-pre.md': reviewDoc(x.slice(0, 7), 'consumed', [[1, 'd.txt:2', '—']]) })
  w.checkout('main')
  const m8 = w.merge('feat', 'Merge pull request #8 from o/feat')
  const later = w.commit('later work', { 'e.txt': 'e\n' })
  // row 1 a line a3 wrote, row 2 a line older than a3 (the range boundary), row 3 a line d.txt does not have
  w.commit('review later', {
    'docs/reviews/2026-10-06-later.md': reviewDoc(later.slice(0, 7), 'pending', [[1, 'd.txt:2', '—'], [2, 'd.txt:1', '—'], [3, 'd.txt:9', '—']]),
  })
  w.publish()
  note(home, 'a3')
  emitAll(home, 'ra', [merged(D(5, '01:00'), 'a3', { pr: 8 })])
  const a = run(home, 'ra', { repo: w.dir })
  assert.equal(a.escapes.count, 1)
  assert.deepEqual(task(a, 'a3').commits.slice(0, 1), [m8])
  assert.ok(task(a, 'a3').commits.includes(x))
  assert.deepEqual(task(a, 'a3').evidence, [{
    source: 'review', doc: 'docs/reviews/2026-10-06-later.md', head: later, row: 1, cite: 'd.txt:2', status: 'pending', disposition: null,
  }])
  assert.deepEqual(a.escapes.excluded.unlandedDocs, [], 'the pre-merge head is on main: the ancestry bound, not reach, leaves it out')
  assert.deepEqual(a.escapes.excluded.unresolvedRows.map((r) => [r.doc, r.row, r.cite]), [['docs/reviews/2026-10-06-later.md', 3, 'd.txt:9']])
  assert.match(a.escapes.excluded.unresolvedRows[0].why, /^git blame failed: /)
  assert.deepEqual(a.escapes.sources, READ)
  assert.equal(a.escapes.partial, true, 'a failed blame inside the bounds is missed evidence')
  assert.ok(has(a.flags, /^escapes: Quality misses 1 review finding\(s\) whose git blame failed \(excluded\.unresolvedRows\); it can only read too high$/), a.flags.join('\n'))
})

test('E8: blame stops at each landing, so a line older than a pr\'s second squash is never blamed on its first', (t) => {
  // pr #5 matches two squashes: blamed back to the second one's parent, the first, a line older than both reads as
  // the range boundary, never as the first squash
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'c.txt': 'c1\nc2\nc3\n' })
  const p1 = w.commit('a1: part one (#5)', { 'c.txt': 'c1\nc2 one\nc3\n' })
  const p2 = w.commit('a1: part two (#5)', { 'c.txt': 'c1\nc2 one\nc3 two\n' })
  const later = w.commit('later work', { 'e.txt': 'e\n' })
  w.commit('review later', { 'docs/reviews/2026-10-06-later.md': reviewDoc(later.slice(0, 7), 'pending', [[1, 'c.txt:1', '—'], [2, 'c.txt:2', '—']]) })
  w.publish()
  note(home, 'a1')
  emitAll(home, 'ra', [merged(D(5, '01:00'), 'a1', { pr: 5 })])
  const a = run(home, 'ra', { repo: w.dir })
  assert.deepEqual(task(a, 'a1').commits, [p2, p1])
  assert.deepEqual(task(a, 'a1').evidence.map((e) => [e.row, e.cite]), [[2, 'c.txt:2']], 'row 1 is older than both squashes')
  assert.deepEqual(a.escapes.excluded.unresolvedRows, [])
  assert.equal(a.escapes.partial, false)
  assert.ok(has(a.flags, /^escapes: pr #5 of \[\[a1\]\] matches 2 commits on origin\/main: all of them are its commits$/), a.flags.join('\n'))
})

// ---- E9: degradation ----------------------------------------------------------------------------------------

test('E9: with no --repo, no tasks dir or neither, the unread sources are named and Quality reads partial or null', (t) => {
  const home = tmpHome(t)
  note(home, 'a1'); note(home, 'fix-a1', ['status: open', 'fixes: "[[a1]]"'])
  emitAll(home, 'ra', [merged(D(5, '01:00'), 'a1', { pr: 1 }), merged(D(5, '02:00'), 'a2', { pr: 2 })])

  const norepo = run(home, 'ra')
  assert.deepEqual(norepo.escapes.sources, { fixes: 'read', reverts: 'unread: no --repo', reviews: 'unread: no --repo' })
  assert.deepEqual(norepo.escapes.bySource, { fixes: 1, reverts: null, reviews: null })
  assert.equal(norepo.escapes.reviewDocs, null)
  assert.equal(norepo.escapes.ref, null)
  assert.equal(norepo.escapes.count, 1)
  assert.equal(norepo.escapes.quality, 0.5)
  assert.equal(norepo.escapes.partial, true)
  assert.ok(has(norepo.flags, /^escapes: Quality rests on fixes only: reverts unread \(no --repo\); reviews unread \(no --repo\); it can only read too high$/), norepo.flags.join('\n'))

  const missing = path.join(home, 'no-such-tasks')
  const notasks = run(home, 'ra', { tasks: missing })
  assert.equal(notasks.escapes.sources.fixes, `unread: tasks dir ${missing} not found`)
  assert.equal(notasks.escapes.count, null, 'every source unread')
  assert.equal(notasks.escapes.quality, null)
  assert.equal(notasks.headline.quality, null)
  assert.equal(notasks.escapes.partial, true)
  assert.ok(has(notasks.flags, /^escapes: Quality unknown: fixes unread/))

  // the default tasks dir sits under the scratch HOME: absent here, so a bare call reads fixes unread too
  const bare = run(home, 'ra', { tasks: null })
  assert.equal(bare.escapes.sources.fixes, `unread: tasks dir ${path.join(home, 'repos', 'obsidian', 'Work', 'Tasks')} not found`)
})

test('E9: origin/HEAD unset reads origin/main, flagged; no origin refs read HEAD, flagged', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n' })
  const s1 = w.commit('a1: add a (#1)', { 'a.txt': 'a1\n' })
  w.revert(s1, 'Revert "a1: add a (#1)" (#2)')
  w.publish()
  w.g(['remote', 'set-head', 'origin', '-d'])
  note(home, 'a1')
  emitAll(home, 'ra', [merged(D(5, '01:00'), 'a1', { pr: 1 })])
  const unset = run(home, 'ra', { repo: w.dir })
  assert.equal(unset.escapes.ref.name, 'origin/main')
  assert.equal(unset.escapes.count, 1)
  assert.ok(has(unset.flags, /^escapes: origin\/HEAD unset: read origin\/main; `git remote set-head origin --auto` pins it$/), unset.flags.join('\n'))

  w.g(['remote', 'remove', 'origin'])
  const local = run(home, 'ra', { repo: w.dir })
  assert.equal(local.escapes.ref.name, 'HEAD')
  assert.equal(local.escapes.count, 1)
  assert.ok(has(local.flags, /^escapes: no origin\/HEAD, origin\/main or origin\/master: read HEAD/), local.flags.join('\n'))

  const plain = path.join(home, 'plain')
  fs.mkdirSync(plain)
  const notgit = run(home, 'ra', { repo: plain })
  assert.equal(notgit.escapes.sources.reverts, `unread: --repo ${plain} is not a git work tree`)
  assert.equal(notgit.escapes.sources.reviews, `unread: --repo ${plain} is not a git work tree`)
})

// ---- E10: git env -------------------------------------------------------------------------------------------

test('E10: an exported GIT_DIR and GIT_WORK_TREE (a throwaway repo) change nothing', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n' })
  const s1 = w.commit('a1: add a (#1)', { 'a.txt': 'a1\n' })
  w.revert(s1, 'Revert "a1: add a (#1)" (#2)')
  w.publish()
  const other = new Repo(home, 'other')
  other.commit('a1: something else (#1)', { 'o.txt': 'o\n' })
  note(home, 'a1')
  emitAll(home, 'ra', [merged(D(5, '01:00'), 'a1', { pr: 1 })])
  const clean = run(home, 'ra', { repo: w.dir })
  assert.equal(clean.escapes.count, 1)
  const leaked = run(home, 'ra', { repo: w.dir, env: { GIT_DIR: path.join(other.dir, '.git'), GIT_WORK_TREE: other.dir } })
  assert.deepEqual(leaked.escapes, clean.escapes)
})

// ---- E11: the window ----------------------------------------------------------------------------------------

test('E11: a fixer note and a revert dated after --until still count', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n' })
  w.commit('a1: add a (#1)', { 'a.txt': 'a1\n' })
  const s2 = w.commit('a2: add b (#2)', { 'b.txt': 'b1\n' })
  w.revert(s2, 'Revert "a2: add b (#2)" (#9)', { at: '2026-10-20T09:00:00Z' })
  w.publish()
  note(home, 'a1'); note(home, 'a2'); note(home, 'late-fix', ['status: open', 'captured: 2026-10-20', 'fixes: "[[a1]]"'])
  emitAll(home, 'ra', [merged(D(5, '01:00'), 'a1', { pr: 1 }), merged(D(5, '02:00'), 'a2', { pr: 2 })])
  const a = run(home, 'ra', { repo: w.dir, since: D(5, '00:00'), until: D(5, '23:00') })
  assert.equal(a.escapes.count, 2)
  assert.deepEqual(a.escapes.bySource, { fixes: 1, reverts: 1, reviews: 0 })
})

// ---- E12: nothing landed ------------------------------------------------------------------------------------

test('E12: nothing landed: no Escapes, Quality null, flagged', (t) => {
  const home = tmpHome(t)
  const w = new Repo(home)
  w.commit('init', { 'README.md': 'demo\n' })
  w.publish()
  fs.mkdirSync(tasksDir(home), { recursive: true })
  emitAll(home, 'ra', [[D(5, '01:00'), 'slot-taken', 't1', { settings: { parallel_ceiling: 2 } }]])
  const a = run(home, 'ra', { repo: w.dir })
  assert.equal(a.escapes.landed, 0)
  assert.equal(a.escapes.count, 0)
  assert.equal(a.escapes.quality, null)
  assert.equal(a.headline.quality, null)
  assert.ok(has(a.flags, /^escapes: nothing landed in the window: Quality is null$/), a.flags.join('\n'))
})
