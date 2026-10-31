#!/usr/bin/env python3
"""rollout-settings.py — resolve the operator's rollout settings (p15-4; ADR 0032, a Tuning's home).

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/_shared/scripts/rollout-settings.py [--repo <dir>]

The file is `~/.config/thread/rollouts.toml`, a sibling of ADR 0029's `ladder.toml` (HOME is honoured; there
is no env override). Stdlib only. It writes nothing and makes no network call. This header is the one copy
of the file format:

    # ~/.config/thread/rollouts.toml
    schema = 3                   # optional, top-level, before the first table (ADR 0043): the file's schema version

    [defaults]                   # every rollout on this machine
    parallel_ceiling = 4
    max_review_rounds = 4
    max_iterations = 3
    max_plan_rounds = 3
    auto_retries = 2             # execute's automatic retries of a set-aside task (p16-4, ADR 0033); 0 disables
    spend_approval_usd = 200     # the standing approval (ADR 0034): a spend gate whose total exposure is at most
                                 # this many US dollars passes without a person, and while the calendar month's
                                 # standing approvals stay within it; 0 (the built-in) is off
    verify_slots = 2             # machine-wide (p23-4): at most this many verifier suites run at once across every
                                 # rollout on this machine (execute's verify-slot.py); [defaults] only

    [guardrails]                 # the Reflection's bounds, machine-wide only
    tokens_per_merge_pct = 25    # tokens per merge may rise at most +25%
    set_aside_rate_points = 5    # set-aside rate may rise at most +5 points
    conflict_rate_points = 10    # conflict rate may rise at most +10 points
    quota_stalls = 0             # more than this many quota stalls breaches (0 = any stall)
    review_churn_pct = 40        # regression findings over all review findings above this % breaches
    hours_per_task = 1.5         # Throughput (p21-2, ADR 0037 d1): running hours may not exceed this many per task
                                 # whose Slot or lane holding overlaps the scored window, so an overnight run still
                                 # lands by morning

    [notify]                     # machine-wide only (ADR 0038 d3)
    ntfy_topic = "thread-needs-you"  # the ntfy topic execute's needs-you push falls back to; unset = no fallback

    [repo."lachyts/thread-skill"] # one repo, keyed by its GitHub origin's owner/name
    parallel_ceiling = 5
    inert_paths = ["THREAD.md"]  # schema 2 (p29-3, ADR 0045): this repo's Inert paths; a repo table only

    [repo."Animately/optimizer"]  # schema 3 (ADR 0061): the repo's test-credential class, ONE line in its repo table
    test_credentials = { file = "~/repos/animately/optimizer/.env.local", keys = [{ name = "STRIPE_SECRET", prefix = "sk_test_" }, { name = "SUPABASE_SERVICE_ROLE_KEY", supabase_project = "geyyptxqiovujgbiecsp" }] }

The only top-level keys are `schema`, `defaults`, `guardrails`, `notify` and `repo`. A repo table holds every rollout key but
`verify_slots` (SETTING_KEYS: the four Tuning keys, KEYS, plus `auto_retries`, `spend_approval_usd` and
`verify_slots`; MACHINE_ONLY: `verify_slots`, which is machine-wide and refused under a `[repo."o/r"]` label), plus
`inert_paths` and `test_credentials` (REPO_ONLY: each refused under `[defaults]` with `<key> is per repo: set it under
[repo."owner/name"]`). Dotted keys (`repo."o/r".parallel_ceiling = 5`) and inline tables are read the same as table
form, with one exception: `test_credentials` is read only as ONE line inside its `[repo."o/r"]` table (below), because
inert-paths.py and reflect's tune.py edit this file line by line and treat any other form as a hand edit they refuse.

`inert_paths` (p29-3, ADR 0045; schema 2, the first key above schema 1) is the repo's Inert paths: a list of at most 64
distinct git pathspec globs (matched as `:(glob)<glob>`), empty by default (built-in []), so a repo nobody has checked
always re-runs its verifier. Each glob is refused when it is not a string, is empty or over 200 characters, has leading
or trailing whitespace, holds a control character or a backslash, starts with `/`, `:` (pathspec magic) or `!`, has an
empty, `.` or `..` segment, or ends in `/` (write `dir/**`). It is never stamped on a rollout and is no Tuning key: it
lives only here, written by skills/_shared/scripts/inert-paths.py `record` and `drop` (schedule § 2.9), and read at each
Integration by execute's `lead-integrate.py prepare`, which proves every glob again on the tree being merged. It is not
in `settings`: resolve() reports it as its own top-level `inert_paths` (Output). An older reader (schema 1) ignores
it under a schema-2 file (the schema rule below), so that rollout always re-runs.

`test_credentials` (ADR 0061; schema 3) is the repo's test-credential class: the test-mode and staging keys a credential
gate may name and still be signed by execute's standing approval (`reconcile-rollout.py approve-gates --standing`),
once each key is proved present in `file`. It is one inline table on ONE line inside `[repo."o/r"]`:
`test_credentials = { file = "<path>", keys = [{ name = "<NAME>", prefix = "<prefix>" }, { name = "<NAME>",
supabase_project = "<ref>" }, …] }`, a trailing comment allowed. Every other form is refused at its line with that
remedy (`[repo."o/r"] test_credentials must be one line in that table: …`): the `[repo."o/r".test_credentials]`
sub-table, the dotted forms (top-level or in-table), `repo = {…}` and a value that spans lines. The value
(credential_problem(), the first failure wins; a refused value is described, never echoed) holds exactly `file` and
`keys`; `file` is a string starting `/` or `~/`, at most 300 characters, with no control character and no `(` or `)`
(the annotation that names it ends at a `)`); `keys` is a list of 1 to MAX_CREDENTIAL_KEYS (32) tables, each holding
exactly `name` and one of `prefix` or `supabase_project`; a `name` is an upper-snake env name (CRED_NAME_RE, at least
one `_`) with no LIVE or PROD segment (LIVE_PROD_SEGMENT_RE: a live or production key is never in the class), and no
name twice; a `prefix` is 3 to 40 of A-Z, a-z, 0-9 and `_` (CRED_PREFIX_RE), holds `test` or `sandbox` and no `live`
or `prod`, in any case; a `supabase_project` is a Supabase project ref, 20 lowercase letters (SUPABASE_REF_RE). It is
operator-only: no automated writer adds or changes it (a rollout or task stamp would let an agent widen its own
approval), inert-paths.py's `mine`/`others` check refuses an edit whose result resolves another repo table, and
tune.py refuses an edit that changes any repo's `test_credentials`. It is not in `settings`: resolve() reports it as
its own top-level `test_credentials` (Output), null with no class. A schema-2 reader ignores it under a schema-3 file
(the schema rule below), so that rollout asks every credential gate, as before. It is its own switch, independent of
`spend_approval_usd`: a declared class signs at the built-in 0 too.

`[notify]` holds only `ntfy_topic` (NOTIFY_KEYS), machine-wide like `[guardrails]`: in `[defaults]` or a repo table it
is an unknown key. Two scripts read it, both through the importable resolve(), in process: execute's
skills/execute/scripts/ntfy-push.py publishes to the topic (§ 6.5 *The ntfy fallback*), and reflect's tune.py refuses
an edit whose result resolves another `[notify]` (a Tuning never touches the table). The CLI prints only whether a
topic is set (see Output), never the topic: on ntfy.sh a topic is its own read and publish credential.

The schema (ADR 0043: two rollouts can run on two Engine snapshots, so an older reader meets a newer file). The
top-level `schema` is an integer >= 1 (a boolean, float or string is refused); an absent line reads as 1. SCHEMA is
this reader's own version, and KEY_SCHEMA registers every key it knows, keyed by (scope, key), with the schema that
introduced it; the scopes are `top` (the top-level keys), `rollout` (a `[defaults]` or `[repo."o/r"]` table),
`guardrails` and `notify`. Under a file whose `schema` is above SCHEMA, an unknown key (a top-level table included)
is ignored and listed in `ignored`, unless it is a near-miss of a key known at its scope (near_miss(): equal once
lower-cased with `_` and `-` dropped, or within optimal-string-alignment distance 2), which is still refused as a
typo. Under any other file an unknown key is refused, as ever. A known key whose KEY_SCHEMA is above the file's
`schema` is refused with `<scope>.<key> is a schema-<N> key but the file says schema = <M>: raise the file's
top-level `schema` line to <N> in the same edit`. A top-level `schema` needs a P29+ reader: a pre-P29
rollout-settings.py refuses it as an unknown top-level key, so install a P29+ release before writing one.

Adding a key (the recipe; tests/rollout-settings.test.mjs K10 fails with it): bump SCHEMA; register the key in
KEY_SCHEMA at the new number; keep it no near-miss of any key registered at its scope (K8); and every writer that
adds it to a file whose `schema` is lower raises the file's `schema` line to that number in the same edit: tune.py
does it (raise_schema(), pinned by tests/reflect-tune.test.mjs KT1), and so must a hand edit. Both writers share
raise_schema_lines() below. A writer that raises the schema runs the reader check or names why it need not: a
pre-P29 reader refuses any top-level `schema` line and a schema-N reader any known key above N, and a refused file halts
every rollout on the machine at its next `verify-timeout`, so inert-paths.py `record` asks each live rollout's engine
root to read the new file first (its header); tune.py writes only schema-1 keys, so it never raises the line today.

Repo keys. A repo key must be quoted (`[repo."owner/name"]`) and is an `owner/name` by land.sh's slug rule
(`[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+`, a name that is not all dots), never ending `.git`. It is
matched, ignoring case, against `land.sh --origin-slug <--repo>`: the clone's local `git remote get-url
origin` (no network) in any of the three GitHub URL forms, with a trailing `/` and `.git` stripped. So a
rollout clone (ADR 0042) resolves the same as its in-place checkout. Two repo keys equal ignoring case
are refused as a duplicate. land.sh is run only when the file holds at least one repo table and `--repo`
was given, under ORIGIN_TIMEOUT seconds, in its own process group (killed whole on expiry).

Precedence for each rollout key (the callers apply the first two): task frontmatter → rollout frontmatter →
`[repo."<slug>"]` (source `file:repo`) → `[defaults]` (`file:defaults`) → `built-in`. Guardrail sources are
`file:guardrails` or `built-in`; `ntfy_topic`'s are `file:notify` or `built-in` (resolve()'s value null: no topic). Built-ins: parallel_ceiling 4, max_review_rounds 4, max_iterations 3,
max_plan_rounds 3, auto_retries 2, spend_approval_usd 0, verify_slots 2; guardrails 25 / 5 / 10 / 0 / 40 / 1.5 (hours_per_task,
a heuristic: Lachy's rollouts.toml sets the real bound). `auto_retries` is no Tuning key:
schedule does not stamp it and a Reflection never proposes it; execute's `lead-integrate.py inputs` and
`reconcile-rollout.py auto-retry` resolve it themselves (p16-4). Nor is `spend_approval_usd` (ADR 0034): schedule
shows it but never stamps it on a rollout, and `reconcile-rollout.py approve-gates --standing` resolves it itself (task
`spend_approval_usd:`, then rollout, then this file, then the built-in 0, which is off: the approval lives in this
file, never in the skills, so a fresh install approves nothing). Nor is `verify_slots` (p23-4): machine-wide, so
`[defaults]` only; never stamped on a rollout; execute's `reconcile-rollout.py verify-timeout` reads it at each loop
entry through resolve(repo=None), which validates the whole file. A refused file halts every rollout on this machine at
its next entry (execute's `verify-timeout`), stamped or not, so a new key follows the schema rule above: an older
snapshot reading a file whose `schema` is above its own ignores that key and runs.

Validation (ADR 0016: anything unknown or wrong is refused, never dropped, except a newer file's unknown key under the
schema rule above):
- a `schema` that is not an integer >= 1; a known key whose KEY_SCHEMA is above the file's `schema`;
- an unknown top-level key or table key, `defaults` or `guardrails` that is not a table, a `repo` that is
  not a table, a value under `repo` that is not a table (named by its key: `[repo."o/r"] must be a table`);
- a rollout value that is not an integer >= its MINIMUM: 1 for the four Tuning keys and `verify_slots`, 0 for
  `auto_retries` and `spend_approval_usd` (a boolean, float or string is refused, and so is 0 for a Tuning key);
- a MACHINE_ONLY key (`verify_slots`) in a `[repo."o/r"]` table;
- a `test_credentials` in any form but one line in its repo table, or a value credential_problem() refuses (ADR 0061);
- a guardrail that is not a non-negative integer or float (a boolean is refused; `quota_stalls` is an
  integer >= 0; `hours_per_task` is an integer or float > 0, since a bound of 0 breaches every run);
- a `notify` that is not a table, an unknown key under it, or an `ntfy_topic` that is not an ntfy topic (a string of
  1 to 64 of A-Z, a-z, 0-9, `-` and `_`, TOPIC_RE: an empty string, a URL, a boolean or a number is refused). A refused
  topic string is described, never echoed, so a near-miss topic never lands in a transcript;
- a bad or case-duplicate repo key.
No file (nothing at the path, a missing directory on the way, a plain file as a step on the way) gives the
built-ins, and so does an empty or comment-only file. The file is read by ladder.py's read_toml(), so a
dangling symlink, an unsearchable directory, bytes that are not UTF-8 and a TOML syntax error are refused as
ladder.toml's are.

Order of checks: `--repo` (with `~` expanded) is a directory; the file reads and validates; only then, when a
repo table exists and `--repo` was given, land.sh reads the origin; then the values resolve.

Output. Exit 0 and one JSON line on stdout:

    {"path": "<expanded path>", "file": true|false, "repo": "<owner/name>"|null,
     "settings": {"parallel_ceiling": {"value": 4, "source": "built-in"}, "max_review_rounds": {...},
                  "max_iterations": {...}, "max_plan_rounds": {...}, "auto_retries": {...},
                  "spend_approval_usd": {...}, "verify_slots": {...}},
     "guardrails": {"tokens_per_merge_pct": {"value": 25, "source": "built-in"}, ...},
     "notify": {"ntfy_topic": {"set": true|false, "source": "file:notify"|"built-in"}},
     "inert_paths": {"value": ["<glob>", ...], "source": "file:repo"|"built-in"},   # built-in []
     "test_credentials": {"value": {"file": "<path>", "keys": [{"name": "<NAME>", "prefix": "<p>"}
                                    | {"name": "<NAME>", "supabase_project": "<ref>"}, ...]} | null,
                          "source": "file:repo"|"built-in"},                        # built-in null: no class
     "schema": {"file": <the file's schema, 1 when absent or no file>, "engine": SCHEMA},
     "ignored": ["<scope path of each ignored key>", ...]}     # e.g. "defaults.foo", 'repo."o/r".foo', "away"

`notify` is redacted (redacted()): `set` says whether a topic resolved, and the topic itself is never printed, since
schedule, execute, status and repair run this CLI in a transcript and the Reflection keeps its JSON in a scratch file.
resolve() returns the same object with `"value": "<topic>"|null` in place of `set`, for the in-process readers above.
`test_credentials` is printed whole: key names, prefixes, project refs and a path are no secrets (no value is ever read
here; the standing approval reads the file itself).

`repo` is the origin's owner/name as land.sh printed it (case kept), or null when no repo table could apply:
no `--repo`, no file, no repo table, or no GitHub origin (no repo, no origin, another host: land.sh exit 4).

Exit 2 when the file is refused, `--repo` is not a directory, the origin cannot be read (land.sh will not
start, exits other than 0 or 4, or times out), or on a usage error. Exit 3 when a present file needs tomllib
and this python has none. On failure stdout is empty and stderr carries one line:
`rollout-settings: <path>:<line>: <reason>`, `rollout-settings: <path>: <reason>` when no line applies, or
`rollout-settings: --repo <p>: <reason>`.

Importable: resolve(repo=None, path=None), redacted(out) (resolve()'s object as the CLI prints it), BUILT_IN, GUARDRAILS_BUILT_IN, KEYS (the four Tuning keys, which
run_record.py's TUNING_KEYS, tune.py and score.py read), SETTING_KEYS (KEYS plus `auto_retries`,
`spend_approval_usd` and `verify_slots`: every key a `settings` object holds), MACHINE_ONLY, REPO_ONLY, MINIMUM,
GUARDRAIL_KEYS, NOTIFY_KEYS, NOTIFY_BUILT_IN, TOPIC_RE, ORIGIN_TIMEOUT, SCHEMA, KEY_SCHEMA, MAX_INERT_GLOBS,
MAX_CREDENTIAL_KEYS, glob_problem(glob), credential_problem(value) (why a test_credentials value is refused, or None),
near_miss(key, known), file_schema(doc), load_tables(path) (the validated tables, None for no
file), raise_schema_lines(lines, need, current) (the top-level `schema` raise both writers share: `lines` with the
line raised to `need` when it is above `current`, never lowered; an existing top-level line is rewritten in place,
keeping its comment; otherwise `schema = <need>` and a blank line go before the first table header, above the comment
lines directly over it; a SettingsError for a `schema` line it will not edit), default_path(),
SettingsError(reason, line=None, code=2, subject=None).
"""
import argparse
import importlib.util
import json
import math
import os
import re
import signal
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAND_SH = os.path.join(HERE, "land.sh")

# The four Tuning keys (a Reflection proposes them; run_record.py's TUNING_KEYS is pinned to this tuple).
KEYS = ("parallel_ceiling", "max_review_rounds", "max_iterations", "max_plan_rounds")
# Every rollout key a table may hold and `settings` reports: the Tuning keys plus execute's automatic-retry budget,
# the standing approval's limit in US dollars (ADR 0034) and the machine's verify slots (p23-4); none of the three is
# Reflection-tunable.
SETTING_KEYS = KEYS + ("auto_retries", "spend_approval_usd", "verify_slots")
# Machine-wide keys: valid under [defaults] only, refused in a [repo."o/r"] table (a verify slot is shared by every
# rollout on the machine, whatever its repo).
MACHINE_ONLY = ("verify_slots",)
# Per-repo keys (p29-3): valid in a [repo."o/r"] table only, refused under [defaults], and kept out of `settings`
# (resolve() reports each as its own top-level field). `inert_paths` is a repo's Inert paths (ADR 0045);
# `test_credentials` its test-credential class (ADR 0061), one line in its table.
REPO_ONLY = ("inert_paths", "test_credentials")
MAX_INERT_GLOBS = 64
# test_credentials (ADR 0061): at most 32 keys; a name is an upper-snake env name with at least one `_`; a prefix is 3 to
# 40 word characters; a Supabase project ref is 20 lowercase letters. A name with a LIVE or PROD segment is refused.
MAX_CREDENTIAL_KEYS = 32
CRED_NAME_RE = re.compile(r"[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\Z")
CRED_PREFIX_RE = re.compile(r"[A-Za-z0-9_]{3,40}\Z")
SUPABASE_REF_RE = re.compile(r"[a-z]{20}\Z")
LIVE_PROD_SEGMENT_RE = re.compile(r"(?:^|_)(?:LIVE|PROD)")
BUILT_IN = {"parallel_ceiling": 4, "max_review_rounds": 4, "max_iterations": 3, "max_plan_rounds": 3, "auto_retries": 2,
            "spend_approval_usd": 0, "verify_slots": 2}
# The least valid value of each rollout key: a Tuning key is >= 1; `auto_retries: 0` disables automatic retries;
# `spend_approval_usd: 0` turns the standing approval off.
MINIMUM = {"parallel_ceiling": 1, "max_review_rounds": 1, "max_iterations": 1, "max_plan_rounds": 1, "auto_retries": 0,
           "spend_approval_usd": 0, "verify_slots": 1}
# review_churn_pct (p21-3, ADR 0037 d1): Review churn's absolute bound, a non-negative number like the rates.
# hours_per_task (p21-2): the Throughput Guardrail's absolute bound, skills/reflect/scripts/score.py's built-in too.
GUARDRAIL_KEYS = ("tokens_per_merge_pct", "set_aside_rate_points", "conflict_rate_points", "quota_stalls",
                  "review_churn_pct", "hours_per_task")
GUARDRAILS_BUILT_IN = {"tokens_per_merge_pct": 25, "set_aside_rate_points": 5, "conflict_rate_points": 10,
                       "quota_stalls": 0, "review_churn_pct": 40, "hours_per_task": 1.5}
# [notify] (ADR 0038 d3): machine-wide, read in process by execute's ntfy-push.py and reflect's tune.py; no topic (None)
# means no ntfy fallback. The CLI prints only whether it is set (redacted()).
NOTIFY_KEYS = ("ntfy_topic",)
NOTIFY_BUILT_IN = {"ntfy_topic": None}
TOPIC_RE = re.compile(r"[-_A-Za-z0-9]{1,64}\Z")  # ntfy's own topic rule
TABLES = ("defaults", "guardrails", "notify", "repo")
TOP_KEYS = ("schema",) + TABLES
# The schema (ADR 0043; the header's schema rule and add-a-key recipe). SCHEMA is this reader's version; KEY_SCHEMA
# registers every key it knows, by (scope, key), at the schema that introduced it. K10 freezes the schema-1 set.
SCHEMA = 3
KEY_SCHEMA = {}
KEY_SCHEMA.update({("top", k): 1 for k in TOP_KEYS})
KEY_SCHEMA.update({("rollout", k): 1 for k in SETTING_KEYS})
KEY_SCHEMA.update({("guardrails", k): 1 for k in GUARDRAIL_KEYS})
KEY_SCHEMA.update({("notify", k): 1 for k in NOTIFY_KEYS})
KEY_SCHEMA[("rollout", "inert_paths")] = 2   # p29-3 (ADR 0045): the first schema-2 key
KEY_SCHEMA[("rollout", "test_credentials")] = 3   # ADR 0061: the first schema-3 key
ORIGIN_TIMEOUT = 20  # seconds for land.sh --origin-slug (one local git call); the whole group dies on expiry

# land.sh's origin_slug rule, so a key can only ever equal a slug land.sh prints.
SLUG_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+\Z")

# One TOML key segment (bare, "basic" or 'literal'), as ladder.py's _SEG; a dotted key is segments joined by `.`.
_SEG = r'(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|\'[^\']*\')'
_DOTTED = _SEG + r"(?:\s*\.\s*" + _SEG + r")*"
_SEG_RE = re.compile(_SEG)
_AOT_RE = re.compile(r"\[\[\s*(" + _DOTTED + r")\s*\]\]\s*(?:#.*)?\Z")
_TABLE_RE = re.compile(r"\[\s*(" + _DOTTED + r")\s*\]\s*(?:#.*)?\Z")
_KEY_RE = re.compile(r"(" + _DOTTED + r")\s*=")


def default_path():
    return os.path.expanduser("~/.config/thread/rollouts.toml")


class SettingsError(Exception):
    """A refusal: str() is `<subject>[:<line>]: <reason>`; the CLI prefixes `rollout-settings: `."""

    def __init__(self, reason, line=None, code=2, subject=None):
        Exception.__init__(self, reason)
        self.reason = reason
        self.line = line
        self.code = code
        self.subject = subject

    def __str__(self):
        where = self.subject or ""
        if self.line is not None:
            where = "%s:%d" % (where, self.line)
        return "%s: %s" % (where, self.reason) if where else self.reason


def _ladder():
    spec = importlib.util.spec_from_file_location("thread_ladder", os.path.join(HERE, "ladder.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _unquote(seg):
    if seg[:1] == '"':
        try:
            return json.loads(seg)
        except ValueError:
            return seg[1:-1]
    if seg[:1] == "'":
        return seg[1:-1]
    return seg


def _segments(dotted):
    return tuple(_unquote(m.group(0)) for m in _SEG_RE.finditer(dotted))


class _Lines:
    """Where each key sits in the file, by a line scan (tomllib reports no positions for semantic errors).

    The twin of ladder.py's _Index, generalised to nested paths: `lines` maps a key path (a tuple, e.g.
    ("repo", "o/r", "parallel_ceiling")) to the first line it appears on. A `[a."b"]` or `[[a."b"]]` header
    records its path and each prefix; a key records its path relative to the current table, each dotted
    prefix included. Keys inside an inline table are not scanned: they fall back to the line of the key
    their `{` opens on (line_of's nearest recorded prefix). Only a line that starts outside every value is
    read as a header or a key; the rest of each line is scanned as TOML values, as _Index scans it, so
    strings and comments count for nothing and multi-line strings and arrays carry over to the next line.
    `one_line` maps a key path to its line only for a single-segment key under a two-segment table header
    (`[repo."o/r"]`) whose value closes on that same line (no bracket or multi-line string left open after the
    scan): the one form `test_credentials` is read in (ADR 0061). `lines` and `line_of` are unchanged by it.

    Why a copy and not a share (unlike read_toml): _Index's value scan carries the ladder's own hooks inside
    its loop (the `rung = [` array and each inline rung's `{` line, which its refusals cite), and its records
    are flat (top-level names, per-[[rung]] keys) where this one is path-keyed. Sharing it would mean
    re-cutting the ladder's line attribution, which tests/ladder.test.mjs pins line by line, to serve a second
    file. The copied part is only the string/comment/bracket skip (_scan, _close_multiline); a fix to one of
    them belongs in both, and tests/rollout-settings.test.mjs pins this copy's lines on its own.
    """

    def __init__(self, text):
        self.lines = {}
        self.one_line = {}
        self._table = ()
        self._string = None
        self._brackets = []
        for n, line in enumerate(text.split("\n"), 1):
            self._line(n, line.strip())

    def _record(self, path, n):
        for i in range(1, len(path) + 1):
            self.lines.setdefault(path[:i], n)

    def line_of(self, path):
        """The path's own line, else its nearest recorded prefix's, else None."""
        for i in range(len(path), 0, -1):
            if path[:i] in self.lines:
                return self.lines[path[:i]]
        return None

    def _line(self, n, s):
        if self._string is None and not self._brackets:
            if not s or s.startswith("#"):
                return
            m = _AOT_RE.match(s) or _TABLE_RE.match(s)
            if m:
                self._table = _segments(m.group(1))
                self._record(self._table, n)
                return
            m = _KEY_RE.match(s)
            if m:
                segs = _segments(m.group(1))
                self._record(self._table + segs, n)
                self._scan(s[m.end():])
                if len(self._table) == 2 and len(segs) == 1 and self._string is None and not self._brackets:
                    self.one_line[self._table + segs] = n
                return
        self._scan(s)

    def _scan(self, s):
        i = 0
        while i < len(s):
            if self._string:
                i = self._close_multiline(s, i)
                continue
            c = s[i]
            if c == "#":
                return
            if s.startswith('"""', i) or s.startswith("'''", i):
                self._string = s[i:i + 3]
                i += 3
                continue
            if c == '"':
                i += 1
                while i < len(s) and s[i] != '"':
                    i += 2 if s[i] == "\\" else 1
                i += 1
                continue
            if c == "'":
                end = s.find("'", i + 1)
                i = len(s) if end < 0 else end + 1
                continue
            if c in "[{":
                self._brackets.append(c)
            elif c in "]}" and self._brackets:
                self._brackets.pop()
            i += 1

    def _close_multiline(self, s, i):
        quote = self._string[0]
        while i < len(s):
            if quote == '"' and s[i] == "\\":
                i += 2
            elif s.startswith(self._string, i):
                while i < len(s) and s[i] == quote:
                    i += 1
                self._string = None
                return i
            else:
                i += 1
        return len(s)


def _describe(value):
    if isinstance(value, bool):
        return "a boolean (%s)" % ("true" if value else "false")
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return "a float (%r)" % value
    if isinstance(value, str):
        return "a string (%s)" % json.dumps(value)
    if isinstance(value, list):
        return "an array"
    if isinstance(value, dict):
        return "a table"
    return "a date or time"


def _topic_problem(value):
    """What a refused ntfy_topic is, never the string itself (a near-miss topic stays out of every transcript)."""
    if not isinstance(value, str):
        return _describe(value)
    if not value:
        return "an empty string"
    if len(value) > 64:
        return "a string of %d characters" % len(value)
    return "a string holding another character"


def _osa(a, b):
    """The optimal-string-alignment distance (Levenshtein plus adjacent transpositions)."""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[len(a)][len(b)]


def near_miss(key, known):
    """The known key `key` is a near-miss of (equal once lower-cased with `_` and `-` dropped, or within optimal-string-
    alignment distance 2), else None: a typo of a known key is refused even under a newer file's schema."""
    squash = lambda s: s.lower().replace("_", "").replace("-", "")   # noqa: E731
    for k in known:
        if k != key and (squash(k) == squash(key) or _osa(k, key) <= 2):
            return k
    return None


def glob_problem(glob):
    """Why `glob` is no valid Inert-paths glob (the header's rule), or None."""
    if not isinstance(glob, str):
        return "is not a string (got %s)" % _describe(glob)
    if not glob:
        return "is empty"
    if len(glob) > 200:
        return "is %d characters (at most 200)" % len(glob)
    if glob != glob.strip():
        return "has leading or trailing whitespace"
    if any(ord(c) < 32 or ord(c) == 127 for c in glob):
        return "holds a control character"
    if "\\" in glob:
        return "holds a backslash"
    if glob[0] in "/:!":
        return "starts with %s (a glob is repo-relative, with no pathspec magic or negation)" % json.dumps(glob[0])
    if glob.endswith("/"):
        return "ends in / (write %s)" % json.dumps(glob + "**")
    if any(seg in ("", ".", "..") for seg in glob.split("/")):
        return "has an empty, . or .. segment"
    return None


def credential_problem(value):
    """Why a `test_credentials` value is no valid test-credential class (the header's rules, the first failure wins), or
    None. A refused value is described, never echoed."""
    if not isinstance(value, dict):
        return "must be an inline table { file = \"…\", keys = [ … ] }, got %s" % _describe(value)
    for key in value:
        if key not in ("file", "keys"):
            return "holds an unknown key %s (it holds exactly file and keys)" % json.dumps(key)
    for key in ("file", "keys"):
        if key not in value:
            return "has no %s (it holds exactly file and keys)" % key
    path = value["file"]
    if not isinstance(path, str):
        return "file must be a string, got %s" % _describe(path)
    if not (path.startswith("/") or path.startswith("~/")):
        return "file must be an absolute path (starting / or ~/)"
    if len(path) > 300:
        return "file is %d characters (at most 300)" % len(path)
    if any(ord(c) < 32 or ord(c) == 127 for c in path):
        return "file holds a control character"
    if "(" in path or ")" in path:
        return "file holds a ( or ) (the approval's annotation names it and ends at a ))"
    keys = value["keys"]
    if not isinstance(keys, list):
        return "keys must be a list of 1 to %d tables, got %s" % (MAX_CREDENTIAL_KEYS, _describe(keys))
    if not keys:
        return "keys is empty (it lists 1 to %d keys)" % MAX_CREDENTIAL_KEYS
    if len(keys) > MAX_CREDENTIAL_KEYS:
        return "keys holds %d entries (at most %d)" % (len(keys), MAX_CREDENTIAL_KEYS)
    names = set()
    for n, entry in enumerate(keys, 1):
        where = "keys entry %d" % n
        if not isinstance(entry, dict):
            return "%s must be a table { name = \"…\", prefix = \"…\" }, got %s" % (where, _describe(entry))
        for key in entry:
            if key not in ("name", "prefix", "supabase_project"):
                return "%s holds an unknown key %s (it holds name and one of prefix or supabase_project)" % (
                    where, json.dumps(key))
        if "name" not in entry:
            return "%s has no name" % where
        if ("prefix" in entry) == ("supabase_project" in entry):
            return "%s must hold exactly one of prefix or supabase_project" % where
        name = entry["name"]
        if not isinstance(name, str) or not CRED_NAME_RE.match(name):
            return ("%s: name must be an upper-snake env name (A-Z, 0-9 and _, with at least one _), got %s"
                    % (where, _describe(name) if not isinstance(name, str) else "a string of another form"))
        if LIVE_PROD_SEGMENT_RE.search(name):
            return "%s: name holds a LIVE or PROD segment (a live or production key is never a test credential)" % where
        if name in names:
            return "%s: its name is listed twice" % where
        names.add(name)
        if "prefix" in entry:
            prefix = entry["prefix"]
            if not isinstance(prefix, str) or not CRED_PREFIX_RE.match(prefix):
                return ("%s: prefix must be 3 to 40 of A-Z, a-z, 0-9 and _, got %s"
                        % (where, _describe(prefix) if not isinstance(prefix, str) else "a string of another form"))
            low = prefix.lower()
            if "live" in low or "prod" in low:
                return "%s: prefix holds live or prod (a live or production key is never a test credential)" % where
            if "test" not in low and "sandbox" not in low:
                return "%s: prefix holds no test or sandbox (a test credential's prefix says it is one)" % where
        else:
            ref = entry["supabase_project"]
            if not isinstance(ref, str) or not SUPABASE_REF_RE.match(ref):
                return ("%s: supabase_project must be a Supabase project ref (20 lowercase letters), got %s"
                        % (where, _describe(ref) if not isinstance(ref, str) else "a string of another form"))
    return None


def file_schema(doc):
    """The file's top-level `schema` (1 when absent), or None when it is not an integer >= 1."""
    raw = (doc or {}).get("schema", 1)
    if isinstance(raw, bool) or not isinstance(raw, int) or raw < 1:
        return None
    return raw


def _validate(text, doc, path):
    """{"defaults": {...}, "guardrails": {...}, "notify": {...}, "repo": {slug: {...}}, "schema": N, "ignored": [...]}
    from a parsed file, or SettingsError."""
    idx = _Lines(text)

    def refuse(reason, at):
        raise SettingsError(reason, line=idx.line_of(at), subject=path)

    schema = file_schema(doc)
    if schema is None:
        refuse("schema must be an integer >= 1 (the file's schema version), got %s" % _describe(doc.get("schema")),
               ("schema",))
    ignored = []

    def unknown(scope, key, label, at, why):
        """Ignore a newer file's unknown key (the schema rule), else refuse it with `why`."""
        known = tuple(k for (sc, k) in KEY_SCHEMA if sc == scope)
        miss = near_miss(key, known)
        if schema > SCHEMA and miss is None:
            ignored.append(label)
            return
        if miss is not None and schema > SCHEMA:
            why += " (a near-miss of %s, so it is refused even under a newer schema)" % json.dumps(miss)
        refuse(why, at)

    def newer(scope, key, at):
        """Refuse a known key the file's `schema` is too old for."""
        n = KEY_SCHEMA.get((scope, key), 1)
        if n > schema:
            refuse("%s.%s is a schema-%d key but the file says schema = %d: raise the file's top-level `schema` line to "
                   "%d in the same edit" % (scope, key, n, schema, n), at)

    for key in list(doc):
        if key not in TOP_KEYS:
            unknown("top", key, key, (key,),
                    "unknown top-level key %s (rollouts.toml holds only a top-level schema and [defaults], [guardrails], "
                    "[notify] and [repo.\"owner/name\"] tables)" % json.dumps(key))
        else:
            newer("top", key, (key,))

    def rollout_table(table, label, at):
        kept = {}
        for key, value in table.items():
            if key not in SETTING_KEYS + REPO_ONLY:
                unknown("rollout", key, ".".join(json.dumps(a) if "/" in a else a for a in at + (key,)), at + (key,),
                        "%s: unknown key %s (a rollout table holds %s)" % (label, json.dumps(key),
                                                                         ", ".join(SETTING_KEYS + REPO_ONLY)))
                continue
            newer("rollout", key, at + (key,))
            if key in MACHINE_ONLY and at[0] == "repo":
                refuse("%s %s is machine-wide: set it under [defaults]" % (label, key), at + (key,))
            if key in REPO_ONLY:
                if at[0] != "repo":
                    refuse("%s is per repo: set it under [repo.\"owner/name\"]" % key, at + (key,))
                if key == "test_credentials":
                    # ADR 0061: one line in its repo table, the only form inert-paths.py and tune.py edit around.
                    if at + (key,) not in idx.one_line:
                        refuse("%s test_credentials must be one line in that table: test_credentials = { file = \"…\", "
                               "keys = [ … ] } (inert-paths.py and tune.py edit this file line by line)" % label,
                               at + (key,))
                    why = credential_problem(value)
                    if why:
                        refuse("%s test_credentials: %s" % (label, why), at + (key,))
                    kept[key] = {"file": value["file"],
                                 "keys": [{k: entry[k] for k in ("name", "prefix", "supabase_project") if k in entry}
                                          for entry in value["keys"]]}
                    continue
                if not isinstance(value, list):
                    refuse("%s %s must be a list of git pathspec globs, got %s" % (label, key, _describe(value)),
                           at + (key,))
                if len(value) > MAX_INERT_GLOBS:
                    refuse("%s %s holds %d globs (at most %d)" % (label, key, len(value), MAX_INERT_GLOBS), at + (key,))
                for glob in value:
                    if not isinstance(glob, str):
                        refuse("%s %s: each glob must be a string, got %s" % (label, key, _describe(glob)), at + (key,))
                    why = glob_problem(glob)
                    if why:
                        refuse("%s %s: the glob %s %s" % (label, key, json.dumps(glob), why), at + (key,))
                if len(set(value)) != len(value):
                    dup = next(g for g in value if value.count(g) > 1)
                    refuse("%s %s: the glob %s is listed twice" % (label, key, json.dumps(dup)), at + (key,))
                kept[key] = list(value)
                continue
            if isinstance(value, bool) or not isinstance(value, int) or value < MINIMUM[key]:
                refuse("%s %s must be an integer >= %d, got %s" % (label, key, MINIMUM[key], _describe(value)), at + (key,))
            kept[key] = value
        return kept

    out = {"defaults": {}, "guardrails": {}, "notify": {}, "repo": {}, "schema": schema, "ignored": ignored}
    defaults = doc.get("defaults", {})
    if not isinstance(defaults, dict):
        refuse("defaults must be a table ([defaults]), got %s" % _describe(defaults), ("defaults",))
    out["defaults"] = rollout_table(defaults, "[defaults]", ("defaults",))

    guardrails = doc.get("guardrails", {})
    if not isinstance(guardrails, dict):
        refuse("guardrails must be a table ([guardrails]), got %s" % _describe(guardrails), ("guardrails",))
    kept = {}
    for key, value in guardrails.items():
        at = ("guardrails", key)
        if key not in GUARDRAIL_KEYS:
            unknown("guardrails", key, "guardrails." + key, at,
                    "[guardrails]: unknown key %s (guardrails are %s)" % (json.dumps(key), ", ".join(GUARDRAIL_KEYS)))
            continue
        newer("guardrails", key, at)
        kept[key] = value
        if key == "quota_stalls":
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                refuse("[guardrails] quota_stalls must be an integer >= 0, got %s" % _describe(value), at)
        elif key == "hours_per_task":
            if (isinstance(value, bool) or not isinstance(value, (int, float)) or not value > 0
                    or (isinstance(value, float) and not math.isfinite(value))):
                refuse("[guardrails] hours_per_task must be a number > 0, got %s" % _describe(value), at)
        elif (isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0
              or (isinstance(value, float) and not math.isfinite(value))):
            refuse("[guardrails] %s must be a non-negative number, got %s" % (key, _describe(value)), at)
    out["guardrails"] = kept

    notify = doc.get("notify", {})
    if not isinstance(notify, dict):
        refuse("notify must be a table ([notify]), got %s" % _describe(notify), ("notify",))
    kept = {}
    for key, value in notify.items():
        at = ("notify", key)
        if key not in NOTIFY_KEYS:
            unknown("notify", key, "notify." + key, at,
                    "[notify]: unknown key %s ([notify] holds %s)" % (json.dumps(key), ", ".join(NOTIFY_KEYS)))
            continue
        newer("notify", key, at)
        if not isinstance(value, str) or not TOPIC_RE.match(value):
            refuse("[notify] ntfy_topic must be an ntfy topic (1 to 64 of A-Z, a-z, 0-9, - and _), got %s"
                   % _topic_problem(value), at)
        kept[key] = value
    out["notify"] = kept

    repos = doc.get("repo", {})
    if not isinstance(repos, dict):
        refuse("repo must be a table of tables ([repo.\"owner/name\"]), got %s" % _describe(repos), ("repo",))
    seen = {}  # lowered slug -> the key as written
    for slug, table in repos.items():
        at = ("repo", slug)
        label = "[repo.%s]" % json.dumps(slug)
        if not isinstance(table, dict):  # `repo."o/r" = 5`, or a rollout key written straight under `[repo]`
            refuse("%s must be a table, got %s (a repo's keys go under [repo.\"owner/name\"])"
                   % (label, _describe(table)), at)
        if slug.lower().endswith(".git"):
            refuse("%s: a repo key never ends .git (write the origin's owner/name)" % label, at)
        if not SLUG_RE.match(slug) or not slug.split("/", 1)[1].strip("."):
            refuse("%s: a repo key is a GitHub owner/name ([A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9._-]+, "
                   "a name that is not all dots)" % label, at)
        first = seen.get(slug.lower())
        if first is not None:
            first_line = idx.line_of(("repo", first))
            where = ", first at line %d" % first_line if first_line is not None else ""
            refuse("duplicate repo %s (same as %s%s, ignoring case)" % (json.dumps(slug), json.dumps(first), where), at)
        seen[slug.lower()] = slug
        out["repo"][slug.lower()] = rollout_table(table, label, at)
    return out


def load_tables(path):
    """The validated tables of the file at `path` (_validate's dict), or None when there is no file. SettingsError."""
    ladder = _ladder()
    try:
        read = ladder.read_toml(path)
    except ladder.LadderError as e:
        raise SettingsError(e.reason, line=e.line, code=e.code, subject=path)
    return None if read is None else _validate(read[0], read[1], path)


def _key_line_re(key):
    return re.compile(r"^(\s*(?:%s|\"%s\"|'%s')\s*=\s*)([^\s#]+)(.*)$" % (key, key, key))


def raise_schema_lines(lines, need, current):
    """`lines` with the top-level `schema` raised to `need` when it is above `current` (the file's, else 1): the
    header's rule. Never lowers it; a SettingsError for a schema line it will not edit."""
    if need <= current:
        return lines
    first = next((i for i, line in enumerate(lines)
                  if _AOT_RE.match(line.strip()) or _TABLE_RE.match(line.strip())), len(lines))
    for i in range(first):
        s = lines[i].strip()
        if not s or s.startswith("#"):
            continue
        m = _KEY_RE.match(s)
        if m and _segments(m.group(1)) == ("schema",):
            mm = _key_line_re("schema").match(lines[i])
            if not mm:
                raise SettingsError("cannot read the top-level schema line (line %d): edit it by hand" % (i + 1))
            return lines[:i] + [mm.group(1) + str(need) + mm.group(3)] + lines[i + 1:]
    at = first
    while at > 0 and lines[at - 1].strip().startswith("#"):
        at -= 1   # the comment lines directly over the header stay with it
    return lines[:at] + ["schema = %d" % need, ""] + lines[at:]


def _git_env():
    """The caller's env minus git's repo-local names (GIT_DIR & co.), as unfinished-rollout.py's git_env()."""
    try:
        names = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True,
                               stdin=subprocess.DEVNULL, timeout=ORIGIN_TIMEOUT).stdout.split()
    except (OSError, subprocess.SubprocessError):
        names = []  # land.sh scrubs them again itself
    env = dict(os.environ)
    for name in names:
        env.pop(name, None)
    return env


def _origin_slug(repo):
    """land.sh --origin-slug <repo>: the owner/name, or None when the directory has no GitHub origin (exit 4)."""
    subject = "--repo %s" % repo
    try:
        p = subprocess.Popen(["bash", LAND_SH, "--origin-slug", repo], stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=_git_env(),
                             start_new_session=True, text=True)
    except OSError as e:
        raise SettingsError("cannot read its origin (land.sh will not start: %s)" % (e.strerror or e), subject=subject)
    try:
        out, _err = p.communicate(timeout=ORIGIN_TIMEOUT)
    except subprocess.TimeoutExpired:
        # Kill the whole group before draining: a grandchild git holding the pipe would hang communicate().
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except OSError:
            pass
        for f in (p.stdout, p.stderr):
            try:
                f.close()
            except OSError:
                pass
        p.wait()
        raise SettingsError("reading its origin timed out after %ss" % ORIGIN_TIMEOUT, subject=subject)
    if p.returncode == 4:
        return None
    slug = out.strip()
    if p.returncode != 0 or not slug:
        raise SettingsError("cannot read its origin (land.sh exit %d)" % p.returncode, subject=subject)
    return slug


def resolve(repo=None, path=None):
    """The resolved settings (the CLI's JSON object). Raises SettingsError (with .line, .code, .subject)."""
    if repo is not None:
        repo = os.path.expanduser(repo)
        if not os.path.isdir(repo):
            raise SettingsError("not a directory", subject="--repo %s" % repo)
    path = default_path() if path is None else path
    ladder = _ladder()
    try:
        read = ladder.read_toml(path)
    except ladder.LadderError as e:
        raise SettingsError(e.reason, line=e.line, code=e.code, subject=path)
    tables = (_validate(read[0], read[1], path) if read is not None
              else {"defaults": {}, "guardrails": {}, "notify": {}, "repo": {}, "schema": 1, "ignored": []})

    slug, overrides = None, {}
    if repo is not None and tables["repo"]:
        slug = _origin_slug(repo)
        if slug is not None:
            overrides = tables["repo"].get(slug.lower(), {})

    settings = {}
    for key in SETTING_KEYS:
        if key in overrides:
            settings[key] = {"value": overrides[key], "source": "file:repo"}
        elif key in tables["defaults"]:
            settings[key] = {"value": tables["defaults"][key], "source": "file:defaults"}
        else:
            settings[key] = {"value": BUILT_IN[key], "source": "built-in"}
    guardrails = {}
    for key in GUARDRAIL_KEYS:
        if key in tables["guardrails"]:
            guardrails[key] = {"value": tables["guardrails"][key], "source": "file:guardrails"}
        else:
            guardrails[key] = {"value": GUARDRAILS_BUILT_IN[key], "source": "built-in"}
    notify = {}
    for key in NOTIFY_KEYS:
        if key in tables["notify"]:
            notify[key] = {"value": tables["notify"][key], "source": "file:notify"}
        else:
            notify[key] = {"value": NOTIFY_BUILT_IN[key], "source": "built-in"}
    inert = ({"value": list(overrides["inert_paths"]), "source": "file:repo"} if "inert_paths" in overrides
             else {"value": [], "source": "built-in"})
    creds = overrides.get("test_credentials")
    creds = ({"value": {"file": creds["file"], "keys": [dict(k) for k in creds["keys"]]}, "source": "file:repo"}
             if creds is not None else {"value": None, "source": "built-in"})
    return {"path": path, "file": read is not None, "repo": slug, "settings": settings, "guardrails": guardrails,
            "notify": notify, "inert_paths": inert, "test_credentials": creds,
            "schema": {"file": tables["schema"], "engine": SCHEMA}, "ignored": list(tables["ignored"])}


def redacted(out):
    """resolve()'s object as the CLI prints it: each [notify] value replaced by whether it is set, so the topic (a read
    and publish credential on ntfy.sh) never reaches stdout or a transcript. The rest is resolve()'s, unchanged."""
    view = dict(out)
    view["notify"] = {key: {"set": v["value"] is not None, "source": v["source"]} for key, v in out["notify"].items()}
    return view


class _Parser(argparse.ArgumentParser):
    def error(self, message):  # argparse's default prints multi-line usage; keep failures to one line
        sys.stderr.write("rollout-settings: %s\n" % message)
        sys.exit(2)


def main(argv):
    parser = _Parser(prog="rollout-settings",
                     description="Print the operator's rollout settings (%s) as JSON." % default_path())
    parser.add_argument("--repo", help="a directory in the clone whose GitHub origin picks a [repo.\"owner/name\"] table")
    args = parser.parse_args(argv)
    try:
        out = resolve(repo=args.repo)
    except SettingsError as e:
        sys.stderr.write("rollout-settings: %s\n" % e)
        return e.code
    sys.stdout.write(json.dumps(redacted(out)) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
