import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, useDroppable, closestCorners,
} from '@dnd-kit/core'
import { api } from '../api'
import { useToast } from '../ui/ToastProvider'
import BoardCard from './BoardCard'

const COLUMNS = [
  { status: 'todo',        label: 'To do' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'blocked',     label: 'Blocked' },
  { status: 'done',        label: 'Done' },
]
const STATUSES = new Set(COLUMNS.map(c => c.status))

const dueMs = (iso) => {
  if (!iso) return Infinity
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}
const isOverdue = (t) => {
  if (!t.due_date || t.status === 'done') return false
  const x = new Date(); x.setHours(0, 0, 0, 0)
  return dueMs(t.due_date) < x.getTime()
}
// Within a column: due date ascending (undated last), then event start, then id.
function cardSort(a, b) {
  const da = dueMs(a.due_date), db = dueMs(b.due_date)
  if (da !== db) return da - db
  const ea = a.event?.start ? new Date(a.event.start).getTime() : 0
  const eb = b.event?.start ? new Date(b.event.start).getTime() : 0
  if (ea !== eb) return ea - eb
  return (a.id || 0) - (b.id || 0)
}

function Column({ status, label, tasks, canEdit, onOpen, onMove }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div className={`board-col board-col--${status}${isOver ? ' is-over' : ''}`}>
      <div className="board-col-head">
        <span className="board-col-title">{label}</span>
        <span className="board-col-count">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className="board-col-body">
        {tasks.length === 0
          ? <div className="board-col-empty">{canEdit ? 'Drop tasks here' : 'Nothing here'}</div>
          : tasks.map(t => (
              <BoardCard key={t.id} task={t} canEdit={canEdit} onOpen={onOpen} onMove={onMove} />
            ))}
      </div>
    </div>
  )
}

export default function Board({ projectId, canEdit, reloadToken, onOpenTasks, onChanged }) {
  const { flash } = useToast()
  const [tasks,    setTasks]    = useState(null)
  const [error,    setError]    = useState(false)
  const [assignee, setAssignee] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [activeTask, setActiveTask]   = useState(null)

  const load = useCallback(() => {
    api.tasks.byProject(projectId)
      .then(d => { setTasks(d); setError(false) })
      .catch(() => setError(true))
  }, [projectId])
  useEffect(() => { load() }, [load, reloadToken])   // background refresh; keeps existing cards visible

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const moveTask = useCallback(async (task, newStatus) => {
    if (!canEdit || task.status === newStatus) return
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: newStatus } : t))   // optimistic
    try {
      await api.tasks.update(projectId, task.event.id, task.id, { status: newStatus })
      onChanged?.()
    } catch {
      setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: task.status } : t))  // rollback
      flash('Could not move task.', 'error')
    }
  }, [projectId, canEdit, onChanged, flash])

  const assignees = useMemo(() => {
    const s = new Set()
    for (const t of tasks || []) if (t.assignee) s.add(t.assignee.username)
    return [...s].sort()
  }, [tasks])

  const byStatus = useMemo(() => {
    let list = tasks || []
    if (assignee === 'unassigned') list = list.filter(t => !t.assignee)
    else if (assignee !== 'all')   list = list.filter(t => t.assignee?.username === assignee)
    if (overdueOnly) list = list.filter(isOverdue)
    const m = { todo: [], in_progress: [], blocked: [], done: [] }
    for (const t of list) (m[t.status] || (m[t.status] = [])).push(t)
    for (const k of Object.keys(m)) m[k].sort(cardSort)
    return m
  }, [tasks, assignee, overdueOnly])

  const onDragEnd = ({ active, over }) => {
    setActiveTask(null)
    if (!over) return
    const task = active.data.current?.task
    if (task && STATUSES.has(over.id) && over.id !== task.status) moveTask(task, over.id)
  }

  if (error) return <div className="board"><p className="dim board-msg">Couldn’t load the board.</p></div>
  if (tasks === null) return <div className="board"><p className="dim board-msg">Loading board…</p></div>

  const empty = tasks.length === 0

  return (
    <div className="board">
      <div className="board-toolbar">
        <label className="board-filter">Assignee
          <select value={assignee} onChange={e => setAssignee(e.target.value)}>
            <option value="all">Everyone</option>
            <option value="unassigned">Unassigned</option>
            {assignees.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="board-filter board-overdue">
          <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} />
          Overdue only
        </label>
        {!canEdit && <span className="ro-badge" title="You have view-only access">View only</span>}
      </div>

      {empty ? (
        <p className="dim board-msg">No tasks yet. Add tasks to events in the Timeline or List view — they’ll show up here.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={({ active }) => setActiveTask(active.data.current?.task || null)}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveTask(null)}
        >
          <div className="board-cols">
            {COLUMNS.map(c => (
              <Column
                key={c.status}
                status={c.status}
                label={c.label}
                tasks={byStatus[c.status] || []}
                canEdit={canEdit}
                onOpen={t => onOpenTasks?.(t.event.id)}
                onMove={moveTask}
              />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? <BoardCard task={activeTask} canEdit={false} overlay onOpen={() => {}} onMove={() => {}} /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  )
}
