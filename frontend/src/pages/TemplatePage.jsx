import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useToast } from '../ui/ToastProvider'
import TemplateModal from '../components/TemplateModal'
import PublishModal from '../components/library/PublishModal'
import TemplatePreview from '../components/library/TemplatePreview'
import { GROUPS, VISIBILITY_LABEL, ratioText, spanText } from '../components/library/libraryModel'
import { LibraryHeader } from './TemplateLibraryPage'
import '../library.css'

const when = iso => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

function TrackRecord({ rec }) {
  if (!rec.started) {
    return <p className="dim">Nobody has started a project from this plan yet. Once people do, this shows how many finished and how the plan held up.</p>
  }
  const ratio = ratioText(rec.typical_ratio)
  const need = rec.min_finished_runs - rec.finished
  return (
    <>
      <dl className="lib-record">
        <div><dt>Started</dt><dd>{rec.started}</dd></div>
        <div><dt>Finished</dt><dd>{rec.finished}</dd></div>
        <div><dt>In flight</dt><dd>{rec.in_flight}</dd></div>
        <div><dt>Stalled</dt><dd>{rec.abandoned}</dd></div>
      </dl>
      <p className={ratio ? 'lib-record-ratio' : 'dim'}>
        {ratio
          ? `Against the plan, it ${ratio}.`
          : `How it runs against the plan appears after ${rec.min_finished_runs} finished runs (${need} to go).`}
      </p>
      <p className="dim lib-note">Totals only. It never shows which projects, or whose.</p>
    </>
  )
}

function Comments({ template }) {
  const [rows, setRows] = useState(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const { flash } = useToast()

  useEffect(() => { api.templates.comments(template.key).then(setRows).catch(() => setRows([])) }, [template.key])

  const post = async e => {
    e.preventDefault()
    if (!body.trim()) return
    setBusy(true)
    try {
      const row = await api.templates.addComment(template.key, { body: body.trim() })
      setRows(r => [...(r || []), row]); setBody('')
    } catch (err) {
      flash(err.status === 429 ? 'That is a lot of comments. Try again in a while.' : 'Could not post the comment.', 'error')
    } finally { setBusy(false) }
  }
  const remove = async row => {
    if (!confirm('Delete this comment?')) return
    try { await api.templates.removeComment(template.key, row.id); setRows(r => r.filter(x => x.id !== row.id)) }
    catch { flash('Could not delete the comment.', 'error') }
  }
  const report = async row => {
    try { await api.templates.report(template.key, { comment: row.id }); flash('Reported to the admins', 'saved') }
    catch { flash('Could not send the report.', 'error') }
  }

  return (
    <section className="lib-section">
      <h2>Comments {rows && rows.length > 0 && <span className="dim">· {rows.length}</span>}</h2>
      {rows === null && <p className="dim">Loading…</p>}
      {rows && rows.length === 0 && <p className="dim">No comments yet. What worked? What would you change?</p>}
      <ul className="lib-comments">
        {(rows || []).map(row => (
          <li key={row.id}>
            <div className="lib-comment-head">
              <strong>{row.author}</strong>
              <span className="dim">{when(row.created_at)}</span>
              <span className="lib-comment-actions">
                {row.can_delete && <button className="link-btn" onClick={() => remove(row)}>Delete</button>}
                {!row.is_mine && <button className="link-btn" onClick={() => report(row)}>Report</button>}
              </span>
            </div>
            <p>{row.body}</p>
          </li>
        ))}
      </ul>
      <form className="lib-comment-form" onSubmit={post}>
        <label htmlFor="lib-comment" className="sr-only">Add a comment</label>
        <textarea id="lib-comment" value={body} onChange={e => setBody(e.target.value)} maxLength={4000}
                  placeholder="Add a comment. Your username is shown with it." />
        <button className="btn-primary" disabled={busy || !body.trim()}>{busy ? 'Posting…' : 'Post comment'}</button>
      </form>
    </section>
  )
}

export default function TemplatePage() {
  const { templateKey } = useParams()
  const navigate = useNavigate()
  const { flash } = useToast()
  const [template, setTemplate] = useState(null)
  const [error,    setError]    = useState(null)
  const [using,    setUsing]    = useState(false)
  const [editing,  setEditing]  = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try { setTemplate(await api.templates.get(templateKey)) }
    catch (err) { setError(err.status === 404 ? 'missing' : 'failed') }
  }, [templateKey])
  useEffect(() => { setTemplate(null); load() }, [load])

  if (error) {
    return (
      <div className="dashboard scroll-page">
        <LibraryHeader />
        <main className="dash-main">
          <div className="empty-state dash-empty">
            <p>{error === 'missing' ? 'That template does not exist, or it has not been shared with you.' : 'Could not load the template.'}</p>
            <Link to="/templates">Back to the library</Link>
          </div>
        </main>
      </div>
    )
  }
  if (!template) {
    return <div className="dashboard scroll-page"><LibraryHeader /><main className="dash-main"><p className="dim">Loading…</p></main></div>
  }

  const t = template
  const vote = async () => {
    try { const next = await api.templates.vote(t.key, !t.voted); setTemplate(x => ({ ...x, votes: next.votes, voted: next.voted })) }
    catch { flash('Could not record your vote.', 'error') }
  }
  const fork = async () => {
    try {
      const mine = await api.templates.fork(t.key)
      flash('Copied. This one is yours to change.', 'saved')
      navigate(`/templates/${encodeURIComponent(mine.key)}`)
    } catch { flash('Could not copy the template.', 'error') }
  }
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); flash('Link copied', 'saved') }
    catch { flash(window.location.href, 'saved') }
  }
  const remove = async () => {
    const msg = t.official
      ? `Remove the built-in template "${t.name}" for everyone? An admin can restore it later.`
      : `Delete "${t.name}"? Its votes and comments go with it. Projects already started from it are not affected.`
    if (!confirm(msg)) return
    try { await api.templates.remove(t.key); flash('Template deleted', 'saved'); navigate('/templates') }
    catch { flash('Could not delete the template.', 'error') }
  }
  const unpublish = async () => {
    if (!confirm(t.is_mine ? 'Stop sharing this template? It goes back to being private.' : `Unpublish "${t.name}"? It goes back to being private to its author.`)) return
    try {
      const next = await api.templates.unpublish(t.key)
      flash('No longer shared', 'saved')
      if (next) setTemplate(next); else navigate('/templates')
    } catch { flash('Could not unpublish it.', 'error') }
  }
  const report = async () => {
    const reason = prompt('What is wrong with this template? (optional)')
    if (reason === null) return
    try { await api.templates.report(t.key, { reason }); flash('Reported to the admins', 'saved') }
    catch { flash('Could not send the report.', 'error') }
  }

  const shareable = t.visibility !== 'private'
  const group = GROUPS.find(g => g.id === t.group)?.label

  return (
    <div className="dashboard scroll-page">
      <LibraryHeader />
      <main className="dash-main lib-page">
        <Link to="/templates" className="lib-back">← Template library</Link>

        <div className="lib-head">
          <div className="lib-head-main">
            <h1>{t.name}</h1>
            {t.summary && <p className="lib-head-summary">{t.summary}</p>}
            <div className="lib-head-meta">
              {t.official && <span className="lib-badge lib-badge--official">Official</span>}
              {t.is_mine && <span className={`lib-badge lib-badge--${t.visibility}`}>{VISIBILITY_LABEL[t.visibility]}</span>}
              <span>{t.official ? 'Built in' : t.is_mine ? 'By you' : `By ${t.author || 'a member'}`}</span>
              {group && <span>{group}</span>}
              <span>{spanText(t.span_minutes)}</span>
              <span>{t.task_count} events in {t.category_count} tracks</span>
              {t.milestone_count > 0 && <span>{t.milestone_count} key milestone{t.milestone_count === 1 ? '' : 's'}</span>}
            </div>
            {t.tags.length > 0 && <div className="lib-tags">{t.tags.map(x => <span key={x}>#{x}</span>)}</div>}
            {t.forked_from && (
              <p className="dim">Copied from <Link to={`/templates/${encodeURIComponent(t.forked_from.key)}`}>{t.forked_from.name}</Link></p>
            )}
          </div>
          <div className="lib-actions">
            <button className="btn-primary" onClick={() => setUsing(true)}>Use this template</button>
            <button onClick={fork}>Make my own copy</button>
            <button className={`lib-vote lib-vote--big${t.voted ? ' on' : ''}`} onClick={vote} aria-pressed={t.voted}>
              ▲ {t.votes} {t.voted ? '· voted' : ''}
            </button>
          </div>
        </div>

        <section className="lib-section">
          <h2>The plan</h2>
          <TemplatePreview categories={t.categories} tasks={t.tasks} />
          <p className="dim lib-note">Times are relative. You choose the start date when you use it. ◆ marks a key milestone.</p>
        </section>

        <div className="lib-cols">
          <section className="lib-section">
            <h2>About</h2>
            <p className="lib-desc">{t.description || 'No description.'}</p>
          </section>
          <section className="lib-section">
            <h2>Track record</h2>
            <TrackRecord rec={t.track_record} />
          </section>
        </div>

        <section className="lib-section lib-manage">
          {t.can_edit && <button onClick={() => setEditing(true)}>{shareable ? 'Details and sharing' : 'Edit details or share…'}</button>}
          {shareable && <button onClick={copyLink} title="Works for anyone who is allowed to see this template">Copy link</button>}
          {t.can_unpublish && <button onClick={unpublish}>{t.is_mine ? 'Stop sharing' : 'Unpublish (admin)'}</button>}
          {t.can_delete && <button className="btn-danger" onClick={remove}>{t.official ? 'Remove built-in (admin)' : 'Delete'}</button>}
          {!t.is_mine && !t.official && <button className="link-btn" onClick={report}>Report</button>}
        </section>

        <Comments template={t} />
      </main>

      {using && (
        <TemplateModal initialKey={t.key} onClose={() => setUsing(false)}
                       onCreated={p => { flash('Project created from template', 'saved'); navigate(`/projects/${p.id}`) }} />
      )}
      {editing && (
        <PublishModal template={t} onClose={() => setEditing(false)}
                      onSaved={next => { setTemplate(next); setEditing(false); flash(next.visibility === 'private' ? 'Saved' : 'Saved and shared', 'saved') }} />
      )}
    </div>
  )
}
