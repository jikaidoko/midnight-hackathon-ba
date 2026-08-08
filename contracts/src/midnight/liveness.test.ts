// liveness.test.ts — `keepAlive`, against the three ways a stream can end.
//
// This exists because the bug it prevents was invisible to every other kind of
// test. The indexer stream ends by COMPLETING, and a completed stream is a
// success by every signal a caller has: no error, no exception, no gap. The view
// simply stopped updating and went on serving its last snapshot. Typecheck saw
// nothing, the simulator tests saw nothing, and the only way it was found was by
// stopping a container and filing a report that never showed up.
//
// So each case here is one ending, with a source that produces it on purpose:
//
//   1. completion — the ending actually observed, and the one `repeat` covers
//   2. error      — what `retry` covers
//   3. silence    — an open socket that stopped delivering, what `timeout` covers
//   4. the endings are reported by kind, so a caller can tell a real failure
//      from a routine reconnect
//   5. a replayed burst collapses, because a resubscribe does not resume - it
//      replays, and unreplayed that walks the counters backwards on screen
//
// Fast timings throughout: this is operator wiring, not a timing measurement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEVER,
  defer,
  firstValueFrom,
  of,
  take,
  throwError,
  toArray,
  type Observable,
} from 'rxjs';
import { keepAlive, type StreamEnding } from './derived-state.js';

// `settleMs` well under `reconnectMs`, so a single emission per subscription
// still passes through individually. Test 5 inverts that on purpose.
const FAST = { heartbeatMs: 80, reconnectMs: 5, settleMs: 1 };

test('1. THE FAULT: a source that completes is resubscribed', async () => {
  // `of()` completes the instant it emits, which is exactly the shape the
  // indexer turned out to have. Without `repeat` the pipeline completes after
  // the first value and `toArray` returns [1] - so this assertion is the
  // regression guard for the whole bug.
  let subscriptions = 0;
  const source = defer(() => {
    subscriptions += 1;
    return of(subscriptions);
  });

  const seen = await firstValueFrom(source.pipe(keepAlive(FAST), take(3), toArray()));

  assert.deepEqual(seen, [1, 2, 3], 'each resubscribe produced a fresh emission');
});

test('2. a source that errors is resubscribed', async () => {
  let subscriptions = 0;
  const source = defer(() => {
    subscriptions += 1;
    return subscriptions < 3
      ? (throwError(() => new Error('indexer unreachable')) as Observable<string>)
      : of('recovered');
  });

  const value = await firstValueFrom(source.pipe(keepAlive(FAST)));

  assert.equal(value, 'recovered');
  assert.equal(subscriptions, 3, 'it kept trying rather than giving up on the first failure');
});

test('3. silence is treated as an ending, not as patience', async () => {
  // NEVER is the socket that stays open and delivers nothing. It neither errors
  // nor completes, so it is the one ending the other two operators cannot see.
  let subscriptions = 0;
  const endings: StreamEnding[] = [];
  const source = defer(() => {
    subscriptions += 1;
    return subscriptions === 1 ? (NEVER as Observable<string>) : of('alive');
  });

  const value = await firstValueFrom(
    source.pipe(keepAlive({ ...FAST, onReconnect: (e) => endings.push(e) })),
  );

  assert.equal(value, 'alive');
  // The FIRST ending, not the only one: `settleMs` holds the value back briefly,
  // and the healthy subscription that produced it completes in that window, so
  // a routine 'complete' is normally recorded behind the timeout. What this case
  // is about is that silence ended the first subscription at all.
  assert.equal(
    endings[0]?.kind,
    'timeout',
    'the silent subscription was abandoned and rebuilt',
  );
});

test('4. endings are reported by kind, and an error carries its message', async () => {
  // A caller has to tell these apart: a completion is routine and belongs in no
  // user-facing message, while an error is the one thing worth showing. The
  // public view uses exactly this distinction to decide whether to put a banner
  // on screen.
  const endings: StreamEnding[] = [];
  let subscriptions = 0;
  const source = defer(() => {
    subscriptions += 1;
    if (subscriptions === 1) return of('first') as Observable<string>;
    if (subscriptions === 2) return throwError(() => new Error('indexer said no'));
    return NEVER as Observable<string>;
  });

  const sub = source
    .pipe(keepAlive({ ...FAST, onReconnect: (e) => endings.push(e) }))
    .subscribe({ next: () => {} });
  await new Promise((resolve) => setTimeout(resolve, 300));
  sub.unsubscribe();

  assert.deepEqual(
    endings.slice(0, 3).map((e) => e.kind),
    ['complete', 'error', 'timeout'],
    'all three endings were seen and named',
  );
  // `assert.fail` returns never, which is what narrows `failure` to the error
  // variant for the message check below. An `assert.equal` on `.kind` would
  // pass at runtime and still leave the type a union.
  const failure = endings[1];
  if (failure?.kind !== 'error') {
    assert.fail(`expected the second ending to be an error, got ${failure?.kind}`);
  }
  assert.equal(
    failure.message,
    'indexer said no',
    'the message survives, because it is what a caller would display',
  );
});

test('5. a replayed burst collapses to the state it ended on', async () => {
  // What a real reconnect looks like. The indexer does not resume where the last
  // subscription stopped; it replays past states, so a rebuild on a chain
  // already at twelve reports delivered 10, 11, 12 inside one second. Passed
  // through, that is a counter running backwards on a projector.
  const source = defer(() => of(10, 11, 12));

  const seen = await firstValueFrom(
    source.pipe(
      // settle ABOVE reconnect here, so the whole replay lands inside one quiet
      // window and has to collapse rather than trickle out value by value.
      keepAlive({ heartbeatMs: 500, reconnectMs: 60, settleMs: 15 }),
      take(1),
      toArray(),
    ),
  );

  assert.deepEqual(seen, [12], 'only the state the burst ended on reached the caller');
});
