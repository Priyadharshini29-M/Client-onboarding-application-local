import { useState } from 'react'
import { Mail } from 'lucide-react'
import { api } from '../lib/api'
import { Button } from './ui'
import { useToast } from './toast'

/** Emails the client their form link or document upload link (through Brevo when it is connected). */
export function EmailLinkButton({ clientId, what, onSent }: { clientId: number; what: 'form' | 'documents'; onSent?: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <Button size="sm" variant="primary" icon={<Mail size={14} />} loading={busy} onClick={async () => {
      setBusy(true)
      try {
        const r = await api<{ status: string; error: string | null; to: string }>(`/clients/${clientId}/email-${what === 'form' ? 'form-link' : 'documents-link'}`, { body: {} })
        if (r.status === 'sent') toast.success(`Emailed to ${r.to}`)
        else if (r.status === 'not_sent') toast.error('Saved, but not sent: connect Brevo in Settings → Integrations')
        else toast.error(r.error ?? 'The email could not be sent')
        onSent?.()
      } catch (e) { toast.error(e) } finally { setBusy(false) }
    }}>Email it to the client</Button>
  )
}
