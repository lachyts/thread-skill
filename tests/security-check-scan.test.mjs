// skills/execute/scripts/security-check.py — the opt-in Security check (execute § 3 `security_checks`): a scan of the
// task's own non-merge commits for secrets (gitleaks) and of the dependencies its diff adds or changes for advisories
// (OSV), before the PR, read by the engine's agents and the review judge.
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
// commit pushed, on branch feat (o.bare: no commit at all).
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
  for (const tok of [TOKEN, TOKEN2, TOKEN.slice(4), TOKEN2.slice(4)]) {
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

// The stub OSV: `vulns` maps `<ecosystem>|<name>` to the vulns querybatch reports; GET /v1/vulns/<id> returns one.
async function osvStub(t, vulns = {}) {
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
        const v = byId[decodeURIComponent(req.url.slice('/v1/vulns/'.length))]
        if (!v) { res.statusCode = 404; res.end('{}') } else res.end(JSON.stringify(v))
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

test('S4b: a stale tracking ref is caught by ls-remote, the head fetched into the scratch clone only', async (t) => {
  const s = box(t)
  const leak = s.leak()
  // Pushed by URL (no tracking ref moves), then built on from a second clone, so origin's head is not a local object.
  s.git('push', '-q', s.origin, 'HEAD:refs/heads/feat')
  const other = path.join(s.dir, 'other')
  execFileSync(GIT, ['clone', '-q', '-b', 'feat', s.origin, other], { env: s.env })
  fs.writeFileSync(path.join(other, 'more.txt'), 'more\n')
  execFileSync(GIT, ['-C', other, 'add', '-A'], { env: s.env })
  execFileSync(GIT, ['-C', other, 'commit', '-q', '-m', 'more'], { env: s.env })
  execFileSync(GIT, ['-C', other, 'push', '-q', 'origin', 'feat'], { env: s.env })
  const R = execFileSync(GIT, ['-C', other, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: s.env }).trim()
  assert.notEqual(spawnSync(GIT, ['-C', s.tree, 'cat-file', '-e', `${R}^{commit}`], { env: s.env }).status, 0, 'setup: R not local')
  const refs = s.git('for-each-ref')
  const r = await scan(s)
  assert.equal(r.json.secrets[0].commit, leak)
  assert.equal(r.json.secrets[0].pushed, true)
  assert.equal(r.json.action, 'human')
  assert.match(s.packed(), /upload-pack/, 'origin was read')
  assert.equal(s.git('for-each-ref'), refs, 'S14: the fetch leaves no ref in the tree\'s repo')
  assert.notEqual(spawnSync(GIT, ['-C', s.tree, 'cat-file', '-e', `${R}^{commit}`], { env: s.env }).status, 0, 'nor the object')
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

// ---- S10-S13: refusals, base, env, PATH ---------------------------------------------------------------------------

test('S10: tracked changes uncommitted: exit 2, commit them', async (t) => {
  const s = box(t)
  s.write('README.md', 'changed\n')
  const r = await scan(s)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /^ERROR: security-check: .*commit them, then run the scan again\n$/)
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
