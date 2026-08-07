import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/Layout'
import { Card, PrimaryButton, StatusChip } from '../components/UI'

export default function ReportsPage() {
  const navigate=useNavigate()
  return <AppShell verified bottomNav><section className="page-head"><h1>Hola, Sofía.</h1><p>Tus reportes <span className="count-pill">3 sellados</span></p></section><PrimaryButton onClick={()=>navigate('/record')}>+ Nueva denuncia</PrimaryButton><div className="report-list">
    <Card tone="lavender"><div className="row space"><div><strong>Denuncia por situación ocurrida…</strong><small>Hace 3 días</small></div><StatusChip status="sealed"/></div><button className="card-link" onClick={()=>navigate('/reports/demo-001')}>Ver reporte →</button></Card>
    <Card tone="cream"><div className="row space"><div><strong>Reporte 2</strong><small>Hace 1 semana</small></div><StatusChip status="shared"/></div></Card>
    <Card tone="ice"><div className="row space"><div><strong>Reporte 3</strong><small>Ayer</small></div><StatusChip status="draft"/></div></Card>
  </div></AppShell>
}
