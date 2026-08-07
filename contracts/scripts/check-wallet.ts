// check-wallet.ts - builds the wallet, waits for it to sync, prints its public
// keys. Signs nothing and submits nothing.
//
//   npm run check-wallet
//
// Run this before any deployment. It separates two failures that look identical
// from inside a deploy: "the network is unreachable" and "this seed does not
// build the wallet I think it does". Finding out during a deployment costs the
// deployment; finding out here costs a minute.

import { loadConfig, describe } from '../src/midnight/config.js';
import { buildWallet, waitForSynced, closeWallet } from '../src/midnight/providers.js';

const startedAt = Date.now();
const config = loadConfig();

console.log(describe(config));
console.log('\nBuilding the wallet and syncing...\n');

const ctx = await buildWallet(config);
const state = await waitForSynced(ctx);

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\nSynced in ${elapsed}s.`);
console.log(`  coin public key:       ${state.shielded.coinPublicKey.toHexString()}`);
console.log(`  encryption public key: ${state.shielded.encryptionPublicKey.toHexString()}`);

await closeWallet(ctx);
process.exit(0);
