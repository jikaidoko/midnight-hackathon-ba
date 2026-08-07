import { useEffect, useState } from 'react'
import { FileAudio, FileText, Image, Lock, ShieldCheck } from 'lucide-react'
import Layout from '../components/Layout'
import StatusChip from '../components/StatusChip'
import { mockAuthorizedAccessService } from '../services/mock'
import type { AuthorizedReport } from '../types/domain'
export default function AuthorizedInfoPage(){const [r,setR]=useState<AuthorizedReport|null>(null); useEffect(()=>{mockAuthorizedAccessService.getAuthorizedReport('RP-0048').then(setR)},[]); if(!r)return <Layout><p>Cargando…</p></Layout>; return <Layout>
 <section className="page-head"><span className="eyebrow">ACCESO AUTORIZADO</span><h1>Información compartida</h1><p>Solo se muestra la información que fue autorizada para este reporte.</p></section>
 <article className="report-head"><div><StatusChip>SELLADO</StatusChip><h2>{r.title}</h2><span className="meta">Reporte #{r.id}</span></div><ShieldCheck size={30}/></article>
 <div className="authorized-layout">
  <aside className="access-summary"><h3>Resumen de acceso</h3><span className="eyebrow">COMPARTIDO CON TU ORGANIZACIÓN</span>{r.shared.map(x=><div className="access-item allowed" key={x}>{x}</div>)}<span className="eyebrow private-label">PERMANECE PRIVADO</span>{r.private.map(x=><div className="access-item locked" key={x}><Lock size={15}/>{x}</div>)}</aside>
  <section className="authorized-content"><article className="story-card"><span className="eyebrow">RELATO COMPARTIDO</span><p>{r.transcript}</p></article><h3>Evidencia compartida</h3><div className="evidence-grid">{r.evidence.map(e=><div className="evidence-card" key={e.label}>{e.type==='image'?<Image/>:e.type==='audio'?<FileAudio/>:<FileText/>}<span>{e.label}</span></div>)}</div><div className="not-shared"><Lock/><div><strong>Información no compartida</strong><p>La identidad y la ubicación exacta no fueron compartidas con este organismo.</p></div></div></section>
 </div>
 </Layout>}
