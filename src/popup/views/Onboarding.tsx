import { useState } from 'react'
import { createWallet, restoreFromMnemonic } from '../../lib/bridge'
import { sendToBackground, WalletSecrets } from '../../lib/messages'

/** Cheap length + character-class heuristic — deliberately no zxcvbn-style dependency. */
function passwordStrength(pw: string): { label: string; color: string; pct: number } | null {
  if (!pw) return null
  let classes = 0
  if (/[a-z]/.test(pw)) classes++
  if (/[A-Z]/.test(pw)) classes++
  if (/[0-9]/.test(pw)) classes++
  if (/[^a-zA-Z0-9]/.test(pw)) classes++
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (pw.length >= 16) score++
  score += classes >= 3 ? 2 : classes >= 2 ? 1 : 0
  if (score <= 1) return { label: 'weak', color: 'var(--red)', pct: 33 }
  if (score <= 3) return { label: 'fair', color: '#f5a623', pct: 66 }
  return { label: 'strong', color: 'var(--green)', pct: 100 }
}

function StrengthHint({ password }: { password: string }) {
  const s = passwordStrength(password)
  if (!s) return null
  return (
    <div style={{ marginTop: -6, marginBottom: 10 }}>
      <div style={{ height: 3, background: '#1c1c1c' }}>
        <div style={{ height: '100%', width: `${s.pct}%`, background: s.color, transition: 'width 0.2s, background 0.2s' }} />
      </div>
      <span style={{ fontSize: 10, color: s.color }}>{s.label}</span>
    </div>
  )
}

export function Onboarding({ onDone, addMode = false, onCancel }:
  { onDone: () => void; addMode?: boolean; onCancel?: () => void }) {
  const [mode, setMode] = useState<'menu' | 'create' | 'confirm' | 'restore'>('menu')
  // seed confirmation quiz: 5 random word positions the user must re-enter
  const [quizIdx, setQuizIdx] = useState<number[]>([])
  const [quizAnswers, setQuizAnswers] = useState<string[]>([])
  const [mnemonic, setMnemonic] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pending, setPending] = useState<WalletSecrets | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (secrets: WalletSecrets) => {
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    const r = await sendToBackground({ type: 'SAVE_WALLET', secrets, password, name: name.trim() || undefined })
    if (r.ok) onDone()
    else setError(r.error)
  }

  /** Move from seed display to the confirmation quiz: 5 random distinct word positions. */
  const startQuiz = () => {
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirmPassword) { setError('Passwords do not match'); return }
    setError('')
    const positions = new Set<number>()
    while (positions.size < 5) positions.add(Math.floor(Math.random() * 25))
    setQuizIdx([...positions].sort((a, b) => a - b))
    setQuizAnswers(['', '', '', '', ''])
    setMode('confirm')
  }

  if (mode === 'menu') {
    return (
      <div className="wrap" style={{ paddingTop: addMode ? 30 : 70 }}>
        <div className="center" style={{ marginBottom: 28 }}>
          <div className="brand lg" style={{ justifyContent: 'center' }}>
            <img src="icons/logo.svg" alt="" />
            Beldex
          </div>
          {addMode ? (
            <h2 style={{ marginTop: 18, marginBottom: 6 }}>Add a wallet</h2>
          ) : (
            <>
              <h2 style={{ marginTop: 18, marginBottom: 6 }}>Privacy, in every transaction</h2>
              <p className="tagline">Keep your payments and identity private</p>
            </>
          )}
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
        {addMode && onCancel && (
          <>
            <div style={{ height: 10 }} />
            <button className="btn-ghost" style={{ width: '100%' }} onClick={onCancel}>Cancel</button>
          </>
        )}
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
        <input placeholder="Wallet name (e.g. Savings)" value={name}
          onChange={e => setName(e.target.value)} />
        <input type="password" placeholder="Choose a password (min 8 chars)" value={password}
          onChange={e => setPassword(e.target.value)} />
        <StrengthHint password={password} />
        <input type="password" placeholder="Confirm password" value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)} />
        <button className="btn-primary" onClick={startQuiz}>
          I saved my seed — continue
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  if (mode === 'confirm' && pending) {
    const words = pending.mnemonic.trim().split(/\s+/)
    const check = () => {
      const wrong = quizIdx.filter((wordPos, i) =>
        quizAnswers[i].trim().toLowerCase() !== words[wordPos].toLowerCase())
      if (wrong.length > 0) {
        setError(`Word${wrong.length > 1 ? 's' : ''} #${wrong.map(w => w + 1).join(', #')} ${wrong.length > 1 ? 'are' : 'is'} incorrect — check your backup`)
        return
      }
      setError('')
      save(pending)
    }
    return (
      <div className="wrap">
        <h2>Confirm your seed</h2>
        <p className="muted">
          Enter the requested words from your recovery seed to confirm you saved it.
        </p>
        {quizIdx.map((wordPos, i) => (
          <input key={wordPos} placeholder={`Word #${wordPos + 1}`} autoCapitalize="off"
            value={quizAnswers[i]}
            onChange={e => {
              const next = [...quizAnswers]
              next[i] = e.target.value
              setQuizAnswers(next)
            }} />
        ))}
        <div className="row">
          <button className="btn-ghost" onClick={() => { setError(''); setMode('create') }}>
            Back to seed
          </button>
          <button className="btn-primary" disabled={quizAnswers.some(a => !a.trim())} onClick={check}>
            Confirm
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  return (
    <div className="wrap">
      <h2>Restore wallet</h2>
      <textarea rows={4} placeholder="Enter your 25-word seed"
        value={mnemonic} onChange={e => setMnemonic(e.target.value)} />
      <input placeholder="Wallet name (e.g. Savings)" value={name}
        onChange={e => setName(e.target.value)} />
      <input type="password" placeholder="Choose a password (min 8 chars)" value={password}
        onChange={e => setPassword(e.target.value)} />
      <StrengthHint password={password} />
      <input type="password" placeholder="Confirm password" value={confirmPassword}
        onChange={e => setConfirmPassword(e.target.value)} />
      <div className="row">
        <button className="btn-ghost" onClick={() => { setError(''); setMode('menu') }}>Back</button>
        <button className="btn-primary" onClick={async () => {
          if (password !== confirmPassword) { setError('Passwords do not match'); return }
          try { await save(await restoreFromMnemonic(mnemonic.trim())) }
          catch (e: any) { setError(e.message) }
        }}>Restore</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
