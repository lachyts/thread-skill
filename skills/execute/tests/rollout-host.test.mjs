import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import * as host from "../scripts/rollout-host.mjs";

// This fixture exercises the host exchange boundary; it is not a live native harness claim.
const adapterSource = `import fs from 'node:fs';import path from 'node:path';
const file=d=>path.join(d,'run.json');const read=d=>JSON.parse(fs.readFileSync(file(d),'utf8'));const write=(d,s)=>{fs.mkdirSync(d,{recursive:true,mode:0o700});fs.writeFileSync(file(d),JSON.stringify(s));return s};
export function initialise(d,script,args,caller,config){return write(d,{runId:'run-'+args.waves[0].tasks[0].slug,caller:{harness:caller.harness,session:caller.session},account:config.account,ownershipEpoch:1,config,args,status:'ready',requests:[]})}
export function inspect(d){return read(d)}
export function advance(d){const s=read(d),task=s.args.waves[0].tasks[0],head=process.env.HOST_TEST_HEAD;
if(!s.requests.length)s.requests.push({id:'implement-'+task.slug,label:'implement:'+task.slug,status:'pending',options:{label:'implement:'+task.slug,model:'opus'},native:{inherit:true}});
else if(s.requests.length===1&&s.requests[0].status==='accepted')s.requests.push({id:'review-'+task.slug,label:'review:'+task.slug+' r1',status:'pending',options:{label:'review:'+task.slug+' r1',model:'opus'},native:{inherit:true}});
if(s.requests.length===2&&s.requests[1].status==='accepted'){s.status='complete';s.output={tasks:[{slug:task.slug,status:process.env.HOST_TEST_GATE?'gate-pending':'review',gatedInputs:process.env.HOST_TEST_GATE?[process.env.HOST_TEST_GATE]:[],verified:true,verifiedHead:head,reviewedHead:head,prUrl:'https://github.com/acme/widgets/pull/'+(task.slug.includes('-rollback-')?'2':'1'),summary:'verified'}]}}else s.status='waiting';return write(d,s)}
export function claim(d,id){if(process.env.HOST_TEST_CLAIM_FAIL)throw Error('fixture interruption before adapter claim');const s=read(d),r=s.requests.find(r=>r.id===id);if(r.status!=='pending')throw Error('already claimed');r.status='claimed';r.claimToken='token-'+id;write(d,s);return r}
export function bind(d,id,token,childId){const s=read(d),r=s.requests.find(r=>r.id===id);if(r.claimToken!==token)throw Error('token');r.status='dispatched';r.childId=childId;write(d,s);return r}
export function accept(d,e){const s=read(d),r=s.requests.find(r=>r.id===e.requestId);if(r.claimToken!==e.claimToken||r.childId!==e.childId)throw Error('attestation');if(e.status==='ok'&&r.label.startsWith('review:')&&!Array.isArray(e.output?.feedback))throw Error('fixture schema rejected feedback');r.status=e.status==='ok'?'accepted':e.status;r.output=e.output;write(d,s);return r}
export function recover(d,caller,e){const s=read(d);if(process.env.HOST_TEST_RECOVER_FAIL&&s.args.waves[0].tasks[0].slug.endsWith('task1'))throw Error('fixture partial transfer');if(!e.previousOwnerStopped||s.caller.harness!==caller.harness||s.config.account!==caller.account||e.previousEpoch!==s.ownershipEpoch||caller.epoch!==s.ownershipEpoch+1)throw Error('unsafe recovery epoch');for(const r of s.requests.filter(r=>['claimed','dispatched'].includes(r.status))){const p=e.requests[r.id];if(!p)throw Error('no proof');if(p.status==='not-started')r.status='interrupted';else{r.childId=p.childId;r.status='dispatched'}}s.caller={harness:caller.harness,session:caller.session};s.ownershipEpoch++;return write(d,s)}
`;
const owner = {
  harness: "codex",
  account: "fixture-account",
  session: "lead",
  epoch: 1,
};
const git = (...args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
function setup(
  t,
  {
    tasks = 1,
    verifier = "true",
    allowance = { calls: 8, verifierRuns: 20, recoveries: 3 },
  } = {},
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rollout-host-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, "repo");
  git("init", "-q", "-b", "main", repo);
  git("-C", repo, "config", "user.email", "test@example.test");
  git("-C", repo, "config", "user.name", "Fixture");
  fs.writeFileSync(path.join(repo, "source.txt"), "baseline\n");
  git("-C", repo, "add", ".");
  git("-C", repo, "commit", "-qm", "baseline");
  const head = git("-C", repo, "rev-parse", "HEAD");
  git(
    "-C",
    repo,
    "remote",
    "add",
    "origin",
    "https://github.com/acme/widgets.git",
  );
  git("-C", repo, "update-ref", "refs/pull/1/head", head);
  const nativeAdapter = path.join(dir, "native.mjs");
  fs.writeFileSync(nativeAdapter, adapterSource);
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin);
  const actualGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  fs.writeFileSync(
    path.join(bin, "git"),
    `#!/usr/bin/env python3\nimport os,sys\na=sys.argv[1:]\nif 'fetch' in a:\n a[a.index('origin')]=os.environ['HOST_TEST_REPO']\nos.execv(${JSON.stringify(actualGit)},[${JSON.stringify(actualGit)}]+a)\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/usr/bin/env python3\nimport json,os,sys,subprocess,time\na=sys.argv[1:]\nmarker=os.environ['HOST_TEST_MERGED']+('.'+a[2] if len(a)>2 and a[2]!='1' else '')\nif a[:2]==['repo','view']: print('main')\nelif a[:2]==['pr','view']:\n d={'number':int(a[2]),'url':'https://github.com/acme/widgets/pull/'+a[2],'state':'MERGED' if os.path.exists(marker) else 'OPEN','baseRefName':'main','headRefOid':os.environ.get('HOST_TEST_OBSERVED_HEAD',os.environ['HOST_TEST_HEAD']),'mergeStateStatus':'CLEAN','mergeCommit':{'oid':os.environ['HOST_TEST_HEAD']} if os.path.exists(marker) else None}\n print(json.dumps(d))\nelif a[:2]==['pr','merge']:\n if os.environ.get('HOST_TEST_MERGE_PAUSE'): open(os.environ['HOST_TEST_MERGE_PAUSE'],'w').write(json.dumps({'pid':os.getpid(),'group':os.getpgrp()})); time.sleep(20)\n if not os.environ.get('HOST_TEST_QUEUE'): open(marker,'w').write('merged')\n if os.environ.get('HOST_TEST_APPLY_MERGE'): subprocess.run(['git','-C',os.environ['HOST_TEST_REPO'],'reset','--hard',os.environ['HOST_TEST_HEAD']],check=True)\n print('merged')\nelse: sys.exit(1)\n`,
    { mode: 0o755 },
  );
  const saved = {};
  for (const [k, v] of Object.entries({
    PATH: bin + path.delimiter + process.env.PATH,
    HOST_TEST_REPO: repo,
    HOST_TEST_HEAD: head,
    HOST_TEST_MERGED: path.join(dir, "merged"),
  })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    delete process.env.HOST_TEST_OBSERVED_HEAD;
    delete process.env.HOST_TEST_FAIL;
    delete process.env.HOST_TEST_QUEUE;
    delete process.env.HOST_TEST_CLAIM_FAIL;
    delete process.env.HOST_TEST_RECOVER_FAIL;
    delete process.env.HOST_TEST_APPLY_MERGE;
    delete process.env.HOST_TEST_GATE;
    delete process.env.HOST_TEST_MERGE_PAUSE;
  });
  const taskSpecs = Array.from({ length: tasks }, (_, i) => {
    const id = "task" + i,
      sourcePath = path.join(dir, id + ".md"),
      requirements = "Deliver " + id + " safely.";
    fs.writeFileSync(sourcePath, requirements);
    return {
      id,
      sourcePath,
      requirements,
      acceptance: ["Verifier passes"],
      allowance,
      scope: "single-file",
    };
  });
  const spec = {
    protocolVersion: 4,
    rolloutId: "fixture-rollout",
    repository: {
      path: repo,
      identity: "github.com/acme/widgets",
      baseBranch: "main",
      verifier,
      verifierInputs: [],
    },
    authority: {
      outcomes: ["Working changes"],
      constraints: [],
      allowedActions: ["merge"],
      reservedDecisions: [],
      gates: [],
      mergeEffects: [],
      evidence: { userText: "Authorise this isolated fixture rollout.", context: "Test fixture only; no live actions.", source: "fixture:user-request" },
    },
    tasks: taskSpecs,
  };
  const config = {
    nativeAdapter,
    account: owner.account,
    models: {
      opus: { model: "fixture-opus" },
      fable: { model: "fixture-fable" },
    },
    maxConcurrent: 2,
    engine: { maxIterations: 3, maxPlanRounds: 2, maxReviewRounds: 2 },
  };
  const record = path.join(dir, "record");
  return { dir, repo, head, spec, config, record, nativeAdapter };
}
async function initialise(t, options) {
  const f = setup(t, options);
  await host.initialise(f.record, f.spec, owner, f.config);
  return f;
}
function state(f) {
  return JSON.parse(fs.readFileSync(path.join(f.record, "state.json"), "utf8"));
}
function reviewReceipt(f, requestId, childId, head = f.head) {
  const evidencePath = path.join(f.dir, `native-review-${requestId}.json`);
  fs.writeFileSync(evidencePath, JSON.stringify({ fixture: true, requestId, childId, engine: "review-agent", reviewedHead: head }));
  return { version: 1, requestId, childId, harness: owner.harness, engine: "review-agent", reviewLevel: "xhigh", reviewedHead: head,
    invocationId: `fixture-invocation-${requestId}`, nativeEvidence: { path: evidencePath } };
}
async function completeRequest(f, taskId, childId, output) {
  const s = await host.advance(f.record, owner),
    request = s.requests.find(
      (r) => r.taskId === taskId && r.status === "pending",
    );
  assert.ok(request, "pending request");
  const claimed = await host.claim(f.record, taskId, request.id, owner);
  await host.bind(
    f.record,
    taskId,
    request.id,
    claimed.claimToken,
    childId,
    owner,
  );
  await host.accept(
    f.record,
    taskId,
    {
      version: 1,
      runId: claimed.runId,
      requestId: request.id,
      claimToken: claimed.claimToken,
      childId,
      caller: claimed.caller,
      status: "ok",
      output,
    },
    owner,
    request.label.startsWith("review:") ? reviewReceipt(f, request.id, childId, output.reviewedHead) : undefined,
  );
}
async function converge(f) {
  await completeRequest(f, "task0", "implement-child", {
    verified: true,
    verifiedHead: f.head,
    prUrl: "https://github.com/acme/widgets/pull/1",
    summary: "passed",
  });
  await completeRequest(f, "task0", "review-child", {
    verdict: "approve",
    reviewedHead: f.head,
    feedback: [],
  });
  return host.advance(f.record, owner);
}

function verifierModes(f, modes = ["complete"]) {
  f.spec.repository.verifierContract = { version: 1, baselineModes: ["partial"] };
  f.spec.repository.verifier = `printf '{"mode":"partial","head":"%s"}\\n' "$(git rev-parse HEAD)"`;
  for (const task of f.spec.tasks) task.verifierModes = modes;
}
test("exit-zero partial content cannot approve a task requiring complete content", async (t) => {
  const f = setup(t, { tasks: 2 });
  verifierModes(f);
  f.spec.tasks[1].dependsOn = ["task0"];
  await host.initialise(f.record, f.spec, owner, f.config);
  const result = await converge(f);
  assert.equal(result.readyToMerge.length, 0);
  assert.equal(state(f).tasks.task0.status, "blocked");
  assert.equal(state(f).tasks.task1.status, "open");
  assert.match(state(f).tasks.task0.reason, /mode|acceptance/);
  assert.equal(state(f).execution.pools.task0.spent.verifierRuns, 4);
  assert.equal(fs.existsSync(process.env.HOST_TEST_MERGED), false);
});
test("task modes are pinned, checked before approval and idempotently reserved", async (t) => {
  const f = setup(t);
  verifierModes(f, ["partial", "complete"]);
  await host.initialise(f.record, f.spec, owner, f.config);
  await converge(f);
  assert.equal(state(f).tasks.task0.status, "review");
  assert.equal(state(f).execution.pools.task0.spent.verifierRuns, 4);
  await host.advance(f.record, owner);
  assert.equal(state(f).execution.pools.task0.spent.verifierRuns, 4);
  const operations = Object.values(state(f).host.verifications);
  assert.equal(operations.length, 1);
  assert.equal(operations[0].status, "complete");
  assert.equal(operations[0].result.report.mode, "partial");
  await host.merge(f.record, "task0", owner);
  assert.equal(state(f).tasks.task0.status, "complete");
});
test("malformed or wrongly bound baseline reports and missing task modes reject preparation", async (t) => {
  const f = setup(t);
  verifierModes(f);
  delete f.spec.tasks[0].verifierModes;
  await assert.rejects(host.initialise(f.record, f.spec, owner, f.config), /verifierModes/);
  f.spec.tasks[0].verifierModes = ["complete"];
  f.spec.repository.verifier = "true";
  await assert.rejects(host.initialise(f.record, f.spec, owner, f.config), /report|JSON/);
  f.spec.repository.verifier = `printf '{"mode":"partial","head":"${"a".repeat(40)}"}'`;
  await assert.rejects(host.initialise(f.record, f.spec, owner, f.config), /head|commit/);
});
test("an integrated report outside task modes records regression without unlocking its dependent", async (t) => {
  const f = setup(t, { tasks: 2 });
  verifierModes(f, ["partial"]);
  f.spec.tasks[1].dependsOn = ["task0"];
  // This deterministic fixture switches the integrated mode after its mock merge.
  f.spec.repository.verifier = `if test -f '${process.env.HOST_TEST_MERGED}'; then mode=baseline; else mode=partial; fi; printf '{"mode":"%s","head":"%s"}\\n' "$mode" "$(git rev-parse HEAD)"`;
  await host.initialise(f.record, f.spec, owner, f.config);
  await converge(f);
  await host.merge(f.record, "task0", owner);
  assert.equal(state(f).tasks.task0.status, "draining");
  assert.equal(state(f).tasks.task1.status, "open");
  assert.ok(state(f).execution.mergeHold);
  assert.equal(state(f).tasks.task0.outcome?.satisfied, undefined);
});
test("candidate acceptance never runs beyond the remaining verifier allowance", async (t) => {
  const f = setup(t, { allowance: { calls: 8, verifierRuns: 3, recoveries: 1 } });
  verifierModes(f, ["partial"]);
  await host.initialise(f.record, f.spec, owner, f.config);
  await converge(f);
  assert.equal(state(f).tasks.task0.status, "blocked");
  assert.equal(state(f).execution.pools.task0.spent.verifierRuns, 3);
  assert.deepEqual(state(f).host.verifications, {});
  assert.equal(fs.existsSync(process.env.HOST_TEST_MERGED), false);
});
test("rollback uses prepared restoration modes and can spend its reserved verifier allowance", async (t) => {
  const f = setup(t, { allowance: { calls: 4, verifierRuns: 9, recoveries: 1 } });
  verifierModes(f, ["complete"]);
  f.spec.repository.verifierContract = { version: 1, baselineModes: ["baseline"], rollbackModes: ["baseline", "partial"] };
  f.spec.repository.verifier = `case "\${HOST_TEST_FAIL:-}" in candidate) mode=complete;; 1) mode=invalid;; *) mode=baseline;; esac; printf '{"mode":"%s","head":"%s"}\\n' "$mode" "$(git rev-parse HEAD)"`;
  f.spec.authority.allowedActions.push("revert-run-owned");
  await host.initialise(f.record, f.spec, owner, f.config);
  process.env.HOST_TEST_FAIL = "candidate";
  await converge(f);
  process.env.HOST_TEST_FAIL = "1";
  await host.merge(f.record, "task0", owner);
  delete process.env.HOST_TEST_FAIL;
  const view = await host.advance(f.record, owner);
  const repair = view.requests.find(r => r.claimable);
  assert.equal((await host.claim(f.record, "task0", repair.id, owner)).status, "blocked");
  await host.advance(f.record, owner);
  const s = state(f), task = s.tasks.task0;
  assert.equal(task.attempt.purpose, "rollback");
  assert.deepEqual(s.host.runs[task.attempt.id].args.waves[0].tasks[0].verifierModes, ["baseline", "partial"]);
  const result = await host.verifyTask(f.record, "task0", { operationId: "rollback-check", commit: f.head, purpose: "Check reserved rollback outcome" }, owner);
  assert.equal(result.accepted, true);
  assert.equal(state(f).execution.pools.task0.spent.verifierRuns, s.execution.pools.task0.spent.verifierRuns + 1);
});

test("initialisation verifies detached base and pins immutable runtime and task inputs", async (t) => {
  const f = await initialise(t);
  const s = state(f);
  assert.equal(s.host.baseline.exitCode, 0);
  assert.equal(s.host.baseline.commit, f.head);
  assert.equal(
    fs.statSync(path.join(f.record, "state.json")).mode & 0o777,
    0o600,
  );
  assert.equal(
    fs.readFileSync(s.host.adopted.task0.path, "utf8"),
    f.spec.tasks[0].requirements,
  );
  fs.writeFileSync(f.nativeAdapter, 'throw Error("installed changed")');
  await host.advance(f.record, owner);
  assert.equal(state(f).tasks.task0.status, "active");
});
test("baseline failure and mismatched source prevent launch", async (t) => {
  const f = setup(t, { verifier: "false" });
  await assert.rejects(
    host.initialise(f.record, f.spec, owner, f.config),
    /baseline/,
  );
  assert.equal(fs.existsSync(path.join(f.record, "state.json")), false);
  f.spec.repository.verifier = "true";
  f.spec.tasks[0].requirements = "not source";
  await assert.rejects(
    host.initialise(f.record, f.spec, owner, f.config),
    /source|requirements/,
  );
});
test("claims reserve the original allowance and never redispatch a claimed request", async (t) => {
  const f = await initialise(t, { tasks: 2 });
  f.config.maxConcurrent = 1;
  const requests = (await host.advance(f.record, owner)).requests;
  const first = requests[0];
  await host.claim(f.record, first.taskId, first.id, owner);
  assert.equal(state(f).execution.pools[first.taskId].spent.calls, 1);
  assert.equal(state(f).execution.pools[first.taskId].spent.verifierRuns, 3);
  await assert.rejects(
    host.claim(f.record, first.taskId, first.id, owner),
    /claim|reserved/,
  );
  assert.equal(state(f).execution.pools[first.taskId].spent.calls, 1);
});
test("source edits hold affected work and independent task still advances", async (t) => {
  const f = await initialise(t, { tasks: 2 });
  fs.appendFileSync(f.spec.tasks[0].sourcePath, " New outcome.");
  await host.advance(f.record, owner);
  const s = state(f);
  assert.equal(s.tasks.task0.requiresAssessment, true);
  assert.equal(s.tasks.task1.status, "active");
  assert.equal(s.execution.pools.task0.spent.calls, 0);
});
test("review approval requires independent accepted native evidence and observed matching PR head", async (t) => {
  const f = await initialise(t);
  await converge(f);
  const s = state(f);
  assert.equal(s.tasks.task0.status, "review");
  assert.equal(s.tasks.task0.approval.head, f.head);
  assert.match(s.tasks.task0.approval.reviewer, /review-child/);
  assert.equal(s.execution.pools.task0.spent.calls, 2);
});
test("a later unreviewed GitHub head never receives approval", async (t) => {
  const f = await initialise(t);
  process.env.HOST_TEST_OBSERVED_HEAD = "a".repeat(40);
  await converge(f);
  assert.equal(state(f).tasks.task0.status, "blocked");
  assert.equal(state(f).tasks.task0.approval, undefined);
});
test("merger evidence and postmerge verifier are required before completion", async (t) => {
  const f = await initialise(t);
  await converge(f);
  await host.merge(f.record, "task0", owner);
  const s = state(f);
  assert.equal(s.tasks.task0.status, "complete");
  assert.equal(s.tasks.task0.outcome.mergeCommit, f.head);
  assert.equal(s.execution.pools.task0.spent.verifierRuns, 4);
});
test("postmerge regression holds the repository and does not complete the task", async (t) => {
  const f = await initialise(t, {
    verifier: 'test "${HOST_TEST_FAIL:-0}" != 1',
  });
  await converge(f);
  process.env.HOST_TEST_FAIL = "1";
  await host.merge(f.record, "task0", owner);
  const s = state(f);
  assert.ok(s.execution.mergeHold);
  assert.notEqual(s.tasks.task0.status, "complete");
});
test("mutations fence stale owners and source edit before merge prevents side effect", async (t) => {
  const f = await initialise(t);
  await assert.rejects(
    host.advance(f.record, { ...owner, epoch: 0 }),
    /owner|epoch/,
  );
  await converge(f);
  fs.appendFileSync(f.spec.tasks[0].sourcePath, " changed");
  await host.merge(f.record, "task0", owner);
  assert.equal(fs.existsSync(process.env.HOST_TEST_MERGED), false);
  assert.equal(state(f).tasks.task0.requiresAssessment, true);
});
test("unknown locks stop mutation instead of implying an expired owner", async (t) => {
  const f = await initialise(t);
  fs.writeFileSync(
    path.join(f.record, ".host.lock"),
    JSON.stringify({ pid: 99999999, token: "unknown" }),
  );
  await assert.rejects(host.advance(f.record, owner), /lock/);
  assert.equal(state(f).tasks.task0.status, "open");
});
test("generic transitions cannot manufacture worker or merge completion", async (t) => {
  const f = await initialise(t);
  await assert.rejects(
    host.transition(
      f.record,
      { type: "merge-observed", taskId: "task0" },
      owner,
    ),
    /host|transition/,
  );
  await host.transition(f.record, { type: "pause" }, owner);
  await host.advance(f.record, owner);
  assert.equal(state(f).tasks.task0.status, "open");
});

test("queued merges remain pending and do not spend a fresh reservation on polling", async (t) => {
  const f = await initialise(t);
  await converge(f);
  process.env.HOST_TEST_QUEUE = "1";
  await host.merge(f.record, "task0", owner);
  assert.equal(state(f).tasks.task0.status, "waiting");
  assert.equal(state(f).execution.pools.task0.spent.verifierRuns, 4);
  await host.merge(f.record, "task0", owner);
  assert.equal(state(f).execution.pools.task0.spent.verifierRuns, 4);
  delete process.env.HOST_TEST_QUEUE;
  await host.merge(f.record, "task0", owner);
  assert.equal(state(f).tasks.task0.status, "complete");
});
test("a failed adapter claim stays conservatively reserved and blocks redispatch", async (t) => {
  const f = await initialise(t);
  const req = (await host.advance(f.record, owner)).requests[0];
  process.env.HOST_TEST_CLAIM_FAIL = "1";
  await assert.rejects(
    host.claim(f.record, "task0", req.id, owner),
    /reserved.*recovery/,
  );
  delete process.env.HOST_TEST_CLAIM_FAIL;
  delete process.env.HOST_TEST_RECOVER_FAIL;
  delete process.env.HOST_TEST_APPLY_MERGE;
  await assert.rejects(
    host.claim(f.record, "task0", req.id, owner),
    /reserved|claimed/,
  );
  assert.equal(state(f).execution.pools.task0.spent.calls, 1);
});
test("recovery adopts actual children with separate native and domain epochs", async (t) => {
  const f = await initialise(t);
  const req = (await host.advance(f.record, owner)).requests[0],
    claimed = await host.claim(f.record, "task0", req.id, owner);
  const next = { ...owner, session: "replacement", epoch: 2 };
  await host.recover(f.record, next, {
    previousCaller: {
      harness: owner.harness,
      account: owner.account,
      session: owner.session,
    },
    previousEpoch: 1,
    previousOwnerStopped: true,
    reason: "native owner stopped",
    requests: {
      [req.id]: {
        childId: "recovered-child",
        status: "running",
        evidence: "native registry child exists",
      },
    },
  });
  assert.equal(state(f).execution.epoch, 2);
  assert.equal(state(f).execution.requests[req.id].childId, "recovered-child");
  await assert.rejects(host.advance(f.record, owner), /owner|epoch/);
  await host.accept(
    f.record,
    "task0",
    {
      version: 1,
      runId: claimed.runId,
      requestId: req.id,
      claimToken: claimed.claimToken,
      childId: "recovered-child",
      caller: { ...next },
      status: "ok",
      output: { verified: true, verifiedHead: f.head },
    },
    next,
  );
  assert.equal(state(f).execution.requests[req.id].status, "accepted");
});
test("allowance failure blocks one task while independent work remains runnable", async (t) => {
  const f = setup(t, { tasks: 2 });
  f.spec.tasks[0].allowance = { calls: 8, verifierRuns: 2, recoveries: 3 };
  await host.initialise(f.record, f.spec, owner, f.config);
  const requests = (await host.advance(f.record, owner)).requests;
  const bad = requests.find((r) => r.taskId === "task0");
  const r = await host.claim(f.record, "task0", bad.id, owner);
  assert.equal(r.status, "blocked");
  assert.equal(state(f).tasks.task1.status, "active");
});
test("quota substitution creates new immutable settings without refreshing the task pool", async (t) => {
  const f = await initialise(t);
  await host.transition(
    f.record,
    {
      type: "substitute",
      taskId: "task0",
      models: {
        opus: { model: "same-account-alternative" },
        fable: { model: "fixture-fable" },
      },
      evidence: "native account reports equivalent binding available",
    },
    owner,
  );
  await host.advance(f.record, owner);
  const s = state(f),
    run = s.host.runs[s.tasks.task0.attempt.id];
  assert.equal(run.settings.models.opus.model, "same-account-alternative");
  assert.equal(s.execution.pools.task0.spent.calls, 0);
  assert.equal(s.host.config.models.opus.model, "fixture-opus");
  await assert.rejects(
    host.transition(
      f.record,
      {
        type: "substitute",
        taskId: "task0",
        models: f.config.models,
        evidence: "while active",
      },
      owner,
    ),
    /active|drain/,
  );
});
test("a drained regression starts bounded repair with a new PR identity only after proven merge", async (t) => {
  const f = await initialise(t, {
    verifier: 'test "${HOST_TEST_FAIL:-0}" != 1',
  });
  await converge(f);
  process.env.HOST_TEST_FAIL = "1";
  await host.merge(f.record, "task0", owner);
  delete process.env.HOST_TEST_FAIL;
  await host.advance(f.record, owner);
  const s = state(f);
  assert.equal(s.tasks.task0.status, "active");
  assert.equal(s.execution.pools.task0.spent.verifierRuns, 4);
  assert.match(
    s.host.runs[s.tasks.task0.attempt.id].args.waves[0].tasks[0].slug,
    /-repair-/,
  );
});
test("authorised rollback retains finite headroom and uses only the recorded failed landing", async (t) => {
  const f = setup(t, {
    verifier: 'test "${HOST_TEST_FAIL:-0}" != 1',
    allowance: { calls: 4, verifierRuns: 7, recoveries: 3 },
  });
  f.spec.authority.allowedActions.push("revert-run-owned");
  await host.initialise(f.record, f.spec, owner, f.config);
  await converge(f);
  process.env.HOST_TEST_FAIL = "1";
  await host.merge(f.record, "task0", owner);
  delete process.env.HOST_TEST_FAIL;
  let v = await host.advance(f.record, owner);
  const repair = v.requests.find((r) => r.claimable);
  assert.ok(repair);
  const refused = await host.claim(f.record, "task0", repair.id, owner);
  assert.equal(refused.status, "blocked");
  await host.advance(f.record, owner);
  const s = state(f);
  assert.equal(s.tasks.task0.attempt.purpose, "rollback");
  assert.deepEqual(s.tasks.task0.attempt.reverts, [f.head]);
  assert.equal(s.execution.pools.task0.spent.calls, 2);
  assert.equal(s.execution.pools.task0.spent.verifierRuns, 4);
  assert.match(
    fs.readFileSync(
      s.host.runs[s.tasks.task0.attempt.id].args.waves[0].tasks[0].taskPath,
      "utf8",
    ),
    /git revert/,
  );
});

test("partial ownership transfer fences ordinary actions and resumes without double recovery spend", async (t) => {
  const f = await initialise(t, { tasks: 2 });
  const requests = (await host.advance(f.record, owner)).requests;
  const proof = {};
  for (const r of requests) {
    await host.claim(f.record, r.taskId, r.id, owner);
    proof[r.id] = {
      childId: "recovered-" + r.taskId,
      status: "running",
      evidence: "native registry",
    };
  }
  const next = { ...owner, session: "replacement", epoch: 2 },
    evidence = {
      previousCaller: {
        harness: owner.harness,
        account: owner.account,
        session: owner.session,
      },
      previousEpoch: 1,
      previousOwnerStopped: true,
      reason: "previous lead stopped",
      requests: proof,
    };
  process.env.HOST_TEST_RECOVER_FAIL = "1";
  await assert.rejects(
    host.recover(f.record, next, evidence),
    /fixture partial transfer/,
  );
  delete process.env.HOST_TEST_RECOVER_FAIL;
  delete process.env.HOST_TEST_APPLY_MERGE;
  await assert.rejects(
    host.advance(f.record, owner),
    /recovery is in progress/,
  );
  const recoveryLock = path.join(f.record, ".host.lock");
  fs.writeFileSync(
    recoveryLock,
    JSON.stringify({ pid: 99999999, token: "dead-transfer", owner: next }),
  );
  await assert.rejects(
    host.recover(f.record, next, { ...evidence, reason: "different transfer" }),
    /exact recorded transfer/,
  );
  assert.equal(fs.existsSync(recoveryLock), true);
  await host.recover(f.record, next, evidence);
  await host.recover(f.record, next, evidence);
  assert.equal(state(f).execution.epoch, 2);
  assert.equal(state(f).execution.pools.task0.spent.recoveries, 1);
  assert.equal(state(f).execution.pools.task1.spent.recoveries, 1);
});
test("a proven dead host process lock can recover but time alone is never evidence", async (t) => {
  const f = await initialise(t);
  fs.writeFileSync(
    path.join(f.record, ".host.lock"),
    JSON.stringify({ pid: 99999999, token: "dead-owner", owner }),
  );
  await host.recover(
    f.record,
    { ...owner, session: "replacement", epoch: 2 },
    {
      previousCaller: {
        harness: owner.harness,
        account: owner.account,
        session: owner.session,
      },
      previousEpoch: 1,
      previousOwnerStopped: true,
      reason: "native session ended and lock PID does not exist",
      requests: {},
    },
  );
  assert.equal(state(f).execution.epoch, 2);
  assert.equal(fs.existsSync(path.join(f.record, ".host.lock")), false);
});
test("a hanging baseline verifier is terminated as a process group within its finite allowance", async (t) => {
  const f = setup(t, { verifier: "sleep 8; true" });
  f.config.verifierTimeoutMs = 50;
  const start = Date.now();
  await assert.rejects(
    host.initialise(f.record, f.spec, owner, f.config),
    /baseline/,
  );
  assert.ok(Date.now() - start < 4000, "verifier child outlived timeout");
});
test("acceptance resumes across a native result persisted before the host checkpoint", async (t) => {
  const f = await initialise(t);
  const req = (await host.advance(f.record, owner)).requests[0],
    claimed = await host.claim(f.record, "task0", req.id, owner);
  await host.bind(
    f.record,
    "task0",
    req.id,
    claimed.claimToken,
    "actual-child",
    owner,
  );
  const envelope = {
    version: 1,
    runId: claimed.runId,
    requestId: req.id,
    claimToken: claimed.claimToken,
    childId: "actual-child",
    caller: claimed.caller,
    status: "ok",
    output: { verified: true, verifiedHead: f.head },
  };
  const s = state(f),
    run = s.host.runs[s.tasks.task0.attempt.id],
    native = await import("file://" + s.host.release.adapter.path);
  native.accept(run.directory, envelope, claimed.caller);
  assert.equal(state(f).execution.requests[req.id].status, "dispatched");
  await host.accept(f.record, "task0", envelope, owner);
  await host.accept(f.record, "task0", envelope, owner);
  assert.equal(state(f).execution.requests[req.id].status, "accepted");
  assert.equal(state(f).execution.pools.task0.spent.calls, 1);
});
test("an invalidated queued PR cannot silently drain into a replacement attempt", async (t) => {
  const f = await initialise(t);
  await converge(f);
  process.env.HOST_TEST_QUEUE = "1";
  await host.merge(f.record, "task0", owner);
  git("-C", f.repo, "commit", "--allow-empty", "-qm", "peer base advancement");
  await host.merge(f.record, "task0", owner);
  const attempt = state(f).tasks.task0.attempt.id;
  await host.advance(f.record, owner);
  assert.equal(state(f).tasks.task0.status, "draining");
  assert.equal(state(f).tasks.task0.attempt.id, attempt);
  assert.equal(host.status(f.record).continuation.actionable, false);
  assert.equal(host.status(f.record).continuation.waiting, true);
});

test("rollback lands only an exact isolated revert and leaves the original outcome unsatisfied", async (t) => {
  const f = setup(t, {
    verifier: 'test "${HOST_TEST_FAIL:-0}" != 1',
    allowance: { calls: 4, verifierRuns: 7, recoveries: 3 },
  });
  f.spec.authority.allowedActions.push("revert-run-owned");
  git("-C", f.repo, "switch", "-qc", "original-pr");
  fs.writeFileSync(path.join(f.repo, "source.txt"), "regression\n");
  git("-C", f.repo, "commit", "-am", "original task");
  const original = git("-C", f.repo, "rev-parse", "HEAD");
  git("-C", f.repo, "switch", "-q", "main");
  git("-C", f.repo, "update-ref", "refs/pull/1/head", original);
  process.env.HOST_TEST_HEAD = original;
  f.head = original;
  await host.initialise(f.record, f.spec, owner, f.config);
  await converge(f);
  process.env.HOST_TEST_APPLY_MERGE = "1";
  process.env.HOST_TEST_FAIL = "1";
  await host.merge(f.record, "task0", owner);
  delete process.env.HOST_TEST_FAIL;
  let v = await host.advance(f.record, owner);
  const repair = v.requests.find((r) => r.claimable);
  await host.claim(f.record, "task0", repair.id, owner);
  await host.advance(f.record, owner);
  assert.equal(state(f).tasks.task0.attempt.purpose, "rollback");
  git("-C", f.repo, "switch", "-qc", "rollback-pr", original);
  git("-C", f.repo, "revert", "--no-edit", original);
  const reverted = git("-C", f.repo, "rev-parse", "HEAD");
  git("-C", f.repo, "switch", "-q", "main");
  git("-C", f.repo, "update-ref", "refs/pull/2/head", reverted);
  process.env.HOST_TEST_HEAD = reverted;
  await completeRequest(f, "task0", "rollback-implement", {
    verified: true,
    verifiedHead: reverted,
    prUrl: "https://github.com/acme/widgets/pull/2",
    summary: "reverted owned change",
  });
  await completeRequest(f, "task0", "rollback-review", {
    verdict: "approve",
    reviewedHead: reverted,
    feedback: [],
  });
  await host.advance(f.record, owner);
  await host.merge(f.record, "task0", owner);
  const s = state(f);
  assert.equal(s.execution.mergeHold, null);
  assert.equal(s.tasks.task0.status, "blocked");
  assert.equal(s.tasks.task0.outcome, undefined);
  assert.equal(s.tasks.task0.landings[0].revertedBy, reverted);
  assert.deepEqual(s.execution.pools.task0.spent, {
    calls: 4,
    verifierRuns: 7,
    recoveries: 0,
  });
});

test("a superseded queued merge is recorded under its old revision without satisfying changed requirements", async (t) => {
  const f = await initialise(t);
  await converge(f);
  process.env.HOST_TEST_QUEUE = "1";
  await host.merge(f.record, "task0", owner);
  const queued = state(f),
    oldRevision = queued.tasks.task0.revision.hash,
    oldSlug =
      queued.host.runs[queued.tasks.task0.attempt.id].args.waves[0].tasks[0]
        .slug;
  fs.appendFileSync(f.spec.tasks[0].sourcePath, " Changed outcome.");
  fs.writeFileSync(
    process.env.HOST_TEST_MERGED,
    "merged externally from queue",
  );
  await host.advance(f.record, owner);
  const s = state(f);
  assert.equal(s.tasks.task0.landings.length, 1);
  assert.equal(s.tasks.task0.landings[0].revision, oldRevision);
  assert.equal(s.tasks.task0.landings[0].superseded, true);
  assert.equal(s.tasks.task0.status, "blocked");
  assert.equal(s.tasks.task0.outcome, undefined);
  assert.equal(s.execution.pools.task0.spent.verifierRuns, 4);
  await host.transition(
    f.record,
    {
      type: "revise",
      taskId: "task0",
      requirements: fs.readFileSync(f.spec.tasks[0].sourcePath, "utf8"),
      assessment: {
        withinAuthority: true,
        authorityHash: s.authorityHash,
        evidence: "Changed outcome remains inside adopted authority",
      },
    },
    owner,
  );
  await host.transition(f.record, { type: "resume" }, owner);
  await host.advance(f.record, owner);
  const revised = state(f);
  assert.notEqual(
    revised.host.runs[revised.tasks.task0.attempt.id].args.waves[0].tasks[0]
      .slug,
    oldSlug,
  );
});

test("bounded queue inactivity is explicit attention without an actionable polling loop", async (t) => {
  const f = setup(t);
  f.config.maxPendingPolls = 1;
  await host.initialise(f.record, f.spec, owner, f.config);
  await converge(f);
  process.env.HOST_TEST_QUEUE = "1";
  await host.merge(f.record, "task0", owner);
  const c = host.status(f.record).continuation;
  assert.equal(c.needsAttention, true);
  assert.equal(c.actionable, false);
  assert.equal(c.waiting, true);
  delete process.env.HOST_TEST_QUEUE;
  await host.merge(f.record, "task0", owner);
  assert.equal(state(f).tasks.task0.status, "complete");
  assert.equal(host.status(f.record).continuation.needsAttention, false);
});

for (const checkpoint of ["reserved", "merged"]) {
  test(`superseded ${checkpoint} merge checkpoint remains held until terminal evidence is applied`, async (t) => {
    const f = await initialise(t);
    await converge(f);
    process.env.HOST_TEST_QUEUE = "1";
    await host.merge(f.record, "task0", owner);
    const crashed = state(f),
      operation = Object.values(crashed.host.merges)[0];
    operation.status = checkpoint;
    if (checkpoint === "reserved") delete operation.report;
    else operation.report.outcome = "merged";
    fs.writeFileSync(
      path.join(f.record, "state.json"),
      JSON.stringify(crashed),
    );
    fs.appendFileSync(f.spec.tasks[0].sourcePath, " Changed outcome.");
    await host.advance(f.record, owner);
    assert.equal(state(f).tasks.task0.status, "draining");
    assert.equal(state(f).tasks.task0.attempts.length, 1);
    assert.equal(host.status(f.record).continuation.needsAttention, true);
    assert.equal(host.status(f.record).continuation.waiting, false);
    fs.writeFileSync(process.env.HOST_TEST_MERGED, "late actual merge");
    await host.advance(f.record, owner);
    const observed = state(f);
    assert.equal(observed.tasks.task0.landings.length, 1);
    assert.equal(observed.tasks.task0.outcome, undefined);
    assert.equal(host.status(f.record).continuation.needsAttention, false);
  });
}

test("uncapped native tiers and queue bounds require explicit finite configuration", async (t) => {
  const f = setup(t);
  f.config.models.fable = { ...f.config.models.opus };
  await assert.rejects(
    host.initialise(f.record, f.spec, owner, f.config),
    /distinct native models/,
  );
  f.config.models.fable = { model: "fixture-fable" };
  f.config.maxPendingPolls = 0;
  await assert.rejects(
    host.initialise(f.record, f.spec, owner, f.config),
    /maxPendingPolls/,
  );
});

test("covered gate evidence reaches only the matching revision's next canonical attempt", async (t) => {
  const f = await initialise(t);
  process.env.HOST_TEST_GATE = "merge the reviewed task PR";
  await converge(f);
  const blocked = state(f),
    spent = structuredClone(blocked.execution.pools.task0.spent);
  assert.equal(blocked.tasks.task0.status, "blocked");
  blocked.tasks.task0.coveredGates = [
    {
      declaration: "stale gate",
      revision: "old revision",
      authorityHash: blocked.authorityHash,
      evidence: "old mapping",
    },
  ];
  fs.writeFileSync(path.join(f.record, "state.json"), JSON.stringify(blocked));
  await host.transition(
    f.record,
    {
      type: "cover-gate",
      taskId: "task0",
      declaration: process.env.HOST_TEST_GATE,
      assessment: {
        withinAuthority: true,
        authorityHash: blocked.authorityHash,
        evidence: "Exact task merge is already authorised",
      },
    },
    owner,
  );
  assert.deepEqual(state(f).execution.pools.task0.spent, spent);
  await host.transition(f.record, { type: "retry", taskId: "task0" }, owner);
  await host.transition(f.record, { type: "resume" }, owner);
  await host.advance(f.record, owner);
  const s = state(f),
    args = s.host.runs[s.tasks.task0.attempt.id].args;
  assert.deepEqual(args.waves[0].tasks[0].approvedGates, [
    process.env.HOST_TEST_GATE,
  ]);
  assert.equal(
    JSON.parse(args.authorisation).coveredGates[0].evidence,
    "Exact task merge is already authorised",
  );
  assert.equal(JSON.parse(args.authorisation).coveredGates.length, 1);
});

test("owner recovery releases its proven-dead repository merger lock", async (t) => {
  const f = await initialise(t);
  const lock = path.join(f.repo, ".git", "thread-rollout-merge.lock");
  const processLease = {
    version: 1,
    state: "not-started",
    implementation: state(f).host.release.host.sha256,
  };
  fs.writeFileSync(
    lock,
    JSON.stringify({ pid: 99999999, token: "dead-merge", owner, processLease }),
  );
  await host.recover(
    f.record,
    { ...owner, session: "replacement", epoch: 2 },
    {
      previousCaller: {
        harness: owner.harness,
        account: owner.account,
        session: owner.session,
      },
      previousEpoch: 1,
      previousOwnerStopped: true,
      reason: "owner and merger process stopped",
      requests: {},
    },
  );
  assert.equal(fs.existsSync(lock), false);
  const second = { ...owner, session: "replacement", epoch: 2 };
  for (const filename of [lock, path.join(f.record, ".host.lock")])
    fs.writeFileSync(
      filename,
      JSON.stringify({
        pid: 99999999,
        token: "dead-second-owner",
        owner: second,
        processLease,
      }),
    );
  await host.recover(
    f.record,
    { ...owner, session: "third", epoch: 3 },
    {
      previousCaller: {
        harness: second.harness,
        account: second.account,
        session: second.session,
      },
      previousEpoch: 2,
      previousOwnerStopped: true,
      reason: "second owner and merger process stopped",
      requests: {},
    },
  );
  assert.equal(fs.existsSync(lock), false);
  assert.equal(state(f).execution.epoch, 3);
});

test("SIGKILL of the host fences the surviving merger group and parent EOF stops it before recovery", async (t) => {
  const f = await initialise(t);
  await converge(f);
  const paused = path.join(f.dir, "merger-started.json"),
    payload = path.join(f.dir, "merge-payload.json");
  fs.writeFileSync(payload, JSON.stringify({ taskId: "task0", owner }));
  process.env.HOST_TEST_MERGE_PAUSE = paused;
  const child = spawn(
    process.execPath,
    [host.status(f.record).pinnedHost, "merge", f.record, payload],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let diagnostic = "";
  child.stderr.on("data", (chunk) => {
    diagnostic += chunk;
  });
  const closed = new Promise((resolve) => child.once("exit", resolve));
  let group;
  t.after(() => {
    try {
      child.kill("SIGKILL");
    } catch {}
    if (group) {
      try {
        process.kill(-group, "SIGKILL");
      } catch {}
    }
  });
  const waitFor = async (predicate, message) => {
    const deadline = Date.now() + 10000;
    while (!predicate() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(predicate(), message + ": " + diagnostic);
  };
  await waitFor(
    () => fs.existsSync(paused),
    "merger did not reach fixture pause",
  );
  group = JSON.parse(fs.readFileSync(paused, "utf8")).group;
  process.kill(-group, "SIGSTOP");
  child.kill("SIGKILL");
  await closed;
  const next = { ...owner, session: "replacement", epoch: 2 },
    evidence = {
      previousCaller: {
        harness: owner.harness,
        account: owner.account,
        session: owner.session,
      },
      previousEpoch: 1,
      previousOwnerStopped: true,
      reason: "host died; reconcile surviving process lease",
      requests: {},
    };
  await assert.rejects(
    host.recover(f.record, next, evidence),
    /process group.*running|process group.*stopped/,
  );
  const lock = path.join(f.repo, ".git", "thread-rollout-merge.lock");
  assert.equal(JSON.parse(fs.readFileSync(lock, "utf8")).processGroup, group);
  assert.equal(state(f).execution.epoch, 1);
  process.kill(-group, "SIGCONT");
  await waitFor(() => {
    try {
      process.kill(-group, 0);
      return false;
    } catch (e) {
      return e.code === "ESRCH";
    }
  }, "orphan merger group survived parent EOF");
  assert.equal(fs.existsSync(process.env.HOST_TEST_MERGED), false);
  await host.recover(f.record, next, evidence);
  assert.equal(state(f).execution.epoch, 2);
  assert.equal(fs.existsSync(lock), false);
});

test("a legacy PID-only merger lease cannot prove that the command stopped", async (t) => {
  const f = await initialise(t),
    lock = path.join(f.repo, ".git", "thread-rollout-merge.lock");
  fs.writeFileSync(
    lock,
    JSON.stringify({ pid: 99999999, token: "unknown-process", owner }),
  );
  await assert.rejects(
    host.recover(
      f.record,
      { ...owner, session: "replacement", epoch: 2 },
      {
        previousCaller: {
          harness: owner.harness,
          account: owner.account,
          session: owner.session,
        },
        previousEpoch: 1,
        previousOwnerStopped: true,
        reason: "host stopped, command group is unknown",
        requests: {},
      },
    ),
    /unrecognised process lease/,
  );
  assert.equal(fs.existsSync(lock), true);
  assert.equal(state(f).execution.epoch, 1);
});


test("new preparation binds exact authority and external verifier inputs", async (t) => {
  const f = setup(t);
  const missing = structuredClone(f.spec); delete missing.authority.evidence;
  await assert.rejects(host.initialise(f.record, missing, owner, f.config), /authority.*evidence|userText/);
  const external = path.join(f.dir, "verifier.sh");
  fs.writeFileSync(external, "exit 0\n");
  f.spec.repository.verifier = `bash '${external}'`;
  f.spec.repository.verifierInputs = [external];
  await host.initialise(f.record, f.spec, owner, f.config);
  const s = state(f);
  assert.equal(s.host.evidenceContractVersion, 1);
  assert.equal(s.authority.evidence.userText, f.spec.authority.evidence.userText);
  assert.match(s.repository.verifierInputs[0].sha256, /^[a-f0-9]{64}$/);
  fs.writeFileSync(external, "exit 1\n");
  await assert.rejects(host.advance(f.record, owner), /verifier input.*changed/);
  assert.equal(state(f).execution.pools.task0.spent.calls, 0);
});

async function reviewEnvelope(f) {
  await completeRequest(f, "task0", "implement-child", { verified: true, verifiedHead: f.head, prUrl: "https://github.com/acme/widgets/pull/1", summary: "passed" });
  const request = (await host.advance(f.record, owner)).requests.find(r => r.status === "pending");
  const claim = await host.claim(f.record, "task0", request.id, owner);
  await host.bind(f.record, "task0", request.id, claim.claimToken, "review-child", owner);
  return { version: 1, runId: claim.runId, requestId: request.id, claimToken: claim.claimToken, childId: "review-child", caller: claim.caller, status: "ok", output: { verdict: "approve", reviewedHead: f.head, feedback: [] } };
}

test("built-in review receipt is required, bound, and immutable across duplicate results", async (t) => {
  const f = await initialise(t);
  const envelope = await reviewEnvelope(f);
  await assert.rejects(host.accept(f.record, "task0", envelope, owner), /review receipt/);
  const receipt = reviewReceipt(f, envelope.requestId, envelope.childId);
  for (const change of [{ childId: "someone-else" }, { reviewedHead: "b".repeat(40) }, { engine: "hand-rolled" }, { reviewLevel: "high" }]) {
    await assert.rejects(host.accept(f.record, "task0", envelope, owner, { ...receipt, ...change }), /review receipt|review engine|review level/);
  }
  await host.accept(f.record, "task0", envelope, owner, receipt);
  await host.accept(f.record, "task0", envelope, owner, receipt);
  await assert.rejects(host.accept(f.record, "task0", envelope, owner, { ...receipt, invocationId: "different-invocation" }), /conflicting.*receipt/);
  await host.advance(f.record, owner);
  const s = state(f);
  assert.match(s.tasks.task0.approval.reviewReceipt, /^[a-f0-9]{64}$/);
  assert.ok(s.tasks.task0.approval.verifierInputs);
});

test("supplementary verification reserves once, binds commit, and cannot approve a task", async (t) => {
  const f = await initialise(t);
  await host.advance(f.record, owner);
  const before = state(f).execution.pools.task0.spent.verifierRuns;
  const operation = { operationId: "diagnostic-1", commit: f.head, purpose: "Recover missing verifier output" };
  const first = await host.verifyTask(f.record, "task0", operation, owner);
  const again = await host.verifyTask(f.record, "task0", operation, owner);
  assert.deepEqual(again, first);
  assert.equal(first.result.exitCode, 0);
  assert.equal(first.result.commit, f.head);
  assert.equal(state(f).execution.pools.task0.spent.verifierRuns, before + 1);
  assert.equal(state(f).tasks.task0.approval, undefined);
  await assert.rejects(host.verifyTask(f.record, "task0", { ...operation, purpose: "different" }, owner), /conflicting.*verification/);
});


test("recovery fences supplementary verification and retains its reservation", async (t) => {
  const f = await initialise(t);
  await host.advance(f.record, owner);
  const operation = { operationId: "recover-diagnostic", commit: f.head, purpose: "diagnostic" };
  await host.verifyTask(f.record, "task0", operation, owner);
  const saved = state(f), spent = saved.execution.pools.task0.spent.verifierRuns;
  const record = Object.values(saved.host.verifications)[0];
  record.status = "running"; delete record.result;
  fs.writeFileSync(path.join(f.record, "state.json"), JSON.stringify(saved));
  const implementation = saved.host.release.host.sha256;
  const lease = { pid: process.pid, token: "fixture-verifier-token", owner, processLease: { version: 1, state: "not-started", implementation } };
  fs.writeFileSync(record.leasePath, JSON.stringify(lease));
  const next = { ...owner, session: "replacement", epoch: 2 };
  const evidence = { previousCaller: { harness: owner.harness, account: owner.account, session: owner.session }, previousEpoch: 1,
    previousOwnerStopped: true, reason: "verified dead prior host", requests: {} };
  await assert.rejects(host.recover(f.record, next, evidence), /still running|proven stopped/);
  assert.equal(state(f).execution.epoch, 1);
  lease.pid = 99999999;
  fs.writeFileSync(record.leasePath, JSON.stringify(lease));
  await host.recover(f.record, next, evidence);
  const recovered = await host.verifyTask(f.record, "task0", operation, next);
  assert.equal(recovered.status, "interrupted");
  assert.equal(recovered.result, undefined);
  assert.equal(state(f).execution.pools.task0.spent.verifierRuns, spent);
  assert.equal(fs.existsSync(record.leasePath), false);
});


test("supplementary verification cannot exceed allowance, even after restart", async (t) => {
  const f = await initialise(t, { allowance: { calls: 8, verifierRuns: 1, recoveries: 2 } });
  await host.advance(f.record, owner);
  const operation = { operationId: "only-check", commit: f.head, purpose: "diagnostic" };
  const first = await host.verifyTask(f.record, "task0", operation, owner);
  await assert.rejects(host.verifyTask(f.record, "task0", { ...operation, operationId: "extra-check" }, owner), /allowance exhausted/);
  assert.equal(state(f).execution.pools.task0.spent.verifierRuns, 1);
  assert.deepEqual(await host.verifyTask(f.record, "task0", operation, owner), first);
});

test("captured native review evidence cannot be changed before progress", async (t) => {
  const f = await initialise(t), envelope = await reviewEnvelope(f);
  await host.accept(f.record, "task0", envelope, owner, reviewReceipt(f, envelope.requestId, envelope.childId));
  const run = Object.values(state(f).host.runs)[0];
  const captured = run.accepted[envelope.requestId].reviewReceipt.nativeEvidence.path;
  fs.chmodSync(captured, 0o600);
  fs.writeFileSync(captured, "changed evidence");
  await assert.rejects(host.advance(f.record, owner), /review evidence.*changed/);
  assert.equal(state(f).tasks.task0.approval, undefined);
});


test("rejected review formatting cannot poison corrected native evidence", async (t) => {
  const f = await initialise(t), envelope = await reviewEnvelope(f);
  const receipt = reviewReceipt(f, envelope.requestId, envelope.childId);
  envelope.output.feedback = "not an array";
  await assert.rejects(host.accept(f.record, "task0", envelope, owner, receipt), /schema rejected/);
  assert.equal(Object.values(state(f).host.runs)[0].accepted[envelope.requestId], undefined);
  fs.appendFileSync(receipt.nativeEvidence.path, "\nSame child corrected output after schema rejection.\n");
  envelope.output.feedback = [];
  await host.accept(f.record, "task0", envelope, owner, receipt);
  await host.advance(f.record, owner);
  assert.ok(state(f).tasks.task0.approval);
});
