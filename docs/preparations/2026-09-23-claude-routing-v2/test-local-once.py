"""Create a retained private fixture and spend exactly one invocation per case.

Usage: python3 -I -B /absolute/test-local-once.py /absolute/new-private-fixture
Refuses an existing destination. This is a local preparation test, never a native
probe, and must not be run after the separate preparation allowance is exhausted.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "claude-pilot-verify-v2.py"
SCRIPT_HASH = hashlib.sha256(SCRIPT.read_bytes()).hexdigest()
WORK = (HERE / "work-policy.fixture.md").read_bytes()
REVIEW = (HERE / "review-policy.fixture.md").read_bytes().replace(
    b"WORK_SHA256", hashlib.sha256(WORK).hexdigest().encode("ascii"))
PILOT = Path("docs/pilots/claude-routing")
CASES = [
    ("baseline", "baseline", 0), ("partial", "partial", 0), ("complete", "complete", 0),
    ("empty-descendant", "invalid", 1), ("b-only", "invalid", 1),
    ("missing-clause", "invalid", 1), ("stale-digest", "invalid", 1),
    ("file-symlink", "invalid", 1), ("parent-symlink", "invalid", 1),
    ("extra-pilot-file", "invalid", 1), ("out-of-scope", "invalid", 1),
    ("dirty-repository", "invalid", 1),
]


def git(directory, *arguments):
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update(GIT_OPTIONAL_LOCKS="0", GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull,
               GIT_AUTHOR_DATE="2026-09-23T00:00:00+00:00", GIT_COMMITTER_DATE="2026-09-23T00:00:00+00:00")
    return subprocess.check_output(["git", "--no-optional-locks", "-c", "core.hooksPath=" + os.devnull,
        "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false",
        "-c", "user.name=Local verifier fixture", "-c", "user.email=fixture@example.invalid",
        *arguments], cwd=directory, env=env, stderr=subprocess.PIPE).decode().strip()


def write(directory, path, content):
    target = directory / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(content)


def snapshot(directory):
    files = {}
    for current, folders, names in os.walk(directory, followlinks=False):
        for name in sorted(folders + names):
            path = Path(current) / name
            if path.is_symlink():
                files[str(path.relative_to(directory))] = {"symlink": os.readlink(path)}
            elif path.is_file():
                files[str(path.relative_to(directory))] = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    index = Path(git(directory, "rev-parse", "--git-path", "index"))
    if not index.is_absolute():
        index = directory / index
    return {"head": git(directory, "rev-parse", "HEAD"), "files": files,
            "indexSha256": hashlib.sha256(index.read_bytes()).hexdigest()}


def main(destination):
    destination = Path(destination).resolve()
    # No overwrite, resume or counter reset. The private ledger is append-only.
    destination.mkdir(parents=True, exist_ok=False, mode=0o700)
    repository = destination / "repository"
    repository.mkdir()
    git(repository, "init", "-b", "fixture-base")
    write(repository, Path("README.md"), WORK)
    git(repository, "add", "README.md")
    git(repository, "commit", "-m", "Local fixture base only")
    base = git(repository, "rev-parse", "HEAD")
    payload = destination / "parent-payload"
    write(payload, Path("claude-routing/work-policy.md"), WORK)
    records = []
    summary = {"version": 2, "kind": "local-deterministic-fixture-only", "nativeDispatches": 0,
               "ceiling": 12, "verifierInvocations": 0, "base": base, "scriptSha256": SCRIPT_HASH,
               "python": {"path": sys.executable, "version": sys.version.splitlines()[0]},
               "git": {"path": shutil.which("git"), "version": git(repository, "--version")},
               "workFixtureSha256": hashlib.sha256(WORK).hexdigest(),
               "reviewFixtureSha256": hashlib.sha256(REVIEW).hexdigest(), "cases": records}
    for number, (name, expected_mode, expected_exit) in enumerate(CASES, 1):
        case = destination / "cases" / name
        git(repository, "worktree", "add", "--detach", str(case), base)
        if name not in ("baseline", "empty-descendant", "b-only", "file-symlink", "parent-symlink"):
            write(case, PILOT / "work-policy.md", WORK)
        if name in ("complete", "b-only", "stale-digest"):
            review = REVIEW if name != "stale-digest" else REVIEW.replace(
                hashlib.sha256(WORK).hexdigest().encode(), b"0" * 64)
            write(case, PILOT / "review-policy.md", review)
        if name == "missing-clause":
            write(case, PILOT / "work-policy.md", b"\n".join(
                line for line in WORK.split(b"\n") if not line.startswith(b"- Calls and verifier")))
        elif name == "file-symlink":
            (case / PILOT).mkdir(parents=True)
            (case / PILOT / "work-policy.md").symlink_to("../../../README.md")
        elif name == "parent-symlink":
            (case / "docs").mkdir()
            (case / "docs/pilots").symlink_to(payload, target_is_directory=True)
        elif name == "extra-pilot-file":
            write(case, PILOT / "extra.md", b"Extra pilot file must fail.\n")
        elif name == "out-of-scope":
            write(case, Path("README.md"), WORK + b"\nOut-of-scope committed edit.\n")
        if name != "baseline":
            git(case, "add", "--all")
            git(case, "commit", "--allow-empty", "-m", "Local fixture: " + name)
        if name == "dirty-repository":
            write(case, Path("untracked.txt"), b"Untracked repository dirt.\n")
        before = snapshot(case)
        if hashlib.sha256(SCRIPT.read_bytes()).hexdigest() != SCRIPT_HASH:
            raise AssertionError("verifier changed during the one-time suite")
        command = [sys.executable, "-I", str(SCRIPT), "--base", base]
        reservation = {"invocation": number, "case": name, "command": command, "cwd": str(case),
                       "scriptSha256": SCRIPT_HASH}
        with (destination / "invocations.jsonl").open("a") as ledger:
            ledger.write(json.dumps(reservation, sort_keys=True) + "\n")
            ledger.flush()
            os.fsync(ledger.fileno())
        # This is the only verifier subprocess launch in this test. No retries.
        result = subprocess.run(command, cwd=case, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, check=False)
        after = snapshot(case)
        report = json.loads(result.stdout)
        passed = (report == {"mode": expected_mode, "head": before["head"]}
                  and result.returncode == expected_exit and not result.stderr and before == after)
        records.append({**reservation, "expectedMode": expected_mode, "expectedExit": expected_exit,
                        "exit": result.returncode, "stdout": result.stdout, "stderr": result.stderr,
                        "report": report, "unchanged": before == after, "passed": passed,
                        "before": before, "after": after})
        summary["verifierInvocations"] = number
        (destination / "results.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
        print(f"{number:02d} {name}: exit={result.returncode} mode={report['mode']} unchanged={before == after} passed={passed}")
        if not passed:
            raise AssertionError("Stop on unexpected outcome; no automatic rerun is authorised")
    print(json.dumps({"verifierInvocations": len(records), "allPassed": True,
                      "scriptSha256": SCRIPT_HASH, "evidence": str(destination / "results.json")}))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Supply one new absolute private fixture directory")
    main(sys.argv[1])
