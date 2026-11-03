// Confirm-step reproduction for review a0edc92/8314ab finding 5: an archived unreadable note sharing a live broken
// task's name masks that task's why in slices' notGradeable[]. Real scan over a throwaway vault, then slices.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root } from './lib/contract-text.mjs'

const DISPATCH = path.join(root, 'skills', '_shared', 'scripts', 'estate-dispatch.py')
const SCAN = path.join(root, 'skills', '_shared', 'scripts', 'estate-scan.py')
const S = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-unread-')))
after(() => fs.rmSync(S, { recursive: true, force: true }))
const HOME = path.join(S, 'home')
fs.mkdirSync(HOME, { recursive: true })
const env = { ...process.env, HOME, THREAD_EVENTS_DIR: path.join(S, 'events'), THREAD_LEG_LOCK_DIR: path.join(S, 'locks') }
env.PYTHONUSERBASE ??= spawnSync('python3', ['-c', 'import site; print(site.getuserbase())'], { encoding: 'utf8' }).stdout.trim()
delete env.CLAUDE_PLUGIN_ROOT
const write = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t) }

test('finding 5: a live task whose frontmatter does not parse keeps that why beside an archived unreadable namesake', () => {
  const V = path.join(S, 'v')
  write(path.join(V, 'Work', 'Projects', 'Pf.md'), '---\ntags:\n  - project\nstatus: active\n---\n')
  write(path.join(V, 'Work', 'Tasks', 'ok.md'), '---\ntags:\n  - task\nstatus: open\nprojects:\n  - "[[Pf]]"\n---\n')
  write(path.join(V, 'Work', 'Tasks', 'foo.md'),
    '---\ntags:\n  - task\nstatus: open\nprojects:\n  - "[[Pf]]"\nnext_action: Build A2 from the board: the name first\n---\n')
  fs.mkdirSync(path.join(V, 'Work', 'Tasks', 'Archive'), { recursive: true })
  fs.symlinkSync(path.join(S, 'gone.md'), path.join(V, 'Work', 'Tasks', 'Archive', 'foo.md'))  // a moved file
  const scan = spawnSync('python3', [SCAN, '--vault', V, '--today', '2026-10-20', '--deadline', '0'], { encoding: 'utf8', cwd: S, env })
  assert.equal(scan.status, 0, scan.stderr)
  const scanPath = path.join(S, 'scan.json')
  write(scanPath, scan.stdout)
  const sl = spawnSync('python3', [DISPATCH, 'slices', '--scan', scanPath, '--dir', path.join(S, 'slices'), '--tasks', 'ok,foo'],
    { encoding: 'utf8', cwd: S, env })
  assert.equal(sl.status, 0, sl.stderr)
  assert.deepEqual(JSON.parse(sl.stdout).notGradeable, [{ slug: 'foo', why: 'frontmatter does not parse' }])
})
