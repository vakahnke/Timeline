import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useToast } from '../ui/ToastProvider'

const STATUS_LABELS = {
  todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done',
}

function fmtDur(ms) {
  const h = Math.round(ms / 3_600_000)
  if (h <= 0) return '0h'
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24), rh = h % 24
  return rh ? `${d}d ${rh}h` : `${d}d`
}

function fmtDue(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const eventMs = (t) => {
  const s = t.event?.start, e = t.event?.end
  return s && e ? Math.max(0, new Date(e) - new Date(s)) : 0
}

// Project-scoped workload manager: see each member's load and reassign tasks to spread work.
export default function WorkloadModal({ projectId, projectName, members, canEdit, onClose }) {
  const { flash } = useToast()
  const [tasks,   setTasks]   = useState(null)
  const [error,   setError]   = useState(false)
  const [filter,  setFilter]  = useState('all')   // 'all' or an assignee user id
  const [busyId,  setBusyId]  = useState(null)

  useEffect(() => {
    let cancelled = false
    api.tasks.byProject(projectId)
      .then(d => { if (!cancelled) setTasks(d) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const reassign = useCallback(async (task, username) => {
    setBusyId(task.id)
    try {
      const updated = await api.tasks.update(projectId, task.event.id, task.id, { assignee_identifier: username })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, assignee: updated.assignee } : t))
      flash('Reassigned', 'saved')
    } catch (err) {
      let msg = 'Could not reassign.'
      try { msg = Object.values(JSON.parse(err.body)).flat()[0] || msg } catch { /* keep */ }
      flash(msg, 'error')
    } finally {
      setBusyId(null)
    }
  }, [projectId, flash])

  // Per-member stats over ALL project tasks, seeded with every member (so 0-load people show).
  const stats = {}
  for (const m of members) stats[m.user.id] = { id: m.user.id, username: m.user.username, count: 0, ms: 0 }
  for (const t of (tasks || [])) {
    const id = t.assignee?.id
    const s = stats[id] ?? (stats[id] = { id, username: t.assignee?.username || '—', count: 0, ms: 0 })
    s.count += 1
    s.ms += eventMs(t)
  }
  const rows = Object.values(stats).sort((a, b) => b.ms - a.ms || b.count - a.count)
  const total = tasks ? tasks.length : 0
  const maxMs = Math.max(1, ...rows.map(r => r.ms))

  const shown = (tasks || []).filter(t => filter === 'all' || t.assignee?.id === filter)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--wide">
        <div className="modal-head">
          <h2>Manage workloads — <span className="tm-event">{projectName}</span></h2>
          <button className="btn-close" onClick={onClose}>&#10005;</button>
        </div>

        <div className="modal-body">
          {error && <p className="field-error">&#10005; Could not load tasks.</p>}
          {!error && tasks === null && <p className="dim">Loading…</p>}

          {!error && tasks !== null && (
            <>
              <div className="workload">
                <div className="workload-head"><span>Workload by member</span><span className="dim">{total} tasks</span></div>
                {rows.map(r => {
                  const pct = total ? Math.round((r.count / total) * 100) : 0
                  return (
                    <button
                      type="button"
                      key={r.id}
                      className={`workload-row${filter === r.id ? ' is-active' : ''}`}
                      onClick={() => setFilter(filter === r.id ? 'all' : r.id)}
                      title="Click to show only this member’s tasks"
                    >
                      <span className="workload-name">{r.username}</span>
                      <span className="workload-bar"><span className="workload-bar-fill" style={{ width: `${Math.round((r.ms / maxMs) * 100)}%` }} /></span>
                      <span className="workload-stat">{r.count} · {fmtDur(r.ms)} · {pct}%</span>
                    </button>
                  )
                })}
              </div>

              <div className="wl-listhead">
                <span>{filter === 'all' ? 'All tasks' : `Tasks for ${rows.find(r => r.id === filter)?.username || ''}`} ({shown.length})</span>
                {filter !== 'all' && <button className="dep-toggle" onClick={() => setFilter('all')}>Show all</button>}
              </div>

              <div className="wl-tasks">
                {shown.length === 0 && <p className="dim" style={{ fontSize: 12 }}>No tasks.</p>}
                {shown.map(t => (
                  <div key={t.id} className="wl-task-row">
                    <span className={`task-status-badge task-status-badge--${t.status}`}>{STATUS_LABELS[t.status] || t.status}</span>
                    <span className="wl-task-title">{t.title}</span>
                    <span className="wl-task-ctx dim">{t.event.title} · {fmtDur(eventMs(t))}</span>
                    <span className="wl-task-due">{fmtDue(t.due_date)}</span>
                    <select
                      className="wl-task-assignee"
                      value={t.assignee?.username || ''}
                      disabled={!canEdit || busyId === t.id}
                      onChange={e => reassign(t, e.target.value)}
                    >
                      {/* current assignee may not be a current member; keep them selectable */}
                      {!members.some(m => m.user.username === t.assignee?.username) && t.assignee && (
                        <option value={t.assignee.username}>{t.assignee.username}</option>
                      )}
                      {members.map(m => <option key={m.user.id} value={m.user.username}>{m.user.username}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
