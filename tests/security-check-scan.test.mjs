// skills/execute/scripts/security-check.py — the opt-in Security check (execute § 3 `security_checks`): a scan of the
// task's own commits and each merge's resolution for secrets (gitleaks) and of the dependencies its diff adds or changes
// for advisories (OSV), before the PR, read by the engine's agents and the review judge; and, with --anchor, of
// Integration's own commits and merge resolutions since the anchor, read by the integrator and the Integration judge.
//
// Hermetic: each case builds its own mktemp repo whose only remote is a local bare repo (its upload-pack wrapped, so a
// case sees whether origin was read), a stub gitleaks (THREAD_GITLEAKS: a python script that emulates the github-pat
// rule over the range it is given, honours `gitleaks:allow` unless --ignore-gitleaks-allow, and records its argv, cwd,
// the GIT_DIR / GITLEAKS_* it saw and the scanner config in its cwd) and, where a case needs one, a node http stub OSV
// server on 127.0.0.1:0 that counts its requests and records their bodies. The script runs through an async spawn, so
// the in-process server keeps answering. The real-gitleaks cases run only where the script's own lookup finds one
// (preflight), else they skip with the reason (CI has none). The fake secret is built at run time from a fixed sha512,
// so no token sits in this file. Mutation controls copy the script to temp with one textual edit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SC = path.join(root, 'skills', 'execute', 'scripts', 'security-check.py')
const PY = execFileSync('sh', ['-c', 'command -v python3'], { encoding: 'utf8' }).trim()
const GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim()
const CLOSED = 'http://127.0.0.1:9'

// The inherited env without any GIT_* or THREAD_GITLEAKS / THREAD_OSV_URL, plus a scratch global git config.
function baseEnv(dir) {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('GIT_') || k.startsWith('GITLEAKS_') || k === 'THREAD_GITLEAKS' || k === 'THREAD_OSV_URL') continue
    env[k] = v
  }
  const cfg = path.join(dir, 'gitconfig')
  if (!fs.existsSync(cfg)) fs.writeFileSync(cfg, '[user]\n\tname = t\n\temail = t@example.invalid\n[init]\n\tdefaultBranch = main\n[advice]\n\tdetachedHead = false\n')
  env.GIT_CONFIG_GLOBAL = cfg
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.PYTHONDONTWRITEBYTECODE = '1'
  return env
}

// The fake secret: 'gh' + 'p_' and 36 base62 characters from a fixed sha512 (high entropy, as gitleaks's rule needs).
const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function fakeToken(seed = 'thread-security-fixture') {
  const h = crypto.createHash('sha512').update(seed).digest()
  let s = ''
  for (let i = 0; i < 36; i++) s += ALPHA[h[i] % 62]
  return 'gh' + 'p_' + s
}
const TOKEN = fakeToken()
const TOKEN2 = fakeToken('thread-security-fixture-2')
const TOKEN3 = fakeToken('thread-security-fixture-3')

const STUB = (py) => `#!${py}
import json, os, re, subprocess, sys
if sys.argv[1:2] == ["version"]:
    print(os.environ.get("STUB_VERSION", "8.30.1")); sys.exit(0)
args = sys.argv[1:]
src, opts, flags, i = args[1], {}, set(), 2
while i < len(args):
    a = args[i]
    if a.startswith("--log-opts="):
        opts["log"] = a[len("--log-opts="):]
    elif a in ("--report-path", "--report-format", "--exit-code", "--log-level", "--config"):
        opts[a] = args[i + 1]; i += 1
    else:
        flags.add(a)
    i += 1
def rd(p):
    try:
        return open(p).read()
    except OSError:
        return None
cwd = os.getcwd()
rec = {"argv": args, "cwd": cwd, "env": {k: v for k, v in os.environ.items() if k == "GIT_DIR" or k.startswith("GITLEAKS_")},
       "ignore": rd(os.path.join(cwd, ".gitleaksignore")), "config": rd(opts["--config"]) if "--config" in opts else None}
if os.environ.get("STUB_LOG"):
    open(os.environ["STUB_LOG"], "a").write(json.dumps(rec) + "\\n")
out = subprocess.run(["git", "-C", src, "log", "-p", "--format=COMMIT %H", *opts["log"].split()], capture_output=True, text=True).stdout
found, commit, file, ln = [], None, None, 0
for line in out.split("\\n"):
    if line.startswith("COMMIT "):
        commit = line.split()[1]; continue
    if line.startswith("+++ "):
        file = line[6:] if line.startswith("+++ b/") else None; continue
    if line.startswith("--- ") or line.startswith("diff --git"):
        continue
    m = re.match(r"^@@ -\\d+(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@", line)
    if m:
        ln = int(m.group(1)); continue
    if file is None:
        continue
    if line.startswith("+"):
        if re.search(r"ghp_[0-9A-Za-z]{36}", line) and ("--ignore-gitleaks-allow" in flags or "gitleaks:allow" not in line):
            found.append({"RuleID": "github-pat", "File": file, "StartLine": ln, "Commit": commit, "Secret": "REDACTED", "Match": "REDACTED",
                          "Fingerprint": f"{commit}:{file}:github-pat:{ln}"})
        ln += 1
    elif line.startswith(" "):
        ln += 1
json.dump(found, open(opts["--report-path"], "w"))
`

// The real gitleaks the script itself would find (preflight with no THREAD_GITLEAKS), or null.
const REAL = (() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-real-'))
  try {
    const r = spawnSync(PY, [SC, 'preflight'], { env: baseEnv(dir), encoding: 'utf8' })
    return r.status === 0 ? JSON.parse(r.stdout).gitleaks : null
  } catch { return null } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})()
const realSkip = REAL ? false : 'gitleaks not found'

// The sandbox's helpers.
function attach(s) {
  s.write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(s.tree, rel)), { recursive: true }); fs.writeFileSync(path.join(s.tree, rel), text) }
  s.commit = (msg, ...files) => { s.git('add', '-A', ...files); s.git('commit', '-q', '--allow-empty', '-m', msg); return s.git('rev-parse', 'HEAD') }
  s.leak = (file = 'cfg.py', tok = TOKEN, extra = '') => { s.write(file, `TOKEN = "${tok}"${extra}\n`); return s.commit(`add ${file}`) }
  s.head = () => s.git('rev-parse', 'HEAD')
  s.stubLog = () => (fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  s.packed = () => (fs.existsSync(s.packLog) ? fs.readFileSync(s.packLog, 'utf8') : '')
  s.note = (lines) => { const p = path.join(s.dir, 'task note.md'); fs.writeFileSync(p, ['---', 'tags: [task]', '---', '', '## Notes', '', 'x', '', '## Repair input', '', ...lines, ''].join('\n')); return p }
  return s
}
// One case's sandbox: a bare origin (default branch `def`) whose upload-pack is wrapped (packLog), and a tree with one
// commit pushed, on branch feat (o.bare: no commit at all). o.worktree: production's only shape, the tree is a linked
// worktree at <main>/.claude/worktrees/proj-fix-x (a gitfile) holding feat, the main checkout (s.main) back on `def`.
function box(t, o) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-scan-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const def = (o && o.def) || 'main'
  const s = attach({ dir, origin: path.join(dir, 'o.git'), tree: path.join(dir, (o && o.treeName) || 'tree'), bin: path.join(dir, 'bin'),
    log: path.join(dir, 'stub.jsonl'), packLog: path.join(dir, 'upload-pack.log'), tmp: path.join(dir, 'tmp'), def })
  fs.mkdirSync(s.bin); fs.mkdirSync(s.tmp)
  s.env = baseEnv(dir)
  s.stub = path.join(s.bin, 'gitleaks')
  fs.writeFileSync(s.stub, STUB(PY), { mode: 0o755 })
  s.git = (...a) => execFileSync(GIT, ['-C', s.tree, ...a], { encoding: 'utf8', env: s.env }).trim()
  execFileSync(GIT, ['init', '-q', '--bare', '-b', def, s.origin], { env: s.env })
  execFileSync(GIT, ['init', '-q', '-b', def, s.tree], { env: s.env })
  s.git('remote', 'add', 'origin', s.origin)
  const pack = path.join(s.bin, 'upload-pack.sh')
  fs.writeFileSync(pack, `#!/bin/sh\necho "upload-pack $*" >> '${s.packLog}'\nexec '${GIT}' upload-pack "$@"\n`, { mode: 0o755 })
  s.git('config', 'remote.origin.uploadpack', pack)
  if (!(o && o.bare)) {
    s.write('README.md', 'hello\n')
    s.commit('init')
    s.git('push', '-q', 'origin', def)
    s.git('checkout', '-q', '-b', 'feat')
    if (o && o.worktree) {
      s.main = s.tree
      s.git('checkout', '-q', def)
      s.tree = path.join(s.main, '.claude', 'worktrees', 'proj-fix-x')
      execFileSync(GIT, ['-C', s.main, 'worktree', 'add', '-q', s.tree, 'feat'], { env: s.env })
    }
  }
  return s
}

function runPy(argv, env) {
  return new Promise((resolve) => {
    const p = spawn(PY, argv, { env })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d })
    p.on('close', (code) => resolve({ status: code, stdout: out, stderr: err }))
  })
}

// One scan of the sandbox's tree: { status, stdout, stderr, json }. Every run is checked for the secret's text (S14).
async function scan(s, { real = false, base = `origin/${s.def}`, note, osv = CLOSED, extra = [], env = {}, script = SC, tree = s.tree } = {}) {
  const e = { ...s.env, TMPDIR: s.tmp, STUB_LOG: s.log, ...env }
  if (real) delete e.THREAD_GITLEAKS
  else if (!('THREAD_GITLEAKS' in env)) e.THREAD_GITLEAKS = s.stub
  const argv = [script, 'scan', '--tree', tree, '--base', base]
  if (note) argv.push('--accepts-from', note)
  if (osv === null) argv.push('--no-advisories')
  else if (osv) argv.push('--osv-url', osv)
  const r = await runPy([...argv, ...extra], e)
  for (const tok of [TOKEN, TOKEN2, TOKEN3, TOKEN.slice(4), TOKEN2.slice(4), TOKEN3.slice(4)]) {
    assert.ok(!r.stdout.includes(tok) && !r.stderr.includes(tok), 'S14: the secret value never reaches stdout or stderr')
  }
  r.json = r.stdout.trim() ? JSON.parse(r.stdout) : null
  if (r.status === 2) assert.equal(r.stdout, '', 'an exit 2 prints no stdout')
  return r
}

// The script copied to temp with one textual edit (a mutation control).
function mutant(s, from, to) {
  const text = fs.readFileSync(SC, 'utf8')
  assert.ok(text.includes(from), `mutation setup: ${from.slice(0, 60)} not found`)
  const p = path.join(s.dir, 'mutant-security-check.py')
  fs.writeFileSync(p, text.replace(from, to))
  return p
}
function lineMutant(s, marker, replacement) {
  const lines = fs.readFileSync(SC, 'utf8').split('\n')
  const i = lines.findIndex((l) => l.includes(marker))
  assert.ok(i >= 0, `mutation setup: ${marker} not found`)
  const indent = lines[i].match(/^\s*/)[0]
  lines[i] = indent + replacement
  const p = path.join(s.dir, 'mutant-security-check.py')
  fs.writeFileSync(p, lines.join('\n'))
  return p
}

// The stub OSV: `vulns` maps `<ecosystem>|<name>` to the vulns querybatch reports; GET /v1/vulns/<id> returns one, or
// answers 500 when its id is in `fail`.
async function osvStub(t, vulns = {}, { fail = [] } = {}) {
  const seen = []
  const byId = {}
  for (const list of Object.values(vulns)) for (const v of list) byId[v.id] = v
  const srv = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      seen.push({ method: req.method, url: req.url, body })
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'POST' && req.url === '/v1/querybatch') {
        const q = JSON.parse(body).queries
        res.end(JSON.stringify({ results: q.map((x) => ({ vulns: (vulns[`${x.package.ecosystem}|${x.package.name}`] || []).map((v) => ({ id: v.id, modified: '2026-01-01T00:00:00Z' })) })) }))
      } else if (req.method === 'GET' && req.url.startsWith('/v1/vulns/')) {
        const id = decodeURIComponent(req.url.slice('/v1/vulns/'.length))
        const v = byId[id]
        if (fail.includes(id)) { res.statusCode = 500; res.end('{}') } else if (!v) { res.statusCode = 404; res.end('{}') } else res.end(JSON.stringify(v))
      } else { res.statusCode = 404; res.end('{}') }
    })
  })
  const sockets = new Set()
  srv.on('connection', (sk) => { sockets.add(sk); sk.on('close', () => sockets.delete(sk)) })
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { for (const sk of sockets) sk.destroy(); srv.close(() => resolve()) }))
  return { url: `http://127.0.0.1:${srv.address().port}`, seen, queries: () => seen.filter((x) => x.url === '/v1/querybatch').flatMap((x) => JSON.parse(x.body).queries) }
}
const vuln = (id, eco, name, ranges) => ({ id, affected: [{ package: { ecosystem: eco, name }, ranges }] })
const eco = (events) => ({ type: 'ECOSYSTEM', events })
const entry = (ask, answer, key = '', stamp = '2026-11-04T10:00+11:00') => `- ${stamp} needs you (block 0123456789ab${key}): "${ask}" → ${answer}`

// ---- S1-S3: clean, a fake secret, history -------------------------------------------------------------------------

for (const real of [false, true]) {
  const tag = real ? 'real gitleaks' : 'stub'
  test(`S1 (${tag}): a commit with no secret exits 0, clean, an empty brief, and origin is never read`, { skip: real && realSkip }, async (t) => {
    const s = box(t)
    s.write('src/app.py', 'print("hi")\n'); s.commit('clean')
    const r = await scan(s, { real })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.json.result, 'clean')
    assert.equal(r.json.action, null)
    assert.deepEqual(r.json.brief, [])
    assert.deepEqual(r.json.secrets, [])
    assert.equal(s.packed(), '', 'no ls-remote on a clean scan')
  })

  test(`S2 (${tag}): a runtime-built token in cfg.py exits 1, action fix, rewriteFrom its parent`, { skip: real && realSkip }, async (t) => {
    const s = box(t)
    const parent = s.head()
    const leak = s.leak()
    const r = await scan(s, { real })
    assert.equal(r.status, 1, r.stderr)
    assert.equal(r.json.result, 'red')
    assert.equal(r.json.action, 'fix')
    const [sec] = r.json.secrets
    assert.deepEqual({ ...sec, accept: undefined }, { rule: 'github-pat', file: 'cfg.py', line: 1, commit: leak, pushed: false, accept: undefined })
    assert.match(sec.accept, /^secret:[0-9a-f]{12}$/)
    assert.equal(r.json.rewriteFrom, parent)
  })
}

test('S3: a secret removed by a later commit is still red; a soft reset to rewriteFrom and one commit clears it', async (t) => {
  const s = box(t)
  s.leak()
  s.write('cfg.py', 'TOKEN = os.environ["TOKEN"]\n'); s.commit('read it from the env')
  const r = await scan(s)
  assert.equal(r.status, 1)
  assert.equal(r.json.action, 'fix')
  s.git('reset', '--soft', r.json.rewriteFrom)
  s.commit('cfg reads the token from the env')
  const r2 = await scan(s)
  assert.equal(r2.status, 0, r2.stdout)
  assert.deepEqual(r2.json.secrets, [])
})

// ---- S4: pushed ---------------------------------------------------------------------------------------------------

test('S4: a leak commit already on refs/remotes/origin/<branch> is human, already on origin, its accept and recut named', async (t) => {
  const s = box(t)
  s.leak()
  s.git('push', '-q', 'origin', 'feat')
  const r = await scan(s)
  assert.equal(r.status, 1)
  assert.equal(r.json.action, 'human')
  assert.equal(r.json.secrets[0].pushed, true)
  assert.match(r.json.why, /already on origin/)
  assert.ok(r.json.why.includes(`\`security-accept ${r.json.secrets[0].accept}\``), r.json.why)
  assert.match(r.json.why, /recut/)
})

test('S4b: a stale tracking ref is caught by ls-remote, the head fetched into the scratch clone only (and its control)', async (t) => {
  const s = box(t)
  const leak = s.leak()
  // Put on origin from a second clone that fetched the leak commit from the tree and built on it there. The tree never
  // pushes feat, so none of its tracking refs moves on any git (git 2.56 moves refs/remotes/origin/<b> on a push to a
  // URL that names exactly one configured remote), and origin's head is not a local object.
  const other = path.join(s.dir, 'other')
  execFileSync(GIT, ['clone', '-q', s.origin, other], { env: s.env })
  execFileSync(GIT, ['-C', other, 'fetch', '-q', s.tree, 'feat'], { env: s.env })
  execFileSync(GIT, ['-C', other, 'checkout', '-q', '-b', 'feat', 'FETCH_HEAD'], { env: s.env })
  fs.writeFileSync(path.join(other, 'more.txt'), 'more\n')
  execFileSync(GIT, ['-C', other, 'add', '-A'], { env: s.env })
  execFileSync(GIT, ['-C', other, 'commit', '-q', '-m', 'more'], { env: s.env })
  execFileSync(GIT, ['-C', other, 'push', '-q', 'origin', 'feat'], { env: s.env })
  const R = execFileSync(GIT, ['-C', other, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: s.env }).trim()
  assert.notEqual(spawnSync(GIT, ['-C', s.tree, 'cat-file', '-e', `${R}^{commit}`], { env: s.env }).status, 0, 'setup: R not local')
  assert.equal(s.git('branch', '-r', '--contains', leak), '', 'setup: no tracking ref holds the leak commit')
  assert.equal(s.packed(), '', 'setup: origin not read yet')
  const refs = s.git('for-each-ref')
  const r = await scan(s)
  assert.equal(r.json.secrets[0].commit, leak)
  assert.equal(r.json.secrets[0].pushed, true)
  assert.equal(r.json.action, 'human')
  assert.match(s.packed(), /upload-pack/, 'origin was read')
  assert.equal(s.git('for-each-ref'), refs, 'S14: the fetch leaves no ref in the tree\'s repo')
  assert.notEqual(spawnSync(GIT, ['-C', s.tree, 'cat-file', '-e', `${R}^{commit}`], { env: s.env }).status, 0, 'nor the object')
  // Control: a live read that always says "origin has no such branch" leaves only the stale tracking state, which reads
  // unpushed, so the pass above came through the live ls-remote read alone.
  const LS = 'rc, out, _err = _git(self.tree, "ls-remote", "--exit-code", "origin", f"refs/heads/{branch}",\n' +
    '                             timeout=LS_REMOTE_TIMEOUT, check=False)'
  const m = await scan(s, { script: mutant(s, LS, 'rc, out, _err = 2, "", ""') })
  assert.equal(m.json.secrets[0].pushed, false, 'control: without the live read the stale tracking ref reads unpushed')
  assert.equal(m.json.action, 'fix')
})

test('S4c: origin has no such branch: pushed false, action fix', async (t) => {
  const s = box(t)
  s.leak()
  const r = await scan(s)
  assert.equal(r.json.secrets[0].pushed, false)
  assert.equal(r.json.action, 'fix')
  assert.match(s.packed(), /upload-pack/, 'ls-remote ran')
})

test('S4d: an unreadable origin: pushed null, human, could not be read', async (t) => {
  const s = box(t)
  s.leak()
  s.git('remote', 'set-url', 'origin', path.join(s.dir, 'no-such-origin.git'))
  const r = await scan(s)
  assert.equal(r.json.secrets[0].pushed, null)
  assert.ok(r.json.secrets[0].pushedWhy)
  assert.equal(r.json.action, 'human')
  assert.match(r.json.why, /could not be read/)
})

test('S4e: a detached HEAD: pushed null', async (t) => {
  const s = box(t)
  s.leak()
  s.git('checkout', '-q', '--detach')
  const r = await scan(s)
  assert.equal(r.json.secrets[0].pushed, null)
  assert.equal(r.json.action, 'human')
})

test('S4f: two pushed secrets are one question naming both tokens; one answer repeating both exits 0 (and its control)', async (t) => {
  const s = box(t)
  s.leak('cfg.py', TOKEN)
  s.leak('more.py', TOKEN2)
  s.git('push', '-q', 'origin', 'feat')
  const r = await scan(s)
  assert.equal(r.status, 1)
  assert.equal(r.json.action, 'human')
  assert.deepEqual(r.json.secrets.map((x) => [x.file, x.pushed]), [['cfg.py', true], ['more.py', true]])
  const [a, b] = r.json.secrets.map((x) => x.accept)
  const both = `\`security-accept ${a}\` and \`security-accept ${b}\``
  assert.ok(r.json.why.startsWith('The scan found 2 things only you can settle: (1) A secret (github-pat) in cfg.py, commit '), r.json.why)
  assert.ok(r.json.why.includes('; (2) A secret (github-pat) in more.py, commit '), r.json.why)
  assert.ok(r.json.why.endsWith(`. Answer each as it asks, or keep all 2 (answer ${both})?`), r.json.why)
  for (const acc of [a, b]) assert.ok(r.json.why.includes(`is already on origin: once it is rotated, keep it in the history (answer \`security-accept ${acc}\`), or have /thread:repair recut the branch`), r.json.why)
  const note = s.note([entry(r.json.why, `rotated both; keep them (security-accept ${a} and security-accept ${b})`)])
  const r2 = await scan(s, { note })
  assert.equal(r2.status, 0, r2.stdout)
  assert.deepEqual(r2.json.accepted.map((x) => x.token).sort(), [a, b].sort())
  assert.deepEqual(r2.json.secrets, [])
  // One answer keeping only the first leaves the second's own question, alone.
  const r3 = await scan(s, { note: s.note([entry(r.json.why, `keep the first (security-accept ${a})`)]) })
  assert.equal(r3.json.action, 'human')
  assert.ok(r3.json.why.startsWith('A secret (github-pat) in more.py') && r3.json.why.includes(b) && !r3.json.why.includes(a), r3.json.why)
  // Control: a why that keeps only its first item names one token, so the same answer clears only that one.
  const m = await scan(s, { script: mutant(s, 'if len(items) == 1:', 'if items:') })
  const m2 = await scan(s, { note: s.note([entry(m.json.why, `rotated both; keep them (security-accept ${a} and security-accept ${b})`)]) })
  assert.equal(m2.status, 1, 'control: a why naming only the first token must leave the second red')
})

test('S4g: a config change and a pushed secret are one question naming every token', async (t) => {
  const s = box(t)
  s.leak()
  s.write('.gitleaksignore', 'x\n'); s.commit('ignore')
  s.git('push', '-q', 'origin', 'feat')
  const r = await scan(s)
  assert.equal(r.json.action, 'human')
  const toks = [r.json.configTouched[0].accept, r.json.secrets[0].accept]
  assert.ok(r.json.why.startsWith('The scan found 2 things only you can settle: (1) This change creates, edits or leaves an uncommitted .gitleaksignore'), r.json.why)
  assert.ok(r.json.why.endsWith(`keep all 2 (answer ${toks.map((x) => `\`security-accept ${x}\``).join(' and ')})?`), r.json.why)
  const r2 = await scan(s, { note: s.note([entry(r.json.why, `keep both: ${toks.map((x) => `security-accept ${x}`).join(' ')}`)]) })
  assert.equal(r2.status, 0, r2.stdout)
})

// ---- S5: merges ---------------------------------------------------------------------------------------------------

function mainMoves(s) {
  s.git('checkout', '-q', 'main')
  s.write('main.txt', 'main\n'); s.commit('main moves')
  s.git('push', '-q', 'origin', 'main')
  s.git('checkout', '-q', 'feat')
}

test('S5: a merge commit after the leak commit: human, it cannot be rewritten', async (t) => {
  const s = box(t)
  s.leak()
  mainMoves(s)
  s.git('merge', '-q', '--no-ff', '-m', 'merge main', 'origin/main')
  const r = await scan(s)
  assert.equal(r.json.action, 'human')
  assert.match(r.json.why, /cannot rewrite it/)
})

test('S5b: a leak after a merge: fix, rewriteFrom after the merge', async (t) => {
  const s = box(t)
  mainMoves(s)
  s.git('merge', '-q', '--no-ff', '-m', 'merge main', 'origin/main')
  const merge = s.head()
  s.leak()
  const r = await scan(s)
  assert.equal(r.json.action, 'fix')
  assert.equal(r.json.rewriteFrom, merge)
})

test('S5c: two secrets behind a merge are both named; a third after it stays the fix', async (t) => {
  const s = box(t)
  s.leak('cfg.py', TOKEN)
  s.leak('more.py', TOKEN2)
  mainMoves(s)
  s.git('merge', '-q', '--no-ff', '-m', 'merge main', 'origin/main')
  const merge = s.head()
  s.leak('late.py', fakeToken('thread-security-fixture-3'))
  const r = await scan(s)
  assert.equal(r.json.action, 'human')
  assert.equal(r.json.mergeBehind, true)
  const by = Object.fromEntries(r.json.secrets.map((x) => [x.file, x.accept]))
  assert.ok(r.json.why.startsWith('The scan found 2 things only you can settle: (1) A secret (github-pat) in cfg.py'), r.json.why)
  assert.ok(r.json.why.includes(`keep all 2 (answer \`security-accept ${by['cfg.py']}\` and \`security-accept ${by['more.py']}\`)?`), r.json.why)
  assert.ok(!r.json.why.includes(by['late.py']), 'the secret after the merge is no question')
  const r2 = await scan(s, { note: s.note([entry(r.json.why, `keep them (security-accept ${by['cfg.py']} and security-accept ${by['more.py']})`)]) })
  assert.equal(r2.json.action, 'fix')
  assert.deepEqual(r2.json.secrets.map((x) => x.file), ['late.py'])
  assert.equal(r2.json.rewriteFrom, merge)
  assert.equal(r2.json.mergeBehind, false)
})

// ---- M1-M3, I1-I6: merge resolutions, and Integration's scan (--anchor) -------------------------------------------

// feat and main both add app.py (an add/add conflict, so git's automatic merge holds conflict markers); main also adds
// theirs.py holding o.theirs when given. feat merges origin/<def> and resolves app.py as `body`; returns the merge.
function conflictMerge(s, body, o = {}) {
  s.write('app.py', 'OURS = 1\n'); s.commit('ours adds app.py')
  if (o.pushOurs) s.git('push', '-q', 'origin', 'feat')
  const ours = s.head()
  s.git('checkout', '-q', s.def)
  s.write('app.py', 'THEIRS = 2\n')
  if (o.theirs) s.write('theirs.py', `TOKEN = "${o.theirs}"\n`)
  s.commit('theirs adds app.py'); s.git('push', '-q', 'origin', s.def)
  s.git('checkout', '-q', 'feat')
  const m = spawnSync(GIT, ['-C', s.tree, 'merge', '-q', `origin/${s.def}`], { env: s.env, encoding: 'utf8' })
  assert.equal(m.status, 1, 'setup: the merge conflicts')
  s.write('app.py', body)
  s.git('add', '-A'); s.git('commit', '-q', '--no-edit')
  return { ours, merge: s.head() }
}
const RESOLVED = 'OURS = 1\nTHEIRS = 2\n'
const LEAKED = `OURS = 1\nTHEIRS = 2\nTOKEN = "${TOKEN}"\n`
const noWalk = (rec) => rec.argv.find((x) => x.startsWith('--log-opts=--no-walk '))

for (const real of [false, true]) {
  const tag = real ? 'real gitleaks' : 'stub'
  test(`M1 (${tag}): a conflict resolved with a secret in the merge commit is found at the merge, merge: true, human (and its control)`, { skip: real && realSkip }, async (t) => {
    const s = box(t)
    const { merge } = conflictMerge(s, LEAKED)
    const r = await scan(s, { real })
    assert.equal(r.status, 1, r.stderr)
    assert.equal(r.json.action, 'human')
    assert.deepEqual(r.json.secrets.map((x) => [x.file, x.commit, x.line, x.merge, x.pushed]), [['app.py', merge, 3, true, false]])
    assert.match(r.json.why, /sits at or before a merge commit, so the task cannot rewrite it/)
    assert.ok(r.json.why.startsWith(`A secret (github-pat) in app.py, commit ${merge.slice(0, 7)} (a merge's resolution), line 3, `), r.json.why)
    assert.equal(r.json.mergeBehind, true)
    if (!real) {
      // Control: a finding in the replay left at its synthetic commit names no commit of the branch.
      const m = await scan(s, { script: mutant(s, 'found.append({**s, "commit": replays[s["commit"]], "merge": True})', 'found.append({**s, "merge": True})') })
      assert.notEqual(m.json.secrets[0].commit, merge, 'control: without the S→M mapping the commit is not the merge')
    }
  })
}

test('M2: a clean --no-ff merge is no replay: one gitleaks run, the range, and no --no-walk call', async (t) => {
  const s = box(t)
  s.leak()
  mainMoves(s)
  s.git('merge', '-q', '--no-ff', '-m', 'merge main', 'origin/main')
  const r = await scan(s)
  assert.equal(r.status, 1)
  assert.equal(r.json.action, 'human')
  const recs = s.stubLog()
  assert.equal(recs.length, 1, 'one gitleaks run')
  assert.equal(noWalk(recs[0]), undefined)
})

test('M3: an evil-merge edit to a file with no conflict is found at the merge', async (t) => {
  const s = box(t)
  mainMoves(s)
  assert.equal(spawnSync(GIT, ['-C', s.tree, 'merge', '-q', '--no-ff', '--no-commit', 'origin/main'], { env: s.env }).status, 0, 'setup: a clean merge, not committed')
  s.write('README.md', `hello\nTOKEN = "${TOKEN}"\n`)
  s.git('add', '-A'); s.git('commit', '-q', '--no-edit')
  const merge = s.head()
  assert.equal(s.git('rev-list', '--count', '--no-merges', 'origin/main..HEAD'), '0', 'setup: the merge is the branch\'s only commit')
  const r = await scan(s)
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(r.json.secrets.map((x) => [x.file, x.commit, x.line, x.merge]), [['README.md', merge, 2, true]])
  assert.equal(r.json.action, 'human')
})

// Integration's tree: feat's own commit (the anchor, pushed), then a conflict merge of main (theirs.py holds TOKEN3)
// resolved as `body`, then, with o.fix (a file → its text), one fix commit F.
function integrated(s, body, o = {}) {
  const { ours: anchor, merge } = conflictMerge(s, body, { theirs: TOKEN3, pushOurs: true })
  let fix = null
  if (o.fix) {
    for (const [f, text] of Object.entries(o.fix)) s.write(f, text)
    fix = s.commit('an Integration fix')
  }
  return { anchor, merge, fix }
}
const anchorArgs = (anchor, ...more) => ['--anchor', anchor, ...more]
const PKG = JSON.stringify({ dependencies: { 'left-pad': '^1.3.0' } })

for (const real of [false, true]) {
  const tag = real ? 'real gitleaks' : 'stub'
  test(`I1a (${tag}): --anchor reads the resolution and the fix commit, never main's own commits; every secret is Lachy's, origin never read, no dependencies (and its controls)`, { skip: real && realSkip }, async (t) => {
    const s = box(t)
    const o = await osvStub(t, { 'npm|left-pad': [vuln('GHSA-test-0007', 'npm', 'left-pad', [eco([{ introduced: '0' }, { fixed: '1.3.1' }])])] })
    const { anchor, merge, fix } = integrated(s, LEAKED, { fix: { 'fix.py': `TOKEN = "${TOKEN2}"\n`, 'package.json': PKG } })
    const r = await scan(s, { real, osv: o.url, extra: anchorArgs(anchor) })
    assert.equal(r.status, 1, r.stderr)
    assert.equal(r.json.action, 'human')
    assert.deepEqual(r.json.secrets.map((x) => [x.file, x.commit, x.line, !!x.merge]), [['app.py', merge, 3, true], ['fix.py', fix, 1, false]])
    for (const sec of r.json.secrets) assert.ok(!('pushed' in sec) && !('pushedWhy' in sec), JSON.stringify(sec))
    assert.equal(s.packed(), '', 'origin is never read')
    const by = Object.fromEntries(r.json.secrets.map((x) => [x.file, x.accept]))
    assert.ok(r.json.why.startsWith('The scan found 2 things only you can settle: (1) A secret (github-pat) in app.py, commit '), r.json.why)
    for (const f of ['app.py', 'fix.py']) assert.ok(r.json.why.includes(`, is in Integration's commits, which Integration never rewrites: once it is rotated, keep it in the history (answer \`security-accept ${by[f]}\`)`), r.json.why)
    assert.ok(r.json.why.includes(`commit ${merge.slice(0, 7)} (a merge's resolution), line 3`), r.json.why)
    assert.ok(!r.json.why.includes('already on origin'), r.json.why)
    assert.equal(r.json.anchor, anchor)
    assert.equal(r.json.rewriteFrom, null)
    assert.equal(r.json.mergeBehind, true)
    assert.deepEqual(r.json.dependencies, [])
    assert.deepEqual(r.json.advisories, [])
    assert.equal(r.json.advisoriesChecked, false)
    assert.ok(r.json.brief.includes('dependencies not checked: an Integration scan (--anchor) reads secrets and the scanner config only'), r.json.brief.join('\n'))
    assert.equal(o.seen.length, 0, 'no OSV request')
    if (!real) {
      // Control: the anchor range without --first-parent walks into main's commits through the merge's second parent.
      const m = await scan(s, { osv: o.url, extra: anchorArgs(anchor), script: mutant(s, 'f"--first-parent --no-merges {lo}..{head}" if anchor', 'f"--no-merges {lo}..{head}" if anchor') })
      assert.ok(m.json.secrets.some((x) => x.file === 'theirs.py'), 'control: without --first-parent main\'s own secret is read')
      // Control: --anchor read as a task scan builds Pushed and the task's items.
      const m2 = await scan(s, { osv: o.url, extra: anchorArgs(anchor), script: mutant(s, 'integration = anchor is not None', 'integration = False') })
      assert.ok(m2.json.secrets.some((x) => 'pushed' in x), 'control: a task-mode reading carries pushed')
      assert.ok(!m2.json.why.includes("is in Integration's commits"), 'control: a task-mode reading words it otherwise')
    }
  })
}

test('I1b: a fix commit\'s secret alone is still human with --anchor, rewriteFrom null, mergeBehind false; a task-mode scan of the same tree is the fix', async (t) => {
  const s = box(t)
  const { anchor, merge, fix } = integrated(s, RESOLVED, { fix: { 'fix.py': `TOKEN = "${TOKEN2}"\n` } })
  const r = await scan(s, { extra: anchorArgs(anchor) })
  assert.equal(r.status, 1, r.stderr)
  assert.equal(r.json.action, 'human')
  assert.deepEqual(r.json.secrets.map((x) => [x.file, x.commit]), [['fix.py', fix]])
  assert.equal(r.json.rewriteFrom, null)
  assert.equal(r.json.mergeBehind, false)
  assert.equal(r.json.why, `A secret (github-pat) in fix.py, commit ${fix.slice(0, 7)}, line 1, is in Integration's commits, which Integration never rewrites: once it is rotated, keep it in the history (answer \`security-accept ${r.json.secrets[0].accept}\`), or have /thread:repair recut the branch?`)
  const task = await scan(s)
  assert.equal(task.status, 1, task.stderr)
  assert.equal(task.json.action, 'fix')
  assert.equal(task.json.rewriteFrom, merge)
  assert.equal(task.json.secrets[0].accept, r.json.secrets[0].accept, 'the accept key is the same in both modes')
  assert.ok(!('anchor' in task.json), 'a task scan carries no anchor')
})

test('I2: an --anchor that is no commit, or not an ancestor of HEAD, and --history-only without --anchor: exit 2', async (t) => {
  const s = box(t)
  s.leak()
  const r = await scan(s, { extra: anchorArgs('no-such-ref') })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /^ERROR: security-check: --anchor no-such-ref does not resolve to a commit in --tree\n$/)
  mainMoves(s)
  const other = s.git('rev-parse', 'origin/main')
  const r2 = await scan(s, { extra: anchorArgs(other) })
  assert.equal(r2.status, 2)
  assert.match(r2.stderr, /^ERROR: security-check: --anchor [0-9a-f]{7} is not an ancestor of HEAD [0-9a-f]{7}\n$/)
  const r3 = await scan(s, { extra: ['--history-only'] })
  assert.equal(r3.status, 2)
  assert.equal(r3.stderr, "ERROR: security-check: --history-only goes with --anchor (the Integration judge's read-only run)\n")
  const head = await scan(s, { extra: anchorArgs(s.head()) })
  assert.equal(head.status, 0, 'an --anchor at HEAD is an empty range: clean')
})

test('I3: an accept token for a resolution secret, recorded as Lachy answers it, exits 0 and is named', async (t) => {
  const s = box(t)
  const { anchor } = integrated(s, LEAKED)
  const r = await scan(s, { extra: anchorArgs(anchor) })
  assert.equal(r.json.action, 'human')
  const acc = r.json.secrets[0].accept
  const note = s.note([entry(r.json.why, `rotated; keep it (security-accept ${acc})`)])
  const r2 = await scan(s, { note, extra: anchorArgs(anchor) })
  assert.equal(r2.status, 0, r2.stdout)
  assert.deepEqual(r2.json.accepted.map((x) => x.token), [acc])
  assert.deepEqual(r2.json.secrets, [])
  const task = await scan(s, { note })
  assert.equal(task.status, 0, 'the same accept clears the task-mode reading of the resolution')
})

test('I4: the argv: --anchor runs the replay, then the first-parent range last; a task scan keeps its range last', async (t) => {
  const s = box(t)
  const { anchor, merge } = integrated(s, LEAKED, { fix: { 'fix.py': 'x = 1\n' } })
  const head = s.head()
  await scan(s, { extra: anchorArgs(anchor) })
  const recs = s.stubLog()
  assert.equal(recs.length, 2)
  assert.ok(recs[1].argv.includes(`--log-opts=--first-parent --no-merges ${anchor}..${head}`), recs[1].argv.join(' '))
  const nw = noWalk(recs[0])
  assert.match(nw || '', /^--log-opts=--no-walk [0-9a-f]{40}$/)
  assert.ok(!nw.includes(merge) && !nw.includes(head), 'the replay is its own commit')
  await scan(s)
  const mb = s.git('merge-base', 'HEAD', 'origin/main')
  const task = s.stubLog()
  assert.equal(task.length, 4)
  assert.ok(noWalk(task[2]), 'a task scan replays the merge too')
  assert.ok(task[3].argv.includes(`--log-opts=--no-merges ${mb}..${head}`), task[3].argv.join(' '))
})

test('I5: a replay writes nothing to the tree\'s repo: its objects and refs are unchanged, TMPDIR left empty', async (t) => {
  const s = box(t)
  const { anchor } = integrated(s, LEAKED)
  const objects = s.git('count-objects', '-v')
  const refs = s.git('for-each-ref')
  const r = await scan(s, { extra: anchorArgs(anchor) })
  assert.equal(r.status, 1)
  const r2 = await scan(s)
  assert.equal(r2.status, 1)
  assert.equal(s.git('count-objects', '-v'), objects)
  assert.equal(s.git('for-each-ref'), refs)
  assert.deepEqual(fs.readdirSync(s.tmp), [])
})

test('I6: --history-only reads committed history alone: a verifier\'s untracked file, a rewritten tracked file and an untracked .gitleaks.toml never stop it (and its control)', async (t) => {
  const s = box(t)
  s.write('src/own.py', 'x = 1\n')
  const anchor = s.commit('own')
  s.git('push', '-q', 'origin', 'feat')
  mainMoves(s)
  s.git('merge', '-q', '--no-ff', '-m', 'merge main', 'origin/main')
  const fix = s.leak('fix.py', TOKEN2)
  s.write('out/report.xml', '<testsuite/>\n')
  s.write('README.md', 'rewritten by the verifier\n')
  s.write('.gitleaks.toml', "[extend]\nuseDefault = true\n[allowlist]\npaths = ['''fix\\.py''']\n")
  const r = await scan(s, { extra: anchorArgs(anchor, '--history-only') })
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(r.json.secrets.map((x) => [x.file, x.commit]), [['fix.py', fix]])
  assert.deepEqual(r.json.configTouched, [])
  assert.equal(r.json.action, 'human')
  const full = await scan(s, { extra: anchorArgs(anchor) })
  assert.equal(full.status, 2)
  assert.match(full.stderr, /tracked changes are uncommitted/)
  s.git('checkout', '--', 'README.md')
  const untrackedRun = await scan(s, { extra: anchorArgs(anchor) })
  assert.equal(untrackedRun.status, 2)
  assert.match(untrackedRun.stderr, /untracked files are in --tree \(1; git status lists them\)/)
  // Control: the untracked refusal without its --history-only guard stops the judge's run.
  const m = await scan(s, { extra: anchorArgs(anchor, '--history-only'), script: mutant(s, 'loose = [] if args.history_only else untracked(', 'loose = untracked(') })
  assert.equal(m.status, 2, 'control: dropping the guard must fail the case')
})

// ---- S6: the scanner's own config ---------------------------------------------------------------------------------

test('S6: a committed .gitleaksignore change is configTouched, human', async (t) => {
  const s = box(t)
  s.write('.gitleaksignore', 'abc:cfg.py:github-pat:1\n'); s.commit('ignore')
  const r = await scan(s)
  assert.equal(r.status, 1)
  assert.equal(r.json.action, 'human')
  assert.equal(r.json.configTouched.length, 1)
  assert.deepEqual({ ...r.json.configTouched[0], accept: undefined }, { path: '.gitleaksignore', cause: 'committed', accept: undefined })
  assert.match(r.json.configTouched[0].accept, /^config:[0-9a-f]{12}$/)
  assert.ok(r.json.why.startsWith('This change creates, edits or leaves an uncommitted .gitleaksignore, the secret scanner\'s own config: keep it (answer `security-accept config:'), r.json.why)
})

test('S6b: a committed .gitleaks.toml change is configTouched, human', async (t) => {
  const s = box(t)
  s.write('.gitleaks.toml', '[extend]\nuseDefault = true\n'); s.commit('config')
  const r = await scan(s)
  assert.equal(r.json.action, 'human')
  assert.deepEqual(r.json.configTouched.map((c) => [c.path, c.cause]), [['.gitleaks.toml', 'committed']])
})

const ONDISK = {
  S6c: { file: '.gitleaksignore', what: 'an untracked root .gitleaksignore holding the finding\'s fingerprint', body: (leak) => `${leak}:cfg.py:github-pat:1\n` },
  S6d: { file: '.gitleaks.toml', what: 'an untracked root .gitleaks.toml allowlisting cfg.py', body: () => "[extend]\nuseDefault = true\n\n[allowlist]\npaths = ['''cfg\\.py''']\n" },
  S6e: { file: '.gitleaksignore', what: 'a gitignored root .gitleaksignore', body: (leak) => `${leak}:cfg.py:github-pat:1\n`, ignored: true },
}
for (const [name, c] of Object.entries(ONDISK)) {
  for (const real of [false, true]) {
    test(`${name} (${real ? 'real gitleaks' : 'stub'}): ${c.what} is human, uncommitted, and the secret still reported`, { skip: real && realSkip }, async (t) => {
      const s = box(t)
      if (c.ignored) { s.write('.gitignore', `${c.file}\n`); s.commit('ignore it') }
      const leak = s.leak()
      s.write(c.file, c.body(leak))
      assert.equal(s.git('status', '--porcelain', '--untracked-files=no'), '', 'setup: no tracked change')
      const r = await scan(s, { real })
      assert.equal(r.status, 1)
      assert.equal(r.json.action, 'human')
      assert.deepEqual(r.json.configTouched.map((x) => [x.path, x.cause]), [[c.file, 'uncommitted']])
      assert.equal(r.json.secrets.length, 1, 'the secret is still reported')
      assert.equal(r.json.secrets[0].commit, leak)
      if (!real) {
        // Mutation control: without the disk comparison the case fails.
        const m = await scan(s, { script: lineMutant(s, '# the disk comparison', 'drift = []') })
        assert.notEqual(m.json.action, 'human', 'control: dropping the disk comparison must fail the case')
        assert.deepEqual(m.json.configTouched, [])
        // Control: an untracked refusal that does not leave the watched paths out takes the case from the disk rule
        // (a gitignored one is never listed untracked).
        const u = await scan(s, { script: mutant(s, 'untracked(tree, watched_paths(tree, mb))', 'untracked(tree, [])') })
        assert.equal(u.status, c.ignored ? 1 : 2, 'control: refusing an untracked watched path must fail the case')
      }
    })
  }
}

test('S6f: nested fixture .gitleaksignore and .gitleaks.toml are not the scanner\'s config: clean', async (t) => {
  const s = box(t)
  s.write('tests/fixtures/x/.gitleaksignore', 'x\n')
  s.write('tests/fixtures/x/.gitleaks.toml', '[extend]\nuseDefault = true\n')
  s.commit('a fixture repo')
  const r = await scan(s)
  assert.equal(r.status, 0, r.stdout)
  assert.deepEqual(r.json.configTouched, [])
  const m = await scan(s, { script: mutant(s, 'f":(top,literal){p}"', 'f":(top,glob)**/{p}"') })
  assert.equal(m.status, 1, 'control: a pathspec widened to **/ must fail the case')
  assert.notDeepEqual(m.json.configTouched, [])
})

test('S6g (stub): GITLEAKS_CONFIG and GITLEAKS_CONFIG_TOML never reach gitleaks', async (t) => {
  const s = box(t)
  s.leak()
  const allow = path.join(s.dir, 'allow.toml')
  fs.writeFileSync(allow, "[extend]\nuseDefault = true\n[allowlist]\npaths = ['''cfg\\.py''']\n")
  const r = await scan(s, { env: { GITLEAKS_CONFIG: allow, GITLEAKS_CONFIG_TOML: fs.readFileSync(allow, 'utf8') } })
  assert.equal(r.status, 1)
  assert.deepEqual(s.stubLog().at(-1).env, {})
})

test('S6g (real gitleaks): an allowlist through GITLEAKS_CONFIG still reads red', { skip: realSkip }, async (t) => {
  const s = box(t)
  s.leak()
  const allow = path.join(s.dir, 'allow.toml')
  fs.writeFileSync(allow, "[extend]\nuseDefault = true\n[allowlist]\npaths = ['''cfg\\.py''']\n")
  const r = await scan(s, { real: true, env: { GITLEAKS_CONFIG: allow, GITLEAKS_CONFIG_TOML: fs.readFileSync(allow, 'utf8') } })
  assert.equal(r.status, 1)
  assert.equal(r.json.secrets.length, 1)
})

test('S6h: the merge base\'s relative [extend] path is watched too', async (t) => {
  const s = box(t)
  s.git('checkout', '-q', 'main')
  s.write('.gitleaks.toml', '[extend]\npath = "extra.toml"\n')
  s.write('extra.toml', '[extend]\nuseDefault = true\n')
  s.commit('scanner config'); s.git('push', '-q', 'origin', 'main')
  s.git('checkout', '-q', '-B', 'feat')
  s.write('extra.toml', '[extend]\nuseDefault = true\n[allowlist]\npaths = ["cfg.py"]\n'); s.commit('widen it')
  const r = await scan(s)
  assert.equal(r.json.action, 'human')
  assert.deepEqual(r.json.configTouched.map((c) => c.path), ['extra.toml'])
})

test('S7 (stub): the argv carries --ignore-gitleaks-allow, so an inline gitleaks:allow is still red', async (t) => {
  const s = box(t)
  s.leak('cfg.py', TOKEN, '  # gitleaks:allow')
  const r = await scan(s)
  assert.equal(r.status, 1)
  assert.ok(s.stubLog().at(-1).argv.includes('--ignore-gitleaks-allow'))
})

test('S7 (real gitleaks): an inline gitleaks:allow is still red', { skip: realSkip }, async (t) => {
  const s = box(t)
  s.leak('cfg.py', TOKEN, '  # gitleaks:allow')
  const r = await scan(s, { real: true })
  assert.equal(r.status, 1)
  assert.equal(r.json.secrets.length, 1)
})

// ---- S8-S9: dependencies and advisories ----------------------------------------------------------------------------

test('S8: a new package.json dependency with no advisory exits 0 and is listed', async (t) => {
  const s = box(t)
  const o = await osvStub(t)
  s.write('package.json', JSON.stringify({ dependencies: { 'left-pad': '^1.3.0' } }, null, 2)); s.commit('dep')
  const r = await scan(s, { osv: o.url })
  assert.equal(r.status, 0, r.stdout)
  assert.deepEqual(r.json.brief, ['npm left-pad 1.3.0 (package.json)'])
  assert.equal(r.json.advisoriesChecked, true)
})

test('S9: an advisory with a fix is red, action fix, its fixed release named', async (t) => {
  const s = box(t)
  const o = await osvStub(t, { 'npm|left-pad': [vuln('GHSA-test-0001', 'npm', 'left-pad', [eco([{ introduced: '0' }, { fixed: '1.3.1' }])])] })
  s.write('package.json', JSON.stringify({ dependencies: { 'left-pad': '^1.3.0' } })); s.commit('dep')
  const r = await scan(s, { osv: o.url })
  assert.equal(r.status, 1)
  assert.equal(r.json.action, 'fix')
  assert.deepEqual(r.json.advisories[0].fixed, ['1.3.1'])
  assert.deepEqual(r.json.brief, ['npm left-pad 1.3.0 (package.json); advisory GHSA-test-0001, fixed in 1.3.1'])
})

test('S9b: a version bump reads as changed', async (t) => {
  const s = box(t)
  const o = await osvStub(t)
  s.git('checkout', '-q', 'main')
  s.write('package.json', JSON.stringify({ dependencies: { 'left-pad': '^1.2.0', other: '2.0.0' } })); s.commit('dep')
  s.git('push', '-q', 'origin', 'main'); s.git('checkout', '-q', '-B', 'feat')
  s.write('package.json', JSON.stringify({ dependencies: { 'left-pad': '^1.3.0', other: '2.0.0' } })); s.commit('bump')
  const r = await scan(s, { osv: o.url })
  assert.deepEqual(r.json.brief, ['npm left-pad 1.3.0 (package.json); changed from 1.2.0'])
})

test('S9b2: a spec, pin or section change that keeps the floor reads as changed; whitespace alone does not (and its control)', async (t) => {
  const s = box(t)
  const o = await osvStub(t)
  const url = (tag) => `git+https://u:hunter2pass@example.com/b.git?auth=k3y#${tag}`
  s.git('checkout', '-q', 'main')
  s.write('package.json', JSON.stringify({ dependencies: { aaa: '^1.0.0', bbb: url('v1'), same: '^3.0.0' }, devDependencies: { ccc: '^2.0.0' } }))
  s.write('requirements.txt', 'requests>=2.31\nflask>=2.0\n')
  s.commit('deps'); s.git('push', '-q', 'origin', 'main'); s.git('checkout', '-q', '-B', 'feat')
  s.write('package.json', JSON.stringify({ dependencies: { aaa: '~1.0.0', bbb: url('v9'), ccc: '^2.0.0', same: '^3.0.0' } }))
  s.write('requirements.txt', 'requests >= 2.31\nflask[async]>=2.0\n')
  s.commit('respec')
  const r = await scan(s, { osv: o.url })
  assert.equal(r.status, 0, r.stdout)
  assert.deepEqual(r.json.brief, [
    'npm aaa 1.0.0 (package.json); changed from ^1.0.0',
    'npm bbb unversioned (package.json); changed from git+https://example.com/b.git#v1',
    'npm ccc 2.0.0 (package.json); changed from ^2.0.0 in devDependencies',
    'PyPI flask 2.0 (requirements.txt); changed from >=2.0',
  ])
  assert.ok(!r.stdout.includes('hunter2pass') && !r.stdout.includes('k3y'), 'a URL\'s userinfo and query never reach stdout')
  assert.deepEqual(o.queries().map((q) => `${q.package.name}@${q.version}`).sort(), ['aaa@1.0.0', 'ccc@2.0.0', 'flask@2.0'], 'OSV is asked at each floor')
  const m = await scan(s, { osv: o.url, script: lineMutant(s, '# the change comparison', 'if _floor(eco, old_by[norm]["spec"]) == _floor(eco, new[name]["spec"]):') })
  assert.deepEqual(m.json.brief, [], 'control: comparing floors alone must drop every one of them')
})

test('S9c: every manifest kind, its ecosystem and its query form', async (t) => {
  const s = box(t)
  const gitFix = 'a'.repeat(40)
  const o = await osvStub(t, {
    'Go|example.com/mod': [vuln('GO-2026-0001', 'Go', 'example.com/mod', [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.2.4' }] }])],
    'npm|left-pad': [vuln('GHSA-test-0002', 'npm', 'left-pad', [{ type: 'GIT', repo: 'https://x', events: [{ introduced: '0' }, { fixed: gitFix }] }, eco([{ introduced: '0' }, { fixed: '1.3.1' }])])],
  })
  s.write('requirements.txt', '# deps\nDjango_REST.framework[extra]>=3.14 ; python_version > "3"\n-r other.txt\n')
  s.write('pyproject.toml', '[project]\nname = "x"\ndependencies = ["requests>=2.31"]\n\n[tool.poetry.dependencies]\npython = "^3.11"\nhttpx = "^0.27"\n')
  s.write('go.mod', 'module example.com/me\n\ngo 1.22\n\nrequire (\n\texample.com/mod v1.2.3\n)\n')
  s.write('Cargo.toml', '[package]\nname = "x"\n\n[dependencies]\nserde = "1.2"\n')
  s.write('package.json', JSON.stringify({ devDependencies: { 'left-pad': '1.3.0' } }))
  s.commit('deps')
  const r = await scan(s, { osv: o.url })
  assert.deepEqual(r.json.brief, [
    'crates.io serde 1.2 (Cargo.toml)',
    'Go example.com/mod v1.2.3 (go.mod); advisory GO-2026-0001, fixed in v1.2.4',
    'npm left-pad 1.3.0 (package.json); advisory GHSA-test-0002, fixed in 1.3.1',
    'PyPI httpx 0.27 (pyproject.toml)',
    'PyPI requests 2.31 (pyproject.toml)',
    'PyPI Django_REST.framework 3.14 (requirements.txt)',
  ])
  const q = o.queries()
  const of = (e, n) => q.find((x) => x.package.ecosystem === e && x.package.name === n)
  assert.equal(of('Go', 'example.com/mod').version, '1.2.3')
  assert.equal(of('PyPI', 'django-rest-framework').version, '3.14')
  assert.equal(of('crates.io', 'serde').version, '1.2.0')
  assert.ok(!q.some((x) => x.package.name === 'python'), 'poetry python is not a dependency')
  assert.deepEqual(r.json.advisories.find((a) => a.id === 'GHSA-test-0002').fixed, ['1.3.1'], 'a GIT range hash is never a fix')
})

test('S9d: an unreachable OSV is not checked, said so, never red', async (t) => {
  const s = box(t)
  s.write('package.json', JSON.stringify({ dependencies: { 'left-pad': '^1.3.0' } })); s.commit('dep')
  const r = await scan(s, { osv: CLOSED })
  assert.equal(r.status, 0)
  assert.equal(r.json.advisoriesChecked, false)
  assert.equal(r.json.brief[0], 'npm left-pad 1.3.0 (package.json)')
  assert.ok(r.json.brief.some((l) => l.startsWith('advisories not checked: ')), r.json.brief.join('\n'))
})

test('S9e: an advisory with no fixed release above the floor is human, its question exact', async (t) => {
  const s = box(t)
  const o = await osvStub(t, { 'npm|left-pad': [vuln('GHSA-test-0003', 'npm', 'left-pad', [eco([{ introduced: '0' }, { fixed: '1.0.0' }])])] })
  s.write('package.json', JSON.stringify({ dependencies: { 'left-pad': '^1.3.0' } })); s.commit('dep')
  const r = await scan(s, { osv: o.url })
  assert.equal(r.json.action, 'human')
  const acc = r.json.advisories[0].accept
  assert.equal(r.json.why, `npm left-pad 1.3.0 has advisory GHSA-test-0003 with no fixed release: keep it (answer \`security-accept ${acc}\`), name another package, or drop the need?`)
})

test('S9e2: GIT-only and last_affected-only advisories read as no fixed release', async (t) => {
  for (const ranges of [[{ type: 'GIT', events: [{ introduced: '0' }, { fixed: 'b'.repeat(40) }] }], [eco([{ introduced: '0' }, { last_affected: '9.9.9' }])]]) {
    const s = box(t)
    const o = await osvStub(t, { 'npm|left-pad': [vuln('GHSA-test-0004', 'npm', 'left-pad', ranges)] })
    s.write('package.json', JSON.stringify({ dependencies: { 'left-pad': '^1.3.0' } })); s.commit('dep')
    const r = await scan(s, { osv: o.url })
    assert.equal(r.json.action, 'human')
    assert.match(r.json.brief[0], /advisory GHSA-test-0004, no fixed release$/)
  }
})

test('S9f: --no-advisories makes no request and still lists the dependencies', async (t) => {
  const s = box(t)
  const o = await osvStub(t)
  s.write('package.json', JSON.stringify({ dependencies: { 'left-pad': '^1.3.0' } })); s.commit('dep')
  const r = await scan(s, { osv: null, env: { THREAD_OSV_URL: o.url } })
  assert.equal(o.seen.length, 0)
  assert.equal(r.json.brief[0], 'npm left-pad 1.3.0 (package.json)')
})

test('S9g: a fixture manifest is listed, never queried, never red', async (t) => {
  const s = box(t)
  const o = await osvStub(t, { 'npm|lodash': [vuln('GHSA-test-0005', 'npm', 'lodash', [eco([{ introduced: '0' }, { fixed: '4.17.21' }])])] })
  s.write('tests/fixtures/app/package.json', JSON.stringify({ dependencies: { lodash: '4.17.0' } })); s.commit('fixture')
  const r = await scan(s, { osv: o.url })
  assert.equal(r.status, 0)
  assert.deepEqual(r.json.brief, ['npm lodash 4.17.0 (tests/fixtures/app/package.json; fixture, not checked)'])
  assert.equal(o.queries().length, 0)
  const m = await scan(s, { osv: o.url, script: mutant(s, 'return any(part.lower() in FIXTURE_PARTS for part in PurePosixPath(manifest).parent.parts)', 'return False') })
  assert.equal(m.status, 1, 'control: without the FIXTURE_PARTS check the fixture is queried and red')
})

test('S9h: querybatch answers, one advisory GET answers 500: the fetched advisory is red, only the other is not checked (and its control)', async (t) => {
  const s = box(t)
  const o = await osvStub(t, {
    'npm|aaa': [vuln('GHSA-A', 'npm', 'aaa', [eco([{ introduced: '0' }, { fixed: '2.0.0' }])])],
    'npm|bbb': [vuln('GHSA-B', 'npm', 'bbb', [eco([{ introduced: '0' }, { fixed: '2.0.0' }])])],
  }, { fail: ['GHSA-B'] })
  s.write('package.json', JSON.stringify({ dependencies: { aaa: '1.0.0', bbb: '1.0.0' } })); s.commit('deps')
  const r = await scan(s, { osv: o.url })
  assert.equal(r.status, 1, r.stdout)
  assert.equal(r.json.result, 'red')
  assert.equal(r.json.action, 'fix')
  assert.equal(r.json.advisoriesChecked, false)
  assert.deepEqual(r.json.advisories.map((a) => [a.id, a.fixed]), [['GHSA-A', ['2.0.0']]])
  assert.deepEqual(r.json.brief, [
    'npm aaa 1.0.0 (package.json); advisory GHSA-A, fixed in 2.0.0',
    'npm bbb 1.0.0 (package.json)',
    'advisory GHSA-B on npm bbb 1.0.0 not checked: OSV answered HTTP 500',
  ])
  assert.ok(o.seen.some((x) => x.url === '/v1/vulns/GHSA-B'), 'the failed GET was made')
  const m = await scan(s, { osv: o.url, script: mutant(s, 'checked = False\n                continue', 'return [], False') })
  assert.equal(m.status, 0, 'control: giving up on the first failed GET passes a known, fixable advisory silently')
})

test('S9i: a failed querybatch checks nothing and names its HTTP status', async (t) => {
  const s = box(t)
  const srv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = 503; res.end('{}') }) })
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => srv.close(() => resolve())))
  s.write('package.json', JSON.stringify({ dependencies: { aaa: '1.0.0' } })); s.commit('deps')
  const r = await scan(s, { osv: `http://127.0.0.1:${srv.address().port}` })
  assert.equal(r.status, 0, r.stdout)
  assert.equal(r.json.advisoriesChecked, false)
  assert.deepEqual(r.json.brief, ['npm aaa 1.0.0 (package.json)', 'advisories not checked: OSV answered HTTP 503'])
})

// ---- S10-S13: refusals, base, env, PATH ---------------------------------------------------------------------------

test('S10: tracked changes uncommitted: exit 2, commit them', async (t) => {
  const s = box(t)
  s.write('README.md', 'changed\n')
  const r = await scan(s)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /^ERROR: security-check: .*commit them, then run the scan again\n$/)
})

test('S10b: an untracked file is exit 2, never 0, whatever `commit -am` left; with `add -A` it is the fix (and its control)', async (t) => {
  const UNTRACKED = /^ERROR: security-check: untracked files are in --tree \(1; git status lists them\): commit them \(or remove them if they are not part of the change\), then run the scan again\n$/
  const tracked = (s) => lineMutant(s, '# the untracked refusal', 'loose = []')
  // Case 1: a new, never-added file holding the token, and no commit since the merge base.
  const s = box(t)
  s.write('newfile.py', `TOKEN = "${TOKEN}"\n`)
  assert.equal(s.git('rev-list', '--count', 'origin/main..HEAD'), '0', 'setup: nothing committed since the merge base')
  const r = await scan(s)
  assert.equal(r.status, 2, r.stdout)
  assert.match(r.stderr, UNTRACKED)
  const m = await scan(s, { script: tracked(s) })
  assert.equal(m.status, 0, 'control: the tracked-only check must read this tree clean, so S10b fails without the refusal')
  assert.equal(m.json.head, m.json.base)
  // Case 2: a tracked edit plus the untracked token file, committed with `commit -am` only.
  const s2 = box(t)
  s2.write('README.md', 'changed\n')
  s2.write('newfile.py', `TOKEN = "${TOKEN}"\n`)
  s2.git('commit', '-q', '-am', 'edit the readme')
  assert.equal(s2.git('status', '--porcelain', '--untracked-files=no'), '', 'setup: no tracked change')
  const r2 = await scan(s2)
  assert.equal(r2.status, 2, r2.stdout)
  assert.match(r2.stderr, UNTRACKED)
  const m2 = await scan(s2, { script: tracked(s2) })
  assert.equal(m2.status, 0, 'control: the tracked-only check must read the commit -am tree clean')
  // Then `add -A` and a commit: the scan reads the token, the fix.
  const leak = s2.commit('add newfile')
  const r3 = await scan(s2)
  assert.equal(r3.status, 1, r3.stderr)
  assert.equal(r3.json.action, 'fix')
  assert.deepEqual(r3.json.secrets.map((x) => [x.file, x.commit, x.pushed]), [['newfile.py', leak, false]])
  // A gitignored file is never refused.
  const s3 = box(t)
  s3.write('.gitignore', 'build/\n'); s3.commit('ignore build')
  s3.write('build/out.txt', `TOKEN = "${TOKEN}"\n`)
  const r4 = await scan(s3)
  assert.equal(r4.status, 0, r4.stderr)
  assert.equal(r4.json.result, 'clean')
})

test('S11: a master default, an unresolvable base, and paths holding a space and a quote', async (t) => {
  const s = box(t, { def: 'master', treeName: "it's a tree" })
  s.leak()
  const note = path.join(s.dir, "Lachy's note.md")
  fs.writeFileSync(note, '## Repair input\n')
  const r = await scan(s, { base: 'origin/master', note })
  assert.equal(r.status, 1, r.stderr)
  assert.equal(r.json.action, 'fix')
  const bad = await scan(s, { base: 'origin/nope' })
  assert.equal(bad.status, 2)
  assert.match(bad.stderr, /does not resolve/)
})

test('S11b: --tree that is not its own toplevel, or with no merge base: exit 2', async (t) => {
  const s = box(t)
  fs.mkdirSync(path.join(s.tree, 'sub'))
  const r = await scan(s, { tree: path.join(s.tree, 'sub') })
  assert.equal(r.status, 2)
  assert.match(r.stderr, /not its own git toplevel/)
  s.git('checkout', '-q', '--orphan', 'lonely'); s.git('rm', '-rq', '--cached', '.'); s.commit('unrelated')
  const r2 = await scan(s)
  assert.equal(r2.status, 2)
  assert.match(r2.stderr, /no merge base/)
})

test('S12: an exported GIT_DIR at a decoy repo never steers the scan', async (t) => {
  const s = box(t)
  const leak = s.leak()
  const decoy = path.join(s.dir, 'decoy')
  execFileSync(GIT, ['init', '-q', decoy], { env: s.env })
  const r = await scan(s, { env: { GIT_DIR: path.join(decoy, '.git') } })
  assert.equal(r.json.head, leak)
  assert.equal(r.json.secrets[0].commit, leak)
  assert.ok(!('GIT_DIR' in s.stubLog().at(-1).env))
})

test('S13: PATH without Homebrew finds the THREAD_GITLEAKS stub; a non-executable one is an error; the fallback', async (t) => {
  const s = box(t)
  s.leak()
  const r = await scan(s, { env: { PATH: '/usr/bin:/bin' } })
  assert.equal(r.status, 1, r.stderr)
  const plain = path.join(s.bin, 'plain')
  fs.writeFileSync(plain, 'x', { mode: 0o644 })
  const r2 = await scan(s, { env: { THREAD_GITLEAKS: plain } })
  assert.equal(r2.status, 2)
  assert.match(r2.stderr, /THREAD_GITLEAKS=.* is not an executable file/)
  if (fs.existsSync('/opt/homebrew/bin/gitleaks')) {
    const e = { ...s.env, PATH: '/usr/bin:/bin' }
    const p = await runPy([SC, 'preflight'], e)
    assert.equal(p.status, 0, p.stderr)
    assert.equal(JSON.parse(p.stdout).gitleaks, '/opt/homebrew/bin/gitleaks')
  }
})

test('S14: the stub is given --redact and the range, from the scratch clone, never the tree; TMPDIR is left empty', async (t) => {
  const s = box(t)
  const mb = s.head()
  const leak = s.leak()
  const r = await scan(s)
  assert.equal(r.status, 1)
  const rec = s.stubLog().at(-1)
  assert.ok(rec.argv.includes('--redact'))
  assert.ok(rec.argv.includes(`--log-opts=--no-merges ${mb}..${leak}`), rec.argv.join(' '))
  // The scratch clone is gone by now, so its path is compared as written (macOS's TMPDIR may read through /private).
  const under = (p, dir) => [dir, fs.realpathSync(dir)].some((d) => p.startsWith(d + path.sep))
  assert.ok(under(rec.argv[1], s.tmp) && !under(rec.argv[1], s.tree), `the source is the scratch clone: ${rec.argv[1]}`)
  assert.ok(under(rec.cwd, s.tmp), `the cwd is the scratch clone: ${rec.cwd}`)
  assert.deepEqual(fs.readdirSync(s.tmp), [], 'the scratch dir is removed')
})

// ---- S16: a linked worktree, the only tree production passes ------------------------------------------------------

for (const real of [false, true]) {
  const tag = real ? 'real gitleaks' : 'stub'
  test(`S16 (${tag}): on a linked worktree at <repo>/.claude/worktrees/<slug>, clean is 0, a leak the fix, pushed human, untracked exit 2`, { skip: real && realSkip }, async (t) => {
    const s = box(t, { worktree: true })
    assert.ok(fs.statSync(path.join(s.tree, '.git')).isFile(), 'setup: the tree is a gitfile worktree')
    assert.equal(fs.realpathSync(s.git('rev-parse', '--show-toplevel')), fs.realpathSync(s.tree), 'setup: the worktree is its own toplevel')
    s.write('src/app.py', 'print("hi")\n')
    const clean = s.commit('clean')
    const r = await scan(s, { real })
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.json.result, 'clean')
    assert.equal(r.json.head, clean, "the worktree's HEAD, never the main checkout's")
    const leak = s.leak()
    const r2 = await scan(s, { real })
    assert.equal(r2.status, 1, r2.stderr)
    assert.equal(r2.json.action, 'fix')
    assert.deepEqual(r2.json.secrets.map((x) => [x.file, x.commit, x.pushed]), [['cfg.py', leak, false]], 'the scratch clone of a gitfile worktree reads its commits')
    assert.equal(r2.json.rewriteFrom, clean)
    s.git('push', '-q', 'origin', 'feat')
    const r3 = await scan(s, { real })
    assert.equal(r3.json.action, 'human')
    assert.equal(r3.json.secrets[0].pushed, true)
    s.write('new.py', 'x = 1\n')
    const r4 = await scan(s, { real })
    assert.equal(r4.status, 2, r4.stdout)
    assert.match(r4.stderr, /untracked files are in --tree/)
    assert.equal(execFileSync(GIT, ['-C', s.main, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: s.env }).trim(), r.json.base, 'the main checkout is untouched')
  })
}

// ---- S15: accepts from ## Repair input ----------------------------------------------------------------------------

async function noFix(t) {
  const s = box(t)
  const o = await osvStub(t, { 'npm|left-pad': [vuln('GHSA-test-0006', 'npm', 'left-pad', [eco([{ introduced: '0' }])])] })
  s.write('package.json', JSON.stringify({ dependencies: { 'left-pad': '^1.3.0' } })); s.commit('dep')
  const r = await scan(s, { osv: o.url })
  assert.equal(r.json.action, 'human')
  return { s, o, r, acc: r.json.advisories[0].accept }
}

test('S15a: an answer that repeats the token its question named is accepted', async (t) => {
  const { s, o, r, acc } = await noFix(t)
  const note = s.note([entry(r.json.why, `keep it (security-accept ${acc})`)])
  const r2 = await scan(s, { osv: o.url, note })
  assert.equal(r2.status, 0, r2.stdout)
  assert.deepEqual(r2.json.accepted.map((a) => [a.token, a.stamp]), [[acc, '2026-11-04T10:00+11:00']])
  assert.ok(r2.json.brief.includes(`accepted ${acc}: advisory GHSA-test-0006 on npm left-pad 1.3.0 (Repair input 2026-11-04T10:00+11:00)`), r2.json.brief.join('\n'))
  assert.deepEqual(r2.json.advisories, [])
})

test('S15b: the token only in the ask is no accept', async (t) => {
  const { s, o, r } = await noFix(t)
  const r2 = await scan(s, { osv: o.url, note: s.note([entry(r.json.why, 'keep it')]) })
  assert.equal(r2.json.action, 'human')
})

test('S15c: a token whose key no longer matches (the version changed since) stays red', async (t) => {
  const { s, o, r, acc } = await noFix(t)
  s.write('package.json', JSON.stringify({ dependencies: { 'left-pad': '^1.3.5' } })); s.commit('another version')
  const r2 = await scan(s, { osv: o.url, note: s.note([entry(r.json.why, `keep it (security-accept ${acc})`)]) })
  assert.equal(r2.json.action, 'human')
  assert.notEqual(r2.json.advisories[0].accept, acc)
})

test('S15d: a superseded entry never counts; a handed-back one does', async (t) => {
  const { s, o, r, acc } = await noFix(t)
  const sup = await scan(s, { osv: o.url, note: s.note([entry(r.json.why, `keep it (security-accept ${acc})`, '; superseded 2026-11-04T11:00+11:00')]) })
  assert.equal(sup.json.action, 'human')
  const back = await scan(s, { osv: o.url, note: s.note([entry(r.json.why, `keep it (security-accept ${acc})`, '; handed back 2026-11-04T11:00+11:00')]) })
  assert.equal(back.status, 0)
})

test('S15e: an accepted pushed secret leaves secrets; a second, unpushed one is fix at its own rewriteFrom', async (t) => {
  const s = box(t)
  s.leak()
  s.git('push', '-q', 'origin', 'feat')
  const r = await scan(s)
  const acc = r.json.secrets[0].accept
  const note = s.note([entry(r.json.why, `rotated; keep it (security-accept ${acc})`)])
  const r2 = await scan(s, { note })
  assert.equal(r2.status, 0, r2.stdout)
  assert.deepEqual(r2.json.secrets, [])
  assert.equal(r2.json.accepted[0].token, acc)
  const before = s.head()
  s.leak('more.py', TOKEN2)
  const r3 = await scan(s, { note })
  assert.equal(r3.json.action, 'fix')
  assert.equal(r3.json.secrets.length, 1)
  assert.equal(r3.json.secrets[0].file, 'more.py')
  assert.equal(r3.json.rewriteFrom, before)
})

test('S15f, S15g: an accepted config change never changes the config the scan runs on; a further edit asks again', async (t) => {
  const s = box(t)
  s.git('checkout', '-q', 'main')
  s.write('.gitleaksignore', 'base-ignore\n'); s.write('.gitleaks.toml', '[extend]\nuseDefault = true\n# base\n')
  s.commit('base config'); s.git('push', '-q', 'origin', 'main'); s.git('checkout', '-q', '-B', 'feat')
  s.write('.gitleaksignore', 'task-ignore\n'); s.commit('task edits it')
  const r = await scan(s)
  assert.equal(r.json.action, 'human')
  const acc = r.json.configTouched[0].accept
  const note = s.note([entry(r.json.why, `keep it (security-accept ${acc})`)])
  const r2 = await scan(s, { note })
  assert.equal(r2.status, 0, r2.stdout)
  const rec = s.stubLog().at(-1)
  assert.equal(rec.ignore, 'base-ignore\n', "the clone's .gitleaksignore is the merge base's")
  assert.equal(rec.config, '[extend]\nuseDefault = true\n# base\n', "--config is the merge base's")
  s.write('.gitleaksignore', 'task-ignore-2\n'); s.commit('and again')
  const r3 = await scan(s, { note })
  assert.equal(r3.json.action, 'human')
  assert.notEqual(r3.json.configTouched[0].accept, acc)
})

test('S15h: an unreadable --accepts-from: red stays red, clean stays 0, the brief says so', async (t) => {
  const s = box(t)
  const missing = path.join(s.dir, 'no-such-note.md')
  const clean = await scan(s, { note: missing })
  assert.equal(clean.status, 0)
  assert.ok(clean.json.brief.some((l) => l.startsWith('accepts not read: ')))
  s.leak()
  const red = await scan(s, { note: missing })
  assert.equal(red.status, 1)
})

test('S15i: an answer naming a token its ask never named is no accept (and its control)', async (t) => {
  const { s, o, acc } = await noFix(t)
  const note = s.note([entry('Should this ship?', `yes (security-accept ${acc})`)])
  const r = await scan(s, { osv: o.url, note })
  assert.equal(r.json.action, 'human')
  const m = await scan(s, { osv: o.url, note, script: mutant(s, 'if acc in asked and acc not in out:', 'if acc not in out:') })
  assert.equal(m.status, 0, 'control: without the same-token-in-the-ask check the answer is accepted')
})

test('S15j: the ask and answer split at the LAST quote-arrow', async (t) => {
  const { s, o, acc } = await noFix(t)
  const ask = `keep it (answer \`security-accept ${acc}\`)" → security-accept ${acc}`
  const r = await scan(s, { osv: o.url, note: s.note([entry(ask, 'no, drop it')]) })
  assert.equal(r.json.action, 'human')
})

test('S15k: an accepted false positive from the agent\'s own question exits 0', async (t) => {
  const s = box(t)
  s.leak()
  const r = await scan(s)
  const acc = r.json.secrets[0].accept
  const q = `The secret scan reports github-pat in cfg.py, commit ${r.json.secrets[0].commit.slice(0, 7)}, line 1, which reads as not a credential: test data. Accept it (answer \`security-accept ${acc}\`), or say how the task should change it?`
  const r2 = await scan(s, { note: s.note([entry(q, `accept it: security-accept ${acc}`)]) })
  assert.equal(r2.status, 0, r2.stdout)
})

// ---- P1-P3: preflight ---------------------------------------------------------------------------------------------

test('P1-P3: preflight OK, gitleaks missing, gitleaks too old', async (t) => {
  const s = box(t, { bare: true })
  const ok = await runPy([SC, 'preflight'], { ...s.env, THREAD_GITLEAKS: s.stub })
  assert.equal(ok.status, 0, ok.stderr)
  assert.deepEqual(JSON.parse(ok.stdout), { gitleaks: s.stub, version: '8.30.1' })
  const gone = await runPy([SC, 'preflight'], { ...s.env, THREAD_GITLEAKS: path.join(s.dir, 'nope') })
  assert.equal(gone.status, 1)
  assert.equal(gone.stdout, '')
  assert.match(gone.stderr, /^ERROR: security-check: [^\n]+\n$/)
  const old = await runPy([SC, 'preflight'], { ...s.env, THREAD_GITLEAKS: s.stub, STUB_VERSION: '8.18.0' })
  assert.equal(old.status, 1)
  assert.match(old.stderr, /^ERROR: security-check: gitleaks 8\.18\.0 .* older than 8\.19\.0/)
})
