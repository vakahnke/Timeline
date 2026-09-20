import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import { GROUPS, sharedText } from './libraryModel'

// Details and sharing for one of your templates. Sharing is a review step, not a toggle: a
// template is cut from a real project, so before it leaves your hands you see every word of it
// that other people will get.
export default function PublishModal({ template, onSaved, onClose }) {
  const mode = template.library_mode || 'instance'
  const [name,        setName]        = useState(template.name)
  const [summary,     setSummary]     = useState(template.summary || '')
  const [description, setDescription] = useState(template.description || '')
  const [group,       setGroup]       = useState(template.group || 'other')
  const [tags,        setTags]        = useState((template.tags || []).join(', '))
  const [visibility,  setVisibility]  = useState(template.visibility || 'private')
  const [teamIds,     setTeamIds]     = useState(template.shared_with_teams || [])
  const [notes,       setNotes]       = useState(template.share_notes !== false)
  const [todos,       setTodos]       = useState(template.share_todos !== false)
  const [named,       setNamed]       = useState(template.author_display !== 'anonymous')
  const [seen,        setSeen]        = useState(false)
  const [teams,       setTeams]       = useState([])
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState('')

  useEffect(() => { api.teams.list().then(setTeams).catch(() => setTeams([])) }, [])

  const sharing = visibility !== 'private'
  const rows = useMemo(
    () => sharedText({ ...template, name, summary, description }, { notes, todos }),
    [template, name, summary, description, notes, todos])
  const flagged = rows.filter(r => r.flag)
  // Newly sharing, or sharing more widely than before, needs the list to have been looked at.
  const widening = sharing && visibility !== template.visibility
  const blocked = widening && !seen

  const toggleTeam = id => setTeamIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])

  const save = async () => {
    setError('')
    if (!name.trim()) { setError('Give the template a name.'); return }
    if (visibility === 'teams' && !teamIds.length) { setError('Choose at least one team to share with.'); return }
    setBusy(true)
    try {
      const saved = await api.templates.update(template.key, {
        name: name.trim(), summary: summary.trim(), description, group,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        visibility, shared_with_teams: visibility === 'teams' ? teamIds : [],
        share_notes: notes, share_todos: todos, author_display: named ? 'name' : 'anonymous',
      })
      onSaved(saved)
    } catch (err) {
      let msg = 'Could not save the template.'
      try { msg = Object.values(JSON.parse(err.body)).flat()[0] || msg } catch { /* keep */ }
      setError(msg)
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide lib-publish">
        <div className="modal-head">
          <h2>Details and sharing</h2>
          <button className="btn-close" onClick={onClose} aria-label="Close">&#10005;</button>
        </div>

        <div className="modal-body">
          <div className="field">
            <label htmlFor="lib-name">Name</label>
            <input id="lib-name" value={name} onChange={e => setName(e.target.value)} maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="lib-summary">One-line summary <span className="label-hint">(shown on the library card)</span></label>
            <input id="lib-summary" value={summary} onChange={e => setSummary(e.target.value)} maxLength={200}
                   placeholder="What this plan gets done, and for whom" />
          </div>
          <div className="field">
            <label htmlFor="lib-desc">Description <span className="label-hint">(what it assumes, when to use it)</span></label>
            <textarea id="lib-desc" value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="fields-row">
            <div className="field">
              <label htmlFor="lib-group">Shelf</label>
              <select id="lib-group" value={group} onChange={e => setGroup(e.target.value)}>
                {GROUPS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lib-tags">Tags <span className="label-hint">(commas between)</span></label>
              <input id="lib-tags" value={tags} onChange={e => setTags(e.target.value)} placeholder="launch, saas" />
            </div>
          </div>

          <fieldset className="lib-who">
            <legend>Who can see it</legend>
            <label><input type="radio" name="lib-vis" checked={visibility === 'private'}
                          onChange={() => setVisibility('private')} /> Only me</label>
            {mode !== 'off' && (
              <label><input type="radio" name="lib-vis" checked={visibility === 'teams'}
                            onChange={() => setVisibility('teams')} /> Teams I choose</label>
            )}
            {mode === 'instance' && (
              <label><input type="radio" name="lib-vis" checked={visibility === 'instance'}
                            onChange={() => setVisibility('instance')} /> Everyone signed in to this server</label>
            )}
            {mode === 'off' && <p className="dim">Sharing templates is switched off on this server.</p>}
          </fieldset>

          {visibility === 'teams' && (
            <div className="lib-teams">
              {teams.length === 0 && <p className="dim">You are not in any teams yet. Create one from Teams.</p>}
              {teams.map(t => (
                <label key={t.id}><input type="checkbox" checked={teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                  {' '}{t.name} <span className="dim">· {t.member_count} member{t.member_count === 1 ? '' : 's'}</span></label>
              ))}
            </div>
          )}

          {sharing && (
            <>
              <div className="lib-switches">
                <label><input type="checkbox" checked={notes} onChange={e => setNotes(e.target.checked)} /> Include event notes</label>
                <label><input type="checkbox" checked={todos} onChange={e => setTodos(e.target.checked)} /> Include to-do lists</label>
                <label><input type="checkbox" checked={named} onChange={e => setNamed(e.target.checked)} /> Show my name</label>
              </div>
              <p className="dim lib-note">
                {named
                  ? (visibility === 'instance'
                      ? 'Your username will be shown to everyone here, including people you do not share a project with.'
                      : 'Your username will be shown to the members of those teams.')
                  : 'It will be listed as shared by “a member”.'}
                {' '}Your own copy always keeps its notes and to-dos.
              </p>

              <div className="lib-review">
                <div className="lib-review-head">
                  <strong>Exactly what other people will get</strong>
                  <span className="dim">{rows.length} pieces of text</span>
                </div>
                {flagged.length > 0 && (
                  <div className="lib-warn" role="alert">
                    {flagged.length === 1 ? 'One line looks' : `${flagged.length} lines look`} like
                    {' '}{[...new Set(flagged.map(r => r.flag))].join(', ')}. Check {flagged.length === 1 ? 'it' : 'them'} below.
                  </div>
                )}
                <ul className="lib-review-list" tabIndex={0}>
                  {rows.map((r, i) => (
                    <li key={i} className={r.flag ? 'flagged' : ''}>
                      <span className="lib-review-kind">{r.kind}</span>
                      <span className="lib-review-text">{r.text}</span>
                      {r.where && <span className="lib-review-where">{r.where}</span>}
                    </li>
                  ))}
                </ul>
                {widening && (
                  <label className="lib-seen"><input type="checkbox" checked={seen} onChange={e => setSeen(e.target.checked)} />
                    {' '}I have read this list and it is fine to share.</label>
                )}
              </div>
            </>
          )}

          {error && <div className="field-error">&#10005; {error}</div>}
        </div>

        <div className="modal-foot">
          <button onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy || blocked}
                  title={blocked ? 'Read the list of what will be shared first' : undefined}>
            {busy ? 'Saving…' : widening ? 'Share it' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
