// Execute § 4.5's completion ceremony archives the rollout note into Work/Tasks/Archive/Rollouts/. A rollout
// note is normally untracked (the vault's daily sweep commits notes), so an unconditional `git mv` fails with
// `fatal: not under version control` (rc 128): the 3.0.0 live E2E hit it (row 5) and the lead fell back to a
// plain `mv` by hand. The ceremony now picks the move by whether git tracks the note, prints which case ran
// (`tracked` or `untracked`), refuses to overwrite an earlier archived note, then commits by pathspec keyed on
// the printed word (a `tracked` move's old path must be named, or its staged deletion outlives the commit).
//
// Three layers:
//   - behaviour: the `# thread:archive-rollout` fence is EXTRACTED from the move bullet and run against a
//     temp git repo standing in for the vault: untracked, tracked, a collision, and a follow-on moved back;
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

const GUARD = '[ ! -e "$V/$A/<rollout-slug>.md" ] || { echo "archive-rollout: $A/<rollout-slug>.md already exists" >&2; exit 1; }'

function checkArchive(files) {
  const fails = []
  const move = moveBullet(files.execute)
  const prose = move == null ? '' : collapse(move)
  const fenceLines = (archiveFence(move) ?? []).map((l) => l.trim())
  const fence = fenceLines.join('\n')
  const ifAt = fenceLines.findIndex((l) => l.startsWith('if git -C "$V" ls-files --error-unmatch'))

  // cases: the move bullet names both cases, keyed on `git ls-files --error-unmatch`.
  if (!prose.includes('`git mv` when `git ls-files --error-unmatch` finds the note, else a plain `mv`')) fails.push('cases')

  // fence: the runnable snippet tests tracking, then `git mv` or plain `mv`.
  if (ifAt < 0 || !/\bgit -C "\$V" mv\b/.test(fence) || !/else mv -- /.test(fence)) fails.push('fence')

  // noclobber: the guard precedes the `if`, and the prose says a collision halts and is reported.
  const guardAt = fenceLines.indexOf(GUARD)
  if (guardAt < 0 || !(guardAt < ifAt) || !prose.includes('A move never overwrites') ||
    !prose.includes('a collision, which halts the ceremony and is reported')) fails.push('noclobber')

  // printed: each branch prints its case, and the commit keys on the printed word.
  if (!fence.includes('"$N" "$A/" && echo tracked; else') || !fence.includes('"$V/$A/" && echo untracked; fi') ||
    !prose.includes("the rollout note's old `Work/Tasks/<rollout-slug>.md` when the snippet printed `tracked`") ||
    !prose.includes('Never name an old path after `untracked`')) fails.push('printed')

  // pathspec: the commit names the ceremony's notes by pathspec, never the whole vault, and never the bare vault rule.
  if (!prose.includes("commit the ceremony's notes (task, phase, follow-on and rollout) by pathspec") ||
    !prose.includes('never the whole vault') || prose.includes('commit the vault')) fails.push('pathspec')

  // followon: a follow-on moved back out of Archive prints its case, and a `tracked` move-back's old path is named.
  const existing = files.execute.split('\n').find((l) => l.trimStart().startsWith('- Existing follow-on:')) ?? ''
  if (!existing.includes('printing `tracked` or `untracked`') ||
    !prose.includes("the follow-on's old `Work/Tasks/Archive/**` path when *Existing follow-on* moved it back and printed `tracked`"))
    fails.push('followon')

  // template: the manual ceremony's archive step names both cases, the follow-on's old path and the no-clobber rule.
  const step6 = files.template.split('\n').find((l) => l.startsWith('6. Move this note')) ?? ''
  if (!step6.includes('`git ls-files --error-unmatch`') || !step6.includes('else a plain `mv`') ||
    !step6.includes('by pathspec') || !step6.includes('old Archive path of a follow-on') ||
    !step6.includes('A move never overwrites')) fails.push('template')

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
  only('fence', swap('execute', 'else mv -- ', 'else cp -- '), ['fence'])
  only('noclobber:guard', swap('execute', `     ${GUARD}\n`, ''), ['noclobber'])
  only('noclobber:prose', swap('execute', 'a collision, which halts the ceremony and is reported', 'overwritten'), ['noclobber'])
  only('printed:echo', swap('execute', ' && echo tracked;', ';'), ['printed'])
  only('printed:key', swap('execute', 'when the snippet printed `tracked`', 'when the note was tracked'), ['printed'])
  only('pathspec', swap('execute', "then commit the ceremony's notes (task, phase, follow-on and rollout) by pathspec",
    'and commit the vault (task, phase, follow-on and rollout notes)'), ['pathspec'])
  only('followon:commit', swap('execute', ", and the follow-on's old `Work/Tasks/Archive/**` path when *Existing follow-on* moved it back and printed `tracked`", ''), ['followon'])
  only('followon:print', swap('execute', ', printing `tracked` or `untracked` as that snippet does', ''), ['followon'])
  only('template', swap('template', 'A move never overwrites', 'A move overwrites'), ['template'])
  only('sweep', swap('execute', '   - Stamp `status: done`', '   - `git mv` the task notes. Stamp `status: done`'), ['sweep'])
})

test('control: the guard after the `if` fails noclobber', () => {
  const fence = archiveFence(moveBullet(real.execute))
  const ifLine = fence.find((l) => l.trim().startsWith('if git'))
  const moved = real.execute.replace(`     ${GUARD}\n`, '').replace(ifLine, `${ifLine}\n     ${GUARD}`)
  assert.deepEqual(checkArchive({ ...real, execute: moved }), ['noclobber'])
})

test('no line under skills/ moves a note with an unconditional `git mv`', () => {
  const hits = textFiles('skills').flatMap(({ file, text }) =>
    text.split('\n').map((l, i) => [l, i]).filter(([l]) => unconditional(l)).map(([, i]) => `${file}:${i + 1}`))
  assert.deepEqual(hits, [], 'unconditional `git mv` (test tracking with `git ls-files --error-unmatch` first)')
})

// ---- behaviour: the extracted fence against a temp vault ------------------------------------------

const SLUG = 'demo-rollout-2026-10-15'
const OLD = `Work/Tasks/${SLUG}.md`
const ARCHIVED = `Work/Tasks/Archive/Rollouts/${SLUG}.md`
const tmps = []
after(() => { for (const d of tmps) fs.rmSync(d, { recursive: true, force: true }) })

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' })
const write = (v, rel, body) => { fs.mkdirSync(path.dirname(path.join(v, rel)), { recursive: true }); fs.writeFileSync(path.join(v, rel), body) }
const readV = (v, rel) => fs.readFileSync(path.join(v, rel), 'utf8')

// A temp vault: Work/Tasks/other.md committed; the rollout note committed only when `tracked`; `seed` adds more
// files ({ rel: body }) and `commit` lists which of them are committed with the seed.
function vault(tracked, { seed = {}, commit = [] } = {}) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-move-'))
  tmps.push(v)
  assert.equal(git(v, 'init', '-q').status, 0)
  for (const [k, val] of [['user.name', 't'], ['user.email', 't@t'], ['commit.gpgsign', 'false']]) git(v, 'config', k, val)
  write(v, 'Work/Tasks/other.md', 'other\n')
  write(v, OLD, 'status: done\n')
  for (const [rel, body] of Object.entries(seed)) write(v, rel, body)
  git(v, 'add', '--', 'Work/Tasks/other.md', ...commit)
  if (tracked) git(v, 'add', '--', OLD)
  assert.equal(git(v, 'commit', '-qm', 'seed').status, 0)
  return v
}

function script(v, fence = archiveFence(moveBullet(real.execute))) {
  assert.ok(fence, 'the move bullet carries a `# thread:archive-rollout` fence')
  return fence.join('\n').replaceAll('~/repos/obsidian', JSON.stringify(v)).replaceAll('<rollout-slug>', SLUG)
}
const runFence = (v, fence) => spawnSync('bash', ['-euo', 'pipefail', '-c', script(v, fence)], { encoding: 'utf8' })

// The move bullet's commit rule: add the notes the ceremony wrote, commit the same paths, plus the rollout
// note's old path only after `tracked`, plus any old Archive path a `tracked` follow-on move-back left staged.
function commitByRule(v, printed, written, movedBack = []) {
  assert.ok(['tracked', 'untracked'].includes(printed), `the snippet printed its case, got ${JSON.stringify(printed)}`)
  assert.equal(git(v, 'add', '--', ...written).status, 0)
  const old = printed === 'tracked' ? [OLD] : []
  const r = git(v, 'commit', '-qm', 'archive', '--', ...written, ...old, ...movedBack)
  assert.equal(r.status, 0, r.stderr)
}

test('behaviour: an untracked rollout note is moved with a plain mv and prints `untracked`', () => {
  const v = vault(false)
  const naive = git(v, 'mv', '--', OLD, 'Work/Tasks/other-dir.md')
  assert.equal(naive.status, 128, 'control: git mv of an untracked note fails')
  const r = runFence(v)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'untracked\n', 'the plain-mv branch prints its case')
  assert.ok(!fs.existsSync(path.join(v, OLD)), 'old path gone')
  assert.ok(fs.existsSync(path.join(v, ARCHIVED)), 'archived')
  // naming the never-tracked old path anyway is refused, which is why `untracked` leaves it out.
  assert.equal(git(v, 'add', '--', ARCHIVED).status, 0)
  assert.notEqual(git(v, 'commit', '-qm', 'x', '--', ARCHIVED, OLD).status, 0, 'control: a never-tracked pathspec is refused')
  commitByRule(v, r.stdout.trim(), [ARCHIVED])
  assert.equal(git(v, 'ls-files', '--error-unmatch', '--', ARCHIVED).status, 0)
  assert.equal(git(v, 'status', '--porcelain').stdout, '', 'nothing left staged')
})

test('behaviour: a tracked rollout note is moved with git mv, prints `tracked`, and the rename commits by pathspec', () => {
  const v = vault(true)
  const r = runFence(v)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'tracked\n', 'the git-mv branch prints its case')
  assert.ok(fs.existsSync(path.join(v, ARCHIVED)), 'archived')
  assert.match(git(v, 'status', '--porcelain').stdout, /^R {2}Work\/Tasks\/demo-rollout-2026-10-15\.md -> Work\/Tasks\/Archive\/Rollouts\//m,
    'git mv staged a rename')
  commitByRule(v, r.stdout.trim(), [ARCHIVED])
  assert.equal(git(v, 'status', '--porcelain').stdout, '', 'nothing left staged')
})

test('control: on `tracked`, a commit that leaves out the old path leaves its deletion staged with no error', () => {
  const v = vault(true)
  const r = runFence(v)
  assert.equal(r.stdout, 'tracked\n')
  assert.equal(git(v, 'commit', '-qm', 'archive', '--', ARCHIVED).status, 0, 'git does not complain')
  assert.equal(git(v, 'status', '--porcelain').stdout, `D  ${OLD}\n`, 'the deletion is still staged')
})

for (const tracked of [false, true]) {
  test(`behaviour: a same-named archived note is never overwritten (${tracked ? 'tracked' : 'untracked'} source)`, () => {
    const earlier = 'an earlier archived rollout\n'
    const v = vault(tracked, { seed: { [ARCHIVED]: earlier } })
    const r = runFence(v)
    assert.equal(r.status, 1, 'a collision halts the snippet')
    assert.equal(r.stdout, '', 'neither case ran')
    assert.match(r.stderr, new RegExp(`archive-rollout: Work/Tasks/Archive/Rollouts/${SLUG}\\.md already exists`))
    assert.equal(readV(v, ARCHIVED), earlier, 'the archived note is untouched')
    assert.equal(readV(v, OLD), 'status: done\n', 'the rollout note stays where it was')
    assert.doesNotMatch(git(v, 'status', '--porcelain').stdout, /^[RD]/m, 'nothing staged')
  })
}

test('control: without the guard, the plain-mv branch silently overwrites the archived note', () => {
  const earlier = 'an earlier archived rollout\n'
  const v = vault(false, { seed: { [ARCHIVED]: earlier } })
  const unguarded = archiveFence(moveBullet(real.execute)).filter((l) => l.trim() !== GUARD)
  const r = runFence(v, unguarded)
  assert.equal(r.status, 0, 'mv exits 0')
  assert.equal(readV(v, ARCHIVED), 'status: done\n', 'the earlier archived note was overwritten')
})

test('behaviour: a tracked follow-on moved back out of Archive is committed with its old path named', () => {
  const FOLLOW = `phase-close-followup-${SLUG}.md`
  const FOLD = `Work/Tasks/Archive/${FOLLOW}`
  const FNEW = `Work/Tasks/${FOLLOW}`
  const setup = () => {
    const v = vault(false, { seed: { [FOLD]: 'status: done\n' }, commit: [FOLD] })
    // *Existing follow-on*: the archived, done copy is tracked (the sweep committed it), so it moves back with
    // `git mv` and prints `tracked`.
    assert.equal(git(v, 'ls-files', '--error-unmatch', '--', FOLD).status, 0)
    assert.equal(git(v, 'mv', '--', FOLD, 'Work/Tasks/').status, 0)
    write(v, FNEW, 'status: open\nclose phase demo-p1: reconcile-project exited 1: x\n')
    const r = runFence(v)
    assert.equal(r.stdout, 'untracked\n')
    return { v, printed: r.stdout.trim() }
  }
  // control: the rollout's pathspec alone leaves the follow-on's Archive deletion staged.
  const c = setup()
  commitByRule(c.v, c.printed, [ARCHIVED, FNEW])
  assert.equal(git(c.v, 'status', '--porcelain').stdout, `D  ${FOLD}\n`, 'control: the follow-on deletion outlives the commit')
  // the rule: name the follow-on's old Archive path too.
  const w = setup()
  commitByRule(w.v, w.printed, [ARCHIVED, FNEW], [FOLD])
  assert.equal(git(w.v, 'status', '--porcelain').stdout, '', 'nothing left staged')
  assert.equal(git(w.v, 'ls-files', '--', FOLD).stdout, '', 'the Archive path is gone from the index')
})
