// isomorphic.test.ts — a source guard: the reporter's view must load in a browser.
//
// This is deliberately not a behaviour test, because a behaviour test cannot
// see this bug. `Buffer`, `process` and `node:*` all resolve in Node, so a view
// that uses them passes every simulator case and every typecheck, and then
// fails at module load in the browser it was written for. The only place the
// mistake is visible is the source.
//
// The scope is a list, not a directory sweep. `providers.ts`, `zk.ts` and
// `config.ts` are Node-only BY DESIGN — they read keys off disk, build a wallet
// from a seed, and parse an env file — and a browser needs different
// implementations, not portable versions of those. Sweeping the directory would
// flag them forever and the guard would be turned off.
//
// So the list names the modules a user interface imports, and adding one is a
// deliberate act. Each was made portable by removing a dependency that arrived
// through a convenience: `Buffer` for hex, and a `config = loadConfig()`
// default parameter that dragged `node:path` and `process.env` into every
// consumer that never called it.
//
// The guard measures its own subject. A pattern that finds nothing is not a
// pass — an empty read, a moved file or a renamed export would all report clean
// while checking nothing at all, so the sentinel below fails loudly instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SUBJECTS = [
  {
    // Both views a UI renders from. Naming them separately matters: they are
    // independent exports, so one can be moved out while the other keeps the
    // sentinel green and the guard goes on reporting clean about a file that no
    // longer holds what it is guarding.
    file: 'derived-state.ts',
    mustExport: [/export function deriveReporterView/, /export function derivePublicView/],
  },
  // Ledger decoding and the pure circuits that derive on-chain lookup keys.
  { file: 'ledger.ts', mustExport: [/export function filingNullifier/] },
] as const;

function sourceOf(file: string): string {
  return code(readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8'));
}

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

test('the modules a UI imports are free of Node-only APIs', () => {
  for (const { file } of SUBJECTS) {
    const source = sourceOf(file);
    for (const { name, pattern } of NODE_ONLY) {
      assert.equal(
        pattern.test(source),
        false,
        `${file} uses ${name}, which does not exist in a browser. ` +
          'This module is imported by the UI: it has to load there.',
      );
    }
  }
});

test('the guard can see its subjects', () => {
  // Sentinel: if a named export stops being where the guard looks, the loop
  // above is scanning something that is no longer the module it names, and its
  // silence would mean nothing.
  for (const { file, mustExport } of SUBJECTS) {
    for (const pattern of mustExport) {
      assert.match(
        sourceOf(file),
        pattern,
        `Guard is not reading ${file}; the checks above prove nothing about it.`,
      );
    }
  }

  // A pattern that matches nothing anywhere is a broken pattern, not a clean
  // file. Proving each one still fires keeps the loop above honest.
  const canary = 'const b = Buffer.from([]); process.env.X; __dirname;\nimport x from "node:fs";';
  for (const { name, pattern } of NODE_ONLY) {
    assert.ok(pattern.test(canary), `Pattern for ${name} matches nothing; it cannot detect anything.`);
  }
});
