// Sign-in is Google-only. /signup, /forgot-password and /reset-password (older links) all lead here.
import { useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import GoogleButton from '../components/GoogleButton'
import { Alert, Loading } from '../components/ui'
import { useAuth } from '../context/auth'

// Where to go after signing in: back to the page that sent us here, or the dashboard
function useReturnTo() {
  const location = useLocation()
  const from = location.state?.from
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/dashboard'
}

// Apps like Instagram, Facebook, LinkedIn and Snapchat open links in their own browser, where Google refuses to sign
// anyone in ("disallowed_useragent"). Android WebViews say "; wv)"; iOS ones are AppleWebKit without "Safari".
export const inAppBrowser = (ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) =>
  /FBAN|FBAV|Instagram|LinkedInApp|Snapchat|Line\/|; wv\)/i.test(ua) || (/(iPhone|iPad|iPod)/.test(ua) && /AppleWebKit/.test(ua) && !/Safari/.test(ua))

export function Login() {
  const { user, ready } = useAuth()
  const navigate = useNavigate()
  const returnTo = useReturnTo()
  const [params] = useSearchParams()
  const [error, setError] = useState(params.get('link') === 'invalid' ? 'That sign-in link has expired or is not valid. Ask for a new one.' : '')

  if (!ready) return <div className="w page"><Loading /></div>
  if (user) return <Navigate to={returnTo} replace />

  return (
    <div className="w page narrow">
      <h1 className="page-title">Sign in</h1>
      <p className="muted mb-md">Use your Google account to register for events, pay and get your tickets. New here? The same button creates your account.</p>
      {inAppBrowser() && <InAppNotice />}
      <GoogleButton onSuccess={() => navigate(returnTo, { replace: true })} onError={setError} />
      <Alert>{error}</Alert>
    </div>
  )
}

function InAppNotice() {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="alert alert--info" role="status">
      <p className="mb-0">
        <b>Open this page in Chrome or Safari to sign in.</b> Google sign-in doesn't work inside apps like Instagram.
        Use the app's menu (⋮ or ···) and choose <i>Open in browser</i>, or copy the link.
      </p>
      <button type="button" className="btn btn--sm btn--ghost mt-sm" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
    </div>
  )
}
