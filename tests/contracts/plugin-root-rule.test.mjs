// The plugin-root rule (thread-skill-p19-6): one rule, stated once, cited by every caller. Claude Code
// substitutes `${CLAUDE_PLUGIN_ROOT}` only in the SKILL.md it renders; a plugin file the model reads as a
// file (a sibling SKILL.md a router follows, a `_shared` spec, a SKILL.md read from source with `sed`) keeps
// it literal, and the Bash tool leaves the variable unset, so a command copied from it runs against an empty
// root (`/skills/...`: exit 2 from a guard, 127 from a bare `bash`). Seen 2026-10-03 on next → handoff's
// land snippet. Review e4fe2a2/a0bb12 findings 1 and 6 asked for one rule rather than a per-caller patch
// (the p5-2 per-caller patch was reverted at a ledger STOP), so the rule lives in
// skills/_shared/plugin-root.md and nowhere else, and every file that can send the model into read-as-file
// text, or be run from as one, cites it by path. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readIf, walk, textFiles, fencedBlocks, collapse, skillCount } from '../lib/contract-text.mjs'

const RULE = 'skills/_shared/plugin-root.md'
const CITE = '${CLAUDE_PLUGIN_ROOT}/skills/_shared/plugin-root.md'
// The rule's operative form; only the rule file may hold it, so it is stated once.
const EXPORT = /export CLAUDE_PLUGIN_ROOT=/

// Callers that follow another skill's logic by name, without a `${CLAUDE_PLUGIN_ROOT}/…` path to it.
const NAME_ONLY_CALLERS = {
  'skills/repair/SKILL.md': "follows execute's queue loop from the hand-off and runs its commands",
}

// A plugin markdown file named by its rooted path, other than `self` and the rule itself.
const ROOTED_MD = /\$\{CLAUDE_PLUGIN_ROOT\}\/(skills\/[^\s`)"'|]*\.md)/g
const namesAnother = (text, self) =>
  [...text.matchAll(ROOTED_MD)].map((m) => m[1]).some((p) => p !== self && p !== RULE)

// A runnable plugin-root command: an interpreter run on it, or an assignment from it (`ld="${…}/…"`).
// A bare path (a file to read, a path in a table) is not a command.
const RUNNABLE = /(?:\b(?:python3|bash|sh|node)\s+"?|=\s*"?)\$\{CLAUDE_PLUGIN_ROOT\}/
function runnable(text) {
  const fenced = fencedBlocks(text).flat().filter((l) => RUNNABLE.test(l))
  const inline = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]).filter((s) => RUNNABLE.test(s))
  return [...fenced, ...inline]
}

const mdFiles = walk('skills').filter((p) => p.endsWith('.md') && p !== RULE)
const skills = mdFiles.filter((p) => path.basename(p) === 'SKILL.md')

test('the rule file states where the root comes from, the export, and why not a prefix', () => {
  const t = readIf(RULE)
  assert.ok(t != null, `${RULE} is missing`)
  const c = collapse(t)
  assert.match(c, /last `\/skills\/`/, 'the root is the read file\'s path up to its last /skills/ segment')
  assert.match(c, EXPORT, 'every Bash call that runs read-as-file text exports the root first')
  assert.match(c, /prefix/i, 'it says why a `CLAUDE_PLUGIN_ROOT=<root> cmd` prefix does not work')
  assert.match(c, /every Bash (tool )?call/i, 'the export is per call: shell state does not persist')
  assert.match(c, /re-run/i, 'an empty-root failure is the rule skipped: export and re-run')
  for (const p of ['next', 'open save', 'task-writer.md', 'execution-fit.md', 'sed']) {
    assert.ok(c.includes(p), `the rule names the read-as-file path "${p}"`)
  }
})

test('the rule is stated once: no other plugin file holds its export form', () => {
  const hits = textFiles('skills').filter(({ file, text }) => file !== RULE && EXPORT.test(text)).map((f) => f.file)
  assert.deepEqual(hits, [], 'state the rule in skills/_shared/plugin-root.md only, and cite it')
})

test('control: the detectors catch callers and commands, and pass bare paths', () => {
  assert.equal(namesAnother('see `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` § 1', 'skills/stash/SKILL.md'), true)
  assert.equal(namesAnother('`${CLAUDE_PLUGIN_ROOT}/skills/next/SKILL.md`', 'skills/next/SKILL.md'), false)
  assert.equal(namesAnother(`by \`${CITE}\``, 'skills/next/SKILL.md'), false)
  for (const l of ['python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/resolve-day.py [<day>]',
    'bash "${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/handoff-home.sh"',
    'ld="${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/land.sh"']) {
    assert.equal(runnable('```bash\n' + l + '\n```').length, 1, `missed fenced: ${l}`)
    assert.equal(runnable('run `' + l + '` now').length, 1, `missed inline: ${l}`)
  }
  assert.deepEqual(runnable('```\n${CLAUDE_PLUGIN_ROOT}/skills/execute/task.workflow.js\n```'), [])
  assert.deepEqual(runnable('follow `${CLAUDE_PLUGIN_ROOT}/skills/_shared/task-writer.md` exactly'), [])
})

const callers = skills.filter((p) => namesAnother(readIf(p), p) || p in NAME_ONLY_CALLERS)
const runFrom = mdFiles.filter((p) => runnable(readIf(p)).length > 0)
const citers = [...new Set([...callers, ...runFrom])].sort()

test('non-vacuity: the scan finds the skills, the callers and the read-as-file specs', () => {
  assert.equal(skills.length, skillCount(), `expected every skill's SKILL.md, found ${skills.length}`)
  assert.ok(callers.length >= 9, `only ${callers.length} callers found: ${callers.join(', ')}`)
  for (const p of ['skills/next/SKILL.md', 'skills/open/SKILL.md', 'skills/stash/SKILL.md', 'skills/repair/SKILL.md']) {
    assert.ok(callers.includes(p), `${p} sends the model into read-as-file text and must count as a caller`)
  }
  for (const p of ['skills/_shared/task-writer.md', 'skills/_shared/execution-fit.md',
    'skills/handoff/SKILL.md', 'skills/close/SKILL.md']) {
    assert.ok(runFrom.includes(p), `${p} holds runnable plugin-root commands`)
  }
})

for (const p of citers) {
  test(`${p} cites the plugin-root rule`, () => {
    assert.ok(readIf(p).includes(CITE), `${p} ${callers.includes(p) ? 'sends the model into another plugin file' : 'holds a runnable plugin-root command'}` +
      ` and may be read rather than rendered: cite \`${CITE}\` (state nothing of the rule itself)`)
  })
}
