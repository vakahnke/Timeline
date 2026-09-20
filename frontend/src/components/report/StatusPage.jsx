import { useEffect, useLayoutEffect, useRef } from 'react'
import ReportTimeline from './ReportTimeline'
import MilestoneTrend from './MilestoneTrend'
import { STATUS, chosenMilestones, fmtDay, footerText, slipText, trendPoints } from './reportModel'
import { BRAND } from '../../constants'

// Text you can click and type into, right on the page. Commits on blur so React never fights the
// caret; Enter commits a single-line field. Read-only members get plain text.
export function Editable({ value, onChange, tag: Tag = 'span', className = '', placeholder = '', multiline = false, readOnly = false, maxLength }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current && ref.current.textContent !== (value || '')) ref.current.textContent = value || '' }, [value])
  if (readOnly) return <Tag className={className}>{value}</Tag>
  return (
    <Tag
      ref={ref}
      className={`sr-edit ${className}`}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      data-placeholder={placeholder}
      onBlur={e => { let t = e.currentTarget.textContent.replace(/\s+/g, ' ').trim(); if (maxLength) t = t.slice(0, maxLength); if (t !== (value || '')) onChange(t) }}
      onKeyDown={e => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); e.currentTarget.blur() } if (e.key === 'Escape') { e.currentTarget.textContent = value || ''; e.currentTarget.blur() } }}
      onPaste={e => { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' ')) }}
    />
  )
}

function Shape({ kind, className = '' }) {
  return (
    <svg className={className} viewBox="0 0 12 12" aria-hidden="true">
      {kind === 'circle' && <circle cx="6" cy="6" r="5.2" fill="currentColor" />}
      {kind === 'diamond' && <path d="M6 .6 11.4 6 6 11.4.6 6z" fill="currentColor" />}
      {kind === 'square' && <rect x="1" y="1" width="10" height="10" fill="currentColor" />}
    </svg>
  )
}
const SEV = { high: { shape: 'square', tone: 'bad' }, medium: { shape: 'diamond', tone: 'warn' }, low: { shape: 'circle', tone: 'ok' } }

/** The printable page. `doc` is the report document, `report` the status fields, `facts` the
 *  schedule snapshot. `set(path, value)` updates the document; omit it for a read-only page. */
export default function StatusPage({ doc, report, facts, layout, previous, set, paper = 'letter', onFit, read = false }) {
  const ro = !set
  const innerRef = useRef(null)

  // One page means one page. Rather than shrink the type, tell the author when the content no
  // longer fits: the handout overflows its sheet, or the slide's timeline (the only row that
  // gives way) has been squeezed below a readable height.
  useLayoutEffect(() => {
    if (!onFit) return
    const el = innerRef.current
    if (!el) return
    const check = () => {
      const over = el.scrollHeight - el.clientHeight > 2
      const tl = el.querySelector('.sr-tl')
      const squeezed = !!tl && layout === 'slide' && tl.getBoundingClientRect().height < el.getBoundingClientRect().height * 0.2
      onFit(over ? 'overflow' : squeezed ? 'squeezed' : 'ok')
    }
    check()
    if (!window.ResizeObserver) return
    const obs = new ResizeObserver(check)
    obs.observe(el)
    return () => obs.disconnect()
  })
  const st = STATUS[report.status] || STATUS.on_track
  const show = doc.show || {}
  const rows = (facts?.rows || []).filter(r => !(doc.timeline?.hiddenRows || []).includes(r.name))
  const milestones = facts && !facts.empty ? chosenMilestones(doc, facts) : []
  const trend = previous && previous.status !== report.status
    ? `${(['on_track', 'at_risk', 'off_track'].indexOf(report.status) > ['on_track', 'at_risk', 'off_track'].indexOf(previous.status)) ? '▼' : '▲'} was ${STATUS[previous.status]?.label} · ${fmtDay(previous.as_of)}`
    : previous ? `● unchanged since ${fmtDay(previous.as_of)}` : ''
  // `read`: the same report as one readable column for a phone. It flows like the handout, at
  // type sizes you can read without zooming, and its height follows the content.
  const handout = layout === 'handout' || read
  const withBase = !!facts?.baseline && show.baseline === true      // slip is opt-in, per report
  const cols = (doc.columns || []).filter(c => !c.hidden)

  const decision = show.decision && (
    <div className={`sr-ask${doc.decision.none ? ' sr-ask--none' : ''}`}>
      {doc.decision.none ? <span className="sr-ask-t">No decisions needed</span> : (
        <>
          <span className="sr-ask-t">
            <Editable value={doc.decision.title} onChange={v => set('decision.title', v)} readOnly={ro} placeholder="Decision needed" />
            {(doc.decision.neededBy || !ro) && <span className="sr-opt" data-empty={!doc.decision.neededBy}> · by <Editable value={doc.decision.neededBy} onChange={v => set('decision.neededBy', v)} readOnly={ro} placeholder="date" /></span>}
            {(doc.decision.from || !ro) && <span className="sr-opt" data-empty={!doc.decision.from}> · from <Editable value={doc.decision.from} onChange={v => set('decision.from', v)} readOnly={ro} placeholder="who decides" /></span>}
          </span>
          <Editable tag="div" className="sr-ask-b" value={doc.decision.text} onChange={v => set('decision.text', v)} readOnly={ro} multiline
                    placeholder="What you need decided, and what waiting costs." maxLength={260} />
        </>
      )}
    </div>
  )

  // One renderer per block kind (declared in reportModel.BLOCK_KINDS). Add a kind there and a
  // renderer here, and the print tool can place it, reorder it, save it and carry it forward.
  const BLOCK_RENDERERS = {
    text: (c, ci) => (
      <Editable tag="p" className="sr-free" value={c.text} onChange={v => set(`columns.${ci}.text`, v)} readOnly={ro} multiline maxLength={420}
                placeholder="Anything the schedule cannot know: budget, staffing, a note for this audience." />
    ),
    list: (c, ci) => (
      <ul>{(c.items || []).map((it, ii) => (
        <li key={it.id} className="sr-opt" data-empty={!it.text}><span className="sr-m">{c.mark || '•'}</span><span>
          <Editable value={it.text} onChange={v => set(`columns.${ci}.items.${ii}.text`, v)} readOnly={ro} placeholder="Outcome, not activity" maxLength={120} />
          {(it.when || !ro) && <span className="sr-when sr-opt" data-empty={!it.when}> · <Editable value={it.when} onChange={v => set(`columns.${ci}.items.${ii}.when`, v)} readOnly={ro} placeholder="date" maxLength={16} /></span>}
        </span></li>))}
        {!c.items?.length && <li className="sr-none"><span className="sr-m">–</span><span>Nothing to report</span></li>}
      </ul>
    ),
    risks: (c, ci) => (
      <div className="sr-risks">{(c.items || []).map((it, ii) => {
        const sev = SEV[it.severity] || SEV.medium
        return (
          <div className="sr-risk sr-opt" data-empty={!it.text && !it.detail} key={it.id}><Shape kind={sev.shape} className={`sr-sev sr-${sev.tone}`} /><span>
            <Editable tag="b" value={it.text} onChange={v => set(`columns.${ci}.items.${ii}.text`, v)} readOnly={ro} placeholder="The risk, and its impact in days or dollars." maxLength={140} />{' '}
            <Editable className="sr-sub" value={it.detail} onChange={v => set(`columns.${ci}.items.${ii}.detail`, v)} readOnly={ro} placeholder="Owner · mitigation · date" maxLength={120} />
          </span></div>)
      })}
        {!c.items?.length && <div className="sr-risk sr-none"><span /><span>No significant risks</span></div>}
      </div>
    ),
  }
  const column = (c, ci) => (
    <div className="sr-col" key={c.id}>
      <h4><Editable value={c.title} onChange={v => set(`columns.${ci}.title`, v)} readOnly={ro} placeholder="Block title" /></h4>
      {(BLOCK_RENDERERS[c.kind] || BLOCK_RENDERERS.text)(c, ci)}
    </div>
  )

  return (
    <div className={`sr-page sr-page--${read ? 'handout' : layout} sr-paper--${paper}${read ? ' sr-page--read' : ''}`} data-status={report.status}>
      <div className="sr-in" ref={innerRef}>
        <div className="sr-top">
          <span className="sr-ident">
            <Editable tag="b" value={doc.header.project} onChange={v => set('header.project', v)} readOnly={ro} placeholder="Project" />
            <span className="sr-sep">|</span><Editable value={doc.header.subtitle} onChange={v => set('header.subtitle', v)} readOnly={ro} placeholder="Status report" />
            <span className="sr-sep">|</span><Editable value={doc.header.date} onChange={v => set('header.date', v)} readOnly={ro} placeholder="Date" />
            {(doc.header.pm || !ro) && <span className="sr-opt" data-empty={!doc.header.pm}><span className="sr-sep">|</span><Editable value={doc.header.pm} onChange={v => set('header.pm', v)} readOnly={ro} placeholder="PM: name" /></span>}
          </span>
          <span className={`sr-chip sr-${st.tone}`}><Shape kind={st.shape} />{st.label}{trend && <span className="sr-trend">{trend}</span>}</span>
        </div>

        <div className={`sr-lead${show.decision && !handout ? '' : ' sr-lead--solo'}`}>
          <div>
            <Editable tag="div" className="sr-headline" value={doc.headline} onChange={v => set('headline', v)} readOnly={ro} multiline maxLength={170}
                      placeholder="One sentence a leader can repeat: where the project stands and what it needs." />
            {show.pathToGreen && report.status !== 'on_track' && (
              <div className="sr-ptg sr-opt" data-empty={!doc.pathToGreen}><b>Path to green: </b><Editable value={doc.pathToGreen} onChange={v => set('pathToGreen', v)} readOnly={ro} multiline maxLength={200}
                   placeholder="the action, its owner, and the date by which this returns to on track." /></div>)}
          </div>
          {!handout && decision}
        </div>
        {handout && decision}

        {show.kpis && !!doc.kpis?.length && (
          <div className={`sr-kpis${handout && doc.kpis.length > 4 ? ' sr-kpis--wrap' : ''}`} style={{ gridTemplateColumns: `repeat(${handout && doc.kpis.length > 4 ? 3 : doc.kpis.length}, 1fr)` }}>
            {doc.kpis.map((k, i) => (
              <div className="sr-kpi" key={k.id}>
                <Editable className="sr-kl" value={k.label} onChange={v => set(`kpis.${i}.label`, v)} readOnly={ro} placeholder="Label" maxLength={28} />
                <Editable className={`sr-kv${k.tone ? ' sr-' + k.tone : ''}`} value={k.value} onChange={v => set(`kpis.${i}.value`, v)} readOnly={ro} placeholder="Value" maxLength={14} />
                <Editable className="sr-kd" value={k.detail} onChange={v => set(`kpis.${i}.detail`, v)} readOnly={ro} placeholder="compared with what?" maxLength={44} />
              </div>))}
          </div>
        )}

        {show.timeline && <ReportTimeline facts={facts} rows={rows} milestones={milestones} dense={handout} read={read}
                                          showCritical={doc.timeline?.showCritical !== false} showProgress={doc.timeline?.showProgress !== false}
                                          showBaseline={show.baseline === true} />}

        {show.moved === true && facts?.since_last && (doc.moved || !ro) && (
          <div className="sr-moved sr-opt" data-empty={!doc.moved}><b>Moved since {fmtDay(facts.since_last.as_of)}: </b>
            <Editable value={doc.moved} onChange={v => set('moved', v)} readOnly={ro} multiline maxLength={220} placeholder="which dates moved, and by how much." /></div>)}

        {handout && show.milestoneTable && milestones.length > 0 && (
          <table className="sr-ms">
            <thead>{withBase
              ? <tr><th>Milestone</th><th>Baseline</th><th>Forecast</th><th>Slip</th><th>Done</th><th>Status</th></tr>
              : <tr><th>Milestone</th><th>Track</th><th>Date</th><th>Done</th><th>Status</th></tr>}</thead>
            <tbody>{milestones.slice(0, 8).map(m => {
              const s = m.state === 'done' ? { shape: 'circle', tone: 'ok', t: 'Met' } : m.state === 'late' ? { shape: 'square', tone: 'bad', t: 'Past due' } : { shape: 'diamond', tone: 'ink', t: 'Ahead' }
              const status = <td><span className={`sr-st sr-${s.tone}`}><Shape kind={s.shape} />{s.t}</span></td>
              return withBase
                ? <tr key={m.id}><td>{m.title}</td><td>{m.baseline_end ? fmtDay(m.baseline_end) : 'new'}</td><td>{fmtDay(m.date)}</td><td className={m.slip_days > 0 ? 'sr-slip' : ''}>{slipText(m.slip_days)}</td><td>{m.percent_complete}%</td>{status}</tr>
                : <tr key={m.id}><td>{m.title}</td><td>{m.category}</td><td>{fmtDay(m.date)}</td><td>{m.percent_complete}%</td>{status}</tr>
            })}</tbody>
          </table>
        )}

        {handout && show.trend === true && <MilestoneTrend points={trendPoints(facts, milestones)} milestones={milestones} dense={handout} />}

        {show.columns && cols.length > 0 && (
          <div className="sr-cols" style={handout ? undefined : { gridTemplateColumns: cols.map(c => (c.kind === 'risks' ? '1.45fr' : '1fr')).join(' ') }}>
            {doc.columns.map((c, ci) => (c.hidden ? null : column(c, ci)))}
          </div>
        )}

        {show.footer && (
          <div className="sr-foot"><Editable value={footerText(doc, report, facts)} onChange={v => set('footer.text', v)} readOnly={ro} placeholder="Footer" maxLength={220} /><span>{BRAND}</span></div>
        )}
      </div>
    </div>
  )
}
