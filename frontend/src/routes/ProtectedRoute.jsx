import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function RouteFallback() {
  return (
    <div className="route-fallback">
      <div className="spinner" />
    </div>
  )
}

export function ProtectedRoute() {
  const { user, bootstrapping } = useAuth()
  const location = useLocation()
  if (bootstrapping) return <RouteFallback />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

export function PublicOnly({ children }) {
  const { user, bootstrapping } = useAuth()
  if (bootstrapping) return <RouteFallback />
  if (user) return <Navigate to="/" replace />
  return children
}

export function NotFound() {
  return (
    <div className="centered-page">
      <div className="message-card">
        <h1>404</h1>
        <p>That page doesn’t exist.</p>
        <a className="btn-link" href="/">Back to projects</a>
      </div>
    </div>
  )
}
