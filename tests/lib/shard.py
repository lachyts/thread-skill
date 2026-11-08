#!/usr/bin/env python3
"""The full suite's shard split (ADR 0073 d3, p43-3): which of N shards runs each test file.

`bash tests/run.sh --shard K/N` runs shard K of N (.github/workflows/full-suite.yml runs every shard on both OSes on
each push to master); `bash tests/run.sh --shard-plan N` prints the whole split and runs nothing. Stdlib only: it
writes nothing and imports no repo module. This docstring is the one copy of its rules.

    python3 tests/lib/shard.py <N>

Input, on stdin, one entry per line in run.sh's order: `@merge-task-self-tests` (run.sh's two merge-task.sh
self-tests), then every collected test file, repo-relative. Output: one `<k>\t<entry>` line per entry, in input order,
k in 1..N.

Rules:
  - `@merge-task-self-tests` always goes to shard 1.
  - The `*.sh` entries and the `*.mjs` entries are split separately, because run.sh runs its two phases one after
    the other (the shell suites in the background, then one `node --test`), so each phase is balanced on its own.
  - Each kind is split by LPT: largest first by `os.path.getsize` (ties by path), each entry to the shard with the
    least load of that kind so far (ties to the lowest index). The split depends only on file sizes and paths, so
    it is deterministic: the same on both OSes (LF checkouts) and on every re-run.
  - File size is the proxy for a suite's time, as run.sh's `ls -S` order already takes it. A measured weight is
    p43-6's to add if the shards come out uneven. The split is by file and never trims: every entry lands in
    exactly one shard.
  - A shard may hold nothing (N above the entries of a kind); run.sh runs it as a passing shard with no tests.
  - Exit 2, with one `shard: <problem>` line on stderr and nothing on stdout, on: N not a positive integer, a
    duplicate entry, an entry that is not an existing file (other than `@merge-task-self-tests`), or a suffix other
    than .sh and .mjs.
"""
import os
import sys

SELF_TESTS = "@merge-task-self-tests"
KINDS = (".sh", ".mjs")


def die(msg):
    print(f"shard: {msg}", file=sys.stderr)
    sys.exit(2)


def split(entries, n):
    """{entry: shard} for the entries, by the rules above."""
    seen = set()
    by_kind = {k: [] for k in KINDS}
    shard_of = {}
    for e in entries:
        if e in seen:
            die(f"duplicate entry {e}")
        seen.add(e)
        if e == SELF_TESTS:
            shard_of[e] = 1
            continue
        kind = next((k for k in KINDS if e.endswith(k)), None)
        if kind is None:
            die(f"{e}: not a .sh or .mjs test")
        if not os.path.isfile(e):
            die(f"{e}: no such file")
        by_kind[kind].append((os.path.getsize(e), e))
    for items in by_kind.values():
        load = [0] * n
        for size, e in sorted(items, key=lambda t: (-t[0], t[1])):
            k = min(range(n), key=lambda i: (load[i], i))
            load[k] += size
            shard_of[e] = k + 1
    return shard_of


def main(argv):
    if len(argv) != 1 or not argv[0] or argv[0].strip("0123456789") or int(argv[0]) < 1:
        die("usage: shard.py <N>, N a positive integer, entries on stdin")
    n = int(argv[0])
    entries = [line for line in sys.stdin.read().split("\n") if line]
    shard_of = split(entries, n)
    sys.stdout.write("".join(f"{shard_of[e]}\t{e}\n" for e in entries))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
