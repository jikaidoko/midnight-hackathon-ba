// useAuthority — the credential state, as React sees it.
//
// `useSyncExternalStore` rather than a context and an effect: the credential
// lives outside React because the adapters read it on a code path that has no
// component in it, and a copy in state would be a second answer to "who is
// answering" that nothing compares against the one the circuit will use.

import { useSyncExternalStore } from 'react'
import { authority } from './index'
import type { AuthoritySource } from './contracts'

/**
 * The source of the credential in force, re-rendering when it changes.
 *
 * The snapshot is the revision NUMBER, not the source string. Two different
 * presents can both land on `'session'`, and a subscriber that compared the
 * string alone would not re-render when one credential replaced another — the
 * screen would keep saying the right word about the wrong secret.
 */
export function useAuthoritySource(): AuthoritySource {
  useSyncExternalStore(authority.subscribe, authority.revision, authority.revision)
  return authority.source()
}

/** Whether this build needs a credential presented before it can answer. */
export function useAuthorityRequired(): boolean {
  return authority.required
}
