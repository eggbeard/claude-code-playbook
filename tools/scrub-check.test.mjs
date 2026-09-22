import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHits, loadTerms, parseTerms } from './scrub-check.mjs';

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

test('parses terms from lines or commas, ignoring blanks and # comments', () => {
  assert.deepEqual(parseTerms('# names\nAcme\n\nwidgetco, Globex\n'), ['acme', 'widgetco', 'globex']);
});

test('the SCRUB_TERMS variable wins over the terms file', () => {
  assert.deepEqual(loadTerms({ SCRUB_TERMS: 'acme,widgetco' }, '/nonexistent'), ['acme', 'widgetco']);
});

test('no variable and no file yields no terms', () => {
  assert.deepEqual(loadTerms({}, '/nonexistent'), []);
});
