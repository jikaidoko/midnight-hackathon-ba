// file-report.ts - files one report against an admitted case, as one reporter.
//
//   npm run file-report -- <64 hex case>
//   npm run file-report -- <64 hex case> --subject sofia
//
// This is the reporter half of the product: private witness in, client-side
// proof, public state out, and nothing on chain that says who filed.
//
// It got much shorter when the contracts merged. It used to fetch a Merkle path
// out of the admission contract, then run two pre-flight checks - is the case
// admitted, and does the registry root still equal the one frozen into the
// filing contract at deployment - because a mismatch produced an opaque circuit
// assert after a proof had already been generated. There is no frozen root and
// no path: the circuit checks the live registry directly.

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
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
import { amparoContract, ledger } from '../src/midnight/compiled-contract.js';
import {
  subjectSecret,
  subjectLabel,
  positionals,
  recordFiling,
  fromHex,
  toHex,
} from '../src/midnight/subjects.js';
import { createSubjectState } from '../src/amparo-witnesses.js';

const config = loadConfig();
const deploymentFile = resolve(PKG_ROOT, `deployment.${config.networkId}.json`);

if (!existsSync(deploymentFile)) {
  throw new Error(`No deployment at ${deploymentFile}. Run \`npm run deploy\`.`);
}
const deployment = JSON.parse(readFileSync(deploymentFile, 'utf8')) as {
  contractAddress: string;
  // From the deployment record, not from the chain: `reviewThreshold` is a
  // `sealed` field, and sealed fields do not appear in the generated Ledger
  // projection. The circuit reads it; no client can.
  reviewThreshold: string;
};

const [caseArg] = positionals();
if (!caseArg) {
  throw new Error('Which case? Pass the 32-byte case commitment: npm run file-report -- <64 hex>');
}
const caseCommitment = fromHex(caseArg, 'case commitment');
const label = subjectLabel();
const spec = forSubject(AMPARO, label);

console.log(describe(config));
console.log(`\nContract: ${deployment.contractAddress}`);
console.log(`Reporter: ${label}`);
console.log(`Case:     ${toHex(caseCommitment)}`);

const ctx = await buildWallet(config);
await waitForSynced(ctx);
const providers = await buildProviders(ctx, config, AMPARO);

// One pre-flight, kept for the error message rather than for the time.
//
// It saves no proving: `createUnprovenCallTx` runs the circuit locally and its
// asserts fire BEFORE anything is sent to the proof server, so the circuit's own
// rejection is already fast. What it does not do is say which case, or what to do
// about it - and "failed assert: Case is not in the admitted registry" is not a
// sentence anybody should have to read on stage.
const rawState = await providers.publicDataProvider.queryContractState(
  deployment.contractAddress,
);
if (!rawState) throw new Error('Contract has no state on chain');
if (!ledger(rawState.data).admittedIndex.member(caseCommitment)) {
  throw new Error(
    `Case ${toHex(caseCommitment)} is not in the admitted registry. An authority has to ` +
      'admit it first with `npm run admit-case`.',
  );
}

const contract = await findDeployedContract(providers as never, {
  contractAddress: deployment.contractAddress,
  compiledContract: amparoContract(config, spec),
  privateStateId: spec.privateStateId,
  initialPrivateState: createSubjectState(subjectSecret(label, config)),
} as never);

console.log('\nFiling (this generates a proof; the first one is slower)...');
const called = await (
  contract as unknown as {
    callTx: { registerFiling(c: Uint8Array): Promise<{ public: { txId: string } }> };
  }
).callTx.registerFiling(caseCommitment);

console.log(`Transaction ${called.public.txId}`);

recordFiling(label, deployment.contractAddress, caseCommitment, config);

// Read the public state back. This is output B: the count is public, the
// reporter is not.
const after = await providers.publicDataProvider.queryContractState(deployment.contractAddress);
if (!after) throw new Error('Contract state could not be read back after filing');
const state = ledger(after.data);

const reports = state.caseReports.member(caseCommitment)
  ? state.caseReports.lookup(caseCommitment).read()
  : 0n;

console.log(`\nReports for this case: ${reports}`);
console.log(`Threshold:             ${deployment.reviewThreshold} (from the deployment record)`);
console.log(`Under review:          ${state.casesUnderReview.member(caseCommitment) ? 'YES' : 'no'}`);
console.log(`Nullifier tree root:   ${state.filingNullifierTree.root().field.toString()}`);

await closeWallet(ctx);
process.exit(0);
