# Layer 3 — the write-time gate

A stated rule is read once and forgotten. The gate is a PreToolUse hook on `Write` and `Edit` that runs at the moment of the write and can refuse it. The hook is `hooks/comment-gate.mjs` in the plugin; this page explains its three layers.

## 1. A free detector

The hook reads the tool input, works out which comment lines the write *adds* (for an Edit, the on-disk file with the edit applied, minus the comments the replaced span already had), and checks whether the file is production TypeScript. If nothing was added, or the file is out of scope, the hook exits silently. No model call, no cost. Only a command hook can be content-conditional like this; a native model-judge hook would pay for every matched write.

The scope is one constant:

```js
const GATED_PATH = /(?:^|\/)(?:apps|libs)\/.+?\/src\/.*\.tsx?$/;
```

Specs, test utilities, and mocks are excluded. Change that line for a single-package repo.

## 2. A length rule, before any judge

A `//` stack over three lines, or a block or run of adjacent comment lines over six, is denied outright, naming the block. The block is measured as it will stand after the write, so appending two lines to an existing JSDoc is caught too. This catches the essay class at zero cost, and it exists because the judge alone did not: given a six-line stack of individually true "why" sentences, the judge kept it, or timed out trying to decide.

## 3. A fresh-context judge

What remains goes to `claude -p`, headless, on a small fast model, with `Write` and `Edit` disabled. The judge receives the `/comment` skill as its rulebook, the nearest `CLAUDE.md` and `README.md` above the file, the proposed file content, and the flagged lines. It returns one JSON verdict per line. The hook denies unless every added line is load-bearing, and the deny message carries the judge's per-line reasons so the author can rewrite and retry.

The judge is tiered: short comments get a capped thinking budget and a 60-second timeout; four-to-six-line blocks get full thinking and 120 seconds, because that band is where an essay survives the length rule and capped thinking lets it through.

## Fail open

A judge that errors or times out (after one retry) is not a verdict. The hook lets the write through and logs one line to stderr. Blocking a developer on infrastructure flakiness would erode trust in the gate faster than any bad comment. The gap this opens is closed by [layer 4](04-review-audit.md).

`CLAUDE_COMMENT_GATE_OFF=1` disables the gate entirely. The judge sets `CLAUDE_COMMENT_GATE_JUDGE=1` so its own nested session never re-enters the hook.

## Wiring it by hand

If you copy the file instead of installing the plugin, register it in `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/comment-gate.mjs\"" }
        ]
      }
    ]
  }
}
```

and put the skill at `.claude/skills/comment/SKILL.md` so the hook's relative rulebook path resolves.
