// node-globals.ts — Node globals that dependencies read without importing.
//
// Vite externalises Node builtins for the browser rather than shimming them.
// Where a dependency IMPORTS one, `resolve.alias` in `vite.config.ts` points it
// at a polyfill package. This file is for the other case: a global read off
// nothing at all, which no alias can reach.
//
// `Buffer` is one. Under the wallet SDK it is used as a bare global, so the
// failure is `Buffer is not defined` thrown from inside a dependency — and,
// because nothing on the read path touches it, only when a transaction is
// actually built. Reads stay green, the build stays green, the tests stay green.
// It is the same shape as `assert` before it was aliased: loads fine, explodes
// at the first real use.
//
// This module must be evaluated before any dependency is. That is why it is a
// STATIC import at the top of `main.tsx`, whose own imports are all dynamic —
// the ordering is structural rather than a convention an import sorter could
// undo. `process` is installed the same way, from `index.html`, and earlier
// still, because it is read at MODULE scope by `util` rather than inside a call.

import { Buffer } from 'buffer'

// Assigned only when missing, so a real Buffer (or another shim that got here
// first) is never replaced by this one. Two Buffer implementations in one page
// is the same class of problem as two wasm copies: instances of one fail the
// other's checks.
const globals = globalThis as unknown as { Buffer?: unknown }
globals.Buffer ??= Buffer

/**
 * Named export so a source guard can prove this module was reached.
 *
 * Nothing imports it for its value: it exists because a side-effect-only module
 * is indistinguishable from a deleted one at every layer that could check.
 */
export const NODE_GLOBALS_INSTALLED = true
