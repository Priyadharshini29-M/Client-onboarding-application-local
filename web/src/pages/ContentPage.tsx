import { ContentCalendar } from '../components/ContentCalendar'
import { PageHead } from '../components/ui'

export function ContentPage() {
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <PageHead title="Content calendar" sub="Monthly content plans for every client. Click any cell to edit it; changes save when you move on." />
      <ContentCalendar />
    </div>
  )
}
