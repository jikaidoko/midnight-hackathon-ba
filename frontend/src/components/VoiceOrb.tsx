import { Check, Mic, ShieldCheck } from 'lucide-react'

export function VoiceOrb({ size='large', state='idle', onClick }: { size?: 'large'|'medium'|'small'; state?: 'idle'|'listening'|'recording'|'processing'|'success'; onClick?: ()=>void }) {
  const icon = state === 'success' ? <Check/> : state === 'processing' ? <ShieldCheck/> : <Mic/>
  return <button onClick={onClick} className={`voice-orb ${size} ${state}`} aria-label="Acción por voz">
    <span className="orb-glow orb-a"/><span className="orb-glow orb-b"/><span className="orb-glow orb-c"/>
    <span className="orb-icon">{icon}</span>
  </button>
}
