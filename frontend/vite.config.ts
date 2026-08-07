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
    alias: {
      '@amparo/contracts': fileURLToPath(new URL('../contracts/src/midnight', import.meta.url)),
      // Compiler output and the witness implementation. Separate from the alias
      // above because these are generated, not authored: the interface needs
      // them to build a transaction, and only for that.
      '@amparo/generated': fileURLToPath(new URL('../contracts/src', import.meta.url)),
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
  },
  build: { target: 'esnext' },
  server: { host: true, port: 5173 },
})
