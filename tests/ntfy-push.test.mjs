// skills/execute/scripts/ntfy-push.py — the needs-you push's ntfy fallback (execute § 6.5 *The ntfy fallback*, ADR 0038
// decision 3). The lead pipes the one-line push message in through a quoted heredoc; the script reads the topic from
// rollouts.toml's `[notify] ntfy_topic` itself and publishes one JSON body with curl, so the topic never reaches a
// command line, a URL, a header or stdout, and an em dash never goes in a header.
//
// Hermetic: each case gets its own mkdtemp HOME (so tests/run.sh's seeded, refused rollouts.toml is never read), an env
// built from scratch (no proxy variables, no ~/.curlrc), and its own node http server on 127.0.0.1:0 passed as
// --server, standing in for ntfy.sh. The script runs through an async spawn, never spawnSync, which would block the
// event loop the in-process server answers on. Ordinary cases run `python3 -B` with PYTHONDONTWRITEBYTECODE=1; the
// bytecode case runs a copy of the plugin layout without either and walks it for __pycache__. Nothing is written to
// the tree.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn, execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(root, 'skills', 'execute', 'scripts', 'ntfy-push.py')
const SHARED = path.join(root, 'skills', '_shared', 'scripts')
const PY = execFileSync('sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).trim()
const MESSAGE = 'sign off gated input — p23-3: spend: "two runs" at $HOME `x` [[x]] — cap 5 USD'

// ---- helpers ----------------------------------------------------------------------------------------------

function tmpHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ntfy-push-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return home
}

const settingsPath = (home) => path.join(home, '.config', 'thread', 'rollouts.toml')

function writeSettings(home, lines) {
  const p = settingsPath(home)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, lines.join('\n') + '\n')
  return p
}

const withTopic = (home, topic = 'thread-needs-you') => writeSettings(home, ['[defaults]', 'parallel_ceiling = 3', '', '[notify]', `ntfy_topic = "${topic}"`])

const ok = (res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"id":"abc","event":"message"}\n') }

// A local ntfy stand-in: records every request (method, url, headers, body) and answers through `respond`.
async function server(t, respond = (req, res) => ok(res)) {
  const seen = []
  const sockets = new Set()
  const srv = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('latin1') })
      respond(req, res)
    })
  })
  srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { for (const s of sockets) s.destroy(); srv.close(() => resolve()) }))
  return { url: `http://127.0.0.1:${srv.address().port}`, seen }
}

// The script with `input` on stdin, asynchronously, so the in-process server keeps answering.
function run(home, args, input, { argv, env, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(PY, argv || ['-B', SCRIPT, ...args], {
      cwd: cwd || home,
      env: env || { PATH: process.env.PATH, HOME: home, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr, elapsed: Date.now() - started }))
    child.stdin.on('error', () => {})  // a script that exits before reading all of stdin
    child.stdin.end(input)
  })
}

// Refused before any request: exit `code`, nothing on stdout, one `<prefix>…` line on stderr, the server saw nothing.
function refusedNoRequest(r, srv, code, re) {
  assert.equal(r.status, code, `exit ${code}; stderr: ${r.stderr}`)
  assert.equal(r.stdout, '')
  assert.doesNotMatch(r.stderr, /Traceback/)
  assert.match(r.stderr, /^[^\n]+\n$/, `one stderr line; got ${JSON.stringify(r.stderr)}`)
  assert.match(r.stderr, re)
  assert.equal(srv.seen.length, 0, 'no request was made')
}

// ---- sends ------------------------------------------------------------------------------------------------

test('sends: one JSON POST holding topic, message, title and priority 4; the message byte-exact; the topic only in the body', async (t) => {
  const home = tmpHome(t)
  withTopic(home)
  const srv = await server(t)
  const r = await run(home, ['--server', srv.url], `${MESSAGE}\n`)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'ntfy-push: sent\n')
  assert.equal(r.stderr, '')
  assert.equal(srv.seen.length, 1)
  const [req] = srv.seen
  assert.equal(req.method, 'POST')
  assert.equal(req.url, '/', 'a JSON publish goes to the server root: the topic is in no URL path')
  assert.equal(req.headers['content-type'], 'application/json')
  for (const h of ['title', 'x-title', 't', 'message', 'x-message', 'priority', 'x-priority']) {
    assert.equal(req.headers[h], undefined, `no ${h} header: every field is in the JSON body`)
  }
  assert.match(req.body, /^[\x20-\x7e]*$/, 'the body is ASCII (json.dumps escapes the em dash), one line')
  assert.deepEqual(JSON.parse(req.body), { topic: 'thread-needs-you', message: MESSAGE, title: 'thread: needs you', priority: 4 })
  assert.ok(!r.stdout.includes('thread-needs-you') && !r.stderr.includes('thread-needs-you'), 'the topic is never printed')
})

test('a trailing heredoc newline is stripped; a message with none is sent as is', async (t) => {
  for (const input of ['msg\n', 'msg']) {
    const home = tmpHome(t)
    withTopic(home)
    const srv = await server(t)
    const r = await run(home, ['--server', srv.url], input)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(JSON.parse(srv.seen[0].body).message, 'msg', JSON.stringify(input))
  }
})

// ---- no topic ---------------------------------------------------------------------------------------------

test('no [notify] table, or no rollouts.toml: exit 4, the path named on stdout, no request', async (t) => {
  for (const lines of [['[defaults]', 'parallel_ceiling = 3'], null]) {
    const home = tmpHome(t)
    if (lines) writeSettings(home, lines)
    const srv = await server(t)
    const r = await run(home, ['--server', srv.url], `${MESSAGE}\n`)
    assert.equal(r.status, 4, r.stderr)
    assert.equal(r.stdout, `ntfy-push: no [notify] ntfy_topic in ${settingsPath(home)}: fallback skipped\n`)
    assert.equal(r.stderr, '')
    assert.equal(srv.seen.length, 0, 'no request without a topic')
  }
})

// ---- delivery failures ------------------------------------------------------------------------------------

test('a server 500: exit 1, one `delivery failed` stderr line, no traceback, the topic unprinted', async (t) => {
  const home = tmpHome(t)
  withTopic(home)
  const srv = await server(t, (req, res) => { res.writeHead(500); res.end('boom\n') })
  const r = await run(home, ['--server', srv.url], `${MESSAGE}\n`)
  assert.equal(r.status, 1)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^ntfy-push: delivery failed: [^\n]+\n$/)
  assert.doesNotMatch(r.stderr, /Traceback|thread-needs-you/)
  assert.equal(srv.seen.length, 1)
})

test('a server that accepts and never answers: --timeout 1 bounds curl, exit 1 within 10 s', async (t) => {
  const home = tmpHome(t)
  withTopic(home)
  const srv = await server(t, () => {})
  const r = await run(home, ['--server', srv.url, '--timeout', '1'], `${MESSAGE}\n`)
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /^ntfy-push: delivery failed: [^\n]+\n$/)
  assert.ok(r.elapsed < 10000, `bounded: took ${r.elapsed}ms`)
})

test('a curl that outlives its -m bound is killed by the backstop (timeout + 5 s): exit 1', async (t) => {
  const home = tmpHome(t)
  withTopic(home)
  const bin = path.join(home, 'fakebin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nexec /bin/sleep 30\n', { mode: 0o755 })
  const r = await run(home, ['--server', 'http://127.0.0.1:9', '--timeout', '1'], `${MESSAGE}\n`,
    { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 1, r.stderr)
  assert.match(r.stderr, /^ntfy-push: delivery failed: [^\n]*6 ?s[^\n]*\n$/)
  assert.ok(r.elapsed < 15000, `bounded by the backstop: took ${r.elapsed}ms`)
})

test('no curl on PATH: exit 1, one `delivery failed` line, no traceback', async (t) => {
  const home = tmpHome(t)
  withTopic(home)
  const empty = path.join(home, 'empty-bin')
  fs.mkdirSync(empty)
  const r = await run(home, ['--server', 'http://127.0.0.1:9'], `${MESSAGE}\n`, { env: { PATH: empty, HOME: home, PYTHONDONTWRITEBYTECODE: '1' } })
  assert.equal(r.status, 1, r.stderr)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^ntfy-push: delivery failed: [^\n]*curl[^\n]*\n$/)
  assert.doesNotMatch(r.stderr, /Traceback/)
})

// ---- refusals (exit 2 or 3, no request) ----------------------------------------------------------------------

test('a refused rollouts.toml: exit 2, rollout-settings\' own line with its line number, no request', async (t) => {
  const home = tmpHome(t)
  writeSettings(home, ['[notify]', 'ntfy_topic = ""'])
  const srv = await server(t)
  const r = await run(home, ['--server', srv.url], `${MESSAGE}\n`)
  const p = settingsPath(home).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  refusedNoRequest(r, srv, 2, new RegExp(`^rollout-settings: ${p}:2: \\[notify\\] ntfy_topic must be`))
})

test('a present rollouts.toml without tomllib: exit 3 passed through from the resolver, no request', async (t) => {
  const home = tmpHome(t)
  withTopic(home)
  const srv = await server(t)
  const argv = ['-B', '-c', "import sys, runpy; s = sys.argv[1]; sys.modules['tomllib'] = None; sys.argv = [s] + sys.argv[2:]; runpy.run_path(s, run_name='__main__')",
    SCRIPT, '--server', srv.url]
  const r = await run(home, [], `${MESSAGE}\n`, { argv })
  refusedNoRequest(r, srv, 3, /^rollout-settings: .*python >= 3\.11/)
})

test('an empty message, or one that is only a newline: exit 2, no request', async (t) => {
  for (const input of ['', '\n']) {
    const home = tmpHome(t)
    withTopic(home)
    const srv = await server(t)
    refusedNoRequest(await run(home, ['--server', srv.url], input), srv, 2, /^ntfy-push: the message is empty\n$/)
  }
})

test('a message of two lines, or with an inner carriage return: exit 2, `must be one line`, no request', async (t) => {
  for (const input of ['a\nb\n', 'a\rb\n', 'a\r\n', 'a\n\n']) {
    const home = tmpHome(t)
    withTopic(home)
    const srv = await server(t)
    refusedNoRequest(await run(home, ['--server', srv.url], input), srv, 2, /^ntfy-push: the message must be one line\n$/)
  }
})

test('usage: --timeout 0, 601 or x, --server ftp://x, an unknown flag: exit 2 before stdin or settings are read', async (t) => {
  for (const args of [['--timeout', '0'], ['--timeout', '601'], ['--timeout', 'x'], ['--server', 'ftp://x'], ['--server', 'ntfy.sh'], ['--bogus']]) {
    const home = tmpHome(t)
    writeSettings(home, ['[notify]', 'ntfy_topic = ""'])  // refused, so a usage error that read settings would print rollout-settings'
    const srv = await server(t)
    const all = args[0] === '--server' || args[0] === '--bogus' ? args : ['--server', srv.url, ...args]
    refusedNoRequest(await run(home, all, 'a\nb\n'), srv, 2, /^ntfy-push: /)
  }
})

// ---- bytecode, mode and syntax ------------------------------------------------------------------------------

test('no bytecode: a run without -B or PYTHONDONTWRITEBYTECODE leaves no __pycache__ beside the scripts it loads', async (t) => {
  const home = tmpHome(t)
  withTopic(home)
  const srv = await server(t)
  // A copy of the plugin layout, so a red run never litters the real tree.
  const plugin = path.join(home, 'plugin')
  const shared = path.join(plugin, 'skills', '_shared', 'scripts')
  const exec = path.join(plugin, 'skills', 'execute', 'scripts')
  fs.mkdirSync(shared, { recursive: true })
  fs.mkdirSync(exec, { recursive: true })
  for (const f of ['rollout-settings.py', 'ladder.py']) fs.copyFileSync(path.join(SHARED, f), path.join(shared, f))
  fs.copyFileSync(SCRIPT, path.join(exec, 'ntfy-push.py'))
  const env = { PATH: process.env.PATH, HOME: home }
  assert.equal(env.PYTHONDONTWRITEBYTECODE, undefined)
  const r = await run(home, [], `${MESSAGE}\n`, { argv: [path.join(exec, 'ntfy-push.py'), '--server', srv.url], env })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(srv.seen.length, 1)
  // A filesystem walk, never git status: .gitignore hides __pycache__ from git.
  const caches = fs.readdirSync(plugin, { recursive: true }).filter((p) => p.split(path.sep).includes('__pycache__'))
  assert.deepEqual(caches, [], 'no __pycache__ under the plugin copy')
})

test('ntfy-push.py is executable and parses as python 3.8', () => {
  assert.ok(fs.statSync(SCRIPT).mode & 0o111, 'mode 0755, like step-boundary.py')
  assert.ok(fs.readFileSync(SCRIPT, 'utf8').startsWith('#!/usr/bin/env python3\n'))
  const r = spawnSync(PY, ['-B', '-c', 'import ast, sys\nast.parse(open(sys.argv[1]).read(), sys.argv[1], feature_version=(3, 8))', SCRIPT], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
