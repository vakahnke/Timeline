import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useToast } from '../ui/ToastProvider'

// Save a file the API returned. Works for any authenticated download.
function saveBlob({ blob, filename }, fallback) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href; a.download = filename || fallback
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

// Take this project's dates somewhere else: a calendar (.ics) or another scheduling tool
// (Microsoft Project XML). Both are read-only exports, open to every member.
export default function ExportModal({ projectId, events, onClose }) {
  const { flash } = useToast()
  const [only, setOnly] = useState('all')
  const [busy, setBusy] = useState('')
  const milestones = useMemo(() => events.filter(e => e.is_milestone).length, [events])
  const zone = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  const run = async (kind, call, fallback, done) => {
    setBusy(kind)
    try { saveBlob(await call(), fallback); flash(done, 'saved') }
    catch { flash('Could not build the file.', 'error') }
    finally { setBusy('') }
  }
  const count = only === 'milestones' ? milestones : events.length

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal modal-sm export-modal" role="dialog" aria-label="Export">
        <div className="modal-head">
          <h2>Export</h2>
          <button className="btn-close" onClick={onClose} disabled={!!busy} aria-label="Close">&#10005;</button>
        </div>
        <div className="modal-body">
          <section className="export-block">
            <h3>Calendar (.ics)</h3>
            <p>For Outlook, Google Calendar and Apple Calendar. Every entry keeps the same ID, so importing a newer file later should update entries rather than add copies. Phases show as free time, so nobody looks busy for six weeks.</p>
            <div className="export-choice" role="radiogroup" aria-label="What to include">
              <label><input type="radio" name="ics-only" checked={only === 'all'} onChange={() => setOnly('all')} /> Every event <small>{events.length}</small></label>
              <label><input type="radio" name="ics-only" checked={only === 'milestones'} onChange={() => setOnly('milestones')} disabled={!milestones} /> Key milestones only <small>{milestones}</small></label>
            </div>
            <button className="btn-primary" disabled={!!busy || !count}
                    onClick={() => run('ics', () => api.projects.exportCalendar(projectId, only), 'project.ics', 'Calendar file downloaded')}>
              {busy === 'ics' ? 'Building…' : 'Download calendar'}
            </button>
          </section>

          <section className="export-block">
            <h3>Microsoft Project (.xml)</h3>
            <p>Opens in Microsoft Project (File ▸ Open, file type XML), ProjectLibre, GanttProject, Smartsheet and others. Tracks become summary tasks, events become tasks, and dependencies become links. Tasks are set to manual scheduling so your dates open unchanged. Dates are written in your time zone, {zone}.</p>
            <p className="export-note">Not included: members and task owners, colours, comments. To-do items travel in each task’s notes.</p>
            <button className="btn-primary" disabled={!!busy || !events.length}
                    onClick={() => run('xml', () => api.projects.exportMsProject(projectId, zone), 'project-msproject.xml', 'Microsoft Project file downloaded')}>
              {busy === 'xml' ? 'Building…' : 'Download Microsoft Project XML'}
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
