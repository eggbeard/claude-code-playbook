# Layer 4 — the review-time audit

The gate fails open on purpose. A review-time pass closes the gap.

## The agent

`comment-audit` is a read-only subagent with the `/comment` skill preloaded. Given the changed production TS files and the branch diff, it scopes itself with the same predicate the hook uses, isolates the comment lines the branch *added*, reads the surrounding source, and runs the delete-test on each. It also re-checks length and, for kept declaration comments over three lines, nudges toward JSDoc form. Every finding is a Note: it is a backstop, not the enforcement.

The healthy result is "all load-bearing, no findings". The agent is told so, and told that a false finding here costs the same trust the fail-open protects.

Its model is pinned by id in the agent's frontmatter, not chosen at dispatch. A `model` override on the call would silently replace the pin; the skill that dispatches it passes none.

## The gate on the backstop

`review-comments` (invoked as `/comment-gate:review-comments`) is the skill that decides whether the agent runs. It diffs the branch against the base branch, looks at added lines in non-spec TypeScript, and dispatches the agent if any is a comment. It never asks. Two rules make it worth having:

- An author's own `/comment` pass does not substitute. Same party, same blind spot.
- A gate that matches runs; a gate that does not match does not run. No "want me to?".

The skill carries a one-row gating table. In a larger review workflow the same table grows a row per audit, and each row is a grep over the diff, so the decision is mechanical and the reviewer never has to remember which audits exist.
