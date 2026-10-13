import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api, ApiError } from '../lib/api'
import { useApi } from '../lib/hooks'
import { TEAM_ICONS, TeamIcon, type TeamIconKey } from '../lib/teamIcons'
import type { Team } from '../lib/types'
import { Button, Confirm, IconButton, Loading, PageHead } from '../components/ui'
import { useToast } from '../components/toast'
import { SettingsNav } from './Settings'

/** Departments: name and icon. Used for the Teams page, project stages and each client's team. */
export function TeamsSettings() {
  const toast = useToast()
  const { data: teams, setData } = useApi<Team[]>('/teams')
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<TeamIconKey>('film')
  const [picking, setPicking] = useState<number | 'new' | null>(null)
  const [removing, setRemoving] = useState<Team | null>(null)

  async function save(t: Team, body: Partial<Team>) {
    try { setData(await api<Team[]>(`/teams/${t.id}`, { method: 'PATCH', body })) } catch (e) { toast.error(e) }
  }


  return (
    <div className="page">
      <PageHead title="Settings" />
      <SettingsNav />
      <p className="soft" style={{ maxWidth: '64ch', marginBottom: 18 }}>Departments group people, own project stages, and each client gets one lead per department.</p>
      <section className="panel">
        {!teams ? <Loading /> : (
          <div className="rows">
            {teams.map(t => (
              <div key={t.id} className="row-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                <div style={{ position: 'relative' }}>
                  <button type="button" className="dept-ico sm" aria-label={`Change ${t.name} icon`} onClick={() => setPicking(picking === t.id ? null : t.id)}><TeamIcon name={t.icon} size={17} /></button>
                  {picking === t.id && <div className="icon-pop"><IconPicker value={t.icon} onPick={k => { void save(t, { icon: k }); setPicking(null) }} /></div>}
                </div>
                <input className="input sm" style={{ maxWidth: 260 }} defaultValue={t.name} aria-label="Department name"
                  onBlur={e => { if (e.target.value.trim() && e.target.value !== t.name) void save(t, { name: e.target.value.trim() }) }} />
                <span className="muted grow" style={{ fontSize: 13 }}>{t.member_count} {Number(t.member_count) === 1 ? 'person' : 'people'}</span>
                <IconButton label="Delete department" className="danger" onClick={() => setRemoving(t)}><Trash2 size={15} /></IconButton>
              </div>
            ))}
          </div>
        )}
        <form className="row wrap" style={{ padding: '14px 20px', borderTop: '1px solid var(--line)' }} onSubmit={async e => {
          e.preventDefault()
          try { setData(await api<Team[]>('/teams', { body: { name, icon } })); setName(''); toast.success('Department added') }
          catch (err) { toast.error(err instanceof ApiError && err.details ? Object.values(err.details)[0] : err) }
        }}>
          <div style={{ position: 'relative' }}>
            <button type="button" className="dept-ico sm" aria-label="Choose icon" onClick={() => setPicking(picking === 'new' ? null : 'new')}><TeamIcon name={icon} size={17} /></button>
            {picking === 'new' && <div className="icon-pop"><IconPicker value={icon} onPick={k => { setIcon(k); setPicking(null) }} /></div>}
          </div>
          <input className="input sm grow" style={{ minWidth: 180 }} placeholder="New department, e.g. Video Editing" value={name} onChange={e => setName(e.target.value)} aria-label="New department name" />
          <Button size="sm" variant="primary" type="submit" icon={<Plus size={14} />} disabled={!name.trim()}>Add department</Button>
        </form>
      </section>
      {removing && <Confirm title={`Delete ${removing.name}?`} message="Only departments with no people and no project stages can be deleted." onClose={() => setRemoving(null)}
        onConfirm={async () => { try { setData(await api<Team[]>(`/teams/${removing.id}`, { method: 'DELETE' })); toast.success('Department deleted') } catch (e) { toast.error(e); throw e } }} />}
    </div>
  )
}

function IconPicker({ value, onPick }: { value: string; onPick: (k: TeamIconKey) => void }) {
  return (
    <div className="icon-picker">
      {(Object.keys(TEAM_ICONS) as TeamIconKey[]).map(k => (
        <button key={k} type="button" className={k === value ? 'on' : ''} title={TEAM_ICONS[k].label} aria-label={TEAM_ICONS[k].label}
          onClick={() => onPick(k)}><TeamIcon name={k} size={17} /></button>
      ))}
    </div>
  )
}
