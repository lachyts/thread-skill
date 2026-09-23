export const meta = {
  name: 'edit-noop-repro',
  description: 'Reproduce the suspected "Edit tool silently no-ops inside a git worktree" bug in the exact failing context (a Workflow-engine agent() subagent operating in an explicit worktree, as wave-execute.workflow.js worktreeSetup() creates).',
  phases: [{ title: 'Probe' }],
}

// =============================================================================
// One-off diagnostic harness for task: wave-execute-agent-edit-tool-noop-in-worktree
//
// Each probe agent runs three arms in its OWN worktree of a scratch repo, mirroring
// the wave-execute worktree setup verbatim, then REPORTS (does not fix):
//   Arm A — Edit via the WORKTREE absolute path ($WT/...): the normal happy path.
//   Arm B — Edit via the MAIN-CHECKOUT absolute path (<repoPath>/...): the H1 hypothesis —
//           does an edit aimed at the repoPath-prefixed path land in the MAIN tree (invisible
//           to the worktree's git diff), looking like a "silent no-op" to the agent?
//   Arm C — Write a new file via the WORKTREE path: the contrast the original bug report drew
//           ("Write persisted, Edit did not").
//
// args = { repoPath: "<abs path to scratch working clone>", indices: [0,1,2,3] }
// Returns { probes: [PROBE, ...] }.
// =============================================================================

const PROBE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    index: { type: 'number' },
    worktreeToplevel: { type: 'string', description: 'git rev-parse --show-toplevel inside the worktree' },
    armA: {
      type: 'object', additionalProperties: false,
      properties: {
        editReportedSuccess: { type: 'boolean', description: 'did the Edit tool report it succeeded' },
        gitDiffShows: { type: 'boolean', description: 'did `git -C $WT diff` list the file as modified' },
        grepFound: { type: 'boolean', description: 'did grep find the new string on disk in the worktree file' },
      },
      required: ['editReportedSuccess', 'gitDiffShows', 'grepFound'],
    },
    armB: {
      type: 'object', additionalProperties: false,
      properties: {
        editReportedSuccess: { type: 'boolean' },
        landedInWorktreeDiff: { type: 'boolean', description: 'did the WORKTREE git diff show the sentinel change' },
        landedInMainDiff: { type: 'boolean', description: 'did the MAIN-checkout git diff show the sentinel change' },
        grepFoundMain: { type: 'boolean', description: 'did grep find the new string in the MAIN-checkout sentinel file' },
      },
      required: ['editReportedSuccess', 'landedInWorktreeDiff', 'landedInMainDiff', 'grepFoundMain'],
    },
    armC: {
      type: 'object', additionalProperties: false,
      properties: {
        writeReportedSuccess: { type: 'boolean' },
        onDiskInWorktree: { type: 'boolean' },
      },
      required: ['writeReportedSuccess', 'onDiskInWorktree'],
    },
    notes: { type: 'string', description: 'anything surprising: an Edit that reported success but git diff was empty, an Edit error string, a path-canonicalisation note. Precise and literal.' },
  },
  required: ['index', 'worktreeToplevel', 'armA', 'armB', 'armC', 'notes'],
}

function buildPrompt(i, repoPath) {
  return `You are a reproduction PROBE for a suspected "Edit tool silently no-ops inside a git worktree" bug.
Follow these steps EXACTLY and report precisely what you observe. Do NOT try to fix anything — OBSERVE and REPORT.

Scratch repo (the "main checkout"): ${repoPath}
Your index: ${i}

STEP 1 — create an isolated worktree of the scratch repo (mirrors the wave-execute engine verbatim). Run exactly:
  RP="${repoPath}"; WT="$RP/.claude/worktrees/repro-${i}"; BR="audit-fix/repro-${i}"
  if [ -d "$WT" ]; then cd "$WT";
  elif git -C "$RP" show-ref --verify --quiet "refs/heads/$BR"; then git -C "$RP" worktree add "$WT" "$BR" && cd "$WT";
  else git -C "$RP" fetch origin --quiet && git -C "$RP" worktree add "$WT" -b "$BR" origin/main && cd "$WT"; fi
  git rev-parse --show-toplevel
Record the printed toplevel as worktreeToplevel — it MUST be "$WT".

STEP 2 — ARM A (Edit via the WORKTREE absolute path):
  a. Read the file at $WT/src/target_${i}.py (the absolute WORKTREE path).
  b. Edit that SAME absolute path: replace the exact string "ANCHOR_${i}_ALPHA" with "ANCHOR_${i}_BRAVO". Note whether the Edit tool REPORTS success.
  c. Run: git -C "$WT" diff --stat -- src/target_${i}.py   and   grep -c "ANCHOR_${i}_BRAVO" "$WT/src/target_${i}.py" || true
  d. Record armA.editReportedSuccess, armA.gitDiffShows (file listed as changed), armA.grepFound (grep count > 0).

STEP 3 — ARM B (Edit via the MAIN-CHECKOUT absolute path — the H1 hypothesis):
  a. Read the file at ${repoPath}/src/sentinel_${i}.py (the MAIN-checkout path, NOT the worktree).
  b. Edit that MAIN-checkout absolute path: replace "ANCHOR_${i}_MAIN" with "ANCHOR_${i}_MAINEDIT". Note whether Edit reports success.
  c. Run: git -C "$WT" diff --stat   ;   git -C "${repoPath}" diff --stat   ;   grep -c "ANCHOR_${i}_MAINEDIT" "${repoPath}/src/sentinel_${i}.py" || true
  d. Record armB.editReportedSuccess, armB.landedInWorktreeDiff (does the WORKTREE diff show any sentinel change), armB.landedInMainDiff (does the MAIN-checkout diff show it), armB.grepFoundMain.

STEP 4 — ARM C (Write a new file via the WORKTREE path):
  a. Write the file $WT/src/written_${i}.py with contents:  print('written_${i}')
  b. Run: test -f "$WT/src/written_${i}.py" && echo EXISTS ; git -C "$WT" status --porcelain -- src/written_${i}.py
  c. Record armC.writeReportedSuccess, armC.onDiskInWorktree.

STEP 5 — return the structured result with index=${i}, worktreeToplevel, armA, armB, armC, and a notes string capturing anything surprising (an Edit that reported success while git diff stayed empty, any Edit error text, any path note). Be literal.`
}

const a = typeof args === 'string' ? JSON.parse(args) : args
const repoPath = a.repoPath
const indices = a.indices || [0, 1, 2, 3]

log(`edit-noop-repro: ${indices.length} parallel probes against ${repoPath}`)

const probes = await parallel(
  indices.map((i) => () => agent(buildPrompt(i, repoPath), {
    label: `probe:${i}`, phase: 'Probe', schema: PROBE,
  })),
)

return { probes: probes.filter(Boolean) }
