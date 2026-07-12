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

// One task card. The WHOLE card is draggable (grab anywhere), with a distance/delay activation
// so a plain click still opens the task. A "⋯ Move to…" menu is the touch/keyboard/explicit path.
export default function BoardCard({ task, canEdit, overlay = false, onOpen, onMove }) {
  const [menu, setMenu] = useState(false)
  const menuRef = useRef(null)
  const draggedRef = useRef(false)   // suppress the ghost click a drag emits on release
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `card:${task.id}`, disabled: !canEdit || overlay, data: { task },
  })

  useEffect(() => {
    if (isDragging) { draggedRef.current = true; return }
    if (draggedRef.current) { const id = setTimeout(() => { draggedRef.current = false }, 0); return () => clearTimeout(id) }
  }, [isDragging])

  useEffect(() => {
    if (!menu) return
    const onDown = (e) => { if (!menuRef.current?.contains(e.target)) setMenu(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const overdue = isOverdue(task.due_date, task.status)
  const draggable = canEdit && !overlay
  const cls = `board-card${draggable ? ' draggable' : ''}${task.status === 'done' ? ' is-done' : ''}` +
              `${isDragging ? ' is-dragging' : ''}${overlay ? ' overlay' : ''}`

  const handleClick = () => {
    if (draggedRef.current) { draggedRef.current = false; return }   // this click ended a drag
    onOpen?.(task)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cls}
      onClick={handleClick}
      {...(draggable ? { ...listeners, ...attributes } : {})}
    >
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

      {draggable && (
        <div className="board-card-move" ref={menuRef} onPointerDown={e => e.stopPropagation()}>
          <button type="button" className="board-move-btn" title="Move to…" aria-label="Move to…"
                  onClick={e => { e.stopPropagation(); setMenu(m => !m) }}>⋯</button>
          {menu && (
            <div className="board-move-menu" onClick={e => e.stopPropagation()}>
              {ALL_STATUSES.filter(s => s !== task.status).map(s => (
                <button key={s} type="button" onClick={e => { e.stopPropagation(); setMenu(false); onMove(task, s) }}>
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
