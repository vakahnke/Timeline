import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth/AuthContext'
import TeamModal from '../components/TeamModal'

export default function TeamsPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [teams,   setTeams]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [modal,   setModal]   = useState(undefined)  // undefined = closed · null = create · team = manage

  const load = useCallback(async () => {
    setLoading(true)
    try { setTeams(await api.teams.list()); setError(null) }
    catch { setError('Could not load your teams.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="dashboard scroll-page">
      <header className="dash-header">
        <div className="dash-brand">Timeline</div>
        <div className="dash-userbox">
          <button onClick={() => navigate('/')}>Projects</button>
          <span className="dash-user">{user?.username}</span>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-titlebar">
          <h1>Your teams</h1>
          <button className="btn-new" onClick={() => setModal(null)}>+ New Team</button>
        </div>

        {loading && (
          <div className="project-grid">{[0, 1, 2].map(i => <div key={i} className="project-card skeleton" />)}</div>
        )}

        {!loading && error && (
          <div className="empty-state"><div className="icon">⚠</div><p>{error}</p><button onClick={load}>Retry</button></div>
        )}

        {!loading && !error && teams.length === 0 && (
          <div className="empty-state dash-empty">
            <div className="icon">👥</div>
            <p>No teams yet.</p>
            <p className="dim">Create a team to add a whole group to a project at once.</p>
            <button className="btn-new" onClick={() => setModal(null)}>+ New Team</button>
          </div>
        )}

        {!loading && !error && teams.length > 0 && (
          <div className="project-grid">
            {teams.map(t => (
              <button key={t.id} className="project-card" onClick={() => setModal(t)}>
                <div className="project-card-top"><h3>{t.name}</h3></div>
                <p className="project-card-desc">{t.description || 'No description'}</p>
                <div className="project-card-foot">{t.member_count} member{t.member_count === 1 ? '' : 's'}</div>
              </button>
            ))}
          </div>
        )}
      </main>

      {modal !== undefined && (
        <TeamModal team={modal} onClose={() => setModal(undefined)} onChanged={load} />
      )}
    </div>
  )
}
