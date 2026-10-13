import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom'
import {
  Bell, Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronsLeft, ChevronsRight, FolderOpen, LayoutDashboard, LogOut, Menu, Moon,
  Rocket, Settings, Sun, UserPlus, UsersRound, Workflow,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLocalState } from '../lib/hooks'
import { ROLE_LABEL, timeAgo } from '../lib/format'
import type { ActivityItem, AppNotification, ApprovalItem } from '../lib/types'
import { AddClient } from './AddClient'
import { Avatar, Button, IconButton, Modal } from './ui'
import { useToast } from './toast'

interface ShellContext { addClient: () => void; refreshCounts: () => void }
export const useShell = () => useOutletContext<ShellContext>()

type Notes = { unread: number; items: AppNotification[] }

export function Logo() {
  return (
    <Link to="/" className="logo">
      <span className="logo-mark"><Rocket size={15} strokeWidth={2.4} /></span>
      <span className="logo-text">Brand OS<span className="logo-byline">by Digifyce</span></span>
    </Link>
  )
}

/** Closes a popover when clicking outside it. */
function useOutside(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function Shell() {
  const { user, logout, isAdmin } = useAuth()
  const toast = useToast()
  const location = useLocation()
  const [compact, setCompact] = useLocalState('brandos.sidebar.compact', false)
  const [theme, setTheme] = useLocalState<'light' | 'dark'>('brandos.theme', 'light')
  const [adding, setAdding] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [bell, setBell] = useState(false)
  const [profile, setProfile] = useState(false)
  const [reviews, setReviews] = useState<ApprovalItem[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [notes, setNotes] = useState<Notes>({ unread: 0, items: [] })
  const [taskPopup, setTaskPopup] = useState<AppNotification[]>([])
  const [tick, setTick] = useState(0)
  const bellRef = useRef<HTMLDivElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const seen = useRef<number | null>(null)

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  // Notifications: pop new ones up as toasts. The first check after signing in shows one summary instead.
  // Newly assigned tasks are called out separately, in a popup dialog rather than a corner toast.
  const check = useCallback(async () => {
    let n: Notes
    try { n = await api<Notes>('/notifications') } catch { return }
    setNotes(n)
    const maxId = Math.max(0, ...n.items.map(i => i.id))
    const isTask = (i: AppNotification) => i.type === 'task_assigned'
    if (seen.current === null) {
      seen.current = maxId
      const tasks = n.items.filter(i => isTask(i) && !i.read_at)
      if (tasks.length) setTaskPopup(tasks)
      const rest = n.items.filter(i => !isTask(i))
      const restUnread = rest.filter(i => !i.read_at).length
      const key = `brandos.notified.${user?.id}`
      let shown: string | null = null
      try { shown = sessionStorage.getItem(key) } catch { /* private mode */ }
      if (restUnread > 0 && shown !== String(maxId)) {
        const first = rest.find(i => !i.read_at)
        toast.notify({ title: `You have ${restUnread} unread notification${restUnread === 1 ? '' : 's'}`, body: first?.title, onOpen: () => setBell(true) })
        try { sessionStorage.setItem(key, String(maxId)) } catch { /* private mode */ }
      }
      return
    }
    const freshAll = n.items.filter(i => i.id > (seen.current ?? 0) && !i.read_at)
    const freshTasks = freshAll.filter(isTask)
    if (freshTasks.length) setTaskPopup(list => [...list, ...freshTasks])
    freshAll.filter(i => !isTask(i)).slice(0, 3).reverse().forEach(i => toast.notify({ title: i.title, body: i.body, link: i.link }))
    seen.current = Math.max(seen.current, maxId)
  }, [user?.id, toast])

  const dismissTaskPopup = useCallback(() => {
    const ids = taskPopup.map(i => i.id)
    setTaskPopup([])
    if (ids.length) api<Notes>('/notifications/read', { body: { ids } }).then(setNotes).catch(() => {})
  }, [taskPopup])

  const loadReviews = useCallback(() => { api<ApprovalItem[]>('/approvals?view=pending&only_mine=1').then(setReviews).catch(() => {}) }, [])
  useEffect(() => { void check(); loadReviews() }, [location.pathname, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const every = setInterval(() => { if (document.visibilityState === 'visible') { void check(); loadReviews() } }, 30000)
    const onFocus = () => { void check(); loadReviews() }
    window.addEventListener('focus', onFocus)
    return () => { clearInterval(every); window.removeEventListener('focus', onFocus) }
  }, [check, loadReviews])

  useEffect(() => { setMobileOpen(false); setBell(false); setProfile(false) }, [location.pathname, location.search])
  useEffect(() => {
    if (!bell) return
    api<ActivityItem[]>('/activity').then(a => setActivity(a.slice(0, 6))).catch(() => {})
    // Opening the bell marks notifications as read (they stay listed).
    if (notes.unread) api<Notes>('/notifications/read', { body: {} }).then(n => setTimeout(() => setNotes(n), 1500)).catch(() => {})
  }, [bell]) // eslint-disable-line react-hooks/exhaustive-deps
  useOutside(bell, bellRef, () => setBell(false))
  useOutside(profile, profileRef, () => setProfile(false))

  const onTeam = (location.pathname.startsWith('/teams') || location.pathname === '/work')
  const onSettings = location.pathname.startsWith('/settings')
  const badge = reviews.length + notes.unread

  return (
    <div className={`app ${compact ? 'compact' : ''} ${mobileOpen ? 'side-open' : ''}`}>
      <aside className="side" aria-label="Main">
        <div className="side-top">
          <Logo />
          <IconButton label={compact ? 'Expand sidebar' : 'Collapse sidebar'} className="side-toggle" onClick={() => setCompact(!compact)}>
            {compact ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </IconButton>
        </div>

        <nav className="side-nav">
          <NavLink to="/" end title="Dashboard"><LayoutDashboard size={18} /><span>Dashboard</span></NavLink>
          <a href="#add-client" title="Add client" onClick={e => { e.preventDefault(); setAdding(true) }}><UserPlus size={18} /><span>Add client</span></a>
          <NavLink to="/clients" title="Clients"><Building2 size={18} /><span>Clients</span></NavLink>

          <NavLink to="/teams" title="Teams & tasks" className={() => (onTeam ? 'active' : '')}><UsersRound size={18} /><span>Teams</span></NavLink>
          <NavLink to="/reviews" title="Approvals"><CheckCircle2 size={18} /><span>Approvals</span>{reviews.length > 0 && <em className="count">{reviews.length}</em>}</NavLink>
          <NavLink to="/content" title="Content calendar"><CalendarDays size={18} /><span>Content calendar</span></NavLink>
          <NavLink to="/assets" title="Assets"><FolderOpen size={18} /><span>Assets</span></NavLink>
          <NavLink to="/workflows" title="Workflows"><Workflow size={18} /><span>Workflows</span></NavLink>

          {isAdmin && <>
            <NavLink to="/settings/forms" title="Settings" className={() => (onSettings ? 'active' : '')}><Settings size={18} /><span>Settings</span></NavLink>
          </>}
        </nav>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <IconButton label="Open menu" className="topbar-menu" onClick={() => setMobileOpen(true)}><Menu size={18} /></IconButton>
          <span className="topbar-logo"><Logo /></span>
          <span className="grow" />

          <div className="menu" ref={bellRef}>
            <IconButton label={badge ? `Notifications, ${badge} new` : 'Notifications'} className={`line topbar-btn ${bell ? 'on' : ''}`} onClick={() => { setBell(!bell); setProfile(false) }}>
              <Bell size={17} />{badge > 0 && <span className="badge-dot">{badge > 99 ? '99+' : badge}</span>}
            </IconButton>
            {bell && (
              <div className="menu-pop notif" role="dialog" aria-label="Notifications">
                <div className="notif-head"><b>Notifications</b>{notes.unread > 0 && <span className="muted">{notes.unread} new</span>}</div>
                {notes.items.length === 0 && <p className="muted" style={{ padding: '4px 10px 8px', fontSize: 13.5 }}>No notifications yet.</p>}
                {notes.items.slice(0, 6).map(n => (
                  <Link key={n.id} to={n.link ?? '/'} className={`notif-item ${n.read_at ? '' : 'unread'}`} style={{ display: 'block' }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600, display: 'block' }}>{n.title}</span>
                    <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{n.body ? `${n.body.length > 110 ? n.body.slice(0, 110) + '…' : n.body} · ` : ''}{timeAgo(n.created_at)}</span>
                  </Link>
                ))}
                <div className="sep" />
                <div className="label" style={{ padding: '8px 10px 4px' }}>Waiting for your approval</div>
                {reviews.length === 0 && <p className="muted" style={{ padding: '4px 10px 8px', fontSize: 13.5 }}>Nothing to approve.</p>}
                {reviews.slice(0, 5).map(r => (
                  <Link key={r.key} to="/reviews"><span className="vtag">{r.label}</span><span className="grow truncate">{r.title} · {r.client_name}</span></Link>
                ))}
                <div className="sep" />
                <div className="label" style={{ padding: '6px 10px 4px' }}>Recent activity</div>
                {activity.map(a => (
                  <Link key={a.id} to={a.brand_id ? `/clients/${a.brand_id}` : '/'} style={{ display: 'block' }}>
                    <span style={{ fontSize: 13.5 }}><b style={{ fontWeight: 600 }}>{a.user_name ?? 'Client'}</b> {a.message.charAt(0).toLowerCase() + a.message.slice(1)}</span>
                    <span className="muted" style={{ display: 'block', fontSize: 12 }}>{a.brand_name ? `${a.brand_name} · ` : ''}{timeAgo(a.created_at)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <IconButton label={theme === 'dark' ? 'Light mode' : 'Dark mode'} className="line topbar-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </IconButton>

          <div className="menu" ref={profileRef}>
            <button type="button" className={`topbar-user ${profile ? 'on' : ''}`} aria-haspopup="menu" aria-expanded={profile} onClick={() => { setProfile(!profile); setBell(false) }}>
              <Avatar name={user?.name} />
              <span className="topbar-who"><b>{user?.name}</b><small>{user ? ROLE_LABEL[user.role] : ''}{user?.team_name ? ` · ${user.team_name}` : ''}</small></span>
              <ChevronDown size={15} className="topbar-caret" />
            </button>
            {profile && (
              <div className="menu-pop profile-pop" role="menu">
                <div className="who">
                  <b style={{ display: 'block', fontWeight: 600 }}>{user?.name}</b>
                  <span className="muted" style={{ fontSize: 12.5 }}>{user?.email}</span>
                  <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{user ? ROLE_LABEL[user.role] : ''}{user?.team_name ? ` · ${user.team_name}` : ''}</span>
                </div>
                <div className="sep" />
                {isAdmin && <Link to="/settings/forms" role="menuitem"><Settings size={15} /> Settings</Link>}
                <button type="button" role="menuitem" onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark') }}>{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />} {theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>
                <div className="sep" />
                <button type="button" role="menuitem" className="danger-text" onClick={() => void logout()}><LogOut size={15} /> Sign out</button>
              </div>
            )}
          </div>
        </header>
        <Outlet context={{ addClient: () => setAdding(true), refreshCounts: () => setTick(t => t + 1) } satisfies ShellContext} />
      </div>

      {mobileOpen && <div className="drawer-bg" style={{ zIndex: 60 }} onClick={() => setMobileOpen(false)} />}
      {adding && <AddClient onClose={() => setAdding(false)} />}
      {taskPopup.length > 0 && (
        <Modal
          title={taskPopup.length === 1 ? 'New task assigned' : `${taskPopup.length} new tasks assigned`}
          onClose={dismissTaskPopup}
          footer={<Button variant="primary" onClick={dismissTaskPopup}>Got it</Button>}
        >
          <div className="rows">
            {taskPopup.map(n => (
              <Link key={n.id} to={n.link ?? '/teams'} className="row-item" onClick={dismissTaskPopup} style={{ display: 'flex' }}>
                <div className="grow"><div className="t">{n.title}</div>{n.body && <div className="s">{n.body}</div>}</div>
              </Link>
            ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
