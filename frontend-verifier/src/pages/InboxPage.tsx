import { useNavigate } from 'react-router-dom'
import { CheckCircle2, LockOpen, Plus } from 'lucide-react'
import Layout from '../components/Layout'
import StatusChip from '../components/StatusChip'
export default function InboxPage(){const nav=useNavigate(); return <Layout>
  <section className="page-head row-between">
    <div><h1>Solicitudes</h1><p>Verificá condiciones o consultá información que fue compartida con tu organización.</p></div>
    <button className="btn primary" onClick={()=>nav('/verify/new')}><Plus size={18}/>Nueva verificación</button>
  </section>
  <section className="request-list" aria-label="Solicitudes">
    <article className="request-row">
      <div className="request-icon lavender"><CheckCircle2/></div>
      <div className="request-main"><StatusChip>VERIFICACIÓN PRIVADA</StatusChip><h2>Historial de reportes</h2><p>Comprobar si existen al menos 3 reportes sellados previamente.</p></div>
      <span className="meta">Pendiente</span><button className="btn secondary" onClick={()=>nav('/verify/new')}>Verificar</button>
    </article>
    <article className="request-row warm">
      <div className="request-icon cream"><LockOpen/></div>
      <div className="request-main"><StatusChip tone="cream">ACCESO AUTORIZADO</StatusChip><h2>Posible contaminación de un río</h2><p>La persona autorizó acceso parcial a un reporte.</p></div>
      <span className="meta">Disponible</span><button className="btn secondary" onClick={()=>nav('/requests/authorized/RP-0048')}>Ver información</button>
    </article>
  </section>
</Layout>}
