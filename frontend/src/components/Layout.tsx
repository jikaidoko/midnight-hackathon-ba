import type { ReactNode } from 'react'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

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

/**
 * The bottom bar is the only way out of `/reports`, which has no back arrow
 * because it is the home of the signed-in area.
 *
 * Two rules it now keeps. First, every enabled entry goes somewhere DIFFERENT:
 * two of them used to point at `/reports`, so half the bar looked like
 * navigation and behaved like a no-op. Second, `/record` is reachable — the
 * recording flow existed end to end (`/record` → `/review` → `/sealing`) with
 * nothing in the interface linking to its first screen, so the only reachable
 * action from home was opening a case.
 *
 * `to: null` is a screen this build does not have. It renders disabled rather
 * than wired to a placeholder: a control that looks live and does nothing is
 * the same lie as a mock that ignores the circuit's rules, and it costs whoever
 * is testing the time to discover it by clicking.
 */
const NAV: { glyph: string; label: string; to: string | null; owns: string[] }[] = [
  { glyph: '⌂', label: 'Inicio', to: '/reports', owns: ['/reports'] },
  { glyph: '✎', label: 'Denunciar', to: '/record', owns: ['/record', '/review', '/sealing', '/sealed'] },
  { glyph: '◈', label: 'Credencial', to: '/credential', owns: ['/credential'] },
  { glyph: '?', label: 'Ayuda', to: null, owns: [] },
]

function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return <nav className="bottom-nav glass">
    {NAV.map(({ glyph, label, to, owns }) => (
      <button
        key={label}
        className={owns.includes(pathname) ? 'active' : ''}
        disabled={to === null}
        onClick={to === null ? undefined : () => navigate(to)}
      >
        <span>{glyph}</span><small>{label}</small>
      </button>
    ))}
  </nav>
}
