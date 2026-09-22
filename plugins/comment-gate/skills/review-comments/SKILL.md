---
name: review-comments
description: The review step that decides whether the comment-audit agent runs on a branch. Use before opening a pull request, or when reviewing one, to backstop the write-time comment gate. Computes the diff against the base branch, and if any added line in production TS is a comment, dispatches the comment-audit agent without asking.
argument-hint: "[optional: base branch, default main]"
user-invocable: true
---

# Review comments on a branch

The write-time `comment-gate` hook fails open when its judge is unavailable, so a branch can carry a non-load-bearing comment that nothing has checked. This skill is the gate on the backstop: it decides, from the diff alone, whether the `comment-audit` agent runs. It never asks; a matching gate runs the audit.

## Procedure

1. **Base branch.** Use the argument if given, else `main`. Fetch it: `git fetch origin <base>`.
2. **Changed production TS.** List changed non-spec TypeScript files:

   ```bash
   git diff --name-only origin/<base>...HEAD -- '*.ts' '*.tsx' | grep -v -E '\.(spec|test)\.tsx?$'
   ```

   Call this `CHANGED_TS`. If empty, report "no production TS changed" and stop.
3. **Did the diff add a comment line?** Over `git diff origin/<base>...HEAD -- <CHANGED_TS>`, look at `+` lines only. A comment line is one whose first non-whitespace characters are `//`, `/*`, or `*` inside an open block, or that carries a `//` outside a string literal. If none, report "no comment lines added" and stop.
4. **Dispatch the audit.** Call `Agent(subagent_type: "comment-audit")` with `CHANGED_TS` and `FULL_DIFF` (the full output of step 3's diff). If the agent list shows the agent under this plugin's prefix, use that exact name. **Pass no `model` override**: the agent's frontmatter pins its model, and a call-time override replaces the pin.
5. **Report.** Relay the agent's findings verbatim as a list; the healthy result is "all load-bearing, no findings".

## Rules

- An author-time `/comment <file>` pass does not substitute for the audit. That pass is run by the party that wrote the comments; this one is not.
- The audit is advisory (Notes). It does not block; the write-time gate is the enforcement.

## Gating table

One row today. A project that adds more review-time audits extends this table rather than adding ad-hoc dispatch logic.

| Audit | Runs when |
|---|---|
| `comment-audit` | a changed non-spec `.ts`/`.tsx` whose diff adds a comment line |
