import { useState } from 'react'
import { createWallet, restoreFromMnemonic } from '../../lib/bridge'
import { sendToBackground, WalletSecrets } from '../../lib/messages'

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'menu' | 'create' | 'restore'>('menu')
  const [mnemonic, setMnemonic] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState<WalletSecrets | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (secrets: WalletSecrets) => {
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    const r = await sendToBackground({ type: 'SAVE_WALLET', secrets, password })
    if (r.ok) onDone()
    else setError(r.error)
  }

  if (mode === 'menu') {
    return (
      <div className="wrap" style={{ paddingTop: 70 }}>
        <div className="center" style={{ marginBottom: 28 }}>
          <div className="brand lg" style={{ justifyContent: 'center' }}>
            <img src="icons/logo.svg" alt="" />
            Beldex
          </div>
          <h2 style={{ marginTop: 18, marginBottom: 6 }}>Privacy, in every transaction</h2>
          <p className="tagline">Keep your payments and identity private</p>
        </div>
        <button className="btn-primary" disabled={busy} onClick={async () => {
          setBusy(true)
          try { setPending(await createWallet()); setMode('create') }
          catch (e: any) { setError(e.message) }
          finally { setBusy(false) }
        }}>
          {busy ? 'Generating…' : 'Create new wallet'}
        </button>
        <div style={{ height: 10 }} />
        <button className="btn-ghost" style={{ width: '100%' }} onClick={() => setMode('restore')}>
          Restore from seed
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  if (mode === 'create' && pending) {
    return (
      <div className="wrap">
        <h2>Your recovery seed</h2>
        <div className="seed">{pending.mnemonic}</div>
        <p className="warn">
          ⚠ Write these 25 words down and store them safely. They are the only way to recover your funds.
        </p>
        <input type="password" placeholder="Choose a password (min 8 chars)" value={password}
          onChange={e => setPassword(e.target.value)} />
        <button className="btn-primary" onClick={() => save(pending)}>
          I saved my seed — continue
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="wrap">
      <h2>Restore wallet</h2>
      <textarea rows={4} placeholder="Enter your 25-word seed"
        value={mnemonic} onChange={e => setMnemonic(e.target.value)} />
      <input type="password" placeholder="Choose a password (min 8 chars)" value={password}
        onChange={e => setPassword(e.target.value)} />
      <div className="row">
        <button className="btn-ghost" onClick={() => { setError(''); setMode('menu') }}>Back</button>
        <button className="btn-primary" onClick={async () => {
          try { await save(await restoreFromMnemonic(mnemonic.trim())) }
          catch (e: any) { setError(e.message) }
        }}>Restore</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
