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
