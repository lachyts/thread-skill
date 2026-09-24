// Behaviour-eval suite shape: what `claude plugin eval .` (run by a human via `make evals`) will load
// from evals/, checked here for free and without ever running it. Scored runs make real model calls, so
// this file also proves that neither `make test` nor a bare `make` can reach the `evals` target.
//
// Read-only: no fs writes and no child processes (tests/run.sh fails a run that changes the checkout).
// The validators are pure functions over { relPath: text }, so the controls below feed them in-memory
// suites and Makefiles. The loaders run only inside test() bodies and never throw, so a missing evals/
// is one named error, not a dead file.
//
// The frontmatter reader is a strict subset of YAML: every value it returns is one the CLI's YAML
// parser would type the same way, and anything outside the subset fails loudly with an (fm) error.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

// ---------------------------------------------------------------------------------------------------
// Constants

const PROMPT_KEYS = new Set(['description', 'tags', 'runs', 'expected_outcome', 'max_turns', 'timeout_seconds', 'allowed_tools'])
const ALLOWED_TOOLS = new Set(['Read', 'Glob', 'Grep', 'Skill'])
const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch']
const MCP_PREFIX = 'mcp__'
const GRADER_KEYS = {
  regex: new Set(['type', 'pattern', 'flags', 'match', 'target', 'weight', 'arm']),
  tool_used: new Set(['type', 'tool', 'input_match', 'min', 'max', 'weight', 'arm']),
  llm: new Set(['type', 'focus', 'weight', 'arm']),
}
const ARMS = new Set(['with-only', 'both'])
const TARGETS = new Set(['last_message', 'trace'])
const FORBIDDEN_FLAGS = ['--allow-tools', '--scaffold', '--mocks', '--allow-real-servers', '--trust-plugin']
const HOME_MARKERS = ['/Users/', '/home/', '~/', 'repos/obsidian', 'repos/workspaces', /\$\{?HOME\b/]
const NUMERIC_LIKE = [/^[-+]?(\d|\.\d)/, /^[-+]?\.(inf|nan)$/i]
const KEYWORDS = /^(true|false|null|~|yes|no|on|off|y|n)$/i
const looksNumeric = (s) => NUMERIC_LIKE.some((re) => re.test(s))

// ---------------------------------------------------------------------------------------------------
// Frontmatter reader

const fmError = (file, what) => new Error(`${file}: (fm) ${what}`)

// Why a plain (unquoted) scalar would not read back as this exact string under YAML, or null if it would.
function plainScalarError(s) {
  if (/^[{}[\],&*!|>%@`'"#]/.test(s)) return `starts with the YAML indicator ${s[0]}`
  if (/^[-?:]( |$)/.test(s)) return `starts with the YAML indicator "${s[0]}"`
  if (s.includes(': ')) return 'contains ": " (YAML would read a mapping)'
  if (s.includes(' #')) return 'contains " #" (YAML would read a comment)'
  if (s.endsWith(':')) return 'ends with ":" (YAML would read a mapping)'
  if (KEYWORDS.test(s)) return `${s} is a YAML keyword; quote it`
  return null
}

function readValue(raw, key, file) {
  if (raw.startsWith("'")) {
    const m = raw.match(/^'((?:[^']|'')*)'$/)
    if (!m) throw fmError(file, `${key}: unterminated single-quoted value or text after the closing quote`)
    return { kind: 'single', value: m[1].replaceAll("''", "'") }
  }
  if (raw.startsWith('"')) {
    let v
    try { v = JSON.parse(raw) } catch { throw fmError(file, `${key}: malformed double-quoted value or text after the closing quote`) }
    return { kind: 'double', value: v }
  }
  if (raw.startsWith('[')) {
    if (!raw.endsWith(']')) throw fmError(file, `${key}: unterminated flow list`)
    const inner = raw.slice(1, -1)
    if (inner.trim() === '') return { kind: 'list', value: [] }
    const items = inner.split(',').map((x) => x.trim())
    for (const item of items) {
      if (item === '') throw fmError(file, `${key}: flow list has an empty item`)
      if (/[[\]{},:#'"]/.test(item)) throw fmError(file, `${key}: list item ${item} holds a YAML indicator`)
      if (looksNumeric(item)) throw fmError(file, `${key}: list item ${item} looks numeric; YAML would not read it as a string`)
      const why = plainScalarError(item)
      if (why) throw fmError(file, `${key}: list item ${why}`)
    }
    return { kind: 'list', value: items }
  }
  const why = plainScalarError(raw)
  if (why) throw fmError(file, `${key}: value ${why}`)
  return { kind: 'plain', value: raw }
}

// Returns { fm: Map<key, {kind, value}>, body }, or throws an Error whose message starts `${file}: (fm)`.
function readFrontmatter(text, file) {
  if (text.includes('\r')) throw fmError(file, 'CRLF line endings (use LF)')
  if (text.startsWith('\uFEFF')) throw fmError(file, 'starts with a byte-order mark')
  const lines = text.split('\n')
  if (lines[0] !== '---') throw fmError(file, 'first line is not ---')
  const close = lines.indexOf('---', 1)
  if (close === -1) throw fmError(file, 'no closing --- line')
  const fm = new Map()
  for (const line of lines.slice(1, close)) {
    if (line.includes('\t')) throw fmError(file, `tab in frontmatter line: ${line}`)
    const m = line.match(/^([a-z][a-z0-9_]*):[ ]+(\S.*?)\s*$/)
    if (!m) throw fmError(file, `unparseable frontmatter line (only one-line "key: value" is read): ${JSON.stringify(line)}`)
    if (fm.has(m[1])) throw fmError(file, `duplicate key ${m[1]}`)
    fm.set(m[1], readValue(m[2], m[1], file))
  }
  return { fm, body: lines.slice(close + 1).join('\n') }
}

// ---------------------------------------------------------------------------------------------------
// Typed accessors: each returns { value } (value undefined when the key is absent) or { error }.

const typeError = (file, what) => ({ error: `${file}: (type) ${what}` })

function str(fm, key, file) {
  const e = fm.get(key)
  if (!e) return { value: undefined }
  if (e.kind === 'list') return typeError(file, `${key} must be a string, not a list`)
  if (e.kind === 'plain' && looksNumeric(e.value)) return typeError(file, `${key} ${e.value} looks numeric; quote it`)
  return { value: e.value }
}

function int(fm, key, file) {
  const e = fm.get(key)
  if (!e) return { value: undefined }
  if (e.kind !== 'plain' || !/^(0|[1-9]\d*)$/.test(e.value)) return typeError(file, `${key} must be an unquoted non-negative integer`)
  return { value: Number(e.value) }
}

function weight(fm, key, file) {
  const e = fm.get(key)
  if (!e) return { value: undefined }
  if (e.kind !== 'plain' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(e.value)) return typeError(file, `${key} must be an unquoted decimal number`)
  const n = Number(e.value)
  if (!(n > 0)) return typeError(file, `${key} must be > 0`)
  return { value: n }
}

function list(fm, key, file) {
  const e = fm.get(key)
  if (!e) return { value: undefined }
  if (e.kind !== 'list') return typeError(file, `${key} must be a flow list [a, b]`)
  return { value: e.value }
}

// ---------------------------------------------------------------------------------------------------
// Pure validators. None throws: every failure is pushed as `${file}: (${rule}) ${what}`.

function reporter(errors) {
  const err = (file, rule, what) => errors.push(`${file}: (${rule}) ${what}`)
  // Unwraps an accessor result, recording its (type) error.
  const take = (r) => { if (r.error) { errors.push(r.error); return undefined } return r.value }
  return { err, take }
}

const isMock = (p) => p.startsWith('evals/mocks/')
const dirOf = (p) => p.slice(0, p.lastIndexOf('/'))
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1)

function checkDiscovery(files, errors) {
  const { err } = reporter(errors)
  const paths = Object.keys(files)
  const cases = []
  for (const p of paths) {
    if (baseOf(p) !== 'prompt.md' || isMock(p)) continue
    if (dirOf(p) === 'evals') { err(p, 'a', 'a prompt.md at the evals/ root is not a case; put it in its own directory'); continue }
    cases.push(dirOf(p))
  }
  cases.sort()
  if (cases.length < 1) err('evals/', 'a', 'no cases: no directory under evals/ holds a prompt.md')
  for (const a of cases) for (const b of cases) {
    if (b.startsWith(a + '/')) err(`${b}/prompt.md`, 'a', `case nested inside the case ${a}`)
  }
  const byName = new Map()
  for (const c of cases) byName.set(baseOf(c), [...(byName.get(baseOf(c)) || []), c])
  for (const [name, dirs] of byName) {
    if (dirs.length > 1) err(`${dirs[1]}/prompt.md`, 'a', `duplicate case name ${name}: ${dirs.join(' and ')}`)
  }
  // An orphan grader is a file directly in a graders/ directory that no case contains. Keying on the
  // direct parent (not the first `graders` segment) keeps a group directory named graders legal.
  for (const p of paths) {
    if (baseOf(p) === 'case.yaml') err(p, 'a', 'case.yaml is not used by this suite (fixtures go inline in the prompt)')
    if (isMock(p)) continue
    const dir = dirOf(p)
    if (baseOf(dir) === 'graders' && !cases.some((c) => p.startsWith(c + '/'))) {
      err(p, 'a', `orphan grader: ${dirOf(dir)}/ has no prompt.md, so this is never checked or run`)
    }
  }
  return cases
}

function checkPrompt(file, text, errors) {
  const { err, take } = reporter(errors)
  if (text.includes('TODO:')) err(file, 'b', 'contains "TODO:" (a template placeholder the CLI rejects)')
  let parsed
  try { parsed = readFrontmatter(text, file) } catch (e) { errors.push(e.message); return }
  const { fm, body } = parsed
  for (const k of fm.keys()) if (!PROMPT_KEYS.has(k)) err(file, 'b', `unknown key ${k} (allowed: ${[...PROMPT_KEYS].join(', ')})`)
  if (!fm.has('description')) err(file, 'b', 'description is missing')
  else {
    const d = take(str(fm, 'description', file))
    if (d !== undefined && d.trim() === '') err(file, 'b', 'description is empty')
  }
  take(str(fm, 'expected_outcome', file))
  take(list(fm, 'tags', file))
  if (body.trim() === '') err(file, 'b', 'the prompt body is empty')
  else if (body.trim().startsWith('/')) err(file, 'b', 'the prompt body starts with "/" (a slash command skips routing)')
  for (const [key, lo, hi] of [['runs', 1, 3], ['max_turns', 1, 200], ['timeout_seconds', 1, 3600]]) {
    const v = take(int(fm, key, file))
    if (v !== undefined && (v < lo || v > hi)) err(file, 'c', `${key} ${v} is outside ${lo}-${hi}`)
  }
  if (!fm.has('allowed_tools')) { err(file, 'd', 'allowed_tools is missing (it must list Skill)'); return undefined }
  const tools = take(list(fm, 'allowed_tools', file))
  if (tools === undefined) return undefined
  const before = errors.length
  for (const t of tools) {
    if (WRITE_TOOLS.includes(t) || t.startsWith(MCP_PREFIX)) err(file, 'd', `allowed_tools lists ${t} (write/network-capable tools are never granted)`)
    else if (!ALLOWED_TOOLS.has(t)) err(file, 'd', `allowed_tools lists unknown tool ${t} (allowed: ${[...ALLOWED_TOOLS].join(', ')})`)
  }
  if (!tools.includes('Skill')) err(file, 'd', 'allowed_tools is missing Skill')
  // The grant graders are checked against; a bad grant is already a (d) error, so it grants nothing
  // here rather than cascading an (e) error onto every grader.
  return errors.length === before ? tools : undefined
}

function compiles(p, flags) {
  try { new RegExp(p, flags); return true } catch { return false }
}

// `granted` is the case's parsed allowed_tools, or undefined when the grant is itself an error.
function checkGrader(file, text, errors, granted) {
  const { err, take } = reporter(errors)
  if (text.includes('TODO:')) err(file, 'e', 'contains "TODO:"')
  if (text.split('\n')[0].replace(/\r$/, '') !== '---') { err(file, 'e', 'no frontmatter, the CLI would silently skip this grader'); return null }
  let parsed
  try { parsed = readFrontmatter(text, file) } catch (e) { errors.push(e.message); return null }
  const { fm, body } = parsed
  const type = take(str(fm, 'type', file))
  if (!fm.has('type')) { err(file, 'e', 'type is missing'); return null }
  if (type === undefined) return null
  if (!GRADER_KEYS[type]) { err(file, 'e', `type ${type} is not one of ${Object.keys(GRADER_KEYS).join(', ')}`); return null }
  for (const k of fm.keys()) if (!GRADER_KEYS[type].has(k)) err(file, 'e', `key ${k} is not allowed for type ${type}`)
  take(weight(fm, 'weight', file))
  const arm = take(str(fm, 'arm', file))
  if (arm !== undefined && !ARMS.has(arm)) err(file, 'e', `arm ${arm} is not one of ${[...ARMS].join(', ')}`)
  for (const k of ['target', 'focus']) {
    const v = take(str(fm, k, file))
    if (v !== undefined && !TARGETS.has(v)) err(file, 'e', `${k} ${v} is not one of ${[...TARGETS].join(', ')}`)
  }
  let flags = take(str(fm, 'flags', file))
  if (flags !== undefined && !/^[dgimsuvy]*$/.test(flags)) { err(file, 'e', `flags ${flags} holds a non-RegExp flag`); flags = undefined }
  const match = take(str(fm, 'match', file))
  if (match !== undefined && !/^(contains|not_contains|count:(0|[1-9]\d*))$/.test(match)) err(file, 'e', `match ${match} is not contains, not_contains or count:N`)
  const min = take(int(fm, 'min', file))
  const max = take(int(fm, 'max', file))
  if (min !== undefined && max !== undefined && min > max) err(file, 'e', `min ${min} is greater than max ${max}`)
  const tool = take(str(fm, 'tool', file))
  if (type === 'tool_used' && !fm.has('tool')) err(file, 'e', 'a tool_used grader needs tool')
  // A tool the case never grants (or a misspelling such as `skill`) can never fire, so a max: 0 grader
  // would pass every run without testing anything.
  if (type === 'tool_used' && tool !== undefined && granted !== undefined && !granted.includes(tool)) {
    err(file, 'e', `tool ${tool} is not granted by this case's allowed_tools; the grader can never fire`)
  }
  const pattern = take(str(fm, 'pattern', file))
  if (pattern !== undefined && !compiles(pattern, flags || '')) err(file, 'e', `pattern does not compile as a RegExp with flags "${flags || ''}"`)
  const inputMatch = take(str(fm, 'input_match', file))
  if (inputMatch !== undefined && !compiles(inputMatch, '')) err(file, 'e', 'input_match does not compile as a RegExp')
  const b = body.trim()
  if (type === 'llm' && b === '') err(file, 'e', 'an llm grader needs a rubric body')
  if (type === 'regex') {
    if (fm.has('pattern') === (b !== '')) err(file, 'e', 'a regex grader needs its pattern in exactly one of the frontmatter or the body')
    else if (b !== '' && !compiles(b, flags || '')) err(file, 'e', `the body pattern does not compile as a RegExp with flags "${flags || ''}"`)
  }
  if (type === 'tool_used' && b !== '') err(file, 'e', 'a tool_used grader has an empty body')
  return { type, tool, arm, inputMatch, inputMatchOk: inputMatch !== undefined && compiles(inputMatch, '') }
}

function checkSkillGrader(file, g, skills, errors) {
  const { err } = reporter(errors)
  if (!g || g.type !== 'tool_used' || g.tool !== 'Skill') return
  if (g.arm !== 'both') err(file, 'f', 'a Skill grader must set arm: both (otherwise the two-arm score drops it)')
  if (g.inputMatch === undefined) { err(file, 'f', 'a Skill grader needs an input_match naming one skill'); return }
  if (!g.inputMatchOk) return
  const re = new RegExp(g.inputMatch)
  const hits = skills.map((d) => ({ d, ns: re.test(JSON.stringify({ skill: 'thread:' + d })), bare: re.test(JSON.stringify({ skill: d })) }))
    .filter((h) => h.ns || h.bare)
  if (hits.length === 0) err(file, 'f', 'input_match matches no skill under skills/')
  else if (hits.length > 1) err(file, 'f', `input_match is ambiguous: it matches ${hits.map((h) => h.d).join(', ')}`)
  else if (!hits[0].ns || !hits[0].bare) err(file, 'f', `input_match matches only one of thread:${hits[0].d} and ${hits[0].d}`)
}

function checkPaths(files, errors) {
  const { err } = reporter(errors)
  for (const [p, text] of Object.entries(files)) {
    for (const m of HOME_MARKERS) {
      const hit = typeof m === 'string' ? text.includes(m) : m.test(text)
      if (hit) err(p, 'g', `contains a real home or vault path (${m})`)
    }
  }
}

function validateSuite(input, skills) {
  const errors = []
  const { err } = reporter(errors)
  const files = Object.fromEntries(Object.entries(input).filter(([p]) => !p.startsWith('evals/results/')))
  const cases = checkDiscovery(files, errors)
  for (const c of cases) {
    const graders = []
    for (const p of Object.keys(files).sort()) {
      if (!p.startsWith(c + '/')) continue
      const rel = p.slice(c.length + 1)
      if (rel === 'prompt.md') continue
      if (rel.startsWith('graders/')) {
        const rest = rel.slice('graders/'.length)
        if (rest.includes('/')) err(p, 'e', 'graders/ holds a subdirectory; each grader is a direct .md file')
        else if (!rest.endsWith('.md')) err(p, 'e', 'not a .md file (the CLI reads only .md graders)')
        else graders.push(p)
        continue
      }
      err(p, 'a', 'a case directory holds only prompt.md and graders/')
    }
    const granted = checkPrompt(`${c}/prompt.md`, files[`${c}/prompt.md`], errors)
    if (graders.length === 0) err(`${c}/graders/`, 'e', 'the case has no .md graders')
    for (const g of graders) checkSkillGrader(g, checkGrader(g, files[g], errors, granted), skills, errors)
  }
  checkPaths(files, errors)
  return errors
}

// --- Makefile: a subset parser that fails closed on anything it can't see through.

const MAKE_DIRECTIVES = new Set(['define', 'endef', 'undefine', 'ifeq', 'ifneq', 'ifdef', 'ifndef', 'else', 'endif',
  'include', '-include', 'sinclude', 'export', 'unexport', 'override', 'private', 'vpath', 'load'])
const AUTOMATIC_VARS = new Set(['@', '<', '^', '?', '*', '+', '|', '%'])
const REACHES_EVALS = [/claude/i, /\bevals\b/, /\bmake\b/]

// Expands $(NAME) / ${NAME} through the assignments; `$$` is kept. $(MAKE) becomes "make". Anything it
// cannot resolve (unknown names, function calls, cycles) is pushed onto `unresolved`.
function expandMake(s, vars, unresolved, seen = new Set()) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '$') { out += s[i]; continue }
    const n = s[i + 1]
    if (n === '$') { out += '$$'; i++; continue }
    if (n === '(' || n === '{') {
      const close = n === '(' ? ')' : '}'
      let depth = 0, j = i + 1
      for (; j < s.length; j++) {
        if (s[j] === n) depth++
        else if (s[j] === close && --depth === 0) break
      }
      if (j >= s.length) { unresolved.push(s.slice(i)); return out }
      const inner = s.slice(i + 2, j)
      if (inner === 'MAKE') out += 'make'
      else if (!/^[A-Za-z_.][\w.-]*$/.test(inner)) { unresolved.push(`$(${inner})`); out += s.slice(i, j + 1) }
      else if (seen.has(inner)) unresolved.push(`$(${inner}) (a cycle)`)
      else if (vars.has(inner)) out += expandMake(vars.get(inner), vars, unresolved, new Set([...seen, inner]))
      else unresolved.push(`$(${inner})`)
      i = j
      continue
    }
    if (n !== undefined && AUTOMATIC_VARS.has(n)) { out += '$' + n; i++; continue }
    unresolved.push(`$${n ?? ''}`)
    i++
  }
  return out
}

function checkMakefile(text, file = 'Makefile') {
  const errors = []
  const err = (what) => errors.push(`${file}: (h) ${what}`)
  // Logical lines: backslash continuations joined first.
  const phys = text.split('\n')
  const logical = []
  for (let i = 0; i < phys.length; i++) {
    const no = i + 1
    let line = phys[i]
    while (line.endsWith('\\') && i + 1 < phys.length) line = line.slice(0, -1) + ' ' + phys[++i].replace(/^\t/, '')
    logical.push({ no, line })
  }
  const vars = new Map()
  const rules = new Map()   // target -> { prereqs: [], recipes: [] }
  const order = []          // each rule's targets, in file order
  const parseTimeShell = [] // `!=` values and $(shell ...) in assignments: they run for every goal
  const recipeShell = []    // every SHELL / .SHELLFLAGS value: they wrap every recipe on the test path
  let current = null
  for (const { no, line: raw } of logical) {
    if (raw.startsWith('\t')) {
      if (!current) err(`line ${no}: a tab-led recipe line with no current rule`)
      else for (const r of current) r.recipes.push(raw.slice(1))
      continue
    }
    if (raw.trim() === '' || raw.startsWith('#')) continue
    if (raw.startsWith(' ')) { err(`line ${no}: a space-led line (recipes start with a tab)`); continue }
    if (raw.includes('\\#')) { err(`line ${no}: an escaped \\# is not supported`); continue }
    const line = raw.replace(/#.*$/, '').trimEnd()
    if (line === '') continue
    if (line.startsWith('$(') || line.startsWith('${')) { err(`line ${no}: a column-0 $( or \${ line (e.g. $(eval ...)) can create rules this check cannot see`); continue }
    const word = line.split(/\s+/)[0]
    if (MAKE_DIRECTIVES.has(word)) { err(`line ${no}: the directive ${word} is not supported`); current = null; continue }
    const a = line.match(/^([A-Za-z_.][\w.-]*)\s*(:::=|::=|:=|\?=|\+=|!=|=)\s*(.*)$/)
    if (a) {
      const [, name, op, value] = a
      current = null
      if (name === '.DEFAULT_GOAL') { err('.DEFAULT_GOAL is set; the default goal must stay test'); continue }
      if (name === '.RECIPEPREFIX') { err(`line ${no}: .RECIPEPREFIX is not supported`); continue }
      if (op === '!=') parseTimeShell.push(value)
      if (/\$[({]shell\b/.test(value)) parseTimeShell.push(value)
      if (name === 'SHELL' || name === '.SHELLFLAGS') recipeShell.push({ name, value })
      if (op === '+=') vars.set(name, vars.has(name) ? `${vars.get(name)} ${value}` : value)
      else if (op === '?=') { if (!vars.has(name)) vars.set(name, value) } else vars.set(name, value)
      continue
    }
    const colon = line.indexOf(':')
    if (colon <= 0) { err(`line ${no}: unparseable line: ${line}`); current = null; continue }
    const targets = line.slice(0, colon).trim().split(/\s+/)
    let rest = line.slice(colon + 1)
    if (rest.startsWith(':')) rest = rest.slice(1)
    const semi = rest.indexOf(';')
    const inline = semi === -1 ? null : rest.slice(semi + 1).trim()
    const prereqText = semi === -1 ? rest : rest.slice(0, semi)
    if (targets.some((t) => t.includes('&'))) { err(`line ${no}: grouped targets (&:) are not supported`); current = null; continue }
    if (targets.some((t) => t.includes('%'))) { err(`line ${no}: pattern rules are not supported`); current = null; continue }
    if (targets.some((t) => t.includes('$'))) { err(`line ${no}: computed targets are not supported`); current = null; continue }
    if (targets.includes('.DEFAULT')) { err(`line ${no}: .DEFAULT is not supported`); current = null; continue }
    if (prereqText.includes('=')) { err(`line ${no}: target-specific variables are not supported`); current = null; continue }
    if (prereqText.includes(':')) { err(`line ${no}: a second ":" (a static pattern rule) is not supported`); current = null; continue }
    if (prereqText.includes('$')) { err(`line ${no}: computed prerequisites are not supported`); current = null; continue }
    const prereqs = prereqText.split(/\s+/).filter((x) => x && x !== '|')
    current = targets.map((t) => {
      if (!rules.has(t)) rules.set(t, { prereqs: [], recipes: [] })
      const r = rules.get(t)
      r.prereqs.push(...prereqs)
      if (inline) r.recipes.push(inline)
      return r
    })
    order.push(targets)
  }

  // A bare `make` runs the first target of the first rule whose first target doesn't start with '.'.
  const goal = order.find((ts) => !ts[0].startsWith('.'))
  if (!goal) err('no default goal')
  else if (goal[0] !== 'test') err(`default goal is ${goal[0]}, not test; a bare make must never reach evals`)

  for (const v of parseTimeShell) {
    const u = []
    const x = expandMake(v, vars, u)
    if (REACHES_EVALS.some((re) => re.test(x))) err(`a parse-time shell assignment (${v}) mentions claude, evals or make; it runs for every goal`)
  }
  // Each assignment is checked, not just the last: a `:=` is expanded where it stands, so an earlier
  // value can still be the one a recipe runs under.
  for (const { name, value } of recipeShell) {
    const u = []
    const x = expandMake(value, vars, u)
    for (const r of u) err(`${name} references ${r}, which this check cannot resolve`)
    if (REACHES_EVALS.some((re) => re.test(x))) err(`${name} (${value}) mentions claude, evals or make; it wraps every recipe make test runs`)
  }

  // Walk everything `make test` can reach.
  const seen = new Set()
  const walk = (t, via) => {
    if (seen.has(t)) return
    seen.add(t)
    if (t === 'evals') { err(`test reaches evals (via ${via.join(' -> ')})`); return }
    const r = rules.get(t)
    if (!r) { err(`${t} (reached from test via ${via.join(' -> ')}) has no rule`); return }
    for (const line of r.recipes) {
      const unresolved = []
      const x = expandMake(line, vars, unresolved)
      for (const u of unresolved) err(`the ${t} recipe (reached from test) references ${u}, which this check cannot resolve`)
      if (REACHES_EVALS.some((re) => re.test(x))) err(`the ${t} recipe (reached from test) mentions claude, evals or make: ${x}`)
    }
    for (const p of r.prereqs) walk(p, [...via, p])
  }
  walk('test', ['test'])

  const phony = rules.get('.PHONY')?.prereqs || []
  if (!phony.includes('evals')) err('.PHONY lacks evals')
  const ev = rules.get('evals')
  if (!ev) { err('no evals rule'); return errors }
  const unresolved = []
  const recipe = ev.recipes.map((l) => expandMake(l, vars, unresolved)).join('\n')
  for (const u of unresolved) err(`the evals recipe references ${u}, which this check cannot resolve`)
  if (!recipe.includes('claude plugin eval')) err('the evals recipe does not run claude plugin eval')
  if (!ev.recipes.some((l) => /claude plugin eval \.\s+\$(\(EVAL_ARGS\)|\{EVAL_ARGS\})/.test(l))) err('no evals recipe line runs claude plugin eval . $(EVAL_ARGS)')
  let args = ''
  if (!vars.has('EVAL_ARGS')) err('EVAL_ARGS is not assigned')
  else {
    const u = []
    args = expandMake(vars.get('EVAL_ARGS'), vars, u)
    for (const x of u) err(`EVAL_ARGS references ${x}, which this check cannot resolve`)
    if (!/(^|\s)--ablation none(\s|$)/.test(args)) err('EVAL_ARGS lacks --ablation none')
    if (!/(^|\s)--no-publish(\s|$)/.test(args)) err('EVAL_ARGS lacks --no-publish')
    if (!/(^|\s)--max-cost-usd \d+(\.\d+)?(\s|$)/.test(args)) err('EVAL_ARGS lacks --max-cost-usd <number>')
    if (!/(^|\s)--runs [123](\s|$)/.test(args)) err('EVAL_ARGS lacks --runs 1|2|3')
  }
  for (const f of FORBIDDEN_FLAGS) if (`${recipe} ${args}`.includes(f)) err(`the evals recipe or EVAL_ARGS passes ${f}`)
  return errors
}

// The literal strings, plus the spellings they miss: `claude  plugin`, and any line that names make
// ($MAKE, ${MAKE} and $(MAKE) included) together with evals (`make -C . evals`, `make X=y evals`).
const RUNSH_MAKE = /\bmake\b|\$\{?MAKE\b|\$\(MAKE\)/
function checkRunSh(text, file = 'tests/run.sh') {
  const errors = []
  for (const s of ['claude plugin', 'make evals']) if (text.includes(s)) errors.push(`${file}: (h) mentions "${s}"; make test must never run the evals`)
  if (/\bclaude\s+plugin\b/.test(text)) errors.push(`${file}: (h) runs claude plugin; make test must never run the evals`)
  text.split('\n').forEach((line, i) => {
    if (RUNSH_MAKE.test(line) && /\bevals\b/.test(line)) errors.push(`${file}: (h) line ${i + 1} names make and evals; make test must never run the evals`)
  })
  return errors
}

function checkGitignore(text, file = '.gitignore') {
  return text.split('\n').includes('evals/results/') ? [] : [`${file}: (i) no line is exactly evals/results/`]
}

// ---------------------------------------------------------------------------------------------------
// Loaders (called only inside test bodies; never throw).

function loadEvalFiles(base) {
  const files = {}
  const errors = []
  try {
    let st
    try { st = fs.lstatSync(path.join(base, 'evals')) } catch { return { files, errors: ['evals/: (a) evals/ is missing'] } }
    if (!st.isDirectory()) return { files, errors: ['evals/: (a) evals/ is not a directory'] }
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(base, rel), { withFileTypes: true })) {
        if (e.name === '.DS_Store') continue
        const p = `${rel}/${e.name}`
        if (p === 'evals/results') continue
        if (e.isSymbolicLink()) errors.push(`${p}: (a) a symlink under evals/ is not allowed`)
        else if (e.isDirectory()) walk(p)
        else if (e.isFile()) files[p] = fs.readFileSync(path.join(base, p), 'utf8')
        else errors.push(`${p}: (a) not a regular file or directory`)
      }
    }
    walk('evals')
  } catch (e) {
    errors.push(`evals/: (a) could not be read: ${e.message}`)
  }
  return { files, errors }
}

function skillNames(base) {
  return fs.readdirSync(path.join(base, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== '_shared')
    .map((e) => e.name)
    .sort()
}

// ---------------------------------------------------------------------------------------------------
// The real tree

test('the real evals/ suite has no structure errors', () => {
  const { files, errors } = loadEvalFiles(root)
  const all = errors.length ? errors : validateSuite(files, skillNames(root))
  assert.deepEqual(all, [])
})

test('the real Makefile keeps evals off make test and the default goal, with safe EVAL_ARGS', () => {
  assert.deepEqual(checkMakefile(read('Makefile')), [])
})

test('tests/run.sh never runs claude plugin eval or make evals', () => {
  assert.deepEqual(checkRunSh(read('tests/run.sh')), [])
})

test('run.sh control: every spelling of make evals or claude plugin is an (h) error', () => {
  const rows = ['make -C . evals', '$(MAKE) evals', '"$MAKE" evals', '${MAKE} evals', 'make EVAL_ARGS=x evals', 'claude  plugin eval .']
  for (const line of rows) {
    const errors = checkRunSh(`#!/usr/bin/env bash\nset -e\n${line}\n`, 'R')
    assert.ok(errors.length > 0, `${line}: expected errors, got none`)
  }
  assert.deepEqual(checkRunSh(read('tests/run.sh'), 'R'), [], 'the real run.sh')
})

test('.gitignore ignores evals/results/', () => {
  assert.deepEqual(checkGitignore(read('.gitignore')), [])
})

// ---------------------------------------------------------------------------------------------------
// Frontmatter reader table

const fmOf = (lines) => readFrontmatter(`---\n${lines}\n---\nbody\n`, 't.md').fm

test('the frontmatter reader accepts the YAML subset and reads it as YAML would', () => {
  const accept = [
    ["k: 'it''s'", "it's"],
    ["k: '\\d'", '\\d'],
    ['k: "a\\"b"', 'a"b'],
    ['k: []', []],
    ['k: [ ]', []],
    ['k: [smoke, routing]', ['smoke', 'routing']],
    ['k: [a1, v2-x]', ['a1', 'v2-x']],
    ['k: count:3', 'count:3'],
    ['k: i', 'i'],
    ["k: 'docs/handoffs/\\d{4}-\\d{2}-\\d{2}-[a-z0-9-]+\\.md'", 'docs/handoffs/\\d{4}-\\d{2}-\\d{2}-[a-z0-9-]+\\.md'],
    ['k: A plain resume request routes to open, not the next router', 'A plain resume request routes to open, not the next router'],
  ]
  for (const [line, want] of accept) assert.deepEqual(fmOf(line).get('k').value, want, line)
  // A grader may end right after its closing ---.
  assert.equal(readFrontmatter('---\ntype: llm\n---', 'g.md').body, '')
})

test('the frontmatter reader rejects everything outside the subset with an (fm) error', () => {
  const reject = [
    'k: #foo', 'k: - a', 'k: ? a', 'k: : a', 'k: -', 'k: abc:',
    'k: True', 'k: NULL', 'k: ~', 'k: yes',
    'k: a: b', 'k: a #b', "k: 'open", "k: 'a'b'", 'k: "x" #c',
    'k:', 'k: ', '  k: v', 'k: [a]\n  - item', 'k: {a: 1}',
    'k: [a,,b]', 'k: [ , ]', 'k: [a, ]', 'k: [[a]]',
    'k: [2026]', 'k: [1.5]', 'k: [.5]', 'k: [-1]', 'k: [.inf]', 'k: [yes]', 'k: [Null]',
    'k:\tv', 'k: a\nk: b', '# comment', '', 'K: v',
  ]
  for (const line of reject) assert.throws(() => fmOf(line), (e) => e.message.startsWith('t.md: (fm)'), JSON.stringify(line))
  for (const text of ['---\r\nk: v\r\n---\r\nb\r\n', '\uFEFF---\nk: v\n---\nb\n', 'k: v\n---\nb\n', '---\nk: v\nb\n']) {
    assert.throws(() => readFrontmatter(text, 't.md'), (e) => e.message.startsWith('t.md: (fm)'), JSON.stringify(text))
  }
})

// ---------------------------------------------------------------------------------------------------
// Synthetic suites

const SKILLS = ['close', 'next', 'open', 'stash']
const PROMPT = '---\ndescription: A plain resume request routes to open\ntags: [smoke]\nmax_turns: 8\ntimeout_seconds: 180\nallowed_tools: [Read, Glob, Grep, Skill]\n---\n\nPick up the palette-export thread.\n'
const skillGrader = (name, extra = '') => `---\ntype: tool_used\ntool: Skill\ninput_match: '"skill"\\s*:\\s*"(?:[\\w-]+:)?${name}"'\n${extra}arm: both\n---\n`
const REGEX_GRADER = "---\ntype: regex\npattern: 'palette'\nflags: i\nmatch: contains\ntarget: last_message\nweight: 0.5\narm: both\n---\n"
const LLM_GRADER = '---\ntype: llm\nfocus: last_message\n---\nPASS if the reply names the thread. FAIL otherwise.\n'
const C = 'evals/smoke/one'
const cleanSuite = () => ({
  [`${C}/prompt.md`]: PROMPT,
  [`${C}/graders/routes.md`]: skillGrader('open'),
  [`${C}/graders/not-next.md`]: skillGrader('next', 'min: 0\nmax: 0\n'),
  [`${C}/graders/says.md`]: REGEX_GRADER,
  [`${C}/graders/judge.md`]: LLM_GRADER,
  'evals/mocks/readme.txt': 'fixtures live inline in each prompt\n',
})
const withPrompt = (from, to) => ({ [`${C}/prompt.md`]: PROMPT.replace(from, to) })
const withGrader = (name, text) => ({ [`${C}/graders/${name}`]: text })

test('positive control: a clean synthetic suite has no errors', () => {
  assert.deepEqual(validateSuite(cleanSuite(), SKILLS), [])
  // A group directory named graders is not a graders/ directory.
  const grouped = { 'evals/graders/c1/prompt.md': PROMPT, 'evals/graders/c1/graders/g.md': skillGrader('open') }
  assert.deepEqual(validateSuite({ ...cleanSuite(), ...grouped }, SKILLS), [], 'a case under evals/graders/')
})

test('negative control: each known-bad change gives its own named error', () => {
  const P = `${C}/prompt.md`
  const G = (n) => `${C}/graders/${n}`
  const rows = [
    ['allowed_tools [Read, Write]', withPrompt('[Read, Glob, Grep, Skill]', '[Read, Write]'), P, 'd', ['lists Write', 'missing Skill']],
    ['runs: 5', withPrompt('max_turns', 'runs: 5\nmax_turns'), P, 'c', ['runs 5']],
    ["runs: '3'", withPrompt('max_turns', "runs: '3'\nmax_turns"), P, 'type', ['runs']],
    ['description: 2026', withPrompt('description: A plain resume request routes to open', 'description: 2026'), P, 'type', ['quote it']],
    ['flags: [i]', withGrader('says.md', REGEX_GRADER.replace('flags: i', 'flags: [i]')), G('says.md'), 'type', ['not a list']],
    ["weight: '2'", withGrader('says.md', REGEX_GRADER.replace('weight: 0.5', "weight: '2'")), G('says.md'), 'type', ['weight']],
    ['weight: 0', withGrader('says.md', REGEX_GRADER.replace('weight: 0.5', 'weight: 0')), G('says.md'), 'type', ['must be > 0']],
    ['description: #foo', withPrompt('description: A plain resume request routes to open', 'description: #foo'), P, 'fm', ['description']],
    ['tags: [a, ]', withPrompt('tags: [smoke]', 'tags: [a, ]'), P, 'fm', ['empty item']],
    ['tags: [2026]', withPrompt('tags: [smoke]', 'tags: [2026]'), P, 'fm', ['looks numeric']],
    ['a grader with no frontmatter', withGrader('bare.md', 'type: llm\nPASS if it works.\n'), G('bare.md'), 'e', ['no frontmatter']],
    ['a Skill grader without arm: both', withGrader('routes.md', skillGrader('open').replace('arm: both\n', '')), G('routes.md'), 'f', ['arm: both']],
    ['input_match naming no skill', withGrader('routes.md', skillGrader('nope')), G('routes.md'), 'f', ['matches no skill']],
    ['an ambiguous input_match', withGrader('routes.md', skillGrader('(open|next)')), G('routes.md'), 'f', ['ambiguous']],
    ['a body containing /Users/', withPrompt('Pick up', 'Read /Users/someone/notes and pick up'), P, 'g', ['/Users/']],
    ['evals/mocks/x.txt containing /Users/', { 'evals/mocks/x.txt': 'see /Users/someone\n' }, 'evals/mocks/x.txt', 'g', ['/Users/']],
    ['evals/mocks/case.yaml', { 'evals/mocks/case.yaml': 'x: 1\n' }, 'evals/mocks/case.yaml', 'a', ['case.yaml']],
    ['a misspelled prompt (orphan graders)', { 'evals/o/promt.md': PROMPT, 'evals/o/graders/g.md': skillGrader('open') }, 'evals/o/graders/g.md', 'a', ['orphan']],
    ['a root evals/prompt.md', { 'evals/prompt.md': PROMPT }, 'evals/prompt.md', 'a', ['root']],
    ["description: 'TODO: fill in'", withPrompt('description: A plain resume request routes to open', "description: 'TODO: fill in'"), P, 'b', ['TODO:']],
    ['a body starting with /', withPrompt('Pick up', '/thread:open pick up'), P, 'b', ['starts with "/"']],
    ['a nested case', { [`${C}/inner/prompt.md`]: PROMPT, [`${C}/inner/graders/g.md`]: skillGrader('open') }, `${C}/inner/prompt.md`, 'a', ['nested']],
    ['a duplicate case name', { 'evals/other/one/prompt.md': PROMPT, 'evals/other/one/graders/g.md': skillGrader('open') }, P, 'a', ['duplicate case name one', 'evals/other/one']],
    ['CRLF', { [P]: PROMPT.replaceAll('\n', '\r\n') }, P, 'fm', ['CRLF']],
    ['a pattern that does not compile', withGrader('says.md', REGEX_GRADER.replace("pattern: 'palette'", "pattern: '('")), G('says.md'), 'e', ['compile']],
    ['min 2 / max 1', withGrader('not-next.md', skillGrader('next', 'min: 2\nmax: 1\n')), G('not-next.md'), 'e', ['greater than max']],
    ['an empty llm body', withGrader('judge.md', '---\ntype: llm\n---\n\n'), G('judge.md'), 'e', ['rubric']],
    ['a non-empty tool_used body', withGrader('routes.md', skillGrader('open') + 'extra\n'), G('routes.md'), 'e', ['empty body']],
    ['graders/x.txt', withGrader('x.txt', 'notes\n'), G('x.txt'), 'e', ['.md']],
    ['a regex pattern in frontmatter and body', withGrader('says.md', REGEX_GRADER + 'palette\n'), G('says.md'), 'e', ['exactly one']],
    ['tool: skill (lowercase), max: 0', withGrader('not-next.md', skillGrader('next', 'min: 0\nmax: 0\n').replace('tool: Skill', 'tool: skill')), G('not-next.md'), 'e', ['tool skill is not granted', 'never fire']],
    ['tool: Bash not granted, max: 0', withGrader('not-next.md', skillGrader('next', 'min: 0\nmax: 0\n').replace('tool: Skill', 'tool: Bash')), G('not-next.md'), 'e', ['tool Bash is not granted', 'never fire']],
  ]
  for (const [name, patch, file, rule, keywords] of rows) {
    const errors = validateSuite({ ...cleanSuite(), ...patch }, SKILLS)
    assert.ok(errors.length > 0, `${name}: expected errors, got none`)
    for (const e of errors) assert.ok(e.includes(` (${rule}) `), `${name}: expected only (${rule}) errors, got: ${e}`)
    assert.ok(errors.some((e) => e.startsWith(`${file}: `)), `${name}: no error names ${file}: ${errors.join(' | ')}`)
    for (const k of keywords) assert.ok(errors.some((e) => e.includes(k)), `${name}: no error mentions ${k}: ${errors.join(' | ')}`)
  }
})

test('a missing evals/ is one named error, not a thrown load', () => {
  assert.deepEqual(loadEvalFiles(path.join(root, 'skills', '_shared')), { files: {}, errors: ['evals/: (a) evals/ is missing'] })
})

// ---------------------------------------------------------------------------------------------------
// Makefile controls

const MK_PHONY = '.PHONY: test evals\n'
const MK_TEST = 'test:\n\t@bash tests/run.sh\n'
const MK_ARGS = 'EVAL_ARGS ?= --ablation none --runs 1 --max-cost-usd 5 --no-publish --threshold 0\n'
const MK_EVALS = 'evals:\n\tclaude plugin eval . $(EVAL_ARGS)\n'
const mk = (parts = {}) => {
  const p = { phony: MK_PHONY, pre: '', test: MK_TEST, mid: '', args: MK_ARGS, evals: MK_EVALS, post: '', ...parts }
  return p.phony + p.pre + p.test + p.mid + p.args + p.evals + p.post
}

test('Makefile control: every way to reach or weaken evals is a named (h) error', () => {
  const rows = [
    ['test: evals', mk({ test: 'test: evals\n\t@bash tests/run.sh\n' }), 'reaches evals'],
    ['two hops', mk({ test: 'test: chk\n\t@bash tests/run.sh\nchk: evals\n' }), 'reaches evals'],
    ['inline recipe', mk({ test: 'test: ; claude plugin eval .\n' }), 'mentions claude'],
    ['$(eval ...)', mk({ mid: '$(eval test: evals)\n' }), 'column-0 $('],
    ['define/endef', mk({ mid: 'define X\nclaude plugin eval .\nendef\n' }), 'directive define'],
    ['ifeq/else/endif', mk({ mid: 'ifeq ($(A),b)\nY = 1\nelse\nY = 2\nendif\n' }), 'directive ifeq'],
    ['include', mk({ mid: 'include x.mk\n' }), 'directive include'],
    ['a second test rule', mk({ post: 'test: evals\n' }), 'reaches evals'],
    ['double-colon rule', mk({ test: 'test:: evals\n\t@bash tests/run.sh\n' }), 'reaches evals'],
    ['!= shell assignment', mk({ pre: 'X != claude plugin eval .\n', test: 'test:\n\t$(X)\n' }), 'mentions claude'],
    ['$(MAKE) evals', mk({ test: 'test:\n\t$(MAKE) evals\n' }), 'mentions claude, evals or make'],
    ['an unresolved reference', mk({ test: 'test:\n\techo $(UNDEFINED)\n' }), 'cannot resolve'],
    ['--allow-tools in the recipe', mk({ evals: 'evals:\n\tclaude plugin eval . --allow-tools Bash $(EVAL_ARGS)\n' }), '--allow-tools'],
    ['--scaffold in EVAL_ARGS', mk({ args: MK_ARGS.replace('--threshold 0', '--threshold 0 --scaffold') }), '--scaffold'],
    ['EVAL_ARGS without --no-publish', mk({ args: MK_ARGS.replace(' --no-publish', '') }), 'lacks --no-publish'],
    ['evals missing from .PHONY', mk({ phony: '.PHONY: test\n' }), '.PHONY lacks evals'],
    ['no evals rule', mk({ evals: '' }), 'no evals rule'],
    ['a tab line before any rule', mk({ phony: '\techo hi\n' + MK_PHONY }), 'no current rule'],
    ['a static pattern rule', mk({ post: 'objs: %.o: %.c\n' }), 'pattern'],
    ['evals before test', mk({ pre: MK_EVALS, evals: '' }), 'default goal is evals'],
    ['evals test: first', mk({ test: '', evals: '', pre: 'evals test:\n\tclaude plugin eval . $(EVAL_ARGS)\n' }), 'default goal is evals'],
    ['.DEFAULT_GOAL', mk({ pre: '.DEFAULT_GOAL := evals\n' }), '.DEFAULT_GOAL'],
    ['SHELL := claude', mk({ pre: 'SHELL := claude\n' }), 'SHELL (claude) mentions claude'],
    ['.SHELLFLAGS naming make evals', mk({ pre: '.SHELLFLAGS := -c make evals;\n' }), '.SHELLFLAGS (-c make evals;) mentions'],
    ['SHELL through a variable', mk({ pre: 'C = claude\nSHELL = $(C)\n' }), 'SHELL ($(C)) mentions claude'],
    ['grouped targets test evals &:', mk({ post: 'test evals &:\n' }), 'grouped targets'],
    ['claude plugin eval without .', mk({ evals: 'evals:\n\tclaude plugin eval $(EVAL_ARGS)\n' }), 'claude plugin eval . $(EVAL_ARGS)'],
  ]
  // The clean baseline has no errors, so every error a row reports comes from that row's change.
  const base = checkMakefile(mk(), 'M')
  assert.deepEqual(base, [], 'the clean baseline')
  for (const [name, text, keyword] of rows) {
    const errors = checkMakefile(text, 'M')
    assert.ok(errors.some((e) => e.includes(keyword) && !base.includes(e)), `${name}: no new error mentions ${keyword}: ${errors.join(' | ')}`)
  }
  const positive = [
    ['X ::= a:b', mk({ pre: 'X ::= a:b\n' })],
    ['.PHONY: evals test, test first, evals last', mk({ phony: '.PHONY: evals test\n' })],
    ['SHELL := /bin/bash, .SHELLFLAGS := -ec', mk({ pre: 'SHELL := /bin/bash\n.SHELLFLAGS := -ec\n' })],
    ['${EVAL_ARGS}', mk({ evals: 'evals:\n\t@claude plugin eval . ${EVAL_ARGS}\n' })],
  ]
  for (const [name, text] of positive) assert.deepEqual(checkMakefile(text, 'M'), [], name)
})
