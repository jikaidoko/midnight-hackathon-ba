import { useNavigate } from 'react-router-dom'
import { ShieldCheck, AlertTriangle } from 'lucide-react'
import { AppShell } from '../components/Layout'
import { Card, PrimaryButton, StatusChip } from '../components/UI'
import { useReporterView } from '../services/useReporterView'
import { chain } from '../services/mock'

export default function ReportsPage() {
  const navigate = useNavigate()
  const view = useReporterView()

  if (!view) return <AppShell verified bottomNav><p className="muted">Cargando…</p></AppShell>

  return <AppShell verified bottomNav>
    <section className="page-head">
      <h1>Tus denuncias</h1>
      <p>
        Denuncias registradas <span className="count-pill">{view.myFilingCount}</span>
      </p>
    </section>

    {/* Both roots come from the view rather than from a local flag. When they
        diverge nothing is fileable, and every button below would produce a
        failing proof — so the screen says it once, here, instead of letting the
        user discover it one rejected proof at a time. */}
    {view.registryDiverged && <div className="privacy-banner">
      <AlertTriangle size={20}/>
      <span><strong>El registro se movió.</strong><br/>
        No se pueden registrar denuncias hasta que se actualice.</span>
    </div>}

    {/* The differentiator, and it is gated on the chain's own count — not on a
        tally this client keeps, which is a tally this client could be wrong
        about. Below three, no passing proof exists at all. */}
    <Card tone={view.canPresentCredential ? 'lavender' : 'white'}>
      <div className="card-title"><ShieldCheck/> Credencial de reincidencia</div>
      <p>
        {view.canPresentCredential
          ? 'Podés probar que denunciaste tres veces sin decir cuáles ni quién sos.'
          : `Con ${3 - view.myFilingCount} denuncia(s) más vas a poder probar reincidencia sin revelar cuáles.`}
      </p>
      <PrimaryButton
        disabled={!view.canPresentCredential}
        onClick={()=>navigate('/credential')}
      >Presentar credencial</PrimaryButton>
    </Card>

    <div className="section-label">Casos admitidos</div>
    <div className="report-list">
      {view.cases.map((c, i) => <Card key={c.caseCommitment} tone={(['lavender','cream','ice','pink'] as const)[i % 4]}>
        <div className="row space">
          <div>
            <strong>{chain.titleOf(c.caseCommitment)}</strong>
            <small>{c.reports.toString()} denuncia(s) · {c.caseCommitment.slice(0,8)}…</small>
          </div>
          {c.underReview ? <StatusChip status="shared"/> : <StatusChip status="sealed"/>}
        </div>
        <button className="card-link" onClick={()=>navigate(`/reports/${c.caseCommitment}`)}>
          {c.hasFiled ? 'Ya denunciaste →' : 'Ver caso →'}
        </button>
      </Card>)}
    </div>
  </AppShell>
}
