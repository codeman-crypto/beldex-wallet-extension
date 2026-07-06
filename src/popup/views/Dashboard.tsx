import { useEffect, useRef, useState } from 'react'
import { sendToBackground, WalletSecrets } from '../../lib/messages'
import { correctedTotalSent } from '../../lib/spent'
import * as lws from '../../lib/lws'
import { sendFunds, SEND_STEPS } from '../../lib/send'
import { Settings } from './Settings'
import { Receive } from './Receive'
import { truncateMiddle } from '../../lib/format'
import { getBdxPriceUsdt } from '../../lib/price'

const ATOMIC = 1e9 // 1 BDX = 1e9 atomic units
const POLL_MS = 10_000 // Beldex block time ~30s; poll LWS every 10s while popup is open

interface Tx {
  hash: string
  total_received?: string
  total_sent?: string
  timestamp?: string
  height?: number
  mempool?: boolean
  coinbase?: boolean
  unlock_time?: number
  mixin?: number
  payment_id?: string
}

type TxFilter = 'all' | 'in' | 'out'

// ---- locally-tracked outgoing txs (bridge the gap until the LWS indexes them) ----

interface PendingLocalTx { hash: string; sentAtomic: string; timestamp: string }
const PENDING_KEY = 'pending_txs'
const PENDING_TTL_MS = 24 * 3600 * 1000 // give up tracking after a day

async function getPendingLocal(): Promise<PendingLocalTx[]> {
  return (await chrome.storage.local.get(PENDING_KEY))[PENDING_KEY] ?? []
}

async function addPendingLocal(tx: PendingLocalTx): Promise<void> {
  const list = await getPendingLocal()
  if (!list.some(p => p.hash === tx.hash)) {
    await chrome.storage.local.set({ [PENDING_KEY]: [tx, ...list] })
  }
}

/** Drop entries the server now knows about (or stale ones); return those still unknown. */
async function reconcilePendingLocal(serverHashes: Set<string>): Promise<PendingLocalTx[]> {
  const list = await getPendingLocal()
  const still = list.filter(p =>
    !serverHashes.has(p.hash) && Date.now() - new Date(p.timestamp).getTime() < PENDING_TTL_MS)
  if (still.length !== list.length) await chrome.storage.local.set({ [PENDING_KEY]: still })
  return still
}

function fmtBDX(atomic: number): string {
  return (atomic / ATOMIC).toFixed(4)
}

function timeAgo(ts?: string): string {
  if (!ts) return ''
  const s = (Date.now() - new Date(ts).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function Dashboard({ address, onLocked }: { address: string; onLocked: () => void }) {
  const [info, setInfo] = useState<any>(null)
  const [txs, setTxs] = useState<Tx[]>([])
  const [creds, setCreds] = useState<lws.Credentials | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [hideBalance, setHideBalance] = useState(() => localStorage.getItem('hideBalance') === '1')
  const [price, setPrice] = useState<number | null>(null)
  const [txFilter, setTxFilter] = useState<TxFilter>('all')
  const [selectedTx, setSelectedTx] = useState<Tx | null>(null)
  const [txHashCopied, setTxHashCopied] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<'home' | 'send' | 'receive' | 'settings'>('home')

  // send form
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [flash, setFlash] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendPhase, setSendPhase] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')
  const [sendStepCode, setSendStepCode] = useState(0)
  const [sendError, setSendError] = useState('')
  const [txResult, setTxResult] = useState('')
  const [hashCopied, setHashCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()
  const secretsRef = useRef<WalletSecrets | null>(null)

  const refresh = async (c: lws.Credentials) => {
    setRefreshing(true)
    getBdxPriceUsdt().then(p => p !== null && setPrice(p)) // 60s-cached; fire-and-forget
    try {
      const [i, t] = await Promise.all([lws.getAddressInfo(c), lws.getAddressTxs(c)])

      // SECURITY/CORRECTNESS: the server's total_sent / spent_outputs are guesses —
      // it flags any output that appears as a ring member (decoy) in other people's
      // transactions. Verify with key images (requires our spend key) so the balance
      // and history only reflect REAL spends. Without this, phantom "sent"
      // transactions appear whenever strangers sample our outputs as decoys.
      const s = secretsRef.current
      if (s) {
        i.total_sent = String(await correctedTotalSent(s, i))
        for (const tx of t.transactions ?? []) {
          tx.total_sent = String(await correctedTotalSent(s, tx))
        }
      }

      setInfo(i)
      const serverList: Tx[] = (t.transactions ?? [])
        // drop pure decoy-usage entries: nothing received, nothing really sent
        .filter((tx: Tx) => Number(tx.total_received ?? 0) > 0 || Number(tx.total_sent ?? 0) > 0)

      // Just-sent txs the LWS hasn't indexed yet: show them as pending right away.
      const localPending = await reconcilePendingLocal(new Set(serverList.map(tx => tx.hash)))
      const list = [
        ...localPending.map(p => ({
          hash: p.hash,
          total_sent: p.sentAtomic,
          total_received: '0',
          timestamp: p.timestamp,
          mempool: true
        } as Tx)),
        ...serverList
      ].sort((a: Tx, b: Tx) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())
      setTxs(list)
      setError('')
    } catch (e: any) {
      setError(`LWS error: ${e.message}`)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    let cancelled = false
    ;(async () => {
      try {
        // Instant display from the background sync cache while we fetch fresh data.
        const cached = (await chrome.storage.session.get('sync_cache'))['sync_cache']
        if (cached?.info && !cancelled) setInfo(cached.info)

        const s = await sendToBackground({ type: 'GET_SECRETS' })
        if (!s.ok || !s.secrets) { onLocked(); return }
        secretsRef.current = s.secrets
        const c = { address: s.secrets.address, view_key: s.secrets.secViewKey }
        if (cancelled) return
        setCreds(c)
        await lws.login(c)
        await refresh(c)
        timer = setInterval(() => refresh(c), POLL_MS)
      } catch (e: any) {
        setError(`LWS error: ${e.message} — check LWS_URL in src/lib/config.ts`)
      }
    })()
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [])

  const copyAddress = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1500)
  }

  const doSend = async () => {
    setError(''); setTxResult(''); setSending(true)
    setSendPhase('sending'); setSendStepCode(0); setSendError(''); setHashCopied(false)
    try {
      const s = await sendToBackground({ type: 'GET_SECRETS' })
      if (!s.ok || !s.secrets) { onLocked(); return }
      const r = await sendFunds({
        secrets: s.secrets,
        toAddress: to.trim(),
        amount: amount.trim(), // display units, e.g. "1.25"
        priority: flash ? 5 : 1, // 5 = flash (instant) per wallet2.h tx_priority_flash
        onStatus: code => setSendStepCode(code)
      })
      // track locally so it shows as pending in history immediately,
      // even before the LWS scanner picks it up
      await addPendingLocal({
        hash: r.tx_hash,
        sentAtomic: r.total_sent ?? String(Math.round(parseFloat(amount) * ATOMIC)),
        timestamp: new Date().toISOString()
      })
      setTxResult(r.tx_hash)
      setSendPhase('success')
      setTo(''); setAmount('')
      if (creds) refresh(creds)
    } catch (e: any) {
      setSendError(e.message)
      setSendPhase('error')
    } finally {
      setSending(false)
    }
  }

  const toggleHide = () => {
    const next = !hideBalance
    setHideBalance(next)
    localStorage.setItem('hideBalance', next ? '1' : '0')
  }
  const mask = (v: string) => (hideBalance ? '••••••' : v)

  // total_sent is already key-image-corrected in refresh(), so this is the real balance
  const balance = info ? Number(info.total_received ?? 0) - Number(info.total_sent ?? 0) : null
  const locked = info ? Number(info.locked_funds ?? 0) : 0
  const unlocked = balance !== null ? Math.max(0, balance - locked) : null
  // The LWS refreshes `blockchain_height` on a slower cadence than its scanner,
  // so scanned_block_height can briefly exceed it. Treat the max as the true tip.
  const scanned = info ? Number(info.scanned_block_height ?? 0) : 0
  const chainHeight = info ? Math.max(scanned, Number(info.blockchain_height ?? 0)) : 0
  const synced = info && scanned >= chainHeight

  return (
    <div className="wrap">
      <div className="header">
        <div className="brand"><img src="icons/logo.svg" alt="" />Beldex</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-icon" title="Settings" onClick={() => setView(view === 'settings' ? 'home' : 'settings')}>
            ⚙
          </button>
          <button className="btn-icon" onClick={async () => { await sendToBackground({ type: 'LOCK' }); onLocked() }}>
            Lock
          </button>
        </div>
      </div>

      {view === 'settings' && <Settings onBack={() => setView('home')} onWiped={onLocked} />}
      {view === 'receive' && <Receive address={address} onBack={() => setView('home')} />}

      {view !== 'settings' && view !== 'receive' && <>
      <div className="card balance-card">
        <div className="sync">
          {info
            ? <>block {scanned.toLocaleString()} / {chainHeight.toLocaleString()}{' '}
                <span className="live">{synced ? '● synced' : '◌ scanning…'}</span></>
            : 'connecting…'}
        </div>
        <div className="balance">
          {balance === null ? '—' : mask(fmtBDX(balance))} <span className="unit">BDX</span>
          <button className="eye-btn" title={hideBalance ? 'Show balance' : 'Hide balance'} onClick={toggleHide}>
            {hideBalance ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
        {price !== null && (
          <div className="fiat">
            {balance !== null && <>≈ <b>{mask((balance / ATOMIC * price).toFixed(2))} USDT</b> · </>}
            1 BDX = {price.toFixed(4)} USDT
          </div>
        )}
        <div className="sub-balances">
          <span>Unlocked <b className="ok">{unlocked === null ? '—' : mask(fmtBDX(unlocked))}</b></span>
          <span>Locked <b className="warn">{balance === null ? '—' : mask(fmtBDX(locked))}</b></span>
        </div>
        <button className="btn-icon" disabled={refreshing} onClick={() => creds && refresh(creds)}>
          {refreshing ? '…' : '↻ refresh'}
        </button>
        <div className="addr">
          <span title={address}>{truncateMiddle(address)}</span>
          <button className="btn-icon" onClick={copyAddress}>{copied ? '✓' : '⧉'}</button>
        </div>
      </div>

      {view === 'home' && (
        <>
          <div className="row">
            <button className="btn-primary" onClick={() => { setTxResult(''); setView('send') }}>↑ Send</button>
            <button className="btn-primary" onClick={() => setView('receive')}>↓ Receive</button>
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <h4>History</h4>
            <div className="chips">
              {(['all', 'in', 'out'] as TxFilter[]).map(f => (
                <button key={f} className={`chip ${txFilter === f ? 'active' : ''}`} onClick={() => setTxFilter(f)}>
                  {f === 'all' ? 'All' : f === 'in' ? '↓ Received' : '↑ Sent'}
                </button>
              ))}
            </div>
          </div>
          <div className="card history-card">
            {(() => {
              const filtered = txs.filter(tx => {
                const incoming = Number(tx.total_received ?? 0) - Number(tx.total_sent ?? 0) >= 0
                return txFilter === 'all' || (txFilter === 'in' ? incoming : !incoming)
              })
              if (filtered.length === 0) {
                return <p className="muted center">{txs.length === 0 ? 'No transactions yet' : 'Nothing here'}</p>
              }
              return filtered.map(tx => {
                const delta = Number(tx.total_received ?? 0) - Number(tx.total_sent ?? 0)
                const incoming = delta >= 0
                return (
                  <div className="tx" key={tx.hash}>
                    <div className={`icon ${incoming ? '' : 'out'}`}>{incoming ? '↓' : '↑'}</div>
                    <div className="meta">
                      <div className="hash" title={tx.hash}>{tx.hash}</div>
                      <div className="when">
                        {tx.mempool ? <span className="pending">⏳ pending</span> : timeAgo(tx.timestamp)}
                      </div>
                    </div>
                    <div className={`amt ${incoming ? 'in' : 'out'}`}>
                      {incoming ? '+' : '−'}{fmtBDX(Math.abs(delta))}
                    </div>
                    <button className="tx-info" title="Transaction details"
                      onClick={() => { setTxHashCopied(false); setSelectedTx(tx) }}>ⓘ</button>
                  </div>
                )
              })
            })()}
          </div>
        </>
      )}

      {view === 'send' && (
        <div className="card">
          <h2>Send BDX</h2>
          <input placeholder="Recipient address" value={to} onChange={e => setTo(e.target.value)} />
          <input placeholder="Amount (BDX)" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
          <label className="checkbox">
            <input type="checkbox" checked={flash} onChange={e => setFlash(e.target.checked)} />
            ⚡ Flash — instant confirmation
          </label>
          <div className="row">
            <button className="btn-ghost" disabled={sending} onClick={() => setView('home')}>Back</button>
            <button className="btn-primary" disabled={sending || !to.trim() || !amount.trim()} onClick={doSend}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
      </>}

      {sendPhase !== 'idle' && (
        <div className="modal-overlay">
          <div className="modal center">
            {sendPhase === 'sending' && (
              <>
                <div className="spinner" />
                <h2 style={{ marginTop: 16 }}>Sending</h2>
                <p className="muted send-step" key={sendStepCode}>
                  {SEND_STEPS[sendStepCode] ?? 'Preparing…'}
                </p>
                <div className="progress"><div className="bar" style={{ width: `${(sendStepCode / 5) * 100}%` }} /></div>
                <p className="muted" style={{ fontSize: 10 }}>step {Math.max(1, sendStepCode)} of 5</p>
              </>
            )}

            {sendPhase === 'success' && (
              <>
                <svg className="tick" viewBox="0 0 52 52" width="72" height="72">
                  <circle className="tick-circle" cx="26" cy="26" r="24" fill="none" />
                  <path className="tick-check" fill="none" d="M14 27 l8 8 l16 -16" />
                </svg>
                <h2 style={{ marginTop: 10 }}>Sent!</h2>
                <p className="muted" style={{ marginBottom: 4 }}>Transaction hash</p>
                <div className="addr" style={{ marginTop: 0, marginBottom: 14 }}>
                  <span title={txResult}>{truncateMiddle(txResult)}</span>
                  <button className="btn-icon" onClick={async () => {
                    await navigator.clipboard.writeText(txResult)
                    setHashCopied(true)
                    setTimeout(() => setHashCopied(false), 1500)
                  }}>{hashCopied ? '✓' : '⧉'}</button>
                </div>
                <button className="btn-primary" onClick={() => { setSendPhase('idle'); setView('home') }}>Done</button>
              </>
            )}

            {sendPhase === 'error' && (
              <>
                <div className="fail-mark">✕</div>
                <h2 style={{ marginTop: 10 }}>Send failed</h2>
                <p className="error" style={{ marginBottom: 14 }}>{sendError}</p>
                <button className="btn-ghost" style={{ width: '100%' }} onClick={() => setSendPhase('idle')}>Close</button>
              </>
            )}
          </div>
        </div>
      )}

      {selectedTx && (() => {
        const delta = Number(selectedTx.total_received ?? 0) - Number(selectedTx.total_sent ?? 0)
        const incoming = delta >= 0
        const confirmations = selectedTx.mempool || !selectedTx.height
          ? 0
          : Math.max(0, chainHeight - Number(selectedTx.height) + 1)
        const rows: Array<[string, React.ReactNode]> = [
          ['Type', <span className={incoming ? 'ok' : 'error'}>{incoming ? '↓ Received' : '↑ Sent'}</span>],
          ['Amount', `${incoming ? '+' : '−'}${fmtBDX(Math.abs(delta))} BDX`],
          ['Status', selectedTx.mempool
            ? <span className="pending">⏳ Pending (mempool)</span>
            : <span className="ok">✓ Confirmed</span>],
          ['Confirmations', selectedTx.mempool ? '—' : confirmations.toLocaleString()],
          ['Block height', selectedTx.height ? Number(selectedTx.height).toLocaleString() : '—'],
          ['Date', selectedTx.timestamp ? new Date(selectedTx.timestamp).toLocaleString() : '—'],
          ['Ring size', selectedTx.mixin != null ? String(Number(selectedTx.mixin) + 1) : '—']
        ]
        if (selectedTx.payment_id && !/^0+$/.test(selectedTx.payment_id)) {
          rows.push(['Payment ID', truncateMiddle(selectedTx.payment_id)])
        }
        return (
          <div className="modal-overlay" onClick={() => setSelectedTx(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <h2>Transaction</h2>
              <div className="addr" style={{ marginTop: 0, marginBottom: 12 }}>
                <span title={selectedTx.hash}>{truncateMiddle(selectedTx.hash)}</span>
                <button className="btn-icon" onClick={async () => {
                  await navigator.clipboard.writeText(selectedTx.hash)
                  setTxHashCopied(true)
                  setTimeout(() => setTxHashCopied(false), 1500)
                }}>{txHashCopied ? '✓' : '⧉'}</button>
              </div>
              {rows.map(([label, val]) => (
                <div className="detail-row" key={label}>
                  <span className="muted">{label}</span>
                  <span>{val}</span>
                </div>
              ))}
              <div className="row" style={{ marginTop: 14 }}>
                <button className="btn-ghost" onClick={() => setSelectedTx(null)}>Close</button>
                <a className="btn-primary center" style={{ textDecoration: 'none', padding: '12px 18px' }}
                  href={`https://explorer.beldex.io/tx/${selectedTx.hash}`} target="_blank" rel="noreferrer">
                  Explorer ↗
                </a>
              </div>
            </div>
          </div>
        )
      })()}

      {error && <p className="error">{error}</p>}
    </div>
  )
}
