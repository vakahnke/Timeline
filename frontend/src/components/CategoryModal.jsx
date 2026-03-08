import { useState, useEffect, useCallback } from 'react'

export default function CategoryModal({ track, onSave, onClose }) {
  const [name,   setName]   = useState(track.name)
  const [color,  setColor]  = useState(track.color || '#4a88ff')
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(track.name)
    setColor(track.color || '#4a88ff')
    setError('')
  }, [track])

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    try {
      await onSave(track, { name: name.trim(), color })
    } catch (err) {
      setError('Save failed: ' + err.message)
      setSaving(false)
    }
  }, [name, color, track, onSave])

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
          <h2>Edit Category</h2>
          <button className="btn-close" onClick={onClose}>&#10005;</button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Category name"
              autoFocus
            />
          </div>

          <div className="field">
            <label>Color</label>
            <div className="color-row">
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
              />
              <input
                type="text"
                value={color}
                onChange={e => setColor(e.target.value)}
                placeholder="#4a88ff"
                maxLength={7}
              />
            </div>
          </div>

          {error && <div className="field-error">&#10005; {error}</div>}
        </div>

        <div className="modal-foot">
          <button onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
