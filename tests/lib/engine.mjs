// Loads the pure-function region of wave-execute.workflow.js (everything before the orchestration
// marker, which needs Workflow globals) into a vm sandbox and returns the named functions — the same
// technique skills/execute/tests/prompt-invariants.test.mjs uses. `agent` and `log` are stubbed.
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const enginePath = path.join(root, 'skills', 'execute', 'wave-execute.workflow.js')

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
