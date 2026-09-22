---
status: consumed
repo: thread-skill
head: 7038654
mode: code
harness: codex
effort: xhigh
scope: uncommitted rollout-state.mjs and tests plus domain documentation
---
# Native independent state review

Reviewer: rollout_doc_audit, using the bundled Codex review-agent, read-only. Single native pass; not the Claude xhigh multi-angle prompt. Reviewer saw the actual files without the implementation conversation. Scope excluded the host being built in parallel. The initial pass ran 23 tests and reproduced five additional failures in memory.

| Finding | Parent resolution |
| --- | --- |
| P1 Preserve unresolved repository merge hold across relaunch | Fixed: carry hold to new execution; covered by relaunch regression. |
| P2 Fence commands from previous executions | Fixed: monotonically increasing epoch across relaunch; old epoch rejected. |
| P2 Reject stale merge observations after completion | Fixed: stale OPEN rejected; same merged evidence idempotent without duplicate landing. |
| P2 Make native request transitions terminal | Fixed: no backwards or conflicting terminal update; exact terminal replay idempotent. |
| P2 Recover claims proven never dispatched | Fixed: explicit never-started native proof only for unbound claims, no invented child and no allowance refund. |

Integration also requires recovery evidence to name the previous ownership epoch, preventing A→B→A replay. All changes have regression tests; scoped recheck follows the fix commit. This review does not establish real unattended acceptance.
