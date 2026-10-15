#!/usr/bin/env python3
"""review-split.py — split one engine review round's findings original / regression (p21-3, ADR 0037 d1).

python >= 3.8, stdlib only. No CLI: imported by path (importlib.util.spec_from_file_location) by
reconcile-rollout.py's _review_verdict_events, which turns each entry of an engine row's reviewVerdicts into one
review-verdict Run-record event:

    resolve(tree, head) -> str                      the head as a full sha in the task tree, else head unchanged
    baseline(tree, prior_heads, head) -> str        the first prior head at or before head, else head
    split(tree, base, head, bullets) -> dict        {findings, original, regression, unclassified}

The split is the fresh-review ledger's (agents-config skills/fresh-review/scripts/review-ledger.py: its CITE_RE
and its blame rule): each bullet's first `path:line` cite is blamed at the round's head; a line last touched by a
commit in first-parent base..head is a REGRESSION (it changed after review of this task began, so the round is
reviewing a fix), any other commit is ORIGINAL (the work as first judged), and a bullet with no cite, or one git
cannot blame, is unclassified. findings counts every non-blank bullet, so original + regression + unclassified
== findings. --first-parent keeps the lines of other PRs that an Integration merged in from main out of the
regression count: blame attributes such a line to main's commit, which is not on the branch's first-parent chain.

Never raises, never feeds git anything but a 7-40 hex rev: every git call runs `git -C <tree>` with git's
repo-local variables scrubbed (rollout-settings.py's _git_env), stdin closed and a GIT_TIMEOUT, and a failure (no
tree, an unreachable head, a blame past the end of the file, a timeout) makes the finding unclassified.
"""
from __future__ import annotations

import os
import re
import subprocess

# review-ledger.py's cite: the first `<path>.<ext>:<line>` in a bullet.
CITE_RE = re.compile(r"([\w./+-]+\.\w+):(\d+)")
BLAME_HDR = re.compile(r"([0-9a-f]{40,64}) \d+ \d+")
HEX_RE = re.compile(r"[0-9a-fA-F]{7,64}\Z")
GIT_TIMEOUT = 10  # seconds per git call
_ENV = None


def git_env():
    """The caller's env minus git's repo-local names (GIT_DIR & co.), as rollout-settings.py's _git_env()."""
    global _ENV
    if _ENV is None:
        try:
            names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                                   stdin=subprocess.DEVNULL, timeout=GIT_TIMEOUT).stdout.split()
        except (OSError, subprocess.SubprocessError, ValueError):
            names = []
        env = dict(os.environ)
        for name in names:
            env.pop(name, None)
        _ENV = env
    return _ENV


def _git(tree, *args):
    """stdout of `git -C <tree> <args>` when it exits 0, else None. Never raises."""
    try:
        p = subprocess.run(["git", "-C", tree] + list(args), capture_output=True, text=True,
                           stdin=subprocess.DEVNULL, env=git_env(), timeout=GIT_TIMEOUT)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    return p.stdout if p.returncode == 0 else None


def _rev(value):
    """True for a rev git may be given: a 7-40 (sha-256: 64) hex string, never an option."""
    return isinstance(value, str) and bool(HEX_RE.match(value))


def _tree(tree):
    return isinstance(tree, str) and bool(tree) and os.path.isdir(tree)


def resolve(tree, head):
    """head as the full lowercase sha the task tree resolves it to (an abbreviated head and a full one then key
    alike), else head unchanged ('' stays '')."""
    if not head or not _rev(head) or not _tree(tree):
        return head
    out = _git(tree, "rev-parse", "--verify", "--quiet", head + "^{commit}")
    full = (out or "").strip().lower()
    return full if _rev(full) else head


def baseline(tree, prior_heads, head):
    """The task's first judged head: the first of prior_heads (record order, then this row's) that is head or an
    ancestor of it, else head itself (round 1, or a recut branch whose earlier heads are no ancestors)."""
    if not head or not _rev(head) or not _tree(tree):
        return head
    for h in prior_heads:
        if not _rev(h):
            continue
        if h == head or _git(tree, "merge-base", "--is-ancestor", h, head) is not None:
            return h
    return head


def _blame(tree, head, path, line):
    out = _git(tree, "blame", "-L", "%d,%d" % (line, line), "--porcelain", head, "--", path)
    first = out.splitlines()[0] if out else ""
    m = BLAME_HDR.match(first)
    return m.group(1) if m else None


def split(tree, base, head, bullets):
    """{findings, original, regression, unclassified} for one round's bullets judged at head."""
    items = [b for b in (bullets or []) if isinstance(b, str) and b.strip()]
    out = {"findings": len(items), "original": 0, "regression": 0, "unclassified": 0}
    if not items:
        return out
    listed = None
    if _tree(tree) and _rev(head) and _rev(base):
        listed = _git(tree, "rev-list", "--first-parent", "%s..%s" % (base, head))
    if listed is None:
        out["unclassified"] = len(items)
        return out
    in_range = set(listed.split())
    for b in items:
        m = CITE_RE.search(b)
        line = int(m.group(2)) if m else 0
        sha = _blame(tree, head, m.group(1), line) if m and line >= 1 else None
        if sha is None:
            out["unclassified"] += 1
        elif sha in in_range:
            out["regression"] += 1
        else:
            out["original"] += 1
    return out
