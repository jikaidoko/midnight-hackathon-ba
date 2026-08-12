import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/Layout'
import { VoiceOrb } from '../components/VoiceOrb'
import { PASSPHRASE_NOTICE, type AdoptionOutcome } from '../services/contracts'
import { identityService } from '../services'
import {
  installLocalModel,
  listenForPhrase,
  microphoneStatus,
  type MicrophoneStatus,
} from '../midnight/spoken-phrase'
import {
  PHRASE_MIN_WORDS,
  normalizePassphrase,
  phraseProblem,
  phraseWords,
} from '@amparo/contracts/passphrase'

/**
 * What actually happened to the credential, in words.
 *
 * `created` deliberately does NOT say "listo" and nothing else: on a device with
 * no credential, any phrase succeeds, so a confident message there would read as
 * confirmation of a phrase that was never checked against anything.
 */
const OUTCOME_TEXT: Record<AdoptionOutcome, string> = {
  confirmed: 'Frase correcta: es la credencial que ya estaba en este dispositivo.',
  created: 'Credencial abierta. En un dispositivo nuevo cualquier frase abre una, asi que si te equivocaste vas a ver una credencial vacia.',
  replaced: 'Credencial abierta. La que habia en este dispositivo no tenia denuncias, asi que quedo reemplazada por esta.',
}

export default function IdentityPage() {
  const navigate = useNavigate()
  const [phrase, setPhrase] = useState('')
  const [state, setState] = useState<'idle' | 'listening' | 'processing' | 'success'>('idle')
  const [mic, setMic] = useState<MicrophoneStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // Asked once on mount, not on click: the answer decides whether a microphone
  // button exists at all, and offering one that will be refused is worse than not
  // offering it.
  useEffect(() => {
    microphoneStatus().then(setMic, () =>
      setMic({ kind: 'unavailable', reason: 'No se pudo consultar el microfono.' }),
    )
  }, [])

  const words = phraseWords(normalizePassphrase(phrase)).length
  const problem = phraseProblem(normalizePassphrase(phrase))
  const busy = state === 'listening' || state === 'processing'

  async function speak() {
    setError(null)
    setState('listening')
    try {
      // Fills the box rather than unlocking straight away. Recognition mishears,
      // and the phrase is the secret: seeing it before it is used is the
      // difference between fixing a word and opening an empty credential.
      setPhrase(await listenForPhrase())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo escuchar.')
    } finally {
      setState('idle')
    }
  }

  async function install() {
    setError(null)
    setMic((await installLocalModel())
      ? { kind: 'ready' }
      : { kind: 'unavailable', reason: 'No se pudo descargar el reconocimiento local.' })
  }

  async function unlock() {
    if (busy || problem) return
    setError(null)
    setState('processing')
    try {
      const result = await identityService.unlock(phrase)
      setDone(OUTCOME_TEXT[result.outcome])
      setState('success')
      setTimeout(() => navigate('/reports'), 1400)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir la credencial.')
      setState('idle')
    }
  }

  return <AppShell>
    <section className="hero identity-hero">
      <span className="eyebrow">Identidad privada</span>
      <h1>Tu frase abre tu credencial</h1>
      <p>
        Deci o escribi siempre la misma frase. De ella sale tu credencial, y a la red solo
        llega una prueba: la frase no se guarda ni se envia a ningun lado.
      </p>

      <VoiceOrb
        size="large"
        state={state}
        onClick={mic?.kind === 'ready' && !busy ? speak : undefined}
      />

      {mic?.kind === 'ready' && <h3>{state === 'listening' ? 'Escuchando…' : 'Tocá para dictarla'}</h3>}
      {mic?.kind === 'installable' && (
        <p className="muted">
          El reconocimiento de voz local todavia no esta descargado.{' '}
          <button className="link" onClick={install}>Descargarlo</button>, o escribi la frase.
        </p>
      )}
      {/* Not a degraded path. The microphone is refused whenever recognition
          would happen on someone else's servers, and typing is the option with
          no third party in it at all. */}
      {mic?.kind === 'unavailable' && (
        <p className="muted">{mic.reason} Escribi la frase acá abajo.</p>
      )}

      <label className="phrase-field">
        <span>Tu frase</span>
        <textarea
          rows={2}
          value={phrase}
          disabled={busy}
          onChange={(event) => setPhrase(event.target.value)}
          placeholder={`Al menos ${PHRASE_MIN_WORDS} palabras`}
        />
      </label>

      {/* Counts words while they type. The floor is enforced in the derivation
          either way; this is so nobody reaches the button and finds out then. */}
      <small className="muted">
        {words === 0 ? 'Sin palabras todavia.' : `${words} palabra(s).`}
        {problem ? ` ${problem.message}` : ''}
      </small>

      <button className="primary" onClick={unlock} disabled={busy || !!problem}>
        {state === 'processing' ? 'Abriendo tu credencial…' : 'Abrir mi credencial'}
      </button>

      {error && <p className="error">{error}</p>}
      {done && <p className="ok">{done}</p>}

      {/* The claim the build cannot back, on the screen that makes it. This is
          not voice recognition: the words are what count, not the voice. */}
      <p className="muted">{PASSPHRASE_NOTICE}</p>
    </section>
  </AppShell>
}
