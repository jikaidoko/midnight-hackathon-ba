import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { fileURLToPath, URL } from 'node:url'

// `@amparo/contracts/*` resolves to the contract layer's source, by path.
//
// Deliberately NOT an npm workspace. Workspaces hoist, and hoisting is exactly
// how a second copy of a wasm package reappears — the failure the `overrides`
// block exists to prevent, and one that neither the typecheck nor the tests can
// see because neither builds a transaction. Keeping the two `node_modules`
// separate keeps each `overrides` block authoritative over its own tree.
// `npm run check-wasm` is what verifies it.
//
// The two plugins are not optional. The ledger and runtime packages are
// WebAssembly and initialise with a top-level await, which esbuild cannot emit
// for the default target — without these the failure is a build-time parse
// error about top-level await, which reads like a syntax problem in application
// code rather than a bundler target problem in a dependency.
export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  resolve: {
    // ONE copy of each wasm package in the browser bundle, whichever tree the
    // importer came from. Without this the page loads, queries the indexer
    // successfully, and then dies decoding the answer:
    //
    //   Error: expected instance of ChargedState
    //     at _assertClass (contracts/node_modules/@midnight-ntwrk/onchain-runtime-v3/...)
    //
    // The mechanism is the one `overrides` guards against inside a single tree,
    // arriving by a route `overrides` cannot reach. `@amparo/generated` aliases
    // to `../contracts/src`, so `ledger()` and the generated contract resolve
    // their runtime from `contracts/node_modules`, while the providers resolve
    // theirs from `frontend/node_modules`. Two copies, each owning its own wasm
    // instance and therefore its own classes, so a state object built by one
    // fails the other's `_assertClass`.
    //
    // `npm run check-wasm` cannot see this and reported green throughout: it
    // compares VERSIONS per tree, and both trees hold the same version.
    // Identical versions are still two instances, so that guard passing is not
    // evidence about this failure - `check-wasm` now also counts resolved paths,
    // which is the part that can see it.
    //
    // Node is unaffected, which is what made the failure browser-only:
    // `ledger-view.ts` runs entirely inside `contracts/`, so the provider and
    // `ledger()` share one resolution and one instance.
    dedupe: [
      '@midnight-ntwrk/ledger-v8',
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/compact-runtime',
    ],
    alias: {
      '@amparo/contracts': fileURLToPath(new URL('../contracts/src/midnight', import.meta.url)),
      // Compiler output and the witness implementation. Separate from the alias
      // above because these are generated, not authored: the interface needs
      // them to build a transaction, and only for that.
      '@amparo/generated': fileURLToPath(new URL('../contracts/src', import.meta.url)),
      // `events` is a Node builtin, and Vite externalises builtins for the
      // browser rather than shimming them. `abstract-level` — reached through
      // level-private-state-provider, which is how the reporter credential is
      // stored — does `class AbstractLevel extends EventEmitter`, so the
      // externalised stub arrives as `undefined` and the class body throws at
      // module evaluation: "Class extends value undefined". It fails while the
      // module graph loads, before any application code runs, so the page is
      // blank and the stack names only dependencies.
      events: 'events',
      // Same externalisation, later blast radius. `@subsquid/scale-codec` —
      // under the indexer provider, so it runs on every public-state query —
      // does `(0, assert_1.default)(...)`, and the stub is an object, not a
      // function. It loads fine and throws the first time anything is decoded,
      // which is mid-query in chain mode rather than at startup. Nothing in
      // mock mode reaches it, so the page would look healthy right up to the
      // first real read.
      assert: 'assert',
    },
  },
  // Pre-bundling rewrites these into a form that loses the wasm init, so they
  // are handled by the plugins above instead.
  optimizeDeps: {
    exclude: [
      '@midnight-ntwrk/ledger-v8',
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/compact-runtime',
    ],
    // Excluding a package also stops its dependencies from being pre-bundled,
    // and pre-bundling is what gives a CommonJS module an ESM default export.
    // `compact-runtime/dist/error.js` does `import inspect from 'object-inspect'`,
    // and `object-inspect` is CommonJS, so the dev server serves it raw and the
    // browser rejects the module: "does not provide an export named 'default'".
    // Dev only — the production build resolves the same interop through the
    // commonjs plugin, so `npm run build` stays green while `npm run dev` cannot
    // load the page. Listing the dependency on its own keeps the three wasm
    // packages excluded, which is what the plugins above need.
    include: ['object-inspect'],
  },
  // `process` is a Node global, and Vite externalises it for the browser like
  // every other builtin. Some dependencies GUARD it (`typeof process === 'object'`)
  // and survive; others read `process.env` directly and throw at module load with
  // "process is not defined", from inside an esbuild CommonJS wrapper whose stack
  // names only the wrapper. Replacing the expression textually keeps the guarded
  // reads working - a real `process` object would make those guards pass and then
  // fail on the member they expected.
  define: { 'process.env': '{}' },
  build: { target: 'esnext' },
  server: { host: true, port: 5173 },
})
