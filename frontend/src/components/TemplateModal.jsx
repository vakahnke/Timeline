import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../auth/AuthContext'

function defaultStart() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  const off = d.getTimezoneOffset() * 60000
  return new Date(d - off).toISOString().slice(0, 16)
}

export default function TemplateModal({ onCreated, onClose }) {
  const { user } = useAuth()
  const [templates, setTemplates] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [selected,  setSelected]  = useState(null)   // template key
  const [name,      setName]      = useState('')
  const [start,     setStart]     = useState(defaultStart())
  const [owner,     setOwner]     = useState('')
  const [error,     setError]     = useState('')
  const [busy,      setBusy]      = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const items = await api.templates.list()
      setTemplates(items)
      if (items.length && !selected) {
        setSelected(items[0].key)
        setName(items[0].name)
      }
    } catch {
      setError('Could not load templates.')
    } finally {
      setLoading(false)
    }
  }, [selected])

  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (t) => { setSelected(t.key); setName(t.name) }

  const isBuiltin = (t) => t.source === 'builtin'
  // Saved templates: anyone can delete their own. Built-ins are shared/global, so only
  // admins can retire them — and doing so removes them for everyone.
  const canDelete = (t) => (t.source === 'saved') || (isBuiltin(t) && user?.is_staff)

  const deleteTemplate = async (t, e) => {
    e.stopPropagation()
    const msg = isBuiltin(t)
      ? `Delete the built-in template "${t.name}" for everyone? An admin can restore it later.`
      : `Delete template "${t.name}"?`
    if (!confirm(msg)) return
    // Built-ins are addressed by slug (from the "builtin:<slug>" key); saved ones by id.
    const idOrSlug = isBuiltin(t) ? t.key.split(':')[1] : t.id
    try {
      await api.templates.remove(idOrSlug)
      setTemplates(prev => prev.filter(x => x.key !== t.key))
      if (selected === t.key) setSelected(null)
    } catch { setError('Could not delete template.') }
  }

  const create = useCallback(async () => {
    setError('')
    if (!selected) { setError('Pick a template.'); return }
    if (!start)    { setError('Choose a start date.'); return }
    setBusy(true)
    try {
      const project = await api.templates.instantiate({
        key: selected,
        name: name.trim() || undefined,
        start: new Date(start).toISOString(),
        owner: owner.trim() || undefined,
      })
      onCreated(project)
    } catch (err) {
      let msg = 'Could not create the project.'
      try { msg = Object.values(JSON.parse(err.body)).flat()[0] || msg } catch { /* keep */ }
      setError(msg)
      setBusy(false)
    }
  }, [selected, name, start, owner, onCreated])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide">
        <div className="modal-head">
          <h2>New Project from Template</h2>
          <button className="btn-close" onClick={onClose}>&#10005;</button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>Template</label>
            {loading ? (
              <p className="dim">Loading templates…</p>
            ) : (
              <div className="template-list">
                {templates.map(t => (
                  <div
                    key={t.key}
                    className={`template-item${selected === t.key ? ' selected' : ''}`}
                    onClick={() => pick(t)}
                  >
                    <div className="template-item-main">
                      <div className="template-item-top">
                        <span className="template-name">{t.name}</span>
                        <span className={`template-src template-src--${t.source}`}>{t.source}</span>
                      </div>
                      <p className="template-desc">{t.description}</p>
                      <span className="template-meta">{t.task_count} tasks · {t.category_count} categories</span>
                    </div>
                    {canDelete(t) && (
                      <button className="template-del"
                              title={isBuiltin(t) ? 'Delete built-in template (admin · removes it for everyone)' : 'Delete template'}
                              onClick={e => deleteTemplate(t, e)}>&#10005;</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="fields-row">
            <div className="field">
              <label>Project name</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Project name" />
            </div>
            <div className="field">
              <label>Start date</label>
              <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Assign to <span className="label-hint">(email or username — defaults to you)</span></label>
            <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="Blank for yourself, or someone you already work with" />
          </div>

          {error && <div className="field-error">&#10005; {error}</div>}
        </div>

        <div className="modal-foot">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={create} disabled={busy || loading}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  )
}
