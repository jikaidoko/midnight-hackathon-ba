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
// unread.
//
// WHAT IT MEASURES, precisely: the number of distinct RESOLVED PATHS holding
// each package, across both trees. Not version equality - that was the earlier
// predicate and it is the wrong one. The bundler keys modules by resolved path,
// so two copies at the SAME version are still two modules and still two wasm
// instances. Version differences are reported too, because they are the loudest
// symptom, but multiplicity is the property.
//
// WHAT IT STILL DOES NOT MEASURE: content identity at a single path. A copy
// patched in place, or left half-written by an interrupted install, reports its
// old version and passes here. Closing that means comparing lockfile integrity
// hashes, which is a different check.
//
// Failing when it cannot measure is deliberate, and it is enforced rather than
// asserted: every read distinguishes "absent here, keep looking" from "I could
// not read this". A guard that stays silent when its subject is missing is
// indistinguishable from one that approved.

import { readdir, readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// Only the wasm carriers. `compact-runtime` is plain JavaScript, but it
// re-exports the wasm classes from `onchain-runtime-v3`, so its instance
// identity follows that package rather than standing on its own - which is why
// pinning these two is what keeps its re-export surface single.
const PACKAGES = ['@midnight-ntwrk/ledger-v8', '@midnight-ntwrk/onchain-runtime-v3'];

const TREES = [
  { name: 'frontend', root: fileURLToPath(new URL('../node_modules', import.meta.url)) },
  { name: 'contracts', root: fileURLToPath(new URL('../../contracts/node_modules', import.meta.url)) },
];

// Errors that mean "there is nothing here", as opposed to "I could not look".
// Everything else propagates: an unreadable subtree makes the run unable to
// speak for the build, and saying so is the whole point.
const ABSENT = new Set(['ENOENT', 'ENOTDIR']);

// This walk understands npm's layout - a package directory, optionally holding
// its own `node_modules`. Other installers do not lay out trees that way: pnpm
// keeps every real copy inside `.pnpm`, which this walk skips along with every
// other dot-directory. Rather than descend a layout it does not model, refuse
// to report on one.
const FOREIGN_LOCKFILES = ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'];

async function exists(path) {
  try {
    await realpath(path);
    return true;
  } catch (err) {
    if (ABSENT.has(err.code)) return false;
    throw err;
  }
}

/**
 * Whether this tree is laid out the way the walk below assumes. Returns a
 * reason when it is not, so the caller can fail loudly instead of walking a
 * structure where the copies live somewhere it never looks.
 */
async function foreignLayout(tree) {
  const packageDir = dirname(tree.root);

  for (const lockfile of FOREIGN_LOCKFILES) {
    if (await exists(join(packageDir, lockfile))) {
      return `${basename(packageDir)}/ has a ${lockfile}`;
    }
  }

  if (await exists(join(tree.root, '.pnpm'))) {
    return `${tree.name}/node_modules holds a .pnpm store`;
  }

  return null;
}

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
    // Identity is the resolved path, not the string that reached it. A junction
    // - what npm uses on Windows for `npm link` and `file:` dependencies -
    // reaches one directory under a second name: keyed on the string, this set
    // stops neither the double count nor the cycle, and a cycle only ends when
    // the path grows too long to read.
    let real;
    try {
      real = await realpath(dir);
    } catch (err) {
      if (ABSENT.has(err.code)) return;
      throw err;
    }
    if (seen.has(real)) return;
    seen.add(real);

    const manifest = join(real, pkg, 'package.json');
    try {
      const { version } = JSON.parse(await readFile(manifest, 'utf8'));
      found.push({ path: join(real, pkg), version });
    } catch (err) {
      // Absent here is ordinary - most levels hold no copy. Unreadable is not:
      // a truncated or locked manifest that is silently skipped is a copy this
      // run never counted, and the run would still print success.
      if (!ABSENT.has(err.code)) throw err;
    }

    const entries = await readdir(real, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith('.')) continue;

      // A scope directory holds packages, not a package itself.
      const packageDirs = entry.name.startsWith('@')
        ? (await readdir(join(real, entry.name), { withFileTypes: true }))
            .filter((sub) => sub.isDirectory() || sub.isSymbolicLink())
            .map((sub) => join(real, entry.name, sub.name))
        : [join(real, entry.name)];

      for (const packageDir of packageDirs) {
        await scan(join(packageDir, 'node_modules'));
      }
    }
  }

  await scan(nodeModules);
  return found;
}

async function main() {
  const problems = [];
  const report = [];

  for (const tree of TREES) {
    const reason = await foreignLayout(tree);
    if (reason) {
      problems.push(
        `Cannot measure the ${tree.name} tree: ${reason}.\n` +
          `  This check walks npm's layout, where every copy sits in a package directory.\n` +
          `  Under another installer the copies live where it does not look, so a pass here\n` +
          `  would mean nothing. Run this against an npm install.`,
      );
    }
  }

  if (problems.length === 0) {
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

        // Multiplicity, not version difference. Same version at two paths is
        // two modules to the bundler, so it is two wasm instances - and it is
        // the case a version comparison prints as a success detail.
        if (copies.length > 1) {
          problems.push(
            `${pkg} has ${copies.length} copies inside the ${tree.name} tree` +
              (versions.length > 1
                ? `, at ${versions.length} versions`
                : `, all at ${versions[0]} - identical versions at two paths are still two modules`) +
              ':\n' +
              copies.map((copy) => `  ${copy.version}  ${copy.path}`).join('\n') +
              '\n  Deduplicate the tree, or pin the dependents onto one range.',
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
  }

  if (problems.length > 0) {
    console.error('Duplicate or unverifiable WebAssembly packages:\n');
    console.error(problems.join('\n\n'));
    process.exit(1);
  }

  console.log('One resolved path per package, in every tree the bundle draws from:');
  console.log(report.join('\n'));
}

main().catch((err) => {
  // Reaching here means a read failed in a way that is not "absent": the walk
  // covered less than it claims. Exiting 0 on a partial measurement is the
  // failure mode this guard was rewritten to remove, so it exits 1 and names
  // what it could not read.
  console.error('Could not measure the dependency trees, so this check proved nothing:\n');
  console.error(`  ${err.message}`);
  process.exit(1);
});
