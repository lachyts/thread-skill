export const meta = {
  name: 'task',
  description: "Converge one rollout task: plan-gate → Ralph verify → master review; mode 'integrate' runs its Integration trouble path",
  phases: [
    { title: 'Plan-gate' },
    { title: 'Implement' },
    { title: 'Review' },
    { title: 'Integration' },
  ],
}

// =============================================================================
// task.workflow.js — the per-task convergence engine (protocol_version: 5)
//
// Invoked by the thread:execute lead via Workflow({ scriptPath, args }), ONE call per task: the
// engine converges exactly ONE task per call, and the lead holds the calls (ADR 0030, p12-5). The
// lead runs the queue: it fills slots up to `parallel_ceiling`, integrates each approved task with the
// latest main one at a time, and is the rollout's only merger. The lead owns vault I/O, the protocol
// gate, config resolution, status reconciliation, reporting, Integration, merging, the --gated merge
// hold, and the pause (a `pause_requested: true` flag on the rollout note is `reconcile-rollout.py
// next`'s drain — the engine never sees a pause, because the lead simply doesn't launch the next
// call). This script owns ONLY the three-layer convergence engine.
//
// args = {
//   rolloutSlug : string,            // e.g. "giflab-rollout"
//   repoPath    : string,            // absolute path to the project repo
//   verifier    : string,            // shell command that decides pass/fail in a worktree
//   date        : string,            // YYYY-MM-DD (passed in; Date.now() is unavailable here)
//   ladder      : object,            // the operator's ladder (ADR 0029), ladder.py's JSON as the lead resolved
//                                    //   it at THIS call's start: { source: <the file's path> | 'built-in',
//                                    //   rungs: [{ name, model, effort, judge, review }, …] }, bottom first.
//                                    //   Fixed for the call: a resume re-passes its call's own ladder, so an
//                                    //   edit reaches a task at its next call. Validated (ladderArgsError)
//                                    //   before any dispatch, in both modes. Absent ⇒ the built-in ladder (a
//                                    //   Lost-call resume of a call from before 3.0.0); that call's retired
//                                    //   tier-ceiling and judge-pin args are ignored, never an error.
//   knownBaselineFailures : string[],// optional; "test_id — reason" lines for tests already red on a
//                                    //   clean main. Threaded into every agent so they don't re-diagnose
//                                    //   them. Absent/empty ⇒ prompts render byte-identical to pre-item-2.
//   envBootstrap : string,           // optional; shell command run ONCE per worktree right after the agent
//                                    //   cd's in (env-bootstrap), e.g. "poetry env use 3.11 && poetry install".
//                                    //   Absent/empty ⇒ worktree setup renders byte-identical to pre-feature.
//   defaultBranch : string,          // optional; the target repo's origin default branch when it is NOT
//                                    //   'main' (e.g. "master"). Fresh worktrees branch from origin/<it>.
//                                    //   Absent/'main' ⇒ worktree setup renders byte-identical to pre-fix.
//   progress    : string,            // optional; a precomputed progress line — "progress: 2/6 merged,
//                                    //   1 running, 3 queued — 42m elapsed, ~50m remaining (rough)" — from
//                                    //   reconcile-rollout.py next / mark-started (skill §4.5 step 1). This
//                                    //   sandbox has no clock (Date.now() throws): the started:/merged:
//                                    //   stamps live on the task notes, the arithmetic lives in
//                                    //   reconcile-rollout.py, and the engine only RELAYS the line via
//                                    //   log() for live /workflows visibility. Absent/empty ⇒ no extra log
//                                    //   line (byte-identical).
//   task        : {                  // exactly ONE task object. An args object carrying
//                                    //   `waves` (the pre-p12-5 shape) is refused before
//                                    //   any dispatch, as is a missing, null or array `task`.
//       slug            : string,    // task note basename, e.g. "giflab-fix-coalesce"
//       taskPath        : string,    // absolute path to the task note
//       scope           : "single-file" | "cross-cutting" | "read-only",
//       planGate        : boolean,   // resolved by the skill from plan_approval + scope
//       maxIterations   : number,    // Ralph verifier-retry budget
//       maxReviewRounds : number,    // master-review budget; an integer >= 1
//       maxPlanRounds   : number,    // plan-gate budget; an integer >= 1. Anything else (0, negative,
//                                    //   NaN, absent/null, fractional, a string) fails CLOSED per task:
//                                    //   plan-blocked / review-blocked naming the field, before dispatch
//                                    //   of the layer it would disable (roundBudgetDiagnosis, p12-2).
//       ignoreGate      : boolean,   // optional; true ⇒ inject an operator override of any human/release
//                                    //   gate in the note (per-task-override-channel). Absent/false ⇒ byte-identical.
//       rung            : string,    // optional; the task note's `rung:`, the rung it STARTS on (ADR 0029
//                                    //   decision 4; reconcile stamps the rung a task reached, so a
//                                    //   re-dispatch starts there). Absent or '' ⇒ the legacy fields below,
//                                    //   else the bottom rung. A name the ladder lacks (or a non-string)
//                                    //   is read as the TOP rung and reported as drift (the row's rungDrift).
//       model, effort   : string,    // optional, LEGACY: a note with no `rung:` passes its stale `model:`
//                                    //   and `effort:` stamps. They only choose the starting rung (p13-3's
//                                    //   mapping, startRung): `model: fable`, or `effort: xhigh | max`, starts
//                                    //   on the top rung; anything else on the bottom one. No dispatch ever
//                                    //   runs at the stamped model or effort; `rung` wins when both are set.
//       approvedGates   : string[],  // optional; gated inputs a human already signed off, resolved by the
//                                    //   skill from the task note's "## Approved gates" section (bullets,
//                                    //   "(approved …)" annotations stripped). The engine pauses a task
//                                    //   ONLY for declared gates NOT in this list (ADR 0008) — so
//                                    //   re-dispatches and resumes never re-ask. Omit/empty when none.
//                                    //   Never rendered into a prompt — the one arg the lead may ADD on a
//                                    //   resume (execute § 3.7: a signed gate resumes its gate-pending
//                                    //   call, and a replayed implementer/reviser stop for gates now all
//                                    //   approved gets a continuation per gate not yet passed there,
//                                    //   SIGNED_GATES_RESUME).
//       resume          : object,    // optional (p12-6); the SEEDED REVISE after an Integration rejection:
//                                    //   { stage: 'revise', prUrl, branch, worktreePath, reviewHistory,
//                                    //   reviewRoundsUsed, plan }. plan is the approved plan:
//                                    //   `lead-integrate.py plan`'s `plan` (the note's "## Approved plan");
//                                    //   '' when the last own call was not plan-gated; reference for the
//                                    //   reviser, never the contract. Plan and implement are skipped; the
//                                    //   review loop starts at round reviewRoundsUsed + 1 with one seeded
//                                    //   `revise:<slug> r<R+1>` (COLD ENTRY: it re-enters the tree with
//                                    //   branchTreeSetup, fast-forwards it to origin/<branch> and writes no
//                                    //   note), then the unchanged judge loop.
//                                    //   No round left ⇒ review-blocked with no dispatch. A seeded call that
//                                    //   stops blocked writes REVISE_MARKER + `revise stopped: <why>` + the
//                                    //   history. Validated (resumeArgsError) before any dispatch: the history
//                                    //   strictly ascending with at least one round that has feedback, its
//                                    //   last round = reviewRoundsUsed, branch/worktreePath the computed ones,
//                                    //   never a read-only task. A round with empty feedback (reviewLoop
//                                    //   records one for a `changes` verdict with no bullets) is accepted and
//                                    //   dropped (liveHistory), so the live row's history passes verbatim.
//   }
//   mode        : string,            // optional (p12-6); absent or 'task' ⇒ the task's own call, unchanged
//                                    //   (byte-identical prompts, labels and row). 'integrate' ⇒ Integration's
//                                    //   trouble path (ADR 0030 decision 3) with args.integration. Any other
//                                    //   value throws before dispatch.
//   integration : object,            // mode 'integrate' only; validated (integrationArgsError) before any
//                                    //   dispatch — a bad value is a lead bug, not a task block:
//       prUrl, branch, worktreePath  //   the task's PR; branch = audit-fix/<alias>, worktreePath = the task tree.
//       headSha         : string,    // the ANCHOR (40-hex) — always ANCHOR_RECIPE's output, never "the
//                                    //   approved head" by assumption (see the lead contract below).
//       taskBase        : string,    // git merge-base <anchor> origin/<default> (40-hex).
//       mainSha         : string,    // origin/<default> as the lead last read it (40-hex), the end of the
//                                    //   range `landed` covers. The integrator integrates onto whatever its
//                                    //   fresh fetch gives; when that base is not mainSha, the integrator
//                                    //   (after its fetch) and the judge read `log --first-parent
//                                    //   mainSha..<base>` for the PRs that landed after the lead's read.
//       trouble         : string[],  // ⊆ conflict | red | shared-file, deduplicated; [] on a cold re-entry.
//       landed          : [{ prUrl, title, files: string[], taskPath }], // EVERY PR merged in taskBase..mainSha.
//                                    //   A commit pushed without a PR is in no entry (lead-integrate.py prepare's
//                                    //   `unlisted`): the integrator's and the judge's prompts send both to
//                                    //   `log --first-parent taskBase..mainSha` for those.
//       plan            : string,    // the approved plan: `lead-integrate.py plan`'s `plan` (the note's
//                                    //   "## Approved plan"); '' when the last own call was not plan-gated;
//                                    //   reference for the integrator, never the contract.
//       reviewHistory   : [{ round, feedback: string[], stage?: 'integration' }], // rounds strictly ascending; [] ok;
//                                    //   a round with empty feedback is accepted and dropped (liveHistory).
//       reviewRoundsUsed: number,    // >= 1 and >= the history's last round.
//       rung            : { startRung, rung, climbs }, // the task's own rung record, passed through to the row
//                                    //   (rungRecordError): rung names or '', climbs [{ stage, from, to }].
//                                    //   The neutral { startRung: '', rung: '', climbs: [] } when the note has
//                                    //   none, and a pre-3.0.0 tier record { model, escalated, escalatedAt,
//                                    //   tierCapped, tierCappedAt } reads as neutral. Integration itself runs
//                                    //   on the ladder's TOP rung whatever this record says (ADR 0029 decision 5).
//       leadMerge       : object,    // optional: { mergeCommit, headSha, baseSha, verified } — ONLY in a
//                                    //   shared-file-only case where the lead merged and verified green itself.
//       readyAt, startedAt : string, // optional ISO stamps for the merge-line metrics.
//   }
// }
//
// ---- The lead contract for Integration (execute § 4.5 is the lead's side) ----
// The Integration log. reconcile-rollout.py stamps `ready:` when a task's status changes to review, and
// appends one line per Integration call under the note's `## Integration log`, from this row's
// `integration` field: `<startedAt> <outcome> path=<p> pr=<n> anchor=<sha> head=<sha> base=<sha>
// wait=<n|-> duration=<n|-> triggers=<list|->`. It is the durable record the clean path and the
// review-blocked rule below read.
// The anchor (ADR 0030 decision 3: a merge already in the branch is still judged). Every Integration of a
// task pins one anchor: integration.headSha, with taskBase = merge-base(anchor, origin/<default>). The
// anchor is ALWAYS ANCHOR_RECIPE's output on the PR head (render the constant verbatim and pin the copy):
// `anchor <X>` (the recorded ref), `anchor <sha>` (no ref: the commit before the oldest first-parent merge
// of main, or the PR head), or `stale-ref <X>` — delete it with
// `git update-ref -d refs/integration-anchor/<branch> <X>` and run the recipe again. The anchor equals the
// approved head only when the own run never merged main and no Integration has run; passing the approved
// head of a task whose own run merged main STOPs naming the recipe's value. Every Integration call for the
// task (set-aside re-entries, the re-integration after a rejection and revise, every base-moved retry)
// passes the SAME anchor/taskBase pair; only mainSha, trouble, landed, leadMerge, reviewHistory /
// reviewRoundsUsed and the metric stamps are refreshed. The judge reads EVERY first-parent merge in
// anchor..head, so a merge an earlier Integration pushed but never had judged is judged by the next one.
// The ref's lifecycle. The merge step creates refs/integration-anchor/<branch> on the task's first
// Integration, create-only, never moved (local refs are shared by every worktree and survive the session).
// The lead deletes it, guarded by its old value, whenever the branch stops being this PR's: after the PR
// merges (merge-task.sh), when the PR is closed, when the task is re-dispatched from scratch or its branch
// recut (repair § 4), and on a set-aside whose reason starts `integration: merge step STOP: stale anchor ref`.
// Leftovers. A dead integrator (or a verifier that rewrites tracked files, or the env bootstrap) can leave
// tracked changes in the task tree. The merge step stashes them, never discards them (`stashed:
// integration leftovers <head>` in the merge log), so neither the in-run retry nor a re-entry wedges on
// them. Nobody pops that stash automatically: it stays in the repo's stash list for a human to inspect.
// The clean path is the lead's, never this call's, in two cases only: (i) the PR head equals the anchor;
// (ii) the task's latest Integration record is a completed Integration whose head equals the current PR
// head (a base-moved retry then checks shared files against that record's base). The durable record is the
// last `integrated` line of the Integration log. Anything else — a rejection and revise, a set-aside, a
// session that died mid-Integration — takes the trouble path, where `branch-moved` sends it to the judge.
// Inputs. `landed` lists every PR merged in taskBase..mainSha, so a task back from a rejection still lists
// the PRs behind it; the integrator and the judge read mainSha..<base> themselves for anything later. A commit
// pushed to the default branch without a PR is in no entry: a non-empty `landed` points the integrator and the
// judge at the first-parent log taskBase..mainSha for those (an empty one already sends both to the whole log).
// `prUrl`, `reviewHistory`, `reviewRoundsUsed` and `rung` are `lead-integrate.py inputs --row`'s `integrate`
// record (execute § 4.5 step 3), passed verbatim. It uses the approving row the session holds only when that
// row matches the note (slug, `review`, the note's PR, at least its `review_rounds_used`) and its history and
// rounds pass this call's args check (historyError; a row whose rung record fails rungRecordError keeps the
// row and takes the note's rung record). Otherwise, or with no row, it falls back to the note: the cold
// history from the latest `## Blocker diagnosis` or `## Review-blocked feedback` run (parseIntegrationMarker:
// every engine-written rejected or set-aside marker carries it), else [], and `reviewRoundsUsed` the larger
// of the note's `review_rounds_used` and the history's last round. Rounds with empty feedback are dropped here
// (liveHistory). The note's `pr:` reaches prUrl as a PR URL (a bare `#N` built on origin's owner/repo); when
// it cannot, the record's prUrlError makes the lead set the task aside at Integration instead of launching
// this call. `readyAt` is when the approving own (or seeded
// revise) call returned — durable as the note's `ready:` stamp; none ⇒ waitMinutes
// null. `startedAt` is when the lead launches this call. Never integrate a read-only task; run one
// Integration at a time.
// Outcomes. `integrated` ⇒ row status review: hand integration.headSha and baseSha to merge-task.sh
// (execute § 4.5 step 4). `rejected` ⇒
// blocked with REVISE_MARKER (review-blocked when no review round is left): launch the seeded revise
// (task.resume, it holds a slot — ADR 0030 decision 3), then re-integrate on the same anchor. `set-aside` ⇒
// blocked with `integration: <reason>` (gate-pending for a gate): re-enter at Integration on the same anchor.
// Stage markers (ADR 0030 decision 4: a set-aside task resumes at the stage it stopped, and nothing already
// approved is redone). For a blocked task the FIRST line of the latest `## Blocker diagnosis` run decides —
// REVISE_MARKER ⇒ a seeded revise (reconcile-rollout.py reports it `setAsideAt: run`, the task's own lane), any other
// `integration: ` line ⇒ Integration, anything else ⇒ the own run (a task-mode diagnosis that would parse
// as a marker is written `own run: …`). A review-blocked task has no such run: reconcile writes its
// history under `## Review-blocked feedback` as plain `Round N:` groups, which drop the Integration stage.
// So a review-blocked task whose latest Integration log line is `rejected` — an Integration rejection on
// the last round, or a seeded revise that then ran out of rounds (a seeded revise writes no log line) —
// resumes, once max_review_rounds is raised, as a seeded `task.resume` revise: the PR, branch
// and tree from the note, the history from that section's latest run (parseIntegrationMarker reads the
// `Round N:` form), reviewRoundsUsed its last round; never a fresh plan or implement. No such line ⇒ the
// own run.
// "Committed" (the `committed` trigger) is a non-merge commit beyond the merge commit, or a conflict
// resolution; a clean, conflict-free merge commit alone is not code written (a clean merge touching a
// landed PR's files is caught by `shared-file`).
//
// Returns { rolloutSlug, tasks: [ONE row: { slug, scope, status, prUrl, branch, worktreePath,
//   reviewRoundsUsed, planRoundsUsed, blockerDiagnosis, reviewFeedback, reviewHistory,
//   approvedAtCeiling, summary, startRung, rung, climbs, rungDrift, ran, gatedInputs, plan }] }
// — the pre-p12-5 envelope with exactly one row, the called task's, the shape reconcile-rollout.py reads —
// where status ∈ review | review-blocked | blocked | plan-blocked | gate-pending. The rung record (ADR 0029
// decision 7): startRung is the rung the call started on, rung the one it ended on (reconcile stamps it as
// the note's `rung:`), climbs the stages that climbed this call, in order, as { stage: plan | implement |
// review, from, to } (from === to is a recorded no-op on the top rung), rungDrift the task's `rung:` when
// the ladder lacks it ('' otherwise), and ran every dispatch as { label, rung, model, effort }, in order.
// A block on the top rung is a wall at the operator's ceiling: raising it is an edit to the ladder file.
// gatedInputs lists the declared-but-unapproved gates when status is gate-pending
// (a declared gate always pauses for a human — ADR 0008). reviewHistory is the accumulated by-round
// review-judge rejection rationale ([{ round, feedback: [] }], empty when the PR approved first try);
// approvedAtCeiling marks an approval on the FINAL review round with actual rejection history —
// reconcile persists that history to the task note so ceiling approvals stay auditable.
// plan (p14-2) has three states, and only the task's own call settles it: the approved plan (a non-empty
// string) when the own call ran with one, '' when the own call ran without a plan-gate, and null when the
// call reached no plan outcome (plan-blocked, a plan-gate gate-pending, the pre-flight budget block, a
// converge that threw, every seeded-revise and integrate row). reconcile upserts the note's
// "## Approved plan" on a string, removes it on '', and leaves it on null.
// A mode 'integrate' row carries one more key, `integration`: { outcome: integrated | rejected | set-aside,
// path: integrator | judge-only, anchor: { headSha, taskBase }, headSha, baseSha, mergeCommit, triggers
// (conflict | committed | branch-moved | shared-file), reReviewed, feedback, reason, agents: [{ role,
// label, rung, model, effort, finishedAt }], metrics: { readyAt, startedAt, finishedAt, waitMinutes,
// durationMinutes } } — the payload the Integration log line records. Its status is one of the
// five above; startRung/rung/climbs pass integration.rung through (integrationRung), rungDrift is '', and
// ran lists its agents, each on the ladder's top rung.
// =============================================================================

// ---- Structured schemas (replace the old sentinel strings) ------------------

const PLAN_VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ready: { type: 'boolean', description: 'true when a complete plan was produced' },
    blocked: { type: 'boolean', description: 'true if the task is malformed / unrecoverable' },
    blockerCause: { type: 'string', description: 'one-line cause when blocked, else empty string' },
    plan: { type: 'string', description: 'full structured plan text (Files to modify, Test strategy, Sibling-site check, Caller-wiring, Edge cases, Risks, Gated inputs). Empty string if blocked.' },
  },
  required: ['ready', 'blocked', 'blockerCause', 'plan'],
}

const PLAN_JUDGE = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    feedback: { type: 'array', items: { type: 'string' }, description: '3–8 specific bullets when verdict is changes; empty when approve' },
  },
  required: ['verdict', 'feedback'],
}

const IMPL_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verified: { type: 'boolean', description: 'true if the verifier reached the accepted green state (exit 0, or — when a baseline manifest is present — only known-baseline tests fail, each matching its listed reason) before the PR was opened' },
    blocked: { type: 'boolean', description: 'true if Ralph exhausted max iterations or the worktree was unsafe' },
    escalate: { type: 'boolean', description: 'true ONLY when your instructions gave you a ONE-SHOT verifier run and it was red — the task climbs one rung and hands over. Always false when you ran the full verification loop or did no implementation.' },
    prUrl: { type: 'string', description: 'PR URL, or empty string when blocked / read-only' },
    branch: { type: 'string', description: 'branch name, or empty string' },
    worktreePath: { type: 'string', description: 'absolute worktree path from git rev-parse --show-toplevel' },
    blockerDiagnosis: { type: 'string', description: 'one-paragraph diagnosis when blocked, else empty string' },
    summary: { type: 'string', description: 'one-paragraph summary of what changed and was tested' },
    gatedInputs: { type: 'array', items: { type: 'string' }, description: 'ONLY when you stopped before a gated action (ADR 0008): one line per human authorisation the task needs that the note\'s "## Approved gates" does not cover ("spend: <what> — cap <amount>" / "credential: <what>" / "irreversible: <what>"). Omit or empty otherwise.' },
  },
  required: ['verified', 'blocked', 'escalate', 'prUrl', 'branch', 'worktreePath', 'blockerDiagnosis', 'summary'],
}

const REVIEW_VERDICT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    feedback: { type: 'array', items: { type: 'string' }, description: '3–8 specific bullets when verdict is changes; empty when approve' },
  },
  required: ['verdict', 'feedback'],
}

// ---- Shared prompt fragments ------------------------------------------------

// Git environment scrub (p12-3, the 2026-09-23 leak). Agents and verifiers inherit the Claude Code
// process env; an exported GIT_DIR, GIT_WORK_TREE & co. overrides `git -C` and every cwd, so a command
// "in the worktree" runs against whatever repo the variable names. Pointed at a worktree's gitdir, that is
// the SHARED repository (commondir): on 2026-09-23 a test fixture's commits, `core.bare=true` and
// `git push origin` all landed on the real repo and its GitHub remote. Every engine-rendered command that
// runs git or the verifier starts with GIT_ENV_SCRUB (the form land.sh uses; `2>/dev/null` keeps zsh's
// "unset: not enough arguments" quiet when git is missing, and `;` still runs the command). Each Bash call
// starts from the inherited env, so the prefix covers only its own command. Declared before
// BUG_PREFLIGHTS, which interpolates it at module load. Adding it changed every agent prompt's bytes, so a
// resumeFromRunId resume of a pre-p12-3 run re-runs its agents (tests/default-branch.test.mjs).
const GIT_ENV_SCRUB = 'unset $(git rev-parse --local-env-vars 2>/dev/null);'

// A command with GIT_ENV_SCRUB in front, unless it already starts with it (never double-prefixed).
function scrubbed(cmd) {
  return String(cmd).trimStart().startsWith(GIT_ENV_SCRUB) ? cmd : `${GIT_ENV_SCRUB} ${cmd}`
}

// The agents' side of the scrub: only rendered commands carry the prefix mechanically, so every agent
// prompt (all 10 builders, task-tree agents and judges included) carries this rule. Static text.
const GIT_ENV_RULE = `Git environment (hard rule, the 2026-09-23 leak): every Bash call starts from the inherited
environment, so an \`unset\` in one call never carries into the next. Start EVERY Bash command that runs git
or the verifier, in a worktree OR in the main checkout, with \`${GIT_ENV_SCRUB}\`. The commands
rendered in this prompt already carry it. NEVER set or export GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
GIT_COMMON_DIR (or any GIT_* location variable) to point at the project repo, its .git, a worktree or a
worktree's gitdir. The main checkout and every linked worktree share ONE repository (refs, config, remote)
through commondir, so a run that way commits, flips core.bare and pushes against the shared repo and its
real remote. To test behaviour under an exported GIT_* variable, build a throwaway repo under
\`mktemp -d\` whose only remote is a local bare repo, and point the variable there.`

// Removing files (the 2026-10-01 stall). Claude Code's dangerous-removal check is bypass-immune: it asks a
// person about an `rm` whose target it cannot resolve statically even in bypass mode, and nothing times the
// ask out. An unattended agent ran `mkdir -p /tmp/x && cd /tmp/x && rm -rf ./* && …` and its rollout waited
// 13 h on the ask. The estate's PreToolUse hook (`_shared/hooks/check-dangerous-rm.sh`, fixtures in
// `_shared/hooks/tests/run-dangerous-rm-fixtures.sh`) refuses those shapes; this rule saves the agent the
// round trip. Both forms it names for a `mktemp -d` directory pass that hook: `"$T"` with no trailing slash
// leaves it no slash shape to flag, and `${T:?}` is a guard. Every agent prompt (all 10 builders) renders it
// right after GIT_ENV_RULE. A single-quoted one-line string, so nothing in it is interpolated; it has no git
// span, so the scrub rule's span check is unaffected.
const RM_RULE = 'Removing files (hard rule, the 2026-10-01 stall): remove a scratch directory by its literal absolute path (`rm -rf /tmp/x && mkdir -p /tmp/x`); for a `mktemp -d` directory, whose path is not known when you write the command, remove the directory itself by its variable with no trailing slash (`rm -rf "$T"`) or guard the variable (`rm -rf "${T:?}"/*`). Never `cd` into a directory and then remove a relative glob (`rm -rf ./*`), and never remove a path that starts with an unguarded `$VAR/` or a command substitution: Claude Code asks a person about those even in bypass mode, and an unattended run stalls on the ask.'

// The read-only agents' side of the pinned task tree (ADR 0030, p12-4). The planner, plan judge, plan
// reviser and investigator all work in the task's ONE worktree (taskTreeSetup below), which the
// implementer then builds in — so what they may touch there is narrow: read under the tree, map the
// note's checkout paths onto it, and tidy ONLY what their own verifier run added (a before/after
// status diff), never the env bootstrap's output or anything else already present. Static text; its
// one git span is scrubbed like every other.
const TASK_TREE_RULE = `Task tree (hard rule, ADR 0030): this task has ONE worktree, the \`Task tree:\` path above, shared by
every agent on the task; the implementer builds in it after you, so you edit nothing in it.
(i) Read every repo file under the task tree, never the project's shared checkout (it may be stale, dirty
    or on another branch).
(ii) The task note may cite paths in some checkout of this repo (e.g. \`~/repos/<repo>/skills/x.md\`): map
    each to the same repo-relative path under the task tree.
(iii) If you run the verifier, tidy only after your own run: take
    \`${GIT_ENV_SCRUB} git -C "<task tree>" status --porcelain\` immediately before and immediately after it,
    then revert only the tracked changes, and delete only the untracked paths,
    that appear in the after list but not the before list.
(iv) Never delete or revert anything that was present before your run, including the env bootstrap's
    output (an in-project venv or node_modules): the implementer reuses this tree.
(v) If the tree disappears mid-run (a "cannot change to" or "not a git repository" error on
    it), re-run the setup command above once, say so in your output, and continue.`

// The bug classes reviewers caught in the giflab rollout — every code-writing
// agent gets these as explicit preflight checks before opening/updating a PR.
const BUG_PREFLIGHTS = `
Before you open or update a PR, run these preflight checks:
- Dead code: if you add a new function/helper, verify it has at least one PRODUCTION caller, not just tests.
- No-op assertions: if you write a bounded assertion, check whether upstream code already clamps to the same bounds — if so your assertion tests nothing.
- Sibling-site blindness: after a fix, grep the whole file AND codebase for the same code shape; fix every sibling occurrence in this PR (or justify leaving them).
- Worktree safety: run \`${GIT_ENV_SCRUB} git rev-parse --show-toplevel\` and confirm it is NOT the project's main checkout. Run \`${GIT_ENV_SCRUB} git diff --stat\` and confirm every modified path is in your task's scope — if you see unrelated files, STOP and report instead of committing.
- Worktree path discipline: your worktree root is the absolute path \`${GIT_ENV_SCRUB} git rev-parse --show-toplevel\` prints — call it $WT. Every Read/Edit/Write MUST target a path UNDER $WT (e.g. \`$WT/src/foo.py\`). Edit requires an absolute path — do NOT absolutize against the project root you were handed (that is the MAIN checkout): an edit to a \`<project-root>/…\` path lands in the main checkout, OUTSIDE your branch and invisible to your PR — which looks exactly like a "silent Edit no-op" but is really a wrong-tree edit. After editing, \`${GIT_ENV_SCRUB} git -C $WT diff\` MUST show your change; if it does not, you edited the wrong tree — redo it against the \`$WT/…\` path.`.trim()

// Re-dispatch awareness. A resumed blocked task carries the prior attempt's diagnosis in its note —
// reconcile-rollout.py appends `## Review-blocked feedback` / `## Blocker diagnosis` / `## Plan-blocked
// feedback`, and /thread:repair may inject a `## Repair input` with a human decision. Without an explicit
// nudge the agent can re-read the note and silently repeat the rejected work. This line is static (always
// in the prompt) and harmless on a fresh task where no such section exists.
const PRIOR_FEEDBACK_NOTE = `If the task note has a "## Review-blocked feedback", "## Blocker diagnosis", "## Plan-blocked feedback", or "## Repair input" section from a PRIOR attempt, treat it as AUTHORITATIVE — resolve every point in it first, and use any "## Repair input" value exactly as given (do not re-derive or second-guess it).`

// Gated inputs (ADR 0008): API spend, credentials, and irreversible actions are decisions no agent may
// make. Two faces of one rule — the PLAN declares them up front (a required "### Gated inputs" section,
// enforced by the plan-judge), and every code-writing agent stops BEFORE any gated action it finds
// undeclared/unapproved (the plan_approval:false path). Both are STATIC prompt text — always rendered,
// a required contract, not an optional feature — and the ENGINE enforces the pause: parseGatedInputs /
// unapprovedGates below turn a non-empty unapproved declaration into a 'gate-pending' stop regardless
// of plan_approval config or continuous mode (list items only — prose in the section is commentary,
// ADR 0013). Approval lives durably on the task note ("## Approved
// gates", passed in as task.approvedGates), so re-dispatches never re-ask those exact gates.
const GATED_INPUTS_CHECK = `Gated inputs (hard rule — ADR 0008): BEFORE any gated action, identify every human authorisation this
task needs — API spend (a hard cap is mandatory), credentials, or an irreversible action. If the task
note's "## Approved gates" section covers ALL of them, proceed — an approved cap is a CEILING to respect,
never a target (blowing it is a verifier/review failure, not a re-ask). Otherwise STOP BEFORE the gated
action: no spend, no credential use, no irreversible step, no PR. Return blocked=true with one line per
missing gate in gatedInputs ("spend: <what> — cap <amount>" / "credential: <what>" / "irreversible:
<what>") and name them in blockerDiagnosis — a human signs off on the note and you'll be re-dispatched.
No operator override elsewhere in this prompt (release/hold gates) ever overrides THIS rule.`

// Parse the plan's "### Gated inputs" section (any ##–#### level). Only TOP-LEVEL markdown list items
// ("- " / "* " / "+ " / "1. " / "1) " at indent < 2) count as declarations — prose, footnotes, and
// nested sub-bullets are commentary, never a gate (observed live 2026-09-01: a planner footnote after
// bullets restating approved gates was captured as a phantom gate and paused a fully signed-off task;
// ADR 0013). An indented non-list line directly under a gate is a soft-wrap continuation and is joined
// back on, so a wrapped spend gate never loses its mandatory cap. "None" counts only when a line (or
// bullet) is EXACTLY "None" — an embellished "None yet, but …" is not a clean declaration. Returns
// null when the section is MISSING or carries no parseable declaration — no top-level list items and
// no exact "None" — so a gate written ONLY as prose can never silently pass: the caller fails closed
// to plan-blocked and a re-plan under the bullets-only prompt self-heals. Returns [] for an explicit
// "None", else the declared gate lines (markers stripped, wraps rejoined).
function parseGatedInputs(planText) {
  const lines = (planText || '').split('\n')
  const start = lines.findIndex((l) => /^#{2,4}\s+gated inputs\b/i.test(l.trim()))
  if (start === -1) return null
  const out = []
  let sawNone = false
  let open = false // the previous consumed line was a gate (or its wrap) — continuation may attach
  for (let i = start + 1; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (/^#{1,6}\s/.test(line)) break // next heading ends the section
    if (!line) { open = false; continue } // a blank line ends any soft-wrap
    const indent = raw.length - raw.replace(/^[ \t]+/, '').length
    const m = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/)
    if (m && indent < 2) { // top-level list item — a declaration (or an explicit None)
      const bare = m[1].trim()
      if (/^none\.?$/i.test(bare)) { sawNone = true; open = false; continue }
      if (bare) { out.push(bare); open = true } else open = false
      continue
    }
    if (!m && indent >= 2 && open) { out[out.length - 1] += ' ' + line; continue } // soft-wrap — keep the cap
    // everything else — prose, footnotes, nested sub-bullets — is commentary, never a gate
    if (/^none\.?$/i.test(line)) sawNone = true
    open = false
  }
  return out.length || sawNone ? out : null // no items, no exact None — fail closed, same as missing
}

// A gate matches an approval on normalized text (whitespace-collapsed, case-insensitive, any
// "(approved …)" annotation stripped). Deliberately EXACT beyond that: a changed cap is a NEW gate.
function normalizeGate(s) {
  return String(s || '')
    .replace(/^[-*]\s+/, '')
    .replace(/\s*\(approved [^)]*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function unapprovedGates(declared, approved) {
  const ok = new Set((approved || []).map(normalizeGate))
  return (declared || []).filter((g) => !ok.has(normalizeGate(g)))
}

function gateDiagnosis(gates) {
  return 'gated inputs await human sign-off (a declared gate always pauses — ADR 0008):\n'
    + gates.map((g) => '- ' + g).join('\n')
}

// The signed-gate continuation (p12-14, execute § 3.7). After `approve-gates`, the lead resumes the
// gate-pending call with resumeFromRunId and task.approvedGates added, so every agent() up to the stop
// replays from cache — the stopped implementer or reviser included, with its cached
// { blocked: true, gatedInputs: [G] }. Every G is now approved, so that block is neither a gate stop nor
// hardness (a gate stop never climbs, §3.7): the stopped prompt is re-dispatched, on the same rung (its
// model and effort), schema and phase, with this STATIC block appended. It carries no gate text, so
// approvedGates still never reaches a prompt (pinned by approved-gates-resume.test.mjs). The same continuation answers a
// fresh run whose agent stops for gates the note already approved (ADR 0008's agent-fixable slip).
// Bounded per site by the gates already continued past there, not by a count: an agent can find gates one
// after another (A stops for G; G signed; B's continuation stops for G2; G2 signed; C replays both stops
// from cache), so a signed stop that names a gate not yet passed at this site gets one more continuation —
// at most one per distinct approved gate. A signed stop that repeats only gates already passed takes the
// old path: it is the stage's evidence of hardness, so it climbs (a no-op on the top rung) and retries once.
const SIGNED_GATES_RESUME = `RESUMED AFTER SIGN-OFF (ADR 0008): an earlier dispatch of this same prompt stopped before a gated
action. A human has since signed those gates off: re-read the task note's "## Approved gates" section, then
do the work. Each approved cap is a ceiling, never a target. A gate that section does not cover still stops
you, exactly as the gated-inputs rule above says.`

// A stop for gated inputs every one of which the note has since approved.
function signedStop(task, r) {
  return !!r && !r.__dead && !!r.blocked && Array.isArray(r.gatedInputs) && r.gatedInputs.length > 0 &&
    unapprovedGates(r.gatedInputs, task.approvedGates).length === 0
}

// r unchanged, unless it is a signedStop: then continuations past the sign-off while each stop names a gate
// not yet passed at this site (see above). The n-th is labelled `<label> signed` (n = 1) or
// `<label> signed <n>`; each carries the same bytes, the stopped prompt plus SIGNED_GATES_RESUME. st (the
// rung state) records each continuation in the row's `ran`.
async function pastSignedGates(task, r, prompt, opts, st) {
  const passed = new Set()
  for (let n = 1; signedStop(task, r) && r.gatedInputs.some((g) => !passed.has(normalizeGate(g))); n++) {
    for (const g of r.gatedInputs) passed.add(normalizeGate(g))
    log(`${opts.label}: stopped for gates already signed off — continuation ${n} past the sign-off (ADR 0008)`)
    r = await runAgent(prompt + '\n\n' + SIGNED_GATES_RESUME, { ...opts, label: opts.label + (n === 1 ? ' signed' : ` signed ${n}`) }, st)
  }
  return r
}

// Known-baseline-failures manifest (item 2). When the rollout declares tests that already fail on a clean
// `main` for environmental reasons, every agent gets this so N agents don't each independently re-diagnose
// the same reds. Returns "" when empty so the surrounding prompt is BYTE-IDENTICAL to pre-item-2 behaviour
// (the resume-cache invariant) — the non-empty string carries its OWN leading "\n\n", so callers
// interpolate it bare (`${BUG_PREFLIGHTS}${baselineManifest(a)}`) with no surrounding whitespace.
function baselineManifest(a) {
  const reds = a.knownBaselineFailures
  if (!reds || !reds.length) return ''
  return `

This repo has KNOWN BASELINE FAILURES — tests that already fail on a clean \`main\` for pre-existing,
environmental reasons. They are NOT in your scope:
${reds.map((b) => '- ' + b).join('\n')}
Do NOT try to fix them, do NOT flag them as findings, and do NOT \`--deselect\`/skip them (that would hide a
real regression). Keep running the full verifier; only a NEW failure — or a baseline test failing in a way
that does not match its listed reason — is yours to act on.`
}

// Per-task human/release gate override (per-task-override-channel). Some task notes carry a prose gate
// ("don't action until a release ships", "hold for sign-off"); without a structured override an agent may
// refuse mid-dispatch. When the skill resolves ignore_gate for a task, the engine tells the agent that gate
// is deliberately overridden for THIS run. Empty when unset ⇒ prompts render BYTE-IDENTICAL to pre-feature
// behaviour (resume-cache invariant); the non-empty string carries its OWN leading "\n\n" so callers
// interpolate it bare (`…${baselineManifest(a)}${gateOverride(task)}`).
function gateOverride(task) {
  if (!task.ignoreGate) return ''
  return `

OPERATOR OVERRIDE: this task note may carry a human/release gate (e.g. "do not action until a release ships",
"hold for sign-off"). For THIS run that gate is EXPLICITLY OVERRIDDEN by the operator — do not refuse or pause
on account of it; proceed with the task as specified.`
}

// baseline (item 2): array of "test_id — reason" lines, or empty/undefined. When empty the returned text is
// BYTE-IDENTICAL to the pre-item-2 template (resume-cache invariant — do NOT edit the empty branch below).
function ralphLoop(verifier, maxIterations, baseline) {
  if (baseline && baseline.length) {
    return `
Verification loop (Ralph-style):
- Verifier: ${scrubbed(verifier)}
- Max iterations: ${maxIterations}
- KNOWN BASELINE FAILURES (pre-existing, environmental — NOT yours; keep running the full verifier, do NOT
  \`--deselect\`/skip them — that hides real regressions):
${baseline.map((b) => '  - ' + b).join('\n')}
- For i = 1 .. ${maxIterations}:
  a. Run the verifier.
  b. GREEN CRITERION (baseline-aware): the work is verified when EVERY failing test is in the known-baseline
     set above (fewer is fine — a baseline red going green is GOOD, never a failure; a baseline entry absent
     from this run is simply ignored). Treat that state as "pass" and stop the loop.
  c. On a REAL failure — a test OUTSIDE the baseline set fails, OR a baseline test fails in a way that does
     NOT match its listed reason (when unsure whether it matches, treat it as a NEW failure: fail-closed) —
     read the output, diagnose the ROOT cause (not the surface symptom), apply a targeted fix, and commit it
     on the branch (so history records each attempt).
  d. If i == ${maxIterations} and a REAL (non-baseline) failure still remains: do NOT open/update a PR.
     Return a result with blocked=true, verified=false, and a one-paragraph blockerDiagnosis of what you
     tried and why it did not converge. Also append that diagnosis to the task note under a "## Blocker diagnosis" heading.`.trim()
  }
  return `
Verification loop (Ralph-style):
- Verifier: ${scrubbed(verifier)}
- Max iterations: ${maxIterations}
- For i = 1 .. ${maxIterations}:
  a. Run the verifier.
  b. If it passes (exit 0): stop the loop, the work is verified.
  c. On failure: read the output, diagnose the ROOT cause (not the surface symptom),
     apply a targeted fix, and commit it on the branch (so history records each attempt).
  d. If i == ${maxIterations} and it still fails: do NOT open/update a PR. Return a result with
     blocked=true, verified=false, and a one-paragraph blockerDiagnosis of what you tried and why
     it did not converge. Also append that diagnosis to the task note under a "## Blocker diagnosis" heading.`.trim()
}

// A first pass below the top rung does NOT iterate — one verifier run, then either green or a hand-over one
// rung up. Iteration is evidence of hardness, and iteration runs on the rung above (see The ladder below).
// baseline: same "test_id — reason" array as ralphLoop; the green criterion stays baseline-aware.
function oneShotVerify(verifier, baseline) {
  const green = baseline && baseline.length ? `
- KNOWN BASELINE FAILURES (pre-existing, environmental — NOT yours; keep running the full verifier, do NOT
  \`--deselect\`/skip them — that hides real regressions):
${baseline.map((b) => '  - ' + b).join('\n')}
- GREEN CRITERION (baseline-aware): the work is verified when EVERY failing test is in the known-baseline
  set above (fewer is fine — a baseline red going green is GOOD, never a failure; a baseline entry absent
  from this run is simply ignored).` : `
- GREEN CRITERION: the verifier exits 0 — the work is verified.`
  return `
Verification (ONE-SHOT first pass — you do NOT iterate):
- Verifier: ${scrubbed(verifier)}
- Run the verifier EXACTLY ONCE.${green}
- If green: the work is verified — proceed.
- If red (any failure outside the green criterion): do NOT attempt a fix, do NOT run the verifier again,
  and do NOT open/update a PR. Commit your work so far on the branch (so the next rung inherits it),
  append a one-paragraph diagnosis of the failure to the task note under a "## Blocker diagnosis"
  heading, and return escalate=true, verified=false, blocked=false with the same diagnosis in
  blockerDiagnosis. The next rung up (a stronger model or more effort) picks up your worktree and
  iterates from there.`.trim()
}

// Rung-selected verification block for code-writing prompts (ADR 0029 decision 3): the implement stage's
// first pass BELOW the top rung gets the one-shot (hand over one rung up on the first red); the retry after
// the stage's climb, and every pass on the top rung, get the full Ralph loop — on the top there is no rung
// to hand to.
function verifyBlock(st, verifier, maxIterations, baseline) {
  return !onTop(st) && !climbOf(st, 'implement')
    ? oneShotVerify(verifier, baseline)
    : ralphLoop(verifier, maxIterations, baseline)
}

// Escalation hand-over context (empty-when-unused, like baselineManifest/gateOverride — the non-empty
// string carries its OWN leading "\n\n" so callers interpolate it bare). `prior` is the first-pass
// attempt's diagnosis/feedback verbatim.
// `st` and the builder's own `stage` decide the framing, so no caller can pick the wrong one: when that
// stage's climb MOVED the task, this is a takeover one rung up; anything else with a prior is the stage's
// climb recorded as a no-op on the top rung, so a same-rung second pass. `kind` picks the body: the
// code-writing roles (none given) get the verification loop and the committed work on their branch; the
// read-only investigator ('readonly') and the planner ('planner') work in the task tree with no source
// edits, no commits and no PR, so their two arms restate that contract and never mention verification or
// a branch. Both arms keep their marker (SECOND PASS, ONE RUNG UP) whatever the kind.
function escalationContext(prior, st, stage, kind) {
  if (!prior) return ''
  const c = climbOf(st, stage)
  const moved = !!(c && c.from !== c.to)
  if (kind === 'readonly' || kind === 'planner') {
    const work = kind === 'planner' ? 'plan' : 'investigation'
    const contract = kind === 'planner'
      ? 'The plan-only contract above still holds in full: produce the plan, write no code — no source edits, no commits, no PR.'
      : 'The read-only contract above still holds in full: no source edits, no commits, no PR.'
    if (!moved) return `

SECOND PASS: a first attempt at this ${work} did not complete, and you own it from here. This
task is on the ladder's top rung, so there is no hand-over — finish the ${work} yourself.
${contract}
The prior attempt's diagnosis (verbatim):
${prior}`
    return `

ESCALATION: you take this ${work} over ONE RUNG UP (a stronger model or more effort) — a first-pass attempt
one rung down did not complete it, and you own it from here.
${contract}
The prior attempt's diagnosis (verbatim):
${prior}
Do not blindly repeat the failed approach.`
  }
  if (!moved) return `

SECOND PASS: a first attempt did not land this task, and you own it from here. This task is on
the ladder's top rung, so there is no hand-over: run the FULL verification loop and finish the work.
The prior attempt's diagnosis (verbatim):
${prior}
Any committed work from that attempt is already on your branch — build on or replace it as the diagnosis
warrants.`
  return `

ESCALATION: you take this task over ONE RUNG UP (a stronger model or more effort) — a first-pass attempt
one rung down did not land it, and you own it from here. The prior attempt's diagnosis (verbatim):
${prior}
Any committed work from that attempt is already on your branch — build on or replace it as the diagnosis
warrants; do not blindly repeat the failed approach.`
}

// ---- Review-round memory (review-loop-memory, 2026-08-14) --------------------
// The review loop used to hand each reviser ONLY the latest rejection and judge each round fresh —
// whack-a-mole (fix B, regress A) and judge goalpost-moving were unguarded, the exact failures the
// plan loop was hardened against (giflab p6-2 rode to its 4-round ceiling). Both fragments below are
// empty-when-unused with their OWN leading "\n\n" (like baselineManifest/escalationContext), so a
// round-1 judge prompt and a no-history render stay BYTE-IDENTICAL to the pre-feature templates.

function groupedRounds(priorFeedback) {
  return priorFeedback
    .map((r) => `Round ${r.round} rejection:\n${r.feedback.map((f) => '- ' + f).join('\n')}`)
    .join('\n\n')
}

// Judge side: the accumulated history of the judge's OWN prior rejections plus an anti-goalpost
// discipline. A regression of an earlier fix is grounds for rejection; a brand-new objection that was
// visible in round 1 is not — that path rides tasks to the ceiling.
function reviewHistoryBlock(priorFeedback) {
  if (!priorFeedback || !priorFeedback.length) return ''
  return `

Prior review rounds — ACCUMULATED history of your earlier rejections on this PR (each since addressed
by commits on the branch):
${groupedRounds(priorFeedback)}

Discipline for this round:
- VERIFY each earlier concern is still resolved — a regression of an earlier fix is grounds for rejection.
- Do not contradict guidance you gave in an earlier round.
- A NEW objection justifies "changes" ONLY if the new commits introduced it, or it was genuinely not
  visible earlier. Anything you could have raised in round 1 but didn't is a nitpick — note it in your
  feedback if you must, but do not reject on it.`
}

// After this many accumulated rejections the reviser prompt upgrades to a STEP-BACK round. Fixed in
// the engine, deliberately not rollout config (this encodes when patching has demonstrably failed, not a
// per-rollout preference).
const STEP_BACK_AFTER = 2

// Reviser side, round 3+: licence to restructure — the re-planning lever WITHOUT re-entering the plan
// gate mid-worktree. planText is the original approved plan for a plan-gated task ('' otherwise; the
// licence then runs against the task brief alone). The brief stays the contract; the plan is reference,
// not law — deviations must be DECLARED so the reviewer (who sees the same history) judges them open-eyed.
function stepBackBlock(priorFeedback, planText) {
  if (!priorFeedback || priorFeedback.length < STEP_BACK_AFTER) return ''
  const plan = planText ? `

The ORIGINAL APPROVED PLAN, for reference:
---
${planText}
---` : ''
  return `

STEP-BACK ROUND: ${priorFeedback.length} review rounds have not converged — stop patching, step back.
Re-read the task brief${planText ? ' and the original approved plan below' : ''}. You are LICENSED to
restructure the approach${planText ? ' — including deviating from the approved plan —' : ''} where the
accumulated feedback demands it, rather than only applying this round's bullets. The brief remains your
contract${planText ? '; the plan is reference, not law' : ''}. State every ${planText ? 'deviation from the plan' : 'structural change of approach'}
explicitly in the PR body and your summary so the reviewer judges it with eyes open.${plan}`
}

// ---- Prompt builders (5 variants, inlined; this file cannot read .md at runtime) ----

function implementerPrompt(task, a, st, prior) {
  return `You're picking up [[${task.slug}]] from the rollout at [[${a.rolloutSlug}]].

Task note: ${task.taskPath}
Project root: ${a.repoPath}

${worktreeSetup(a, task)}

${GIT_ENV_RULE}

${RM_RULE}

Steps:
1. Read the task note in full + every source file it references. Do not skim. ${PRIOR_FEEDBACK_NOTE}
2. If the fix is well-defined, work test-first (write the failing test before the fix). Use the
   superpowers:test-driven-development skill if applicable.
3. If the task is investigation-first, produce findings, propose a fix in the task note, then implement.
4. ${verifyBlock(st, task.verifier || a.verifier, task.maxIterations, a.knownBaselineFailures)}
5. If the verifier passed: open a PR titled \`audit-fix: <task subject>\`. The body must link the task
   note and explain what changed and why.
6. Return your structured result: verified, blocked, escalate (as your verification block instructs;
   false otherwise), prUrl, branch, worktreePath (from \`${GIT_ENV_SCRUB} git rev-parse --show-toplevel\`),
   blockerDiagnosis (empty if not blocked), and a one-paragraph summary.

${BUG_PREFLIGHTS}

${GATED_INPUTS_CHECK}${baselineManifest(a)}${gateOverride(task)}${escalationContext(prior, st, 'implement')}

Do not update the task's \`status:\` yourself — the lead session reconciles that after review.`
}

function readOnlyPrompt(task, a, st, prior) {
  return `You're picking up [[${task.slug}]] from the rollout at [[${a.rolloutSlug}]]. This is a
READ-ONLY task (scope: read-only) — investigation / audit, NO source edits, NO PR.

Task note: ${task.taskPath}
Task tree: ${worktreeDir(a.repoPath, task.slug)}

${taskTreeSetup(a, task, true)}

Investigate READ-ONLY in this task tree — do NOT modify any source files, do NOT commit, do NOT open a PR.

${TASK_TREE_RULE}

${GIT_ENV_RULE}

${RM_RULE}

Steps:
1. Read the task note in full + every file it references (under the task tree).
2. Run the read-only investigation it asks for (greps, reading tests, and a baseline verifier run to OBSERVE:
   run it as \`${scrubbed(task.verifier || a.verifier)}\` from the task tree).
3. Append your findings to the task note under a "## Findings" heading, starting with
   \`Investigated on: <sha from the setup's tree base: line>\` followed verbatim by any \`tree NOT refreshed:\`
   line the setup printed — concrete, with file:line refs.
4. Return your structured result: verified=true (findings produced) or blocked=true (could not complete),
   escalate=false, prUrl="", branch="", worktreePath="${worktreeDir(a.repoPath, task.slug)}" (the task tree),
   blockerDiagnosis (empty unless blocked), and a one-paragraph summary of what you found.${baselineManifest(a)}${escalationContext(prior, st, 'implement', 'readonly')}`
}

function plannerPrompt(task, a, st, prior) {
  return `You're picking up [[${task.slug}]] from the rollout at [[${a.rolloutSlug}]].

This task is GATED ON PLAN APPROVAL. In this dispatch you produce a structured plan ONLY — DO NOT write
any code, DO NOT open a PR, DO NOT modify source files. A judge will review your plan and either approve it
(you'll be re-dispatched to implement) or send it back for revision.

Task note: ${task.taskPath}
Task tree: ${worktreeDir(a.repoPath, task.slug)}

${taskTreeSetup(a, task, true)}

Investigate READ-ONLY in this task tree (no source edits, no commits) — you are producing a plan only; the
implementer builds in this same tree later, so the plan is made on the base the code is built on.

${TASK_TREE_RULE}

${GIT_ENV_RULE}

${RM_RULE}

Steps:
1. Read the task note in full + every source file it references. Do not skim. ${PRIOR_FEEDBACK_NOTE}
2. Read-only investigation to back the plan:
   - grep for sibling sites of the same anti-pattern across the file + codebase
   - identify callers of any function you intend to change/add
   - run the verifier ONCE from the task tree to capture the baseline (\`${scrubbed(a.verifier)}\`) — observe only, write no fix code
   - skim related tests
3. Produce a plan whose FIRST line is \`Planned on: <sha from the setup's tree base: line>\`, followed verbatim
   by any \`tree NOT refreshed:\` or \`tree NOT attached\` line the setup printed, then EXACTLY these
   sub-sections, concrete not abstract:
   ### Files to modify  (repo-relative path: one-line rationale)
   ### Test strategy    (test-first? which failing test first? which existing tests assert this?)
   ### Sibling-site check (the anti-pattern; verbatim greps run + counts; all sibling occurrences in scope)
   ### Caller-wiring     (what calls the new/changed surface; grep proof; are tests the only callers?)
   ### Edge cases        (explicit list)
   ### Risks / unknowns  (what could go wrong; what you want the reviewer to weigh in on)
   ### Gated inputs      (REQUIRED — one markdown bullet ("- ") per human authorisation the task needs:
                          "- spend: <what> — cap <amount>" (a hard cap is mandatory), "- credential: <what>",
                          "- irreversible: <what>"; or exactly "None". BULLETS ONLY — no prose, commentary,
                          or footnotes in this section: the engine reads only list lines, and anything else
                          is rejected. A non-empty declaration pauses the task for human sign-off —
                          regardless of config or continuous mode (ADR 0008). If the task note carries a
                          "## Approved gates" section, restate each still-needed approved gate VERBATIM as
                          a bullet (without its "(approved …)" annotation) — restated approved gates do not
                          re-pause; only NEW gates do.)
4. Return your structured result: ready=true with the full plan text in \`plan\`, blocked=false, blockerCause="".

If during investigation you find the task is fundamentally malformed (impossible, contradicts a committed
change, etc.), append a one-paragraph diagnosis to the task note under "## Blocker diagnosis" and return
ready=false, blocked=true, blockerCause="<one line>", plan="".${baselineManifest(a)}${gateOverride(task)}${escalationContext(prior, st, 'plan', 'planner')}`
}

function planJudgePrompt(task, planText, a) {
  return `You are reviewing an implementation PLAN (no code written yet) for [[${task.slug}]] from the
rollout [[${a.rolloutSlug}]]. Apply rigorous judgement — your job is to catch a weak plan before any code
is written.

Task note (the brief to judge against): ${task.taskPath}
Task tree: ${worktreeDir(a.repoPath, task.slug)}

${taskTreeSetup(a, task, false)}

The plan to review:
---
${planText}
---

Base check first: your setup printed \`tree base: <sha>\`. Compare it with the plan's \`Planned on:\` line. If
they differ, or the plan has none, the tree was recreated or moved since planning: say so as the first line
of your feedback, re-check the plan's claims against this tree, and return "changes" if any no longer holds.
If the plan quotes a \`tree NOT refreshed:\` or \`tree NOT attached\` line, surface it in your feedback.

Check, against the task brief:
- Does the plan actually address the brief?
- Are the listed files reasonable and complete?
- Sibling-site check done properly (greps run, all occurrences accounted for)?
- Caller-wiring check done (dead-code prevention — is the new surface actually called in production)?
- Are the edge cases the right ones?
- Are the stated risks/unknowns the real ones?
- Does the plan carry the required "### Gated inputs" section — either exactly "None" or concrete gate
  BULLETS ("- spend: … — cap …" WITH a hard cap / "- credential: …" / "- irreversible: …")? A missing
  section, a spend gate without a cap, or non-bullet prose in the section (the engine reads only list
  lines — a gate written as prose is rejected, and commentary does not belong there) is an
  automatic "changes" (ADR 0008). Also flag a gate the brief implies but the plan omits.

${TASK_TREE_RULE}

${GIT_ENV_RULE}

${RM_RULE}

Read the brief and grep the task tree as needed to verify the plan's claims — do not approve on faith.
Decide: verdict "approve" if the plan is sound (clean or trivially nitpicky), else "changes" with 3–8
specific, actionable feedback bullets.`
}

function planReviserPrompt(task, priorPlan, priorFeedback, round, a) {
  const grouped = groupedRounds(priorFeedback)
  return `PLAN REVISION ROUND ${round}: a reviewer requested changes to your prior plan for [[${task.slug}]]
(rollout [[${a.rolloutSlug}]]). Still plan-only — NO code, NO PR, NO source edits.

Task note: ${task.taskPath}
Task tree: ${worktreeDir(a.repoPath, task.slug)}

${taskTreeSetup(a, task, false)}

Your prior plan:
---
${priorPlan}
---

Feedback to address — ACCUMULATED across every prior review round. Every bullet still applies unless your
revision demonstrably resolves it; do not drop an earlier round's concern to satisfy a later one:
${grouped}

${TASK_TREE_RULE}

${GIT_ENV_RULE}

${RM_RULE}

Run additional READ-ONLY investigation in the task tree as needed. Rewrite the plan so that its
FIRST line is \`Planned on: <sha from your setup's tree base: line>\`, followed verbatim by any \`tree NOT
attached\` line the setup printed and any \`tree NOT refreshed:\` line your prior plan quoted, with the SAME required sub-sections
(Files to modify / Test strategy / Sibling-site check / Caller-wiring / Edge cases / Risks /
Gated inputs — bullets only: declare spend with a hard cap, credentials, irreversible actions, or
exactly "None").
Return ready=true with the rewritten plan in \`plan\`. If you discover the task is unrecoverable, return
ready=false, blocked=true, blockerCause="<one line>".`
}

function approvedPlanImplementerPrompt(task, planText, a, st, prior) {
  return `PLAN APPROVED for [[${task.slug}]] (rollout [[${a.rolloutSlug}]]). Implement the approved plan below.

Task note: ${task.taskPath}
Project root: ${a.repoPath}

${worktreeSetup(a, task)}

${GIT_ENV_RULE}

${RM_RULE}

The approved plan:
---
${planText}
---

Implement the plan as written. Do NOT re-plan or substantially deviate. Minor refinements within the
plan's spirit (a slightly different test name, a one-line helper not listed) are fine — the bar is "would
the reviewer recognise this as the approved plan?". If you discover during implementation that the plan is
wrong (an assumption breaks, a named file doesn't exist as described), STOP and return blocked=true with
blockerDiagnosis="plan-divergence: <one line>" instead of forging ahead.

Steps:
1. Implement the plan (test-first where the plan says so). ${PRIOR_FEEDBACK_NOTE}
2. ${verifyBlock(st, task.verifier || a.verifier, task.maxIterations, a.knownBaselineFailures)}
3. On verifier pass: open a PR titled \`audit-fix: <task subject>\`, body links the task note + explains the change.
4. Return your structured result: verified, blocked, escalate (as your verification block instructs; false
   otherwise), prUrl, branch, worktreePath (\`${GIT_ENV_SCRUB} git rev-parse --show-toplevel\`), blockerDiagnosis, summary.

${BUG_PREFLIGHTS}

${GATED_INPUTS_CHECK}${baselineManifest(a)}${gateOverride(task)}${escalationContext(prior, st, 'implement')}

Do not update the task's \`status:\` yourself — the lead session reconciles that after review.`
}

function reviewJudgePrompt(task, prevImpl, a, priorFeedback) {
  const depth = task.scope === 'cross-cutting'
    ? `This is a CROSS-CUTTING change — review it structurally and rigorously. Apply the discipline of the
superpowers:requesting-code-review skill: correctness, brief adherence, missed sibling sites, dead code,
no-op assertions, edge cases, test quality. Approve ONLY if findings are clean or trivially nitpicky.`
    : `This is a SINGLE-FILE change — review it for correctness, adherence to the brief, sloppiness, and
edge cases.`
  return `You are reviewing an OPEN PR for [[${task.slug}]] from the rollout [[${a.rolloutSlug}]].

PR: ${prevImpl.prUrl}
Task note (the brief): ${task.taskPath}
Task tree: ${worktreeDir(a.repoPath, task.slug)}

${depth}

${GIT_ENV_RULE}

${RM_RULE}

The PR is authoritative: judge \`gh pr diff ${prevImpl.prUrl}\` at the PR head. The task tree is context only
(the rest of the repo at that commit): read files there only when
\`${GIT_ENV_SCRUB} git -C "${worktreeDir(a.repoPath, task.slug)}" rev-parse HEAD\` equals
\`gh pr view ${prevImpl.prUrl} --json headRefOid -q .headRefOid\` AND
\`${GIT_ENV_SCRUB} git -C "${worktreeDir(a.repoPath, task.slug)}" status --porcelain\` prints nothing.
On a mismatch, a non-empty status or a missing tree, use \`gh pr diff\` / \`gh pr view\` only — never the
project's shared checkout. You are read-only: no edit, commit or push, in the tree or anywhere else.

Read \`gh pr diff ${prevImpl.prUrl}\` and the task brief. Decide: verdict "approve" if the PR is sound, else
"changes" with 3–8 specific, actionable feedback bullets (these become the reviser's instructions).${reviewHistoryBlock(priorFeedback)}${baselineManifest(a)}`
}

// priorFeedback is the FULL accumulated [{ round, feedback }] history (latest round last) — the latest
// round is the work order, earlier rounds render as anti-regression constraints (their fixes are already
// committed on the branch; "fix B, regress A" is the failure this guards). planText: original approved
// plan for the step-back round ('' otherwise). seeded (p12-6): set only on a `task.resume` revise call
// (its own Workflow call after an Integration rejection) — it adds the COLD ENTRY block after the PR:
// line; unset, the bytes are the pre-p12-6 reviser's (pinned in prompt-invariants).
function reviserPrompt(task, prevImpl, priorFeedback, round, a, planText, seeded) {
  const latest = priorFeedback[priorFeedback.length - 1]
  const earlier = priorFeedback.slice(0, -1)
  const guard = earlier.length ? `

Prior rounds — ACCUMULATED history. These were addressed by commits already on this branch: treat them
as ANTI-REGRESSION constraints. Your new changes must not undo them; before pushing, verify each still
holds.
${groupedRounds(earlier)}` : ''
  return `REVISION ROUND ${round}: master review requested changes on your prior pass for [[${task.slug}]]
(rollout [[${a.rolloutSlug}]]).

You are working in an EXISTING worktree on an EXISTING branch with an OPEN PR — NOT a fresh one.
Worktree path: ${prevImpl.worktreePath}
Branch: ${prevImpl.branch}
PR: ${prevImpl.prUrl}${seeded ? coldEntryBlock(a, task, priorFeedback) : ''}

First action: \`cd ${prevImpl.worktreePath}\` and confirm via \`${GIT_ENV_SCRUB} git rev-parse --show-toplevel\` that you are
in that worktree (NOT the project's main checkout) and on branch ${prevImpl.branch}.

${GIT_ENV_RULE}

${RM_RULE}

Review feedback — ROUND ${latest.round} (your work order; apply every bullet, verbatim below):
${latest.feedback.map((f) => '- ' + f).join('\n')}${guard}${stepBackBlock(priorFeedback, planText)}

Push new commits to the existing branch (the PR auto-updates) — do NOT open a new PR.

${ralphLoop(task.verifier || a.verifier, task.maxIterations, a.knownBaselineFailures)}

${BUG_PREFLIGHTS}

${GATED_INPUTS_CHECK}${baselineManifest(a)}

Do not update the task's \`status:\` yourself — the lead session reconciles that after review.

Return your structured result: verified, blocked, escalate=false (you run the full verification loop),
prUrl (unchanged), branch (unchanged), worktreePath, blockerDiagnosis, summary.`
}

// The seeded reviser's COLD ENTRY (p12-6): its own leading "\n\n", like the other empty-when-unused
// fragments. A revise after an Integration rejection is a separate call, possibly long after the tree
// was last used, so it re-enters the tree with branchTreeSetup (self-heal, re-attach, lock, and the
// fast-forward to origin/<branch> that STOPs on a divergence) instead of the in-run reviser's bare `cd`.
// The no-force line matters here: a rebase plus force-push of a branch holding an Integration merge
// breaks ADR 0030's never-force rule and strands refs/integration-anchor/<branch>, so the next
// Integration STOPs. The note-write override keeps the engine's stage marker the only diagnosis a
// stopped revise leaves (ADR 0030 decision 4).
function coldEntryBlock(a, task, history) {
  const last = history[history.length - 1]
  const integ = history.filter((r) => r.stage === 'integration').map((r) => r.round)
  return `

COLD ENTRY (ADR 0030 decision 3): this revise is its own call, launched after the Integration re-review
rejected this approved branch${integ.length ? ` (round ${integ.join(', ')})` : ''}, possibly long after the tree was last used.
${branchTreeSetup(a, task, true, true)}
The latest round below ${last && last.stage === 'integration' ? "is the Integration re-review's" : 'follows an Integration re-review rejection'}: fix it on the branch and push; never merge
origin/${defaultBranch(a)} yourself — the lead re-integrates.
The branch may carry an Integration merge, and every later Integration pins its anchor on this history:
push plainly; never rebase or force-push; a rejected push returns blocked.
Do not write the task note in this call — this overrides the verification loop's last step; return the
diagnosis, and the engine records it with its stage marker.`
}

// ---- Helpers ----------------------------------------------------------------

function shortAlias(slug) {
  // drop a leading "<project>-" segment for the branch name, mirroring the prose skill
  const i = slug.indexOf('-')
  return i === -1 ? slug : slug.slice(i + 1)
}

// Worktrees are created EXPLICITLY under the TARGET repo, not via isolation:'worktree'.
// Rationale: the harness's isolation:'worktree' worktrees the *session's* git root (proven
// empirically — from an ops/vault session it grabs ~/repos/workspaces, the wrong repo, and
// ignores repoPath). Anchoring the worktree on a.repoPath makes the engine correct from ANY
// launch location and places worktrees under <repoPath>/.claude/worktrees/ (where the daily
// reaper finds them). Cleanup is the reaper's job, not the harness's.
// ONE tree per task (ADR 0030, p12-4): this path is the task's tree for EVERY agent on it. The task's
// first agent creates it — the planner of a plan-gated task (taskTreeSetup), else the investigator of
// a read-only task (taskTreeSetup) or the implementer (worktreeSetup) — and every later agent reuses it;
// the review judge is handed the same path as context. taskTreeSetup locks it with the session's pid,
// which the reaper's live-pid check honours, so a plan-gated or read-only task's tree is never reaped
// mid-run. An ungated code-writing task's tree is created by worktreeSetup, which never locks it.
function worktreeDir(repoPath, slug) {
  return `${repoPath}/.claude/worktrees/${slug}`
}

// Optional per-rollout env bootstrap (env-bootstrap): a command run once, right after the agent enters its
// worktree, so every agent starts from a working interpreter + deps instead of each independently
// rediscovering an env fix (e.g. `poetry env use 3.11 && poetry install`). Empty/unset ⇒ returns '' so
// worktreeSetup renders BYTE-IDENTICAL to pre-feature behaviour (resume-cache invariant), exactly like
// baselineManifest / gateOverride. It runs in every arm (fresh OR reused worktree) — it's idempotent env
// setup, not a git op, so it does not touch the "reuse arms must not re-fetch/rebase" invariant below.
// taskTreeSetup renders the same command line inside its guarded block (it runs in the task tree or not
// at all); worktreeSetup keeps it after the toplevel check, where its GOLDEN bytes put it.
function envBootstrapStep(a) {
  if (!a.envBootstrap) return ''
  return `
  ${a.envBootstrap}   # one-time env bootstrap from the rollout (env_bootstrap): establish interpreter + deps`
}

// The branch the rollout builds on (args.defaultBranch): the repo's GitHub default, which the skill
// resolves from the remote and passes only when it is not 'main'. Fresh worktrees are cut from
// origin/<it>; `gh pr create` already targets that same default, so PRs need no explicit base.
// Unset/'main' renders every prompt BYTE-IDENTICAL to the pre-fix engine (resume-cache invariant), so
// each rollout that predates this argument replays from cache. The name is interpolated into bash, so
// it must be a plain ref name git would accept — a safe charset plus git's check-ref-format rules (no
// empty or dot-led component, no '..', no '.lock' component end, no trailing '/' or '.') — refused
// rather than quoted, so a bad value fails the run once instead of every task's worktree setup.
// Not named `baseBranch`: protocol 4 owns that name.
const BRANCH_NAME = /^(?!-)(?!\/)(?!.*\/\/)(?!.*\.\.)(?!\.)(?!.*\/\.)(?!.*\.lock(?:\/|$))(?!.*[/.]$)[A-Za-z0-9._\/-]+$/
function defaultBranch(a) {
  const b = a.defaultBranch || 'main'
  if (typeof b !== 'string' || !BRANCH_NAME.test(b)) {
    throw new Error(`defaultBranch: refusing ${JSON.stringify(b)} — not a valid branch name`)
  }
  return b
}

// Bash the code-writing agents run as their FIRST action to enter an isolated worktree of the
// target repo. Resume-safe: reuse the dir if it exists, attach an existing branch, else create.
// On a plan-gated task the planner has usually created this tree already (taskTreeSetup), so arm 1
// reuses it; on an ungated one the implementer is the task's first agent and creates it. The bytes
// are GOLDEN-pinned (tests/default-branch.test.mjs): the lock, attach and refresh steps live in
// taskTreeSetup, never here.
function worktreeSetup(a, task) {
  const wt = worktreeDir(a.repoPath, task.slug)
  const br = `audit-fix/${shortAlias(task.slug)}`
  const base = `origin/${defaultBranch(a)}`
  return `First, set up your ISOLATED worktree of the TARGET repo (NOT the session repo). Run exactly, as ONE Bash command (the \`unset\` on its first line covers only that command):
  ${GIT_ENV_SCRUB} WT="${wt}"; BR="${br}"
  if [ -d "$WT" ]; then cd "$WT";
  elif git -C "${a.repoPath}" show-ref --verify --quiet "refs/heads/$BR"; then git -C "${a.repoPath}" worktree add "$WT" "$BR" && cd "$WT";
  else git -C "${a.repoPath}" fetch origin --quiet && git -C "${a.repoPath}" worktree add "$WT" -b "$BR" ${base} && cd "$WT"; fi
  git rev-parse --show-toplevel   # MUST print "$WT" (your worktree), NOT ${a.repoPath} (the main checkout) — STOP if it doesn't${envBootstrapStep(a)}
Work only inside this worktree: every git / edit / verifier / PR command runs from here. ALL file-tool
paths (Read/Edit/Write) must be under "$WT" — e.g. "$WT/src/foo.py". NEVER edit a "${a.repoPath}/…" path:
that is the MAIN checkout, and an edit there lands outside your branch, invisible to your PR — the failure
that looks like a "silent Edit no-op" but is really a wrong-tree edit. After any edit, confirm \`${GIT_ENV_SCRUB} git -C "$WT" diff\` shows it.
A FRESH worktree is branched from a freshly-fetched ${base} (NOT local HEAD) so it includes every
task that has already merged. The two reuse arms above are unchanged — they must NOT re-fetch or
rebase an in-flight branch on resume.`
}

// Bash the READ-ONLY agents (planner, plan judge, plan reviser, investigator) run as their FIRST action to
// enter the task's tree (ADR 0030, p12-4) — the same worktreeDir path worktreeSetup uses, so every agent on
// a task shares one tree and the plan is made on the base the code is built on. A code-writing task's tree
// is its audit-fix/<alias> branch (the same WT/BR lines and arms as worktreeSetup); a read-only task's is
// detached at origin/<base>.
// - self-heal (before the arms): when "$WT" is missing, unlock + prune its registration. A tree this setup
//   locked and someone then `rm -rf`'d stays registered, `worktree prune` skips locked entries, and every
//   later `worktree add` for the slug fails "missing but locked" — so without this, TASK_TREE_RULE (v)'s
//   re-run could never recover it.
// After the arms, guarded so nothing touches the main checkout when "$WT" is a stale plain directory or
// an arm failed (the shell must be IN "$WT" and "$WT" must be its own toplevel):
// - lock: unlock + lock with `pid $PPID` — the Bash tool's shell's parent is the long-lived claude session,
//   and the daily reaper skips a tree whose lock names a live pid (unlocking stale ones). Re-locking each
//   render refreshes the pid; `lock` on a locked tree exits 128, hence the unlock first.
// - attach (code-writing only): a detached tree (a read-only → code-writing scope flip) is put on $BR —
//   the existing branch, else a new one at HEAD — so no commit is lost.
// - refresh (refresh=true: planner, investigator): fetch first (a failure skips every later check), then
//   fast-forward to origin/<base> only when the tree has no tracked changes and HEAD is an ancestor (no
//   commits of its own); the command is picked at run time — `merge --ff-only` on a branch, `checkout
//   --detach` only when already detached — so a branch tree is never detached. Untracked files (a verifier
//   artefact, an in-project venv) do not block it; one in the way makes git refuse, and that is reported.
//   Any skip prints `tree NOT refreshed: <why>; N behind origin/<base> as last fetched` for the agent to
//   quote. The judge and reviser (refresh=false) never move the tree to a new commit.
// - `tree base: <sha>`: the commit the agent is reading — the planner's `Planned on:`, which the plan judge
//   compares with its own to catch a tree recreated or moved since planning.
// - env bootstrap (refresh=true only): last inside the guard, so it runs in "$WT" or not at all — never in
//   the caller's cwd after a failed fetch/add, nor in a stale plain dir where `poetry install` / `npm
//   install` would walk up to the main checkout's project.
// The implementer prompts do not call this (their worktreeSetup bytes are GOLDEN-pinned). With no
// a.repoPath (the cap sweep's call shape) it still renders; a bad defaultBranch throws, as there.
// The self-heal and lock lines are shared with branchTreeSetup (p12-6) through treeSelfHeal and
// treeLockLines; this setup's bytes are pinned (prompt-invariants), so the refactor moved no byte.
function taskTreeSetup(a, task, refresh) {
  const wt = worktreeDir(a.repoPath, task.slug)
  const br = `audit-fix/${shortAlias(task.slug)}`
  const base = `origin/${defaultBranch(a)}`
  const code = task.scope !== 'read-only'
  const g = 'git -C "$WT"'
  const skip = 'why="fast-forward refused (untracked file in the way?)"'
  const cmd = [
    code ? `${GIT_ENV_SCRUB} WT="${wt}"; BR="${br}"` : `${GIT_ENV_SCRUB} WT="${wt}"`,
    treeSelfHeal(a),
    'if [ -d "$WT" ]; then cd "$WT";',
    ...(code ? [`elif git -C "${a.repoPath}" show-ref --verify --quiet "refs/heads/$BR"; then git -C "${a.repoPath}" worktree add "$WT" "$BR" && cd "$WT";`] : []),
    code
      ? `else git -C "${a.repoPath}" fetch origin --quiet && git -C "${a.repoPath}" worktree add "$WT" -b "$BR" ${base} && cd "$WT"; fi`
      : `else git -C "${a.repoPath}" fetch origin --quiet && git -C "${a.repoPath}" worktree add --detach "$WT" ${base} && cd "$WT"; fi`,
    `if [ -d "$WT" ] && [ "$(${g} rev-parse --show-toplevel 2>/dev/null)" = "$(pwd -P)" ]; then`,
    ...treeLockLines(g),
    ...(code ? [`  if ! ${g} symbolic-ref -q HEAD >/dev/null; then { if ${g} show-ref --verify --quiet "refs/heads/$BR"; then ${g} checkout --quiet "$BR"; else ${g} checkout --quiet -b "$BR"; fi; } || echo "tree NOT attached to $BR: checkout failed"; fi`] : []),
    ...(refresh ? [
      '  why=""',
      `  if ! ${g} fetch origin --quiet; then why="fetch failed"`,
      `  elif [ -n "$(${g} status --porcelain --untracked-files=no)" ]; then why="dirty (tracked changes)"`,
      `  elif ! ${g} merge-base --is-ancestor HEAD ${base}; then why="own commits"`,
      `  elif ${g} symbolic-ref -q HEAD >/dev/null; then ${g} merge --ff-only --quiet ${base} || ${skip}`,
      `  else ${g} checkout --quiet --detach ${base} || ${skip}; fi`,
      `  [ -z "$why" ] || echo "tree NOT refreshed: $why; $(${g} rev-list --count HEAD..${base}) behind ${base} as last fetched"`,
    ] : []),
    `  echo "tree base: $(${g} rev-parse HEAD)"`,
    ...(refresh && a.envBootstrap ? ['  ' + envBootstrapStep(a).trimStart()] : []),
    'fi',
    `git rev-parse --show-toplevel   # MUST print "$WT" (the task tree), NOT ${a.repoPath} (the main checkout) — STOP if it doesn't`,
  ]
  const kind = code
    ? `on branch ${br} (the implementer builds on it later)`
    : 'detached for this read-only task (a tree an earlier code-writing scope left on its branch stays there)'
  const moves = refresh
    ? `fast-forwards it to ${base} only when it has no tracked changes and no commits of its own, and otherwise
prints a \`tree NOT refreshed: <why>; N behind ${base} as last fetched\` line — quote that line verbatim
where your instructions below say so`
    : `never moves it to a new commit`
  return `First, enter this task's tree (ADR 0030). Run exactly, as ONE Bash command (the \`unset\` on its first line covers only that command):
${cmd.map((l) => '  ' + l).join('\n')}
This is the ONE worktree every agent on this task shares, ${kind}, first cut from a freshly fetched ${base}.
The setup reuses an existing tree and ${moves}. It locks the tree against the daily worktree reaper and
ends by printing \`tree base: <sha>\`, the commit you are reading. Every repo read and command runs in this
tree, never in the project's shared checkout at "${a.repoPath}", which may be stale.`
}

// The self-heal both tree setups run before their arms (see taskTreeSetup): a locked tree someone
// `rm -rf`'d stays registered, and every later `worktree add` for the slug fails "missing but locked".
function treeSelfHeal(a) {
  return `[ -d "$WT" ] || { git -C "${a.repoPath}" worktree unlock "$WT" 2>/dev/null; git -C "${a.repoPath}" worktree prune; }`
}

// The reaper lock both tree setups take inside their guard (see taskTreeSetup), indented for it.
function treeLockLines(g) {
  return [
    `  ${g} worktree unlock "$WT" 2>/dev/null`,
    `  ${g} worktree lock --reason "pid $PPID thread:execute task tree" "$WT" 2>/dev/null || echo "tree NOT locked against the daily reaper"`,
  ]
}

// Bash the agents that work on an APPROVED task's existing PR branch run first (p12-6): the integrator
// and the Integration judge, and the seeded (cold-entry) reviser. Unlike taskTreeSetup it never cuts a
// branch from origin/<default>: the branch is the PR's, so the arms reuse "$WT", re-attach the local
// $BR, or track origin/$BR after a fetch, and otherwise print a STOP. Inside the same guard as
// taskTreeSetup: the pid lock, the tree put on $BR (a detached or wrong-branch tree), `tree head:`, and
// the env bootstrap last (bootstrap=true: the code-writing agents; the judge only reads).
// ff=true (the seeded reviser only): after the checkout, fetch and fast-forward $BR to origin/$BR, so a
// tree reused as it was (or a local $BR left behind) never misses commits an Integration pushed since. A
// divergence is a STOP, never a rebase or a force; local commits origin lacks (a dead reviser's unpushed
// work) stay, and the plain push carries them. `--no-autostash` (p14-3, as merge-task.sh's): under
// `merge.autoStash=true` a modified tracked file the fast-forward touches would be stashed, the tree moved
// and the edit re-applied on top, so the reviser would build on a change silently carried across; with it
// git refuses and the STOP line prints, the tree and the edit left as they were. A modified file the
// fast-forward does not touch stays in place, as on any checkout. The integrator gets no fast-forward
// here: its merge step stashes leftovers first, then fast-forwards under the same divergence STOP.
function branchTreeSetup(a, task, bootstrap, ff) {
  const wt = worktreeDir(a.repoPath, task.slug)
  const br = `audit-fix/${shortAlias(task.slug)}`
  const g = 'git -C "$WT"'
  const cmd = [
    `${GIT_ENV_SCRUB} WT="${wt}"; BR="${br}"`,
    treeSelfHeal(a),
    'if [ -d "$WT" ]; then cd "$WT";',
    `elif git -C "${a.repoPath}" show-ref --verify --quiet "refs/heads/$BR"; then git -C "${a.repoPath}" worktree add "$WT" "$BR" && cd "$WT";`,
    `elif git -C "${a.repoPath}" fetch origin --quiet && git -C "${a.repoPath}" show-ref --verify --quiet "refs/remotes/origin/$BR"; then git -C "${a.repoPath}" worktree add --track -b "$BR" "$WT" "origin/$BR" && cd "$WT";`,
    'else echo "tree NOT attached: neither $BR nor origin/$BR exists — STOP"; fi',
    `if [ -d "$WT" ] && [ "$(${g} rev-parse --show-toplevel 2>/dev/null)" = "$(pwd -P)" ]; then`,
    ...treeLockLines(g),
    `  if [ "$(${g} symbolic-ref -q --short HEAD)" != "$BR" ]; then { if ${g} show-ref --verify --quiet "refs/heads/$BR"; then ${g} checkout --quiet "$BR"; else ${g} checkout --quiet --track -b "$BR" "origin/$BR"; fi; } || echo "tree NOT on $BR: checkout failed — STOP"; fi`,
    ...(ff ? [
      `  if [ "$(${g} symbolic-ref -q --short HEAD)" = "$BR" ]; then`,
      `    if ! ${g} fetch origin --quiet; then echo "tree NOT fast-forwarded: fetch origin failed — STOP"`,
      `    elif ! ${g} show-ref --verify --quiet "refs/remotes/origin/$BR"; then echo "tree NOT fast-forwarded: origin/$BR does not exist — STOP"`,
      `    elif ! ${g} merge-base --is-ancestor HEAD "origin/$BR" && ! ${g} merge-base --is-ancestor "origin/$BR" HEAD; then echo "tree NOT fast-forwarded: $BR has diverged from origin/$BR — never rebase or force-push; STOP"`,
      `    elif ! ${g} merge --ff-only --no-autostash --quiet "origin/$BR"; then echo "tree NOT fast-forwarded to origin/$BR: local changes in the way — STOP"; fi`,
      '  fi',
    ] : []),
    `  echo "tree head: $(${g} rev-parse HEAD)"`,
    ...(bootstrap && a.envBootstrap ? ['  ' + envBootstrapStep(a).trimStart()] : []),
    'fi',
    `git rev-parse --show-toplevel   # MUST print "$WT" (the task tree), NOT ${a.repoPath} (the main checkout) — STOP if it doesn't`,
  ]
  return `Enter this task's tree (ADR 0030) first. Run exactly, as ONE Bash command (the \`unset\` on its first line covers only that command):
${cmd.map((l) => '  ' + l).join('\n')}
This is the task's ONE worktree, on its PR branch ${br}. The setup reuses it, re-attaches the local branch,
or tracks origin/${br} after a fetch; it never cuts a new branch from the default branch. It locks the tree
against the daily worktree reaper, puts it on ${br}${ff ? `, fast-forwards it to origin/${br} (never past a divergence)` : ''} and prints \`tree head: <sha>\`. Any printed line that
ends in STOP (or a toplevel that is not the task tree) means: change nothing, and return blocked with that
line as your diagnosis. Every repo read and command runs in this tree, never in the project's shared
checkout at "${a.repoPath}".`
}

// ---- The ladder (ADR 0029) ----------------------------------------------------
// The operator's ladder is the ONE place models and efforts live: named rungs, bottom first, each a model
// (a tier alias, never a version) plus the efforts of the code-writing roles (`effort`: planner, plan
// reviser, implementer, reviser, read-only investigator), the plan-gate judge (`judge`) and the master
// review (`review`). Rungs may share a model, so an effort step and a model step are the same kind of move.
// The top rung is the ceiling: there is no other cap, and a quota that runs out is an edit to the file.
//
// Per call, no snapshot (decision 6). The lead runs ladder.py at each call's start and passes its JSON as
// args.ladder; the call keeps it to the end, and a resume re-passes it. With none, BUILT_IN_LADDER applies
// (ladder.py's built-in, pinned equal by tests/ladder.test.mjs): two Opus rungs, nothing above Opus, no max.
//
// A task's state (rungState) is mutable and shared by every layer of the call: the rung it STARTED on, the
// rung it is AT, the stages that CLIMBED and every dispatch it RAN.
// - Start (decision 4): the task's `rung:` names its starting rung (default the bottom one). A name the
//   ladder lacks is read as the top rung and reported as drift. A note with no `rung:` still carries the
//   pre-3.0.0 stamps, so the legacy `model: fable` or `effort: xhigh | max` starts on the top rung (p13-3's
//   mapping; one place, startRung, for the lead's args and for an old call's resume alike).
// - Climb (decision 3): each stage — plan, implement, review — climbs one rung at its FIRST evidence of
//   hardness, once per call, never past the top: a planner that produced no plan, a plan-judge `changes`, a
//   red one-shot or a blocked first implementer pass, a blocked investigator, a review-judge `changes`. On
//   the top rung the climb is recorded as a no-op. A gate stop and a dead agent are never evidence.
// - Effort and judges: every dispatch reads the CURRENT rung (implEffort, judgeEffort), so a climb carries
//   the model and every role's effort at once, judges included.
// - Verify shape: below the top, the implement stage's first pass verifies one-shot (verifyBlock); the retry
//   after a real climb keeps the full max_iterations, which is what the hand-over buys. On the top rung
//   every pass runs the full loop, so its first pass has ALREADY spent a full budget: its same-rung retry
//   gets CAPPED_RETRY_ITERATIONS, never a second full one.
// - Record (decision 7): rungRecord → the row's startRung, rung and climbs; reconcile stamps `rung:` with
//   the rung reached, so a re-dispatch starts there and never re-pays the lower rungs.
const LADDER_MODELS = ['opus', 'fable']   // ladder.py's MODELS (tests/ladder.test.mjs pins them equal)
const LADDER_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
// A rung name is written raw into YAML frontmatter (`rung: <name>`), so it is a plain lowercase token that
// YAML reads back as the same string: ladder.py's NAME_RE and YAML_WORDS, and reconcile-rollout.py's
// is_rung_name (tests/ladder.test.mjs L9 feeds all three the same names and pins that they agree).
const LADDER_NAME = /^[a-z][a-z0-9._-]*$/
const LADDER_YAML_WORDS = ['true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n', 'null']
const BUILT_IN_LADDER = {
  source: 'built-in',
  rungs: [
    { name: 'opus-high', model: 'opus', effort: 'high', judge: 'high', review: 'xhigh' },
    { name: 'opus-xhigh', model: 'opus', effort: 'xhigh', judge: 'high', review: 'xhigh' },
  ],
}
const STAGES = ['plan', 'implement', 'review']
// The top-rung retry's budget: one fix-and-re-verify cycle. See implement().
const CAPPED_RETRY_ITERATIONS = 2

function rungName(s) {
  return typeof s === 'string' && LADDER_NAME.test(s) && !LADDER_YAML_WORDS.includes(s)
}

// args.ladder: '' when usable (or absent), else why not. A bad value is a lead bug: the orchestration
// throws before any dispatch, in both modes.
function ladderArgsError(l) {
  if (l === undefined || l === null) return ''
  if (!l || typeof l !== 'object' || Array.isArray(l)) return `must be one object { source, rungs }, got ${JSON.stringify(l)}`
  if (typeof l.source !== 'string' || !l.source) return `source must be a non-empty string, got ${JSON.stringify(l.source)}`
  if (!Array.isArray(l.rungs) || !l.rungs.length) return 'rungs must be a non-empty array, bottom rung first'
  const seen = []
  for (let i = 0; i < l.rungs.length; i++) {
    const r = l.rungs[i]
    const at = `rung ${i + 1}`
    if (!r || typeof r !== 'object' || Array.isArray(r)) return `${at} must be an object { name, model, effort, judge, review }`
    if (!rungName(r.name)) return `${at}: name ${JSON.stringify(r.name)} must be lowercase [a-z][a-z0-9._-]* and not a YAML word`
    if (seen.includes(r.name)) return `${at}: duplicate name ${JSON.stringify(r.name)}`
    seen.push(r.name)
    if (!LADDER_MODELS.includes(r.model)) return `${at} (${r.name}): unknown model ${JSON.stringify(r.model)} (known: ${LADDER_MODELS.join(', ')})`
    for (const k of ['effort', 'judge', 'review']) {
      if (!LADDER_EFFORTS.includes(r[k])) return `${at} (${r.name}): ${k} ${JSON.stringify(r[k])} is not one of ${LADDER_EFFORTS.join(', ')}`
    }
  }
  return ''
}

// The call's ladder: the one the lead passed, else the built-in one.
function ladderOf(a) {
  return a && a.ladder !== undefined && a.ladder !== null ? a.ladder : BUILT_IN_LADDER
}

// { index, drift }: where the task starts on `ladder`, and its `rung:` when the ladder lacks it ('' else).
function startRung(task, ladder) {
  const names = ladder.rungs.map((r) => r.name)
  const top = names.length - 1
  const want = task ? task.rung : undefined
  if (want !== undefined && want !== null && want !== '') {
    const i = typeof want === 'string' ? names.indexOf(want) : -1
    return i >= 0 ? { index: i, drift: '' } : { index: top, drift: typeof want === 'string' ? want : JSON.stringify(want) }
  }
  const legacy = (v) => (v === undefined || v === null ? '' : String(v).trim().toLowerCase())
  const model = legacy(task && task.model)
  const effort = legacy(task && task.effort)
  return { index: model === 'fable' || effort === 'xhigh' || effort === 'max' ? top : 0, drift: '' }
}

// The task's rung state for one call (see above). Logs the drift once, when there is one.
function rungState(task, a) {
  const L = ladderOf(a)
  const s = startRung(task, L)
  if (s.drift) {
    log(`rung drift: ${task.slug}'s rung: ${s.drift} is not on the ladder (${L.source}) — read as the top rung ${L.rungs[L.rungs.length - 1].name}`)
  }
  return { source: L.source, rungs: L.rungs, start: s.index, at: s.index, climbs: [], ran: [], drift: s.drift }
}

function cur(st) { return st.rungs[st.at] }
function onTop(st) { return st.at === st.rungs.length - 1 }
function climbOf(st, stage) { return st.climbs.find((c) => c.stage === stage) || null }
function rungRecord(st) {
  return { startRung: st.rungs[st.start].name, rung: cur(st).name, climbs: st.climbs.map((c) => ({ ...c })) }
}
// The record plus the call's drift and its dispatches: the row's five rung keys.
function rowRecord(st) {
  return { ...rungRecord(st), rungDrift: st.drift, ran: st.ran.map((x) => ({ ...x })) }
}

// The stage's climb (see above): once per stage per call, never past the top, where it is recorded as a
// no-op. Returns whether the rung MOVED. Prompt framing does not read this return: every builder derives
// its own from `st` and its stage (escalationContext off the stage's climb, verifyBlock off onTop and the
// implement climb). The one live consumer of the return is implement()'s retry budget.
function escalate(st, slug, stage) {
  if (climbOf(st, stage)) return false
  const from = cur(st).name
  if (!onTop(st)) st.at += 1
  const to = cur(st).name
  st.climbs.push({ stage, from, to })
  log(from === to
    ? `climb: ${slug} stays on the top rung ${to} (${stage}, a recorded no-op)`
    : `climb: ${slug} → ${to} (${stage})`)
  return from !== to
}

// The code-writing roles' effort, and a judge's ('judge' the plan gate, 'review' the master review), on
// the task's CURRENT rung.
function implEffort(st) { return cur(st).effort }
function judgeEffort(st, role) { return cur(st)[role] }

// ---- Dispatch resilience: transient agent death -----------------------------
// A terminal API/connection error (observed 2026-07-18: "API Error: Connection closed mid-response") kills
// the agent process mid-run, and the Workflow `agent()` global surfaces that as a `null` return. Left
// unguarded that null propagates into a later stage and throws (e.g. `null is not an object (evaluating
// 'prevImpl.prUrl')` when a dead implementer's null reaches reviewLoop), and the task is reported with the
// useless generic "workflow stage threw" diagnosis. runAgent() centralises the guard: it does ONE automatic
// in-run retry (connection deaths are near-always transient — the manual re-dispatch recovered first-try in
// every observed case), and if the agent is STILL dead it returns a distinguished `{ __dead: true }`
// sentinel instead of a raw null. Every layer below checks `.__dead` immediately after the call and converts
// it into a CLEAN transient block, so no stage ever dereferences a null and the cause is CLASSIFIED —
// reconcile then writes an actionable "re-dispatch cleanly" note instead of the generic stage-threw string.
const TRANSIENT_DIAGNOSIS =
  'transient infrastructure failure — the agent process died mid-run on a terminal API/connection error ' +
  '(e.g. "Connection closed mid-response"), NOT a task-authored blocker. Re-dispatch cleanly: the worktree ' +
  'and any committed work are reusable and a fresh dispatch of the same prompt should proceed normally.'

// st (optional): a task-mode call's rung state. Each dispatch is recorded on st.ran BEFORE it runs, so a
// stage that throws still reports what it dispatched (ADR 0029 decision 7). The integrate mode passes none:
// it records its agents on its own trace, also before each runs (integrate()).
async function runAgent(prompt, opts, st) {
  if (st) st.ran.push({ label: (opts && opts.label) || '', rung: cur(st).name, model: opts && opts.model, effort: opts && opts.effort })
  let r = await agent(prompt, opts)
  if (r == null) {
    log(`agent death (null return) on ${(opts && opts.label) || '?'} — one automatic retry`)
    r = await agent(prompt, opts)
  }
  return r == null ? { __dead: true } : r
}

// Layer-appropriate clean blocks for a dead agent (see runAgent). The specific diagnosis is what makes the
// transient case cheap: reconcile writes "re-dispatch cleanly" and the lead auto-retries instead of
// hand-diagnosing an infra blip from the <failures> block.
function transientPlanBlock(task, rounds) {
  return { task, blocked: true, status: 'plan-blocked', blockerDiagnosis: TRANSIENT_DIAGNOSIS, planRoundsUsed: rounds }
}
function transientImplBlock(extra) {
  return { blocked: true, blockerDiagnosis: TRANSIENT_DIAGNOSIS, ...(extra || {}) }
}

// Round budgets (p12-2). planLoop and reviewLoop are bounded `while (round <= budget)` loops whose only
// returns sit inside the body, so a budget that is 0, negative, NaN, undefined/null (an omitted or empty
// YAML key), fractional or a numeric string would either never enter the loop or never hit the strict
// `round === budget` ceiling, and fall off the end returning undefined. For planLoop that is a fail-OPEN
// on ADR 0008 (implement() reads an undefined plan result as "no gate"). Only an integer >= 1 is a budget;
// anything else fails CLOSED with a diagnosis naming the frontmatter field. Strings are rejected rather
// than coerced: args built from YAML ints are numbers, so a string is itself a config error. The text is
// kept free of double quotes because the lead copies it into a ROLLOUT-STATUS reason (Stop-hook regex).
const ROUND_BUDGET_FIELDS = { maxPlanRounds: 'max_plan_rounds', maxReviewRounds: 'max_review_rounds' }
function roundBudgetDiagnosis(task, keys) {
  const show = (v) => (typeof v === 'string' ? `'${v.replace(/"/g, '')}' (a string)` : String(v))
  const bad = keys.filter((k) => !(Number.isInteger(task[k]) && task[k] >= 1))
  if (!bad.length) return ''
  return 'invalid round budget: ' + bad.map((k) => `${ROUND_BUDGET_FIELDS[k]} = ${show(task[k])}`).join(', ') +
    ' — each must be an integer >= 1. Fix the task (or rollout) frontmatter and re-dispatch; the engine ' +
    'fails closed rather than skip a plan or review layer (ADR 0008).'
}
// The review-blocked shape for a bad review budget. The diagnosis goes in reviewFeedback as well as
// blockerDiagnosis: reconcile writes bullets(reviewFeedback) for review-blocked when reviewHistory is empty.
function reviewBudgetBlock(prev, diag) {
  return { ...(prev || {}), blocked: true, status: 'review-blocked', blockerDiagnosis: diag, reviewFeedback: [diag], reviewHistory: [], reviewRoundsUsed: 0 }
}

// ---- The three convergence layers -------------------------------------------

async function planLoop(task, st, a) {
  // Entry guard BEFORE the planner dispatch: an unusable budget must never reach implement() as "no gate".
  const badBudget = roundBudgetDiagnosis(task, ['maxPlanRounds'])
  if (badBudget) return { task, blocked: true, status: 'plan-blocked', blockerDiagnosis: badBudget, planRoundsUsed: 0 }
  let plan = await runAgent(plannerPrompt(task, a, st, ''), {
    label: `plan:${task.slug}`, phase: 'Plan-gate', schema: PLAN_VERDICT, model: cur(st).model, effort: implEffort(st),
  }, st)
  if (plan.__dead) return transientPlanBlock(task, 0)
  if (plan.blocked || !plan.ready) {
    // A first-pass planner failure is the plan stage's first evidence of hardness: it climbs (a no-op on
    // the top rung) and the planner gets one retry, on the rung it is now on, before plan-blocked.
    escalate(st, task.slug, 'plan')
    plan = await runAgent(plannerPrompt(task, a, st, plan.blockerCause || 'first-pass planner produced no plan'), {
      label: `plan:${task.slug}@${cur(st).name}`, phase: 'Plan-gate', schema: PLAN_VERDICT, model: cur(st).model, effort: implEffort(st),
    }, st)
    if (plan.__dead) return transientPlanBlock(task, 0)
  }
  if (plan.blocked || !plan.ready) {
    return { task, blocked: true, status: 'plan-blocked', blockerDiagnosis: plan.blockerCause || 'planner returned no plan', planRoundsUsed: 0 }
  }
  // Accumulate every round's rejection rationale (item 1): thread the FULL judge feedback into each
  // revise round and into the plan-blocked diagnosis, mirroring what a manual re-dispatch achieves by
  // letting a fresh planner read the rationale appended to the task note.
  const priorFeedback = []
  let round = 1
  while (round <= task.maxPlanRounds) {
    const verdict = await runAgent(planJudgePrompt(task, plan.plan, a), {
      label: `plan-judge:${task.slug} r${round}`, phase: 'Plan-gate', schema: PLAN_JUDGE, model: cur(st).model, effort: judgeEffort(st, 'judge'),
    }, st)
    if (verdict.__dead) return transientPlanBlock(task, round)
    if (verdict.verdict === 'approve') {
      // Gated inputs (ADR 0008): a declared gate always pauses for a human — regardless of
      // plan_approval config or continuous mode. Gates already approved on the note
      // (task.approvedGates) are skipped, so re-dispatches never re-ask those exact gates.
      const declared = parseGatedInputs(plan.plan)
      if (declared === null) {
        // The judge approved a plan WITHOUT the required section, or with a section carrying no
        // parseable declaration — no list items, no "None" (its checklist forbids both, ADR 0013).
        // Fail closed — but to plan-blocked, not gate-pending: there is nothing concrete for a
        // human to sign, and a re-plan under the current prompt self-heals with a declaration.
        return {
          task, blocked: true, status: 'plan-blocked', planRoundsUsed: round,
          blockerDiagnosis: 'plan was approved without a parseable "### Gated inputs" section — gates must be markdown bullets ("- spend/credential/irreversible: …") or exactly "None" (fail-closed, ADR 0008) — re-plan and declare each gate as a bullet or an explicit "None"',
        }
      }
      const gates = unapprovedGates(declared, task.approvedGates)
      if (gates.length) {
        return {
          task, blocked: true, status: 'gate-pending', gatedInputs: gates,
          planRoundsUsed: round, blockerDiagnosis: gateDiagnosis(gates),
        }
      }
      return { task, blocked: false, plan: plan.plan, planRoundsUsed: round }
    }
    // Record this round's rejection BEFORE the max-rounds return and the reviser dispatch, so both the
    // plan-blocked diagnosis and the next reviser see the complete accumulated rationale (push with the
    // judge round `round`, not `round + 1` — that off-by-one would mislabel the "Round N" headings).
    priorFeedback.push({ round, feedback: verdict.feedback })
    if (round === task.maxPlanRounds) {
      return {
        task, blocked: true, status: 'plan-blocked', planRoundsUsed: round,
        blockerDiagnosis: 'plan not approved after ' + round + ' rounds. Accumulated reviewer feedback:\n' +
          priorFeedback.map((r) => 'Round ' + r.round + ': ' + r.feedback.join('; ')).join('\n'),
      }
    }
    // A judged `changes` is the plan stage's evidence of hardness: revision is iteration, and iteration
    // runs one rung up (once per stage — a later `changes` never climbs again; a no-op on the top rung).
    escalate(st, task.slug, 'plan')
    plan = await runAgent(planReviserPrompt(task, plan.plan, priorFeedback, round + 1, a), {
      label: `plan-revise:${task.slug} r${round + 1}`, phase: 'Plan-gate', schema: PLAN_VERDICT, model: cur(st).model, effort: implEffort(st),
    }, st)
    if (plan.__dead) return transientPlanBlock(task, round + 1)
    if (plan.blocked || !plan.ready) {
      return { task, blocked: true, status: 'plan-blocked', blockerDiagnosis: plan.blockerCause || 'plan-reviser returned no plan', planRoundsUsed: round + 1 }
    }
    round += 1
  }
  // Unreachable once the entry guard holds; kept so the function can never end in undefined (fail-closed).
  return {
    task, blocked: true, status: 'plan-blocked', planRoundsUsed: round - 1,
    blockerDiagnosis: `plan round budget exhausted without a verdict (max_plan_rounds = ${String(task.maxPlanRounds)}) — fail-closed, ADR 0008`,
  }
}

async function implement(task, st, prev, a) {
  if (prev && prev.blocked) return prev // plan-blocked passthrough
  // Plan-stage metadata to thread forward (or carry onto a transient block) when a plan was approved.
  const planExtra = (task.planGate && prev && prev.plan) ? { planRoundsUsed: prev.planRoundsUsed || 0 } : undefined
  if (task.scope === 'read-only') {
    let r = await runAgent(readOnlyPrompt(task, a, st, ''), {
      label: `investigate:${task.slug}`, phase: 'Implement', schema: IMPL_RESULT, model: cur(st).model, effort: implEffort(st),
    }, st)
    if (r.__dead) return transientImplBlock()
    if (r.blocked) {
      // The implement stage's first evidence of hardness: climb (a no-op on the top rung), one retry.
      escalate(st, task.slug, 'implement')
      r = await runAgent(readOnlyPrompt(task, a, st, r.blockerDiagnosis || 'first-pass investigation did not complete'), {
        label: `investigate:${task.slug}@${cur(st).name}`, phase: 'Implement', schema: IMPL_RESULT, model: cur(st).model, effort: implEffort(st),
      }, st)
      if (r.__dead) return transientImplBlock()
    }
    return r
  }
  // Same builder for both passes: st is read at build time, so a first pass below the top rung renders the
  // one-shot verification block and the pass after the stage's climb renders the full Ralph loop.
  const prompt = (prior, t) => ((t || task).planGate && prev && prev.plan)
    ? approvedPlanImplementerPrompt(t || task, prev.plan, a, st, prior)
    : implementerPrompt(t || task, a, st, prior)
  // A stop for gated inputs (ADR 0008) is a HUMAN decision, not evidence of hardness: convert it to a
  // clean gate-pending block and never climb on it. Checked before the climb branch on both
  // passes. Approved gates are filtered out defensively (the prompt already tells the agent to proceed
  // past them), so an already-signed gate can never be re-asked; a stop for ONLY approved gates has already
  // had its continuations (pastSignedGates) by the time this runs, so it repeats gates already passed.
  const gatePending = (r) => {
    const gates = unapprovedGates(r.gatedInputs, task.approvedGates)
    if (!gates.length) return null
    return { ...r, blocked: true, status: 'gate-pending', gatedInputs: gates, blockerDiagnosis: gateDiagnosis(gates), ...(planExtra || {}) }
  }
  // The opts are held, and the builder call re-rendered (a pure function of unchanged inputs), so a signed
  // stop's continuation (pastSignedGates) carries the same bytes on the same rung; the cached call itself
  // is unchanged. Each runAgent() keeps a builder call as its first argument (git-env-scrub's e2 guard).
  const firstOpts = { label: `implement:${task.slug}`, phase: 'Implement', schema: IMPL_RESULT, model: cur(st).model, effort: implEffort(st) }
  let r = await runAgent(prompt(''), firstOpts, st)
  r = await pastSignedGates(task, r, prompt(''), firstOpts, st)
  // A dead agent is transient infra, NOT evidence of hardness — do NOT climb; report a clean block.
  if (r.__dead) return transientImplBlock(planExtra)
  const gatedFirst = gatePending(r)
  if (gatedFirst) return gatedFirst
  if (r.escalate || r.blocked) {
    // One-shot red or a first-pass block: the task has proven non-mechanical. The implement stage climbs
    // and the next rung takes over in the same worktree (the committed attempt + note diagnosis carry
    // over; an approved plan is NOT re-planned) with the full Ralph budget. On the top rung the climb is a
    // recorded no-op and the same rung retries once.
    const moved = escalate(st, task.slug, 'implement')
    const prior = [r.blockerDiagnosis, r.summary].filter((s) => s && s.trim()).join('\n')
      || 'first-pass attempt did not verify green'
    // On the top rung the first pass ran the full loop, so it ALREADY spent a FULL Ralph budget; a second
    // full one would double the verifier spend at the ceiling. The retry budget is NOT a function of
    // max_iterations — two rounds of arithmetic (floor(n/2), then a floor of 2 around it) each broke at an
    // edge: floor(n/2) gave 1 at the template default, and a 1-iteration ralphLoop fires step (d) at i == 1
    // and blocks WITHOUT re-running the verifier, so the agent commits an unverified fix; the floor then
    // handed n=2 a full second budget, the exact doubling being guarded against. What the retry actually
    // needs is one fix-and-re-verify cycle, which is a CONSTANT. A top-rung task's implement cost is
    // therefore exactly `max_iterations + CAPPED_RETRY_ITERATIONS`, against a climbing one's
    // `1 + max_iterations` — one extra iteration at every n, no edge cases. A climb that really moved keeps
    // its full budget: that is what the hand-over buys.
    const retryTask = moved ? task : { ...task, maxIterations: CAPPED_RETRY_ITERATIONS }
    const retryOpts = { label: `implement:${task.slug}@${cur(st).name}`, phase: 'Implement', schema: IMPL_RESULT, model: cur(st).model, effort: implEffort(st) }
    r = await runAgent(prompt(prior, retryTask), retryOpts, st)
    r = await pastSignedGates(task, r, prompt(prior, retryTask), retryOpts, st)
    if (r.__dead) return transientImplBlock(planExtra)
    const gatedRetry = gatePending(r)
    if (gatedRetry) return gatedRetry
  }
  // Defensive: a result that neither verified nor blocked and has no PR cannot go to review.
  if (!r.verified && !r.blocked && !r.prUrl) {
    r = { ...r, blocked: true, blockerDiagnosis: r.blockerDiagnosis || 'agent returned neither verified nor blocked' }
  }
  // thread the plan-stage metadata forward so the final report shows plan_rounds_used
  return planExtra ? { ...r, ...planExtra } : r
}

// One reviser dispatch (the review loop's revise step, moved here verbatim by p12-6 so the seeded
// entry reuses it). Returns { stop } — the row to return — or { current } to judge next. `round` is the
// round being revised for; `seeded` is the task.resume seed (the reviser's COLD ENTRY) or null.
async function reviseRound(task, st, current, priorFeedback, round, a, planText, seeded) {
  // A review-judge `changes` is the review stage's evidence of hardness: revision is iteration, and
  // iteration runs one rung up (once per stage per call; a no-op on the top rung). A seeded revise is its
  // own call, so it climbs from the rung its note was stamped with.
  escalate(st, task.slug, 'review')
  const reviseOpts = { label: `revise:${task.slug} r${round}`, phase: 'Review', schema: IMPL_RESULT, model: cur(st).model, effort: implEffort(st) }
  let revised = await runAgent(reviserPrompt(task, current, priorFeedback, round, a, planText, seeded), reviseOpts, st)
  // A replayed (or fresh) stop for gates the note has since approved: continuations (pastSignedGates), on the
  // same reviser prompt re-rendered from the same inputs. A dead result passes through (signedStop is false).
  revised = await pastSignedGates(task, revised, reviserPrompt(task, current, priorFeedback, round, a, planText, seeded), reviseOpts, st)
  if (revised.__dead) return { stop: { ...current, status: 'blocked', blockerDiagnosis: TRANSIENT_DIAGNOSIS } }
  if (revised.blocked) {
    // A reviser can DISCOVER a gated input the earlier passes never hit (ADR 0008) — same human
    // stop, never a plain block.
    const gates = unapprovedGates(revised.gatedInputs, task.approvedGates)
    if (gates.length) {
      return { stop: { ...current, ...revised, blocked: true, status: 'gate-pending', gatedInputs: gates, blockerDiagnosis: gateDiagnosis(gates) } }
    }
    return { stop: { ...current, status: 'blocked', blockerDiagnosis: revised.blockerDiagnosis } }
  }
  return { current: { ...current, ...revised } }
}

// seed (p12-6, the `task.resume` revise after an Integration rejection): { history, roundsUsed }. The
// loop starts at round roundsUsed + 1 with the seeded history, runs ONE seeded revise, then the unchanged
// judge loop (its revises get the same COLD ENTRY). Unseeded, every label, prompt and row is unchanged.
async function reviewLoop(task, st, prev, a, planText, seed) {
  // plan-blocked / gate-pending passthrough (already carry their own status — never remap to 'blocked')
  if (prev && prev.blocked && (prev.status === 'plan-blocked' || prev.status === 'gate-pending')) return prev
  // Ralph-blocked OR transient-dead implement result (both carry blocked=true)
  if (prev && prev.blocked) return { ...prev, status: 'blocked' }
  if (task.scope === 'read-only') return { ...prev, status: 'review', reviewRoundsUsed: 0 }
  // Entry guard (converge's pre-flight normally catches this first): an unusable review budget blocks
  // with the diagnosis where reconcile looks for it — reviewFeedback, since the history is empty.
  const badBudget = roundBudgetDiagnosis(task, ['maxReviewRounds'])
  if (badBudget) return reviewBudgetBlock(prev, badBudget)

  let current = prev
  // Accumulate every round's rejection rationale (review-loop-memory), mirroring planLoop: the judge
  // sees the full history (anti-goalpost discipline), each reviser gets the latest round as its work
  // order plus earlier rounds as anti-regression constraints, and the history is RETURNED on both
  // ceiling outcomes so reconcile can persist it (a ceiling approval previously left no record at all).
  const priorFeedback = seed ? seed.history.map((r) => ({ ...r, feedback: [...r.feedback] })) : []
  let round = seed ? seed.roundsUsed + 1 : 1
  // A seeded call that stops blocked carries its history, so taskResult can write the revise marker
  // (ADR 0030 decision 4: it resumes at revise, never at a fresh plan). Unseeded rows are untouched.
  // Its rounds used never drop below the seed's: the seed's last round may have had no feedback (liveHistory).
  const stopped = (x) => (seed && x.status === 'blocked'
    ? { ...x, reviewHistory: priorFeedback, reviewRoundsUsed: Math.max(seed.roundsUsed, priorFeedback[priorFeedback.length - 1].round) }
    : x)
  if (seed) {
    if (round > task.maxReviewRounds) {
      // No round left for the revise: the Integration rejection was the last one. No dispatch.
      const last = priorFeedback[priorFeedback.length - 1]
      return { ...current, status: 'review-blocked', reviewRoundsUsed: seed.roundsUsed, reviewFeedback: last.feedback, reviewHistory: priorFeedback }
    }
    const step = await reviseRound(task, st, current, priorFeedback, round, a, planText, seed)
    if (step.stop) return stopped(step.stop)
    current = step.current
  }
  while (round <= task.maxReviewRounds) {
    const verdict = await runAgent(reviewJudgePrompt(task, current, a, priorFeedback), {
      label: `review:${task.slug} r${round}`, phase: 'Review', schema: REVIEW_VERDICT, model: cur(st).model, effort: judgeEffort(st, 'review'),
    }, st)
    // Dead review-judge: the PR is real and stands — block on transient infra so the lead re-judges it.
    if (verdict.__dead) return stopped({ ...current, status: 'blocked', blockerDiagnosis: TRANSIENT_DIAGNOSIS })
    if (verdict.verdict === 'approve') {
      // approvedAtCeiling: an approval on the LAST possible round with real rejection history — the
      // unauditable case the audit flagged (giflab p6-2). A clean first-round approve at a 1-round
      // ceiling has no history: not a ceiling event, nothing to record.
      return {
        ...current, status: 'review', reviewRoundsUsed: round, reviewHistory: priorFeedback,
        approvedAtCeiling: round === task.maxReviewRounds && priorFeedback.length > 0,
      }
    }
    // Record this round's rejection BEFORE the ceiling return and the reviser dispatch, so the
    // review-blocked record and the next reviser/judge all see the complete accumulated rationale
    // (push with the judge round `round`, not `round + 1` — same off-by-one guard as planLoop).
    priorFeedback.push({ round, feedback: verdict.feedback })
    if (round === task.maxReviewRounds) {
      return { ...current, status: 'review-blocked', reviewRoundsUsed: round, reviewFeedback: verdict.feedback, reviewHistory: priorFeedback }
    }
    const step = await reviseRound(task, st, current, priorFeedback, round + 1, a, planText, seed || null)
    if (step.stop) return stopped(step.stop)
    current = step.current
    round += 1
  }
  // Unreachable once the entry guard holds; kept so the function can never end in undefined (fail-closed).
  const diag = `review round budget exhausted without a verdict (max_review_rounds = ${String(task.maxReviewRounds)}) — fail-closed, ADR 0008`
  return { ...current, status: 'review-blocked', reviewRoundsUsed: round - 1, blockerDiagnosis: diag, reviewFeedback: [diag], reviewHistory: priorFeedback }
}

// One task, end to end: plan-gate → implement → review, sharing a single mutable rung state so a climb
// in any layer carries into every later agent AND judge. The orchestration below builds `st` first and runs
// converge() once, for the one task this call carries, so a stage that throws still has its record (st);
// tasks converge independently across calls.
async function converge(task, a, st = rungState(task, a)) {
  const wrap = (r) => (r ? { ...r, ...rowRecord(st) } : r)
  // Pre-flight: a code-writing task whose review layer cannot run must not spend a planner, an
  // implementer and a PR first. The diagnosis lists every invalid budget the task would use, so one
  // frontmatter fix covers both. (Read-only tasks never run the review layer, so their budget is moot.)
  if (task.scope !== 'read-only' && roundBudgetDiagnosis(task, ['maxReviewRounds'])) {
    const keys = task.planGate ? ['maxPlanRounds', 'maxReviewRounds'] : ['maxReviewRounds']
    return wrap({ task, ...reviewBudgetBlock(null, roundBudgetDiagnosis(task, keys)), plan: null })
  }
  // A seeded revise (task.resume, validated before dispatch): the approved PR stands, so plan and
  // implement are skipped and the review loop starts from the seeded history (p12-6).
  if (task.resume) {
    const R = task.resume
    const pr = { prUrl: R.prUrl, branch: R.branch, worktreePath: R.worktreePath, verified: true, blocked: false, blockerDiagnosis: '', summary: '' }
    // A seeded revise never settles the plan (p14-2): its row carries plan null, so the note keeps it.
    return wrap({ ...(await reviewLoop(task, st, pr, a, R.plan, { history: R.reviewHistory, roundsUsed: R.reviewRoundsUsed })), plan: null })
  }
  const planned = task.planGate ? await planLoop(task, st, a) : { task, plan: null, blocked: false }
  const impl = await implement(task, st, planned, a)
  // The approved plan rides into the review loop for the step-back round's reference ('' when the
  // task was not plan-gated — the step-back licence then runs against the brief alone).
  const reviewed = await reviewLoop(task, st, impl, a, (task.planGate && planned && planned.plan) || '')
  // The row's plan (p14-2), set here over any inner `plan`: the approved plan when the plan-gate approved
  // one, '' when the task is not plan-gated, null when the plan-gate reached no approved plan (plan-blocked,
  // gate-pending at the plan) — reconcile then leaves the note's "## Approved plan" as it was.
  const approved = (planned && !planned.blocked && typeof planned.plan === 'string' && planned.plan.trim()) ? planned.plan : null
  return wrap({ ...reviewed, plan: !task.planGate ? '' : approved })
}

// One result row per task, the shape reconcile-rollout.py reads. A converge() that threw (r === null)
// becomes a blocked row with the same diagnosis the engine has always given a dropped item, and the rung
// record st held when it threw: the climbs so far and every dispatch that ran.
// The diagnosis passes through stageDiagnosis (p12-6): a seeded revise that stopped blocked gets the
// revise marker, and an own-run diagnosis that would read as a stage marker gets `own run: `.
function taskResult(t, r, st) {
  const norm = r || { blocked: true, status: 'blocked', blockerDiagnosis: 'workflow stage threw — see /workflows', ...rowRecord(st) }
  const status = norm.status || (norm.blocked ? 'blocked' : 'review')
  return {
    slug: t.slug,
    scope: t.scope,
    status,
    prUrl: norm.prUrl || (t.resume && t.resume.prUrl) || '',
    branch: norm.branch || (t.resume && t.resume.branch) || '',
    worktreePath: norm.worktreePath || (t.resume && t.resume.worktreePath) || '',
    reviewRoundsUsed: norm.reviewRoundsUsed || (t.resume && t.resume.reviewRoundsUsed) || 0,
    planRoundsUsed: norm.planRoundsUsed || 0,
    blockerDiagnosis: stageDiagnosis(t, norm, status),
    reviewFeedback: norm.reviewFeedback || [],
    reviewHistory: norm.reviewHistory || (t.resume && t.resume.reviewHistory) || [],
    approvedAtCeiling: !!norm.approvedAtCeiling,
    gatedInputs: norm.gatedInputs || [],
    summary: norm.summary || '',
    startRung: norm.startRung,
    rung: norm.rung,
    climbs: norm.climbs,
    rungDrift: norm.rungDrift,
    ran: norm.ran,
    plan: (r && typeof r.plan === 'string') ? r.plan : null,
  }
}

// ---- Integration (ADR 0030 decision 3, p12-6) --------------------------------
// The trouble path of Integration as its own small Workflow call (args.mode: 'integrate'). The lead runs
// the clean path itself (p12-9); this call runs only for a conflict, a red verifier, a shared file or a
// re-entry. It never merges the PR and never returns `integrated` without an agent that read git.

// The stage markers (ADR 0030 decision 4). The FIRST line of a task note's latest `## Blocker diagnosis`
// run decides where a set-aside task resumes:
// - INTEGRATION_PREFIX: set aside AT Integration — it re-enters at Integration on the same anchor. p12-8's
//   reconcile reads any latest run starting `integration:` (any case) as `setAsideAt: integration`, so
//   INTEGRATION_PREFIX is the engine's ONLY producer of that prefix.
// - REVISE_MARKER: an Integration re-review rejected the branch — the task revises in its own lane as a
//   seeded `task.resume` call, never a fresh plan. It deliberately does NOT start `integration:`, so p12-8
//   reports it `setAsideAt: run` (the task's own lane).
// - anything else is the task's own run. A task-mode diagnosis that would parse as either marker is
//   written as OWN_RUN_PREFIX + itself (stageDiagnosis).
const INTEGRATION_PREFIX = 'integration: '
const REVISE_MARKER = 'revise: rejected at Integration re-review — revise on the branch, then re-integrate'
const OWN_RUN_PREFIX = 'own run: '
const INTEGRATION_TROUBLE = ['conflict', 'red', 'shared-file']
const INTEGRATION_THREW = 'workflow stage threw — see /workflows'
const SHA40 = /^[0-9a-f]{40}$/
const PR_URL = /^https:\/\/\S+\/pull\/\d+$/

// The task's anchor (ADR 0030 decision 3): the ONE commit every Integration of the task pins. It prints
// exactly one line:
//   anchor <X>     refs/integration-anchor/<branch> exists and X is an ancestor of the PR head;
//   stale-ref <X>  the ref exists but is NOT on the branch (recut or rewritten): delete it with
//                  `git update-ref -d <ref> <X>` and run the recipe again;
//   anchor <sha>   no ref: the first parent of the OLDEST first-parent merge in origin/<default>..<head>
//                  (the commit before the task's own run, or an earlier Integration, merged main in), or
//                  the PR head itself when the branch carries no such merge.
// Inputs, as shell variables: WT (any checkout of the repo, freshly fetched), BR (audit-fix/<alias>),
// D (origin/<default>), H (the PR head). The lead renders this constant verbatim (p12-9 pins its copy);
// the merge step and the judge check embed it, and tests/integration-tree.test.sh runs it.
const ANCHOR_RECIPE = 'X=$(git -C "$WT" rev-parse -q --verify "refs/integration-anchor/$BR" 2>/dev/null); ' +
  'if [ -n "$X" ]; then if git -C "$WT" merge-base --is-ancestor "$X" "$H"; then echo "anchor $X"; else echo "stale-ref $X"; fi; ' +
  'else M=$(git -C "$WT" rev-list --first-parent --merges "$D..$H" | tail -n 1); ' +
  'if [ -n "$M" ]; then echo "anchor $(git -C "$WT" rev-parse "$M^1")"; else echo "anchor $(git -C "$WT" rev-parse "$H")"; fi; fi'

const INTEGRATE_RESULT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    blocked: { type: 'boolean', description: 'true on a merge-step STOP, an unresolvable conflict, a red verifier at the ceiling, a rejected push or an unsafe tree' },
    blockerDiagnosis: { type: 'string', description: 'one paragraph when blocked (a merge-step STOP line verbatim), else empty string' },
    verified: { type: 'boolean', description: 'true ONLY if the full verifier reached the accepted green state in THIS call' },
    mergeLog: { type: 'string', description: 'the merge step stdout, verbatim' },
    mergeState: { type: 'string', enum: ['up-to-date', 'already-merged', 'merged', 'none'], description: 'the merge line: up-to-date, already-merged, merged (also after a resolved conflict), or none when blocked before a merge line' },
    mergeCommit: { type: 'string', description: 'the 40-hex merge commit when mergeState is merged or already-merged (after a conflict: your resolution commit), else empty string' },
    taskHead: { type: 'string', description: 'the sha on the merge step task head: line' },
    baseSha: { type: 'string', description: 'the sha on the merge step integration base: line' },
    headSha: { type: 'string', description: 'the branch head after your last commit (rev-parse HEAD)' },
    pushedSha: { type: 'string', description: 'the sha ls-remote reports for the branch on origin after your push' },
    conflictFiles: { type: 'array', items: { type: 'string' }, description: 'the conflict: paths, recorded before resolving; [] when none' },
    fixCommits: { type: 'array', items: { type: 'string' }, description: 'shas of the non-merge commits you made after the merge; [] when none' },
    summary: { type: 'string', description: 'one paragraph: what the merge brought in, how you resolved it, what the verifier said' },
    gatedInputs: { type: 'array', items: { type: 'string' }, description: 'ONLY when you stopped before a gated action (ADR 0008): one line per human authorisation the note\'s "## Approved gates" does not cover. Omit or empty otherwise.' },
    finishedAt: { type: 'string', description: 'the output of date -u +%Y-%m-%dT%H:%M:%SZ, run as your last action' },
  },
  required: ['blocked', 'blockerDiagnosis', 'verified', 'mergeLog', 'mergeState', 'mergeCommit', 'taskHead', 'baseSha', 'headSha', 'pushedSha', 'conflictFiles', 'fixCommits', 'summary', 'finishedAt'],
}

const INTEGRATION_REVIEW = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string', enum: ['approve', 'changes'] },
    feedback: { type: 'array', items: { type: 'string' }, description: '1–8 specific bullets when verdict is changes (or unreadable); empty when approve' },
    unreadable: { type: 'boolean', description: 'true ONLY when the judge check printed FAIL — you could not read the integration' },
    finishedAt: { type: 'string', description: 'the output of date -u +%Y-%m-%dT%H:%M:%SZ, run as your last action' },
  },
  required: ['verdict', 'feedback', 'unreadable', 'finishedAt'],
}

// ---- Integration: markers and history ----

function flattenLine(s) {
  return String(s == null ? '' : s).replace(/\s*\n\s*/g, ' ').trim()
}

// A history with every bullet on one line (the form markers carry, so a parsed marker round-trips).
function normHistory(history) {
  return (history || []).map((r) => ({ ...r, feedback: (r.feedback || []).map(flattenLine) }))
}

// The history as a marker carries it: `Round N rejection:` / `Round N (Integration) rejection:`, then
// one-line bullets. Reconcile writes it verbatim, so a cold lead rebuilds the history from the note. A round
// with no feedback (a later in-call judge's `changes` with []) is left out, as parseIntegrationMarker and
// reconcile's history_block leave it out, rather than written as a header with no bullets.
function markerHistory(history) {
  return (history || [])
    .map((r) => ({ ...r, feedback: (r.feedback || []).map(flattenLine).filter((f) => f) }))
    .filter((r) => r.feedback.length)
    .map((r) => `Round ${r.round}${r.stage === 'integration' ? ' (Integration)' : ''} rejection:\n` +
      r.feedback.map((f) => '- ' + f).join('\n'))
    .join('\n\n')
}

// kind: 'rejected' → REVISE_MARKER + history; 'revise-stopped' → REVISE_MARKER, a `revise stopped:` line,
// history; 'set-aside' → INTEGRATION_PREFIX + the reason on one line (+ history when non-empty).
function integrationMarker(kind, reason, history) {
  const h = markerHistory(history)
  const tail = h ? '\n\n' + h : ''
  if (kind === 'rejected') return REVISE_MARKER + tail
  if (kind === 'revise-stopped') return REVISE_MARKER + '\nrevise stopped: ' + flattenLine(reason) + tail
  return INTEGRATION_PREFIX + flattenLine(String(reason || '').replace(/^\s*integration:\s*/i, '')) + tail
}

// The reference parser for one run's text (p12-8's latest_run_text / status's blockerSummary). The first
// non-blank line decides the stage; the history accepts both the marker form and reconcile's `Round N:`,
// from the first line on, so a `## Review-blocked feedback` run (which opens with `Round 1:`) parses whole.
function parseIntegrationMarker(text) {
  const lines = String(text == null ? '' : text).split('\n')
  const at = lines.findIndex((l) => l.trim())
  const first = at === -1 ? '' : lines[at].trim()
  const low = first.toLowerCase()
  const stage = low.startsWith(REVISE_MARKER.split(' — ')[0].toLowerCase()) ? 'revise'
    : low.startsWith('integration:') ? 'integrate' : 'own'
  let reason = String(text == null ? '' : text).trim()
  if (stage === 'integrate') reason = first.replace(/^integration:\s*/i, '')
  if (stage === 'revise') {
    const s = lines.find((l) => /^revise stopped:/i.test(l.trim()))
    reason = s ? s.trim().replace(/^revise stopped:\s*/i, '') : ''
  }
  const history = []
  let cur = null
  for (const raw of lines.slice(Math.max(at, 0))) {
    const l = raw.trim()
    const m = l.match(/^Round (\d+)( \(Integration\))?(?: rejection)?:$/i)
    if (m) {
      cur = { round: Number(m[1]), feedback: [] }
      if (m[2]) cur.stage = 'integration'
      history.push(cur)
      continue
    }
    const b = l.match(/^- (.+)$/)
    if (b && cur) { cur.feedback.push(b[1].trim()); continue }
    cur = null
  }
  return { stage, reason, history: history.filter((r) => r.feedback.length) }
}

// The row's blockerDiagnosis (taskResult). A seeded revise that stopped blocked (a dead or blocked
// reviser, a dead judge, a throw) resumes at revise, so it gets the revise-stopped marker with its
// history. Any other diagnosis that would parse as a stage marker is escaped as the task's own run.
function stageDiagnosis(t, norm, status) {
  const d = norm.blockerDiagnosis || ''
  if (t.resume && status === 'blocked') {
    if (parseIntegrationMarker(d).stage === 'revise') return d
    const h = norm.reviewHistory && norm.reviewHistory.length ? norm.reviewHistory : t.resume.reviewHistory
    return integrationMarker('revise-stopped', d || 'the revise call stopped with no diagnosis', h)
  }
  return d && parseIntegrationMarker(d).stage !== 'own' ? OWN_RUN_PREFIX + d : d
}

// ---- Integration: args ----

// A review history as the engine itself records it. reviewLoop pushes `{ round, feedback: verdict.feedback }`
// for every `changes` verdict, and REVIEW_VERDICT lets that feedback be [] — so a round with empty (or
// blank) feedback is valid input here, and the live row's history passes verbatim. liveHistory drops such
// rounds before use, as reconcile's history_block and parseIntegrationMarker already do, so the live and
// the cold (note-rebuilt) histories agree.
function historyError(h, allowEmpty) {
  if (!Array.isArray(h)) return 'must be an array'
  if (!allowEmpty && !h.length) return 'must be non-empty'
  let prev = 0
  for (const r of h) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return 'entries must be { round, feedback, stage? } objects'
    if (!(Number.isInteger(r.round) && r.round >= 1)) return 'round must be an integer >= 1'
    if (r.round <= prev) return 'rounds must be strictly ascending'
    if (!Array.isArray(r.feedback) || r.feedback.some((f) => typeof f !== 'string')) {
      return `round ${r.round}: feedback must be an array of strings`
    }
    if (r.stage !== undefined && r.stage !== 'integration') return `round ${r.round}: stage must be 'integration' when present`
    prev = r.round
  }
  if (!allowEmpty && !liveHistory(h).length) return 'must carry at least one round with feedback'
  return ''
}

// A validated history with blank bullets and empty rounds dropped (see historyError).
function liveHistory(h) {
  return h.map((r) => ({ ...r, feedback: r.feedback.filter((f) => f.trim()) })).filter((r) => r.feedback.length)
}

const isSha = (s) => typeof s === 'string' && SHA40.test(s)
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o)

// The PR identity both entries check: the branch and tree are the deterministic task ones, never any
// valid name (the integrator pushes to it).
function prIdentityError(a, o) {
  const t = a.task
  if (typeof t.slug !== 'string' || !t.slug) return 'task.slug must be a non-empty string'
  if (typeof a.repoPath !== 'string' || !a.repoPath) return 'repoPath must be a non-empty string'
  if (t.scope === 'read-only') return 'a read-only task has no PR to integrate or revise'
  if (typeof o.prUrl !== 'string' || !PR_URL.test(o.prUrl)) return `prUrl must be a PR URL (…/pull/<n>), got ${JSON.stringify(o.prUrl)}`
  const br = `audit-fix/${shortAlias(t.slug)}`
  if (o.branch !== br) return `branch must be ${br}, got ${JSON.stringify(o.branch)}`
  const wt = worktreeDir(a.repoPath, t.slug)
  if (o.worktreePath !== wt) return `worktreePath must be ${wt}, got ${JSON.stringify(o.worktreePath)}`
  return ''
}

// integration.rung: the task's own rung record (ADR 0029 decision 7), which Integration passes through to
// its row. Three shapes pass; anything else is a lead bug, refused before dispatch:
// - the record a task-mode row carries: { startRung, rung, climbs }, each name a rung name or '', each climb
//   { stage: plan | implement | review, from, to } with rung names (from === to is a recorded no-op);
// - the neutral record { startRung: '', rung: '', climbs: [] }, for a task whose note has no `rung:`
//   (lead-integrate.py inputs gives it, and a note stamped `rung:` gives only that name);
// - a pre-3.0.0 tier record { model: opus | fable, escalated, escalatedAt, tierCapped, tierCappedAt } (a
//   Lost-call resume of an old integrate call), which reads as neutral: Integration runs on the top rung
//   anyway, so the old record decides nothing.
function rungRecordError(g) {
  if (!isObj(g)) return `must be one object { startRung, rung, climbs }, got ${JSON.stringify(g)}`
  if ('model' in g) {
    if (!['opus', 'fable'].includes(g.model) || typeof g.escalated !== 'boolean' || typeof g.escalatedAt !== 'string' ||
      typeof g.tierCapped !== 'boolean' || typeof g.tierCappedAt !== 'string') {
      return `a pre-3.0.0 tier record must be { model: opus|fable, escalated: boolean, escalatedAt: string, tierCapped: boolean, tierCappedAt: string }, got ${JSON.stringify(g)}`
    }
    return ''
  }
  const keys = Object.keys(g).sort().join(',')
  const name = (v) => v === '' || rungName(v)
  if (keys !== 'climbs,rung,startRung' || !name(g.startRung) || !name(g.rung) || !Array.isArray(g.climbs) ||
    g.climbs.some((c) => !isObj(c) || Object.keys(c).sort().join(',') !== 'from,stage,to' || !STAGES.includes(c.stage) || !rungName(c.from) || !rungName(c.to))) {
    return `must be { startRung, rung, climbs } (rung names or '', climbs [{ stage: ${STAGES.join('|')}, from, to }]), got ${JSON.stringify(g)}`
  }
  return ''
}

// The record a validated integration.rung passes through to the row: a pre-3.0.0 tier record reads as
// the neutral one.
function integrationRung(g) {
  if ('model' in g) return { startRung: '', rung: '', climbs: [] }
  return { startRung: g.startRung, rung: g.rung, climbs: g.climbs.map((c) => ({ stage: c.stage, from: c.from, to: c.to })) }
}

// args.integration (mode 'integrate'). A bad value is a lead bug, not a task block: the caller throws
// before any agent() call. The SHAs are interpolated into bash, so they are validated, never quoted.
function integrationArgsError(a) {
  const I = a.integration
  const t = a.task
  if (!isObj(I)) return 'must be one object'
  const id = prIdentityError(a, I)
  if (id) return id
  if (!(Number.isInteger(t.maxIterations) && t.maxIterations >= 1)) return `task.maxIterations must be an integer >= 1, got ${JSON.stringify(t.maxIterations)}`
  const budget = roundBudgetDiagnosis(t, ['maxReviewRounds'])
  if (budget) return budget
  for (const k of ['headSha', 'taskBase', 'mainSha']) if (!isSha(I[k])) return `${k} must be a 40-hex commit sha, got ${JSON.stringify(I[k])}`
  if (!Array.isArray(I.trouble) || I.trouble.some((x) => !INTEGRATION_TROUBLE.includes(x)) || new Set(I.trouble).size !== I.trouble.length) {
    return `trouble must be a deduplicated subset of ${INTEGRATION_TROUBLE.join('|')}, got ${JSON.stringify(I.trouble)}`
  }
  if (!Array.isArray(I.landed)) return 'landed must be an array'
  for (const p of I.landed) {
    if (!isObj(p) || typeof p.prUrl !== 'string' || !PR_URL.test(p.prUrl) || typeof p.title !== 'string' ||
      typeof p.taskPath !== 'string' || !Array.isArray(p.files) || p.files.some((f) => typeof f !== 'string')) {
      return `landed entries must be { prUrl, title, files: string[], taskPath }, got ${JSON.stringify(p)}`
    }
  }
  if (typeof I.plan !== 'string') return 'plan must be a string'
  const he = historyError(I.reviewHistory, true)
  if (he) return 'reviewHistory ' + he
  const last = I.reviewHistory.length ? I.reviewHistory[I.reviewHistory.length - 1].round : 0
  if (!(Number.isInteger(I.reviewRoundsUsed) && I.reviewRoundsUsed >= 1 && I.reviewRoundsUsed >= last)) {
    return `reviewRoundsUsed must be an integer >= 1 and >= the history's last round (${last}), got ${JSON.stringify(I.reviewRoundsUsed)}`
  }
  const rungBad = rungRecordError(I.rung)
  if (rungBad) return 'rung ' + rungBad
  if (I.leadMerge !== undefined) {
    const m = I.leadMerge
    if (!isObj(m) || !isSha(m.mergeCommit) || !isSha(m.headSha) || !isSha(m.baseSha) || typeof m.verified !== 'boolean') {
      return 'leadMerge must be { mergeCommit, headSha, baseSha (40-hex), verified: boolean }'
    }
    // The lead's merge commit is never the anchor: an anchor refreshed to the post-merge head would let
    // the merge it holds skip the judge. The recipe gives the commit before that merge.
    if (m.mergeCommit === I.headSha) return 'leadMerge.mergeCommit is the passed anchor headSha — pass ANCHOR_RECIPE\'s anchor, never the merged head'
  }
  for (const k of ['readyAt', 'startedAt']) if (I[k] !== undefined && typeof I[k] !== 'string') return `${k} must be a string when present`
  return ''
}

// args.task.resume: the seeded revise after an Integration rejection (stage 'revise').
function resumeArgsError(a) {
  const R = a.task.resume
  if (!isObj(R)) return 'must be one object'
  if (R.stage !== 'revise') return `stage must be 'revise', got ${JSON.stringify(R.stage)}`
  const id = prIdentityError(a, R)
  if (id) return id
  const he = historyError(R.reviewHistory, false)
  if (he) return 'reviewHistory ' + he
  const last = R.reviewHistory[R.reviewHistory.length - 1].round
  if (R.reviewRoundsUsed !== last) return `reviewRoundsUsed must equal the history's last round (${last}), got ${JSON.stringify(R.reviewRoundsUsed)}`
  if (typeof R.plan !== 'string') return 'plan must be a string'
  return ''
}

// ---- Integration: metrics (no clock: the stamps come in, and agents stamp their own finish) ----

const ISO_STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/
function daysFromCivil(y, m, d) {
  const yy = m <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468
}
// An ISO stamp (`YYYY-MM-DDTHH:MM[:SS[.f]]` with `Z` or a `±HH[:]MM` offset, p12-8's offset-minute form
// included) as minutes since the epoch, or null. Zoneless or malformed stamps are null, never a guess.
function isoMinutes(s) {
  if (typeof s !== 'string') return null
  const m = s.trim().match(ISO_STAMP)
  if (!m) return null
  const [y, mo, d, h, mi] = [1, 2, 3, 4, 5].map((i) => Number(m[i]))
  const se = m[6] === undefined ? 0 : Number(m[6])
  const mdays = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (mo < 1 || mo > 12 || d < 1 || d > mdays[mo - 1] || h > 23 || mi > 59 || se > 59) return null
  let off = 0
  if (m[7] !== 'Z') {
    const digits = m[7].slice(1).replace(':', '')
    const oh = Number(digits.slice(0, 2))
    const om = Number(digits.slice(2))
    if (oh > 23 || om > 59) return null
    off = (m[7][0] === '-' ? -1 : 1) * (oh * 60 + om)
  }
  return daysFromCivil(y, mo, d) * 1440 + h * 60 + mi + se / 60 - off
}
// Whole minutes from one stamp to another; null when either is missing/unparseable or the span is negative.
function wholeMinutes(from, to) {
  const f = isoMinutes(from)
  const t = isoMinutes(to)
  if (f === null || t === null) return null
  const secs = Math.round((t - f) * 60)
  return secs < 0 ? null : Math.floor(secs / 60)
}
// waitMinutes = startedAt − readyAt; durationMinutes = the latest agent finishedAt − startedAt (null when
// no agent stamped a parseable finish).
function integrationMetrics(I, agents) {
  const readyAt = typeof I.readyAt === 'string' ? I.readyAt : null
  const startedAt = typeof I.startedAt === 'string' ? I.startedAt : null
  let finishedAt = null
  let fin = null
  for (const ag of agents || []) {
    const v = isoMinutes(ag.finishedAt)
    if (v !== null && (fin === null || v > fin)) { fin = v; finishedAt = ag.finishedAt }
  }
  return {
    readyAt, startedAt, finishedAt,
    waitMinutes: wholeMinutes(readyAt, startedAt),
    durationMinutes: finishedAt === null ? null : wholeMinutes(startedAt, finishedAt),
  }
}

// ---- Integration: rendered steps ----

// The integrator's merge step: ONE Bash command that runs under bash and `zsh -f` (the Bash tool's
// shell). A STOP prints `merge step STOP: <why>` and exits 3; the engine records it as
// `integration: merge step STOP: <why>`. In order: abort a merge left in progress; stash the tracked
// changes left behind (a dead integrator mid-fix, a verifier or env bootstrap that rewrites tracked files),
// never discarding them, printing `stashed: integration leftovers <head>`, so neither the in-run retry nor
// a re-entry wedges on them; fetch (retried once); fast-forward ONLY to origin/$BR (a divergence is a
// STOP, never a force); the anchor checks (the pinned anchor and its ref's lifecycle, see the lead
// contract) — a stale ref, a mismatched ref, an anchor that carries a merge, a base that is not
// merge-base(anchor, main), an anchor not on the branch — then the create-only anchor ref;
// the `task head:`, `integration base:`, `task file:` (B...H) and `main file:` (TB..B) lines; and exactly
// one `merge:` line. `already-merged <M>` is the newest first-parent merge in TB..H whose second parent
// is an ancestor of (or is) B; a conflict lists its `conflict:` paths before anything is resolved and
// keeps MERGE_HEAD.
function integrationMergeStep(a, task, I) {
  const wt = worktreeDir(a.repoPath, task.slug)
  const br = `audit-fix/${shortAlias(task.slug)}`
  const def = defaultBranch(a)
  const g = 'git -C "$WT"'
  return [
    `${GIT_ENV_SCRUB} WT="${wt}"; BR="${br}"; D="origin/${def}"; A="${I.headSha}"; TB="${I.taskBase}"; REF="refs/integration-anchor/$BR"`,
    '(',
    'merge_stop() { echo "merge step STOP: $1"; exit 3; }',
    `[ "$(${g} symbolic-ref -q --short HEAD)" = "$BR" ] || merge_stop "the task tree $WT is not on $BR — re-run the setup"`,
    `if ${g} rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then ${g} merge --abort || merge_stop "could not abort the merge left in progress"; echo "aborted: a merge left in progress"; fi`,
    `if [ -n "$(${g} status --porcelain --untracked-files=no)" ]; then L="integration leftovers $(${g} rev-parse HEAD)"; ${g} stash push --quiet -m "$L" || merge_stop "tracked changes in $WT could not be stashed — commit or discard them, then re-run"; echo "stashed: $L"; fi`,
    `[ -z "$(${g} status --porcelain --untracked-files=no)" ] || merge_stop "tracked changes in $WT survived the stash — commit or discard them, then re-run"`,
    `${g} fetch origin --quiet || ${g} fetch origin --quiet || merge_stop "fetch origin failed twice"`,
    `${g} show-ref --verify --quiet "refs/remotes/origin/$BR" || merge_stop "origin/$BR does not exist — the PR branch is gone"`,
    `${g} merge --ff-only --quiet "origin/$BR" >/dev/null 2>&1 || merge_stop "$BR has diverged from origin/$BR — never force; reconcile it by hand"`,
    `for s in "$A" "$TB"; do ${g} cat-file -e "$s^{commit}" 2>/dev/null || merge_stop "unknown commit $s"; done`,
    `H=$(${g} rev-parse HEAD); B=$(${g} rev-parse "$D"); X=$(${g} rev-parse -q --verify "$REF" 2>/dev/null)`,
    'if [ -n "$X" ]; then',
    `  ${g} merge-base --is-ancestor "$X" "$H" || merge_stop "stale anchor ref $X is not on $BR (branch recut or rewritten) — delete it: git update-ref -d $REF $X"`,
    '  [ "$X" = "$A" ] || merge_stop "anchor mismatch: recorded $X, passed $A — pass the recorded anchor"',
    'fi',
    `if [ -n "$(${g} rev-list --first-parent --merges "$TB..$A")" ]; then R=$(${ANCHOR_RECIPE}); R=$(echo "$R" | cut -d' ' -f2); merge_stop "anchor $A carries a merge — ANCHOR_RECIPE gives $R"; fi`,
    `MB=$(${g} merge-base "$A" "$B"); [ "$MB" = "$TB" ] || merge_stop "taskBase $TB is not merge-base($A, $D) = $MB — pass the task's own base"`,
    `${g} merge-base --is-ancestor "$A" "$H" || merge_stop "anchor $A is not an ancestor of $BR's head $H (rewritten?)"`,
    `[ -n "$X" ] || ${g} update-ref "$REF" "$A" "" || merge_stop "could not record the anchor ref $REF"`,
    'echo "anchor: $A base $TB"; echo "task head: $H"; echo "integration base: $B"',
    `${g} diff --name-only "$B...$H" | sed 's/^/task file: /'`,
    `${g} diff --name-only "$TB" "$B" | sed 's/^/main file: /'`,
    'if [ "$B" = "$TB" ]; then echo "merge: up-to-date"',
    `elif ${g} merge-base --is-ancestor "$B" "$H"; then`,
    `  M=""; for c in $(${g} rev-list --first-parent --merges "$TB..$H"); do if ${g} merge-base --is-ancestor "$c^2" "$B"; then M=$c; break; fi; done`,
    `  [ -n "$M" ] || merge_stop "$D is already in $BR but no first-parent merge brought it in"`,
    '  echo "merge: already-merged $M"',
    `elif ${g} merge --no-ff --no-edit -m "Merge origin/${def} into $BR (Integration)" "$B" >/dev/null 2>&1; then echo "merge: merged $(${g} rev-parse HEAD)"`,
    `elif ${g} rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then echo "merge: conflict"; ${g} diff --name-only --diff-filter=U | sed 's/^/conflict: /'`,
    'else merge_stop "git merge failed with no conflict (an untracked file in the way?)"; fi',
    ')',
  ].join('\n')
}

// The Integration judge's merge reads: EVERY first-parent merge in anchor..head, newest first, not only the
// merge this call made. An earlier Integration can push its merge and then lose its judge (a death, an
// unreadable check), and a lead merge (P1) can sit on top of such a merge; the next judge is the only one
// left to read it. For each merge it prints `show --cc` (the merge's own resolution) and the remerge diff
// (the committed merge against git's automatic merge of the same parents; skipped on git < 2.38, which has
// no `merge-tree --write-tree`), then a count line. Read-only; runs under bash and `zsh -f`.
function integrationMergeReads(a, task, I, j) {
  const wt = worktreeDir(a.repoPath, task.slug)
  const g = 'git -C "$WT"'
  return [
    `${GIT_ENV_SCRUB} WT="${wt}"; A="${I.headSha}"; HD="${j.headSha}"; n=0`,
    `for C in $(${g} log --first-parent --merges --format=%H "$A..$HD"); do`,
    '  n=$((n+1)); echo "=== merge $C"',
    `  ${g} show --cc "$C"`,
    `  T=$(${g} merge-tree --write-tree "$C^1" "$C^2" 2>/dev/null | head -n 1)`,
    `  if [ -n "$T" ]; then echo "=== remerge diff $C"; ${g} diff "$T" "$C"; else echo "=== no remerge diff for $C (git < 2.38)"; fi`,
    'done',
    'echo "=== $n first-parent merge(s) in $A..$HD"',
  ].join('\n')
}

// The Integration judge's first step: can it read what it judges? Every SHA it reads is checked with
// `cat-file -e`, fetched on a miss and re-checked; then the anchor checks, read-only (it never writes the
// ref). Prints `judge check: ok` or `judge check: FAIL <why>` (exit 3).
function integrationJudgeCheck(a, task, I, j) {
  const wt = worktreeDir(a.repoPath, task.slug)
  const br = `audit-fix/${shortAlias(task.slug)}`
  const g = 'git -C "$WT"'
  const shas = [j.mergeCommit, j.headSha, I.headSha, j.baseSha].filter((s) => s).join(' ')
  const probe = `miss=""; for s in ${shas}; do ${g} cat-file -e "$s^{commit}" 2>/dev/null || miss="$miss $s"; done`
  return [
    `${GIT_ENV_SCRUB} WT="${wt}"; BR="${br}"; A="${I.headSha}"; TB="${I.taskBase}"; HD="${j.headSha}"; REF="refs/integration-anchor/$BR"`,
    '(',
    'check_fail() { echo "judge check: FAIL $1"; exit 3; }',
    probe,
    `if [ -n "$miss" ]; then ${g} fetch origin --quiet; ${g} fetch origin "$BR" --quiet; ${probe}; fi`,
    '[ -z "$miss" ] || check_fail "cannot read the integration commits:$miss"',
    `X=$(${g} rev-parse -q --verify "$REF" 2>/dev/null)`,
    'if [ -n "$X" ]; then',
    `  ${g} merge-base --is-ancestor "$X" "$HD" || check_fail "stale anchor ref $X is not on $BR (branch recut or rewritten)"`,
    '  [ "$X" = "$A" ] || check_fail "anchor mismatch: recorded $X, passed $A"',
    `elif [ -n "$(${g} rev-list --first-parent --merges "$TB..$A")" ]; then check_fail "anchor $A carries a merge"`,
    'fi',
    `${g} merge-base --is-ancestor "$A" "$HD" || check_fail "anchor $A is not an ancestor of head $HD"`,
    'echo "judge check: ok"',
    ')',
  ].join('\n')
}

// The integrator's verification: the full Ralph loop (Integration runs on the top rung, so there is no
// one-shot hand-over) with the note write replaced — the engine records the diagnosis with its marker.
function integrationVerify(task, a) {
  const noteWrite = 'Also append that diagnosis to the task note under a "## Blocker diagnosis" heading.'
  return ralphLoop(task.verifier || a.verifier, task.maxIterations, a.knownBaselineFailures)
    .replace(noteWrite, 'Write nothing to the task note (the engine records the diagnosis), and push nothing.')
}

const INTEGRATION_PRIOR_NOTE = `The task note may carry "## Blocker diagnosis" runs from an earlier Integration or revise (a latest run
starting \`integration:\` or \`revise:\`): read them as context. The task brief and the review history below are
the contract. Write NOTHING to the task note in this call — the engine records your result.`

// The integrator's preflights. The scope check diffs against the INTEGRATION base, never the task's base:
// once origin/<default> is merged in, everything it brought sits in the task-base range.
const INTEGRATION_PREFLIGHTS = `
Before you push, run these preflight checks:
- Worktree safety: \`${GIT_ENV_SCRUB} git rev-parse --show-toplevel\` prints the task tree, NOT the project's main checkout.
- Scope: \`${GIT_ENV_SCRUB} git diff --stat <integration base>...HEAD\` (the sha on the merge step's \`integration base:\` line) lists only the task's own files plus your resolution and fixes. A file outside that set: STOP and return blocked.
- Sibling-site blindness: when a resolution or fix changes a code shape, grep the file AND the codebase for the same shape and fix every sibling the landed PRs or this task touched.
- Dead code: a helper you add has a PRODUCTION caller, not just tests.
- No force: push plainly. A rejected push is a STOP (return blocked) — never force-push, never rewrite the branch.`.trim()

function landedBlock(a, task, I) {
  const wt = worktreeDir(a.repoPath, task.slug)
  if (!I.landed.length) {
    return `No landed PRs were passed (origin/${defaultBranch(a)} may have moved by direct push): read
\`${GIT_ENV_SCRUB} git -C "${wt}" log --first-parent ${I.taskBase}..origin/${defaultBranch(a)}\` instead, after the merge step's fetch.`
  }
  return I.landed.map((p) => `- ${p.prUrl} — ${p.title}
  files: ${p.files.length ? p.files.join(', ') : '(none listed)'}
  task brief: ${p.taskPath || '(none)'}`).join('\n') +
    '\nRead EVERY brief above and each PR\'s `gh pr diff <url>` before you resolve anything: their intent is half the contract.' +
    `\nThis list ends at ${I.mainSha}, origin/${defaultBranch(a)} as the lead read it. When the merge step's \`integration base:\` sha
is not ${I.mainSha}, more PRs landed after that read: run
\`${GIT_ENV_SCRUB} git -C "${wt}" log --first-parent ${I.mainSha}..<integration base>\` after the merge step and read
each PR there (its brief and \`gh pr diff\`) the same way, before you resolve anything.` +
    `\nCommits pushed to origin/${defaultBranch(a)} without a PR (no \` (#N)\` suffix, no \`Merge pull request #N\` prefix) are in no list here: after the merge step, find them with
\`${GIT_ENV_SCRUB} git -C "${wt}" log --first-parent --oneline ${I.taskBase}..${I.mainSha}\` (and in the later range above, when there is one), and read
each one's \`${GIT_ENV_SCRUB} git -C "${wt}" show <sha>\` before you resolve anything: its diff is its only brief, and it is theirs as much as the landed PRs.`
}

function integratorPrompt(task, a, I) {
  const wt = worktreeDir(a.repoPath, task.slug)
  const def = defaultBranch(a)
  const trouble = I.trouble.length ? I.trouble.join(', ') : 'none reported (a re-entry: find it from the merge step and the verifier)'
  const history = I.reviewHistory.length ? `

The review history — ANTI-REGRESSION constraints: every point stays resolved through your resolution:
${markerHistory(I.reviewHistory)}` : ''
  return `INTEGRATION (trouble path, ADR 0030 decision 3) for [[${task.slug}]] (rollout [[${a.rolloutSlug}]]). The task's PR
is approved: bring the latest origin/${def} into its branch, resolve, re-verify and push. You never merge the PR.

Task note (the brief): ${task.taskPath}
PR: ${I.prUrl}
Branch: ${I.branch}
Task tree: ${wt}

${branchTreeSetup(a, task, true)}

${GIT_ENV_RULE}

${RM_RULE}

Why you are here — the lead's trouble: ${trouble}.
${INTEGRATION_PRIOR_NOTE}

The approved plan, for reference only. The brief is the contract: a deviation from this plan that the PR body declares
(a step-back revise may make one) stands, and your resolution never undoes it.
---
${I.plan || '(no plan: the task was not plan-gated — the brief is the contract)'}
---${history}

PRs that landed on origin/${def} since the task's base ${I.taskBase}:
${landedBlock(a, task, I)}

Step 1 — the merge step. Run exactly, as ONE Bash command (exit 3 is a STOP):
${integrationMergeStep(a, task, I).split('\n').map((l) => '  ' + l).join('\n')}
It aborts a merge left in progress, stashes any tracked changes an earlier attempt left behind (a
\`stashed: integration leftovers <head>\` line: leave that stash alone, never pop or apply it, and name it in your
summary), fetches, fast-forwards ${I.branch} to its origin copy (never past a divergence), checks the task's
anchor ${I.headSha} (recorded once as refs/integration-anchor/${I.branch}) and prints \`anchor:\`, \`task head:\`,
\`integration base:\`, \`task file:\` and \`main file:\` lines and exactly one \`merge:\` line. Copy its stdout
VERBATIM into mergeLog. On a \`merge step STOP: <why>\` line: change nothing, and return blocked=true with that
line verbatim as blockerDiagnosis and mergeState "none".

Step 2 — resolve. On \`merge: conflict\`: resolve every \`conflict:\` path keeping BOTH intents — what the
landed PRs did (theirs) and what this task did (ours); never drop a side to make the merge go through. Then
stage the paths and complete the merge with \`${GIT_ENV_SCRUB} git -C "${wt}" commit --no-edit\`. A conflict you
cannot resolve without dropping an intent: \`${GIT_ENV_SCRUB} git -C "${wt}" merge --abort\`, push nothing, and
return blocked=true naming the files.

Step 3 — verify. Required unless ALL of these hold: the merge step printed \`merge: up-to-date\`, the lead's
trouble has no \`red\`, \`task head:\` equals the anchor ${I.headSha}, and you committed nothing. When required:
${integrationVerify(task, a)}

${INTEGRATION_PREFLIGHTS}

Step 4 — push and read back. Push plainly with \`${GIT_ENV_SCRUB} git -C "${wt}" push origin "${I.branch}"\`, then
read \`${GIT_ENV_SCRUB} git -C "${wt}" ls-remote origin "refs/heads/${I.branch}"\`: its sha is pushedSha, and
\`${GIT_ENV_SCRUB} git -C "${wt}" rev-parse HEAD\` is headSha. A rejected push is a STOP: return blocked.

${GATED_INPUTS_CHECK}${baselineManifest(a)}${gateOverride(task)}

Rules: never edit the PR (title, body, labels, comments), never merge it, never write the task note. Return
blocked, blockerDiagnosis, verified (true only if the verifier went green in THIS call), mergeLog, mergeState,
mergeCommit (after a conflict: your resolution commit), taskHead, baseSha, headSha, pushedSha, conflictFiles
(the \`conflict:\` paths), fixCommits (your non-merge commits after the merge), summary, and as your LAST action
run \`date -u +%Y-%m-%dT%H:%M:%SZ\` and return its output as finishedAt.`
}

// j: { mergeCommit ('' when nothing was merged), headSha, baseSha, triggers, path }.
function integrationReviewPrompt(task, a, I, j) {
  const wt = worktreeDir(a.repoPath, task.slug)
  const def = defaultBranch(a)
  const S = `${GIT_ENV_SCRUB} git -C "${wt}"`
  const M = j.mergeCommit
  // `landed` covers taskBase..mainSha (the lead's read). A base past mainSha means PRs landed after that
  // read, invisible to the list; with no list the taskBase..base read already covers them.
  // Commits pushed without a PR are in no list: a non-empty list adds the taskBase..mainSha log for them.
  const late = I.landed.length && j.baseSha !== I.mainSha
  const reads = [
    `- EVERY first-parent merge on the branch since the anchor, not only the newest: a merge an earlier
  Integration pushed but never had judged is part of what you judge now. Run exactly, as ONE Bash command
  (per merge: its own resolution, \`show --cc\`, then its remerge diff, how the committed merge differs from
  git's automatic one):
${integrationMergeReads(a, task, I, j).split('\n').map((l) => '    ' + l).join('\n')}`,
    ...(M ? [
      `- \`${S} diff "${M}^1" ${M}\` and \`${S} diff "${M}^2" ${M}\` — the newest merge as each side sees it.`,
    ] : [`- No new merge commit: origin/${def} was not merged in this integration (the merges above, if any, are earlier ones).`]),
    `- \`${S} log -p --first-parent --no-merges ${I.headSha}..${j.headSha}\` — every commit on the branch since the anchor (repair, revise and fix commits).`,
    ...(I.landed.length
      ? [...I.landed.map((p) => `- ${p.prUrl} (${p.title}): \`gh pr diff ${p.prUrl}\` and its brief ${p.taskPath || '(none)'}.`),
        `- \`${S} log --first-parent --oneline ${I.taskBase}..${I.mainSha}\` — the commits pushed to origin/${def} without a PR (no \` (#N)\` suffix, no \`Merge pull request #N\` prefix) are in no list above: read each one's \`${S} show <sha>\` too (and any in the later range below, when it is listed). In Step 3 they count as theirs, the same as the landed PRs.`]
      : [`- No landed PRs were passed: read \`${S} log --first-parent ${I.taskBase}..${j.baseSha}\` for what landed.`]),
    ...(late ? [
      `- \`${S} log --first-parent ${I.mainSha}..${j.baseSha}\` — PRs that landed after the lead read origin/${def} at ${I.mainSha}, so not listed above: read each one's \`gh pr diff\` and brief too.`,
    ] : []),
  ]
  const last = I.reviewHistory[I.reviewHistory.length - 1]
  const history = I.reviewHistory.length ? `

The PR's review history (context):
${markerHistory(I.reviewHistory)}${last.stage === 'integration' ? `

The latest round is an earlier Integration re-review's rejection, since revised: confirm each point is
resolved; an open point is grounds for \`changes\`.` : ''}` : ''
  return `You are the Integration RE-REVIEW judge for [[${task.slug}]] (rollout [[${a.rolloutSlug}]]), ADR 0030 decision 3.
The task's PR was approved; origin/${def} has since been brought into its branch. You judge ONLY that
integration, read-only: no edit, commit or push, in the tree or anywhere else.

PR: ${I.prUrl}
Task note (the brief): ${task.taskPath}
Task tree: ${wt}
Path: ${j.path === 'judge-only' ? 'the lead merged and verified; no integrator ran' : 'an integrator merged, resolved and verified'}.
Why you are here: ${j.triggers.join(', ')}.

${branchTreeSetup(a, task, false)}

${GIT_ENV_RULE}

${RM_RULE}

Step 1 — the judge check. Run exactly, as ONE Bash command:
${integrationJudgeCheck(a, task, I, j).split('\n').map((l) => '  ' + l).join('\n')}
On \`judge check: FAIL <why>\`: read nothing else, and return verdict "changes", unreadable=true and one
bullet "cannot read the integration: <why>". Never approve what you could not read.

Step 2 — read the integration (merge ${M || '(none)'}, head ${j.headSha}, base ${j.baseSha}, anchor ${I.headSha}):
${reads.join('\n')}${history}

Step 3 — decide ONE question, not a fresh review of the task: was anything of theirs (the landed PRs)
dropped or contradicted, or anything of ours (this task's approved change) lost? Verdict "approve" if
nothing was, else "changes" with 1–8 specific bullets (they become the revise call's work order);
unreadable=false. As your LAST action run \`date -u +%Y-%m-%dT%H:%M:%SZ\` and return its output as finishedAt.`
}

// ---- Integration: the call ----

// The integrator's merge-step log, line by line (only the step's own prefixes are read).
function parseMergeLog(text) {
  const lines = String(text == null ? '' : text).split('\n').map((l) => l.replace(/\s+$/, ''))
  const one = (p) => {
    const l = lines.find((x) => x.startsWith(p))
    return l === undefined ? null : l.slice(p.length).trim()
  }
  const all = (p) => lines.filter((x) => x.startsWith(p)).map((x) => x.slice(p.length).trim()).filter((x) => x)
  return {
    anchor: one('anchor: '),
    taskHead: one('task head: '),
    base: one('integration base: '),
    merge: lines.filter((x) => x.startsWith('merge: ')),
    taskFiles: all('task file: '),
    mainFiles: all('main file: '),
    conflicts: all('conflict: '),
  }
}

// Checks the integrator's result (pure). null when it is usable, else { reason, gates? } — a set-aside.
// A verify is required unless the base is unmoved, nothing is red, the branch has not moved and nothing
// was committed: then (the race case) the result integrates with no verifier run.
function integrationCheck(I, r, approved) {
  if (!r || r.__dead) return { reason: TRANSIENT_DIAGNOSIS }
  const gates = unapprovedGates(r.gatedInputs, approved)
  if (gates.length) return { reason: gateDiagnosis(gates), gates }
  if (r.blocked) return { reason: r.blockerDiagnosis || 'the integrator returned blocked with no diagnosis' }
  const log = parseMergeLog(r.mergeLog)
  if (log.anchor === null) return { reason: 'the merge log has no `anchor:` line — the merge step did not run as rendered' }
  if (log.anchor !== `${I.headSha} base ${I.taskBase}`) return { reason: `the merge log's anchor line (${log.anchor}) is not the passed anchor ${I.headSha} base ${I.taskBase}` }
  if (log.merge.length !== 1) return { reason: `the merge log has ${log.merge.length} \`merge:\` lines, not one` }
  if (!log.taskFiles.length) return { reason: 'the merge log has no `task file:` line' }
  if (r.mergeState === 'none') return { reason: 'mergeState is none but the integrator did not report blocked' }
  if (!['up-to-date', 'already-merged', 'merged'].includes(r.mergeState)) return { reason: `unknown mergeState ${JSON.stringify(r.mergeState)}` }
  const merged = r.mergeState !== 'up-to-date'
  for (const k of ['taskHead', 'baseSha', 'headSha', 'pushedSha', ...(merged ? ['mergeCommit'] : [])]) {
    if (!isSha(r[k])) return { reason: `${k} is not a 40-hex sha: ${JSON.stringify(r[k])}` }
  }
  const line = log.merge[0]
  const lm = line.match(/^merge: (up-to-date|already-merged|merged|conflict)(?: ([0-9a-f]{40}))?$/)
  const agrees = lm && (
    (lm[1] === 'up-to-date' && !lm[2] && r.mergeState === 'up-to-date') ||
    (lm[1] === 'conflict' && !lm[2] && r.mergeState === 'merged') ||
    ((lm[1] === 'merged' || lm[1] === 'already-merged') && lm[1] === r.mergeState && lm[2] === r.mergeCommit))
  if (!agrees) return { reason: `the merge log's \`${line}\` disagrees with mergeState ${r.mergeState} / mergeCommit ${r.mergeCommit || '(none)'}` }
  if (log.taskHead !== r.taskHead) return { reason: `taskHead ${r.taskHead} is not the merge log's task head ${log.taskHead}` }
  if (log.base !== r.baseSha) return { reason: `baseSha ${r.baseSha} is not the merge log's integration base ${log.base}` }
  if (r.mergeState === 'up-to-date' && r.baseSha !== I.taskBase) return { reason: `merge: up-to-date onto ${r.baseSha}, which is not the task's base ${I.taskBase}` }
  if (r.pushedSha !== r.headSha) return { reason: `origin has ${r.pushedSha}, not the integrated head ${r.headSha} — the push did not land` }
  const verifyRequired = merged || I.trouble.includes('red') || r.taskHead !== I.headSha || r.headSha !== r.taskHead
  if (verifyRequired && !r.verified) return { reason: 'the full verifier was required but did not go green in this call' }
  return null
}

// The re-review triggers, computed here and failing closed — the agent reports no trigger flag.
function integrationTriggers(I, r) {
  const log = parseMergeLog(r.mergeLog)
  const text = String(r.mergeLog || '')
  const out = []
  if (I.trouble.includes('conflict') || (r.conflictFiles || []).length || /^merge: conflict$/m.test(text) || /^conflict: /m.test(text)) out.push('conflict')
  const merged = r.mergeState === 'merged' || r.mergeState === 'already-merged'
  if ((r.fixCommits || []).length || (merged && r.headSha !== r.mergeCommit) || (r.mergeState === 'up-to-date' && r.headSha !== r.taskHead)) out.push('committed')
  if (r.taskHead !== I.headSha) out.push('branch-moved')
  const theirs = new Set(log.mainFiles)
  for (const p of I.landed) for (const f of p.files) theirs.add(f)
  if (I.trouble.includes('shared-file') || log.taskFiles.some((f) => theirs.has(f))) out.push('shared-file')
  return out
}

// One Integration: P1 (judge only) or P2 (integrator, then the judge when any trigger is set). trace
// collects the path and every agent dispatched, so a throw still reports what ran.
// No signed-gate continuation here, by design (p12-14): an Integration gate stop sets the task aside at
// Integration, and once signed it re-enters through the Integration queue (approve-gates writes `review`),
// so a fresh integrate call re-reads the latest main (ADR 0030 decision 3) and is never a resume.
async function integrate(task, a, trace) {
  const I = a.integration
  // Integration runs on the ladder's TOP rung whatever rung the task reached (ADR 0029 decision 5): the
  // integrator at the top rung's effort, the judge at its review effort. Integration is not the task's own
  // run, so the task's record (integration.rung) decides nothing here; it only passes through to the row.
  const L = ladderOf(a)
  const top = L.rungs[L.rungs.length - 1]
  const effortOf = { integrator: top.effort, judge: top.review }
  const R = I.reviewRoundsUsed
  const lm = I.leadMerge
  const opts = (label, schema, role) => ({ label, phase: 'Integration', schema, model: top.model, effort: effortOf[role] })
  // Each dispatch is recorded on the trace BEFORE it runs, as task mode records on st.ran (ADR 0029 decision
  // 7): an integrator or judge that throws is still in the row's `ran` and `integration.agents`. `finished`
  // fills its finishedAt in once it returns ('' for a dead or thrown one).
  const record = (role, label) => {
    const rec = { role, label, rung: top.name, model: top.model, effort: effortOf[role], finishedAt: '' }
    trace.agents.push(rec)
    return rec
  }
  const finished = (rec, r) => {
    if (!r.__dead && typeof r.finishedAt === 'string') rec.finishedAt = r.finishedAt
  }
  const ilabel = `integrate:${task.slug}`
  const jlabel = `integration-review:${task.slug} r${R + 1}`
  let j
  if (lm && lm.verified && I.trouble.length === 1 && I.trouble[0] === 'shared-file' && lm.headSha === lm.mergeCommit && lm.baseSha !== I.taskBase) {
    // P1: the lead merged cleanly and its verifier went green — no top-rung agent only to re-run it.
    trace.path = 'judge-only'
    j = { mergeCommit: lm.mergeCommit, headSha: lm.headSha, baseSha: lm.baseSha, triggers: ['shared-file'], path: trace.path }
  } else {
    trace.path = 'integrator'
    const ri = record('integrator', ilabel)
    const r = await runAgent(integratorPrompt(task, a, I), opts(ilabel, INTEGRATE_RESULT, 'integrator'))
    finished(ri, r)
    const bad = integrationCheck(I, r, task.approvedGates)
    if (bad) return { outcome: 'set-aside', reason: bad.reason, gates: bad.gates || [] }
    j = { mergeCommit: r.mergeState === 'up-to-date' ? '' : r.mergeCommit, headSha: r.headSha, baseSha: r.baseSha, triggers: integrationTriggers(I, r), path: trace.path }
    if (!j.triggers.length) return { outcome: 'integrated', ...j, reReviewed: false }
  }
  const rj = record('judge', jlabel)
  const v = await runAgent(integrationReviewPrompt(task, a, I, j), opts(jlabel, INTEGRATION_REVIEW, 'judge'))
  finished(rj, v)
  if (v.__dead) return { outcome: 'set-aside', reason: TRANSIENT_DIAGNOSIS, ...j, reReviewed: false }
  const feedback = (v.feedback || []).map(flattenLine).filter((f) => f)
  if (v.unreadable) return { outcome: 'set-aside', reason: `judge could not read the integration — ${feedback[0] || 'no reason given'}`, ...j, reReviewed: true, feedback }
  if (v.verdict === 'approve') return { outcome: 'integrated', ...j, reReviewed: true }
  return { outcome: 'rejected', ...j, reReviewed: true, feedback: feedback.length ? feedback : ['the Integration re-review returned changes with no feedback'] }
}

// The integrate call's ONE row: the task row's 20 keys plus `integration` (the payload the Integration log line
// records). Its rung record is the task's own, passed through; its `ran` is Integration's agents.
// Every status is one of reconcile's five: integrated → review; rejected → blocked with the revise
// marker (review-blocked when no review round is left); set-aside → blocked with `integration: <reason>`
// (gate-pending for a gate). A rejected task's note therefore never reads as approved.
function integrationResult(task, out, a, trace) {
  const I = a.integration
  const o = out || { outcome: 'set-aside', reason: INTEGRATION_THREW }
  let status = 'review'
  let blockerDiagnosis = ''
  let reviewFeedback = []
  let reviewHistory = I.reviewHistory
  let reviewRoundsUsed = I.reviewRoundsUsed
  let gatedInputs = []
  if (o.outcome === 'rejected') {
    reviewFeedback = o.feedback
    reviewRoundsUsed = I.reviewRoundsUsed + 1
    // one-line bullets throughout, so the history parsed back from the marker equals this one
    reviewHistory = [...normHistory(I.reviewHistory), { round: reviewRoundsUsed, feedback: o.feedback, stage: 'integration' }]
    if (reviewRoundsUsed >= task.maxReviewRounds) status = 'review-blocked'
    else { status = 'blocked'; blockerDiagnosis = integrationMarker('rejected', '', reviewHistory) }
  } else if (o.outcome === 'set-aside') {
    gatedInputs = o.gates || []
    status = gatedInputs.length ? 'gate-pending' : 'blocked'
    blockerDiagnosis = integrationMarker('set-aside', o.reason, I.reviewHistory)
  }
  const head = o.headSha || ''
  const g = integrationRung(I.rung)
  return {
    slug: task.slug,
    scope: task.scope,
    status,
    prUrl: I.prUrl,
    branch: I.branch,
    worktreePath: I.worktreePath,
    reviewRoundsUsed,
    planRoundsUsed: 0,
    blockerDiagnosis,
    reviewFeedback,
    reviewHistory,
    approvedAtCeiling: false,
    gatedInputs,
    summary: o.outcome === 'integrated'
      ? `integrated ${head} onto ${o.baseSha} (${trace.path}${o.reReviewed ? ', re-reviewed' : ', no re-review'})`
      : o.outcome === 'rejected' ? `Integration re-review rejected ${head}` : `set aside at Integration: ${flattenLine(o.reason)}`,
    startRung: g.startRung,
    rung: g.rung,
    climbs: g.climbs,
    rungDrift: '',
    ran: trace.agents.map((x) => ({ label: x.label, rung: x.rung, model: x.model, effort: x.effort })),
    plan: null,
    integration: {
      outcome: o.outcome,
      path: trace.path,
      anchor: { headSha: I.headSha, taskBase: I.taskBase },
      headSha: head,
      baseSha: o.baseSha || '',
      mergeCommit: o.mergeCommit || '',
      triggers: o.triggers || [],
      reReviewed: !!o.reReviewed,
      feedback: o.feedback || [],
      reason: o.outcome === 'set-aside' ? flattenLine(o.reason) : '',
      agents: trace.agents,
      metrics: integrationMetrics(I, trace.agents),
    },
  }
}

// ---- Orchestration: one task per call; the lead holds the calls (ADR 0030) ---

// The Workflow tool passes `args` to a scriptPath workflow JSON-stringified, not as a live
// object (confirmed empirically: the script sees `typeof args === 'string'`). Parse defensively
// so the engine works whether args arrives as a string or an object.
const a = typeof args === 'string' ? JSON.parse(args) : args
defaultBranch(a)   // fail the run before any dispatch on an unusable args.defaultBranch
// Refuse the pre-p12-5 `waves` args shape before any dispatch: a lead on a stale SKILL.md, or a resume of a
// pre-rename run, must fail loudly here rather than converge nothing. Recovery is a re-dispatch.
if (a.waves !== undefined) throw new Error('task.workflow.js takes one args.task, not args.waves (ADR 0030, p12-5)')
if (!a.task || typeof a.task !== 'object' || Array.isArray(a.task)) throw new Error('args.task must be one task object')
// args.mode (p12-6): absent or 'task' runs the task's own call; 'integrate' runs Integration's trouble
// path. Bad Integration or seeded-revise args are lead bugs, refused before any dispatch.
const mode = a.mode === undefined ? 'task' : a.mode
if (mode !== 'task' && mode !== 'integrate') throw new Error(`args.mode: refusing ${JSON.stringify(a.mode)} — 'task' (the default) or 'integrate'`)
// args.ladder (ADR 0029 decision 6): the ladder.py JSON the lead resolved at this call's start. A malformed
// one is a lead bug, refused before any dispatch in both modes; an absent one is the built-in ladder.
const badLadder = ladderArgsError(a.ladder)
if (badLadder) throw new Error('args.ladder: ' + badLadder)
// Printed at every call, so a run's log names the ladder it ran on (a path, or built-in).
function logLadder() {
  const L = ladderOf(a)
  const none = a.ladder === undefined || a.ladder === null
  log(`ladder: ${L.source} — ${L.rungs.map((g) => g.name).join(', ')}` +
    (none ? ' (no args.ladder: a call from before 3.0.0 runs on the built-in ladder)' : ''))
}
if (mode === 'integrate') {
  const bad = integrationArgsError(a)
  if (bad) throw new Error('args.integration: ' + bad)
  if (a.task.resume !== undefined) throw new Error("args.task.resume: a seeded revise is its own call, never mode 'integrate'")
} else if (a.integration !== undefined) {
  throw new Error("args.integration: only with args.mode 'integrate'")
}
if (mode === 'task' && a.task.resume !== undefined) {
  const bad = resumeArgsError(a)
  if (bad) throw new Error('args.task.resume: ' + bad)
}

if (mode === 'integrate') {
  log(`integrate: ${a.rolloutSlug} — ${a.task.slug} (${a.task.scope})`)
  logLadder()
  if (a.progress) log(a.progress)
  // The validated history with its empty rounds dropped (liveHistory) is the one every prompt and the row use.
  const ia = { ...a, integration: { ...a.integration, reviewHistory: liveHistory(a.integration.reviewHistory) } }
  // A stage that throws becomes a set-aside at Integration, never a lost result.
  const trace = { agents: [], path: '' }
  let out
  try {
    out = await integrate(ia.task, ia, trace)
  } catch (e) {
    log(`integrate threw on ${a.task.slug}: ${(e && e.message) || e}`)
    out = null
  }
  const irow = integrationResult(ia.task, out, ia, trace)
  log(`${irow.slug} → ${irow.status} (integration: ${irow.integration.outcome})`)
  return { rolloutSlug: a.rolloutSlug, tasks: [irow] }
}

log(`task: ${a.rolloutSlug} — ${a.task.slug} (${a.task.scope})`)
logLadder()
// Progress/ETA relay: the sandbox has no clock, so the skill precomputes this line (reconcile-rollout.py
// next / mark-started) from the task notes' started:/merged: stamps and the engine just surfaces it.
if (a.progress) log(a.progress)

// A seeded revise uses its validated history with the empty rounds dropped (liveHistory); any other task
// object passes through untouched.
const callTask = a.task.resume
  ? { ...a.task, resume: { ...a.task.resume, reviewHistory: liveHistory(a.task.resume.reviewHistory) } }
  : a.task
// The task's rung state, built before converge so a stage that throws still reports its record.
const st = rungState(callTask, a)
// A stage that throws drops the task to null, which taskResult() turns into a blocked row — the same
// mapping the engine has always had, so one bad stage never loses the call's result.
let r
try {
  r = await converge(callTask, a, st)
} catch (e) {
  log(`converge threw on ${a.task.slug}: ${(e && e.message) || e}`)
  r = null
}
const row = taskResult(callTask, r, st)
log(`${row.slug} → ${row.status}`)

return { rolloutSlug: a.rolloutSlug, tasks: [row] }
