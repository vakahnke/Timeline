import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth/AuthContext'
import { GROUPS, VISIBILITY_LABEL, recordLine, spanText } from '../components/library/libraryModel'
import '../library.css'

const SORTS = [
  { id: 'proven',  label: 'Most proven' },
  { id: 'popular', label: 'Most votes' },
  { id: 'new',     label: 'Newest' },
  { id: 'name',    label: 'Name' },
]
const SCOPES = [
  { id: '',       label: 'Everything' },
  { id: 'mine',   label: 'Mine' },
  { id: 'shared', label: 'Shared with me' },
]

export function LibraryHeader() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <header className="dash-header">
      <div className="dash-brand">Timeline</div>
      <div className="dash-userbox">
        <button onClick={() => navigate('/')}>Projects</button>
        <button onClick={() => navigate('/teams')}>Teams</button>
        <span className="dash-user">{user?.username}</span>
        <button onClick={logout}>Log out</button>
      </div>
    </header>
  )
}

export default function TemplateLibraryPage() {
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [q,       setQ]       = useState('')
  const [group,   setGroup]   = useState('')
  const [tag,     setTag]     = useState('')
  const [scope,   setScope]   = useState('')
  const [sort,    setSort]    = useState('proven')

  // The whole library is one small list, so it is fetched once and filtered here; the server
  // does the sorting it owns ("proven") and the same filters are there for other clients.
  const load = useCallback(async () => {
    setLoading(true)
    try { setItems(await api.templates.list({ sort })); setError(null) }
    catch { setError('Could not load the library.') }
    finally { setLoading(false) }
  }, [sort])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter(t =>
      (!group || t.group === group) &&
      (!tag || t.tags.some(x => x.toLowerCase() === tag)) &&
      (scope !== 'mine' || t.is_mine) &&
      (scope !== 'shared' || (t.source === 'saved' && !t.is_mine)) &&
      (!needle || [t.name, t.summary, t.description, t.tags.join(' ')].join(' ').toLowerCase().includes(needle)))
  }, [items, q, group, tag, scope])

  const tags = useMemo(() => {
    const count = new Map()
    for (const t of items) for (const x of t.tags) count.set(x.toLowerCase(), (count.get(x.toLowerCase()) || 0) + 1)
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([x]) => x)
  }, [items])

  const vote = async (t, e) => {
    e.preventDefault(); e.stopPropagation()
    try {
      const next = await api.templates.vote(t.key, !t.voted)
      setItems(list => list.map(x => x.key === t.key ? { ...x, votes: next.votes, voted: next.voted } : x))
    } catch { /* the count simply stays as it was */ }
  }

  return (
    <div className="dashboard scroll-page">
      <LibraryHeader />
      <main className="dash-main">
        <div className="dash-titlebar">
          <div>
            <h1>Template library</h1>
            <p className="dim lib-sub">Plans that worked, ready to run again. Save any project as a template, then share it here.</p>
          </div>
        </div>

        <div className="lib-controls">
          <input className="lib-search" type="search" value={q} onChange={e => setQ(e.target.value)}
                 placeholder="Search templates" aria-label="Search templates" />
          <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort by">
            {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="lib-chips" role="group" aria-label="Filter">
          {SCOPES.map(s => (
            <button key={s.id || 'all'} className={`lib-chip${scope === s.id ? ' on' : ''}`} onClick={() => setScope(s.id)}>{s.label}</button>
          ))}
          <span className="lib-chip-gap" />
          {GROUPS.map(g => (
            <button key={g.id} className={`lib-chip${group === g.id ? ' on' : ''}`}
                    onClick={() => setGroup(group === g.id ? '' : g.id)}>{g.label}</button>
          ))}
          {tags.length > 0 && <span className="lib-chip-gap" />}
          {tags.map(x => (
            <button key={x} className={`lib-chip lib-chip--tag${tag === x ? ' on' : ''}`}
                    onClick={() => setTag(tag === x ? '' : x)}>#{x}</button>
          ))}
        </div>

        {loading && <div className="lib-grid">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="lib-card skeleton" />)}</div>}

        {!loading && error && (
          <div className="empty-state"><div className="icon">⚠</div><p>{error}</p><button onClick={load}>Retry</button></div>
        )}

        {!loading && !error && shown.length === 0 && (
          <div className="empty-state dash-empty">
            <p>{scope === 'mine' ? 'You have not saved a template yet.' : 'Nothing matches.'}</p>
            <p className="dim">{scope === 'mine'
              ? 'Open a project and choose Save as Template. It stays private until you share it.'
              : 'Try fewer filters.'}</p>
          </div>
        )}

        {!loading && !error && shown.length > 0 && (
          <div className="lib-grid">
            {shown.map(t => {
              const record = recordLine(t.track_record)
              return (
                <Link key={t.key} to={`/templates/${encodeURIComponent(t.key)}`} className="lib-card">
                  <div className="lib-card-top">
                    <h3>{t.name}</h3>
                    {t.official && <span className="lib-badge lib-badge--official">Official</span>}
                    {t.is_mine && <span className={`lib-badge lib-badge--${t.visibility}`}>{VISIBILITY_LABEL[t.visibility]}</span>}
                  </div>
                  <p className="lib-card-desc">{t.summary || t.description || 'No description'}</p>
                  <div className="lib-card-meta">
                    {spanText(t.span_minutes)} · {t.task_count} events · {t.category_count} tracks
                    {t.milestone_count > 0 && ` · ${t.milestone_count} ◆`}
                  </div>
                  <div className={`lib-card-record${record ? '' : ' none'}`}>{record || 'Not run yet'}</div>
                  <div className="lib-card-foot">
                    <span className="lib-card-by">
                      {t.official ? 'Built in' : t.is_mine ? 'By you' : `By ${t.author || 'a member'}`}
                    </span>
                    <span className="lib-card-counts">
                      <button className={`lib-vote${t.voted ? ' on' : ''}`} onClick={e => vote(t, e)}
                              aria-pressed={t.voted} aria-label={t.voted ? 'Take back your vote' : 'Vote for this template'}>
                        ▲ {t.votes}
                      </button>
                      <span title="Comments">💬 {t.comment_count}</span>
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
