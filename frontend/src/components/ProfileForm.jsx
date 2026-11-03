// Name, phone, roll number, branch and year. Used on /welcome after the first sign-in and on the profile page.
import { useState } from 'react'
import { useAuth } from '../context/auth'
import { BRANCHES, YEARS, formatPhone, readProfileForm, yearLabel } from '../lib/profile'
import { Alert } from './ui'

export default function ProfileForm({ submitLabel = 'Save', onSaved }) {
  const { user, updateProfile } = useAuth()
  const [f, setF] = useState({
    name: user.name ?? '',
    phone: user.phone ? formatPhone(user.phone) : '',
    rollNumber: user.rollNumber ?? '',
    branch: user.branch ?? '',
    year: user.year ? String(user.year) : '',
  })
  const [errors, setErrors] = useState({})
  const [state, setState] = useState({ busy: false, error: '', saved: false })
  const set = (key) => (e) => {
    setF((x) => ({ ...x, [key]: e.target.value }))
    setErrors((x) => ({ ...x, [key]: undefined }))
    setState((s) => ({ ...s, saved: false }))
  }

  async function submit(e) {
    e.preventDefault()
    const { body, errors: found } = readProfileForm(f)
    if (found) return setErrors(found)
    setState({ busy: true, error: '', saved: false })
    try {
      const me = await updateProfile(body)
      setState({ busy: false, error: '', saved: true })
      onSaved?.(me)
    } catch (err) {
      setState({ busy: false, error: err.message, saved: false })
    }
  }

  const field = (key, label, input, hint) => (
    <div className="field">
      <label htmlFor={`pf-${key}`}>{label}</label>
      {input}
      {errors[key] ? <p className="hint hint--error" id={`pf-${key}-err`}>{errors[key]}</p> : hint && <p className="hint">{hint}</p>}
    </div>
  )
  const aria = (key) => ({ id: `pf-${key}`, 'aria-invalid': Boolean(errors[key]), 'aria-describedby': errors[key] ? `pf-${key}-err` : undefined })

  return (
    <form onSubmit={submit} noValidate>
      {field('name', 'Full name', <input {...aria('name')} autoComplete="name" value={f.name} onChange={set('name')} />)}
      {field('phone', 'WhatsApp number', <input {...aria('phone')} type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={f.phone} onChange={set('phone')} />, 'The organisers use it for event updates on WhatsApp.')}
      {field('rollNumber', 'Roll number', <input {...aria('rollNumber')} autoCapitalize="characters" placeholder="1602-23-733-042" value={f.rollNumber} onChange={set('rollNumber')} />)}
      <div className="field-row">
        {field('branch', 'Branch', (
          <>
            <input {...aria('branch')} list="pf-branches" placeholder="CSE" value={f.branch} onChange={set('branch')} />
            <datalist id="pf-branches">{BRANCHES.map((b) => <option key={b} value={b} />)}</datalist>
          </>
        ))}
        {field('year', 'Year', (
          <select {...aria('year')} value={f.year} onChange={set('year')}>
            <option value="">Choose…</option>
            {YEARS.map((y) => <option key={y} value={y}>{yearLabel(y)}</option>)}
          </select>
        ))}
      </div>
      <Alert>{state.error}</Alert>
      {state.saved && <Alert tone="ok">Saved.</Alert>}
      <button className="btn" type="submit" disabled={state.busy}>{state.busy ? 'Saving…' : submitLabel}</button>
    </form>
  )
}
