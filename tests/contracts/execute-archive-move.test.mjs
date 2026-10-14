// Execute § 4.5's completion ceremony archives the rollout note into Work/Tasks/Archive/Rollouts/. A rollout
// note is normally untracked (the vault's daily sweep commits notes), so an unconditional `git mv` fails with
// `fatal: not under version control` (rc 128): the 3.0.0 live E2E hit it (row 5) and the lead fell back to a
// plain `mv` by hand. The ceremony now picks the move by whether git tracks the note, then commits by pathspec.
//
// Three layers:
//   - behaviour: the `# thread:archive-rollout` fence is EXTRACTED from the move bullet and run against a
//     temp git repo standing in for the vault, once with the note untracked and once tracked;
//   - checkArchive: a pure function returning the names of the failed doc checks, run on the real files and
//     on one control per check, so no matcher passes vacuously;
//   - sweep: no line under skills/ moves a vault note with an unconditional `git mv`.
// Nothing is written into the checkout.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { read, collapse, FENCE, fencedBlocks, textFiles } from '../lib/contract-text.mjs'

const real = {
  execute: read('skills/execute/SKILL.md'),
  template: read('skills/schedule/rollout-template.md'),
}

// Execute § 4.5 step 5's bullets (three-space `- ` items up to the first blank line outside a fence).
function stepFive(text) {
  const lines = text.split('\n')
  const head = lines.findIndex((l) => /^5\. \*\*Completion\.\*\*/.test(l))
  if (head < 0) return []
  const bullets = []
  let fence = false
  for (let i = head + 1; i < lines.length; i++) {
    const l = lines[i]
    if (FENCE.test(l)) fence = !fence
    else if (!fence && /^\s*$/.test(l)) break
    if (!fence && /^ {3}- /.test(l)) bullets.push(l)
    else if (bullets.length) bullets[bullets.length - 1] += `\n${l}`
  }
  return bullets
}

const moveBullet = (text) => stepFive(text).find((b) => b.startsWith('   - Move the rollout note')) ?? null
const archiveFence = (bullet) =>
  bullet == null ? null : fencedBlocks(bullet).find((b) => b.some((l) => l.trim() === '# thread:archive-rollout')) ?? null

// A `git mv` (or `git -C <dir> mv`) on a line that does not also test tracking with `ls-files --error-unmatch`.
const GIT_MV = /\bgit (?:-C \S+ )?mv\b/
const unconditional = (line) => GIT_MV.test(line) && !line.includes('ls-files --error-unmatch')

function checkArchive(files) {
  const fails = []
  const move = moveBullet(files.execute)
  const prose = move == null ? '' : collapse(move)

  // cases: the move bullet names both cases, keyed on `git ls-files --error-unmatch`.
  if (!prose.includes('`git mv` when `git ls-files --error-unmatch` finds the note, else a plain `mv`')) fails.push('cases')

  // fence: the runnable snippet tests tracking, then `git mv` or plain `mv`.
  const fence = (archiveFence(move) ?? []).join('\n')
  if (!fence.includes('ls-files --error-unmatch') || !/\bgit -C "\$V" mv\b/.test(fence) ||
    !/else mv -- /.test(fence)) fails.push('fence')

  // pathspec: the commit names the moved note by pathspec, and the old path only when it was tracked.
  if (!prose.includes('commit by pathspec') || !prose.includes('only when the note was tracked')) fails.push('pathspec')

  // template: the manual ceremony's archive step names both cases too.
  const step6 = files.template.split('\n').find((l) => l.startsWith('6. Move this note')) ?? ''
  if (!step6.includes('`git ls-files --error-unmatch`') || !step6.includes('else a plain `mv`') ||
    !step6.includes('by pathspec')) fails.push('template')

  // sweep: no unconditional `git mv` in either file.
  if ([files.execute, files.template].some((t) => t.split('\n').some(unconditional))) fails.push('sweep')
  return fails
}

const only = (name, files, want) => assert.deepEqual(checkArchive(files), want, `${name}: expected ${want}`)
const swap = (key, from, to) => {
  assert.ok(real[key].includes(from), `control setup: ${from.slice(0, 60)} not in ${key}`)
  return { ...real, [key]: real[key].replace(from, to) }
}

test('the real execute SKILL.md and rollout template pass every archive check', () => {
  assert.deepEqual(checkArchive(real), [])
})

test('controls: each check fails on its own mutation', () => {
  only('cases', swap('execute', 'finds the note, else a plain `mv`', 'finds the note'), ['cases'])
  only('fence', swap('execute', 'else mv -- ', 'else git -C "$V" ls-files --error-unmatch -- '), ['fence'])
  only('pathspec', swap('execute', 'only when the note was tracked', 'always'), ['pathspec'])
  only('template', swap('template', 'else a plain `mv`', 'else nothing'), ['template'])
  only('sweep', swap('execute', '   - Stamp `status: done`', '   - `git mv` the task notes. Stamp `status: done`'), ['sweep'])
})

test('no line under skills/ moves a note with an unconditional `git mv`', () => {
  const hits = textFiles('skills').flatMap(({ file, text }) =>
    text.split('\n').map((l, i) => [l, i]).filter(([l]) => unconditional(l)).map(([, i]) => `${file}:${i + 1}`))
  assert.deepEqual(hits, [], 'unconditional `git mv` (test tracking with `git ls-files --error-unmatch` first)')
})

// ---- behaviour: the extracted fence against a temp vault ------------------------------------------

const SLUG = 'demo-rollout-2026-10-15'
const tmps = []
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }) })

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' })

function vault(tracked) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-move-'))
  tmps.push(v)
  assert.equal(git(v, 'init', '-q').status, 0)
  for (const [k, val] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false']]) git(v, 'config', k, val)
  fs.mkdirSync(path.join(v, 'Work/Tasks'), { recursive: true })
  fs.writeFileSync(path.join(v, 'Work/Tasks/other.md'), 'other\n')
  fs.writeFileSync(path.join(v, `Work/Tasks/${SLUG}.md`), 'status: done\n')
  git(v, 'add', '--', 'Work/Tasks/other.md')
  if (tracked) git(v, 'add', '--', `Work/Tasks/${SLUG}.md`)
  assert.equal(git(v, 'commit', '-qm', 'seed').status, 0)
  return v
}

function runFence(v) {
  const fence = archiveFence(moveBullet(real.execute))
  assert.ok(fence, 'the move bullet carries a `# thread:archive-rollout` fence')
  const script = fence.join('\n').replaceAll('~/repos/obsidian', JSON.stringify(v)).replaceAll('<rollout-slug>', SLUG)
  return spawnSync('bash', ['-euo', 'pipefail', '-c', script], { encoding: 'utf8' })
}

test('behaviour: an untracked rollout note is moved with a plain mv (the unconditional git mv fails rc 128)', () => {
  const v = vault(false)
  const naive = git(v, 'mv', '--', `Work/Tasks/${SLUG}.md`, 'Work/Tasks/other-dir.md')
  assert.equal(naive.status, 128, 'control: git mv of an untracked note fails')
  const r = runFence(v)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!fs.existsSync(path.join(v, `Work/Tasks/${SLUG}.md`)), 'old path gone')
  assert.ok(fs.existsSync(path.join(v, `Work/Tasks/Archive/Rollouts/${SLUG}.md`)), 'archived')
  // commit by pathspec: add the moved note, commit only it; the old path was never tracked, so it is not named.
  const p = `Work/Tasks/Archive/Rollouts/${SLUG}.md`
  assert.equal(git(v, 'add', '--', p).status, 0)
  assert.equal(git(v, 'commit', '-qm', 'archive', '--', p).status, 0)
  assert.equal(git(v, 'ls-files', '--error-unmatch', '--', p).status, 0)
})

test('behaviour: a tracked rollout note is moved with git mv, and the rename commits by pathspec', () => {
  const v = vault(true)
  const r = runFence(v)
  assert.equal(r.status, 0, r.stderr)
  const p = `Work/Tasks/Archive/Rollouts/${SLUG}.md`
  assert.ok(fs.existsSync(path.join(v, p)), 'archived')
  assert.match(git(v, 'status', '--porcelain').stdout, /^R {2}Work\/Tasks\/demo-rollout-2026-10-15\.md -> Work\/Tasks\/Archive\/Rollouts\//m,
    'git mv staged a rename')
  assert.equal(git(v, 'commit', '-qm', 'archive', '--', `Work/Tasks/${SLUG}.md`, p).status, 0)
  assert.equal(git(v, 'status', '--porcelain').stdout, '', 'nothing left staged')
})
