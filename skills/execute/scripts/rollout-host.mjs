#!/usr/bin/env node
/** Protocol 4 durable host. Convergence belongs exclusively to the pinned Workflow engine.
 * This module never spawns a model: the native lead claims, spawns, binds and accepts children.
 * CLI: rollout-host.mjs COMMAND DIRECTORY PAYLOAD.json; status needs no payload.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createRollout,
  apply,
  eligible,
  summary,
  digest,
} from "./rollout-state.mjs";
const execute = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const loadedHost = fs.readFileSync(fileURLToPath(import.meta.url));
const loadedState = fs.readFileSync(path.join(HERE, "rollout-state.mjs"));
const demand = (ok, message) => {
  if (!ok) throw new Error(message);
};
const clone = (v) => structuredClone(v);
const bytes = (v) => crypto.createHash("sha256").update(v).digest("hex");
const terminal = new Set(["accepted", "blocked", "denied", "interrupted"]);
const context = (o) => ({
  harness: o.harness,
  account: o.account,
  session: o.session,
});
const nativeContext = (o, run) => ({
  ...context(o),
  epoch: run?.snapshot?.ownershipEpoch ?? 1,
});
const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
function atomic(filename, value) {
  const tmp = filename + "." + crypto.randomUUID() + ".tmp",
    fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filename);
  const directory = fs.openSync(path.dirname(filename), "r");
  try {
    fs.fsyncSync(directory);
  } finally {
    fs.closeSync(directory);
  }
}
function privateDirectory(directory) {
  demand(path.isAbsolute(directory), "record directory must be absolute");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  demand(
    stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
    "record directory must be private mode 700 and not a symlink",
  );
}
function acquire(filename, owner, { processLease = false } = {}) {
  let fd;
  try {
    fd = fs.openSync(filename, "wx", 0o600);
  } catch (e) {
    if (e.code === "EEXIST")
      throw new Error(
        `Exclusive lock exists: ${filename}; reconcile its actual owner before recovery`,
      );
    throw e;
  }
  const token = crypto.randomUUID();
  fs.writeFileSync(
    fd,
    JSON.stringify({
      pid: process.pid,
      token,
      owner,
      ...(processLease
        ? {
            processLease: {
              version: 1,
              state: "not-started",
              implementation: bytes(loadedHost),
            },
          }
        : {}),
      createdAt: new Date().toISOString(),
    }),
  );
  fs.fsyncSync(fd);
  const release = () => {
    fs.closeSync(fd);
    const lock = read(filename);
    demand(lock.token === token, "lock ownership changed");
    if (processLease) assertProcessLeaseStopped(lock);
    fs.unlinkSync(filename);
  };
  release.recordProcessGroup = (processGroup) => {
    demand(
      processLease && Number.isSafeInteger(processGroup) && processGroup > 0,
      "invalid process lease group",
    );
    const lock = read(filename);
    demand(
      lock.token === token && lock.processLease.state === "not-started",
      "process lease ownership changed",
    );
    atomic(filename, {
      ...lock,
      processGroup,
      processLease: { ...lock.processLease, state: "released" },
    });
  };
  return release;
}
function assertProcessLeaseStopped(lock) {
  const lease = lock.processLease;
  demand(
    lease?.version === 1 && lease.implementation === bytes(loadedHost),
    "unrecognised process lease; actual command ownership must be reconciled",
  );
  if (lease.state === "not-started") {
    demand(!lock.processGroup, "not-started process lease has a group");
    return;
  }
  demand(
    lease.state === "released" &&
      Number.isSafeInteger(lock.processGroup) &&
      lock.processGroup > 0,
    "process group evidence unavailable",
  );
  let stopped = false;
  try {
    process.kill(-lock.processGroup, 0);
  } catch (e) {
    stopped = e.code === "ESRCH";
  }
  demand(
    stopped,
    "leased process group is still running or cannot be proven stopped",
  );
}
function assertOwner(s, o) {
  demand(
    o &&
      o.harness === s.execution.owner.harness &&
      o.account === s.execution.owner.account &&
      o.session === s.execution.owner.session &&
      o.epoch === s.execution.epoch,
    "stale owner or epoch",
  );
}
async function transaction(directory, owner, action, { recover = false } = {}) {
  privateDirectory(directory);
  const release = acquire(path.join(directory, ".host.lock"), owner);
  try {
    let s = read(path.join(directory, "state.json"));
    if (!recover) {
      assertOwner(s, owner);
      demand(
        !s.host?.recoveryIntent,
        "ownership recovery is in progress; resume that exact transfer",
      );
      checkRelease(s);
      checkVerifierInputs(s.repository);
    }
    const tx = {
      directory,
      get state() {
        return s;
      },
      set state(v) {
        s = v;
      },
      save() {
        atomic(path.join(directory, "state.json"), s);
      },
      apply(command) {
        s = apply(s, command, owner);
        return s;
      },
    };
    const result = await action(tx);
    tx.save();
    return result === undefined ? view(s) : result;
  } finally {
    release();
  }
}
async function command(binary, args, options = {}) {
  try {
    const r = await execute(binary, args, {
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120000,
      ...options,
    });
    return { exitCode: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    return {
      exitCode: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout || "",
      stderr: e.stderr || e.message,
    };
  }
}
async function checked(binary, args, options) {
  const r = await command(binary, args, options);
  demand(r.exitCode === 0, `${binary} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}
const git = (repo, ...args) => checked("git", ["-C", repo, ...args]);
function repositoryIdentity(origin) {
  const m =
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i.exec(
      origin,
    );
  demand(m, "origin must identify a GitHub repository");
  return "github.com/" + m[1];
}
async function resolveRepository(repository) {
  demand(path.isAbsolute(repository.path), "repository path must be absolute");
  const identity = repositoryIdentity(
    await git(repository.path, "remote", "get-url", "origin"),
  );
  demand(
    !repository.identity ||
      repository.identity.toLowerCase() === identity.toLowerCase(),
    "repository identity differs from origin",
  );
  const slug = identity.slice("github.com/".length);
  const baseBranch =
    repository.baseBranch ||
    (await checked("gh", [
      "repo",
      "view",
      slug,
      "--json",
      "defaultBranchRef",
      "-q",
      ".defaultBranchRef.name",
    ]));
  await checked("git", ["check-ref-format", "--branch", baseBranch]);
  demand(
    typeof repository.verifier === "string" && repository.verifier.trim(),
    "verifier is required",
  );
  return { ...clone(repository), identity, baseBranch };
}
async function fetchBase(repository) {
  await git(
    repository.path,
    "fetch",
    "--quiet",
    "origin",
    repository.baseBranch,
  );
  return git(repository.path, "rev-parse", "FETCH_HEAD^{commit}");
}
function validConfig(config, owner) {
  demand(
    config && path.isAbsolute(config.nativeAdapter || ""),
    "nativeAdapter must be an explicit absolute path",
  );
  demand(
    config.account === owner.account,
    "native adapter account must match owner",
  );
  demand(
    Number.isSafeInteger(config.maxConcurrent) && config.maxConcurrent > 0,
    "maxConcurrent must be positive",
  );
  if (config.claudeReviewProtocol !== undefined)
    demand(owner.harness === "claude" && config.routingPolicy && config.claudeReviewProtocol === "claude-fork-v1",
      "claudeReviewProtocol requires the prepared Claude routing policy");
  for (const tier of config.routingPolicy ? [] : ["opus", "fable"]) {
    const b = config.models?.[tier];
    demand(
      b &&
        typeof b === "object" &&
        (b.inherit === true || (typeof b.model === "string" && b.model.trim())),
      `explicit native mapping required for ${tier}`,
    );
  }
  for (const key of ["maxIterations", "maxPlanRounds", "maxReviewRounds"])
    demand(
      Number.isSafeInteger(config.engine?.[key]) && config.engine[key] > 0,
      `engine.${key} must be positive`,
    );
  demand(!config.engine?.ignoreGate, "ignoreGate is forbidden");
  if (!config.routingPolicy && config.engine.maxTier !== "opus")
    demand(
      config.models.opus.model &&
        config.models.fable.model &&
        config.models.opus.model !== config.models.fable.model,
      "uncapped escalation requires two explicit distinct native models",
    );
  for (const key of ["verifierTimeoutMs", "mergeTimeoutMs", "maxPendingPolls"])
    if (config[key] !== undefined)
      demand(
        Number.isSafeInteger(config[key]) && config[key] > 0,
        `${key} must be positive`,
      );
}
function bindVerifierInputs(repository) {
  demand(Array.isArray(repository.verifierInputs), "repository.verifierInputs must explicitly declare external inputs (or [])");
  return repository.verifierInputs.map((input) => {
    const filename = typeof input === "string" ? input : input.path;
    demand(path.isAbsolute(filename || ""), "verifier input path must be absolute");
    demand(fs.statSync(filename).isFile(), "verifier input must be a file");
    return { path: filename, realPath: fs.realpathSync(filename), sha256: bytes(fs.readFileSync(filename)) };
  });
}
function validateVerifierContract(repository, tasks) {
  const contract = repository.verifierContract;
  const modes = (value) => Array.isArray(value) && value.length > 0 &&
    value.every(v => typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(v)) &&
    new Set(value).size === value.length;
  if (contract === undefined) {
    demand(tasks.every(t => t.verifierModes === undefined), "task.verifierModes requires repository.verifierContract");
    return;
  }
  demand(contract && contract.version === 1 &&
    Object.keys(contract).every(k => ["version", "baselineModes", "rollbackModes"].includes(k)) && modes(contract.baselineModes) &&
    (contract.rollbackModes === undefined || modes(contract.rollbackModes)),
    "verifierContract requires version 1 and nonempty unique baselineModes");
  for (const task of tasks) demand(modes(task.verifierModes), `task ${task.id} requires nonempty unique verifierModes`);
}
function reportResult(repository, commit, result) {
  if (!repository.verifierContract || result.exitCode !== 0) return result;
  try {
    const report = JSON.parse(result.stdout);
    demand(report && !Array.isArray(report) && Object.keys(report).every(k => ["mode", "head"].includes(k)) &&
      typeof report.mode === "string" && report.mode.trim(), "verifier JSON report requires mode and head only");
    demand(report.head === commit, "verifier report head differs from verified commit");
    return { ...result, report };
  } catch (error) {
    return { ...result, processExitCode: result.exitCode, exitCode: 1,
      stderr: `${result.stderr || ""}\nInvalid verifier JSON report: ${error.message}` };
  }
}
function verificationAccepted(s, t, result) {
  if (result.exitCode !== 0) return false;
  if (!s.repository.verifierContract) return true;
  const modes = !t ? s.repository.verifierContract.baselineModes
    : t.attempt?.purpose === "rollback" ? s.repository.verifierContract.rollbackModes : t.verifierModes;
  return result.report?.head === result.commit && modes.includes(result.report.mode);
}
function checkVerifierInputs(repository) {
  for (const input of repository.verifierInputs || [])
    demand(fs.existsSync(input.path) && fs.realpathSync(input.path) === input.realPath &&
      bytes(fs.readFileSync(input.path)) === input.sha256, `verifier input changed: ${input.path}`);
}
function immutable(filename, text, mode = 0o400) {
  if (fs.existsSync(filename)) {
    demand(
      bytes(fs.readFileSync(filename)) === bytes(text),
      "immutable snapshot differs from requested content",
    );
    return { path: filename, sha256: bytes(text) };
  }
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const fd = fs.openSync(filename, "wx", mode);
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return { path: filename, sha256: bytes(text) };
}
function pinRelease(directory, s, config) {
  const releaseDirectory = path.join(
      directory,
      "executions",
      s.execution.id,
      "release",
    ),
    previous = s.host?.release,
    out = {};
  for (const [key, source, name] of [
    [
      "engine",
      previous?.engine.path || path.join(HERE, "../wave-execute.workflow.js"),
      "engine.js",
    ],
    [
      "merger",
      previous?.merger.path || path.join(HERE, "merge-wave.sh"),
      "merger.sh",
    ],
    [
      "adapter",
      previous?.adapter.path || config.nativeAdapter,
      "native-adapter.mjs",
    ],
    [
      "host",
      previous?.host.path || fileURLToPath(import.meta.url),
      "rollout-host.mjs",
    ],
    [
      "state",
      previous?.state.path || path.join(HERE, "rollout-state.mjs"),
      "rollout-state.mjs",
    ],
  ]) {
    const content =
      !previous && key === "host"
        ? loadedHost
        : !previous && key === "state"
          ? loadedState
          : fs.readFileSync(source);
    out[key] = {
      ...immutable(
        path.join(releaseDirectory, name),
        content,
        key === "merger" ? 0o500 : 0o400,
      ),
      source,
    };
  }
  const routingSource = previous?.routing?.path || path.join(path.dirname(config.nativeAdapter), "native_routing.mjs");
  if (previous?.routing || fs.existsSync(routingSource)) {
    const policySource = previous?.routingPolicy?.path || path.resolve(path.dirname(config.nativeAdapter), "../state/native-routing-policy.json");
    out.routing = { ...immutable(path.join(releaseDirectory, "native_routing.mjs"), fs.readFileSync(routingSource)), source: routingSource };
    out.routingPolicy = { ...immutable(path.resolve(releaseDirectory, "../state/native-routing-policy.json"), fs.readFileSync(policySource)), source: policySource };
  }
  return out;
}
function checkRelease(s) {
  for (const r of Object.values(s.host.release))
    demand(
      bytes(fs.readFileSync(r.path)) === r.sha256,
      "pinned runtime changed; execution cannot continue",
    );
  demand(
    bytes(loadedHost) === s.host.release.host.sha256 &&
      bytes(loadedState) === s.host.release.state.sha256,
    "installed host/state differs from this execution; invoke its pinnedHost",
  );
  for (const run of Object.values(s.host.runs || {}))
    for (const accepted of Object.values(run.accepted || {})) {
      const evidence = accepted.reviewReceipt?.nativeEvidence;
      if (evidence) demand(fs.existsSync(evidence.path) && bytes(fs.readFileSync(evidence.path)) === evidence.sha256,
        "captured native review evidence changed");
    }
  for (const run of Object.values(s.host.runs || {}))
    for (const evidence of Object.values(run.reviewForkEvidence || {}))
      demand(fs.existsSync(evidence.path) && bytes(fs.readFileSync(evidence.path)) === evidence.sha256,
        "captured native fork evidence changed");
}
const forkReview = (request) => request.options?.reviewContract?.protocol === "claude-fork-v1";
const requestCalls = (request) => forkReview(request) ? 2 : 1;
const reservedNativeSlots = (s) => Object.values(s.execution.requests)
  .filter(r => ["claimed", "dispatched"].includes(r.status)).reduce((sum, r) => sum + (r.calls || 1), 0);
function assertNativeIdentity(s, requestId, values, { wrapper = false } = {}) {
  demand(values.every(v => typeof v === "string" && v.trim()) && new Set(values).size === values.length,
    "distinct native identities required");
  for (const r of Object.values(s.execution.requests)) {
    const occupied = [r.childId, r.reviewFork?.childId, r.reviewFork?.invocationId].filter(Boolean);
    for (const v of values) demand(!occupied.includes(v) ||
      (r.id === requestId && (wrapper ? r.childId === v : [r.reviewFork?.childId, r.reviewFork?.invocationId].includes(v))),
      "independent native identities required across task runs");
  }
}
async function adapter(s) {
  checkRelease(s);
  return import(pathToFileURL(s.host.release.adapter.path).href);
}
function adopt(directory, s, t) {
  const actual = fs.readFileSync(t.sourcePath, "utf8");
  demand(
    actual === t.revision.requirements,
    `source requirements do not agree for ${t.id}`,
  );
  const filename = path.join(
    directory,
    "executions",
    s.execution.id,
    "requirements",
    t.id,
    `${t.revision.number}-${t.revision.hash}.md`,
  );
  return {
    ...immutable(filename, actual),
    revision: t.revision.hash,
    sourcePath: t.sourcePath,
  };
}
async function checkMergeEffects(repository, base, authority) {
  const paths = (
    await git(
      repository.path,
      "ls-tree",
      "-r",
      "--name-only",
      base,
      ".github/workflows",
    )
  )
    .split("\n")
    .filter(Boolean);
  for (const file of paths) {
    const body = await git(repository.path, "show", `${base}:${file}`);
    if (/\b(deploy|publish|deployment|production|release|pages)\b/i.test(body))
      demand(
        authority.mergeEffects.some(
          (e) =>
            e &&
            typeof e === "object" &&
            e.path === file &&
            e.authorised === true &&
            typeof e.description === "string" &&
            e.description.trim(),
        ),
        `unrecognised deployment/publication effect in ${file}; explicit mergeEffects authority required`,
      );
  }
}
// The detached supervisor cannot release the command until its group is durably
// leased. Its private stdin stays open for the owner's lifetime; EOF kills only
// the supervisor's own process group, never a recovered or reused PID.
const leasedSupervisor = `
const {spawn}=require('node:child_process');
let started=false, stopping=false, input='';
function stop(){if(stopping)return;stopping=true;try{process.kill(-process.pid,'SIGTERM')}catch{};setTimeout(()=>{try{process.kill(-process.pid,'SIGKILL')}catch{}},250)}
process.on('SIGTERM',stop);
process.stdin.on('end',stop);process.stdin.on('error',stop);
process.stdin.on('data',chunk=>{input+=chunk;if(started||!input.includes('\\n'))return;if(input!=='run\\n'){stop();return}started=true;const child=spawn(process.argv[1],process.argv.slice(2),{stdio:['ignore','inherit','inherit']});child.on('error',e=>{process.stderr.write(e.message);stop()});child.on('exit',(code)=>{if(!stopping)process.exit(code??1)})});
`;
async function boundedProcess(
  binary,
  args,
  { cwd, timeout = 600000, lease } = {},
) {
  return new Promise((resolve) => {
    let stdout = "",
      stderr = "",
      timedOut = false,
      overflow = false,
      killTimer;
    const child = spawn(
      lease ? process.execPath : binary,
      lease ? ["-e", leasedSupervisor, binary, ...args] : args,
      {
        cwd,
        detached: true,
        stdio: [lease ? "pipe" : "ignore", "pipe", "pipe"],
      },
    );
    const terminate = () => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 250);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeout);
    const collect = (channel, chunk) => {
      if (channel === "stdout") stdout += chunk;
      else stderr += chunk;
      if (stdout.length + stderr.length > 8 * 1024 * 1024 && !overflow) {
        overflow = true;
        terminate();
      }
    };
    child.stdout.on("data", (c) => collect("stdout", c));
    child.stderr.on("data", (c) => collect("stderr", c));
    if (lease) {
      child.stdin.on("error", () => {});
      child.once("spawn", () => {
        try {
          lease.recordProcessGroup(child.pid);
          child.stdin.write("run\n");
        } catch (e) {
          stderr += e.message;
          terminate();
        }
      });
    }
    child.on("error", (e) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({ exitCode: 1, stdout, stderr: e.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({
        exitCode: timedOut ? 124 : overflow ? 125 : (code ?? 1),
        stdout,
        stderr,
        signal,
        timedOut,
      });
    });
  });
}
async function verify(
  directory,
  repository,
  commit,
  purpose,
  timeoutMs = 600000,
  lease,
) {
  checkVerifierInputs(repository);
  const worktree = path.join(directory, "verification", crypto.randomUUID());
  fs.mkdirSync(path.dirname(worktree), { recursive: true, mode: 0o700 });
  await git(repository.path, "worktree", "add", "--detach", worktree, commit);
  let result;
  try {
    demand(
      (await git(worktree, "rev-parse", "HEAD")) === commit,
      "verification worktree base mismatch",
    );
    demand(
      (await git(worktree, "status", "--porcelain")) === "",
      "verification worktree is not clean",
    );
    result = await boundedProcess("/bin/bash", ["-lc", repository.verifier], {
      cwd: worktree,
      timeout: timeoutMs,
      lease,
    });
    checkVerifierInputs(repository);
    return {
      purpose,
      commit,
      command: repository.verifier,
      ...reportResult(repository, commit, result),
      finishedAt: new Date().toISOString(),
    };
  } finally {
    const removal = await command("git", [
      "-C",
      repository.path,
      "worktree",
      "remove",
      worktree,
    ]);
    if (result)
      result.cleanup =
        removal.exitCode === 0
          ? "removed"
          : "retained (verifier modified the worktree)";
  }
}
function view(s) {
  const requests = [];
  for (const [attemptId, run] of Object.entries(s.host?.runs || {})) {
    const t = s.tasks[run.taskId];
    if (!t?.attempt || t.attempt.id !== attemptId) continue;
    for (const r of run.snapshot?.requests || []) {
      const durable = s.execution.requests[r.id];
      requests.push({
        ...r,
        taskId: t.id,
        attemptId,
        runId: run.snapshot.runId,
        resultCaller: nativeContext(s.execution.owner, run),
        ...(durable
          ? { status: durable.status, childId: durable.childId || r.childId }
          : {}),
        claimable:
          r.status === "pending" &&
          !durable &&
          t.status === "active" &&
          !t.attempt.superseded &&
          ["running", "pausing"].includes(s.execution.status),
      });
    }
  }
  const result = {
    ...summary(s),
    tasks: Object.values(s.tasks).map((t) => ({
      taskId: t.id,
      sourcePath: t.sourcePath,
      member: t.member,
      status: t.status,
      revision: { number: t.revision.number, hash: t.revision.hash },
      reason: t.reason || t.hostProblem || "",
      prUrl:
        t.approval?.prUrl ||
        t.attempt?.result?.prUrl ||
        t.landings.at(-1)?.prUrl ||
        null,
      outcome: t.outcome || null,
      attemptId: t.attempt?.id || null,
      evidenceRecord: s.host.statePath,
    })),
    pinnedHost: s.host.release.host.path,
    allowances: Object.fromEntries(
      Object.entries(s.execution.pools).map(([id, p]) => [
        id,
        {
          spent: p.spent,
          limit: p.limit,
          remaining: Object.fromEntries(
            Object.keys(p.limit).map((k) => [k, p.limit[k] - p.spent[k]]),
          ),
        },
      ]),
    ),
    recoveryPending: !!s.host.recoveryIntent,
    requests,
    readyToMerge: Object.values(s.tasks)
      .filter((t) => ["review", "waiting"].includes(t.status) && t.approval)
      .map((t) => t.id),
    mergeHold: s.execution.mergeHold,
    assessments: Object.values(s.tasks)
      .filter((t) => t.requiresAssessment)
      .map((t) => ({ taskId: t.id, reason: t.reason })),
    interrupt: Object.values(s.execution.requests)
      .filter(
        (r) =>
          ["claimed", "dispatched"].includes(r.status) &&
          (s.execution.status === "stopped" ||
            s.tasks[r.taskId].attempt?.superseded),
      )
      .map((r) => ({
        taskId: r.taskId,
        requestId: r.id,
        childId: r.childId || null,
        ...(r.reviewFork ? { reviewFork: r.reviewFork } : {}),
      })),
  };
  result.continuation = continuation(s, result);
  return result;
}
function pendingQueue(s, t) {
  return Object.values(s.host.merges).some(
    (m) => m.taskId === t.id && !m.queueResolved,
  );
}
function resolveMerge(operation, status) {
  operation.queueResolved = true;
  operation.status = status;
  delete operation.pendingPolls;
  delete operation.needsAttention;
}
function continuation(s, v) {
  const runnable = ["running", "pausing"].includes(s.execution.status),
    requests = Object.values(s.execution.requests),
    inflight = requests.filter((r) =>
      ["claimed", "dispatched"].includes(r.status),
    );
  const freeSlots = s.host.config.maxConcurrent - reservedNativeSlots(s);
  const capacity = freeSlots > 0;
  const ambiguous = inflight.some((r) => r.status === "claimed" && !r.childId);
  const unresolved = Object.values(s.host.merges).filter(
    (m) => !m.queueResolved,
  );
  const queue = unresolved.some((m) => m.report?.outcome === "pending");
  const uncertainMerge = unresolved.some(
    (m) => m.report?.outcome !== "pending",
  );
  const waiting =
    inflight.some((r) => r.status === "dispatched" && r.childId) || queue;
  const replayable = Object.values(s.tasks).some(
    (t) => t.status === "active" && !outstanding(s, t).length,
  );
  const drain = Object.values(s.tasks).some(
    (t) =>
      t.status === "draining" &&
      !outstanding(s, t).length &&
      !pendingQueue(s, t),
  );
  const immediateMerge = v.readyToMerge.some((id) => {
    const t = s.tasks[id];
    return (
      t.status === "review" ||
      s.host.merges[t.approval.digest]?.report?.outcome !== "pending"
    );
  });
  const actionable =
    runnable &&
    !s.host.recoveryIntent &&
    (ambiguous ||
      replayable ||
      drain ||
      immediateMerge ||
      (capacity &&
        (v.requests.some((r) => r.claimable && requestCalls(r) <= freeSlots) || eligible(s).length > 0)) ||
      (!inflight.length &&
        !Object.values(s.tasks).some((t) =>
          ["active", "review", "waiting", "draining"].includes(t.status),
        )));
  return {
    actionable: !!actionable,
    needsAttention:
      !!s.host.recoveryIntent ||
      uncertainMerge ||
      unresolved.some((m) => m.needsAttention),
    waiting: !!waiting,
    reason: s.host.recoveryIntent
      ? "ownership recovery incomplete"
      : uncertainMerge
        ? "merge request outcome requires evidence reconciliation"
        : unresolved.some((m) => m.needsAttention)
          ? "merge queue inactivity requires evidence reconciliation"
          : ambiguous
            ? "claimed native request requires evidence reconciliation"
            : actionable
              ? "host has a ready transition"
              : waiting
                ? "evidenced native child or merge queue remains in flight"
                : `execution ${s.execution.status}; no evidenced in-flight activity`,
  };
}
export function status(directory) {
  const s = read(path.join(directory, "state.json")),
    v = view(s),
    locked = fs.existsSync(path.join(directory, ".host.lock"));
  return {
    ...v,
    locked,
    ...(locked
      ? {
          continuation: {
            actionable: false,
            needsAttention: true,
            waiting: false,
            reason: "exclusive host lock requires owner reconciliation",
          },
        }
      : {}),
  };
}
export async function initialise(directory, spec, owner, config) {
  privateDirectory(directory);
  const release = acquire(path.join(directory, ".host.lock"), owner);
  try {
    demand(
      !fs.existsSync(path.join(directory, "state.json")),
      "record already exists; advance or recover it",
    );
    validConfig(config, owner);
    for (const key of ["userText", "context", "source"])
      demand(typeof spec.authority?.evidence?.[key] === "string" && spec.authority.evidence[key].trim(), `authority.evidence.${key} must preserve exact authorisation evidence`);
    if (config.routingPolicy) {
      for (const key of ["maxTier", "judgeModel", "model", "effort"])
        demand(config.engine[key] === undefined, `engine.${key} is legacy-only; prepare a native routingPolicy (recovery:null for a resource ceiling, exactModel for a requested author)`);
      for (const task of spec.tasks)
        demand(task.model === undefined && task.effort === undefined,
          `task ${task.id} model/effort overrides are legacy-only; preserve requested author/effort in the prepared native policy`);
      const routing = await import(pathToFileURL(path.join(path.dirname(config.nativeAdapter), "native_routing.mjs")).href);
      config = { ...config, routingPolicy: routing.normaliseRoutingPolicy(config.routingPolicy, { harness: owner.harness }) };
      if (owner.harness === "claude") {
        demand(config.claudeReviewProtocol === undefined || config.claudeReviewProtocol === "claude-fork-v1",
          "new Claude policy executions require claude-fork-v1 review protocol");
        demand(config.maxConcurrent >= 2, "Claude fork review requires two reserved native capacity slots");
        const native = await import(pathToFileURL(config.nativeAdapter).href);
        demand(typeof native.bindReviewFork === "function" && typeof native.recordReviewFork === "function",
          "native adapter lacks durable Claude review fork support");
        config = { ...config, claudeReviewProtocol: "claude-fork-v1" };
      }
      const rounds = config.routingPolicy.recovery ? 3 : 2;
      for (const key of ["maxIterations", "maxReviewRounds", ...(spec.tasks.some(t => t.planGate ?? t.scope === "cross-cutting") ? ["maxPlanRounds"] : [])])
        demand(config.engine[key] >= rounds, `engine.${key} lacks headroom for the prepared effort/recovery path`);
    }
    const resolved = {
      ...clone(spec),
      repository: await resolveRepository(spec.repository),
    };
    resolved.repository.verifierInputs = bindVerifierInputs(resolved.repository);
    validateVerifierContract(resolved.repository, resolved.tasks);
    resolved.evidenceContractVersion = config.claudeReviewProtocol ? 2 : 1;
    if (config.routingPolicy) resolved.routingPolicy = config.routingPolicy;
    let s = createRollout(resolved, owner);
    if (s.repository.verifierContract && s.authority.allowedActions.includes("revert-run-owned"))
      demand(s.repository.verifierContract.rollbackModes, "authorised rollback requires prepared verifierContract.rollbackModes");
    for (const t of Object.values(s.tasks)) {
      demand(path.isAbsolute(t.sourcePath), "sourcePath must be absolute");
      demand(
        fs.readFileSync(t.sourcePath, "utf8") === t.revision.requirements,
        `source requirements do not agree for ${t.id}`,
      );
      demand(
        t.scope !== "read-only",
        "protocol 4 supports PR-shaped tasks only",
      );
    }
    if (config.routingPolicy) {
      const candidates = config.routingPolicy.recovery ? 3 : 2;
      const rollback = s.authority.allowedActions.includes("revert-run-owned");
      for (const task of Object.values(s.tasks)) {
        const gated = task.planGate ?? task.scope === "cross-cutting";
        const perCandidate = config.claudeReviewProtocol ? 3 : 2;
        const minimumCalls = perCandidate * candidates + (gated ? 2 : 0) + (rollback ? perCandidate : 0);
        const minimumVerifiers = candidates * (s.repository.verifierContract ? 2 : 1) + (gated ? 1 : 0) + 2 + (rollback ? 3 + (s.repository.verifierContract ? 1 : 0) : 0);
        const pool = s.execution.pools[task.pool];
        demand(pool.limit.calls >= minimumCalls && pool.limit.verifierRuns >= minimumVerifiers,
          `task ${task.id} allowance lacks prepared correction/review/merge headroom (${minimumCalls} calls, ${minimumVerifiers} verifiers)`);
      }
    }
    const base = await fetchBase(s.repository);
    await checkMergeEffects(s.repository, base, s.authority);
    const baseline = await verify(
      directory,
      s.repository,
      base,
      "baseline",
      config.verifierTimeoutMs,
    );
    demand(
      verificationAccepted(s, null, baseline),
      `baseline verifier report or mode failed: ${baseline.stderr || baseline.stdout || baseline.exitCode}`,
    );
    if (s.authority.allowedActions.includes("revert-run-owned"))
      for (const pool of Object.values(s.execution.pools))
        demand(
          pool.limit.calls > 2 && pool.limit.verifierRuns > 3,
          "authorised rollback needs finite headroom within the original allowance",
        );
    s.host = {
      version: 1,
      evidenceContractVersion: resolved.evidenceContractVersion,
      statePath: path.join(directory, "state.json"),
      rollbackReserve: s.authority.allowedActions.includes("revert-run-owned")
        ? { calls: config.claudeReviewProtocol ? 3 : 2, verifierRuns: s.repository.verifierContract ? 4 : 3 }
        : { calls: 0, verifierRuns: 0 },
      config: clone(config),
      release: pinRelease(directory, s, config),
      baseline,
      adopted: {},
      runs: {},
      merges: {},
      recoveries: [],
      settings: {},
      verifications: {},
    };
    for (const t of Object.values(s.tasks))
      s.host.adopted[t.id] = adopt(directory, s, t);
    atomic(path.join(directory, "state.json"), s);
    return view(s);
  } finally {
    release();
  }
}
export const init = initialise;
function assessSources(tx) {
  let changed = false;
  for (const t of Object.values(tx.state.tasks)) {
    if (!t.member) continue;
    let text;
    try {
      text = fs.readFileSync(t.sourcePath, "utf8");
    } catch (e) {
      text = `SOURCE_UNAVAILABLE:${e.code}`;
    }
    if (digest(text) !== t.revision.hash && !t.requiresAssessment) {
      tx.apply({
        type: "assessment-needed",
        taskId: t.id,
        observedHash: digest(text),
        reason: "source requirements changed; authority assessment required",
      });
      changed = true;
    }
  }
  if (changed) tx.save();
  return changed;
}
function settingsFor(s, t) {
  return (
    s.host.settings?.[t.id]?.at(-1) || {
      models: s.host.config.models,
      roles: s.host.config.roles || {},
      engine: s.host.config.engine,
    }
  );
}
function coveredGates(s, t) {
  return (t.coveredGates || []).filter(
    (gate) =>
      gate.revision === t.revision.hash &&
      gate.authorityHash === s.authorityHash,
  );
}
function engineTask(s, t) {
  const cfg =
      t.attempt.purpose === "rollback"
        ? {
            ...settingsFor(s, t).engine,
            maxIterations: 1,
            maxPlanRounds: 1,
            maxReviewRounds: 1,
            model: settingsFor(s, t).engine.maxTier || "fable",
          }
        : settingsFor(s, t).engine,
    old = t.attempts
      .slice(0, -1)
      .reverse()
      .find((a) => a.result);
  const priorRun = old && s.host.runs[old.id],
    landed = t.landings.length > 0;
  return {
    slug:
      t.attempt.purpose === "rollback"
        ? `${s.rolloutId}-${t.id}-rollback-${t.generation}`
        : landed
          ? `${s.rolloutId}-${t.id}-repair-${t.generation}`
          : priorRun?.args.waves[0].tasks[0].slug || `${s.rolloutId}-${t.id}`,
    taskPath: s.host.adopted[t.id].path,
    scope: t.scope || "single-file",
    planGate:
      t.attempt.purpose === "rollback"
        ? false
        : (t.planGate ?? t.scope === "cross-cutting"),
    maxIterations: cfg.maxIterations,
    maxPlanRounds: cfg.maxPlanRounds,
    maxReviewRounds: cfg.maxReviewRounds,
    ...(!s.host.config.routingPolicy ? {
      model: t.attempt.purpose === "rollback" ? cfg.model : t.model || cfg.model || "opus",
      ...(t.effort ? { effort: t.effort } : {}),
    } : {}),
    ...(t.difficulty ? { difficulty: t.difficulty } : {}),
    ...(t.verifierModes ? { verifierModes: t.attempt.purpose === "rollback" ? s.repository.verifierContract.rollbackModes : t.verifierModes } : {}),
    ...(t.routingState ? { routingState: t.routingState } : {}),
    approvedGates: [
      ...new Set([
        ...s.authority.gates.filter((g) => typeof g === "string"),
        ...coveredGates(s, t).map((g) => g.declaration),
      ]),
    ],
    ...(old ? { priorResult: old.result } : {}),
  };
}
function engineArgs(s, t) {
  const task = engineTask(s, t),
    cfg = settingsFor(s, t).engine;
  return {
    protocolVersion: 4,
    ...(s.host.evidenceContractVersion ? { evidenceContractVersion: s.host.evidenceContractVersion, harness: s.execution.owner.harness } : {}),
    ...(s.host.config.routingPolicy ? { routingPolicy: s.host.config.routingPolicy } : {}),
    ...(s.host.config.claudeReviewProtocol ? { claudeReviewProtocol: s.host.config.claudeReviewProtocol } : {}),
    rolloutSlug: s.rolloutId,
    repoPath: s.repository.path,
    verifier: s.repository.verifier,
    ...(s.repository.verifierContract ? { verifierContract: s.repository.verifierContract } : {}),
    baseBranch: s.repository.baseBranch,
    baseRef: t.attempt.baseRef,
    date: new Date().toISOString().slice(0, 10),
    concurrency: 1,
    authorisation: JSON.stringify({
      authority: s.authority,
      coveredGates: coveredGates(s, t),
      priorAttempt: task.priorResult || null,
      retryPolicy:
        "Reuse the existing task branch and PR. Preserve prior feedback. A changed base requires explicit integration and fresh verification/review; never open a duplicate PR to evade it.",
    }),
    ...(cfg.maxTier ? { maxTier: cfg.maxTier } : {}),
    ...(cfg.judgeModel ? { judgeModel: cfg.judgeModel } : {}),
    ...(cfg.envBootstrap ? { envBootstrap: cfg.envBootstrap } : {}),
    waves: [{ wave: 1, tasks: [task] }],
  };
}
async function initialiseAttempt(tx, t) {
  const s = tx.state,
    existing = s.host.runs[t.attempt.id];
  if (existing) {
    const native = await adapter(s);
    existing.snapshot = fs.existsSync(path.join(existing.directory, "run.json"))
      ? native.inspect(
          existing.directory,
          nativeContext(s.execution.owner, existing),
        )
      : native.initialise(
          existing.directory,
          s.host.release.engine.path,
          existing.args,
          nativeContext(s.execution.owner, existing),
          {
            account: s.execution.owner.account,
            models: existing.settings.models,
            roles: existing.settings.roles || {},
            maxConcurrent: s.host.config.maxConcurrent,
            ...(s.host.config.routingPolicy ? { routingPolicy: s.host.config.routingPolicy } : {}),
          },
        );
    existing.initialisation = "ready";
    tx.save();
    return existing;
  }
  const runDirectory = path.join(
    tx.directory,
    "executions",
    s.execution.id,
    "attempts",
    t.attempt.id,
  );
  let args = engineArgs(s, t);
  if (t.attempt.purpose === "rollback") {
    const brief = `# Authorised rollback attempt\n\nRevert ONLY the following execution-owned squash commits, newest first: ${t.attempt.reverts.join(", ")}.\nUse git revert --no-edit on the adopted base. Never reset, force push, or undo peer work. Stop on any conflict or uncertainty. Open a NEW rollback PR, run the configured verifier, and obtain independent review. Do not implement the original outcome during this rollback.\n\n## Original outcome remains unsatisfied\n${t.revision.requirements}\n\n## Regression evidence\n${s.execution.mergeHold.evidence}\n`;
    args.waves[0].tasks[0].taskPath = immutable(
      path.join(runDirectory, "rollback-task.md"),
      brief,
    ).path;
  }
  const run = {
    taskId: t.id,
    directory: runDirectory,
    args,
    settings: clone(settingsFor(s, t)),
    initialisation: "reserved",
    snapshot: null,
    accepted: {},
  };
  s.host.runs[t.attempt.id] = run;
  tx.save();
  const native = await adapter(s);
  if (fs.existsSync(path.join(runDirectory, "run.json")))
    run.snapshot = native.inspect(
      runDirectory,
      nativeContext(s.execution.owner, run),
    );
  else
    run.snapshot = native.initialise(
      runDirectory,
      s.host.release.engine.path,
      run.args,
      nativeContext(s.execution.owner, run),
      {
        account: s.execution.owner.account,
        models: run.settings.models,
        roles: run.settings.roles || {},
        maxConcurrent: s.host.config.maxConcurrent,
        ...(s.host.config.routingPolicy ? { routingPolicy: s.host.config.routingPolicy } : {}),
      },
    );
  run.initialisation = "ready";
  tx.save();
  return run;
}
function outstanding(s, t) {
  return Object.values(s.execution.requests).filter(
    (r) => r.taskId === t.id && !terminal.has(r.status),
  );
}
function block(tx, t, reason) {
  if (outstanding(tx.state, t).length) {
    t.hostProblem = reason;
    return;
  }
  tx.apply({ type: "block", taskId: t.id, reason });
  tx.save();
}
async function prEvidence(s, url) {
  const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/([1-9][0-9]*)$/.exec(
    url,
  );
  demand(
    m &&
      `github.com/${m[1]}`.toLowerCase() ===
        s.repository.identity.toLowerCase(),
    "PR repository identity mismatch",
  );
  const p = JSON.parse(
    await checked("gh", [
      "pr",
      "view",
      m[2],
      "-R",
      m[1],
      "--json",
      "number,url,state,baseRefName,headRefOid,mergeCommit",
    ]),
  );
  demand(
    p.url === url &&
      String(p.number) === m[2] &&
      p.baseRefName === s.repository.baseBranch,
    "PR base or identity changed",
  );
  demand(/^[a-f0-9]{40}$/.test(p.headRefOid), "PR head evidence unavailable");
  return p;
}
async function consumeComplete(tx, t, run) {
  const result = run.snapshot.output?.tasks;
  demand(
    Array.isArray(result) &&
      result.length === 1 &&
      result[0].slug === run.args.waves[0].tasks[0].slug,
    "canonical engine returned a different task",
  );
  const r = result[0];
  if (r.status !== "review") {
    tx.apply({
      type: "converged",
      taskId: t.id,
      attemptId: t.attempt.id,
      revision: t.revision.hash,
      result: { ...r, reason: r.blockerDiagnosis || r.status },
    });
    return;
  }
  demand(
    r.verified === true && r.verifiedHead && r.verifiedHead === r.reviewedHead,
    "engine did not verify and review the same head",
  );
  const evidence = Object.values(run.accepted);
  const reviews = evidence.filter(
    (e) =>
      e.status === "accepted" && e.label?.startsWith("review:") &&
      e.status === "accepted" &&
      e.output?.verdict === "approve" &&
      e.output.reviewedHead === r.reviewedHead,
  );
  const implementations = evidence.filter(
    (e) =>
      /^(implement|revise):/.test(e.label) &&
      e.status === "accepted" &&
      e.output?.verified === true &&
      e.output.verifiedHead === r.verifiedHead,
  );
  demand(
    reviews.length && implementations.length,
    "independent native review and verification request evidence required",
  );
  const reviewer = reviews.at(-1),
    implementation = implementations.at(-1);
  if (tx.state.host.evidenceContractVersion)
    demand(reviewer.reviewReceipt?.reviewedHead === r.reviewedHead,
      "built-in review receipt missing or stale at convergence");
  demand(
    reviewer.childId !== implementation.childId &&
      reviewer.childId !== tx.state.execution.owner.session,
    "reviewer must be an independent native child",
  );
  const actual = await prEvidence(tx.state, r.prUrl);
  demand(
    actual.headRefOid === r.reviewedHead,
    "GitHub PR head differs from independently reviewed head",
  );
  if (tx.state.repository.verifierContract) {
    await git(tx.state.repository.path, "fetch", "--quiet", "origin", `refs/pull/${actual.number}/head`);
    demand(await git(tx.state.repository.path, "rev-parse", "FETCH_HEAD^{commit}") === actual.headRefOid,
      "candidate verification fetched a different PR head");
    const operation = await verifyTaskLocked(tx, t.id, {
      operationId: `candidate-${t.attempt.id}-${actual.headRefOid}`,
      commit: actual.headRefOid,
      purpose: "Host candidate task acceptance before approval",
    }, tx.state.execution.owner);
    demand(operation.status === "complete" && verificationAccepted(tx.state, t, operation.result),
      `candidate task acceptance mode failed: ${operation.result?.stderr || operation.result?.stdout || operation.status}`);
  }
  tx.apply({
    type: "converged",
    taskId: t.id,
    attemptId: t.attempt.id,
    revision: t.revision.hash,
    result: {
      ...r,
      head: actual.headRefOid,
      reviewer: `${reviewer.childId}:${reviewer.requestId}`,
      ...(reviewer.reviewReceipt ? { reviewReceipt: digest(reviewer.reviewReceipt) } : {}),
      verification: JSON.stringify({
        implementation: implementation.requestId,
        child: implementation.childId,
        outputHash: digest(implementation.output),
        review: reviewer.requestId,
        head: actual.headRefOid,
      }),
    },
  });
}
async function reconcileSupersededQueues(tx, owner) {
  for (const key of Object.keys(tx.state.host.merges)) {
    let s = tx.state,
      operation = s.host.merges[key],
      t = s.tasks[operation.taskId];
    const attempt = t?.attempts.find((a) => a.id === operation.attemptId);
    if (operation.queueResolved || !attempt?.superseded) continue;
    const approval = operation.approvalSnapshot || attempt.approval;
    demand(approval, "queued request has no historical approval");
    const actual = await prEvidence(s, approval.prUrl);
    operation.queueObservation = actual;
    operation.pendingPolls = (operation.pendingPolls || 0) + 1;
    operation.needsAttention =
      operation.pendingPolls >= (s.host.config.maxPendingPolls ?? 60);
    tx.save();
    if (actual.state === "OPEN") continue;
    if (actual.state === "CLOSED") {
      resolveMerge(operation, "closed");
      tx.save();
      continue;
    }
    demand(
      actual.state === "MERGED" &&
        actual.headRefOid === approval.head &&
        actual.mergeCommit?.oid,
      "superseded queue landed with different or missing head evidence; explicit reconciliation required",
    );
    const common = await git(
      s.repository.path,
      "rev-parse",
      "--git-common-dir",
    );
    const release = acquire(
      path.join(
        path.resolve(s.repository.path, common),
        "thread-rollout-merge.lock",
      ),
      owner,
      { processLease: true },
    );
    try {
      const integrated = await fetchBase(s.repository);
      await git(
        s.repository.path,
        "merge-base",
        "--is-ancestor",
        actual.mergeCommit.oid,
        integrated,
      );
      let verification = operation.verification;
      if (!verification || verification.commit !== integrated) {
        if (operation.verificationStarted) {
          tx.apply({
            type: "reserve-verifier",
            taskId: t.id,
            verifierRuns: 1,
            purpose: "recover superseded queue verification",
          });
          s = tx.state;
          operation = s.host.merges[key];
        }
        operation.verificationStarted = true;
        delete operation.verification;
        tx.save();
        verification = await verify(
          tx.directory,
          s.repository,
          integrated,
          "superseded queue landing",
          s.host.config.verifierTimeoutMs,
        );
        operation.verification = verification;
        tx.save();
      }
      tx.apply({
        type: "superseded-merge-observed",
        taskId: t.id,
        attemptId: attempt.id,
        approval: approval.digest,
        verified: verificationAccepted(s, t, verification),
        observation: {
          repository: s.repository.identity,
          baseBranch: s.repository.baseBranch,
          prUrl: approval.prUrl,
          head: actual.headRefOid,
          state: "MERGED",
          mergeCommit: actual.mergeCommit.oid,
          verification: JSON.stringify(verification),
        },
      });
      resolveMerge(tx.state.host.merges[key], "superseded-merged");
      tx.save();
    } finally {
      release();
    }
  }
}
export async function advance(directory, owner) {
  return transaction(directory, owner, async (tx) => {
    assessSources(tx);
    if (!["running", "pausing"].includes(tx.state.execution.status))
      return view(tx.state);
    await reconcileSupersededQueues(tx, owner);
    const native = await adapter(tx.state);
    for (const t of Object.values(tx.state.tasks).filter(
      (t) => t.status === "draining",
    )) {
      const run = tx.state.host.runs[t.attempt?.id];
      if (outstanding(tx.state, t).length || pendingQueue(tx.state, t))
        continue;
      if (run) {
        run.snapshot = native.inspect(run.directory, nativeContext(owner, run));
        if (
          run.snapshot.requests.some((r) =>
            ["claimed", "dispatched"].includes(r.status),
          )
        )
          continue;
        run.superseded = true;
      }
      tx.apply({
        type: "drained",
        taskId: t.id,
        evidence:
          "native journal has no claimed/dispatched child and all host claims are terminal",
      });
      tx.save();
    }
    for (const t0 of Object.values(tx.state.tasks)) {
      let t = tx.state.tasks[t0.id];
      if (t.status !== "active" || t.attempt?.superseded) continue;
      try {
        const prior = tx.state.host.runs[t.attempt.id],
          run =
            prior?.initialisation === "ready"
              ? prior
              : await initialiseAttempt(tx, t);
        run.snapshot = await native.advance(
          run.directory,
          nativeContext(owner, run),
        );
        tx.save();
        if (run.snapshot.status === "complete") {
          assessSources(tx);
          t = tx.state.tasks[t.id];
          if (t.status === "active" && !t.attempt.superseded)
            await consumeComplete(tx, t, run);
        } else if (run.snapshot.status === "blocked")
          block(tx, t, run.snapshot.problem || "native engine blocked");
      } catch (e) {
        block(
          tx,
          tx.state.tasks[t.id],
          `native execution blocked: ${e.message}`,
        );
      }
      tx.save();
    }
    const held =
      tx.state.execution.mergeHold &&
      tx.state.tasks[tx.state.execution.mergeHold.taskId];
    if (
      held?.status === "blocked" &&
      !held.requiresAssessment &&
      held.attempt?.purpose !== "rollback" &&
      tx.state.authority.allowedActions.includes("revert-run-owned")
    ) {
      const pool = tx.state.execution.pools[held.pool],
        reverts = held.landings
          .filter((l) => !l.revertedBy && l.purpose !== "rollback")
          .map((l) => l.mergeCommit)
          .reverse();
      if (
        reverts.length &&
        pool.limit.calls - pool.spent.calls >= tx.state.host.rollbackReserve.calls &&
        pool.limit.verifierRuns - pool.spent.verifierRuns >= tx.state.host.rollbackReserve.verifierRuns
      ) {
        tx.apply({ type: "retry", taskId: held.id });
        tx.state.host.rollbackPending ??= {};
        tx.state.host.rollbackPending[held.id] = reverts;
        tx.save();
      }
    }
    for (const id of eligible(tx.state)) {
      if (
        Object.values(tx.state.tasks).filter((t) => t.status === "active")
          .length >= tx.state.host.config.maxConcurrent
      )
        break;
      if (!eligible(tx.state).includes(id)) continue;
      try {
        const baseRef = await fetchBase(tx.state.repository);
        assessSources(tx);
        if (!eligible(tx.state).includes(id)) continue;
        const reverts = tx.state.host.rollbackPending?.[id];
        tx.apply({
          type: "start",
          taskId: id,
          baseRef,
          purpose: reverts
            ? "rollback"
            : tx.state.execution.mergeHold?.taskId === id
              ? "repair"
              : "outcome",
          ...(reverts ? { reverts } : {}),
        });
        if (reverts) delete tx.state.host.rollbackPending[id];
        tx.save();
        const t = tx.state.tasks[id],
          run = await initialiseAttempt(tx, t);
        run.snapshot = await native.advance(
          run.directory,
          nativeContext(owner, run),
        );
        tx.save();
      } catch (e) {
        block(tx, tx.state.tasks[id], `admission blocked: ${e.message}`);
      }
    }
    tx.apply({ type: "settle" });
    return view(tx.state);
  });
}
function runFor(s, taskId) {
  const t = s.tasks[taskId];
  demand(t?.attempt, "task has no attempt");
  const run = s.host.runs[t.attempt.id];
  demand(run, "native attempt not initialised");
  return { t, run };
}
function verifierCost(s, request, run) {
  const label = request.label || request.options?.label || "";
  if (run.args.routingPolicy && /^(implement|revise|plan|plan-revise):/.test(label)) return 1;
  if (/^(implement|revise):/.test(label))
    return Math.max(run.args.waves[0].tasks[0].maxIterations, 2);
  if (/^plan:/.test(label)) return 1;
  if (/^(plan-revise|plan-judge|review):/.test(label)) return 0;
  throw new Error(`unknown request verifier reservation: ${label}`);
}
export async function claim(directory, taskId, requestId, owner) {
  return transaction(directory, owner, async (tx) => {
    assessSources(tx);
    let { t, run } = runFor(tx.state, taskId);
    demand(
      !tx.state.execution.requests[requestId],
      "request already reserved or claimed; reconcile instead of redispatch",
    );
    const native = await adapter(tx.state);
    run.snapshot = native.inspect(run.directory, nativeContext(owner, run));
    const request = run.snapshot.requests.find((r) => r.id === requestId);
    demand(request?.status === "pending", "native request is not pending");
    const calls = requestCalls(request);
    demand(reservedNativeSlots(tx.state) + calls <= tx.state.host.config.maxConcurrent,
      "global native capacity reached (including reserved review forks)");
    const cost = verifierCost(tx.state, request, run),
      pool = tx.state.execution.pools[t.pool],
      reserve =
        t.attempt.purpose === "rollback"
          ? { calls: 0, verifierRuns: 0 }
          : tx.state.host.rollbackReserve;
    if (
      pool.spent.calls + calls > pool.limit.calls - reserve.calls ||
      pool.spent.verifierRuns + cost >
        pool.limit.verifierRuns - reserve.verifierRuns
    ) {
      const reason = reserve.calls
        ? "remaining allowance reserved for authorised rollback"
        : "task allowance exhausted";
      block(tx, t, reason);
      return { status: "blocked", taskId, reason };
    }
    try {
      tx.apply({ type: "claim", taskId, requestId, calls, verifierRuns: cost });
    } catch (e) {
      if (/allowance/.test(e.message)) {
        block(tx, t, e.message);
        return { status: "blocked", taskId, reason: e.message };
      }
      throw e;
    }
    tx.state.execution.requests[requestId].reservation =
      "conservative maximum requested verifier work";
    if (calls === 2) tx.state.execution.requests[requestId].reviewFork = { status: "reserved" };
    run = tx.state.host.runs[t.attempt.id];
    tx.save();
    let claimed;
    try {
      claimed = native.claim(
        run.directory,
        requestId,
        nativeContext(owner, run),
      );
    } catch (e) {
      tx.state.execution.requests[requestId].claimProblem = e.message;
      tx.save();
      throw new Error(
        `claim reserved but adapter outcome requires recovery: ${e.message}`,
      );
    }
    tx.state.execution.requests[requestId].claimToken = claimed.claimToken;
    run.snapshot = native.inspect(run.directory, nativeContext(owner, run));
    tx.save();
    return {
      ...claimed,
      caller: nativeContext(owner, run),
      taskId,
      attemptId: t.attempt.id,
      runId: run.snapshot.runId,
      verifierRuns: cost,
    };
  });
}
export async function bind(
  directory,
  taskId,
  requestId,
  token,
  childId,
  owner,
) {
  return transaction(directory, owner, async (tx) => {
    let { run } = runFor(tx.state, taskId);
    const r = tx.state.execution.requests[requestId];
    demand(r && r.claimToken === token, "host claim token mismatch");
    assertNativeIdentity(tx.state, requestId, [childId], { wrapper: true });
    tx.apply({
      type: "request-state",
      taskId,
      requestId,
      status: "dispatched",
      childId,
    });
    run = runFor(tx.state, taskId).run;
    tx.save();
    const native = await adapter(tx.state);
    const result = native.bind(
      run.directory,
      requestId,
      token,
      childId,
      nativeContext(owner, run),
    );
    run.snapshot = native.inspect(run.directory, nativeContext(owner, run));
    return result;
  });
}
export async function bindReviewFork(directory, taskId, requestId, token, binding, owner) {
  return transaction(directory, owner, async tx => {
    const { run } = runFor(tx.state, taskId), r = tx.state.execution.requests[requestId];
    demand(r?.taskId === taskId && r.claimToken === token && r.calls === 2 && r.reviewFork,
      "host fork reservation and claim required");
    assertNativeIdentity(tx.state, requestId, [binding.childId, binding.invocationId]);
    const native = await adapter(tx.state);
    const result = native.bindReviewFork(run.directory, requestId, token, binding, nativeContext(owner, run));
    run.snapshot = native.inspect(run.directory, nativeContext(owner, run));
    r.reviewFork = clone(run.snapshot.requests.find(q => q.id === requestId).reviewFork);
    return result;
  });
}
export async function recordReviewFork(directory, taskId, requestId, token, proof, owner, nativeEvidence) {
  return transaction(directory, owner, async tx => {
    const { run } = runFor(tx.state, taskId), r = tx.state.execution.requests[requestId];
    demand(r?.taskId === taskId && r.claimToken === token && r.calls === 2 && r.reviewFork,
      "host fork reservation and claim required");
    const source = nativeEvidence?.path;
    demand(path.isAbsolute(source || "") && fs.statSync(source).isFile(), "native fork evidence file required");
    const content = fs.readFileSync(source);
    demand(content.length > 0 && (!nativeEvidence.sha256 || nativeEvidence.sha256 === bytes(content)),
      "native fork evidence digest mismatch or empty evidence");
    const proofHash = digest(proof), prior = run.reviewForkEvidence?.[requestId];
    demand(!prior || (prior.proofHash === proofHash && prior.sha256 === bytes(content)), "conflicting fork evidence replay");
    const captured = immutable(path.join(directory, "review-evidence", `${bytes(requestId)}-fork-${bytes(content)}.json`), content);
    const native = await adapter(tx.state);
    const result = native.recordReviewFork(run.directory, requestId, token, proof, nativeContext(owner, run));
    run.snapshot = native.inspect(run.directory, nativeContext(owner, run));
    r.reviewFork = clone(run.snapshot.requests.find(q => q.id === requestId).reviewFork);
    (run.reviewForkEvidence ??= {})[requestId] = { ...captured, proofHash, source };
    return result;
  });
}
/** Record a proven native refusal before creation of any child, never a timeout. */
export async function recordUnavailable(directory, taskId, requestId, claimToken, proof, owner) {
  return transaction(directory, owner, async (tx) => {
    const request = tx.state.execution.requests[requestId];
    demand(request?.taskId === taskId && request.claimToken === claimToken && !request.childId,
      "native refusal requires this owner's unbound claim");
    let { run } = runFor(tx.state, taskId);
    const native = await adapter(tx.state);
    demand(typeof native.recordUnavailable === "function", "pinned adapter cannot attest a native launch refusal");
    const result = native.recordUnavailable(run.directory, requestId, claimToken, proof, nativeContext(owner, run));
    tx.apply({ type: "request-unavailable", taskId, requestId, proof });
    run = runFor(tx.state, taskId).run;
    run.accepted[requestId] = { requestId, label: result.options?.label || result.label,
      status: "denied", launchUnavailable: clone(proof) };
    run.snapshot = native.inspect(run.directory, nativeContext(owner, run));
    return result;
  });
}
function captureReviewReceipt(directory, run, request, envelope, receipt, owner) {
  const compound = forkReview(request);
  demand(receipt?.version === (compound ? 2 : 1), "built-in review receipt required for dispatched protocol");
  demand(receipt.requestId === envelope.requestId && receipt.childId === envelope.childId &&
    receipt.harness === owner.harness && receipt.reviewedHead === envelope.output?.reviewedHead &&
    /^[a-f0-9]{40,64}$/.test(receipt.reviewedHead || ""), "review receipt identity or head mismatch");
  demand(receipt.engine === (owner.harness === "claude" ? "code-review" : "review-agent"), "native built-in review engine required");
  demand(["xhigh", "max"].includes(receipt.reviewLevel), "review level must satisfy the xhigh floor");
  if (request.native?.reviewContract || request.options?.reviewContract) {
    const contract = request.native?.reviewContract || request.options.reviewContract;
    demand(contract.engine === (owner.harness === "claude" ? "claude-code-review" : "codex-review-agent") &&
      contract.level === receipt.reviewLevel && contract.reviewedHead === receipt.reviewedHead,
      "review receipt differs from dispatched review contract");
  }
  demand(typeof receipt.invocationId === "string" && receipt.invocationId.trim(), "review receipt native invocation id required");
  if (compound) {
    const fork = request.reviewFork;
    demand(fork?.status === "complete" && run.reviewForkEvidence?.[request.id], "completed native review fork evidence required");
    demand(fork.reviewedHead === receipt.reviewedHead && receipt.fork?.childId === fork.childId && receipt.fork?.resultHash === fork.resultHash &&
      receipt.invocationId === fork.invocationId, "review fork receipt identity or result mismatch");
    demand(receipt.relay?.childId === envelope.childId && receipt.relay?.outputHash === bytes(fork.output) &&
      typeof receipt.relay.evidence === "string" && receipt.relay.evidence.trim(),
      "verbatim review findings relay to the same wrapper requires native evidence");
  }
  const previous = run.accepted[envelope.requestId];
  if (previous?.reviewReceipt) {
    demand(previous.reviewReceiptInputHash === digest(receipt), "conflicting review receipt replay");
    return previous.reviewReceipt;
  }
  const filename = receipt.nativeEvidence?.path;
  demand(path.isAbsolute(filename || "") && fs.existsSync(filename) && fs.statSync(filename).isFile(), "review receipt native evidence file required");
  const content = fs.readFileSync(filename);
  demand(content.length > 0, "review receipt native evidence must not be empty");
  if (receipt.nativeEvidence.sha256)
    demand(receipt.nativeEvidence.sha256 === bytes(content), "review receipt evidence digest mismatch");
  // A rejected schema delivery is not an accepted receipt. Its immutable capture
  // may coexist with corrected evidence from the same child without poisoning it.
  const captured = immutable(path.join(directory, "review-evidence", bytes(envelope.requestId) + "-" + bytes(content) + ".json"), content);
  return { ...clone(receipt), nativeEvidence: { ...captured, source: filename } };
}
export async function accept(directory, taskId, envelope, owner, reviewReceipt) {
  return transaction(directory, owner, async (tx) => {
    let { run } = runFor(tx.state, taskId);
    const r = tx.state.execution.requests[envelope.requestId];
    demand(
      r?.taskId === taskId &&
        r.childId === envelope.childId &&
        r.claimToken === envelope.claimToken,
      "host result identity mismatch",
    );
    const journal = read(path.join(run.directory, "run.json")),
      nativeAccepted = Array.isArray(journal.requests)
        ? journal.requests.find((r) => r.id === envelope.requestId)
        : journal.requests[envelope.requestId];
    const replay =
      run.accepted[envelope.requestId]?.envelopeHash === digest(envelope) ||
      nativeAccepted?.resultHash === digest(envelope);
    demand(
      replay || digest(envelope.caller) === digest(nativeContext(owner, run)),
      "result must attest the current same-account native owner",
    );
    const label = nativeAccepted?.options?.label || nativeAccepted?.label || "";
    const receipt = tx.state.host.evidenceContractVersion && label.startsWith("review:") && envelope.status === "ok"
      ? captureReviewReceipt(directory, run, nativeAccepted, envelope, reviewReceipt, owner) : undefined;
    const native = await adapter(tx.state),
      accepted = native.accept(
        run.directory,
        envelope,
        nativeContext(owner, run),
      );
    tx.apply({
      type: "request-state",
      taskId,
      requestId: envelope.requestId,
      status: accepted.status,
    });
    run = runFor(tx.state, taskId).run;
    run.accepted[envelope.requestId] = {
      requestId: envelope.requestId,
      label: accepted.options?.label || accepted.label,
      childId: accepted.childId,
      status: accepted.status,
      output: accepted.output,
      envelopeHash: digest(envelope),
      ...(receipt ? { reviewReceipt: receipt, reviewReceiptInputHash: digest(reviewReceipt) } : {}),
      ...(accepted.routingProvenance ? { routing: accepted.routingProvenance } : {}),
    };
    run.snapshot = native.inspect(run.directory, nativeContext(owner, run));
    return accepted;
  });
}

/** Supplementary evidence only: never substitutes for native implementation/review approval. */
export async function verifyTask(directory, taskId, operation, owner) {
  return transaction(directory, owner, (tx) => verifyTaskLocked(tx, taskId, operation, owner));
}
async function verifyTaskLocked(tx, taskId, operation, owner) {
    const directory = tx.directory;
    const t = tx.state.tasks[taskId];
    demand(t?.attempt, "supplementary verification requires a task attempt");
    demand(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(operation.operationId || ""), "verification operationId required");
    demand(/^[a-f0-9]{40,64}$/.test(operation.commit || ""), "verification needs a concrete commit");
    demand(typeof operation.purpose === "string" && operation.purpose.trim(), "verification purpose required");
    const key = tx.state.execution.id + ":" + operation.operationId;
    const basis = { taskId, attemptId: t.attempt.id, revision: t.revision.hash, commit: operation.commit,
      purpose: operation.purpose, verifier: digest({ command: tx.state.repository.verifier, inputs: tx.state.repository.verifierInputs || [],
        ...(tx.state.repository.verifierContract ? { contract: tx.state.repository.verifierContract, modes: t.verifierModes } : {}) }) };
    const hash = digest(basis), previous = tx.state.host.verifications?.[key];
    if (previous) {
      demand(previous.inputHash === hash, "conflicting supplementary verification operation");
      demand(["complete", "interrupted"].includes(previous.status), "supplementary verification interrupted; reconcile owner before retrying with a new operation id");
      return clone(previous);
    }
    const pool = tx.state.execution.pools[t.pool], reserve = t.attempt.purpose === "rollback" ? 0 : tx.state.host.rollbackReserve?.verifierRuns || 0;
    demand(pool.spent.verifierRuns + 1 <= pool.limit.verifierRuns - reserve, "supplementary verifier allowance exhausted or reserved for rollback");
    demand(await git(tx.state.repository.path, "rev-parse", `${operation.commit}^{commit}`) === operation.commit, "verification commit unavailable");
    tx.apply({ type: "reserve-verifier", taskId, verifierRuns: 1, purpose: operation.purpose });
    const leasePath = path.join(directory, "verification-leases", bytes(key) + ".lock");
    fs.mkdirSync(path.dirname(leasePath), { recursive: true, mode: 0o700 });
    const record = { ...basis, operationId: operation.operationId, executionId: tx.state.execution.id, inputHash: hash,
      status: "reserved", owner: clone(owner), leasePath };
    (tx.state.host.verifications ??= {})[key] = record;
    tx.save();
    const lease = acquire(leasePath, owner, { processLease: true });
    try {
      record.status = "running"; tx.save();
      record.result = await verify(directory, tx.state.repository, operation.commit, operation.purpose, tx.state.host.config.verifierTimeoutMs, lease);
      record.accepted = verificationAccepted(tx.state, t, record.result);
      record.status = "complete";
    } catch (error) {
      record.status = "interrupted"; record.error = error.message;
      throw error;
    } finally { tx.save(); lease(); }
    return clone(record);
}

async function expectedRevertTree(directory, s, t) {
  const worktree = path.join(directory, "rollback-check", crypto.randomUUID());
  fs.mkdirSync(path.dirname(worktree), { recursive: true, mode: 0o700 });
  await git(
    s.repository.path,
    "worktree",
    "add",
    "--detach",
    worktree,
    t.attempt.baseRef,
  );
  try {
    for (const commit of t.attempt.reverts) {
      demand(
        t.landings.some(
          (l) =>
            l.mergeCommit === commit &&
            !l.revertedBy &&
            l.purpose !== "rollback",
        ),
        "rollback commit is not an attributable live landing",
      );
      await git(
        worktree,
        "merge-base",
        "--is-ancestor",
        commit,
        t.attempt.baseRef,
      );
      demand(
        (await git(worktree, "rev-list", "--parents", "-n", "1", commit)).split(
          " ",
        ).length === 2,
        "rollback requires an attributable squash commit",
      );
      await git(worktree, "revert", "--no-commit", commit);
    }
    return await git(worktree, "write-tree");
  } finally {
    await command("git", [
      "-C",
      s.repository.path,
      "worktree",
      "remove",
      "--force",
      worktree,
    ]);
  }
}
async function mergeLocked(tx, taskId, lease) {
  assessSources(tx);
  let s = tx.state,
    t = s.tasks[taskId];
  demand(t, "unknown task");
  if (t.requiresAssessment || t.attempt?.superseded) return view(s);
  demand(
    ["running", "pausing"].includes(s.execution.status),
    "execution stopped or paused",
  );
  demand(
    !s.execution.mergeHold || s.execution.mergeHold.taskId === taskId,
    "repository is held after a regression",
  );
  demand(
    t.approval && ["review", "waiting"].includes(t.status),
    "task has no current approval",
  );
  checkRelease(s);
  const approval = t.approval,
    actual = await prEvidence(s, approval.prUrl);
  if (actual.headRefOid !== approval.head) {
    tx.apply({
      type: "invalidate",
      taskId,
      reason: "PR head changed; reapproval required",
      evidence: JSON.stringify(actual),
    });
    return view(tx.state);
  }
  await git(
    s.repository.path,
    "fetch",
    "--quiet",
    "origin",
    `refs/pull/${actual.number}/head`,
  );
  const prospective = await git(
    s.repository.path,
    "rev-parse",
    "FETCH_HEAD^{commit}",
  );
  demand(
    prospective === actual.headRefOid,
    "fetched prospective head differs from approval",
  );
  await checkMergeEffects(s.repository, prospective, s.authority);
  const base = await fetchBase(s.repository);
  if (actual.state === "OPEN" && base !== t.attempt.baseRef) {
    tx.apply({
      type: "invalidate",
      taskId,
      reason:
        "fetched base changed; integrate the existing PR and obtain fresh verification/review",
      evidence: base,
    });
    return view(tx.state);
  }
  if (t.attempt.purpose === "rollback") {
    demand(
      !t.landings.some((l) => l.prUrl === approval.prUrl),
      "rollback must have a distinct PR",
    );
    const expected = await expectedRevertTree(tx.directory, s, t),
      observed = await git(
        s.repository.path,
        "rev-parse",
        `${prospective}^{tree}`,
      );
    demand(
      expected === observed,
      "rollback candidate differs from the isolated revert of owned commits",
    );
  }
  let operation = s.host.merges[approval.digest];
  if (!operation) {
    const pool = s.execution.pools[t.pool],
      floor =
        t.attempt.purpose === "rollback"
          ? 0
          : s.host.rollbackReserve.verifierRuns;
    if (pool.spent.verifierRuns + 1 > pool.limit.verifierRuns - floor) {
      block(tx, t, "postmerge allowance reserved for authorised rollback");
      return view(tx.state);
    }
    try {
      tx.apply({
        type: "reserve-verifier",
        taskId,
        verifierRuns: 1,
        purpose: "postmerge integration verification",
      });
    } catch (e) {
      block(tx, t, `postmerge allowance unavailable: ${e.message}`);
      return view(tx.state);
    }
    s = tx.state;
    t = s.tasks[taskId];
    operation = s.host.merges[approval.digest] = {
      taskId,
      approval: approval.digest,
      approvalSnapshot: clone(approval),
      attemptId: t.attempt.id,
      status: "reserved",
      postmergeReserved: true,
    };
    tx.save();
  }
  const merged = await boundedProcess(
    "/bin/bash",
    [
      s.host.release.merger.path,
      s.repository.path,
      approval.prUrl,
      "--expected-base",
      s.repository.baseBranch,
      "--expected-head",
      approval.head,
      "--json",
    ],
    { timeout: s.host.config.mergeTimeoutMs ?? 600000, lease },
  );
  let report;
  try {
    report = JSON.parse(merged.stdout);
  } catch {
    throw new Error(`merger returned no valid evidence: ${merged.stderr}`);
  }
  operation.report = report;
  operation.status = report.outcome;
  tx.save();
  const p = report.results?.find((p) => p.url === approval.prUrl);
  demand(
    p &&
      p.head === approval.head &&
      p.reviewedHead === approval.head &&
      p.base === s.repository.baseBranch &&
      `github.com/${p.repository}` === s.repository.identity,
    "merger evidence binding mismatch",
  );
  if (
    merged.exitCode === 3 &&
    report.outcome === "pending" &&
    p.state === "OPEN"
  ) {
    operation.pendingPolls = (operation.pendingPolls || 0) + 1;
    operation.needsAttention =
      operation.pendingPolls >= (s.host.config.maxPendingPolls ?? 60);
    tx.save();
    tx.apply({
      type:
        t.attempt.purpose === "rollback" ? "revert-observed" : "merge-observed",
      taskId,
      attemptId: t.attempt.id,
      approval: approval.digest,
      observation: {
        repository: s.repository.identity,
        baseBranch: s.repository.baseBranch,
        prUrl: approval.prUrl,
        head: p.head,
        state: "OPEN",
      },
    });
    return view(tx.state);
  }
  if (
    merged.exitCode !== 0 ||
    report.outcome !== "merged" ||
    p.state !== "MERGED"
  ) {
    if (p.state === "CLOSED") resolveMerge(operation, "closed");
    block(tx, t, report.reason || p.reason || "merge blocked");
    return view(tx.state);
  }
  const integrated = await fetchBase(s.repository);
  await git(
    s.repository.path,
    "merge-base",
    "--is-ancestor",
    p.mergeCommit,
    integrated,
  );
  let verification = operation.verification;
  if (!verification || verification.commit !== integrated) {
    if (operation.verificationStarted) {
      tx.apply({
        type: "reserve-verifier",
        taskId,
        verifierRuns: 1,
        purpose: "recover interrupted or stale postmerge verification",
      });
      s = tx.state;
      operation = s.host.merges[approval.digest];
    }
    operation.verificationStarted = true;
    delete operation.verification;
    tx.save();
    verification = await verify(
      tx.directory,
      s.repository,
      integrated,
      "postmerge",
      s.host.config.verifierTimeoutMs,
    );
    operation.verification = verification;
    tx.save();
  }
  if (!verificationAccepted(s, t, verification)) {
    tx.apply({
      type: "regression",
      taskId,
      landing: {
        repository: s.repository.identity,
        baseBranch: s.repository.baseBranch,
        prUrl: approval.prUrl,
        head: p.head,
        state: "MERGED",
        mergeCommit: p.mergeCommit,
      },
      evidence: JSON.stringify({ merge: p, verification }),
    });
    resolveMerge(tx.state.host.merges[approval.digest], "regression");
    return view(tx.state);
  }
  tx.apply({
    type:
      t.attempt.purpose === "rollback" ? "revert-observed" : "merge-observed",
    taskId,
    attemptId: t.attempt.id,
    approval: approval.digest,
    observation: {
      repository: s.repository.identity,
      baseBranch: s.repository.baseBranch,
      prUrl: approval.prUrl,
      head: p.head,
      state: "MERGED",
      mergeCommit: p.mergeCommit,
      verification: JSON.stringify(verification),
    },
  });
  resolveMerge(tx.state.host.merges[approval.digest], "merged");
  tx.apply({ type: "settle" });
  return view(tx.state);
}
export async function merge(directory, taskId, owner) {
  return transaction(directory, owner, async (tx) => {
    const common = await git(
      tx.state.repository.path,
      "rev-parse",
      "--git-common-dir",
    );
    const absolute = path.resolve(tx.state.repository.path, common),
      release = acquire(
        path.join(absolute, "thread-rollout-merge.lock"),
        owner,
        { processLease: true },
      );
    try {
      return await mergeLocked(tx, taskId, release);
    } finally {
      release();
    }
  });
}
const publicTransitions = new Set([
  "pause",
  "stop",
  "resume",
  "settle",
  "retry",
  "revise",
  "cover-gate",
  "invalidate",
  "prerequisite",
  "defer",
  "relaunch",
]);
export async function transition(directory, change, owner) {
  return transaction(directory, owner, async (tx) => {
    if (change.type === "substitute") {
      demand(!tx.state.host.config.routingPolicy, "new-policy model bindings are pinned; recovery uses the prepared routing policy");
      const t = tx.state.tasks[change.taskId];
      demand(
        t && !["active", "review", "waiting", "draining"].includes(t.status),
        "drain active work before substitution",
      );
      demand(
        typeof change.evidence === "string" && change.evidence.trim(),
        "native substitution evidence required",
      );
      demand(
        !change.engine && !change.account && !change.harness,
        "substitution cannot change quality gates, harness or account",
      );
      const settings = {
        ...clone(settingsFor(tx.state, t)),
        id: crypto.randomUUID(),
        models: clone(change.models),
        evidence: change.evidence,
      };
      validConfig({ ...tx.state.host.config, models: settings.models }, owner);
      tx.apply({ type: "retry", taskId: t.id });
      const record = immutable(
        path.join(
          directory,
          "executions",
          tx.state.execution.id,
          "settings",
          t.id,
          settings.id + ".json",
        ),
        JSON.stringify(settings, null, 2),
      );
      (tx.state.host.settings[t.id] ??= []).push({ ...settings, record });
      return view(tx.state);
    }
    demand(
      publicTransitions.has(change.type),
      "transition is reserved for host-attested evidence",
    );
    if (change.type === "revise") {
      const t = tx.state.tasks[change.taskId];
      demand(
        t && fs.readFileSync(t.sourcePath, "utf8") === change.requirements,
        "revision must match actual source requirements",
      );
    }
    if (change.type === "prerequisite")
      validateVerifierContract(tx.state.repository, [change.task]);
    if (change.type === "prerequisite")
      demand(
        fs.readFileSync(change.task.sourcePath, "utf8") ===
          change.task.requirements,
        "prerequisite must match source",
      );
    tx.apply(change);
    if (change.type === "revise" || change.type === "prerequisite") {
      const id = change.type === "revise" ? change.taskId : change.task.id;
      tx.state.host.adopted[id] = adopt(
        directory,
        tx.state,
        tx.state.tasks[id],
      );
    }
    if (change.type === "relaunch") {
      tx.state.host.release = pinRelease(
        directory,
        tx.state,
        tx.state.host.config,
      );
      for (const t of Object.values(tx.state.tasks).filter((t) =>
        tx.state.execution.scope.includes(t.id),
      ))
        tx.state.host.adopted[t.id] = adopt(directory, tx.state, t);
    }
    return view(tx.state);
  });
}
function releaseProvenDeadLock(
  filename,
  { owner, epoch, processLease = false } = {},
) {
  if (!fs.existsSync(filename)) return;
  const initial = fs.lstatSync(filename),
    raw = fs.readFileSync(filename, "utf8");
  let lock;
  try {
    lock = JSON.parse(raw);
  } catch {
    throw new Error("unrecognised lock evidence");
  }
  const pid = typeof lock === "number" ? lock : lock.pid;
  demand(Number.isSafeInteger(pid) && pid > 0, "lock PID evidence unavailable");
  if (owner)
    demand(
      lock.owner &&
        digest(context(lock.owner)) === digest(context(owner)) &&
        lock.owner.epoch === epoch &&
        lock.token,
      "lock owner differs from recovery predecessor",
    );
  let stopped = false;
  try {
    process.kill(pid, 0);
  } catch (e) {
    stopped = e.code === "ESRCH";
  }
  demand(
    stopped,
    "lock-owning process is still running or cannot be proven stopped",
  );
  if (processLease) assertProcessLeaseStopped(lock);
  demand(
    fs.lstatSync(filename).ino === initial.ino &&
      fs.readFileSync(filename, "utf8") === raw,
    "lock evidence changed",
  );
  fs.unlinkSync(filename);
}
export async function recover(directory, owner, evidence) {
  const recorded = read(path.join(directory, "state.json"));
  if (
    recorded.host.recoveries.at(-1) &&
    digest(recorded.host.recoveries.at(-1).evidence) === digest(evidence) &&
    owner.session === recorded.execution.owner.session &&
    owner.epoch === recorded.execution.epoch
  ) {
    assertOwner(recorded, owner);
    return status(directory);
  }
  demand(
    evidence.previousOwnerStopped === true &&
      evidence.previousEpoch === recorded.execution.epoch &&
      digest(evidence.previousCaller) ===
        digest(context(recorded.execution.owner)),
    "recovery predecessor epoch and stop evidence required",
  );
  demand(
    owner.harness === recorded.execution.owner.harness &&
      owner.account === recorded.execution.owner.account &&
      owner.epoch === recorded.execution.epoch + 1,
    "recovery destination owner/epoch mismatch",
  );
  const predecessor = {
    ...recorded.execution.owner,
    epoch: recorded.execution.epoch,
  };
  const pending = recorded.host.recoveryIntent;
  if (pending)
    demand(
      digest(pending.owner) === digest(owner) &&
        digest(pending.evidence) === digest(evidence),
      "partial recovery must resume the exact recorded transfer",
    );
  const matchesOwner = (candidate, expected) =>
    candidate &&
    digest(context(candidate)) === digest(context(expected)) &&
    candidate.epoch === expected.epoch;
  const hostLock = path.join(directory, ".host.lock"),
    lockOwner =
      pending &&
      fs.existsSync(hostLock) &&
      matchesOwner(read(hostLock).owner, pending.owner)
        ? pending.owner
        : predecessor;
  releaseProvenDeadLock(hostLock, {
    owner: lockOwner,
    epoch: lockOwner.epoch,
  });
  const common = await git(
      recorded.repository.path,
      "rev-parse",
      "--git-common-dir",
    ),
    mergeLock = path.join(
      path.resolve(recorded.repository.path, common),
      "thread-rollout-merge.lock",
    );
  // Another rollout may own this repository lease. Only the proven predecessor's
  // dead process can be released as part of this execution's ownership transfer.
  if (
    fs.existsSync(mergeLock) &&
    matchesOwner(read(mergeLock).owner, predecessor)
  )
    releaseProvenDeadLock(mergeLock, {
      owner: predecessor,
      epoch: recorded.execution.epoch,
      processLease: true,
    });
  return transaction(
    directory,
    owner,
    async (tx) => {
      const previous = tx.state.execution.owner;
      for (const operation of Object.values(tx.state.host.verifications || {})) {
        if (!["reserved", "running"].includes(operation.status)) continue;
        demand(matchesOwner(operation.owner, predecessor), "supplementary verifier belongs to another owner");
        if (fs.existsSync(operation.leasePath)) {
          releaseProvenDeadLock(operation.leasePath, {
            owner: predecessor, epoch: predecessor.epoch, processLease: true,
          });
        } else if (operation.status === "running") {
          const proof = evidence.verifications?.[operation.operationId];
          demand(proof?.status === "stopped" && typeof proof.evidence === "string" && proof.evidence.trim(),
            "missing supplementary verifier process evidence; reconcile before recovery");
        }
        operation.status = "interrupted";
        operation.error = "Prior owner stopped before verification was durably completed; reservation retained";
        delete operation.result;
        delete operation.accepted;
        tx.save();
      }
      demand(
        previous.harness === owner.harness &&
          previous.account === owner.account,
        "recovery must use the same harness/account",
      );
      demand(
        evidence.previousOwnerStopped === true &&
          digest(evidence.previousCaller) === digest(context(previous)),
        "previous owner stop and identity evidence required",
      );
      const pending = tx.state.host.recoveryIntent;
      if (pending)
        demand(
          digest(pending.owner) === digest(owner) &&
            digest(pending.evidence) === digest(evidence),
          "partial recovery must resume the exact recorded transfer",
        );
      const resolutions = {};
      const activeRequests = Object.values(tx.state.execution.requests).filter(r => ["claimed", "dispatched"].includes(r.status));
      demand(Object.keys(evidence.requests || {}).length === activeRequests.length &&
        Object.keys(evidence.requests || {}).every(id => activeRequests.some(r => r.id === id)),
        "recovery evidence must cover exactly the outstanding host requests");
      for (const r of Object.values(tx.state.execution.requests).filter((r) =>
        ["claimed", "dispatched"].includes(r.status),
      )) {
        const proof = evidence.requests?.[r.id];
        demand(
          proof && typeof proof.evidence === "string" && proof.evidence.trim(),
          "ambiguous claimed native request cannot be redispatched",
        );
        if (proof.status === "not-started") {
          demand(
            r.status === "claimed" && !r.childId,
            "not-started evidence cannot clear a dispatched child",
          );
          resolutions[r.id] = {
            state: "not-started",
            evidence: proof.evidence,
          };
        } else {
          demand(
            proof.childId && ["running", "terminal"].includes(proof.status),
            "actual native child/status evidence required",
          );
          resolutions[r.id] = {
            childId: proof.childId,
            state: "dispatched",
            evidence: proof.evidence,
          };
        }
      }
      const native = await adapter(tx.state);
      // Validate every native journal before pinning a recovery intent. A missing
      // fork observation must be correctable without locking in that bad input.
      const identities = new Set();
      for (const [runId, run] of Object.entries(tx.state.host.runs)) {
        if (!fs.existsSync(path.join(run.directory, "run.json"))) continue;
        releaseProvenDeadLock(path.join(run.directory, ".lock"));
        let journal = read(path.join(run.directory, "run.json"));
        const priorEpoch = pending?.adapterEpochs[runId] ?? run.snapshot?.ownershipEpoch ?? 1;
        let requests = Array.isArray(journal.requests) ? journal.requests : Object.values(journal.requests);
        for (const request of requests) {
          const proof = evidence.requests?.[request.id];
          const values = [proof?.childId || request.childId,
            proof?.reviewFork?.childId || request.reviewFork?.childId,
            proof?.reviewFork?.invocationId || request.reviewFork?.invocationId].filter(Boolean);
          for (const id of values) {
            demand(!identities.has(id), "recovery repeats a native identity across task runs");
            identities.add(id);
          }
        }
        if (journal.caller.session === owner.session && (journal.ownershipEpoch ?? 1) === priorEpoch + 1) continue;
        for (const request of requests.filter(r => r.status === "pending" && evidence.requests?.[r.id]?.status === "not-started"))
          native.claim(run.directory, request.id, { ...context(previous), epoch: priorEpoch });
        journal = read(path.join(run.directory, "run.json"));
        requests = Array.isArray(journal.requests) ? journal.requests : Object.values(journal.requests);
        if (tx.state.host.config.claudeReviewProtocol)
          demand(typeof native.validateRecovery === "function", "fork recovery requires native prevalidation");
        if (typeof native.validateRecovery === "function") native.validateRecovery(run.directory,
          { ...context(owner), epoch: priorEpoch + 1 }, {
            ...evidence, previousCaller: journal.caller, previousEpoch: priorEpoch,
            requests: Object.fromEntries(requests.filter(r => ["claimed", "dispatched"].includes(r.status)).map(r => [r.id, evidence.requests[r.id]])),
          });
      }
      const next = apply(
        tx.state,
        {
          type: "recover",
          previousEpoch: evidence.previousEpoch,
          previousOwnerStopped: true,
          evidence: evidence.reason,
          resolutions,
        },
        owner,
      );
      const intent = pending || {
        owner: clone(owner),
        evidence: clone(evidence),
        adapterEpochs: Object.fromEntries(
          Object.entries(tx.state.host.runs).map(([id, r]) => [
            id,
            r.snapshot?.ownershipEpoch ?? 1,
          ]),
        ),
      };
      tx.state.host.recoveryIntent = intent;
      tx.save();
      demand(
        typeof native.recover === "function",
        "pinned adapter lacks ownership recovery; execution remains held",
      );
      for (const [id, run] of Object.entries(tx.state.host.runs)) {
        if (!fs.existsSync(path.join(run.directory, "run.json"))) continue;
        releaseProvenDeadLock(path.join(run.directory, ".lock"));
        let journal = read(path.join(run.directory, "run.json"));
        const priorEpoch = intent.adapterEpochs[id];
        if (
          journal.caller.harness === owner.harness &&
          journal.caller.session === owner.session &&
          (journal.ownershipEpoch ?? 1) === priorEpoch + 1
        ) {
          run.snapshot = native.inspect(run.directory, {
            ...context(owner),
            epoch: priorEpoch + 1,
          });
          continue;
        }
        let nativeRequests = Array.isArray(journal.requests)
          ? journal.requests
          : Object.values(journal.requests);
        for (const request of nativeRequests.filter(
          (r) =>
            r.status === "pending" &&
            evidence.requests?.[r.id]?.status === "not-started",
        )) {
          native.claim(run.directory, request.id, {
            ...context(previous),
            epoch: priorEpoch,
          });
          journal = read(path.join(run.directory, "run.json"));
        }
        nativeRequests = Array.isArray(journal.requests)
          ? journal.requests
          : Object.values(journal.requests);
        const requests = Object.fromEntries(
          nativeRequests
            .filter((r) => ["claimed", "dispatched"].includes(r.status))
            .map((r) => {
              demand(
                evidence.requests?.[r.id],
                "missing adapter recovery evidence",
              );
              return [r.id, evidence.requests[r.id]];
            }),
        );
        run.snapshot = native.recover(
          run.directory,
          { ...context(owner), epoch: priorEpoch + 1 },
          {
            ...evidence,
            previousCaller: journal.caller,
            previousEpoch: priorEpoch,
            requests,
          },
        );
        tx.save();
      }
      next.host = tx.state.host;
      for (const run of Object.values(next.host.runs))
        for (const request of run.snapshot?.requests || []) {
          const recorded = next.execution.requests[request.id];
          if (recorded && request.claimToken)
            recorded.claimToken = request.claimToken;
          if (recorded && request.reviewFork) recorded.reviewFork = clone(request.reviewFork);
        }
      next.host.recoveries.push({
        owner: context(owner),
        evidence: clone(evidence),
      });
      delete next.host.recoveryIntent;
      tx.state = next;
      return view(tx.state);
    },
    { recover: true },
  );
}
async function main() {
  const [op, directory, payloadPath] = process.argv.slice(2);
  demand(
    op && directory,
    "usage: rollout-host.mjs COMMAND DIRECTORY PAYLOAD.json",
  );
  const p = op === "status" ? {} : read(payloadPath);
  let out;
  switch (op) {
    case "init":
      out = await initialise(directory, p.spec, p.owner, p.config);
      break;
    case "status":
      out = status(directory);
      break;
    case "advance":
      out = await advance(directory, p.owner);
      break;
    case "claim":
      out = await claim(directory, p.taskId, p.requestId, p.owner);
      break;
    case "bind":
      out = await bind(
        directory,
        p.taskId,
        p.requestId,
        p.claimToken,
        p.childId,
        p.owner,
      );
      break;
    case "bind-review-fork":
      out = await bindReviewFork(directory, p.taskId, p.requestId, p.claimToken, p.binding, p.owner);
      break;
    case "record-review-fork":
      out = await recordReviewFork(directory, p.taskId, p.requestId, p.claimToken, p.proof, p.owner, p.nativeEvidence);
      break;
    case "accept":
      out = await accept(directory, p.taskId, p.envelope, p.owner, p.reviewReceipt);
      break;
    case "unavailable":
      out = await recordUnavailable(directory, p.taskId, p.requestId, p.claimToken, p.proof, p.owner);
      break;
    case "verify":
      out = await verifyTask(directory, p.taskId, p.operation, p.owner);
      break;
    case "merge":
      out = await merge(directory, p.taskId, p.owner);
      break;
    case "transition":
      out = await transition(directory, p.command, p.owner);
      break;
    case "recover":
      out = await recover(directory, p.owner, p.evidence);
      break;
    default:
      throw Error("unknown host command: " + op);
  }
  console.log(JSON.stringify(out, null, 2));
}
if (
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((e) => {
    console.error(JSON.stringify({ outcome: "blocked", reason: e.message }));
    process.exitCode = 1;
  });
