# claude-code-playbook

Claude writes comments the way tutorials do: it explains its work, restates the code, and records every number it measured. A stated rule against that decays as a session grows. This playbook shows a four-layer answer that holds.

1. **Output style** — set `outputStyle` to `Concise` so the assistant leads with results and stops narrating. [Read](01-output-style.md)
2. **The comment rule** — one skill, one test: would the next editor mis-edit this code without the comment? [Read](02-comment-rule.md)
3. **The write-time gate** — a PreToolUse hook that detects added comments for free, denies essays by length, and sends the rest to a fresh-context judge. [Read](03-comment-gate.md)
4. **The review-time audit** — an agent that re-checks a branch's added comments, because the gate fails open when the judge is down. [Read](04-review-audit.md)

The reasoning behind the shape: [Why stated rules decay](why-stated-rules-decay.md). A one-page visual walkthrough of the gate: [The Comment Gate, explained](comment-gate-explained.html).

## Install

```
/plugin marketplace add eggbeard/claude-code-playbook
/plugin install comment-gate@claude-code-playbook
```

Then change one constant, `GATED_PATH` in `hooks/comment-gate.mjs`, if your source tree is not `apps/` and `libs/`.
