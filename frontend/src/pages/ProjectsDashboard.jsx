import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../ui/ToastProvider'
import CreateProjectModal from '../components/CreateProjectModal'

function RoleBadge({ role }) {
  if (!role) return null
  return <span className={`role-badge role-badge--${role}`}>{role}</span>
}

export default function ProjectsDashboard() {
  const { user, logout } = useAuth()
  const { flash } = useToast()
  const navigate = useNavigate()

  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setProjects(await api.projects.list())
      setError(null)
    } catch {
      setError('Could not load your projects.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = useCallback(async (data) => {
    const created = await api.projects.create(data)
    flash('Project created', 'saved')
    navigate(`/projects/${created.id}`)
  }, [flash, navigate])

  return (
    <div className="dashboard scroll-page">
      <header className="dash-header">
        <div className="dash-brand">Timeline</div>
        <div className="dash-userbox">
          <span className="dash-user">{user?.username}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-titlebar">
          <h1>Your projects</h1>
          <button className="btn-new" onClick={() => setCreating(true)}>+ New Project</button>
        </div>

        {loading && (
          <div className="project-grid">
            {[0, 1, 2].map(i => <div key={i} className="project-card skeleton" />)}
          </div>
        )}

        {!loading && error && (
          <div className="empty-state">
            <div className="icon">⚠</div>
            <p>{error}</p>
            <button onClick={load}>Retry</button>
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
          <div className="empty-state dash-empty">
            <div className="icon">&#9776;</div>
            <p>No projects yet.</p>
            <p className="dim">Create your first project to start planning.</p>
            <button className="btn-new" onClick={() => setCreating(true)}>+ New Project</button>
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="project-grid">
            {projects.map(p => (
              <button key={p.id} className="project-card" onClick={() => navigate(`/projects/${p.id}`)}>
                <div className="project-card-top">
                  <h3>{p.name}</h3>
                  <RoleBadge role={p.my_role} />
                </div>
                <p className="project-card-desc">{p.description || 'No description'}</p>
                <div className="project-card-foot">
                  <span>{p.member_count} member{p.member_count === 1 ? '' : 's'}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {creating && (
        <CreateProjectModal onCreate={handleCreate} onClose={() => setCreating(false)} />
      )}
    </div>
  )
}
