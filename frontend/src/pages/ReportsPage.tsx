import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { AppShell } from '../components/Layout'
import { Card, StatusChip } from '../components/UI'
import { useReporterView } from '../services/useReporterView'
import { titleOf } from '../services'

export default function ReportsPage() {
  const navigate = useNavigate()
  const view = useReporterView()

  if (!view) return <AppShell verified bottomNav><p className="muted">Cargando…</p></AppShell>

  return <AppShell verified bottomNav>
    <section className="page-head">
      <h1>Tus aportes</h1>
      <p>Cada denuncia cuenta desde la primera.</p>
    </section>

    {/*
      A plain counter, and no countdown to anything.

      This card used to read "faltan N denuncias para poder probar reincidencia",
      which put a number between the person and the act of reporting. The
      contract does no such thing: `registerFiling` asks only that the case is
      admitted and that this reporter has not already filed on it. Nothing about
      three. The three lives in `proveRepeatFilings`, a separate and entirely
      optional circuit for PRESENTING a credential — so a screen that framed it
      as a bar to clear was describing a rule that does not exist, and
      discouraging exactly the first-time reporter the channel is for.
    */}
    <Card tone="lavender">
      <div className="card-title"><Sparkles size={18}/> Aportes registrados</div>
      <div className="row space" style={{ marginTop: 10 }}>
        <strong style={{ fontFamily: 'Manrope, sans-serif', fontSize: 40, color: 'var(--deep-midnight)' }}>
          {view.myFilingCount}
        </strong>
        <button className="card-link" onClick={()=>navigate('/credential')}>Ver reconocimiento →</button>
      </div>
    </Card>

    <div className="section-label">Casos admitidos</div>
    <div className="report-list">
      {view.cases.map((c, i) => <Card key={c.caseCommitment} tone={(['lavender','cream','ice','pink'] as const)[i % 4]}>
        <div className="row space">
          <div>
            <strong>{titleOf(c.caseCommitment)}</strong>
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
