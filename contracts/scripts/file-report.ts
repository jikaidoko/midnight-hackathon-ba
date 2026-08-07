// file-report.ts - files one report against an admitted case, as one reporter.
//
//   npm run file-report -- <64 hex case>
//   npm run file-report -- <64 hex case> --subject sofia
//
// This is the reporter half of the product, and the first time `registerFiling`
// runs anywhere other than the simulator: private witness in, client-side proof,
// public state out, and nothing on chain that says who filed.
//
// The Merkle path is read from the case admission contract's own tree with
// `findPathForLeaf`, not rebuilt from an off-chain mirror. The chain is the only
// source that cannot drift.
//
// Two pre-flight checks run before a proof is built, because a proof takes real
// time and both failures otherwise arrive as the same opaque circuit assert:
//
//   1. the case is in the admitted registry at all;
//   2. the registry's root still equals the root frozen into the filing
//      contract at deployment - see deploy-filing.ts for why it is frozen.

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
import { FILING_REGISTRY, forSubject } from '../src/midnight/contracts.js';
import { filingContract, caseLedger, filingLedger } from '../src/midnight/compiled-contract.js';
import {
  subjectSecret,
  subjectLabel,
  positionals,
  recordFiling,
  fromHex,
  toHex,
} from '../src/midnight/subjects.js';
import type { SubjectPrivateState } from '../src/filing-witnesses.js';

const config = loadConfig();
const filingFile = resolve(PKG_ROOT, `deployment.filing.${config.networkId}.json`);

if (!existsSync(filingFile)) {
  throw new Error(`No filing registry deployment at ${filingFile}. Run \`npm run deploy-filing\`.`);
}
const deployment = JSON.parse(readFileSync(filingFile, 'utf8')) as {
  contractAddress: string;
  caseAdmissionAddress: string;
  // From the deployment record, not from the chain: `reviewThreshold` is a
  // `sealed` field, and sealed fields do not appear in the generated Ledger
  // projection. The circuit reads it; no client can. Every other value this
  // script needs is read from the two contracts directly.
  reviewThreshold: string;
};

const [caseArg] = positionals();
if (!caseArg) {
  throw new Error(
    'Which case? Pass the 32-byte case commitment: npm run file-report -- <64 hex>',
  );
}
const caseCommitment = fromHex(caseArg, 'case commitment');
const label = subjectLabel();
const spec = forSubject(FILING_REGISTRY, label);

console.log(describe(config));
console.log(`\nFiling registry: ${deployment.contractAddress}`);
console.log(`Reporter:        ${label}`);
console.log(`Case:            ${toHex(caseCommitment)}`);

const ctx = await buildWallet(config);
await waitForSynced(ctx);
const providers = await buildProviders(ctx, config, FILING_REGISTRY);

// ── Pre-flight 1: is the case admitted, and can we get a path to it? ─────────
const rawCaseState = await providers.publicDataProvider.queryContractState(
  deployment.caseAdmissionAddress,
);
if (!rawCaseState) throw new Error('Case admission contract has no state on chain');
const caseState = caseLedger(rawCaseState.data);

const path = caseState.admittedCases.findPathForLeaf(caseCommitment);
if (!path) {
  throw new Error(
    `Case ${toHex(caseCommitment)} is not in the admitted registry. An authority has to ` +
      'admit it first with `npm run admit-case`.',
  );
}

// ── Pre-flight 2: is the frozen root still the live one? ─────────────────────
const rawFilingState = await providers.publicDataProvider.queryContractState(
  deployment.contractAddress,
);
if (!rawFilingState) throw new Error('Filing registry has no state on chain');
const filingState = filingLedger(rawFilingState.data);

const liveRoot = caseState.admittedCases.root().field;
const frozenRoot = filingState.admittedRoot.field;
if (liveRoot !== frozenRoot) {
  throw new Error(
    `The admitted registry has moved since the filing registry was deployed.\n` +
      `  frozen at deploy: ${frozenRoot}\n` +
      `  live now:         ${liveRoot}\n` +
      `The case IS admitted, but its Merkle path reaches the live root and the circuit ` +
      `compares against the frozen one, so the proof would be rejected with "Case is not ` +
      `in the admitted registry".\n` +
      `This is the two-contract integration gap, not a bad case commitment. Redeploy the ` +
      `filing registry (\`npm run deploy-filing\`) to freeze the current root, or admit ` +
      `every case the demo needs BEFORE deploying it.`,
  );
}

console.log(`Admitted root:   ${liveRoot} (matches the frozen root)`);

const privateState: SubjectPrivateState = { subjectSecret: subjectSecret(label, config) };

const contract = await findDeployedContract(providers as never, {
  contractAddress: deployment.contractAddress,
  compiledContract: filingContract(config, spec),
  privateStateId: spec.privateStateId,
  initialPrivateState: privateState,
} as never);

console.log('\nFiling (this generates a proof; the first one is slower)...');
const called = await (
  contract as unknown as {
    callTx: {
      registerFiling(c: Uint8Array, p: unknown): Promise<{ public: { txId: string } }>;
    };
  }
).callTx.registerFiling(caseCommitment, path);

console.log(`Transaction ${called.public.txId}`);

// Recorded against THIS registry. The nullifier that backs a credential lives
// in this contract's tree and nowhere else, so a filing is only ever meaningful
// alongside the address it landed in.
recordFiling(label, deployment.contractAddress, caseCommitment, config);

// Read the public state back. This is output B: the count is public, the
// reporter is not.
const after = await providers.publicDataProvider.queryContractState(deployment.contractAddress);
if (!after) throw new Error('Filing registry state could not be read back after filing');
const state = filingLedger(after.data);

const reports = state.caseReports.member(caseCommitment)
  ? state.caseReports.lookup(caseCommitment).read()
  : 0n;
const underReview = state.casesUnderReview.member(caseCommitment);

console.log(`\nReports for this case: ${reports}`);
console.log(`Threshold:             ${deployment.reviewThreshold} (from the deployment record)`);
console.log(`Under review:          ${underReview ? 'YES' : 'no'}`);
console.log(`Nullifier tree root:   ${state.filingNullifierTree.root().field.toString()}`);

await closeWallet(ctx);
process.exit(0);
