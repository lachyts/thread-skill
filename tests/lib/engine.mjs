// Loads task.workflow.js for tests. loadEngine() evaluates the pure-function region (everything before
// the orchestration marker, which needs Workflow globals) in a vm sandbox and returns the named
// functions — the same technique skills/execute/tests/prompt-invariants.test.mjs uses; `agent` and `log`
// are stubbed. runTask() runs the WHOLE script the way the Workflow runtime does.
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const enginePath = path.join(root, 'skills', 'execute', 'task.workflow.js')
// The args.verifySlot every engine test passes (required, estate ADR 0009 d4); the path is never run.
export const VERIFY_SLOT = { script: '/plugins/thread/x/skills/execute/scripts/verify-slot.py', slots: 2 }

export function loadEngine(names) {
  const src = fs.readFileSync(enginePath, 'utf8')
  const idx = src.indexOf('// ---- Orchestration')
  if (idx === -1) throw new Error('orchestration marker not found in ' + enginePath)
  const head = src.slice(0, idx).replace('export const meta', 'const meta') + `\nvar __t = { ${names.join(', ')} };\n`
  const ctx = { console, log: () => {}, agent: async () => null }
  vm.createContext(ctx)
  vm.runInContext(head, ctx)
  return ctx.__t
}

// Runs the whole engine script once, as the runtime does for one Workflow call: `export const meta`
// becomes a plain const and the body (top-level `return` included) is wrapped in an async function,
// evaluated in a FRESH vm context whose only globals are `args`, `log` (captured) and `agent` (each
// call recorded as { label, prompt }, then delegated to agentImpl(prompt, opts)).
// Returns { result, logs, calls } on success or { error, logs, calls } when the script throws. The
// result is JSON round-tripped into this realm so deepStrictEqual can compare runs across contexts.
// options.source runs that engine text instead of the file's (a test's broken-variant control).
export async function runTask(args, agentImpl, options = {}) {
  const src = options.source === undefined ? fs.readFileSync(enginePath, 'utf8') : options.source
  const name = options.source === undefined ? enginePath : enginePath + ' (options.source variant)'
  if (!src.includes('export const meta')) throw new Error('export const meta not found in ' + name)
  const body = src.replace('export const meta', 'const meta')
  const logs = []
  const calls = []
  const ctx = {
    console,
    args,
    log: (m) => { logs.push(String(m)) },
    agent: async (prompt, opts) => {
      calls.push({ label: (opts && opts.label) || '', prompt })
      return agentImpl(prompt, opts)
    },
  }
  vm.createContext(ctx)
  try {
    const out = await vm.runInContext(`(async () => {\n${body}\n})()`, ctx, { filename: name })
    return { result: out === undefined ? out : JSON.parse(JSON.stringify(out)), logs, calls }
  } catch (error) {
    return { error, logs, calls }
  }
}
