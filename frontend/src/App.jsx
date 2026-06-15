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

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
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
