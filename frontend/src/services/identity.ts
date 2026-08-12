// identity.ts - the phrase becomes the credential.
//
// Real in BOTH modes, unlike the other services, and that is deliberate rather
// than convenient: the derivation and the credential store are local either way,
// so there is nothing here a mock would stand in for. What mock mode does not do
// is USE the secret - its feed is scripted - so unlocking there proves the phrase
// works and proves nothing about a filing.
//
// The two steps are separate on purpose. Deriving is pure and reversible; storing
// is the step that can strand filings, and `adoptDerivedSecret` is where that
// refusal lives. Keeping them apart means a mistyped phrase costs a rejection
// rather than an identity.

import {
  derivePassphraseSecret,
  normalizePassphrase,
  phraseWords,
} from '@amparo/contracts/passphrase'
import { adoptDerivedSecret } from '../midnight/subject-store'
import type { IdentityResult, IdentityService } from './contracts'

export const passphraseIdentity: IdentityService = {
  async unlock(phrase: string): Promise<IdentityResult> {
    // Derive first, adopt second. Both can reject and the order decides what a
    // failure costs: a phrase below the floor is refused before anything touches
    // the store, so a mistake leaves the existing credential exactly as it was.
    const secret = await derivePassphraseSecret(phrase)
    // The store reports what happened rather than the caller guessing from
    // whether a credential existed beforehand - a random secret with no filings
    // is replaced, and that is not a confirmation of anything.
    const outcome = adoptDerivedSecret(secret)

    return { outcome, words: phraseWords(normalizePassphrase(phrase)).length }
  },
}
