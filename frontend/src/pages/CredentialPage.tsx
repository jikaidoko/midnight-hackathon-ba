// CredentialPage — recognition first, credential second.
//
// The order is the correction. This screen used to open with "hacen falta 3",
// which reads as a bar the reporter has to clear before they count. They do not:
// `registerFiling` never consults a filing total. The three belongs to
// `proveRepeatFilings`, a separate circuit that PRESENTS a credential to a
// verifier, and calling it is optional in the strict sense — nothing in the
// channel is withheld from someone who never does.
//
// So the counter is the headline and the credential is an extra tool, offered
// where it applies and never framed as the thing that makes a report count.
// What stays sparse is what the proof reveals: a root and a context. A screen
// listing the three cases would show the reporter something the verifier never
// receives, and teach the audience the opposite of the guarantee.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, Lock, ShieldCheck, AlertTriangle } from 'lucide-react'
import { AppShell } from '../components/Layout'
import { Card, PrimaryButton } from '../components/UI'
import { useReporterView } from '../services/useReporterView'
import { credentialService } from '../services'

/** Binds the proof to one verifier, so it cannot be replayed against another. */
const VERIFIER_CONTEXT = 'autoridad-ambiental'

/** What stays private no matter how many times someone reports. */
const NEVER_REVEALED = ['Identidad', 'Fechas', 'Contenido', 'Ubicación', 'Casos relacionados']

export default function CredentialPage() {
  const navigate = useNavigate()
  const view = useReporterView()
  const [busy, setBusy] = useState(false)
  const [txId, setTxId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!view) return <AppShell back><p className="muted">Cargando…</p></AppShell>

  const count = view.myFilingCount

  async function present() {
    setBusy(true); setError(null)
    try {
      setTxId((await credentialService.present(VERIFIER_CONTEXT)).txId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return <AppShell back>
    <section className="center page-head">
      <span className="eyebrow" style={{ alignSelf: 'center' }}>Reconocimiento</span>
      <h1>Contribución reconocida</h1>
      <p>Gracias por sumar transparencia y cuidar lo que es de todos.</p>
    </section>

    <Card tone="lavender" className="center">
      <div style={{ display: 'grid', placeItems: 'center', gap: 6 }}>
        <div className="credential-orb"><BadgeCheck size={38}/></div>
        <p className="contribution-count">{count}</p>
        <strong style={{ color: 'var(--deep-midnight)' }}>
          {count === 1 ? 'aporte a la comunidad' : 'aportes a la comunidad'}
        </strong>
        <small className="muted" style={{ marginTop: 6 }}>
          {count === 0
            ? 'Tu primera denuncia ya cuenta. No hay mínimo que alcanzar.'
            : 'Registrados de forma anónima y verificados criptográficamente.'}
        </small>
      </div>
    </Card>

    <Card tone="glass">
      <div className="card-title">No fue necesario revelar</div>
      <p className="muted" style={{ marginTop: 6 }}>
        Tus aportes son anónimos y verificables al mismo tiempo.
      </p>
      <div className="locked-grid" style={{ marginTop: 12, justifyContent: 'flex-start' }}>
        {NEVER_REVEALED.map((item) => (
          <span className="locked-pill" key={item} style={{ fontSize: 11 }}>
            <Lock size={13}/> {item}
          </span>
        ))}
      </div>
    </Card>

    {/*
      The optional extra, and it only appears once it applies.

      Rendering it greyed out with "faltan N" would put the bar back on screen
      in a different font. Below three there is no passing proof to build, so
      there is nothing to offer and nothing being withheld.
    */}
    {view.canPresentCredential && (txId
      ? <Card tone="glass">
          <div className="card-title"><ShieldCheck size={18}/> Credencial presentada</div>
          <p>La autoridad puede verificarla sin aprender nada más.</p>
          <small>{txId}</small>
          <button className="text-link" onClick={()=>navigate('/reports')}>Volver →</button>
        </Card>
      : <Card tone="cream">
          <div className="card-title">Además, si te sirve</div>
          <p style={{ fontSize: 12, lineHeight: 1.5, marginTop: 6 }}>
            Podés probarle a un tercero que denunciaste tres veces o más, sin decir cuáles ni
            quién sos. Es opcional: no cambia nada de lo que ya registraste.
          </p>
          <div style={{ marginTop: 12 }}>
            <PrimaryButton disabled={busy} onClick={present}>
              {busy ? 'Generando prueba…' : 'Presentar credencial'}
            </PrimaryButton>
          </div>
        </Card>)}

    {error && <div className="privacy-banner"><AlertTriangle size={20}/><span>{error}</span></div>}
  </AppShell>
}
