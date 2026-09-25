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

GitHub offers branch protection on a private repo only with a paid plan, so the repo went public
on 2026-09-26 to make this enforceable. It's published as-is, a reference implementation for one
setup, as the README says.

The reason for including the owner: rollout agents act with the operator's GitHub identity.
Any bypass granted to Lachy is also granted to every agent he launches, so it would not have
stopped the leak that prompted this.

## Considered options

- **Required CI with admin bypass.** Rejected: it keeps direct pushes working, but every
  agent inherits the bypass, so it protects against nothing that runs as Lachy.
- **CI for visibility only.** Rejected: it enforces nothing and leaves leak prevention to
  the test-side `GIT_*` scrub alone. That scrub is the root-cause fix; this protection is
  the independent second layer.
