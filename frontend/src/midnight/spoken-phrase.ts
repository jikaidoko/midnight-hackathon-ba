// spoken-phrase.ts - capturing the phrase by voice, on this device only.
//
// THE REASON THIS FILE IS SHAPED LIKE A GUARD: the browser's speech recognition
// is not necessarily local. In its original form it is a NETWORK service - audio
// is uploaded to the vendor's recogniser and text comes back. For this app the
// spoken phrase IS the reporter's secret, so a cloud recogniser would mail the
// secret to a third party on the way to deriving it. That is not a privacy
// nuance; it is the opposite of the product.
//
// So local processing is a precondition, not a preference, and the check fails
// CLOSED: anything short of a browser that confirms on-device recognition gets no
// microphone at all, and the interface asks the person to type instead. Typing is
// the path with no third party in it, which is why it is always offered and never
// presented as the degraded option.
//
// A silent fallback would be the worst outcome available here - the flow would
// look identical, work perfectly, and upload the secret. Hence two independent
// conditions below rather than one: the browser has to SAY on-device recognition
// is available, and the `processLocally` flag has to still be set when read back.
// A browser that ignores the flag drops it, and the readback is what notices.

/**
 * The subset used here. Declared locally because the on-device members are newer
 * than the ambient DOM types, and casting to `any` at the call site would remove
 * exactly the checking that keeps the two conditions below honest.
 */
interface LocalSpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  /** When set, recognition must not leave the device. */
  processLocally?: boolean
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionResultLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechRecognitionResultLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}

interface SpeechRecognitionConstructor {
  new (): LocalSpeechRecognition
  /** Newer browsers only. Its ABSENCE is treated as "no on-device support". */
  availableOnDevice?(lang: string): Promise<string>
  installOnDevice?(lang: string): Promise<boolean>
}

const LANG = 'es-AR'

function constructorFor(): SpeechRecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type MicrophoneStatus =
  /** On-device recognition confirmed. The microphone may be used. */
  | { readonly kind: 'ready' }
  /** The model is not present yet but the browser can fetch it. */
  | { readonly kind: 'installable' }
  /** No microphone path. `reason` is shown to the person. */
  | { readonly kind: 'unavailable'; readonly reason: string }

/**
 * Whether the phrase may be spoken on this browser.
 *
 * Every branch that is not a confirmed local model returns `unavailable`. The
 * default answer is no: an unknown state is indistinguishable from a cloud
 * recogniser from in here, and guessing wrong uploads the secret.
 */
export async function microphoneStatus(): Promise<MicrophoneStatus> {
  const Recognition = constructorFor()
  if (!Recognition) {
    return { kind: 'unavailable', reason: 'Este navegador no reconoce voz.' }
  }
  if (typeof Recognition.availableOnDevice !== 'function') {
    // Recognition exists, but the browser cannot tell us whether it runs here.
    // On this API that historically meant the vendor's servers, so it is refused
    // rather than tried.
    return {
      kind: 'unavailable',
      reason: 'Este navegador solo reconoce voz en sus servidores, y la frase es tu secreto.',
    }
  }
  try {
    const availability = await Recognition.availableOnDevice(LANG)
    if (availability === 'available') return { kind: 'ready' }
    if (availability === 'downloadable' || availability === 'downloading') {
      return { kind: 'installable' }
    }
    return {
      kind: 'unavailable',
      reason: 'No hay reconocimiento de voz local para espanol en este navegador.',
    }
  } catch {
    return { kind: 'unavailable', reason: 'No se pudo verificar si el reconocimiento es local.' }
  }
}

/** Downloads the local model. Only meaningful after an `installable` status. */
export async function installLocalModel(): Promise<boolean> {
  const Recognition = constructorFor()
  if (typeof Recognition?.installOnDevice !== 'function') return false
  try {
    return await Recognition.installOnDevice(LANG)
  } catch {
    return false
  }
}

/**
 * Listens once and resolves with the recognised text.
 *
 * Re-checks the status rather than trusting a value the caller passed: the model
 * can be uninstalled between a page load and a click, and the cost of being
 * wrong here is the secret leaving the device.
 */
export async function listenForPhrase(): Promise<string> {
  const status = await microphoneStatus()
  if (status.kind !== 'ready') {
    throw new Error(
      status.kind === 'installable'
        ? 'Falta descargar el reconocimiento de voz local.'
        : status.reason,
    )
  }

  const Recognition = constructorFor()
  if (!Recognition) throw new Error('Este navegador no reconoce voz.')

  const recognition = new Recognition()
  recognition.lang = LANG
  recognition.continuous = false
  recognition.interimResults = false
  recognition.maxAlternatives = 1
  recognition.processLocally = true

  // Second condition, independent of the first. A browser that does not
  // implement the flag silently discards the assignment, and then `start()`
  // would recognise remotely with everything above having reported fine. Reading
  // it back is what turns that into a refusal.
  if (recognition.processLocally !== true) {
    throw new Error('Este navegador ignora el pedido de reconocimiento local.')
  }

  return await new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    recognition.onresult = (event) => {
      const alternatives = event.results[0]
      const best = alternatives && alternatives[0]
      finish(() =>
        best?.transcript
          ? resolve(best.transcript)
          : reject(new Error('No se reconocio ninguna palabra.')),
      )
    }
    recognition.onerror = (event) => {
      const message =
        event.error === 'not-allowed'
          ? 'No diste permiso al microfono.'
          : event.error === 'no-speech'
            ? 'No se escucho nada.'
            : `El reconocimiento fallo (${event.error}).`
      finish(() => reject(new Error(message)))
    }
    // Fires after `onresult` on success and on its own when nothing was heard, so
    // it only rejects if neither of the two above already settled.
    recognition.onend = () => finish(() => reject(new Error('No se escucho nada.')))

    try {
      recognition.start()
    } catch {
      finish(() => reject(new Error('No se pudo abrir el microfono.')))
    }
  })
}
