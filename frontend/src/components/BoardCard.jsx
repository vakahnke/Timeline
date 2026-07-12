import { useState, useEffect, useRef } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'

const STATUS_LABELS = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' }
const ALL_STATUSES = ['todo', 'in_progress', 'blocked', 'done']

function fmtDue(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
function isOverdue(iso, status) {
  if (!iso || status === 'done') return false
  const t = new Date(); t.setHours(0, 0, 0, 0)
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d) < t
}

// One task card. A dedicated grip handle carries the drag listeners (clean click-vs-drag,
// touch-friendly); the body opens the task; a "⋯" menu is the explicit/touch move path.
export default function BoardCard({ task, canEdit, overlay = false, onOpen, onMove }) {
  const [menu, setMenu] = useState(false)
  const menuRef = useRef(null)
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `card:${task.id}`, disabled: !canEdit || overlay, data: { task },
  })

  useEffect(() => {
    if (!menu) return
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const overdue = isOverdue(task.due_date, task.status)
  const cls = `board-card${task.status === 'done' ? ' is-done' : ''}${isDragging ? ' is-dragging' : ''}${overlay ? ' overlay' : ''}`

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} className={cls}>
      {canEdit && !overlay && (
        <button className="board-card-grip" {...listeners} {...attributes} title="Drag to move" aria-label="Drag task">⠿</button>
      )}

      <div className="board-card-main" onClick={() => onOpen?.(task)} role="button" tabIndex={0}
           onKeyDown={e => { if (e.key === 'Enter') onOpen?.(task) }}>
        <div className="board-card-title">{task.title}</div>
        <div className="board-card-meta">
          <span className="board-card-event" title={task.event?.title}>{task.event?.title}</span>
          {task.due_date && (
            <span className={`board-card-due${overdue ? ' overdue' : ''}`}>
              {overdue ? 'Overdue · ' : ''}{fmtDue(task.due_date)}
            </span>
          )}
        </div>
        <div className="board-card-foot">
          <span className="board-card-who">{task.assignee?.username || 'Unassigned'}</span>
        </div>
      </div>

      {canEdit && !overlay && (
        <div className="board-card-move" ref={menuRef}>
          <button type="button" className="board-move-btn" title="Move to…" aria-label="Move to…"
                  onClick={() => setMenu(m => !m)}>⋯</button>
          {menu && (
            <div className="board-move-menu">
              {ALL_STATUSES.filter(s => s !== task.status).map(s => (
                <button key={s} type="button" onClick={() => { setMenu(false); onMove(task, s) }}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
