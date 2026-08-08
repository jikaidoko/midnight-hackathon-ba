// useOversight.ts — the control portal's subscriptions.
//
// Two of them, kept separate because they come from different places and one of
// them may not exist. The backlog is public chain state. Responses are written
// by a circuit this build does not carry, so in chain mode that half is empty
// and says so. Joining them into one hook would hide which half went missing.

import { useEffect, useState } from 'react'
import type { CaseResponseView, PublicLedgerView } from './contracts'
import { oversightFeed, responseService } from '.'

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

/**
 * Responses on record.
 *
 * A map with missing keys, never entries with blank fields: absence is the
 * observable this whole surface is built around, and a screen cannot tell an
 * empty string from an unanswered case.
 */
export function useResponses(): ReadonlyMap<string, CaseResponseView> {
  const [responses, setResponses] = useState(() => responseService.responses())

  useEffect(() => {
    // The service hands back the same Map instance it mutates, so a new Map is
    // built here on every change. Without the copy React compares the object to
    // itself, finds it unchanged, and skips the render that was the point.
    const sync = () => setResponses(new Map(responseService.responses()))
    sync()
    return responseService.subscribe(sync)
  }, [])

  return responses
}
