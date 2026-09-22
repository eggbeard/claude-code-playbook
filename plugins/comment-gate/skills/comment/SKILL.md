---
name: comment
description: The rule for code comments — load-bearing only, plus the delete-test for deciding keep vs cut. Invoke to run an on-demand cleanup pass over a named file (e.g. "/comment src/foo/bar.ts"), or to settle whether a specific comment earns its place. The comment-gate PreToolUse hook reads this skill as the rulebook for the fresh-context judge that rules on comments added to production TS; this skill is that rule.
argument-hint: "[optional: a file path to run a cleanup pass over, e.g. src/foo/bar.ts]"
user-invocable: true
---

# Comments: load-bearing only

The default is **no comment**. Code should explain itself through names and structure. A comment earns its place only when it carries information the code genuinely cannot — and then it explains **why**, never **what**.

This file is the single source of truth for the rule. The write-time `comment-gate` hook and the review-time `comment-audit` agent both read it, so an edit here reaches both mechanisms.

> **Maintainer note — four deliberate points, synced by hand.** The write-time judge prompt in [`hooks/comment-gate.mjs`](../../hooks/comment-gate.mjs) and the review-time agent [`agents/comment-audit.md`](../../agents/comment-audit.md) each *re-emphasise* four points inline, on top of reading this file: the delete-test's **mis-edit formulation**, the **"overlap with a domain doc is NOT grounds to cut"** (relocate) stance, the **public-API JSDoc / tooltip exception**, and the **JSDoc-form preference for a kept, sizable declaration comment** (below) — which the judge must treat as *never a reason to cut*. The duplication is intentional — the judge demonstrably mis-cut with the full rulebook alone. **If you change any of those four points here, update those two inline copies too**, or the judge and the audit get a mixed signal. Every *other* edit (keep/cut lists, traps, examples, the delete-test's scope) propagates automatically, since both read this file live.

The rule is *don't restate and don't narrate* — **not** *relocate*. A comment may rightly live in the code; the test is never *where the fact belongs* but *whether the comment restates* the code, a doc, or your own derivation. Keep a load-bearing why where the reader meets it; cut a restatement even when it is technically true and in the code.

## The delete-test

For any comment — one you're about to write, one the gate flagged, or one you're reviewing:

> **Delete the comment. Would a competent reader — with the whole repo, grep, git blame, and the domain docs at hand — MIS-EDIT this code without it?**
> - **No** → the comment was not load-bearing. Leave it deleted.
> - **Yes** → deleting it lets the next editor break something the code cannot warn them about. Keep it.

The test is *mis-edit*, not *absent-from-code* — and it degrades two ways when you run it on your own writing:

- **"Is this true and not already in the code?"** is the wrong question — every domain fact passes it (code never states measurements or server internals), so it filters nothing.
- **The reader is not you-before-your-discovery**, who needs the whole derivation. The reader has the repo, grep, and the domain docs. Scope "need" to *editing this code safely*, not to re-deriving how you got here.

Run it honestly. "It's nice to have" fails. The bar is *the next editor mis-edits without it*.

### One reader exception — the consumer at a distance

The mis-edit test scopes the reader to *editing this code*. **Public API surface has a second legitimate reader**: the consumer who *references* an exported symbol from another file — and, in VSCode, reads its **hover tooltip** without ever opening the source. For an **exported / public** class, interface, type, method, or function, a brief JSDoc (`/** … */`) that helps that consumer understand *what the thing is* or use it correctly is load-bearing even though the editor at the definition would not mis-edit without it. This is the one sanctioned "what," and the one place "helps a reader elsewhere" counts.

It is **optional, never required** — we do not mandate doc coverage the way some projects do. Add it only where a consumer is genuinely helped (a "what is this" line on a model/interface; a note on an API-service method about anything unusual in the endpoint), keep it brief, and keep it to the *what-it-is / why*, not a restatement of the signature the tooltip already renders. At an ordinary in-body code site this exception does not apply — the mis-edit test governs there.

### Form: sizable declaration comments use JSDoc

When a comment that has **already earned its place** describes a whole declaration — a function, class, method, interface, or type — and runs to **more than three lines**, write it as a JSDoc block (`/** … */`), not a `//` stack or a plain `/* … */`. Only `/**` renders as the editor's hover tooltip, so a sizable comment that has earned its keep gains visibility for free, where a reader meets the symbol.

This is a **form preference, not a keep/cut rule**. It never decides whether a comment stays, and being in the wrong form is **never** grounds to cut a load-bearing comment — it applies only *after* the delete-test passes. A one-to-three-line leading comment, and any in-body comment describing a single line or block, keep `//`. Delimiter only: prefer the `/** */` form for the tooltip; we do **not** mandate `@param` / `@returns` tags — that would push toward the doc-coverage mandate we deliberately avoid.

### Length: one comment, one fact

A comment states the one fact the next editor would mis-edit without. **A `//` stack over three lines, or a `/* */` / `/** */` block over six, is an essay** — however true each sentence is, and however many of them individually pass the delete-test. Cut it to the fact. If several distinct facts genuinely belong at one declaration, they fit in a six-line JSDoc; if they do not, most of them belong in the commit message or the domain doc.

How the lines are counted: a blank line between two `//` comments does not end the stack (a paragraph break is still the same essay), a `//` stack that runs straight into a `/* */` block is one run of comment lines and the six-line cap applies to the run, and a comment trailing code on its own line counts alone — ten annotated array entries are ten one-line comments, not a stack. An edit that grows an existing block is measured against the whole block, not the lines it adds.

The write-time gate enforces this **mechanically, before the judge runs**: an over-long added comment is denied with no model call, and the message names the block. The review-time audit treats the same overrun as a Warning. The delete-test still governs everything under the limit.

## Keep (load-bearing)

- **Why, not what** — a rationale a reader cannot infer from the code: why this approach over the obvious one, why this order matters, why a value is what it is.
- **A non-obvious constraint or workaround** — paired with its reason (e.g. "the device WebView is Chrome 90, so no ES2022"). A workaround with no stated reason is just noise; the reason is the load.
- **A footgun warning** — something the next editor would otherwise break (e.g. "these two must move in lockstep").
- **An anchor** — a reference to the issue / spec / external source that explains code whose motivation lives outside the file (e.g. `catalogue#620`).
- **A consumer-facing API doc (the hover tooltip)** — a brief JSDoc on an **exported / public** class, interface, type, method, or function that helps a consumer at a *reference site* grasp the thing without opening its source (see *the consumer at a distance*, above). Optional, never required.

A load-bearing comment stays **even when a domain `CLAUDE.md`/`README` covers the same topic**. The audiences differ — a doc says *"this kind of thing exists across the domain"*, a code comment says *"this specific thing, here"* — the editor at the line may not have the doc open, and docs get trimmed for brevity too. Do not cut a code-site footgun/why because "it's in the doc": that is the *relocate* fallacy, and if both ends get trimmed the fact is lost from both.

## Cut (not load-bearing)

- **Restates the code** — `// increment the counter` over `counter++`; `// map to ids` over `.map(rep => rep.id)`.
- **Narrates the steps** — `// first map, then filter`. The code already shows the sequence.
- **Tutorial asides** — explaining the language, a general API, or a pattern to the reader. (Distinct from a brief consumer-facing JSDoc describing *what this specific exported thing is* — that is Keep, above.)
- **Section banners / decorative dividers**, and changelog narration (`// changed to fix the bug`) — that belongs in the commit message.
- **Commented-out code** — delete it; git remembers.

## Rationalization traps (the recurring offenders)

These feel valuable at the moment of writing — especially right after a hard derivation — and pass the wrong "is it true?" test while failing the mis-edit test. Cut them:

- **Measurements, dates, percentages** — `~33ms/row`, `0.4s for 959 rows`, `measured 2026-07-08`, `~23% of live rows`. A number inline is stale the day after and the next editor cannot act on it. If it justified a decision, the decision is in the code; the number belongs in the commit or the domain doc.
- **Copying doc prose** — pasting a domain `CLAUDE.md`/`README` paragraph verbatim, or re-narrating its general guidance with no code-site-specific point. (Overlap alone is fine — a footgun/why pinned to *this* line is load-bearing even when the doc discusses the topic; see Keep. What fails is a verbatim copy that adds nothing here.)
- **Consumer lists** — "used by the detail page and the list column". grep is the source of truth and never goes stale; a hand-maintained list does.
- **Design-decision narration** — "changed to X to fix the bug" is the commit message; "first map, then filter" is the code.

## Worked examples

```ts
// ✗ Cut — restates the code
// loop over the books and collect their ids
const ids = books.map(book => book.id);

// ✓ Keep — why this code exists at all; the reason is outside the file
// Target ES2019: the terminal's WebView is Chrome 90 and predates ES2022 (catalogue#619).
target: 'es2019',

// ✗ Cut — narrates an obvious step
// set inBlock to false once we see the closing marker
if (raw.includes('*/')) inBlock = false;

// ✓ Keep — a constraint the next editor would otherwise miss
// versionCode and versionName must move in lockstep with package.json (the release script asserts it).

// ✓ Keep — consumer-facing JSDoc; lands as a hover tooltip at every reference site (optional)
/** A catalogue entry as returned by /api/books — identity only; loan history loads separately. */
export interface Book { /* … */ }

// ✓ Form — a kept 4-line "why" leading a function belongs in a /** */ block (tooltip),
//   not a // stack (no tooltip). Same text, JSDoc delimiter:
/**
 * Resolve the member id from the scan payload, falling back to the mag-stripe track
 * when the barcode is absent — the two encodings disagree on check digits, so we
 * normalise here rather than at every call site (catalogue#712).
 */
function resolveMemberId(scan: Scan): MemberId { /* … */ }
```

## On-demand cleanup pass — `/comment <file>`

When invoked with a file path, run a standalone pass:

1. **Read** the file.
2. For **every** comment, run the delete-test.
3. **Cut** the ones that fail; **keep** the load-bearing ones untouched.
4. Touch **comments only** — never change code logic, behavior, or formatting in this pass.
5. **Report briefly**: how many cut, how many kept, and one line on any judgement call (a comment you kept that looked borderline, or cut that someone might miss).

If invoked with no argument, treat the current diff or the file under discussion as the target, or just re-state the rule for the work in front of you.
