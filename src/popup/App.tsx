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

  const refresh = async () => {
    const r = await sendToBackground({ type: 'GET_STATE' })
    if (r.ok && r.state) {
      setState(r.state)
      setAddress(r.address ?? '')
      setWalletName(r.walletName ?? '')
      setWallets(r.wallets ?? [])
    }
  }

  useEffect(() => { refresh() }, [])

  if (state === 'loading') return <Screen><p className="muted center" style={{ paddingTop: 100 }}>Loading…</p></Screen>
  if (state === 'uninitialized') return <Onboarding onDone={refresh} />
  if (state === 'locked') return <Unlock walletName={walletName} wallets={wallets} onChanged={refresh} />
  // key= forces a clean remount when switching between wallets
  return <Dashboard key={address} address={address} walletName={walletName} wallets={wallets} onLocked={refresh} />
}

export function Screen({ children }: { children: React.ReactNode }) {
  return <div className="wrap">{children}</div>
}
