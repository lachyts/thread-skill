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

## Scoped rollback and queue review

After host integration, the same independent reviewer inspected actual rollback landing, stale queue and terminal-request changes. It confirmed the terminal cleanup fix and reported two further findings:

| Finding | Parent resolution |
| --- | --- |
| P2 Make successful rollback observation replay idempotent | Fixed: recognise identical historical rollback evidence before the current-attempt guard; conflicting evidence fails. |
| P2 Record reversion relationships on every actual rollback landing | Fixed: successful, superseded and failed-verification landings retain the reverted commit list and mark original landings as reverted. |

Both reproductions were added as failing regressions before the fixes. Narrow independent recheck: no findings; all 36 state tests pass. Source edits retain an assessment hold; historical queued landings never complete revised outcomes. Actual native wake/queue behaviour remains a live acceptance item.

## Covered gate declaration

A native documentation review found the runbook promised semantic coverage of newly declared gates but exposed no supported operation. Added `cover-gate`: it accepts only an inactive current gate-pending declaration, records its evidence against unchanged authority/current revision, and preserves spent allowance. The host passes only current mappings plus their assessment to independent review. It never creates new authority or silently clears a pause. A failing regression preceded the implementation; scoped independent recheck reported no findings, with all 37 state tests and the targeted host binding test passing.
