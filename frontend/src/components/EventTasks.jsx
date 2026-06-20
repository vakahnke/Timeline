import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useToast } from '../ui/ToastProvider'

const STATUS_OPTIONS = [
  { value: 'todo',        label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'blocked',     label: 'Blocked' },
  { value: 'done',        label: 'Done' },
]

const errMsg = (err, fallback) => {
  try { return Object.values(JSON.parse(err.body)).flat()[0] || fallback } catch { return fallback }
}

// People picker backed by a <datalist>: suggests project members but accepts any
// existing user's email/username (the API resolves it).
function PeopleInput({ value, onCommit, members, listId, placeholder, disabled }) {
  const [text, setText] = useState(value || '')
  useEffect(() => { setText(value || '') }, [value])
  const commit = () => { if (text.trim() !== (value || '')) onCommit(text.trim()) }
  return (
    <>
      <input
        className="task-people"
        list={listId}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } }}
      />
      <datalist id={listId}>
        {members.map(m => <option key={m.user.id} value={m.user.username}>{m.user.email}</option>)}
      </datalist>
    </>
  )
}

export default function EventTasks({ projectId, eventId, members, currentUser, readOnly }) {
  const { flash } = useToast()
  const [tasks,   setTasks]   = useState([])
  const [loading, setLoading] = useState(true)

  // New-task draft
  const [nTitle,    setNTitle]    = useState('')
  const [nOwner,    setNOwner]    = useState(currentUser?.username || '')
  const [nAssignee, setNAssignee] = useState('')
  const [nDue,      setNDue]      = useState('')
  const [adding,    setAdding]    = useState(false)

  useEffect(() => {
    let cancelled = false
    api.tasks.list(projectId, eventId)
      .then(data => { if (!cancelled) setTasks(data) })
      .catch(() => { if (!cancelled) flash('Could not load tasks.', 'error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, eventId, flash])

  const patchTask = useCallback(async (id, patch) => {
    try {
      const updated = await api.tasks.update(projectId, eventId, id, patch)
      setTasks(prev => prev.map(t => t.id === id ? updated : t))
    } catch (err) {
      flash(errMsg(err, 'Could not update task.'), 'error')
    }
  }, [projectId, eventId, flash])

  const addTask = useCallback(async () => {
    if (!nTitle.trim()) { flash('Task title is required.', 'error'); return }
    setAdding(true)
    try {
      const created = await api.tasks.create(projectId, eventId, {
        title: nTitle.trim(),
        owner_identifier:    nOwner.trim(),
        assignee_identifier: nAssignee.trim(),  // blank -> defaults to owner
        due_date: nDue || null,
      })
      setTasks(prev => [...prev, created])
      setNTitle(''); setNAssignee(''); setNDue('')
      setNOwner(currentUser?.username || '')
    } catch (err) {
      flash(errMsg(err, 'Could not add task.'), 'error')
    } finally {
      setAdding(false)
    }
  }, [projectId, eventId, nTitle, nOwner, nAssignee, nDue, currentUser, flash])

  const removeTask = useCallback(async (t) => {
    if (!confirm(`Delete task “${t.title}”?`)) return
    try {
      await api.tasks.remove(projectId, eventId, t.id)
      setTasks(prev => prev.filter(x => x.id !== t.id))
    } catch (err) {
      flash(errMsg(err, 'Could not delete task.'), 'error')
    }
  }, [projectId, eventId, flash])

  return (
    <div className="field">
      <label>Tasks {tasks.length > 0 && <span style={{ color: '#555' }}>({tasks.length})</span>}</label>

      {loading ? (
        <p className="dim" style={{ fontSize: 12 }}>Loading tasks…</p>
      ) : (
        <div className="task-list">
          {tasks.length === 0 && (
            <p className="dim" style={{ fontSize: 12, margin: '2px 0' }}>No tasks yet.</p>
          )}

          {tasks.map(t => (
            <div key={t.id} className={`task-row task-row--${t.status}`}>
              <input
                className="task-title"
                defaultValue={t.title}
                disabled={readOnly}
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== t.title) patchTask(t.id, { title: v }) }}
                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
              />
              <select
                className="task-status"
                value={t.status}
                disabled={readOnly}
                onChange={e => patchTask(t.id, { status: e.target.value })}
              >
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <PeopleInput
                value={t.assignee?.username}
                members={members}
                listId={`assignee-list-${t.id}`}
                placeholder="Assignee"
                disabled={readOnly}
                onCommit={v => patchTask(t.id, { assignee_identifier: v })}
              />
              <input
                className="task-due"
                type="date"
                value={t.due_date || ''}
                disabled={readOnly}
                onChange={e => patchTask(t.id, { due_date: e.target.value || null })}
              />
              {!readOnly && (
                <button type="button" className="task-del" title="Delete task" onClick={() => removeTask(t)}>&#10005;</button>
              )}
            </div>
          ))}

          {!readOnly && (
            <div className="task-row task-row--new">
              <input
                className="task-title"
                value={nTitle}
                placeholder="New task…"
                onChange={e => setNTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTask() } }}
              />
              <PeopleInput
                value={nOwner}
                members={members}
                listId="new-owner-list"
                placeholder="Owner"
                onCommit={setNOwner}
              />
              <PeopleInput
                value={nAssignee}
                members={members}
                listId="new-assignee-list"
                placeholder="Assignee (defaults to owner)"
                onCommit={setNAssignee}
              />
              <input
                className="task-due"
                type="date"
                value={nDue}
                onChange={e => setNDue(e.target.value)}
              />
              <button type="button" className="btn-primary btn-sm" onClick={addTask} disabled={adding}>
                {adding ? '…' : 'Add'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
