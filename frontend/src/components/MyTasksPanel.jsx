import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

const STATUS_LABELS = {
  todo:        'To do',
  in_progress: 'In progress',
  blocked:     'Blocked',
  done:        'Done',
}

const SORTS = [
  { value: 'date',    label: 'Due date' },
  { value: 'project', label: 'Project' },
  { value: 'both',    label: 'Project, then date' },
]

function fmtDue(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function isOverdue(iso, status) {
  if (!iso || status === 'done') return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d) < today
}

// Due date ascending, undated last, then title.
function byDate(a, b) {
  if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
  if (a.due_date) return -1
  if (b.due_date) return 1
  return a.title.localeCompare(b.title)
}

export default function MyTasksPanel() {
  const navigate = useNavigate()
  const [tasks,   setTasks]   = useState(null)
  const [error,   setError]   = useState(false)
  const [sort,    setSort]    = useState(() => localStorage.getItem('dash.tasks.sort') || 'date')

  useEffect(() => {
    let cancelled = false
    api.auth.myTasks()
      .then(data => { if (!cancelled) setTasks(data) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { localStorage.setItem('dash.tasks.sort', sort) }, [sort])

  if (error) return <p className="dim">Couldn’t load your tasks.</p>
  if (tasks === null) return <p className="dim">Loading…</p>

  const open = tasks.filter(t => t.status !== 'done').length

  // Build either a flat list (date) or project-grouped sections (project / both).
  let groups
  if (sort === 'date') {
    groups = [{ name: null, items: [...tasks].sort(byDate) }]
  } else {
    const byProject = {}
    for (const t of tasks) (byProject[t.project.name] ??= []).push(t)
    groups = Object.keys(byProject).sort((a, b) => a.localeCompare(b)).map(name => ({
      name,
      items: byProject[name].sort(sort === 'both' ? byDate : (a, b) => a.title.localeCompare(b.title)),
    }))
  }

  const Row = (t) => {
    const overdue = isOverdue(t.due_date, t.status)
    return (
      <div
        key={t.id}
        className="mytask-row"
        role="button"
        tabIndex={0}
        onClick={() => navigate(`/projects/${t.project.id}`)}
        onKeyDown={e => { if (e.key === 'Enter') navigate(`/projects/${t.project.id}`) }}
      >
        <span className={`task-status-badge task-status-badge--${t.status}`}>
          {STATUS_LABELS[t.status] || t.status}
        </span>
        <span className="mytask-title">{t.title}</span>
        <span className="mytask-ctx dim">
          {sort === 'date' ? `${t.project.name} · ${t.event.title}` : t.event.title}
        </span>
        <span className={`mytask-due${overdue ? ' mytask-due--overdue' : ''}`}>
          {t.due_date ? fmtDue(t.due_date) : '—'}
        </span>
      </div>
    )
  }

  return (
    <div className="mytasks">
      <div className="mytasks-toolbar">
        <span className="dim">{open} open · {tasks.length} total</span>
        <label className="mytasks-sort">
          Sort:
          <select value={sort} onChange={e => setSort(e.target.value)}>
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {tasks.length === 0 ? (
        <p className="dim">Nothing is assigned to you right now.</p>
      ) : (
        groups.map(g => (
          <div key={g.name ?? '_'} className="mytask-group">
            {g.name && <div className="mytask-group-head">{g.name} <span className="dim">({g.items.length})</span></div>}
            <div className="mytasks-list">{g.items.map(Row)}</div>
          </div>
        ))
      )}
    </div>
  )
}
