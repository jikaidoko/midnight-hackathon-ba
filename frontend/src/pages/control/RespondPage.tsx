// RespondPage — the body puts its answer on the same ledger as the reports.
//
// What makes this expensive for an institution is not that it can open an
// investigation. It is that DISMISSING is written too, permanently, with
// reasoning attached and nowhere to take it back. So the screen says that
// before the form, not after the submit.
//
// The byte counter is not decoration. Grounds are a fixed-width field on chain
// and the encoder REFUSES rather than truncates, because cutting UTF-8 at a
// byte offset splits whatever character straddles it and this entry can never
// be rewritten. Spanish with accents runs out well before 256 characters, so a
// character count would let someone write past the limit and only find out at
// submission, with the whole justification typed.

import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, FileSignature, MoveUp, ShieldX, Scale } from 'lucide-react'
import { ControlShell } from '../../components/ControlShell'
import { useOversightCase, useResponses } from '../../services/useOversight'
import { responseService, titleOf } from '../../services'
import {
  GROUNDS_MAX_BYTES,
  groundsByteLength,
  type ResponseKind,
} from '../../services/contracts'

const KINDS: { value: ResponseKind; label: string; Icon: typeof Scale }[] = [
  { value: 'investigation', label: 'Se abre investigación', Icon: Scale },
  { value: 'referral', label: 'Se deriva a otro organismo', Icon: MoveUp },
  { value: 'dismissal', label: 'Se desestima el caso', Icon: ShieldX },
]

export default function RespondPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const kase = useOversightCase(id)
  const responses = useResponses()

  const [kind, setKind] = useState<ResponseKind | null>(null)
  const [grounds, setGrounds] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!kase) {
    return (
      <ControlShell narrow>
        <div className="panel empty-state">
          <p>Cargando el registro público…</p>
        </div>
      </ControlShell>
    )
  }

  const existing = responses.get(kase.caseCommitment)
  const used = groundsByteLength(grounds)
  const over = used > GROUNDS_MAX_BYTES

  // Every reason the contract would refuse, checked before a proof is built.
  const blocked =
    !responseService.available
      ? responseService.unavailableReason
      : existing
        ? 'Este caso ya tiene respuesta registrada. No se puede editar ni reemplazar.'
        : !kase.underReview
          ? 'El caso todavía no alcanzó el umbral. El organismo sólo responde casos escalados.'
          : null

  const canSubmit = !blocked && !busy && kind !== null && used > 0 && !over

  async function submit() {
    if (!kase || kind === null) return
    setBusy(true)
    setError(null)
    try {
      await responseService.respond(kase.caseCommitment, kind, grounds)
      navigate(`/control/${kase.caseCommitment}`)
    } catch (e) {
      // Verbatim. The refusals name the actual reason, and paraphrasing them
      // into "algo salió mal" is how a failure on stage becomes undiagnosable.
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <ControlShell narrow>
      <header className="control-header center">
        <span className="eyebrow-label">Acción requerida</span>
        <h1 className="display">Registrar respuesta</h1>
        <p>{titleOf(kase.caseCommitment)}</p>
      </header>

      <div className="panel wide pad-xl respond-stack">
        <div className="control-banner alert">
          <AlertTriangle size={22} />
          <div>
            <h3>Atención</h3>
            <p>
              Tu respuesta se escribe en la cadena. Es pública y permanente. No se puede editar
              ni borrar.
            </p>
          </div>
        </div>

        {blocked && (
          <div className="control-banner alert">
            <AlertTriangle size={22} />
            <p>{blocked}</p>
          </div>
        )}

        <div className="field">
          <h2 style={{ margin: 0, fontFamily: 'Manrope, sans-serif', fontSize: 24, color: 'var(--deep-midnight)' }}>
            Resolución del caso
          </h2>
          <div className="kind-grid">
            {KINDS.map(({ value, label, Icon }) => (
              <label className="kind-option" key={value}>
                <input
                  type="radio"
                  name="resolution"
                  value={value}
                  checked={kind === value}
                  disabled={blocked !== null}
                  onChange={() => setKind(value)}
                />
                <div className="kind-option__face">
                  <Icon size={30} />
                  <span>{label}</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="grounds">
            <span>Fundamentación (queda pública)</span>
            <span className={`hint ${over ? 'over' : ''}`}>
              {used} / {GROUNDS_MAX_BYTES} bytes
            </span>
          </label>
          <textarea
            id="grounds"
            rows={5}
            value={grounds}
            disabled={blocked !== null}
            placeholder="Detalle y justificación técnica de la resolución."
            onChange={(e) => setGrounds(e.target.value)}
          />
          {over && (
            <small style={{ color: 'var(--error)' }}>
              Se rechaza en vez de recortarse: la entrada es permanente y cortar el texto partiría
              un carácter por la mitad.
            </small>
          )}
        </div>

        {error && (
          <div className="control-banner alert">
            <AlertTriangle size={22} />
            <p>{error}</p>
          </div>
        )}

        <div className="form-actions">
          <button className="btn-ghost" onClick={() => navigate(`/control/${kase.caseCommitment}`)}>
            Cancelar
          </button>
          <button className="btn-solid" disabled={!canSubmit} onClick={submit}>
            <FileSignature size={16} />
            {busy ? 'Generando prueba…' : 'Firmar y registrar'}
          </button>
        </div>
      </div>
    </ControlShell>
  )
}
