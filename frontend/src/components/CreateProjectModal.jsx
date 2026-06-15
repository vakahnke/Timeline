import { useState, useEffect, useCallback } from 'react'

// project == null -> create mode; project set -> edit mode. The parent's onSubmit
// decides whether to create or update.
export default function CreateProjectModal({ project, onSubmit, onClose }) {
  const editing = !!project
  const [name,        setName]        = useState(project?.name || '')
  const [description, setDescription] = useState(project?.description || '')
  const [error,       setError]       = useState('')
  const [saving,      setSaving]      = useState(false)

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setError('Project name is required.'); return }
    setSaving(true)
    try {
      await onSubmit({ name: name.trim(), description: description.trim() })
    } catch (err) {
      setError(`Could not ${editing ? 'save' : 'create'} project: ` + err.message)
      setSaving(false)
    }
  }, [name, description, onSubmit, editing])

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
