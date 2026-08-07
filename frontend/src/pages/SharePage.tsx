import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Image, MapPin, UserRound, Lock, Building2 } from 'lucide-react'
import { AppShell } from '../components/Layout'
import { Card, PrimaryButton } from '../components/UI'
import { disclosureService } from '../services/mock'

export default function SharePage() {
  const navigate=useNavigate(); const [s,setS]=useState({content:true,evidence:true,location:false,identity:false}); const [busy,setBusy]=useState(false)
  const items = [
    ['content','Contenido de la denuncia','Detalle de lo sucedido',FileText,'lavender'],
    ['evidence','Evidencia adjunta','Fotos, audios o videos',Image,'cream'],
    ['location','Ubicación exacta','Coordenadas del incidente',MapPin,'ice'],
    ['identity','Datos de identidad','Nombre y contacto',UserRound,'pink'],
  ] as const
  async function authorize(){setBusy(true);await disclosureService.authorize('demo-001',s);navigate('/reports/demo-001/access')}
  return <AppShell back><section className="page-head"><h1>Elegí qué querés compartir.</h1><p>Solo la información seleccionada será accesible.</p></section><div className="permission-list">{items.map(([key,title,sub,Icon,tone])=><label key={key} className={`permission ${tone}`}><span className="round-icon"><Icon size={17}/></span><span><strong>{title}</strong><small>{sub}</small></span><input type="checkbox" checked={s[key]} onChange={e=>setS({...s,[key]:e.target.checked})}/></label>)}</div><div className="privacy-banner"><Lock size={18}/><span>Tu identidad por voz nunca se comparte.</span></div><Card tone="glass"><div className="recipient"><Building2/><div><small>Compartir con</small><strong>Autoridad Ambiental</strong><p>Recibirá únicamente la información seleccionada.</p></div></div></Card><Card tone="white"><div className="section-label">Resumen</div><div className="summary-cols"><div><small>SE COMPARTIRÁ</small>{s.content&&<p>✓ Contenido</p>}{s.evidence&&<p>✓ Evidencia</p>}</div><div><small>SEGUIRÁ PRIVADO</small>{!s.location&&<p>🔒 Ubicación</p>}{!s.identity&&<p>🔒 Identidad</p>}</div></div></Card><PrimaryButton disabled={busy} onClick={authorize}>{busy?'Autorizando…':'Autorizar acceso'}</PrimaryButton></AppShell>
}
