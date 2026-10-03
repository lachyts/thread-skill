# prollout <tasks-dir> [<frontmatter line>]: a started protocol-5 rollout note, demo-rollout-2026-10-03 (a
# linked task carries owner:, a lead's mark), for ADR 0031's hold. The extra line (e.g. `paused: …`) goes in
# the rollout note's frontmatter. Sourced by tests that need `unfinished-rollout.py running` to list one.
prollout() {
  mkdir -p "$1"
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n%s\n---\n' "${2:-}" > "$1/demo-rollout-2026-10-03.md"
  printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[demo-rollout-2026-10-03]]"\nowner: lead\n---\n' > "$1/demo-task.md"
}
