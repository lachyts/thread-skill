# Per-task subagent prompts — moved

As of `protocol_version: 3`, the dispatched-subagent prompts are **no longer read from this file at runtime**. Workflow scripts have no filesystem access, so the eight prompt variants now live as inlined template-builder functions in:

```
${CLAUDE_PLUGIN_ROOT}/skills/execute/wave-execute.workflow.js
```

The variants and the functions that build them:

| Variant | Builder in `wave-execute.workflow.js` | Returns (schema) |
|---|---|---|
| Implementer (gate off) | `implementerPrompt` | `IMPL_RESULT` |
| Read-only investigator | `readOnlyPrompt` | `IMPL_RESULT` (no PR) |
| Planner (gate on) | `plannerPrompt` | `PLAN_VERDICT` |
| Plan judge | `planJudgePrompt` | `PLAN_JUDGE` |
| Plan-reviser | `planReviserPrompt` | `PLAN_VERDICT` |
| Approved-plan implementer | `approvedPlanImplementerPrompt` | `IMPL_RESULT` |
| Review judge | `reviewJudgePrompt` | `REVIEW_VERDICT` |
| Reviser | `reviserPrompt` | `IMPL_RESULT` |

Signatures are deliberately not reproduced here — read them off the script. The escalation parameters (`tier`, `prior`, `priorFeedback` — ADR 0006/0007) travel with the engine, and any copy of them in this file goes stale.

Sentinel strings (`WAVE-VERIFIED` / `PLAN-READY` / `BLOCKED:`) are gone — every agent now returns a validated structured object (the `schema:` option on `agent()`), so the engine branches on typed fields instead of parsing free text.

The shared fragments (`BUG_PREFLIGHTS`, `GATED_INPUTS_CHECK`, `ralphLoop(...)`) carry the verifier-retry contract, the gated-inputs stop rule (ADR 0008 — spend/credentials/irreversible actions always pause for human sign-off; its predictive face is the plan's required `### Gated inputs` section, enforced by the plan-judge and paused on by the engine via `parseGatedInputs`/`unapprovedGates`), and the giflab-rollout bug preflights (dead code / no-op assertions / sibling-site blindness / worktree-safety) into every code-writing prompt. `GIT_ENV_SCRUB` and `GIT_ENV_RULE` carry the git-environment scrub (p12-3): every engine-rendered command that runs git or the verifier (the worktree setup, the verifier line, the preflights' git spans) starts with `unset $(git rev-parse --local-env-vars 2>/dev/null);`, and the rule (scrub every git or verifier command, never point a `GIT_*` location variable at the shared repository, test env isolation in a `mktemp -d` scratch repo) is in **every** agent prompt, the read-only task-tree agents and judges included, not only the code-writing ones. The read-only agents (planner, plan judge, plan reviser, investigator) also carry `TASK_TREE_RULE` and enter the task's own tree with `taskTreeSetup` (ADR 0030, p12-4); the review judge is handed that tree as context only, with the PR authoritative.

To change a prompt, edit the builder in the workflow script.
