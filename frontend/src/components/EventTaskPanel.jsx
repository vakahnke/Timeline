import { useEffect, useCallback } from 'react'
import EventTasks from './EventTasks'

// A docked drawer pinned to the side of the timeline for managing one event's tasks.
// Non-modal: the timeline stays interactive, and clicking another event's badge just
// re-points this panel at that event. The actual editor is the shared <EventTasks>.
export default function EventTaskPanel({ projectId, event, members, currentUser, readOnly, onSummaryChange, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // EventTasks reports just the rollup; tag it with this event's id for the parent.
  const handleSummary = useCallback((s) => onSummaryChange?.(event.id, s), [event.id, onSummaryChange])

  const total = event?.task_count || 0
  const done  = event?.tasks_done || 0
  const pct   = total ? Math.round((done / total) * 100) : 0

  return (
    <aside className="task-panel" role="dialog" aria-label="Event tasks">
      <div className="task-panel-head">
        <div className="task-panel-title">
          <span className="task-panel-kicker">Tasks</span>
          <span className="task-panel-event" title={event?.title}>{event?.title || 'Event'}</span>
        </div>
        <button className="btn-close" onClick={onClose} title="Close (Esc)">&#10005;</button>
      </div>

      {total > 0 && (
        <div className="task-panel-progress">
          <div className="task-progress" title={`${pct}% of tasks done`}>
            <div className="task-progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="task-summary-text">{done}/{total} done · {pct}%</span>
        </div>
      )}

      <div className="task-panel-body">
        {/* key by event id so switching events resets the editor's new-task draft */}
        <EventTasks
          key={event.id}
          projectId={projectId}
          eventId={event.id}
          members={members}
          currentUser={currentUser}
          readOnly={readOnly}
          onSummaryChange={handleSummary}
        />
      </div>
    </aside>
  )
}
