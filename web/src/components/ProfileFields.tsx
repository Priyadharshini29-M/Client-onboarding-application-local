import type { ProfileField } from '../lib/clientTypes'
import { Field } from './ui'

/** Inputs for a client type's details. Values are kept as strings in the client's profile. */
export function ProfileFields({ fields, values, onChange }: {
  fields: ProfileField[]; values: Record<string, string>; onChange: (key: string, value: string) => void
}) {
  return (
    <div className="form-2col">
      {fields.map(f => (
        <Field key={f.key} label={f.label}>
          {id => f.kind === 'select' ? (
            <select id={id} className="select" value={values[f.key] ?? ''} onChange={e => onChange(f.key, e.target.value)}>
              <option value="">Choose</option>
              {f.options?.map(o => <option key={o}>{o}</option>)}
            </select>
          ) : (
            <div className={f.kind === 'money' ? 'input-affix' : undefined}>
              {f.kind === 'money' && <span>₹</span>}
              <input id={id} className="input" inputMode={f.kind === 'number' || f.kind === 'money' ? 'numeric' : undefined}
                type={f.kind === 'url' ? 'url' : 'text'} placeholder={f.placeholder} value={values[f.key] ?? ''}
                onChange={e => onChange(f.key, f.kind === 'number' || f.kind === 'money' ? e.target.value.replace(/[^\d]/g, '') : e.target.value)} />
            </div>
          )}
        </Field>
      ))}
    </div>
  )
}
