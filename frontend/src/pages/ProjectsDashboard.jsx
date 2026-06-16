import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../ui/ToastProvider'
import CreateProjectModal from '../components/CreateProjectModal'
import TemplateModal from '../components/TemplateModal'
import MembersPanel from '../components/MembersPanel'

function RoleBadge({ role }) {
  if (!role) return null
  return <span className={`role-badge role-badge--${role}`}>{role}</span>
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ProjectsDashboard() {
  const { user, logout } = useAuth()
  const { flash } = useToast()
  const navigate = useNavigate()

  const [projects,   setProjects]   = useState([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [creating,   setCreating]   = useState(false)
  const [editing,    setEditing]    = useState(null)
  const [sharing,    setSharing]    = useState(null)
  const [templating, setTemplating] = useState(false)

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

  const handleUpdate = useCallback(async (data) => {
    const updated = await api.projects.update(editing.id, data)
    setProjects(prev => prev.map(p => p.id === editing.id ? updated : p))
    setEditing(null)
    flash('Project updated', 'saved')
  }, [editing, flash])

  const handleDelete = useCallback(async (p) => {
    if (!confirm(`Delete project “${p.name}”? This permanently removes its timeline and all events.`)) return
    try {
      await api.projects.remove(p.id)
      setProjects(prev => prev.filter(x => x.id !== p.id))
      flash('Project deleted', 'saved')
    } catch {
      flash('Could not delete project.', 'error')
    }
  }, [flash])

  const handleFromTemplate = useCallback((project) => {
    flash('Project created from template', 'saved')
    navigate(`/projects/${project.id}`)
  }, [flash, navigate])

  const open = (id) => navigate(`/projects/${id}`)

  return (
    <div className="dashboard scroll-page">
      <header className="dash-header">
        <div className="dash-brand">Timeline</div>
        <div className="dash-userbox">
          <button onClick={() => navigate('/teams')}>Teams</button>
          <span className="dash-user">{user?.username}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-titlebar">
          <h1>Your projects</h1>
          <div className="dash-actions">
            <button className="btn-template" onClick={() => setTemplating(true)}>From Template</button>
            <button className="btn-new" onClick={() => setCreating(true)}>+ New Project</button>
          </div>
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
            <div className="dash-actions">
              <button className="btn-template" onClick={() => setTemplating(true)}>From Template</button>
              <button className="btn-new" onClick={() => setCreating(true)}>+ New Project</button>
            </div>
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="project-grid">
            {projects.map(p => {
              const canEdit = p.my_role === 'owner' || p.my_role === 'editor'
              const isOwner = p.my_role === 'owner'
              return (
                <div
                  key={p.id}
                  className="project-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => open(p.id)}
                  onKeyDown={e => { if (e.key === 'Enter') open(p.id) }}
                >
                  <div className="project-card-top">
                    <h3>{p.name}</h3>
                    <RoleBadge role={p.my_role} />
                  </div>
                  <p className="project-card-desc">{p.description || 'No description'}</p>

                  {p.start ? (
                    <div className="project-card-dates">
                      {fmtDate(p.start)} <span className="arrow">→</span> {fmtDate(p.end)}
                    </div>
                  ) : (
                    <div className="project-card-dates dim">No scheduled tasks yet</div>
                  )}

                  <div className="project-progress" title={`${p.progress}% complete`}>
                    <div className="project-progress-bar" style={{ width: `${p.progress}%` }} />
                  </div>

                  <div className="project-card-foot">
                    <span>{p.event_count} event{p.event_count === 1 ? '' : 's'} · {p.member_count} member{p.member_count === 1 ? '' : 's'} · {p.progress}%</span>
                    <div className="project-card-actions" onClick={e => e.stopPropagation()}>
                      {isOwner && (
                        <button className="card-action" title="Manage access — add people & teams" onClick={() => setSharing(p)}>&#128101;</button>
                      )}
                      {canEdit && (
                        <button className="card-action" title="Edit project" onClick={() => setEditing(p)}>&#9998;</button>
                      )}
                      {isOwner && (
                        <button className="card-action card-action--danger" title="Delete project" onClick={() => handleDelete(p)}>&#10005;</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {creating && (
        <CreateProjectModal onSubmit={handleCreate} onClose={() => setCreating(false)} />
      )}
      {editing && (
        <CreateProjectModal project={editing} onSubmit={handleUpdate} onClose={() => setEditing(null)} />
      )}
      {sharing && (
        <MembersPanel projectId={sharing.id} isOwner onClose={() => { setSharing(null); load() }} />
      )}
      {templating && (
        <TemplateModal onCreated={handleFromTemplate} onClose={() => setTemplating(false)} />
      )}
    </div>
  )
}
