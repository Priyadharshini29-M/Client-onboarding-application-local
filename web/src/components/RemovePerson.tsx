import { useState } from 'react'
import { UserMinus } from 'lucide-react'
import { api } from '../lib/api'
import { useApi } from '../lib/hooks'
import { Button, Field, Loading, Modal, Note } from './ui'
import { useToast } from './toast'

type Preview = {
  person: { id: number; name: string; role: string; team_id: number | null }
  open_tasks: number; waiting_approval: number; managed_clients: number; open_content: number; setup_items: number
  leads: { id: number; client: string; department: string }[]
  suggested: { id: number; name: string; team_id: number | null }[]
}

/** Remove a person: shows what they are responsible for and lets you hand it all to someone else first. */
export function RemovePerson({ userId, onClose, onRemoved }: { userId: number; onClose: () => void; onRemoved: () => void }) {
  const toast = useToast()
  const { data, error } = useApi<Preview>(`/users/${userId}/removal`)
  const [handTo, setHandTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (error) {
    return (
      <Modal title="Can't remove this person" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
        <Note tone="error">{error.message}</Note>
      </Modal>
    )
  }
  if (!data) return <Modal title="Remove person" onClose={onClose}><Loading /></Modal>

  const p = data.person
  const sameTeam = data.suggested.filter(s => s.team_id === p.team_id)
  const choice = handTo ?? (sameTeam[0] ? String(sameTeam[0].id) : '')
  const hasWork = data.open_tasks + data.leads.length + data.managed_clients + data.open_content + data.setup_items > 0
  const first = p.name.split(' ')[0]

  async function remove() {
    setBusy(true)
    try {
      const r = await api<{ removed: string; handed_to: string | null }>(`/users/${userId}`, { method: 'DELETE', body: { hand_to: hasWork && choice ? Number(choice) : null } })
      toast.success(r.handed_to ? `${r.removed} removed. Their work went to ${r.handed_to}.` : `${r.removed} removed`)
      onRemoved()
      onClose()
    } catch (e) { toast.error(e); setBusy(false) }
  }

  return (
    <Modal title={`Remove ${p.name}?`} sub="They lose access straight away. This can't be undone." onClose={onClose} footer={<>
      <Button onClick={onClose}>Keep {first}</Button>
      <Button variant="danger" icon={<UserMinus size={15} />} loading={busy} onClick={remove}>Remove {first}</Button>
    </>}>
      <div className="stack" style={{ gap: 16 }}>
        {hasWork ? (
          <>
            <div>
              <div className="label" style={{ marginBottom: 8 }}>What {first} is responsible for now</div>
              <ul className="rm-list">
                {data.open_tasks > 0 && <li><b>{data.open_tasks}</b> open task{data.open_tasks === 1 ? '' : 's'}{data.waiting_approval > 0 ? ` (${data.waiting_approval} waiting for approval)` : ''}</li>}
                {data.leads.length > 0 && <li>Client lead for <b>{data.leads.map(l => `${l.client} (${l.department})`).join(', ')}</b></li>}
                {data.managed_clients > 0 && <li>Manages <b>{data.managed_clients}</b> client{data.managed_clients === 1 ? '' : 's'}</li>}
                {data.open_content > 0 && <li><b>{data.open_content}</b> content calendar post{data.open_content === 1 ? '' : 's'}</li>}
                {data.setup_items > 0 && <li><b>{data.setup_items}</b> setup checklist item{data.setup_items === 1 ? '' : 's'}</li>}
              </ul>
            </div>
            <Field label="Hand all of it to" help="They'll get a notification. Choose nobody to leave it unassigned.">
              {id => <select id={id} className="select" value={choice} onChange={e => setHandTo(e.target.value)}>
                <option value="">Nobody (leave it unassigned)</option>
                {sameTeam.length > 0 && <optgroup label="Same department">{sameTeam.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
                <optgroup label="Everyone else">{data.suggested.filter(s => s.team_id !== p.team_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
              </select>}
            </Field>
          </>
        ) : <p className="soft">{first} has no open tasks and isn't a lead on any client.</p>}
        <p className="muted" style={{ fontSize: 13 }}>Their past work stays: submitted versions, approvals and client history are kept, without their name.</p>
      </div>
    </Modal>
  )
}
