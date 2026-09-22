# claude-code-playbook — repo bootstrap and the comment-gate plugin

Design for a public GitHub repo (`eggbeard/claude-code-playbook`) that shares how to drive Claude Code well, starting with one worked scenario: keeping model-written comments out of production code. The repo is a Claude Code plugin marketplace plus a GitHub Pages commentary. It contains no code from the source workspace.

## Goal

A developer at another company can:

1. read a short set of pages explaining the problem (verbose model-written comments) and the four-layer answer (output style, comment rule, write-time gate, review-time audit), and
2. install the enforcement as a plugin with two commands, and
3. adapt the one path rule that is project-shaped.

## Non-goals

- Porting the source workspace's GitLab, Nx, or review-report tooling. Only the one transferable idea from the review skill is carried: "diff added a comment line → dispatch the comment audit".
- Any settings-driven configuration of the hook. The gated-path rule is a constant.
- Versioned releases. The marketplace points at `main`.

## Layout

```
claude-code-playbook/
  README.md                          what this is, install commands, page index
  LICENSE                            MIT
  .gitignore                         node_modules only; docs/superpowers/ specs and plans are committed, and _config.yml keeps them off the site
  .claude-plugin/marketplace.json    name: claude-code-playbook; plugins: [comment-gate]
  .github/workflows/ci.yml           node --test + scrub check on push and PR
  tools/scrub-check.mjs              denylist grep over the tree; exits 1 on a hit
  plugins/comment-gate/
    .claude-plugin/plugin.json       name, description, version, license, author
    hooks/hooks.json                 PreToolUse matcher Write|Edit → node ${CLAUDE_PLUGIN_ROOT}/hooks/comment-gate.mjs
    hooks/comment-gate.mjs
    hooks/comment-gate.test.mjs
    hooks/comment-gate.fixtures.mjs
    skills/comment/SKILL.md
    skills/review-comments/SKILL.md
    agents/comment-audit.md
  docs/                              GitHub Pages: main branch, /docs folder, Jekyll default theme
    _config.yml                      title, theme
    index.md
    01-output-style.md
    02-comment-rule.md
    03-comment-gate.md
    04-review-audit.md
    why-stated-rules-decay.md
    comment-gate-explained.html
```

Marketplace and plugin manifests follow the documented schema: only `plugin.json` sits inside `.claude-plugin/`; `hooks/`, `skills/`, `agents/` sit at the plugin root; the marketplace entry uses `"source": "./plugins/comment-gate"`.

## The plugin, file by file

### hooks/comment-gate.mjs

Ported from the source hook with these changes:

- `isGatedFile` becomes a `GATED_PATH` regex constant at the top of the file, with the spec and test-utility exclusions kept as two further constants. A single comment above them says this is the one line a non-Nx project changes. Default remains `(apps|libs)/**/src/**/*.ts(x)` minus `*.spec|test.ts(x)`, `/test-`, `/testing/`, `.mock.`.
- The rulebook path resolves to `../skills/comment/SKILL.md` relative to the hook, as now. This works because the plugin ships both.
- `nearestDocs` walks up from the target file to the **project root** (`CLAUDE_PROJECT_DIR`, falling back to `process.cwd()`), not to the hook's own repo root, because the hook now lives outside the project.
- Issue-number anchors and the reference to the source design doc are removed from comments. The retained comments are the load-bearing ones: the fail-open rationale, the recursion guard, the string-blanking reason, the tier rationale.
- Environment variables keep their names (`CLAUDE_COMMENT_GATE_OFF`, `CLAUDE_COMMENT_GATE_JUDGE`).
- The judge invocation is unchanged: `claude -p --output-format json --model haiku --disallowedTools Write Edit`, two attempts, fail open.

### hooks/comment-gate.test.mjs

Ported. The one source-workspace path in `isGatedFile` tests is replaced with a neutral one. Tests cover the detector for the three comment languages, the string-blanking, the scope predicate, the length rule, the tier choice, the deny shape, and `parseVerdict`.

### hooks/comment-gate.fixtures.mjs

Rewritten from scratch. Same shape (an array of `{ name, expect, file, content }`, one judge run each, run explicitly, never under `node --test`) but every fixture is invented around a library-catalogue domain (a `catalogue` data-access library with `books.api.service.ts`, `books.selectors.ts`, a `loan-form.component.ts`). The pairs teach the same lessons as the originals: a measurement comment denies; a consumer list denies; a percentage denies; a why-plus-anchor passes; a footgun passes; a public-API JSDoc passes; a signature-restating JSDoc denies.

### skills/comment/SKILL.md

The rule text ports intact: the delete-test, the consumer-at-a-distance exception, the JSDoc-form preference, the length rule, keep/cut lists, rationalization traps, the on-demand cleanup pass. Changes:

- The maintainer note keeps its point (four reinforcement strings are duplicated in the hook prompt and the agent, sync by hand) with relative links into the plugin.
- Worked examples are rewritten on the catalogue domain. The Chrome-90 example becomes a generic "target ES2019 because a fixed WebView on the device predates ES2022" with an invented issue reference of the form `catalogue#12`.
- The issue number in the frontmatter description is removed.

### skills/review-comments/SKILL.md

New, small. Purpose: the author's or reviewer's step that decides whether the audit runs. Procedure: compute the diff against the base branch; grep the added lines of non-spec `.ts` for comment markers; if any, dispatch `Agent(subagent_type: "comment-audit")` with `CHANGED_TS` and `FULL_DIFF`; never ask whether to run it and never let an author-time `/comment` pass substitute for it. It states the model-pinning rule: do not pass a `model` override, the agent frontmatter pins the model. It carries a one-row gating table so a reader sees how further audits would be added.

### agents/comment-audit.md

Ported. Changes: "origin/develop" becomes "the base branch (the skill passes it)"; the `docs/review-criteria.md` sentence is dropped, severity is stated as always Note; the report-relative link format is simplified to `path:line`; the `skills: [comment]` frontmatter preload stays. The model pin stays an explicit id (`claude-opus-5`) with the note that aliases are session-relative.

## The pages

Written fresh, drawing on the source design doc but not copying company detail.

| Page | Content |
|---|---|
| `index.md` | The problem in three sentences. The four layers as a diagram-free list with one line each. Install commands. Link to each page. |
| `01-output-style.md` | What `outputStyle: "Concise"` does. The three settings files and their precedence (local project, project, user). `/output-style` writes to the local file; moving the line into `.claude/settings.json` is how one developer's preference becomes a team default. A short before/after of the same answer in Default and Concise. |
| `02-comment-rule.md` | The delete-test and why "true and not in the code" is the wrong test. Links to the skill. When to run `/comment <file>` by hand. |
| `03-comment-gate.md` | How the hook works: the zero-cost regex detector, the mechanical length rule, the tiered fresh-context judge, fail-open. Why PreToolUse deny rather than PostToolUse advice. Why a command hook rather than a native judge hook. The one constant to change. The `hooks.json` wiring shown raw for a reader who copies by hand instead of installing. |
| `04-review-audit.md` | Why a write-time gate that fails open needs a review-time backstop. The agent, its scope predicate (the same one as the hook), and how a review skill gates it on the diff. |
| `why-stated-rules-decay.md` | The essay: the five mechanisms that erode a stated rule, why the advisory hook failed although it fired every time, the test-substitution finding, and the mechanism-to-design-choice table. Company references become "a single branch shipped roughly fifty comment lines that failed the delete-test with the advisory hook flagging every one". |
| `comment-gate-explained.html` | The standalone explainer, copied with its two company references rewritten. |

Pages configuration: `_config.yml` with `title: claude-code-playbook`, `theme: jekyll-theme-minimal` (a built-in GitHub Pages theme, no Gemfile). Pages source set to `main` / `docs` via `gh api`.

## Scrub rule

Nothing leaves the source workspace by copy without a pass for identifiers. `tools/scrub-check.mjs` greps every tracked file (case-insensitive, whole word) for a denylist of terms on every CI run; any hit fails the job and prints the path and line. **The terms are never committed**, because a committed list would itself advertise every phrase it protects: CI reads them from the `SCRUB_TERMS` repository secret, and a local run reads the gitignored `.scrub-terms` file. The script exits non-zero when neither is present, so a missing secret cannot pass vacuously. The owner holds the list; it covers the company and product short names, the internal host name, domain-library names from the ported files, the source repo name, and the developer's work login.

Manual pass before the first commit, on top of the script: read every ported file end to end. Fixtures are not scrubbed; they are rewritten.

## Testing and verification

- `node --test plugins/comment-gate/hooks/` passes locally and in CI.
- `node tools/scrub-check.mjs` passes locally and in CI.
- `claude plugin validate .` passes at the repo root.
- Install from the local path into a throwaway project (`/plugin marketplace add <local clone path>`, `/plugin install comment-gate@claude-code-playbook`) and prove: an Edit adding `// increment the counter` above `counter++` in `libs/x/src/a.ts` is denied; an Edit adding a footgun comment is allowed; an Edit to `libs/x/src/a.spec.ts` is not gated. Record the three outcomes in the README's "verified against" line with the Claude Code version.
- The fixtures run once by hand; every fixture's outcome matches its `expect`.

## Sequence

1. Local repo (exists, empty). Write manifests, port and scrub the plugin, write the pages, CI, scrub tool.
2. Run tests, scrub check, plugin validate, the throwaway-project install.
3. Owner reviews the scrub denylist and the ported files.
4. Create the GitHub repo **private** with `gh repo create`, push `main`.
5. Owner reviews on GitHub.
6. Flip to public, enable Pages (`main`, `/docs`), confirm the site renders.

Nothing is public before step 6.

## Resolved decisions

- Plugin layout from day one; the repo is a marketplace so later plugins are additive.
- Gated-path rule is a constant, not a setting.
- Name `claude-code-playbook`, MIT, public after review, Pages from `docs/` on `main`.
- The output-style layer is documentation only; it is not shipped as plugin content.
