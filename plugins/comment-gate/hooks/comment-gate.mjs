#!/usr/bin/env node
/**
 * PreToolUse hook (Write|Edit) for comment lines added to production TS. Denies
 * by length first (a // stack over three lines or a block over six, no model
 * call), then by a fresh-context `claude -p` judge reading /comment as its
 * rulebook. Fails OPEN when the judge is unavailable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Replace string-literal contents with spaces, length-preserving, so a `//` or
// `/*` inside a string (e.g. a URL) is never read as a comment marker. Only a
// template literal may stay open at end of line; `quote` carries it over.
function blankStrings(line, openQuote = null) {
  let text = '';
  let quote = openQuote;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') {
        text += '  ';
        i++;
        continue;
      }
      if (ch === quote) {
        quote = null;
        text += ch;
        continue;
      }
      text += ' ';
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      text += ch;
    } else {
      text += ch;
    }
  }
  return { text, quote: quote === '`' ? quote : null };
}

const TRIPLE_SLASH_DIRECTIVE = /^\/\/\/\s*</;

function detectCStyle(lines) {
  const comments = [];
  let inBlock = false;
  let openQuote = null;
  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    if (inBlock) {
      comments.push({ line: lineNo, text: raw.trim() });
      if (raw.includes('*/')) inBlock = false;
      return;
    }
    const scan = blankStrings(raw, openQuote);
    const lineIdx = scan.text.indexOf('//');
    const blockIdx = scan.text.indexOf('/*');
    const start = lineIdx !== -1 && (blockIdx === -1 || lineIdx < blockIdx) ? lineIdx : blockIdx;
    openQuote = start === -1 ? scan.quote : null;
    if (start === -1) return;
    const text = raw.slice(start).trim();
    if (start === lineIdx) {
      if (!TRIPLE_SLASH_DIRECTIVE.test(text)) comments.push({ line: lineNo, text });
      return;
    }
    comments.push({ line: lineNo, text });
    if (scan.text.indexOf('*/', blockIdx + 2) === -1) inBlock = true;
  });
  return comments;
}

// Only .ts/.tsx files are gated (isGatedFile), so this is the one detector.
export function detectComments(text) {
  if (!text) return [];
  return detectCStyle(text.split('\n'));
}

function safeRead(readFile, file) {
  try {
    return readFile(file);
  } catch {
    return null;
  }
}

const NOTHING = { comments: [], all: [], content: '' };
const textsOf = (comments) => new Set(comments.map((comment) => comment.text));

// The comment lines the write introduces, with `all` the comments of the
// post-write `content` they are located in — so the length rule can measure
// the whole block an edit grows, and the judge sees the comment in context.
// Write: comments of the new content whose text is not already on disk.
// Edit: comments inside new_string's span of the file with the edit applied,
// minus those old_string's span already had. Both spans are detected in the
// context of the whole file: an edit that appends lines to an open JSDoc
// carries no `/**` of its own.
export function addedComments(payload, readFile) {
  const tool = payload?.tool_name;
  const input = payload?.tool_input ?? {};
  const file = input.file_path ?? payload?.tool_response?.filePath ?? '';

  const onDisk = readFile ? safeRead(readFile, file) : null;
  if (tool === 'Write') {
    const content = input.content ?? '';
    const all = detectComments(content);
    const before = textsOf(detectComments(onDisk ?? ''));
    return { file, comments: all.filter((comment) => !before.has(comment.text)), all, content };
  }

  const oldString = input.old_string ?? '';
  const newString = input.new_string ?? '';
  const at = oldString && onDisk != null ? onDisk.indexOf(oldString) : -1;
  if (at === -1) {
    const before = textsOf(detectComments(oldString));
    const added = detectComments(newString).filter((comment) => !before.has(comment.text));
    return added.length ? { file, comments: added, all: added, content: newString } : { file, ...NOTHING };
  }

  const firstLine = onDisk.slice(0, at).split('\n').length;
  const inSpanOf = (text) => (comment) =>
    comment.line >= firstLine && comment.line < firstLine + text.split('\n').length;
  const before = textsOf(detectComments(onDisk).filter(inSpanOf(oldString)));
  const content = onDisk.slice(0, at) + newString + onDisk.slice(at + oldString.length);
  const all = detectComments(content);
  const comments = all.filter(inSpanOf(newString)).filter((comment) => !before.has(comment.text));
  return { file, comments, all, content };
}

const MAX_SHOWN = 10;

function truncate(text, max = 100) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

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

function denyReason(file, comments) {
  const noun = comments.length === 1 ? 'comment line' : 'comment lines';
  const shown = comments.slice(0, MAX_SHOWN).map((comment) => `  • L${comment.line}: ${truncate(comment.text)}`);
  if (comments.length > MAX_SHOWN) shown.push(`  • …and ${comments.length - MAX_SHOWN} more`);
  return [
    `Blocked: ${comments.length} ${noun} added to ${file}.`,
    'Comments in production TS are load-bearing only (/comment is the rule). Delete-test each: keep only a why / constraint / footgun / anchor the code cannot carry; cut anything that restates the code or a doc, or narrates steps. Then retry.',
    ...shown,
  ].join('\n');
}

// Returns a PreToolUse deny object, or null to leave the normal permission flow
// untouched. CLAUDE_COMMENT_GATE_OFF disables the gate for emergencies.
export function decidePre(payload, readFile) {
  if (process.env.CLAUDE_COMMENT_GATE_OFF) return null;
  const tool = payload?.tool_name;
  if (tool !== 'Write' && tool !== 'Edit') return null;
  const input = payload?.tool_input ?? {};
  const file = input.file_path ?? payload?.tool_response?.filePath ?? '';
  if (!isGatedFile(file)) return null;
  const { comments } = addedComments(payload, readFile);
  if (comments.length === 0) return null;
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: denyReason(file, comments),
    },
  };
}

// --- length rule (deterministic, before the judge) ---

const LINE_STACK_MAX = 3;
const BLOCK_MAX = 6;

// Groups comment lines into blocks: a run of full-line `//` comments (blank
// lines between them do not break the run), or one `/* … */` / `/** … */`
// block with its continuation lines. A trailing comment after code is a block
// of its own; ten annotated array entries are not a ten-line stack. `content`
// is the text the line numbers index; without it every comment is full-line.
export function commentBlocks(comments, content = '') {
  return groupBlocks(comments, content).map(({ kind, start, end, lines }) => ({ kind, start, end, lines }));
}

function groupBlocks(comments, content) {
  const lines = content ? content.split('\n') : [];
  const isFullLine = (comment) => (lines[comment.line - 1] ?? comment.text).trim() === comment.text;
  const onlyBlankBetween = (from, to) => {
    for (let lineNo = from; lineNo < to; lineNo++) {
      if ((lines[lineNo - 1] ?? 'code').trim() !== '') return false;
    }
    return true;
  };

  const blocks = [];
  let current = null;
  for (const comment of comments) {
    const starter = comment.text.startsWith('//') ? 'line' : comment.text.startsWith('/*') ? 'block' : null;
    const fullLine = isFullLine(comment);
    let continues = false;
    if (current?.kind === 'block' && !current.closed) {
      continues = comment.line === current.end + 1;
      current.closed = comment.text.includes('*/');
    } else if (current?.kind === 'line' && starter === 'line' && current.fullLine && fullLine) {
      continues = comment.line === current.end + 1 || onlyBlankBetween(current.end + 1, comment.line);
    }
    if (continues) {
      current.end = comment.line;
      current.lines += 1;
    } else {
      const kind = starter ?? 'block';
      const closed = kind === 'line' || comment.text.indexOf('*/', 2) !== -1;
      current = { kind, start: comment.line, end: comment.line, lines: 1, closed, fullLine };
      blocks.push(current);
    }
  }
  return blocks;
}

const overLimit = (block) =>
  (block.kind === 'line' && block.lines > LINE_STACK_MAX) || (block.kind === 'block' && block.lines > BLOCK_MAX);

// Adjacent full-line blocks of different kinds (a // stack straight into a
// JSDoc) are one run of comment lines; the block cap applies to the run as a
// whole. Trailing comments never join a run.
function contiguousRuns(blocks) {
  const runs = [];
  for (const block of blocks.filter((candidate) => candidate.fullLine)) {
    const last = runs.at(-1);
    if (last && block.start === last.end + 1) {
      last.end = block.end;
      last.lines += block.lines;
      last.blocks.push(block);
    } else {
      runs.push({ kind: 'run', start: block.start, end: block.end, lines: block.lines, blocks: [block] });
    }
  }
  return runs;
}

// Blocks over the cap that hold at least one added line, measured over `all`
// (every comment of `content`) so an edit that grows an existing block to seven
// lines is caught, not just a seven-line paste.
export function lengthViolations(comments, { all = comments, content = '' } = {}) {
  const touched = (block) => comments.some((comment) => comment.line >= block.start && comment.line <= block.end);
  const blocks = groupBlocks(all, content);
  const violations = blocks.filter((block) => overLimit(block) && touched(block));
  const runs = contiguousRuns(blocks).filter(
    (run) => run.blocks.length > 1 && run.lines > BLOCK_MAX && touched(run) && !run.blocks.some(overLimit),
  );
  return [...violations, ...runs]
    .map(({ kind, start, end, lines }) => ({ kind, start, end, lines }))
    .sort((left, right) => left.start - right.start);
}

function describe(block) {
  const where = block.start === block.end ? `L${block.start}` : `L${block.start}–L${block.end}`;
  if (block.kind === 'line') return `  • ${where}: // stack, ${block.lines} lines (max ${LINE_STACK_MAX})`;
  if (block.kind === 'block') return `  • ${where}: /* */ block, ${block.lines} lines (max ${BLOCK_MAX})`;
  return `  • ${where}: ${block.lines} consecutive comment lines across blocks (max ${BLOCK_MAX})`;
}

export function lengthDeny(file, violations) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: [
        `Blocked: an over-long comment added to ${file} (/comment: one comment, one fact).`,
        `A // stack over ${LINE_STACK_MAX} lines, or a /** */ block or run of comment lines over ${BLOCK_MAX}, is an essay however true each line is. Cut it to the fact the next editor would mis-edit without; a kept declaration comment goes in a /** */ block.`,
        ...violations.map(describe),
      ].join('\n'),
    },
  };
}

// Short comments get capped thinking (enough to spot restatement, ~12 s); a
// 4–6 line block gets full thinking and a longer timeout — the band where an
// essay survives the length rule and capped thinking measurably lets it through.
export function judgeTier(comments, { all = comments, content = '' } = {}) {
  const touched = (block) => comments.some((comment) => comment.line >= block.start && comment.line <= block.end);
  const longest = Math.max(0, ...commentBlocks(all, content).filter(touched).map((block) => block.lines));
  return longest > LINE_STACK_MAX
    ? { name: 'long', thinkingTokens: null, timeoutMs: 120_000 }
    : { name: 'short', thinkingTokens: 1024, timeoutMs: 60_000 };
}

// --- fresh-context judge (escalation) ---

const JUDGE_ATTEMPTS = 2;
const JUDGE_ARGS = ['-p', '--output-format', 'json', '--model', 'haiku', '--disallowedTools', 'Write', 'Edit'];
const skillPath = fileURLToPath(new URL('../skills/comment/SKILL.md', import.meta.url));
// The hook lives in the plugin cache, so the docs walk is rooted at the
// project being edited, not at this file.
const repoRoot = `${resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd())}/`;

// Nearest CLAUDE.md + README walking up from the target to the repo root — the
// domain facts a comment might merely restate, which the judge weighs against.
function nearestDocs(file, readFile) {
  const docs = [];
  const want = new Set(['CLAUDE.md', 'README.md']);
  let dir = dirname(resolve(repoRoot, file));
  while (dir.startsWith(repoRoot) && want.size) {
    for (const name of [...want]) {
      const path = join(dir, name);
      const text = existsSync(path) ? safeRead(readFile, path) : null;
      if (text) {
        docs.push({ path: path.slice(repoRoot.length), text });
        want.delete(name);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return docs;
}

function buildJudgePrompt(file, comments, content, rulebook, docs) {
  const flagged = comments.map((comment) => `  L${comment.line}: ${comment.text}`).join('\n');
  const docBlocks = docs.map((doc) => `### ${doc.path}\n${doc.text}`).join('\n\n') || '(none)';
  // These four strings restate points in the rulebook on purpose: the judge
  // mis-cut with the rulebook alone. SKILL.md's maintainer note names them;
  // change them together.
  return [
    'You are a fresh-context code-comment judge. You did not write this code and have no stake in it.',
    'Apply the delete-test from the rulebook to EACH flagged comment line: would a competent editor working AT THIS LINE mis-edit the code without the comment? Keep a why / constraint / footgun / gotcha / anchor a reader at this line needs; cut only what restates the adjacent code or narrates obvious steps.',
    '',
    'IMPORTANT — overlap with a domain doc is NOT grounds to cut. A footgun or why belongs at the code site even when a CLAUDE.md or README also covers the topic: the audiences differ (a doc says "this kind of thing exists across the domain"; a code comment says "this specific thing, here"), the editor at this line may not have the doc open, and docs are themselves trimmed for brevity — so a load-bearing comment must not depend on the doc surviving. Cut for redundancy only when the comment adds nothing a reader AT THIS LINE needs: pure restatement of the adjacent code, step narration, or doc prose copied verbatim with no code-site-specific point. When unsure, keep it.',
    'ALSO — the public-API exception. A brief JSDoc on an EXPORTED / public class, interface, type, method, or function is load-bearing when it helps a CONSUMER who references the symbol from another file — VSCode shows it as a hover tooltip — even though the editor at the definition would not mis-edit without it. This is the one place "helps a reader elsewhere" counts and the one sanctioned "what is this." It is optional, never required: keep such a JSDoc only where a consumer is genuinely helped (a "what is this" on a model/interface; a note on an API-service method about anything unusual in the endpoint), and STILL cut a JSDoc that merely restates the signature the tooltip already shows or narrates the body. This exception is for public API surface only — it does not loosen the mis-edit test for ordinary in-body comments.',
    'FORM, NOT SUBSTANCE — the JSDoc-form preference is NEVER a reason to cut. When a KEPT comment describes a whole declaration (a function, class, method, interface, or type) and runs to more than three lines, the rulebook prefers it be written as a /** … */ block so it surfaces as an editor tooltip. That is purely a form preference for a comment that already earned its place: a load-bearing comment in the wrong form (a // stack or a plain /* */ block) STILL PASSES — set keep:true. Never set keep:false because of form; form is advisory and the review-time audit notes it separately.',
    '',
    '## Rulebook (/comment skill)',
    rulebook,
    '',
    '## Nearest domain docs (context for the domain — overlap is not itself a reason to cut)',
    docBlocks,
    '',
    `## Proposed content of ${file}`,
    '```',
    content,
    '```',
    '',
    '## Flagged added comment lines',
    flagged,
    '',
    'Respond with ONLY a compact JSON object — no prose, no markdown fence:',
    '{"allow": <true iff EVERY flagged line is load-bearing>, "lines": [{"line": <n>, "keep": <bool>, "reason": "<short>"}]}',
  ].join('\n');
}

// Extracts the verdict from the `claude -p --output-format json` envelope's
// `.result`. Returns null (or throws — runJudge catches it) when no trustworthy
// verdict is present; a no-verdict result makes the hook fail OPEN, not deny.
export function parseVerdict(stdout) {
  const envelope = JSON.parse(stdout);
  if (envelope.is_error || typeof envelope.result !== 'string') return null;
  const match = envelope.result.match(/\{[\s\S]*\}/);
  if (!match) return null;
  const verdict = JSON.parse(match[0]);
  return typeof verdict.allow === 'boolean' ? verdict : null;
}

function judgeEnv(tier) {
  const env = { ...process.env, CLAUDE_COMMENT_GATE_JUDGE: '1' };
  if (tier.thinkingTokens) env.MAX_THINKING_TOKENS = String(tier.thinkingTokens);
  else delete env.MAX_THINKING_TOKENS;
  return env;
}

// `spawn` is injectable so a spec can pin the tier's timeout and thinking budget
// reaching the child without running a judge.
export function runJudge({ file, comments, content, tier }, readFile, spawn = spawnSync) {
  const rulebook = safeRead(readFile, skillPath) ?? '';
  const prompt = buildJudgePrompt(file, comments, content, rulebook, nearestDocs(file, readFile));
  // Retry once with a longer timeout — an occasional timeout or transient API
  // error is not a verdict and must not become a false deny; a slow first call
  // gets more room on the retry instead of hitting the same wall.
  for (let attempt = 0; attempt < JUDGE_ATTEMPTS; attempt += 1) {
    const run = spawn('claude', JUDGE_ARGS, {
      input: prompt,
      encoding: 'utf8',
      timeout: tier.timeoutMs * (attempt + 1),
      maxBuffer: 16 * 1024 * 1024,
      env: judgeEnv(tier),
    });
    if (run.status === 0 && run.stdout) {
      try {
        const verdict = parseVerdict(run.stdout);
        if (verdict) return verdict;
      } catch {
        // fall through to the next attempt
      }
    }
  }
  return null;
}

export function denyFromVerdict(file, verdict) {
  const lines = verdict.lines ?? [];
  const cut = lines.filter((line) => line.keep === false);
  const listed = (cut.length ? cut : lines).slice(0, MAX_SHOWN);
  const shown = listed.map((line) => `  • L${line.line}: ${truncate(line.reason ?? 'not load-bearing')}`);
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: [
        `Blocked: the comment judge rejected added comment line(s) in ${file} (/comment delete-test).`,
        'Cut or rewrite these, then retry — keep only a why / constraint / footgun / anchor the code cannot carry:',
        ...shown,
      ].join('\n'),
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Recursion guard: the judge runs a nested `claude`, which loads this same
  // hook — a set guard var makes that nested invocation a no-op.
  if (process.env.CLAUDE_COMMENT_GATE_JUDGE) process.exit(0);
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    process.exit(0);
  }
  const readFile = (file) => readFileSync(file, 'utf8');
  const detected = decidePre(input, readFile);
  if (!detected) process.exit(0);

  const { file, comments, all, content } = addedComments(input, readFile);
  const violations = lengthViolations(comments, { all, content });
  if (violations.length) {
    process.stdout.write(JSON.stringify(lengthDeny(file, violations)));
    process.exit(0);
  }
  const tier = judgeTier(comments, { all, content });
  const verdict = runJudge({ file, comments, content, tier }, readFile);
  if (!verdict) {
    // Judge unavailable after a retry — fail OPEN. A failed judge is not a bad
    // comment; blocking here would punish infra flakiness. A review-time comment
    // audit is the backstop. Leave a breadcrumb on stderr.
    process.stderr.write(
      `comment-gate: ${tier.name}-tier judge unavailable for ${file}; allowed ${comments.length} unreviewed comment line(s)\n`,
    );
    process.exit(0);
  }
  if (verdict.allow) process.exit(0);
  process.stdout.write(JSON.stringify(denyFromVerdict(file, verdict)));
  process.exit(0);
}
