// ControlShell — the oversight portal's frame.
//
// Deliberately a different shell from `AppShell`, not a variant of it. The
// reporter app is a phone held by one person; this is a desktop workspace where
// an official works a queue. They share every design token and no layout.

import type { ReactNode } from 'react'
import { Building2, ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { authority } from '../services'
import { useAuthorityRequired, useAuthoritySource } from '../services/useAuthority'

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

          <ControlWho />
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

/**
 * Who the portal currently IS, rather than who it is decorated as.
 *
 * This read "Organismo verificador" unconditionally, which is precisely what the
 * credential work exists to stop: the role was implied by which variables a build
 * happened to be compiled with, and the interface asserted it either way — on a
 * build with no secret at all, on a build carrying one, and on a session where
 * someone had actually identified themselves.
 *
 * Three states now, and the middle one is the reason this exists. A build that
 * carries its own credential says so here, because the nav bar is the only place
 * anyone would ever notice.
 */
const WHO = {
  session: { label: 'Credencial presentada', Icon: ShieldCheck, tone: '' },
  build: { label: 'Credencial en la build', Icon: ShieldAlert, tone: 'warn' },
  none: { label: 'Sin identificar', Icon: ShieldQuestion, tone: 'muted' },
} as const

function ControlWho() {
  const required = useAuthorityRequired()
  const source = useAuthoritySource()

  // Mock mode has no credential to be in any state about, so it keeps the plain
  // institutional label rather than reporting on a mechanism it does not run.
  if (!required) {
    return (
      <div className="control-who">
        <span>Organismo verificador</span>
        <div className="control-avatar">
          <Building2 size={18} />
        </div>
      </div>
    )
  }

  const { label, Icon, tone } = WHO[source]

  return (
    <div className={`control-who ${tone}`}>
      <span>{label}</span>
      {source === 'session' && (
        // Held bytes and stored state both — the gateway does the second part,
        // because dropping only the first would leave the witness able to serve
        // this credential to whoever sits down at this browser next.
        <button className="control-link" onClick={() => void authority.withdraw()}>
          Salir
        </button>
      )}
      <div className="control-avatar">
        <Icon size={18} />
      </div>
    </div>
  )
}
