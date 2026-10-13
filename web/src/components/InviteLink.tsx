import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, MailCheck, MailWarning, Send } from 'lucide-react'
import { api } from '../lib/api'
import { formatDate } from '../lib/format'
import { Button, copyText, Modal } from './ui'
import { useToast } from './toast'

export type InviteResult = { link: string; email_status: 'sent' | 'not_sent' | 'failed'; email_error: string | null; expires_at: string; purpose: 'join' | 'reset'; email: string }

/** Shows an invite or reset link after it was created: whether the email went out, and the link to copy. */
export function InviteLinkModal({ name, result, onClose }: { name: string; result: InviteResult; onClose: () => void }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)
  const first = name.split(' ')[0]
  const reset = result.purpose === 'reset'
  const sent = result.email_status === 'sent'

  return (
    <Modal title={reset ? `Password reset link for ${first}` : `${first} is invited`} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="stack" style={{ gap: 16 }}>
        {sent ? (
          <div className="invite-status ok"><MailCheck size={18} /><span>We emailed {reset ? 'the link' : 'an invite'} to <b>{result.email}</b>. {first} opens it, {reset ? 'chooses a new password' : 'chooses a password'} and is signed in.</span></div>
        ) : (
          <div className="invite-status warn"><MailWarning size={18} /><span>
            {result.email_status === 'failed' ? <>The email could not be sent ({result.email_error}). </> : <>No email went out because Brevo isn't connected. </>}
            Copy the link below and send it to {first} yourself, by WhatsApp or email. <Link to="/settings/integrations" onClick={onClose}>Connect Brevo</Link> to send invites automatically.
          </span></div>
        )}
        <div>
          <div className="label" style={{ marginBottom: 6 }}>{reset ? 'Reset link' : 'Invite link'}</div>
          <div className="invite-link">
            <input className="input mono" readOnly value={result.link} onFocus={e => e.target.select()} aria-label="Link" />
            <Button icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={async () => { if (await copyText(result.link)) { setCopied(true); toast.success('Link copied') } }}>{copied ? 'Copied' : 'Copy'}</Button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Works once. Expires on {formatDate(result.expires_at)}. Anyone with this link can set the password, so send it only to {first}.</p>
        </div>
      </div>
    </Modal>
  )
}

/** "Resend invite" / "Send password reset link" for someone already in People. */
export function SendLinkButton({ userId, joined, name, onResult }: { userId: number; joined: boolean; name: string; onResult: (r: InviteResult) => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <div className="send-link">
      <div className="grow">
        <b>{joined ? 'Password' : 'Invite'}</b>
        <small>{joined ? `Send ${name.split(' ')[0]} a link to choose a new password.` : `${name.split(' ')[0]} hasn't set a password yet. Send a fresh invite link.`}</small>
      </div>
      <Button size="sm" icon={<Send size={14} />} loading={busy} onClick={async () => {
        setBusy(true)
        try { onResult(await api<InviteResult>(`/users/${userId}/invite`, { body: {} })) } catch (e) { toast.error(e) } finally { setBusy(false) }
      }}>{joined ? 'Send reset link' : 'Resend invite'}</Button>
    </div>
  )
}

