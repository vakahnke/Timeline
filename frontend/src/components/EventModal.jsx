import { useState, useEffect, useCallback } from 'react'
import EventTasksSummary from './EventTasksSummary'
import EventComments from './EventComments'
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

// Duration <-> milliseconds. The event still stores start/end; duration is just a
// friendlier way to enter one of them without hand-calculating a future date.
const UNIT_MS = { hours: 3_600_000, days: 86_400_000, weeks: 604_800_000 }
const round2  = (n) => Math.round(n * 100) / 100
const msFromDur = (val, unit) => Math.max(0, Number(val) || 0) * UNIT_MS[unit]
// Pick the friendliest whole unit for an existing span (weeks > days > fractional hours).
function durFromMs(ms) {
  if (ms > 0 && ms % UNIT_MS.weeks === 0) return { val: ms / UNIT_MS.weeks, unit: 'weeks' }
  if (ms > 0 && ms % UNIT_MS.days  === 0) return { val: ms / UNIT_MS.days,  unit: 'days'  }
  return { val: round2(ms / UNIT_MS.hours), unit: 'hours' }
}

export default function EventModal({ eventId, defaults, events, tracks, projectId, readOnly = false, escDisabled = false, canComment = false, isOwner = false, tasksReloadToken, onManageTasks, onSave, onDelete, onClose }) {
  const existing = eventId ? events.find(e => e.id === eventId) : null

  // Editable fields live in one undoable object so Ctrl+Z / the modal's ↶ ↷ can revert
  // edits (including predecessor toggles) before you save.
  const { value: form, set: setForm, reset: resetForm, undo, redo, canUndo, canRedo } = useUndoableForm({
    title: '', start: '', end: '', track: '', notes: '', pct: 0, milestone: false, dependsOn: [], successors: [],
    durVal: 1, durUnit: 'hours',
  })
  const { title, start, end, track, notes, pct, milestone, dependsOn, successors, durVal, durUnit } = form

  const [showAllDeps,  setShowAllDeps]  = useState(false)
  const [showAllSuccs, setShowAllSuccs] = useState(false)
  const [error,     setError]     = useState('')
  const [saving,    setSaving]    = useState(false)
  // Which endpoint stays put when the duration changes ('start' = duration grows the end).
  const [anchor,    setAnchor]    = useState('start')

  // Field setters. `coalesce` keeps a run of edits to one field as a single undo step.
  const setField = useCallback((key, value, opts) =>
    setForm(f => ({ ...f, [key]: value }), opts), [setForm])

  // Start / End / Duration are linked: editing one recomputes exactly one other, so the
  // user never hand-calculates a date. See the "pinned endpoint" model above the file.
  const applyStart = (v) => {                    // move the block, keep its length → end shifts
    setAnchor('start')
    setForm(f => {
      if (!v) return { ...f, start: v }
      return { ...f, start: v, end: toLocalISO(new Date(v).getTime() + msFromDur(f.durVal, f.durUnit)) }
    }, { field: 'start', coalesce: true })
  }
  const applyEnd = (v) => {                       // you set the finish line → duration recomputes
    setAnchor('end')
    setForm(f => {
      if (!v || !f.start) return { ...f, end: v }
      const ms = Math.max(0, new Date(v).getTime() - new Date(f.start).getTime())
      return { ...f, end: v, durVal: round2(ms / UNIT_MS[f.durUnit]) }
    }, { field: 'end', coalesce: true })
  }
  const applyDurVal = (v) => {                     // grow from the pinned endpoint
    setForm(f => {
      const ms = msFromDur(v, f.durUnit)
      if (anchor === 'end' && f.end)  return { ...f, durVal: v, start: toLocalISO(new Date(f.end).getTime() - ms) }
      if (f.start)                    return { ...f, durVal: v, end:   toLocalISO(new Date(f.start).getTime() + ms) }
      return { ...f, durVal: v }
    }, { field: 'dur', coalesce: true })
  }
  const applyDurUnit = (u) => {                    // relabel the same span; dates don't move
    setForm(f => ({ ...f, durUnit: u, durVal: round2(msFromDur(f.durVal, f.durUnit) / UNIT_MS[u]) }))
  }
  const flipAnchor = () => setAnchor(a => (a === 'start' ? 'end' : 'start'))

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
        milestone: !!existing.is_milestone,
        dependsOn: existing.depends_on ?? [],
        // Successors are the inverse link: every event that lists THIS one as a predecessor.
        successors: events.filter(e => (e.depends_on ?? []).includes(existing.id)).map(e => e.id),
      }
    } else {
      const now = new Date()
      init = {
        title: '',
        start: defaults?.start ?? toLocalISO(now),
        end:   defaults?.end ?? toLocalISO(new Date(now.getTime() + 3_600_000)),
        track: defaults?.category ?? tracks[0]?.name ?? '',
        notes: '', pct: 0, milestone: false, dependsOn: [], successors: [],
      }
    }
    // Seed the duration fields from the loaded span so the number/unit match start→end.
    const spanMs = new Date(init.end).getTime() - new Date(init.start).getTime()
    const dur = durFromMs(spanMs)
    init.durVal = dur.val; init.durUnit = dur.unit
    resetForm(init)             // also clears undo/redo history for the new event
    setShowAllDeps(false)       // collapse back to just the selected predecessors
    setShowAllSuccs(false)
    setAnchor('start')
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
        is_milestone:     !!milestone,
        depends_on:       dependsOn,
        // Not a field on this event — the parent reconciles it by editing each successor's
        // depends_on after this event is saved (a new event has no id until then).
        _successors:      successors,
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

  // An event can't be both a predecessor and a successor of this one (that's a 2-cycle),
  // so each picker hides what the other already claimed.
  const candidateDeps  = events.filter(e => e.id !== eventId && !successors.includes(e.id))
  const selectedDeps   = events.filter(e => dependsOn.includes(e.id))
  const shownDeps      = showAllDeps ? candidateDeps : selectedDeps

  const candidateSuccs = events.filter(e => e.id !== eventId && !dependsOn.includes(e.id))
  const selectedSuccs  = events.filter(e => successors.includes(e.id))
  const shownSuccs     = showAllSuccs ? candidateSuccs : selectedSuccs

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
              <input type="datetime-local" value={start} onChange={e => applyStart(e.target.value)} />
            </div>
            <div className="field">
              <label>End</label>
              <input type="datetime-local" value={end} onChange={e => applyEnd(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Duration</label>
            <div className="dur-row">
              <input
                className="dur-val"
                type="number" min="0"
                step={durUnit === 'hours' ? '0.25' : '0.5'}
                value={durVal}
                onChange={e => applyDurVal(e.target.value)}
              />
              <select className="dur-unit" value={durUnit} onChange={e => applyDurUnit(e.target.value)}>
                <option value="hours">hours</option>
                <option value="days">days</option>
                <option value="weeks">weeks</option>
              </select>
              {!readOnly && (
                <button
                  type="button"
                  className="dur-anchor"
                  onClick={flipAnchor}
                  title="Which endpoint stays put when you change the duration. Click to flip."
                >
                  ⇄ moves the {anchor === 'start' ? 'End' : 'Start'}
                </button>
              )}
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

          {(candidateSuccs.length > 0 || selectedSuccs.length > 0) && (
            <div className="field">
              <label>
                Leads to <span style={{ color: '#555' }}>(successors)</span>
                {selectedSuccs.length > 0 && <span style={{ color: '#555' }}> · {selectedSuccs.length} selected</span>}
              </label>
              {shownSuccs.length > 0 && (
                <div className="depends-list">
                  {shownSuccs.map(e => (
                    <label key={e.id} className="depends-item">
                      <input
                        type="checkbox"
                        checked={successors.includes(e.id)}
                        onChange={ev => {
                          const checked = ev.target.checked
                          setForm(f => ({
                            ...f,
                            successors: checked ? [...f.successors, e.id] : f.successors.filter(id => id !== e.id),
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
              {!showAllSuccs && selectedSuccs.length === 0 && (
                <p className="dim" style={{ fontSize: 12, margin: '2px 0' }}>No successors selected.</p>
              )}
              {!readOnly && (
                <button type="button" className="dep-toggle" onClick={() => setShowAllSuccs(v => !v)}>
                  {showAllSuccs
                    ? '▲ Show selected only'
                    : `▾ Add successor (${candidateSuccs.length - selectedSuccs.length} available)`}
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

          <label className="milestone-row" title="Key milestones are drawn as diamonds and listed on the status report">
            <input type="checkbox" checked={!!milestone} onChange={e => setField('milestone', e.target.checked, { field: 'milestone' })} />
            <span>Key milestone <em>· a date leadership tracks; shown on the status report</em></span>
          </label>

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

        {/* Comments live OUTSIDE the disabled fieldset so Commenters (read-only on the event
            fields) can still post. Only for saved events. */}
        {existing && (
          <div className="modal-comments">
            <EventComments
              projectId={projectId}
              eventId={eventId}
              canComment={canComment}
              isOwner={isOwner}
            />
          </div>
        )}

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
