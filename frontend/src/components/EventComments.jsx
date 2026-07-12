import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useAuth } from '../auth/AuthContext'

function fmtWhen(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}
const wasEdited = (c) => new Date(c.updated_at) - new Date(c.created_at) > 1500

// A comment thread on an event. Anyone with access can read; Commenter+ (canComment) can
// post. Authors edit/delete their own; project owners/admins can delete any (moderation).
export default function EventComments({ projectId, eventId, canComment, isOwner }) {
  const { user } = useAuth()
  const [comments, setComments] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [body,     setBody]     = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editBody,  setEditBody]  = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setComments(await api.comments.list(projectId, eventId)); setError('') }
    catch { setError('Could not load comments.') }
    finally { setLoading(false) }
  }, [projectId, eventId])

  useEffect(() => { load() }, [load])

  const errFrom = (err, fallback) => {
    try { const b = JSON.parse(err.body); return b.detail || Object.values(b).flat()[0] || fallback }
    catch { return fallback }
  }

  const post = useCallback(async (e) => {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true); setError('')
    try {
      const c = await api.comments.create(projectId, eventId, { body: body.trim() })
      setComments(prev => [...prev, c]); setBody('')
    } catch (err) { setError(errFrom(err, 'Could not post comment.')) }
    finally { setBusy(false) }
  }, [projectId, eventId, body])

  const saveEdit = useCallback(async (c) => {
    if (!editBody.trim()) return
    try {
      const upd = await api.comments.update(projectId, eventId, c.id, { body: editBody.trim() })
      setComments(prev => prev.map(x => x.id === c.id ? upd : x))
      setEditingId(null)
    } catch (err) { setError(errFrom(err, 'Could not save.')) }
  }, [projectId, eventId, editBody])

  const remove = useCallback(async (c) => {
    if (!confirm('Delete this comment?')) return
    try {
      await api.comments.remove(projectId, eventId, c.id)
      setComments(prev => prev.filter(x => x.id !== c.id))
    } catch (err) { setError(errFrom(err, 'Could not delete.')) }
  }, [projectId, eventId])

  const isMine = (c) => c.author.id === user?.id
  const canDelete = (c) => isMine(c) || isOwner || user?.is_staff

  return (
    <div className="ec">
      <label className="ec-label">
        Comments{comments.length > 0 && <span className="ec-count">{comments.length}</span>}
      </label>

      {loading ? (
        <p className="dim" style={{ fontSize: 12, margin: '2px 0' }}>Loading…</p>
      ) : (
        <div className="ec-list">
          {comments.length === 0 && (
            <p className="dim" style={{ fontSize: 12, margin: '2px 0' }}>No comments yet.</p>
          )}
          {comments.map(c => (
            <div key={c.id} className="ec-item">
              <div className="ec-head">
                <span className="ec-author">{c.author.username}</span>
                <span className="ec-when">{fmtWhen(c.created_at)}{wasEdited(c) ? ' · edited' : ''}</span>
              </div>
              {editingId === c.id ? (
                <div className="ec-edit">
                  <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={2} />
                  <div className="ec-edit-actions">
                    <button className="btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                    <button className="btn-sm btn-primary" onClick={() => saveEdit(c)} disabled={!editBody.trim()}>Save</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="ec-body">{c.body}</div>
                  {canDelete(c) && (
                    <div className="ec-actions">
                      {isMine(c) && (
                        <button className="ec-link" onClick={() => { setEditingId(c.id); setEditBody(c.body) }}>Edit</button>
                      )}
                      <button className="ec-link ec-del" onClick={() => remove(c)}>Delete</button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {canComment ? (
        <form className="ec-form" onSubmit={post}>
          <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Add a comment…" rows={2} />
          <button className="btn-primary btn-sm" type="submit" disabled={busy || !body.trim()}>
            {busy ? 'Posting…' : 'Comment'}
          </button>
        </form>
      ) : (
        <p className="dim" style={{ fontSize: 11, margin: '4px 0' }}>
          You have view-only access — you can read comments but not post.
        </p>
      )}

      {error && <div className="field-error">&#10005; {error}</div>}
    </div>
  )
}
