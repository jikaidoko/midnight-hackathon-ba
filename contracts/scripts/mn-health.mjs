// mn-health.mjs - one health check covering all three services.
//
//   npm run mn:health                    HTTP checks, a few seconds
//   npm run mn:health -- --ws-seconds=30 also hold subscriptions open for 30s
//   npm run mn:health -- --node=... --indexer=... --proof=...
//
// This script exists because `docker compose ps` cannot answer the question on
// its own. The proof server image is distroless - no shell, no HTTP client - so
// no container-side healthcheck can run in it, and it reports `Up` forever
// instead of `healthy`. Waiting for three healthy services never succeeds. The
// check that does work is from the host, which is this.
//
// What each plane tells you:
//   HTTP  - the services are up, and the indexer is keeping up with the node.
//   WS    - subscriptions stay open. A wallet sync is a long-lived subscription,
//           so a socket that drops after a minute means a sync that never ends,
//           while every HTTP check stays green. Worth running before a demo on a
//           public network; on the local network it rarely tells you anything
//           new.
//
// A green result here says the network is reachable. It does not say a wallet
// will finish syncing: this measures cheap subscriptions, not the historical
// scan. Use `npm run check-wallet` for that.
//
// No dependencies: native fetch and WebSocket (Node 22+).

const args = process.argv.slice(2);

const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const NODE_URL = flag('node', process.env.MN_NODE_URL ?? 'http://127.0.0.1:9944');
const INDEXER_URL = flag(
  'indexer',
  process.env.MN_INDEXER_URL ?? 'http://127.0.0.1:8088/api/v4/graphql',
);
const PROOF_URL = flag('proof', process.env.MN_PROOF_SERVER_URL ?? 'http://127.0.0.1:6300');
const INDEXER_WS_URL = flag(
  'indexer-ws',
  process.env.MN_INDEXER_WS_URL ?? INDEXER_URL.replace(/^http/, 'ws') + '/ws',
);
const WS_SECONDS = Number(flag('ws-seconds', '0'));
const TIMEOUT_MS = Number(flag('timeout', '10000'));

/** Blocks the indexer may trail the node by before it counts as stale. */
const MAX_LAG_BLOCKS = 10;

const ok = (m) => console.log(`  OK    ${m}`);
const bad = (m) => console.log(`  FAIL  ${m}`);
const warn = (m) => console.log(`  WARN  ${m}`);

let failures = 0;
const fail = (m) => {
  failures += 1;
  bad(m);
};

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// HTTP plane
// ---------------------------------------------------------------------------

/** Node tip height, through the substrate JSON-RPC. */
async function nodeTip() {
  const res = await withTimeout(
    fetch(NODE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getHeader', params: [] }),
    }),
    TIMEOUT_MS,
    'node RPC',
  );
  if (!res.ok) throw new Error(`node RPC returned HTTP ${res.status}`);
  const body = await res.json();
  const height = body?.result?.number;
  if (typeof height !== 'string') throw new Error('node RPC returned no block header');
  return Number.parseInt(height, 16);
}

/** Indexer tip height and the timestamp of that block. */
async function indexerTip() {
  const res = await withTimeout(
    fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query { block { height timestamp } }' }),
    }),
    TIMEOUT_MS,
    'indexer',
  );
  if (!res.ok) throw new Error(`indexer returned HTTP ${res.status}`);
  const body = await res.json();
  if (body?.errors?.length) throw new Error(`indexer GraphQL error: ${body.errors[0].message}`);
  const block = body?.data?.block;
  if (!block) throw new Error('indexer returned no block; it may still be starting up');
  return { height: Number(block.height), timestamp: block.timestamp };
}

/** Proof server liveness. This is the check no compose healthcheck can perform. */
async function proofServerAlive() {
  const res = await withTimeout(fetch(`${PROOF_URL}/health`), TIMEOUT_MS, 'proof server');
  if (!res.ok) throw new Error(`proof server returned HTTP ${res.status}`);
  return (await res.text()).trim();
}

// ---------------------------------------------------------------------------
// WebSocket plane
// ---------------------------------------------------------------------------

/**
 * Opens a socket, runs a protocol-specific driver, and reports how long the
 * connection survived. Resolves rather than rejects: a socket that drops early
 * is a result, not an error.
 */
function probeSocket({ name, url, protocols, driver, seconds }) {
  return new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') {
      resolve({ name, ok: false, note: 'no WebSocket in this Node runtime', events: 0, ms: 0 });
      return;
    }

    const startedAt = Date.now();
    let events = 0;
    let note = 'connecting';
    let settled = false;

    const socket = protocols ? new WebSocket(url, protocols) : new WebSocket(url);

    const finish = (survived) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      resolve({ name, ok: survived, note, events, ms: Date.now() - startedAt });
    };

    const api = {
      send: (obj) => socket.send(JSON.stringify(obj)),
      setNote: (n) => {
        note = n;
      },
      count: () => {
        events += 1;
      },
    };

    const timer = setTimeout(() => finish(true), seconds * 1000);

    socket.onopen = () => {
      note = 'open';
      driver.onOpen?.(api);
    };
    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      driver.onMessage?.(api, msg);
    };
    socket.onerror = () => {
      note = 'socket error';
      finish(false);
    };
    socket.onclose = (event) => {
      note = `closed early (code ${event?.code ?? 'unknown'})`;
      finish(false);
    };
  });
}

/** Indexer subscriptions speak graphql-transport-ws: init, ack, then subscribe. */
const indexerDriver = {
  onOpen: (api) => api.send({ type: 'connection_init', payload: {} }),
  onMessage: (api, msg) => {
    if (msg.type === 'connection_ack') {
      api.setNote('acknowledged');
      api.send({
        id: '1',
        type: 'subscribe',
        payload: { query: 'subscription { blocks { height } }' },
      });
      return;
    }
    if (msg.type === 'next') {
      api.count();
      api.setNote('streaming blocks');
      return;
    }
    // A schema that rejects this particular subscription still proves the socket
    // itself stays up, which is what the probe measures.
    if (msg.type === 'error') api.setNote('subscription rejected; measuring the socket only');
  },
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log('Midnight network health');
console.log(`  node    ${NODE_URL}`);
console.log(`  indexer ${INDEXER_URL}`);
console.log(`  proof   ${PROOF_URL}`);
console.log('');

let tip;
try {
  tip = await nodeTip();
  ok(`node is answering, chain tip #${tip.toLocaleString('en-US')}`);
} catch (error) {
  fail(`node: ${error.message}`);
}

try {
  const indexer = await indexerTip();
  const lag = tip === undefined ? undefined : tip - indexer.height;
  const suffix = lag === undefined ? '' : `, ${lag} block(s) behind the node`;
  if (lag !== undefined && lag > MAX_LAG_BLOCKS) {
    warn(`indexer is answering at #${indexer.height.toLocaleString('en-US')}${suffix}`);
    warn('  the indexer is falling behind; queries will return stale public state');
  } else {
    ok(`indexer is answering at #${indexer.height.toLocaleString('en-US')}${suffix}`);
  }
} catch (error) {
  fail(`indexer: ${error.message}`);
}

try {
  const body = await proofServerAlive();
  ok(`proof server is answering (${body.slice(0, 60)})`);
} catch (error) {
  fail(`proof server: ${error.message}`);
}

if (WS_SECONDS > 0) {
  console.log(`\nHolding subscriptions open for ${WS_SECONDS}s`);
  const results = await Promise.all([
    probeSocket({
      name: 'indexer subscription',
      url: INDEXER_WS_URL,
      protocols: 'graphql-transport-ws',
      driver: indexerDriver,
      seconds: WS_SECONDS,
    }),
    probeSocket({
      name: 'node new-heads subscription',
      url: NODE_URL.replace(/^http/, 'ws'),
      driver: {
        onOpen: (api) =>
          api.send({ jsonrpc: '2.0', id: 1, method: 'chain_subscribeNewHeads', params: [] }),
        onMessage: (api, msg) => {
          if (msg.method === 'chain_newHead') {
            api.count();
            api.setNote('streaming heads');
          }
        },
      },
      seconds: WS_SECONDS,
    }),
  ]);

  for (const r of results) {
    const detail = `${r.note}, ${r.events} event(s), ${(r.ms / 1000).toFixed(1)}s`;
    if (r.ok) ok(`${r.name}: survived the full window (${detail})`);
    else fail(`${r.name}: dropped early (${detail})`);
  }
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed. The network is reachable.');
console.log('This does not guarantee a wallet will finish syncing: run `npm run check-wallet`.');
process.exit(0);
