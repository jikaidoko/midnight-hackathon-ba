import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/Layout'
import { VoiceOrb } from '../components/VoiceOrb'
import { CheckCircle2 } from 'lucide-react'

export default function SealingPage() {
  const navigate = useNavigate()
  useEffect(()=>{ const t=setTimeout(()=>navigate('/sealed'),2800); return ()=>clearTimeout(t)},[navigate])
  return <AppShell>
    <section className="hero sealing"><VoiceOrb size="medium" state="processing"/><h1>Protegiendo tu denuncia…</h1><p>Estamos creando un registro verificable sin hacer público tu contenido.</p><div className="glass process-card"><div><CheckCircle2/> Integridad</div><div><CheckCircle2/> Privacidad</div><div><CheckCircle2/> Registro</div></div><small className="muted">La demo avanza automáticamente.</small></section>
  </AppShell>
}
