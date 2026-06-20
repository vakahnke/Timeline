import { useState, useEffect, useCallback } from 'react'
import EventTasksSummary from './EventTasksSummary'
import { useUndoableForm } from '../hooks/useUndoableForm'

function fmtDateTime(dateStr) {
  const d = new Date(dateStr)
  const day  = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${day} ${time}`
}

function fmtTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

function toLocalISO(dateStr) {
  const d   = new Date(dateStr)
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d - off).toISOString().slice(0, 16)
}

export default function EventModal({ eventId, defaults, events, tracks, projectId, readOnly = false, escDisabled = false, tasksReloadToken, onManageTasks, onSave, onDelete, onClose }) {
  const existing = eventId ? events.find(e => e.id === eventId) : null

  // Editable fields live in one undoable object so Ctrl+Z / the modal's ↶ ↷ can revert
  // edits (including predecessor toggles) before you save.
  const { value: form, set: setForm, reset: resetForm, undo, redo, canUndo, canRedo } = useUndoableForm({
    title: '', start: '', end: '', track: '', notes: '', pct: 0, dependsOn: [],
  })
  const { title, start, end, track, notes, pct, dependsOn } = form

  const [showAllDeps, setShowAllDeps] = useState(false)
  const [error,     setError]     = useState('')
  const [saving,    setSaving]    = useState(false)

  // Field setters. `coalesce` keeps a run of edits to one field as a single undo step.
  const setField = useCallback((key, value, opts) =>
    setForm(f => ({ ...f, [key]: value }), opts), [setForm])

  useEffect(() => {
    let init
    if (existing) {
      init = {
        title: existing.title,
        start: toLocalISO(existing.start),
        end:   toLocalISO(existing.end),
        track: existing.category,
        notes: existing.notes || '',
        pct:   existing.percent_complete ?? 0,
        dependsOn: existing.depends_on ?? [],
      }
    } else {
      const now = new Date()
      init = {
        title: '',
        start: defaults?.start ?? toLocalISO(now),
        end:   defaults?.end ?? toLocalISO(new Date(now.getTime() + 3_600_000)),
        track: defaults?.category ?? tracks[0]?.name ?? '',
        notes: '', pct: 0, dependsOn: [],
      }
    }
    resetForm(init)             // also clears undo/redo history for the new event
    setShowAllDeps(false)       // collapse back to just the selected predecessors
    setError('')
  }, [eventId])

  const handleSave = useCallback(async () => {
    setError('')
    if (!title.trim())  { setError('Title is required.'); return }
    if (!start || !end) { setError('Start and end are required.'); return }
    if (new Date(end) <= new Date(start)) { setError('End must be after start.'); return }

    setSaving(true)
    try {
      await onSave({
        title:      title.trim(),
        start:      new Date(start).toISOString(),
        end:        new Date(end).toISOString(),
        category:   track.trim() || 'Default',
        notes:            notes.trim(),
        percent_complete: Math.min(100, Math.max(0, Number(pct))),
        depends_on:       dependsOn,
      })
    } catch (err) {
      setError('Save failed: ' + err.message)
      setSaving(false)
    }
  }, [form, onSave])

  const handleDelete = useCallback(async () => {
    const ev = events.find(e => e.id === eventId)
    if (!ev || !confirm(`Delete "${ev.title}"?`)) return
    setSaving(true)
    try { await onDelete() }
    catch (err) { setError('Delete failed: ' + err.message); setSaving(false) }
  }, [eventId, events, onDelete])

  // Keyboard shortcut
  useEffect(() => {
    const onKey = (e) => {
      if (escDisabled) return  // a task-manager modal is layered on top; let it handle keys
      if (e.key === 'Escape') { onClose(); return }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { handleSave(); return }
      if (readOnly || !(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      // Take over Ctrl/⌘+Z to undo the whole form edit, not just text in one field.
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (k === 'z' || k === 'y') { e.preventDefault(); redo() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, handleSave, escDisabled, readOnly, undo, redo])

  const candidateDeps = events.filter(e => e.id !== eventId)
  const selectedDeps  = candidateDeps.filter(e => dependsOn.includes(e.id))
  const shownDeps     = showAllDeps ? candidateDeps : selectedDeps

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{readOnly ? 'Event' : existing ? 'Edit Event' : 'New Event'}</h2>
          <div className="modal-head-actions">
            {!readOnly && (
              <>
                <button type="button" className="btn-icon" onClick={undo} disabled={!canUndo} title="Undo  ·  Ctrl/⌘ + Z">↶</button>
                <button type="button" className="btn-icon" onClick={redo} disabled={!canRedo} title="Redo  ·  Ctrl/⌘ + Shift + Z">↷</button>
              </>
            )}
            <button className="btn-close" onClick={onClose}>&#10005;</button>
          </div>
        </div>

        <fieldset className="modal-body" disabled={readOnly}>
          <div className="field">
            <label>Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setField('title', e.target.value, { field: 'title', coalesce: true })}
              placeholder="Event title"
              autoFocus={!readOnly}
            />
          </div>

          <div className="fields-row">
            <div className="field">
              <label>Start</label>
              <input type="datetime-local" value={start} onChange={e => setField('start', e.target.value, { field: 'start', coalesce: true })} />
            </div>
            <div className="field">
              <label>End</label>
              <input type="datetime-local" value={end} onChange={e => setField('end', e.target.value, { field: 'end', coalesce: true })} />
            </div>
          </div>

          <div className="field">
            <label>Category</label>
            <select value={track} onChange={e => setField('track', e.target.value)}>
              {tracks.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </div>


          {candidateDeps.length > 0 && (
            <div className="field">
              <label>
                Depends on <span style={{ color: '#555' }}>(predecessors)</span>
                {selectedDeps.length > 0 && <span style={{ color: '#555' }}> · {selectedDeps.length} selected</span>}
              </label>
              {shownDeps.length > 0 && (
                <div className="depends-list">
                  {shownDeps.map(e => (
                    <label key={e.id} className="depends-item">
                      <input
                        type="checkbox"
                        checked={dependsOn.includes(e.id)}
                        onChange={ev => {
                          const checked = ev.target.checked
                          setForm(f => ({
                            ...f,
                            dependsOn: checked ? [...f.dependsOn, e.id] : f.dependsOn.filter(id => id !== e.id),
                          }))  // discrete: each toggle is its own undo step
                        }}
                      />
                      <span className="dep-swatch" style={{ background: e.color || '#4a88ff' }} />
                      <span className="dep-title">{e.title}</span>
                      <span className="dep-time">{fmtDateTime(e.start)} – {fmtTime(e.end)}</span>
                    </label>
                  ))}
                </div>
              )}
              {!showAllDeps && selectedDeps.length === 0 && (
                <p className="dim" style={{ fontSize: 12, margin: '2px 0' }}>No predecessors selected.</p>
              )}
              {!readOnly && (
                <button type="button" className="dep-toggle" onClick={() => setShowAllDeps(v => !v)}>
                  {showAllDeps
                    ? '▲ Show selected only'
                    : `▾ Add predecessor (${candidateDeps.length - selectedDeps.length} available)`}
                </button>
              )}
            </div>
          )}

          <div className="field">
            <label>% Complete</label>
            <div className="pct-row">
              <input
                type="range"
                min="0" max="100" step="5"
                value={pct}
                onChange={e => setField('pct', Number(e.target.value), { field: 'pct', coalesce: true })}
              />
              <span className="pct-value">{pct}%</span>
            </div>
          </div>

          <div className="field">
            <label>Notes</label>
            <textarea value={notes} onChange={e => setField('notes', e.target.value, { field: 'notes', coalesce: true })} placeholder="Optional notes…" />
          </div>

          {existing ? (
            <EventTasksSummary
              projectId={projectId}
              eventId={eventId}
              reloadToken={tasksReloadToken}
              readOnly={readOnly}
              onManage={() => onManageTasks?.(eventId)}
            />
          ) : !readOnly && (
            <div className="field">
              <label>Tasks</label>
              <p className="dim" style={{ fontSize: 12, margin: '2px 0' }}>
                Save the event first, then reopen it to add tasks.
              </p>
            </div>
          )}

          {error && <div className="field-error">&#10005; {error}</div>}
        </fieldset>

        <div className="modal-foot">
          {readOnly ? (
            <button className="btn-primary" onClick={onClose}>Close</button>
          ) : (
            <>
              {onDelete && (
                <button className="btn-danger" onClick={handleDelete} disabled={saving}>Delete</button>
              )}
              <button onClick={onClose} disabled={saving}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
