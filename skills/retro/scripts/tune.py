#!/usr/bin/env python3
"""tune.py — land the Tunings Lachy picked from a Retro, and record the Retro (p15-5, ADR 0032).

python >= 3.8, stdlib only. The only writer of rollouts.toml and of tunings.jsonl. Called by
skills/retro/SKILL.md (step 7) exactly once per Retro that reached its scores:

    python3 ${CLAUDE_PLUGIN_ROOT}/skills/retro/scripts/tune.py --scores <score.json|-> \\
        (--pick p1[,p2...] --repo <dir> | --record-only) [--config <path>] [--dry-run]

--scores is score.py's JSON. --pick and --record-only are mutually exclusive and one is required.

--record-only writes ONE `tuning` line (applied: []) through run_record.emit and never reads or touches the
config: every Retro leaves its headline scores as the next Retro's baseline. With `repo: null` in the scores
(no GitHub origin) it writes nothing, prints `tune: not recorded: ...` on stderr and exits 0.

--pick, checked before any write:
- every pick names an id in scores.proposals (a withheld or unknown id is refused; a repeated id counts once;
  two picks on one key are refused);
- the repo identity is rollout-settings.py's _origin_slug(--repo) (land.sh --origin-slug, its timeout and its
  process group), never resolve()'s `repo`, which is null when no repo table applies yet: so the first Tuning
  on a repo passes. No GitHub origin, an unreadable origin, or a slug other than scores.repo (ignoring case)
  is refused;
- each pick's `from` equals resolve(repo=--repo, path=--config)'s value for its key now (else a stale `from`);
- the key is not set in dotted or inline-table form (edit those by hand);
- a config rollout-settings refuses is refused (exit 3 when a present file needs tomllib and there is none).
The edit works on the config's realpath (a symlink keeps its link), line by line: in the repo's
`[repo."owner/name"]` table (matched ignoring case) it replaces the value and keeps a trailing comment, or
inserts the key after the table's last key; with no table it appends `[repo."<scores.repo>"]` (a key set only
under [defaults] still gets a repo entry: Tunings are per repo). No file, or a comment-only one, is created
or appended to; a missing parent directory is created, and removed again when a failure leaves it empty. The
result goes to a temp file in the same directory and must resolve with each picked key at its `to` from
`file:repo`, every other key and Guardrail unchanged.

Write order: (1) every check above; (2) ONE `tuning` line carrying every pick, through
run_record.emit(strict=True), its returned bool checked: one os.write, so tunings.jsonl gains the whole set
or nothing; (3) os.replace(temp, realpath).
- emit returns False (an unwritable events dir, a short write): the temp file goes, rollouts.toml was never
  touched, exit 1. emit refuses: the same, exit 2.
- os.replace fails after the line landed: the temp file goes and a compensating `tuning` line follows with
  `voids: <id>`, `applied: []` and the same scores (score.py drops a voided line's applied and keeps its
  scores); exit 1. If that line fails too, stderr says tunings.jsonl claims a Tuning rollouts.toml lacks.
--dry-run prints the diff and the line it would write, and writes nothing.

On success stdout names the line's id and file, then one line per Tuning: `applied <key> <from> → <to> for
<repo>: takes effect at the next /thread:schedule (or --regenerate); a rollout note already stamped keeps its
own values`.

Exit codes: 0 applied, recorded, or not recorded for a null repo; 1 a write failed (nothing applied, or the
line voided); 2 refused (usage, scores, picks, identity, a stale from, a refused or unvalidated config);
3 no tomllib for a present config.
"""
from __future__ import annotations

import argparse
import datetime
import difflib
import importlib.util
import json
import os
import re
import secrets
import stat
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SHARED = os.path.join(os.path.dirname(os.path.dirname(HERE)), "_shared", "scripts")
TAKES_EFFECT = ("takes effect at the next /thread:schedule (or --regenerate); a rollout note already stamped "
                "keeps its own values")


def _load(name, path):
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError("no loader for %s" % path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


RR = _load("thread_run_record", os.path.join(SHARED, "run_record.py"))
RS = _load("thread_rollout_settings", os.path.join(SHARED, "rollout-settings.py"))


class Stop(Exception):
    def __init__(self, message, code):
        Exception.__init__(self, message)
        self.code = code


def say(line):
    sys.stderr.write("tune: %s\n" % line)


def new_id():
    now = datetime.datetime.now(datetime.timezone.utc)
    return "t-%s-%s" % (now.strftime("%Y%m%dT%H%M%SZ"), secrets.token_hex(3))


def read_scores(src):
    try:
        raw = sys.stdin.read() if src == "-" else open(os.path.expanduser(src), encoding="utf-8").read()
        doc = json.loads(raw)
    except (OSError, ValueError) as e:
        raise Stop("--scores %s cannot be read as JSON: %s" % (src, e), 2)
    if not isinstance(doc, dict) or not isinstance(doc.get("rollout"), str) or \
            not isinstance(doc.get("window"), dict) or not isinstance(doc.get("headline"), dict) or \
            not isinstance(doc.get("proposals"), list):
        raise Stop("--scores %s is not score.py's output (rollout, window, headline, proposals)" % src, 2)
    return doc


def line_fields(scores, applied, tid, voids=None):
    w = scores["window"]
    fields = {"id": tid, "repo": scores["repo"],
              "window": {k: w[k] for k in ("since", "until", "activeStart", "activeEnd", "partial") if k in w},
              "scores": {k: scores["headline"].get(k) for k in RR.SCORE_KEYS}, "applied": applied}
    binding = (scores.get("binding") or {}).get("constraint") if isinstance(scores.get("binding"), dict) else None
    if binding in RR.BINDINGS:
        fields["binding"] = binding
    if voids:
        fields["voids"] = voids
    return fields


def tunings_path():
    try:
        return os.path.join(RR.events_dir(), RR.TUNINGS + ".jsonl")
    except ValueError:
        return RR.TUNINGS + ".jsonl"


def emit(scores, fields):
    """True written; False a write failure; Stop(2) refused."""
    try:
        return RR.emit(scores["rollout"], "tuning", fields=fields, strict=True)
    except RR.Refused as e:
        raise Stop("the run record refused the line: %s" % e, 2)


# ---- the config edit ---------------------------------------------------------------------------------------

def _key_line_re(key):
    return re.compile(r"^(\s*(?:%s|\"%s\"|'%s')\s*=\s*)([^\s#]+)(.*)$" % (key, key, key))


def edit_text(text, slug, picks, doc):
    """The config text with each pick's key set to its `to` in [repo."<slug>"] (a Stop(2) for a form it won't edit)."""
    lines = text.split("\n") if text else []
    trailing = bool(lines) and lines[-1] == ""
    if trailing:
        lines = lines[:-1]
    repos = (doc or {}).get("repo") or {}
    written = next((k for k in repos if isinstance(k, str) and k.lower() == slug.lower()), None)
    table, header, end, last_key = (), None, None, None
    keys_at = {}
    for i, line in enumerate(lines):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = RS._AOT_RE.match(s) or RS._TABLE_RE.match(s)
        if m:
            table = RS._segments(m.group(1))
            if header is not None and end is None:
                end = i
            if len(table) == 2 and table[0] == "repo" and table[1].lower() == slug.lower():
                header = i
            continue
        m = RS._KEY_RE.match(s)
        if not m:
            continue
        segs = RS._segments(m.group(1))
        path = table + segs
        if path[0] != "repo":
            continue
        if header is not None and end is None and len(segs) == 1:
            last_key = i
            keys_at[segs[0]] = i
        elif len(path) == 1 or path[1].lower() == slug.lower():
            raise Stop("[repo.%s] is set in dotted or inline-table form in the config: edit it by hand"
                       % json.dumps(written or slug), 2)
    if written is not None and header is None:
        raise Stop("[repo.%s] is set in dotted or inline-table form in the config: edit it by hand"
                   % json.dumps(written), 2)
    if header is not None:
        inserts = []
        for p in picks:
            i = keys_at.get(p["key"])
            if i is None:
                inserts.append("%s = %d" % (p["key"], p["to"]))
                continue
            m = _key_line_re(p["key"]).match(lines[i])
            if not m:
                raise Stop("cannot read the %s line in [repo.%s] (line %d): edit it by hand"
                           % (p["key"], json.dumps(written or slug), i + 1), 2)
            lines[i] = m.group(1) + str(p["to"]) + m.group(3)
        if inserts:
            at = (last_key if last_key is not None else header) + 1
            lines[at:at] = inserts
    else:
        if lines and lines[-1].strip():
            lines.append("")
        lines.append("[repo.%s]" % json.dumps(slug))
        lines.extend("%s = %d" % (p["key"], p["to"]) for p in picks)
    return "\n".join(lines) + "\n"


class Created:
    """Directories made for the temp file, removed again (deepest first) when left empty by a failure."""

    def __init__(self, directory):
        self.made = []
        d = directory
        missing = []
        while d and not os.path.exists(d):
            missing.append(d)
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
        for d in reversed(missing):
            os.mkdir(d)
            self.made.append(d)

    def undo(self):
        for d in reversed(self.made):
            try:
                os.rmdir(d)
            except OSError:
                pass


def _unlink(path):
    try:
        os.unlink(path)
    except OSError:
        pass


# ---- the verbs ---------------------------------------------------------------------------------------------

def record_only(scores, dry_run):
    if scores.get("repo") is None:
        say("not recorded: the scores carry no repo (no GitHub origin), so no baseline is kept")
        return 0
    tid = new_id()
    fields = line_fields(scores, [], tid)
    if dry_run:
        print("would record %s in %s: %s" % (tid, tunings_path(), json.dumps(fields, ensure_ascii=False)))
        return 0
    if not emit(scores, fields):
        say("nothing recorded: the Retro's line could not be written (see run_record above)")
        return 1
    print("recorded %s in %s: no Tuning applied (a baseline for the next Retro on %s)"
          % (tid, tunings_path(), scores["repo"]))
    return 0


def pick(scores, picks_arg, repo, config, dry_run):
    ids = []
    for x in picks_arg.split(","):
        x = x.strip()
        if x and x not in ids:
            ids.append(x)
    if not ids:
        raise Stop("--pick names no proposal", 2)
    proposals = {p.get("id"): p for p in scores["proposals"] if isinstance(p, dict)}
    withheld = {p.get("id"): p for p in scores.get("withheld") or [] if isinstance(p, dict)}
    picks = []
    for i in ids:
        if i in withheld:
            raise Stop("%s is withheld (%s): it cannot be picked" % (i, withheld[i].get("reason")), 2)
        if i not in proposals:
            raise Stop("%s is no proposal in the scores (proposals: %s)" % (i, ", ".join(sorted(proposals)) or "none"), 2)
        picks.append(proposals[i])
    keys = [p.get("key") for p in picks]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if dup:
        raise Stop("two picks on one key (%s): pick one" % ", ".join(dup), 2)
    for p in picks:
        if p.get("key") not in RS.KEYS or not all(isinstance(p.get(k), int) for k in ("from", "to", "ranAt")):
            raise Stop("%s is not a well-formed proposal (key, from, to, ranAt)" % p.get("id"), 2)
    if repo is None:
        raise Stop("--pick needs --repo <dir> (the clone whose GitHub origin names the repo)", 2)
    repo = os.path.expanduser(repo)
    if not os.path.isdir(repo):
        raise Stop("--repo %s is not a directory" % repo, 2)
    if scores.get("repo") is None:
        raise Stop("the scores carry no repo: nothing can be tuned", 2)
    try:
        origin = RS._origin_slug(repo)
    except RS.SettingsError as e:
        raise Stop(str(e), 2)
    if origin is None:
        raise Stop("--repo %s has no GitHub origin (land.sh exit 4): nothing can be tuned" % repo, 2)
    if origin.lower() != scores["repo"].lower():
        raise Stop("--repo %s is %s, but the scores are for %s" % (repo, origin, scores["repo"]), 2)
    config = os.path.expanduser(config or RS.default_path())
    try:
        before = RS.resolve(repo=repo, path=config)
    except RS.SettingsError as e:
        raise Stop("rollout-settings: %s" % e, e.code)
    for p in picks:
        now = before["settings"][p["key"]]["value"]
        if now != p["from"]:
            raise Stop("%s's from is stale: %s is %d now, not %d (re-run the Retro's score)"
                       % (p["id"], p["key"], now, p["from"]), 2)
    real = os.path.realpath(config)
    try:
        text = open(real, encoding="utf-8").read() if os.path.exists(real) else ""
        read = RS._ladder().read_toml(config)
    except Exception as e:
        raise Stop("cannot read %s: %s" % (config, e), 2)
    new_text = edit_text(text, scores["repo"], picks, read[1] if read else None)
    created = Created(os.path.dirname(real))
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(real), prefix="." + os.path.basename(real) + ".", suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(new_text)
        mode = stat.S_IMODE(os.stat(real).st_mode) if os.path.exists(real) else 0o644
        os.chmod(tmp, mode)
        try:
            after = RS.resolve(repo=repo, path=tmp)
        except RS.SettingsError as e:
            raise Stop("the edit does not validate (%s): nothing written" % e, 2)
        picked = {p["key"]: p["to"] for p in picks}
        for k in RS.KEYS:
            want = {"value": picked[k], "source": "file:repo"} if k in picked else before["settings"][k]
            if after["settings"][k] != want:
                raise Stop("the edit resolves %s to %s, not %s: nothing written" % (k, after["settings"][k], want), 2)
        if after["guardrails"] != before["guardrails"]:
            raise Stop("the edit changes the Guardrails: nothing written", 2)
        tid = new_id()
        applied = [{"key": p["key"], "from": p["from"], "to": p["to"], "ranAt": p["ranAt"],
                    "rule": str(p.get("rule"))[:64], "evidence": str(p.get("evidence"))[:300],
                    "agreeing": p.get("agreeing") if isinstance(p.get("agreeing"), int) else 0} for p in picks]
        fields = line_fields(scores, applied, tid)
        if dry_run:
            diff = difflib.unified_diff(text.splitlines(True), new_text.splitlines(True), config, config + " (tuned)")
            sys.stdout.write("".join(diff))
            print("would record %s in %s: %s" % (tid, tunings_path(), json.dumps(fields, ensure_ascii=False)))
            _unlink(tmp)
            created.undo()
            return 0
        if not emit(scores, fields):
            raise Stop("nothing applied: the Retro's line could not be written (see run_record above); "
                       "rollouts.toml is unchanged", 1)
        try:
            os.replace(tmp, real)
        except OSError as e:
            _unlink(tmp)
            created.undo()
            vid = new_id()
            ok = False
            try:
                ok = RR.emit(scores["rollout"], "tuning", fields=line_fields(scores, [], vid, voids=tid))
            except Exception:
                ok = False
            if not ok:
                say("the void line could not be written either: tunings.jsonl claims %s applied, but "
                    "rollouts.toml lacks it" % tid)
            raise Stop("rollouts.toml was not written (%s): nothing applied%s" % (e, "; %s voided by %s" % (tid, vid)
                                                                                 if ok else ""), 1)
    except Stop:
        if tmp:
            _unlink(tmp)
        created.undo()
        raise
    except OSError as e:
        if tmp:
            _unlink(tmp)
        created.undo()
        raise Stop("cannot write next to %s: %s" % (real, e), 1)
    print("recorded %s in %s" % (tid, tunings_path()))
    for a in applied:
        print("applied %s %d → %d for %s: %s" % (a["key"], a["from"], a["to"], scores["repo"], TAKES_EFFECT))
    return 0


class Parser(argparse.ArgumentParser):
    def error(self, message):
        say(message)
        sys.exit(2)


def main(argv):
    p = Parser(prog="tune.py", description="Apply a Retro's picked Tunings to rollouts.toml and record the Retro.")
    p.add_argument("--scores", required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--pick")
    g.add_argument("--record-only", action="store_true")
    p.add_argument("--repo")
    p.add_argument("--config")
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args(argv)
    try:
        scores = read_scores(a.scores)
        if a.record_only:
            return record_only(scores, a.dry_run)
        return pick(scores, a.pick, a.repo, a.config, a.dry_run)
    except Stop as e:
        say(str(e))
        return e.code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
