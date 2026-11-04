// Confirm-step reproductions for review a0edc92/8314ab (finding 1): next-action.py read over a throwaway vault.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { root } from './lib/contract-text.mjs'

const SCRIPT = path.join(root, 'skills', '_shared', 'scripts', 'next-action.py')
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'confirm-read-'))
after(() => fs.rmSync(scratch, { recursive: true, force: true }))
function vault(files) {
  const dir = fs.mkdtempSync(path.join(scratch, 'vault-'))
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}
const rows = (dir, args) => {
  const r = spawnSync('python3', [SCRIPT, '--vault', dir, ...args], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
}
const task = (fm, body = '\n# Note\n') => `---\n${fm}\n---\n${body}`

test('finding 1: a slot linking a note with no frontmatter at all reads live, as it did before', () => {
  const dir = vault({
    'Work/Tasks/plain.md': '# Plain\n\nJust a markdown note.\n',
    'Work/Projects/X.md': task('tags: [project]\nnext_task: "[[plain]]"'),
  })
  assert.deepEqual(rows(dir, ['read', 'X']).map((r) => r.slice(1, 5)), [['X', 'live', 'plain', 'plain']])
})
