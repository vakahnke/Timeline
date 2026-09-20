import { useEffect, useState } from 'react'
import { api } from '../api'

// Closing out a run: how the plan worked, what it cost, what to change. Every answer is optional.
// The wording rates the plan, never the people. See docs/design/template-closeout.md.

const OUTCOMES = [
  { id: 'worked',              label: 'It worked',               hint: 'We would run this plan again as it is.' },
  { id: 'worked_with_changes', label: 'It worked, with changes', hint: 'We got there, but had to bend the plan.' },
  { id: 'did_not_work',        label: 'It did not work',         hint: 'The plan was wrong for this.' },
  { id: 'stopped',             label: 'We stopped early',        hint: 'Cancelled or set aside, whatever the reason.' },
]
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'INR', 'BRL', 'MXN']

// Members who are not owners see the answers but cannot change them (the server decides too).
// `intro` replaces the opening line (used right after saving the project as a template).
export default function CloseoutModal({ project, canEdit = true, intro = null, onSaved, onRemoved, onClose }) {
  const fromTemplate = !!project.source_template_key
  const template = project.source_template     // { key, name (null if no longer visible), has_owner }
  const [loading,  setLoading]  = useState(true)
  const [existing, setExisting] = useState(false)
  const [outcome,  setOutcome]  = useState('')
  const [amount,   setAmount]   = useState('')
  const [currency, setCurrency] = useState('USD')
  const [effort,   setEffort]   = useState('')
  const [lesson,   setLesson]   = useState('')
  const [share,    setShare]    = useState(true)
  const [toOwner,  setToOwner]  = useState(true)
  const [asComment, setAsComment] = useState(false)
  const [posted,   setPosted]   = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    let cancelled = false
    api.projects.closeout.get(project.id).then(c => {
      if (cancelled) return
      if (c) {
        setExisting(true)
        setOutcome(c.outcome || '')
        setAmount(c.cost_amount == null ? '' : String(Number(c.cost_amount)))
        setCurrency(c.cost_currency || 'USD')
        setEffort(c.effort_person_days == null ? '' : String(Number(c.effort_person_days)))
        setLesson(c.lesson || '')
        setShare(c.share_figures !== false)
        setToOwner(c.lesson_to_owner !== false)
        setPosted(!!c.posted_as_comment)
      }
    }).catch(() => { if (!cancelled) setError('Could not load the close-out.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project.id])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const number = text => (text.trim() === '' ? null : Number(text.replace(/,/g, '')))

  const save = async () => {
    setError('')
    const cost = number(amount), days = number(effort)
    if ((cost !== null && !(cost >= 0)) || (days !== null && !(days >= 0))) {
      setError('Cost and effort must be plain numbers, zero or more.'); return
    }
    setBusy(true)
    try {
      await api.projects.closeout.save(project.id, {
        outcome, cost_amount: cost, cost_currency: cost === null ? '' : currency,
        effort_person_days: days, lesson: lesson.trim(), share_figures: share,
        lesson_to_owner: toOwner, post_as_comment: asComment && !posted,
      })
      onSaved()
    } catch (err) {
      let msg = 'Could not save the close-out.'
      try { msg = Object.values(JSON.parse(err.body)).flat()[0] || msg } catch { /* keep */ }
      setError(msg); setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm('Remove this close-out? The project goes back to being open.')) return
    setBusy(true)
    try { await api.projects.closeout.remove(project.id); onRemoved() }
    catch { setError('Could not remove the close-out.'); setBusy(false) }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide closeout">
        <div className="modal-head">
          <h2>{canEdit ? `Close out ${project.name}` : `Close-out of ${project.name}`}</h2>
          <button className="btn-close" onClick={onClose} aria-label="Close">&#10005;</button>
        </div>

        <div className="modal-body">
          {loading ? <p className="dim">Loading…</p> : (
            <>
              <p className="dim closeout-intro">
                {!canEdit ? null : intro ? `${intro} ` : ''}
                {canEdit ? 'Three questions about the plan, all optional. You can change the answers later.'
                         : 'What this project\'s owner said about the run. Only an owner can change it.'}
              </p>

              <fieldset className="closeout-set" disabled={!canEdit}>
                <legend>How did the plan work?</legend>
                {OUTCOMES.map(o => (
                  <label key={o.id} className="closeout-choice">
                    <input type="radio" name="closeout-outcome" checked={outcome === o.id} onChange={() => setOutcome(o.id)} />
                    <span><strong>{o.label}</strong><span className="dim"> · {o.hint}</span></span>
                  </label>
                ))}
                {outcome && canEdit && <button type="button" className="link-btn" onClick={() => setOutcome('')}>Clear my answer</button>}
              </fieldset>

              <fieldset className="closeout-set" disabled={!canEdit}>
                <legend>What did it cost?</legend>
                <div className="closeout-cost">
                  <div className="field">
                    <label htmlFor="co-amount">Money</label>
                    <div className="closeout-money">
                      <input id="co-amount" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 14000" />
                      <select id="co-currency" aria-label="Currency" value={currency} onChange={e => setCurrency(e.target.value)}>
                        {[...new Set([currency, ...CURRENCIES])].map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="co-effort">Effort <span className="label-hint">(person-days)</span></label>
                    <input id="co-effort" inputMode="decimal" value={effort} onChange={e => setEffort(e.target.value)} placeholder="e.g. 45" />
                  </div>
                </div>
                <p className="dim closeout-note">Either, both or neither. A rough figure is better than none.</p>
                {fromTemplate && (
                  <label className="check-row">
                    <input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} />
                    <span>Include my numbers in the template's totals
                      <span className="label-hint"> · used only in a middle figure across at least three runs, rounded, never with this project's name. Untick to keep them on this project only.</span></span>
                  </label>
                )}
              </fieldset>

              <div className="field">
                <label htmlFor="co-lesson">What would you change next time?</label>
                <textarea id="co-lesson" readOnly={!canEdit} value={lesson} onChange={e => setLesson(e.target.value)} maxLength={500}
                          placeholder="One or two sentences." />
              </div>
              {/* Outside .field on purpose: its label and input styles are for text boxes. */}
              <div className="closeout-lesson-opts">
                {canEdit && template?.has_owner && (
                  <label className="check-row">
                    <input type="checkbox" checked={toOwner} onChange={e => setToOwner(e.target.checked)} />
                    <span>Send this to the template's owner
                      <span className="label-hint"> · so the plan can be improved. They see the text and the date, not which project it came from. Untick to keep it with this project.</span></span>
                  </label>
                )}
                {canEdit && template?.name && (posted
                  ? <p className="dim closeout-note">Posted as a comment on “{template.name}”.</p>
                  : (
                    <label className="check-row">
                      <input type="checkbox" checked={asComment} onChange={e => setAsComment(e.target.checked)} />
                      <span>Also post it as a comment on “{template.name}”
                        <span className="label-hint"> · under your username, where everyone who can see the template can read it.</span></span>
                    </label>
                  ))}
                {canEdit && !template?.has_owner && <p className="dim closeout-note">Kept with this project.</p>}
              </div>
            </>
          )}
          {error && <div className="field-error">&#10005; {error}</div>}
        </div>

        <div className="modal-foot">
          {existing && canEdit && <button className="btn-danger closeout-remove" onClick={remove} disabled={busy}>Remove</button>}
          <button onClick={onClose} disabled={busy}>{canEdit ? 'Cancel' : 'Close'}</button>
          {canEdit && (
            <button className="btn-primary" onClick={save} disabled={busy || loading}>
              {busy ? 'Saving…' : existing ? 'Save changes' : 'Close it out'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
