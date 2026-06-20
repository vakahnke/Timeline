import { useEffect } from 'react'
import EventTasks from './EventTasks'

// A dedicated view for managing the tasks of a single event, opened from the event
// modal so the editor isn't crammed alongside the event's own fields.
export default function TaskManagerModal({ projectId, eventId, eventTitle, members, currentUser, readOnly = false, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--wide">
        <div className="modal-head">
          <h2>Tasks — <span className="tm-event">{eventTitle}</span></h2>
          <button className="btn-close" onClick={onClose}>&#10005;</button>
        </div>

        <div className="modal-body">
          <EventTasks
            projectId={projectId}
            eventId={eventId}
            members={members}
            currentUser={currentUser}
            readOnly={readOnly}
          />
        </div>

        <div className="modal-foot">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
