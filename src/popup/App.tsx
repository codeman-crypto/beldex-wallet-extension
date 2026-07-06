import { useEffect, useState } from 'react'
import { sendToBackground, WalletState } from '../lib/messages'
import { Onboarding } from './views/Onboarding'
import { Unlock } from './views/Unlock'
import { Dashboard } from './views/Dashboard'

export function App() {
  const [state, setState] = useState<WalletState | 'loading'>('loading')
  const [address, setAddress] = useState<string>('')

  const refresh = async () => {
    const r = await sendToBackground({ type: 'GET_STATE' })
    if (r.ok && r.state) {
      setState(r.state)
      if (r.address) setAddress(r.address)
    }
  }

  useEffect(() => { refresh() }, [])

  if (state === 'loading') return <Screen><p className="muted center" style={{ paddingTop: 100 }}>Loading…</p></Screen>
  if (state === 'uninitialized') return <Onboarding onDone={refresh} />
  if (state === 'locked') return <Unlock onUnlocked={refresh} />
  return <Dashboard address={address} onLocked={refresh} />
}

export function Screen({ children }: { children: React.ReactNode }) {
  return <div className="wrap">{children}</div>
}
