// AuthorityGate — the control body identifies itself before it can answer.
//
// WHERE THIS SITS, and it is the whole design: in front of ANSWERING, never in
// front of reading. The backlog is derivable from public state by any observer,
// and that is exactly what makes "nobody told us" unavailable as a defence. A
// credential prompt on the inbox would delete that property while looking like
// security — the queue would become a thing only the body can see, which is the
// arrangement this contract exists to replace.
//
// So: `/control` and `/control/:id` stay open to anyone with the URL. This gate
// stands between the case and the form that writes to the chain.

import { useState, type FormEvent } from 'react'
import { KeyRound, ShieldAlert } from 'lucide-react'
import { authority } from '../../services'

export function AuthorityGate({ onReady }: { onReady?: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    try {
      authority.present(value)
      // Cleared on success only. On failure the value stays so the official can
      // see what they pasted — a field that empties itself on error hides
      // whether the paste was truncated, which is the likeliest mistake here.
      setValue('')
      setError(null)
      onReady?.()
    } catch (e) {
      // Verbatim. The two refusals — wrong shape, and "this is the wallet seed"
      // — have completely different fixes, and "clave inválida" would hide which.
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="panel wide pad-xl respond-stack">
      <div className="control-banner">
        <KeyRound size={22} />
        <div>
          <h3>Identificate para responder</h3>
          <p>
            Leer el registro no necesita credencial y nunca la va a necesitar: cualquiera puede
            derivar la bandeja, y por eso nadie puede decir después que no se enteró. Registrar
            una respuesta sí, porque prueba que conocés la preimagen del compromiso de autoridad
            que el contrato publicó.
          </p>
        </div>
      </div>

      <form className="field" onSubmit={submit}>
        <label className="field__label" htmlFor="authority-secret">
          <span>Secreto de autoridad</span>
          <span className="hint">64 caracteres hex</span>
        </label>
        <input
          id="authority-secret"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder="Pegalo desde el registro de despliegue"
          onChange={(e) => setValue(e.target.value)}
        />
        <small style={{ color: 'var(--outline)' }}>
          Queda en memoria mientras dure esta sesión y no viaja a ningún servidor. Si recargás la
          página hay que volver a pegarlo: se sostiene en memoria y no en el almacenamiento del
          navegador, que sobrevive a la recarga y lo puede leer cualquier script de este origen.
        </small>

        {error && (
          <div className="control-banner alert" style={{ marginTop: 'var(--md)' }}>
            <ShieldAlert size={22} />
            <p>{error}</p>
          </div>
        )}

        <div className="form-actions" style={{ marginTop: 'var(--md)' }}>
          <button className="btn-solid" type="submit" disabled={value.trim().length === 0}>
            <KeyRound size={16} />
            Presentar credencial
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * Shown when the credential came from the build rather than from a person.
 *
 * This is the configuration the gate exists to make survivable, so it is stated
 * rather than left to be inferred from the absence of a prompt. Whoever holds
 * this bundle can answer cases; that is a fact about the artifact, and the only
 * place it can be noticed is here.
 */
export function BuildCredentialNotice() {
  return (
    <div className="control-banner alert">
      <ShieldAlert size={22} />
      <div>
        <h3>Esta build lleva el secreto adentro</h3>
        <p>
          La credencial viene compilada, así que cualquiera que tenga este bundle puede responder
          casos. Sirve para la red local, donde el registro de despliegue se genera de cero y no
          vale nada. No es la forma de publicarlo: presentá la credencial desde el portal y sacá
          <code> VITE_MN_AUTHORITY_SECRET</code> del build.
        </p>
      </div>
    </div>
  )
}
