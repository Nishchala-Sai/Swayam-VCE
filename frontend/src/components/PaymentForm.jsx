// Manual UPI payment step, shared by event registrations and sub-event bookings: shows the event's UPI QR, UPI ID and
// payee name (or the written instructions), then sends the 12-digit UTR, the amount paid and an optional screenshot link as proof.
import { useState } from 'react'
import { api, assetUrl } from '../api/client'
import { inr } from '../lib/events'
import { Alert } from './ui'

const isHttpsUrl = (s) => {
  try {
    return new URL(s).protocol === 'https:'
  } catch {
    return false
  }
}

// kind: 'registration' → POST /api/payments/:id/proof; 'booking' → POST /api/payments/sub-event-bookings/:id/proof
export default function PaymentForm({ kind, id, amount: defaultAmount, upiQrUrl, upiId, upiPayeeName, instructions, onSubmitted, onLater }) {
  const [utr, setUtr] = useState('')
  const [amount, setAmount] = useState(defaultAmount ? String(defaultAmount) : '')
  const [screenshot, setScreenshot] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  async function copyUpiId() {
    try {
      await navigator.clipboard.writeText(upiId)
      setCopied(true)
    } catch {
      // clipboard blocked (e.g. not https): the ID is on screen to copy by hand
    }
  }

  async function submit(e) {
    e.preventDefault()
    const cleanUtr = utr.replace(/\s/g, '')
    if (!/^\d{12}$/.test(cleanUtr)) return setError('Enter the 12-digit UTR (transaction reference) from your UPI app.')
    const total = Number(amount)
    if (!Number.isInteger(total) || total < 1) return setError('Enter the total amount you paid, in whole rupees.')
    const shot = screenshot.trim()
    if (shot && !isHttpsUrl(shot)) return setError('The screenshot link must start with https://')
    setBusy(true)
    setError('')
    const path = kind === 'booking' ? `/payments/sub-event-bookings/${id}/proof` : `/payments/${id}/proof`
    try {
      await api(path, { method: 'POST', body: { utrNumber: cleanUtr, totalAmountPaid: total, ...(shot && { paymentScreenshotUrl: shot }) } })
      onSubmitted()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <h2>Pay {defaultAmount ? inr(defaultAmount) : ''} by UPI</h2>
      {upiQrUrl ? (
        <div className="upi-qr"><img src={assetUrl(upiQrUrl)} alt="Swayam UPI payment QR code" /></div>
      ) : (
        !instructions && !upiId && <Alert tone="info">The payment QR code isn't available here. Contact the organisers for UPI details.</Alert>
      )}
      {upiId && (
        <p className="upi-id">
          <span className="small muted">Pay to{upiPayeeName ? ` ${upiPayeeName}` : ''}</span>
          <span className="mono">{upiId}</span>
          <button type="button" className="link-btn small accent" onClick={copyUpiId}>{copied ? 'Copied' : 'Copy'}</button>
        </p>
      )}
      {instructions && <p className="small">{instructions}</p>}
      <p className="small muted">Pay with any UPI app, then enter the details from your UPI app below.</p>

      <div className="field">
        <label htmlFor="utr">UTR / transaction reference (12 digits)</label>
        <input id="utr" inputMode="numeric" autoComplete="off" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 412345678901" />
      </div>
      <div className="field">
        <label htmlFor="amt">Total amount paid (₹)</label>
        <input id="amt" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="shot">Payment screenshot link <span className="muted">(optional)</span></label>
        <input id="shot" type="url" inputMode="url" placeholder="https://…" value={screenshot} onChange={(e) => setScreenshot(e.target.value)} />
        <p className="hint">Upload the screenshot to Google Drive or similar and paste a link anyone can open.</p>
      </div>

      <Alert>{error}</Alert>
      <div className="actions">
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit payment details'}</button>
        {onLater && <button className="btn btn--ghost" type="button" onClick={onLater}>Pay later</button>}
      </div>
      {onLater && <p className="small muted mt-sm">Your place is saved. You can submit these details later from your dashboard.</p>}
    </form>
  )
}
