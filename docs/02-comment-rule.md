# Layer 2 — the comment rule

The plugin ships one skill, `/comment`, and everything else reads it. The rule fits in a sentence: a comment earns its place only when it carries a why, a constraint, a footgun, or an anchor that the code cannot, and never when it restates the code, a doc, or the author's own derivation.

## The delete-test

> Delete the comment. Would a competent reader, with the whole repo, grep, git blame, and the domain docs at hand, **mis-edit** this code without it?

Yes: keep it. No: it was not load-bearing.

The word that matters is *mis-edit*. The test people actually run on their own writing is "is this true and not already in the code?", and every domain fact passes that: code never states a measurement or a server's internals. "The code doesn't say this" is true of everything and filters nothing. The reader is also not you-before-your-discovery; they have the repo and the docs. Scope "need" to editing this code safely.

## Two things people get wrong

- **Overlap with a doc is not grounds to cut.** A doc says "this kind of thing exists across the domain"; a code comment says "this specific thing, here". The editor at the line may not have the doc open. Cut a comment for redundancy only when it adds nothing a reader at this line needs.
- **Length is its own rule.** A `//` stack over three lines, or a block over six, is an essay however true each line is. One comment, one fact. The gate enforces this mechanically before any judge runs.

## The exception

A brief JSDoc on an **exported** symbol is load-bearing when it helps a consumer who sees it as a hover tooltip from another file. It is optional. A JSDoc that restates the signature still gets cut.

## Running it by hand

`/comment-gate:comment path/to/file.ts` (the plugin prefixes its skill names) runs a cleanup pass: every comment gets the delete-test, failures are cut, code is untouched, and you get a one-line report. The full rule, keep and cut lists, worked examples, and the rationalization traps are in the skill file itself: [`plugins/comment-gate/skills/comment/SKILL.md`](https://github.com/eggbeard/claude-code-playbook/blob/main/plugins/comment-gate/skills/comment/SKILL.md).
