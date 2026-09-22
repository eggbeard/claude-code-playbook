#!/usr/bin/env node
// Fails CI when any file names the workspace this content was ported from. The
// terms are never committed: CI reads the SCRUB_TERMS secret, a local run reads
// the gitignored .scrub-terms file.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
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
  const terms = loadTerms();
  if (terms.length === 0) {
    console.error(`scrub-check: no terms configured; set SCRUB_TERMS or create ${TERMS_FILE} at the repo root.`);
    process.exit(2);
  }
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  let failed = false;
  for (const file of files) {
    const hits = findHits(readFileSync(join(repoRoot, file), 'utf8'), terms);
    for (const hit of hits) {
      failed = true;
      console.log(`${file}:${hit.line}: ${hit.term}`);
    }
  }
  if (failed) {
    console.error('scrub-check: source-workspace identifiers found; rewrite the lines above.');
    process.exit(1);
  }
  console.log(`scrub-check: clean (${terms.length} terms)`);
}
