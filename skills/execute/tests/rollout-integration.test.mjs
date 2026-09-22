/** Full canonical engine → native journal → host fixture. No model or GitHub writes. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as host from "../scripts/rollout-host.mjs";
const adapter = process.env.THREAD_TEST_NATIVE_ADAPTER;
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
function rig(t, harness, { parallel = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-integrated-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "repo");
  git("init", "-q", "-b", "master", repo);
  git("-C", repo, "config", "user.email", "fixture@example.test");
  git("-C", repo, "config", "user.name", "Fixture");
  fs.writeFileSync(path.join(repo, "check.txt"), "unchanged fixture\n");
  git("-C", repo, "add", ".");
  git("-C", repo, "commit", "-qm", "baseline");
  const head = git("-C", repo, "rev-parse", "HEAD");
  git(
    "-C",
    repo,
    "remote",
    "add",
    "origin",
    "https://github.com/fixture/project.git",
  );
  git("-C", repo, "update-ref", "refs/pull/1/head", head);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const actualGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  fs.writeFileSync(
    path.join(bin, "git"),
    `#!/usr/bin/env python3\nimport os,sys\na=sys.argv[1:]\nif 'fetch' in a and 'origin' in a:a[a.index('origin')]=os.environ['THREAD_RIG_REPO']\nos.execv(${JSON.stringify(actualGit)},[${JSON.stringify(actualGit)}]+a)\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/usr/bin/env python3\nimport json,os,sys\na=sys.argv[1:]\nif a[:2]==['pr','view']:\n merged=os.path.exists(os.environ['THREAD_RIG_MERGED'])\n print(json.dumps({'number':1,'url':'https://github.com/fixture/project/pull/1','state':'MERGED' if merged else 'OPEN','baseRefName':'master','headRefOid':os.environ['THREAD_RIG_HEAD'],'mergeStateStatus':'CLEAN','mergeCommit':{'oid':os.environ['THREAD_RIG_HEAD']} if merged else None}))\nelif a[:2]==['pr','merge']:open(os.environ['THREAD_RIG_MERGED'],'w').write('fixture merged')\nelse:sys.exit(1)\n`,
    { mode: 0o755 },
  );
  const env = {
      PATH: bin + path.delimiter + process.env.PATH,
      THREAD_RIG_REPO: repo,
      THREAD_RIG_HEAD: head,
      THREAD_RIG_MERGED: path.join(dir, "merged"),
    },
    saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
  const tasks = (
    parallel ? ["first", "follower", "independent"] : ["first"]
  ).map((id) => {
    const sourcePath = path.join(dir, id + ".md"),
      requirements = `# ${id}\nPreserve fixture behaviour.\n`;
    fs.writeFileSync(sourcePath, requirements);
    return {
      id,
      sourcePath,
      requirements,
      scope: "single-file",
      planGate: true,
      acceptance: ["Verifier true and independent fixture review"],
      dependsOn: id === "follower" ? ["first"] : [],
      conflicts: [],
      allowance: { calls: 32, verifierRuns: 32, recoveries: 3 },
    };
  });
  const owner = {
    harness,
    account: "fixture-account",
    session: "fixture-root",
    epoch: 1,
  };
  return {
    dir,
    repo,
    head,
    owner,
    record: path.join(dir, "record"),
    spec: {
      protocolVersion: 4,
      rolloutId: "fixture-rollout",
      repository: {
        path: repo,
        identity: "github.com/fixture/project",
        baseBranch: "master",
        verifier: "test -f check.txt",
      },
      authority: {
        outcomes: ["Preserve fixture behaviour"],
        constraints: ["fixture only"],
        allowedActions: ["merge"],
        reservedDecisions: [],
        gates: [],
        mergeEffects: [],
      },
      tasks,
    },
    config: {
      nativeAdapter: adapter,
      account: owner.account,
      maxConcurrent: 3,
      models: {
        opus: { model: "fixture-first-tier" },
        fable: { model: "fixture-stronger-tier" },
      },
      engine: { maxIterations: 2, maxPlanRounds: 2, maxReviewRounds: 2 },
    },
  };
}
let childNumber = 0;
async function dispatch(f, request, owner = f.owner) {
  const claim = await f.host.claim(f.record, request.taskId, request.id, owner);
  assert.ok(claim.claimToken);
  const childId = `${owner.harness}-fixture-child-${++childNumber}`;
  await f.host.bind(
    f.record,
    request.taskId,
    request.id,
    claim.claimToken,
    childId,
    owner,
  );
  return { claim, childId };
}
function output(label, f) {
  if (label.startsWith("plan-judge:"))
    return { verdict: "approve", feedback: [] };
  if (label.startsWith("plan:") || label.startsWith("plan-revise:"))
    return {
      ready: true,
      blocked: false,
      blockerCause: "",
      plan: "## Files to modify\nNone for fixture\n## Test strategy\nRun verifier\n### Gated inputs\nNone",
    };
  if (label.startsWith("review:"))
    return { verdict: "approve", feedback: [], reviewedHead: f.head };
  if (label.startsWith("implement:") || label.startsWith("revise:"))
    return {
      verified: true,
      verifiedHead: f.head,
      blocked: false,
      escalate: false,
      prUrl: "https://github.com/fixture/project/pull/1",
      branch: "fixture-branch",
      worktreePath: f.repo,
      blockerDiagnosis: "",
      summary: "Fixture preserves baseline",
      gatedInputs: [],
    };
  throw Error("unexpected real engine stage " + label);
}
async function accept(
  f,
  request,
  claim,
  childId,
  owner = f.owner,
  nativeEpoch = claim.caller.epoch,
) {
  await f.host.accept(
    f.record,
    request.taskId,
    {
      version: 1,
      runId: claim.runId,
      requestId: request.id,
      claimToken: claim.claimToken,
      childId,
      caller: {
        harness: owner.harness,
        account: owner.account,
        session: owner.session,
        epoch: nativeEpoch,
      },
      status: "ok",
      output: output(request.label, f),
    },
    owner,
  );
}
async function converge(f, id, owner = f.owner) {
  for (let n = 0; n < 12; n++) {
    const status = await f.host.advance(f.record, owner);
    if (status.readyToMerge.includes(id)) return status;
    const request = status.requests.find((r) => r.taskId === id && r.claimable);
    assert.ok(request, JSON.stringify(status));
    const { claim, childId } = await dispatch(f, request, owner);
    await accept(f, request, claim, childId, owner);
  }
  throw Error("fixture exceeded bounded real engine stages");
}
for (const harness of ["claude", "codex"])
  test(
    `real engine and adapter ${harness} fixture preserves recovery and exact-head approval`,
    {
      skip:
        !adapter && "set THREAD_TEST_NATIVE_ADAPTER to tested shared adapter",
    },
    async (t) => {
      const f = rig(t, harness);
      await host.initialise(f.record, f.spec, f.owner, f.config);
      f.host = await import(
        pathToFileURL(host.status(f.record).pinnedHost).href
      );
      const request = (await f.host.advance(f.record, f.owner)).requests.find(
        (r) => r.claimable,
      );
      const { claim, childId } = await dispatch(f, request);
      const replacement = {
        ...f.owner,
        session: "fixture-replacement",
        epoch: 2,
      };
      await f.host.recover(f.record, replacement, {
        previousCaller: {
          harness,
          account: f.owner.account,
          session: f.owner.session,
        },
        previousEpoch: 1,
        previousOwnerStopped: true,
        reason: "Fixture native owner terminal evidence",
        requests: {
          [request.id]: {
            childId,
            status: "running",
            evidence: "Fixture native registry still has same child",
          },
        },
      });
      await assert.rejects(f.host.advance(f.record, f.owner), /owner|epoch/);
      await accept(f, request, claim, childId, replacement, 2);
      await converge(f, "first", replacement);
      await f.host.merge(f.record, "first", replacement);
      const s = f.host.status(f.record);
      assert.equal(s.complete, 1);
      assert.equal(s.rolloutComplete, true);
      const record = JSON.parse(
        fs.readFileSync(path.join(f.record, "state.json")),
      );
      assert.equal(record.tasks.first.approval.head, f.head);
      assert.equal(record.execution.pools.first.spent.recoveries, 1);
      assert.ok(record.execution.pools.first.spent.calls >= 4);
    },
  );
test(
  "real task engine releases follower while independent native request remains dispatched",
  { skip: !adapter && "set THREAD_TEST_NATIVE_ADAPTER" },
  async (t) => {
    const f = rig(t, "codex", { parallel: true });
    await host.initialise(f.record, f.spec, f.owner, f.config);
    f.host = await import(pathToFileURL(host.status(f.record).pinnedHost).href);
    const initial = await f.host.advance(f.record, f.owner);
    const independent = initial.requests.find(
      (r) => r.taskId === "independent" && r.claimable,
    );
    const held = await dispatch(f, independent);
    await converge(f, "first");
    await f.host.merge(f.record, "first", f.owner);
    const next = await f.host.advance(f.record, f.owner);
    assert.ok(
      next.requests.some((r) => r.taskId === "follower" && r.claimable),
    );
    assert.ok(
      next.requests.some(
        (r) =>
          r.taskId === "independent" &&
          r.childId === held.childId &&
          r.status === "dispatched",
      ),
    );
  },
);
