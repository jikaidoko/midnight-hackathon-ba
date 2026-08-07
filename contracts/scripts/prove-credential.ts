// prove-credential.ts - presents the repeat-filing credential.
//
//   npm run prove-credential -- --subject sofia
//   npm run prove-credential -- --subject sofia --context "ministry-of-labour"
//
// Output A, on a real network: proves the caller has THREE distinct filings on
// record without revealing which ones, or who they are.
//
// What the circuit is given is deliberately thin - three case commitments, three
// Merkle paths, a root and a verifier context. What makes it sound is that the
// leaves are nullifiers only this reporter's secret can derive, and the paths
// have to reach a root the nullifier tree actually had. A reporter with two
// filings cannot construct a third path, and a reporter with a tree of their own
// cannot get its root past `checkRoot`.
//
// The three cases come from the LOCAL record, not from the chain. Nothing on
// chain links a filing to a reporter - that is the privacy property - so the
// client is the only thing that knows which cases to rebuild nullifiers for.
//
// `context` scopes the presentation. The same credential presented to the same
// verifier twice is refused, which is what stops a screenshot of a valid proof
// from being replayed; presenting to a DIFFERENT verifier is fine and expected.

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, describe, PKG_ROOT } from '../src/midnight/config.js';
import {
  buildWallet,
  buildProviders,
  waitForSynced,
  closeWallet,
} from '../src/midnight/providers.js';
import { AMPARO, forSubject } from '../src/midnight/contracts.js';
import { amparoContract, ledger, filingNullifier } from '../src/midnight/compiled-contract.js';
import {
  subjectSecret,
  subjectLabel,
  subjectFilings,
  filingsElsewhere,
  fromHex,
  toHex,
} from '../src/midnight/subjects.js';
import { createSubjectState } from '../src/amparo-witnesses.js';

const config = loadConfig();
const deploymentFile = resolve(PKG_ROOT, `deployment.${config.networkId}.json`);

if (!existsSync(deploymentFile)) {
  throw new Error(`No deployment at ${deploymentFile}. Run \`npm run deploy\`.`);
}
const deployment = JSON.parse(readFileSync(deploymentFile, 'utf8')) as { contractAddress: string };

const argv = process.argv.slice(2);
const ctxIdx = argv.indexOf('--context');
const contextName = ctxIdx !== -1 ? (argv[ctxIdx + 1] ?? '') : 'demo-verifier';
if (!contextName || contextName.startsWith('--')) {
  throw new Error('--context needs a name, e.g. --context "ministry-of-labour"');
}
// The circuit takes 32 bytes; a readable name is what a verifier actually has.
const context = Uint8Array.from(createHash('sha256').update(contextName).digest());

const label = subjectLabel();
const spec = forSubject(AMPARO, label);
const secret = subjectSecret(label, config);

const registry = deployment.contractAddress;
const filed = subjectFilings(label, registry, config);
if (filed.length < 3) {
  // Before blaming the reporter: filings against a PREVIOUS deployment are the
  // usual cause, because every deployment starts an empty nullifier tree and
  // redeploying is routine while the work is in motion. Those filings are real
  // and still on chain; they just cannot be proved against this contract.
  const stranded = filingsElsewhere(label, registry, config);
  const note = stranded.length
    ? '\n\nThere ARE filings on local record, against a different contract:\n' +
      stranded.map((e) => `  ${e.registry}  ${e.cases.length} filing(s)`).join('\n') +
      '\nThose were made against a previous deployment. Every deployment starts an\n' +
      'empty nullifier tree, so they stay on chain but cannot back a credential\n' +
      `here. They have to be made again against ${registry}.`
    : '';
  throw new Error(
    `Reporter "${label}" has ${filed.length} filing(s) on local record against ${registry}; ` +
      'the credential needs 3. File against three distinct admitted cases with ' +
      '`npm run file-report` first.' +
      note,
  );
}
// Three distinct cases. The circuit asserts distinctness itself, so taking the
// first three of a de-duplicated record cannot smuggle a repeat past it.
const cases = filed.slice(0, 3).map((h) => fromHex(h, 'recorded case'));

console.log(describe(config));
console.log(`\nContract: ${deployment.contractAddress}`);
console.log(`Reporter: ${label}`);
console.log(`Verifier: ${contextName}`);

const ctx = await buildWallet(config);
await waitForSynced(ctx);
const providers = await buildProviders(ctx, config, AMPARO);

const rawState = await providers.publicDataProvider.queryContractState(deployment.contractAddress);
if (!rawState) throw new Error('Contract has no state on chain');
const state = ledger(rawState.data);

// Rebuild each nullifier through the contract's own pure circuit, then read its
// path out of the on-chain tree. A missing path means that filing is not on
// chain under this secret - the wrong reporter label is the usual cause.
const claimedRoot = state.filingNullifierTree.root();
const paths = cases.map((kase) => {
  const nullifier = filingNullifier(secret, kase);
  const path = state.filingNullifierTree.findPathForLeaf(nullifier);
  if (!path) {
    throw new Error(
      `No on-chain filing by "${label}" for case ${toHex(kase)}. The local record says there ` +
        'is one, so either the filing transaction never landed or this is the wrong reporter.',
    );
  }
  return path;
});

console.log(`Claimed root: ${claimedRoot.field.toString()}`);
console.log(`Paths found:  ${paths.length}/3`);

const privateState = createSubjectState(secret);

const contract = await findDeployedContract(providers as never, {
  contractAddress: deployment.contractAddress,
  compiledContract: amparoContract(config, spec),
  privateStateId: spec.privateStateId,
  initialPrivateState: privateState,
} as never);

console.log('\nProving (three Merkle paths; slower than a filing)...');
const called = await (
  contract as unknown as {
    callTx: {
      proveRepeatFilings(
        cases: Uint8Array[],
        paths: unknown[],
        claimedRoot: { field: bigint },
        context: Uint8Array,
      ): Promise<{ public: { txId: string } }>;
    };
  }
).callTx.proveRepeatFilings(cases, paths, claimedRoot, context);

console.log(`Transaction ${called.public.txId}`);
console.log(
  '\nCredential accepted: three distinct filings, one reporter, none of them named.\n' +
    `Presenting again to "${contextName}" will be refused; another verifier is fine.`,
);

await closeWallet(ctx);
process.exit(0);
