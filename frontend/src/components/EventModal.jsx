import { useState, useEffect, useCallback } from 'react'
import EventTasksSummary from './EventTasksSummary'

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

  const [title,     setTitle]     = useState('')
  const [start,     setStart]     = useState('')
  const [end,       setEnd]       = useState('')
  const [track,     setTrack]     = useState('')
  const [notes,     setNotes]     = useState('')
  const [pct,       setPct]       = useState(0)
  const [dependsOn, setDependsOn] = useState([])
  const [showAllDeps, setShowAllDeps] = useState(false)
  const [error,     setError]     = useState('')
  const [saving,    setSaving]    = useState(false)

  useEffect(() => {
    if (existing) {
      setTitle(existing.title)
      setStart(toLocalISO(existing.start))
      setEnd(toLocalISO(existing.end))
      setTrack(existing.category)
      setNotes(existing.notes || '')
      setPct(existing.percent_complete ?? 0)
      setDependsOn(existing.depends_on ?? [])
    } else {
      const now = new Date()
      setTitle('')
      setStart(defaults?.start ?? toLocalISO(now))
      setEnd(defaults?.end ?? toLocalISO(new Date(now.getTime() + 3_600_000)))
      setTrack(defaults?.category ?? tracks[0]?.name ?? '')
      setNotes('')
      setPct(0)
      setDependsOn([])
    }
    setShowAllDeps(false)  // collapse back to just the selected predecessors
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
  }, [title, start, end, track, notes, pct, dependsOn, onSave])

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
      if (e.key === 'Escape') onClose()
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSave()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, handleSave, escDisabled])

  const candidateDeps = events.filter(e => e.id !== eventId)
  const selectedDeps  = candidateDeps.filter(e => dependsOn.includes(e.id))
  const shownDeps     = showAllDeps ? candidateDeps : selectedDeps

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{readOnly ? 'Event' : existing ? 'Edit Event' : 'New Event'}</h2>
          <button className="btn-close" onClick={onClose}>&#10005;</button>
        </div>

        <fieldset className="modal-body" disabled={readOnly}>
          <div className="field">
            <label>Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Event title"
              autoFocus={!readOnly}
            />
          </div>

          <div className="fields-row">
            <div className="field">
              <label>Start</label>
              <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label>End</label>
              <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Category</label>
            <select value={track} onChange={e => setTrack(e.target.value)}>
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
                          if (ev.target.checked) setDependsOn(p => [...p, e.id])
                          else setDependsOn(p => p.filter(id => id !== e.id))
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
                onChange={e => setPct(Number(e.target.value))}
              />
              <span className="pct-value">{pct}%</span>
            </div>
          </div>

          <div className="field">
            <label>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
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
