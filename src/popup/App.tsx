import { useEffect, useState } from 'react'
import { sendToBackground, WalletMeta, WalletState } from '../lib/messages'
import { Onboarding } from './views/Onboarding'
import { Unlock } from './views/Unlock'
import { Dashboard } from './views/Dashboard'

export function App() {
  const [state, setState] = useState<WalletState | 'loading'>('loading')
  const [address, setAddress] = useState<string>('')
  const [walletName, setWalletName] = useState<string>('')
  const [wallets, setWallets] = useState<WalletMeta[]>([])
  const [error, setError] = useState<string>('')

  const refresh = async () => {
    try {
      const r = await sendToBackground({ type: 'GET_STATE' })
      if (r.ok && r.state) {
        setError('')
        setState(r.state)
        setAddress(r.address ?? '')
        setWalletName(r.walletName ?? '')
        setWallets(r.wallets ?? [])
      } else if (!r.ok) {
        // don't hang on "Loading…" — surface why the background couldn't respond
        setError(r.error)
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not reach the wallet background')
    }
  }

  useEffect(() => { refresh() }, [])

  if (state === 'loading') {
    return (
      <Screen>
        <p className="muted center" style={{ paddingTop: 100 }}>
          {error ? '' : 'Loading…'}
        </p>
        {error && (
          <div className="center" style={{ paddingTop: 60 }}>
            <p className="error">{error}</p>
            <button className="btn-ghost" onClick={refresh}>Retry</button>
          </div>
        )}
      </Screen>
    )
  }
  if (state === 'uninitialized') return <Onboarding onDone={refresh} />
  if (state === 'locked') return <Unlock walletName={walletName} wallets={wallets} onChanged={refresh} />
  // key= forces a clean remount when switching between wallets
  return <Dashboard key={address} address={address} walletName={walletName} wallets={wallets} onLocked={refresh} />
}

export function Screen({ children }: { children: React.ReactNode }) {
  return <div className="wrap">{children}</div>
}
