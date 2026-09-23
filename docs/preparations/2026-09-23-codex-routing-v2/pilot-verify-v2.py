"""Fixed-command verifier for the proposed one-task, two-document pilot.

The exact pristine seed commit is a valid baseline. Every other commit must
contain both complete contract documents. This does not implement task-stage
routing, and cannot validate the superseded work-only intermediate task.
"""
import json
import pathlib
import subprocess
import sys

BASE_COMMIT = "89a7ff1d409554f5442b548c967408f24bfa27a4"
DIRECTORY = pathlib.Path("docs/pilots/codex-routing")
EVIDENCE = (
    "Evidence: thread-skill@8c5980bb0339310f537488bf4cfde599da1e6e07:"
    "docs/implementation/2026-09-23-codex-routing-capability-report.md."
)
REQUIRED_LINES = {
    "work-policy.md": (
        "# Work policy",
        "Model: gpt-6-astra.",
        "Easy work starts at high; difficult work starts at xhigh.",
        "The supported maximum for this model is ultra.",
        "Requested, resolved and observed settings are recorded separately.",
        "No recovery alternative is configured.",
        "Direct maximum probes do not prove a failed correction ladder.",
        EVIDENCE,
    ),
    "review-policy.md": (
        "# Review policy",
        "Engine: review-agent.",
        "Independent review starts at the xhigh floor.",
        "The reviewer runs in a clean child context.",
        "Native evidence must bind the request, independent child, exact reviewed commit and actual invocation.",
        "The bundled engine performs a single pass and does not delegate.",
        "A model's self-report is insufficient evidence of its runtime settings.",
        "Thread host receipt capture remains a separate acceptance gate.",
        EVIDENCE,
    ),
}


def git(*arguments):
    return subprocess.check_output(
        ["git", *arguments], text=True, stderr=subprocess.PIPE
    ).strip()


def verify():
    if len(sys.argv) != 1:
        raise ValueError("This fixed verifier accepts no stage or task arguments.")
    if pathlib.Path(git("rev-parse", "--show-toplevel")).resolve() != pathlib.Path.cwd().resolve():
        raise ValueError("Run the fixed verifier at the candidate repository root.")
    head = git("rev-parse", "HEAD")
    if git("status", "--porcelain", "--untracked-files=all"):
        raise ValueError("The candidate checkout must be clean.")
    ancestry = subprocess.run(
        ["git", "merge-base", "--is-ancestor", BASE_COMMIT, head],
        capture_output=True,
        text=True,
    )
    if ancestry.returncode != 0:
        raise ValueError("The candidate is not descended from the pinned baseline.")
    for component in (pathlib.Path("docs"), pathlib.Path("docs/pilots"), DIRECTORY):
        if component.is_symlink():
            raise ValueError("Pilot directory components must not be symlinks.")
    if head == BASE_COMMIT:
        if DIRECTORY.exists():
            raise ValueError("The pinned baseline must have no pilot directory.")
        return {"status": "pass", "mode": "baseline", "head": head}

    errors = []
    for filename, required in REQUIRED_LINES.items():
        path = DIRECTORY / filename
        if path.is_symlink() or not path.is_file():
            errors.append(str(path) + ": required ordinary file missing")
            continue
        lines = {line.strip() for line in path.read_text(encoding="utf-8").splitlines()}
        for line in required:
            if line not in lines:
                errors.append(str(path) + ": missing contract line: " + line)
    if errors:
        raise ValueError("; ".join(errors))
    return {
        "status": "pass",
        "mode": "documents",
        "head": head,
        "validatedPaths": [str(DIRECTORY / name) for name in REQUIRED_LINES],
    }


if __name__ == "__main__":
    try:
        result = verify()
    except (ValueError, OSError, UnicodeError, subprocess.SubprocessError) as error:
        print(json.dumps({"status": "fail", "error": str(error)}, sort_keys=True))
        sys.exit(1)
    print(json.dumps(result, sort_keys=True))
