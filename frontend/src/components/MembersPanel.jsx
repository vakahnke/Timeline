import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const ROLES = ['owner', 'editor', 'viewer']

export default function MembersPanel({ projectId, isOwner, onClose }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const [identifier, setIdentifier] = useState('')
  const [newRole,    setNewRole]    = useState('viewer')
  const [adding,     setAdding]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setMembers(await api.projects.members.list(projectId))
      setError('')
    } catch {
      setError('Could not load members.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  const addMember = useCallback(async (e) => {
    e.preventDefault()
    if (!identifier.trim()) return
    setAdding(true)
    setError('')
    try {
      await api.projects.members.add(projectId, { identifier: identifier.trim(), role: newRole })
      setIdentifier('')
      await load()
    } catch (err) {
      let msg = 'Could not add member.'
      try { msg = Object.values(JSON.parse(err.body)).flat()[0] || msg } catch { /* keep */ }
      setError(msg)
    } finally {
      setAdding(false)
    }
  }, [projectId, identifier, newRole, load])

  const changeRole = useCallback(async (m, role) => {
    try {
      await api.projects.members.updateRole(projectId, m.id, { role })
      setMembers(prev => prev.map(x => x.id === m.id ? { ...x, role } : x))
    } catch (err) {
      let msg = 'Could not change role.'
      try { msg = JSON.parse(err.body).detail || msg } catch { /* keep */ }
      setError(msg)
    }
  }, [projectId])

  const removeMember = useCallback(async (m) => {
    if (!confirm(`Remove ${m.user.username} from this project?`)) return
    try {
      await api.projects.members.remove(projectId, m.id)
      setMembers(prev => prev.filter(x => x.id !== m.id))
    } catch (err) {
      let msg = 'Could not remove member.'
      try { msg = JSON.parse(err.body).detail || msg } catch { /* keep */ }
      setError(msg)
    }
  }, [projectId])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Members</h2>
          <button className="btn-close" onClick={onClose}>&#10005;</button>
        </div>

        <div className="modal-body">
          {isOwner && (
            <form className="invite-row" onSubmit={addMember}>
              <input
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="Email or username"
              />
              <select value={newRole} onChange={e => setNewRole(e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <button className="btn-primary" type="submit" disabled={adding}>
                {adding ? 'Adding…' : 'Add'}
              </button>
            </form>
          )}

          {error && <div className="field-error">&#10005; {error}</div>}

          {loading ? (
            <p className="dim">Loading members…</p>
          ) : (
            <div className="members-list">
              {members.map(m => (
                <div key={m.id} className="member-row">
                  <div className="member-id">
                    <span className="member-name">{m.user.username}</span>
                    <span className="member-email">{m.user.email}</span>
                  </div>
                  {isOwner ? (
                    <>
                      <select
                        className="role-select"
                        value={m.role}
                        onChange={e => changeRole(m, e.target.value)}
                      >
                        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <button className="btn-danger btn-sm" onClick={() => removeMember(m)}>Remove</button>
                    </>
                  ) : (
                    <span className={`role-badge role-badge--${m.role}`}>{m.role}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
