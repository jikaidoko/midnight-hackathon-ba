// subjects.test.ts — the reporter credential store.
//
// This module holds the only copy of something irreplaceable. A reporter's
// secret is what every one of their nullifiers derives from, and nothing on
// chain links a filing to anyone, so losing or corrupting a record permanently
// loses the ability to prove filings that are still on chain. There is no
// re-sync, because there is nothing to re-sync from.
//
// It had no tests, and its semantics changed twice in one day (filings scoped
// per registry, then atomic writes). These cover the behaviour that is easy to
// break silently: scoping, dedupe, secret stability across rewrites, the legacy
// guard, and the two argv parsers whose failures are quiet rather than loud.
//
// Filesystem-backed and network-free. Each test gets its own `networkId`, which
// is what `subjectsFile` keys on, so they cannot collide.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import {
  subjectsFile,
  subjectSecret,
  subjectFilings,
  filingsElsewhere,
  recordFiling,
  subjectLabel,
  positionals,
  toHex,
  fromHex,
} from './subjects.js';
import type { MidnightConfig } from './config.js';

const REGISTRY_A = 'a'.repeat(64);
const REGISTRY_B = 'b'.repeat(64);
const CASE_1 = new Uint8Array(32).fill(0x11);
const CASE_2 = new Uint8Array(32).fill(0x22);

/** An isolated store. `subjectsFile` keys on networkId, so a unique one is a
 *  unique file. Returns a cleanup that also removes any orphaned `.tmp`. */
function isolated(): { config: MidnightConfig; cleanup: () => void } {
  const networkId = `test-${randomBytes(8).toString('hex')}`;
  const config = { networkId } as MidnightConfig;
  const path = subjectsFile(config);
  return {
    config,
    cleanup: () => {
      rmSync(path, { force: true });
      rmSync(`${path}.tmp`, { force: true });
    },
  };
}

function withStore(fn: (config: MidnightConfig, path: string) => void): void {
  const { config, cleanup } = isolated();
  try {
    fn(config, subjectsFile(config));
  } finally {
    cleanup();
  }
}

test('1. a secret is minted once and stays stable across rewrites', () => {
  withStore((config) => {
    const first = subjectSecret('sofia', config);
    assert.equal(first.length, 32);

    assert.deepEqual(subjectSecret('sofia', config), first, 'same secret on re-read');

    // Every filing rewrites the whole file. The secret has to survive that:
    // a regenerated secret orphans every filing the reporter ever made.
    recordFiling('sofia', REGISTRY_A, CASE_1, config);
    recordFiling('sofia', REGISTRY_A, CASE_2, config);
    assert.deepEqual(subjectSecret('sofia', config), first, 'survives rewrites');

    assert.notDeepEqual(subjectSecret('vecina', config), first, 'reporters differ');
  });
});

test('2. filings are scoped per registry and de-duplicated', () => {
  withStore((config) => {
    subjectSecret('sofia', config);

    recordFiling('sofia', REGISTRY_A, CASE_1, config);
    recordFiling('sofia', REGISTRY_A, CASE_1, config); // repeat
    assert.deepEqual(subjectFilings('sofia', REGISTRY_A, config), [toHex(CASE_1)]);

    // The same case in another registry is a genuinely different filing: a
    // redeployed contract starts an empty nullifier tree.
    recordFiling('sofia', REGISTRY_B, CASE_1, config);
    assert.deepEqual(subjectFilings('sofia', REGISTRY_A, config), [toHex(CASE_1)]);
    assert.deepEqual(subjectFilings('sofia', REGISTRY_B, config), [toHex(CASE_1)]);

    recordFiling('sofia', REGISTRY_A, CASE_2, config);
    assert.deepEqual(subjectFilings('sofia', REGISTRY_A, config), [toHex(CASE_1), toHex(CASE_2)]);
    assert.deepEqual(subjectFilings('sofia', REGISTRY_B, config), [toHex(CASE_1)], 'B unaffected');

    assert.deepEqual(subjectFilings('sofia', 'c'.repeat(64), config), [], 'unknown registry');
    assert.deepEqual(subjectFilings('nobody', REGISTRY_A, config), [], 'unknown reporter');
  });
});

test('3. filingsElsewhere reports the other registries, and only those', () => {
  withStore((config) => {
    subjectSecret('sofia', config);
    recordFiling('sofia', REGISTRY_A, CASE_1, config);
    recordFiling('sofia', REGISTRY_A, CASE_2, config);

    assert.deepEqual(filingsElsewhere('sofia', REGISTRY_A, config), [], 'nothing elsewhere yet');

    // This is the diagnosis that made the fix worth making: after a redeploy the
    // filings are still on chain and still hers, and the store is the only thing
    // that can say so.
    const elsewhere = filingsElsewhere('sofia', REGISTRY_B, config);
    assert.equal(elsewhere.length, 1);
    assert.equal(elsewhere[0]?.registry, REGISTRY_A);
    assert.equal(elsewhere[0]?.cases.length, 2);

    assert.deepEqual(filingsElsewhere('nobody', REGISTRY_A, config), []);
  });
});

test('4. recordFiling refuses a reporter that was never created', () => {
  withStore((config) => {
    assert.throws(
      () => recordFiling('ghost', REGISTRY_A, CASE_1, config),
      /No subject "ghost" on file/,
    );
  });
});

test('5. a legacy flat filing list is refused, not silently reattributed', () => {
  withStore((config, path) => {
    // The pre-scoping format. Guessing which registry these belong to would
    // produce exactly the wrong diagnosis the scoping exists to prevent.
    writeFileSync(
      path,
      JSON.stringify({ sofia: { secret: '11'.repeat(32), filings: [toHex(CASE_1)] } }),
    );

    for (const call of [
      () => subjectSecret('sofia', config),
      () => subjectFilings('sofia', REGISTRY_A, config),
      () => filingsElsewhere('sofia', REGISTRY_A, config),
      () => recordFiling('sofia', REGISTRY_A, CASE_2, config),
    ]) {
      assert.throws(call, /predates registry-scoped filings/, 'every entry point refuses');
    }
  });
});

test('6. writes are atomic and leave no orphan temp file', () => {
  withStore((config, path) => {
    subjectSecret('sofia', config);
    recordFiling('sofia', REGISTRY_A, CASE_1, config);

    assert.ok(existsSync(path), 'the store exists');
    // The temp carries every reporter's secret in full. An orphan is both a
    // stale credential copy on disk and, before its .gitignore entry, committable.
    assert.equal(existsSync(`${path}.tmp`), false, 'no orphan .tmp');
  });
});

test('7. ADVERSARIAL: a __proto__ label does not vanish into the prototype', () => {
  withStore((config) => {
    // On a normal object this writes the prototype rather than a property: the
    // record reads back absent, a fresh secret is minted every run, and the
    // reporter's filings become unprovable with no error to explain it.
    const secret = subjectSecret('__proto__', config);
    assert.deepEqual(subjectSecret('__proto__', config), secret, 'the record persists');

    recordFiling('__proto__', REGISTRY_A, CASE_1, config);
    assert.deepEqual(subjectFilings('__proto__', REGISTRY_A, config), [toHex(CASE_1)]);

    // And it stays its own reporter rather than leaking into every other one.
    assert.deepEqual(subjectFilings('sofia', REGISTRY_A, config), []);
    assert.notDeepEqual(subjectSecret('sofia', config), secret);
  });
});

test('8. subjectLabel: flag, then env, then default', () => {
  const saved = process.env.MN_SUBJECT;
  try {
    delete process.env.MN_SUBJECT;
    assert.equal(subjectLabel([]), 'default');
    assert.equal(subjectLabel(['--subject', 'sofia']), 'sofia');
    assert.equal(subjectLabel(['<hex>', '--subject', 'sofia']), 'sofia');

    process.env.MN_SUBJECT = 'from-env';
    assert.equal(subjectLabel([]), 'from-env');
    assert.equal(subjectLabel(['--subject', 'sofia']), 'sofia', 'the flag wins');

    assert.throws(() => subjectLabel(['--subject']), /--subject needs a label/);
    assert.throws(() => subjectLabel(['--subject', '--context']), /--subject needs a label/);
  } finally {
    if (saved === undefined) delete process.env.MN_SUBJECT;
    else process.env.MN_SUBJECT = saved;
  }
});

test('9. positionals: a flag VALUE is never mistaken for a positional', () => {
  assert.deepEqual(positionals(['<hex>']), ['<hex>']);
  assert.deepEqual(positionals(['--subject', 'sofia', '<hex>']), ['<hex>']);
  assert.deepEqual(positionals(['<hex>', '--subject', 'sofia']), ['<hex>']);

  // The one that bites. `deploy` reads positionals()[0] as the review
  // threshold, so a leaked flag value becomes BigInt('ministry-of-labour').
  assert.deepEqual(
    positionals(['--context', 'ministry-of-labour', '<hex>']),
    ['<hex>'],
    'the context value is not a positional',
  );
  assert.deepEqual(positionals(['--context', 'court', '--subject', 'sofia', '2']), ['2']);

  // A valueless flag is dropped without eating what follows it.
  assert.deepEqual(positionals(['--force', '2']), ['2']);
  assert.deepEqual(positionals([]), []);
});

test('10. hex round-trips, and rejects anything that is not 32 bytes', () => {
  const bytes = Uint8Array.from(randomBytes(32));
  assert.deepEqual(fromHex(toHex(bytes), 'value'), bytes);
  assert.equal(toHex(new Uint8Array(32).fill(0xab)), 'ab'.repeat(32));

  for (const bad of ['', 'ab', 'ab'.repeat(33), 'zz'.repeat(32), `${'ab'.repeat(31)}a`]) {
    assert.throws(() => fromHex(bad, 'case commitment'), /case commitment must be 64 hex/);
  }
  // Uppercase is valid hex and must not be rejected.
  assert.deepEqual(fromHex('AB'.repeat(32), 'value'), new Uint8Array(32).fill(0xab));
});
