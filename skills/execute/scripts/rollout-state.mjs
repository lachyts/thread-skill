/** Protocol 4 domain transitions. No model dispatch, Git mutation or note writes. */
import crypto from "node:crypto";
const copy = (value) => structuredClone(value);
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export const digest = (value) =>
  crypto.createHash("sha256").update(canonical(value)).digest("hex");
const requireThat = (ok, message) => {
  if (!ok) throw new Error(message);
};
const text = (v, name) =>
  requireThat(typeof v === "string" && v.trim(), `${name} is required`);
const positive = (v, name) =>
  requireThat(
    Number.isSafeInteger(v) && v > 0,
    `${name} must be a positive integer`,
  );
const sha = (v) => typeof v === "string" && /^[0-9a-f]{40,64}$/.test(v);
const active = (t) =>
  ["active", "review", "waiting", "draining"].includes(t.status);
function validOwner(o) {
  requireThat(
    o && ["claude", "codex"].includes(o.harness),
    "native harness required",
  );
  text(o.account, "account");
  text(o.session, "session");
}
function allowance(a) {
  for (const k of ["calls", "verifierRuns", "recoveries"]) positive(a?.[k], k);
  return copy(a);
}
function task(input) {
  requireThat(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input.id), "invalid task id");
  text(input.sourcePath, "sourcePath");
  text(input.requirements, "requirements");
  requireThat(
    Array.isArray(input.acceptance) &&
      input.acceptance.length &&
      input.acceptance.every((v) => typeof v === "string" && v.trim()),
    "acceptance checks required",
  );
  return {
    ...copy(input),
    dependsOn: copy(input.dependsOn || []),
    conflicts: copy(input.conflicts || []),
    pool: input.id,
    allowance: allowance(input.allowance),
    revision: {
      number: 1,
      hash: digest(input.requirements),
      requirements: input.requirements,
    },
    revisions: [],
    status: "open",
    member: true,
    landings: [],
    coveredGates: [],
    attempts: [],
    generation: 0,
  };
}
function validateGraph(tasks) {
  for (const t of Object.values(tasks))
    for (const id of [...t.dependsOn, ...t.conflicts])
      requireThat(tasks[id] && id !== t.id, `unknown or self reference ${id}`);
  const visiting = new Set(),
    done = new Set();
  function walk(id) {
    if (done.has(id)) return;
    requireThat(!visiting.has(id), "dependency cycle");
    visiting.add(id);
    for (const d of tasks[id].dependsOn) walk(d);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of Object.keys(tasks)) walk(id);
}
function newExecution(s, scope, owner, epoch = 1, mergeHold = null) {
  const pools = {};
  for (const id of scope) {
    const t = s.tasks[id];
    pools[t.pool] ??= {
      limit: copy(t.allowance),
      spent: { calls: 0, verifierRuns: 0, recoveries: 0 },
    };
  }
  return {
    id: crypto.randomUUID(),
    status: "running",
    scope: copy(scope),
    owner: copy(owner),
    epoch,
    pools,
    requests: {},
    mergeHold: copy(mergeHold),
  };
}
export function createRollout(spec, owner) {
  requireThat(
    spec.protocolVersion === 4,
    "explicit protocolVersion 4 required",
  );
  validOwner(owner);
  text(spec.rolloutId, "rolloutId");
  for (const k of ["path", "identity", "baseBranch", "verifier"])
    text(spec.repository?.[k], `repository.${k}`);
  for (const k of [
    "outcomes",
    "constraints",
    "allowedActions",
    "reservedDecisions",
    "gates",
    "mergeEffects",
  ])
    requireThat(
      Array.isArray(spec.authority?.[k]),
      `authority.${k} must be an array`,
    );
  requireThat(
    spec.authority.outcomes.length &&
      spec.authority.allowedActions.includes("merge"),
    "outcomes and merge authorisation required",
  );
  requireThat(Array.isArray(spec.tasks) && spec.tasks.length, "tasks required");
  const tasks = {};
  for (const input of spec.tasks) {
    requireThat(!tasks[input.id], "duplicate task");
    tasks[input.id] = task(input);
  }
  validateGraph(tasks);
  const s = {
    protocolVersion: 4,
    ...(spec.evidenceContractVersion ? { evidenceContractVersion: spec.evidenceContractVersion } : {}),
    ...(spec.routingPolicy ? { routingPolicy: copy(spec.routingPolicy) } : {}),
    rolloutId: spec.rolloutId,
    repository: copy(spec.repository),
    authority: copy(spec.authority),
    authorityHash: digest(spec.authority),
    tasks,
    history: [],
    events: [],
  };
  s.execution = newExecution(s, Object.keys(tasks), owner);
  return s;
}
function dependenciesSatisfied(s, t) {
  return t.dependsOn.every(
    (id) =>
      s.tasks[id].status === "complete" &&
      s.tasks[id].outcome?.revision === s.tasks[id].revision.hash,
  );
}
function hasAllowance(s, t) {
  const p = s.execution.pools[t.pool];
  return (
    p &&
    p.spent.calls < p.limit.calls &&
    p.spent.verifierRuns < p.limit.verifierRuns
  );
}
export function eligible(s) {
  if (s.execution.status !== "running") return [];
  return s.execution.scope.filter((id) => {
    const t = s.tasks[id];
    if (
      !t.member ||
      t.requiresAssessment ||
      t.status !== "open" ||
      !hasAllowance(s, t) ||
      !dependenciesSatisfied(s, t)
    )
      return false;
    if (s.execution.mergeHold && s.execution.mergeHold.taskId !== id)
      return false;
    return !Object.values(s.tasks).some(
      (other) =>
        active(other) &&
        (t.conflicts.includes(other.id) || other.conflicts.includes(id)),
    );
  });
}
export function summary(s) {
  const tasks = Object.values(s.tasks).filter((t) => t.member);
  return {
    execution: s.execution.status,
    executionId: s.execution.id,
    rolloutComplete: tasks.every((t) => t.status === "complete"),
    complete: tasks.filter((t) => t.status === "complete").length,
    blocked: tasks
      .filter((t) => t.status === "blocked")
      .map((t) => ({ id: t.id, reason: t.reason })),
    ready: eligible(s),
    waiting: tasks.filter(active).map((t) => ({ id: t.id, status: t.status })),
    owner: s.execution.owner,
    epoch: s.execution.epoch,
  };
}
function closure(s, id) {
  const found = new Set([id]);
  let more = true;
  while (more) {
    more = false;
    for (const t of Object.values(s.tasks))
      if (!found.has(t.id) && t.dependsOn.some((d) => found.has(d))) {
        found.add(t.id);
        more = true;
      }
  }
  return [...found];
}
function invalidate(s, id, reason) {
  for (const key of closure(s, id)) {
    const t = s.tasks[key];
    delete t.approval;
    delete t.outcome;
    t.reason = reason;
    if (active(t)) {
      t.status = "draining";
      t.attempt.superseded = true;
    } else if (t.member) t.status = "open";
  }
}
function assessment(s, a) {
  requireThat(
    a?.withinAuthority === true && a.authorityHash === s.authorityHash,
    "revision or prerequisite exceeds authority",
  );
  text(a.evidence, "assessment evidence");
}
function approvalBasis(s, t, head) {
  return {
    revision: t.revision.hash,
    authority: s.authorityHash,
    verifier: digest(s.repository.verifier),
    ...(s.evidenceContractVersion ? {
      verifierInputs: digest(s.repository.verifierInputs || []),
      reviewReceipt: t.attempt.result.reviewReceipt,
    } : {}),
    ...(s.routingPolicy ? { routingPolicy: digest(s.routingPolicy) } : {}),
    baseRef: t.attempt.baseRef,
    purpose: t.attempt.purpose || "outcome",
    reverts: t.attempt.reverts || [],
    head,
    dependencies: t.dependsOn.map((id) => ({
      id,
      outcome: s.tasks[id].outcome,
    })),
  };
}
function currentAttempt(t, c) {
  requireThat(t.attempt?.id === c.attemptId, "stale attempt");
  requireThat(!t.attempt.superseded, "superseded attempt");
}
function outstanding(s, id) {
  return Object.values(s.execution.requests).filter(
    (r) =>
      r.taskId === id &&
      !["accepted", "interrupted", "blocked", "denied"].includes(r.status),
  );
}
function recordReversion(t, attempt, mergeCommit) {
  if (attempt.purpose !== "rollback") return;
  for (const landing of t.landings)
    if (attempt.reverts.includes(landing.mergeCommit))
      landing.revertedBy = mergeCommit;
}

/** Host attestations are trusted local inputs, never worker-authored commands. */
export function apply(previous, command, context) {
  const s = copy(previous),
    c = command,
    e = s.execution;
  requireThat(s.protocolVersion === 4, "unsupported protocol");
  validOwner(context);
  if (c.type === "recover") {
    requireThat(
      context.harness === e.owner.harness &&
        context.account === e.owner.account,
      "recovery must use same harness/account",
    );
    requireThat(
      context.session !== e.owner.session,
      "session already owns execution",
    );
    requireThat(
      c.previousEpoch === e.epoch,
      "recovery evidence ownership epoch mismatch",
    );
    requireThat(
      c.previousOwnerStopped === true,
      "previous owner must be proven stopped",
    );
    text(c.evidence, "owner recovery evidence");
    const pools = new Set(
      e.scope.filter((id) => active(s.tasks[id])).map((id) => s.tasks[id].pool),
    );
    for (const id of pools) {
      const p = e.pools[id];
      requireThat(
        p.spent.recoveries < p.limit.recoveries,
        "recovery allowance exhausted",
      );
      p.spent.recoveries++;
    }
    for (const r of Object.values(e.requests).filter((r) =>
      ["claimed", "dispatched"].includes(r.status),
    )) {
      const resolution = c.resolutions?.[r.id];
      requireThat(
        resolution &&
          [
            "dispatched",
            "accepted",
            "interrupted",
            "blocked",
            "denied",
            "not-started",
          ].includes(resolution.state),
        "unresolved native request prevents recovery",
      );
      if (resolution.state === "not-started") {
        requireThat(
          r.status === "claimed" && !r.childId,
          "cannot erase a dispatched child",
        );
        text(resolution.evidence, "native never-started evidence");
        r.status = "interrupted";
        r.recovery = copy(resolution);
        continue;
      }
      text(resolution.childId, "actual recovered child");
      if (r.childId)
        requireThat(r.childId === resolution.childId, "child identity changed");
      r.childId = resolution.childId;
      // Collected outputs still pass through native accept; recovery cannot manufacture them.
      r.status = resolution.state === "dispatched" ? "dispatched" : r.status;
      r.recovery = copy(resolution);
    }
    e.owner = copy(context);
    delete e.owner.epoch;
    e.epoch++;
  } else {
    requireThat(
      context.harness === e.owner.harness &&
        context.account === e.owner.account &&
        context.session === e.owner.session &&
        context.epoch === e.epoch,
      "stale owner or epoch",
    );
    const t = c.taskId ? s.tasks[c.taskId] : null;
    if (c.taskId) requireThat(t, "unknown task");
    switch (c.type) {
      case "start": {
        requireThat(eligible(s).includes(c.taskId), "task is not ready");
        requireThat(sha(c.baseRef), "immutable base SHA required");
        requireThat(
          !c.purpose || ["outcome", "repair", "rollback"].includes(c.purpose),
          "invalid attempt purpose",
        );
        if (c.purpose === "rollback") {
          requireThat(
            s.authority.allowedActions.includes("revert-run-owned"),
            "rollback is not authorised",
          );
          requireThat(
            e.mergeHold?.taskId === t.id,
            "rollback requires attributed regression hold",
          );
          requireThat(
            Array.isArray(c.reverts) &&
              c.reverts.length > 0 &&
              new Set(c.reverts).size === c.reverts.length,
            "rollback commits required",
          );
          for (const commit of c.reverts)
            requireThat(
              t.landings.some(
                (l) =>
                  l.mergeCommit === commit &&
                  !l.revertedBy &&
                  l.purpose !== "rollback",
              ),
              "rollback commit is not owned by this task or already reverted",
            );
        }
        t.generation++;
        t.attempt = {
          id: crypto.randomUUID(),
          generation: t.generation,
          executionId: e.id,
          revision: t.revision.hash,
          baseRef: c.baseRef,
          ownerEpoch: e.epoch,
          purpose: c.purpose || "outcome",
          reverts: c.purpose === "rollback" ? copy(c.reverts) : [],
        };
        t.attempts.push(t.attempt);
        t.status = "active";
        delete t.reason;
        break;
      }
      case "claim": {
        requireThat(
          ["running", "pausing"].includes(e.status),
          "execution stopped or paused",
        );
        requireThat(
          t.status === "active" && !t.attempt.superseded,
          "task not active",
        );
        text(c.requestId, "requestId");
        requireThat(!e.requests[c.requestId], "request already claimed");
        const cost = c.verifierRuns ?? 0;
        const calls = c.calls ?? 1;
        positive(calls, "calls");
        requireThat(
          Number.isSafeInteger(cost) && cost >= 0,
          "invalid verifier reservation",
        );
        const p = e.pools[t.pool];
        requireThat(
          p.spent.calls + calls <= p.limit.calls &&
            p.spent.verifierRuns + cost <= p.limit.verifierRuns,
          "allowance exhausted",
        );
        p.spent.calls += calls;
        p.spent.verifierRuns += cost;
        e.requests[c.requestId] = {
          id: c.requestId,
          taskId: t.id,
          attemptId: t.attempt.id,
          status: "claimed",
          calls,
          verifierRuns: cost,
        };
        break;
      }
      case "reserve-verifier": {
        requireThat(
          ["running", "pausing"].includes(e.status),
          "execution stopped or paused",
        );
        positive(c.verifierRuns, "verifierRuns");
        text(c.purpose, "verification purpose");
        const p = e.pools[t.pool];
        requireThat(
          p && p.spent.verifierRuns + c.verifierRuns <= p.limit.verifierRuns,
          "verifier allowance exhausted",
        );
        p.spent.verifierRuns += c.verifierRuns;
        break;
      }
      case "request-unavailable": {
        const r = e.requests[c.requestId];
        requireThat(r && r.taskId === t.id, "unknown request");
        requireThat(c.proof?.source === "native-launch" && c.proof.neverStarted === true &&
          s.routingPolicy?.recovery?.model === c.proof.model, "native launch refusal evidence required");
        text(c.proof.evidence, "native launch refusal evidence");
        if (r.launchUnavailable) {
          requireThat(digest(r.launchUnavailable) === digest(c.proof), "conflicting native launch refusal");
          return previous;
        }
        requireThat(r.status === "claimed" && !r.childId, "native refusal requires an unbound claim");
        r.status = "denied";
        r.launchUnavailable = copy(c.proof);
        break;
      }
      case "request-state": {
        const r = e.requests[c.requestId];
        requireThat(r && r.taskId === t.id, "unknown request");
        requireThat(
          [
            "dispatched",
            "accepted",
            "interrupted",
            "blocked",
            "denied",
          ].includes(c.status),
          "invalid request state",
        );
        if (
          ["accepted", "interrupted", "blocked", "denied"].includes(r.status)
        ) {
          requireThat(c.status === r.status, "terminal request cannot change");
          return previous;
        }
        if (c.status === "dispatched") {
          text(c.childId, "actual native child id");
          requireThat(c.childId !== e.owner.session, "lead cannot be child");
          requireThat(
            !Object.values(e.requests).some(
              (q) => q.id !== r.id && q.childId === c.childId,
            ),
            "independent stages require fresh child",
          );
          if (r.childId) requireThat(r.childId === c.childId, "child changed");
          r.childId = c.childId;
        } else requireThat(r.childId, "request has no native child");
        r.status = c.status;
        break;
      }
      case "converged": {
        currentAttempt(t, c);
        requireThat(c.revision === t.revision.hash, "stale revision");
        const hash = digest(c.result);
        if (t.attempt.resultHash) {
          requireThat(t.attempt.resultHash === hash, "conflicting result");
          return previous;
        }
        requireThat(t.status === "active", "task not active");
        requireThat(
          outstanding(s, t.id).length === 0,
          "native requests still unresolved",
        );
        t.attempt.resultHash = hash;
        t.attempt.result = copy(c.result);
        if (s.routingPolicy && c.result.routingState) {
          const route = c.result.routingState;
          requireThat(route.version === 1 && route.policyDigest === s.routingPolicy.policyDigest &&
            Number.isSafeInteger(route.qualityFailures) && route.qualityFailures >= (t.routingState?.qualityFailures || 0),
            "invalid or regressed routing state");
          if (route.recoveryUnavailable) {
            requireThat(route.recoveryUnavailable.model === s.routingPolicy.recovery?.model && route.qualityFailures >= 2,
              "invalid unavailable recovery binding");
            text(route.recoveryUnavailable.evidence, "unavailable recovery evidence");
          }
          if (t.routingState?.recoveryUnavailable)
            requireThat(digest(route.recoveryUnavailable || null) === digest(t.routingState.recoveryUnavailable),
              "unavailable recovery evidence cannot be removed or changed");
          t.routingState = copy(route);
        }
        if (c.result.status === "review") {
          requireThat(
            c.result.verified === true && sha(c.result.head),
            "successful verification and head required",
          );
          requireThat(
            c.result.verifiedHead === c.result.head &&
              c.result.reviewedHead === c.result.head,
            "verification/review head mismatch",
          );
          text(c.result.reviewer, "independent reviewer");
          text(c.result.verification, "verification evidence");
          if (s.evidenceContractVersion)
            requireThat(/^[a-f0-9]{64}$/.test(c.result.reviewReceipt || ""), "built-in review receipt required");
          text(c.result.prUrl, "PR URL");
          const url = new URL(c.result.prUrl);
          requireThat(
            `${url.host}${url.pathname.replace(/\/pull\/\d+$/, "")}` ===
              s.repository.identity && /\/pull\/\d+$/.test(url.pathname),
            "PR identity mismatch",
          );
          requireThat(
            dependenciesSatisfied(s, t),
            "dependency outcome changed",
          );
          const basis = approvalBasis(s, t, c.result.head);
          t.approval = {
            ...basis,
            digest: digest(basis),
            prUrl: c.result.prUrl,
            reviewer: c.result.reviewer,
            verification: c.result.verification,
          };
          t.attempt.approval = copy(t.approval);
          t.status = "review";
        } else {
          t.status = "blocked";
          t.reason =
            c.result.reason || c.result.blockerDiagnosis || c.result.status;
        }
        break;
      }
      case "superseded-merge-observed": {
        const attempt = t.attempts.find((a) => a.id === c.attemptId),
          a = attempt?.approval,
          o = c.observation;
        requireThat(
          attempt?.superseded && a && c.approval === a.digest,
          "historical superseded approval required",
        );
        requireThat(
          o?.state === "MERGED" &&
            sha(o.mergeCommit) &&
            o.repository === s.repository.identity &&
            o.baseBranch === s.repository.baseBranch &&
            o.prUrl === a.prUrl &&
            o.head === a.head,
          "historical merge identity binding mismatch",
        );
        requireThat(
          typeof c.verified === "boolean",
          "integration verification result required",
        );
        text(o.verification, "integration verification evidence");
        const evidenceHash = digest({ observation: o, verified: c.verified }),
          prior = t.landings.find((l) => l.mergeCommit === o.mergeCommit);
        if (prior) {
          requireThat(
            prior.evidenceHash === evidenceHash,
            "conflicting historical landing evidence",
          );
          return previous;
        }
        t.landings.push({
          ...copy(o),
          attemptId: attempt.id,
          revision: attempt.revision,
          purpose: attempt.purpose,
          reverts: copy(attempt.reverts || []),
          verified: c.verified,
          superseded: true,
          evidenceHash,
        });
        recordReversion(t, attempt, o.mergeCommit);
        invalidate(
          s,
          t.id,
          "superseded queued change landed; current outcomes require revalidation",
        );
        if (!c.verified && !e.mergeHold)
          e.mergeHold = { taskId: t.id, evidence: o.verification };
        break;
      }
      case "revert-observed":
      case "merge-observed": {
        if (c.type === "revert-observed") {
          const landed = t.landings.find(
            (l) =>
              l.attemptId === c.attemptId &&
              l.purpose === "rollback" &&
              l.observationHash &&
              l.verified !== false,
          );
          if (landed) {
            const attempt = t.attempts.find((a) => a.id === c.attemptId);
            requireThat(
              c.approval === attempt?.approval?.digest &&
                digest(c.observation) === landed.observationHash,
              "conflicting rollback observation",
            );
            return previous;
          }
        }
        requireThat(
          ["running", "pausing"].includes(e.status),
          "execution stopped or paused",
        );
        currentAttempt(t, c);
        const reverting = c.type === "revert-observed";
        requireThat(
          reverting === (t.attempt.purpose === "rollback"),
          "rollback needs revert-observed evidence",
        );
        const a = t.approval,
          o = c.observation;
        requireThat(a && c.approval === a.digest, "stale approval");
        requireThat(
          digest(approvalBasis(s, t, a.head)) === a.digest,
          "approval basis changed",
        );
        requireThat(dependenciesSatisfied(s, t), "dependency outcome changed");
        requireThat(
          !e.mergeHold || e.mergeHold.taskId === t.id,
          "repository merge hold",
        );
        requireThat(
          o.repository === s.repository.identity &&
            o.baseBranch === s.repository.baseBranch &&
            o.prUrl === a.prUrl,
          "merge identity mismatch",
        );
        requireThat(o.head === a.head, "PR head changed");
        if (t.status === "complete") {
          const landed = t.landings.at(-1);
          requireThat(
            o.state === "MERGED" && o.mergeCommit === landed.mergeCommit,
            "stale merge observation",
          );
          return previous;
        }
        if (o.state === "MERGED") {
          requireThat(sha(o.mergeCommit), "actual merge commit required");
          text(o.verification, "post-merge verification evidence");
          if (e.mergeHold?.taskId === t.id) e.mergeHold = null;
          t.landings.push({
            ...copy(o),
            attemptId: t.attempt.id,
            revision: t.revision.hash,
            purpose: t.attempt.purpose,
            reverts: copy(t.attempt.reverts || []),
            observationHash: digest(o),
          });
          if (reverting) {
            recordReversion(t, t.attempt, o.mergeCommit);
            invalidate(
              s,
              t.id,
              "reverted to restore integration; required outcome remains unmet",
            );
            t.status = "blocked";
          } else {
            t.status = "complete";
            t.outcome = {
              revision: t.revision.hash,
              mergeCommit: o.mergeCommit,
              approval: a.digest,
            };
          }
        } else {
          requireThat(o.state === "OPEN", "PR closed without merge");
          t.status = "waiting";
        }
        break;
      }
      case "cover-gate": {
        assessment(s, c.assessment);
        requireThat(
          t.status === "blocked" &&
            !t.requiresAssessment &&
            t.attempt?.revision === t.revision.hash &&
            !t.attempt.superseded &&
            t.attempt.result?.status === "gate-pending",
          "current blocked gate declaration required",
        );
        text(c.declaration, "gate declaration");
        requireThat(
          t.attempt.result.gatedInputs?.includes(c.declaration),
          "gate was not declared by the current attempt",
        );
        t.coveredGates ??= [];
        if (
          t.coveredGates.some(
            (g) =>
              g.declaration === c.declaration &&
              g.revision === t.revision.hash &&
              g.authorityHash === s.authorityHash,
          )
        )
          return previous;
        t.coveredGates.push({
          declaration: c.declaration,
          revision: t.revision.hash,
          authorityHash: s.authorityHash,
          evidence: c.assessment.evidence,
          attemptId: t.attempt.id,
        });
        break;
      }
      case "block": {
        text(c.reason, "block reason");
        for (const id of c.resolvedRequests || []) {
          const r = e.requests[id];
          requireThat(r && r.taskId === t.id, "unknown resolved request");
          requireThat(
            ["accepted", "interrupted", "blocked", "denied"].includes(r.status),
            "native request unresolved; collect native evidence before blocking",
          );
        }
        requireThat(
          outstanding(s, t.id).length === 0,
          "native requests still unresolved",
        );
        t.status = "blocked";
        t.reason = c.reason;
        delete t.approval;
        break;
      }
      case "retry":
        requireThat(
          !active(t) && t.status !== "complete" && t.member,
          "task cannot retry",
        );
        requireThat(hasAllowance(s, t), "allowance exhausted");
        t.status = "open";
        break;
      case "assessment-needed":
        text(c.reason, "assessment reason");
        text(c.observedHash, "observed requirements hash");
        invalidate(s, t.id, c.reason);
        t.requiresAssessment = true;
        t.observedHash = c.observedHash;
        if (t.status !== "draining") t.status = "blocked";
        break;
      case "revise":
        assessment(s, c.assessment);
        text(c.requirements, "requirements");
        t.requiresAssessment = false;
        delete t.observedHash;
        t.revisions.push(copy(t.revision));
        t.revision = {
          number: t.revision.number + 1,
          hash: digest(c.requirements),
          requirements: c.requirements,
          assessment: copy(c.assessment),
        };
        invalidate(s, t.id, "requirements revised");
        break;
      case "invalidate":
        text(c.reason, "invalidation reason");
        text(c.evidence, "invalidation evidence");
        invalidate(s, t.id, c.reason);
        break;
      case "drained":
        requireThat(
          t.status === "draining" && outstanding(s, t.id).length === 0,
          "drain unresolved",
        );
        text(c.evidence, "drain evidence");
        t.status = t.requiresAssessment ? "blocked" : "open";
        break;
      case "prerequisite": {
        assessment(s, c.assessment);
        requireThat(
          !active(t),
          "drain current attempt before changing dependencies",
        );
        requireThat(!s.tasks[c.task.id], "prerequisite already exists");
        const child = task(c.task);
        child.pool = t.pool;
        child.allowance = copy(t.allowance);
        s.tasks[child.id] = child;
        t.dependsOn.push(child.id);
        e.scope.push(child.id);
        validateGraph(s.tasks);
        invalidate(s, t.id, "new prerequisite");
        break;
      }
      case "defer": {
        const ids = c.scope || [t.id];
        for (const id of ids) {
          requireThat(
            s.tasks[id] && !active(s.tasks[id]),
            "cannot defer active work",
          );
          for (const d of closure(s, id))
            requireThat(
              ids.includes(d) || !s.tasks[d].member,
              "dependent closure must be deferred together",
            );
        }
        for (const id of ids) {
          s.tasks[id].member = false;
          s.tasks[id].status = "deferred";
        }
        break;
      }
      case "pause":
        requireThat(e.status === "running", "execution not running");
        e.status = "pausing";
        break;
      case "stop":
        e.status = "stopped";
        break;
      case "resume":
        requireThat(
          ["paused", "stopped", "ended"].includes(e.status),
          "execution is not paused or ended",
        );
        e.status = "running";
        break;
      case "settle": {
        const inFlight = e.scope.some((id) => active(s.tasks[id]));
        if (e.status === "pausing" && !inFlight) e.status = "paused";
        else if (
          e.status === "running" &&
          !inFlight &&
          eligible(s).length === 0
        )
          e.status = "ended";
        break;
      }
      case "relaunch": {
        requireThat(e.status === "ended", "relaunch requires ended execution");
        text(c.instruction, "explicit relaunch instruction");
        requireThat(
          Array.isArray(c.scope) &&
            c.scope.length &&
            new Set(c.scope).size === c.scope.length,
          "requested unfinished scope required",
        );
        for (const id of c.scope)
          requireThat(
            s.tasks[id]?.member &&
              s.tasks[id].status !== "complete" &&
              !active(s.tasks[id]),
            "relaunch only unfinished scope",
          );
        s.history.push(copy(e));
        s.execution = newExecution(
          s,
          c.scope,
          e.owner,
          e.epoch + 1,
          e.mergeHold,
        );
        for (const id of c.scope) {
          s.tasks[id].status = "open";
          delete s.tasks[id].approval;
        }
        break;
      }
      case "regression":
        text(c.evidence, "regression evidence");
        if (c.landing) {
          const l = c.landing,
            a = t.approval;
          requireThat(
            a &&
              l.state === "MERGED" &&
              sha(l.mergeCommit) &&
              l.repository === s.repository.identity &&
              l.baseBranch === s.repository.baseBranch &&
              l.head === a.head &&
              l.prUrl === a.prUrl,
            "regression landing does not match approved task",
          );
          if (
            !t.landings.some(
              (previous) => previous.mergeCommit === l.mergeCommit,
            )
          )
            t.landings.push({
              ...copy(l),
              attemptId: t.attempt.id,
              revision: t.revision.hash,
              purpose: t.attempt.purpose,
              reverts: copy(t.attempt.reverts || []),
              verified: false,
            });
          recordReversion(t, t.attempt, l.mergeCommit);
        }
        e.mergeHold = { taskId: t.id, evidence: c.evidence };
        invalidate(s, t.id, "post-merge regression");
        break;
      case "clear-hold":
        text(c.evidence, "restored integration evidence");
        requireThat(e.mergeHold, "no merge hold");
        e.mergeHold = null;
        break;
      default:
        throw new Error(`unknown transition ${c.type}`);
    }
  }
  for (const t of Object.values(s.tasks))
    if (t.attempt) {
      const i = t.attempts.findIndex((a) => a.id === t.attempt.id);
      if (i >= 0) t.attempts[i] = copy(t.attempt);
    }
  s.events.push({
    sequence: s.events.length + 1,
    type: c.type,
    taskId: c.taskId || null,
    executionId: s.execution.id,
    epoch: s.execution.epoch,
    evidence: copy(c),
  });
  return s;
}
