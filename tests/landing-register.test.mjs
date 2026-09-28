// skills/_shared/scripts/landing-register.py — the landing register reader (ADR 0028 § 8).
//
// Every agent push asks it one question: may agents land in this repo? The register is a deny-list, so
// the reader fails closed wherever the file is ambiguous (a mention anywhere lists, a bad file is exit 2)
// and fails open only where the task mandates it (no register file at all). Hermetic: fixture repos are
// `git init` plus `git remote add` in a temp dir (no commits, no network), git config is /dev/null, and
// the caller's repo-local git env (a hook's GIT_DIR) is scrubbed before anything is layered back on.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'landing-register.py')
const FIX = path.join(root, 'tests', 'fixtures', 'landing-register')
const REGISTER = path.join(FIX, 'register.md')
const MALFORMED = path.join(FIX, 'malformed.md')
const UNTERMINATED = path.join(FIX, 'unterminated.md')

// Order matters: scrub git's own repo-local names first, then pin the config, so the pin is never
// filtered back out (run.sh:38's approach, exact names).
const drop = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
const base = { ...process.env }
for (const name of drop) delete base[name]
delete base.LANDING_REGISTER
base.GIT_CONFIG_GLOBAL = '/dev/null'
base.GIT_CONFIG_NOSYSTEM = '1'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-register-'))
const tmpHome = path.join(tmp, 'home')
fs.mkdirSync(tmpHome)
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }))

function git(args) {
  const r = spawnSync('git', args, { env: base, encoding: 'utf8' })
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
}

let repoCount = 0
function repo(origin, { name } = {}) {  // a fresh repo with `origin` set (none when origin is null)
  const dir = path.join(tmp, name ?? `repo-${++repoCount}`)
  fs.mkdirSync(dir, { recursive: true })
  git(['init', '-q', dir])
  if (origin !== null) git(['-C', dir, 'remote', 'add', 'origin', origin])
  return dir
}

// reg: a register path, '' (set but empty) or undefined (unset); omitted means the clean fixture.
function run(args, opts = {}) {
  const { home = tmpHome, env = {}, python = 'python3' } = opts
  const reg = 'reg' in opts ? opts.reg : REGISTER
  const e = { ...base, HOME: home, ...env }
  if (reg !== undefined) e.LANDING_REGISTER = reg
  const r = spawnSync(python, [SCRIPT, ...args], { env: e, encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error }
}

function check(target, opts) {  // target: a repo path, or ['--slug', 'o/n']
  return run(['check', ...(Array.isArray(target) ? target : [target])], opts)
}

function assertResult(r, status, stdout, label = '') {
  assert.equal(r.stderr, '', `stderr ${label}`)
  assert.equal(r.stdout, stdout, `stdout ${label}`)
  assert.equal(r.status, status, `status ${label}`)
}

function assertError(r, pattern = /^landing-register: \S.*\n$/) {
  assert.equal(r.status, 2, `status; stderr: ${r.stderr}`)
  assert.equal(r.stdout, '', 'nothing on stdout on error')
  assert.match(r.stderr, pattern)
  assert.equal(r.stderr.split('\n').filter(Boolean).length, 1, `one stderr line: ${r.stderr}`)
}

// ---- The task note's Verify line: listed, unlisted, missing file, no-origin.

test('listed: an scp-style origin on the register prints listed with the first entry\'s reason', () => {
  const r = check(repo('git@github.com:Animately/imgproxy.git'))
  assertResult(r, 3, 'listed Animately/imgproxy: reason A\n')  // reason A, not the duplicate's B
})

test('unlisted: lands, and the front-matter bullet never warns', () => {
  assertResult(check(repo('https://github.com/Animately/giflab.git')), 0, 'land\n')
})

test('missing register file: lands with one stderr warning', () => {
  const r = check(repo('git@github.com:Animately/imgproxy.git'), { reg: path.join(tmp, 'nope.md') })
  assert.equal(r.stdout, 'land\n')
  assert.equal(r.status, 0)
  assert.match(r.stderr, /^landing-register: no register at .*nope\.md[^\n]*\n$/)
})

for (const [label, origin] of [
  ['no origin remote', null],
  ['a bare path origin', '/srv/git/imgproxy'],
  ['a file:// origin', 'file:///srv/git/Animately/imgproxy.git'],
  ['another host (listed-looking slug)', 'https://gitlab.com/Animately/imgproxy.git'],
  ['GitHub with three path segments', 'https://github.com/Animately/imgproxy/extra'],
  ['www.github.com', 'https://www.github.com/Animately/imgproxy.git'],
  // remote-check's `case` admits neither, so the reader must not either (p11-3/p11-6 agree on origins).
  ['https with userinfo', 'https://lachy@github.com/Animately/imgproxy.git'],
  ['ssh with a port', 'ssh://git@github.com:22/Animately/imgproxy.git'],
  ['an owner starting with -', 'https://github.com/-Animately/imgproxy.git'],
  ['an all-dot name', 'https://github.com/Animately/...git'],
]) {
  test(`no-origin: ${label}`, () => {
    // The register is never read: a directory register (exit 2 when read) proves it.
    assertResult(check(repo(origin)), 4, 'no-origin\n', label)
    assertResult(check(repo(origin), { reg: tmp }), 4, 'no-origin\n', `${label}, register not read`)
  })
}

// ---- Origin shapes and case.

for (const origin of [
  'https://github.com/Animately/imgproxy.git',
  'https://github.com/Animately/imgproxy',
  'git@github.com:Animately/imgproxy',
  'ssh://git@github.com/Animately/imgproxy.git',
  'https://github.com/Animately/imgproxy/',
]) {
  test(`origin shape resolves: ${origin}`, () => {
    assertResult(check(repo(origin)), 3, 'listed Animately/imgproxy: reason A\n')
  })
}

test('matching is case-insensitive; output keeps the origin spelling', () => {
  assertResult(check(repo('https://github.com/animately/ANIMATELY-seo.git')), 3,
    'listed animately/ANIMATELY-seo: marketing site\n')
})

// ---- The relaxed entry grammar: every clean-fixture bullet is an entry, none warns.

for (const [slug, reason] of [
  ['Animately/animately-SEO', 'marketing site'],
  ['Animately/endash', 'en dash reason'],
  ['Animately/colon', 'colon reason'],
  ['Animately/teamrepo', '(team repo)'],
  ['Animately/bold', 'bold reason'],
  ['Animately/wikilink', 'no reason given'],
  ['Animately/noreason', 'no reason given'],
  ['Animately/star', 'star bullet'],
  ['Animately/plus', 'plus bullet'],
  ['Animately/numbered', 'numbered bullet'],
  ['Animately/indented', 'indented bullet'],
  ['Animately/dotgit', 'dotgit reason'],
  ['Animately/italic', 'italic reason'],
  ['Wild/anything', 'owner-wide'],
]) {
  test(`entry grammar: ${slug} is listed with "${reason}"`, () => {
    assertResult(check(repo(`https://github.com/${slug}.git`)), 3, `listed ${slug}: ${reason}\n`)
  })
}

// ---- Malformed bullets: deterministic warnings, fail closed on any attributable mention.

function assertMalformed(slug, status, stdout) {
  const r = check(repo(`git@github.com:${slug}.git`), { reg: MALFORMED })
  assert.equal(r.stdout, stdout, `stdout for ${slug}`)
  assert.equal(r.status, status, `status for ${slug}`)
  const lines = r.stderr.split('\n').filter(Boolean)
  assert.equal(lines.length, 2, `two warnings for ${slug}: ${r.stderr}`)
  assert.match(lines[0], /^landing-register: .*malformed\.md:2: malformed entry: - Animately imgproxy/)
  assert.match(lines[1], /^landing-register: .*malformed\.md:3: malformed entry: - see the ops channel/)
}

test('malformed: a slug in prose lists that repo', () => {
  assertMalformed('Animately/mentioned-in-prose', 3,
    'listed Animately/mentioned-in-prose: malformed register entry at line 1\n')
})
test('malformed: a malformed bullet naming the bare repo name lists it', () => {
  assertMalformed('Animately/imgproxy', 3, 'listed Animately/imgproxy: malformed register entry at line 2\n')
})
test('malformed: an unrelated repo still lands, with the same two warnings', () => {
  assertMalformed('Animately/giflab', 0, 'land\n')
})
test('malformed: a longer name is not hit by a shorter bare name', () => {
  assertMalformed('Animately/imgproxy-benchmark-script', 0, 'land\n')
})

// A bullet marker glued to its text is a malformed bullet: it warns and gets the bare-name sweep, and
// a leading `-` or `.` never makes a different owner (GitHub owners cannot start with either).
for (const [label, line] of [
  ['dash glued to the slug', '-Animately/imgproxy — reason'],
  ['number glued to the slug', '1.Animately/imgproxy — reason'],
  ['a dash inside the bullet', '- -Animately/imgproxy'],
  ['glued, bare name only', '-imgproxy — reason'],
]) {
  test(`malformed: ${label} lists the repo and warns`, () => {
    const reg = path.join(tmp, 'glued.md')
    fs.writeFileSync(reg, `Header.\n${line}\n`)
    const warning = `landing-register: ${reg}:2: malformed entry: ${line}\n`
    const listed = check(repo('git@github.com:Animately/imgproxy.git'), { reg })
    assert.equal(listed.stdout, 'listed Animately/imgproxy: malformed register entry at line 2\n', label)
    assert.equal(listed.status, 3, label)
    assert.equal(listed.stderr, warning, label)
    const other = check(['--slug', 'Animately/giflab'], { reg })
    assert.equal(other.stdout, 'land\n', `${label}: another repo lands`)
    assert.equal(other.stderr, warning, `${label}: with the same warning`)
  })
}

test('thematic breaks are neither bullets nor malformed', () => {
  const reg = path.join(tmp, 'breaks.md')
  fs.writeFileSync(reg, 'Header.\n\n---\n* * *\n- - -\n___\n- Animately/imgproxy — after breaks\n')
  assertResult(check(['--slug', 'Animately/imgproxy'], { reg }), 3, 'listed Animately/imgproxy: after breaks\n')
  assertResult(check(['--slug', 'Animately/giflab'], { reg }), 0, 'land\n')
})

test('an exact entry beats an earlier owner-wide one', () => {
  const reg = path.join(tmp, 'exact.md')
  fs.writeFileSync(reg, '- Wild/* — owner\n- Wild/specific — exact\n')
  assertResult(check(['--slug', 'Wild/specific'], { reg }), 3, 'listed Wild/specific: exact\n')
  assertResult(check(['--slug', 'Wild/other'], { reg }), 3, 'listed Wild/other: owner\n')
})

test('front matter closed by ... is skipped, and the body after it is read', () => {
  const reg = path.join(tmp, 'dots.md')
  fs.writeFileSync(reg, '---\ntags: x\n- not an entry\n...\n- Animately/imgproxy — after dots\n')
  assertResult(check(['--slug', 'Animately/imgproxy'], { reg }), 3, 'listed Animately/imgproxy: after dots\n')
  assertResult(check(['--slug', 'Animately/giflab'], { reg }), 0, 'land\n', 'front-matter bullet never warns')
})

test('unterminated front matter: exit 2 for every repo', () => {
  for (const slug of ['Animately/imgproxy', 'Animately/giflab']) {
    assertError(check(repo(`https://github.com/${slug}`), { reg: UNTERMINATED }), /unterminated front matter/)
  }
})

// ---- Registers built at test time (git's eol handling never touches them).

test('CRLF and a BOM: listed, no \\r in the reason', () => {
  const reg = path.join(tmp, 'crlf.md')
  fs.writeFileSync(reg, '﻿---\r\ntags: x\r\n---\r\n- Animately/imgproxy — crlf reason\r\n')
  assertResult(check(repo('https://github.com/Animately/imgproxy'), { reg }), 3,
    'listed Animately/imgproxy: crlf reason\n')
})

test('an empty register lands silently', () => {
  const reg = path.join(tmp, 'empty.md')
  fs.writeFileSync(reg, '')
  assertResult(check(repo('https://github.com/Animately/imgproxy'), { reg }), 0, 'land\n')
})

test('a register path that is a directory: exit 2', () => {
  assertError(check(repo('https://github.com/Animately/giflab'), { reg: tmp }), /cannot read register/)
})

test('a register that is not UTF-8: exit 2', () => {
  const reg = path.join(tmp, 'latin1.md')
  fs.writeFileSync(reg, Buffer.from([0x2d, 0x20, 0xff, 0xfe, 0x0a]))
  assertError(check(repo('https://github.com/Animately/giflab'), { reg }), /cannot read register/)
})

test('a slug mentioned in front matter or a sentence still lists (mention sweep)', () => {
  const reg = path.join(tmp, 'mentions.md')
  fs.writeFileSync(reg, '---\nnote: Animately/fmrepo\n---\nSee https://github.com/Animately/urlrepo.\nAlso Animately/endrepo.\n')
  for (const [slug, line] of [['Animately/fmrepo', 2], ['Animately/urlrepo', 4], ['Animately/endrepo', 5]]) {
    assertResult(check(repo(`https://github.com/${slug}`), { reg }), 3,
      `listed ${slug}: malformed register entry at line ${line}\n`, slug)
  }
  assertResult(check(repo('https://github.com/Animately/url'), { reg }), 0, 'land\n', 'prefix is not a hit')
})

test('owner/* in prose or front matter lists every repo of that owner (mention sweep)', () => {
  const reg = path.join(tmp, 'owner-mentions.md')
  fs.writeFileSync(reg, '---\nnote: Front/*\n---\nNothing from Prose/* lands.\n')
  assertResult(check(['--slug', 'Front/anything'], { reg }), 3,
    'listed Front/anything: malformed register entry at line 2\n')
  assertResult(check(['--slug', 'Prose/anything'], { reg }), 3,
    'listed Prose/anything: malformed register entry at line 4\n')
  assertResult(check(['--slug', 'Other/anything'], { reg }), 0, 'land\n')
})

test('mention sweep, left bound: a leading - or . names the repo; a longer word does not', () => {
  const reg = path.join(tmp, 'left-bound.md')
  fs.writeFileSync(reg, 'Held: -Animately/dashed and .Animately/dotted.\nNot: my-Animately/imgproxy, v1.Animately/giflab.\n')
  for (const [slug, line] of [['Animately/dashed', 1], ['Animately/dotted', 1]]) {
    assertResult(check(['--slug', slug], { reg }), 3, `listed ${slug}: malformed register entry at line ${line}\n`, slug)
  }
  for (const slug of ['Animately/imgproxy', 'Animately/giflab']) {
    assertResult(check(['--slug', slug], { reg }), 0, 'land\n', slug)
  }
})

// ---- The default register path.

test('default path: LANDING_REGISTER unset or empty reads ~/repos/workspaces/_shared/knowledge', () => {
  const home = path.join(tmp, 'home-with-register')
  const knowledge = path.join(home, 'repos', 'workspaces', '_shared', 'knowledge')
  fs.mkdirSync(knowledge, { recursive: true })
  fs.copyFileSync(REGISTER, path.join(knowledge, 'landing-register.md'))
  const r = repo('git@github.com:Animately/imgproxy.git')
  assertResult(check(r, { reg: undefined, home }), 3, 'listed Animately/imgproxy: reason A\n', 'unset')
  assertResult(check(r, { reg: '', home }), 3, 'listed Animately/imgproxy: reason A\n', 'empty')
})

test('LANDING_REGISTER with a leading ~ is expanded against HOME', () => {
  const home = path.join(tmp, 'home-tilde')
  fs.mkdirSync(path.join(home, 'regs'), { recursive: true })
  fs.copyFileSync(REGISTER, path.join(home, 'regs', 'landing.md'))
  assertResult(check(['--slug', 'Animately/imgproxy'], { reg: '~/regs/landing.md', home }), 3,
    'listed Animately/imgproxy: reason A\n')
})

test('a dangling symlink at the register path, or above it, is exit 2, not "no register"', () => {
  const link = path.join(tmp, 'dangling.md')
  fs.symlinkSync(path.join(tmp, 'gone.md'), link)
  assertError(check(['--slug', 'Animately/imgproxy'], { reg: link }), /cannot read register/)
  const dir = path.join(tmp, 'dangling-dir')
  fs.symlinkSync(path.join(tmp, 'gone-dir'), dir)
  assertError(check(['--slug', 'Animately/imgproxy'], { reg: path.join(dir, 'landing.md') }), /cannot read register/)
})

test('default path: no file there lands with the one warning', () => {
  const r = check(repo('git@github.com:Animately/imgproxy.git'), { reg: undefined })
  assert.equal(r.stdout, 'land\n')
  assert.equal(r.status, 0)
  assert.match(r.stderr, /^landing-register: no register at .*repos\/workspaces\/_shared\/knowledge\/landing-register\.md[^\n]*\n$/)
})

// ---- Repo paths.

test('a repo path with a space resolves', () => {
  assertResult(check(repo('git@github.com:Animately/imgproxy.git', { name: 'my repo' })), 3,
    'listed Animately/imgproxy: reason A\n')
})

test('a subdirectory of the repo resolves', () => {
  const dir = repo('git@github.com:Animately/imgproxy.git')
  const sub = path.join(dir, 'src', 'deep')
  fs.mkdirSync(sub, { recursive: true })
  assertResult(check(sub), 3, 'listed Animately/imgproxy: reason A\n')
})

// ---- Errors: exit 2, nothing on stdout, one prefixed stderr line.

test('a path that is not a git repository', () => {
  const dir = path.join(tmp, 'not-a-repo')
  fs.mkdirSync(dir)
  assertError(check(dir), /not a git repository/)
})
test('a path that does not exist', () => assertError(check(path.join(tmp, 'missing'))))
test('check with no argument', () => assertError(run(['check'])))
test('check with both --slug and a path', () => {
  assertError(run(['check', '--slug', 'a/b', repo('https://github.com/a/b')]))
})
test('no subcommand', () => assertError(run([])))
test('an unknown subcommand', () => assertError(run(['frob', '/tmp'])))
test('--slug that is not owner/name', () => assertError(check(['--slug', 'not-a-slug'])))
test('--slug with three segments', () => assertError(check(['--slug', 'a/b/c'])))
for (const slug of ['../..', 'Animately/..', 'Animately/.', '-Animately/imgproxy', '.Animately/imgproxy']) {
  test(`--slug ${slug} is not a repo: exit 2`, () => assertError(check(['--slug', slug])))
}
test('an empty repo path is exit 2, never the current directory', () => {
  // Run from inside a listed repo: were "" read as ".", this would print `listed`.
  const cwdRepo = repo('git@github.com:Animately/imgproxy.git')
  const e = { ...base, HOME: tmpHome, LANDING_REGISTER: REGISTER }
  const r = spawnSync('python3', [SCRIPT, 'check', ''], { env: e, cwd: cwdRepo, encoding: 'utf8' })
  assertError({ status: r.status, stdout: r.stdout, stderr: r.stderr }, /empty <repo-path>/)
})

// Help would exit 0 with usage on stdout; exit 0 is the permission to push, so help is an error.
for (const args of [['-h'], ['--help'], ['check', '-h'], ['check', '--help'], ['check', '--slug', 'a/b', '-h']]) {
  test(`${args.join(' ')} is exit 2 and never prints land`, () => {
    const r = run(args)
    assertError(r)
    assert.doesNotMatch(r.stdout + r.stderr, /\bland\b/)
  })
}

// ---- --slug: owner/name without a checkout (the daily lander's form).

test('--slug listed', () => {
  assertResult(check(['--slug', 'Animately/imgproxy']), 3, 'listed Animately/imgproxy: reason A\n')
})
test('--slug unlisted, .git stripped', () => {
  assertResult(check(['--slug', 'animately/giflab.git']), 0, 'land\n')
})

// A PATH holding only python proves --slug never calls git, and a path check without git is exit 2.
const pyExe = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout.trim()
test('--slug needs no git; a repo path without git is exit 2', () => {
  const noGit = { PATH: path.join(tmp, 'empty-bin') }
  fs.mkdirSync(noGit.PATH, { recursive: true })
  assertResult(check(['--slug', 'Animately/imgproxy'], { env: noGit, python: pyExe }), 3,
    'listed Animately/imgproxy: reason A\n')
  assertError(check(repo('https://github.com/Animately/giflab'), { env: noGit, python: pyExe }), /git/)
})

// ---- Env hygiene: a hook's inherited GIT_DIR never overrides the path argument.

test('an inherited GIT_DIR is scrubbed: the path argument wins', () => {
  const listed = repo('git@github.com:Animately/imgproxy.git')
  const unlisted = repo('git@github.com:Animately/giflab.git')
  assertResult(check(unlisted, { env: { GIT_DIR: path.join(listed, '.git'), GIT_WORK_TREE: listed } }), 0, 'land\n')
})
