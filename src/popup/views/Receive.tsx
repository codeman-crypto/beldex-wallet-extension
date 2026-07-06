import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { truncateMiddle } from '../../lib/format'
import { newIntegratedAddress } from '../../lib/bridge'

export function Receive({ address, onBack }: { address: string; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [shown, setShown] = useState(address) // primary or a generated unique address
  const [paymentId, setPaymentId] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const isUnique = shown !== address

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Error correction level H tolerates ~30% obstruction — required for the center logo.
    QRCode.toCanvas(canvas, shown, {
      errorCorrectionLevel: 'H',
      width: 170,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' }
    })
      .then(() => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const logo = new Image()
        logo.onload = () => {
          const size = canvas.width * 0.22
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(canvas.width / 2, canvas.height / 2, size / 2 + 5, 0, Math.PI * 2)
          ctx.fill()
          ctx.drawImage(logo, (canvas.width - size) / 2, (canvas.height - size) / 2, size, size)
        }
        logo.src = 'icons/logo.svg'
      })
      .catch((e: Error) => setError(e.message))
  }, [shown])

  const generateUnique = async () => {
    setError('')
    try {
      const r = await newIntegratedAddress(address)
      setShown(r.address)
      setPaymentId(r.paymentId)
      setCopied(false)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(shown)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="card center receive-card">
      <h2 style={{ marginBottom: 8 }}>Receive BDX</h2>
      <div className="qr-box">
        <canvas ref={canvasRef} />
      </div>
      <p className="muted" style={{ margin: '8px 0 4px' }}>
        {isUnique ? <>Unique address · payment ID <b className="ok">{paymentId}</b></> : 'Your primary address'}
      </p>
      <div className="addr" style={{ marginTop: 0, marginBottom: 8 }}>
        <span title={shown}>{truncateMiddle(shown)}</span>
        <button className="btn-icon" onClick={copy}>{copied ? '✓' : '⧉'}</button>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        {isUnique
          ? <button className="btn-ghost" onClick={() => { setShown(address); setPaymentId(''); setCopied(false) }}>Primary</button>
          : <button className="btn-ghost" onClick={generateUnique}>+ Unique address</button>}
        {isUnique && <button className="btn-ghost" onClick={generateUnique}>↻ New</button>}
      </div>
      {isUnique && (
        <p className="muted" style={{ fontSize: 10, margin: '0 0 8px' }}>
          Funds sent here arrive in this wallet, tagged with the payment ID — hand a
          different one to each payer to tell them apart.
        </p>
      )}
      <button className="btn-ghost" style={{ width: '100%' }} onClick={onBack}>Back</button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
