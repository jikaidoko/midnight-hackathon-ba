import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, FileText, MapPin, StickyNote, ShieldCheck } from 'lucide-react'
import { AppShell } from '../components/Layout'
import { VoiceOrb } from '../components/VoiceOrb'

export default function RecordPage() {
  const navigate = useNavigate()
  const [recording, setRecording] = useState(false)
  const [finished, setFinished] = useState(false)
  return <AppShell back verified>
    <section className="center intro"><h1>Hola, Sofía.</h1><p>Contanos qué pasó.</p></section>
    <section className="record-center">
      <VoiceOrb size="medium" state={recording ? 'recording' : 'idle'} onClick={()=>setRecording(!recording)}/>
      <h3>{recording ? 'Te estamos escuchando' : 'Contanos qué pasó'}</h3>
      <p className="muted">{recording ? 'Contá lo sucedido con el nivel de detalle que necesites.' : 'Mantené presionado para grabar. Podés hablar con tus propias palabras.'}</p>
      {recording && <><div className="timer">00:12</div><div className="wave"><i/><i/><i/><i/><i/><i/><i/></div><button className="mini-dark" onClick={()=>{setRecording(false);setFinished(true)}}>Finalizar</button></>}
      {finished && <button className="text-link" onClick={()=>navigate('/review')}>Revisar relato →</button>}
    </section>
    <div className="trust glass-lite"><ShieldCheck size={18}/><span>Después vas a poder revisar el contenido antes de sellarlo.</span></div>
    <section><div className="section-label">Adjuntar evidencia (opcional)</div><div className="attach-grid">
      <button className="attach pink"><Camera/><small>Foto</small></button>
      <button className="attach ice"><FileText/><small>Documento</small></button>
      <button className="attach lavender"><MapPin/><small>Ubicación</small></button>
      <button className="attach cream"><StickyNote/><small>Nota</small></button>
    </div></section>
    <div className="privacy-banner"><ShieldCheck size={20}/><span>Tu relato permanece privado hasta que decidas continuar. Ningún dato se comparte sin tu confirmación explícita.</span></div>
  </AppShell>
}
