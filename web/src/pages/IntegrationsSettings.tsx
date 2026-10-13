import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ExternalLink, KeyRound, Mail, MessageCircle, MessageSquareText, RefreshCw, Send, Unplug, Users } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/hooks'
import type { IntegrationState } from '../lib/types'
import { Button, Confirm, Field, Loading, Note, PageHead } from '../components/ui'
import { useToast } from '../components/toast'
import { SettingsNav } from './Settings'

type S = IntegrationState['settings']

/** Settings → Integrations: Brevo for every email, SMS and WhatsApp the app sends, and the client contact list. */
export function IntegrationsSettings() {
  const toast = useToast()
  const { data, setData } = useApi<IntegrationState>('/settings/integrations')
  const [key, setKey] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [changingKey, setChangingKey] = useState(false)

  async function save(body: Partial<S> & { brevo_api_key?: string }, what = 'save') {
    setBusy(what); setErrors({})
    try {
      const next = await api<IntegrationState>('/settings/integrations', { method: 'PUT', body })
      setData(next)
      if (what === 'connect') { setKey(''); setChangingKey(false); toast.success(changingKey ? 'API key updated' : 'Brevo is connected') } else toast.success('Saved')
    } catch (e) {
      if (e instanceof ApiError && e.details) setErrors(e.details); else toast.error(e)
    } finally { setBusy(null) }
  }

  const s = data?.settings
  const setting = <K extends keyof S>(k: K, v: S[K]) => data && setData({ ...data, settings: { ...data.settings, [k]: v } })

  return (
    <div className="page">
      <PageHead title="Settings" />
      <SettingsNav />
      {!data || !s ? <Loading /> : (
        <div className="int-grid">
          <section className="panel int-main">
            <div className="int-head">
              <span className="int-logo" aria-hidden="true">B</span>
              <div className="grow">
                <h2>Brevo</h2>
                <p>Sends every email, SMS and WhatsApp message from Brand OS: workflow messages, form links, document requests and approval alerts.</p>
              </div>
              {data.connected ? <span className="pill ok"><CheckCircle2 size={12} /> Connected</span> : <span className="pill">Not connected</span>}
            </div>

            {!data.connected ? (
              <div className="int-body">
                <Field label="API key" error={errors.brevo_api_key} help={<>In Brevo, open <b>SMTP &amp; API → API keys</b> and create a key. It starts with <code>xkeysib-</code>.</>}>
                  {id => <div className="row" style={{ gap: 8 }}>
                    <input id={id} className="input mono grow" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} placeholder="xkeysib-…" />
                    <Button variant="primary" icon={<KeyRound size={14} />} loading={busy === 'connect'} disabled={!key.trim()} onClick={() => save({ brevo_api_key: key.trim() }, 'connect')}>Connect</Button>
                  </div>}
                </Field>
                <a className="link-btn" href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noreferrer">Open Brevo API keys <ExternalLink size={13} /></a>
              </div>
            ) : (
              <div className="int-body">
                <div className="int-account">
                  {data.account?.error ? <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 8 }}><Note tone="error">{data.account.error}</Note>{!changingKey && <button type="button" className="link-btn" style={{ justifySelf: 'start' }} onClick={() => setChangingKey(true)}><KeyRound size={13} /> Paste a new key</button>}</div> : <>
                    <div><span className="label">Account</span><b>{data.account?.company || data.account?.email}</b><small>{data.account?.email}</small></div>
                    <div><span className="label">Plan</span><b>{data.account?.plans?.join(' · ') || '—'}</b></div>
                    <div><span className="label">API key</span><b className="mono">{data.key_hint}</b>
                      {!changingKey && <button type="button" className="link-btn" style={{ justifySelf: 'start', fontSize: 13 }} onClick={() => setChangingKey(true)}><KeyRound size={13} /> Change key</button>}
                    </div>
                  </>}
                </div>
                {changingKey && (
                  <Field label="New API key" error={errors.brevo_api_key} help={<>Paste the new key from Brevo (<b>SMTP &amp; API → API keys</b>). Your sender and other settings stay the same.</>}>
                    {id => <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <input id={id} className="input mono grow" style={{ minWidth: 200 }} type="password" autoComplete="off" autoFocus value={key} onChange={e => setKey(e.target.value)} placeholder="xkeysib-…" />
                      <Button variant="primary" loading={busy === 'connect'} disabled={!key.trim()} onClick={() => save({ brevo_api_key: key.trim() }, 'connect')}>Save key</Button>
                      <Button onClick={() => { setChangingKey(false); setKey(''); setErrors({}) }}>Cancel</Button>
                    </div>}
                  </Field>
                )}

                <div className="int-section">
                  <div className="int-sec-head"><Mail size={16} /><b>Email</b></div>
                  <div className="two">
                    <Field label="From name">{id => <input id={id} className="input" value={s.brevo_sender_name} onChange={e => setting('brevo_sender_name', e.target.value)} />}</Field>
                    <Field label="From email" error={errors.brevo_sender_email} help={data.senders.length ? 'Must be a verified sender in Brevo' : 'Add and verify a sender in Brevo first'}>
                      {id => data.senders.length
                        ? <select id={id} className="select" value={s.brevo_sender_email} onChange={e => setting('brevo_sender_email', e.target.value)}>
                            <option value="">Choose…</option>{data.senders.map(x => <option key={x.email} value={x.email}>{x.name} · {x.email}{x.active ? '' : ' (not verified)'}</option>)}
                          </select>
                        : <input id={id} className="input" type="email" value={s.brevo_sender_email} onChange={e => setting('brevo_sender_email', e.target.value)} placeholder="hello@yourcompany.com" />}
                    </Field>
                  </div>
                </div>

                <div className="int-section">
                  <div className="int-sec-head"><MessageSquareText size={16} /><b>SMS</b><MessageCircle size={16} style={{ marginLeft: 8 }} /><b>WhatsApp</b></div>
                  <div className="two">
                    <Field label="SMS sender name" error={errors.brevo_sms_sender} help="3 to 11 letters or numbers">{id => <input id={id} className="input" value={s.brevo_sms_sender} onChange={e => setting('brevo_sms_sender', e.target.value)} placeholder="BRANDOS" />}</Field>
                    <Field label="WhatsApp sender number" help="Your WhatsApp number connected in Brevo">{id => <input id={id} className="input" value={s.brevo_whatsapp_number} onChange={e => setting('brevo_whatsapp_number', e.target.value)} placeholder="919876543210" />}</Field>
                  </div>
                  <Field label="Default country code" help="Added to 10-digit phone numbers">{id => <input id={id} className="input" style={{ maxWidth: 120 }} value={s.default_country_code} onChange={e => setting('default_country_code', e.target.value)} />}</Field>
                </div>

                <div className="int-section">
                  <div className="int-sec-head"><Send size={16} /><b>What goes through Brevo</b></div>
                  <label className="fb-switch">
                    <span className="grow"><b>Send emails through Brevo</b><small>Workflow emails, form links and document requests</small></span>
                    <button type="button" role="switch" aria-checked={s.brevo_emails} className={`sw ${s.brevo_emails ? 'on' : ''}`} onClick={() => setting('brevo_emails', !s.brevo_emails)} />
                  </label>
                  <label className="fb-switch">
                    <span className="grow"><b>Email people about their work</b><small>New tasks, work waiting for approval, approvals and rework requests</small></span>
                    <button type="button" role="switch" aria-checked={s.notify_emails} className={`sw ${s.notify_emails ? 'on' : ''}`} onClick={() => setting('notify_emails', !s.notify_emails)} />
                  </label>
                </div>

                <div className="int-section">
                  <div className="int-sec-head"><Users size={16} /><b>Client contacts</b></div>
                  <label className="fb-switch">
                    <span className="grow"><b>Sync clients to Brevo</b><small>Adds each client's main contact to a list when they are added or edited</small></span>
                    <button type="button" role="switch" aria-checked={s.sync_clients} className={`sw ${s.sync_clients ? 'on' : ''}`} onClick={() => setting('sync_clients', !s.sync_clients)} />
                  </label>
                  {s.sync_clients && (
                    <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
                      <Field label="List">{id => <select id={id} className="select" style={{ minWidth: 240 }} value={s.brevo_list_id} onChange={e => setting('brevo_list_id', e.target.value)}>
                        <option value="">No list (contacts only)</option>{data.lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>}</Field>
                      <Button icon={<RefreshCw size={14} />} loading={busy === 'sync'} onClick={async () => {
                        setBusy('sync')
                        try {
                          const r = await api<{ synced: number; errors: string[] }>('/settings/integrations/sync-clients', { body: {} })
                          toast.success(`Synced ${r.synced} clients`); if (r.errors.length) toast.error(r.errors[0])
                        } catch (e) { toast.error(e) } finally { setBusy(null) }
                      }}>Sync all clients now</Button>
                    </div>
                  )}
                </div>

                <div className="int-foot">
                  <Button variant="primary" loading={busy === 'save'} onClick={() => save({ ...s })}>Save settings</Button>
                  <Button icon={<Send size={14} />} loading={busy === 'test'} onClick={async () => {
                    setBusy('test')
                    try { const r = await api<{ sent_to: string }>('/settings/integrations/test-email', { body: {} }); toast.success(`Test email sent to ${r.sent_to}`) } catch (e) { toast.error(e) } finally { setBusy(null) }
                  }}>Send me a test email</Button>
                  <span className="grow" />
                  <Button variant="ghost" className="danger-text" icon={<Unplug size={14} />} onClick={() => setDisconnecting(true)}>Disconnect</Button>
                </div>
              </div>
            )}
          </section>


          <aside className="panel int-side">
            <div className="panel-head"><div><h2>Last 30 days</h2><p>Messages the app tried to send</p></div></div>
            <div className="int-stats">
              <div><b>{data.stats.sent_30}</b><span>Sent</span></div>
              <div className={Number(data.stats.failed_30) ? 'bad' : ''}><b>{data.stats.failed_30}</b><span>Failed</span></div>
              <div><b>{data.stats.unsent_30}</b><span>Not sent</span></div>
            </div>
            <div className="panel-body"><Link to="/workflows?view=messages" className="link-btn">See every message <ExternalLink size={13} /></Link></div>
          </aside>
        </div>
      )}
      {disconnecting && <Confirm title="Disconnect Brevo?" message="Messages will be saved in the app but not sent until you connect again." action="Disconnect"
        onClose={() => setDisconnecting(false)}
        onConfirm={async () => { try { setData(await api<IntegrationState>('/settings/integrations/disconnect', { body: {} })); toast.success('Brevo disconnected') } catch (e) { toast.error(e); throw e } }} />}
    </div>
  )
}

