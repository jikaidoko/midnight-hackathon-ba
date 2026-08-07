import { Mic, Play, Pencil, Image, MapPin, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../components/Layout'
import { Card, PrimaryButton, SecondaryButton } from '../components/UI'

export default function ReviewPage() {
  const navigate = useNavigate()
  return <AppShell back>
    <section className="page-head"><h1>Revisá tu denuncia</h1><p>Podés modificar la información antes de dejarla sellada.</p></section>
    <Card tone="glass" className="audio-card"><div className="row"><div className="round-icon"><Mic size={18}/></div><div><strong>Tu relato</strong><small>01:34</small></div></div><div className="wave long"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div><div className="actions-row"><button><Play size={15}/> Escuchar</button><button>Volver a grabar</button></div></Card>
    <section><div className="section-title">Transcripción</div><Card tone="lavender"><p>“Quiero dejar constancia de una situación que ocurrió hoy por la mañana…”</p><button className="edit"><Pencil size={14}/> Editar</button></Card></section>
    <section><div className="section-title">Información adicional</div><div className="mini-grid"><Card tone="pink"><Image size={18}/><strong>Foto</strong><small>2 archivos</small></Card><Card tone="ice"><MapPin size={18}/><strong>Ubicación</strong><small>Agregada</small></Card></div><button className="text-link">+ Agregar información</button></section>
    <div className="privacy-banner"><ShieldCheck size={20}/><span><strong>Tu denuncia todavía es privada.</strong><br/>Podés revisar o modificar esta información antes de sellarla.</span></div>
    <div className="stack-actions"><PrimaryButton onClick={()=>navigate('/sealing')}>Sellar denuncia</PrimaryButton><SecondaryButton>Guardar como borrador</SecondaryButton></div>
  </AppShell>
}
