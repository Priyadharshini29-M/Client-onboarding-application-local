import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FolderOpen, Plus } from 'lucide-react'
import { useApi } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { ASSET_KIND } from '../lib/format'
import type { AssetFormatRow } from '../lib/types'
import { AssetLibrary } from '../components/AssetLibrary'
import { FormatDetail, FormatModal, KindIcon } from '../components/AssetFormats'
import { Button, Loading, PageHead } from '../components/ui'

/** Assets: Drive links and documents, plus the formats the team fills in (shoot briefs, calendars, checklists). */
export function Assets() {
  const { isAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  const { data: formats, reload } = useApi<AssetFormatRow[]>('/asset-formats')
  const [creating, setCreating] = useState(false)
  const selected = params.get('format')
  const current = selected ? Number(selected) : null
  const pick = (id: number | null) => setParams(id ? { format: String(id) } : {}, { replace: true })

  useEffect(() => {
    document.querySelector('.af-nav .on')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [current, formats])

  return (
    <div className="page">
      <PageHead title="Assets" sub="Drive links, documents, and the formats the team fills in for each client."
        actions={isAdmin ? <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>New format</Button> : undefined} />

      <div className="af-layout">
        <aside className="af-side">
          <nav className="af-nav" aria-label="Assets">
            <button className={`af-item ${current === null ? 'on' : ''}`} onClick={() => pick(null)}>
              <span className="af-ico sm"><FolderOpen size={15} /></span>
              <span className="grow"><b>Files & links</b><small>Drive links and documents</small></span>
            </button>

            <div className="af-side-head"><span className="label">Formats</span>{formats && <span className="muted" style={{ fontSize: 12 }}>{formats.length}</span>}</div>

            {!formats ? <Loading /> : formats.map(f => (
              <button key={f.id} className={`af-item ${current === f.id ? 'on' : ''} ${f.is_active ? '' : 'off'}`} onClick={() => pick(f.id)}>
                <span className="af-ico sm"><KindIcon kind={f.kind} size={15} /></span>
                <span className="grow">
                  <b>{f.name}</b>
                  <small>{ASSET_KIND[f.kind].label} · {f.field_count} {Number(f.field_count) === 1 ? 'field' : 'fields'}{f.is_active ? '' : ' · off'}</small>
                </span>
                {Number(f.waiting_count) > 0 && <em className="count" title="Waiting for approval">{f.waiting_count}</em>}
              </button>
            ))}
          </nav>
        </aside>

        <div className="af-main">
          {current === null
            ? <AssetLibrary />
            : <FormatDetail key={current} id={current} onChanged={() => void reload()} onDeleted={() => { pick(null); void reload() }} />}
        </div>
      </div>

      {creating && <FormatModal onClose={() => setCreating(false)} onSaved={f => { setCreating(false); void reload(); pick(f.id) }} />}
    </div>
  )
}
