import { useRef, useState } from 'react'
import { FileInput, FileText, Upload } from 'lucide-react'
import { api } from '../lib/api'
import { DOC_ACCEPT, extractText } from '../lib/docText'
import { Button } from './ui'
import { useToast } from './toast'

type Found = { values: Record<string, string> }
export type Applied = { filled: number; kept: number }
type Result = { tone: 'ok' | 'warn'; text: string }

/**
 * "Fill from a document": reads a brief in the browser, asks the server which answers it contains,
 * and hands them to the form. The document itself is never uploaded or kept, only its text.
 */
export function DocAutofill({ endpoint, auth = true, variant, onFound }: {
  endpoint: string; auth?: boolean; variant: 'card' | 'button'
  onFound: (values: Record<string, string>) => Applied
}) {
  const toast = useToast()
  const picker = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<'' | 'reading' | 'matching'>('')
  const [result, setResult] = useState<Result | null>(null)

  async function run(file: File) {
    setResult(null)
    let res: Result
    try {
      setStep('reading')
      const text = await extractText(file)
      setStep('matching')
      const found = await api<Found>(endpoint, { body: { text }, auth })
      const { filled, kept } = onFound(found.values)
      const total = Object.keys(found.values).length
      if (!total) res = { tone: 'warn', text: `We couldn't find answers in ${file.name}. Try another document, or type the answers below.` }
      else if (!filled) res = { tone: 'warn', text: `${file.name} only had answers for questions that were already filled in, so nothing was changed.` }
      else res = {
        tone: 'ok',
        text: `Filled ${filled} answer${filled === 1 ? '' : 's'} from ${file.name}. They're marked “From document”, so please check them.`
          + (kept ? ` ${kept} question${kept === 1 ? ' that was' : 's that were'} already answered ${kept === 1 ? 'was' : 'were'} left as ${kept === 1 ? 'it was' : 'they were'}.` : ''),
      }
    } catch (e) {
      res = { tone: 'warn', text: e instanceof Error ? e.message : 'That document could not be read.' }
    } finally { setStep('') }
    if (variant === 'button') { if (res.tone === 'ok') toast.success(res.text); else toast.error(res.text) }
    else setResult(res)
  }

  const input = <input ref={picker} type="file" accept={DOC_ACCEPT} hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void run(f) }} />
  const label = step === 'reading' ? 'Reading document…' : step === 'matching' ? 'Finding answers…' : null

  if (variant === 'button') return <>
    {input}
    <Button size="sm" icon={<FileInput size={14} />} loading={!!step} onClick={() => picker.current?.click()}>{label ?? 'Fill from a document'}</Button>
  </>

  return (
    <div className="autofill">
      {input}
      <span className="autofill-icon" aria-hidden="true"><FileText size={20} /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <b>Have these details in a document?</b>
        <small>Upload your brand brief or company profile (PDF, Word or text file). We'll fill in the answers we find, and you can check and change them before sending. We don't keep the document.</small>
        {result && <p className={`autofill-result ${result.tone}`} role="status">{result.text}</p>}
      </div>
      <Button icon={step ? undefined : <Upload size={15} />} loading={!!step} onClick={() => picker.current?.click()}>{label ?? (result ? 'Upload another' : 'Upload document')}</Button>
    </div>
  )
}
