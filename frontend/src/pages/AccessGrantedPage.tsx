import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/Layout'
import { Card, PrimaryButton, SecondaryButton, StatusChip } from '../components/UI'

export default function AccessGrantedPage() {
  const navigate=useNavigate()
  return <AppShell back><section className="center page-head"><StatusChip status="shared"/><h1>Acceso autorizado</h1><p>Autoridad Ambiental puede consultar la información que seleccionaste.</p></section><Card tone="lavender"><div className="section-title">Compartido</div><p>✓ Contenido de la denuncia</p><p>✓ Evidencia adjunta</p></Card><Card tone="cream"><div className="section-title">Permanece privado</div><p>🔒 Ubicación exacta</p><p>🔒 Datos de identidad</p></Card><p className="center muted">Esta autorización solo aplica a este reporte.</p><div className="stack-actions"><PrimaryButton>Ver permisos</PrimaryButton><SecondaryButton onClick={()=>navigate('/reports')}>Volver a mis reportes</SecondaryButton></div></AppShell>
}
