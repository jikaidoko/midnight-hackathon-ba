// main.tsx — the entry point, and the one place a misconfigured build can still
// say so out loud.
//
// Two things happen here, and both exist because of the same failure: a chain
// build that cannot work renders NOTHING, with an empty console, and a blank
// page is the least diagnosable output a program has.
//
//   1. The app's modules are imported dynamically, inside a try. `config.ts` and
//      `providers.ts` validate at module scope on purpose — a wrong network
//      label or a weak storage password should stop the build before a single
//      screen appears. But a throw during a STATIC import aborts the entry
//      point's own evaluation, so the handler written to report it never runs
//      and the page stays white. Measured here: a password truncated by an
//      unquoted `#` in the env file produced exactly that — no render, no error,
//      nothing to read.
//
//   2. `assertZkAssets` then asks whether this origin actually serves the
//      proving keys for every circuit a screen here can call. Without it the
//      first symptom is a 404 raised from inside a dependency, seconds after
//      somebody pressed a button, mid-proof — which reads like a broken circuit
//      and is a missing `npm run copy-zk`. It is knowable at startup, so it is
//      asked at startup.
//
// Mock mode skips only the key check: it proves nothing and fetches no key, so
// failing it there would be a startup error invented for a build that cannot
// hit it. The visible-failure path is not skipped, because a mock build can be
// misconfigured too.

// FIRST, and static while everything else here is dynamic. It installs the Node
// globals dependencies read without importing, and it only works if it runs
// before any of them is evaluated — see the file for which ones and why.
import './node-globals'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)

/**
 * The refusal, rendered as a page.
 *
 * Verbatim, and with almost no styling. Every message this can receive names
 * the variable, the probed URL, or the command that fixes it; paraphrasing them
 * into "something went wrong" turns a one-line fix into a debugging session,
 * and this screen exists precisely for the moment when there is no time for one.
 */
function StartupFailure({ error }: { error: unknown }) {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: '46rem' }}>
      <h1 style={{ fontSize: '1.25rem' }}>La aplicación no arrancó</h1>
      <pre style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
        {error instanceof Error ? error.message : String(error)}
      </pre>
    </div>
  )
}

async function start() {
  try {
    const [{ default: App }, { CHAIN_MODE }, { assertZkAssets }] = await Promise.all([
      import('./App'),
      import('./services'),
      import('./midnight/providers'),
    ])

    if (CHAIN_MODE) await assertZkAssets()

    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </React.StrictMode>,
    )
  } catch (error) {
    root.render(<StartupFailure error={error} />)
  }
}

void start()
