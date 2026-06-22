import { useEffect, useState } from 'react'
import { api } from '../api'

// Read-only progress glance for the event modal. The full add/edit/delete UI lives in
// the docked EventTaskPanel, opened via the button (which closes this modal).
// `reloadToken` changes after the panel closes so the summary reflects edits.
export default function EventTasksSummary({ projectId, eventId, reloadToken, readOnly, onManage }) {
  const [tasks, setTasks] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.tasks.list(projectId, eventId)
      .then(d => { if (!cancelled) setTasks(d) })
      .catch(() => { if (!cancelled) setTasks([]) })
    return () => { cancelled = true }
  }, [projectId, eventId, reloadToken])

  const total   = tasks ? tasks.length : 0
  const done    = tasks ? tasks.filter(t => t.status === 'done').length : 0
  const blocked = tasks ? tasks.filter(t => t.status === 'blocked').length : 0
  const pct     = total ? Math.round((done / total) * 100) : 0

  return (
    <div className="field">
      <label>Tasks {total > 0 && <span style={{ color: '#555' }}>({total})</span>}</label>

      {total > 0 && (
        <div className="task-summary">
          <div className="task-progress" title={`${pct}% of tasks done`}>
            <div className="task-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="task-summary-text">
            {done}/{total} done · {pct}%
            {blocked > 0 && <span className="task-summary-blocked"> · {blocked} blocked</span>}
          </span>
        </div>
      )}

      {tasks === null && <p className="dim" style={{ fontSize: 12, margin: '2px 0' }}>Loading tasks…</p>}
      {tasks !== null && total === 0 && <p className="dim" style={{ fontSize: 12, margin: '2px 0' }}>No tasks yet.</p>}

      <button type="button" className="btn-manage-tasks" onClick={onManage}>
        {readOnly ? 'View tasks' : 'Manage tasks'}{total > 0 ? ` (${total})` : ''} →
      </button>
    </div>
  )
}
