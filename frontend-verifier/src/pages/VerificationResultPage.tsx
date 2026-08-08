import { useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, Lock } from 'lucide-react'
import Layout from '../components/Layout'
import type { VerificationResult } from '../types/domain'
export default function VerificationResultPage(){
 const [open,setOpen]=useState(false)
 const result=useMemo<VerificationResult>(()=>{const s=sessionStorage.getItem('verification-result'); return s?JSON.parse(s):{requestId:'VR-0182',status:'verified',condition:{metric:'sealed_reports',operator:'gte',threshold:3},value:true,privateFields:['Identidad','Fechas','Contenido','Ubicación'],proof:{status:'Valid',network:'Midnight',circuit:'report-history-threshold',proofId:'0x8e21...4fa9'}}},[])
 return <Layout>
  <section className="page-head"><span className="eyebrow">RESULTADO</span><h1>Verificación completada</h1><p>La condición solicitada pudo comprobarse correctamente.</p></section>
  <article className="result-card">
    <div className="verification-orb"><CheckCircle2 size={34}/></div><span className="eyebrow">CONDICIÓN VERIFICADA</span>
    <h2>Al menos {result.condition.threshold} reportes sellados previamente</h2><p>La persona cumple la condición solicitada.</p><div className="truth">VERDADERO</div>
  </article>
  <section className="privacy-summary"><div><h2>No fue necesario revelar</h2><p>AMPARO confirmó la condición sin compartir el historial completo.</p></div><div className="private-grid">{result.privateFields.map(x=><div className="private-item" key={x}><Lock size={18}/><span>{x}</span></div>)}</div></section>
  <section className="technical"><button className="technical-toggle" onClick={()=>setOpen(!open)}>Ver detalles técnicos <ChevronDown size={18} className={open?'rotate':''}/></button>{open&&result.proof&&<div className="technical-grid"><span>Status<strong>Proof {result.proof.status}</strong></span><span>Network<strong>{result.proof.network}</strong></span><span>Request<strong>{result.requestId}</strong></span><span>Circuit<strong>{result.proof.circuit}</strong></span><span>Proof ID<strong>{result.proof.proofId}</strong></span></div>}</section>
 </Layout>
}
