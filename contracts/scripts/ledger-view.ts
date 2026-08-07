// ledger-view.ts - the public ledger, live, for an audience.
//
//   npm run ledger-view
//
// Serves the deliberately public half of the contract: how many independent
// reports each admitted case has, and which cases crossed the threshold into
// review. It is the third view of the demo, and the only one whose subject is an
// institution rather than a person.
//
// WHAT THIS PROCESS DOES NOT BUILD, and why that is the point:
//
//   no wallet          nothing here signs or submits, so there is no seed to
//                      hold, no sync to wait for, and no chance of the wallet
//                      out-of-memory that has cost this project the most time
//   no proof server    reading proves nothing
//   no private state   the view takes no secret, because `derivePublicView`
//                      has no parameter through which one could enter
//
// An indexer is the entire dependency. That is what makes this the view that is
// safe to leave running on a projector: every failure mode the other two share
// belongs to machinery this one never touches.
//
// The page polls this process; this process holds ONE live subscription to the
// chain. So the flag flipping on screen is the chain's own event arriving, not a
// poll that happened to catch a changed number - the polling only carries the
// last thing the subscription saw to the browser.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { retry, tap } from 'rxjs';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { loadConfig, PKG_ROOT } from '../src/midnight/config.js';
import { publicView$, type PublicLedgerView } from '../src/midnight/derived-state.js';

const config = loadConfig();

const deploymentFile = resolve(PKG_ROOT, `deployment.${config.networkId}.json`);
if (!existsSync(deploymentFile)) {
  throw new Error(`No deployment at ${deploymentFile}. Run \`npm run deploy\`.`);
}
const deployment = JSON.parse(readFileSync(deploymentFile, 'utf8')) as {
  contractAddress: string;
  reviewThreshold?: string;
};

// `reviewThreshold` is `sealed`, so it is absent from the generated Ledger
// projection and no client can read it off the chain. It comes from the record
// written at deployment, which is the only place it was ever visible.
if (deployment.reviewThreshold === undefined) {
  throw new Error(
    `${deploymentFile} has no reviewThreshold. It is a sealed field and cannot be read from ` +
      'the chain, so a record without it cannot say how far a case is from review. Redeploy.',
  );
}
const reviewThreshold = BigInt(deployment.reviewThreshold);

const port = Number(process.env.MN_LEDGER_VIEW_PORT ?? 8090);

// Address handling is network-scoped in the SDK, so this has to be set before
// the provider is built rather than after.
setNetworkId(config.networkId);

const publicDataProvider = indexerPublicDataProvider(config.indexerUrl, config.indexerWsUrl);

// ---------------------------------------------------------------------------
// The live snapshot
// ---------------------------------------------------------------------------

interface Snapshot {
  /** Null until the first emission: a contract deployed one block ago is normal. */
  view: PublicLedgerView | null;
  /** Set when the subscription itself fails, so the page can say so. */
  error: string | null;
  /** ISO time of the last emission, for the staleness indicator. */
  updatedAt: string | null;
  /** Emissions so far. A number that stops moving is the useful signal. */
  updates: number;
}

const snapshot: Snapshot = { view: null, error: null, updatedAt: null, updates: 0 };

// An rxjs subscription is TERMINAL on error, so an `error` handler that only
// records the failure leaves the stream dead: the page would serve the last
// snapshot forever, moving nothing. `tap` records it so the page can say so,
// `retry` reconnects. On a projector a view that stops silently is worse than
// one that admits it is broken.
const subscription = publicView$({ publicDataProvider } as never, {
  contractAddress: deployment.contractAddress,
  reviewThreshold,
})
  .pipe(
    tap({
      error: (err: unknown) => {
        snapshot.error = err instanceof Error ? err.message : String(err);
        console.error('Subscription failed, retrying in 2s:', snapshot.error);
      },
    }),
    retry({ delay: 2000 }),
  )
  .subscribe({
    next: (view) => {
      snapshot.view = view;
      snapshot.error = null;
      snapshot.updatedAt = new Date().toISOString();
      snapshot.updates += 1;
      console.log(
        `[${new Date().toLocaleTimeString()}] ${view.admittedCount} admitted · ` +
          `${view.totalReports} reports · ${view.underReviewCount} under review`,
      );
    },
  });

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

/** JSON.stringify cannot encode a bigint, and every count here is one. */
const asJson = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

const PAGE = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Amparo - public ledger</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 2rem;
    background: #2C2C2A; color: #B4B2A9;
    font: 15px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  h1 { font-size: 1.1rem; letter-spacing: .18em; text-transform: uppercase; color: #EAE8E0; margin: 0 0 .4rem; }
  .sub { color: #6E6C66; margin-bottom: 2rem; font-size: .82rem; word-break: break-all; }
  .totals { display: flex; flex-wrap: wrap; gap: 2.5rem; margin-bottom: 2.2rem;
            border-top: 1px solid #45443F; border-bottom: 1px solid #45443F; padding: 1.1rem 0; }
  .total .n { font-size: 1.9rem; color: #EAE8E0; }
  .total .n.flag { color: #EF9F27; }
  .total .k { font-size: .72rem; letter-spacing: .13em; text-transform: uppercase; color: #6E6C66; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: .7rem; letter-spacing: .13em; text-transform: uppercase;
       color: #6E6C66; font-weight: 400; padding: 0 .8rem .7rem 0; border-bottom: 1px solid #45443F; }
  td { padding: .85rem .8rem .85rem 0; border-bottom: 1px solid #35342F; vertical-align: middle; }
  tr.review td { background: rgba(239,159,39,.07); }
  .case { color: #8F8D85; }
  tr.review .case { color: #EAE8E0; }
  .bar { display: inline-block; width: 130px; height: 7px; background: #3A3934; vertical-align: middle; margin-right: .7rem; }
  .bar i { display: block; height: 100%; background: #7E7C74; }
  tr.review .bar i { background: #EF9F27; }
  .status { font-size: .74rem; letter-spacing: .1em; text-transform: uppercase; }
  .status.open { color: #6E6C66; }
  .status.review { color: #EF9F27; }
  /* The flip is the moment the demo is built around, so it is announced. */
  @keyframes flash { 0%,100% { background: rgba(239,159,39,.07); } 35% { background: rgba(239,159,39,.42); } }
  tr.flip td { animation: flash 1.15s ease-in-out 2; }
  .foot { margin-top: 2.2rem; font-size: .74rem; color: #55534E; }
  .err { color: #E06B4F; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #6D8B3A; margin-right: .45rem; }
  .dot.stale { background: #E06B4F; }
</style>
</head>
<body>
  <h1>Amparo &mdash; public ledger</h1>
  <div class="sub" id="sub"></div>
  <div class="totals" id="totals"></div>
  <table>
    <thead><tr><th style="width:42%">Case commitment</th><th style="width:34%">Independent reports</th><th>Status</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="foot" id="foot"></div>

<script>
const flagged = new Set();   // cases already seen under review, so a flip flashes once
let first = true;

function render(s) {
  const sub = document.getElementById('sub');
  // One branch, not two writes: the error line used to be overwritten by the
  // network line four statements later, so a dead subscription looked identical
  // to a healthy one. textContent rather than innerHTML because this string is
  // the indexer's, not ours - the only value on the page we do not author.
  if (s.error) {
    sub.textContent = 'subscription error: ' + s.error;
    sub.classList.add('err');
  } else if (s.meta) {
    sub.textContent = s.meta.network + ' · contract ' + s.meta.contractAddress;
    sub.classList.remove('err');
  }
  if (!s.view) {
    document.getElementById('foot').textContent = 'Waiting for the first state from the chain...';
    return;
  }
  const v = s.view;

  document.getElementById('totals').innerHTML = [
    ['Cases admitted', v.admittedCount, false],
    ['Reports filed', v.totalReports, false],
    ['Under review', v.underReviewCount, Number(v.underReviewCount) > 0],
    ['Review threshold', v.reviewThreshold, false],
  ].map(function (t) {
    return '<div class="total"><div class="n' + (t[2] ? ' flag' : '') + '">' + t[1] +
           '</div><div class="k">' + t[0] + '</div></div>';
  }).join('');

  document.getElementById('rows').innerHTML = v.cases.map(function (c) {
    const reports = Number(c.reports), threshold = Number(v.reviewThreshold);
    const pct = Math.min(100, threshold === 0 ? 100 : (reports / threshold) * 100);
    // A case already flagged when the page loaded is not a flip we witnessed.
    const isFlip = c.underReview && !flagged.has(c.caseCommitment) && !first;
    if (c.underReview) flagged.add(c.caseCommitment);
    return '<tr class="' + (c.underReview ? 'review ' : '') + (isFlip ? 'flip' : '') + '">' +
      '<td class="case">' + c.caseCommitment.slice(0, 16) + '&hellip;</td>' +
      '<td><span class="bar"><i style="width:' + pct + '%"></i></span>' + reports +
        (c.underReview ? '' : ' <span style="color:#55534E">(' + c.reportsToReview + ' to review)</span>') +
      '</td>' +
      '<td><span class="status ' + (c.underReview ? 'review' : 'open') + '">' +
        (c.underReview ? 'Under review' : 'Open') + '</span></td>' +
    '</tr>';
  }).join('');
  first = false;

  const age = s.updatedAt ? (Date.now() - new Date(s.updatedAt).getTime()) / 1000 : null;
  document.getElementById('foot').innerHTML =
    '<span class="dot' + (age !== null && age > 90 ? ' stale' : '') + '"></span>' +
    s.updates + ' chain updates · last ' +
    (age === null ? 'never' : age < 2 ? 'just now' : Math.round(age) + 's ago') +
    ' · nothing on this page identifies a reporter';
}

async function tick() {
  try {
    const r = await fetch('/api/state');
    render(await r.json());
  } catch (e) {
    document.getElementById('foot').innerHTML = '<span class="err">view server unreachable</span>';
  }
}
tick();
setInterval(tick, 1000);
</script>
</body>
</html>`;

const server = createServer((req, res) => {
  if (req.url === '/api/state') {
    res.writeHead(200, {
      'content-type': 'application/json',
      // The page polls every second; a cached response would freeze the demo.
      'cache-control': 'no-store',
    });
    res.end(
      asJson({
        ...snapshot,
        meta: {
          network: config.networkId,
          contractAddress: deployment.contractAddress,
        },
      }),
    );
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});

// Bound to loopback explicitly. Without the host argument Node listens on every
// interface, so a view whose banner promises 127.0.0.1 was in fact reachable
// from the whole venue wifi - and this is the one process here meant to be left
// running unattended.
server.listen(port, '127.0.0.1', () => {
  // Only the two services this view actually uses. `describe(config)` also
  // lists the node and the proof server, three lines above a banner that says
  // it uses neither.
  console.log(`network:  ${config.networkId}`);
  console.log(`indexer:  ${config.indexerUrl}`);
  console.log(`\nContract: ${deployment.contractAddress}`);
  console.log(`Threshold: ${reviewThreshold} independent reports`);
  console.log(`\nPublic ledger view: http://127.0.0.1:${port}`);
  console.log('No wallet, no proof server: this view only reads.\n');
});

// Without this the subscription keeps the process alive after Ctrl-C and the
// port stays bound, which during a demo reads as "the port is already in use".
const shutdown = (): void => {
  subscription.unsubscribe();
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
