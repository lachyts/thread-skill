# prollout <tasks-dir> [<frontmatter line>]: a started protocol-5 rollout note, demo-rollout-2026-10-03 (a
# linked task carries owner:, a lead's mark), for ADR 0031's hold. The extra line (e.g. `paused: …`) goes in
# the rollout note's frontmatter. Sourced by tests that need `unfinished-rollout.py running` to list one.
prollout() {
  mkdir -p "$1"
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n%s\n---\n' "${2:-}" > "$1/demo-rollout-2026-10-03.md"
  printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[demo-rollout-2026-10-03]]"\nowner: lead\n---\n' > "$1/demo-task.md"
}

# away_file <home> <written_at> [away=true] [until=2099-01-01T00:00:00Z] [trickle=2] [morning=09:00]: the Away state
# file (execute away.md § The state file) at <home>/.config/thread/away.json, for a `next` call whose HOME is <home>.
# The defaults are a fresh Away file that never lapses, so a suite that needs each rollout's own parallel_ceiling
# writes one with the written_at its `--now` reads as fresh (within 24 h before it, at most 5 minutes after).
away_file() {
  mkdir -p "$1/.config/thread"
  printf '{"away": %s, "until": "%s", "morning": "%s", "trickle": %s, "written_at": "%s"}\n' \
    "${3:-true}" "${4:-2099-01-01T00:00:00Z}" "${6:-09:00}" "${5:-2}" "$2" > "$1/.config/thread/away.json"
}
