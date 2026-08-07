// useReporterView.ts — the single subscription every screen reads from.
//
// One hook rather than per-screen fetches, because the view is not per screen:
// a filing changes a corroboration count that another screen is showing, and an
// admission can make every case unfileable at once. Screens that each held
// their own copy would disagree, and the one the user is looking at would be
// the stale one about half the time.

import { useEffect, useState } from 'react'
import type { ReporterView } from './contracts'
import { reporterFeed } from './mock'

export function useReporterView(): ReporterView | null {
  const [view, setView] = useState<ReporterView | null>(() => reporterFeed.current())

  useEffect(() => {
    // `cancelled` rather than an AbortController: the feed is an async
    // generator, and the `finally` in its body runs when the loop is exited, so
    // breaking out is what unsubscribes. Without the flag a late emission would
    // set state on an unmounted component.
    let cancelled = false
    void (async () => {
      for await (const next of reporterFeed.view$()) {
        if (cancelled) break
        setView(next)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return view
}

/** One case by commitment, or null while the view is still loading. */
export function useCase(caseCommitment: string | undefined) {
  const view = useReporterView()
  if (!view || !caseCommitment) return null
  return view.cases.find((c) => c.caseCommitment === caseCommitment) ?? null
}
