import { useNavigate } from 'react-router-dom'
import { Lock, ShieldCheck } from 'lucide-react'
import { AppShell } from '../components/Layout'
import { Card, PrimaryButton, StatusChip } from '../components/UI'

export default function ReportDetailPage() {
  const navigate=useNavigate()
  return <AppShell back>
    <section className="center page-head"><StatusChip status="sealed"/><h1>Denuncia por situación ocurrida el 7 de agosto</h1><p>7 de agosto · 13:42</p></section>
    <Card tone="glass"><div className="card-title"><ShieldCheck/> Registro verificable</div><p>Podemos comprobar que este reporte no fue modificado desde su sellado.</p><div className="facts"><span><small>Integridad</small><strong>Confirmada</strong></span><span><small>Fecha</small><strong>7 ago · 13:42</strong></span></div><button className="text-link">Ver detalles técnicos</button></Card>
    <Card tone="cream"><div className="card-title"><Lock/> Contenido privado</div><p>Solo vos decidís quién puede acceder a la información de este reporte.</p></Card>
    <PrimaryButton onClick={()=>navigate('/reports/demo-001/share')}>Gestionar acceso</PrimaryButton>
  </AppShell>
}
