import { useEffect, useState } from 'react'
import { Rocket } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { User } from '../lib/types'
import { Button, Field, Loading, Note } from '../components/ui'

type Invite = { name: string; email: string; purpose: 'join' | 'reset'; role: string; team: string | null; expires_at: string }

/** The page behind an invite or password-reset link: choose a password, then you're signed in. */
export function Join() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { startSession } = useAuth()
  const [invite, setInvite] = useState<Invite | null>(null)
  const [problem, setProblem] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Invite>(`/public/invites/${token}`, { auth: false }).then(setInvite).catch(e => setProblem(e instanceof Error ? e.message : 'This link does not work.'))
  }, [token])

  const first = invite?.name.split(' ')[0] ?? ''
  const reset = invite?.purpose === 'reset'

  return (
    <div className="signin">
      <div className="signin-main">
        <div className="signin-box">
          <span className="logo" style={{ fontSize: 16 }}>
            <span className="logo-mark"><Rocket size={15} strokeWidth={2.4} /></span>
            <span className="logo-text">Brand OS<span className="logo-byline">by Digifyce</span></span>
          </span>
          {problem ? (
            <>
              <h1 style={{ fontSize: 30 }}>This link doesn't work</h1>
              <Note tone="error">{problem}</Note>
              <Link to="/sign-in" className="btn btn-secondary btn-block">Go to sign in</Link>
            </>
          ) : !invite ? <Loading /> : (
            <form className="stack" style={{ gap: 16 }} onSubmit={async e => {
              e.preventDefault(); setError('')
              if (password.length < 8) { setError('Use at least 8 characters.'); return }
              if (password !== confirm) { setError('The two passwords are different.'); return }
              setBusy(true)
              try {
                const r = await api<{ token: string; user: User }>(`/public/invites/${token}`, { body: { password }, auth: false })
                startSession(r.token, r.user)
                navigate('/', { replace: true })
              } catch (err) {
                setError(err instanceof ApiError && err.details ? Object.values(err.details)[0] : err instanceof Error ? err.message : 'Something went wrong.')
                setBusy(false)
              }
            }}>
              <h1 style={{ fontSize: 30 }}>{reset ? `New password, ${first}` : `Welcome, ${first}`}</h1>
              <p className="soft">{reset ? 'Choose a new password for Brand OS.' : <>You've been invited to Brand OS as <b>{invite.role}</b>{invite.team ? <> in <b>{invite.team}</b></> : null}. Choose a password to get started.</>}</p>
              {error && <Note tone="error">{error}</Note>}
              <Field label="Email">{id => <input id={id} className="input" value={invite.email} readOnly autoComplete="username" />}</Field>
              <Field label={reset ? 'New password' : 'Password'} help="At least 8 characters">{id => <input id={id} className="input" type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} autoFocus />}</Field>
              <Field label="Type it again">{id => <input id={id} className="input" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} />}</Field>
              <Button variant="primary" size="lg" type="submit" loading={busy} className="btn-block">{reset ? 'Save and sign in' : 'Set password and sign in'}</Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
