// skills/_shared/scripts/backlog-orient.py, the Backlog orient's one reader and writer (skills/orient/backlog.md;
// ADR 0071). Every case runs the shipped script over a fixture vault V under one temp dir S, each writing case on its
// own copy of V (its own HOME, so the declared trigger file `~/trigger.json` is that copy's). The cases:
//   (a)  sweep: exactly the Backlog the Pulse's line rules give, every row's fields, projects[] and excluded[], no write;
//   (a2) sweep's set equals an oracle written here from those rules (fm_lines, fm_list, link_names, the status line);
//   (b)  park: only `status:`, the inserted `parked-by:` and one Notes line change; every shared refusal is exit 2,
//        one stderr line and a byte-identical vault; a BOM+CRLF note keeps both;
//   (c)  reopen, (d) obsolete, (d2) rehome and (h) wait: their writes and refusals;
//   (e)  record: its path (` (2)` on a second run), its sections in order, its tags and frontmatter, --append;
//   (f)  trigger: the write's format (key order, offsets, whole seconds rounded up, indent, newline, mode, a replaced
//        inode, no .tmp left), a missing, corrupt or non-object file, --at, the env seam, --read, guards 1 and 3, and a
//        Pulse stamp landing in _before_replace;
//   (g)  every disposition on one vault, then the guards after write-back #1: a Pulse stamp (g1), a new task (g2), a
//        clean answered write (g3), the Batches notes naming the fork-written members (g4), the unparseable task (g5),
//        Answered, waiting (g6), a kept § 3.5 answer recorded through the real estate-dispatch.py (g7), a held gate (g8).
// Reads and writes only under S.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root } from './lib/contract-text.mjs'

const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'backlog-orient.py')
const DISPATCH = path.join(root, 'skills', '_shared', 'scripts', 'estate-dispatch.py')
const NEXT_ACTION = path.join(root, 'skills', '_shared', 'scripts', 'next-action.py')

const drop = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
const base = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
for (const name of [...drop, 'CLAUDE_PLUGIN_ROOT', 'PULSE_TRIGGER_FILE']) delete base[name]
base.PYTHONUSERBASE ??= spawnSync('python3', ['-c', 'import site; print(site.getuserbase())'], { encoding: 'utf8' }).stdout.trim()

const S = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-orient-')))
after(() => fs.rmSync(S, { recursive: true, force: true }))

const write = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text) }
const fm = (lines, body = '\n# Note\n') => `---\n${lines}\n---\n${body}`
const AREA = 'Work/Projects/Animately/Animately.md'
const D = '2026-11-06'
const STAMP = '2026-11-05T09:18:40+11:00'

// ---- the fixture vault V -------------------------------------------------------------------------------------------
const V = path.join(S, 'v')
const P = (rel, lines) => write(path.join(V, 'Work', 'Projects', rel), fm(lines))
const T = (slug, lines, body = '') => write(path.join(V, 'Work', 'Tasks', `${slug}.md`),
  fm(lines, `\n# ${slug}\n\n## Notes\n\nCaptured for the fixture.${body}\n`))
const task = (status, projects, more = '') => `tags:\n  - task\nstatus: ${status}\nprojects: ${projects}${more}`

P('Animately/Animately.md', 'tags:\n  - area\naliases: [Anim]\nbacklog_excludes: ["[[GifLab]]"]\nbacklog_trigger: ~/trigger.json')
P('Animately/Website.md', 'tags:\n  - project\nstatus: active\nrepos:\n  - ~/repos/x')
P('Animately/Sub/Deep Note.md', 'tags:\n  - project\naliases: [Deep]')
P('Animately/GifLab.md', 'tags:\n  - project')
P('Animately/GifLab Large-File Routes Research.md', 'tags:\n  - research')
P('Animately/Press kit.md', 'tags:\n  - reference')
P('Animately/Backlog orients/2026-11-01 Animately Backlog orient.md', 'tags:\n  - backlog-orient')
P('Chorus/Chorus.md', 'tags:\n  - project')

T('t-inline', task('open', '["[[Website]]", "[[AI]]"]', '\npriority: high'))
T('t-block', 'tags:\n  - task\nstatus: open\nprojects:\n  - "[[Deep]]"\n  - "[[AI]]"')
T('t-scalar', task('open', '"[[Sub/Deep Note|the deep one]]"'))
T('t-bare', task('open', '[Website]'))
T('t-area', task('open', '["[[Animately]]"]'))
write(path.join(V, 'Work', 'Tasks', 't-bom.md'),
  '\ufeff---\r\ntags:\r\n  - task\r\nstatus: open\r\nprojects: ["[[Anim]]"]\r\n---\r\n\r\n# t-bom\r\n\r\n## Notes\r\n\r\nCRLF.\r\n')
T('t-orient-park', task('parked', '["[[Website]]"]', '\nparked-by: backlog-orient 2026-11-01'))
T('t-held-park', task('parked', '["[[Website]]"]'))
T('t-in-progress', task('in_progress', '["[[Website]]"]'))
T('t-thread', 'tags:\n  - task\n  - thread\nstatus: open\nprojects: ["[[Website]]"]')
T('t-decisions', 'tags:\n  - task\n  - decisions\nstatus: open\nprojects: ["[[Website]]"]')
T('t-notask', 'tags:\n  - ai\nstatus: open\nprojects: ["[[Website]]"]')
T('t-done', task('done', '["[[Website]]"]'))
write(path.join(V, 'Work', 'Tasks', 'Archive', 't-archived.md'), fm(task('open', '["[[Website]]"]')))
T('g-one', task('open', '["[[GifLab]]", "[[Animately]]"]'))
T('g-two', task('open', '["[[GifLab Large-File Routes Research]]"]'))
T('c-chorus', task('open', '["[[Chorus]]"]'))
T('t-unparseable', 'tags:\n  - task\nstatus: open\nsummary: fix: the thing\nprojects: ["[[Website]]"]')
T('t-record-link', task('open', '["[[2026-11-01 Animately Backlog orient]]"]'))
T('gate-one', task('open', '["[[Website]]"]'), '\n\nShip the banner, but hold for sign-off from the shop.')
T('gate-two', task('open', '["[[Website]]"]'), '\n\nDo not start until the next release lands.')
T('m-a', task('open', '["[[Website]]"]'))
T('m-b', task('open', '["[[Website]]"]', '\nrollout: "[[website-rollout-2026-11-06]]"'))
T('m-c', task('open', '["[[Website]]"]', '\nrollout: "[[website-rollout-2026-11-01]]"'))
write(path.join(V, 'Work', 'Tasks', 'website-rollout-2026-11-06.md'),
  fm('tags:\n  - task\n  - rollout\nstatus: open\nprojects: ["[[Website]]"]', '\n## Queue\n\n- [[m-a]]\n'))
write(path.join(V, 'Work', 'Tasks', 'Archive', 'Rollouts', 'website-rollout-2026-11-01.md'),
  fm('tags:\n  - task\n  - rollout\nstatus: done\nprojects: ["[[Website]]"]', '\n## Queue\n\nNothing linked here.\n'))

const MEMBERS = ['c-none', 'gate-one', 'gate-two', 'm-a', 'm-b', 'm-c', 't-area', 't-bare', 't-block', 't-bom', 't-decisions',
  't-held-park', 't-inline', 't-notask', 't-orient-park', 't-record-link', 't-scalar', 't-thread', 't-unparseable']
  .filter((s) => s !== 'c-none')

// ---- running it ----------------------------------------------------------------------------------------------------
let copies = 0
// A fresh copy of V with its own HOME; `trigger` (an object or raw text) seeds its ~/trigger.json.
function copyVault(name, trigger) {
  const dir = path.join(S, `${name}-${++copies}`)
  fs.cpSync(V, path.join(dir, 'v'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true })
  const c = { dir, v: path.join(dir, 'v'), home: path.join(dir, 'home'), trig: path.join(dir, 'home', 'trigger.json') }
  if (trigger !== undefined) {
    fs.writeFileSync(c.trig, typeof trigger === 'string' ? trigger : `${JSON.stringify(trigger, null, 1)}\n`)
    fs.chmodSync(c.trig, 0o600)
  }
  return c
}
const run = (c, args, { input, env = {} } = {}) => {
  const r = spawnSync('python3', [SCRIPT, '--vault', c.v, ...args], { encoding: 'utf8', input, cwd: S, timeout: 60000,
    env: { ...base, HOME: c.home, ...env } })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}
const PRISTINE = { dir: S, v: V, home: path.join(S, 'home') }
fs.mkdirSync(PRISTINE.home, { recursive: true })
const sweep = (c) => {
  const r = run(c, ['sweep', '--area', AREA, '--json'])
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const tf = (c, slug) => path.join(c.v, 'Work', 'Tasks', `${slug}.md`)
const read = (p) => fs.readFileSync(p, 'utf8')
// Every file under a dir: rel → bytes, mtime and inode, for a byte-identical check.
function snap(dir) {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else { const st = fs.statSync(p, { bigint: true }); out[path.relative(dir, p)] = [fs.readFileSync(p).toString('base64'), String(st.mtimeNs)] }
    }
  }
  walk(dir)
  return out
}
// A refusal: exit `code`, one stderr line starting backlog-orient:, nothing written under the copy.
function refused(c, args, re, code = 2) {
  const before = snap(c.dir)
  const r = run(c, args)
  assert.equal(r.status, code, `${args.join(' ')}: ${r.stdout}${r.stderr}`)
  const lines = r.stderr.trimEnd().split('\n')
  assert.equal(lines.length, 1, r.stderr)
  assert.match(lines[0], /^backlog-orient: /)
  if (re) assert.match(lines[0], re)
  assert.deepEqual(snap(c.dir), before, `${args.join(' ')} wrote something`)
  return r
}

// ---- (a) sweep -------------------------------------------------------------------------------------------------------
test('(a) sweep reads exactly the Backlog, every row field, projects[] and excluded[], and writes nothing', () => {
  const before = snap(S)
  const out = sweep(PRISTINE)
  assert.deepEqual(snap(S), before, 'sweep wrote something')
  const rows = Object.fromEntries(out.rows.map((r) => [r.task, r]))
  assert.deepEqual(Object.keys(rows).sort(), MEMBERS)
  for (const gone of ['g-one', 'g-two', 't-archived', 'website-rollout-2026-11-06', 't-in-progress', 'c-chorus', 't-done']) {
    assert.ok(!(gone in rows), `${gone} is no Backlog member`)
  }
  assert.match(out.read_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}\+1[01]:00$/)
  assert.deepEqual(out.excludes, ['giflab'])
  assert.equal(rows['t-unparseable'].frozen, 'unparseable:frontmatter does not parse (line 5, summary)')
  assert.equal(rows['t-orient-park'].park, 'orient')
  assert.equal(rows['t-orient-park'].parkedBy, 'backlog-orient 2026-11-01')
  assert.equal(rows['t-held-park'].park, 'held')
  assert.equal(rows['t-inline'].park, null)
  assert.equal(rows['t-thread'].frozen, 'thread')
  assert.equal(rows['t-decisions'].frozen, 'decisions')
  assert.equal(rows['t-notask'].frozen, 'not a task')
  assert.equal(rows['t-inline'].frozen, null)
  assert.equal(rows['m-b'].inFlight, true, 'm-b links a live rollout')
  assert.equal(rows['m-c'].inFlight, false, 'an archived rollout is not live')
  assert.deepEqual(out.rows.filter((r) => r.inFlight).map((r) => r.task), ['m-b'])
  assert.deepEqual(out.rows.filter((r) => r.areaOnly).map((r) => r.task).sort(), ['t-area', 't-bom'])
  assert.deepEqual(rows['t-block'].homes, ['Deep Note'])
  assert.deepEqual(rows['t-scalar'].homes, ['Deep Note'])
  assert.deepEqual(rows['t-bare'].homes, ['Website'])
  assert.deepEqual(rows['t-record-link'].homes, ['2026-11-01 Animately Backlog orient'])
  assert.equal(rows['t-inline'].priority, 'high')
  assert.equal(rows['t-bom'].rel, 'Work/Tasks/t-bom.md')
  assert.deepEqual(out.projects.map((p) => p.name).sort(), ['Deep Note', 'Website'])
  assert.deepEqual(out.projects.find((p) => p.name === 'Website').repos, ['~/repos/x'])
  assert.deepEqual(out.excluded.map((p) => p.name).sort(), ['GifLab', 'GifLab Large-File Routes Research'])
  assert.equal(out.trigger.declared, true)
  assert.equal(out.trigger.exists, false)
  assert.equal(out.trigger.runReason, 'manual')
})

// ---- (a2) the oracle -------------------------------------------------------------------------------------------------
// The Pulse's line rules, written again here: a member is a Tasks/*.md note whose first line is `---`, whose last
// `status:` line reads open or parked, whose tags hold no rollout, and whose projects name the area or a note under
// its folder (stem or alias), none of them starting with an excluded name.
function oracle(vault) {
  const norm = (t) => (t.startsWith('\ufeff') ? t.slice(1) : t).replace(/\r\n/g, '\n')
  const fmLines = (t) => { const l = t.split('\n'); if (l[0] !== '---') return []; const i = l.findIndex((x, k) => k > 0 && x.trim() === '---'); return i < 0 ? [] : l.slice(1, i) }
  const unq = (v) => String(v).trim().replace(/^["']+|["']+$/g, '').trim()
  const splitItems = (inner) => { const out = []; let cur = ''; let depth = 0; for (let i = 0; i < inner.length;) { if (inner.startsWith('[[', i)) { depth++; cur += '[['; i += 2 } else if (inner.startsWith(']]', i) && depth) { depth--; cur += ']]'; i += 2 } else if (inner[i] === ',' && !depth) { out.push(cur); cur = ''; i++ } else { cur += inner[i]; i++ } } out.push(cur); return out }
  const fmList = (lines, key) => {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(new RegExp(`^${key}:(.*)$`))
      if (!m) continue
      const rest = m[1].trim()
      let raw = []
      if (rest.startsWith('[')) raw = splitItems(rest.endsWith(']') ? rest.slice(1, -1) : rest.slice(1))
      else if (rest) raw = [rest]
      else for (const n of lines.slice(i + 1)) { const it = n.match(/^\s*-\s*(.*)$/); if (it) raw.push(it[1]); else if (n.trim()) break }
      return raw.map(unq).filter(Boolean)
    }
    return []
  }
  const linkNames = (items) => items.flatMap((it) => { const ls = [...it.matchAll(/\[\[([^\]\n]+?)\]\]/g)].map((m) => m[1]); return (ls.length ? ls : [it]).map((t) => { let n = t.split('|')[0].split('#')[0].trim(); n = n.split('/').pop(); return n.endsWith('.md') ? n.slice(0, -3) : n }).filter(Boolean) })
  const stems = new Map([['animately', 'Animately']])
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
  for (const p of walk(path.join(vault, 'Work', 'Projects', 'Animately')).filter((p) => p.endsWith('.md')).sort()) {
    const stem = path.basename(p, '.md')
    for (const n of [stem, ...fmList(fmLines(norm(read(p))), 'aliases')]) if (!stems.has(n.toLowerCase())) stems.set(n.toLowerCase(), stem)
  }
  const out = []
  for (const name of fs.readdirSync(path.join(vault, 'Work', 'Tasks')).filter((n) => n.endsWith('.md')).sort()) {
    const p = path.join(vault, 'Work', 'Tasks', name)
    if (!fs.statSync(p).isFile()) continue
    const lines = fmLines(norm(read(p)))
    const status = unq((lines.filter((l) => /^status:/.test(l)).pop() ?? 'status:').slice(7)).toLowerCase()
    const tags = fmList(lines, 'tags').map((t) => t.toLowerCase().replace(/^#+/, ''))
    const resolved = linkNames(fmList(lines, 'projects')).map((n) => [n.toLowerCase(), stems.get(n.toLowerCase())])
    const out1 = resolved.some(([n, s]) => n.startsWith('giflab') || (s ?? '').toLowerCase().startsWith('giflab'))
    if (!out1 && resolved.some(([, s]) => s) && !tags.includes('rollout') && ['open', 'parked'].includes(status)) out.push(name.slice(0, -3))
  }
  return out
}

test('(a2) sweep\'s Backlog equals the oracle written from the Pulse\'s line rules', () => {
  assert.deepEqual(sweep(PRISTINE).rows.map((r) => r.task).sort(), oracle(V).sort())
  assert.deepEqual(oracle(V).sort(), MEMBERS)
})

// ---- (b) park ---------------------------------------------------------------------------------------------------------
test('(b) park writes status, parked-by and one Notes line, byte for byte; [no-change] on an orient park', () => {
  const c = copyVault('park')
  const old = read(tf(c, 't-inline'))
  const r = run(c, ['park', '--area', AREA, '--task', 't-inline', '--reason', 'its batch is not worth a rollout yet', '--today', D])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'parked Work/Tasks/t-inline.md: its batch is not worth a rollout yet\n')
  const want = old.replace('status: open\n', `status: parked\nparked-by: backlog-orient ${D}\n`)
    .replace('Captured for the fixture.\n', `Captured for the fixture.\n- ${D} parked by the Backlog orient: its batch is not worth a rollout yet\n`)
  assert.equal(read(tf(c, 't-inline')), want)
  const before = snap(c.dir)
  const again = run(c, ['park', '--area', AREA, '--task', 't-orient-park', '--reason', 'x'])
  assert.equal(again.status, 0, again.stderr)
  assert.match(again.stdout, /^\[no-change\] Work\/Tasks\/t-orient-park\.md/)
  assert.deepEqual(snap(c.dir), before)
})

test('(b) a BOM and CRLF note keeps both through a park', () => {
  const c = copyVault('bom')
  assert.equal(run(c, ['park', '--area', AREA, '--task', 't-bom', '--reason', 'later', '--today', D]).status, 0)
  assert.equal(read(tf(c, 't-bom')),
    `\ufeff---\r\ntags:\r\n  - task\r\nstatus: parked\r\nparked-by: backlog-orient ${D}\r\nprojects: ["[[Anim]]"]\r\n---\r\n\r\n# t-bom\r\n\r\n## Notes\r\n\r\nCRLF.\r\n- ${D} parked by the Backlog orient: later\r\n`)
})

const SHARED = [['m-b', /in flight/], ['t-done', /done/], ['t-thread', /`thread`/], ['t-decisions', /`decisions`/],
  ['t-notask', /not a task/], ['t-held-park', /held park/], ['t-unparseable', /does not parse.*mend it first/], ['nope', /no task note/]]

test('(b) park refuses each shared case, an empty reason and an urgent task, exit 2 with the vault byte-identical', () => {
  const c = copyVault('park-refuse', { stamped_at: STAMP, reason: 'urgent', tasks: ['Work/Tasks/t-area.md'],
    urgent: [{ task: 'Work/Tasks/t-area.md', rule: 'severity-1' }] })
  for (const [slug, re] of SHARED) refused(c, ['park', '--area', AREA, '--task', slug, '--reason', 'r'], re)
  refused(c, ['park', '--area', AREA, '--task', 't-inline', '--reason', '   '], /--reason is empty/)
  refused(c, ['park', '--area', AREA, '--task', 't-area', '--reason', 'r'], /urgent/)
})

// ---- (c) reopen and (d) obsolete -------------------------------------------------------------------------------------
test('(c) reopen opens an orient park and drops parked-by; it refuses a held park and an open task', () => {
  const c = copyVault('reopen')
  const old = read(tf(c, 't-orient-park'))
  const r = run(c, ['reopen', '--task', 't-orient-park', '--batch', 'batch 1, [[website-rollout-2026-11-06]]', '--today', D])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(read(tf(c, 't-orient-park')), old.replace('status: parked\n', 'status: open\n').replace('parked-by: backlog-orient 2026-11-01\n', '')
    .replace('Captured for the fixture.\n', `Captured for the fixture.\n- ${D} reopened by the Backlog orient: joins batch 1, [[website-rollout-2026-11-06]]\n`))
  refused(c, ['reopen', '--task', 't-held-park', '--batch', 'b'], /held park/)
  refused(c, ['reopen', '--task', 't-inline', '--batch', 'b'], /not parked/)
  refused(c, ['reopen', '--task', 't-area', '--batch', ' '], /--batch is empty/)
  for (const [slug, re] of SHARED) refused(c, ['reopen', '--task', slug, '--batch', 'b'], re)
})

test('(d) obsolete drops a task with one of --fixed-by or --gone, never both or neither', () => {
  const c = copyVault('obsolete')
  let r = run(c, ['obsolete', '--task', 't-inline', '--fixed-by', '[[m-a]]', '--today', D])
  assert.equal(r.status, 0, r.stderr)
  assert.match(read(tf(c, 't-inline')), /\nstatus: dropped\n/)
  assert.match(read(tf(c, 't-inline')), new RegExp(`\\n- ${D} obsolete \\(Backlog orient\\): no longer true: fixed by \\[\\[m-a\\]\\]\\n`))
  r = run(c, ['obsolete', '--task', 't-orient-park', '--gone', 'the page was removed', '--today', D])
  assert.equal(r.status, 0, r.stderr)
  const t = read(tf(c, 't-orient-park'))
  assert.ok(!t.includes('parked-by:'), 'an obsoleted orient park loses parked-by')
  assert.match(t, /no longer true: the page was removed\n/)
  refused(c, ['obsolete', '--task', 't-area'], /exactly one of --fixed-by and --gone/)
  refused(c, ['obsolete', '--task', 't-area', '--fixed-by', 'x', '--gone', 'y'], /exactly one/)
  refused(c, ['obsolete', '--task', 't-area', '--gone', ''], /--gone is empty/)
  for (const [slug, re] of SHARED) refused(c, ['obsolete', '--task', slug, '--gone', 'g'], re)
})

// ---- (d2) rehome ---------------------------------------------------------------------------------------------------
test('(d2) rehome swaps the area link for a project under the area and keeps the rest', () => {
  const c = copyVault('rehome')
  write(tf(c, 't-two'), fm(task('open', '["[[Animately]]", "[[AI]]"]')))
  let r = run(c, ['rehome', '--area', AREA, '--task', 't-two', '--to', 'Website', '--today', D])
  assert.equal(r.status, 0, r.stderr)
  assert.match(read(tf(c, 't-two')), /\nprojects: \["\[\[Website\]\]", "\[\[AI\]\]"\]\n/)
  assert.match(read(tf(c, 't-two')), new RegExp(`- ${D} re-homed by the Backlog orient: \\[\\[Animately\\]\\] → \\[\\[Website\\]\\]\\n`))
  r = run(c, ['rehome', '--area', AREA, '--task', 't-bom', '--to', 'Work/Projects/Animately/Sub/Deep Note.md', '--today', D])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(read(tf(c, 't-bom')).includes('projects: ["[[Deep Note]]"]\r\n'), 'the alias link swapped, CRLF kept')
  refused(c, ['rehome', '--area', AREA, '--task', 't-area', '--to', 'Chorus'], /no note under the area folder/)
  refused(c, ['rehome', '--area', AREA, '--task', 't-area', '--to', 'GifLab'], /excluded name/)
  refused(c, ['rehome', '--area', AREA, '--task', 't-area', '--to', 'Press kit'], /not tagged `project`/)
  refused(c, ['rehome', '--area', AREA, '--task', 't-area', '--to', '2026-11-01 Animately Backlog orient'], /not tagged `project`/)
  refused(c, ['rehome', '--area', AREA, '--task', 't-inline', '--to', 'Website'], /already names/)
  refused(c, ['rehome', '--area', AREA, '--task', 't-block', '--to', 'Website'], /links \[\[Animately\]\] nowhere/)
  for (const [slug, re] of SHARED) refused(c, ['rehome', '--area', AREA, '--task', slug, '--to', 'Website'], re)
})

// ---- (h) wait -------------------------------------------------------------------------------------------------------
test('(h) wait writes one Notes line and keeps the shared refusals', () => {
  const c = copyVault('wait')
  const old = read(tf(c, 'gate-two'))
  const r = run(c, ['wait', '--task', 'gate-two', '--why', "its project's rollout already runs", '--today', D])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(read(tf(c, 'gate-two')), old.replace('lands.\n', `lands.\n- ${D} waits for the next Backlog orient: its project's rollout already runs\n`))
  refused(c, ['wait', '--task', 'gate-two', '--why', ' '], /--why is empty/)
  for (const [slug, re] of SHARED) refused(c, ['wait', '--task', slug, '--why', 'w'], re)
})

// ---- (e) record -------------------------------------------------------------------------------------------------------
const SECTIONS = ['Trigger', 'Batches', 'Rollouts started', 'Parks', 'Reopens', 'Obsoletes', 'Re-homes', 'Merges and unbundles',
  'Held parks', 'Session lane and misfits', 'Left out', 'Drift fixes and mends', 'Decided for you', 'Questions asked',
  'Held by his answer', 'Questions waiting', 'Answered, waiting', 'Folded', 'Write-back', 'Touched']
const recordRel = (n = 1) => `Work/Projects/Animately/Backlog orients/${D} Animately Backlog orient${n === 1 ? '' : ` (${n})`}.md`
const record = (c, obj) => run(c, ['record', '--area', AREA, '--date', D], { input: JSON.stringify(obj) })
const append = (c, rel, obj) => run(c, ['record', '--append', '--note', rel], { input: JSON.stringify(obj) })

test('(e) record writes its note, its sections in order and its frontmatter; a second run takes (2); --append adds', () => {
  const c = copyVault('record')
  const r = record(c, { read_at: '2026-11-06T10:00:00.000001+11:00', trigger_stamp: STAMP, seen_orient_at: null,
    rows: { Parks: ['[[t-inline]]: not worth a rollout yet'], Batches: ['[[website-rollout-2026-11-06]] (prior none): [[m-a]]'] },
    touched: ['t-inline', 't-inline'] })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, `recorded ${recordRel()}\n`)
  const t = read(path.join(c.v, recordRel()))
  assert.ok(t.startsWith(`---\ntags:\n  - backlog-orient\narea: "[[Animately]]"\ndate: ${D}\nread_at: "2026-11-06T10:00:00.000001+11:00"\n` +
    `trigger_stamp: "${STAMP}"\nseen_orient_at: none\nlast_orient_at:\nlast_reason:\n---\n`), t.slice(0, 300))
  assert.deepEqual([...t.matchAll(/^## (.+)$/gm)].map((m) => m[1]), SECTIONS)
  assert.match(t, /## Parks\n\n- \[\[t-inline\]\]: not worth a rollout yet\n/)
  assert.equal((t.match(/^- \[\[t-inline\]\]$/gm) ?? []).length, 1, 'a touched slug is listed once')
  assert.equal(record(c, { read_at: '2026-11-06T10:00:00+11:00' }).stdout, `recorded ${recordRel(2)}\n`)
  const a = append(c, recordRel(), { rows: { Parks: ['[[t-bare]]: later'], 'Held by his answer': ['[[gate-two]]: "until the next release"'] },
    touched: ['t-bare', 't-inline'], trigger_stamp: '2026-11-06T09:00:00+11:00' })
  assert.equal(a.status, 0, a.stderr)
  const t2 = read(path.join(c.v, recordRel()))
  assert.match(t2, /## Parks\n\n- \[\[t-inline\]\]: not worth a rollout yet\n- \[\[t-bare\]\]: later\n/)
  assert.match(t2, /## Held by his answer\n\n- \[\[gate-two\]\]: "until the next release"\n/)
  assert.match(t2, /## Touched\n\n- \[\[t-inline\]\]\n- \[\[t-bare\]\]\n$/)
  assert.match(t2, /\ntrigger_stamp: "2026-11-06T09:00:00\+11:00"\n/)
  refused(c, ['record', '--append', '--note', recordRel()], null)
  for (const bad of [{ rows: { Nope: ['x'] } }, { rows: { Touched: ['x'] } }, { rows: { Parks: [' '] } }, { read_at: 'x' }]) {
    const before = snap(c.dir)
    assert.equal(append(c, recordRel(), bad).status, 2, JSON.stringify(bad))
    assert.deepEqual(snap(c.dir), before)
  }
  assert.equal(record(c, { read_at: 'not a time' }).status, 2)
})

// ---- (f) trigger ---------------------------------------------------------------------------------------------------------
const PULSE = { stamped_at: STAMP, reason: 'pile-up', tasks: ['Work/Tasks/t-area.md'], urgent: [] }
// A record whose Trigger section lists the stamp's tasks, written with read_at = now (so nothing older counts).
function freshRecord(c, { stamp = STAMP, seen = null, rows = {}, touched = [], readAt } = {}) {
  const at = readAt ?? sweep(c).read_at
  const r = record(c, { read_at: at, trigger_stamp: stamp, seen_orient_at: seen, rows: { Trigger: ['[[t-area]] pile-up'], ...rows }, touched })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim().replace(/^recorded /, '')
}
const writeBack = (c, rel, more = []) => run(c, ['trigger', '--area', AREA, '--write', '--reason', 'pile-up', '--record', rel, ...more])
const iso = (d) => d.toISOString().replace('Z', '+00:00')
const atNow = (offsetMs = 0) => iso(new Date(Date.now() + offsetMs))

test('(f) the write-back keeps every key in order, rounds up to the next whole second and replaces the file atomically', () => {
  const c = copyVault('trig', { ...PULSE, x: 'kept', last_orient_at: '2026-10-28T14:05:00+11:00', last_reason: 'urgent' })
  const rel = freshRecord(c, { seen: '2026-10-28T14:05:00+11:00' })
  const ino = fs.statSync(c.trig).ino
  // 01:30:00.250 UTC is 12:30:00.250 in Melbourne (AEDT, +11:00): rounded up to 12:30:01.
  const at = new Date(Date.now() - 60000)
  at.setUTCMilliseconds(250)
  const r = writeBack(c, rel, ['--at', iso(at)])
  assert.equal(r.status, 0, r.stderr)
  const text = read(c.trig)
  const obj = JSON.parse(text)
  assert.deepEqual(Object.keys(obj), ['stamped_at', 'reason', 'tasks', 'urgent', 'x', 'last_orient_at', 'last_reason'])
  const L = new Date(obj.last_orient_at)
  assert.equal(L.getTime(), Math.ceil(at.getTime() / 1000) * 1000, 'rounded up to the next whole second')
  assert.match(obj.last_orient_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+1[01]:00$/, 'Melbourne offset, whole seconds')
  assert.equal(obj.last_reason, 'pile-up')
  assert.equal(text, `${JSON.stringify(obj, null, 1)}\n`, 'indent 1 and a trailing newline')
  assert.equal(fs.statSync(c.trig).mode & 0o777, 0o600)
  assert.notEqual(fs.statSync(c.trig).ino, ino, 'replaced, never written in place')
  assert.deepEqual(fs.readdirSync(c.home).filter((n) => n.endsWith('.tmp')), [])
  const rt = read(path.join(c.v, rel))
  assert.match(rt, new RegExp(`\\nlast_orient_at: "${obj.last_orient_at.replace(/[+]/g, '\\+')}"\\nlast_reason: pile-up\\n`))
  assert.match(rt, /## Write-back\n\n- \S+ write-back #1 \(pile-up\) → /)
  // A key the file lacked goes last; a mode other than 0600 is kept.
  const c2 = copyVault('trig2', PULSE)
  fs.chmodSync(c2.trig, 0o640)
  assert.equal(writeBack(c2, freshRecord(c2)).status, 0)
  assert.deepEqual(Object.keys(JSON.parse(read(c2.trig))), ['stamped_at', 'reason', 'tasks', 'urgent', 'last_orient_at', 'last_reason'])
  assert.equal(fs.statSync(c2.trig).mode & 0o777, 0o640)
})

test('(f) a missing file is created with the two keys; a corrupt file or an array is exit 2, untouched', () => {
  const c = copyVault('trig-missing')
  const rel = freshRecord(c, { stamp: null })
  assert.equal(writeBack(c, rel).status, 0)
  assert.deepEqual(Object.keys(JSON.parse(read(c.trig))), ['last_orient_at', 'last_reason'])
  assert.equal(fs.statSync(c.trig).mode & 0o777, 0o600)
  for (const bad of ['{"stamped_at": ', '[1, 2]']) {
    const d = copyVault('trig-bad', bad)
    refused(d, ['trigger', '--area', AREA, '--write', '--reason', 'manual', '--record', freshRecord(d, { stamp: null })], /JSON/)
    assert.equal(read(d.trig), bad)
    refused(d, ['trigger', '--area', AREA, '--read'], /JSON/)
  }
})

test('(f) --at more than 15 minutes ahead is refused; the env is honoured only with a declaration; --read writes nothing', () => {
  const c = copyVault('trig-at', PULSE)
  const rel = freshRecord(c)
  refused(c, ['trigger', '--area', AREA, '--write', '--reason', 'pile-up', '--record', rel, '--at', atNow(16 * 60000)], /15 minutes/)
  const other = path.join(c.dir, 'env-trigger.json')
  fs.writeFileSync(other, `${JSON.stringify({ stamped_at: '2026-11-06T08:00:00+11:00', tasks: [], urgent: [] })}\n`)
  const read1 = run(c, ['trigger', '--area', AREA, '--read', '--json'], { env: { PULSE_TRIGGER_FILE: other } })
  assert.equal(JSON.parse(read1.stdout).path, other)
  assert.equal(JSON.parse(read1.stdout).pending, true)
  const area = path.join(c.v, AREA)
  fs.writeFileSync(area, read(area).replace('backlog_trigger: ~/trigger.json\n', ''))
  const before = snap(c.dir)
  const read2 = run(c, ['trigger', '--area', AREA, '--read'], { env: { PULSE_TRIGGER_FILE: other } })
  assert.equal(read2.stdout, 'trigger: none declared on [[Animately]]\n')
  refused(c, ['trigger', '--area', AREA, '--write', '--reason', 'manual', '--record', rel], /no backlog_trigger: declared/)
  assert.deepEqual(snap(c.dir), before, '--read and a refused write wrote nothing')
  assert.ok(!fs.existsSync(path.join(c.home, 'x.json')))
})

test('(f) guard 1 names each stamp task missing from the Trigger section as unread or seen, urgent marked; guard 3 holds', () => {
  const c = copyVault('guard1', { stamped_at: '2026-11-06T09:00:00+11:00', reason: 'urgent',
    tasks: ['Work/Tasks/t-area.md', 'Work/Tasks/t-inline.md', 'Work/Tasks/t-block.md', 'Work/Tasks/t-scalar.md'],
    urgent: [{ task: 'Work/Tasks/t-scalar.md', rule: 'severity-1' }] })
  const rel = freshRecord(c, { rows: { Parks: ['[[t-inline]]: later'] } })
  const before = snap(c.dir)
  const r = writeBack(c, rel)
  assert.equal(r.status, 4, r.stderr)
  assert.equal(r.stdout, 'stamp 2026-11-06T09:00:00+11:00\nseen Work/Tasks/t-inline.md\nunread Work/Tasks/t-block.md\nunread Work/Tasks/t-scalar.md urgent\n')
  assert.match(r.stderr, /^backlog-orient: write-back held \(guard 1\)/)
  assert.deepEqual(snap(c.dir), before)
  const g3 = copyVault('guard3', { ...PULSE, last_orient_at: '2026-11-06T08:00:00+11:00' })
  const r3 = writeBack(g3, freshRecord(g3, { seen: '2026-10-28T14:05:00+11:00' }))
  assert.equal(r3.status, 4)
  assert.match(r3.stdout, /^last_orient_at 2026-11-06T08:00:00\+11:00 \(the record read 2026-10-28T14:05:00\+11:00\)$/m)
})

const HOOK = `
import importlib.util, json, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("backlog_orient", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
def stamp():
    p = sys.argv[2]
    d = json.load(open(p))
    d["stamped_at"] = "2026-11-06T09:30:00+11:00"
    d["tasks"].append("Work/Tasks/t-block.md")
    open(p, "w").write(json.dumps(d, indent=1) + "\\n")
m._before_replace = stamp
sys.exit(m.main(sys.argv[3:]))
`

test('(f) a Pulse stamp landing in _before_replace runs the guards again: exit 4, the Pulse\'s bytes intact', () => {
  const c = copyVault('hook', PULSE)
  const rel = freshRecord(c)
  const r = spawnSync('python3', ['-c', HOOK, SCRIPT, c.trig, '--vault', c.v, 'trigger', '--area', AREA, '--write', '--reason',
    'pile-up', '--record', rel], { encoding: 'utf8', env: { ...base, HOME: c.home } })
  assert.equal(r.status, 4, r.stderr)
  assert.match(r.stdout, /^stamp 2026-11-06T09:30:00\+11:00\nunread Work\/Tasks\/t-block\.md\n$/)
  const obj = JSON.parse(read(c.trig))
  assert.equal(obj.stamped_at, '2026-11-06T09:30:00+11:00')
  assert.ok(!('last_orient_at' in obj), 'the orient wrote nothing over the Pulse')
  assert.deepEqual(fs.readdirSync(c.home).filter((n) => n.endsWith('.tmp')), [])
  assert.match(read(path.join(c.v, rel)), /\nlast_orient_at:\n/)
})

// ---- (g) every disposition on one vault, then the guards -----------------------------------------------------------
const STAMPED = ['t-area', 't-inline', 'gate-two', 't-held-park'].map((s) => `Work/Tasks/${s}.md`)
const touchLater = (p) => fs.appendFileSync(p, 'Written by a fork.\n')
const ns = (iso) => BigInt(new Date(iso).getTime()) * 1000000n
// Sweep, every disposition, the forks' writes, the record and write-back #1. `skip` leaves Batches rows out.
function dispositions(name, { skip = [], mend = false } = {}) {
  const c = copyVault(name, { stamped_at: STAMP, reason: 'pile-up', tasks: STAMPED, urgent: [] })
  const at = sweep(c).read_at
  const ok = (args) => { const r = run(c, args); assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`) }
  ok(['park', '--area', AREA, '--task', 't-inline', '--reason', 'not worth a rollout yet', '--today', D])
  ok(['reopen', '--task', 't-orient-park', '--batch', 'batch 1', '--today', D])
  ok(['obsolete', '--task', 't-scalar', '--gone', 'the issue is gone', '--today', D])
  ok(['rehome', '--area', AREA, '--task', 't-area', '--to', 'Website', '--today', D])
  for (const s of ['m-a', 'm-b', 'm-c']) touchLater(tf(c, s))
  if (mend) {
    const m = spawnSync('python3', [NEXT_ACTION, '--vault', c.v, 'mend', 't-unparseable'], { encoding: 'utf8', env: { ...base, HOME: c.home } })
    assert.match(m.stdout, /mended:summary/, m.stderr)
  }
  const batches = [['website-rollout-2026-11-06', '[[website-rollout-2026-11-06]] (prior none): [[t-orient-park]]'],
    ['website-rollout-2026-11-01', '[[website-rollout-2026-11-01]] (the prior, carried)']].filter(([n]) => !skip.includes(n)).map(([, r]) => r)
  const rel = freshRecord(c, { readAt: at, rows: {
    Trigger: STAMPED.map((t) => `[[${path.basename(t, '.md')}]] pile-up`), Batches: batches,
    Parks: ['[[t-inline]]: not worth a rollout yet'], Reopens: ['[[t-orient-park]]: batch 1'],
    Obsoletes: ['[[t-scalar]]: the issue is gone'], 'Re-homes': ['[[t-area]] → [[Website]]'],
    ...(mend ? { 'Drift fixes and mends': ['[[t-unparseable]] mended:summary'] } : {}) },
  touched: ['t-inline', 't-orient-park', 't-scalar', 't-area'] })
  return { c, rel, at, wb: writeBack(c, rel) }
}
const restamp = (c, rel) => writeBack(c, rel)
const lastOrient = (c) => JSON.parse(read(c.trig)).last_orient_at

test('(g) every disposition lands, and write-back #1 lands after every task write', () => {
  const { c, wb } = dispositions('g')
  assert.equal(wb.status, 0, wb.stdout + wb.stderr)
  const L = ns(lastOrient(c))
  for (const name of fs.readdirSync(path.join(c.v, 'Work', 'Tasks')).filter((n) => n.endsWith('.md'))) {
    const m = fs.statSync(path.join(c.v, 'Work', 'Tasks', name), { bigint: true }).mtimeNs
    assert.ok(m <= L, `${name} was written after last_orient_at (${m} > ${L})`)
  }
  assert.match(read(tf(c, 't-inline')), /\nstatus: parked\nparked-by: backlog-orient /)
  assert.match(read(tf(c, 't-orient-park')), /\nstatus: open\n/)
  assert.match(read(tf(c, 't-scalar')), /\nstatus: dropped\n/)
  assert.match(read(tf(c, 't-area')), /\nprojects: \["\[\[Website\]\]"\]\n/)
})

test('(g1) a Pulse stamp after write-back #1 holds the re-stamp; (g2) so does a new Backlog task', () => {
  const g1 = dispositions('g1')
  assert.equal(g1.wb.status, 0, g1.wb.stderr)
  const obj = JSON.parse(read(g1.c.trig))
  fs.writeFileSync(g1.c.trig, `${JSON.stringify({ ...obj, stamped_at: '2026-11-07T09:00:00+11:00' }, null, 1)}\n`)
  const before = snap(g1.c.dir)
  const r1 = restamp(g1.c, g1.rel)
  assert.equal(r1.status, 4, r1.stderr)
  assert.match(r1.stderr, /re-stamp held \(guard 1\)/)
  assert.deepEqual(snap(g1.c.dir), before)
  const g2 = dispositions('g2')
  write(tf(g2.c, 't-new'), fm(task('open', '["[[Website]]"]')))
  const r2 = restamp(g2.c, g2.rel)
  assert.equal(r2.status, 4)
  assert.equal(r2.stdout, 'unread Work/Tasks/t-new.md\n')
})

test('(g3) a clean answered write lets the re-stamp land, after that write', () => {
  const { c, rel, wb } = dispositions('g3')
  assert.equal(wb.status, 0)
  const first = lastOrient(c)
  const a = append(c, rel, { rows: { 'Questions asked': ['[[t-bare]]: which page? → the gallery (recorded)'] } })
  assert.equal(a.status, 0, a.stderr)
  touchLater(tf(c, 't-bare'))
  const r = restamp(c, rel)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const L2 = ns(lastOrient(c))
  assert.ok(L2 >= fs.statSync(tf(c, 't-bare'), { bigint: true }).mtimeNs)
  assert.ok(L2 >= ns(first))
  assert.match(read(path.join(c.v, rel)), / re-stamp \(pile-up\) → /)
})

test('(g4) the fork-written members are named through the Batches notes; a Batches row removed leaves exactly its members unread', () => {
  const { c, rel, wb } = dispositions('g4')
  assert.equal(wb.status, 0, wb.stdout)
  const t = read(path.join(c.v, rel))
  for (const s of ['m-a', 'm-b', 'm-c']) {
    assert.ok(!t.includes(`[[${s}]]`), `${s} is named only through a Batches note`)
    assert.ok(fs.statSync(tf(c, s)).mtimeMs > new Date(JSON.parse(read(c.trig)).last_orient_at).getTime() - 60000)
  }
  const noNew = dispositions('g4-new', { skip: ['website-rollout-2026-11-06'] })
  assert.equal(noNew.wb.status, 4)
  assert.equal(noNew.wb.stdout, 'unread Work/Tasks/m-a.md\nunread Work/Tasks/m-b.md\n')
  const noPrior = dispositions('g4-prior', { skip: ['website-rollout-2026-11-01'] })
  assert.equal(noPrior.wb.status, 4)
  assert.equal(noPrior.wb.stdout, 'unread Work/Tasks/m-c.md\n')
})

test('(g5) the unparseable task, mended after read_at, holds the write-back until the record names it', () => {
  const c = copyVault('g5', { stamped_at: STAMP, reason: 'pile-up', tasks: [], urgent: [] })
  const at = sweep(c).read_at
  const m = spawnSync('python3', [NEXT_ACTION, '--vault', c.v, 'mend', 't-unparseable'], { encoding: 'utf8', env: { ...base, HOME: c.home } })
  assert.match(m.stdout, /mended:summary/, m.stderr)
  const bare = freshRecord(c, { readAt: at, rows: { Trigger: [] } })
  const r = writeBack(c, bare)
  assert.equal(r.status, 4)
  assert.equal(r.stdout, 'unread Work/Tasks/t-unparseable.md\n')
  const { wb } = dispositions('g5-named', { mend: true })
  assert.equal(wb.status, 0, wb.stdout)
})

test('(g6) an answered task under Answered, waiting holds the re-stamp until the section is empty', () => {
  const { c, rel, wb } = dispositions('g6')
  assert.equal(wb.status, 0)
  assert.equal(run(c, ['wait', '--task', 'gate-two', '--why', "its project's rollout already runs", '--today', D]).status, 0)
  assert.equal(append(c, rel, { rows: { 'Questions asked': ['[[gate-two]]: which shop? → the main one'],
    'Answered, waiting': ['[[gate-two]]: its project\'s rollout already runs'] } }).status, 0)
  const r = restamp(c, rel)
  assert.equal(r.status, 4)
  assert.equal(r.stdout, 'waiting Work/Tasks/gate-two.md\n')
  assert.match(r.stderr, /re-stamp held \(guard 4\)/)
  const p = path.join(c.v, rel)
  fs.writeFileSync(p, read(p).replace("- [[gate-two]]: its project's rollout already runs\n", ''))
  assert.equal(restamp(c, rel).status, 0)
})

test('(g7) a kept § 3.5 answer, recorded through estate-dispatch.py, joins the post-question round and the re-stamp lands', () => {
  const run7 = (withBatch) => {
    const { c, rel, wb } = dispositions(withBatch ? 'g7' : 'g7-unbatched')
    assert.equal(wb.status, 0)
    const q = '§ 3.5 gate: does "hold for" hold this task out of a rollout?'
    const rec = spawnSync('python3', [DISPATCH, 'record', '--vault', c.v, '--task', 'gate-one', '--question', q,
      '--answer', 'No: keep it, it holds nothing', '--recommended', 'No: keep it, it holds nothing', '--by', 'schedule',
      '--today', D], { encoding: 'utf8', env: { ...base, HOME: c.home, THREAD_EVENTS_DIR: path.join(c.dir, 'events') } })
    assert.equal(rec.status, 0, rec.stderr)
    assert.match(read(tf(c, 'gate-one')), new RegExp(`## Decisions \\(asked ahead ${D}\\)\\n\\n- § 3\\.5 gate: does "hold for" hold this task ` +
      'out of a rollout\\? → No: keep it, it holds nothing \\(asked at /thread:schedule; recommended: No: keep it, it holds nothing\\)\\n'))
    const note = 'website-rollout-2026-11-06-2'
    write(tf(c, note), fm('tags:\n  - task\n  - rollout\nstatus: open\nprojects: ["[[Website]]"]', '\n## Queue\n\n- [[gate-one]]\n'))
    const g = tf(c, 'gate-one')
    fs.writeFileSync(g, read(g).replace('status: open\n', `status: open\nrollout: "[[${note}]]"\n`))
    if (withBatch) {
      assert.equal(append(c, rel, { rows: { Batches: [`[[${note}]] (post-question round, prior none)`],
        'Rollouts started': [`[[${note}]]: stamp-start --backlog`] } }).status, 0)
    }
    return { c, rel, r: restamp(c, rel) }
  }
  const { c, r } = run7(true)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(ns(lastOrient(c)) >= fs.statSync(tf(c, 'gate-one'), { bigint: true }).mtimeNs)
  const bare = run7(false)
  assert.equal(bare.r.status, 4)
  assert.equal(bare.r.stdout, 'unread Work/Tasks/gate-one.md\n')
})

test('(g8) a held gate writes nothing to its task, takes no wait line and never holds the re-stamp', () => {
  const { c, rel, wb } = dispositions('g8')
  assert.equal(wb.status, 0)
  const before = fs.readFileSync(tf(c, 'gate-two'))
  assert.equal(append(c, rel, { rows: { 'Held by his answer': ['[[gate-two]]: "until the next release" is a gate (his answer)'] } }).status, 0)
  const r = restamp(c, rel)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(!r.stdout.includes('waiting'))
  assert.deepEqual(fs.readFileSync(tf(c, 'gate-two')), before)
  assert.ok(!read(tf(c, 'gate-two')).includes('waits for the next Backlog orient'))
})
