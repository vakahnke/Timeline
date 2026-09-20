import { useState, useEffect, useCallback } from 'react'

// project == null -> create mode; project set -> edit mode. The parent's onSubmit
// decides whether to create or update.
export default function CreateProjectModal({ project, onSubmit, onClose }) {
  const editing = !!project
  const [name,        setName]        = useState(project?.name || '')
  const [description, setDescription] = useState(project?.description || '')
  // Only on a project that was started from a template, and only its owner decides.
  const fromTemplate = editing && !!project.source_template_key && project.my_role === 'owner'
  const [counted,     setCounted]     = useState(project?.count_in_track_record !== false)
  const [error,       setError]       = useState('')
  const [saving,      setSaving]      = useState(false)

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setError('Project name is required.'); return }
    setSaving(true)
    try {
      await onSubmit({ name: name.trim(), description: description.trim(),
                       ...(fromTemplate ? { count_in_track_record: counted } : {}) })
    } catch (err) {
      setError(`Could not ${editing ? 'save' : 'create'} project: ` + err.message)
      setSaving(false)
    }
  }, [name, description, onSubmit, editing, fromTemplate, counted])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') handleSave()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, handleSave])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{editing ? 'Edit Project' : 'New Project'}</h2>
          <button className="btn-close" onClick={onClose}>&#10005;</button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
                   placeholder="e.g. Website Redesign" autoFocus />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
                      placeholder="Optional — what is this project about?" />
          </div>
          {fromTemplate && (
            <label className="check-row">
              <input type="checkbox" checked={counted} onChange={e => setCounted(e.target.checked)} />
              <span>Count this project in its template's track record
                <span className="label-hint"> · totals only, never the project's name. Untick for confidential work.</span></span>
            </label>
          )}
          {error && <div className="field-error">&#10005; {error}</div>}
        </div>

        <div className="modal-foot">
          <button onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : (editing ? 'Save changes' : 'Create project')}
          </button>
        </div>
      </div>
    </div>
  )
}
