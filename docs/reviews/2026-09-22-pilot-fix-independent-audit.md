---
repo: /Users/lachlants/.codex/worktrees/thread-rollout-redesign/thread-skill
head: 67a825f
harness: codex
engine: review-agent
mode: code
effort: xhigh
reviewed: 2026-09-22
status: consumed
---

[P2] Preserve ignored files when integrating the adopted base — skills/execute/wave-execute.workflow.js:862

When the existing task worktree contains an ignored local file and the adopted base newly tracks that same path, the new merge silently replaces the local file. `git status --porcelain` excludes ignored files, and `git merge` overwrites them by default, so both cleanliness checks pass and the entry succeeds after losing local work. This was reproduced by ignoring `local.txt`, writing `local work to preserve` in the task worktree, and committing a tracked `local.txt` with different contents on the adopted base: the emitted setup returned successfully with the upstream contents replacing the local contents. Add `--no-overwrite-ignore` to the integration merge (or an equivalent collision check) and a regression case that requires the local contents and prior head to survive this failed entry.

Overall assessment: the guarded same-PR integration works for the covered normal, invalid-authority and conflict paths. One concrete data-preservation defect remains in the new merge path. No other qualifying findings in the requested change.

Scope: fixed comparison `de84d401d06d022aea09a2e94c09d73b0eb9b4ea..67a825fb723f3b67604b6529553cc87b910f85e4`, limited to `skills/execute/wave-execute.workflow.js` and `skills/execute/tests/engine-safety.test.mjs`. Read surrounding prompt builders, the durable retry producer/consumer and relevant tests solely to validate changed call paths. This was not an audit of the earlier implementation. The bundled Codex review-agent skill was available and applied directly in this independent native review agent; no other model CLI or subdelegation was used.

Checks:

- Verified the requested Git root. Every shell command was explicitly bound to that root. HEAD had moved to `50dc7fe05ff14a9df1e033c99e4754d309d69557`; review and test inputs were loaded from the fixed `67a825fb723f3b67604b6529553cc87b910f85e4` Git blobs.
- Engine safety tests: 41 passed, 0 failed. Executed the fixed test and workflow content in memory; real-Git fixtures exercised integration, repeat entry, repository path spellings, dirty tracked/untracked worktrees, wrong/missing branch, unknown head, conflict rollback and invalid durable retry context.
- Prompt compatibility suite: 191 assertions passed; suite reported `ALL PASS`, exit 0. Workflow and rollout-template inputs were loaded from the fixed commit. An initial in-memory adaptation could not resolve the template fixture; supplying the fixed template blob resolved that harness-only error.
- Scoped `git diff --check`: passed.
- Additional real-Git reproduction: the emitted retry setup successfully overwrote an ignored local file; `git status --porcelain` was empty both before and after. Temporary fixture removed afterwards.

The agent boundary remains mocked in the test suite; no live PR or native implementation agent was dispatched. Source, index and HEAD were not modified. Only this requested audit report was written; no prior review reports were read.

## Follow-up disposition — 22 September 2026

Resolved by `fa937dfb342c8e03da9c77826d6e17ebb18c730a` and consumed by the originating session after the [fresh correction review](2026-09-22-ignored-file-fix.md) returned no findings. The suggested `--no-overwrite-ignore` flag alone failed the real-Git reproduction on Git 2.47.0. The correction instead checks the previewed merge result for ignored-file collisions before modifying the worktree, including filesystem aliases and directory-rename destinations. The applied merge uses the same strategy as the preview.

Seven new real-Git regressions passed alongside the existing checks: 49 combined Node tests passed, with no failures or skips. This resolves the source defect; it does not establish live acceptance of the corrected native retry path or complete the release gates. The original finding and its original scope above are retained as historical evidence.
