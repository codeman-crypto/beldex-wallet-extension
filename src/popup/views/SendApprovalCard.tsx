// Dapp transaction approval + signing. Rendered in the panel (preferred) or
// the approval.html popup (fallback) — both are window contexts, so the WASM
// send bridge runs HERE, never in the service worker.
//
// Audit M1/M4 compliance: the FULL untruncated recipient address, the exact
// amount (all 9 decimals), the priority, and the requesting origin are all
// shown before the user can approve. Fee is heuristic pre-approval (the
// MyMonero-lineage bridge computes the real fee only during construction);
// the EXACT fee paid is shown on the success screen and returned to the dapp.

import { useEffect, useState } from 'react'
import { sendToBackground } from '../../lib/messages'
import { sendFunds, SEND_STEPS } from '../../lib/send'
import { ATOMIC, DECIMALS } from '../../lib/money'
import { addPendingLocal } from '../../lib/pendingTxs'

export interface SendReqParams {
  to: string
  amount?: string // atomic units
  priority: 1 | 2 | 3 | 4 | 5
  sweep: boolean
}

/** Exact display: all significant decimals, trailing zeros trimmed. */
function exactBDX(atomic: bigint): string {
  const whole = atomic / ATOMIC
  const frac = (atomic % ATOMIC).toString().padStart(DECIMALS, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

/** Display-units string for the send bridge ("1.25"), exact. */
function displayUnits(atomic: bigint): string {
  const whole = atomic / ATOMIC
  const frac = (atomic % ATOMIC).toString().padStart(DECIMALS, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}

type Phase = 'review' | 'signing' | 'success' | 'failed'

export function SendApprovalCard({ reqId, origin, params, walletName, onDone }: {
  reqId: string
  origin: string
  params: SendReqParams
  walletName: string
  onDone: () => void
}) {
  const [phase, setPhase] = useState<Phase>('review')
  const [stepCode, setStepCode] = useState(0)
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const [fee, setFee] = useState('')

  const amountAtomic = params.amount ? BigInt(params.amount) : null

  // Keepalive: the signing flow + user reading time must outlive the MV3
  // service worker's ~30s idle timeout, or the dapp's reply channel dies.
  useEffect(() => {
    if (phase === 'success' || phase === 'failed') return
    const t = setInterval(() => { sendToBackground({ type: 'TOUCH' }).catch(() => {}) }, 15_000)
    return () => clearInterval(t)
  }, [phase])

  const reject = async () => {
    await sendToBackground({ type: 'DAPP_REJECT', reqId })
    onDone()
  }

  const approve = async () => {
    setPhase('signing'); setError(''); setStepCode(0)
    // Global single-flight send lock (shared with the panel's own send flow).
    const lock = await sendToBackground({ type: 'SEND_LOCK_ACQUIRE' })
    if (!lock.ok) { setError(lock.error); setPhase('review'); return }
    try {
      const s = await sendToBackground({ type: 'GET_SECRETS' })
      if (!s.ok || !s.secrets) throw new Error('Wallet locked — unlock and retry')

      const r = await sendFunds({
        secrets: s.secrets,
        toAddress: params.to,
        // Bridge expects DISPLAY units; convert exactly from atomic.
        amount: params.sweep ? '0' : displayUnits(amountAtomic!),
        priority: params.priority,
        isSweeping: params.sweep,
        onStatus: code => setStepCode(code)
      })

      const paidFee = r.used_fee ?? '0'
      setTxHash(r.tx_hash); setFee(paidFee)
      // Record locally so the tx shows in history IMMEDIATELY (⏳ pending),
      // before the LWS scanner indexes it — same store the panel's send uses.
      await addPendingLocal(s.secrets.address, {
        hash: r.tx_hash,
        sentAtomic: String(r.total_sent ?? params.amount ?? '0'),
        timestamp: new Date().toISOString()
      }).catch(() => {})
      await sendToBackground({
        type: 'DAPP_COMPLETE', reqId, result: { txHash: r.tx_hash, fee: String(paidFee) }
      })
      setPhase('success')
    } catch (e: any) {
      // Full reason stays HERE in the wallet; the dapp gets a sanitized error.
      setError(e?.message ?? 'Transaction failed')
      await sendToBackground({ type: 'DAPP_FAIL', reqId }).catch(() => {})
      setPhase('failed')
    } finally {
      await sendToBackground({ type: 'SEND_LOCK_RELEASE' }).catch(() => {})
    }
  }

  const box: React.CSSProperties = {
    fontSize: 11, wordBreak: 'break-all', background: '#0d0d0d',
    border: '1px solid var(--border)', padding: '8px 10px'
  }

  if (phase === 'signing') {
    return (
      <div className="card center">
        <h2>Sending…</h2>
        <p className="muted">{SEND_STEPS[stepCode] ?? 'Preparing…'}</p>
        <p className="warn">Do not close the wallet.</p>
      </div>
    )
  }

  if (phase === 'success') {
    return (
      <div className="card center">
        <h2>Transaction Sent</h2>
        <h4>Transaction hash</h4>
        <div style={box}>{txHash}</div>
        {fee && fee !== '0' && <p className="muted">Network fee: {exactBDX(BigInt(fee))} BDX</p>}
        <button className="btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={onDone}>Done</button>
      </div>
    )
  }

  if (phase === 'failed') {
    return (
      <div className="card center">
        <h2>Transaction Failed</h2>
        <p className="error">{error}</p>
        <p className="muted">No funds left your wallet unless the error occurred after broadcast.</p>
        <button className="btn-ghost" style={{ width: '100%' }} onClick={onDone}>Close</button>
      </div>
    )
  }

  return (
    <>
      <h2 style={{ textAlign: 'center' }}>Transaction Request</h2>
      <div style={{
        fontSize: 14, fontWeight: 700, color: 'var(--green)', wordBreak: 'break-all',
        textAlign: 'center', border: '1px dashed var(--green)', padding: 12,
        marginBottom: 14, background: '#0d0d0d'
      }}>
        {origin}
      </div>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          This site asks <b>{walletName || 'your wallet'}</b> to send:
        </p>
        <h4>Amount</h4>
        <div style={{ ...box, fontSize: 15, fontWeight: 700 }}>
          {params.sweep ? 'ENTIRE SPENDABLE BALANCE (sweep)' : `${exactBDX(amountAtomic!)} BDX`}
        </div>
        <h4>To address — verify it in full</h4>
        <div style={box}>{params.to}</div>
        <h4>Priority</h4>
        <div style={box}>
          {params.priority}{params.priority === 5 ? ' — FLASH (instant, higher fee)' : ' — standard'}
        </div>
        <h4>Network fee</h4>
        <div style={box}>
          Estimated ≈ 0.02–0.05 BDX{params.priority === 5 ? ' (flash pays more)' : ''} — exact fee
          is computed during signing and shown after broadcast.
        </div>
      </div>
      <p className="warn center">
        ⚠ Beldex transactions are irreversible. Check the address and amount carefully.
      </p>
      <div className="row">
        <button className="btn-ghost" onClick={reject}>Reject</button>
        <button className="btn-primary" onClick={approve}>Approve &amp; Send</button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  )
}
