# The Heat hold's reading (verify-slot.py heat_level, estate ADR 0009 d5), pinned for every suite that sources this:
# a hot Mac never flips an assertion on `next`.
export THREAD_HEAT_LEVEL=0

# prollout <tasks-dir> [<frontmatter line>]: a started protocol-5 rollout note, demo-rollout-2026-10-03 (a
# linked task carries owner:, a lead's mark), for ADR 0031's hold. The extra line (e.g. `paused: …`) goes in
# the rollout note's frontmatter. Sourced by tests that need `unfinished-rollout.py running` to list one.
prollout() {
  mkdir -p "$1"
  printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\n%s\n---\n' "${2:-}" > "$1/demo-rollout-2026-10-03.md"
  printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[demo-rollout-2026-10-03]]"\nowner: lead\n---\n' > "$1/demo-task.md"
}

# away_file <home> <written_at> [away=true] [until=2099-01-01T00:00:00Z] [trickle=2] [morning=09:00] [away_cap=99]:
# the Away state file (execute away.md § The state file) at <home>/.config/thread/away.json, for a `next` call whose
# HOME is <home>. The defaults are a fresh Away file that never lapses and whose Away cap (p29-8, ADR 0049) never
# binds, so a suite that needs each rollout's own parallel_ceiling writes one with the written_at its `--now` reads
# as fresh (within 24 h before it, at most 5 minutes after); an away_cap of `-` leaves the key out (the built-in
# default applies).
away_file() {
  local cap="${7:-99}" capkey=""
  [ "$cap" = "-" ] || capkey=", \"away_cap\": $cap"
  mkdir -p "$1/.config/thread"
  printf '{"away": %s, "until": "%s", "morning": "%s", "trickle": %s%s, "written_at": "%s"}\n' \
    "${3:-true}" "${4:-2099-01-01T00:00:00Z}" "${6:-09:00}" "${5:-2}" "$capkey" "$2" > "$1/.config/thread/away.json"
}
