// tests/run.sh's node phase (p54-3, ADR 0084 d4): `node --test` over the files it is given, in the order given.
//
//     node tests/lib/node-run.mjs --test-concurrency=<N> --test-timeout=<ms> <test file>...
//
// Why not `node --test` itself: the CLI treats its arguments as globs and sorts what they match (node 22 and 23), so
// a file list passed longest-first still starts in path order, and tests/reflect-weekly.test.mjs, the slowest file,
// started near the end. This runs the same runner through node:test's `run()`, whose `files` keep their order, with
// the CLI's own two flags and its default reporter (spec on node 23 and later, and on a terminal; tap otherwise, as
// node 22 on CI), so the run's output reads as the CLI's did. Exit 1 when any test fails, as the CLI's.
//
// After the reporter's last line it prints `== node seconds per file`, then one `<seconds>\t<file>` line per file,
// longest first: the seconds of the file's top-level tests (their duration_ms summed, the file's whole time when it
// fails to load), the lines tests/shard-weights.tsv's node section is regenerated from (its header says how).
import { run } from 'node:test'
import { spec, tap } from 'node:test/reporters'
import { resolve } from 'node:path'

const files = []
let concurrency = 1
let timeout = Infinity
for (const a of process.argv.slice(2)) {
  const m = /^--test-(concurrency|timeout)=([1-9][0-9]*)$/.exec(a)
  if (m) {
    if (m[1] === 'concurrency') concurrency = Number(m[2])
    else timeout = Number(m[2])
  } else if (a.startsWith('-')) {
    console.error(`node-run: unknown flag ${a}`)
    process.exit(2)
  } else {
    files.push(a)
  }
}
if (files.length === 0) {
  console.error('node-run: no test file given')
  process.exit(2)
}

const major = Number(process.versions.node.split('.')[0])
const reporter = major >= 23 || process.stdout.isTTY ? new spec() : tap
const seconds = new Map(files.map((f) => [f, 0]))
// A top-level test's event names its file by the path it was given or by its absolute path: resolved, either is its row.
const rowOf = new Map(files.map((f) => [resolve(f), f]))
const tally = (data) => {
  if (data.nesting !== 0 || !data.file) return
  const f = rowOf.get(resolve(data.file))
  if (f !== undefined) seconds.set(f, seconds.get(f) + (data.details?.duration_ms ?? 0) / 1000)
}

const stream = run({ files, concurrency, timeout })
stream.on('test:pass', tally)
stream.on('test:fail', (data) => {
  process.exitCode = 1
  tally(data)
})
const out = stream.compose(reporter)
out.pipe(process.stdout, { end: false })
out.on('end', () => {
  const rows = [...seconds].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  process.stdout.write(`== node seconds per file\n${rows.map(([f, s]) => `${s.toFixed(1)}\t${f}`).join('\n')}\n`)
})
