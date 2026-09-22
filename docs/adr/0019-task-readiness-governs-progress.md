# Task readiness governs progress; waves remain a planning view

Status: accepted, implementation pending
Date: 2026-09-22

Tasks advance when their currently satisfied dependencies, authority, remaining allowance and conflicts permit it. Verified merges release eligible dependants immediately; unrelated tasks do not impose a wave barrier. Waves remain useful planning groupings, but a single wave cursor cannot express the truth of partial progress.

An execution ends partially when no task can advance and no genuine in-flight work remains. Its rollout stays unfinished, retaining blocked tasks and their history. A historical merge remains recorded after a revert or adopted requirement revision, while current completion and dependent outcomes are invalidated and revalidated. Missing workers are recovery work with a finite recovery allowance, not indefinite evidence of waiting.

A normal pause admits no new tasks or follow-ons; already active tasks may finish their bounded work and merge approved results before the execution becomes paused. An immediate stop fences further work and merges immediately while preserving recoverable state. Neither form resumes automatically. This amends the ordered-wave execution assumption in [ADR 0009](0009-thread-absorbs-wave.md), preserving its execution-fit boundary, and preserves the single engine in [ADR 0004](0004-repair-is-a-conductor-not-an-engine.md) and human roadmap in [ADR 0005](0005-a-phase-is-a-plan-not-a-task.md).
