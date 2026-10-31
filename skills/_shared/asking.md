# Asking Lachy — the question gate

Read this before any AskUserQuestion (or the harness's own ask tool), any plain-text question, any grill question and
any recommendation. Every question spends his attention, so only the questions he owns reach him, each worded so he can
answer it well; every other call is decided for him and listed where he can overturn it.

## 1. Label the Owner

Label each question before it is asked:

| Owner | What it is | Action |
| --- | --- | --- |
| *yours* | intent, how important it is, how robust it must be, who it is for, how it feels, his taste or lived use, which thing he meant, and an authorisation an ADR keeps as his (ADR 0008's sign-offs, ADR 0011's vault tasks) | Ask it, in the Framing (§ 3). |
| *priorities* | a call his stated priorities, or the project's `## Priorities` card, already answer | Decide it and list it (§ 2). |
| *technical* | a call the code, the data, the ADRs or research can settle | Research it, decide it and list it (§ 2). |
| *gate* | a process step: "next move?", "archive?", a "write it?" he already approved, confirming a queue he approved, a review STOP, "shall I carry on?" | Never ask: design it out, or decide and say so in one line. |

- A confirm of content he owns but has not seen (a roadmap, a draft in his voice) is *yours*.
- The steering exception (Chorus ADR 0110 d3): a detail he has said he steers is *yours*, whatever its kind.
- A gated input (ADR 0008) is never a *gate*: a credential, an irreversible step or a sign-off is *yours*.
- Spend under the standing approval is never asked (Chorus ADR 0108 d4): a fork about spend alone is *priorities*.
- A credential in its repo's declared test-credential class is never asked ahead (ADR 0061): the standing approval signs it at the stop, or asks then.
- A review STOP or a design gap is never his by default: it goes to the agent that can resolve it.
- An open `fork for Lachy` stays *yours* until he rules on it.
- The rollout clone (schedule § 0) is a *technical* call that ADR 0042 keeps a question until p30-10 decides it: until
  then it is asked, in the Framing.

## 2. Decided for you

Every call you make for him is written down, never made silently:

- one plain line per call, with its reason: `Decided for you: <the fork> → <the call> (<owner>: <reason>)`;
- written where he reads it: the task note's `## Decided for you (<date>)` section (`estate-dispatch.py`'s
  `decided-for-you` and `record --owner` write it), an ADR's Decided for him (overturnable) list, or the report that
  ends the turn;
- the less sure calls first, and kept short: a report shows at most eight lines and points at the notes for the rest;
- each stands unless the code shows it wrong, and he can overturn any of them.

## 3. The Framing

A question of his carries five things, in this order:

1. **Plain words**: what the question is about, with no jargon.
2. **The goal**: how the fork ties to the project's goal.
3. **Gains and costs**: what each option gains and costs, in quality, robustness, his time and speed.
4. **The pick**: your recommendation, measured against his priorities (§ 4).
5. **The Note**: end with "What would make this wrong for you?" (or "where do you want to stay involved?"), so he
   can correct a priority, not only pick an option.

## 4. The recommendation

The recommended option comes first, marked as recommended, with its why. A pick that hands work back to him, or
spends less for lower quality, says why his priority does not apply here: he puts quality over cost and his
autonomy over his time, so a recommendation against either carries its reason in the option's own description.

## 5. In a grill

- Ask only *yours*, one question at a time, each in the Framing, with a Note invited.
- Walk every *technical* and *priorities* branch yourself, from the code, the ADRs and CONTEXT.md, and show each in
  the grill as `Decided for you: <fork> → <call> (<owner>: <reason>)`, where he can overturn it.
- End with the full Decided for you list, his overturns applied; an ADR the grill writes ends with its Decided for
  him (overturnable) list.
- A Note that corrects his priorities goes into the project's `## Priorities` card, or the estate brief, the same day.

## 6. Where it applies

- ADR 0054 § Sites lists every ask unit in `skills/` with its Owner and what became of it, and every ask that stands
  there (a `cited` or `listed` row) cites this file in its own paragraph or list item;
  `tests/contracts/question-gate.test.mjs` holds both to the tree.
- A `follow-up` row there is an ask its owner task removes; until it lands, the ask is put in the Framing.
- **Script-built rounds.** `estate-dispatch.py`'s `rounds` and `preflight` build the questions that orient-all § 4
  and schedule § 1.5 pass on verbatim, so their Framing comes from the grade (readiness-grade § Each decision: a
  decision's `goal` and its `stakes`, one line per option). Each kind, against the five points:

| Kind | Plain words | Goal | Gains and costs | Pick | Note |
| --- | --- | --- | --- | --- | --- |
| One call / Grill | the decision's `question` | its `goal` | each option's `stakes` line | recommended first, with its `why` | yes |
| Ungraded | fixed text | none: nobody could read the task | fixed descriptions | `Leave it out`, with its reason | yes |
| Sign-off | its gates, verbatim (ADR 0008) | none | what each answer signs | none: the authorisation is his (ADR 0008) | yes |
| Unpark | the project's why | its why | each answer described | none: parking is his standing call (ADR 0041) | yes |

Sources: Chorus ADR 0110 (ask him only his questions), ADR 0054 (this gate in the plugin) and the estate brief,
`~/.agents/knowledge/how-lachy-decides.md`.
