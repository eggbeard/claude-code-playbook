# claude-code-playbook

Patterns for driving Claude Code well, packaged as installable plugins with a written explanation of why each one is shaped the way it is.

Site: https://eggbeard.github.io/claude-code-playbook/

## Plugins

| Plugin | What it does |
|---|---|
| `comment-gate` | Blocks non-load-bearing comments at write time with a fresh-context judge, and backstops it with a review-time audit agent. |

## Install

```
/plugin marketplace add eggbeard/claude-code-playbook
/plugin install comment-gate@claude-code-playbook
```

`comment-gate` gates files matching `apps/**/src` and `libs/**/src`. Change `GATED_PATH` at the top of `plugins/comment-gate/hooks/comment-gate.mjs` for another layout.

Verified against Claude Code 2.1.278: a restating comment in production TS is denied, a footgun comment is allowed, a spec file is not gated.

## Layout

```
.claude-plugin/marketplace.json   the marketplace
plugins/<name>/                   one plugin per folder
docs/                             the site (GitHub Pages, Jekyll)
tools/scrub-check.mjs             CI guard: no identifiers from the workspace this was ported from
                                  (the terms live in the SCRUB_TERMS secret, never in the repo)
```

## Developing

```
node --test 'tools/**/*.test.mjs' 'plugins/**/*.test.mjs'
node tools/scrub-check.mjs
claude plugin validate .
```

The scrub check reads its terms from `SCRUB_TERMS` (comma-separated) or a gitignored `.scrub-terms` file at the repo root, one term per line, and exits 2 when neither is present.

The judge calibration fixtures cost one model call each and run by hand: `node plugins/comment-gate/hooks/comment-gate.fixtures.mjs`.

## Licence

MIT.
