#!/usr/bin/env python3
"""The full suite's shard split (ADR 0073 d3, p43-3; measured weights p43-6): which of N shards runs each test file.

`bash tests/run.sh --shard K/N` runs shard K of N (.github/workflows/full-suite.yml runs every shard on both OSes on
each push to master); `bash tests/run.sh --shard-plan N` prints the whole split and runs nothing. Stdlib only: it
writes nothing and imports no repo module. This docstring is the one copy of its rules.

    python3 tests/lib/shard.py <N>

Input, on stdin, one entry per line in run.sh's order: `@merge-task-self-tests` (run.sh's two merge-task.sh
self-tests), then every collected test file, repo-relative. Output: one `<k>\t<entry>` line per entry, in input order,
k in 1..N.

Weights. The measured seconds live in `shard-weights.tsv` in this script's parent's parent (tests/shard-weights.tsv,
beside run.sh); its own header says where they come from and how to regenerate them. An absent file means no weights.
`#` lines and blank lines are ignored; every other line is `<seconds>\t<entry>`, seconds a positive number. The entry
may be `@merge-task-self-tests`. A line whose entry is not in the input is ignored, so a deleted test never breaks the
split.

Rules:
  - `@merge-task-self-tests` always goes to shard 1, and its weight (0 when it has none) seeds shard 1's `.sh` load,
    since the self-tests run in that shard's shell phase.
  - The `*.sh` entries and the `*.mjs` entries are split separately, because run.sh runs its two phases one after
    the other (the shell suites in the background, then one `node --test`), so each phase is balanced on its own.
  - An entry's load is its weight. An unweighted entry, in a kind that has weighted input entries, gets its size
    (`os.path.getsize`) times the median seconds-per-byte of that kind's weighted input entries (a new suite added
    after the weights were measured). Otherwise its load is its size, the proxy run.sh's `ls -S` order takes.
  - Each kind is split by LPT: largest load first (ties by path), each entry to the shard with the least load of that
    kind so far (ties to the lowest index). The split depends only on the weights file, file sizes and paths, so it
    is deterministic: the same on both OSes (LF checkouts) and on every re-run. It is by file and never trims: every
    entry lands in exactly one shard.
  - A shard may hold nothing (N above the entries of a kind); run.sh runs it as a passing shard with no tests.
  - Exit 2, with one `shard: <problem>` line on stderr and nothing on stdout, on: N not a positive integer, a
    duplicate entry, an entry that is not an existing file (other than `@merge-task-self-tests`), or a suffix other
    than .sh and .mjs; and, as `shard: tests/shard-weights.tsv:<n>: <problem>`, on a weights line that is not
    `<seconds>\t<entry>`, a weight that is not a positive number, or an entry listed twice.
"""
import math
import os
import statistics
import sys
from pathlib import Path

SELF_TESTS = "@merge-task-self-tests"
KINDS = (".sh", ".mjs")
WEIGHTS = Path(__file__).resolve().parent.parent / "shard-weights.tsv"


def die(msg):
    print(f"shard: {msg}", file=sys.stderr)
    sys.exit(2)


def read_weights(path=WEIGHTS):
    """{entry: seconds} from the weights file, by the rules above; {} when there is no file."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {}
    label = f"{path.parent.name}/{path.name}"
    weights, first = {}, {}
    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 2 or not parts[1] or parts[1] != parts[1].strip():
            die(f"{label}:{n}: not a `<seconds><TAB><entry>` line")
        sec, entry = parts
        try:
            w = float(sec)
        except ValueError:
            w = math.nan
        if not (math.isfinite(w) and w > 0):
            die(f"{label}:{n}: the weight {sec!r} is not a positive number")
        if entry in first:
            die(f"{label}:{n}: {entry} is listed twice (first on line {first[entry]})")
        first[entry] = n
        weights[entry] = w
    return weights


def split(entries, n, weights=None):
    """{entry: shard} for the entries, by the rules above (weights: {entry: seconds}, read_weights's)."""
    weights = {} if weights is None else weights
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
    for kind, items in by_kind.items():
        rates = [weights[e] / size for size, e in items if e in weights and size > 0]
        rate = statistics.median(rates) if rates else None
        loads = []
        for size, e in items:
            if e in weights:
                loads.append((weights[e], e))
            else:
                loads.append((size * rate if rate is not None else size, e))
        load = [0.0] * n
        if kind == ".sh" and SELF_TESTS in seen:
            load[0] = weights.get(SELF_TESTS, 0.0)
        for w, e in sorted(loads, key=lambda t: (-t[0], t[1])):
            k = min(range(n), key=lambda i: (load[i], i))
            load[k] += w
            shard_of[e] = k + 1
    return shard_of


def main(argv):
    if len(argv) != 1 or not argv[0] or argv[0].strip("0123456789") or int(argv[0]) < 1:
        die("usage: shard.py <N>, N a positive integer, entries on stdin")
    n = int(argv[0])
    weights = read_weights()
    entries = [line for line in sys.stdin.read().split("\n") if line]
    shard_of = split(entries, n, weights)
    sys.stdout.write("".join(f"{shard_of[e]}\t{e}\n" for e in entries))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
