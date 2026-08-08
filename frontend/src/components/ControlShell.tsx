// ControlShell — the oversight portal's frame.
//
// Deliberately a different shell from `AppShell`, not a variant of it. The
// reporter app is a phone held by one person; this is a desktop workspace where
// an official works a queue. They share every design token and no layout.

import type { ReactNode } from 'react'
import { Building2 } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * `Credenciales` is a route this build does not have, so it renders disabled
 * rather than pointing somewhere plausible. A nav entry that looks live and
 * does nothing costs whoever is testing the time to find out by clicking, and
 * it is the same class of lie as a form that cannot submit.
 */
const LINKS: { label: string; to: string | null }[] = [
  { label: 'Casos bajo revisión', to: '/control' },
  { label: 'Credenciales', to: null },
]

export function ControlShell({
  children,
  narrow = false,
}: {
  children: ReactNode
  narrow?: boolean
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <div className="control">
      <nav className="control-nav">
        <div className="control-nav__inner">
          <button className="control-brand" onClick={() => navigate('/control')}>
            AMPARO / Control
          </button>

          <div className="control-links">
            {LINKS.map(({ label, to }) => (
              <button
                key={label}
                className={`control-link ${to && pathname.startsWith(to) ? 'active' : ''}`}
                disabled={to === null}
                onClick={to === null ? undefined : () => navigate(to)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="control-who">
            <span>Organismo verificador</span>
            <div className="control-avatar">
              <Building2 size={18} />
            </div>
          </div>
        </div>
      </nav>

      <main className={`control-main ${narrow ? 'narrow' : ''}`}>{children}</main>

      <footer className="control-footer">
        <div className="control-footer__inner">
          <strong>Organismo de Control Institucional — Sistema de verificación Amparo</strong>
          <span>El registro de respuestas es público y permanente.</span>
        </div>
      </footer>
    </div>
  )
}
