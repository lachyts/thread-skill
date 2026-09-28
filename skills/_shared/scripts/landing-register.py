#!/usr/bin/env python3
"""Read the landing register: may agents land (push) in this repo? (ADR 0028 § 8.)

Caller contract. Exit 0 (`land`) is the ONLY permission to push. Any other exit (3 listed, 4 no-origin,
2 error) means do not push: commit locally and report. Never read 2 as "not listed". Branch on the exit
code, never on the slug in the output; stdout and stderr may be shown verbatim.

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/landing-register.py check <repo-path>
    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/landing-register.py check --slug <owner/name>

Exactly one of <repo-path> and --slug. --slug is for callers holding a GitHub owner/name and no
checkout (the daily lander, from gh's nameWithOwner); it never calls git. Stdlib only, python >= 3.9.

  exit 0  stdout `land`                          unlisted, or no register file (one stderr warning)
  exit 3  stdout `listed <owner/name>: <reason>`  on the register (or named anywhere in it)
  exit 4  stdout `no-origin`                     origin missing or not GitHub; the register is not read
  exit 2  stdout empty                           error: bad arguments, not a git repo, git missing, bad
                                                 --slug, register unreadable / not UTF-8 / unterminated
                                                 front matter. One `landing-register: ` line on stderr.

stdout is exactly one line on exit 0, 3 or 4. stderr carries warnings and errors only. <owner/name> in
output is the origin-derived (or --slug) spelling, a trailing `.git` dropped; matching is
case-insensitive, as GitHub slugs are.

Origin. The fetch URL of `origin` (as execute's merge-wave reads it), accepted only in the shapes
execution-fit's remote-check admits: `https://github.com/` (optional userinfo), `git@github.com:`,
`ssh://git@github.com[:port]/`. The rest must be exactly `<owner>/<name>` (segments of
[A-Za-z0-9._-]), one trailing `/` and then a trailing `.git` tolerated. Anything else is `no-origin`.
Repo-local git env inherited from a caller (a hook's GIT_DIR) is dropped first, so the path argument
always wins.

Register. `$LANDING_REGISTER` if set and non-empty, else
`~/repos/workspaces/_shared/knowledge/landing-register.md`. A deny-list: an unlisted repo lands. The
format is one bullet per listed repo:

    - <owner>/<name> — <reason>

Optional front matter (line 1 `---`, closed by `---` or `...`) is never parsed for entries. A prose
header line is fine; headings, prose and blank lines are not entries. The grammar is relaxed: the
bullet marker may be `-`, `*`, `+` or `1.`/`1)` at any indent; the slug may be wrapped in backticks,
`**`, `_` or `[[ ]]`, and may end `.git`; the separator may be an em or en dash, `-`, `:`, `,`, `;` or
nothing; an empty reason reads `no reason given`. `<owner>/*` lists every repo of that owner. The first
matching entry wins (an exact entry before an owner-wide one).

The reader fails closed. A bullet that is not an entry warns on stderr (`<path>:<line>: malformed
entry`) on every run, whatever the repo. A repo with no entry is still listed (`malformed register
entry at line N`) when any line of the file, front matter included, names its `<owner>/<name>` or
`<owner>/*`, or when a malformed bullet names its bare <name>. So for the register's author: an
owner/name written anywhere in this file lists that repo; name allowed repos by bare name only.
"""
import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_REGISTER = Path("repos", "workspaces", "_shared", "knowledge", "landing-register.md")
SEG = r"[A-Za-z0-9._-]+"
SLUG_RE = re.compile(r"(%s)/(%s)" % (SEG, SEG))
ORIGIN_RE = re.compile(r"(?:https://(?:[^@/]+@)?github\.com/|git@github\.com:|ssh://git@github\.com(?::\d+)?/)(.*)")
BULLET_RE = re.compile(r"\s*(?:[-*+]|\d+[.)])\s+(.*)")
# Decoration, slug (owner/name or owner/*), closing decoration, then not a slug character.
ENTRY_RE = re.compile(r"(?P<open>[`*_\[]*)(?P<slug>%s/(?:%s|\*))(?P<close>[`*_\]]*)(?![A-Za-z0-9._/-])(?P<rest>.*)"
                      % (SEG, SEG))
SEPARATORS = "—–-:,;"
# Word bounds for the mention sweep. A slug character on either side extends the word, except that a
# `_` next to a non-word character is emphasis (`_Animately/x_`), and a `.` not followed by a slug
# character ends a sentence.
BEFORE = r"(?<![A-Za-z0-9.-])(?<![A-Za-z0-9.-]_)"
AFTER = r"(?:\.git)?(?![A-Za-z0-9-]|\.[A-Za-z0-9]|_+(?:[A-Za-z0-9-]|\.[A-Za-z0-9]))"


def fail(reason):
    sys.stderr.write("landing-register: %s\n" % reason)
    sys.exit(2)


def warn(message):
    sys.stderr.write("landing-register: %s\n" % message)


def done(line, code):
    sys.stdout.write(line + "\n")
    sys.exit(code)


class Parser(argparse.ArgumentParser):
    def error(self, message):  # argparse's default prints multi-line usage; keep failures to one line
        fail(message)


def parse_slug(text):
    """owner/name with a trailing `.git` dropped, or None."""
    if text.endswith(".git"):
        text = text[:-4]
    m = SLUG_RE.fullmatch(text)
    return (m.group(1), m.group(2)) if m else None


def git_env():
    """The caller's env minus git's repo-local names (GIT_DIR & co.), as tests/run.sh scrubs them."""
    try:
        r = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True)
    except OSError as e:
        fail("git not found: %s" % e)
    env = dict(os.environ)
    for name in r.stdout.split():
        env.pop(name, None)
    return env


def origin_slug(repo):
    env = git_env()
    try:
        if subprocess.run(["git", "-C", repo, "rev-parse", "--git-dir"], env=env,
                          capture_output=True, text=True).returncode != 0:
            fail("%s is not a git repository" % repo)
        r = subprocess.run(["git", "-C", repo, "remote", "get-url", "origin"], env=env,
                           capture_output=True, text=True)
    except OSError as e:
        fail("git not found: %s" % e)
    m = ORIGIN_RE.fullmatch(r.stdout.strip()) if r.returncode == 0 else None
    rest = m.group(1) if m else ""
    if rest.endswith("/"):
        rest = rest[:-1]
    slug = parse_slug(rest)
    if slug is None:
        done("no-origin", 4)
    return slug


def register_path():
    env = os.environ.get("LANDING_REGISTER", "")
    return Path(env) if env else Path.home() / DEFAULT_REGISTER


def read_lines(path):
    """The register's lines, or None when there is no file. Any other read failure is exit 2."""
    try:
        with open(path, encoding="utf-8-sig", newline="") as f:
            text = f.read()
    except FileNotFoundError:
        return None
    except (OSError, UnicodeDecodeError) as e:
        fail("cannot read register %s: %s" % (path, e))
    lines = re.split(r"\r\n|\r|\n", text)
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def front_matter_end(lines, path):
    """Index of the first body line (0 when there is no front matter)."""
    if not lines or lines[0] != "---":
        return 0
    for i in range(1, len(lines)):
        if lines[i] in ("---", "..."):
            return i + 1
    fail("%s: unterminated front matter (line 1 '---' never closed)" % path)


def parse_entry(body):
    """(slug, reason) for a bullet body in entry grammar, else None."""
    m = ENTRY_RE.match(body)
    if not m:
        return None
    slug = m.group("slug")
    # `_Animately/x_`: the closing `_` is emphasis the greedy slug swallowed. Owners never hold `_`.
    trailing = len(slug) - len(slug.rstrip("_"))
    strip = min(m.group("open").count("_"), trailing)
    if strip:
        slug = slug[:-strip]
    if slug.endswith(".git"):
        slug = slug[:-4]
    reason = re.sub(r"^[\s%s]+" % re.escape(SEPARATORS), "", m.group("rest")).strip()
    return slug, reason or "no reason given"


def mentions(word):
    return re.compile(BEFORE + word + AFTER, re.IGNORECASE)


def check(owner, name):
    path = register_path()
    lines = read_lines(path)
    if lines is None:
        warn("no register at %s; unlisted by default, landing" % path)
        done("land", 0)
    body_start = front_matter_end(lines, path)

    entries, malformed = [], []  # (lineno, slug, reason) / (lineno, line)
    for i in range(body_start, len(lines)):
        m = BULLET_RE.fullmatch(lines[i])
        if not m:
            continue
        entry = parse_entry(m.group(1))
        if entry:
            entries.append((i + 1,) + entry)
        else:
            malformed.append((i + 1, lines[i]))
            warn("%s:%d: malformed entry: %s" % (path, i + 1, lines[i]))

    slug = "%s/%s" % (owner, name)
    for _, entry_slug, reason in entries:
        if entry_slug.lower() == slug.lower():
            done("listed %s: %s" % (slug, reason), 3)
    for _, entry_slug, reason in entries:
        if entry_slug.lower() == ("%s/*" % owner).lower():
            done("listed %s: %s" % (slug, reason), 3)

    named = mentions(r"%s/(?:%s|\*)" % (re.escape(owner), re.escape(name)))
    for i, line in enumerate(lines):
        if named.search(line):
            done("listed %s: malformed register entry at line %d" % (slug, i + 1), 3)
    bare = mentions(re.escape(name))
    for lineno, line in malformed:
        if bare.search(line):
            done("listed %s: malformed register entry at line %d" % (slug, lineno), 3)
    done("land", 0)


def main():
    parser = Parser(prog="landing-register")
    sub = parser.add_subparsers(dest="command", parser_class=Parser)
    sub.required = True
    c = sub.add_parser("check")
    c.add_argument("repo", nargs="?")
    c.add_argument("--slug")
    args = parser.parse_args()
    if (args.repo is None) == (args.slug is None):
        fail("check takes exactly one of <repo-path> and --slug <owner/name>")
    if args.slug is not None:
        slug = parse_slug(args.slug)
        if slug is None:
            fail("--slug is not <owner>/<name>: %r" % args.slug)
    else:
        slug = origin_slug(args.repo)
    check(*slug)


if __name__ == "__main__":
    main()
