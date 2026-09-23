/** Full canonical engine → native journal → host fixture. No model or GitHub writes. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
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
        verifierInputs: [],
      },
      authority: {
        outcomes: ["Preserve fixture behaviour"],
        constraints: ["fixture only"],
        allowedActions: ["merge"],
        reservedDecisions: [],
        gates: [],
        mergeEffects: [],
        evidence: { userText: "Authorise isolated fixture only.", context: "No live model or GitHub action.", source: "fixture:user-request" },
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
  result = output(request.label, f),
  beforeAccept,
) {
  let receipt;
  if (request.label.startsWith("review:")) {
    const evidencePath = path.join(f.dir, `native-review-${request.id}.json`);
    fs.writeFileSync(evidencePath, JSON.stringify({ fixture: true, requestId: request.id, childId, reviewedHead: f.head }));
    receipt = { version: 1, requestId: request.id, childId, harness: owner.harness,
      engine: owner.harness === "claude" ? "code-review" : "review-agent", reviewLevel: "xhigh",
      reviewedHead: f.head, invocationId: `fixture-${request.id}`, nativeEvidence: { path: evidencePath } };
    if (claim.options.reviewContract?.protocol === "claude-fork-v1" && !f.skipForkFixture) {
      const forkId = `${childId}-builtin`, invocationId = receipt.invocationId;
      const binding = { childId: forkId, invocationId };
      await f.host.bindReviewFork(f.record, request.taskId, request.id, claim.claimToken, binding, owner);
      const text = JSON.stringify(result.feedback);
      const proof = { ...binding, status: "complete", output: text, reviewedHead: f.head,
        routing: { requestId: request.id, childId: forkId, policyDigest: claim.native.routing.resolved.policyDigest,
          requested: claim.native.routing.requested, resolved: claim.native.routing.resolved,
          observed: { model: claim.native.routing.resolved.model, effort: claim.native.routing.resolved.effort,
            source: "native-runtime", evidence: "TEST FIXTURE fork runtime observation" } },
        evidence: "TEST FIXTURE built-in completion receipt" };
      await f.host.recordReviewFork(f.record, request.taskId, request.id, claim.claimToken, proof, owner, { path: evidencePath });
      const fork = f.host.status(f.record).requests.find(r => r.id === request.id).reviewFork;
      receipt.version = 2;
      receipt.fork = { childId: forkId, resultHash: fork.resultHash };
      receipt.relay = { childId, outputHash: crypto.createHash("sha256").update(text).digest("hex"), evidence: "TEST FIXTURE same-child native relay" };
    }
  }
  const envelope = {
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
      output: result,
      ...(claim.native.routing ? { routing: {
        requestId: request.id, childId, policyDigest: claim.native.routing.resolved.policyDigest,
        requested: claim.native.routing.requested, resolved: claim.native.routing.resolved,
        observed: { model: claim.native.routing.resolved.model, effort: claim.native.routing.resolved.effort,
          source: "native-runtime", evidence: "TEST FIXTURE native observation, not live proof" },
      } } : {}),
    };
  if (beforeAccept) await beforeAccept(envelope, receipt);
  await f.host.accept(
    f.record,
    request.taskId,
    envelope,
    owner,
    receipt,
  );
  return { envelope, receipt };
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

async function routedRig(t, harness, difficulty = "easy") {
  const f = rig(t, harness);
  const routing = await import(pathToFileURL(path.join(path.dirname(adapter), "native_routing.mjs")).href);
  const normalModel = harness === "claude" ? "claude-opus-5-5" : "gpt-fixture-normal";
  const recoveryModel = harness === "claude" ? "claude-fable-5-1" : "gpt-fixture-recovery";
  const supportedEfforts = ["low", "medium", "high", "xhigh", "max"];
  f.config.routingPolicy = routing.createRoutingPolicy({ harness, normalModel, recoveryModel, difficulty,
    capabilities: { harness, verified: true, source: "native-capability-preflight", evidence: "TEST FIXTURE capabilities only",
      models: { [normalModel]: { supportedEfforts }, [recoveryModel]: { supportedEfforts } } } });
  f.config.engine = { maxIterations: 3, maxPlanRounds: 3, maxReviewRounds: 3 };
  f.spec.tasks[0].difficulty = difficulty;
  f.spec.authority.evidence = { userText: "  Exact fixture authorisation.\nKeep this second line.  ",
    context: "Fixture context with a trailing newline.\n", source: "fixture:user-request" };
  const verifierInput = path.join(f.dir, "external-verifier.sh");
  fs.writeFileSync(verifierInput, "test -f check.txt\n");
  f.spec.repository.verifier = `sh '${verifierInput}'`;
  f.spec.repository.verifierInputs = [verifierInput];
  return { ...f, normalModel, recoveryModel, verifierInput };
}

test("Claude review reserves wrapper and fork and refuses success without native fork evidence", { skip: !adapter }, async t => {
  const f = await routedRig(t, "claude");
  await host.initialise(f.record, f.spec, f.owner, f.config);
  f.host = await import(pathToFileURL(host.status(f.record).pinnedHost).href);
  let request, pair;
  for (let i = 0; i < 6; i++) {
    request = (await f.host.advance(f.record, f.owner)).requests.find(r => r.claimable);
    assert.ok(request);
    const before = f.host.status(f.record).allowances.first.spent.calls;
    pair = await dispatch(f, request);
    if (request.label.startsWith("review:")) {
      assert.equal(f.host.status(f.record).allowances.first.spent.calls, before + 2);
      assert.equal(pair.claim.reviewFork.status, "reserved");
      f.skipForkFixture = true;
      await assert.rejects(accept(f, request, pair.claim, pair.childId), /fork|protocol/);
      break;
    }
    await accept(f, request, pair.claim, pair.childId);
  }
  assert.ok(request.label.startsWith("review:"));
  f.skipForkFixture = false;
  const spent = f.host.status(f.record).allowances.first.spent.calls;
  await accept(f, request, pair.claim, pair.childId, f.owner, 1, output(request.label, f), async (envelope, receipt) => {
    await assert.rejects(f.host.accept(f.record, request.taskId, envelope, f.owner,
      { ...receipt, fork: { ...receipt.fork, childId: "different-fork" } }), /fork.*mismatch/);
    await assert.rejects(f.host.accept(f.record, request.taskId, envelope, f.owner,
      { ...receipt, relay: { ...receipt.relay, outputHash: "0".repeat(64) } }), /relay/);
  });
  assert.equal(f.host.status(f.record).allowances.first.spent.calls, spent);
});

test("missing fork recovery evidence cannot poison a later proven transfer", { skip: !adapter }, async t => {
  const f = await routedRig(t, "claude");
  await host.initialise(f.record, f.spec, f.owner, f.config);
  f.host = await import(pathToFileURL(host.status(f.record).pinnedHost).href);
  let request, pair;
  for (let i = 0; i < 6; i++) {
    request = (await f.host.advance(f.record, f.owner)).requests.find(r => r.claimable);
    pair = await dispatch(f, request);
    if (request.label.startsWith("review:")) break;
    await accept(f, request, pair.claim, pair.childId);
  }
  const binding = { childId: `${pair.childId}-builtin`, invocationId: `fixture-${request.id}` };
  await f.host.bindReviewFork(f.record, request.taskId, request.id, pair.claim.claimToken, binding, f.owner);
  const before = f.host.status(f.record).allowances.first.spent;
  const next = { ...f.owner, session: "recovered-fork-owner", epoch: 2 };
  const evidence = { previousCaller: { harness: f.owner.harness, account: f.owner.account, session: f.owner.session },
    previousEpoch: 1, previousOwnerStopped: true, reason: "TEST FIXTURE old native owner stopped",
    requests: { [request.id]: { childId: pair.childId, status: "running", evidence: "TEST FIXTURE wrapper remains attached" } } };
  await assert.rejects(f.host.recover(f.record, next, evidence), /fork/);
  assert.equal(f.host.status(f.record).recoveryPending, false);
  assert.deepEqual(f.host.status(f.record).allowances.first.spent, before);
  evidence.requests[request.id].reviewFork = { ...binding, status: "terminal", evidence: "TEST FIXTURE fork terminal with collected output" };
  await f.host.recover(f.record, next, evidence);
  f.owner = next;
  await accept(f, request, pair.claim, pair.childId, next, 2);
  assert.equal(f.host.status(f.record).allowances.first.spent.calls, before.calls);
  assert.equal(f.host.status(f.record).allowances.first.spent.recoveries, before.recoveries + 1);
  const done = await f.host.advance(f.record, next);
  assert.ok(done.readyToMerge.includes("first"));
});

for (const [harness, difficulty] of [["claude", "easy"], ["codex", "hard"]])
  test(`real policy/engine/adapter/host ${harness} ${difficulty} fixture preserves the full ladder and evidence`,
    { skip: !adapter && "set THREAD_TEST_NATIVE_ADAPTER" }, async t => {
      const f = await routedRig(t, harness, difficulty);
      await host.initialise(f.record, f.spec, f.owner, f.config);
      const pinnedHost = host.status(f.record).pinnedHost;
      f.host = await import(pathToFileURL(pinnedHost).href);
      const read = () => JSON.parse(fs.readFileSync(path.join(f.record, "state.json")));
      const initial = read();
      assert.deepEqual(initial.authority.evidence, f.spec.authority.evidence, "exact authority text survives preparation");
      assert.equal(initial.repository.verifierInputs[0].path, f.verifierInput);
      assert.match(initial.repository.verifierInputs[0].sha256, /^[a-f0-9]{64}$/);
      assert.equal(initial.host.release.routing.sha256.length, 64);
      assert.equal(initial.host.release.routingPolicy.sha256.length, 64);
      const calls = [];
      let reviewCount = 0;
      for (let n = 0; n < 12; n++) {
        const s = await f.host.advance(f.record, f.owner);
        if (s.readyToMerge.includes("first")) break;
        const request = s.requests.find(r => r.taskId === "first" && r.claimable);
        assert.ok(request, JSON.stringify(s));
        const { claim, childId } = await dispatch(f, request);
        calls.push({ label: request.label, ...claim.native.routing.resolved, role: claim.options.routing.role });
        if (n === 0) {
          const oldOwner = f.owner;
          f.owner = { ...oldOwner, session: "routing-fixture-replacement", epoch: 2 };
          await f.host.recover(f.record, f.owner, { previousCaller: { harness, account: oldOwner.account, session: oldOwner.session },
            previousEpoch: 1, previousOwnerStopped: true, reason: "TEST FIXTURE terminal owner inventory",
            requests: { [request.id]: { childId, status: "running", evidence: "TEST FIXTURE native child inventory" } } });
          await assert.rejects(f.host.advance(f.record, oldOwner), /owner|epoch/);
          f.host = await import(pathToFileURL(host.status(f.record).pinnedHost).href);
          assert.equal(host.status(f.record).pinnedHost, pinnedHost, "recovery resumes the pinned implementation");
          assert.equal(read().execution.pools.first.spent.calls, 1, "ownership recovery does not renew allowance");
        }
        const next = request.label.startsWith("review:") && ++reviewCount < 3
          ? { verdict: "changes", feedback: [`Fixture substantive quality failure ${reviewCount}`], reviewedHead: f.head }
          : output(request.label, f);
        const delivered = await accept(f, request, claim, childId, f.owner, 2, next,
          request.label.startsWith("review:") ? async (envelope, receipt) => {
            const spent = read().execution.pools.first.spent;
            await assert.rejects(f.host.accept(f.record, request.taskId, envelope, f.owner), /receipt required/);
            await assert.rejects(f.host.accept(f.record, request.taskId,
              { ...envelope, routing: { ...envelope.routing, observed: null } }, f.owner, receipt), /observation.*required/);
            assert.deepEqual(read().execution.pools.first.spent, spent, "invalid evidence spends no new allowance");
          } : undefined);
        const spent = read().execution.pools.first.spent;
        await f.host.accept(f.record, request.taskId, delivered.envelope, f.owner, delivered.receipt);
        assert.deepEqual(read().execution.pools.first.spent, spent, "identical delivery does not reserve another request");
      }
      assert.ok(f.host.status(f.record).readyToMerge.includes("first"));
      const beforeMerge = read();
      assert.equal(beforeMerge.tasks.first.routingState.qualityFailures, 2);
      assert.equal(beforeMerge.tasks.first.routingState.stage, "recovery");
      assert.equal(beforeMerge.tasks.first.attempt.result.reviewHistory.length, 2);
      assert.deepEqual(calls.filter(c => c.role === "work").map(c => [c.model, c.effort]), [
        [f.normalModel, difficulty === "hard" ? "xhigh" : "high"],
        [f.normalModel, difficulty === "hard" ? "xhigh" : "high"],
        [f.normalModel, "max"], [f.recoveryModel, "max"],
      ]);
      const run = Object.values(beforeMerge.host.runs)[0];
      const accepted = Object.values(run.accepted);
      assert.equal(accepted.length, 8, "plan + implementation + three independent reviews + two corrections");
      assert.ok(accepted.every(r => r.routing?.observed?.source === "native-runtime"));
      const reviews = accepted.filter(r => r.label.startsWith("review:"));
      assert.equal(reviews.length, 3);
      assert.ok(reviews.every(r => r.reviewReceipt?.reviewedHead === f.head && fs.existsSync(r.reviewReceipt.nativeEvidence.path)));
      assert.equal(beforeMerge.execution.pools.first.spent.calls, harness === "claude" ? 11 : 8);
      assert.equal(beforeMerge.execution.pools.first.spent.verifierRuns, 4);
      assert.equal(beforeMerge.execution.pools.first.spent.recoveries, 1);
      const verifierBytes = fs.readFileSync(f.verifierInput);
      fs.writeFileSync(f.verifierInput, "false # changed external verifier bytes\n");
      await assert.rejects(f.host.merge(f.record, "first", f.owner), /verifier input changed/);
      assert.equal(read().execution.pools.first.spent.verifierRuns, 4, "input drift stops before another reservation");
      fs.writeFileSync(f.verifierInput, verifierBytes);
      await f.host.merge(f.record, "first", f.owner);
      assert.equal(f.host.status(f.record).rolloutComplete, true);
      const final = read();
      assert.equal(final.tasks.first.approval.head, f.head);
      assert.equal(final.execution.pools.first.spent.verifierRuns, 5, "the combined postmerge integration verification remains charged");
    });

test("new-policy preparation refuses insufficient declared ladder allowance before native dispatch",
  { skip: !adapter && "set THREAD_TEST_NATIVE_ADAPTER" }, async t => {
    for (const [rollback, field, value] of [[false, "calls", 7], [false, "verifierRuns", 5],
      [true, "calls", 9], [true, "verifierRuns", 8]]) {
      const f = await routedRig(t, "claude");
      if (rollback) f.spec.authority.allowedActions.push("revert-run-owned");
      f.spec.tasks[0].allowance[field] = value;
      await assert.rejects(host.initialise(f.record, f.spec, f.owner, f.config), /allowance|headroom/);
      assert.equal(fs.existsSync(path.join(f.record, "state.json")), false);
    }
  });

test("native quota block after a quality failure preserves routing and PR in durable host state",
  { skip: !adapter && "set THREAD_TEST_NATIVE_ADAPTER" }, async t => {
    const f = await routedRig(t, "claude");
    f.spec.tasks[0].planGate = false;
    await host.initialise(f.record, f.spec, f.owner, f.config);
    f.host = await import(pathToFileURL(host.status(f.record).pinnedHost).href);
    const first = (await f.host.advance(f.record, f.owner)).requests.find(r => r.claimable);
    const initial = await dispatch(f, first);
    await accept(f, first, initial.claim, initial.childId, f.owner, 1,
      { ...output(first.label, f), verified: false, verifiedHead: "", escalate: true,
        failureKind: "quality", blockerDiagnosis: "TEST FIXTURE implementation is incorrect" });
    const second = (await f.host.advance(f.record, f.owner)).requests.find(r => r.claimable);
    const { claim, childId } = await dispatch(f, second);
    assert.equal(claim.native.routing.resolved.route, "maximum");
    await f.host.accept(f.record, second.taskId, { version: 1, runId: claim.runId, requestId: second.id,
      claimToken: claim.claimToken, childId, caller: claim.caller, status: "blocked",
      reason: "TEST FIXTURE quota unavailable", routing: { requestId: second.id, childId,
        policyDigest: claim.native.routing.resolved.policyDigest, requested: claim.native.routing.requested,
        resolved: claim.native.routing.resolved, observed: null } }, f.owner);
    await f.host.advance(f.record, f.owner);
    const record = JSON.parse(fs.readFileSync(path.join(f.record, "state.json")));
    assert.equal(record.tasks.first.status, "blocked");
    assert.equal(record.tasks.first.routingState.qualityFailures, 1);
    assert.equal(record.tasks.first.routingState.stage, "maximum");
    assert.equal(record.tasks.first.attempt.result.prUrl, "https://github.com/fixture/project/pull/1");
    assert.match(record.tasks.first.attempt.result.blockerDiagnosis, /quota unavailable/);
    assert.equal(record.execution.pools.first.spent.calls, 2);
    assert.equal(record.execution.pools.first.spent.verifierRuns, 2);
  });

test("host rejects explicit legacy routing knobs instead of losing the operator's model intent",
  { skip: !adapter && "set THREAD_TEST_NATIVE_ADAPTER" }, async t => {
    for (const [where, field, value] of [["engine", "maxTier", "opus"], ["engine", "judgeModel", "fable"],
      ["engine", "model", "opus"], ["engine", "effort", "max"], ["task", "model", "opus"], ["task", "effort", "max"]]) {
      const f = await routedRig(t, "claude");
      (where === "engine" ? f.config.engine : f.spec.tasks[0])[field] = value;
      await assert.rejects(host.initialise(f.record, f.spec, f.owner, f.config), /legacy|routingPolicy|prepared policy/);
      assert.equal(fs.existsSync(path.join(f.record, "state.json")), false);
    }
  });

for (const maxIterations of [3, 4])
  test(`attested native launch refusal preserves the original ceiling ${maxIterations}, fallback and restart state`,
    { skip: !adapter && "set THREAD_TEST_NATIVE_ADAPTER" }, async t => {
      const f = await routedRig(t, "claude");
      f.spec.tasks[0].planGate = false;
      f.config.engine.maxIterations = maxIterations;
      await host.initialise(f.record, f.spec, f.owner, f.config);
      f.host = await import(pathToFileURL(host.status(f.record).pinnedHost).href);
      const read = () => JSON.parse(fs.readFileSync(path.join(f.record, "state.json")));
      for (let candidate = 1; candidate <= 2; candidate++) {
        const request = (await f.host.advance(f.record, f.owner)).requests.find(r => r.claimable);
        const { claim, childId } = await dispatch(f, request);
        assert.equal(claim.native.routing.resolved.model, f.normalModel);
        await accept(f, request, claim, childId, f.owner, claim.caller.epoch,
          { ...output(request.label, f), verified: false, verifiedHead: "", escalate: true, failureKind: "quality",
            blockerDiagnosis: `TEST FIXTURE substantive quality failure ${candidate}` });
      }
      const refused = (await f.host.advance(f.record, f.owner)).requests.find(r => r.claimable);
      const claim = await f.host.claim(f.record, refused.taskId, refused.id, f.owner);
      assert.equal(claim.native.routing.resolved.route, "recovery");
      const proof = { model: f.recoveryModel, evidence: "TEST FIXTURE native launch explicitly refused before creating child",
        source: "native-launch", neverStarted: true };
      await f.host.recordUnavailable(f.record, refused.taskId, refused.id, claim.claimToken, proof, f.owner);
      const spent = read().execution.pools.first.spent;
      assert.deepEqual(spent, { calls: 3, verifierRuns: 3, recoveries: 0 });
      assert.equal(read().execution.requests[refused.id].status, "denied");
      assert.ok(!read().execution.requests[refused.id].childId, "a refused launch never fabricates a native child");
      await f.host.recordUnavailable(f.record, refused.taskId, refused.id, claim.claimToken, proof, f.owner);
      assert.deepEqual(read().execution.pools.first.spent, spent, "identical refusal is idempotent and does not refund its claim");
      await assert.rejects(f.host.recordUnavailable(f.record, refused.taskId, refused.id, claim.claimToken,
        { ...proof, evidence: "conflicting fixture proof" }, f.owner), /conflict|already|refusal/i);
      const afterRefusal = await f.host.advance(f.record, f.owner);
      const unavailable = { model: proof.model, evidence: proof.evidence };
      if (maxIterations === 3) {
        assert.equal(read().tasks.first.status, "blocked");
        assert.equal(afterRefusal.requests.filter(r => r.claimable).length, 0, "last candidate cannot create another attempt");
        assert.deepEqual(read().tasks.first.routingState.recoveryUnavailable, unavailable);
        assert.equal(read().tasks.first.routingState.qualityFailures, 2);
        await f.host.transition(f.record, { type: "retry", taskId: "first" }, f.owner);
        await f.host.transition(f.record, { type: "resume" }, f.owner);
        assert.deepEqual(read().execution.pools.first.spent, spent, "explicit retry retains the same spent pool");
      }
      const nextState = await f.host.advance(f.record, f.owner);
      const pending = nextState.requests.find(r => r.claimable);
      assert.ok(pending, JSON.stringify({ execution: nextState.execution, tasks: nextState.tasks }));
      assert.equal(pending.native.routing.resolved.model, f.normalModel);
      assert.equal(pending.native.routing.resolved.effort, "max");
      assert.equal(pending.native.routing.resolved.route, "maximum-unavailable");
      assert.deepEqual(pending.native.routing.requested.recoveryUnavailable, unavailable);
      const previousOwner = f.owner;
      f.owner = { ...previousOwner, session: "fallback-restart", epoch: 2 };
      await f.host.recover(f.record, f.owner, { previousCaller: { harness: previousOwner.harness, account: previousOwner.account,
        session: previousOwner.session }, previousEpoch: 1, previousOwnerStopped: true,
        reason: "TEST FIXTURE stopped owner; pending fallback survives process restart", requests: {} });
      f.host = await import(pathToFileURL(host.status(f.record).pinnedHost).href);
      const restarted = (await f.host.advance(f.record, f.owner)).requests.find(r => r.claimable);
      assert.equal(restarted.id, pending.id, "restart preserves the pending fallback identity");
      assert.deepEqual(restarted.native.routing.requested.recoveryUnavailable, unavailable);
      await converge(f, "first");
      assert.ok(f.host.status(f.record).readyToMerge.includes("first"));
      const completed = read();
      assert.equal(completed.tasks.first.routingState.stage, "maximum-unavailable");
      assert.equal(completed.tasks.first.routingState.qualityFailures, 2);
      assert.deepEqual(completed.tasks.first.routingState.recoveryUnavailable, unavailable);
      assert.equal(completed.execution.pools.first.spent.calls, 6);
      assert.equal(completed.execution.pools.first.spent.verifierRuns, 4);
      assert.equal(completed.execution.pools.first.spent.recoveries, 1);
      assert.ok(!completed.execution.requests[refused.id].childId);
      await f.host.merge(f.record, "first", f.owner);
      assert.equal(f.host.status(f.record).rolloutComplete, true);
    });
