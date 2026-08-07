import type { ReactNode } from 'react'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

export function AppShell({ children, back = false, verified = false, bottomNav = false }: { children: ReactNode; back?: boolean; verified?: boolean; bottomNav?: boolean }) {
  const navigate = useNavigate()
  return <div className="app-bg">
    <div className="phone-shell">
      <header className="topbar glass-lite">
        <button className={`icon-btn ${back ? '' : 'invisible'}`} onClick={() => navigate(-1)} aria-label="Volver"><ArrowLeft size={18}/></button>
        <div className="brand">AMPARO</div>
        {verified ? <div className="verified-pill"><ShieldCheck size={13}/> Verificada</div> : <div className="topbar-spacer"/>}
      </header>
      <main className={`page ${bottomNav ? 'with-nav' : ''}`}>{children}</main>
      {bottomNav && <BottomNav/>}
    </div>
  </div>
}

function BottomNav() {
  const navigate = useNavigate()
  return <nav className="bottom-nav glass">
    <button onClick={() => navigate('/reports')}><span>⌂</span><small>Inicio</small></button>
    <button className="active" onClick={() => navigate('/reports')}><span>▤</span><small>Reportes</small></button>
    <button><span>?</span><small>Ayuda</small></button>
    <button><span>○</span><small>Perfil</small></button>
  </nav>
}
