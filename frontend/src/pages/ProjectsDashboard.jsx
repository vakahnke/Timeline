import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../ui/ToastProvider'
import CreateProjectModal from '../components/CreateProjectModal'
import TemplateModal from '../components/TemplateModal'
import MembersPanel from '../components/MembersPanel'
import MyTasksPanel from '../components/MyTasksPanel'
import MovablePanel from '../components/MovablePanel'

function RoleBadge({ role }) {
  if (!role) return null
  return <span className={`role-badge role-badge--${role}`}>{role}</span>
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Default window positions: projects on top, my-tasks stacked below.
const DEFAULT_LAYOUTS = {
  projects: { x: 0, y: 0,   w: 1000, h: 480, zoom: 1 },
  tasks:    { x: 0, y: 504, w: 1000, h: 400, zoom: 1 },
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

  // The dashboard owns the panel layouts (so it can arrange them) and persists them.
  const canvasRef = useRef(null)
  const hadSaved  = useRef(!!localStorage.getItem('dash.layouts'))  // captured before the persist effect runs
  const [layouts, setLayouts] = useState(() => {
    try { const s = JSON.parse(localStorage.getItem('dash.layouts')); if (s?.projects && s?.tasks) return s } catch { /* ignore */ }
    return DEFAULT_LAYOUTS
  })
  useEffect(() => { localStorage.setItem('dash.layouts', JSON.stringify(layouts)) }, [layouts])

  // Default layouts (DEFAULT_LAYOUTS) horizontally centered for the current canvas width.
  const centeredDefaults = useCallback(() => {
    const avail = canvasRef.current?.clientWidth ?? 1280
    const cx = (w) => Math.max(0, Math.round((avail - w) / 2))
    return {
      projects: { ...DEFAULT_LAYOUTS.projects, x: cx(DEFAULT_LAYOUTS.projects.w) },
      tasks:    { ...DEFAULT_LAYOUTS.tasks,    x: cx(DEFAULT_LAYOUTS.tasks.w) },
    }
  }, [])

  // First visit (no saved layout): start the windows centered. They stay free to move anywhere.
  useEffect(() => {
    if (!hadSaved.current) setLayouts(centeredDefaults())
  }, [centeredDefaults])

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

  const setPanel = (key) => (l) => setLayouts(prev => ({ ...prev, [key]: l }))
  const resetLayout = () => { localStorage.removeItem('dash.layouts'); setLayouts(centeredDefaults()) }

  // Arrange both windows: 'side' = half-width next to each other; 'stack' = full-width stacked.
  const arrange = (mode) => {
    const avail = canvasRef.current?.clientWidth ?? 1280
    if (mode === 'side') {
      const gap = 16, w = Math.floor((avail - gap) / 2)
      setLayouts(prev => ({
        projects: { ...prev.projects, x: 0,       y: 0, w, h: Math.max(prev.projects.h, 460) },
        tasks:    { ...prev.tasks,    x: w + gap, y: 0, w, h: Math.max(prev.tasks.h, 460) },
      }))
    } else {
      setLayouts(prev => ({
        projects: { ...prev.projects, x: 0, y: 0, w: avail },
        tasks:    { ...prev.tasks,    x: 0, y: (prev.projects.h || 480) + 24, w: avail },
      }))
    }
  }

  const canvasMinH = Math.max(560, ...Object.values(layouts).map(l => l.y + l.h + 24))

  const projectsBody = (
    <>
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
    </>
  )

  return (
    <div className="dashboard scroll-page">
      <header className="dash-header">
        <div className="dash-brand">Timeline</div>
        <div className="dash-userbox">
          <button onClick={() => arrange('side')} title="Place the windows side by side">Side by side</button>
          <button onClick={() => arrange('stack')} title="Stack the windows">Stack</button>
          <button onClick={resetLayout} title="Reset window positions, sizes & zoom">Reset</button>
          <button onClick={() => navigate('/teams')}>Teams</button>
          <span className="dash-user">{user?.username}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <main className="dash-canvas" ref={canvasRef} style={{ minHeight: canvasMinH }}>
        <MovablePanel
          title="Your projects"
          layout={layouts.projects}
          onChange={setPanel('projects')}
          minHeight={220}
          actions={
            <>
              <button className="btn-template" onClick={() => setTemplating(true)}>From Template</button>
              <button className="btn-new" onClick={() => setCreating(true)}>+ New Project</button>
            </>
          }
        >
          {projectsBody}
        </MovablePanel>

        <MovablePanel
          title="My tasks"
          layout={layouts.tasks}
          onChange={setPanel('tasks')}
          minHeight={200}
        >
          <MyTasksPanel />
        </MovablePanel>
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
