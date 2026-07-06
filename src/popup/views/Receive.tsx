import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { truncateMiddle } from '../../lib/format'

export function Receive({ address, onBack }: { address: string; onBack: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Error correction level H tolerates ~30% obstruction — required for the center logo.
    QRCode.toCanvas(canvas, address, {
      errorCorrectionLevel: 'H',
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' }
    })
      .then(() => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const logo = new Image()
        logo.onload = () => {
          const size = canvas.width * 0.22
          const x = (canvas.width - size) / 2
          const y = (canvas.height - size) / 2
          // white backing disc so the logo doesn't blend into QR modules
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(canvas.width / 2, canvas.height / 2, size / 2 + 5, 0, Math.PI * 2)
          ctx.fill()
          ctx.drawImage(logo, x, y, size, size)
        }
        logo.src = 'icons/logo.svg'
      })
      .catch((e: Error) => setError(e.message))
  }, [address])

  const copy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="card center">
      <h2>Receive BDX</h2>
      <div className="qr-box">
        <canvas ref={canvasRef} />
      </div>
      <p className="muted" style={{ margin: '10px 0 4px' }}>Your Beldex address</p>
      <div className="addr" style={{ marginTop: 0, marginBottom: 12 }}>
        <span title={address}>{truncateMiddle(address)}</span>
        <button className="btn-icon" onClick={copy}>{copied ? '✓' : '⧉'}</button>
      </div>
      <button className="btn-ghost" style={{ width: '100%' }} onClick={onBack}>Back</button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
