// CredentialPage — the one screen that shows what this project can do and
// nothing else can: proving "I have filed three times" while revealing neither
// which filings nor who.
//
// What is on screen is deliberately sparse. The proof reveals a root and a
// context and nothing else, so a screen that listed the three cases would be
// showing the user something the verifier never receives — and teaching the
// audience the opposite of the guarantee.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldCheck, EyeOff, AlertTriangle } from 'lucide-react'
import { AppShell } from '../components/Layout'
import { Card, PrimaryButton } from '../components/UI'
import { useReporterView } from '../services/useReporterView'
import { credentialService } from '../services'

/** Binds the proof to one verifier, so it cannot be replayed against another. */
const VERIFIER_CONTEXT = 'autoridad-ambiental'

export default function CredentialPage() {
  const navigate = useNavigate()
  const view = useReporterView()
  const [busy, setBusy] = useState(false)
  const [txId, setTxId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!view) return <AppShell back><p className="muted">Cargando…</p></AppShell>

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
      <h1>Probá que denunciaste antes</h1>
      <p>Sin decir cuáles, ni cuántas veces más, ni quién sos.</p>
    </section>

    <Card tone="lavender">
      <div className="card-title"><EyeOff/> Qué ve quien recibe la prueba</div>
      <div className="facts">
        <span><small>Que denunciaste</small><strong>3 veces o más</strong></span>
        <span><small>Cuáles casos</small><strong>Nada</strong></span>
        <span><small>Tu identidad</small><strong>Nada</strong></span>
        <span><small>Reutilizable</small><strong>No</strong></span>
      </div>
    </Card>

    {/* The count comes from the chain. The circuit will not build a passing
        transaction below three, so a button offered here on a local guess would
        just burn a proof to learn what the view already knows. */}
    {!view.canPresentCredential && <div className="privacy-banner">
      <AlertTriangle size={20}/>
      <span>Tenés {view.myFilingCount} denuncia(s) registradas. Hacen falta 3.</span>
    </div>}

    {error && <div className="privacy-banner"><AlertTriangle size={20}/><span>{error}</span></div>}

    {txId
      ? <Card tone="glass">
          <div className="card-title"><ShieldCheck/> Credencial presentada</div>
          <p>La autoridad puede verificarla sin aprender nada más.</p>
          <small>{txId}</small>
          <button className="text-link" onClick={()=>navigate('/reports')}>Volver →</button>
        </Card>
      : <PrimaryButton disabled={busy || !view.canPresentCredential} onClick={present}>
          {busy ? 'Generando prueba…' : 'Presentar credencial'}
        </PrimaryButton>}
  </AppShell>
}
