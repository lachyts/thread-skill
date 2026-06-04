# Per-task subagent prompts — moved

As of `protocol_version: 3`, the dispatched-subagent prompts are **no longer read from this file at runtime**. Workflow scripts have no filesystem access, so the five prompt variants now live as inlined template-builder functions in:

```
${CLAUDE_PLUGIN_ROOT}/skills/execute/wave-execute.workflow.js
```

The variants and the functions that build them:

| Variant | Builder in `wave-execute.workflow.js` | Returns (schema) |
|---|---|---|
| Implementer (gate off) | `implementerPrompt(task, a)` | `IMPL_RESULT` |
| Read-only investigator | `readOnlyPrompt(task, a)` | `IMPL_RESULT` (no PR) |
| Planner (gate on) | `plannerPrompt(task, a)` | `PLAN_VERDICT` |
| Plan judge | `planJudgePrompt(task, plan, a)` | `PLAN_JUDGE` |
| Plan-reviser | `planReviserPrompt(task, prior, feedback, round, a)` | `PLAN_VERDICT` |
| Approved-plan implementer | `approvedPlanImplementerPrompt(task, plan, a)` | `IMPL_RESULT` |
| Review judge | `reviewJudgePrompt(task, prevImpl, a)` | `REVIEW_VERDICT` |
| Reviser | `reviserPrompt(task, prevImpl, feedback, round, a)` | `IMPL_RESULT` |

Sentinel strings (`WAVE-VERIFIED` / `PLAN-READY` / `BLOCKED:`) are gone — every agent now returns a validated structured object (the `schema:` option on `agent()`), so the engine branches on typed fields instead of parsing free text.

The shared fragments (`BUG_PREFLIGHTS`, `ralphLoop(...)`) carry the verifier-retry contract and the giflab-rollout bug preflights (dead code / no-op assertions / sibling-site blindness / worktree-safety) into every code-writing prompt.

To change a prompt, edit the builder in the workflow script.
