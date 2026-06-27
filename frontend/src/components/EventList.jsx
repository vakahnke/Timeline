import { useState, useEffect, useMemo, useCallback } from 'react'
import { api } from '../api'
import { useToast } from '../ui/ToastProvider'

// A flat, chronological list of every event with its tasks underneath — the mobile-
// friendly alternative to the pan/zoom timeline. Tasks load in ONE request
// (api.tasks.byProject) and are grouped client-side, so there's no per-event fetch.

const STATUS_GLYPH = { todo: '○', in_progress: '◐', blocked: '⚠', done: '✓' }
const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' }

function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}
function fmtSpan(s, e) {
  const sameDay = new Date(s).toDateString() === new Date(e).toDateString()
  return sameDay ? `${fmtTime(s)} – ${fmtTime(e)}` : `${fmtTime(s)} → ${new Date(e).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${fmtTime(e)}`
}
function dayKey(ms) { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
function fmtDayHeader(ms) {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtDue(d) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function fmtNow(ms) {
  const d = new Date(ms)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' +
         d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function EventList({ projectId, events, tracks, canEdit, reloadToken, onOpenEdit, onOpenTasks, onOpenNew }) {
  const { flash } = useToast()
  const [tasksByEvent, setTasksByEvent] = useState({})
  const [loading, setLoading] = useState(true)
  const [nowTs, setNowTs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTs(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const colorOf = useMemo(() => {
    const map = Object.fromEntries((tracks || []).map(t => [t.name, t.color]))
    return (ev) => map[ev.category] || ev.color || '#818cf8'
  }, [tracks])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.tasks.byProject(projectId)
      .then(list => {
        if (cancelled) return
        const map = {}
        for (const t of list) (map[t.event.id] ||= []).push(t)
        setTasksByEvent(map)
      })
      .catch(() => { if (!cancelled) flash('Could not load tasks.', 'error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, reloadToken, flash])

  const ordered = useMemo(
    () => [...events].sort((a, b) => new Date(a.start) - new Date(b.start)),
    [events],
  )

  // Tap the status glyph to toggle done <-> todo, with an optimistic update.
  const toggleDone = useCallback(async (eventId, task) => {
    if (!canEdit) return
    const next = task.status === 'done' ? 'todo' : 'done'
    setTasksByEvent(prev => ({
      ...prev,
      [eventId]: prev[eventId].map(t => t.id === task.id ? { ...t, status: next } : t),
    }))
    try {
      await api.tasks.update(projectId, eventId, task.id, { status: next })
    } catch {
      flash('Could not update task.', 'error')
      setTasksByEvent(prev => ({
        ...prev,
        [eventId]: prev[eventId].map(t => t.id === task.id ? { ...t, status: task.status } : t),
      }))
    }
  }, [projectId, canEdit, flash])

  if (!loading && ordered.length === 0) {
    return (
      <div className="event-list event-list--empty">
        <p className="dim">No events yet.</p>
        {canEdit && <button className="btn-primary" onClick={() => onOpenNew?.()}>+ New Event</button>}
      </div>
    )
  }

  const nowIndex = ordered.findIndex(ev => new Date(ev.start).getTime() >= nowTs)
  let lastDay = null
  return (
    <div className="event-list">
      {ordered.map((ev, i) => {
        const tasks = tasksByEvent[ev.id] || []
        const done = tasks.filter(t => t.status === 'done').length
        const k = dayKey(ev.start)
        const showHeader = k !== lastDay
        lastDay = k
        return (
          <div key={ev.id}>
            {i === nowIndex && <div className="el-now"><span className="el-now-label">Now · {fmtNow(nowTs)}</span></div>}
            {showHeader && <div className="el-day">{fmtDayHeader(ev.start)}</div>}
            <div className="el-event" style={{ borderLeftColor: colorOf(ev) }}>
              <div className="el-event-head" onClick={() => onOpenEdit?.(ev.id)}>
                <div className="el-event-main">
                  <span className="el-event-title">{ev.title}</span>
                  <span className="el-event-time">{fmtSpan(ev.start, ev.end)}</span>
                </div>
                <div className="el-event-meta">
                  {ev.category && <span className="el-cat" style={{ color: colorOf(ev) }}>{ev.category}</span>}
                  {tasks.length > 0 && <span className="el-count">{done}/{tasks.length} done</span>}
                </div>
              </div>

              <div className="el-tasks">
                {tasks.map(t => (
                  <div key={t.id} className={`el-task el-task--${t.status}`}>
                    <button
                      className="el-task-check"
                      title={canEdit ? `${STATUS_LABEL[t.status]} — tap to toggle done` : STATUS_LABEL[t.status]}
                      disabled={!canEdit}
                      onClick={() => toggleDone(ev.id, t)}
                    >{STATUS_GLYPH[t.status] || '○'}</button>
                    <span className="el-task-title" onClick={() => onOpenTasks?.(ev.id)}>{t.title}</span>
                    {t.assignee && <span className="el-task-who">{t.assignee.username}</span>}
                    {t.due_date && <span className="el-task-due">{fmtDue(t.due_date)}</span>}
                  </div>
                ))}

                <button className="el-tasks-manage" onClick={() => onOpenTasks?.(ev.id)}>
                  {tasks.length === 0
                    ? (canEdit ? '+ Add a task' : 'No tasks')
                    : (canEdit ? 'Manage tasks →' : 'View tasks →')}
                </button>
              </div>
            </div>
          </div>
        )
      })}
      {nowIndex === -1 && <div className="el-now"><span className="el-now-label">Now · {fmtNow(nowTs)}</span></div>}
    </div>
  )
}
