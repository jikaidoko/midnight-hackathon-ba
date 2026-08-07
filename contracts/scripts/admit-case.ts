// admit-case.ts - admits one case against a deployed contract, then verifies the
// display mirror against the real on-chain tree.
//
//   npm run deploy
//   npm run admit-case                 admit a random case commitment
//   npm run admit-case -- <64 hex>     admit a specific one
//
// This is the end-to-end path: private witness in, client-side proof, public
// state out. `npm run deploy` proves the constructor circuit works; this proves
// the gated circuit does, which is the one the product depends on.
//
// The mirror check at the end is not decoration. `admitCase` receives the new
// root as a parameter and cannot bind it to the real tree, because the ADT's
// `root()` is runtime-only. So an off-chain computation error would publish a
// mirror that lies while every transaction succeeds. Comparing the two
// independent sources after EVERY admission is what makes that visible at the
// moment it happens rather than later, in a UI, far from the cause.

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, describe, PKG_ROOT } from '../src/midnight/config.js';
import {
  buildWallet,
  buildProviders,
  waitForSynced,
  closeWallet,
  PRIVATE_STATE_ID,
} from '../src/midnight/providers.js';
import { amparoContract, ledger } from '../src/midnight/compiled-contract.js';
import { createCaseRegistry, assertMirrorMatchesTree, toHex } from '../src/case-registry.js';
import type { AuthorityPrivateState } from '../src/witnesses.js';

interface DeploymentFile {
  network: string;
  contractAddress: string;
  authoritySecret: string;
  admittedCases: string[];
}

function hexToBytes(hex: string, name: string): Uint8Array {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length !== 64) {
    throw new Error(`${name} must be 64 hex characters (32 bytes), got "${hex}"`);
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

const config = loadConfig();
const deploymentFile = resolve(PKG_ROOT, `deployment.${config.networkId}.json`);

if (!existsSync(deploymentFile)) {
  throw new Error(`No deployment found at ${deploymentFile}. Run \`npm run deploy\` first.`);
}
const deployment = JSON.parse(readFileSync(deploymentFile, 'utf8')) as DeploymentFile;

const argHex = process.argv[2];
const caseCommitment = argHex
  ? hexToBytes(argHex, 'case commitment')
  : Uint8Array.from(randomBytes(32));

console.log(describe(config));
console.log(`\nContract: ${deployment.contractAddress}`);
console.log(`Case:     ${toHex(caseCommitment)}`);

// Replay the admission log so the mirror is in the same state the contract is,
// then compute the root this admission will produce. Order matters: the tree is
// insertion-ordered, so replaying out of order yields a different root.
const registry = createCaseRegistry();
for (const admitted of deployment.admittedCases) {
  registry.admit(hexToBytes(admitted, 'previously admitted case'));
}
const newRoot = registry.admit(caseCommitment);
console.log(`New root: ${newRoot.field.toString()}`);

const ctx = await buildWallet(config);
await waitForSynced(ctx);
const providers = await buildProviders(ctx, config);

const privateState: AuthorityPrivateState = {
  authoritySecret: hexToBytes(deployment.authoritySecret, 'authority secret'),
};

// The credential reaches the circuit through the private state provider, not
// through this script: the witness reads it from there. Handing it to
// `findDeployedContract` as `initialPrivateState` is what stores it. Writing it
// to the provider directly beforehand fails - private state is keyed by contract
// address, and the address is only bound once the contract is found.
const contract = await findDeployedContract(providers as never, {
  contractAddress: deployment.contractAddress,
  compiledContract: amparoContract(config),
  privateStateId: PRIVATE_STATE_ID,
  initialPrivateState: privateState,
} as never);

console.log('\nAdmitting (this generates a proof; the first one is slower)...');
const called = await (
  contract as unknown as {
    callTx: { admitCase(c: Uint8Array, r: { field: bigint }): Promise<{ public: { txId: string } }> };
  }
).callTx.admitCase(caseCommitment, newRoot);

console.log(`Transaction ${called.public.txId}`);

// Read the public state back and compare the two sources.
const rawState = await providers.publicDataProvider.queryContractState(deployment.contractAddress);
if (!rawState) throw new Error('Contract state could not be read back after admission');
const publicState = ledger(rawState.data);

console.log(`\nAdmitted count: ${publicState.admittedCount}`);
console.log(`Mirror root:    ${publicState.admittedRoot.field.toString()}`);
console.log(`Real tree root: ${publicState.admittedCases.root().field.toString()}`);

assertMirrorMatchesTree(publicState);
console.log('Mirror matches the on-chain tree.');

deployment.admittedCases.push(toHex(caseCommitment));
writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2) + '\n');

await closeWallet(ctx);
process.exit(0);
