// Packaging contracts: what Claude Code needs to load this plugin at all, and what the skills promise
// about each other's files. Deterministic and free — the fast floor under the behaviour evals.
//
// The description checks guard a failure that is otherwise silent: over the model-facing skill-listing
// budget, whole descriptions drop out and skills render as bare names, killing natural-language
// triggering (THREAD.md § Known quirks). 1,536 chars is Claude Code's per-description cap; the total is
// a ratchet — lower it when descriptions are trimmed, never raise it to make a test pass.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const DESCRIPTION_CAP = 1536
const DESCRIPTION_TOTAL_RATCHET = 8600

// Minimal frontmatter reader for the shapes this repo uses: `key: plain`, `key: 'single ''quoted'''`,
// `key: "double quoted"`, one line each. Anything else fails loudly rather than parsing wrong.
function frontmatter(text, file) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/)
  assert.ok(m, `${file}: no frontmatter block`)
  const out = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    assert.ok(kv, `${file}: unparseable frontmatter line: ${line}`)
    let v = kv[2]
    if (v.startsWith("'")) {
      assert.ok(v.endsWith("'") && v.length > 1, `${file}: unterminated single-quoted ${kv[1]}`)
      v = v.slice(1, -1).replaceAll("''", "'")
    } else if (v.startsWith('"')) {
      v = JSON.parse(v)
    }
    out[kv[1]] = v
  }
  return out
}

// Every directory under skills/ is a skill except these shared-spec homes — so a skill that loses its
// SKILL.md fails here instead of silently dropping out of the listing.
const NOT_SKILLS = new Set(['_shared'])
const skillDirs = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && !NOT_SKILLS.has(e.name))
  .map((e) => e.name)
  .sort()
for (const d of skillDirs) {
  assert.ok(fs.existsSync(path.join(root, 'skills', d, 'SKILL.md')), `skills/${d}/ has no SKILL.md (a shared dir belongs in NOT_SKILLS)`)
}
const skills = skillDirs.map((d) => ({ dir: d, fm: frontmatter(read(`skills/${d}/SKILL.md`), `skills/${d}/SKILL.md`) }))

test('both manifests carry the same version', () => {
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'))
  const market = JSON.parse(read('.claude-plugin/marketplace.json'))
  const entry = market.plugins.find((p) => p.name === plugin.name)
  assert.ok(entry, `marketplace.json has no "${plugin.name}" entry`)
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/)
  assert.equal(entry.version, plugin.version)
})

test('every skill directory has a SKILL.md whose name is the directory', () => {
  assert.ok(skills.length >= 13, `expected ≥13 skills, found ${skills.length}`)
  for (const { dir, fm } of skills) assert.equal(fm.name, dir, `skills/${dir}: name "${fm.name}"`)
})

test(`each description exists and fits the ${DESCRIPTION_CAP}-char listing cap`, () => {
  for (const { dir, fm } of skills) {
    assert.ok(fm.description && fm.description.length > 40, `skills/${dir}: missing/empty description`)
    assert.ok(fm.description.length <= DESCRIPTION_CAP, `skills/${dir}: description ${fm.description.length} > ${DESCRIPTION_CAP}`)
  }
})

test(`descriptions total ≤ ${DESCRIPTION_TOTAL_RATCHET} chars (ratchet — lower it after trims)`, () => {
  const total = skills.reduce((n, { fm }) => n + fm.description.length, 0)
  assert.ok(total <= DESCRIPTION_TOTAL_RATCHET, `descriptions total ${total} > ${DESCRIPTION_TOTAL_RATCHET}`)
})

test('no skill hides itself from the model (disable-model-invocation)', () => {
  // execute/SKILL.md warns against ever adding it: a hidden member loses natural-language triggering.
  for (const { dir, fm } of skills) assert.ok(!('disable-model-invocation' in fm), `skills/${dir}`)
})

test('hooks.json parses and every hook command targets a file in this plugin', () => {
  const hooks = JSON.parse(read('hooks/hooks.json'))
  const commands = JSON.stringify(hooks).match(/\$\{CLAUDE_PLUGIN_ROOT\}\/[^"\s\\]+/g) || []
  assert.ok(commands.length > 0, 'no ${CLAUDE_PLUGIN_ROOT} hook command found')
  for (const c of commands) {
    const rel = c.replace('${CLAUDE_PLUGIN_ROOT}/', '')
    assert.ok(fs.existsSync(path.join(root, rel)), `hooks.json → missing ${rel}`)
  }
})

test('every ${CLAUDE_PLUGIN_ROOT}/… path the skills and README cite exists', () => {
  const files = ['README.md', ...skillDirs.map((d) => `skills/${d}/SKILL.md`)]
  for (const extra of ['skills/_shared', 'skills/schedule', 'skills/execute']) {
    for (const f of fs.readdirSync(path.join(root, extra))) if (f.endsWith('.md')) files.push(`${extra}/${f}`)
  }
  const missing = []
  for (const f of new Set(files)) {
    for (const ref of read(f).match(/\$\{CLAUDE_PLUGIN_ROOT\}\/[A-Za-z0-9_./<>-]+/g) || []) {
      const rel = ref.replace('${CLAUDE_PLUGIN_ROOT}/', '').replace(/[.)]+$/, '')
      if (rel.includes('<')) continue   // a pattern like skills/<route>/SKILL.md, not a path
      if (!fs.existsSync(path.join(root, rel))) missing.push(`${f} → ${rel}`)
    }
  }
  assert.deepEqual(missing, [])
})
