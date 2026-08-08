// CasePage — one case, and the only history the chain actually carries.
//
// The timeline is derived, not stored. There are no timestamps on the ledger,
// so what it shows is the sequence the corroboration count implies: the filings
// that reached the threshold, the escalation the contract performed by itself,
// and the ones that arrived afterwards. Every number here is public.

import { useNavigate, useParams } from 'react-router-dom'
import { ArrowRight, ArrowLeft, ShieldCheck, GitCommitVertical, CheckCircle2 } from 'lucide-react'
import { ControlShell } from '../../components/ControlShell'
import { useOversightCase, useOversightView, useResponses } from '../../services/useOversight'
import { titleOf } from '../../services'
import type { CaseResponseView } from '../../services/contracts'

const KIND_LABEL: Record<CaseResponseView['kind'], string> = {
  investigation: 'Se abrió investigación',
  referral: 'Se derivó a otro organismo',
  dismissal: 'Se desestimó el caso',
}

export default function CasePage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const view = useOversightView()
  const kase = useOversightCase(id)
  const responses = useResponses()

  if (!view) {
    return (
      <ControlShell narrow>
        <div className="panel empty-state">
          <p>Cargando el registro público…</p>
        </div>
      </ControlShell>
    )
  }

  if (!kase) {
    return (
      <ControlShell narrow>
        <div className="panel empty-state">
          <h2>Caso no encontrado</h2>
          <p>No hay ningún caso admitido con ese identificador.</p>
        </div>
      </ControlShell>
    )
  }

  const threshold = view.reviewThreshold
  const response = responses.get(kase.caseCommitment)
  const after = kase.reportsAfterEscalation

  return (
    <ControlShell narrow>
      <header className="control-header center">
        <span className="eyebrow-label">ID: {kase.caseCommitment.slice(0, 12)}</span>
        <h1>{titleOf(kase.caseCommitment)}</h1>
        <p>Revisión de denuncias acumuladas por el sistema.</p>
      </header>

      <section className="panel wide pad-xl">
        <div className="panel-head">
          <h2>
            <GitCommitVertical size={22} /> Línea de tiempo de escalada
          </h2>
          <span className="chip neutral">Total: {kase.reports.toString()} denuncias</span>
        </div>

        {kase.underReview ? (
          <div className="timeline">
            <div className="timeline__item">
              <p>
                <strong>
                  Las primeras {threshold.toString()} denuncias llegaron de personas distintas.
                </strong>
              </p>
              <small>
                El contrato lo garantiza sin saber quiénes son: cada denuncia gasta un valor que
                sólo esa persona puede producir, y sólo una vez por caso.
              </small>
            </div>

            <div className="timeline__item mark">
              <p>el caso se marcó bajo revisión automáticamente</p>
            </div>

            {after > 0n ? (
              <div className="timeline__item dim">
                <p>
                  Denuncias {(threshold + 1n).toString()} a {kase.reports.toString()} llegaron
                  después.
                </p>
              </div>
            ) : (
              <div className="timeline__item dim">
                <p>No hubo denuncias posteriores a la escalada.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="timeline">
            <div className="timeline__item">
              <p>
                <strong>
                  {kase.reports.toString()} de {threshold.toString()} denuncias.
                </strong>
              </p>
              <small>
                Faltan {kase.reportsToReview.toString()} para que el caso escale. El organismo
                todavía no tiene el deber de responderlo.
              </small>
            </div>
          </div>
        )}
      </section>

      <section className="panel wide notice">
        <ShieldCheck size={30} />
        <div>
          <h3>Aviso de privacidad criptográfica</h3>
          <p>
            No hay identidades acá. El sistema no las tiene. Cada denuncia es una prueba de que
            una persona distinta denunció, sin decir quién.
          </p>
        </div>
      </section>

      {response ? (
        <section className="panel wide">
          <div className="panel-head">
            <h2>
              <CheckCircle2 size={22} /> {KIND_LABEL[response.kind]}
            </h2>
            <span className="chip calm">Respuesta registrada</span>
          </div>
          <p>{response.grounds}</p>
          <p className="mono">{response.txId}</p>
        </section>
      ) : null}

      <div className="form-actions" style={{ width: '100%', justifyContent: 'center', gap: 16 }}>
        <button className="btn-ghost" onClick={() => navigate('/control')}>
          <ArrowLeft size={16} /> Volver a la bandeja
        </button>
        {/* Only escalated, unanswered cases get the action. The contract refuses
            the rest, and offering the button anyway would spend a proof to
            learn what this view already knows. */}
        {kase.underReview && !response && (
          <button
            className="btn-solid pill"
            onClick={() => navigate(`/control/${kase.caseCommitment}/respond`)}
          >
            Registrar respuesta <ArrowRight size={16} />
          </button>
        )}
      </div>
    </ControlShell>
  )
}
