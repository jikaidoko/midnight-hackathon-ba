// useOversight.ts — the control portal's subscriptions.
//
// The backlog and each case's answer both come out of `derivePublicView`, which
// takes no secret: this is the view any observer can build, which is the property
// that makes "nobody told us" unavailable as a defence.
//
// An earlier version of this note said responses came from "a circuit this build
// does not carry". `respondToCase` is in the contract now, so that half is real.
// What an unanswered case renders is the ABSENCE of an entry - the observable the
// circuit exists to produce, not a gap in the wiring.

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
