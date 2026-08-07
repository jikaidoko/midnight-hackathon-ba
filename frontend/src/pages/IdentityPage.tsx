import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/Layout'
import { VoiceOrb } from '../components/VoiceOrb'
import { identityService } from '../services/mock'

export default function IdentityPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<'idle'|'listening'|'processing'|'success'>('idle')
  const [label, setLabel] = useState('Tocá para identificarte')
  async function authenticate() {
    if (state !== 'idle') return
    setState('listening'); setLabel('Escuchando…')
    await new Promise(r=>setTimeout(r,850))
    setState('processing'); setLabel('Verificando tu identidad…')
    const result = await identityService.authenticateVoice()
    if (result.recognized) {
      setState('success'); setLabel('Hola, Sofía.')
      setTimeout(()=>navigate('/record'),700)
    }
  }
  return <AppShell>
    <section className="hero identity-hero">
      <span className="eyebrow">Identidad privada por voz</span>
      <h1>Tu voz es tu identidad</h1>
      <p>Identificate con tu voz para acceder de forma privada a tus reportes.</p>
      <VoiceOrb size="large" state={state} onClick={authenticate}/>
      <h3>{label}</h3>
      <p className="muted">Solo necesitamos unos segundos de tu voz.</p>
    </section>
  </AppShell>
}
