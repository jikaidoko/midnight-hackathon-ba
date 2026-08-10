// useOversight.ts — the control portal's subscription to the public ledger.
//
// One stream, and it takes no secret. Everything the portal shows — the
// backlog, which cases crossed the threshold, which of those were answered and
// which were not — comes from state any observer can read. That is not a
// convenience: an oversight view that required a credential would quietly
// delete the property the whole design rests on, which is that "nobody told us"
// is not available as a defence.

import { useEffect, useState } from 'react'
import type { PublicLedgerView } from './contracts'
import { oversightFeed } from '.'

export function useOversightView(): PublicLedgerView | null {
  const [view, setView] = useState<PublicLedgerView | null>(() => oversightFeed.current())

  useEffect(() => {
    // Same shape as `useReporterView`: the feed is an async generator, so
    // breaking out of the loop is what runs its `finally` and unsubscribes.
    let cancelled = false
    void (async () => {
      for await (const next of oversightFeed.view$()) {
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

/** One case by commitment, or null while the backlog is still loading. */
export function useOversightCase(caseCommitment: string | undefined) {
  const view = useOversightView()
  if (!view || !caseCommitment) return null
  return view.cases.find((c) => c.caseCommitment === caseCommitment) ?? null
}
