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

Origin. The fetch URL of `origin` (as execute's merge-task reads it), accepted only with the prefixes
execution-fit's remote-check admits, so the two classify an origin the same way: `https://github.com/`,
`git@github.com:`, `ssh://git@github.com/` (no userinfo on https, no port on ssh). The rest must be
exactly `<owner>/<name>`, one trailing `/` and then a trailing `.git` tolerated. Segments are
[A-Za-z0-9._-]; an owner starts with a letter or digit (as GitHub's do), and neither segment is all
dots. Anything else is `no-origin`. The same slug rules bind --slug (a bad one is exit 2). Repo-local
git env inherited from a caller (a hook's GIT_DIR) is dropped first, so the path argument always wins;
an empty <repo-path> (an unset variable) is exit 2, never the current directory.

Register. `$LANDING_REGISTER` (`~` expanded) if set and non-empty, else
`~/repos/workspaces/_shared/knowledge/landing-register.md`. Only a path where nothing exists, not even
a symlink, is "no register" (warn, land); a path that exists but will not open, a dangling symlink
included, is exit 2. A deny-list: an unlisted repo lands. The format is one bullet per listed repo:

    - <owner>/<name> — <reason>

Optional front matter (line 1 `---`, closed by `---` or `...`) is never parsed for entries. A prose
header line is fine if it does not open with a bullet marker; headings, prose and blank lines are not
entries. The grammar is relaxed: the bullet marker may be `-`, `*`, `+` or `1.`/`1)` at any indent,
then whitespace; the slug may be wrapped in backticks, `**`, `_` or `[[ ]]`, and may end `.git`; the
separator may be an em or en dash, `-`, `:`, `,`, `;` or nothing; an empty reason reads `no reason
given`. `<owner>/*` lists every repo of that owner. An exact entry beats an owner-wide one wherever
each sits; among entries of one kind the first wins.

The reader fails closed. A bullet that is not an entry, and a bullet marker glued to its text
(`-Animately/x`, `1.Animately/x`; thematic breaks such as `---` and `* * *` excepted), warns on stderr
(`<path>:<line>: malformed entry`) on every run, whatever the repo. A repo with no entry is still
listed (`malformed register entry at line N`) when any line of the file, front matter included, names
its `<owner>/<name>` or `<owner>/*`, or when a malformed bullet names its bare <name>. A name counts as
written unless the run of slug characters touching it on the left holds a letter or digit (then it is
part of a longer word: `x-Animately/y`, `v1.Animately/y`); `-Animately/y` and `_Animately/y_` count.
So for the register's author: an owner/name written anywhere in this file lists that repo; name
allowed repos by bare name only. Help flags are not accepted: `-h` is an argument error (exit 2).
"""
import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_REGISTER = Path("repos", "workspaces", "_shared", "knowledge", "landing-register.md")
OWNER = r"[A-Za-z0-9][A-Za-z0-9._-]*"  # GitHub owners never start with `-` or `.`
SEG = r"[A-Za-z0-9._-]+"
SLUG_RE = re.compile(r"(%s)/(%s)" % (OWNER, SEG))
# Exactly execution-fit's remote-check prefixes (its `case`), so both classify an origin alike.
ORIGIN_RE = re.compile(r"(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)(.*)")
BULLET_RE = re.compile(r"\s*(?:[-*+]|\d+[.)])\s+(.*)")
GLUED_RE = re.compile(r"\s*(?:[-*+]|\d+[.)])\S.*")  # a bullet marker with no space after it
THEMATIC_RE = re.compile(r"\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})")  # `---`, `* * *`: not bullets
# Decoration, slug (owner/name or owner/*), closing decoration, then not a slug character.
ENTRY_RE = re.compile(r"(?P<open>[`*_\[]*)(?P<slug>%s/(?:%s|\*))(?P<close>[`*_\]]*)(?![A-Za-z0-9._/-])(?P<rest>.*)"
                      % (OWNER, SEG))
SEPARATORS = "—–-:,;"
# Right-hand word bound for the mention sweep: a slug character extends the word, except that a `.` not
# followed by a slug character ends a sentence and trailing `_` next to a non-word character is emphasis
# (`_Animately/x_`). The left-hand bound is `extends_left`.
AFTER = r"(?:\.git)?(?![A-Za-z0-9-]|\.[A-Za-z0-9]|_+(?:[A-Za-z0-9-]|\.[A-Za-z0-9]))"
LEFT_RUN_RE = re.compile(r"[A-Za-z0-9._-]*\Z")


def fail(reason):
    sys.stderr.write("landing-register: %s\n" % reason)
    sys.exit(2)


def warn(message):
    sys.stderr.write("landing-register: %s\n" % message)


def done(line, code):
    sys.stdout.write(line + "\n")
    sys.exit(code)


class Parser(argparse.ArgumentParser):
    # No -h/--help: argparse's help exits 0 with usage on stdout, which would read as `land`.
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("add_help", False)
        super().__init__(*args, **kwargs)

    def error(self, message):  # argparse's default prints multi-line usage; keep failures to one line
        fail(message)


def parse_slug(text):
    """owner/name with a trailing `.git` dropped, or None."""
    if text.endswith(".git"):
        text = text[:-4]
    m = SLUG_RE.fullmatch(text)
    if not m or any(set(seg) == {"."} for seg in m.groups()):  # `..` is a path, never a repo
        return None
    return m.group(1), m.group(2)


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
    return Path(os.path.expanduser(env)) if env else Path.home() / DEFAULT_REGISTER


def read_lines(path):
    """The register's lines, or None when nothing exists at the path (not even a dangling symlink, in
    the path or any of its parents). Any other read failure is exit 2."""
    try:
        with open(path, encoding="utf-8-sig", newline="") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as e:
        if isinstance(e, FileNotFoundError) and not any(
                os.path.lexists(p) and not os.path.exists(p) for p in (path,) + tuple(path.parents)):
            return None
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


def extends_left(line, start):
    """True when the slug characters touching `start` on the left hold a letter or digit, so the match
    is the tail of a longer word (`x-Animately/y`). `-`, `.` and `_` alone never extend it: an owner or
    name cannot be made of them, so `-Animately/y` and `_Animately/y_` name Animately/y."""
    return re.search(r"[A-Za-z0-9]", LEFT_RUN_RE.search(line, 0, start).group()) is not None


def mentioned(word, line):
    return any(not extends_left(line, m.start())
               for m in re.finditer(word + AFTER, line, re.IGNORECASE))


def check(owner, name):
    path = register_path()
    lines = read_lines(path)
    if lines is None:
        warn("no register at %s; unlisted by default, landing" % path)
        done("land", 0)
    body_start = front_matter_end(lines, path)

    entries, malformed = [], []  # (lineno, slug, reason) / (lineno, line)
    for i in range(body_start, len(lines)):
        if THEMATIC_RE.fullmatch(lines[i]):
            continue
        m = BULLET_RE.fullmatch(lines[i])
        if not m and not GLUED_RE.fullmatch(lines[i]):
            continue
        entry = parse_entry(m.group(1)) if m else None
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

    named = r"%s/(?:%s|\*)" % (re.escape(owner), re.escape(name))
    for i, line in enumerate(lines):
        if mentioned(named, line):
            done("listed %s: malformed register entry at line %d" % (slug, i + 1), 3)
    for lineno, line in malformed:
        if mentioned(re.escape(name), line):
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
    if args.repo == "":
        fail("empty <repo-path> (an unset variable?); refusing to check the current directory")
    if args.slug is not None:
        slug = parse_slug(args.slug)
        if slug is None:
            fail("--slug is not <owner>/<name>: %r" % args.slug)
    else:
        slug = origin_slug(args.repo)
    check(*slug)


if __name__ == "__main__":
    main()
