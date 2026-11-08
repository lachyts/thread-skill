# 0074 — One serial chain per project, and sign-ins settled at schedule

Date: 2026-11-07
Status: proposed. Grilled 2026-11-07 in the SEO orient session, after its audit of `seo-rollout-2026-11-07` … `-4`;
built by Phase 42 (`thread-skill-p42-2` … `-4`). For one project's serial work, d1 amends ADR 0040's p24-2 mechanic
*One chain per serial note* ("A serial set that splits into surface-disjoint groups gets one note per group") and ADR
0067 d4's predicted claims, which "group, order and wait": disjoint surfaces no longer split a project's members into
chains. d3 amends the next sentence of that d4, "They never refuse a schedule" (serial-chains.py's docstring repeats it
word for word): a predicted `repo:` claim outside its launch folder's checkout now refuses its member, aliased or not.
d3 also amends ADR 0059 d4, "A code row never opens where its Leg cannot finish it": its refusal of "an alias-less
member that writes two or more checkouts" widens to every member that commits to a checkout other than its launch
folder's, and its exemption, "An aliased member in checkout A that also claims checkout B (a workspace `--add-dir`, a
project `Local:`)", now holds only while B is reach the row does not commit to. Sits beside Phase 41 (a rollout
waits instead of stopping, and never notifies): this ADR moves the waits it can foresee into the sitting, where he is
present.

## Context

`/thread:orient SEO` scheduled five serial-shaped rows: two live-site title/meta publishes, a content refresh, a
one-line edit in a second repo, and a new MCP fork. `serial-chains.py plan` groups members into chains by surface
overlap and in-set dependencies only, and each row claimed only its own task note, so it wrote four chain notes, and
the orient started four Leg Sessions at once. One finished (the fork). Two stopped within ten minutes on one cause:
the Webflow MCP, a remote OAuth server, was signed out in the Legs' Sessions; a thread note said it had been re-authed,
and nothing checked it from the Legs' launch before they started (only each Leg's own preflight, `legs.md` §
Preflight, sets such a row aside). The fourth stopped because a row that wrote `~/repos/tools/metrics` launched from
the workspaces seo launcher, a surface the orient added: its Leg made the edit, Verify was green, but a review
subagent cannot leave the Session's cwd (`legs.md` § Review), so the Leg reverted its own commit and set the task
aside. The plan refuses a cross-checkout row only when it has no launch alias, or launches from the vault (ADR 0059
d4).

His words: "it looks like you launched a bunch of rollout legs, like four different legs, and each of them failed in
different ways … Why then do we need to create four different serial chains that are each named 'leg'? It creates
all this extra admin especially when they break because basically all of these seem to break somehow."

His model of a rollout (one parent session, subagents under it) is the parallel shape. Serial work has no parent:
each chain is run by Legs, each a visible Session (ADR 0040). The admin he names is the count of those Sessions.

## Decision

**d1. One chain per project.** Schedule's serial path writes at most one chain note per project per run: every
serial-shaped member whose first `projects:` link is that project goes in it, in dependency order, and its rows are
worked by one Leg Session at a time. Grouping keeps its two edges, a surface overlap and an in-set dependency, and
adds a third, a shared first project, so disjoint surfaces no longer split a project's chain. A member with no
`projects:` link is grouped as before, by surface and dependency alone: it gets a chain of its own unless one of those
edges joins it to another member. Two projects' members still give two chains unless a surface overlap or an in-set
dependency joins them, as today, and separate chains run side by side, taking turns by rank on a place they share
(ADR 0067 d4, d9). A row set aside (a gate, a sign-in, a block) never holds the rows after it that do not depend on
it: the Leg sets it aside and claims the next, as `legs.md` already does. A Leg still hands over to a fresh Session at
a launch change between two rows (ADR 0040) and after at most five fresh claims (CONTEXT.md **Leg**), so one chain can
be worked by several Legs, one after another, never side by side.

**d2. Sign-ins are settled at schedule, before any Leg starts.** For each member, schedule reads the MCP namespaces
its `## Launch` names as required and checks each answers from the row's launch profile. A server only Lachy can sign
in to that reads signed out raises one `hands_steps` list on his screen (each server, where to sign in, the evidence
that ticks it) while he is still in the sitting, and the chain's Leg 1 starts only once every needed server reads
signed in. A server he will not sign in to now, or a check that cannot run, leaves the rows that need it out of the
chain, unstamped, each named with what to sign in to; a later `/thread:orient --steer` takes them. A member that
depends on a row left out, by any dependency the plan reads (its `depends-on:` or `blocked-by:`, or a body dependency
schedule § 3 passes as `--dep <dependant>=<dependency>`), directly or through another member, is left out with it,
unstamped, and named the same way: the row it waits on, and what to sign in to. Kept in, it would be held
`depends on [[<row>]]`, and once nothing else was claimable its chain would close `stuck`: a row launched to wait. The
Leg's own preflight stays as the backstop.

**d3. A row commits only to the checkout it launches from.** `serial-chains.py plan` refuses any member, aliased or
not, that commits to a checkout other than its launch folder's. The checkouts it commits to are those of its `repo:`
surfaces (a keyed `repo:<toplevel>//<path>` token, or a bare `repo:<toplevel>` that is a git toplevel), declared,
derived or added for it at schedule. The plan cannot tell a commit from a read: a `## Launch` path below another
checkout's toplevel outside a **Read...** item (a **Files:** span, an unlabelled line) is a prediction, so a row that
names a file there only to read it is refused too. The remedy names, in turn: that checkout's launcher when the
launch-folders file (`launch-folders.json`) has one, else a launch from that checkout; one task per checkout chained
by `depends-on:` (under d1 those tasks stay in the one chain, with a Leg boundary between them); and, for a checkout
the row only reads, ADR 0059 d4's third remedy, a `surfaces:` declaration without that checkout, or the path moved
under a **Read...** item, which derivation skips.

An alias-less member opens with `claude` from the one checkout its `repo:` surfaces name, whatever else it reaches.
Naming none, it opens as today: from its one `works` checkout when it has exactly one, refused when it has two or more
(ADR 0059 d4), and with none from its one path-only `repo:` token, else the vault root. Naming two or more, it is
refused. So the build changes the launch pick as well as the refusal: today the pick reads `works`, reach included,
and opens from the vault when `works` holds two, so a member that commits to checkout A while its first project's
`Local:` is checkout B would still be refused.

Reach beside a launch in a checkout is not refused: a launch command's `--add-dir` and `cd` paths and the first
project's `Local:` predict nothing (schedule § Serial path), and the read-only reach ADR 0059 d4 named (a workspace
`--add-dir`, a project `Local:`) stays allowed as it ruled, so a workspace chain that reaches other repos still
schedules. `works_of` counts that reach too, so d3's refusal reads the surfaces' checkouts, not a member's `works`, and
so does the alias-less pick until its surfaces name none. ADR 0059 d4's two refusals, which the plan reads from
`works` today, stay as they are, each for a member with no checkout to open in: the alias-less one above, and an
aliased one launched from the vault while it works any checkout, reach included. The reason is a commit's alone: a review cannot leave the Session's cwd, so a row
that commits elsewhere can never finish. A read needs no review, but the plan sees only what a row names: a read it
predicts is refused like a commit until one of the remedies above takes the path out of the prediction. A row that
commits to a checkout it only reaches, naming no path there, predicts no claim and is not caught here; its Leg's
review stays the backstop, as on 11-07.

## Consequences

- An orient's serial steer opens one Leg Session at a time per project, never one per task.
- A chain whose rows launch from several checkouts, which d3 now forces whenever a project's rows commit to several,
  still hands over to a new Session at each launch change: the 11-07 SEO set (rows in workspaces,
  `~/repos/tools/metrics` and the MCP fork's repo) still opens at least three Leg Sessions, one after another. The
  plan's order puts a row with the previous row's launch next among those ready in the same phase, which keeps those
  boundaries few.
- A day-shaped deadline is met by a sign-in in the sitting, not by a later repair.
- A project's serial work runs slower end to end, its rows in turn: he chose that over the Session count.
- A vault note's claim that a service is signed in ("re-authed 11-03") is no longer the evidence: d2's live check is.

## Decided for him (overturnable)

- A row that commits to a checkout other than its launch's → refused, or relaunched from its own checkout (technical:
  a review cannot leave the Session's cwd, so such a row can never finish; d3).
- A path a row names in another checkout only to read it, outside a **Read...** item → refused like a commit, until a
  `surfaces:` declaration leaves that checkout out or the path moves under **Read...** (technical: the plan cannot
  tell a read from a commit, and either remedy is one line; d3).
- Read-only reach into another checkout (a workspace `--add-dir`, a project `Local:`) → still allowed, as ADR 0059 d4
  ruled (technical: it commits nothing, so no review has to leave the cwd, and refusing it would refuse real workspace
  chains).
- The sign-in check runs from each row's launch profile, not from the scheduling session's (technical: MCP auth is
  per Session and per profile).
- Rows needing a server he will not sign in to now are left out, never launched to wait (priorities: Phase 41's "fix
  all rollouts when I sit down intentionally", and his pick here, "ask at schedule time").
- A member that depends on a row left out, by any dependency the plan reads (`depends-on:`, `blocked-by:`, or a body
  dependency passed as `--dep`), is left out with it (follows from the bullet above: kept in, it would wait on that
  row and close its chain `stuck`).
- A session-lane member that depends on a row left out is never left out itself, but a member depending on it is,
  directly or through another such lane member (technical: a lane row is never stamped, so leaving it out changes
  nothing, while a chained row depending on it would wait on a row that waits on a left-out one; d2's "through another
  member").
- A member with no `projects:` link is grouped as before, by surface and dependency alone (technical: no project names
  what it shares with the rest, and d1 adds only the shared-project edge).
- The sign-in step sits after Pre-flight and before the gates, as schedule § Serial path S3.7 (technical: S4's gates
  and its `checkouts`-keyed reads then see only the rows that stay, and every S2 re-run carries `--signed-out`, so
  S4's `--dep` edges still widen the closure).
- orient-all's parent raises the one sign-in list before batch 1, whatever the budget (technical: a fork asks nothing
  and has no route to the question tool or the Stage's list, orient-all § 6 step 3, and one list replaces a pause
  between serial batches).
- The Backlog orient's forks check and leave rows out, and its § B9 raises the list after the start, its
  post-question round scheduling each row whose server then reads signed in (technical: a fork asks nothing, ADR
  0071, and § B9 is the run's sitting).
- `--signed-out` keys a row's launch as its alias, or `claude` plus its folder for an alias-less row (technical: an
  alias fixes its folder and its `--mcp-config`, while alias-less rows differ by folder through project `.mcp.json`
  servers and their per-path approvals).
- The check reads the account a fresh shell resolves, never this session's pinned one and never every Login. This
  session's tools stand in only when its account, folder and MCP config match the row's launch, and a namespace they
  lack is read from `claude mcp list` (technical: a Stage Leg's Login is picked at its start by weekly room, Chorus
  ADR 0103 d1 as amended by Chorus ADR 0111, which schedule cannot know; checking each Login would ask one sign-in per Login;
  and a session opened with `--strict-mcp-config` holds a set the row's Leg would not. `legs.md` § Preflight
  backstops all of it).
- A Codex launch's (`cx-*`) sign-ins are not checked at schedule and never leave a row out, and S7 names them. This
  departs from d2's "a check that cannot run leaves the rows out" (technical: `claude mcp list` and this session's
  tools read Claude Code's config, never the Codex profile a `cx-*` alias opens; `codex mcp list` lists that
  profile's servers without calling one; and a `cx-*` Leg is a manual hand-over, `legs.md` § Hand over, whose
  preflight checks them).
