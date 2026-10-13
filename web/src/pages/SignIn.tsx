import { useState } from 'react'
import { Rocket } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Button, Field, Note } from '../components/ui'


export function SignIn() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />

  return (
    <div className="signin">
      <div className="signin-main">
        <form className="signin-box" onSubmit={async e => {
          e.preventDefault(); setBusy(true); setError('')
          try { await login(email, password) } catch (err) { setError(err instanceof Error ? err.message : 'Sign in failed.') } finally { setBusy(false) }
        }}>
          <span className="logo" style={{ fontSize: 16 }}>
            <span className="logo-mark"><Rocket size={15} strokeWidth={2.4} /></span>
            <span className="logo-text">Brand OS<span className="logo-byline">by Digifyce</span></span>
          </span>
          <h1>From brief<br />to launch.</h1>
          <p className="soft">Sign in to see what's waiting on you today.</p>
          {error && <Note tone="error">{error}</Note>}
          <Field label="Work email">{id => <input id={id} className="input" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />}</Field>
          <Field label="Password">{id => <input id={id} className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />}</Field>
          <Button variant="primary" size="lg" type="submit" loading={busy} className="btn-block">Sign in</Button>
          <p className="muted" style={{ fontSize: 13, textAlign: 'center' }}>No account yet? Ask your admin to invite you. Forgot your password? Ask them for a reset link.</p>
        </form>
      </div>
    </div>
  )
}
