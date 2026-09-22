# claude-code-playbook bootstrap and comment-gate plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the public `claude-code-playbook` repo as a Claude Code plugin marketplace whose first plugin, `comment-gate`, ships the write-time comment hook, the `/comment` rule, the review-time audit agent, and a review skill that gates the audit, with a GitHub Pages commentary explaining the four layers.

**Architecture:** The repo root is a marketplace (`.claude-plugin/marketplace.json`) pointing at `plugins/comment-gate/`, a self-contained plugin (hook, skills, agent). `docs/` is a Jekyll site served by GitHub Pages. A denylist scrub script runs in CI so nothing from the source workspace can land by accident. Ported files are copied from the source workspace and edited in place; fixtures and pages are written fresh.

**Tech Stack:** Node 20+ (ES modules, `node:test`), Claude Code plugin manifests, GitHub Pages with a built-in Jekyll theme, GitHub Actions, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-09-21-comment-gate-plugin-design.md`

## Global Constraints

- The repo contains **no code from the source workspace**. Ported tooling files are allowed after a scrub; source-workspace fixtures are never copied, they are rewritten.
- `$SOURCE` below is the absolute path of the source workspace on the executor's machine. It is set in the shell for the session and **never written into any committed file** (this plan included).
- The scrub denylist (Task 2) must pass on every commit. Run `node tools/scrub-check.mjs` before each commit from Task 2 onward.
- Comments in shipped code are load-bearing only, judged by the `/comment` rule the plugin itself ships.
- Node ESM throughout (`.mjs`); no dependencies, no `package.json` needed.
- Nothing is pushed to GitHub before Task 11, and the repo stays private until the owner flips it in Task 12.
- Commit messages: conventional prefix (`chore:`, `feat:`, `docs:`, `test:`), end with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Repo scaffold and plugin manifests

**Files:**
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `README.md` (stub, finished in Task 10)
- Create: `.claude-plugin/marketplace.json`
- Create: `plugins/comment-gate/.claude-plugin/plugin.json`
- Create: `plugins/comment-gate/hooks/hooks.json`

**Interfaces:**
- Produces: marketplace name `claude-code-playbook`, plugin name `comment-gate`, hook command `node "${CLAUDE_PLUGIN_ROOT}/hooks/comment-gate.mjs"` (the file Task 3 creates).

- [ ] **Step 1: Write `.gitignore`**

```
node_modules/
.DS_Store
```

- [ ] **Step 2: Write `LICENSE`** (MIT, current year, owner name)

```
MIT License

Copyright (c) 2026 Michael Hodgson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 3: Write the README stub**

```markdown
# claude-code-playbook

Patterns for driving Claude Code well, packaged as installable plugins with a written explanation of why each one is shaped the way it is.

Work in progress. The first plugin, `comment-gate`, keeps model-written comments out of production code.
```

- [ ] **Step 4: Write `.claude-plugin/marketplace.json`**

```json
{
  "name": "claude-code-playbook",
  "description": "Patterns for driving Claude Code well: hooks, skills and agents with the reasoning behind them.",
  "owner": {
    "name": "Michael Hodgson",
    "url": "https://github.com/eggbeard"
  },
  "plugins": [
    {
      "name": "comment-gate",
      "source": "./plugins/comment-gate",
      "description": "Blocks non-load-bearing comments at write time with a fresh-context judge, and backstops it with a review-time audit agent.",
      "license": "MIT",
      "keywords": ["comments", "hooks", "code-quality"]
    }
  ]
}
```

- [ ] **Step 5: Write `plugins/comment-gate/.claude-plugin/plugin.json`**

```json
{
  "name": "comment-gate",
  "description": "Blocks non-load-bearing comments at write time with a fresh-context judge, and backstops it with a review-time audit agent.",
  "version": "0.1.0",
  "license": "MIT",
  "author": {
    "name": "Michael Hodgson",
    "url": "https://github.com/eggbeard"
  },
  "homepage": "https://eggbeard.github.io/claude-code-playbook/",
  "repository": "https://github.com/eggbeard/claude-code-playbook",
  "keywords": ["comments", "hooks", "code-quality"]
}
```

- [ ] **Step 6: Write `plugins/comment-gate/hooks/hooks.json`**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/comment-gate.mjs\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 7: Validate the manifests**

Run: `claude plugin validate <repo>` (the local clone path)
Expected: reports the marketplace and the `comment-gate` plugin as valid. (The hook script does not exist yet; if validation complains about the missing file, note it and re-run after Task 3.)

- [ ] **Step 8: Commit**

```bash
git add .gitignore LICENSE README.md .claude-plugin plugins/comment-gate/.claude-plugin plugins/comment-gate/hooks/hooks.json
git commit -m "chore: scaffold the marketplace and the comment-gate plugin manifests"
```

---

### Task 2: Scrub check and CI

**Files:**
- Create: `tools/scrub-check.mjs`
- Create: `tools/scrub-check.test.mjs`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `node tools/scrub-check.mjs` exits 0 when clean, 1 on any hit, printing `path:line: term`. Exports `findHits(text, terms)` returning `[{ line, term }]` for the test.

- [ ] **Step 1: Write the failing test `tools/scrub-check.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHits } from './scrub-check.mjs';

test('matches a term as a whole word, case-insensitive', () => {
  const hits = findHits('The ACME app\nnothing here\nwidgetco-workspace path', ['acme', 'widgetco']);
  assert.deepEqual(hits, [
    { line: 1, term: 'acme' },
    { line: 3, term: 'widgetco' },
  ]);
});

test('does not match a term inside a longer word', () => {
  assert.deepEqual(findHits('an example of sampling', ['amp']), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/scrub-check.test.mjs`
Expected: FAIL, cannot find module `./scrub-check.mjs`.

- [ ] **Step 3: Write `tools/scrub-check.mjs`**

The denylist is the set of identifiers that appeared in the files being ported plus the source organisation's short names, the executor's local username, and the device and domain names from the ported examples. **It is never committed**: a committed list advertises every phrase it protects. The script reads `SCRUB_TERMS` (comma-separated, set as a repository secret for CI) or the gitignored `.scrub-terms` file (one term per line) and exits 2 when neither is present. The owner supplies the terms in chat at execution time; write them to `.scrub-terms` and set the secret with `gh secret set SCRUB_TERMS`.

```js
#!/usr/bin/env node
// Fails CI when any file names the source workspace this content was ported from.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TERMS_FILE = '.scrub-terms';

export function parseTerms(text) {
  return text
    .split(/[\n,]/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term && !term.startsWith('#'));
}

export function loadTerms(env = process.env, root = repoRoot) {
  if (env.SCRUB_TERMS) return parseTerms(env.SCRUB_TERMS);
  const file = join(root, TERMS_FILE);
  return existsSync(file) ? parseTerms(readFileSync(file, 'utf8')) : [];
}

export function findHits(text, terms) {
  const patterns = terms.map((term) => ({ term, regex: new RegExp(`\\b${term}\\b`, 'i') }));
  const hits = [];
  text.split('\n').forEach((line, index) => {
    for (const { term, regex } of patterns) {
      if (regex.test(line)) hits.push({ line: index + 1, term });
    }
  });
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  let failed = false;
  for (const file of files) {
    if (file === 'tools/scrub-check.mjs' || file === 'tools/scrub-check.test.mjs') continue;
    const hits = findHits(readFileSync(file, 'utf8'), TERMS);
    for (const hit of hits) {
      failed = true;
      console.log(`${file}:${hit.line}: ${hit.term}`);
    }
  }
  if (failed) {
    console.error('scrub-check: source-workspace identifiers found; rewrite the lines above.');
    process.exit(1);
  }
  console.log('scrub-check: clean');
}
```

Note: the executor's local username is one of the terms, so no committed file carries a local absolute path. The scrub covers the spec and plan too; they name the source only as "the source workspace" and describe ported text by position, never by quoting it. Add `.scrub-terms` to `.gitignore`, and in `ci.yml` pass `SCRUB_TERMS: ${{ secrets.SCRUB_TERMS }}` as `env` on the scrub step.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tools/scrub-check.test.mjs`
Expected: 2 passing.

- [ ] **Step 5: Write `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: node --test 'tools/**/*.test.mjs' 'plugins/**/*.test.mjs'
      - run: node tools/scrub-check.mjs
```

- [ ] **Step 6: Run the scrub over the tree (the spec and plan are tracked from this commit on)**

Run: `git add -A` then `node tools/scrub-check.mjs`
Expected: `scrub-check: clean`. If the spec or plan hits, rewrite the offending line (the spec and plan must describe the source only as "the source workspace").

- [ ] **Step 7: Commit**

```bash
git add tools .github docs/superpowers
git commit -m "chore: add the scrub check, CI, and the design spec and plan"
```

---

### Task 3: Port the hook and its unit tests

**Files:**
- Create: `plugins/comment-gate/hooks/comment-gate.mjs` (copied from `$SOURCE/.claude/hooks/comment-gate.mjs`, then edited)
- Create: `plugins/comment-gate/hooks/comment-gate.test.mjs` (copied from `$SOURCE/.claude/hooks/comment-gate.test.mjs`, then edited)

**Interfaces:**
- Consumes: `hooks.json` command from Task 1.
- Produces: exported `detectComments`, `addedComments`, `isGatedFile`, `decidePre`, `parseVerdict`, `commentBlocks`, `lengthViolations`, `lengthDeny`, `judgeTier`, `runJudge`, `denyFromVerdict` (unchanged names). The end-to-end tests place a fake `claude` first on `PATH` in a temp sandbox, so `node --test` makes no live model call. Rulebook path `../skills/comment/SKILL.md` relative to the hook (Task 5 creates it). Env vars `CLAUDE_COMMENT_GATE_OFF`, `CLAUDE_COMMENT_GATE_JUDGE`.

- [ ] **Step 1: Copy both files**

```bash
cp "$SOURCE/.claude/hooks/comment-gate.mjs" plugins/comment-gate/hooks/comment-gate.mjs
cp "$SOURCE/.claude/hooks/comment-gate.test.mjs" plugins/comment-gate/hooks/comment-gate.test.mjs
```

- [ ] **Step 2: Edit the test file first (it defines the target behaviour)**

Replace line 1, which names the source workspace and two issue numbers in a parenthetical, with:

```js
// Tests for the PreToolUse comment-gate hook.
```

Replace line 2 with:

```js
// Run: node --test plugins/comment-gate/hooks/comment-gate.test.mjs
```

In the `isGatedFile` test, two assertions use source-workspace paths (an app path and an absolute lib path naming a domain). Replace them with:

```js
  assert.equal(isGatedFile('apps/web/src/app/app.config.ts'), true);
  assert.equal(isGatedFile('/abs/path/libs/catalogue/data-access/src/lib/x.ts'), true);
```

Add one new test after the existing `isGatedFile` tests:

```js
test('GATED_PATH is the one constant a project changes', () => {
  assert.equal(isGatedFile('src/lib/thing.ts'), false);
  assert.equal(isGatedFile('packages/core/src/thing.ts'), false);
});
```

- [ ] **Step 3: Run the tests to see the new one fail**

Run: `node --test plugins/comment-gate/hooks/comment-gate.test.mjs`
Expected: every test passes except the module import fails on nothing yet; if `GATED_PATH` test passes already (it will, since the copied predicate rejects those paths), that is fine, proceed. The failing part comes in Step 4's constant refactor, which must keep all tests green.

- [ ] **Step 4: Edit the hook — scope constants**

Replace the `isGatedFile` block (the comment above it plus the function) with:

```js
// The one place a project changes: which files the gate covers. The default
// is an Nx-style tree; a single-package repo might use /^src\/.*\.tsx?$/.
const GATED_PATH = /(?:^|\/)(?:apps|libs)\/.+?\/src\/.*\.tsx?$/;
const SPEC_FILE = /\.(?:spec|test)\.tsx?$/;
const TEST_UTILITY = /(?:^|\/)test-|(?:^|\/)testing\/|\.mock\./;

export function isGatedFile(file) {
  if (!file) return false;
  const path = file.replace(/\\/g, '/');
  return GATED_PATH.test(path) && !SPEC_FILE.test(path) && !TEST_UTILITY.test(path);
}
```

- [ ] **Step 5: Edit the hook — project root for the docs walk**

Replace:

```js
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
```

with:

```js
// The hook lives in the plugin cache, so the docs walk is rooted at the
// project being edited, not at this file.
const repoRoot = resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd()) + '/';
```

`resolve` is already imported from `node:path`.

- [ ] **Step 6: Edit the hook — remove source-workspace anchors**

Apply exactly these text edits:

1. Header block: replace `rulebook (#662, #689). Fails OPEN when the judge is unavailable.` with `rulebook. Fails OPEN when the judge is unavailable.`
2. In `buildJudgePrompt`, the six-line `//` comment beginning `// The four reinforcement strings below restate points…`: replace the sentence fragment `judge mis-cut with the rulebook alone (docs/comment-gate-design.md). Sync them with SKILL.md if` with `judge mis-cut with the rulebook alone. Sync them with SKILL.md if`. Then cut that comment to at most three lines, keeping its one fact:

```js
  // These four strings restate points in the rulebook on purpose: the judge
  // mis-cut with the rulebook alone. SKILL.md's maintainer note names them;
  // change them together.
```

3. Grep the file for `#[0-9]`, `!1`, `docs/`, and the source workspace's short name, and confirm no hits remain.

- [ ] **Step 7: Run the tests**

Run: `node --test plugins/comment-gate/hooks/comment-gate.test.mjs`
Expected: all pass.

- [ ] **Step 8: Smoke the hook end to end without a judge (length rule path)**

Run:

```bash
printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"libs/x/src/a.ts","content":"// one\n// two\n// three\n// four\nconst a = 1;\n"}}' | node plugins/comment-gate/hooks/comment-gate.mjs
```

Expected: JSON on stdout with `"permissionDecision":"deny"` naming a 4-line `//` stack. Then confirm the off switch:

```bash
printf '%s' '{"tool_name":"Write","tool_input":{"file_path":"libs/x/src/a.ts","content":"// one\n// two\n// three\n// four\nconst a = 1;\n"}}' | CLAUDE_COMMENT_GATE_OFF=1 node plugins/comment-gate/hooks/comment-gate.mjs
```

Expected: no output, exit 0.

- [ ] **Step 9: Scrub and commit**

```bash
node tools/scrub-check.mjs
git add plugins/comment-gate/hooks
git commit -m "feat(comment-gate): port the write-time hook with a single gated-path constant"
```

---

### Task 4: Rewrite the judge calibration fixtures

**Files:**
- Create: `plugins/comment-gate/hooks/comment-gate.fixtures.mjs`

**Interfaces:**
- Consumes: the hook from Task 3 and the rulebook from Task 5 (run the fixtures only after Task 5; the judge reads the skill).

- [ ] **Step 1: Write the file**

```js
#!/usr/bin/env node
// Calibration eval for the comment-gate judge: each fixture is a comment the
// rulebook should deny or pass. Spawns one judge per fixture, so run it by
// hand (`node plugins/comment-gate/hooks/comment-gate.fixtures.mjs`), never
// under `node --test`.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const hook = join(dirname(fileURLToPath(import.meta.url)), 'comment-gate.mjs');
const apiService = 'libs/catalogue/data-access/src/lib/api/books.api.service.ts';

const fixtures = [
  {
    name: 'measurements/dates — serializer timing',
    expect: 'deny',
    file: apiService,
    content: [
      '  // view=summary selects the slim projection: it skips the per-row',
      '  // relational fields that make the default serializer ~40ms/row —',
      '  // 0.5s for all 1200 rows instead of 48s (measured 2026-03-02).',
      '  public getAll(): Observable<BookSummaryDto[]> {',
    ].join('\n'),
  },
  {
    name: 'consumer list — selector read API',
    expect: 'deny',
    file: 'libs/catalogue/data-access/src/lib/books.selectors.ts',
    content: [
      '  // The slice read API. Consumers: the book detail page (selectBookById)',
      '  // and the shelf list column (selectAllBooks).',
      '  export const selectAllBooks = createSelector(selectBooksState, selectAll);',
    ].join('\n'),
  },
  {
    name: 'percentage — placeholder convention share',
    expect: 'deny',
    file: 'libs/catalogue/ui/src/lib/loan-form/loan-form.component.ts',
    content: [
      '  // Placeholder hint only (never auto-filled): surname[:6] uppercased — the',
      '  // most common member-code convention (~30% of 1200; the rest ad hoc).',
      '  function suggestMemberCodePlaceholder(member: Member): string {',
    ].join('\n'),
  },
  {
    name: 'why + anchor — view=summary is load-bearing',
    expect: 'pass',
    file: apiService,
    content: [
      '  // view=summary is load-bearing — without it the default serializer is',
      '  // unusably slow (libs/catalogue/README.md).',
      '  public getAll(): Observable<BookSummaryDto[]> {',
    ].join('\n'),
  },
  {
    name: 'footgun — private create/link invariant',
    expect: 'pass',
    file: apiService,
    content: [
      '  // create and setShelfKey stay private so no caller can create without',
      '  // shelving — a bare create leaves a permanent, never-findable orphan.',
      '  public provisionForShelf(newBook: NewBook): Observable<BookDto> {',
    ].join('\n'),
  },
  {
    name: 'why — non-obvious server behaviour forces the follow-up PUT',
    expect: 'pass',
    file: apiService,
    content: [
      '  // POST discards a posted shelf key (the server re-derives it from the',
      '  // title), so the key can only be set by this follow-up PUT.',
      '  private setShelfKey(bookId: BookId, shelf: ShelfCode): Observable<BookDto> {',
    ].join('\n'),
  },
  {
    name: 'public-API JSDoc — "what is it" tooltip on an exported interface',
    expect: 'pass',
    file: 'libs/catalogue/interfaces/src/lib/book.model.ts',
    content: [
      '/** A catalogue entry as returned by /api/books — identity only; loan',
      ' * history and holds load separately via the extras query. */',
      'export interface Book {',
    ].join('\n'),
  },
  {
    name: 'signature-restating JSDoc — adds nothing over the name and types',
    expect: 'deny',
    file: apiService,
    content: [
      '  /** Gets the book by its id and returns an observable of the book DTO. */',
      '  public getById(id: BookId): Observable<BookDto> {',
    ].join('\n'),
  },
  {
    name: 'essay — five true "why" lines as a // stack (length rule, no judge)',
    expect: 'deny',
    file: apiService,
    content: [
      '  // Diagnostic preview: when enabled, shows the just-scanned cover in a toast',
      '  // so a librarian can confirm the scanner works. Off by default; flip',
      '  // SHOW_PREVIEW to true to enable. This class is only registered under',
      '  // isDevMode() in the routes, so the preview can never reach a production',
      '  // terminal even if the flag is left on. The scan flow runs regardless.',
      '  const SHOW_PREVIEW = false;',
    ].join('\n'),
  },
  {
    name: 'essay — six-line JSDoc narrating the body (long tier, judged)',
    expect: 'deny',
    file: apiService,
    content: [
      '  /**',
      '   * Fetches the book by id. Builds the URL from the api root and the id,',
      '   * issues the GET through HttpClient, and pipes the response through',
      '   * catchError into handleError so failures become typed errors.',
      '   * Returns an observable of the DTO for the effect to map.',
      '   */',
      '  public getById(id: BookId): Observable<BookDto> {',
    ].join('\n'),
  },
];

function run(fixture) {
  const payload = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: fixture.file, content: fixture.content },
  });
  const result = spawnSync('node', [hook], { input: payload, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const got = result.stdout.trim().length > 0 ? 'deny' : 'pass';
  return { ...fixture, got, ok: got === fixture.expect };
}

let matched = 0;
for (const fixture of fixtures) {
  const result = run(fixture);
  if (result.ok) matched += 1;
  console.log(`${result.ok ? '✓' : '✗'} [want ${result.expect}, got ${result.got}] ${result.name}`);
}
console.log(`\n${matched}/${fixtures.length} fixtures matched expectation.`);
```

- [ ] **Step 2: Scrub and commit (run the fixtures in Task 5 Step 5, once the rulebook exists)**

```bash
node tools/scrub-check.mjs
git add plugins/comment-gate/hooks/comment-gate.fixtures.mjs
git commit -m "test(comment-gate): add judge calibration fixtures on an invented catalogue domain"
```

---

### Task 5: Port the `/comment` skill

**Files:**
- Create: `plugins/comment-gate/skills/comment/SKILL.md` (copied from `$SOURCE/.claude/skills/comment/SKILL.md`, then edited)

**Interfaces:**
- Produces: the rulebook file at the path the hook reads (`../skills/comment/SKILL.md` from the hook) and the skill name `comment` the agent preloads.

- [ ] **Step 1: Copy**

```bash
mkdir -p plugins/comment-gate/skills/comment
cp "$SOURCE/.claude/skills/comment/SKILL.md" plugins/comment-gate/skills/comment/SKILL.md
```

- [ ] **Step 2: Frontmatter**

Replace the `description:` value with:

```
The rule for code comments — load-bearing only, plus the delete-test for deciding keep vs cut. Invoke to run an on-demand cleanup pass over a named file (e.g. "/comment src/foo/bar.ts"), or to settle whether a specific comment earns its place. The comment-gate PreToolUse hook reads this skill as the rulebook for the fresh-context judge that rules on comments added to production TS; this skill is that rule.
```

Replace the `argument-hint` example path `libs/foo/bar.ts` with `src/foo/bar.ts`.

- [ ] **Step 3: Body edits**

1. First paragraph after the heading: replace `This file is the single source of truth for the rule. Everything else *points* here rather than restating it — the CLAUDE.md "Coding style" line, the write-time \`comment-gate\` hook, and the review-time \`comment-audit\` agent all read or link this skill, so an edit here reaches every mechanism.` with `This file is the single source of truth for the rule. The write-time \`comment-gate\` hook and the review-time \`comment-audit\` agent both read it, so an edit here reaches both mechanisms.`
2. Maintainer note: replace the two links with `[\`hooks/comment-gate.mjs\`](../../hooks/comment-gate.mjs)` and `[\`agents/comment-audit.md\`](../../agents/comment-audit.md)`; delete the parenthetical `(see [\`docs/comment-gate-design.md\`](../../../docs/comment-gate-design.md))` and the sentence fragment it sits in becomes `The duplication is intentional — the judge demonstrably mis-cut with the full rulebook alone.`
3. Keep list, constraint bullet: the example names a device brand; replace the whole parenthetical with `(e.g. "the device WebView is Chrome 90, so no ES2022")`.
4. Keep list, anchor bullet: the example is a source-workspace issue reference; replace the whole parenthetical with `(e.g. \`catalogue#620\`)`.
5. Worked examples block: replace the whole fenced `ts` block with:

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

6. Grep the file for `#[0-9]`, `libs/`, `IRep`, the device brand, and the source workspace's short name, and confirm only the intended `catalogue#…` anchors remain.

- [ ] **Step 4: Run the hook's unit tests (the rulebook path is now real)**

Run: `node --test 'plugins/**/*.test.mjs'`
Expected: all pass.

- [ ] **Step 5: Run the calibration fixtures once**

Run: `node plugins/comment-gate/hooks/comment-gate.fixtures.mjs`
Expected: `10/10 fixtures matched expectation.` This spends ten judge calls and takes a few minutes. If a fixture mismatches, do not tune the rule: record the mismatch in the commit message and continue; the owner decides in review.

- [ ] **Step 6: Scrub and commit**

```bash
node tools/scrub-check.mjs
git add plugins/comment-gate/skills/comment
git commit -m "feat(comment-gate): port the /comment rule with neutral worked examples"
```

---

### Task 6: Port the `comment-audit` agent

**Files:**
- Create: `plugins/comment-gate/agents/comment-audit.md` (copied from `$SOURCE/.claude/agents/comment-audit.md`, then edited)

**Interfaces:**
- Consumes: skill `comment` (Task 5) via the `skills:` frontmatter.
- Produces: agent name `comment-audit`, inputs `CHANGED_TS` and `FULL_DIFF`, findings as Notes.

- [ ] **Step 1: Copy**

```bash
mkdir -p plugins/comment-gate/agents
cp "$SOURCE/.claude/agents/comment-audit.md" plugins/comment-gate/agents/comment-audit.md
```

- [ ] **Step 2: Frontmatter**

Replace the `description:` value with:

```
Review-time backstop for the write-time comment gate — re-checks the comment lines a branch ADDED to production TS against the /comment delete-test, catching non-load-bearing comments that landed while the gate's judge was failing open. Read-only; returns findings only.
```

Keep `tools`, `model: claude-opus-5`, and `skills: [comment]` as they are.

- [ ] **Step 3: Body edits**

1. "Why this exists": replace `the [\`comment-gate\` PreToolUse hook](../hooks/comment-gate.mjs) (#689)` with `the [\`comment-gate\` PreToolUse hook](../hooks/comment-gate.mjs)`; replace `This audit is that catch, at review time (#690).` with `This audit is that catch, at review time.`
2. Inputs: replace `the branch diff vs \`origin/develop\`` with `the branch diff against the base branch (the calling skill computes it)`.
3. Step 1: the bullet list stays; replace the sentence `As of this writing it admits a path when all of these hold:` with `It admits a path when all of these hold (the project may have changed the \`GATED_PATH\` constant; read the installed hook):`.
4. Step 4: delete the paragraph beginning `Severity is **owned here, not cited**` and replace it with `Every finding is a Note; there is no higher severity in this audit.` Replace the link form in the two example findings: `[\`libs/reps/util/src/lib/format-rep.ts:12\`](../../../libs/reps/util/src/lib/format-rep.ts#L12)` becomes `\`libs/catalogue/util/src/lib/format-title.ts:12\``, and `[\`libs/badges/util/src/lib/resolve-badge-id.ts:8\`](../../../libs/badges/util/src/lib/resolve-badge-id.ts#L8)` becomes `\`libs/catalogue/util/src/lib/resolve-member-id.ts:8\``. Rename the code identifiers in the examples to match: `reps.map(rep => rep.id)` → `books.map(book => book.id)`, `resolveBadgeId(...)` → `resolveMemberId(...)`. Replace `(report-relative \`../../../<path>#L<n>\`, per the shared finding format)` with `(\`path:line\`)`.
5. Grep for `develop`, `MR`, `review-criteria`, `rep`, `badge`, `#[0-9]`, and the source workspace's short name. Replace remaining `MR time` / `MR-time` with `review time` / `review-time`. Confirm no hits remain.

- [ ] **Step 4: Scrub and commit**

```bash
node tools/scrub-check.mjs
git add plugins/comment-gate/agents
git commit -m "feat(comment-gate): port the review-time comment-audit agent"
```

---

### Task 7: Write the `review-comments` skill

**Files:**
- Create: `plugins/comment-gate/skills/review-comments/SKILL.md`

**Interfaces:**
- Consumes: agent `comment-audit` (Task 6), hook scope predicate (Task 3).

- [ ] **Step 1: Write the file**

````markdown
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
````

- [ ] **Step 2: Validate the plugin**

Run: `claude plugin validate .`
Expected: valid; lists two skills, one agent, one hook.

- [ ] **Step 3: Scrub and commit**

```bash
node tools/scrub-check.mjs
git add plugins/comment-gate/skills/review-comments
git commit -m "feat(comment-gate): add the review-comments skill that gates the audit on the diff"
```

---

### Task 8: Install into a throwaway project and prove the gate

**Files:**
- None committed. Throwaway project at `/tmp/claude-1000/gate-trial` (or any scratch path).

**Interfaces:**
- Consumes: everything in `plugins/comment-gate/`.

- [ ] **Step 1: Make the throwaway project**

```bash
mkdir -p /tmp/claude-1000/gate-trial/libs/x/src
printf 'let counter = 0;\nexport function next() {\n  counter++;\n  return counter;\n}\n' > /tmp/claude-1000/gate-trial/libs/x/src/a.ts
printf 'export const spec = true;\n' > /tmp/claude-1000/gate-trial/libs/x/src/a.spec.ts
git -C /tmp/claude-1000/gate-trial init -q
```

- [ ] **Step 2: Install from the local marketplace (interactive; the owner runs this)**

In a Claude Code session started in `/tmp/claude-1000/gate-trial`:

```
/plugin marketplace add <repo>
/plugin install comment-gate@claude-code-playbook
```

where `<repo>` is the local clone path. Restart the session so the hook registers.

- [ ] **Step 3: Three probes, in that session**

1. Ask: "In libs/x/src/a.ts add the comment `// increment the counter` directly above `counter++`." Expected: the Edit is **denied** with a reason naming L3 as restatement.
2. Ask: "In libs/x/src/a.ts add above `counter++` the comment `// Must stay a module-level counter: callers rely on monotonic ids across hot reloads (catalogue#12).`" Expected: the Edit is **allowed**.
3. Ask: "In libs/x/src/a.spec.ts add `// a comment` above the export." Expected: the Edit is **allowed** with no judge call (spec files are out of scope).

Record the Claude Code version (`claude --version`) and the three outcomes; Task 10 puts them in the README.

- [ ] **Step 4: Check the names the session shows**

Confirm which names the session lists for the plugin's skills (`comment` and `review-comments`, possibly prefixed `comment-gate:`) and the agent. If prefixed, update the `skills:` frontmatter in `plugins/comment-gate/agents/comment-audit.md` and the dispatch name in `plugins/comment-gate/skills/review-comments/SKILL.md` to the exact listed names, re-run `node --test 'plugins/**/*.test.mjs'`, scrub, and commit:

```bash
git commit -am "fix(comment-gate): use the installed skill and agent names"
```

---

### Task 9: The Pages site

**Files:**
- Create: `docs/_config.yml`
- Create: `docs/index.md`
- Create: `docs/01-output-style.md`
- Create: `docs/02-comment-rule.md`
- Create: `docs/03-comment-gate.md`
- Create: `docs/04-review-audit.md`
- Create: `docs/why-stated-rules-decay.md` (from `$SOURCE/docs/comment-gate-design.md`, then edited)
- Create: `docs/comment-gate-explained.html` (from `$SOURCE/docs/comment-gate-explained.html`, then edited)

- [ ] **Step 1: `docs/_config.yml`**

```yaml
title: claude-code-playbook
description: Patterns for driving Claude Code well, and why they are shaped the way they are.
theme: jekyll-theme-minimal
exclude:
  - superpowers
```

- [ ] **Step 2: `docs/index.md`**

```markdown
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
```

- [ ] **Step 3: `docs/01-output-style.md`**

```markdown
# Layer 1 — the Concise output style

The cheapest change is one line of settings:

```json
{
  "outputStyle": "Concise"
}
```

`Concise` is a built-in Claude Code output style. It tells the assistant to lead with the result, skip preamble and recap, keep simple answers to a sentence or three, and never trade correctness for brevity. It changes how Claude *talks*, not how it codes, but the two are linked: an assistant that narrates its work in chat narrates it in comments too.

## Where the line lives

Three settings files can carry it. Highest precedence first:

| File | Scope | Committed? |
|---|---|---|
| `.claude/settings.local.json` | you, this project | no (gitignored by convention) |
| `.claude/settings.json` | everyone, this project | yes |
| `~/.claude/settings.json` | you, every project | n/a |

The `/output-style Concise` command writes to the local project file. That is a personal choice. Moving the same line into `.claude/settings.json` and committing it is the act of making it a team default: every session in the repo gets it, and the change goes through review like any other.

The other built-in styles are `Default`, `Proactive`, `Explanatory`, and `Learning`. `Explanatory` and `Learning` do the opposite of what this playbook wants; they are for teaching, not shipping.

## What it looks like

Same question, "why does the build fail?", two styles.

Default:

> Let me take a look at the build output. I'll check the error message first and then look at the relevant file. It looks like the failure is caused by a missing import in `app.config.ts`. I'll explain what I found: the `provideRouter` symbol is used on line 12 but never imported. To fix this, I'll add the import. Let me know if you'd like me to proceed.

Concise:

> `app.config.ts:12` uses `provideRouter` without importing it. Adding the import fixes the build.

The style alone does not stop comment essays. It sets the tone; the next three layers enforce the rule.
```

- [ ] **Step 4: `docs/02-comment-rule.md`**

```markdown
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

`/comment path/to/file.ts` runs a cleanup pass: every comment gets the delete-test, failures are cut, code is untouched, and you get a one-line report. The full rule, keep and cut lists, worked examples, and the rationalization traps are in the skill file itself: [`plugins/comment-gate/skills/comment/SKILL.md`](https://github.com/eggbeard/claude-code-playbook/blob/main/plugins/comment-gate/skills/comment/SKILL.md).
```

- [ ] **Step 5: `docs/03-comment-gate.md`**

```markdown
# Layer 3 — the write-time gate

A stated rule is read once and forgotten. The gate is a PreToolUse hook on `Write` and `Edit` that runs at the moment of the write and can refuse it. The hook is `hooks/comment-gate.mjs` in the plugin; this page explains its three layers.

## 1. A free detector

The hook reads the tool input, works out which comment lines the write *adds* (for an Edit, comments in the new text that were not in the old text), and checks whether the file is production TypeScript. If nothing was added, or the file is out of scope, the hook exits silently. No model call, no cost. Only a command hook can be content-conditional like this; a native model-judge hook would pay for every matched write.

The scope is one constant:

```js
const GATED_PATH = /(?:^|\/)(?:apps|libs)\/.+?\/src\/.*\.tsx?$/;
```

Specs, test utilities, and mocks are excluded. Change that line for a single-package repo.

## 2. A length rule, before any judge

An added `//` stack over three lines or a `/* */` block over six is denied outright, naming the block. This catches the essay class at zero cost, and it exists because the judge alone did not: given a six-line stack of individually true "why" sentences, the judge kept it, or timed out trying to decide.

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
```

- [ ] **Step 6: `docs/04-review-audit.md`**

```markdown
# Layer 4 — the review-time audit

The gate fails open on purpose. A review-time pass closes the gap.

## The agent

`comment-audit` is a read-only subagent with the `/comment` skill preloaded. Given the changed production TS files and the branch diff, it scopes itself with the same predicate the hook uses, isolates the comment lines the branch *added*, reads the surrounding source, and runs the delete-test on each. It also re-checks length and, for kept declaration comments over three lines, nudges toward JSDoc form. Every finding is a Note: it is a backstop, not the enforcement.

The healthy result is "all load-bearing, no findings". The agent is told so, and told that a false finding here costs the same trust the fail-open protects.

Its model is pinned by id in the agent's frontmatter, not chosen at dispatch. A `model` override on the call would silently replace the pin; the skill that dispatches it passes none.

## The gate on the backstop

`review-comments` is the skill that decides whether the agent runs. It diffs the branch against the base branch, looks at added lines in non-spec TypeScript, and dispatches the agent if any is a comment. It never asks. Two rules make it worth having:

- An author's own `/comment` pass does not substitute. Same party, same blind spot.
- A gate that matches runs; a gate that does not match does not run. No "want me to?".

The skill carries a one-row gating table. In a larger review workflow the same table grows a row per audit, and each row is a grep over the diff, so the decision is mechanical and the reviewer never has to remember which audits exist.
```

- [ ] **Step 7: Port the essay to `docs/why-stated-rules-decay.md`**

```bash
cp "$SOURCE/docs/comment-gate-design.md" docs/why-stated-rules-decay.md
```

Then apply these edits:

1. Title and lead: replace `# The Blocking Comment Gate — Design` with `# Why stated rules decay`; replace the first paragraph (it ends with an issue reference) with `How a blocking gate keeps model-written comment essays out of production code, and why this shape works where a clearly-stated rule did not.`
2. "The problem it solves": replace `a single recent branch (!1170) shipped roughly fifty` with `a single branch shipped roughly fifty`.
3. Mechanism 3: the closing parenthetical names a merge request number and two offender categories; replace the whole parenthetical with `(the worst offenders were performance measurements and a server-side key-linking rule)`.
4. "Length rule and judge tiers": replace `The #554 branch carried` with `One branch carried`; replace `measured against the six-line one on 2026-09-21,` with `measured against the six-line one,`.
5. "A rejected direction": replace `The calibration fixtures (\`.claude/hooks/comment-gate.fixtures.mjs\`) pin` with `The calibration fixtures (\`hooks/comment-gate.fixtures.mjs\`) pin`.
5a. "Length rule and judge tiers", last paragraph: delete the sentence that names the CI job and the npm script (`The spec is run by …`).
5b. "Detector scope", first paragraph: delete the parenthetical issue reference after `were removed`, and delete the parenthetical measurement `(about two in five templates under \`src\` carry a comment, mostly section labels and stale notes)`.
6. Delete the section `## Review-time backstop (planned)` entirely and replace it with:

   ```markdown
   ## Review-time backstop

   Because the write-time gate fails open when the judge is unavailable, the `comment-audit` agent reviews a branch's added comments at review time against the same rule. Write-time blocks the clear cases in the common path; review-time is the defense-in-depth net. See [layer 4](04-review-audit.md).
   ```
7. Replace the `## Files` section with:

   ```markdown
   ## Files

   - `hooks/comment-gate.mjs` — the detector, length rule, tiered judge, and fail-open logic; `hooks/comment-gate.test.mjs` — unit coverage; `hooks/comment-gate.fixtures.mjs` — the judge calibration eval (run by hand; one model call per fixture).
   - `skills/comment/SKILL.md` — the rule; the judge's rulebook.
   - `hooks/hooks.json` — registers the hook under `PreToolUse` for `Write|Edit`.
   ```
8. Grep the file for `!1`, `#[0-9]`, `.claude/`, `CLAUDE.md "Coding style"`, and the source workspace's short name, and fix any remaining hit by deleting the reference.

- [ ] **Step 8: Port the explainer**

```bash
cp "$SOURCE/docs/comment-gate-explained.html" docs/comment-gate-explained.html
```

Two lines (the `eyebrow` paragraph and the footer `span`) carry the source workspace name and an issue number after the title; replace each with `The Comment Gate · claude-code-playbook`. Then grep the file for `!1`, `#[0-9]`, `libs/`, `apps/`, and every term in the scrub denylist, and read every hit; rewrite any that names the source workspace's domains (keep generic `apps/**/src` scope mentions).

- [ ] **Step 9: Scrub and commit**

```bash
node tools/scrub-check.mjs
git add docs
git commit -m "docs: add the four-layer commentary and the Pages configuration"
```

---

### Task 10: Finish the README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the stub**

```markdown
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

Verified against Claude Code <version from Task 8>: a restating comment in production TS is denied, a footgun comment is allowed, a spec file is not gated.

## Layout

```
.claude-plugin/marketplace.json   the marketplace
plugins/<name>/                   one plugin per folder
docs/                             the site (GitHub Pages, Jekyll)
tools/scrub-check.mjs             CI guard: no identifiers from the workspace this was ported from
```

## Developing

```
node --test 'tools/**/*.test.mjs' 'plugins/**/*.test.mjs'
node tools/scrub-check.mjs
claude plugin validate .
```

The judge calibration fixtures cost one model call each and run by hand: `node plugins/comment-gate/hooks/comment-gate.fixtures.mjs`.

## Licence

MIT.
```

Fill `<version from Task 8>` with the recorded version.

- [ ] **Step 2: Scrub and commit**

```bash
node tools/scrub-check.mjs
git add README.md
git commit -m "docs: finish the README with install, layout and verification"
```

---

### Task 11: Create the private GitHub repo and push

**Files:** none.

- [ ] **Step 1: Final local checks**

```bash
node --test 'tools/**/*.test.mjs' 'plugins/**/*.test.mjs'
node tools/scrub-check.mjs
claude plugin validate .
git status --short
```

Expected: tests pass, scrub clean, plugin valid, working tree clean.

- [ ] **Step 2: Owner review gate**

Stop. The owner reads the scrub denylist in `tools/scrub-check.mjs` and every file under `plugins/` and `docs/`. Proceed only on their explicit go.

- [ ] **Step 3: Create the repo, private, and push**

```bash
gh repo create eggbeard/claude-code-playbook --private --source . --remote origin --push --description "Patterns for driving Claude Code well: hooks, skills and agents with the reasoning behind them."
```

Expected: repo created, `main` pushed, CI run starts.

- [ ] **Step 4: Confirm CI**

Run: `gh run watch --repo eggbeard/claude-code-playbook`
Expected: the `ci` workflow passes.

---

### Task 12: Go public and enable Pages

**Files:** none.

- [ ] **Step 1: Owner review gate**

Stop. The owner reviews the repo on GitHub. Proceed only on their explicit go.

- [ ] **Step 2: Flip visibility**

```bash
gh repo edit eggbeard/claude-code-playbook --visibility public --accept-visibility-change-consequences
```

- [ ] **Step 3: Enable Pages from `main` / `docs`**

```bash
gh api -X POST repos/eggbeard/claude-code-playbook/pages -f 'source[branch]=main' -f 'source[path]=/docs'
```

Expected: 201 with an `html_url` of `https://eggbeard.github.io/claude-code-playbook/`.

- [ ] **Step 4: Confirm the site renders**

Wait for the Pages build (`gh api repos/eggbeard/claude-code-playbook/pages/builds/latest` shows `status: built`), then open the URL and check the index links resolve and `comment-gate-explained.html` loads.

- [ ] **Step 5: Prove the public install path**

In a fresh throwaway project session: `/plugin marketplace add eggbeard/claude-code-playbook`, `/plugin install comment-gate@claude-code-playbook`, and repeat probe 1 from Task 8. Expected: denied.

---

## Self-review

- **Spec coverage.** Layout → Tasks 1, 9, 10. Hook edits (constant, project-root docs walk, anchor removal, unchanged judge) → Task 3. Test file → Task 3. Fixtures rewritten on the catalogue domain with the same lesson pairs → Task 4. Skill port with neutral examples and maintainer note → Task 5. New review-comments skill with gating table and model-pin rule → Task 7. Agent port (base branch, severity, link form, model pin) → Task 6. Six pages plus explainer plus `_config.yml` → Task 9. Scrub rule with denylist, CI, owner sees the list → Task 2, gate in Task 11. Testing: unit tests, scrub, validate, throwaway install with three probes recorded in README, fixtures run once → Tasks 3, 5, 8, 10, 11. Sequence private-then-public with two owner gates → Tasks 11, 12.
- **Spec amendments.** The spec said `.gitignore` excludes `docs/superpowers/`; the owner decided plans are committed in this repo, so `.gitignore` does not exclude it and `_config.yml` excludes `superpowers` from the site instead. The spec should be updated to match (one-line edit, done alongside Task 2's commit).
- **Placeholders.** `<version from Task 8>` and `<repo>` are deliberate fill-ins recorded by earlier steps, not unknowns.
- **Names.** `GATED_PATH`, `SPEC_FILE`, `TEST_UTILITY` (Task 3) are referenced by Tasks 6, 9, 10 by the same names. Agent name `comment-audit`, skill names `comment` and `review-comments`, marketplace `claude-code-playbook`, plugin `comment-gate` are consistent throughout; Task 8 Step 4 is the one place they may gain a plugin prefix.
