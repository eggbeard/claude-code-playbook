# Why stated rules decay

How a blocking gate keeps model-written comment essays out of production code, and why this shape works where a clearly-stated rule did not.

## The problem it solves

The rule for comments is *load-bearing only* — a comment earns its place only when it carries a why / constraint / footgun / anchor the code cannot, and never when it restates the code, a doc, or the author's own derivation. The rule was stated in the root `CLAUDE.md`, in the `/comment` skill, and in per-session memory, and it was flagged at write time by an advisory `comment-gate` PostToolUse hook. It still failed: a single branch shipped roughly fifty comment lines that failed the delete-test **with the advisory hook flagging every one as it was written**, and removing them took a dedicated sweep and an extra review round.

Clarity was never the deficit. The fix had to be structural, not textual.

## Why a stated rule decays

Five mechanisms erode any static instruction as a session grows — none of them fixable by wording:

1. **Salience decays with distance.** The rule is a few hundred tokens at the top of a context that grows into the hundreds of thousands. It is not deleted, it gets quieter relative to everything nearer.
2. **In-context precedent beats stated rules.** Models imitate before they obey. Whatever style is in the files being read — including the model's *own earlier output in the session* — becomes the strongest signal for "what code looks like here." Once a few comments slip through, each is precedent for the next; drift compounds.
3. **The pull scales; the constraint doesn't.** Training rewards explaining your work, and comment-dense tutorial code dominates training corpora. That pull regenerates at every token and is *strongest right after a hard derivation*, when the reasoning feels most valuable — so the rule loses precisely on the hard-won discoveries (the worst offenders were performance measurements and a server-side key-linking rule).
4. **Judgment rules carry their own exception.** "Load-bearing only" needs a classifier, and the classifier is the same context that just wrote the comment and is maximally convinced of its value. Every judgment rule decays into "what I just wrote is the exception."
5. **Nothing persists across sessions.** Each session restarts from identical weights; corrections update the conversation, not the model. Memory files and `CLAUDE.md` additions are just more instruction text, subject to 1–4 as the session grows.

## Why the advisory hook failed even though it fired every time

The PostToolUse advisory flag was the *newest* thing in context when it fired — it won the recency battle, which is the diagnostic point: the failure was never memory. It failed because of what it landed on:

- **Author-as-judge.** The flag arrived seconds after the model deliberately composed the comment, with the justification still hot in working memory. The verdict was precomputed; the flag was answered by self-consistency, not a fresh evaluation. (Observed during the sweep: five flags on one edit batch answered with a single blanket sentence, not per-comment tests.)
- **Advisory attached to success.** The write had already succeeded when the flag arrived, so acting on it meant reopening finished work — which competes with the pull to continue. An advisory on a success reads as FYI. The missing property was not loudness but *conditionality*.
- **Habituation.** The flag fired on every added comment line, legitimate ones included, so it acquired a false-positive base rate and each dismissal made the next cheaper.
- **The skill was never actually read.** The hook injected one line pointing at `/comment`; the skill body — the delete-test, the keep/cut lists — was never in context at the decision point, and an author defending a fresh commitment has no motive to go fetch the prosecution's brief.

## The test-substitution finding

When the author *does* run the delete-test, it degrades at two points:

- The real question — "would a competent reader, with the repo, mis-edit this code without the comment?" — silently becomes **"is this information true and not already in the code?"**, which every domain fact passes trivially (code never states measurements or server internals). "The code doesn't say this" is true of everything and filters nothing.
- The "competent reader" gets modelled as *the author before their own discovery*, who by construction needs the full derivation — rather than a reader with the repo, grep, git blame, and the domain docs at hand.

The reframing that closes the leak, now the wording in `/comment`: **would a competent reader — with the whole repo and the domain docs available — mis-edit these lines without this comment?** It scopes "need" to editing this code safely and pins the reader model. Sharper wording only makes the honest evaluation more likely, though; the *enforcement* comes from the judge, not the words.

## The design

Two layers behind one PreToolUse `command` hook on `Write|Edit` (`hooks/comment-gate.mjs`):

1. **A cheap, deterministic regex detector — the zero-cost gate.** It scans the *proposed* content for comment lines added to production TS (`apps/**/src`, `libs/**/src`; excluding `*.spec.ts` and test utilities — that carve-out is deliberate). No comment lines added → the hook exits silently and the write proceeds at zero model cost. Only a `command` hook can make this content-conditional; a native LLM-judge hook fires on every matched write and would pay a model call even for comment-free edits.

2. **A fresh-context judge — the escalation.** When comment lines are detected, the hook invokes a headless `claude -p --output-format json --model haiku`, with Write/Edit disabled, given the `/comment` skill as its rulebook, the nearest domain `CLAUDE.md`/`README`, and the proposed file content with the added lines flagged. The judge applies the delete-test to each line and returns a compact verdict JSON. The hook allows the write only if every added line is load-bearing; otherwise it denies with the judge's per-line reasons, and the model must cut or rewrite before it can proceed.

The judge starts with a clean context — no derivation in working memory, no commitment to defend, born fresh per judgment — so it cannot habituate, and the rulebook is finally *read* at the decision point by the party it was written for.

### How each failure mechanism maps to a design choice

| Failure mechanism | Design answer |
|---|---|
| Salience decay | Gate fires at the moment of the write (PreToolUse) — no distance to decay over |
| Author-as-judge / precomputed verdict | A fresh-context judge with no authorship stake, born per judgment |
| Advisory-on-success | A blocking deny — the write fails; rewriting is the only way forward |
| Habituation | Nothing is asked of the author; the judge has no history to habituate against |
| Skill never read | The skill *is* the judge's rulebook, in context at every decision |
| Judgment-carries-exception | The judge applies the mis-edit test with no derivation in working memory |
| Per-write cost | A regex detector escalates only when comment lines are added — a content-conditional a native judge hook can't express |

## Robustness

- **Recursion is structurally impossible.** The judge runs with Write and Edit disabled, so it cannot re-enter the gate (which fires only on Write/Edit); as belt-and-suspenders the hook also sets `CLAUDE_COMMENT_GATE_JUDGE=1` before spawning and no-ops at entry when it sees it.
- **Fail-open on an unavailable judge.** A real "not load-bearing" verdict blocks the write; but a judge that errors or times out (after one retry, with a raised timeout) is *not* a verdict, so the hook fails **open** — the write proceeds. A transient infra failure is not a bad comment, and blocking on it would punish flakiness and erode trust in the gate. The gap this opens (a bad comment can land while the judge is down) is closed at review time by the comment-audit agent (below), so enforcement is defense-in-depth, not a single write-time chokepoint. A one-line stderr breadcrumb records each fail-open.
- **Escape hatch.** `CLAUDE_COMMENT_GATE_OFF=1` disables the gate entirely for emergencies.
- **Cost.** The judge only ever runs when comments are added to production TS; a comment-free write costs nothing.

## Length rule and judge tiers

The judge alone did not stop essays. One branch carried an eleven-line and a six-line `//` stack of individually true "why" sentences; the review-time audit passed both on substance, and the write-time judge, measured against the six-line one, denied it only with its full thinking budget, at 54 to 96 seconds per call against a 60-second first-attempt timeout — so in practice it often timed out and failed open. Capping the judge's thinking made it fast (12 to 15 seconds) and still exact on restatement, but it then kept the essay every time. Which of the nearest docs were in the prompt (both, one, or none) changed no verdict.

So the gate now has three layers:

1. **Length, deterministic, before any model call.** A `//` stack over three lines, or a `/* */` block or run of adjacent full-line comments over six, is denied outright, naming the block. This is the rulebook's *one comment, one fact* rule; it catches the essay class at zero cost. The block is measured as it will stand after the write — an `Edit` is applied to the on-disk file and the comments in its span are read in the context of the whole file, so appending two lines to an open JSDoc is caught although neither added line carries a `/**`. A blank line between `//` paragraphs does not restart the count; a comment trailing code counts alone; a `Write` of an existing file measures only the comments the file did not already hold.
2. **A short tier for what remains under three lines:** the judge runs with `MAX_THINKING_TOKENS=1024` and a 60-second first attempt. Restatement and narration are caught here in about 12 seconds.
3. **A long tier for four-to-six-line blocks:** full thinking and a 120-second first attempt, because this is the one band where an essay survives the length rule and capped thinking measurably lets it through.

The tier is chosen by the longest block the write touches. `judgeTier` and `lengthViolations` in the hook are unit-tested, and the end-to-end tests run the hook against a fake `claude` placed first on `PATH`, which records the environment it was spawned with — so the spec pins that the tier's thinking cap reaches the child, that the length rule fires on the `Edit` path, and that an unavailable judge fails open, with no live model call. The fixtures carry one deterministic essay and one judged six-line narration.

## Detector scope

The detector reads TypeScript only, because `isGatedFile` admits only `.ts` and `.tsx`; the html, yaml and scss branches it once carried had no caller and were removed. Angular templates are a plausible future target and the `<!-- -->` case is lexically trivial, but gating them also means an html block kind for the length rule, a carve-out for `<!-- eslint-disable … -->` directives, and rewording the rulebook, the judge prompt and the audit agent, which all say "production TS". That is its own issue when wanted.

The regex detector tracks string and template-literal state line by line. Its one known blind spot is a `//` or `/*` inside a regex literal, which no gated file in the tree contains today. The upgrade path when one appears is the TypeScript compiler API, not an LSP server: `ts.createSourceFile` plus `getLeadingCommentRanges` / `getTrailingCommentRanges` over the token positions gives exact ranges (regex literals need parser context, so the bare scanner is not enough) at about 130 ms of import per gated write. An LSP server is the wrong layer: a hook is a fresh process per write and LSP has no "list the comments" request.

## A rejected direction (do not re-propose)

An early skill-rewrite draft framed the rule as "truth is not the test; **home** is the test" — facts belong in the domain doc, code gets a pointer. That was rejected: code can be the right home for a comment. The rule is to **not restate** anything — not the code, not a doc, not the author's derivation — and to treat comments as what they are: unverified prose in a deterministic artifact, drifting from the day they are written. The rule is *don't restate / don't narrate*, not *relocate*.

This bit in practice. The first judge build was given the nearest domain docs and told a comment restating them should be cut — and it promptly cut load-bearing footguns and whys that merely *overlapped* a `CLAUDE.md` topic, re-deriving the rejected "home is the test." The fix was to tell the judge that overlap with a doc is **not** grounds to cut: the audiences differ (a doc warns "this kind of problem exists across the domain"; a code comment warns "this specific problem, here"), the editor at the line may not have the doc open, and docs get trimmed for brevity too — so a code-site footgun must not depend on the doc surviving. The calibration fixtures (`hooks/comment-gate.fixtures.mjs`) pin this both ways: measurements / dates / consumer-lists deny; code-site footguns / whys / anchors pass.

## Review-time backstop

Because the write-time gate fails open when the judge is unavailable, the `comment-audit` agent reviews a branch's added comments at review time against the same rule. Write-time blocks the clear cases in the common path; review-time is the defense-in-depth net. See [layer 4](04-review-audit.md).

## Files

- `hooks/comment-gate.mjs` — the detector, length rule, tiered judge, and fail-open logic; `hooks/comment-gate.test.mjs` — unit and end-to-end coverage; `hooks/comment-gate.fixtures.mjs` — the judge calibration eval (run by hand; one model call per fixture).
- `skills/comment/SKILL.md` — the rule; the judge's rulebook.
- `hooks/hooks.json` — registers the hook under `PreToolUse` for `Write|Edit`.
- Root `CLAUDE.md` "Coding style" — a one-line pointer at `/comment`.
