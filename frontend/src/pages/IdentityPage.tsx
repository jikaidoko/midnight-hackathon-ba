import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/Layout'
import { VoiceOrb } from '../components/VoiceOrb'
import { DEMO_ONLY_VOICE } from '../services/contracts'
import { identityService } from '../services/mock'

export default function IdentityPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<'idle'|'listening'|'processing'|'success'>('idle')
  const [label, setLabel] = useState('Tocá para identificarte')

  async function unlock() {
    if (state !== 'idle') return
    setState('listening'); setLabel('Escuchando…')
    await new Promise(r=>setTimeout(r,850))
    setState('processing'); setLabel('Abriendo tu credencial…')
    await identityService.unlock()
    setState('success'); setLabel('Listo.')
    setTimeout(()=>navigate('/reports'),700)
  }

  return <AppShell>
    <section className="hero identity-hero">
      <span className="eyebrow">Identidad privada</span>
      <h1>Tu voz abre tu credencial</h1>
      <p>Tu credencial no sale de este dispositivo. A la red solo llega una prueba.</p>
      <VoiceOrb size="large" state={state} onClick={unlock}/>
      <h3>{label}</h3>
      {/* The claim this screen makes is the one the build cannot back. Saying it
          here, not in a README, is what keeps the demo from being a false claim. */}
      <p className="muted">{DEMO_ONLY_VOICE}</p>
    </section>
  </AppShell>
}
