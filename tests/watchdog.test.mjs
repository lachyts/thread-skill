// skills/execute/scripts/watchdog.py — the Watchdog's launchd fallback (ADR 0048, p29-7; status § The Watchdog's
// reading). It probes the Chorus Stage as `ctl.sh status` does (GET <url>api/logins, never host.lock), reads every
// rollout's `reconcile-rollout.py moving` verdict in process behind an mtime gate, and notifies once per stall through
// ntfy-push.py, keyed on (slug, lastEvent). It never writes the vault or a Run record.
//
// Hermetic: each case gets its own mkdtemp dir (HOME with `[notify] ntfy_topic`, the tasks dir, the Run record dir, the
// note-lock dir, the state file), a node http server standing in for ntfy (and one for the Stage where a case needs it
// up), and a closed port for a Stage that is down. The script runs through an async spawn, so the in-process servers
// keep answering. Record mtimes are set with fs.utimesSync against a fixed --now.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WD = path.join(root, 'skills', 'execute', 'scripts', 'watchdog.py')
const RRPY = path.join(root, 'skills', '_shared', 'scripts', 'run_record.py')
const PY = execFileSync('sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).trim()
const NOW = '2026-10-26T12:00:00Z'
const T = (iso) => Date.parse(iso) / 1000
const RO = 'proj-rollout-2026-10-26'

function scratch(t, topic = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-'))
  t.after(() => { try { execFileSync('chmod', ['-R', 'u+rwX', dir]) } catch {} ; fs.rmSync(dir, { recursive: true, force: true }) })
  const s = { dir, home: path.join(dir, 'home'), tasks: path.join(dir, 'tasks'), events: path.join(dir, 'events'),
    locks: path.join(dir, 'locks'), state: path.join(dir, 'state', 'watchdog.json'), bin: path.join(dir, 'bin') }
  for (const d of [s.home, s.tasks, s.events, s.locks, s.bin]) fs.mkdirSync(d, { recursive: true })
  fs.mkdirSync(path.join(s.home, '.config', 'thread'), { recursive: true })
  setTopic(s, topic)
  fs.writeFileSync(path.join(s.bin, 'gh'), '#!/bin/sh\necho "no PR" >&2\nexit 1\n', { mode: 0o755 })
  s.env = { PATH: process.env.PATH, HOME: s.home, THREAD_EVENTS_DIR: s.events, THREAD_NOTE_LOCK_DIR: s.locks,
    THREAD_MACHINE_TIMES: '{}', THREAD_HEAT_LEVEL: '0', PYTHONDONTWRITEBYTECODE: '1', TZ: 'UTC' }
  return s
}

function setTopic(s, topic) {
  const lines = ['[defaults]', 'parallel_ceiling = 3', '']
  if (topic) lines.push('[notify]', 'ntfy_topic = "thread-watchdog-test"')
  fs.writeFileSync(path.join(s.home, '.config', 'thread', 'rollouts.toml'), lines.join('\n') + '\n')
  // A fresh Away file that lifts the Mac-wide cap, so each rollout runs to its own ceiling.
  fs.writeFileSync(path.join(s.home, '.config', 'thread', 'away.json'), JSON.stringify({ away: true, until: '2099-01-01T00:00:00Z',
    morning: '09:00', trickle: 2, away_cap: 99, written_at: '2026-10-26T00:00:00Z' }) + '\n')
}

// A started rollout with one in_progress task (or `extra` frontmatter on the rollout note, `tasks` on the queue).
function rollout(s, { ro = RO, fm = [], tasks = { a: ['status: in_progress', 'owner: lead'] } } = {}) {
  const queue = Object.keys(tasks).map((k) => `- [[${k}]]`).join('\n')
  fs.writeFileSync(path.join(s.tasks, `${ro}.md`), ['---', 'tags: [task, rollout]', 'status: in_progress',
    'protocol_version: 5', 'parallel_ceiling: 3', ...fm, '---', '', '## Queue', '', queue, ''].join('\n'))
  for (const [slug, lines] of Object.entries(tasks)) {
    fs.writeFileSync(path.join(s.tasks, `${slug}.md`), ['---', 'tags: [task]', ...lines, `rollout: "[[${ro}]]"`, '---', '', 'body', ''].join('\n'))
  }
}

function emit(s, kind, ts, { task = null, json = {}, ro = RO } = {}) {
  const argv = ['-B', RRPY, 'emit', '--rollout', ro, '--kind', kind, '--json', JSON.stringify(json), '--ts', ts]
  if (task) argv.push('--task', task)
  const r = spawnSync(PY, argv, { env: s.env, encoding: 'utf8' })
  assert.equal(r.status, 0, `emit ${kind}: ${r.stderr}`)
}
const recordPath = (s, ro = RO) => path.join(s.events, `${ro}.jsonl`)
const age = (s, iso, ro = RO) => fs.utimesSync(recordPath(s, ro), T(iso), T(iso))

async function server(t, respond) {
  const seen = []
  const sockets = new Set()
  const srv = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => { seen.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString() }); respond(req, res) })
  })
  srv.on('connection', (sk) => { sockets.add(sk); sk.on('close', () => sockets.delete(sk)) })
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { for (const sk of sockets) sk.destroy(); srv.close(() => resolve()) }))
  return { url: `http://127.0.0.1:${srv.address().port}/`, seen }
}
const ntfy = (t) => server(t, (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"x"}\n') })

async function closedPort() {
  const srv = http.createServer()
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const port = srv.address().port
  await new Promise((resolve) => srv.close(resolve))
  return `http://127.0.0.1:${port}/`
}

function run(s, args, { env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(PY, ['-B', WD, ...args], { cwd: s.dir, env: env || s.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}
const check = (s, chorus, n, extra = []) => run(s, ['check', '--tasks-dir', s.tasks, '--state', s.state, '--chorus-url', chorus,
  '--ntfy-server', n.url.replace(/\/$/, ''), '--gh-bin', path.join(s.bin, 'gh'), '--now', NOW, ...extra])
const state = (s) => (fs.existsSync(s.state) ? JSON.parse(fs.readFileSync(s.state, 'utf8')) : null)
const posts = (n) => n.seen.filter((r) => r.method === 'POST')

// A stall: an in_progress task whose lead's last life sign is 2 h old, its record untouched for 2 h.
function stall(s, opts = {}) {
  rollout(s, opts)
  emit(s, 'lead-entry', '2026-10-26T10:00:00Z', { json: { by: 'heartbeat', session: 'S' }, ro: opts.ro || RO })
  age(s, '2026-10-26T10:00:00Z', opts.ro || RO)
}

test('W1. a stall with the Stage down: one POST, the key stored', async (t) => {
  const s = scratch(t); const n = await ntfy(t); const chorus = await closedPort()
  stall(s)
  const r = await check(s, chorus, n)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(posts(n).length, 1)
  const body = JSON.parse(posts(n)[0].body)
  assert.equal(body.message, `see /thread:status ${RO} — ${RO}: rollout stalled (silent), no life sign for 120m`)
  assert.match(r.stdout, new RegExp(`${RO} stalled silent: notified`))
  assert.deepEqual(Object.keys(state(s).notified), [RO])
  assert.equal(state(s).v, 1)
  assert.equal(state(s).notified[RO].lastEvent, '2026-10-26T10:00:00.000Z')
})

test('W2 / W3. run again: no POST, already notified; a new life sign, stale again: a second POST', async (t) => {
  const s = scratch(t); const n = await ntfy(t); const chorus = await closedPort()
  stall(s)
  await check(s, chorus, n)
  const before = fs.readFileSync(s.state, 'utf8')
  const mtime = fs.statSync(s.state).mtimeMs
  const r = await check(s, chorus, n)
  assert.equal(posts(n).length, 1, 'W2: still one POST')
  assert.match(r.stdout, /already notified/)
  assert.equal(fs.readFileSync(s.state, 'utf8'), before, 'W2: the state is unchanged')
  assert.equal(fs.statSync(s.state).mtimeMs, mtime, 'W2: … and not rewritten')
  emit(s, 'lead-entry', '2026-10-26T10:30:00Z', { json: { by: 'heartbeat', session: 'S' } })
  age(s, '2026-10-26T10:30:00Z')
  const r3 = await check(s, chorus, n)
  assert.equal(posts(n).length, 2, `W3: a second POST; ${r3.stdout}`)
  assert.equal(state(s).notified[RO].lastEvent, '2026-10-26T10:30:00.000Z')
})

test('W4. the Stage answers 2xx on api/logins: no POST, state untouched, no host.lock', async (t) => {
  const s = scratch(t); const n = await ntfy(t)
  const stage = await server(t, (req, res) => { res.writeHead(req.url === '/api/logins' ? 200 : 404); res.end('[]') })
  stall(s)
  const r = await check(s, stage.url, n)
  assert.equal(r.status, 0)
  assert.equal(r.stdout.trim(), 'watchdog: Chorus is running (api/logins answered): the fallback stays silent')
  assert.equal(posts(n).length, 0)
  assert.equal(state(s), null, 'no state written')
  assert.deepEqual(stage.seen.map((q) => [q.method, q.url]), [['GET', '/api/logins']])
  assert.equal(fs.existsSync(path.join(s.home, '.local', 'state', 'chorus', 'stage', 'host.lock')), false)
  const down = await server(t, (req, res) => { res.writeHead(503); res.end('') })
  const r2 = await check(s, down.url, n)
  assert.equal(posts(n).length, 1, `a non-2xx reads as down: ${r2.stdout}`)
})

test('W5. a moving or Trickle-waiting rollout: no POST; a fresh record: recent: not read', async (t) => {
  const s = scratch(t); const n = await ntfy(t); const chorus = await closedPort()
  rollout(s)
  emit(s, 'lead-entry', '2026-10-26T11:50:00Z', { json: { by: 'heartbeat', session: 'S' } })
  age(s, '2026-10-26T10:00:00Z')
  let r = await check(s, chorus, n)
  assert.match(r.stdout, new RegExp(`${RO} moving`))
  fs.writeFileSync(path.join(s.home, '.config', 'thread', 'away.json'), JSON.stringify({ away: false, until: '2099-01-01T00:00:00Z',
    morning: '09:00', trickle: 1, away_cap: 99, written_at: '2026-10-26T00:00:00Z' }) + '\n')
  const other = 'other-rollout-2026-10-26'
  rollout(s, { ro: other, tasks: { o1: ['status: in_progress', 'owner: lead-o'] } })
  emit(s, 'lead-entry', '2026-10-26T11:58:00Z', { json: { by: 'heartbeat' }, ro: other })
  fs.rmSync(path.join(s.tasks, 'a.md'))
  rollout(s, { tasks: { q: ['status: open', 'owner: lead'] } })
  emit(s, 'lead-entry', '2026-10-26T08:00:00Z', { json: { by: 'heartbeat' } })
  age(s, '2026-10-26T08:00:00Z')
  r = await check(s, chorus, n)
  assert.match(r.stdout, new RegExp(`${RO} waiting trickle`))
  assert.match(r.stdout, new RegExp(`${other} recent: not read`))
  assert.equal(posts(n).length, 0)
})

test('W6. ntfy-push exit 4 (no topic): nothing recorded; once a topic is set, the next run POSTs', async (t) => {
  const s = scratch(t, false); const n = await ntfy(t); const chorus = await closedPort()
  stall(s)
  let r = await check(s, chorus, n)
  assert.equal(posts(n).length, 0)
  assert.match(r.stdout, /not notified \(ntfy-push exit 4\)/)
  assert.equal(state(s), null)
  setTopic(s, true)
  r = await check(s, chorus, n)
  assert.equal(posts(n).length, 1, r.stdout)
})

test('W7. plist: the job, its gh, its PATH and --chorus-url', async (t) => {
  const s = scratch(t)
  const parse = (xml) => JSON.parse(execFileSync(PY, ['-c', 'import json, plistlib, sys; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))'],
    { input: xml, encoding: 'utf8' }))
  let r = await run(s, ['plist'], { env: { ...s.env, PATH: `${s.bin}:/usr/bin:/bin` } })
  assert.equal(r.status, 0, r.stderr)
  let job = parse(r.stdout)
  assert.deepEqual(job.ProgramArguments.slice(1), [WD, 'check', '--gh-bin', path.join(s.bin, 'gh')])
  assert.ok(path.isAbsolute(job.ProgramArguments[0]))
  assert.equal(job.StartInterval, 600)
  assert.equal(job.RunAtLoad, true)
  assert.equal(job.ProcessType, 'Background')
  assert.equal(job.EnvironmentVariables.PATH.split(':')[0], s.bin)
  assert.equal(job.Label, 'com.thread.watchdog')
  r = await run(s, ['plist'], { env: { ...s.env, PATH: '/usr/bin:/bin' } })
  job = parse(r.stdout)
  assert.deepEqual(job.ProgramArguments.slice(1), [WD, 'check'])
  assert.equal(r.stderr.split('\n').filter((l) => l.startsWith('WARN')).length, 1)
  r = await run(s, ['plist', '--chorus-url', ''], { env: { ...s.env, PATH: `${s.bin}:/usr/bin:/bin` } })
  job = parse(r.stdout)
  assert.deepEqual(job.ProgramArguments.slice(-2), ['--chorus-url', ''])
})

test('W8. --dry-run posts and writes nothing', async (t) => {
  const s = scratch(t); const n = await ntfy(t); const chorus = await closedPort()
  stall(s)
  const r = await check(s, chorus, n, ['--dry-run'])
  assert.match(r.stdout, /would notify/)
  assert.equal(posts(n).length, 0)
  assert.equal(state(s), null)
})

test('W9. a write that is no life sign keeps the key: recent while fresh, then already notified', async (t) => {
  const s = scratch(t); const n = await ntfy(t); const chorus = await closedPort()
  stall(s)
  await check(s, chorus, n)
  emit(s, 'suite-ended', '2026-10-26T11:58:00Z', { task: 'a', json: { suite: 's-0123456789abcdef', by: 'integration', runner: 'lead',
    outcome: 'green', seconds: 1 } })
  age(s, '2026-10-26T11:58:00Z')
  let r = await check(s, chorus, n)
  assert.match(r.stdout, /recent: not read/)
  assert.deepEqual(Object.keys(state(s).notified), [RO], 'the key is kept')
  age(s, '2026-10-26T10:00:00Z')
  r = await check(s, chorus, n)
  assert.match(r.stdout, /already notified/)
  assert.equal(posts(n).length, 1)
})

test('W10. an unreadable record is a lost look: the key is kept, then already notified', async (t) => {
  const s = scratch(t); const n = await ntfy(t); const chorus = await closedPort()
  stall(s)
  await check(s, chorus, n)
  fs.chmodSync(recordPath(s), 0o000)
  let r = await check(s, chorus, n)
  assert.match(r.stdout, /not read: .*a lost look, never a stall/)
  assert.deepEqual(Object.keys(state(s).notified), [RO])
  fs.chmodSync(recordPath(s), 0o644)
  age(s, '2026-10-26T10:00:00Z')
  r = await check(s, chorus, n)
  assert.match(r.stdout, /already notified/)
  assert.equal(posts(n).length, 1)
})

test('W11. a notified rollout that then reads paused drops its key', async (t) => {
  const s = scratch(t); const n = await ntfy(t); const chorus = await closedPort()
  stall(s)
  await check(s, chorus, n)
  const p = path.join(s.tasks, `${RO}.md`)
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('protocol_version: 5', 'protocol_version: 5\npaused: 2026-10-26T11:00+00:00'))
  const r = await check(s, chorus, n)
  assert.match(r.stdout, new RegExp(`${RO} waiting paused`))
  assert.deepEqual(state(s).notified, {})
})

test('W12. a merge-held rollout whose lead fell silent 2 h ago: one POST naming silent', async (t) => {
  const s = scratch(t); const n = await ntfy(t); const chorus = await closedPort()
  rollout(s, { tasks: { a: ['status: review', 'owner: lead', 'pr: https://github.com/o/r/pull/5', 'ready: 2026-10-26T07:00+00:00',
    'integrating: 2026-10-26T08:00+00:00'] } })
  emit(s, 'lane-taken', '2026-10-26T08:00:00Z', { task: 'a' })
  emit(s, 'hold-started', '2026-10-26T08:01:00Z', { task: 'a', json: { hold: 'merge' } })
  emit(s, 'lead-entry', '2026-10-26T10:00:00Z', { json: { by: 'heartbeat' } })
  age(s, '2026-10-26T10:00:00Z')
  const r = await check(s, chorus, n)
  assert.equal(posts(n).length, 1, r.stdout)
  assert.match(JSON.parse(posts(n)[0].body).message, /rollout stalled \(silent\), no life sign for 120m/)
})
