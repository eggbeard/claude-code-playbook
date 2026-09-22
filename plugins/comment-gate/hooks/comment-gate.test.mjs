// Tests for the PreToolUse comment-gate hook.
// Run: node --test plugins/comment-gate/hooks/comment-gate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectComments,
  addedComments,
  isGatedFile,
  decidePre,
  parseVerdict,
  commentBlocks,
  lengthViolations,
  lengthDeny,
  judgeTier,
  runJudge,
} from './comment-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'comment-gate.mjs');

// --- detectComments ---

test('detects a full-line // comment', () => {
  assert.deepEqual(detectComments('  // explain\nconst x = 1;'), [{ line: 1, text: '// explain' }]);
});

test('detects a trailing // comment after code', () => {
  const found = detectComments('const x = 1; // why');
  assert.deepEqual(found, [{ line: 1, text: '// why' }]);
});

test('does NOT flag // inside a string literal (URL)', () => {
  assert.deepEqual(detectComments(`const url = 'https://example.com';`), []);
});

test('does NOT flag // inside a multi-line template literal', () => {
  const content = ['const text = `', '  see https://a.example', '  and https://b.example', '`;', '// real'].join('\n');
  assert.deepEqual(detectComments(content), [{ line: 5, text: '// real' }]);
});

test('a backtick inside a // comment does not open a template literal on the next line', () => {
  assert.deepEqual(detectComments('// the `x\n// next'), [
    { line: 1, text: '// the `x' },
    { line: 2, text: '// next' },
  ]);
});

test('flags a trailing comment even when the line also holds a URL string', () => {
  const found = detectComments(`const url = 'https://x'; // real`);
  assert.deepEqual(found, [{ line: 1, text: '// real' }]);
});

test('detects a multi-line /* */ block including its continuation lines', () => {
  const found = detectComments('/* one\n * two\n */\ncode();');
  assert.deepEqual(found.map((comment) => comment.line), [1, 2, 3]);
});

test('skips a /// <reference /> directive', () => {
  assert.deepEqual(detectComments('/// <reference types="node" />\n/// plain'), [{ line: 2, text: '/// plain' }]);
});

// --- addedComments ---

test('Write: reports every comment in the new content when the file is new', () => {
  const payload = {
    tool_name: 'Write',
    tool_input: { file_path: 'x.ts', content: '// a\nconst x = 1; // b' },
  };
  const { comments, all, content } = addedComments(payload, () => '');
  assert.deepEqual(comments.map((comment) => comment.text), ['// a', '// b']);
  assert.deepEqual(all, comments);
  assert.equal(content, payload.tool_input.content);
});

test('Write over an existing file: only comments absent from disk are added, all still carries every one', () => {
  const disk = '/**\n * kept\n */\nconst x = 1;';
  const payload = {
    tool_name: 'Write',
    tool_input: { file_path: 'x.ts', content: '/**\n * kept\n */\nconst x = 1;\n// new' },
  };
  const { comments, all } = addedComments(payload, () => disk);
  assert.deepEqual(comments, [{ line: 5, text: '// new' }]);
  assert.equal(all.length, 4);
});

test('Edit: reports only comments added vs old_string, at their line in the edited file', () => {
  const payload = {
    tool_name: 'Edit',
    tool_input: {
      file_path: 'x.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 1;\n// added',
    },
  };
  const disk = 'lineA\nlineB\nconst x = 1;\nlineC';
  const { comments, content } = addedComments(payload, () => disk);
  assert.deepEqual(comments, [{ line: 4, text: '// added' }]);
  assert.equal(content, 'lineA\nlineB\nconst x = 1;\n// added\nlineC');
});

test('Edit: an added comment whose text already exists elsewhere on disk does not hide the others', () => {
  const payload = {
    tool_name: 'Edit',
    tool_input: {
      file_path: 'x.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 1;\n// dup\n// one\n// two\n// three',
    },
  };
  const disk = '// dup\nconst x = 1;';
  const { comments } = addedComments(payload, () => disk);
  assert.deepEqual(comments.map((comment) => comment.text), ['// dup', '// one', '// two', '// three']);
});

test('Edit: falls back to new_string line numbers when old_string is not on disk', () => {
  const payload = {
    tool_name: 'Edit',
    tool_input: { file_path: 'x.ts', old_string: 'gone', new_string: 'code();\n// added' },
  };
  const { comments, content } = addedComments(payload, () => 'unrelated');
  assert.deepEqual(comments, [{ line: 2, text: '// added' }]);
  assert.equal(content, 'code();\n// added');
});

test('Edit: a comment already present in old_string is not flagged', () => {
  const payload = {
    tool_name: 'Edit',
    tool_input: {
      file_path: 'x.ts',
      old_string: '// keep\nconst x = 1;',
      new_string: '// keep\nconst x = 2;',
    },
  };
  assert.deepEqual(addedComments(payload, () => '').comments, []);
});

// --- isGatedFile ---

test('gates production TS under apps/**/src and libs/**/src (incl. nested lib types)', () => {
  assert.equal(isGatedFile('libs/users/feature/src/lib/foo.ts'), true);
  assert.equal(isGatedFile('apps/web/src/app/app.config.ts'), true);
  assert.equal(isGatedFile('/abs/path/libs/catalogue/data-access/src/lib/x.ts'), true);
});

test('does not gate specs, test utilities, non-src, non-TS, or root files', () => {
  assert.equal(isGatedFile('libs/users/feature/src/lib/foo.spec.ts'), false);
  assert.equal(isGatedFile('libs/users/feature/src/lib/foo.test.ts'), false);
  assert.equal(isGatedFile('libs/users/feature/src/test-utils.ts'), false);
  assert.equal(isGatedFile('libs/users/feature/src/lib/foo.mock.ts'), false);
  assert.equal(isGatedFile('libs/users/feature/src/testing/harness.ts'), false);
  assert.equal(isGatedFile('libs/users/README.md'), false);
  assert.equal(isGatedFile('libs/users/feature/src/lib/foo.html'), false);
  assert.equal(isGatedFile('foo.ts'), false);
  assert.equal(isGatedFile('.claude/hooks/comment-gate.mjs'), false);
});

// --- decidePre ---

test('decidePre denies a gated write that adds a comment', () => {
  const payload = { tool_name: 'Write', tool_input: { file_path: 'libs/x/feature/src/lib/a.ts', content: '// why\ncode();' } };
  const decision = decidePre(payload, () => '');
  assert.equal(decision.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(decision.hookSpecificOutput.permissionDecisionReason, /L1: \/\/ why/);
});

test('decidePre stays silent (null) for a comment-free gated write', () => {
  const payload = { tool_name: 'Write', tool_input: { file_path: 'libs/x/feature/src/lib/a.ts', content: 'const x = 1;' } };
  assert.equal(decidePre(payload, () => ''), null);
});

test('decidePre stays silent for a spec file even with comments', () => {
  const payload = { tool_name: 'Write', tool_input: { file_path: 'libs/x/feature/src/lib/a.spec.ts', content: '// why\ncode();' } };
  assert.equal(decidePre(payload, () => ''), null);
});

test('decidePre stays silent for a non-gated path even with comments', () => {
  const payload = { tool_name: 'Write', tool_input: { file_path: '.claude/hooks/x.mjs', content: '// why' } };
  assert.equal(decidePre(payload, () => ''), null);
});

test('decidePre ignores tools other than Write/Edit', () => {
  assert.equal(decidePre({ tool_name: 'Read', tool_input: { file_path: 'libs/x/feature/src/lib/a.ts' } }, () => ''), null);
});

test('decidePre is disabled by CLAUDE_COMMENT_GATE_OFF', () => {
  const payload = { tool_name: 'Write', tool_input: { file_path: 'libs/x/feature/src/lib/a.ts', content: '// why' } };
  process.env.CLAUDE_COMMENT_GATE_OFF = '1';
  try {
    assert.equal(decidePre(payload, () => ''), null);
  } finally {
    delete process.env.CLAUDE_COMMENT_GATE_OFF;
  }
});

// --- length rule and judge tier ---

const lines = (...texts) => texts.map((text, index) => ({ line: index + 1, text }));
const blocksOf = (content) => commentBlocks(detectComments(content), content);

test('commentBlocks groups a // stack, a JSDoc block, and a lone trailing comment', () => {
  const comments = [
    ...lines('// a', '// b', '/** open', ' * body', ' */'),
    { line: 9, text: '// trailing' },
  ];
  assert.deepEqual(commentBlocks(comments), [
    { kind: 'line', start: 1, end: 2, lines: 2 },
    { kind: 'block', start: 3, end: 5, lines: 3 },
    { kind: 'line', start: 9, end: 9, lines: 1 },
  ]);
});

test('a /* */ block whose continuation lines begin with // is one block, not // fragments', () => {
  const content = ['/*', '// one', '// two', '// three', '// four', '// five', '// six', '*/'].join('\n');
  assert.deepEqual(blocksOf(content), [{ kind: 'block', start: 1, end: 8, lines: 8 }]);
  assert.equal(lengthViolations(detectComments(content), { content }).length, 1);
});

test('a // stack continues across a blank line but not across a code line', () => {
  const paragraphs = ['// one', '// two', '', '// three', '// four'].join('\n');
  assert.deepEqual(blocksOf(paragraphs), [{ kind: 'line', start: 1, end: 5, lines: 4 }]);
  const stepped = ['// one', 'a();', '// two', 'b();', '// three', 'c();', '// four'].join('\n');
  assert.equal(blocksOf(stepped).length, 4);
  assert.equal(lengthViolations(detectComments(stepped), { content: stepped }).length, 0);
});

test('trailing comments on consecutive code lines are separate blocks, not a stack', () => {
  const content = ['x([', '  A, // a', '  B, // b', '  C, // c', '  D, // d', ']);'].join('\n');
  assert.equal(blocksOf(content).length, 4);
  assert.equal(lengthViolations(detectComments(content), { content }).length, 0);
});

test('lengthViolations flags a four-line // stack and a seven-line block, not the limits themselves', () => {
  assert.equal(lengthViolations(lines('// 1', '// 2', '// 3')).length, 0);
  assert.equal(lengthViolations(lines('// 1', '// 2', '// 3', '// 4')).length, 1);
  assert.equal(lengthViolations(lines('/**', ' * 2', ' * 3', ' * 4', ' * 5', ' */')).length, 0);
  assert.equal(lengthViolations(lines('/**', ' * 2', ' * 3', ' * 4', ' * 5', ' * 6', ' */')).length, 1);
});

test('lengthViolations measures the whole block an edit grows, and ignores untouched blocks', () => {
  const content = ['/**', ' * 2', ' * 3', ' * 4', ' * 5', ' * 6', ' */', 'code();', '// 9', '// 10', '// 11', '// 12'].join('\n');
  const all = detectComments(content);
  const grown = lengthViolations([{ line: 4, text: ' * 4' }], { all, content });
  assert.deepEqual(grown, [{ kind: 'block', start: 1, end: 7, lines: 7 }]);
});

test('a // stack running straight into a block is capped as one run of comment lines', () => {
  const content = ['// 1', '// 2', '// 3', '/**', ' * 5', ' * 6', ' * 7', ' * 8', ' */', 'code();'].join('\n');
  const violations = lengthViolations(detectComments(content), { content });
  assert.deepEqual(violations, [{ kind: 'run', start: 1, end: 9, lines: 9 }]);
  assert.match(lengthDeny('a.ts', violations).hookSpecificOutput.permissionDecisionReason, /9 consecutive comment lines/);
});

test('lengthDeny names each violation with its range, kind, and count', () => {
  const reason = lengthDeny('a.ts', [
    { kind: 'line', start: 1, end: 4, lines: 4 },
    { kind: 'block', start: 10, end: 17, lines: 8 },
  ]).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /L1–L4: \/\/ stack, 4 lines \(max 3\)/);
  assert.match(reason, /L10–L17: \/\* \*\/ block, 8 lines \(max 6\)/);
});

test('judgeTier caps thinking for short comments and lifts it for a 4–6 line block', () => {
  assert.equal(judgeTier(lines('// why', '// more')).name, 'short');
  assert.equal(judgeTier(lines('// why', '// more')).thinkingTokens, 1024);
  const long = judgeTier(lines('/**', ' * 2', ' * 3', ' * 4', ' */'));
  assert.equal(long.name, 'long');
  assert.equal(long.thinkingTokens, null);
  assert.equal(long.timeoutMs, 120_000);
});

test('judgeTier is chosen by the whole block an edit touches', () => {
  const content = ['/**', ' * 2', ' * 3', ' * 4', ' */'].join('\n');
  const all = detectComments(content);
  assert.equal(judgeTier([{ line: 3, text: ' * 3' }], { all, content }).name, 'long');
});

// --- runJudge: what reaches the spawned judge ---

const verdictEnvelope = JSON.stringify({ is_error: false, result: '{"allow": true, "lines": []}' });

function recordingSpawn(results) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    return results[calls.length - 1] ?? results.at(-1);
  };
  return { spawn, calls };
}

test('runJudge passes the tier timeout and thinking budget to the child, and doubles the timeout on retry', () => {
  const failed = { status: 1, stdout: '' };
  const passed = { status: 0, stdout: verdictEnvelope };
  const { spawn, calls } = recordingSpawn([failed, passed]);
  const tier = judgeTier(lines('// why'));
  const verdict = runJudge({ file: 'a.ts', comments: lines('// why'), content: '// why', tier }, () => '', spawn);
  assert.equal(verdict.allow, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'claude');
  assert.equal(calls[0].options.timeout, 60_000);
  assert.equal(calls[1].options.timeout, 120_000);
  assert.equal(calls[0].options.env.MAX_THINKING_TOKENS, '1024');
  assert.equal(calls[0].options.env.CLAUDE_COMMENT_GATE_JUDGE, '1');
});

test('runJudge lifts the thinking cap and uses the long timeout for the long tier', () => {
  const { spawn, calls } = recordingSpawn([{ status: 0, stdout: verdictEnvelope }]);
  const tier = { name: 'long', thinkingTokens: null, timeoutMs: 120_000 };
  runJudge({ file: 'a.ts', comments: lines('// why'), content: '// why', tier }, () => '', spawn);
  assert.equal(calls[0].options.timeout, 120_000);
  assert.equal('MAX_THINKING_TOKENS' in calls[0].options.env, false);
});

test('runJudge returns null after both attempts fail', () => {
  const { spawn, calls } = recordingSpawn([{ status: 1, stdout: '' }]);
  const tier = judgeTier(lines('// why'));
  assert.equal(runJudge({ file: 'a.ts', comments: lines('// why'), content: '// why', tier }, () => '', spawn), null);
  assert.equal(calls.length, 2);
});

// --- end-to-end: the script reads stdin and emits per the hook contract ---
// A fake `claude` on PATH records the environment it was called with and returns
// a canned verdict, so no test here makes a live model call.

const FAKE_CLAUDE = `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({
  thinking: process.env.MAX_THINKING_TOKENS ?? null,
  guard: process.env.CLAUDE_COMMENT_GATE_JUDGE ?? null,
}));
if (process.env.FAKE_CLAUDE_FAIL) process.exit(1);
process.stdout.write(JSON.stringify({
  is_error: false,
  result: JSON.stringify({ allow: false, lines: [{ line: 1, keep: false, reason: 'restates' }] }),
}));
`;

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'comment-gate-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE);
  chmodSync(join(bin, 'claude'), 0o755);
  const log = join(root, 'judge.json');
  const gated = join(root, 'libs/x/feature/src/lib/a.ts');
  mkdirSync(dirname(gated), { recursive: true });
  const runHook = (payload, extraEnv = {}) =>
    spawnSync('node', [script], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_CLAUDE_LOG: log, ...extraEnv },
    });
  const judgeSaw = () => (existsSync(log) ? JSON.parse(readFileSync(log, 'utf8')) : null);
  return { gated, runHook, judgeSaw };
}

const reasonOf = (result) => JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason;

test('e2e: an over-long // stack is denied without a judge call', () => {
  const { gated, runHook, judgeSaw } = sandbox();
  const result = runHook({
    tool_name: 'Write',
    tool_input: { file_path: gated, content: '// one\n// two\n// three\n// four\ncode();' },
  });
  assert.equal(result.status, 0);
  assert.match(reasonOf(result), /over-long comment/);
  assert.match(reasonOf(result), /\/\/ stack, 4 lines/);
  assert.equal(judgeSaw(), null, 'the length rule must not spawn the judge');
});

test('e2e: an Edit that grows an on-disk block past six lines is denied by length, without a judge call', () => {
  const { gated, runHook, judgeSaw } = sandbox();
  writeFileSync(gated, '/**\n * one\n * two\n * three\n * four\n */\ncode();\n');
  const result = runHook({
    tool_name: 'Edit',
    tool_input: { file_path: gated, old_string: ' * four\n */', new_string: ' * four\n * five\n * six\n */' },
  });
  assert.equal(result.status, 0);
  assert.match(reasonOf(result), /L1–L8: \/\* \*\/ block, 8 lines/);
  assert.equal(judgeSaw(), null);
});

test('e2e: an Edit adding a four-line // stack is denied by length', () => {
  const { gated, runHook, judgeSaw } = sandbox();
  writeFileSync(gated, 'const x = 1;\ncode();\n');
  const result = runHook({
    tool_name: 'Edit',
    tool_input: { file_path: gated, old_string: 'const x = 1;', new_string: 'const x = 1;\n// a\n// b\n// c\n// d' },
  });
  assert.match(reasonOf(result), /L2–L5: \/\/ stack, 4 lines/);
  assert.equal(judgeSaw(), null);
});

test('e2e: a short comment reaches the judge in the short tier and its verdict denies', () => {
  const { gated, runHook, judgeSaw } = sandbox();
  const result = runHook({ tool_name: 'Write', tool_input: { file_path: gated, content: '// explain\ncode();' } });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.match(reasonOf(result), /comment judge rejected/);
  assert.deepEqual(judgeSaw(), { thinking: '1024', guard: '1' });
});

test('e2e: a five-line block reaches the judge in the long tier (no thinking cap)', () => {
  const { gated, runHook, judgeSaw } = sandbox();
  const result = runHook({
    tool_name: 'Write',
    tool_input: { file_path: gated, content: '/**\n * a\n * b\n * c\n */\ncode();' },
  });
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(judgeSaw(), { thinking: null, guard: '1' });
});

test('e2e: an unavailable judge fails open with a stderr breadcrumb', () => {
  const { gated, runHook } = sandbox();
  const result = runHook(
    { tool_name: 'Write', tool_input: { file_path: gated, content: '// explain\ncode();' } },
    { FAKE_CLAUDE_FAIL: '1' },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '');
  assert.match(result.stderr, /short-tier judge unavailable/);
});

test('e2e: the hook stays silent on a comment-free gated write', () => {
  const { gated, runHook, judgeSaw } = sandbox();
  const result = runHook({ tool_name: 'Write', tool_input: { file_path: gated, content: 'const x = 1;' } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '');
  assert.equal(judgeSaw(), null);
});

test('e2e: rewriting a file whole re-judges nothing it already carried', () => {
  const { gated, runHook, judgeSaw } = sandbox();
  const existing = '/**\n * 1\n * 2\n * 3\n * 4\n * 5\n * 6\n */\nconst x = 1;\n';
  writeFileSync(gated, existing);
  const result = runHook({ tool_name: 'Write', tool_input: { file_path: gated, content: existing.replace('1;', '2;') } });
  assert.equal(result.stdout.trim(), '');
  assert.equal(judgeSaw(), null);
});

// --- parseVerdict (fail-closed on anything unexpected) ---

const envelope = (result, isError = false) => JSON.stringify({ is_error: isError, result });

test('parseVerdict reads allow/lines from a clean envelope', () => {
  const verdict = parseVerdict(envelope('{"allow": false, "lines": [{"line": 1, "keep": false, "reason": "restates"}]}'));
  assert.equal(verdict.allow, false);
  assert.equal(verdict.lines[0].keep, false);
});

test('parseVerdict extracts the JSON even when wrapped in prose or a fence', () => {
  const verdict = parseVerdict(envelope('Here is my verdict:\n```json\n{"allow": true, "lines": []}\n```'));
  assert.equal(verdict.allow, true);
});

test('parseVerdict returns null on an error envelope', () => {
  assert.equal(parseVerdict(envelope('{"allow": true}', true)), null);
});

test('parseVerdict returns null when result has no JSON', () => {
  assert.equal(parseVerdict(envelope('the model refused')), null);
});

test('parseVerdict returns null when allow is not a boolean', () => {
  assert.equal(parseVerdict(envelope('{"lines": []}')), null);
});

test('trailing comments never join a run, even ten of them on adjacent lines', () => {
  const content = ['x([', ...Array.from({ length: 10 }, (_, index) => `  E${index}, // e${index}`), ']);'].join('\n');
  assert.equal(lengthViolations(detectComments(content), { content }).length, 0);
});

test('Edit inside an open JSDoc: the lines old_string already had are not added, the new ones are', () => {
  const disk = '/**\n * one\n * two\n */\ncode();';
  const payload = {
    tool_name: 'Edit',
    tool_input: { file_path: 'x.ts', old_string: ' * two\n */', new_string: ' * two\n * three\n */' },
  };
  const { comments, all } = addedComments(payload, () => disk);
  assert.deepEqual(comments, [{ line: 4, text: '* three' }]);
  assert.equal(all.length, 5);
});

// --- GATED_PATH is the one constant a project changes ---

test('paths outside the default apps/libs tree are not gated', () => {
  assert.equal(isGatedFile('src/lib/thing.ts'), false);
  assert.equal(isGatedFile('packages/core/src/thing.ts'), false);
});
