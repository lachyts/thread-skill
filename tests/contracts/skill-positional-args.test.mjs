// No SKILL.md body may hold a positional parameter: a dollar sign followed by a digit, braced or not.
// When a skill is invoked with arguments, Claude Code substitutes them (whitespace-split, 0-based) into
// every `$0`, `$1`, … across the whole SKILL.md body — shell and awk variables, prose and code fences
// alike — so `print $2` in a snippet renders as an argument word and the model runs a corrupted command
// (2026-09-25, `/thread:close <sentence>`). `make test` extracts snippets from the source files, where
// nothing is substituted, so only this contract sees it. The fix is structural: logic that needs `$N` lives
// in a script under skills/**/scripts/ and the SKILL.md calls it (p5-2); prose writes "30 USD", not a
// dollar-digit amount. Whole body, not code fences only, because the substitution is whole-body too.
// The braced form is banned as well: whether Claude Code substitutes it is undocumented, and a script
// never needs it in a SKILL.md. Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]))
  .sort()

const POSITIONAL = /\$\{?[0-9]/g

// findViolations <text> → ['<line>:<col> <line text>', …]; shared by the real scan and the control case.
function findViolations(text) {
  const out = []
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(POSITIONAL)) out.push(`${i + 1}:${m.index + 1} ${line.trim().slice(0, 120)}`)
  })
  return out
}

const skills = walk('skills').filter((p) => path.basename(p) === 'SKILL.md')

test('the scan finds the skills', () => {
  assert.ok(skills.length >= 13, `expected every skill's SKILL.md, found ${skills.length}`)
})

test('control: the matcher catches shell, awk, braced and prose positionals, and passes the rest', () => {
  const bad = [
    'thr() { awk \'{ print $2 }\' "$1"; }',
    'awk \'NR==1 && $0!="---"{exit}\'',
    'echo "${1}"',
    'needs ~$30 of credits',
  ]
  for (const l of bad) assert.equal(findViolations(l).length > 0, true, `missed: ${l}`)
  const good = [
    'hs="${CLAUDE_PLUGIN_ROOT}/skills/close/scripts/handoff-scan.sh"',
    'slug="${slug:-}" bash "$hs"',
    'awk \'{ print $NF }\'; echo "$@ $# $? $$ $!"',
    'needs 30 USD of credits',
  ]
  for (const l of good) assert.deepEqual(findViolations(l), [], `false positive: ${l}`)
})

for (const p of skills) {
  test(`${p} holds no positional $N (Claude Code substitutes skill arguments into them)`, () => {
    const v = findViolations(fs.readFileSync(path.join(root, p), 'utf8'))
    assert.deepEqual(v, [], `${p}: move the logic into a script under skills/**/scripts/ and call it; ` +
      `in prose write the amount without a dollar-digit pair.\n  ${v.join('\n  ')}`)
  })
}
