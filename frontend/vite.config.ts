import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// `@amparo/contracts/*` resolves to the contract layer's source, by path.
//
// Deliberately NOT an npm workspace. Workspaces hoist, and hoisting is exactly
// how a second copy of a wasm package reappears — the failure the `overrides`
// block in `contracts/package.json` exists to prevent, and one that neither the
// typecheck nor the tests can see because neither builds a transaction. Keeping
// the two `node_modules` separate keeps each `overrides` block authoritative
// over its own tree.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@amparo/contracts': fileURLToPath(new URL('../contracts/src/midnight', import.meta.url)),
    },
  },
  server: { host: true, port: 5173 }
})
