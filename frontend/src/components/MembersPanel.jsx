import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'

const ROLES = ['owner', 'editor', 'commenter', 'viewer']
// Team grants are capped at Editor (ownership is always granted individually).
const TEAM_ROLES = ['editor', 'commenter', 'viewer']
// Privilege labels surfaced to users (the API still uses owner/editor/commenter/viewer).
const ROLE_LABELS = {
  owner: 'Owner — full access', editor: 'Read & edit',
  commenter: 'Read & comment', viewer: 'Read only',
}

export default function MembersPanel({ projectId, isOwner, onClose }) {
  const [access,  setAccess]  = useState([])   // unified: direct + team-derived + org-admin
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const [identifier, setIdentifier] = useState('')
  const [newRole,    setNewRole]    = useState('viewer')
  const [adding,     setAdding]     = useState(false)

  const [teams,      setTeams]      = useState([])
  const [selTeam,    setSelTeam]    = useState('')
  const [teamRole,   setTeamRole]   = useState('editor')
  const [addingTeam, setAddingTeam] = useState(false)
  const [note,       setNote]       = useState('')
  const [assignedTeams, setAssignedTeams] = useState([])
  const [allUsers,   setAllUsers]   = useState([])

  const loadAccess = useCallback(async () => {
    setLoading(true)
    try {
      setAccess(await api.projects.access(projectId))
      setError('')
    } catch {
      setError('Could not load access.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const loadTeams = useCallback(async () => {
    try { setAssignedTeams(await api.projects.teams.list(projectId)) } catch { /* ignore */ }
  }, [projectId])

  useEffect(() => { loadAccess(); loadTeams() }, [loadAccess, loadTeams])

  useEffect(() => {
    if (!isOwner) return
    api.teams.list()
      .then(ts => { setTeams(ts); if (ts.length) setSelTeam(String(ts[0].id)) })
      .catch(() => {})
    api.users.list().then(setAllUsers).catch(() => {})
  }, [isOwner])

  // Suggest only people who don't already have a DIRECT grant (you can still directly-add
  // someone who currently has access only via a team).
  const directUsernames = new Set(access.filter(r => r.membership_id).map(r => r.user.username))
  const userOptions = allUsers.filter(u => !directUsernames.has(u.username))

  const addTeam = useCallback(async () => {
    if (!selTeam) return
    setAddingTeam(true); setError(''); setNote('')
    try {
      const link = await api.projects.addTeam(projectId, { team: Number(selTeam), role: teamRole })
      setNote(`Assigned “${link.team.name}” as ${ROLE_LABELS[link.role] || link.role}. Everyone on the team now has access.`)
      await Promise.all([loadTeams(), loadAccess()])
    } catch (err) {
      let msg = 'Could not add team.'
      try { msg = Object.values(JSON.parse(err.body)).flat()[0] || msg } catch { /* keep */ }
      setError(msg)
    } finally {
      setAddingTeam(false)
    }
  }, [projectId, selTeam, teamRole, loadTeams, loadAccess])

  const removeTeam = useCallback(async (link) => {
    if (!confirm(`Remove team “${link.team.name}” from this project? Members who don’t have direct access will lose it.`)) return
    try {
      await api.projects.teams.remove(projectId, link.team.id)
      await Promise.all([loadTeams(), loadAccess()])
    } catch {
      setError('Could not remove team.')
    }
  }, [projectId, loadTeams, loadAccess])

  const addMember = useCallback(async (e) => {
    e.preventDefault()
    if (!identifier.trim()) return
    setAdding(true); setError('')
    try {
      await api.projects.members.add(projectId, { identifier: identifier.trim(), role: newRole })
      setIdentifier('')
      await loadAccess()
    } catch (err) {
      let msg = 'Could not add member.'
      try { msg = Object.values(JSON.parse(err.body)).flat()[0] || msg } catch { /* keep */ }
      setError(msg)
    } finally {
      setAdding(false)
    }
  }, [projectId, identifier, newRole, loadAccess])

  const changeRole = useCallback(async (row, role) => {
    try {
      await api.projects.members.updateRole(projectId, row.membership_id, { role })
      await loadAccess()
    } catch (err) {
      let msg = 'Could not change role.'
      try { msg = JSON.parse(err.body).detail || msg } catch { /* keep */ }
      setError(msg)
    }
  }, [projectId, loadAccess])

  const removeMember = useCallback(async (row) => {
    if (!confirm(`Remove ${row.user.username}’s direct access to this project?`)) return
    try {
      await api.projects.members.remove(projectId, row.membership_id)
      await loadAccess()
    } catch (err) {
      let msg = 'Could not remove member.'
      try { msg = JSON.parse(err.body).detail || msg } catch { /* keep */ }
      setError(msg)
    }
  }, [projectId, loadAccess])

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Members</h2>
          <button className="btn-close" onClick={onClose}>&#10005;</button>
        </div>

        <div className="modal-body">
          {isOwner && <div className="mp-label">Add a person</div>}
          {isOwner && (
            <form className="invite-row" onSubmit={addMember}>
              <input
                list="mp-user-list"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="Pick or type a name / email"
                autoComplete="off"
              />
              <datalist id="mp-user-list">
                {userOptions.map(u => (
                  <option key={u.id} value={u.username}>{u.email}</option>
                ))}
              </datalist>
              <select value={newRole} onChange={e => setNewRole(e.target.value)}>
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <button className="btn-primary" type="submit" disabled={adding}>
                {adding ? 'Adding…' : 'Add'}
              </button>
            </form>
          )}

          {isOwner && teams.length > 0 && <div className="mp-label">Add a team</div>}
          {isOwner && teams.length > 0 && (
            <div className="invite-row">
              <select style={{ flex: 1 }} value={selTeam} onChange={e => setSelTeam(e.target.value)}>
                {teams.map(t => <option key={t.id} value={t.id}>{t.name} ({t.member_count})</option>)}
              </select>
              <select value={teamRole} onChange={e => setTeamRole(e.target.value)}>
                {TEAM_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
              <button className="btn-template" onClick={addTeam} disabled={addingTeam}>
                {addingTeam ? 'Adding…' : 'Add team'}
              </button>
            </div>
          )}

          {note && <div className="dim" style={{ fontSize: 11, marginTop: -4 }}>{note}</div>}
          {error && <div className="field-error">&#10005; {error}</div>}

          {assignedTeams.length > 0 && (
            <>
              <div className="mp-label">Assigned teams</div>
              <div className="members-list">
                {assignedTeams.map(link => (
                  <div key={link.id} className="member-row">
                    <div className="member-id">
                      <span className="member-name">{link.team.name}</span>
                      <span className="member-email">
                        {link.team.member_count} member{link.team.member_count === 1 ? '' : 's'} · everyone gets {ROLE_LABELS[link.role] || link.role}
                      </span>
                    </div>
                    {isOwner
                      ? <button className="btn-danger btn-sm" onClick={() => removeTeam(link)}>Remove</button>
                      : <span className={`role-badge role-badge--${link.role}`}>{link.role}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="mp-label">Who has access</div>
          {loading ? (
            <p className="dim">Loading access…</p>
          ) : (
            <div className="members-list">
              {access.map(row => {
                const via = row.via_teams.map(t => t.name).join(', ')
                const direct = !!row.membership_id
                // Editable only for a plain direct grant; org-admins and team-derived rows are locked.
                const editable = isOwner && direct && !row.is_org_admin
                return (
                  <div key={row.user.id} className="member-row">
                    <div className="member-id">
                      <span className="member-name">{row.user.username}</span>
                      <span className="member-email">
                        {row.user.email}
                        {row.is_org_admin && <span className="mp-src"> · org-admin</span>}
                        {!row.is_org_admin && via && <span className="mp-src"> · via {via}</span>}
                      </span>
                    </div>
                    {editable ? (
                      <>
                        <select
                          className="role-select"
                          value={row.direct_role}
                          onChange={e => changeRole(row, e.target.value)}
                        >
                          {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                        </select>
                        <button className="btn-danger btn-sm" onClick={() => removeMember(row)}>Remove</button>
                      </>
                    ) : (
                      <span
                        className={`role-badge role-badge--${row.role}`}
                        title={row.is_org_admin
                          ? 'Org-admin — owns every project'
                          : via ? `Granted by team ${via} — remove or edit the team to change`
                          : ''}
                      >
                        {row.role}{(row.is_org_admin || (!direct && via)) ? ' 🔒' : ''}
                      </span>
                    )}
                  </div>
                )
              })}
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
