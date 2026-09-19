import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../ui/ToastProvider'
import StatusPage from '../components/report/StatusPage'
import useIsNarrow from '../ui/useIsNarrow'
import { BLOCK_KINDS, LIMITS, STATUS, fmtLong, newBlock, newDocument, refreshFromSchedule, uid } from '../components/report/reportModel'
import '../report.css'

// The print tool. It opens already filled in from the schedule; everything on the page can then
// be changed right here, at print time: click any text on the page to reword it, and use the
// panel to choose what is shown. Nothing about a project's page is configured anywhere else, and
// a saved report becomes the starting shape for that project's next one.

// Immutable "a.b.0.c" setter for the report document.
function setPath(obj, path, value) {
  const keys = path.split('.')
  const out = Array.isArray(obj) ? [...obj] : { ...obj }
  let cur = out
  keys.forEach((k, i) => {
    if (i === keys.length - 1) { cur[k] = value; return }
    cur[k] = Array.isArray(cur[k]) ? [...cur[k]] : { ...(cur[k] || {}) }
    cur = cur[k]
  })
  return out
}
const move = (arr, i, d) => { const a = [...arr], j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a }

const PAGE_CSS = {
  slide:   '@page { size: 13.333in 7.5in; margin: 0 }',
  letter:  '@page { size: 8.5in 11in; margin: 0 }',
  a4:      '@page { size: 210mm 297mm; margin: 0 }',
}

export default function StatusReportPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { flash } = useToast()

  const [project, setProject]   = useState(null)
  const [facts, setFacts]       = useState(null)
  const [suggestion, setSug]    = useState(null)
  const [previous, setPrevious] = useState(null)
  const [doc, setDoc]           = useState(null)
  const [report, setReport]     = useState(null)     // status fields
  const [layout, setLayout]     = useState('slide')
  const [paper, setPaper]       = useState(() => { try { return localStorage.getItem('report:paper') || 'letter' } catch { return 'letter' } })
  const [saved, setSaved]       = useState([])
  const [baselines, setBaselines] = useState([])
  const [baseName, setBaseName] = useState('')
  const [limits, setLimits]     = useState({})        // threshold inputs, as typed
  const [savedId, setSavedId]   = useState(null)      // set when showing/editing a saved report
  const [frozen, setFrozen]     = useState(false)     // true = facts come from a saved snapshot
  const [error, setError]       = useState(null)
  const [busy, setBusy]         = useState(false)
  const [fit, setFit]           = useState('ok')     // 'ok' | 'overflow' | 'squeezed'

  const canEdit = project && (project.my_role === 'owner' || project.my_role === 'editor')
  const narrow = useIsNarrow('(max-width: 640px)')

  const load = useCallback(async ({ keepDoc = false } = {}) => {
    try {
      const [proj, draft, list, bases] = await Promise.all([
        api.projects.get(projectId), api.statusReports.draft(projectId), api.statusReports.list(projectId), api.baselines.list(projectId),
      ])
      setBaselines(bases.results || bases); setLimits(proj.status_thresholds || {})
      setProject(proj); setFacts(draft.facts); setSug(draft.suggestion); setPrevious(draft.previous); setSaved(list)
      setFrozen(false)
      if (keepDoc) {
        setDoc(d => refreshFromSchedule(d, draft))
        setReport(r => r.status_source === 'override'
          ? { ...r, suggested_status: draft.suggestion.status, rule_fired: draft.suggestion.rule_fired }
          : { ...r, status: draft.suggestion.status, suggested_status: draft.suggestion.status, rule_fired: draft.suggestion.rule_fired })
      } else {
        setDoc(newDocument({ ...draft, user }))
        setReport({ status: draft.suggestion.status, suggested_status: draft.suggestion.status, status_source: 'rule', override_reason: '', rule_fired: draft.suggestion.rule_fired })
        setLayout(draft.previous?.layout || 'slide'); setSavedId(null)
      }
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError && (e.status === 403 || e.status === 404) ? 'You don’t have access to this project.' : 'Could not load the status report. Is the API running?')
    }
  }, [projectId, user])

  useEffect(() => { load() }, [load])
  useEffect(() => { try { localStorage.setItem('report:paper', paper) } catch { /* private mode */ } }, [paper])

  // The printed page size follows the layout. @page cannot be toggled by a class, so keep one
  // <style> tag in step with the current choice.
  useEffect(() => {
    const tag = document.createElement('style')
    tag.id = 'sr-page-size'
    tag.textContent = layout === 'slide' ? PAGE_CSS.slide : PAGE_CSS[paper]
    document.head.appendChild(tag)
    return () => tag.remove()
  }, [layout, paper])
  useEffect(() => { document.body.classList.add('sr-body'); return () => document.body.classList.remove('sr-body') }, [])

  const set = useCallback((path, value) => setDoc(d => setPath(d, path, value)), [])
  const patch = (fn) => setDoc(d => fn(d))

  const chooseStatus = (s) => setReport(r => s === r.suggested_status
    ? { ...r, status: s, status_source: 'rule', override_reason: '' }
    : { ...r, status: s, status_source: 'override' })

  const setCommitted = async (value) => {
    setBusy(true)
    try { await api.projects.update(projectId, { committed_end: value || null }); await load({ keepDoc: true }) }
    catch { flash('Could not save the committed date.', 'error') }
    finally { setBusy(false) }
  }

  // Baselines and thresholds belong to the project, not to one report, so they save at once.
  const takeBaseline = async () => {
    const name = baseName.trim() || `Plan of ${fmtLong()}`
    setBusy(true)
    try { await api.baselines.create(projectId, name); setBaseName(''); await load({ keepDoc: true }); flash('Baseline set. Tick “Show changes against the baseline” on any report that should show them', 'saved') }
    catch { flash('Could not set the baseline.', 'error') }
    finally { setBusy(false) }
  }
  const removeBaseline = async (id) => {
    setBusy(true)
    try { await api.baselines.remove(projectId, id); await load({ keepDoc: true }) }
    catch { flash('Could not delete the baseline.', 'error') }
    finally { setBusy(false) }
  }
  const saveLimits = async () => {
    const clean = Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v === '' || v == null ? null : Number(v)]))
    setBusy(true)
    try { await api.projects.update(projectId, { status_thresholds: clean }); await load({ keepDoc: true }); flash('Status limits saved', 'saved') }
    catch { flash('Limits must be whole numbers: days 1–250, percent and points 1–100.', 'error') }
    finally { setBusy(false) }
  }

  const save = async () => {
    if (report.status_source === 'override' && !report.override_reason.trim()) { flash('Say why the status differs from the rule.', 'error'); return }
    setBusy(true)
    const payload = { as_of: facts.as_of, layout, ...report, content: doc, snapshot: facts }
    try {
      const r = savedId ? await api.statusReports.update(projectId, savedId, payload) : await api.statusReports.create(projectId, payload)
      setSavedId(r.id); setSaved(await api.statusReports.list(projectId)); flash('Report saved', 'saved')
    } catch { flash('Could not save the report.', 'error') }
    finally { setBusy(false) }
  }

  // An editable PowerPoint of exactly what is on the page now, edits included. Nothing is saved.
  const downloadPptx = async () => {
    setBusy(true)
    try {
      const { blob, filename } = await api.statusReports.exportPptx(projectId, {
        layout, paper, ...report, content: doc, snapshot: facts,
        previous: previous ? { status: previous.status, as_of: previous.as_of } : null,
        tz_offset: -new Date().getTimezoneOffset(),
      })
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href; a.download = filename || 'status-report.pptx'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1000)
      flash('PowerPoint downloaded', 'saved')
    } catch { flash('Could not build the PowerPoint file.', 'error') }
    finally { setBusy(false) }
  }

  const openSaved = async (id) => {
    if (!id) { load(); return }
    setBusy(true)
    try {
      const r = await api.statusReports.get(projectId, id)
      setDoc(r.content); setFacts(r.snapshot); setLayout(r.layout); setSavedId(r.id); setFrozen(true)
      setReport({ status: r.status, suggested_status: r.suggested_status || r.status, status_source: r.status_source, override_reason: r.override_reason, rule_fired: r.rule_fired })
      const before = saved.filter(s => new Date(s.as_of) < new Date(r.as_of))[0]
      setPrevious(before || null)
    } catch { flash('Could not open that report.', 'error') }
    finally { setBusy(false) }
  }

  const removeSaved = async () => {
    if (!savedId || !confirm('Delete this saved report?')) return
    try { await api.statusReports.remove(projectId, savedId); flash('Report deleted', 'saved'); load() }
    catch { flash('Could not delete the report.', 'error') }
  }

  const eventsByTrack = useMemo(() => {
    const m = {}
    for (const e of facts?.events || []) (m[e.category] ||= []).push(e)
    return m
  }, [facts])

  if (error) return <div className="sr-shell"><div className="sr-error"><p>{error}</p><button onClick={() => navigate(`/projects/${projectId}`)}>Back to the project</button></div></div>
  if (!doc || !report || !facts) return <div className="sr-shell"><div className="sr-error"><p>Building the report…</p></div></div>

  const msIds = doc.timeline.milestoneIds ?? (facts.events || []).filter(e => e.is_milestone).map(e => e.id)
  const toggleMs = (id) => set('timeline.milestoneIds', msIds.includes(id) ? msIds.filter(x => x !== id) : [...msIds, id])
  const toggleRow = (name) => { const h = doc.timeline.hiddenRows || []; set('timeline.hiddenRows', h.includes(name) ? h.filter(x => x !== name) : [...h, name]) }
  const showToggle = (key, label) => (
    <label className="sr-check" key={key}><input type="checkbox" checked={doc.show[key] !== false} onChange={e => set(`show.${key}`, e.target.checked)} />{label}</label>
  )

  const optIn = (key, label) => (
    <label className="sr-check" key={key}><input type="checkbox" checked={doc.show[key] === true} onChange={e => set(`show.${key}`, e.target.checked)} />{label}</label>
  )

  return (
    <div className="sr-shell">
      <header className="sr-bar">
        <button className="btn-back" onClick={() => navigate(`/projects/${projectId}`)} title="Back to the project">←</button>
        <h1>{project?.name} <span>· status report</span></h1>
        <div className="sr-seg" role="group" aria-label="Layout">
          <button className={layout === 'slide' ? 'on' : ''} onClick={() => setLayout('slide')}>Slide 16:9</button>
          <button className={layout === 'handout' ? 'on' : ''} onClick={() => setLayout('handout')}>Handout</button>
        </div>
        {layout === 'handout' && (
          <select className="sr-paper" value={paper} onChange={e => setPaper(e.target.value)} aria-label="Paper size"><option value="letter">Letter</option><option value="a4">A4</option></select>
        )}
        <span className="sr-grow" />
        {canEdit && <button onClick={save} disabled={busy}>{savedId ? 'Save changes' : 'Save report'}</button>}
        <button onClick={downloadPptx} disabled={busy} title="An editable .pptx: native text, shapes and table, no pictures">Download PowerPoint</button>
        <button className="sr-primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </header>

      <div className="sr-work">
        <aside className="sr-side" aria-label="Customize the page">
          {frozen && (
            <div className="sr-note">Showing the report saved for {fmtLong(facts.as_of)}, with the numbers as they were then.
              <button onClick={() => load({ keepDoc: true })}>Refresh from today’s schedule</button></div>
          )}
          {!canEdit && <div className="sr-note">You have view-only access. You can print this page; changes here are not saved.</div>}
          {fit !== 'ok' && (
            <div className="sr-note sr-note--warn" role="alert">
              <b>{fit === 'overflow' ? 'This is more than one page.' : 'The timeline is being squeezed.'}</b>
              {fit === 'overflow' ? ' The bottom of the page is cut off.' : ' There is too much text around it to draw it at a readable size.'}
              {' '}Hide a block, remove an item or a number, or shorten the wording. The type is never shrunk to fit.
            </div>
          )}
          <p className="sr-tip">Click any text on the page to reword it. Use this panel to choose what the page shows.</p>

          <details open>
            <summary>Status</summary>
            <div className="sr-status">
              {Object.entries(STATUS).map(([k, s]) => (
                <button key={k} className={`sr-st-btn sr-t-${s.tone}${report.status === k ? ' on' : ''}`} onClick={() => chooseStatus(k)}>
                  {s.label}{report.suggested_status === k && <em> · by rule</em>}
                </button>))}
            </div>
            <p className="sr-hint">Rule: {report.rule_fired}.</p>
            {report.status_source === 'override' && (
              <label className="sr-f">Why it differs from the rule (printed in the footer)
                <input id="sr-override" value={report.override_reason} maxLength={200} onChange={e => setReport(r => ({ ...r, override_reason: e.target.value }))} placeholder="e.g. Sponsor agreed a new date on Sep 18" /></label>
            )}
            <label className="sr-f">Committed finish date
              <input id="sr-committed" type="date" value={project?.committed_end || ''} disabled={!canEdit || busy} onChange={e => setCommitted(e.target.value)} /></label>
            <p className="sr-hint">The date the project is held to. The forecast is measured against it.</p>
          </details>

          <details>
            <summary>Baseline and limits <small>{facts?.baseline ? facts.baseline.name : 'no baseline'}</small></summary>
            <div className="sr-base">
              {facts?.baseline
                ? <p className="sr-hint">{doc.show.baseline === true ? 'This report shows changes' : 'This report does not show them. If you tick “Show changes against the baseline”, they are measured'} against <b>{facts.baseline.name}</b>, frozen {fmtLong(facts.baseline.created_at)}: {facts.baseline.moved} event{facts.baseline.moved === 1 ? '' : 's'} moved, {facts.baseline.added} added, {facts.baseline.removed} removed since.</p>
                : <p className="sr-hint" id="sr-base-tip"><b>Optional.</b> A baseline freezes today’s dates as the approved plan, so a report <i>can</i> show how the plan has changed since. Plans should change; this is for the audiences that need to see it. Setting one shows nothing by itself: it only appears on a report where you tick “Show changes against the baseline”.</p>}
              {canEdit && (
                <div className="sr-base-row">
                  <input id="sr-base-name" value={baseName} maxLength={80} onChange={e => setBaseName(e.target.value)} placeholder={facts?.baseline ? 'Name for the new baseline' : 'e.g. Approved plan'} aria-label="Baseline name" />
                  <button onClick={takeBaseline} disabled={busy || frozen || facts?.empty}>{facts?.baseline ? 'Re-baseline' : 'Set baseline'}</button>
                </div>)}
              {baselines.length > 0 && (
                <div className="sr-rows">{baselines.map(b => (
                  <div className="sr-row" key={b.id}>
                    <span className="sr-row-t">{b.name}{b.active && <em> · active</em>} <small>{fmtLong(b.created_at)}</small></span>
                    {canEdit && <button onClick={() => removeBaseline(b.id)} disabled={busy} title="Delete this baseline">✕</button>}
                  </div>))}</div>)}
              <p className="sr-hint">Limits for the status rule. Agree them before anything slips; blank uses the default.</p>
              <div className="sr-thresh">
                {[['off_track_working_days', 'Off track beyond (working days late)', 10], ['off_track_percent', '…or beyond (% of project length)', 10], ['behind_points', 'At risk when work trails time by (points)', 10]].map(([k, label, dflt]) => (
                  <Fragment key={k}><label htmlFor={`sr-lim-${k}`}>{label}</label>
                    <input id={`sr-lim-${k}`} type="number" min="1" inputMode="numeric" placeholder={String(dflt)} value={limits[k] ?? ''} disabled={!canEdit || busy} onChange={e => setLimits(l => ({ ...l, [k]: e.target.value }))} /></Fragment>))}
              </div>
              {canEdit && <div className="sr-actions"><button onClick={saveLimits} disabled={busy}>Save limits</button></div>}
            </div>
          </details>

          <details open>
            <summary>What the page shows</summary>
            <div className="sr-checks">
              {showToggle('decision', 'Decision needed')}
              {showToggle('pathToGreen', 'Path to green (when not on track)')}
              {showToggle('kpis', 'Numbers strip')}
              {showToggle('timeline', 'Timeline')}
              {/* Off unless chosen: how much a plan has moved is for specific audiences, not every report. */}
              {facts?.baseline && optIn('baseline', 'Show changes against the baseline')}
              {facts?.since_last && optIn('moved', 'Show what moved since last report')}
              {layout === 'handout' && (facts?.history?.length || 0) >= 2 && (
                <label className="sr-check"><input type="checkbox" checked={doc.show.trend === true} onChange={e => set('show.trend', e.target.checked)} />Milestone trend chart</label>)}
              {showToggle('columns', 'Text blocks')}
              {layout === 'handout' && showToggle('milestoneTable', 'Milestone table')}
              {showToggle('footer', 'Footer')}
            </div>
            <label className="sr-check"><input type="checkbox" checked={!doc.decision.none} onChange={e => set('decision.none', !e.target.checked)} />There is a decision to ask for</label>
          </details>

          <details>
            <summary>Numbers <small>{doc.kpis.length} of {LIMITS.kpis}</small></summary>
            {doc.kpis.map((k, i) => (
              <div className="sr-row" key={k.id}>
                <span className="sr-row-t">{k.label || 'Untitled'}{!k.auto && <em> · yours</em>}</span>
                <select value={k.tone || ''} onChange={e => set(`kpis.${i}.tone`, e.target.value)} aria-label="Emphasis"><option value="">plain</option><option value="ok">good</option><option value="warn">watch</option><option value="bad">bad</option></select>
                <button onClick={() => patch(d => ({ ...d, kpis: move(d.kpis, i, -1) }))} disabled={i === 0} title="Move left">←</button>
                <button onClick={() => patch(d => ({ ...d, kpis: move(d.kpis, i, 1) }))} disabled={i === doc.kpis.length - 1} title="Move right">→</button>
                <button onClick={() => patch(d => ({ ...d, kpis: d.kpis.filter(x => x.id !== k.id), hiddenKpis: k.auto ? [...(d.hiddenKpis || []), k.id] : d.hiddenKpis }))} title="Remove">✕</button>
              </div>))}
            <div className="sr-actions">
              <button disabled={doc.kpis.length >= LIMITS.kpis} onClick={() => patch(d => ({ ...d, kpis: [...d.kpis, { id: uid('k'), label: 'Budget', value: '—', detail: 'vs plan', tone: '' }] }))}>+ Add a number</button>
              <button onClick={() => patch(d => ({ ...refreshFromSchedule({ ...d, hiddenKpis: [] }, { facts, suggestion, previous }) }))}>Reset to schedule</button>
            </div>
          </details>

          <details>
            <summary>Timeline</summary>
            <label className="sr-check"><input type="checkbox" checked={doc.timeline.showProgress !== false} onChange={e => set('timeline.showProgress', e.target.checked)} />Progress fill</label>
            <label className="sr-check"><input type="checkbox" checked={doc.timeline.showCritical !== false} onChange={e => set('timeline.showCritical', e.target.checked)} />Critical path</label>
            <h5>Tracks</h5>
            <div className="sr-checks">{(facts.rows || []).map(r => (
              <label className="sr-check" key={r.name}><input type="checkbox" checked={!(doc.timeline.hiddenRows || []).includes(r.name)} onChange={() => toggleRow(r.name)} /><i style={{ background: r.color }} />{r.name}</label>))}</div>
            <h5>Milestones on the page <small>{msIds.length}</small></h5>
            <p className="sr-hint">Pick the dates this audience tracks. This choice is for the report only.</p>
            <div className="sr-ms-pick">{Object.entries(eventsByTrack).map(([track, evs]) => (
              <div key={track}><span className="sr-ms-track">{track}</span>{evs.map(e => (
                <label className="sr-check" key={e.id}><input type="checkbox" checked={msIds.includes(e.id)} onChange={() => toggleMs(e.id)} />{e.title}</label>))}</div>))}</div>
          </details>

          <details>
            <summary>Text blocks <small>{doc.columns.filter(c => !c.hidden).length} of {LIMITS.columns}</small></summary>
            {doc.columns.map((c, ci) => (
              <div className="sr-block" key={c.id}>
                <div className="sr-row">
                  <span className="sr-row-t">{c.title || 'Untitled'}</span>
                  <select value={c.kind} onChange={e => set(`columns.${ci}`, { ...c, kind: e.target.value, source: undefined, items: c.items || [], text: c.text || '' })} aria-label="Block type">{Object.entries(BLOCK_KINDS).map(([k, b]) => <option key={k} value={k}>{b.label}</option>)}</select>
                  <button onClick={() => patch(d => ({ ...d, columns: move(d.columns, ci, -1) }))} disabled={ci === 0} title="Move left">←</button>
                  <button onClick={() => patch(d => ({ ...d, columns: move(d.columns, ci, 1) }))} disabled={ci === doc.columns.length - 1} title="Move right">→</button>
                  <button onClick={() => patch(d => ({ ...d, columns: d.columns.filter(x => x.id !== c.id) }))} title="Remove block">✕</button>
                </div>
                {(BLOCK_KINDS[c.kind]?.maxItems || 0) > 0 && (
                  <div className="sr-items">
                    {(c.items || []).map((it, ii) => (
                      <div className="sr-row sr-row--item" key={it.id}>
                        <span className="sr-row-t">{it.text || 'New item'}</span>
                        {BLOCK_KINDS[c.kind]?.hasSeverity && <select value={it.severity || 'medium'} onChange={e => set(`columns.${ci}.items.${ii}.severity`, e.target.value)} aria-label="Severity"><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select>}
                        <button onClick={() => set(`columns.${ci}.items`, move(c.items, ii, -1))} disabled={ii === 0} title="Move up">↑</button>
                        <button onClick={() => set(`columns.${ci}.items`, c.items.filter(x => x.id !== it.id))} title="Remove">✕</button>
                      </div>))}
                    <button className="sr-add" disabled={(c.items || []).length >= BLOCK_KINDS[c.kind].maxItems}
                            onClick={() => set(`columns.${ci}.items`, [...(c.items || []), BLOCK_KINDS[c.kind].newItem()])}>
                      + Add {BLOCK_KINDS[c.kind].itemLabel}</button>
                  </div>)}
              </div>))}
            <div className="sr-actions">
              <button disabled={doc.columns.length >= LIMITS.columns} onClick={() => patch(d => ({ ...d, columns: [...d.columns, newBlock('text')] }))}>+ Add a block</button>
            </div>
          </details>

          <details>
            <summary>Saved reports <small>{saved.length}</small></summary>
            <select id="sr-saved" value={savedId || ''} onChange={e => openSaved(e.target.value ? Number(e.target.value) : null)}>
              <option value="">New report from today’s schedule</option>
              {saved.map(s => <option key={s.id} value={s.id}>{fmtLong(s.as_of)} · {STATUS[s.status]?.label}{s.author_name ? ` · ${s.author_name}` : ''}</option>)}
            </select>
            <p className="sr-hint">Saving keeps a dated copy. The next report for this project starts from its shape and shows the change since.</p>
            {savedId && canEdit && <button className="sr-danger" onClick={removeSaved}>Delete this saved report</button>}
          </details>
        </aside>

        <main className="sr-stage">
          <div className={`sr-fit sr-fit--${layout}${fit === 'overflow' ? ' sr-fit--over' : ''}`}>
            {/* On a phone the page is shown whole, as it prints. It is far too small to type into
                there, so editing happens in the readable version below. */}
            <StatusPage doc={doc} report={report} facts={facts} layout={layout} previous={previous} set={canEdit && !narrow ? set : undefined} paper={paper} onFit={setFit} />
          </div>
          {narrow && (
            <>
              <p className="sr-caption">This is the {layout === 'slide' ? 'slide' : 'handout'} exactly as it prints and exports. Pinch to zoom, or turn your phone sideways.</p>
              <h2 className="sr-read-h">The same report, sized for reading</h2>
              <div className="sr-readwrap">
                <StatusPage doc={doc} report={report} facts={facts} layout={layout} previous={previous} set={canEdit ? set : undefined} paper={paper} read />
              </div>
              {canEdit && <p className="sr-caption">Tap any text above to reword it. The slide follows.</p>}
            </>
          )}
          <p className={`sr-caption${narrow ? ' sr-caption--desk' : ''}`}>{layout === 'slide' ? 'Prints as a 16:9 page: drop the PDF straight into a deck.' : `Prints on ${paper === 'a4' ? 'A4' : 'Letter'}, portrait.`} In the print dialog choose “Save as PDF”, margins “None”, and turn on background graphics.</p>
        </main>
      </div>
    </div>
  )
}
