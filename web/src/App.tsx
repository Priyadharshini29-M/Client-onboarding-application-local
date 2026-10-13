import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider } from './components/toast'
import { Shell } from './components/Shell'
import { Empty, Loading } from './components/ui'
import { SignIn } from './pages/SignIn'
import { Join } from './pages/Join'
import { Home } from './pages/Home'
import { Clients } from './pages/Clients'
import { ClientPage } from './pages/ClientPage'
import { Reviews } from './pages/Reviews'
import { People, ProjectTypes } from './pages/Settings'
import { FormsSettings } from './pages/FormBuilder'
import { ClientForm } from './pages/ClientForm'
import { TeamPage } from './pages/TeamPage'
import { Assets } from './pages/Assets'
import { IntegrationsSettings } from './pages/IntegrationsSettings'
import { ContentPage } from './pages/ContentPage'
import { ClientDocumentsPublic } from './pages/ClientDocumentsPublic'
import { TeamsSettings } from './pages/TeamsSettings'

function Private({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <Loading />
  if (!user) return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  return isAdmin ? <>{children}</> : <div className="page"><Empty title="Admins only">Ask an admin if you need to change settings.</Empty></div>
}

/** Tasks now live inside Teams. Old links like /work?team=2 still land in the right place. */
function WorkRedirect() {
  const team = new URLSearchParams(useLocation().search).get('team')
  return <Navigate to={team ? `/teams/${team}` : '/teams'} replace />
}

// The canvas library is large, so the Workflows pages load only when they are opened.
const Workflows = lazy(() => import('./pages/Workflows').then(m => ({ default: m.Workflows })))
const WorkflowEditor = lazy(() => import('./pages/WorkflowEditor').then(m => ({ default: m.WorkflowEditor })))
const lazyPage = (el: ReactNode) => <Suspense fallback={<div className="page"><Loading /></div>}>{el}</Suspense>

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/sign-in" element={<SignIn />} />
            <Route path="/join/:token" element={<Join />} />
            <Route path="/fill/:token" element={<ClientForm />} />
            <Route path="/documents/:token" element={<ClientDocumentsPublic />} />
            <Route element={<Private><Shell /></Private>}>
              <Route index element={<Home />} />
              <Route path="clients" element={<Clients />} />
              <Route path="clients/:id" element={<ClientPage />} />
              <Route path="work" element={<WorkRedirect />} />
              <Route path="reviews" element={<Reviews />} />
              <Route path="teams" element={<TeamPage />} />
              <Route path="teams/:id" element={<TeamPage />} />
              <Route path="assets" element={<Assets />} />
              <Route path="workflows" element={lazyPage(<Workflows />)} />
              <Route path="workflows/:id" element={lazyPage(<WorkflowEditor />)} />
              <Route path="content" element={<ContentPage />} />
              <Route path="settings/teams" element={<AdminOnly><TeamsSettings /></AdminOnly>} />
              <Route path="settings" element={<Navigate to="/settings/forms" replace />} />
              <Route path="settings/forms" element={<AdminOnly><FormsSettings /></AdminOnly>} />
              <Route path="settings/project-types" element={<AdminOnly><ProjectTypes /></AdminOnly>} />
              <Route path="settings/people" element={<AdminOnly><People /></AdminOnly>} />
              <Route path="settings/integrations" element={<AdminOnly><IntegrationsSettings /></AdminOnly>} />
              <Route path="*" element={<div className="page"><Empty title="This page doesn't exist">Use the menu above to find your way.</Empty></div>} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
