// isomorphic.test.ts — a source guard: the reporter's view must load in a browser.
//
// This is deliberately not a behaviour test, because a behaviour test cannot
// see this bug. `Buffer`, `process` and `node:*` all resolve in Node, so a view
// that uses them passes every simulator case and every typecheck, and then
// fails at module load in the browser it was written for. The only place the
// mistake is visible is the source.
//
// Scope is one file on purpose. `providers.ts` and `zk.ts` are Node-only by
// design — they read keys off disk and build a wallet from a seed — and a
// browser needs different implementations of both, not the same ones made
// portable. `derived-state.ts` is the opposite case: it is the piece a UI
// imports directly, so it is the piece that has to stay portable.
//
// The guard measures its own subject. A pattern that finds nothing is not a
// pass — an empty read, a moved file or a renamed export would all report clean
// while checking nothing at all, so the sentinel below fails loudly instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SUBJECT = fileURLToPath(new URL('./derived-state.ts', import.meta.url));

/** Node globals and imports that have no meaning in a browser. */
const NODE_ONLY = [
  { name: 'Buffer', pattern: /\bBuffer\b/ },
  { name: 'process', pattern: /\bprocess\.(env|argv|cwd)\b/ },
  { name: "node: import", pattern: /from\s+['"]node:/ },
  { name: '__dirname / __filename', pattern: /\b__(dirname|filename)\b/ },
];

/**
 * Comments are stripped before matching. Without this the guard fires on the
 * comment that explains why `Buffer` is absent, and the only way to stay green
 * would be to delete the explanation — a guard that forbids documenting its own
 * rule trains people to work around it.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

test('the reporter view is free of Node-only APIs', () => {
  const source = code(readFileSync(SUBJECT, 'utf8'));

  for (const { name, pattern } of NODE_ONLY) {
    assert.equal(
      pattern.test(source),
      false,
      `derived-state.ts uses ${name}, which does not exist in a browser. ` +
        'This module is imported by the UI: it has to load there.',
    );
  }
});

test('the guard can see its subject', () => {
  const source = code(readFileSync(SUBJECT, 'utf8'));

  // Sentinel: if this export ever stops being here, every assertion above is
  // scanning something that is no longer the reporter's view, and silence from
  // the loop above would mean nothing.
  assert.match(
    source,
    /export function deriveReporterView/,
    'Guard is not reading the reporter view; the checks above prove nothing.',
  );

  // A pattern that matches nothing anywhere is a broken pattern, not a clean
  // file. Proving each one still fires keeps the loop above honest.
  const canary = 'const b = Buffer.from([]); process.env.X; __dirname;\nimport x from "node:fs";';
  for (const { name, pattern } of NODE_ONLY) {
    assert.ok(pattern.test(canary), `Pattern for ${name} matches nothing; it cannot detect anything.`);
  }
});
