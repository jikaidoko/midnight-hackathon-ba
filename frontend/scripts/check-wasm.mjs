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

// The wasm carriers, plus `compact-runtime`.
//
// `compact-runtime` was previously left out as "plain JavaScript: two copies of
// it are harmless as long as they resolve to the same runtime underneath". That
// condition is precisely the one that fails. It is the module that builds a
// `QueryContext`, and it reaches the runtime through its OWN resolution - so a
// second copy of it selects a second `onchain-runtime-v3`, and the browser dies
// with `expected instance of ChargedState` while every version reported here
// matches.
const PACKAGES = [
  '@midnight-ntwrk/ledger-v8',
  '@midnight-ntwrk/onchain-runtime-v3',
  '@midnight-ntwrk/compact-runtime',
];

/**
 * Packages the bundler is told to collapse to one copy.
 *
 * Read out of the config rather than restated here: a list that can drift from
 * the thing it describes is worse than no list. A missing block is a hard
 * failure for the same reason an uninstalled tree is - the check would otherwise
 * pass without having measured its subject.
 */
async function dedupedPackages() {
  const configPath = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
  const source = await readFile(configPath, 'utf8');
  const block = /dedupe\s*:\s*\[([^\]]*)\]/.exec(source);
  if (!block) {
    throw new Error(
      `No \`resolve.dedupe\` block found in ${configPath}.\n` +
        '  Two trees feed the browser bundle, so every wasm package installed in both has to\n' +
        '  be deduped there or the page fails on the first decode. This check cannot verify an\n' +
        '  invariant the config no longer states.',
    );
  }
  return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

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
const deduped = await dedupedPackages();

for (const pkg of PACKAGES) {
  const versionsAcrossTrees = new Map();
  const pathsAcrossTrees = [];

  for (const tree of TREES) {
    const copies = await findCopies(tree.root, pkg);
    for (const copy of copies) pathsAcrossTrees.push({ tree: tree.name, ...copy });

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

  // The case MATCHING versions cannot reach, and the one that actually broke the
  // page: two separate installs of the same version are still two wasm
  // instances. Nothing in a version comparison can see it - this check reported
  // green for the whole time the control screens could not load.
  //
  // Two copies are fine when the bundler is told to collapse them, so that is
  // what is asserted rather than "exactly one copy": the trees are deliberately
  // unhoisted so each `overrides` block stays authoritative over its own.
  if (pathsAcrossTrees.length > 1 && !deduped.includes(pkg)) {
    problems.push(
      `${pkg} resolves to ${pathsAcrossTrees.length} separate installs and is NOT in\n` +
        '  `resolve.dedupe` in vite.config.ts:\n' +
        pathsAcrossTrees.map((copy) => `    ${copy.version}  ${copy.path}`).join('\n') +
        '\n  Same version is not the same instance. Each install carries its own wasm module\n' +
        '  owning its own classes, so a value built by one fails the other\'s type check -\n' +
        '  `expected instance of ChargedState` - after a query that succeeded. Add it to\n' +
        '  `resolve.dedupe`.',
    );
  }
}

if (problems.length > 0) {
  console.error('Duplicate or unverifiable WebAssembly packages:\n');
  console.error(problems.join('\n\n'));
  process.exit(1);
}

console.log("One instance per package in the browser bundle (deduped where installed twice):");
console.log(report.join('\n'));
