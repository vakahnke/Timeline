import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

const STATUS_LABELS = {
  todo:        'To do',
  in_progress: 'In progress',
  blocked:     'Blocked',
  done:        'Done',
}

function fmtDue(iso) {
  if (!iso) return null
  // due_date is a plain YYYY-MM-DD (no timezone) — parse as local to avoid off-by-one.
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function isOverdue(iso, status) {
  if (!iso || status === 'done') return false
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d) < today
}

export default function MyTasksPanel() {
  const navigate = useNavigate()
  const [tasks,   setTasks]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let cancelled = false
    api.auth.myTasks()
      .then(data => { if (!cancelled) setTasks(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading || error) return null  // stay quiet until we have something useful to show

  const open = tasks.filter(t => t.status !== 'done')

  return (
    <section className="mytasks">
      <div className="dash-titlebar">
        <h1>My tasks {open.length > 0 && <span className="mytasks-count">{open.length}</span>}</h1>
      </div>

      {tasks.length === 0 ? (
        <p className="dim">Nothing is assigned to you right now.</p>
      ) : (
        <div className="mytasks-list">
          {tasks.map(t => {
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
                <span className="mytask-ctx dim">{t.project.name} · {t.event.title}</span>
                <span className={`mytask-due${overdue ? ' mytask-due--overdue' : ''}`}>
                  {t.due_date ? fmtDue(t.due_date) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
