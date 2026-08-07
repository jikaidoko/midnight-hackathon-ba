// deploy-filing.ts - deploys the filing registry against a deployed case
// admission contract.
//
//   npm run deploy                     case admission first; this reads it
//   npm run admit-case                 admit the cases the demo will file against
//   npm run deploy-filing              threshold 3
//   npm run deploy-filing -- 2         threshold 2
//
// ORDER MATTERS, and not for convenience. The constructor takes the admitted
// root as a value and the field is written once:
//
//   constructor(root: MerkleTreeDigest, threshold: Uint<64>)
//
// So this deployment FREEZES whatever `admittedCases.root()` is at this moment.
// A case admitted afterwards changes the real registry's root, and a Merkle path
// into the new tree no longer reaches the frozen one - `registerFiling` rejects
// it with "Case is not in the admitted registry", which reads like the case is
// unknown when it is simply newer than this contract.
//
// That is the known cost of the two contracts being separate, and it is the
// reason `npm run admit-case` belongs BEFORE this script and not after. It goes
// away when the two are unified into one contract, where the circuit can check
// the path against the live tree with `admittedCases.checkRoot(...)` instead of
// against a value copied at construction time. Until then this script prints the
// frozen root and `file-report` refuses to build a transaction it knows will
// fail, so the failure is legible rather than mysterious.

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, describe, PKG_ROOT } from '../src/midnight/config.js';
import {
  buildWallet,
  buildProviders,
  waitForSynced,
  closeWallet,
} from '../src/midnight/providers.js';
import { CASE_ADMISSION, FILING_REGISTRY, forSubject } from '../src/midnight/contracts.js';
import { filingContract, caseLedger, filingLedger } from '../src/midnight/compiled-contract.js';
import { subjectSecret, subjectLabel, positionals } from '../src/midnight/subjects.js';
import type { SubjectPrivateState } from '../src/filing-witnesses.js';

const config = loadConfig();
const caseFile = resolve(PKG_ROOT, `deployment.${config.networkId}.json`);
const filingFile = resolve(PKG_ROOT, `deployment.filing.${config.networkId}.json`);

if (!existsSync(caseFile)) {
  throw new Error(
    `No case admission deployment at ${caseFile}. Run \`npm run deploy\` first: the ` +
      `filing registry is constructed with that contract's admitted root.`,
  );
}
const caseDeployment = JSON.parse(readFileSync(caseFile, 'utf8')) as {
  contractAddress: string;
};

const [thresholdArg] = positionals();
const threshold = BigInt(thresholdArg ?? process.env.MN_REVIEW_THRESHOLD ?? '3');
if (threshold < 1n) throw new Error(`review threshold must be at least 1 (got ${threshold})`);

console.log(describe(config));
console.log(`\nCase admission: ${caseDeployment.contractAddress}`);

// Redeploying strands every filing already made against the previous registry.
// The nullifier tree lives inside the contract, so a new deployment starts
// empty: those filings stay on chain, stay the reporter's, and stop being able
// to back a credential here. `file-report` offers a redeploy as the remedy for
// a diverged root, so this is reachable by following the instructions - it is
// worth saying out loud BEFORE the deploy proof rather than after.
if (existsSync(filingFile)) {
  const previous = JSON.parse(readFileSync(filingFile, 'utf8')) as { contractAddress?: string };
  console.log(
    `\nWARNING: this replaces the filing registry at ${previous.contractAddress ?? '(unknown)'}.\n` +
      'Its nullifier tree does not carry over. Every filing already made against it stays on\n' +
      'chain but can no longer back a credential, and each reporter has to file again.',
  );
}

// The wallet has to be up before the admitted root can be read: the root comes
// from the indexer, through the provider set.
const ctx = await buildWallet(config);
await waitForSynced(ctx);
const providers = await buildProviders(ctx, config, FILING_REGISTRY);

const rawCaseState = await providers.publicDataProvider.queryContractState(
  caseDeployment.contractAddress,
);
if (!rawCaseState) {
  throw new Error(`Case admission contract ${caseDeployment.contractAddress} has no state on chain`);
}
const caseState = caseLedger(rawCaseState.data);
const admittedRoot = caseState.admittedCases.root();

console.log(`Admitted cases: ${caseState.admittedCount}`);
console.log(`Admitted root:  ${admittedRoot.field.toString()}`);
console.log(`Threshold:      ${threshold}`);

if (caseState.admittedCount === 0n) {
  console.log(
    '\nWARNING: no cases are admitted yet. The root about to be frozen is the empty\n' +
      'tree, so NOTHING will ever be fileable against this deployment. Admit the\n' +
      "demo's cases with `npm run admit-case` and deploy the filing registry again.",
  );
}

// The deployer needs a private state because the contract declares a witness,
// even though the constructor never reads it. An absent one fails inside the
// proof rather than here.
const label = subjectLabel();
const spec = forSubject(FILING_REGISTRY, label);
const initialPrivateState: SubjectPrivateState = { subjectSecret: subjectSecret(label, config) };

console.log('\nDeploying (this generates the constructor proof)...');
const deployed = await deployContract(providers as never, {
  compiledContract: filingContract(config, spec) as never,
  args: [admittedRoot, threshold],
  privateStateId: spec.privateStateId,
  initialPrivateState,
} as never);

const contractAddress = (
  deployed as { deployTxData: { public: { contractAddress: string } } }
).deployTxData.public.contractAddress;

console.log(`\nDeployed at ${contractAddress}`);

// Read the state back and confirm the constructor wrote what it was given. The
// frozen root is the one value this deployment can never correct, so a mismatch
// has to be caught now and not by a reporter whose filing is rejected.
const rawFilingState = await providers.publicDataProvider.queryContractState(contractAddress);
if (!rawFilingState) throw new Error('Filing registry state could not be read back after deploy');
const filingState = filingLedger(rawFilingState.data);

if (filingState.admittedRoot.field !== admittedRoot.field) {
  throw new Error(
    `Frozen root ${filingState.admittedRoot.field} does not match the admitted root ` +
      `${admittedRoot.field} it was constructed with. Nothing will be fileable.`,
  );
}
console.log(`Frozen root confirmed: ${filingState.admittedRoot.field.toString()}`);

// The threshold cannot be confirmed the same way. `reviewThreshold` is `sealed`,
// and a sealed field is absent from the generated Ledger projection - readable
// by the circuit, invisible to any client. So the value passed here is the only
// record of it, which is why it goes into the deployment file below and why
// every script that displays it reads it from there rather than from the chain.

writeFileSync(
  filingFile,
  JSON.stringify(
    {
      network: config.networkId,
      contractAddress,
      caseAdmissionAddress: caseDeployment.contractAddress,
      // `reviewThreshold` is the only field here that is not readable on chain,
      // which is the whole reason this record exists. The frozen root and the
      // admitted case list are deliberately NOT copied: both are readable from
      // the two contracts themselves, and `file-report` reads them from there.
      // A local copy of chain state is a second source that can only drift.
      reviewThreshold: threshold.toString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(`Wrote ${filingFile}`);

await closeWallet(ctx);
process.exit(0);
