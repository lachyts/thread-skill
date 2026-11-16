#!/usr/bin/env bash
# master-runs (p54-7, ADR 0084 Decided for you 3, 11 and 13): reconcile-rollout.py reads master's `full suite` runs,
# makes the newest red run's one re-run, files a red-master fix task first in the queue, checks the Green tip, and writes
# master-run lines to the Run record's master-runs.jsonl. Lean by design: Part 1 is one python process that imports the
# module and pins every pure decision, verdict, parse and fit; Part 2 runs the CLI only for I/O and wiring, on an inline
# fake gh (no sleeps: the budget and the deadline by their knobs, the ledger's grace by --now).
#   Part 1 (pure):
#   M5  covered and new suites: a red the read before already holds files nothing more; a new suite files its own.
#   M6  attempt 1 red on A, attempt 2 on B alone: unconfirmed; the next run red on B is covered and files B.
#   M7  a newest run whose suites the read before only partly holds is re-run first; its re-run files both.
#   M8  a newer run in progress is the re-test: no re-run; it confirms and files.
#   M10 healed: a newer green comes first, so the break is recorded healed with no task (once a streak); the trail.
#   M13 DfY 13's publisher red, as run sequences (a) a blip, (b) a return covered, (c) a red straight after a blip.
#   M14 no verdict: a cancel with no time-limit annotation (the publisher skipped); a cut shard; a no-verdict run skipped.
#   M15 a failed shard named by its failed step; `node tests` expanded from the TAP location.
#   M19 a fix that landed before a run that is still red refiles its suite.
#   M23 a log just over the cap is parsed from its tail, to the same suites.
#   M25 filed with no green listed: one rule, only the since filter dropped.
#   M26 the re-run ledger: the grace, its end, a refusal, a re-run with no verdict, the lock's guard.
#   M27 _master_fit: a line too big fits, its lists cut in sort order with their totals.
#   Part 2 (CLI):
#   M1  all green: nothing written; two calls a pass once the branch is cached; C proven from the list.
#   M2  one re-run of the newest red run, never a second; its red re-run files one task, joined first and started first.
#   M3  a red that passes its re-run: a rerun-pass line, no task, never a Flake.
#   M4  an unreadable gh: missing, a 500 on the list, a 500 on a log: not read, nothing written, no call after the 500.
#   M9  the Green tip: proven, wait, unproven (a line and a task, once), proven by an earlier attempt, no ref, head_sha.
#   M11 two rollouts on one repo: one line and one task per key, the same since, trail, key and stem either way round.
#   M12 the next rollout takes over runs a complete rollout left; a complete rollout's fix is loose.
#   M16 the pass bounds: the read budget and the pass deadline, each draining a backlog pass by pass.
#   M17 --dry-run writes nothing and makes no re-run.
#   M18 the master-runs lock busy: not read, nothing written.
#   M20 GitHub refuses the re-run: recorded once, the line reads refused.
#   M21 no GitHub origin; no full-suite workflow.
#   M22 recovery: a task with no line; a line write that fails, then lands naming the same task; a join that fails,
#       then joins through R's own stem.
#   M24 a red too big for one line: one fitted line, one task holding every suite and PR.
# Temp dirs only; no vault, no network. bash 3.2-compatible (macOS).
set -uo pipefail
export TZ=UTC PYTHONDONTWRITEBYTECODE=1

HERE="$(cd "$(dirname "$0")" && pwd)"
RR="$HERE/../scripts/reconcile-rollout.py"
TMP="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
export HOME="$TMP/home"; mkdir -p "$HOME"
export THREAD_HEAT_LEVEL=0
export THREAD_VERIFY_SLOTS_DIR="$TMP/verify-slots"

fail=0
ok() { if [ "$1" = "$2" ]; then echo "ok   - $3"; else echo "FAIL - $3: expected [$2] got [$1]"; fail=1; fi; }
has() { case "$1" in *"$2"*) echo "ok   - $3";; *) echo "FAIL - $3: [$2] not in [$1]"; fail=1;; esac; }
hasnt() { case "$1" in *"$2"*) echo "FAIL - $3: unexpected [$2] in [$1]"; fail=1;; *) echo "ok   - $3";; esac; }

# ── Part 1: the pure core, one process ────────────────────────────────────────────────────────────────────────────
python3 - "$RR" > "$TMP/pure.out" 2>&1 <<'PY'
import importlib.util, io, json, sys
from datetime import datetime, timedelta, timezone
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); rr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rr)

REPO, T0 = "o/r", datetime(2026, 11, 16, tzinfo=timezone.utc)
PUB = rr.MASTER_PUBLISHER
def z(m): return (T0 + timedelta(minutes=m)).strftime("%Y-%m-%dT%H:%M:%SZ")
def sha(n): return ("%02d" % n) * 20
def run(n, concl="failure", attempt=1, status="completed"):
    return {"id": 1000 + n, "number": n, "attempt": attempt, "status": status,
            "conclusion": concl if status == "completed" else None, "sha": sha(n), "created": z(n * 30),
            "updated": z(n * 30 + 20), "url": "https://github.com/o/r/actions/runs/%d" % (1000 + n)}
def cache(): return {"branch": None, **{k: {} for k in rr.MASTER_CACHE_MAPS}}
def V(c, r, n, suites):
    """attempt n of run r: suites None green, [] no verdict, else red on them."""
    key = "%d/%d" % (r["id"], n)
    if n < r["attempt"]:
        c["attempts"][key] = {"conclusion": "success" if suites is None else "failure",
                              "updated_at": z(r["number"] * 30 + 5 * n)}
    c["verdicts"][key] = ({"v": "green", "suites": []} if suites is None else {"v": "none", "suites": []}
                          if suites == [] else {"v": "red", "suites": sorted(suites), "where": {}, "detail": None})
def ledger(**kw): return {"reruns": kw.get("reruns", {}), "refusals": kw.get("refusals", {})}
NOW = T0 + timedelta(days=1)
class World:
    """A repo's history as master-runs sees it: runs, the cache, the ledger, the notes and the keys a pass wrote."""
    def __init__(self): self.runs, self.c, self.l, self.notes, self.keys = [], cache(), ledger(), [], set()
    def decide(self, now=NOW): return rr._master_decide(self.runs, self.c, self.l, self.notes, self.keys, now, REPO)
    def apply(self, d):
        """Write what a pass decided: each key, and each filed task as its note."""
        for dec in d["decisions"]:
            self.keys.add(dec["key"])
            if dec["task"]:
                f = dec["fields"]
                self.notes.append({"stem": dec["task"]["stem"], "repo": REPO, "kind": f["redKind"],
                                   "since": f.get("since"), "run": f["runId"], "attempt": f["attempt"],
                                   "suites": list(f["newSuites"]), "merged": None, "rollout": "ro"})
        return d
    def cmp(self, g, x, prs=(1,)):
        self.c["compares"]["%s...%s" % (sha(g), sha(x))] = {
            "total": len(prs), "commits": [["%040d" % p, "Merge pull request #%d from o/b%d" % (p, p)] for p in prs]}
def summary(d):
    return [(x["fields"]["outcome"], x["fields"]["runId"] - 1000, x["fields"].get("retest"),
             x["fields"].get("newSuites"), x["task"]["stem"] if x["task"] else None) for x in d["decisions"]]
def check(name, got, want):
    print(("ok %s" % name) if got == want else ("FAIL %s: got %r want %r" % (name, got, want)))
def stem(n, a): return "master-red-r-%s-%d" % (sha(n)[:12], a)

# M5: G green, R1 red on A (re-run, red again: filed), R2 red on A (covered), R3 red on {A, B} (re-run: B filed)
w = World(); w.runs = [run(1, "success"), run(2)]; V(w.c, w.runs[1], 1, ["A"])
d = w.decide()
check("M5: R1 newest, red on A after a green: one planned re-run, nothing decided", (d["rerun"], summary(d)),
      ({"run": 1002, "attempt": 1, "number": 2}, []))
w.runs[1] = run(2, attempt=2); V(w.c, w.runs[1], 1, ["A"]); V(w.c, w.runs[1], 2, ["A"])
d = w.decide()
check("M5: … its re-run red on A: the compare (G, R1) is needed first", d["needs"], [("compare", sha(1), sha(2))])
w.cmp(1, 2, (11, 12))
d = w.apply(w.decide())
check("M5: … then one red line, retest rerun, newSuites [A], its task -2", summary(d),
      [("red", 2, "rerun", ["A"], stem(2, 2))])
check("M5: … merges and prs from the compare", (d["decisions"][0]["fields"]["merges"], d["decisions"][0]["fields"]["prs"]),
      (2, [11, 12]))
w.runs.append(run(3)); V(w.c, w.runs[2], 1, ["A"])
d = w.apply(w.decide())
f = d["decisions"][0]["fields"]
check("M5: R2 newest, red on A: covered, no re-run, a red line with no newSuites, no followup",
      (d["rerun"], summary(d)), (None, [("red", 3, "covered", None, None)]))
check("M5: … merges and prs null, no compare needed", (f["merges"], f["prs"], d["needs"]), (None, None, []))
w.runs.append(run(4)); V(w.c, w.runs[3], 1, ["A", "B"])
d = w.decide()
check("M5: R3 newest, red on {A, B}: not covered, one planned re-run", (d["rerun"], summary(d)),
      ({"run": 1004, "attempt": 1, "number": 4}, []))
w.runs[3] = run(4, attempt=2); V(w.c, w.runs[3], 1, ["A", "B"]); V(w.c, w.runs[3], 2, ["A", "B"])
check("M5: … its re-run red on {A, B}: the compare (G, R3) is needed", w.decide()["needs"], [("compare", sha(1), sha(4))])
w.cmp(1, 4, (11, 12, 13))
d = w.apply(w.decide())
check("M5: … a second task naming B alone", summary(d), [("red", 4, "rerun", ["B"], stem(4, 2))])
check("M5: … its line's suites are both, confirmed", d["decisions"][0]["fields"]["suites"], ["A", "B"])

# M6: attempt 1 red on A, attempt 2 on B alone, W green: unconfirmed; the next run P red on B is covered and files B
w = World(); w.runs = [run(1, "success"), run(2, attempt=2)]; V(w.c, w.runs[1], 1, ["A"]); V(w.c, w.runs[1], 2, ["B"])
d = w.apply(w.decide())
check("M6: attempt 1 on A, attempt 2 on B alone: unconfirmed, retest rerun, no task",
      (summary(d), d["decisions"][0]["fields"]["suites"]), ([("unconfirmed", 2, "rerun", None, None)], ["B"]))
w.runs.append(run(3)); V(w.c, w.runs[2], 1, ["B"]); w.cmp(1, 3)
d = w.apply(w.decide())
check("M6: P newest, red on B: W(P) is R's attempt 2, so covered: no re-run, a task naming B, stem -1",
      (d["rerun"], summary(d)), (None, [("red", 3, "covered", ["B"], stem(3, 1))]))

# M7: N newest at {A, B}, the previous run red on A and unconfirmed: N is re-run first; its re-run red on B files both
w = World(); w.runs = [run(1, "success"), run(2), run(3)]; V(w.c, w.runs[1], 1, ["A"]); V(w.c, w.runs[2], 1, ["A", "B"])
d = w.apply(w.decide())
check("M7: the previous run unconfirmed; N not covered: one planned re-run of N, nothing filed",
      (summary(d), d["rerun"]), ([("unconfirmed", 2, "next-run", None, None)], {"run": 1003, "attempt": 1, "number": 3}))
w.runs[2] = run(3, attempt=2); V(w.c, w.runs[2], 1, ["A", "B"]); V(w.c, w.runs[2], 2, ["B"]); w.cmp(1, 3)
d = w.apply(w.decide())
check("M7: … N's attempt 2 red on B: one task naming A and B, stem -2", summary(d), [("red", 3, "rerun", ["A", "B"], stem(3, 2))])

# M8: a newer run in progress is the re-test: no re-run; it completes red on A, covered, and files A
w = World(); w.runs = [run(1, "success"), run(2), run(3, status="in_progress")]; V(w.c, w.runs[1], 1, ["A"])
d = w.apply(w.decide())
check("M8: R red on A with a newer run in progress: no re-run, unconfirmed, retest next-run", (d["rerun"], summary(d)),
      (None, [("unconfirmed", 2, "next-run", None, None)]))
w.runs[2] = run(3); V(w.c, w.runs[2], 1, ["A"]); w.cmp(1, 3)
d = w.apply(w.decide())
check("M8: … N completes red on A: covered, a task naming A, stem -1; no re-run at any step", (d["rerun"], summary(d)),
      (None, [("red", 3, "covered", ["A"], stem(3, 1))]))

# M10: healed: G, R1 red on A, R2 red on A, then S1 green
w = World(); w.runs = [run(1, "success"), run(2), run(3), run(4, "success")]
V(w.c, w.runs[1], 1, ["A"]); V(w.c, w.runs[2], 1, ["A"])
check("M10: the break's compare (G, R2) is read first", w.decide()["needs"], [("compare", sha(1), sha(3))])
w.cmp(1, 3, (21, 22)); d = w.apply(w.decide())
check("M10: R1 unconfirmed; R2 red, healed, newSuites [A], no task; S1's green line", summary(d),
      [("unconfirmed", 2, "next-run", None, None), ("red", 3, "next-run", ["A"], None), ("green", 4, None, None, None)])
f, g = d["decisions"][1]["fields"], d["decisions"][2]["fields"]
check("M10: … the red line healed, merges and prs from compare(G, R2), no followup",
      (f.get("healed"), f["merges"], f["prs"], "followup" in f), (True, 2, [21, 22], False))
check("M10: … the green's trailMinutes from the first run after G to S1's completion, redRuns 2, since G",
      (g["trailMinutes"], g["redRuns"], g["since"], g["followups"], "trailFloor" in g), (80, 2, sha(1), [], False))
w = World(); w.runs = [run(1, "success"), run(2), run(3), run(4), run(5, "success")]
for i in (1, 2, 3):
    V(w.c, w.runs[i], 1, ["A"])
w.cmp(1, 3)
w.keys = {(REPO, 1002, 1, "unconfirmed"), (REPO, 1003, 1, "red")}
w.notes = [{"stem": "", "repo": REPO, "kind": "healed", "since": sha(1), "run": 1003, "attempt": 1, "suites": ["A"],
            "merged": None, "rollout": ""}]   # what _master_keys reads off R2's healed line, written a pass before
check("M10: a later pass over the same streak: the healed break counts as filed, so R3 adds no break", summary(w.decide()),
      [("red", 4, "next-run", None, None), ("green", 5, None, None, None)])

# M13: DfY 13's publisher red, as run sequences
w = World(); w.runs = [run(1, "success"), run(2)]; V(w.c, w.runs[1], 1, [PUB])
d = w.decide()
check("M13 (a): R1 newest, publisher-red, after a green: one planned re-run", (d["rerun"], summary(d)),
      ({"run": 1002, "attempt": 1, "number": 2}, []))
w.runs[1] = run(2, "success", attempt=2); V(w.c, w.runs[1], 1, [PUB]); V(w.c, w.runs[1], 2, None)
d = w.apply(w.decide())
check("M13 (a): … its re-run green: rerun-pass, publisherOnly, no task", (summary(d), d["decisions"][0]["fields"].get("publisherOnly")),
      ([("rerun-pass", 2, None, None, None)], True))
w.runs.append(run(3)); V(w.c, w.runs[2], 1, [PUB])
d = w.decide()
check("M13 (c): R2 newest, publisher-red straight after the blip: its own one re-run", (d["rerun"], summary(d)),
      ({"run": 1003, "attempt": 1, "number": 3}, []))
import copy
w2 = copy.deepcopy(w)
w.runs[2] = run(3, attempt=2); V(w.c, w.runs[2], 1, [PUB]); V(w.c, w.runs[2], 2, [PUB])
w.c["verdicts"]["1003/2"]["detail"] = "Green tip: refs/thread/green still sits behind after 3 failed pushes"
d = w.apply(w.decide())
check("M13 (c1): … its re-run red: a publisher task, retest rerun, no further re-run, merges and prs null",
      (d["rerun"], summary(d), d["decisions"][0]["fields"]["redKind"], d["decisions"][0]["fields"]["merges"], d["decisions"][0]["fields"]["prs"]),
      (None, [("red", 3, "rerun", [PUB], stem(3, 2))], "publisher", None, None))
body = "\n".join(d["decisions"][0]["task"]["body"])
check("M13 (c1): … the task quotes the error line, blames no merge, and asks for a fix or a credential gate",
      ("Green tip: refs/thread/green still sits behind" in body, "no merge is blamed" in body,
       "never another re-run" in body, "Merges since" in body), (True, True, True, False))
w2.runs[2] = run(3, "success", attempt=2); V(w2.c, w2.runs[2], 1, [PUB]); V(w2.c, w2.runs[2], 2, None)
d = w2.apply(w2.decide())
check("M13 (c2): … its re-run green: a second rerun-pass, publisherOnly, no task",
      (summary(d), d["decisions"][0]["fields"].get("publisherOnly")), ([("rerun-pass", 3, None, None, None)], True))
w = World(); w.runs = [run(1, "success"), run(2), run(3, status="queued")]; V(w.c, w.runs[1], 1, [PUB])
d = w.apply(w.decide())
check("M13 (b): R1 publisher-red with R2 pending: unconfirmed [publisher], retest next-run, no re-run",
      (d["rerun"], summary(d), d["decisions"][0]["fields"]["suites"]), (None, [("unconfirmed", 2, "next-run", None, None)], [PUB]))
w.runs[2] = run(3); V(w.c, w.runs[2], 1, [PUB]); w.c["verdicts"]["1003/1"]["detail"] = "Green tip: push refused"
d = w.apply(w.decide())
f = d["decisions"][0]["fields"] if d["decisions"] else {}
check("M13 (b): … R2 publisher-red: covered, redKind publisher, merges and prs null, no compare, no re-run",
      (d["rerun"], d["needs"], summary(d), f.get("redKind"), f.get("merges"), f.get("prs")),
      (None, [], [("red", 3, "covered", [PUB], stem(3, 1))], "publisher", None, None))
check("M13 (b): … its task quotes the ::error:: line", "Green tip: push refused" in "\n".join(d["decisions"][0]["task"]["body"]), True)

# M14: no verdict
J = lambda i, name, c: {"id": i, "name": name, "conclusion": c, "url": "u%d" % i, "step": None}
jobs = [J(51, "full suite (ubuntu-latest, shard 1/4)", "success"), J(52, "full suite (macos-latest, shard 2/4)", "cancelled"),
        J(53, PUB, "skipped")]
check("M14 (a): a cancelled shard's annotations are read first", rr._master_verdict("cancelled", jobs, {}, {}),
      ("need", [("annotations", 52)]))
check("M14 (a): … a cancel with no time-limit annotation, the publisher skipped: no verdict",
      rr._master_verdict("cancelled", jobs, {}, {"52": {"cut": False}})["v"], "none")
check("M14 (b): … with the annotation: red, the job cut at its time limit",
      rr._master_verdict("cancelled", jobs, {}, {"52": {"cut": True}})["suites"], ["full suite (macos-latest, shard 2/4) (cut at its time limit)"])
check("M14: startup_failure is red; neutral is no verdict",
      (rr._master_verdict("startup_failure", None, {}, {})["suites"], rr._master_verdict("neutral", None, {}, {})["v"]),
      ([rr.MASTER_STARTUP], "none"))
w = World(); w.runs = [run(1, "success"), run(2), run(3, "cancelled")]; V(w.c, w.runs[1], 1, ["A"]); V(w.c, w.runs[2], 1, [])
d = w.apply(w.decide())
check("M14 (c): H newest has no verdict: R is not re-run, unconfirmed, retest none", (d["rerun"], summary(d)),
      (None, [("unconfirmed", 2, "none", None, None)]))
w.runs.append(run(4)); V(w.c, w.runs[3], 1, ["A"]); w.cmp(1, 4)
d = w.apply(w.decide())
check("M14 (c): … P newest, red on A: W(P) is R's read (H skipped), covered, a task naming A, no re-run",
      (d["rerun"], summary(d)), (None, [("red", 4, "covered", ["A"], stem(4, 1))]))

# M15: a failed shard named by its failed step; node tests from the TAP location
ts = "2026-11-16T10:00:00.1234567Z "
pip = "﻿" + "\n".join(ts + l for l in ["##[group]Run python3 -m pip install pyyaml", "ERROR: no network",
                                              "##[error]Process completed with exit code 1."])
check("M15: no suite line, its pip install step failed: named by that step",
      rr._job_suites(pip, "full suite (ubuntu-latest, shard 1/4)", "Run python3 -m pip install pyyaml"),
      ['full suite (ubuntu-latest, shard 1/4): step "Run python3 -m pip install pyyaml" failed'])
check("M15: … no suite line and run.sh's step failed: tests/run.sh named",
      rr._job_suites(ts + "boom", "J", "Run bash tests/run.sh --shard 1/4"), ["J: tests/run.sh failed with no suite named"])
tap = ["== node tests (12 files)", "TAP version 13", "# Subtest: two", "    # Subtest: sub", "    not ok 1 - sub", "      ---",
       "      location: '/home/runner/work/r/r/tests/sub-only.test.mjs:4:36'", "      ...", "not ok 2 - two", "  ---",
       "  location: '/home/runner/work/r/r/tests/x.test.mjs:4:1'", "  ...", "ok 3 - fine", "  ---", "  ...",
       "node tests (12 files): FAILED (40s)", "tests/leg.test.sh: FAILED (1200s)", "", "make test: FAILED (300s)",
       "  - tests/leg.test.sh (timed out after 1200s)", "  - node tests (12 files)", "##[error]Process completed with exit code 1."]
log = "﻿" + "\n".join(ts + l for l in tap)
check("M15: node tests (N files) expanded to the failing file from its top-level TAP location; a timeout tail dropped",
      rr._job_suites(log, "J"), ["tests/leg.test.sh", "tests/x.test.mjs"])
check("M15: … a cut shard (no verdict line): every FAILED label but make test",
      rr._job_suites("\n".join(ts + l for l in tap[:17]), "J"), ["tests/leg.test.sh", "tests/x.test.mjs"])
check("M15: … spec's `test at` is the fallback",
      rr._job_suites("\n".join(ts + l for l in ["test at tests/y.test.mjs:3:1", "make test: FAILED (9s)", "  - node tests (3 files)"]), "J"),
      ["tests/y.test.mjs"])

# M19: a fix that landed before a run that is still red refiles its suite; the next covered run files nothing more
w = World(); w.runs = [run(1, "success"), run(2, attempt=2)]; V(w.c, w.runs[1], 1, ["A"]); V(w.c, w.runs[1], 2, ["A"]); w.cmp(1, 2)
w.apply(w.decide())
w.notes[0]["merged"] = T0 + timedelta(minutes=3 * 30 - 1)   # T1 merged a minute before R5's created_at
w.runs += [run(3), run(4)]; V(w.c, w.runs[2], 1, ["A"]); V(w.c, w.runs[3], 1, ["A"]); w.cmp(1, 3)
d = w.apply(w.decide())
check("M19: T1 merged before R5, R5 still red on A: T2 names A; R6 covered files nothing more", summary(d),
      [("red", 3, "next-run", ["A"], stem(3, 1)), ("red", 4, "covered", None, None)])

# M23: a log just over the cap is parsed from its tail, to the same suites
lines = ["%s tests/pass-%04d.test.sh: ok (3s)" % (ts.strip(), i) for i in range(120)] + [ts + l for l in tap]
full = ("﻿" + "\n".join(lines)).encode()
text, cut = rr._log_tail(io.BytesIO(full), 4096)
check("M23: a ~%d KB log over a 4 KiB cap: cut, the same suites as the uncut log" % (len(full) // 1024),
      (len(full) > 4096, cut, rr._job_suites(text, "J"), text.startswith(ts[:4])),
      (True, True, rr._job_suites(full.decode(), "J"), True))
check("M23: … at or under the cap it is read whole", rr._log_tail(io.BytesIO(full), len(full)), (full.decode(), False))

# M25: filed with no green listed: one rule, only the since filter dropped
def note(st, since, merged, suites=("A",)):
    return {"stem": st, "repo": REPO, "kind": "suites", "since": since, "run": 9, "attempt": 1, "suites": list(suites),
            "merged": merged, "rollout": "ro"}
r2 = run(2)
after, before = T0 + timedelta(minutes=2 * 30 + 1), T0 + timedelta(minutes=2 * 30 - 1)
for label, notes, want in (("a fix for A merged after R's created_at counts: nothing new", [note("t", None, after)], [("unconfirmed", 1, "next-run", None, None), ("red", 2, "covered", None, None)]),
                           ("the fix merged before R's created_at: A refiles", [note("t", sha(7), before)], [("unconfirmed", 1, "next-run", None, None), ("red", 2, "covered", ["A"], stem(2, 1))])):
    w = World(); w.runs = [run(1), run(2)]; V(w.c, w.runs[0], 1, ["A"]); V(w.c, w.runs[1], 1, ["A"]); w.notes = notes
    d = w.decide()
    check("M25: no green listed, R covered on A: %s" % label, summary(d), want)
f = d["decisions"][1]["fields"]
check("M25: … since null: no compare, merges and prs null", (f["since"], f["merges"], f["prs"], d["needs"]), (None, None, None, []))
check("M25: … the task names the floor run and lists no merge", "is the floor, so no merge is listed" in "\n".join(d["decisions"][1]["task"]["body"]), True)
check("M25: with G set, a fix filed under another since does not count",
      (rr._master_filed([note("t", sha(7), None)], REPO, sha(1), r2, "own"),
       rr._master_filed([note("t", sha(1), None)], REPO, sha(1), r2, "own"),
       rr._master_filed([note("own", sha(1), None)], REPO, sha(1), r2, "own")), (set(), {"A"}, set()))

# M26: the re-run ledger
w = World(); w.runs = [run(1, "success"), run(2)]; V(w.c, w.runs[1], 1, ["A"])
w.l = ledger(reruns={"1002/1": z(2 * 30 + 21)})
d = w.decide(now=T0 + timedelta(minutes=2 * 30 + 22))
check("M26: a re-run of (R, 1) made a minute ago and not listed yet: a gap, no planned re-run, no decision",
      (d["rerun"], summary(d), d["gap"] is not None), (None, [], True))
d = w.decide(now=T0 + timedelta(minutes=2 * 30 + 32))
check("M26: … eleven minutes on, still unseen: R final on attempt 1, retest none", (d["rerun"], summary(d)),
      (None, [("unconfirmed", 2, "none", None, None)]))
w.l = ledger(refusals={"1002/1": 403})
check("M26: a ledger refusal: retest refused", summary(w.decide()), [("unconfirmed", 2, "refused", None, None)])
w = World(); w.runs = [run(1, "success"), run(2, "cancelled", attempt=2), run(3, status="in_progress")]
V(w.c, w.runs[1], 1, ["A"]); V(w.c, w.runs[1], 2, [])
d = w.decide()
check("M26: R's attempt 2 cancelled with no verdict and P pending: final on attempt 1, retest next-run",
      (summary(d), d["decisions"][0]["fields"]["attempt"]), ([("unconfirmed", 2, "next-run", None, None)], 1))
w.runs.pop()
check("M26: … with no newer run: retest none", summary(w.decide()), [("unconfirmed", 2, "none", None, None)])
l = ledger(reruns={"1002/1": z(1)})
check("M26: the lock's guard refuses a re-run the ledger holds and stores nothing",
      (rr._master_rerun_guard(l, [run(2)], 1002) is not None, l, rr._master_rerun_guard(ledger(refusals={"1002/1": 403}), [run(2)], 1002) is not None),
      (True, ledger(reruns={"1002/1": z(1)}), True))
check("M26: … a newer run at the head, or one not completed: no re-run; else it goes",
      (rr._master_rerun_guard(ledger(), [run(2), run(3, status="queued")], 1002) is not None,
       rr._master_rerun_guard(ledger(), [run(2, status="in_progress")], 1002) is not None,
       rr._master_rerun_guard(ledger(), [run(1), run(2)], 1002)), (True, True, None))

# M27: _master_fit
RRm = rr._run_record()
base = {"repo": REPO, "outcome": "red", "sha": sha(2), "at": z(80), "runId": 1002, "attempt": 1}
names = ["tests/%s.test.mjs" % (("s%02d" % i) * 30)[:180] for i in range(70)]
f, why = rr._master_fit(dict(base, suites=list(reversed(names))), "ro")
check("M27: 70 suites of ~200 characters: the line fits, suitesTotal 70, its first entries in name order",
      (why, RRm.line_bytes("master-run", f, "ro") <= RRm.MAX_LINE, f["suitesTotal"], f["suites"] == sorted(names)[:len(f["suites"])]),
      (None, True, 70, True))
f, why = rr._master_fit(dict(base, suites=["x" * 300]), "ro")
check("M27: a name of 300 characters is cut to 200", (why, len(f["suites"][0]), "suitesTotal" in f), (None, 200, False))
f, why = rr._master_fit(dict(base, prs=list(range(150, 0, -1))), "ro")
check("M27: 150 prs: cut to at most 100, ascending, prsTotal 150", (why, len(f["prs"]) <= 100, f["prs"][:2], f["prsTotal"]),
      (None, True, [1, 2], 150))
f, why = rr._master_fit(dict(base, suites=names, newSuites=names, prs=list(range(1, 130)), since=sha(1), merges=129), "ro")
check("M27: every list at once: fits, each total recorded, and run_record.check passes it",
      (why, RRm.line_bytes("master-run", f, "ro") <= RRm.MAX_LINE, f["suitesTotal"], f["newSuitesTotal"], f["prsTotal"]),
      (None, True, 70, 70, 129))
PY
prc=$?
while IFS= read -r line; do
  case "$line" in
    "ok "*) echo "ok   - ${line#ok }" ;;
    "FAIL "*) echo "FAIL - ${line#FAIL }"; fail=1 ;;
    *) echo "$line" ;;
  esac
done < "$TMP/pure.out"
[ "$prc" -eq 0 ] || { echo "FAIL - Part 1: the python block exited $prc"; fail=1; }

# ── Part 2: the CLI, on a fake gh ─────────────────────────────────────────────────────────────────────────────────
mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'PY'
#!/usr/bin/env python3
# A fake gh: `gh api <endpoint>` is served from $FAKE_GH/api/<endpoint with / ? & = as _> (a `.code` sibling gives the
# `(HTTP nnn)` error form; no file is a 404); `gh run rerun` takes its rc and stderr from rerun.rc and rerun.err; every
# argv is logged to gh.log.
import os, re, sys
G, a = os.environ["FAKE_GH"], sys.argv[1:]
with open(os.path.join(G, "gh.log"), "a") as f:
    f.write(" ".join(a) + "\n")
if a[:2] == ["run", "rerun"]:
    rc = open(os.path.join(G, "rerun.rc")).read().strip() if os.path.exists(os.path.join(G, "rerun.rc")) else "0"
    if os.path.exists(os.path.join(G, "rerun.err")):
        sys.stderr.write(open(os.path.join(G, "rerun.err")).read())
    sys.exit(int(rc))
if a[:1] == ["api"] and len(a) >= 2:
    p = os.path.join(G, "api", re.sub(r"[/?&=]", "_", a[1]))
    if os.path.exists(p + ".code"):
        sys.stderr.write("gh: request failed (HTTP %s)\n" % open(p + ".code").read().strip())
        sys.exit(1)
    if os.path.exists(p):
        sys.stdout.buffer.write(open(p, "rb").read())
        sys.exit(0)
    sys.stderr.write("gh: Not Found (HTTP 404)\n")
    sys.exit(1)
sys.stderr.write("fake gh: unknown call\n")
sys.exit(2)
PY
chmod +x "$TMP/bin/gh"

# fx.py <gh dir> <spec json>: master's history as GitHub serves it, every api file written afresh. The spec:
#   runs [[n, conclusion|null, attempt?, status?]] (id 1000+n, head sha (%02d n)*20, created n*30 min after T0, updated
#   +20), attempts {"n/k": conclusion}, jobs {"n/k": [[job id, name, conclusion, log|null, failed step|null]]} (log: a
#   string, or {suites, node, cut, pad, error}), logcode {job: code}, annotations {job: true|false}, compare [[g, x,
#   [prs], total?]], ref n | sha | null, head {sha: runs}, codes {endpoint: code}.
cat > "$TMP/fx.py" <<'PY'
import json, os, re, shutil, sys
from datetime import datetime, timedelta, timezone
G, spec = sys.argv[1], json.loads(sys.argv[2])
T0 = datetime(2026, 11, 16, tzinfo=timezone.utc)
A, R = os.path.join(G, "api"), "repos/o/r/"
shutil.rmtree(A, ignore_errors=True); os.makedirs(A)
def z(m): return (T0 + timedelta(minutes=m)).strftime("%Y-%m-%dT%H:%M:%SZ")
def sha(n): return ("%02d" % n) * 20 if isinstance(n, int) else n
def put(ep, body):
    with open(os.path.join(A, re.sub(r"[/?&=]", "_", ep)), "w") as f:
        f.write(body if isinstance(body, str) else json.dumps(body))
def code(ep, c): put(ep + ".code", str(c))
def ts(i): return "2026-11-16T10:%02d:%02d.1234567Z " % (i // 60 % 60, i % 60)
def mklog(s):
    if isinstance(s, str): return s
    out = ["##[group]Run bash tests/run.sh --shard 1/4", "== bash syntax (9 files)", "bash syntax (9 files): ok (1s)"]
    out += ["tests/pass-%04d.test.sh: ok (3s)" % i for i in range(s.get("pad", 0))]
    if s.get("error"):
        out += ["##[error]%s" % s["error"], "##[error]Process completed with exit code 1."]
        return "﻿" + "\n".join(ts(i) + l for i, l in enumerate(out)) + "\n"
    node = s.get("node", [])
    if node:
        out += ["== node tests (40 files)", "TAP version 13"]
        for k, f in enumerate(node):
            out += ["# Subtest: case %d" % k, "    # Subtest: inner", "    not ok 1 - inner", "      ---",
                    "      location: '/home/runner/work/r/r/tests/inner-only.test.mjs:9:9'", "      ...",
                    "not ok %d - case %d" % (k + 1, k), "  ---", "  duration_ms: 1.5",
                    "  location: '/home/runner/work/r/r/%s:3:1'" % f, "  failureType: 'subtestsFailed'", "  ..."]
        out.append("node tests (40 files): FAILED (40s)")
    for su in s.get("suites", []):
        out.append("%s: FAILED (12s)" % su)
    if not s.get("cut"):
        out += ["run wrote nothing into the checkout: ok (0s)", "", "make test: FAILED (300s)"]
        out += ["  - %s" % su for su in s.get("suites", [])] + (["  - node tests (40 files)"] if node else [])
    out.append("##[error]Process completed with exit code 1.")
    return "﻿" + "\n".join(ts(i) + l for i, l in enumerate(out)) + "\n"
def runobj(r):
    n, c = r[0], r[1]
    att = r[2] if len(r) > 2 else 1
    st = r[3] if len(r) > 3 else "completed"
    return {"id": 1000 + n, "run_number": n, "run_attempt": att, "status": st,
            "conclusion": c if st == "completed" else None, "head_sha": r[4] if len(r) > 4 else sha(n),
            "created_at": z(n * 30), "updated_at": z(n * 30 + 20 + 5 * (att - 1)),
            "html_url": "https://github.com/o/r/actions/runs/%d" % (1000 + n)}
if not spec.get("nobranch"):
    put("repos/o/r", {"default_branch": "master"})
runs = sorted((runobj(r) for r in spec.get("runs", [])), key=lambda o: -o["run_number"])
wf = R + "actions/workflows/full-suite.yml/runs?"
if not spec.get("noworkflow"):
    put(wf + "branch=master&event=push&per_page=100", {"total_count": len(runs), "workflow_runs": runs})
    put(wf + "branch=master&event=push&per_page=5", {"total_count": len(runs), "workflow_runs": runs[:5]})
for k, c in spec.get("attempts", {}).items():
    n, a = map(int, k.split("/"))
    put(R + "actions/runs/%d/attempts/%d" % (1000 + n, a),
        {"run_attempt": a, "status": "completed", "conclusion": c, "updated_at": z(n * 30 + 20 + 5 * (a - 1))})
for k, jobs in spec.get("jobs", {}).items():
    n, a = map(int, k.split("/"))
    put(R + "actions/runs/%d/attempts/%d/jobs?per_page=100" % (1000 + n, a), {"jobs": [
        {"id": j[0], "name": j[1], "conclusion": j[2], "html_url": "https://github.com/o/r/actions/runs/%d/job/%d" % (1000 + n, j[0]),
         "steps": ([{"name": j[4], "conclusion": "failure"}] if len(j) > 4 and j[4] else [])} for j in jobs]})
    for j in jobs:
        if len(j) > 3 and j[3] is not None:
            put(R + "actions/jobs/%d/logs" % j[0], mklog(j[3]))
for jid, c in spec.get("logcode", {}).items():
    code(R + "actions/jobs/%s/logs" % jid, c)
for jid, cut in spec.get("annotations", {}).items():
    put(R + "check-runs/%s/annotations?per_page=100" % jid,
        [{"message": "The job running on runner X has exceeded the maximum execution time of 30 minutes." if cut
          else "The operation was canceled."}])
for c in spec.get("compare", []):
    prs = c[2]
    put(R + "compare/%s...%s" % (sha(c[0]), sha(c[1])), {"total_commits": c[3] if len(c) > 3 else len(prs), "commits": [
        {"sha": "%040d" % p, "commit": {"message": "Merge pull request #%d from o/branch-%d\n\nbody" % (p, p)}} for p in prs]})
if spec.get("ref") is not None:
    put(R + "git/ref/thread/green", {"ref": "refs/thread/green", "object": {"sha": sha(spec["ref"]), "type": "commit"}})
for s, rs in spec.get("head", {}).items():
    put(wf + "head_sha=%s&event=push" % s, {"total_count": len(rs), "workflow_runs": [runobj(r) for r in rs]})
for ep, c in spec.get("codes", {}).items():
    code(ep, c)
PY

# One shared, read-only Project root: a repo whose origin is github.com/o/r.
ROOT="$TMP/root"; git -c init.defaultBranch=master init -q "$ROOT"; git -C "$ROOT" config remote.origin.url https://github.com/o/r.git
NOW=2026-11-17T00:00:00Z
F=""; G=""; RO=""; out=""; err=""; rc=0
# mkro <path> [extra Notes line] — a protocol-5 parallel rollout note on $ROOT, two queued tasks q1 and q2 in its Queue
mkro() {
  local ro="$1" slug q p="${QP:-q}" pj="${PJ:-Demo}"; slug=$(basename "$1" .md)
  { printf -- '---\ntags: [task, rollout]\nstatus: open\nprotocol_version: 5\nparallel_ceiling: 3\nprojects:\n  - "[[%s]]"\n---\n\n' "$pj"
    printf '## Notes\n\nProject root: `%s`\n%s\n\n## Queue\n\n| # | Task | Scope | Mode |\n|---|---|---|---|\n' "${PROOT:-$ROOT}" "${2:-}"
    printf '| 1 | [[%s1\\|%s1]] | single-file | — |\n| 2 | [[%s2\\|%s2]] | single-file | — |\n%s' "$p" "$p" "$p" "$p" "${QEXTRA:-}"; } > "$ro"
  for q in "${p}1" "${p}2"; do
    printf -- '---\ntags: [task]\nstatus: %s\nrollout: "[[%s]]"\npriority: normal\n%sprojects:\n  - "[[%s]]"\n---\n\n## Notes\n\nbody\n' \
      "${QST:-open}" "$slug" "${QFM:-}" "$pj" > "$(dirname "$ro")/$q.md"
  done
}
# fresh <name> — a fixture's own lock dir, events dir, fake-gh dir, tasks dir and rollout note
fresh() {
  F="$TMP/$1"; G="$F/gh"; mkdir -p "$G" "$F/tasks" "$F/locks" "$F/events"
  export THREAD_NOTE_LOCK_DIR="$F/locks" THREAD_EVENTS_DIR="$F/events" FAKE_GH="$G"
  RO="$F/tasks/r-rollout-2026-11-16.md"; mkro "$RO"
  echo "== $1"
}
fx() { python3 "$TMP/fx.py" "$G" "$1"; }
# mr [args...] -> $rc, $out, $err: one master-runs pass at --now $NOW
mr() { python3 "$RR" master-runs --rollout "$RO" --tasks-dir "$F/tasks" --gh-bin "$TMP/bin/gh" --now "$NOW" "$@" \
         > "$F/out" 2> "$F/err"; rc=$?; out=$(cat "$F/out"); err=$(cat "$F/err"); }
calls() { cat "$G/gh.log" 2>/dev/null; }
ncalls() { calls | grep -c -- "$1" || true; }
gl() { : > "$G/gh.log"; }
# lines [outcome] — master-runs.jsonl's lines, one `outcome runId attempt retest newSuites followup` per line
lines() { python3 - "$THREAD_EVENTS_DIR/master-runs.jsonl" "${1:-}" <<'PY'
import json, sys
try:
    rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
except FileNotFoundError:
    rows = []
for d in rows:
    if sys.argv[2] and d["outcome"] != sys.argv[2]:
        continue
    print(" ".join(str(x) for x in (d["outcome"], d.get("runId"), d.get("attempt"), d.get("retest"),
                                     ",".join(d.get("newSuites") or []) or "-", d.get("followup") or "-")))
PY
}
field() { python3 -c 'import json,sys; rows=[json.loads(l) for l in open(sys.argv[1]) if l.strip()]; d=[r for r in rows if r["outcome"]==sys.argv[2]][int(sys.argv[4]) if len(sys.argv)>4 else 0]; print(json.dumps(d.get(sys.argv[3]), separators=(",", ":")))' "$THREAD_EVENTS_DIR/master-runs.jsonl" "$@"; }
tasks() { ( cd "$F/tasks" && ls master-red-*.md master-green-*.md 2>/dev/null ) | tr '\n' ' ' | sed 's/ $//'; }
fmv() { grep -m1 "^$2:" "$F/tasks/$1.md" | sed "s/^$2: *//"; }
qrows() { sed -n '/^## Queue/,/^## /p' "$RO" | grep '^|' | tail -n +3; }
sha() { local s o='' i; s=$(printf '%02d' "$1"); for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do o="$o$s"; done; printf '%s' "$o"; }   # run n's head
J1='"full suite (ubuntu-latest, shard 1/4)"'; J2='"full suite (macos-latest, shard 2/4)"'

# ── M1 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m1
fx '{"runs": [[1, "success"], [2, "success"], [3, "success"]], "ref": 3}'
mr
ok "$rc|$(lines | wc -l | tr -d ' ')|$(tasks)" "0|0|" "M1: an all-green history: exit 0, no line, no task"
ok "$(calls | sed 's/[?].*//' | tr '\n' ';')" "api repos/o/r;api repos/o/r/actions/workflows/full-suite.yml/runs;api repos/o/r/git/ref/thread/green;" "M1: … the branch, the list and the ref only: no counted read, no re-run"
ok "$(python3 -c 'import json,sys; print(sorted(json.load(open(sys.argv[1]))["proven"]))' "$F/locks/master-runs-o.r.json")" "['$(sha 3)']" "M1: … the cache holds C as proven"
gl; mr
ok "$rc|$(calls | wc -l | tr -d ' ')" "0|2" "M1: a second pass makes two calls, the list and the ref (the branch cached)"

# ── M2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m2
QEXTRA='| 3 | [[qsolo\|qsolo]] | cross-cutting | — |
' mkro "$RO" '- 2026-11-16T09:00+00:00 auto-retry [[qhi]] at 6aece1bf4ed4'
for q in qhi qsolo; do
  printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[r-rollout-2026-11-16]]"\npriority: %s\n%sprojects:\n  - "[[Demo]]"\n---\n\nbody\n' \
    "$([ $q = qhi ] && echo high || echo normal)" "$([ $q = qsolo ] && echo 'solo: true
')" > "$F/tasks/$q.md"
done
H2='"runs": [[1, "success"], [2, "failure"]], "jobs": {"2/1": [[21, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}], [22, '"$J2"', "success"], [23, "publish the Green tip", "skipped"]]}, "ref": 1'
fx "{$H2}"
mr
ok "$rc|$(ncalls 'run rerun')|$(lines | wc -l | tr -d ' ')|$(tasks)" "0|1|0|" "M2 pass 1: one re-run, no line, no task"
has "$(calls)" "run rerun 1002 --failed -R o/r" "M2 pass 1: … the newest run's failed jobs"
ok "$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sorted(d["reruns"]), d["refusals"])' "$F/locks/master-runs-o.r.reruns.json")" "['1002/1'] {}" "M2 pass 1: … the ledger holds a re-run of (R, 1)"
printf '1' > "$G/rerun.rc"; printf 'HTTP 422: run 1002 is already running (https://api.github.com/...)\n' > "$G/rerun.err"
NOW=2026-11-17T00:01:00Z mr
ok "$rc|$(ncalls 'run rerun')|$(lines | wc -l | tr -d ' ')|$(tasks)" "0|1|0|" "M2 pass 1b, a minute on, the list unchanged: exit 0, still one re-run, no line, no task"
ok "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["refusals"])' "$F/locks/master-runs-o.r.reruns.json")" "{}" "M2 pass 1b: … no refusal stored"
rm -f "$G/rerun.rc" "$G/rerun.err"
fx '{"runs": [[1, "success"], [2, "failure", 2]], "attempts": {"2/1": "failure"}, "jobs": {"2/1": [[21, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}], [22, '"$J2"', "success"], [23, "publish the Green tip", "skipped"]], "2/2": [[24, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}], [23, "publish the Green tip", "skipped"]]}, "compare": [[1, 2, [101, 102, 103]]], "ref": 1}'
NOW=2026-11-17T00:30:00Z mr
T2="master-red-r-$(sha 2 | cut -c1-12)-2"
ok "$rc|$(tasks)" "0|$T2.md" "M2 pass 2: attempt 2 red on A: one task, stem -2"
ok "$(fmv "$T2" priority)|$(fmv "$T2" master_red)|$(fmv "$T2" master_red_since)|$(fmv "$T2" master_red_run)|$(fmv "$T2" master_red_attempt)" "high|\"o/r\"|$(sha 1)|1002|2" "M2 pass 2: … priority high, master_red, since G, run, attempt"
ok "$(sed -n '/^master_red_suites:/,/^[a-z]/p' "$F/tasks/$T2.md" | grep '^  - ')" '  - "tests/a.test.sh"' "M2 pass 2: … suites [A]"
has "$(cat "$F/tasks/$T2.md")" "#101" "M2 pass 2: … its body names PR #101"; has "$(cat "$F/tasks/$T2.md")" "#103" "M2 pass 2: … and #103"
ok "$(qrows | head -2)" "| 1 | [[$T2\\|master-red-r-$(sha 2 | cut -c1-12)-2]] | — | joined 2026-11-17 |
| 2 | [[q1\\|q1]] | single-file | — |" "M2 pass 2: … joined at Queue row 1, the numbers shifted"
ok "$(fmv "$T2" rollout)" '"[[r-rollout-2026-11-16]]"' "M2 pass 2: … rollout: stamped"
ok "$(lines)" "red 1002 2 rerun tests/a.test.sh $T2" "M2 pass 2: one red line: retest rerun, newSuites [A], the followup"
ok "$(field red redKind)|$(field red merges)|$(field red prs)|$(field red since)" "\"suites\"|3|[101,102,103]|\"$(sha 1)\"" "M2 pass 2: … redKind suites, merges and prs from the compare"
nx=$(python3 "$RR" next --rollout "$RO" --tasks-dir "$F/tasks" --dry-run --now "$NOW" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["start"][0])')
ok "$nx" "$T2" "M2: next --dry-run starts it first, ahead of the Notes-ranked high task and the queued Solo row"
gl; NOW=2026-11-17T00:40:00Z mr
ok "$rc|$(tasks)|$(lines | wc -l | tr -d ' ')" "0|$T2.md|1" "M2 pass 3: no second task or line"
ok "$(calls | sed 's/[?].*//' | tr '\n' ';')" "api repos/o/r/actions/workflows/full-suite.yml/runs;api repos/o/r/git/ref/thread/green;" "M2 pass 3: … only the list and the ref: no jobs, log or compare call (cached)"

# A history every fixture below starts from: G (run 1) green, R (run 2) red on tests/a.test.sh at attempt 1.
RED1='"runs": [[1, "success"], [2, "failure"]], "jobs": {"2/1": [[21, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}], [23, "publish the Green tip", "skipped"]]}'
# ... and R at attempt 2, red on it again, with G...R's compare.
RED2='"runs": [[1, "success"], [2, "failure", 2]], "attempts": {"2/1": "failure"}, "jobs": {"2/1": [[21, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}], [23, "publish the Green tip", "skipped"]], "2/2": [[24, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}], [23, "publish the Green tip", "skipped"]]}, "compare": [[1, 2, [101, 102]]]'
T22="master-red-r-$(sha 2 | cut -c1-12)-2"

# ── M3 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m3
fx "{$RED1}"; mr
ok "$rc|$(ncalls 'run rerun')" "0|1" "M3: R red, newest: its one re-run"
fx '{"runs": [[1, "success"], [2, "success", 2]], "attempts": {"2/1": "failure"}, "jobs": {"2/1": [[21, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}], [23, "publish the Green tip", "skipped"]]}}'
NOW=2026-11-17T00:30:00Z mr
ok "$rc|$(lines)|$(tasks)" "0|rerun-pass 1002 2 None - -|" "M3: its re-run green: one rerun-pass line, no task"
ok "$(grep -l '"kind":"flake"' "$THREAD_EVENTS_DIR"/*.jsonl 2>/dev/null | wc -l | tr -d ' ')|$(grep -c '## Flake log' "$RO")" "0|0" "M3: … no flake line anywhere, no ## Flake log"

# ── M4 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m4a
fx "{$RED1}"
python3 "$RR" master-runs --rollout "$RO" --tasks-dir "$F/tasks" --gh-bin "$TMP/no-such-gh" --now "$NOW" > "$F/out" 2> "$F/err"; rc=$?; out=$(cat "$F/out")
ok "$rc|$out|$(lines | wc -l | tr -d ' ')|$(tasks)" "8|master-runs: not read (gh missing)|0|" "M4 (a): gh missing: exit 8, not read, no line, no task"
fresh m4b
fx '{'"$RED1"', "codes": {"repos/o/r/actions/workflows/full-suite.yml/runs?branch=master&event=push&per_page=100": 500}}'
mr
ok "$rc|$(lines | wc -l | tr -d ' ')|$(tasks)|$(ncalls 'run rerun')" "8|0||0" "M4 (b): a 500 on the list: exit 8, no line, no task, no re-run"
has "$out" "master-runs: not read (actions/workflows/full-suite.yml/runs" "M4 (b): … not read, naming the list"
fresh m4c
fx '{"runs": [[1, "success"], [2, "failure"]], "jobs": {"2/1": [[31, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}], [32, '"$J2"', "failure", {"suites": ["tests/b.test.sh"]}]]}, "logcode": {"31": 500}}'
mr
ok "$rc|$(lines | wc -l | tr -d ' ')|$(tasks)|$(ncalls 'run rerun')" "8|0||0" "M4 (c): a 500 on the first of two failed logs: exit 8, no line, no task, no re-run"
ok "$(calls | tail -1)" "api repos/o/r/actions/jobs/31/logs" "M4 (c): … no call after the 500"

# ── M9 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m9a
fx '{"runs": [[1, "success"], [2, "success"], [3, "success"]], "ref": 2}'; mr
ok "$rc|$(lines | wc -l | tr -d ' ')|$(tasks)|$(ncalls head_sha)" "0|0||0" "M9 (a): the ref's commit has a listed success run: nothing, no runs?head_sha call"
fresh m9b
fx '{"runs": [[1, "success"], [2, null, 1, "in_progress"]], "ref": 2}'; mr
ok "$rc|$(lines | wc -l | tr -d ' ')|$(tasks)" "0|0|" "M9 (b): its run in progress, the publisher still going: nothing (wait)"
fresh m9c
H9='"runs": [[1, "success"], [2, "cancelled"]], "jobs": {"2/1": [[71, '"$J1"', "cancelled"], [72, "publish the Green tip", "skipped"]]}, "annotations": {"71": false}, "ref": 2'
fx "{$H9}"; mr
U="master-green-unproven-r-$(sha 2 | cut -c1-12)"
ok "$rc|$(lines)|$(tasks)" "0|unproven None None None - $U|$U.md" "M9 (c): its runs all completed with no success: an unproven line and its own task"
ok "$(field unproven ref)|$(fmv "$U" master_red_kind)|$(fmv "$U" master_red_ref_sha)|$(fmv "$U" priority)" "\"refs/thread/green\"|green-tip|$(sha 2)|high" "M9 (c): … the task's marks"
has "$(cat "$F/tasks/$U.md")" "The last green run: #1" "M9 (c): … it names the last green run"
gl; mr
ok "$rc|$(lines | wc -l | tr -d ' ')|$(tasks)" "0|1|$U.md" "M9 (c): a second pass adds nothing"
fx '{"runs": [[3, "success"]], "ref": 2}'; gl; mr
ok "$rc|$(ncalls head_sha)|$(lines | wc -l | tr -d ' ')" "0|0|1" "M9 (c): a third, C off the list: no runs?head_sha call (keyed)"
fresh m9d
fx '{"runs": [[1, "success"], [2, "failure", 2]], "attempts": {"2/1": "success"}, "jobs": {"2/2": [[81, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}]]}, "ref": 2}'
mr
ok "$rc|$(lines unproven | wc -l | tr -d ' ')|$(tasks)" "0|0|" "M9 (d): its latest attempt failed but attempt 1 succeeded: proven, no unproven line, no task"
ok "$(python3 -c 'import json,sys; print(sorted(json.load(open(sys.argv[1]))["proven"]))' "$F/locks/master-runs-o.r.json")" "['$(sha 2)']" "M9 (d): … the proof cached by sha"
fresh m9e
fx '{"runs": [[1, "success"]]}'; mr
ok "$rc|$(lines | wc -l | tr -d ' ')|$(ncalls head_sha)" "0|0|0" "M9 (e): no ref (a 404): nothing"
fresh m9f
C=cccccccccccccccccccccccccccccccccccccccc
fx '{"runs": [[1, "success"]], "ref": "'$C'", "head": {"'$C'": [[40, "success", 1, "completed", "'$C'"]]}}'; mr
ok "$rc|$(ncalls head_sha)|$(lines | wc -l | tr -d ' ')" "0|1|0" "M9 (f): C in no listed run: one runs?head_sha call, proven by its success"
gl; mr
ok "$rc|$(ncalls head_sha)" "0|0" "M9 (f): … a second pass makes no runs?head_sha call (the proof cached by sha)"

# ── M11 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
# m11 <name> <a|b> — ro-a (Demo, its first merge 2026-11-12) and ro-b (Other, 2026-11-15) on one repo and one Mac's
# dirs, the one named running first; the history grows from G, R (red at attempt 2) to G, R, R2 (covered), S (green)
H11B='"runs": [[1, "success"], [2, "failure", 2], [3, "failure"], [4, "success"]], "attempts": {"2/1": "failure"}, "jobs": {"2/1": [[21, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}]], "2/2": [[24, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}]], "3/1": [[31, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}]]}, "compare": [[1, 2, [101, 102]]], "ref": 4'
m11() {
  fresh "$1"; local a="$F/tasks/a-rollout-2026-11-12.md" b="$F/tasks/b-rollout-2026-11-15.md" one two
  rm -f "$RO" "$F"/tasks/q*.md
  QP=qa PJ=Demo QST=done QFM='merged: 2026-11-12T10:00+00:00
' mkro "$a"; printf '| 3 | [[qa3\\|qa3]] | single-file | — |\n' >> "$a"
  printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[a-rollout-2026-11-12]]"\nprojects:\n  - "[[Demo]]"\n---\n\nbody\n' > "$F/tasks/qa3.md"
  QP=qb PJ=Other QST=done QFM='merged: 2026-11-15T10:00+00:00
' mkro "$b"; printf '| 3 | [[qb3\\|qb3]] | single-file | — |\n' >> "$b"
  printf -- '---\ntags: [task]\nstatus: open\nrollout: "[[b-rollout-2026-11-15]]"\nprojects:\n  - "[[Other]]"\n---\n\nbody\n' > "$F/tasks/qb3.md"
  if [ "$2" = a ]; then one=$a; two=$b; else one=$b; two=$a; fi
  fx "{$RED2, \"ref\": 1}"; RO=$one; mr; r1=$rc; RO=$two; mr; r2=$rc
  fx "{$H11B}"; RO=$one; NOW=2026-11-17T01:00:00Z mr; r3=$rc; RO=$two; NOW=2026-11-17T01:00:00Z mr; r4=$rc
}
strip() { python3 -c 'import json,sys
for l in open(sys.argv[1]):
    d = json.loads(l); [d.pop(k) for k in ("ts", "host", "rollout")]; print(json.dumps(d, sort_keys=True))' "$THREAD_EVENTS_DIR/master-runs.jsonl"; }
m11 m11 a
ok "$r1|$r2|$r3|$r4|$(tasks)" "0|0|0|0|$T22.md" "M11: ro-a files; ro-b's later passes add no task"
ok "$(lines | awk '{print $1, $2}' | tr '\n' ';')" "red 1002;red 1003;green 1004;" "M11: … one line per key: R's red, R2's covered red, S's green"
ok "$(fmv "$T22" rollout)|$(grep -c "$T22" "$F/tasks/a-rollout-2026-11-12.md")|$(grep -c "$T22" "$F/tasks/b-rollout-2026-11-15.md")" '"[[a-rollout-2026-11-12]]"|1|0' "M11: … joined into ro-a alone"
ok "$(python3 -c 'import json,sys; print(sorted({json.loads(l)["rollout"] for l in open(sys.argv[1])}))' "$THREAD_EVENTS_DIR/master-runs.jsonl")" "['a-rollout-2026-11-12']" "M11: … every line ro-a's"
SA=$(strip); m11 m11-swapped b; SB=$(strip)
ok "$SB" "$SA" "M11: the swapped copy (ro-b first) writes the same since, trail, key fields and stem: only rollout and ts differ"
ok "$(field green trailMinutes)|$(field green followups)|$(field green since)" "80|[\"$T22\"]|\"$(sha 1)\"" "M11: … the green's trail and followups from history"

# ── M12 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m12
A12="$F/tasks/a-rollout-2026-11-12.md"; B12="$F/tasks/b-rollout-2026-11-15.md"; rm -f "$RO" "$F"/tasks/q*.md
QP=qa QST=done QFM='merged: 2026-11-12T10:00+00:00
' mkro "$A12"; QP=qb PJ=Other mkro "$B12"
fx '{"runs": [[1, "success"], [2, null, 1, "in_progress"]], "ref": 1}'; RO=$A12; mr
ok "$rc|$(lines | wc -l | tr -d ' ')|$(tasks)" "0|0|" "M12: ro-a complete, the run still in progress at its ceremony pass: nothing"
fx "{$RED2, \"ref\": 1}"; RO=$B12; NOW=2026-11-17T02:00:00Z mr
ok "$rc|$(tasks)|$(fmv "$T22" rollout)|$(qrows | head -1 | grep -c "$T22")" "0|$T22.md|\"[[b-rollout-2026-11-15]]\"|1" "M12: later ro-b (another project on the repo) reads the run, files the task and joins it"
ok "$(sed -n '/^projects:/{n;p;}' "$F/tasks/$T22.md")" '  - "[[Other]]"' "M12: … its projects: ro-b's"
fresh m12b
A12="$F/tasks/a-rollout-2026-11-12.md"; rm -f "$RO" "$F"/tasks/q*.md
QP=qa QST=done QFM='merged: 2026-11-12T10:00+00:00
' mkro "$A12"; RO=$A12
fx "{$RED2, \"ref\": 1}"; mr
ok "$rc|$(tasks)|$(fmv "$T22" rollout)" "0|$T22.md|" "M12: ro-a complete with a confirmed red: the task is filed loose"
has "$out" "master-runs: not joined: --rollout a-rollout-2026-11-12 is complete" "M12: … not joined: complete"
ok "$(lines | awk '{print $1, $6}')" "red $T22" "M12: … its line names it"

# ── M16 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
H16='"runs": [[1, "success"], [2, "failure"], [3, null, 1, "queued"]], "jobs": {"2/1": [[61, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}], [62, '"$J2"', "failure", {"suites": ["tests/b.test.sh"]}]]}'
counted() { calls | grep -c 'attempts/1/jobs\|/logs' || true; }
entries() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sum(len(d[k]) for k in ("attempts","jobs","suites","annotations","compares")))' "$F/locks/master-runs-o.r.json"; }
fresh m16a; export THREAD_MASTER_RUNS_READS=1
fx "{$H16}"
for pass in 1 2; do
  gl; mr
  ok "$rc|$out|$(counted)|$(entries)|$(lines | wc -l | tr -d ' ')" "8|master-runs: not read (read budget)|1|$pass|0" "M16 (a) pass $pass: one counted read, the cache one entry larger, not read (read budget)"
done
gl; mr
ok "$rc|$(counted)|$(lines)" "0|1|unconfirmed 1002 1 next-run - -" "M16 (a) pass 3: the last read, then R's unconfirmed line, exit 0"
unset THREAD_MASTER_RUNS_READS
fresh m16b; export THREAD_MASTER_RUNS_SECONDS=0
fx "{$H16, \"ref\": 1}"
for pass in 1 2 3; do
  gl; mr
  ok "$rc|$(printf '%s' "$out" | tail -1)|$(counted)|$(ncalls 'git/ref')" "8|master-runs: not read (pass deadline)|1|0" "M16 (b) pass $pass: only the exempt calls (one counted read), no ref read, not read (pass deadline)"
done
ok "$(lines)" "unconfirmed 1002 1 next-run - -" "M16 (b): … pass 3 wrote R's line"
unset THREAD_MASTER_RUNS_SECONDS

# ── M17 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m17
fx '{"runs": [[1, "success"], [2, "failure", 2], [3, "failure"]], "attempts": {"2/1": "failure"}, "jobs": {"2/1": [[21, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}]], "2/2": [[24, '"$J1"', "failure", {"suites": ["tests/a.test.sh"]}]], "3/1": [[31, '"$J1"', "failure", {"suites": ["tests/b.test.sh"]}]]}, "compare": [[1, 2, [101]]], "ref": 1}'
q0=$(cksum < "$RO"); mr --dry-run
ok "$rc|$(tasks)|$(cksum < "$RO")|$(ls "$THREAD_EVENTS_DIR" | wc -l | tr -d ' ')|$(ls "$F/locks" | wc -l | tr -d ' ')|$(ncalls 'run rerun')" "0||$q0|0|0|0" "M17: --dry-run: no task, no Queue row, no line, no cache, no ledger, no re-run"
has "$out" "master-runs: would re-run run 1003 (#3)" "M17: … it prints the planned re-run"
has "$out" "master-runs: would file $T22" "M17: … the task"
has "$out" "master-runs: would write red run 1002 attempt 2" "M17: … and the line"

# ── M18 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m18
fx "{$RED1}"
python3 -c 'import fcntl,sys,time; f=open(sys.argv[1],"a"); fcntl.flock(f, fcntl.LOCK_EX); open(sys.argv[2],"w").write("held"); time.sleep(60)' \
  "$F/locks/master-runs-o.r.lock" "$F/held" & HOLDER=$!
for _ in $(seq 1 200); do [ -e "$F/held" ] && break; sleep 0.05; done
THREAD_NOTE_LOCK_TIMEOUT=1 mr
kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
ok "$rc|$out|$(lines | wc -l | tr -d ' ')|$(tasks)|$(ncalls 'run rerun')|$(test -e "$F/locks/master-runs-o.r.reruns.json" && echo ledger)" "8|master-runs: not read (master-runs lock busy)|0||0|" "M18: the lock busy: exit 8, not read, no line, no task, no re-run, the ledger untouched"

# ── M20 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m20
fx "{$RED1}"; printf '1' > "$G/rerun.rc"; printf 'HTTP 403: Resource not accessible by integration\n' > "$G/rerun.err"
mr
ok "$rc|$(lines | wc -l | tr -d ' ')|$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["refusals"])' "$F/locks/master-runs-o.r.reruns.json")" "0|0|{'1002/1': 403}" "M20 pass 1: GitHub refuses the re-run: exit 0, no line, the ledger holds the refusal"
mr
ok "$rc|$(lines)|$(ncalls 'run rerun')" "0|unconfirmed 1002 1 refused - -|1" "M20 pass 2: R's line, retest refused, no second re-run"

# ── M21 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m21
P21="$F/root"; git -c init.defaultBranch=master init -q "$P21"; git -C "$P21" config remote.origin.url "file://$F/origin.git"
PROOT=$P21 mkro "$RO"; fx "{$RED1}"; mr
ok "$rc|$(calls | wc -l | tr -d ' ')" "0|0" "M21: no GitHub origin (a file:// remote): exit 0, no gh call"
has "$out" "master-runs: no GitHub origin (file://" "M21: … one line says so"
fresh m21b
fx '{"noworkflow": true}'; mr
ok "$rc|$out|$(lines | wc -l | tr -d ' ')" "0|master-runs: no full-suite.yml workflow on o/r: nothing to read|0" "M21: a 404 on the full-suite workflow: exit 0, nothing"

# ── M22 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m22a
fx "{$RED2, \"ref\": 1}"; mr
python3 -c 'import sys
ro, task = sys.argv[1:]
keep = [l for l in open(ro) if "master-red-" not in l]; open(ro, "w").write("".join(keep))
keep = [l for l in open(task) if not l.startswith("rollout:")]; open(task, "w").write("".join(keep))' "$RO" "$F/tasks/$T22.md"
: > "$THREAD_EVENTS_DIR/master-runs.jsonl"
mr
ok "$rc|$(tasks)|$(lines)" "0|$T22.md|red 1002 2 rerun tests/a.test.sh $T22" "M22 (a): a task with no line (a crash): the next pass writes the line naming it, its suites, no second file"
ok "$(fmv "$T22" rollout)|$(qrows | head -1 | grep -c "$T22")" '"[[r-rollout-2026-11-16]]"|1' "M22 (a): … and joins it again"
fresh m22b
fx "{$RED2, \"ref\": 1}"; : > "$THREAD_EVENTS_DIR/master-runs.jsonl"; chmod 0444 "$THREAD_EVENTS_DIR/master-runs.jsonl"
mr
ok "$rc|$(tasks)|$(qrows | head -1 | grep -c "$T22")|$(lines | wc -l | tr -d ' ')" "1|$T22.md|1|0" "M22 (b): the line write fails: exit 1, the task filed and joined, no line"
has "$err" "ERROR: master-runs: line not written" "M22 (b): … ERROR: line not written"
chmod 0644 "$THREAD_EVENTS_DIR/master-runs.jsonl"; mr
ok "$rc|$(tasks)|$(lines)" "0|$T22.md|red 1002 2 rerun tests/a.test.sh $T22" "M22 (b): the next pass writes the line naming that stem, no second task"
fresh m22c
fx "{$RED2, \"ref\": 1}"
python3 - "$RR" "$RO" "$F/tasks" "$TMP/bin/gh" "$NOW" > "$F/out" 2> "$F/err" <<'PY'
import importlib.util, sys
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("rr", sys.argv[1]); rr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rr)
def cmd_join(ns):
    print("ERROR: join: cannot write: %s: Permission denied" % ns.rollout, file=sys.stderr)
    return 1
rr.cmd_join = cmd_join
args = rr._parser().parse_args(["master-runs", "--rollout", sys.argv[2], "--tasks-dir", sys.argv[3], "--gh-bin",
                                sys.argv[4], "--now", sys.argv[5]])
sys.exit(args.func(args))
PY
rc=$?; out=$(cat "$F/out"); err=$(cat "$F/err")
ok "$rc|$(tasks)|$(fmv "$T22" rollout)|$(qrows | grep -c master-red-)|$(lines | wc -l | tr -d ' ')" "1|$T22.md||0|0" "M22 (c): the join fails (exit 1): exit 1, the task filed, not joined, no line"
has "$err" "ERROR: master-runs: [[$T22]] not joined (cannot write:" "M22 (c): … ERROR: not joined"
mr
ok "$rc|$(tasks)|$(fmv "$T22" rollout)|$(qrows | head -1 | grep -c "$T22")|$(lines)" "0|$T22.md|\"[[r-rollout-2026-11-16]]\"|1|red 1002 2 rerun tests/a.test.sh $T22" "M22 (c): the next pass joins it at Queue row 1, stamps rollout:, writes one line naming it, no second task"

# ── M24 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
fresh m24
FILES=$(python3 -c 'import json; print(json.dumps(["tests/%s-%02d.test.mjs" % ("long-path-segment-" * 7, i) for i in range(60)]))')
PRS=$(python3 -c 'import json; print(json.dumps(list(range(1, 121))))')
fx '{"runs": [[1, "success"], [2, "failure"], [3, "failure"]], "jobs": {"2/1": [[21, '"$J1"', "failure", {"node": '"$FILES"'}]], "3/1": [[31, '"$J1"', "failure", {"node": '"$FILES"'}]]}, "compare": [[1, 3, '"$PRS"']], "ref": 1}'
mr
T24="master-red-r-$(sha 3 | cut -c1-12)-1"
ok "$rc|$(ncalls 'run rerun')|$(tasks)|$(lines | awk '{print $1, $2, $4}' | tr '\n' ';')" "0|0|$T24.md|unconfirmed 1002 next-run;red 1003 covered;" "M24: W unconfirmed, R covered: no re-run, one red line, one task, exit 0"
ok "$(python3 -c 'import json,sys
for l in open(sys.argv[1]):
    d = json.loads(l)
    print(d["outcome"], len(l.encode()) <= 16384, d.get("suitesTotal"), d.get("newSuitesTotal"), d.get("prsTotal"),
          d["suites"] == sorted(d["suites"]) and d["suites"][0].endswith("-00.test.mjs"), d.get("newSuites", ["-00.test.mjs"])[0].endswith("-00.test.mjs"))' "$THREAD_EVENTS_DIR/master-runs.jsonl")" "unconfirmed True 60 None None True True
red True 60 60 120 True True" "M24: … each line at most MAX_LINE, its totals 60, 60, 120, its lists cut in sort order"
ok "$(sed -n '/^master_red_suites:/,/^[a-z]/p' "$F/tasks/$T24.md" | grep -c '^  - ')|$(grep -c '^- `tests/long' "$F/tasks/$T24.md")|$(grep -c '(PR #' "$F/tasks/$T24.md")" "60|60|120" "M24: … the task's master_red_suites holds all 60, its body every file and all 120 PRs"
mr
ok "$rc|$(lines | wc -l | tr -d ' ')|$(tasks)" "0|2|$T24.md" "M24: a second pass adds nothing"

echo
if [ "$fail" -eq 0 ]; then echo "reconcile-rollout-master-runs: ALL PASS"; else echo "reconcile-rollout-master-runs: FAILED"; fi
exit "$fail"
