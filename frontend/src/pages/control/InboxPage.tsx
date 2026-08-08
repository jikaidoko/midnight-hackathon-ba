// InboxPage — the backlog, and the case the mockup got backwards.
//
// The original design had the body INITIATING verifications. That inverts the
// contract in the one place it matters: if the body decides what to look at,
// then it can also decide not to, and its inaction becomes invisible. Here
// cases arrive on their own at a threshold the contract owns, and a case with
// no response is rendered as exactly that — evidence, not an empty row.
//
// Nothing on this screen required a credential to compute. That is the claim.

import { useNavigate } from 'react-router-dom'
import { AlertCircle, Clock, Info, Hourglass, CheckCircle2 } from 'lucide-react'
import { ControlShell } from '../../components/ControlShell'
import { useOversightView } from '../../services/useOversight'
import { titleOf } from '../../services'
import { ResponseKind } from '../../services/contracts'
import type { PublicCaseView } from '../../services/contracts'

const KIND_LABEL: Record<ResponseKind, string> = {
  [ResponseKind.investigation]: 'Investigación abierta',
  [ResponseKind.referral]: 'Derivado a otro organismo',
  [ResponseKind.dismissal]: 'Desestimado',
}

function EscalatedCard({
  kase,
  threshold,
  onOpen,
}: {
  kase: PublicCaseView
  threshold: bigint
  onOpen: () => void
}) {
  const late = kase.reportsAfterEscalation

  return (
    <article className="case-card">
      <div className="case-card__body">
        <h2>{titleOf(kase.caseCommitment)}</h2>
        <div className="case-card__meta">
          <span className="chip alert">
            Se necesitaban {threshold.toString()}. Van {kase.reports.toString()}.
          </span>
          <span className="chip bare">
            <Clock size={16} /> {kase.caseCommitment.slice(0, 12)}…
          </span>
        </div>
        {/* The only "how long has this been sitting here" the chain can answer.
            There are no timestamps on the ledger, so corroborations that landed
            after escalation is the honest unit — and rendering nothing at all
            beats rendering an invented number of days. */}
        {late > 0n && (
          <p>
            {late.toString()} {late === 1n ? 'persona denunció' : 'personas denunciaron'} después
            de que este caso ya debía estar en revisión.
          </p>
        )}
      </div>

      <div className="case-card__side">
        {/* `answered` and the label come from the same public view as the
            counts. A second source for this fact is a second source that can
            disagree, and the way it disagrees is showing "sin respuesta" over a
            case the body answered an hour ago. */}
        {kase.answered && kase.kind !== undefined ? (
          <span className="chip calm">
            <CheckCircle2 size={16} /> {KIND_LABEL[kase.kind]}
          </span>
        ) : (
          <span className="chip bare danger">
            <AlertCircle size={16} /> Sin respuesta registrada
          </span>
        )}
        <button className="btn-solid" onClick={onOpen}>
          {kase.answered ? 'Ver caso' : 'Registrar respuesta'}
        </button>
      </div>
    </article>
  )
}

export default function InboxPage() {
  const navigate = useNavigate()
  const view = useOversightView()

  if (!view) {
    return (
      <ControlShell>
        <div className="panel empty-state">
          <p>Cargando el registro público…</p>
        </div>
      </ControlShell>
    )
  }

  return (
    <ControlShell>
      <header className="control-header">
        <h1>Casos bajo revisión</h1>
        <p>Estos casos alcanzaron el umbral de denuncias. Llegaron acá solos.</p>
      </header>

      <div className="control-banner">
        <Info size={22} />
        <p>
          <strong>Umbral: {view.reviewThreshold.toString()} denuncias.</strong> Lo fija el
          contrato y no puede modificarse desde este portal.
        </p>
      </div>

      {view.underReview.length === 0 ? (
        <div className="panel empty-state">
          <h2>No hay casos escalados</h2>
          <p>
            Ninguno de los {view.admittedCount.toString()} casos admitidos alcanzó todavía el
            umbral.
          </p>
        </div>
      ) : (
        <section className="case-list">
          {view.underReview.map((kase) => (
            <EscalatedCard
              key={kase.caseCommitment}
              kase={kase}
              threshold={view.reviewThreshold}
              onOpen={() => navigate(`/control/${kase.caseCommitment}`)}
            />
          ))}
        </section>
      )}

      {view.approaching.length > 0 && (
        <section className="approaching">
          <h2>Acercándose al umbral</h2>
          {view.approaching.map((kase) => (
            <article className="case-card waiting" key={kase.caseCommitment}>
              <div className="case-card__body">
                <h2>{titleOf(kase.caseCommitment)}</h2>
                <div className="case-card__meta">
                  <span className="chip neutral">
                    {kase.reports.toString()} de {view.reviewThreshold.toString()}
                  </span>
                </div>
              </div>
              {/* No action here on purpose. The body's duty starts at the
                  threshold, and offering a button earlier would let it answer
                  a case nobody watched escalate. */}
              <span className="chip bare">
                <Hourglass size={16} /> Esperando confirmaciones
              </span>
            </article>
          ))}
        </section>
      )}
    </ControlShell>
  )
}
