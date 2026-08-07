import { useState } from 'react'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { mockVerificationService } from '../services/mock'
export default function NewVerificationPage(){
 const nav=useNavigate(); const [n,setN]=useState(3); const [loading,setLoading]=useState(false)
 const submit=async()=>{setLoading(true); const r=await mockVerificationService.verifyCondition({metric:'sealed_reports',operator:'gte',threshold:n}); sessionStorage.setItem('verification-result',JSON.stringify(r)); nav(`/verify/result/${r.requestId}`)}
 return <Layout><div className="narrow">
  <button className="text-btn" onClick={()=>nav('/requests')}><ArrowLeft size={16}/>Volver</button>
  <section className="page-head"><h1>Nueva verificación</h1><p>Definí la condición que necesitás comprobar.</p></section>
  <article className="glass-card verification-form">
    <span className="eyebrow">¿QUÉ QUERÉS VERIFICAR?</span>
    <h2>Historial de reportes</h2>
    <div className="sentence-builder"><span>Confirmar si existen</span><select aria-label="Operador"><option>al menos</option></select><input aria-label="Cantidad" type="number" min="1" value={n} onChange={e=>setN(Number(e.target.value)||1)}/><strong>reportes sellados previamente</strong></div>
    <div className="privacy-banner"><ShieldCheck size={20}/><span>Esta verificación no revelará identidad, contenido ni fechas de los reportes.</span></div>
    <div className="actions"><button className="btn tertiary" onClick={()=>nav('/requests')}>Cancelar</button><button className="btn primary" disabled={loading} onClick={submit}>{loading?'Verificando…':'Solicitar verificación'}</button></div>
  </article>
 </div></Layout>
}
