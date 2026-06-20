import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth/AuthContext'

const STATUS_LABELS = {
  todo:        'To do',
  in_progress: 'In progress',
  blocked:     'Blocked',
  done:        'Done',
}

const SORTS = [
  { value: 'date',     label: 'Due date' },
  { value: 'project',  label: 'Project' },
  { value: 'both',     label: 'Project, then date' },
  { value: 'assignee', label: 'Assignee' },
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

function fmtDur(ms) {
  const h = Math.round(ms / 3_600_000)
  if (h <= 0) return '0h'
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24), rh = h % 24
  return rh ? `${d}d ${rh}h` : `${d}d`
}

function byDate(a, b) {
  if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
  if (a.due_date) return -1
  if (b.due_date) return 1
  return a.title.localeCompare(b.title)
}

const eventMs = (t) => {
  const s = t.event?.start, e = t.event?.end
  return s && e ? Math.max(0, new Date(e) - new Date(s)) : 0
}

export default function MyTasksPanel() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [tasks, setTasks] = useState(null)   // ALL tasks across my projects (any assignee)
  const [error, setError] = useState(false)
  const [sort,   setSort]   = useState(() => localStorage.getItem('dash.tasks.sort') || 'date')
  const [filter, setFilter] = useState(() => localStorage.getItem('dash.tasks.filter') || 'me')

  useEffect(() => {
    let cancelled = false
    api.auth.myTasks('all')
      .then(data => { if (!cancelled) setTasks(data) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => { localStorage.setItem('dash.tasks.sort', sort) }, [sort])
  useEffect(() => { localStorage.setItem('dash.tasks.filter', filter) }, [filter])

  if (error) return <p className="dim">Couldn’t load tasks.</p>
  if (tasks === null) return <p className="dim">Loading…</p>

  const isMine = t => user && t.assignee?.id === user.id

  // Per-member workload over the whole team (percentage of tasks + summed event duration).
  const total = tasks.length
  const byMember = {}
  for (const t of tasks) {
    const u = t.assignee?.username || '—'
    const m = (byMember[u] ??= { username: u, isMe: isMine(t), count: 0, ms: 0 })
    m.count += 1
    m.ms += eventMs(t)
  }
  const members = Object.values(byMember).sort((a, b) => b.count - a.count)

  // Filter the rows shown.
  const shown = filter === 'me'  ? tasks.filter(isMine)
              : filter === 'all' ? tasks
              : tasks.filter(t => t.assignee?.username === filter)

  const openCount = shown.filter(t => t.status !== 'done').length

  // Group/sort the shown rows.
  let groups
  if (sort === 'date') {
    groups = [{ name: null, items: [...shown].sort(byDate) }]
  } else {
    const key = sort === 'assignee' ? (t => t.assignee?.username || '—') : (t => t.project.name)
    const within = sort === 'project' ? ((a, b) => a.title.localeCompare(b.title)) : byDate
    const map = {}
    for (const t of shown) (map[key(t)] ??= []).push(t)
    groups = Object.keys(map).sort((a, b) => a.localeCompare(b)).map(name => ({ name, items: map[name].sort(within) }))
  }

  const showWho = filter !== 'me' && sort !== 'assignee'

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
          {sort === 'project' || sort === 'both' ? t.event.title : `${t.project.name} · ${t.event.title}`}
        </span>
        {showWho && <span className="mytask-who">{t.assignee?.username || '—'}</span>}
        <span className={`mytask-due${overdue ? ' mytask-due--overdue' : ''}`}>
          {t.due_date ? fmtDue(t.due_date) : '—'}
        </span>
      </div>
    )
  }

  return (
    <div className="mytasks">
      <div className="mytasks-toolbar">
        <span className="dim">{openCount} open · {shown.length} shown</span>
        <div className="mytasks-controls">
          <label className="mytasks-sort">
            Show:
            <select value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="me">Me</option>
              <option value="all">Everyone</option>
              {members.filter(m => !m.isMe).map(m => (
                <option key={m.username} value={m.username}>{m.username}</option>
              ))}
            </select>
          </label>
          <label className="mytasks-sort">
            Sort:
            <select value={sort} onChange={e => setSort(e.target.value)}>
              {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Workload breakdown: who holds the tasks, by % (count) and total duration. */}
      {filter !== 'me' && total > 0 && (
        <div className="workload" title="Share of tasks by count, and total duration of those tasks’ events">
          <div className="workload-head">Workload by member</div>
          {members.map(m => {
            const pct = Math.round((m.count / total) * 100)
            return (
              <button
                type="button"
                key={m.username}
                className={`workload-row${filter === m.username ? ' is-active' : ''}`}
                onClick={() => setFilter(filter === m.username ? 'all' : m.username)}
                title="Click to filter to this member"
              >
                <span className="workload-name">{m.username}{m.isMe ? ' (me)' : ''}</span>
                <span className="workload-bar"><span className="workload-bar-fill" style={{ width: `${pct}%` }} /></span>
                <span className="workload-stat">{pct}% · {m.count} · {fmtDur(m.ms)}</span>
              </button>
            )
          })}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="dim">{filter === 'me' ? 'Nothing is assigned to you right now.' : 'No tasks here.'}</p>
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
