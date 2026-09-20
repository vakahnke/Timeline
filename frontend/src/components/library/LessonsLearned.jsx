import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api'
import { useToast } from '../../ui/ToastProvider'
import { OUTCOME_LABEL, monthText, suspectIn } from './libraryModel'
import '../../library.css'       // the start-from-template dialog also opens from the dashboard

// "Lessons learned" on a template: its owner's notes first, then what each run learned, newest
// first, in its writer's words. See docs/design/template-closeout.md, section 8.

const NOTE_MAX = 300
const BRIEF_RUNS = 5          // how many run lessons the start-from-template dialog shows

function RunLesson({ row, actions }) {
  return (
    <li>
      <div className="lib-comment-head">
        <strong>{row.author || 'Anonymous'}</strong>
        {row.outcome && <span className={`lib-outcome lib-outcome--${row.outcome}`}>{OUTCOME_LABEL[row.outcome]}</span>}
        <span className="dim">{monthText(row.month)}</span>
        {actions && <span className="lib-comment-actions">{actions}</span>}
      </div>
      <p>{row.text}</p>
    </li>
  )
}

// Read-only, for the moment someone is about to start a project from the plan.
export function LessonsLearnedBrief({ templateKey, data }) {
  if (!data || (data.notes.length === 0 && data.runs.length === 0)) return null
  const more = data.total - Math.min(data.total, BRIEF_RUNS)
  return (
    <div className="lessons-brief">
      <p className="lessons-brief-title">Before you start: what earlier runs learned</p>
      <ul className="lib-comments">
        {data.notes.map(n => (
          <li key={`n${n.id}`}>
            <div className="lib-comment-head"><span className="lib-outcome">From the plan's owner</span></div>
            <p>{n.text}</p>
          </li>
        ))}
        {data.runs.slice(0, BRIEF_RUNS).map(row => <RunLesson key={row.id} row={row} />)}
      </ul>
      {more > 0 && (
        <p className="dim lib-note">
          <Link to={`/templates/${encodeURIComponent(templateKey)}`}>{more} more on the template's page</Link>
        </p>
      )}
    </div>
  )
}

function NoteEditor({ initial = '', busy, saveLabel, onSave, onCancel }) {
  const [text, setText] = useState(initial)
  const flag = suspectIn(text)
  return (
    <form className="lib-comment-form" onSubmit={e => { e.preventDefault(); if (text.trim()) onSave(text.trim()) }}>
      <label htmlFor="lib-note-text" className="sr-only">Your note</label>
      <textarea id="lib-note-text" value={text} onChange={e => setText(e.target.value)} maxLength={NOTE_MAX}
                placeholder="What should someone know before running this plan? One or two sentences." />
      {flag && <p className="lib-flag">This looks like it contains {flag}. Everyone who can see the template will read it.</p>}
      <div className="lib-note-editor-foot">
        <button className="btn-primary" disabled={busy || !text.trim()}>{busy ? 'Saving…' : saveLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>}
        <span className="dim">{text.length}/{NOTE_MAX}</span>
      </div>
    </form>
  )
}

export default function LessonsLearned({ templateKey, data, onChange }) {
  const { flash } = useToast()
  const [editing, setEditing] = useState(null)      // a note id, or 'new'
  const [busy,    setBusy]    = useState(false)

  const run = async (work, failed) => {
    setBusy(true)
    try { onChange(await work()); setEditing(null) }
    catch (err) {
      let msg = failed
      try { msg = Object.values(JSON.parse(err.body)).flat()[0] || msg } catch { /* keep */ }
      flash(msg, 'error')
    } finally { setBusy(false) }
  }
  const takeDown = row => {
    if (!confirm('Take this lesson down from the template? Its writer keeps it on their project. This cannot be undone from here.')) return
    run(() => api.templates.removeLesson(templateKey, row.id), 'Could not take the lesson down.')
  }
  const report = async row => {
    try { await api.templates.report(templateKey, { lesson: row.id }); flash('Reported to the admins', 'saved') }
    catch { flash('Could not send the report.', 'error') }
  }
  const removeNote = n => {
    if (!confirm('Delete this note?')) return
    run(() => api.templates.removeNote(templateKey, n.id), 'Could not delete the note.')
  }

  const { notes, runs, can_add_notes: canAdd, can_remove: canRemove } = data
  const empty = notes.length === 0 && runs.length === 0

  return (
    <section className="lib-section">
      <h2>Lessons learned {runs.length > 0 && <span className="dim">· {runs.length} from runs</span>}</h2>
      {empty && (
        <p className="dim">Nothing yet. When someone closes out a project started from this plan, what they learned
          appears here: what went wrong, what they had to change, when not to use it.</p>
      )}
      <ul className="lib-comments">
        {notes.map((n, i) => (
          <li key={`n${n.id}`}>
            <div className="lib-comment-head">
              <span className="lib-outcome">From the plan's owner</span>
              {canAdd && editing !== n.id && (
                <span className="lib-comment-actions">
                  {i > 0 && <button className="link-btn" disabled={busy} onClick={() => run(() => api.templates.updateNote(templateKey, n.id, { position: i - 1 }), 'Could not move the note.')}>Move up</button>}
                  <button className="link-btn" disabled={busy} onClick={() => setEditing(n.id)}>Edit</button>
                  <button className="link-btn" disabled={busy} onClick={() => removeNote(n)}>Delete</button>
                </span>
              )}
            </div>
            {editing === n.id
              ? <NoteEditor initial={n.text} busy={busy} saveLabel="Save note" onCancel={() => setEditing(null)}
                            onSave={text => run(() => api.templates.updateNote(templateKey, n.id, { text }), 'Could not save the note.')} />
              : <p>{n.text}</p>}
          </li>
        ))}
        {runs.map(row => (
          <RunLesson key={row.id} row={row} actions={(canRemove || !row.is_mine) && (
            <>
              {canRemove && <button className="link-btn" disabled={busy} onClick={() => takeDown(row)}>Take down</button>}
              {!row.is_mine && !canRemove && <button className="link-btn" onClick={() => report(row)}>Report</button>}
            </>
          )} />
        ))}
      </ul>
      {canAdd && editing === 'new' && (
        <NoteEditor busy={busy} saveLabel="Add note" onCancel={() => setEditing(null)}
                    onSave={text => run(() => api.templates.addNote(templateKey, { text }), 'Could not add the note.')} />
      )}
      {canAdd && editing === null && notes.length < 7 && (
        <button onClick={() => setEditing('new')}>Add a note of your own</button>
      )}
      {!empty && (
        <p className="dim lib-note">
          From people who closed out a project started from this plan, in their own words.
          {canRemove && ' You can take a lesson down, not reword it; add a note of your own instead.'}
        </p>
      )}
    </section>
  )
}
