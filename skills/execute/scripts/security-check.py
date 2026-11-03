#!/usr/bin/env python3
"""security-check.py — the opt-in Security check of a parallel rollout's task (execute § 3 `security_checks`).

Python stdlib only. Two verbs:

  security-check.py preflight
      gitleaks is found (find_gitleaks), `gitleaks version` is at least 8.19.0 (the release with the `git`
      subcommand) and `git --version` runs. Exit 0 prints {"gitleaks": <path>, "version": <v>}; exit 1 prints one
      `ERROR: security-check: <why>` line on stderr. No network call. `reconcile-rollout.py verify-timeout` runs it at
      every loop entry of a rollout with `security_checks: true` (its exit 5 otherwise).

  security-check.py scan --tree <wt> --base <ref> [--accepts-from <task note>] [--osv-url <base> | --no-advisories]
      The engine's code-writing agents run it once the verifier is green, before they open or update the PR, and the
      review judge runs it again. It reads the tree and the note only, and writes only its own
      tempfile.mkdtemp(prefix="thread-security-") directory, removed in a `finally`.
      1-4. Refusals, each exit 2 with one ERROR line and no stdout: --tree is not its own git toplevel; tracked
           changes are uncommitted ("commit them, then run the scan again"); --base does not resolve; no merge base.
      5.   The config watch: the root `.gitleaks.toml` and `.gitleaksignore` (and the relative in-repo `[extend] path`
           of the merge base's `.gitleaks.toml`). A committed change in <mb>..HEAD (root-level pathspecs only) or an
           uncommitted one on disk (untracked or gitignored bytes, a symlink, a directory) is `configTouched`.
      6-7. gitleaks runs over the task's own non-merge commits <mb>..HEAD in a scratch `--shared --no-checkout` clone
           that holds only the merge base's scanner config, so nothing the task leaves on disk silences it.
      8.   Secrets: rule, file, line and commit only (never the Secret or Match fields), with `pushed` read only when
           one is found: the local remote-tracking refs, then origin's live head for the branch.
      9.   Accepts: a `security-accept <kind>:<key>` token that Lachy's recorded answer in the note's `## Repair input`
           repeats from its own question (record-answer's entry shape).
      10.  Dependencies the diff adds or changes in package.json, requirements*.txt, pyproject.toml, go.mod and
           Cargo.toml; a fixture manifest is listed and never checked.
      11.  Advisories from OSV (querybatch, then one GET per hit); an unreachable OSV is `advisoriesChecked: false`,
           never a red.
      12.  The brief lines; 13. `action` (fix | human | null) and `why`.
      One JSON line on stdout; exit 0 clean (accepted items included), 1 red. Neither stdout nor stderr ever holds a
      secret value.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath

try:
    import tomllib
except ImportError:  # python < 3.11
    tomllib = None

MIN_GITLEAKS = (8, 19, 0)
GITLEAKS_FALLBACKS = ("/opt/homebrew/bin/gitleaks", "/usr/local/bin/gitleaks")
GITLEAKS_TIMEOUT = 300
GIT_TIMEOUT = 120
LS_REMOTE_TIMEOUT = 30
FETCH_TIMEOUT = 60
OSV_CALL_TIMEOUT = 10
OSV_TOTAL_BUDGET = 60
OSV_DEFAULT = "https://api.osv.dev"
MAX_DEPS = 200
CONFIG_PATHS = (".gitleaks.toml", ".gitleaksignore")
FIXTURE_PARTS = {"test", "tests", "__tests__", "testdata", "fixture", "fixtures", "__fixtures__"}
ACCEPT_KINDS = ("secret", "config", "advisory")
# git's own repo-local variables, when `git rev-parse --local-env-vars` cannot say (git 2.47's list).
LOCAL_ENV_FALLBACK = (
    "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT",
    "GIT_OBJECT_DIRECTORY", "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE", "GIT_PREFIX", "GIT_INTERNAL_SUPER_PREFIX",
    "GIT_SHALLOW_FILE", "GIT_COMMON_DIR",
)

# record-answer's `## Repair input` entry (reconcile-rollout.py cmd_record_answer's `body`, ANY_ENTRY_RE):
#   - <stamp> <needs you|decision> (block <fp>[; key]): "<ask>" → <answer>
# The ask is the question verbatim, so it is split from the answer at the LAST ASK_SPLIT. tests/contracts/
# security-check.test.mjs (`entry-shape`) pins this pair against reconcile-rollout.py's writer.
ENTRY_RE = re.compile(r'^- (\S+) (needs you|decision) \(block ([0-9a-f]{12}|-)((?:;[^)]*)?)\): "')
ASK_SPLIT = '" → '
REPAIR_INPUT = "## Repair input"
TOKEN_RE = re.compile(rf"security-accept ({'|'.join(ACCEPT_KINDS)}):([0-9a-f]{{12}})")


class Refusal(Exception):
    """A scan that cannot run: exit 2 with its one ERROR line."""


# ---- environment and subprocesses ---------------------------------------------------------------------------------

_SCRUBBED = None


def _scrubbed_env():
    """The inherited env without git's repo-local variables (its own list, else LOCAL_ENV_FALLBACK, and every
    GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n) and without any GITLEAKS_* variable, with GIT_TERMINAL_PROMPT=0: every git
    and gitleaks subprocess gets it, so an exported GIT_DIR or GITLEAKS_CONFIG never steers the scan."""
    global _SCRUBBED
    if _SCRUBBED is not None:
        return dict(_SCRUBBED)
    names = set(LOCAL_ENV_FALLBACK)
    try:
        base = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        r = subprocess.run(["git", "rev-parse", "--local-env-vars"], capture_output=True, text=True, env=base,
                           timeout=GIT_TIMEOUT)
        if r.returncode == 0:
            names |= {n.strip() for n in r.stdout.split() if n.strip()}
    except (OSError, subprocess.SubprocessError):
        pass
    env = {}
    for k, v in os.environ.items():
        if k in names or k.startswith("GITLEAKS_") or re.match(r"GIT_CONFIG_(KEY|VALUE)_\d+$", k):
            continue
        env[k] = v
    env["GIT_TERMINAL_PROMPT"] = "0"
    _SCRUBBED = env
    return dict(env)


def _git(tree, *args, timeout=GIT_TIMEOUT, check=True, text=True):
    """`git -C <tree> <args>` under the scrubbed env: (rc, stdout, stderr); a failure with check is a Refusal."""
    try:
        r = subprocess.run(["git", "-C", str(tree), *args], capture_output=True, text=text, env=_scrubbed_env(),
                           timeout=timeout)
    except subprocess.TimeoutExpired:
        if check:
            raise Refusal(f"git {args[0]} timed out after {timeout} s")
        return 124, "" if text else b"", "timed out"
    except OSError as e:
        raise Refusal(f"git not runnable: {e}")
    if check and r.returncode != 0:
        err = (r.stderr if text else r.stderr.decode("utf8", "replace")).strip().splitlines()
        raise Refusal(f"git {' '.join(args[:2])} failed (exit {r.returncode}){': ' + err[0] if err else ''}")
    return r.returncode, r.stdout, r.stderr


def find_gitleaks():
    """(path, None) or (None, why). THREAD_GITLEAKS, when set, is the only candidate (a non-executable value is an
    error, never a fallback); else PATH, then /opt/homebrew/bin, then /usr/local/bin (a non-login shell may not carry
    Homebrew on PATH)."""
    pinned = os.environ.get("THREAD_GITLEAKS")
    if pinned:
        if os.path.isfile(pinned) and os.access(pinned, os.X_OK):
            return pinned, None
        return None, f"THREAD_GITLEAKS={pinned} is not an executable file"
    found = shutil.which("gitleaks")
    if found:
        return found, None
    for cand in GITLEAKS_FALLBACKS:
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand, None
    return None, "gitleaks not found (on PATH, /opt/homebrew/bin or /usr/local/bin): install it (brew install gitleaks)"


def _version_tuple(text):
    m = re.search(r"v?(\d+)\.(\d+)\.(\d+)", text or "")
    return tuple(int(x) for x in m.groups()) if m else None


def cmd_preflight(_args):
    def fail(why):
        print(f"ERROR: security-check: {why}", file=sys.stderr)
        return 1

    path, why = find_gitleaks()
    if why:
        return fail(why)
    try:
        r = subprocess.run([path, "version"], capture_output=True, text=True, env=_scrubbed_env(), timeout=30)
    except (OSError, subprocess.SubprocessError) as e:
        return fail(f"{path} version did not run: {e}")
    ver = _version_tuple(r.stdout) or _version_tuple(r.stderr)
    if r.returncode != 0 or ver is None:
        return fail(f"{path} version gave no version (exit {r.returncode})")
    if ver < MIN_GITLEAKS:
        return fail(f"gitleaks {'.'.join(map(str, ver))} at {path} is older than "
                    f"{'.'.join(map(str, MIN_GITLEAKS))} (the release with the `git` subcommand): upgrade it")
    try:
        g = subprocess.run(["git", "--version"], capture_output=True, text=True, env=_scrubbed_env(), timeout=30)
    except (OSError, subprocess.SubprocessError) as e:
        return fail(f"git not runnable: {e}")
    if g.returncode != 0:
        return fail(f"git --version exited {g.returncode}")
    print(json.dumps({"gitleaks": path, "version": ".".join(map(str, ver))}))
    return 0


# ---- accept keys ----------------------------------------------------------------------------------------------------

def _key(*fields):
    return hashlib.sha256("\0".join(str(f) for f in fields).encode("utf8")).hexdigest()[:12]


def secret_accept(commit, file, rule, line):
    return f"secret:{_key('secret', commit, file, rule, line)}"


def config_accept(path, cause, content):
    return f"config:{_key('config', path, cause, content)}"


def advisory_accept(osv_id, ecosystem, name, version):
    return f"advisory:{_key('advisory', osv_id, ecosystem, name, version)}"


def token(accept):
    return f"security-accept {accept}"


# ---- the accepts (step 9) -------------------------------------------------------------------------------------------

def read_accepts(note_path):
    """({accept: stamp}, why|None): the tokens Lachy's recorded answers honour. Only the note's `## Repair input`,
    record-answer's lines only (ENTRY_RE), split at the LAST ASK_SPLIT; a `superseded` key never counts, a live or
    `handed back` one does; a token counts only when the answer holds it AND the same entry's ask (the question,
    verbatim) named it. An unreadable note is no accepts and a why; a note with no section is no accepts, no why."""
    try:
        text = Path(note_path).read_text(encoding="utf8")
    except (OSError, UnicodeDecodeError) as e:
        return {}, f"{type(e).__name__}: {e.strerror if isinstance(e, OSError) and e.strerror else e}"
    out, capturing = {}, False
    for raw in text.split("\n"):
        line = raw.strip()
        if raw.rstrip() == REPAIR_INPUT:
            capturing = True
            continue
        if capturing and raw.startswith("## "):
            break
        if not capturing:
            continue
        m = ENTRY_RE.match(line)
        if not m or "superseded" in m.group(4):
            continue
        rest = line[m.end():]
        at = rest.rfind(ASK_SPLIT)
        if at < 0:
            continue
        ask, answer = rest[:at], rest[at + len(ASK_SPLIT):]
        asked = {f"{k}:{h}" for k, h in TOKEN_RE.findall(ask)}
        for k, h in TOKEN_RE.findall(answer):
            acc = f"{k}:{h}"
            if acc in asked and acc not in out:
                out[acc] = m.group(1)
    return out, None


# ---- dependencies (step 10) -----------------------------------------------------------------------------------------

def _is_fixture(manifest):
    return any(part.lower() in FIXTURE_PARTS for part in PurePosixPath(manifest).parent.parts)


VERSION_RE = re.compile(r"v?(\d+(?:\.\d+)*(?:-[0-9A-Za-z.]+)?)")
UNVERSIONED_RE = re.compile(r"^\s*$|^\*$|^latest$|^x$|://|^git[+:@]|^github:|^file:|^link:|^workspace:|^npm:|^path:"
                            r"|\.git$|^[\w.-]+/[\w.-]+(#.*)?$", re.I)


def floor_of(spec):
    """The floor version a spec names (`^1.2.3` → 1.2.3, `>=1.2` → 1.2, `1.2` → 1.2), or None when it is
    unversioned (a URL, `*`, a git spec, a path, no version, or only an upper bound)."""
    if spec is None:
        return None
    s = str(spec).strip()
    if UNVERSIONED_RE.search(s):
        return None
    for part in re.split(r"\s*(?:,|\|\||\s)\s*", s):
        part = part.strip()
        if not part:
            continue
        op = re.match(r"^(===|==|>=|~=|\^|~>|~|=|>|<=|<|!=)?\s*", part)
        sign = op.group(1) or ""
        if sign in ("<", "<=", "!="):
            continue
        m = VERSION_RE.match(part[op.end():])
        if m:
            return m.group(1)
    return None


def _floor(eco, spec):
    """floor_of, except that a go.mod version keeps its leading `v` as go.mod writes it (query_version drops it)."""
    if eco == "Go":
        m = re.match(r"^v\d+(?:\.\d+)*\S*$", str(spec or "").strip())
        return m.group(0) if m else None
    return floor_of(spec)


def _pep503(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def _norm_name(ecosystem, name):
    return _pep503(name) if ecosystem == "PyPI" else name


REQ_NAME = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$")


def _pep508(line):
    """(name, spec) of one PEP 508 requirement (extras and environment markers stripped), or None."""
    line = line.split(";", 1)[0].strip()
    if not line:
        return None
    m = REQ_NAME.match(line)
    if not m:
        return None
    spec = m.group(3).strip()
    if spec.startswith("@"):
        spec = spec[1:].strip()   # a direct reference: unversioned
        return m.group(1), "url:" + spec
    spec = spec.strip("()").strip()
    return m.group(1), spec


def parse_requirements(text):
    deps = {}
    for raw in text.splitlines():
        line = raw.split(" #", 1)[0].strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        got = _pep508(line)
        if got and got[0] not in deps:
            deps[got[0]] = got[1]
    return deps


def parse_package_json(text):
    data = json.loads(text)
    deps = {}
    if not isinstance(data, dict):
        return deps
    for sect in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
        block = data.get(sect)
        if isinstance(block, dict):
            for name, spec in block.items():
                if isinstance(name, str) and name not in deps:
                    deps[name] = spec if isinstance(spec, str) else ""
    return deps


def _toml_spec(v):
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        if isinstance(v.get("version"), str):
            return v["version"]
        return ""
    return ""


def parse_pyproject(text):
    data = tomllib.loads(text)
    deps = {}
    project = data.get("project") if isinstance(data.get("project"), dict) else {}
    lists = [project.get("dependencies") or []]
    opt = project.get("optional-dependencies")
    if isinstance(opt, dict):
        lists.extend(v for v in opt.values())
    for lst in lists:
        if not isinstance(lst, list):
            continue
        for item in lst:
            got = _pep508(item) if isinstance(item, str) else None
            if got and got[0] not in deps:
                deps[got[0]] = got[1]
    poetry = ((data.get("tool") or {}).get("poetry") or {}) if isinstance(data.get("tool"), dict) else {}
    tables = [poetry.get("dependencies"), poetry.get("dev-dependencies")]
    groups = poetry.get("group")
    if isinstance(groups, dict):
        tables.extend((g or {}).get("dependencies") for g in groups.values() if isinstance(g, dict))
    for table in tables:
        if not isinstance(table, dict):
            continue
        for name, v in table.items():
            if name.lower() == "python" or name in deps:
                continue
            deps[name] = _toml_spec(v)
    return deps


def parse_cargo(text):
    data = tomllib.loads(text)
    deps = {}
    for sect in ("dependencies", "dev-dependencies", "build-dependencies"):
        table = data.get(sect)
        if isinstance(table, dict):
            for name, v in table.items():
                if name not in deps:
                    deps[name] = _toml_spec(v)
    return deps


def parse_go_mod(text):
    deps, block = {}, False
    for raw in text.splitlines():
        line = raw.split("//", 1)[0].strip()
        if not line:
            continue
        if block:
            if line == ")":
                block = False
                continue
            parts = line.split()
        elif line.startswith("require"):
            rest = line[len("require"):].strip()
            if rest.startswith("("):
                block = True
                continue
            parts = rest.split()
        else:
            continue
        if len(parts) >= 2 and parts[0] not in deps:
            deps[parts[0]] = parts[1]
    return deps


MANIFESTS = (
    # (basename matcher, ecosystem, parser, needs tomllib)
    (lambda b: b == "package.json", "npm", parse_package_json, False),
    (lambda b: re.fullmatch(r"requirements.*\.txt", b) is not None, "PyPI", parse_requirements, False),
    (lambda b: b == "pyproject.toml", "PyPI", parse_pyproject, True),
    (lambda b: b == "go.mod", "Go", parse_go_mod, False),
    (lambda b: b == "Cargo.toml", "crates.io", parse_cargo, True),
)


def _manifest_kind(path):
    base = PurePosixPath(path).name
    for match, eco, parser, toml in MANIFESTS:
        if match(base):
            return eco, parser, toml
    return None


def _show(tree, rev, path):
    rc, out, _err = _git(tree, "show", f"{rev}:{path}", check=False, text=False)
    return out.decode("utf8", "replace") if rc == 0 else None


def dependencies(tree, mb, head, brief_tail):
    """The new or changed dependencies, one dict each, in manifest then name order."""
    _rc, out, _err = _git(tree, "diff", "--name-only", "--no-renames", "-z", mb, head)
    touched = sorted(p for p in out.split("\0") if p and _manifest_kind(p))
    deps = []
    for manifest in touched:
        eco, parser, needs_toml = _manifest_kind(manifest)
        if needs_toml and tomllib is None:
            brief_tail.append(f"{manifest} not read: TOML needs tomllib (python >= 3.11)")
            continue
        new_text = _show(tree, head, manifest)
        if new_text is None:
            continue   # deleted: nothing new
        try:
            new = parser(new_text)
        except Exception as e:  # a malformed manifest is named, never fatal
            brief_tail.append(f"{manifest} not read: {type(e).__name__}")
            continue
        old_text = _show(tree, mb, manifest)
        try:
            old = parser(old_text) if old_text is not None else {}
        except Exception:
            old = {}
        old_by = {_norm_name(eco, n): s for n, s in old.items()}
        fixture = _is_fixture(manifest)
        for name in sorted(new, key=lambda n: _norm_name(eco, n)):
            norm = _norm_name(eco, name)
            ver = _floor(eco, new[name])
            if norm in old_by:
                was = _floor(eco, old_by[norm])
                if was == ver:
                    continue
                changed = was or "unversioned"
            else:
                changed = None
            deps.append({"ecosystem": eco, "name": name, "norm": norm, "version": ver, "manifest": manifest,
                         "fixture": fixture, "changedFrom": changed})
    if len(deps) > MAX_DEPS:
        brief_tail.append(f"{len(deps) - MAX_DEPS} more dependencies not listed or checked")
        deps = deps[:MAX_DEPS]
    return deps


# ---- advisories (step 11) -------------------------------------------------------------------------------------------

SEMVER_ECOS = ("npm", "Go", "crates.io")


def query_version(eco, version):
    v = version[1:] if eco == "Go" and version.startswith("v") else version
    if eco in SEMVER_ECOS:
        core, sep, pre = v.partition("-")
        parts = core.split(".")
        while len(parts) < 3:
            parts.append("0")
        v = ".".join(parts) + (sep + pre if sep else "")
    return v


def _cmp_key(v):
    """A generic numeric dotted comparator's key, or None when `v` has no numeric dotted lead."""
    m = re.match(r"^v?(\d+(?:\.\d+)*)(.*)$", str(v or "").strip())
    if not m:
        return None
    nums = [int(x) for x in m.group(1).split(".")]
    while len(nums) < 4:
        nums.append(0)
    rest = m.group(2)
    pre = bool(rest) and not rest.startswith("+") and not re.match(r"^\.?post", rest)
    return (tuple(nums), 0 if pre else 1, rest)


def fixed_versions(vuln, eco, norm, version):
    """The `fixed` events of the ECOSYSTEM and SEMVER ranges (a GIT range is skipped whole) of the package's affected
    entries that contain the queried version; every such event when the version cannot be compared."""
    q = _cmp_key(version)
    out = []
    for aff in vuln.get("affected") or []:
        pkg = aff.get("package") or {}
        if pkg.get("ecosystem") != eco or _norm_name(eco, str(pkg.get("name", ""))) != norm:
            continue
        for rng in aff.get("ranges") or []:
            if rng.get("type") not in ("ECOSYSTEM", "SEMVER"):
                continue
            intro = None
            for ev in rng.get("events") or []:
                if "introduced" in ev:
                    intro = ev["introduced"]
                elif "fixed" in ev:
                    fx = str(ev["fixed"])
                    if q is None:
                        out.append(fx)
                    else:
                        lo = None if intro in (None, "0") else _cmp_key(intro)
                        hi = _cmp_key(fx)
                        from_start = intro in (None, "0")
                        if hi is not None and (from_start or (lo is not None and lo <= q)) and q < hi:
                            out.append(fx)
                    intro = None
                elif "last_affected" in ev or "limit" in ev:
                    intro = None
    uniq = sorted(set(out), key=lambda v: (_cmp_key(v) is None, _cmp_key(v) or (), v))
    return uniq


class OSV:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.deadline = time.monotonic() + OSV_TOTAL_BUDGET
        self.cache = {}

    def _call(self, path, body=None):
        left = self.deadline - time.monotonic()
        if left <= 0:
            raise TimeoutError(f"the {OSV_TOTAL_BUDGET} s budget ran out")
        data = json.dumps(body).encode("utf8") if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method="POST" if data else "GET",
                                     headers={"Content-Type": "application/json", "User-Agent": "thread-security-check"})
        with urllib.request.urlopen(req, timeout=min(OSV_CALL_TIMEOUT, left)) as r:
            return json.loads(r.read().decode("utf8"))

    def batch(self, queries):
        res = self._call("/v1/querybatch", {"queries": queries})
        results = res.get("results") if isinstance(res, dict) else None
        if not isinstance(results, list) or len(results) != len(queries):
            raise ValueError("querybatch returned no matching results list")
        return [[v.get("id") for v in (r or {}).get("vulns") or [] if isinstance(v, dict) and v.get("id")]
                for r in results]

    def vuln(self, osv_id):
        if osv_id not in self.cache:
            got = self._call("/v1/vulns/" + urllib.request.quote(osv_id, safe=""))
            if not isinstance(got, dict):
                raise ValueError(f"vulns/{osv_id} is not an object")
            self.cache[osv_id] = got
        return self.cache[osv_id]


def advisories(deps, osv_url, brief_tail):
    """(advisories, checked): every advisory OSV holds for a versioned, non-fixture dependency's queried version."""
    checkable = [d for d in deps if d["version"] and not d["fixture"]]
    if not checkable:
        return [], osv_url is not None
    if osv_url is None:
        brief_tail.append("advisories not checked: --no-advisories")
        return [], False
    osv = OSV(osv_url)
    out = []
    try:
        queries = []
        for d in checkable:
            d["queried"] = query_version(d["ecosystem"], d["version"])
            queries.append({"package": {"name": d["norm"], "ecosystem": d["ecosystem"]}, "version": d["queried"]})
        hits = osv.batch(queries)
        for d, ids in zip(checkable, hits):
            for osv_id in ids:
                fixed = fixed_versions(osv.vuln(osv_id), d["ecosystem"], d["norm"], d["queried"])
                if d["ecosystem"] == "Go":
                    fixed = [f if f.startswith("v") else "v" + f for f in fixed]
                adv = {"id": osv_id, "ecosystem": d["ecosystem"], "name": d["name"], "version": d["version"],
                       "queried": d["queried"], "manifest": d["manifest"], "fixed": fixed,
                       "accept": advisory_accept(osv_id, d["ecosystem"], d["norm"], d["queried"])}
                d.setdefault("advisories", []).append(adv)
                out.append(adv)
    except urllib.error.HTTPError as e:
        brief_tail.append(f"advisories not checked: OSV answered HTTP {e.code}")
        return [], False
    except (urllib.error.URLError, OSError, TimeoutError, ValueError, json.JSONDecodeError) as e:
        why = getattr(e, "reason", None) or e
        brief_tail.append(f"advisories not checked: {type(e).__name__}: {why}")
        for d in checkable:
            d.pop("advisories", None)
        return [], False
    return out, True


# ---- the scan -------------------------------------------------------------------------------------------------------

def _rev(tree, rev):
    rc, out, _err = _git(tree, "rev-parse", "-q", "--verify", f"{rev}", check=False)
    return out.strip() if rc == 0 else None


def watched_paths(tree, mb):
    """The root `.gitleaks.toml` and `.gitleaksignore`, plus the merge base's `.gitleaks.toml` relative in-repo
    `[extend] path` when tomllib can read it (an absolute one is read as-is, outside the watch)."""
    paths = list(CONFIG_PATHS)
    text = _show(tree, mb, ".gitleaks.toml")
    if text is not None and tomllib is not None:
        try:
            ext = (tomllib.loads(text).get("extend") or {}).get("path")
        except Exception:
            ext = None
        if isinstance(ext, str) and ext and not os.path.isabs(ext):
            norm = os.path.normpath(ext).replace(os.sep, "/")
            if not norm.startswith("../") and norm not in (".", "..") and norm not in paths:
                paths.append(norm)
    return paths


def _disk_id(tree, path):
    """The on-disk content id of a watched path: None when absent, else `symlink:<target>`, `directory` or the
    git hash-object --no-filters of its bytes."""
    full = os.path.join(tree, path)
    if os.path.islink(full):
        return f"symlink:{os.readlink(full)}"
    if os.path.isdir(full):
        return "directory"
    if not os.path.exists(full):
        return None
    _rc, out, _err = _git(tree, "hash-object", "--no-filters", "--", full)
    return out.strip()


def _blob(tree, rev, path):
    rc, out, _err = _git(tree, "rev-parse", "-q", "--verify", f"{rev}:{path}", check=False)
    return out.strip() if rc == 0 else None


def disk_drift(tree, mb, head, paths, committed):
    """Rule (b): a watched path whose on-disk bytes differ from what is committed (the merge base's blob, or HEAD's
    when rule (a) already names the path, so one committed change is never counted twice). A regular file is read
    directly, whether gitignored or untracked; a symlink or a directory always counts. Absent at both is equal."""
    out = []
    for p in paths:
        want = _blob(tree, head if p in committed else mb, p)
        have = _disk_id(tree, p)
        if have is None and want is None:
            continue
        if have is not None and (have.startswith("symlink:") or have == "directory"):
            out.append((p, have))
        elif have != want:
            out.append((p, have or "absent"))
    return out


def config_watch(tree, mb, head):
    paths = watched_paths(tree, mb)
    committed = []
    for p in paths:
        _rc, out, _err = _git(tree, "diff", "--name-only", "--no-renames", mb, head, "--", f":(top,literal){p}")
        if out.strip():
            committed.append(p)
    touched = []
    for p in committed:
        content = _blob(tree, head, p) or "deleted"
        touched.append({"path": p, "cause": "committed", "accept": config_accept(p, "committed", content)})
    drift = disk_drift(tree, mb, head, paths, committed)  # the disk comparison
    for p, content in drift:
        touched.append({"path": p, "cause": "uncommitted", "accept": config_accept(p, "uncommitted", content)})
    touched.sort(key=lambda t: (t["path"], t["cause"]))
    return paths, touched


def scratch_clone(tree, mb, paths, tmp):
    scan = os.path.join(tmp, "scan")
    _git(tree, "clone", "-q", "--shared", "--no-checkout", str(tree), scan)
    for p in paths:
        rc, out, _err = _git(tree, "show", f"{mb}:{p}", check=False, text=False)
        if rc != 0:
            continue
        dest = os.path.join(scan, p)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as fh:
            fh.write(out)
    return scan


def run_gitleaks(gitleaks, scan, mb, head, tmp):
    report = os.path.join(tmp, "report.json")
    argv = [gitleaks, "git", scan, f"--log-opts=--no-merges {mb}..{head}", "--redact", "--ignore-gitleaks-allow",
            "--no-banner", "--report-format", "json", "--report-path", report, "--exit-code", "0",
            "--log-level", "error"]
    cfg = os.path.join(scan, ".gitleaks.toml")
    if os.path.isfile(cfg):
        argv += ["--config", cfg]
    try:
        r = subprocess.run(argv, cwd=scan, capture_output=True, text=True, env=_scrubbed_env(), timeout=GITLEAKS_TIMEOUT)
    except subprocess.TimeoutExpired:
        raise Refusal(f"gitleaks timed out after {GITLEAKS_TIMEOUT} s")
    except OSError as e:
        raise Refusal(f"gitleaks not runnable: {e}")
    if r.returncode != 0:
        raise Refusal(f"gitleaks exited {r.returncode}")
    try:
        with open(report, encoding="utf8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as e:
        raise Refusal(f"gitleaks report not readable: {type(e).__name__}")
    if not isinstance(data, list):
        raise Refusal("gitleaks report is not a list")
    found = []
    for f in data:
        if not isinstance(f, dict):
            continue
        # RuleID, File, StartLine and Commit only: the Secret and Match fields are never read.
        rule, file, line, commit = f.get("RuleID"), f.get("File"), f.get("StartLine"), f.get("Commit")
        if not isinstance(rule, str) or not isinstance(file, str) or not isinstance(commit, str):
            continue
        key = (commit, file, rule, line)
        if key not in [(s["commit"], s["file"], s["rule"], s["line"]) for s in found]:
            found.append({"rule": rule, "file": file, "line": line, "commit": commit})
    return found


class Pushed:
    """Whether a commit is on origin, read once per scan: the local remote-tracking refs, then origin's live head
    for the tree's branch (ls-remote; a head not held locally is fetched into the scratch clone only)."""

    def __init__(self, tree, scan):
        self.tree, self.scan = tree, scan
        self.live, self.why, self.read = None, None, False

    def _origin_head(self):
        if self.read:
            return
        self.read = True
        rc, out, _err = _git(self.tree, "symbolic-ref", "-q", "--short", "HEAD", check=False)
        branch = out.strip()
        if rc != 0 or not branch:
            self.why = "HEAD is detached, so no branch names origin's head"
            return
        rc, out, _err = _git(self.tree, "ls-remote", "--exit-code", "origin", f"refs/heads/{branch}",
                             timeout=LS_REMOTE_TIMEOUT, check=False)
        if rc == 2:
            self.live = ""   # origin has no such branch: nothing is pushed there
            return
        if rc != 0 or not out.strip():
            self.why = f"git ls-remote origin exited {rc}"
            return
        head = out.split()[0]
        if not _rev(self.scan, f"{head}^{{commit}}"):
            _rc, url, _err = _git(self.tree, "remote", "get-url", "origin", check=False)
            rc, _out, _err = _git(self.scan, "fetch", "--quiet", "--no-tags", url.strip(), f"refs/heads/{branch}",
                                  timeout=FETCH_TIMEOUT, check=False)
            if rc != 0 or not _rev(self.scan, f"{head}^{{commit}}"):
                self.why = f"origin's head {head[:7]} could not be fetched (git fetch exited {rc})"
                return
        self.live = head

    def of(self, commit):
        """(True | False | None, why|None)."""
        _rc, out, _err = _git(self.tree, "branch", "-r", "--contains", commit, check=False)
        if out.strip():
            return True, None
        self._origin_head()
        if self.live is None:
            return None, self.why
        if self.live == "":
            return False, None
        rc, _out, _err = _git(self.scan, "merge-base", "--is-ancestor", commit, self.live, check=False)
        return rc == 0, None


def _sha7(s):
    return str(s)[:7]


def scan(args):
    tree = os.path.realpath(args.tree)
    rc, top, _err = _git(tree, "rev-parse", "--show-toplevel", check=False) if os.path.isdir(tree) else (1, "", "")
    if rc != 0 or os.path.realpath(top.strip()) != tree:
        raise Refusal(f"--tree {args.tree} is not its own git toplevel")
    _rc, dirty, _err = _git(tree, "status", "--porcelain", "--untracked-files=no")
    if dirty.strip():
        raise Refusal("tracked changes are uncommitted in --tree: commit them, then run the scan again")
    base = _rev(tree, f"{args.base}^{{commit}}")
    if not base:
        raise Refusal(f"--base {args.base} does not resolve to a commit in --tree")
    head = _rev(tree, "HEAD^{commit}")
    if not head:
        raise Refusal("--tree has no HEAD commit")
    rc, mb, _err = _git(tree, "merge-base", head, base, check=False)
    mb = mb.strip()
    if rc != 0 or not mb:
        raise Refusal(f"no merge base between HEAD and {args.base}")

    gitleaks, why = find_gitleaks()
    if why:
        raise Refusal(why)
    brief_tail = []
    accepts, why = ({}, None) if not args.accepts_from else read_accepts(args.accepts_from)
    if why:
        brief_tail.append(f"accepts not read: {why}")

    tmp = tempfile.mkdtemp(prefix="thread-security-")
    try:
        paths, config = config_watch(tree, mb, head)
        scan_dir = scratch_clone(tree, mb, paths, tmp)
        found = run_gitleaks(gitleaks, scan_dir, mb, head, tmp)
        accepted = []

        def take(accept, detail):
            if accept in accepts:
                accepted.append({"token": accept, "detail": detail, "stamp": accepts[accept]})
                return True
            return False

        secrets = []
        if found:
            pushed = Pushed(tree, scan_dir)
            for s in found:
                s["accept"] = secret_accept(s["commit"], s["file"], s["rule"], s["line"])
                if take(s["accept"], f"secret {s['rule']} in {s['file']}, commit {_sha7(s['commit'])}, line {s['line']}"):
                    continue
                s["pushed"], why = pushed.of(s["commit"])
                if s["pushed"] is None:
                    s["pushedWhy"] = why
                secrets.append({k: s[k] for k in ("rule", "file", "line", "commit", "pushed", "pushedWhy", "accept")
                                if k in s})
        rewrite_from, merge_behind = None, False
        if secrets:
            _rc, order, _err = _git(tree, "rev-list", "--reverse", "--topo-order", f"{mb}..{head}")
            order = order.split()
            at = {c: i for i, c in enumerate(order)}
            secrets.sort(key=lambda s: (at.get(s["commit"], len(order)), s["file"], s["line"] or 0))
            first = secrets[0]["commit"]
            rewrite_from = _rev(tree, f"{first}^")
            _rc, merges, _err = _git(tree, "rev-list", "--merges", f"{first}^..{head}", check=False)
            merge_behind = bool(merges.strip())
        config = [c for c in config if not take(c["accept"], f"config {c['path']} ({c['cause']})")]

        deps = dependencies(tree, mb, head, brief_tail)
        osv_url = None if args.no_advisories else (args.osv_url or os.environ.get("THREAD_OSV_URL") or OSV_DEFAULT)
        advs, checked = advisories(deps, osv_url, brief_tail)
        open_advs = [a for a in advs
                     if not take(a["accept"], f"advisory {a['id']} on {a['ecosystem']} {a['name']} {a['version']}")]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    action, why = None, None
    def ask(text):
        nonlocal action, why
        action = "human"
        if why is None:
            why = text

    def where(s):
        return f"A secret ({s['rule']}) in {s['file']}, commit {_sha7(s['commit'])}, line {s['line']}"

    tail = "or have /thread:repair recut the branch?"
    if config:
        names = ", ".join(dict.fromkeys(c["path"] for c in config))
        toks = " and ".join(f"`{token(c['accept'])}`" for c in config)
        ask(f"This change creates, edits or leaves an uncommitted {names}, the secret scanner's own config: keep it "
            f"(answer {toks}), or drop the change?")
    for s in secrets:
        if s["pushed"] is True:
            ask(f"{where(s)}, is already on origin: once it is rotated, keep it in the history (answer "
                f"`{token(s['accept'])}`), {tail}")
    for s in secrets:
        if s["pushed"] is None:
            ask(f"{where(s)}, was found, and origin could not be read to say whether it is pushed ({s['pushedWhy']}): "
                f"once it is rotated, keep it in the history (answer `{token(s['accept'])}`), {tail}")
    if secrets and merge_behind:
        s = secrets[0]
        ask(f"{where(s)}, sits at or before a merge commit, so the task cannot rewrite it: once it is rotated, keep it "
            f"in the history (answer `{token(s['accept'])}`), {tail}")
    for a in open_advs:
        if not a["fixed"]:
            ask(f"{a['ecosystem']} {a['name']} {a['version']} has advisory {a['id']} with no fixed release: keep it "
                f"(answer `{token(a['accept'])}`), name another package, or drop the need?")
    if action is None and (secrets or open_advs):
        action = "fix"

    brief = []
    for d in deps:
        line = f"{d['ecosystem']} {d['name']} {d['version'] or 'unversioned'} ({d['manifest']}"
        line += "; fixture, not checked)" if d["fixture"] else ")"
        if d["changedFrom"]:
            line += f"; changed from {d['changedFrom']}"
        for a in d.get("advisories") or []:
            line += (f"; advisory {a['id']}, fixed in {', '.join(a['fixed'])}" if a["fixed"]
                     else f"; advisory {a['id']}, no fixed release")
        brief.append(line)
    for acc in accepted:
        brief.append(f"accepted {acc['token']}: {acc['detail']} (Repair input {acc['stamp']})")
    brief.extend(brief_tail)

    out = {
        "result": "red" if action else "clean", "action": action, "why": why, "base": mb, "head": head,
        "secrets": secrets, "rewriteFrom": rewrite_from, "mergeBehind": merge_behind, "configTouched": config,
        "dependencies": [{k: d[k] for k in ("ecosystem", "name", "version", "manifest", "fixture", "changedFrom")}
                         for d in deps],
        "advisories": [{k: a[k] for k in ("id", "ecosystem", "name", "version", "manifest", "fixed", "accept")}
                       for a in open_advs],
        "advisoriesChecked": checked, "accepted": accepted, "brief": brief,
    }
    print(json.dumps(out))
    return 1 if action else 0


def cmd_scan(args):
    try:
        return scan(args)
    except Refusal as e:
        print(f"ERROR: security-check: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # a defect here is never a red: exit 2, naming only its type and place
        tb = e.__traceback__
        while tb is not None and tb.tb_next is not None:
            tb = tb.tb_next
        print(f"ERROR: security-check: internal error {type(e).__name__} at line {tb.tb_lineno if tb else '?'}",
              file=sys.stderr)
        return 2


def main(argv=None):
    p = argparse.ArgumentParser(prog="security-check.py", description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="verb", required=True)
    sub.add_parser("preflight").set_defaults(func=cmd_preflight)
    s = sub.add_parser("scan")
    s.add_argument("--tree", required=True)
    s.add_argument("--base", required=True)
    s.add_argument("--accepts-from", dest="accepts_from")
    g = s.add_mutually_exclusive_group()
    g.add_argument("--osv-url", dest="osv_url")
    g.add_argument("--no-advisories", dest="no_advisories", action="store_true")
    s.set_defaults(func=cmd_scan)
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
