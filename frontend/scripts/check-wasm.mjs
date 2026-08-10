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
// each package, across both trees, and whether the bundler is told to collapse
// them. Not version equality - that alone is the wrong predicate. The bundler
// keys modules by resolved path, so two copies at the SAME version are still two
// modules and still two wasm instances. Version differences are reported too,
// because they are the loudest symptom, but multiplicity is the property.
//
// Multiplicity is measured ACROSS the trees, not inside each one. Two copies
// inside a single tree and one copy in each tree are the same fact to the
// bundler, and a per-tree count cannot see the second - which is the normal,
// intended layout here, so a per-tree count reports green on exactly the case
// this exists to catch.
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

// The wasm carriers, plus `compact-runtime`.
//
// `compact-runtime` is plain JavaScript, which invites the argument that two
// copies of it are harmless as long as they re-export the same runtime
// underneath. That condition is precisely the one that fails. It is the module
// that builds a `QueryContext`, and it reaches the runtime through its OWN
// resolution - so a second copy of it selects a second `onchain-runtime-v3`, and
// the browser dies with `expected instance of ChargedState` while every version
// reported here matches. It was left out once on that reasoning and the page
// broke; it is measured.
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
    // Read before the walk: a config that no longer states the invariant makes
    // every result below unverifiable, and saying so once is clearer than
    // reporting per-package multiplicities nobody can judge.
    let deduped;
    try {
      deduped = await dedupedPackages();
    } catch (err) {
      problems.push(err.message);
    }

    // No dedupe list means no verdict: the walk below can still count copies,
    // but "two installs" is only a problem when nothing collapses them, so
    // reporting multiplicities here would be reporting a number with no
    // predicate attached. The pushed message above is the whole result.
    for (const pkg of deduped ? PACKAGES : []) {
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

        // Two versions inside one tree is a dependency conflict, not something
        // `dedupe` repairs: the bundler collapses onto one of them, and which
        // one is not stated anywhere. Reported unconditionally.
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

      // The case MATCHING versions cannot reach, and the one that actually broke
      // the page: two separate installs of the same version are still two wasm
      // instances. Nothing in a version comparison can see it - this check
      // reported green for the whole time the control screens could not load.
      //
      // Two copies are fine when the bundler is told to collapse them, so that
      // is what is asserted rather than "exactly one copy": the trees are
      // deliberately unhoisted so each `overrides` block stays authoritative
      // over its own, which means one copy per tree is the intended state.
      if (pathsAcrossTrees.length > 1 && !deduped.includes(pkg)) {
        problems.push(
          `${pkg} resolves to ${pathsAcrossTrees.length} separate installs and is NOT in\n` +
            '  `resolve.dedupe` in vite.config.ts:\n' +
            pathsAcrossTrees.map((copy) => `    ${copy.version}  ${copy.path}`).join('\n') +
            '\n  Same version is not the same instance. Each install carries its own wasm module\n' +
            "  owning its own classes, so a value built by one fails the other's type check -\n" +
            '  `expected instance of ChargedState` - after a query that succeeded. Add it to\n' +
            '  `resolve.dedupe`.',
        );
      }
    }
  }

  if (problems.length > 0) {
    console.error('Duplicate or unverifiable WebAssembly packages:\n');
    console.error(problems.join('\n\n'));
    process.exit(1);
  }

  // Not "one resolved path per package": the passing state has one per tree, and
  // the report below prints both. What was verified is that every package
  // installed more than once is deduped, which is what makes it one MODULE.
  console.log('One instance per package in the browser bundle (deduped where installed twice):');
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
