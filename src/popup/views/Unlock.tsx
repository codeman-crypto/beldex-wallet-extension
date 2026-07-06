import { useState } from 'react'
import { sendToBackground } from '../../lib/messages'

export function Unlock({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const unlock = async () => {
    setBusy(true)
    const r = await sendToBackground({ type: 'UNLOCK', password })
    setBusy(false)
    if (r.ok) onUnlocked()
    else setError(r.error)
  }

  return (
    <div className="wrap" style={{ paddingTop: 90 }}>
      <div className="center" style={{ marginBottom: 24 }}>
        <div className="brand lg" style={{ justifyContent: 'center' }}>
          <img src="icons/logo.svg" alt="" />
          Beldex
        </div>
        <h2 style={{ marginTop: 18 }}>Welcome back</h2>
        <p className="tagline">Unlock your wallet</p>
      </div>
      <div className="card">
        <input type="password" autoFocus placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && unlock()} />
        <button className="btn-primary" disabled={busy || !password} onClick={unlock}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        {error && <p className="error" style={{ marginBottom: 0 }}>{error}</p>}
      </div>
    </div>
  )
}
