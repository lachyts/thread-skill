#!/usr/bin/env python3
"""Fake `gh` (2.43.1 behaviour) for tests/merge-task-*.test.sh. Logs every argv as one line to
$MT_STATE/gh.log and serves only the calls merge-task.sh makes, from files under $MT_STATE. $MT_SRV is a
real bare repo standing in for GitHub's copy of origin: a squash merge is a real commit there, `commits/<oid>`
reads its parents from it, and the script's own `git fetch` / `git ls-remote` hit it directly (no fake).

Fidelity guards (rc 99): -q/--jq/--template on `pr view`, `pr list`, `pr create`, `repo view` or the api graphql,
git/ref, compare and commits reads (merge-task and lead-integrate.py revert read whole objects); a non-numeric PR arg on
`pr view|checks|merge`; `pr create` without --head, --base, --title and --body-file, or with a body file that is
missing; `pr list` without --head, --state and --json.

State (a missing file takes the default in brackets):
  default                 the default branch [master]          repo view; err.repo: its text, rc 1
  pr/<N>/<field>          state baseRefName headRefOid headRefName mergeStateStatus reviewDecision [""] url;
                          autoMergeRequest (present ⇒ set, else null); mergeCommit (an oid, else null).
                          No pr/<N> dir ⇒ GraphQL "Could not resolve to a PullRequest", rc 1.
  pr/<N>/<field>.seq      one value per `pr view`, the last one sticky.
  pr/<N>/headRefOid.live  present ⇒ headRefOid reads srv's refs/heads/<headRefName> live, as GitHub's PR head follows
                          its branch (`pr create` writes it).
  pr/<N>/lag              N more pr views read OPEN with mergeCommit null after a merge (from merge.lag).
  pr/<N>/mergeCommit.lag  N more MERGED pr views read mergeCommit null.
  err.prview              its text on stderr, rc 1, for every pr view.
  mq                      true/false; absent ⇒ the "doesn't exist on type" schema error; err.graphql: transient.
  base.seq                git/ref/heads/<default> values, one per read, the last sticky (absent ⇒ 404);
                          base.cur records the last one served. err.ref: transient.
  compare [ahead]         compare/A...B status. err.compare: "HTTP 404" in it ⇒ the 404 form, else transient.
  err.commits             transient error for commits/<oid> (unknown oid ⇒ the 404 form).
  branch                  branches/<b>, merge-task's required-gate read 1 (ADR 0069 d1; <b> must be one path segment that
                          unquotes to the default branch, else rc 99). Absent ⇒ protected with a required `ci` check;
                          `unprotected` ⇒ lachyts/chorus's live shape (private, free plan: protected false, enforcement
                          off); `ruleset` ⇒ lachyts/thread-skill's (protected true by a ruleset, classic protection off);
                          `nochecks` ⇒ Animately/optimizer's develop (protected, enforcement everyone, `contexts: []`,
                          `checks: []`); `noflag` ⇒ 200 with no `protected`; `404-notfound` ⇒ the Not Found form;
                          `404-branch` ⇒ "Branch not found"; `403-integration` ⇒ "Resource not accessible by
                          integration"; `403-rate` ⇒ the primary rate limit. err.branch: its text, rc 1, on every read.
  rules                   rules/branches/<b>, read 2 (the same segment check). Absent ⇒ []; a JSON array literal ⇒
                          served as-is; `403-plan` ⇒ chorus's live "Upgrade to GitHub Pro" text; `403-rate` ⇒ the
                          secondary rate limit; `404` ⇒ the Not Found form. err.rules: its text, rc 1, on every read.
  inflight [0]            actions/runs (the whole object; -q is rc 99): that many unfinished runs, ids 9000 on.
  runs                    a JSON list served as workflow_runs instead of inflight's.
  runs.seq                JSON lines, each a list served as workflow_runs, one per read, the last sticky; read before
                          runs and inflight. err.runs: its text, rc 1, on every actions/runs list read.
  runjobs.<id>            actions/runs/<id>/jobs, served as written (absent ⇒ the 404 form).
  checks.seq              JSON lines {"rc","out","err","sleep"} popped per `pr checks --watch`, the last
                          sticky; absent ⇒ rc 0 with one passing row. Each popped entry is kept as checks.cur.
                          Its out is printed before its sleep, as gh prints its first table, then err after.
                          A `pr checks` without --watch prints checks.cur's out with its rc (no stderr): the
                          checks as they stand. `pr checks --json` is gh 2.43.1's "unknown flag: --json", rc 1,
                          unless checks.json is present (a newer gh): with -q it prints `links`; without -q (merge-task's
                          conclusion read, ADR 0073 d4) a JSON array of checks.cur's table rows, each {name, bucket (the
                          row's 2nd cell: pass | fail | cancel | pending | skipping), link (its 4th)} with the --json
                          fields asked for.
  links, steps            the infra-classify reads; `run rerun` is logged, rc 0 (rerun.fail present: rc 1). `run view
                          <id>` with -q serves steps.<id> when that file exists (an empty one: a run with no failed
                          step), else steps; without -q (the whole --json object: merge-task's job conclusion read,
                          `--json jobs`, and lead-integrate.py ci-headroom's, `--json jobs,workflowName`) it serves
                          run.<id>.json, else jobs.<id>, else an "HTTP 404" error, rc 1.
  run.<id>.json           lead-integrate.py ci-headroom's read (ADR 0073 d5): the whole run object (its jobs,
                          workflowName), served first by a `run view <id>` with no -q.
                          run.<id>.err: its text on stderr, rc 1, nothing printed, for that `run view <id> --json`.
                          Any `run view --json` field outside gh 2.43.1's RUN_VIEW_FIELDS is its
                          `Unknown JSON field: "<f>"` and field list on stderr, rc 1, before anything is served.
  checkruns.<sha>         commits/<sha>/check-runs (merge-task's probe and merge-settings.py's rename gate, ADR 0080): a
                          JSON object {total_count, check_runs: [{name, status, conclusion, app: {id}}]}, or a bare list
                          (total_count its length). checkruns.<sha>.seq: JSON lines, one per read, the last sticky,
                          read first. Absent ⇒ the 404 form. A `check_name=` query keeps only the runs of that exact
                          name, total_count recomputed. err.checkruns: its text, rc 1 (a 5xx: transient).
  statuses.<sha>          commits/<sha>/status: {total_count, statuses: [{context, state}]}, or a bare list. Absent ⇒
                          GitHub's answer for a commit with no status, 200 and an empty list. err.status: its text, rc 1.
  repo.json               repos/o/r (merge-settings.py's ownership read). Absent ⇒ {owner {login o, type User},
                          default_branch <default>, permissions {admin true}}. err.repo-api: its text, rc 1.
  user                    the viewer's login for `api user` [o].
  orgrole.<org>           user/memberships/orgs/<org>: `admin` or `member` (state active); absent ⇒ the 404 form.
  runners, runners.<org>  repos/o/r/actions/runners and orgs/<org>/actions/runners (merge-settings.py check's runner
                          read): a JSON list of runner objects {name, status, busy, labels: [{name}]}, served as
                          {total_count, runners}; absent ⇒ none registered. err.runners: its text, rc 1, on both.
  rsc.json                branches/<b>/protection/required_status_checks, stored in the write's body form {strict,
                          checks: [{context, app_id}]}; GET serves {url, strict, contexts, contexts_url, checks} with a
                          stored app_id -1 read back as null; absent ⇒ the 404 form. A PATCH (--input -) rewrites it:
                          a body with both `contexts` and `checks`, or a check whose app_id is null, is GitHub's 422.
                          While it exists, branches/<b> reports its checks, and `pr checks --required` drops the rows
                          of any check it does not require.
  rulesets/<id>.json      rulesets/<id>: the whole ruleset object; a PUT replaces its `rules` whole. A rule whose
                          `parameters` is null, or any `parameters` key on deletion, non_fast_forward,
                          required_linear_history, required_signatures or creation, is GitHub's 422. While the dir
                          exists and `rules` does not, rules/branches/<b> lists each ruleset's rules with its
                          ruleset_id (ruleset_source_type its `source_type`, Repository by default).
  write.err               its text, rc 1, nothing changed, on every write of rsc.json or a ruleset (a 403).
  err.<route>             a 5xx-like text, rc 1, on that route's reads: err.rsc, err.rulesets, err.user.
  writes.log              every non-GET api call outside graphql (its method, endpoint and body, one line), the
                          merge-task DELETE of the head branch included (still rc 0). A method is read from --method X,
                          --method=X, -X X or -XX; a call that carries -f, -F, --field, --raw-field or --input and no
                          method is a POST, as gh's.
  merge.push <sha>        before anything else in a merge: headRefOid := sha, srv head branch := sha.
  merge.refuse <text>     its text, rc 1, nothing changed.   merge.neterr: a network error, rc 1.
  merge.queue             rc 0, autoMergeRequest set, stays OPEN.   merge.noop: rc 0, nothing changed.
  merge.nosrv             the squash commit is made but srv's default branch is not moved.
  merge.lag <N>           see pr/<N>/lag.   merge.hook <sh>: run after a successful squash.
  squash-parent           the squash commit's parent [base.cur, else srv's default branch].
  squash.tree             the squash commit's tree: `head` (the PR head's tree) or a 40-hex tree [the empty tree].
  daemon <secs>           the next gh call (any) leaves a child behind, as git's daemonize does for an auto gc: its own
                          session, fds 0-2 on /dev/null, every other fd it inherited kept; it sleeps <secs>. Its pid is
                          written to daemon.pid, for the test to stop.

Opt-in verbs for lead-integrate.py revert (no existing suite calls them):
  pr create [-R o/r] --head <br> --base <b> --title <t> --body-file <f>
                          PR max(100, the highest number + 1): OPEN, CLEAN, its head live on srv's <br> (which must
                          exist), title and body kept; prints its URL. An OPEN PR on <br> already: GitHub's
                          "already exists" text, rc 1.
  pr list [-R o/r] --head <br> --state open|merged|closed|all --json <fields>
                          a JSON array of the PRs on <br> in that state, newest first; mergeCommit {oid} or null.
  disable.fail            `pr merge --disable-auto` fails.
"""
import json
import os
import subprocess
import sys
import time
from urllib.parse import unquote

args = sys.argv[1:]
ST = os.environ["MT_STATE"]
SRV = os.environ["MT_SRV"]
with open(os.path.join(ST, "gh.log"), "a") as fh:
    fh.write(" ".join(args) + "\n")


def p(*a):
    return os.path.join(ST, *a)


def rd(path, default=None):
    try:
        with open(path) as fh:
            return fh.read().rstrip("\n")
    except FileNotFoundError:
        return default


def wr(path, value):
    with open(path, "w") as fh:
        fh.write(value + "\n")


def rm(path):
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


def has(name):
    return os.path.exists(p(name))


def die(msg, out=None, rc=1):
    if out is not None:
        print(out)
    sys.stderr.write(msg + "\n")
    sys.exit(rc)


def git(*a, inp=None):
    return subprocess.run(["git", "-c", "user.name=fake-gh", "-c", "user.email=f@f", "--git-dir", SRV, *a],
                          capture_output=True, text=True, input=inp)


def not_found():
    die("gh: Not Found (HTTP 404)",
        out=json.dumps({"message": "Not Found", "documentation_url": "https://docs.github.com/rest", "status": "404"}))


def pop(path):
    lines = (rd(path, "") or "").split("\n")
    if len(lines) > 1:
        wr(path, "\n".join(lines[1:]))
    return lines[0]


def peek(path):
    return (rd(path, "") or "").split("\n")[0]


if has("daemon"):
    secs = float(rd(p("daemon")) or 0)
    rm(p("daemon"))
    child = os.fork()
    if child == 0:
        os.setsid()
        null = os.open(os.devnull, os.O_RDWR)
        for fd in (0, 1, 2):
            os.dup2(null, fd)
        time.sleep(secs)
        os._exit(0)
    wr(p("daemon.pid"), str(child))


def guard_jq(call):
    if any(a in args for a in ("-q", "--jq", "--template", "-t")):
        die("fake gh: unexpected --jq on " + call, rc=99)


def guard_num():
    if len(args) < 3 or not args[2].isdigit():
        die("fake gh: PR arg must be a number", rc=99)


DEFAULT = rd(p("default"), "master")
FIELDS = ["state", "baseRefName", "headRefOid", "headRefName", "mergeStateStatus", "reviewDecision", "url",
          "autoMergeRequest", "mergeCommit"]


def cur(d, name):  # the current value without popping a seq
    seq = os.path.join(d, name + ".seq")
    if os.path.exists(seq):
        return peek(seq)
    return rd(os.path.join(d, name), "")


def head_of(d):
    """A PR's head: srv's branch, live, when pr/<N>/headRefOid.live is present; else its stored value."""
    if os.path.exists(os.path.join(d, "headRefOid.live")):
        r = git("rev-parse", "--verify", "-q", "refs/heads/" + cur(d, "headRefName"))
        return r.stdout.strip()
    return cur(d, "headRefOid")


def pr_dirs():
    base = p("pr")
    return sorted((int(n) for n in os.listdir(base) if n.isdigit()), reverse=True) if os.path.isdir(base) else []


def opt(name):
    return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else None


def current_base():
    return rd(p("base.cur")) or (peek(p("base.seq")) if has("base.seq") else "") or \
        git("rev-parse", "refs/heads/" + DEFAULT).stdout.strip()


# ---- repo view ------------------------------------------------------------------------------------------
if args[:2] == ["repo", "view"]:
    guard_jq("repo view")
    if has("err.repo"):
        die(rd(p("err.repo")))
    print(json.dumps({"defaultBranchRef": {"name": DEFAULT}}))
    sys.exit(0)

# ---- pr view --------------------------------------------------------------------------------------------
if args[:2] == ["pr", "view"]:
    guard_jq("pr view")
    guard_num()
    n = args[2]
    d = p("pr", n)
    if has("err.prview"):
        die(rd(p("err.prview")))
    if not os.path.isdir(d):
        die("GraphQL: Could not resolve to a PullRequest with the number of %s. (repository.pullRequest)" % n)
    want = args[args.index("--json") + 1].split(",") if "--json" in args else FIELDS
    vals = {}
    for f in FIELDS:
        seq = os.path.join(d, f + ".seq")
        vals[f] = pop(seq) if (f in want and os.path.exists(seq)) else rd(os.path.join(d, f), "")
    if os.path.exists(os.path.join(d, "headRefOid.live")):
        vals["headRefOid"] = head_of(d)
    lag = int(rd(os.path.join(d, "lag"), "0") or "0")
    if vals["state"] == "MERGED" and lag > 0:
        wr(os.path.join(d, "lag"), str(lag - 1))
        vals["state"], vals["mergeCommit"] = "OPEN", ""
    mcl = int(rd(os.path.join(d, "mergeCommit.lag"), "0") or "0")
    if vals["state"] == "MERGED" and mcl > 0:
        wr(os.path.join(d, "mergeCommit.lag"), str(mcl - 1))
        vals["mergeCommit"] = ""
    out = {}
    for f in want:
        v = vals.get(f, "")
        if f == "autoMergeRequest":
            out[f] = {"enabledAt": "2026-10-01T00:00:00Z", "mergeMethod": "SQUASH"} if os.path.exists(
                os.path.join(d, f)) else None
        elif f == "mergeCommit":
            out[f] = {"oid": v} if v else None
        else:
            out[f] = v
    print(json.dumps(out))
    sys.exit(0)

# ---- pr create / pr list (lead-integrate.py revert) ------------------------------------------------------
if args[:2] == ["pr", "create"]:
    guard_jq("pr create")
    head, base, title, body_file = opt("--head"), opt("--base"), opt("--title"), opt("--body-file")
    if not (head and base and title and body_file) or not os.path.isfile(body_file):
        die("fake gh: pr create needs --head, --base, --title and an existing --body-file", rc=99)
    for n in pr_dirs():
        d = p("pr", str(n))
        if cur(d, "headRefName") == head and cur(d, "state") == "OPEN":
            die('a pull request for branch "%s" into branch "%s" already exists:\nhttps://github.com/o/r/pull/%d'
                % (head, base, n))
    sha = git("rev-parse", "--verify", "-q", "refs/heads/" + head).stdout.strip()
    if not sha:
        die("pull request create failed: GraphQL: Head sha can't be blank, Head ref must be a branch (createPullRequest)")
    n = max([99] + pr_dirs()) + 1
    d = p("pr", str(n))
    os.makedirs(d)
    for f, v in (("state", "OPEN"), ("baseRefName", base), ("headRefName", head), ("headRefOid", sha),
                 ("headRefOid.live", "1"), ("mergeStateStatus", "CLEAN"), ("url", "https://github.com/o/r/pull/%d" % n),
                 ("title", title), ("body", rd(body_file, ""))):
        wr(os.path.join(d, f), v)
    print("https://github.com/o/r/pull/%d" % n)
    sys.exit(0)
if args[:2] == ["pr", "list"]:
    guard_jq("pr list")
    head, state, fields = opt("--head"), (opt("--state") or "").lower(), opt("--json")
    if not head or state not in ("open", "merged", "closed", "all") or not fields:
        die("fake gh: pr list needs --head, --state and --json", rc=99)
    out = []
    for n in pr_dirs():
        d = p("pr", str(n))
        if cur(d, "headRefName") != head or (state != "all" and cur(d, "state") != state.upper()):
            continue
        row = {}
        for f in fields.split(","):
            if f == "number":
                row[f] = n
            elif f == "mergeCommit":
                v = cur(d, "mergeCommit")
                row[f] = {"oid": v} if v else None
            elif f == "headRefOid":
                row[f] = head_of(d)
            else:
                row[f] = cur(d, f)
        out.append(row)
    print(json.dumps(out))
    sys.exit(0)

def required_names():
    """The contexts rsc.json and the rulesets require, or None when neither is stored (no filtering)."""
    names, any_ = set(), False
    if has("rsc.json"):
        any_ = True
        names |= {c.get("context") for c in json.loads(rd(p("rsc.json"))).get("checks") or []}
    if os.path.isdir(p("rulesets")):
        any_ = True
        for f in os.listdir(p("rulesets")):
            if f.endswith(".json"):
                for r in json.loads(rd(p("rulesets", f))).get("rules") or []:
                    if r.get("type") == "required_status_checks":
                        names |= {c.get("context") for c in (r.get("parameters") or {}).get("required_status_checks") or []}
    return names if any_ else None


def keep_required(table):
    names = required_names()
    if names is None or not table:
        return table
    out = [l for l in table.split("\n") if len(l.split("\t")) < 2 or l.split("\t")[0] in names]
    return "\n".join(out)


# ---- pr checks ------------------------------------------------------------------------------------------
if args[:2] == ["pr", "checks"]:
    guard_num()
    if "--json" in args:  # the failed-required-links and conclusion reads: gh 2.43.1 has no --json on pr checks
        if not has("checks.json"):
            die("unknown flag: --json\n\nUsage:  gh pr checks [<number> | <url> | <branch>] [flags]\n")
        if "-q" in args or "--jq" in args:
            print(rd(p("links"), ""))
            sys.exit(0)
        table = json.loads(rd(p("checks.cur"))).get("out", "") if has("checks.cur") else ""
        fields = opt("--json").split(",")
        rows = []
        for line in table.split("\n"):
            cells = line.split("\t")
            if len(cells) < 2:
                continue
            full = {"name": cells[0], "bucket": cells[1], "link": cells[3] if len(cells) > 3 else ""}
            rows.append({f: full.get(f, "") for f in fields})
        print(json.dumps(rows))
        sys.exit(0)
    e = {"rc": 0, "out": "ci\tpass\t1s\thttps://github.com/o/r/actions/runs/1/job/1\t\n", "err": ""}
    if "--watch" not in args:  # a one-shot read: the checks as they stand, the last watch's result
        if has("checks.cur"):
            e = json.loads(rd(p("checks.cur")))
        sys.stdout.write(keep_required(e.get("out", "")))
        sys.exit(int(e.get("rc", 0)))
    if has("checks.seq"):
        e = json.loads(pop(p("checks.seq")))
        wr(p("checks.cur"), json.dumps(e))
    # gh prints its first table before it waits for the next refresh, so a watch cut mid-sleep has written its rows.
    sys.stdout.write(keep_required(e.get("out", "")))
    sys.stdout.flush()
    if e.get("sleep"):
        time.sleep(float(e["sleep"]))
    sys.stderr.write(e.get("err", ""))
    sys.exit(int(e.get("rc", 0)))

# ---- run view / run rerun -------------------------------------------------------------------------------
# gh 2.43.1's `run view --json` fields (`gh run view --json` with none lists them): it refuses any other, `attempt`
# included, with rc 1 before any API call.
RUN_VIEW_FIELDS = ("conclusion", "createdAt", "databaseId", "displayTitle", "event", "headBranch", "headSha", "jobs",
                   "name", "number", "startedAt", "status", "updatedAt", "url", "workflowDatabaseId", "workflowName")
if args[:2] == ["run", "view"]:
    rid = args[2] if len(args) > 2 else ""
    if "--json" in args:
        i = args.index("--json")
        for f in (args[i + 1] if i + 1 < len(args) else "").split(","):
            if f.strip() not in RUN_VIEW_FIELDS:
                die('Unknown JSON field: "%s"\nAvailable fields:\n' % f.strip()
                    + "\n".join("  " + x for x in RUN_VIEW_FIELDS))
        if rid and has("run.%s.err" % rid):
            die(rd(p("run.%s.err" % rid), ""))
    if "-q" not in args and "--jq" not in args:  # the whole --json object: run.<id>.json, else jobs.<id>, else a 404
        for own in ("run.%s.json" % rid, "jobs.%s" % rid):
            if rid and has(own):
                print(rd(p(own)))
                sys.exit(0)
        not_found()
    own = "steps.%s" % rid if rid else ""
    print(rd(p(own) if own and has(own) else p("steps"), ""))
    sys.exit(0)
if args[:2] == ["run", "rerun"]:
    if has("rerun.fail"):
        die("HTTP 403: This workflow run cannot be rerun (https://api.github.com/repos/o/r/actions/runs/%s/rerun-failed-jobs)"
            % (args[2] if len(args) > 2 else ""))
    sys.exit(0)

# ---- pr merge -------------------------------------------------------------------------------------------
if args[:2] == ["pr", "merge"]:
    guard_num()
    n = args[2]
    d = p("pr", n)
    if not os.path.isdir(d):
        die("GraphQL: Could not resolve to a PullRequest with the number of %s. (repository.pullRequest)" % n)
    if "--disable-auto" in args:
        if has("disable.fail"):
            die("GraphQL: Could not disable auto-merge (disablePullRequestAutoMerge)")
        rm(os.path.join(d, "autoMergeRequest"))
        sys.exit(0)
    if has("merge.push"):
        sha = rd(p("merge.push"))
        rm(p("merge.push"))
        rm(os.path.join(d, "headRefOid.seq"))
        wr(os.path.join(d, "headRefOid"), sha)
        git("update-ref", "refs/heads/" + cur(d, "headRefName"), sha)
    state, mss, head = cur(d, "state"), cur(d, "mergeStateStatus"), head_of(d)
    admin = "--admin" in args
    if state == "MERGED":
        die("! Pull request #%s was already merged" % n, rc=0)
    if mss == "BLOCKED" and not admin:
        die("X Pull request #%s is not mergeable: the base branch policy prohibits the merge." % n)
    if mss == "BEHIND" and not admin:
        die("X Pull request #%s is not mergeable: the head branch is not up to date with the base branch." % n)
    if mss == "DIRTY":
        die("X Pull request #%s is not mergeable: the merge commit cannot be cleanly created." % n)
    if "--match-head-commit" in args and args[args.index("--match-head-commit") + 1] != head:
        die("GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)")
    if has("merge.refuse"):
        die(rd(p("merge.refuse")))
    if has("merge.neterr"):
        die("error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com")
    if has("merge.queue"):
        wr(os.path.join(d, "autoMergeRequest"), "set")
        sys.exit(0)
    if has("merge.noop"):
        sys.exit(0)
    parent = rd(p("squash-parent")) or current_base()
    tree = git("mktree", inp="").stdout.strip()
    want_tree = rd(p("squash.tree"))
    if want_tree == "head":
        tree = git("rev-parse", head + "^{tree}").stdout.strip()
    elif want_tree:
        tree = want_tree
    r = git("commit-tree", tree, "-p", parent, "-m", "squash #" + n)
    if r.returncode != 0:
        die("fake gh: squash failed: " + r.stderr.strip(), rc=99)
    m = r.stdout.strip()
    if not has("merge.nosrv"):
        git("update-ref", "refs/heads/" + DEFAULT, m)
    for f in ("state", "mergeCommit"):
        rm(os.path.join(d, f + ".seq"))
    wr(os.path.join(d, "state"), "MERGED")
    wr(os.path.join(d, "mergeCommit"), m)
    wr(p("base.seq"), m)
    wr(p("base.cur"), m)
    if has("merge.lag"):
        wr(os.path.join(d, "lag"), rd(p("merge.lag")))
    if has("merge.hook"):
        subprocess.run(["sh", "-c", rd(p("merge.hook"))])
    print("✓ Squashed and merged pull request #%s" % n)
    sys.exit(0)

# ---- api ------------------------------------------------------------------------------------------------
if args[:1] == ["api"]:
    takes_value = {"--method", "-X", "-f", "-F", "--field", "--raw-field", "-H", "--header", "-q", "--jq",
                   "-t", "--template", "--input"}
    endpoint, i = None, 1
    while i < len(args):
        if args[i] in takes_value:
            i += 2
            continue
        if not args[i].startswith("-"):
            endpoint = args[i]
            break
        i += 1
    method = None
    for k, a in enumerate(args):
        if a in ("--method", "-X") and k + 1 < len(args):
            method = args[k + 1].upper()
            break
        if a.startswith("--method="):
            method = a.split("=", 1)[1].upper()
            break
        if a.startswith("-X") and len(a) > 2:
            method = a[2:].upper()
            break
    if method is None:
        fielded = any(a in ("-f", "-F", "--field", "--raw-field", "--input") or
                      a.startswith(("--field=", "--raw-field=", "--input=")) for a in args)
        method = "POST" if fielded else "GET"
    if endpoint == "graphql":
        guard_jq("api graphql")
        if has("err.graphql"):
            die(rd(p("err.graphql")))
        if not has("mq"):
            die("GraphQL: Field 'isMergeQueueEnabled' doesn't exist on type 'PullRequest' (Field 'isMergeQueueEnabled' doesn't exist on type 'PullRequest')")
        mq = rd(p("mq")) == "true"
        print(json.dumps({"data": {"repository": {"pullRequest": {"isMergeQueueEnabled": mq}}}}))
        sys.exit(0)
    path_only, _, query = (endpoint or "").partition("?")
    parts = path_only.split("/")
    body = None
    if method != "GET":
        if "--input" in args and args[args.index("--input") + 1] == "-":
            body = sys.stdin.read()
        with open(p("writes.log"), "a") as fh:
            fh.write("%s %s %s\n" % (method, endpoint, (body or "").replace("\n", " ")))
    if method == "DELETE":
        sys.exit(0)

    def serve_list(name, key, filt=None):
        """A JSON object {total_count, <key>} from <name>.seq (popped) or <name>; a bare list is wrapped."""
        raw = pop(p(name + ".seq")) if has(name + ".seq") else rd(p(name))
        d = json.loads(raw)
        if isinstance(d, list):
            d = {"total_count": len(d), key: d}
        if filt is not None:
            d[key] = [x for x in d.get(key) or [] if filt(x)]
            d["total_count"] = len(d[key])
        print(json.dumps(d))
        sys.exit(0)

    def gh_out(d):
        print(json.dumps(d))
        sys.exit(0)

    def unprocessable(msg):
        die("gh: %s (HTTP 422)" % msg, out=json.dumps({"message": msg, "status": "422"}))

    def rsc_get():
        d = json.loads(rd(p("rsc.json")))
        checks = [{"context": c.get("context"), "app_id": None if c.get("app_id") in (None, -1) else c.get("app_id")}
                  for c in d.get("checks") or []]
        return {"url": "https://api.github.com/" + path_only, "strict": d.get("strict"),
                "contexts": [c["context"] for c in checks], "contexts_url": "https://api.github.com/x", "checks": checks}

    PARAMLESS = ("deletion", "non_fast_forward", "required_linear_history", "required_signatures", "creation")
    # merge-settings.py's routes (ADR 0080): ahead of the generic commits and branches routes.
    if path_only == "user":
        if has("err.user"):
            die(rd(p("err.user")))
        gh_out({"login": rd(p("user"), "o")})
    if len(parts) == 4 and parts[:3] == ["user", "memberships", "orgs"]:
        role = rd(p("orgrole." + parts[3]))
        if role is None:
            not_found()
        gh_out({"state": "active", "role": role, "organization": {"login": parts[3]}})
    if (len(parts) == 5 and parts[0] == "repos" or len(parts) == 4 and parts[0] == "orgs") and parts[-2:] == ["actions", "runners"]:
        if has("err.runners"):
            die(rd(p("err.runners")))
        name = "runners" if parts[0] == "repos" else "runners." + parts[1]
        runners = json.loads(rd(p(name))) if has(name) else []
        gh_out({"total_count": len(runners), "runners": runners})
    if len(parts) == 3 and parts[0] == "repos":
        if has("err.repo-api"):
            die(rd(p("err.repo-api")))
        gh_out(json.loads(rd(p("repo.json"))) if has("repo.json") else {
            "owner": {"login": parts[1], "type": "User"}, "default_branch": DEFAULT, "permissions": {"admin": True}})
    if len(parts) == 7 and parts[3] == "branches" and parts[5:] == ["protection", "required_status_checks"]:
        if unquote(parts[4]) != DEFAULT:
            die("fake gh: the branch must be one percent-encoded segment naming %s, got %s" % (DEFAULT, parts[4]), rc=99)
        if method == "GET":
            if has("err.rsc"):
                die(rd(p("err.rsc")))
            if not has("rsc.json"):
                die("gh: Required status checks not enabled (HTTP 404)", out=json.dumps({"message": "Required status checks not enabled"}))
            gh_out(rsc_get())
        if method != "PATCH":
            die("fake gh: %s on required_status_checks" % method, rc=99)
        if has("write.err"):
            die(rd(p("write.err")))
        if not has("rsc.json"):
            not_found()
        new = json.loads(body or "{}")
        if "contexts" in new and "checks" in new:
            unprocessable("Invalid request. Only one of contexts or checks may be given.")
        if any(c.get("app_id", 0) is None for c in new.get("checks") or []):
            unprocessable("Invalid request. For 'properties/app_id', nil is not an integer.")
        cur_ = json.loads(rd(p("rsc.json")))
        if "strict" in new:
            cur_["strict"] = new["strict"]
        if "checks" in new:
            cur_["checks"] = new["checks"]
        wr(p("rsc.json"), json.dumps(cur_))
        gh_out(rsc_get())
    if len(parts) == 5 and parts[3] == "rulesets":
        f = p("rulesets", parts[4] + ".json")
        if method == "GET":
            if has("err.rulesets"):
                die(rd(p("err.rulesets")))
            if not os.path.exists(f):
                not_found()
            gh_out(json.loads(rd(f)))
        if method != "PUT":
            die("fake gh: %s on rulesets" % method, rc=99)
        if has("write.err"):
            die(rd(p("write.err")))
        if not os.path.exists(f):
            not_found()
        new = json.loads(body or "{}")
        for r in new.get("rules") or []:
            if "parameters" in r and r["parameters"] is None:
                unprocessable("Invalid property /rules/0/parameters: data cannot be null.")
            if "parameters" in r and r.get("type") in PARAMLESS:
                unprocessable("Invalid property /rules: %s takes no parameters." % r.get("type"))
        rs = json.loads(rd(f))
        if "rules" in new:
            rs["rules"] = new["rules"]
        wr(f, json.dumps(rs))
        gh_out(rs)
    if len(parts) == 6 and parts[3] == "commits" and parts[5] == "check-runs":
        guard_jq("api commits/<sha>/check-runs")
        if has("err.checkruns"):
            die(rd(p("err.checkruns")))
        if not has("checkruns." + parts[4]) and not has("checkruns." + parts[4] + ".seq"):
            not_found()
        want_name = next((unquote(q.split("=", 1)[1]) for q in query.split("&") if q.startswith("check_name=")), None)
        serve_list("checkruns." + parts[4], "check_runs",
                   (lambda r: r.get("name") == want_name) if want_name is not None else None)
    if len(parts) == 6 and parts[3] == "commits" and parts[5] == "status":
        guard_jq("api commits/<sha>/status")
        if has("err.status"):
            die(rd(p("err.status")))
        if not has("statuses." + parts[4]):
            gh_out({"state": "pending", "total_count": 0, "statuses": []})
        serve_list("statuses." + parts[4], "statuses")
    if len(parts) >= 6 and parts[3:5] == ["git", "ref"]:
        guard_jq("api git/ref")
        if has("err.ref"):
            die(rd(p("err.ref")))
        if not has("base.seq"):
            not_found()
        sha = pop(p("base.seq"))
        wr(p("base.cur"), sha)
        print(json.dumps({"ref": "refs/" + "/".join(parts[5:]), "object": {"sha": sha, "type": "commit"}}))
        sys.exit(0)
    if len(parts) >= 5 and parts[3] == "compare":
        guard_jq("api compare")
        if has("err.compare"):
            if "HTTP 404" in rd(p("err.compare")):
                not_found()
            die(rd(p("err.compare")))
        print(json.dumps({"status": rd(p("compare"), "ahead")}))
        sys.exit(0)
    if len(parts) == 5 and parts[3] == "commits":
        guard_jq("api commits")
        if has("err.commits"):
            die(rd(p("err.commits")))
        r = git("rev-list", "--parents", "-n", "1", parts[4])
        if r.returncode != 0 or not r.stdout.strip():
            not_found()
        shas = r.stdout.split()
        print(json.dumps({"sha": shas[0], "parents": [{"sha": s} for s in shas[1:]]}))
        sys.exit(0)
    if len(parts) == 7 and parts[3:5] == ["actions", "runs"] and parts[6] == "jobs":
        guard_jq("api actions/runs/<id>/jobs")
        if not has("runjobs." + parts[5]):
            not_found()
        print(rd(p("runjobs." + parts[5])))
        sys.exit(0)
    if len(parts) >= 5 and parts[3:5] == ["actions", "runs"]:
        guard_jq("api actions/runs")
        if has("err.runs"):
            die(rd(p("err.runs")))
        if has("runs.seq"):
            runs = json.loads(pop(p("runs.seq")))
            print(json.dumps({"total_count": len(runs), "workflow_runs": runs}))
            sys.exit(0)
        runs = json.loads(rd(p("runs"))) if has("runs") else [
            {"id": 9000 + i, "status": "in_progress"} for i in range(int(rd(p("inflight"), "0")))]
        print(json.dumps({"total_count": len(runs), "workflow_runs": runs}))
        sys.exit(0)
    if len(parts) >= 5 and (parts[3] == "branches" or parts[3:5] == ["rules", "branches"]):
        # merge-task's required-gate reads (ADR 0069 d1): whole objects, the branch one percent-encoded segment.
        rules = parts[3] == "rules"
        seg = parts[5:] if rules else parts[4:]
        guard_jq("api " + ("rules/branches" if rules else "branches"))
        if len(seg) != 1 or unquote(seg[0]) != DEFAULT:
            die("fake gh: the branch must be one percent-encoded segment naming %s, got %s" % (DEFAULT, "/".join(seg)),
                rc=99)
        if not rules:
            if has("err.branch"):
                die(rd(p("err.branch")))
            mode = rd(p("branch"))
            off = {"enforcement_level": "off", "contexts": [], "checks": []}
            if mode is None and has("rsc.json"):
                g = rsc_get()
                print(json.dumps({"name": DEFAULT, "protected": True, "protection": {
                    "enabled": True, "required_status_checks": {"enforcement_level": "everyone",
                                                                "contexts": g["contexts"], "checks": g["checks"]}}}))
            elif mode is None:
                print(json.dumps({"name": DEFAULT, "protected": True, "protection": {
                    "enabled": True, "required_status_checks": {"enforcement_level": "everyone", "contexts": ["ci"],
                                                                "checks": [{"context": "ci", "app_id": None}]}}}))
            elif mode == "unprotected":
                print(json.dumps({"name": DEFAULT, "protected": False, "protection": {"enabled": False,
                                                                                     "required_status_checks": off}}))
            elif mode == "ruleset":
                print(json.dumps({"name": DEFAULT, "protected": True, "protection": {"enabled": False,
                                                                                    "required_status_checks": off}}))
            elif mode == "nochecks":
                print(json.dumps({"name": DEFAULT, "protected": True, "protection": {
                    "enabled": True, "required_status_checks": {"enforcement_level": "everyone", "contexts": [],
                                                                "checks": []}}}))
            elif mode == "noflag":
                print(json.dumps({"name": DEFAULT}))
            elif mode == "404-notfound":
                not_found()
            elif mode == "404-branch":
                die("gh: Branch not found (HTTP 404)", out=json.dumps({
                    "message": "Branch not found", "documentation_url": "https://docs.github.com/rest", "status": "404"}))
            elif mode == "403-integration":
                die("gh: Resource not accessible by integration (HTTP 403)", out=json.dumps({
                    "message": "Resource not accessible by integration", "status": "403"}))
            elif mode == "403-rate":
                die("gh: API rate limit exceeded for user ID 1. (HTTP 403)", out=json.dumps({
                    "message": "API rate limit exceeded for user ID 1.", "status": "403"}))
            else:
                die("fake gh: unknown branch state %r" % mode, rc=99)
            sys.exit(0)
        if has("err.rules"):
            die(rd(p("err.rules")))
        mode = rd(p("rules"))
        if mode is None and os.path.isdir(p("rulesets")):
            out = []
            for f in sorted(os.listdir(p("rulesets"))):
                if f.endswith(".json"):
                    rs = json.loads(rd(p("rulesets", f)))
                    for r in rs.get("rules") or []:
                        out.append(dict(r, ruleset_id=rs.get("id"), ruleset_source_type=rs.get("source_type", "Repository"),
                                        ruleset_source="o/r"))
            print(json.dumps(out))
        elif mode is None:
            print("[]")
        elif mode.lstrip().startswith("["):
            print(json.dumps(json.loads(mode)))
        elif mode == "403-plan":
            die("gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)", out=json.dumps({
                "message": "Upgrade to GitHub Pro or make this repository public to enable this feature.", "status": "403"}))
        elif mode == "403-rate":
            die("gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)",
                out=json.dumps({"message": "You have exceeded a secondary rate limit.", "status": "403"}))
        elif mode == "404":
            not_found()
        else:
            die("fake gh: unknown rules state %r" % mode, rc=99)
        sys.exit(0)

die("fake gh: unhandled call: " + " ".join(args), rc=99)
