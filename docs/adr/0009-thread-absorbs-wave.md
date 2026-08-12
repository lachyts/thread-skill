# 0009 — thread absorbs wave: one plugin, one prefix, two lanes

Date: 2026-08-12
Status: accepted (supersedes the packaging conclusion of ADR 0003)

## Context

Thread and wave shipped as sibling plugins with a prose boundary: orient
*referred* PR-shaped clusters to `/wave:*`; wave's execution-fit fallback
described "calendar/session-driven execution" without naming a thread verb.
A 2026-08-12 audit of 10 orient runs and 34 wave rollouts found the boundary
leaking in practice: orient dispatched two repo-backed clusters through its
own cc-* batch lane (2026-08-10, GifLab and Smart Slider) instead of the
engine, the fit test existed in three divergent prose copies, wave's two
references to thread pointed at a retired path, and release hygiene slipped
on both trains independently (wave's fit gate sat uninstalled for two weeks;
thread's marketplace.json ran chronically one version behind).

Two decisions from the same interview dissolved the case for separation:
the execution-fit test now decides the lane **hard** (not as a referral),
and schedule's 3-task floor is gone (shape decides, not count). After those,
the two plugins are one system with one routing brain dispatching
bidirectionally — and cross-plugin dispatch can only go by skill name,
whereas intra-plugin routing runs a sibling's SKILL.md by
`${CLAUDE_PLUGIN_ROOT}` path, thread's established discipline.

## Decision

Merge wave into thread as one plugin, `thread` 2.0.0, thirteen skills.
Thread's seven daily-driver verbs keep their names; wave's six become
`/thread:split|gather|schedule|execute|status|repair`. **"Wave" moves from
namespace to glossary**: rollouts still have waves, `wave:` frontmatter and
`WAVE-STATUS:` internals are untouched — the wave is the object, not the
namespace. Hard cutover per the no-alias-stubs rule: no `/wave:*` stubs,
tombstone README on the archived wave-skill repo only.

ADR 0003's *scope* reasoning survives intact: orient still never grows a
merge engine, still emits artefacts rather than launching, and non-PR ops
work is still the wrong fit for the engine. Only its packaging conclusion —
that the engine must live in a separate namespace — is superseded.

## Rejected

- **Two plugins, mechanical cross-links** ("married, not merged") — fixes
  the stale refs and the fit-test drift but keeps two release trains (both
  empirically slipped), keeps sibling dispatch name-based, and keeps two
  prefixes for one system.
- **wave absorbs thread** — renames the seven high-frequency verbs to save
  the six rare ones.
- **New umbrella name** — both muscle memories break; maximum sweep.
- **Monorepo, two plugins** — one release train but abandons the single
  family name that motivated the merge.

## Consequences

- A one-line orient tweak now ships on the same release train as the engine;
  the compensating disciplines are inherited (no `hooks` key in plugin.json,
  single-quoted description scalars, plugin.json/marketplace.json bumped
  together).
- Wave's ADRs 0001–0005 renumbered to 0004–0008; wave's THREAD.md preserved
  verbatim as `docs/wave-THREAD-archive.md`; wave-skill pinned at
  `wave--v1.4.1` and archived.
- Every external `/wave:*` reference (AGENTS.md, shared writer specs,
  parity checker, vault notes, memories) swept in the same cutover.
