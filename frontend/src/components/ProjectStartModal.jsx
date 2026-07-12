import { useState, useEffect } from 'react'

const DAY_MS = 86_400_000

// ms -> 'YYYY-MM-DD' in local time, for the <input type="date"> value.
function toDateInput(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
// Whole days between the current start's calendar day and the chosen date (local, DST-safe).
function daysBetween(fromMs, dateStr) {
  const from = new Date(fromMs); from.setHours(0, 0, 0, 0)
  const to   = new Date(dateStr + 'T00:00:00')
  return Math.round((to.getTime() - from.getTime()) / DAY_MS)
}

// Reschedule the whole project: pick a new start date and every event (and its task due
// dates) shifts by the same number of whole days. One undoable step, handled by the parent.
export default function ProjectStartModal({ currentStart, currentEnd, eventCount, onApply, onClose }) {
  const [date,   setDate]   = useState(() => toDateInput(currentStart))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const days   = daysBetween(currentStart, date)
  const newEnd = currentEnd + days * DAY_MS

  const apply = async () => {
    if (!days) return
    setSaving(true)
    try { await onApply(days) }
    catch { setSaving(false) }   // parent surfaces the error toast; leave the modal open
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div className="modal modal-sm">
        <div className="modal-head">
          <h2>Change start date</h2>
          <button className="btn-close" onClick={onClose} disabled={saving}>&#10005;</button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>New start date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} autoFocus />
          </div>

          <p className="reschedule-summary">
            {days === 0 ? (
              'Pick a different date to shift the project.'
            ) : (
              <>
                Shifts all <b>{eventCount}</b> event{eventCount === 1 ? '' : 's'} and their task due dates{' '}
                <b>{days > 0 ? `${days} day${days === 1 ? '' : 's'} later` : `${-days} day${days === -1 ? '' : 's'} earlier`}</b>.
                <br />New finish: <b>{fmtDate(newEnd)}</b>.
              </>
            )}
          </p>
        </div>

        <div className="modal-foot">
          <button onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={apply} disabled={saving || days === 0}>
            {saving ? 'Rescheduling…' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
