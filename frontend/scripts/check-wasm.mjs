// check-wasm.mjs - one WebAssembly instance per package, across every tree the
// browser bundle draws from.
//
// Each of these packages carries its own wasm instance owning its own classes,
// so an object built by one copy fails the other's internal type check:
// "expected instance of LedgerParameters", "expected instance of StateValue".
// Both surface from inside a dependency, during a deployment, with nothing
// pointing at the duplication. Neither the typecheck nor the tests can see it -
// none of them builds a transaction.
//
// This replaces a plain `npm ls` in this package, which measured the wrong
// subject. The browser graph spans TWO dependency trees, not one: nothing in
// `frontend/src` imports `@midnight-ntwrk/compact-runtime`, but the generated
// contract does, and it is reached through the `@amparo/generated` alias, so it
// resolves from `contracts/node_modules`. A check run here saw one version and
// reported success while the tree that actually supplies the runtime went
// unread. Two trees that each hold a single version can still hold two
// DIFFERENT versions, and that is the case this exists to catch.
//
// Failing when it cannot measure is deliberate. A guard that stays silent when
// its subject is missing is indistinguishable from one that approved.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// Only the wasm carriers. `compact-runtime` is plain JavaScript: two copies of
// it are harmless as long as they resolve to the same runtime underneath, which
// is what these two entries pin.
const PACKAGES = ['@midnight-ntwrk/ledger-v8', '@midnight-ntwrk/onchain-runtime-v3'];

const TREES = [
  { name: 'frontend', root: fileURLToPath(new URL('../node_modules', import.meta.url)) },
  { name: 'contracts', root: fileURLToPath(new URL('../../contracts/node_modules', import.meta.url)) },
];

/**
 * Every installed copy of `pkg` under a `node_modules` root, including the
 * nested copies npm creates when two dependents ask for incompatible ranges -
 * which is exactly how the second wasm instance appears.
 *
 * Descends only through `node_modules` directories rather than walking the
 * whole tree, so the cost stays proportional to the dependency graph.
 */
async function findCopies(nodeModules, pkg) {
  const found = [];
  const seen = new Set();

  async function scan(dir) {
    if (seen.has(dir)) return;
    seen.add(dir);

    const manifest = join(dir, pkg, 'package.json');
    try {
      const { version } = JSON.parse(await readFile(manifest, 'utf8'));
      found.push({ path: join(dir, pkg), version });
    } catch {
      // Not installed at this level. Nested levels are still worth reading.
    }

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.')) continue;

      // A scope directory holds packages, not a package itself.
      const packageDirs = entry.name.startsWith('@')
        ? (await readdir(join(dir, entry.name), { withFileTypes: true }))
            .filter((sub) => sub.isDirectory() || sub.isSymbolicLink())
            .map((sub) => join(dir, entry.name, sub.name))
        : [join(dir, entry.name)];

      for (const packageDir of packageDirs) {
        await scan(join(packageDir, 'node_modules'));
      }
    }
  }

  await scan(nodeModules);
  return found;
}

const problems = [];
const report = [];

for (const pkg of PACKAGES) {
  const versionsAcrossTrees = new Map();

  for (const tree of TREES) {
    const copies = await findCopies(tree.root, pkg);

    // The measurement guard. "Not installed" is not "installed once": both
    // trees feed the bundle, so an absent one means this run proved nothing.
    if (copies.length === 0) {
      problems.push(
        `${pkg} is not installed in the ${tree.name} tree (${tree.root}).\n` +
          `  Both trees supply the browser bundle, so this check cannot speak for the build.\n` +
          `  Run \`npm ci\` in ${tree.name}/ and try again.`,
      );
      continue;
    }

    const versions = [...new Set(copies.map((copy) => copy.version))];
    if (versions.length > 1) {
      problems.push(
        `${pkg} has ${versions.length} versions inside the ${tree.name} tree: ${versions.join(', ')}.\n` +
          copies.map((copy) => `  ${copy.version}  ${copy.path}`).join('\n'),
      );
    }

    for (const version of versions) {
      if (!versionsAcrossTrees.has(version)) versionsAcrossTrees.set(version, []);
      versionsAcrossTrees.get(version).push(tree.name);
    }
    report.push(`  ${pkg}  ${versions.join(', ')}  (${tree.name}, ${copies.length} copy/copies)`);
  }

  // The case a per-tree check cannot reach: one version each, two different
  // versions, two wasm instances in one page.
  if (versionsAcrossTrees.size > 1) {
    problems.push(
      `${pkg} differs BETWEEN trees: ` +
        [...versionsAcrossTrees]
          .map(([version, trees]) => `${version} in ${trees.join(' and ')}`)
          .join(', ') +
        '\n  Both reach the browser. Pin the same version in both `overrides` blocks.',
    );
  }
}

if (problems.length > 0) {
  console.error('Duplicate or unverifiable WebAssembly packages:\n');
  console.error(problems.join('\n\n'));
  process.exit(1);
}

console.log('One version per package, in every tree the bundle draws from:');
console.log(report.join('\n'));
