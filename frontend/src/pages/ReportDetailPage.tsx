import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Lock, ShieldCheck, AlertTriangle } from 'lucide-react'
import { AppShell } from '../components/Layout'
import { Card, PrimaryButton, SecondaryButton, StatusChip } from '../components/UI'
import { useCase } from '../services/useReporterView'
import { chain, reportingService } from '../services/mock'

export default function ReportDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams()
  const view = useCase(id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!view) return <AppShell back><p className="muted">Caso no encontrado.</p></AppShell>

  async function file() {
    if (!view) return
    setBusy(true); setError(null)
    try {
      await reportingService.file(view.caseCommitment)
      navigate('/sealed')
    } catch (e) {
      // The circuit's rejections are the ones worth surfacing verbatim: they
      // name the actual reason, and paraphrasing them into "algo salió mal"
      // is how a demo failure becomes undiagnosable on stage.
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return <AppShell back>
    <section className="center page-head">
      {view.underReview ? <StatusChip status="shared"/> : <StatusChip status="sealed"/>}
      <h1>{chain.titleOf(view.caseCommitment)}</h1>
      <p>{view.caseCommitment.slice(0,16)}…</p>
    </section>

    <Card tone="glass">
      <div className="card-title"><ShieldCheck/> Corroboración pública</div>
      <p>Cuántas personas denunciaron este caso es público. Quiénes son, no.</p>
      <div className="facts">
        <span><small>Denuncias</small><strong>{view.reports.toString()}</strong></span>
        <span><small>Bajo revisión</small><strong>{view.underReview ? 'Sí' : 'No'}</strong></span>
      </div>
    </Card>

    <Card tone="cream">
      <div className="card-title"><Lock/> Tu denuncia</div>
      <p>
        {view.hasFiled
          ? 'Ya denunciaste este caso. Nadie puede saber que fuiste vos.'
          : 'Al denunciar, a la red solo llega un valor que nadie puede vincular con vos.'}
      </p>
    </Card>

    {error && <div className="privacy-banner">
      <AlertTriangle size={20}/><span>{error}</span>
    </div>}

    {/* `canFile` is the view's answer, not this screen's guess. Offering the
        button when the chain would reject it costs a real proof to find out. */}
    {view.canFile
      ? <PrimaryButton disabled={busy} onClick={file}>
          {busy ? 'Generando prueba…' : 'Denunciar este caso'}
        </PrimaryButton>
      : <SecondaryButton onClick={()=>navigate('/reports')}>
          {view.hasFiled ? 'Ya denunciado' : 'No disponible'}
        </SecondaryButton>}
  </AppShell>
}
