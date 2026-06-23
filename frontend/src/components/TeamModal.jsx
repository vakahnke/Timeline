import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

// team === null  -> create mode;  team set -> manage mode (members + rename + delete)
export default function TeamModal({ team, onClose, onChanged }) {
  const creating = !team
  const canManage = creating || !!team?.is_owner   // members see a read-only view
  const [name,        setName]        = useState(team?.name || '')
  const [description, setDescription] = useState(team?.description || '')
  const [members,     setMembers]     = useState(team?.members || [])
  const [identifier,  setIdentifier]  = useState('')
  const [error,       setError]       = useState('')
  const [busy,        setBusy]        = useState(false)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const errFrom = (err, fallback) => {
    try { return Object.values(JSON.parse(err.body)).flat()[0] || fallback } catch { return fallback }
  }

  const createTeam = useCallback(async () => {
    if (!name.trim()) { setError('Team name is required.'); return }
    setBusy(true)
    try { await api.teams.create({ name: name.trim(), description: description.trim() }); onChanged(); onClose() }
    catch (err) { setError(errFrom(err, 'Could not create team.')); setBusy(false) }
  }, [name, description, onChanged, onClose])

  const saveMeta = useCallback(async () => {
    if (!name.trim()) { setError('Team name is required.'); return }
    setBusy(true)
    try { await api.teams.update(team.id, { name: name.trim(), description: description.trim() }); onChanged() }
    catch (err) { setError(errFrom(err, 'Could not save.')) }
    setBusy(false)
  }, [team, name, description, onChanged])

  const addMember = useCallback(async (e) => {
    e.preventDefault()
    if (!identifier.trim()) return
    setError('')
    try {
      const updated = await api.teams.addMember(team.id, { identifier: identifier.trim() })
      setMembers(updated.members); setIdentifier(''); onChanged()
    } catch (err) { setError(errFrom(err, 'Could not add member.')) }
  }, [team, identifier, onChanged])

  const removeMember = useCallback(async (u) => {
    try { const updated = await api.teams.removeMember(team.id, u.id); setMembers(updated.members); onChanged() }
    catch { setError('Could not remove member.') }
  }, [team, onChanged])

  const deleteTeam = useCallback(async () => {
    if (!confirm(`Delete team "${team.name}"?`)) return
    try { await api.teams.remove(team.id); onChanged(); onClose() }
    catch { setError('Could not delete team.') }
  }, [team, onChanged, onClose])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>{creating ? 'New Team' : (canManage ? 'Manage Team' : 'Team')}</h2>
          <button className="btn-close" onClick={onClose}>&#10005;</button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Design Squad" autoFocus disabled={!canManage} />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional" disabled={!canManage} />
          </div>

          {!creating && (
            <>
              {canManage ? (
                <form className="invite-row" onSubmit={addMember}>
                  <input value={identifier} onChange={e => setIdentifier(e.target.value)} placeholder="Add member by email or username" />
                  <button className="btn-primary" type="submit">Add</button>
                </form>
              ) : (
                <p className="dim" style={{ margin: '2px 0 8px' }}>You're a member of this team. Only the owner can change it.</p>
              )}
              <div className="members-list">
                {members.map(u => (
                  <div key={u.id} className="member-row">
                    <div className="member-id">
                      <span className="member-name">{u.username}</span>
                      <span className="member-email">{u.email}</span>
                    </div>
                    {canManage && <button className="btn-danger btn-sm" onClick={() => removeMember(u)}>Remove</button>}
                  </div>
                ))}
                {!members.length && <p className="dim">No members yet{canManage ? ' — add people above.' : '.'}</p>}
              </div>
            </>
          )}

          {error && <div className="field-error">&#10005; {error}</div>}
        </div>

        <div className="modal-foot">
          {!creating && canManage && <button className="btn-danger" onClick={deleteTeam} disabled={busy}>Delete team</button>}
          <button onClick={onClose} disabled={busy}>Close</button>
          {creating && <button className="btn-primary" onClick={createTeam} disabled={busy}>{busy ? 'Creating…' : 'Create team'}</button>}
          {!creating && canManage && <button className="btn-primary" onClick={saveMeta} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>}
        </div>
      </div>
    </div>
  )
}
