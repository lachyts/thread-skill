# 0025 — master moves only by green PR, owner included

Date: 2026-09-26
Status: accepted

## Context

`lachyts/thread-skill` had no CI and no branch protection. On 2026-09-23 a rollout agent's
test ran with an exported `GIT_DIR` and pushed fixture commits and a stray `main` straight to
GitHub master. Nothing refused them, because they were ordinary pushes made with Lachy's own
credentials. The same rollout verified every combined tree only because the lead re-ran
`make test` by hand after each wave: `merge-wave.sh` found no required checks.

## Decision

Master moves only by pull request with a green, strict `make test` check. Force-push and
deletion are refused, and **the protection applies to admins too**, with no bypass. Release
and close-out commits ride a PR like everything else. In an emergency the protection is
lifted by hand and deliberately, then restored.

**Enforced by repository rulesets, with no bypass actors, and nothing else.** Classic branch
protection was tried first and removed the same day. While it was live, a direct push from the
owner's account (`4c285d2..73bcdd0`) landed. That push was exactly PR #21's green head, so it may
have been accepted as a fast-forward of an approved-by-checks PR rather than a bypass; the cause
wasn't established. An empty probe commit pushed straight to master under the ruleset was refused
("Changes must be made through a pull request"). One mechanism means one restore procedure. Two
rulesets are live:

- `master-green-pr-only` (id 24028790) on `refs/heads/master`: pull request required (0
  approvals, so the owner can merge their own), required status checks `make test
  (ubuntu-latest)` and `make test (macos-latest)` (GitHub Actions, integration 15368) with the
  strict policy, deletion and non-fast-forward refused.
- `no-main-branch` (id 24028787) on `refs/heads/main`: creation, update and deletion refused.
  The 2026-09-23 leak also pushed a stray `main`; protecting `master` alone would not have
  stopped that half.

**The job names are the check contexts.** Renaming the workflow job or a matrix value leaves
the old contexts unreported, and every PR then waits forever. Change the ruleset in the same
change. To lift or restore: `gh api -X PUT repos/lachyts/thread-skill/rulesets/24028790 -f
enforcement=disabled` (or `=active`); `gh api repos/lachyts/thread-skill/rulesets/24028790`
prints the full payload.

**Local commits on master are stranded.** `thread:close` and `thread:handoff` commit to
whatever branch is checked out. On `master` those commits can no longer be pushed: they wait
until the next PR carries them, and meanwhile the checkout diverges from `origin/master`. Task
p5-4 makes both verbs commit to a branch when the default branch is protected.

GitHub offers branch protection on a private repo only with a paid plan, so the repo went public
on 2026-09-26 to make this enforceable. It's published as-is, a reference implementation for one
setup, as the README says.

The reason for including the owner: rollout agents act with the operator's GitHub identity.
Any bypass granted to Lachy is also granted to every agent he launches, so it would not have
stopped the leak that prompted this.

## Considered options

- **Required CI with admin bypass.** Rejected: it keeps direct pushes working, but every
  agent inherits the bypass, so it protects against nothing that runs as Lachy.
- **Classic branch protection.** Tried first and removed: a second mechanism doubles every
  rename and restore, and its behaviour under an owner push was not established (above).
- **CI for visibility only.** Rejected: it enforces nothing and leaves leak prevention to
  the test-side `GIT_*` scrub alone. That scrub is the root-cause fix; this protection is
  the independent second layer.
