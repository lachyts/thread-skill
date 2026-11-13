// ADR 0080 d4: one script changes a repo's merge settings, and its guard is technical, never prose. No agent prompt
// names a call that writes the rulesets or the branch-protection settings (read-only calls, like schedule § 2.5's merge
// gate, stay), and no script but skills/execute/scripts/merge-settings.py makes one; inside it, every write is rendered
// from its one WRITES table by _write_argv, so its undo cannot drift from its write.
//
// A write window is anchored at each logical (backslash-joined) line holding a caller (`gh api`, an "api" list token,
// curl, requests., urllib.request or http.client): that line and the next five. It is a write when it also holds an
// endpoint (`rulesets` or `/protection`) and a write form: -X, --method or --request before PUT, PATCH, POST or DELETE
// (after whitespace, `=`, nothing, or a list's `", "`); a field or body flag (-f, -F, --field, --raw-field, --input,
// curl's -d, --data… or --json, each of which makes gh's call a POST) with no explicit GET in the window;
// requests.put|patch|post|delete(; or method="PUT…".
//   G1 prose: the .md, .js and .mjs files under skills/ and hooks/, CLAUDE.md, CONTEXT.md, THREAD.md, README.md and
//      docs/** hold no write window, but ADR 0025's by-hand lift, its one anchor at line 42 (allowlisted).
//   G2 scripts: every file under skills/*/scripts/ and hooks/ but merge-settings.py holds none.
//   G3 merge-settings.py: one WRITES table holding exactly the classic PATCH and the ruleset PUT; a quoted write method
//      only inside it; --method and --input once each, inside _write_argv; no -X, --request, -f, -F, --field or
//      --raw-field literal; _undo_text and _write render through _write_argv(, and free and restore write through _write(.
// Pure matchers over contract-text's file reads, so the real tree and the controls run through the same code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { read, root, textFiles } from '../lib/contract-text.mjs'

const CALLER = /\bgh\s+api\b|["']api["']|\bcurl\b|\brequests\.|\burllib\.request\b|\bhttp\.client\b/
const ENDPOINT = /rulesets|\/protection/
const METHOD_FORM = /(?:-X|--method|--request)(?:\s+|=|["']\s*,\s*["']|)["']?(?:PUT|PATCH|POST|DELETE)\b/
const FIELD_FORM = /(?:^|[\s"'(,[])(?:-f|-F|--field|--raw-field|--input|-d|--data[\w-]*|--json)(?=[\s"'=,\])]|$)/
const EXPLICIT_GET = /(?:-X|--method|--request)(?:\s+|=|["']\s*,\s*["']|)["']?GET\b/
const REQUESTS_WRITE = /\brequests\.(?:put|patch|post|delete)\(/
const METHOD_KW = /\bmethod\s*=\s*["'](?:PUT|PATCH|POST|DELETE)/

// The logical lines of `text`: a line ending in `\` joins the next; each carries its first physical line number.
export function logicalLines(text) {
  const out = []
  let cur = null
  text.split('\n').forEach((l, i) => {
    if (cur == null) cur = { n: i + 1, text: '' }
    const joined = /\\\s*$/.test(l)
    cur.text += (cur.text ? ' ' : '') + l.replace(/\\\s*$/, '')
    if (!joined) { out.push(cur); cur = null }
  })
  if (cur) out.push(cur)
  return out
}

// The physical line numbers that anchor a write window in `text`.
export function writeAnchors(text) {
  const lines = logicalLines(text)
  const anchors = []
  lines.forEach((l, i) => {
    if (!CALLER.test(l.text)) return
    const win = lines.slice(i, i + 6).map((x) => x.text).join('\n')
    if (!ENDPOINT.test(win)) return
    const field = FIELD_FORM.test(win) && !EXPLICIT_GET.test(win)
    if (METHOD_FORM.test(win) || field || REQUESTS_WRITE.test(win) || METHOD_KW.test(win)) anchors.push(l.n)
  })
  return anchors
}

const ADR25 = 'docs/adr/0025-master-moves-only-by-green-pr-owner-included.md'
const MS = 'skills/execute/scripts/merge-settings.py'
const PROSE_ROOT = ['CLAUDE.md', 'CONTEXT.md', 'THREAD.md', 'README.md']

const proseFiles = () => [
  ...['skills', 'hooks'].flatMap((d) => textFiles(d)).filter(({ file }) => /\.(?:md|js|mjs)$/.test(file)),
  ...PROSE_ROOT.filter((f) => fs.existsSync(path.join(root, f))).map((file) => ({ file, text: read(file) })),
  ...textFiles('docs'),
]
const scriptFiles = () => [
  ...textFiles('skills').filter(({ file }) => /^skills\/[^/]+\/scripts\//.test(file)),
  ...textFiles('hooks'),
].filter(({ file }) => file !== MS)

// G1: the files holding a write window, but ADR 0025's one allowlisted anchor at line 42.
export function proseWrites(files) {
  const out = []
  for (const { file, text } of files) {
    const a = writeAnchors(text)
    if (file === ADR25) {
      if (JSON.stringify(a) !== '[42]') out.push(`${file}: anchors ${JSON.stringify(a)}, not [42]`)
    } else if (a.length) out.push(`${file}: ${a.join(', ')}`)
  }
  return out
}

// G2: the scripts holding a write window.
export const scriptWrites = (files) => files.filter(({ text }) => writeAnchors(text).length).map(({ file }) => file)

// The body of the top-level `def <name>(` in python `text`: up to the next line at column 0 that is not blank.
function defBody(text, name) {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.startsWith(`def ${name}(`))
  if (i < 0) return null
  const j = lines.findIndex((l, k) => k > i && /^\S/.test(l))
  return lines.slice(i, j < 0 ? undefined : j).join('\n')
}

// G3: merge-settings.py's own write discipline, as named failures.
export function msFailures(text) {
  const fails = []
  const tables = text.split('\n').filter((l) => /^WRITES = \{/.test(l))
  // The table: from its `WRITES = {` line through the line that closes it (`)}` at its end).
  const m = text.match(/\nWRITES = \{[^\n]*(?:\n(?!\S)[^\n]*)*?\)\}[ \t]*(?=\n)/)
  const start = m ? m.index : -1
  const end = m ? m.index + m[0].length : -1
  const table = m ? m[0] : ''
  const entries = [...table.matchAll(/"(\w+)":\s*\("(\w+)",\s*"([^"]+)"\)/g)].map((m) => `${m[1]} ${m[2]} ${m[3]}`).sort()
  if (tables.length !== 1 || JSON.stringify(entries) !== JSON.stringify([
    'protection PATCH repos/{repo}/branches/{branch}/protection/required_status_checks', 'ruleset PUT repos/{repo}/rulesets/{id}'])) {
    fails.push('one WRITES table with exactly the classic PATCH and the ruleset PUT')
  }
  const outside = text.slice(0, Math.max(0, start)) + text.slice(Math.max(0, end))
  if (/["'](?:PUT|PATCH|POST|DELETE)["']/.test(outside)) fails.push('a quoted write method outside WRITES')
  const argv = defBody(text, '_write_argv') ?? ''
  for (const flag of ['--method', '--input']) {
    if (text.split(flag).length !== 2 || argv.split(flag).length !== 2) fails.push(`${flag} once, inside _write_argv`)
  }
  if (/["'](?:-X|--request|-f|-F|--field|--raw-field)["']|(?<![\w-])(?:-X|-F|-f)(?![\w-])|--request\b|--raw-field\b|--field\b/.test(text)) {
    fails.push('a -X, --request, -f, -F, --field or --raw-field literal')
  }
  for (const fn of ['_undo_text', '_write']) {
    if (!(defBody(text, fn) ?? '').includes('_write_argv(')) fails.push(`${fn} renders through _write_argv(`)
  }
  for (const fn of ['cmd_restore', '_free_locked']) {
    if (!(defBody(text, fn) ?? '').includes('_write(')) fails.push(`${fn} writes through _write(`)
  }
  return fails
}

test('G1: no prose names a call that writes the rulesets or the branch-protection settings (ADR 0025:42 allowlisted)', () => {
  assert.deepEqual(proseWrites(proseFiles()), [])
})

test('G2: no script but merge-settings.py makes a call that writes them', () => {
  assert.deepEqual(scriptWrites(scriptFiles()), [])
})

test('G3: merge-settings.py renders every write and its undo from its one WRITES table', () => {
  assert.deepEqual(msFailures(read(MS)), [])
})

// ---- controls ------------------------------------------------------------------------------------------------------

test('controls: every write form is a write window', () => {
  const ep = 'repos/o/r/rulesets/1'
  for (const [label, text] of [
    ['-X PUT', `gh api -X PUT ${ep}`],
    ['-XPUT', `gh api -XPUT ${ep}`],
    ['--method=PATCH', 'gh api --method=PATCH repos/o/r/branches/m/protection/required_status_checks'],
    ['list-form argv', `subprocess.run(["gh", "api", "--method", "PUT", "${ep}"])`],
    ['-f with no method', `gh api ${ep} -f x=y`],
    ['--raw-field', `gh api ${ep} --raw-field enforcement=disabled`],
    ['-F', `gh api ${ep} -F n=1`],
    ['--input -', `printf '{}' | gh api ${ep} --input -`],
    ['a two-line backslash call', `gh api \\\n  -X PUT \\\n  ${ep}`],
    ['curl -X DELETE', 'curl -X DELETE https://api.github.com/repos/o/r/branches/m/protection'],
    ['requests.put', `requests.put("https://api.github.com/${ep}", json={})`],
  ]) assert.notDeepEqual(writeAnchors(text), [], label)
})

test('controls: a read is no write window', () => {
  for (const [label, text] of [
    ['a bare GET', 'gh api repos/o/r/rulesets/1'],
    ['-X GET with -f', 'gh api -X GET repos/o/r/rules/branches/m -f per_page=100'],
    ["merge-gate's reads", `argv = [gh_bin, "api", "-i", "-H", "Accept: application/vnd.github+json", endpoint]\nrules/branches`],
    ["merge-task's rules read", 'gate_read "$tmp/gate-rules.json" "repos/$OWNER/$REPO/rules/branches/$enc?per_page=100"'],
    ["merge-task's probe reads", 'gh api "repos/$OWNER/$REPO/commits/$IHEAD/check-runs?per_page=100"\ngh api "repos/$OWNER/$REPO/commits/$IHEAD/status?per_page=100"'],
    ["merge-task's head-branch DELETE", 'gh api --method DELETE "repos/$OWNER/$REPO/git/refs/heads/$br"'],
    ["merge-task's graphql -f", "gh api graphql -f query='query{x}' -f o=\"$OWNER\" -F n=\"$PR\""],
    ["THREAD.md's update-branch PUT", 'gh api -X PUT repos/o/r/pulls/7/update-branch'],
    ['prose', 'Lift the branch protection by hand, then restore it.'],
  ]) assert.deepEqual(writeAnchors(text), [], label)
})

test('controls: G1 flags a prose write and an ADR 0025 with a second anchor; G2 flags a script write', () => {
  assert.deepEqual(proseWrites([{ file: 'skills/x/SKILL.md', text: 'Run `gh api -X PUT repos/o/r/rulesets/1`.' }]), ['skills/x/SKILL.md: 1'])
  const adr = read(ADR25)
  assert.deepEqual(proseWrites([{ file: ADR25, text: adr }]), [])
  assert.equal(proseWrites([{ file: ADR25, text: `${adr}\n\`gh api --method PATCH repos/o/r/branches/m/protection\`\n` }]).length, 1)
  assert.deepEqual(scriptWrites([{ file: 'skills/x/scripts/y.sh', text: 'gh api repos/o/r/rulesets/1 --input - <<< "$b"' }]), ['skills/x/scripts/y.sh'])
})

test('controls: G3 fails a second template, a DELETE in the table, a -f literal and an undo that skips _write_argv', () => {
  const real = read(MS)
  const plant = (from, to) => { assert.ok(real.includes(from), from); return real.replace(from, to) }
  const stray = plant('def _canon(body):', 'STRAY = "gh api --method PUT repos/{repo}/rulesets/{id} --input -"\n\n\ndef _canon(body):')
  assert.ok(msFailures(stray).includes('--method once, inside _write_argv'), 'a second template string')
  assert.ok(msFailures(plant('"ruleset": ("PUT", "repos/{repo}/rulesets/{id}")}', '"ruleset": ("PUT", "repos/{repo}/rulesets/{id}"),\n          "drop": ("DELETE", "repos/{repo}/rulesets/{id}")}'))
    .includes('one WRITES table with exactly the classic PATCH and the ruleset PUT'), 'a DELETE in the table')
  assert.ok(msFailures(plant('def _canon(body):', 'FLAG = "-f"\n\n\ndef _canon(body):'))
    .includes('a -X, --request, -f, -F, --field or --raw-field literal'), 'a "-f" literal')
  const undo = defBody(real, '_undo_text')
  assert.ok(msFailures(real.replace(undo, 'def _undo_text(source, before, **where):\n    return "gh api"\n'))
    .includes('_undo_text renders through _write_argv('), 'an undo with no _write_argv(')
})
