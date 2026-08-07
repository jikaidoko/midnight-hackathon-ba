// subjects.ts - the reporter-side credential store.
//
// The authority is one identity and its secret is written into the deployment
// record. Reporters are not: every one holds their own secret, all of their
// filings derive from it, and it is the only way to rebuild the nullifiers a
// credential proof needs. Losing it does not lose the filings - they stay on
// chain - but it permanently loses the ability to prove they were yours,
// because nothing on chain links them to anyone.
//
// So this file is a stand-in for what a real deployment puts in a wallet. It is
// gitignored, it holds live credentials, and it exists because the demo needs
// several reporters on one machine.
//
// The list of cases a reporter filed against is kept here too, for the same
// reason: the chain deliberately does not record it. Filings are unlinkable by
// design, so `proveRepeatFilings` cannot discover its own inputs - the client
// has to remember which cases it filed, or it can never present a credential.
// That is a property of the design working, not a gap in it.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';
import { PKG_ROOT, type MidnightConfig } from './config.js';

export interface SubjectRecord {
  /** 32-byte hex. The reporter's private credential. */
  secret: string;
  /**
   * Case commitments this reporter filed against, keyed by the contract the
   * filing landed in, in order within each contract.
   *
   * Keyed, and not one flat list, because the nullifier tree lives INSIDE the
   * contract. Any new deployment starts a fresh, empty tree, so a filing made
   * against a previous one has no path in the new one and can never back a
   * credential there. A flat list cannot tell the two apart, and
   * `prove-credential` ends up blaming a transaction that never landed for a
   * filing that landed perfectly well - in a contract that is no longer the
   * current one. Redeploying is routine during a demo, so this is a path the
   * work is actively steered onto.
   */
  filings: Record<string, string[]>;
}

type SubjectFile = Record<string, SubjectRecord>;

export function subjectsFile(config: MidnightConfig): string {
  return resolve(PKG_ROOT, `subjects.${config.networkId}.json`);
}

function read(config: MidnightConfig): SubjectFile {
  const path = subjectsFile(config);
  // Null-prototype, because reporter labels are keys here and a label comes off
  // the command line. On a normal object `--subject __proto__` writes the
  // prototype instead of a property: the record reads back as absent, a fresh
  // secret is minted on every run, and the reporter's filings become
  // unprovable - with no error anywhere to say why.
  if (!existsSync(path)) return Object.create(null) as SubjectFile;
  const data = Object.assign(
    Object.create(null),
    JSON.parse(readFileSync(path, 'utf8')),
  ) as SubjectFile;

  // Written before filings were scoped to a registry. A flat list cannot say
  // which deployment those filings are in, and guessing would produce exactly
  // the wrong diagnosis this scoping exists to prevent - so it stops here
  // rather than silently attributing them to the current registry.
  for (const [label, record] of Object.entries(data)) {
    if (Array.isArray(record?.filings)) {
      throw new Error(
        `${path} predates registry-scoped filings: subject "${label}" holds a flat filing list, ` +
          'which cannot say which contract those filings landed in. Either delete the ' +
          'file and file again, or rewrite the entry by hand as ' +
          '{"secret": "...", "filings": {"<registry address>": ["<case>", ...]}}.',
      );
    }
  }
  return data;
}

/**
 * Writes atomically: full write to a temporary file, then rename.
 *
 * Same reasoning as `writeStateBlob` in providers.ts, and it applies harder
 * here. This file holds EVERY reporter's secret and is rewritten in full on
 * each filing, so a process killed mid-write truncates all of them at once -
 * and unlike a wallet blob there is nothing to re-sync from, because nothing on
 * chain links a filing to anyone. Rename within a filesystem is atomic, so the
 * worst outcome is an orphan `.tmp` the next write replaces.
 */
function write(config: MidnightConfig, data: SubjectFile): void {
  const target = subjectsFile(config);
  const temp = `${target}.tmp`;
  writeFileSync(temp, JSON.stringify(data, null, 2) + '\n');
  renameSync(temp, target);
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function fromHex(hex: string, name: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length !== 64) {
    throw new Error(`${name} must be 64 hex characters (32 bytes), got "${hex}"`);
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/**
 * The reporter's secret, created on first use and reused afterwards.
 *
 * Created rather than derived from the label: a secret derived from a public
 * string is a secret anyone can recompute, and every filing this reporter ever
 * makes hangs off this value.
 */
export function subjectSecret(label: string, config: MidnightConfig): Uint8Array {
  const data = read(config);
  const existing = data[label];
  if (existing) return fromHex(existing.secret, `secret of subject "${label}"`);

  const secret = Uint8Array.from(randomBytes(32));
  data[label] = { secret: toHex(secret), filings: {} };
  write(config, data);
  return secret;
}

/** Cases this reporter filed against `registry`, as recorded locally. */
export function subjectFilings(
  label: string,
  registry: string,
  config: MidnightConfig,
): string[] {
  return read(config)[label]?.filings?.[registry] ?? [];
}

/**
 * Filings recorded against OTHER registries than `registry`.
 *
 * This exists for one failure: the filings were made against a previous
 * deployment of the contract - a redeploy, or the contract being replaced. They
 * are still on chain and still the reporter's, but they are in a tree the
 * current contract does not have, so a credential cannot be built from them.
 * Reported rather than merged, because the honest answer is "file again", and a
 * caller that cannot see the old registry has no way to say so.
 */
export function filingsElsewhere(
  label: string,
  registry: string,
  config: MidnightConfig,
): Array<{ registry: string; cases: string[] }> {
  const filings = read(config)[label]?.filings ?? {};
  return Object.entries(filings)
    .filter(([addr, cases]) => addr !== registry && cases.length > 0)
    .map(([addr, cases]) => ({ registry: addr, cases }));
}

export function recordFiling(
  label: string,
  registry: string,
  caseCommitment: Uint8Array,
  config: MidnightConfig,
): void {
  const data = read(config);
  const record = data[label];
  if (!record) throw new Error(`No subject "${label}" on file; nothing to record against`);
  const hex = toHex(caseCommitment);
  const cases = (record.filings[registry] ??= []);
  if (!cases.includes(hex)) cases.push(hex);
  write(config, data);
}

/**
 * Which reporter a script is acting as: `-- --subject <label>`, else MN_SUBJECT,
 * else `default`. Passed explicitly in the demo, where several reporters file
 * against the same case from the same machine.
 */
export function subjectLabel(argv: string[] = process.argv.slice(2)): string {
  const i = argv.indexOf('--subject');
  if (i !== -1) {
    const label = argv[i + 1];
    if (!label || label.startsWith('--')) throw new Error('--subject needs a label');
    return label;
  }
  return process.env.MN_SUBJECT ?? 'default';
}

/**
 * Every flag that takes a value. A flag missing from here has its VALUE parsed
 * as a positional, which is silent and wrong: `deploy` reads `positionals()[0]`
 * as the review threshold and `admit-case` reads it as the case commitment, so
 * the first unlisted flag turns those into `BigInt('<some string>')` and a hex
 * parse of a flag value. Add the flag here when you add it anywhere.
 */
const VALUED_FLAGS = new Set(['--subject', '--context']);

/** Positional arguments, with flags and their values removed. */
export function positionals(argv: string[] = process.argv.slice(2)): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (VALUED_FLAGS.has(arg)) { i++; continue; }
    if (arg.startsWith('--')) continue;
    out.push(arg);
  }
  return out;
}
