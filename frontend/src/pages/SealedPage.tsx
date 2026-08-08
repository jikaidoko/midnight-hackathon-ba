import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/Layout'
import { VoiceOrb } from '../components/VoiceOrb'
import { PrimaryButton, SecondaryButton, StatusChip } from '../components/UI'

export default function SealedPage() {
  const navigate=useNavigate()
  return <AppShell><section className="hero sealed"><VoiceOrb size="medium" state="success"/><StatusChip status="sealed"/><h1>Denuncia sellada</h1><p>Tu reporte quedó registrado de forma verificable.</p><p className="muted">El contenido permanece privado.</p><div className="date-pill glass-lite">7 de agosto · 13:42</div><div className="stack-actions wide"><PrimaryButton onClick={()=>navigate('/reports/demo-001')}>Ver reporte</PrimaryButton><SecondaryButton onClick={()=>navigate('/reports')}>Volver al inicio</SecondaryButton></div></section></AppShell>
}
