import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ToastProvider } from './ui/ToastProvider'
import { ProtectedRoute, PublicOnly, NotFound, RouteFallback } from './routes/ProtectedRoute'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import ProjectsDashboard from './pages/ProjectsDashboard'
import TeamsPage from './pages/TeamsPage'

// Code-split the heavy timeline route (canvas ruler + CPM + drag math).
const ProjectTimeline = lazy(() => import('./pages/ProjectTimeline'))

// Set VITE_DEMO_BANNER at build time (e.g. on a public demo host) to show a notice bar.
const DEMO_BANNER = import.meta.env.VITE_DEMO_BANNER || ''

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          {DEMO_BANNER && <div className="demo-banner" role="note">{DEMO_BANNER}</div>}
          <Routes>
            <Route path="/login"    element={<PublicOnly><LoginPage /></PublicOnly>} />
            <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<ProjectsDashboard />} />
              <Route path="/teams" element={<TeamsPage />} />
              <Route
                path="/projects/:projectId"
                element={
                  <Suspense fallback={<RouteFallback />}>
                    <ProjectTimeline />
                  </Suspense>
                }
              />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
