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

The shared fragments (`BUG_PREFLIGHTS`, `GATED_INPUTS_CHECK`, `ralphLoop(...)`) carry the verifier-retry contract, the gated-inputs stop rule (ADR 0008 — spend/credentials/irreversible actions always pause for human sign-off; its predictive face is the plan's required `### Gated inputs` section, enforced by the plan-judge and paused on by the engine via `parseGatedInputs`/`unapprovedGates`), and the giflab-rollout bug preflights (dead code / no-op assertions / sibling-site blindness / worktree-safety) into every code-writing prompt.

To change a prompt, edit the builder in the workflow script.
