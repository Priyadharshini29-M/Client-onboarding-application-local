import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Megaphone, ShoppingBag } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/hooks'
import { CLIENT_TYPES } from '../lib/clientTypes'
import type { Blueprint, BrandType, ClientDetail } from '../lib/types'
import { ProfileFields } from './ProfileFields'
import { Button, Field, Modal } from './ui'
import { useToast } from './toast'

const ICON = { ecommerce: ShoppingBag, lead_gen: Megaphone }

/** Add a client: pick the type first, then only the details that type needs. */
export function AddClient({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const { data: blueprints } = useApi<Blueprint[]>('/blueprints')
  const [type, setType] = useState<BrandType>('ecommerce')
  const [form, setForm] = useState({ name: '', contact_name: '', email: '', phone: '', industry: '' })
  const [profile, setProfile] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const def = CLIENT_TYPES[type]
  const flow = blueprints?.find(b => b.client_type === type)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErrors({})
    try {
      const c = await api<ClientDetail>('/clients', { body: { ...form, brand_type: type, profile } })
      toast.success(`${c.name} is set up. Share the onboarding form next.`)
      onClose()
      navigate(`/clients/${c.id}`)
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details); else toast.error(err)
    } finally { setBusy(false) }
  }

  return (
    <Modal title="Add a client" sub="Choose the kind of client. We'll set up the right onboarding form and project flow." onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" type="submit" form="add-client" loading={busy}>Add {def.short} client</Button></>}>
      <form id="add-client" className="stack" style={{ gap: 20 }} onSubmit={submit}>
        <div className="type-pick" role="radiogroup" aria-label="Client type">
          {Object.values(CLIENT_TYPES).map(t => {
            const Icon = ICON[t.key]
            return (
              <button key={t.key} type="button" role="radio" aria-checked={type === t.key} className={`type-card ${type === t.key ? 'on' : ''}`}
                onClick={() => { setType(t.key); setProfile({}) }}>
                <span className="type-ico"><Icon size={18} /></span>
                <span><b>{t.label}</b><small>{t.description}</small></span>
              </button>
            )
          })}
        </div>

        <div className="form-2col">
          <Field label={type === 'ecommerce' ? 'Brand name' : 'Business name'} required error={errors.name}>
            {id => <input id={id} className={`input ${errors.name ? 'invalid' : ''}`} value={form.name} onChange={set('name')} placeholder={type === 'ecommerce' ? 'e.g. Lushra' : 'e.g. Smile Dental Care'} />}
          </Field>
          <Field label="Industry">{id => <input id={id} className="input" value={form.industry} onChange={set('industry')} placeholder={def.industryHint} />}</Field>
          <Field label="Main contact">{id => <input id={id} className="input" value={form.contact_name} onChange={set('contact_name')} placeholder="Their name" />}</Field>
          <Field label="Phone">{id => <input id={id} className="input" value={form.phone} onChange={set('phone')} placeholder="+91" />}</Field>
          <Field label="Email" error={errors.email}>{id => <input id={id} type="email" className="input" value={form.email} onChange={set('email')} placeholder="name@company.com" />}</Field>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <div className="section-rule"><span>{def.label} details</span></div>
          <ProfileFields fields={def.fields.filter(f => f.quick)} values={profile} onChange={(k, v) => setProfile(p => ({ ...p, [k]: v }))} />
          <p className="muted" style={{ fontSize: 13 }}>You can add the rest in Edit details later.</p>
        </div>

        {flow && (
          <div className="flow-note">
            <b>{flow.name} flow · {flow.stages.length} stages</b>
            <span>{flow.stages.map(s => s.name).join(' → ')}</span>
          </div>
        )}
        {errors.brand_type && <p className="error" style={{ color: 'var(--change)' }}>{errors.brand_type}</p>}
      </form>
    </Modal>
  )
}
