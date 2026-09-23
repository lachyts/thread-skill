// Reference contracts: the ADR numbers and cross-file `§` citations the skills lean on must point at
// something real. Agents follow these citations literally ("see execute § 3.7"); a dangling one sends
// them hunting, and nothing else in the suite notices when a heading is renamed or an ADR number is
// wrong. Three rules, one matcher (findViolations) shared by the real scan and the control case:
//
//   A  every `ADR NNNN` in README.md, skills/**/*.md and docs/adr/*.md resolves to exactly one
//      docs/adr/NNNN-*.md, unless a foreign-repo qualifier precedes it ("Chorus ADR 0047"). Every
//      number of a list resolves too ("ADR 0014, 0015", "ADR 0006/0007", "ADRs 0001–0005" by both
//      endpoints). An `ADR NNNN § X` must also resolve X against that ADR's headings.
//   B  a `§` citation of a named in-repo target (a skill, a skills/_shared spec, CONTEXT.md, README)
//      in README.md or skills/**/*.md resolves against that file's headings or bold paragraph labels.
//      The target sits directly before the `§` ("execute § 3.7", "execute (§8: …"), or is chained:
//      "`task-writer.md` exactly: § 1 routing, § 2 dedup, …" inline to the sentence end, or the same
//      introducer followed by nested "- § 1 …" list items (see carryZones).
//   C  a `§` citation of a file outside the repo can't be checked hermetically, so it must match an
//      EXTERNAL entry, hand-verified. A new or changed external citation fails until someone checks
//      it and adds it.
//
// Out of scope by design: intra-file bare `§ N`, a target that is neither directly before its `§` nor
// a `:` / `exactly:` introducer, § citations in .js/.py/.sh files, and the historical records under
// docs/ (ADRs are scanned for rule A only). Reads files only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const walk = (d) => fs.readdirSync(path.join(root, d), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]))
  .sort()

// Qualifiers that mark an ADR number as another repo's (compared case-sensitively).
const FOREIGN_ADR_QUALIFIERS = ['Chorus', 'workspaces']

// External § citations, hand-verified 2026-09-23. [path as cited (or its trailing segment), section].
const EXTERNAL = [
  ['add-task.md', 'Step 4'],
  ['obsidian-schema.md', 'Task'],
  ['claude-base-instructions.md', 'Claude memory management'],
  ['triage-batching-protocol.md', '6'],
  ['CLAUDE.md', 'Launch profiles'],
  ['~/.agents/skills/method/SKILL.md', 'Which ledger a row goes to'],
]

// Citations the checker flags that are really broken but live in a file another task owns. Each entry:
// { file, cite, why }. A fixed entry must be removed (the last test enforces it).
const KNOWN_BROKEN = []

// ---- section index of a target file -------------------------------------------------------------

const stripFrontmatter = (text) => {
  const m = text.match(/^---\n[\s\S]*?\n---\n/)
  return m ? '\n'.repeat(m[0].split('\n').length - 1) + text.slice(m[0].length) : text
}

// Headings and bold paragraph labels (`**Lifecycle.**`), ignoring anything inside a fenced block.
function sectionIndex(text) {
  const lines = stripFrontmatter(text).split('\n')
  const out = []
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return }
    if (fence) return
    let m = l.match(/^(#{1,6})\s+(.*)$/)
    if (m) { out.push({ kind: 'h', level: m[1].length, raw: m[2].replace(/[`*]/g, '').trim(), line: i }); return }
    m = l.match(/^\*\*(.+?)\.?\*\*/)
    if (m) out.push({ kind: 'b', raw: m[1].replace(/[`*]/g, '').trim(), line: i })
  })
  return { out, lines }
}

// A heading's comparable name: numbering stripped, cut at " — " / " (", trailing punctuation trimmed.
const headingKey = (raw) => raw.replace(/^\d+(?:\.\d+)*[a-z]?\.\s+/, '')
  .split(/ — | \(/)[0].replace(/[\s.,:;!?]+$/, '').trim().toLowerCase()

// A citation's section text, cut where the prose runs on past the section name.
const citeKey = (s) => {
  s = s.replace(/^["“]/, '')
  const i = s.search(/ — | \(|:|\.(?:\s|$)|[,;)|*`§]/)
  return (i >= 0 ? s.slice(0, i) : s).replace(/[\s.,:;!?'"”]+$/, '').trim().toLowerCase()
}

// Case-insensitive prefix in either direction, at a word boundary ("Life" never matches "Lifecycle").
function namedMatch(a, b) {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a]
  return s.length > 0 && l.startsWith(s) && (l.length === s.length || !/[a-z0-9]/.test(l[s.length]))
}

const NUMERIC = /^(\d+)(?:\.(\d+))?([a-z])?(?![A-Za-z0-9])/
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Does `section` (the text after a §) resolve in `text`? Returns null when it does, else a reason.
function resolveSection(text, section, idx) {
  const { out, lines } = idx
  section = section.replace(/^["“]/, '')
  const num = section.match(NUMERIC)
  if (num) {
    const [, a, b, c] = num
    const key = a + (b ? `.${b}` : '') + (c || '')
    const startsWith = (k) => new RegExp(`^${esc(k)}(?:\\.(?!\\d)|\\s|$)`)
    if (out.some((h) => h.kind === 'h' && startsWith(key).test(h.raw))) return null
    if (b && !c) {  // N.M → item M of the numbered list under heading N (task-writer § 1.4)
      const h = out.find((x) => x.kind === 'h' && startsWith(a).test(x.raw))
      if (h) {
        const next = out.find((x) => x.kind === 'h' && x.line > h.line && x.level <= h.level)
        let fence = false
        const item = new RegExp(`^${b}\\.\\s`)
        for (const l of lines.slice(h.line + 1, next ? next.line : undefined)) {
          if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue }
          if (!fence && item.test(l)) return null
        }
      }
    }
    return `no heading numbered ${key}`
  }
  const k = citeKey(section)
  if (!k) return 'empty section name'
  return out.some((h) => namedMatch(k, headingKey(h.raw))) ? null : `no heading or bold label "${k}"`
}

// ---- target classification ----------------------------------------------------------------------

const stripToken = (t) => t.replace(/`/g, '').replace(/^[([]+/, '').replace(/['’]s$/, '').replace(/^\$\{CLAUDE_PLUGIN_ROOT\}\//, '')

// → { file } in-repo, { ext } external, { missing } a named in-repo target that doesn't exist, or null (bare).
function classify(target, ctx) {
  const t = target
  let m
  if ((m = t.match(/^\/thread:([\w-]+)$/))) {
    return ctx.skills.has(m[1]) ? { file: `skills/${m[1]}/SKILL.md` } : { missing: `no skill "${m[1]}"` }
  }
  if ((m = t.match(/^([\w-]+)(?:\s+SKILL(?:\.md)?|\/SKILL\.md)?$/)) && ctx.skills.has(m[1])) return { file: `skills/${m[1]}/SKILL.md` }
  if ((m = t.match(/^skills\/([\w-]+)\/SKILL\.md$/))) {
    return ctx.skills.has(m[1]) ? { file: t } : { missing: `no skill "${m[1]}"` }
  }
  if ((m = t.match(/^(?:skills\/)?(?:_shared\/)?([\w-]+)(?:\.md)?$/)) && ctx.shared.has(m[1])) return { file: `skills/_shared/${m[1]}.md` }
  if (t === 'CONTEXT.md') return { file: 'CONTEXT.md' }
  if (t === 'README' || t === 'README.md') return { file: 'README.md' }
  if (/\.md$/.test(t) || /^[~/]/.test(t)) return { ext: t }
  return null
}

// The token(s) directly before a §: "execute", "`close`'s", "execute SKILL.md", "(handoff", and the
// token before an opening paren ("execute (§8: …").
function targetBefore(pre) {
  if (/\(\s*$/.test(pre)) pre = pre.replace(/\(\s*$/, '')
  const m = pre.match(/(?:(\S+)\s+)?(\S+)\s*$/)
  if (!m) return ''
  const last = stripToken(m[2])
  if ((last === 'SKILL.md' || last === 'SKILL') && m[1]) return `${stripToken(m[1])} ${last}`
  return last
}

// Chained citations: a named target followed by `:` or `exactly:` carries to the bare § refs after it.
// Inline ("`task-writer.md` exactly: § 1 routing, § 2 dedup, …") the carry runs to the sentence end, a
// blank line or a new list item. When the colon ends its line, it runs through the more-indented lines
// directly under it (the nested "- § 1 …" items) and stops at the next line indented no deeper. The
// matcher also stops it at the first § that has its own named target. → [{ start, end, raw, c }].
function carryZones(text, ctx) {
  const zones = []
  for (const m of text.matchAll(/(\S+?)(?:\s+exactly)?:(?=[ \t]|\n|$)/g)) {
    const raw = targetBefore(text.slice(Math.max(0, m.index - 300), m.index + m[1].length))
    const c = raw && classify(raw, ctx)
    if (!c) continue
    const colon = m.index + m[0].length - 1
    // A colon inside a code span ("`status: open`") introduces nothing.
    if ((text.slice(text.lastIndexOf('\n', colon) + 1, colon).match(/`/g) || []).length % 2) continue
    const start = colon + 1
    const eol = text.indexOf('\n', start) < 0 ? text.length : text.indexOf('\n', start)
    let end
    if (text.slice(start, eol).trim() === '') {
      const lineStart = text.lastIndexOf('\n', m.index) + 1
      const indent = text.slice(lineStart).match(/^[ \t]*/)[0].length
      end = eol
      while (end < text.length) {
        const next = text.slice(end + 1).split('\n')[0]
        if (!next.trim() || next.match(/^[ \t]*/)[0].length <= indent) break
        end += 1 + next.length
      }
    } else {
      const stop = text.slice(start).search(/\.(?=\s|$)|\n[ \t]*\n|\n[ \t]*(?:[-*+]|\d+\.)\s/)
      end = stop < 0 ? text.length : start + stop
    }
    if (end > start) zones.push({ start, end, raw, c })
  }
  return zones
}

// ---- the matcher --------------------------------------------------------------------------------

const lineAt = (text, i) => text.slice(0, i).split('\n').length

// sources: [{ file, text, rules? ('ABC' default) }]; ctx: { readTarget, adrs, skills, shared }.
// Returns [{ file, line, rule, cite, why }]; bumps `checked` per rule so the scan can prove non-vacuity.
function findViolations(sources, ctx, checked = { A: 0, B: 0, C: 0 }) {
  const out = []
  const idxCache = new Map()
  const indexOf = (rel) => {
    if (!idxCache.has(rel)) {
      const text = ctx.readTarget(rel)
      idxCache.set(rel, text == null ? null : { text, idx: sectionIndex(text) })
    }
    return idxCache.get(rel)
  }
  const sectionAfter = (text, from) => text.slice(from, from + 240).split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim()

  for (const { file, text, rules = 'ABC' } of sources) {
    const push = (i, rule, cite, why) => out.push({ file, line: lineAt(text, i), rule, cite, why })

    if (rules.includes('A')) {
      // "ADR 0014, 0015", "ADR 0006/0007", "ADR 0011 and 0014", "ADRs 0001–0005": every listed number
      // resolves (a range by both endpoints). A continuation number followed by `-` or a digit is a date
      // ("ADR 0015, 2026-09-15"), not an ADR. A trailing `§ X` belongs to the last number.
      const NUM = String.raw`\d{4}(?![-\d])`
      const LIST = new RegExp(String.raw`\bADRs?\s+(\d{4})\b((?:\s*(?:,|\/|&|–|\band\b)\s*${NUM})*)`, 'g')
      for (const m of text.matchAll(LIST)) {
        const q = (text.slice(Math.max(0, m.index - 60), m.index).match(/(\S+)\s+$/)?.[1] || '')
          .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '')
        if (FOREIGN_ADR_QUALIFIERS.includes(q)) continue
        const nums = [m[1], ...(m[2].match(/\d{4}/g) || [])]
        const rest = text.slice(m.index + m[0].length).match(/^\s*§§?\s*/)
        const section = rest ? sectionAfter(text, m.index + m[0].length + rest[0].length) : ''
        nums.forEach((n, i) => {
          checked.A++
          const last = i === nums.length - 1
          const hits = ctx.adrs.get(n) || []
          const cite = `ADR ${n}${rest && last ? ` § ${section.slice(0, 40)}` : ''}`
          if (hits.length !== 1) { push(m.index, 'A', cite, `${hits.length} docs/adr/${n}-*.md files (need exactly 1)`); return }
          if (rest && last) {
            const t = indexOf(`docs/adr/${hits[0]}`)
            const why = resolveSection(t.text, section, t.idx)
            if (why) push(m.index, 'A', cite, `docs/adr/${hits[0]}: ${why}`)
          }
        })
      }
    }

    if (rules.includes('B') || rules.includes('C')) {
      const zones = carryZones(text, ctx)
      for (const m of text.matchAll(/§§?/g)) {
        let raw = targetBefore(text.slice(Math.max(0, m.index - 300), m.index))
        let c = raw ? classify(raw, ctx) : null
        const zone = zones.find((z) => m.index >= z.start && m.index < z.end)
        if (c) { if (zone) zone.end = m.index } else if (zone) { raw = zone.raw; c = zone.c; }
        if (!c) continue
        const section = sectionAfter(text, m.index + m[0].length).replace(/^§+\s*/, '')
        const cite = `${raw} § ${section.slice(0, 40)}`
        if (c.missing) { if (rules.includes('B')) { checked.B++; push(m.index, 'B', cite, c.missing) } continue }
        if (c.ext) {
          if (!rules.includes('C')) continue
          checked.C++
          // A numeric section compares whole (6 ≠ 6.4 ≠ 6b), so a changed number fails until re-verified.
          const num = section.match(NUMERIC)
          const numKey = num ? num[1] + (num[2] ? `.${num[2]}` : '') + (num[3] || '') : null
          const key = citeKey(section)
          const ok = EXTERNAL.some(([p, s]) => (c.ext === p || c.ext.endsWith(`/${p}`)) &&
            (/^\d/.test(s) ? numKey === s : key === s.toLowerCase()))
          if (!ok) push(m.index, 'C', cite, 'external citation not on the EXTERNAL allowlist (verify by hand, then add it)')
          continue
        }
        if (!rules.includes('B')) continue
        const t = indexOf(c.file)
        if (!t) { checked.B++; push(m.index, 'B', cite, `${c.file} does not exist`); continue }
        // §§ 6–7 / §§ 1 & 4: resolve each numeric part; a single § cites one section.
        const parts = [section]
        if (m[0] === '§§' && /^\d/.test(section)) {
          const split = section.split(/\s*(?:&|,|–|\band\b)\s*/)
          const n = split.findIndex((q) => !/^\d/.test(q))
          parts.splice(0, 1, ...split.slice(0, n < 0 ? split.length : n))
        }
        for (const p of parts) {
          checked.B++
          const why = resolveSection(t.text, p, t.idx)
          if (why) push(m.index, 'B', cite, `${c.file}: ${why}`)
        }
      }
    }
  }
  return out
}

// ---- the real tree ------------------------------------------------------------------------------

const skillDirs = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== '_shared').map((e) => e.name)
const adrs = new Map()
for (const f of fs.readdirSync(path.join(root, 'docs/adr')).sort()) {
  const m = f.match(/^(\d{4})-.*\.md$/)
  if (m) adrs.set(m[1], [...(adrs.get(m[1]) || []), f])
}
const ctx = {
  readTarget: (rel) => (fs.existsSync(path.join(root, rel)) ? read(rel) : null),
  adrs,
  skills: new Set(skillDirs),
  shared: new Set(fs.readdirSync(path.join(root, 'skills/_shared')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))),
}

const docSources = ['README.md', ...walk('skills').filter((f) => f.endsWith('.md'))].map((file) => ({ file, text: read(file) }))
const adrSources = walk('docs/adr').filter((f) => f.endsWith('.md')).map((file) => ({ file, text: read(file), rules: 'A' }))
const checked = { A: 0, B: 0, C: 0 }
const violations = findViolations([...docSources, ...adrSources], ctx, checked)

const isKnown = (v) => KNOWN_BROKEN.some((k) => k.file === v.file && k.cite === v.cite)
const fmt = (v) => `${v.file}:${v.line} ${v.cite} — ${v.why}`
const unexpected = (rule) => violations.filter((v) => v.rule === rule && !isKnown(v)).map(fmt)

test('rule A: every ADR reference resolves to exactly one docs/adr file (and its § section)', () => {
  assert.deepEqual(unexpected('A'), [])
})

test('rule B: every in-repo § citation resolves to a heading or bold label', () => {
  assert.deepEqual(unexpected('B'), [])
})

test('rule C: every external § citation is on the hand-verified EXTERNAL allowlist', () => {
  assert.deepEqual(unexpected('C'), [])
})

test('control: the matcher rejects known-bad citations and accepts known-good ones', () => {
  const run = (text) => findViolations([{ file: 'control.md', text }], ctx)
  for (const bad of ['execute § 99', 'ADR 0999', 'ADR 0008 § Nope', '`add-task.md` § Nope',
    '`add-task.md` § Phased tasks', 'task-writer § 9.9', 'execute (§ 99',
    // chained: inline run and nested list items carry the introducer to each bare §
    '`task-writer.md` exactly: § 1 routing, § 99 nope', '`task-writer.md`: § 1 routing, § 3b day page, § 99 nope',
    'follow `task-writer.md` exactly:\n   - § 1 routing.\n   - § 99 nope.\n   - § 2 dedup.',
    // every number of an ADR list, both endpoints of a range
    'ADR 0014, 0999', 'ADR 0006/0999', 'ADR 0011 and 0999', 'ADRs 0001–0999',
    // an external numeric section compares whole, not by its major number
    '`_shared/knowledge/triage-batching-protocol.md` §6.4', '`_shared/knowledge/triage-batching-protocol.md` § 6b']) {
    assert.equal(run(bad).length, 1, `expected exactly one violation for: ${bad} → ${JSON.stringify(run(bad))}`)
  }
  for (const good of ['Chorus ADR 0047', 'workspaces ADR 0003', 'task-writer § 1.4', 'handoff § Handoff document defines',
    'close § The handoff owns the continuation has the scan', 'execute SKILL §4.5 step 5',
    '/thread:schedule §4.7', 'CONTEXT.md § Rollout.', 'execute (§8: x',
    // chained runs stop at a sentence end, a shallower list item, another named target, a code-span colon
    '`task-writer.md` exactly: § 1 routing. Then § 99 is bare.',
    'follow `task-writer.md` exactly:\n   - § 1 routing.\n- § 99 is a new top-level item.',
    '`task-writer.md` exactly: § 1 routing, CONTEXT.md § Rollout, § 99 is bare',
    'a `status: open` task, § 99 is bare',
    'ADR 0006/0007', 'ADR 0011 and 0014', 'ADRs 0001–0005', 'ADR 0015, 2026-09-15: amended',
    '`_shared/knowledge/triage-batching-protocol.md` §6']) {
    assert.deepEqual(run(good).map(fmt), [], `expected no violation for: ${good}`)
  }
})

// Floors sit well below the 2026-09-23 counts (A 103 with list continuations, B 43 with the chained
// task-writer citations, C 9) so sibling edits that move or drop citations don't trip them; a matcher
// that silently stops matching does.
test('non-vacuity: the real scan checked a floor of references per rule', () => {
  assert.ok(checked.A >= 50, `rule A checked only ${checked.A} ADR references`)
  assert.ok(checked.B >= 25, `rule B checked only ${checked.B} in-repo § citations`)
  assert.ok(checked.C >= 6, `rule C checked only ${checked.C} external § citations`)
})

test('every KNOWN_BROKEN entry still fails (remove it once fixed)', () => {
  for (const k of KNOWN_BROKEN) {
    assert.ok(violations.some((v) => v.file === k.file && v.cite === k.cite), `KNOWN_BROKEN entry now passes: ${k.file} ${k.cite}`)
  }
})
