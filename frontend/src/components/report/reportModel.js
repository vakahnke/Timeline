// The status report "document": what the print tool edits and what gets saved as
// StatusReport.content. The backend supplies FACTS (dates, progress, milestones, timeline rows);
// everything about how the page looks and reads lives here, so a project can shape its own page
// at print time without a schema change. See docs/design/status-one-pager.md.

export const STATUS = {
  on_track:  { label: 'On track',  shape: 'circle',  tone: 'ok' },
  at_risk:   { label: 'At risk',   shape: 'diamond', tone: 'warn' },
  off_track: { label: 'Off track', shape: 'square',  tone: 'bad' },
}

export const LIMITS = { headline: 170, listItems: 4, risks: 3, kpis: 6, columns: 3 }

// Block kinds. To add a new kind of block to the page, declare it here (its label in the print
// tool, how a new one starts, how many items it may hold) and give it a renderer in
// StatusPage.jsx's BLOCK_RENDERERS. Nothing else needs to change: the panel's menus, the
// add/remove/reorder controls, saving, and carry-over to the next report all work off this table.
export const BLOCK_KINDS = {
  list:  { label: 'list',      itemLabel: 'an item', maxItems: 4, newItem: () => ({ id: uid('l'), text: '', when: '' }) },
  risks: { label: 'risks',     itemLabel: 'a risk',  maxItems: 3, newItem: () => ({ id: uid('r'), severity: 'medium', text: '', detail: '' }), hasSeverity: true },
  text:  { label: 'free text', maxItems: 0 },
}
export const newBlock = (kind = 'text') => ({ id: uid('c'), kind, title: kind === 'text' ? 'Budget and staffing' : 'New block', text: '', items: [] })

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDay = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}` }
export const fmtLong = (iso) => { const d = iso ? new Date(iso) : new Date(); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}` }
// A date-only string ("2026-11-03") must not be shifted by the local timezone.
export const fmtDateOnly = (s) => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return `${MONTHS[m - 1]} ${d}` }

let _id = 0
export const uid = (p = 'i') => `${p}${Date.now().toString(36)}${(_id++).toString(36)}`

// ── Numbers strip, derived from the facts. Each is editable afterwards; `auto` marks the ones
//    "Refresh from schedule" is allowed to overwrite. ──────────────────────────────────────────
export function autoKpis(facts) {
  if (!facts || facts.empty) return []
  const committed = facts.project.committed_end
  const v = facts.variance_days, wd = facts.variance_working_days
  const behind = facts.elapsed - facts.progress
  const late = facts.milestones_late || 0
  const ms = facts.milestones || []
  const crit = (facts.critical_ids || []).length
  const trouble = facts.critical_blocked_or_overdue || 0
  return [
    { id: 'finish', auto: true, label: committed ? 'Forecast finish' : 'Planned finish', value: fmtDay(facts.end),
      detail: committed ? (v > 0 ? `+${v} day${v === 1 ? '' : 's'} vs ${fmtDateOnly(committed)} commitment` : v < 0 ? `${-v} day${v === -1 ? '' : 's'} ahead of ${fmtDateOnly(committed)}` : `on the ${fmtDateOnly(committed)} commitment`) : 'no committed date set',
      tone: committed ? (wd > 10 ? 'bad' : v > 0 ? 'warn' : 'ok') : '' },
    { id: 'work', auto: true, label: 'Work complete', value: `${facts.progress}%`, detail: `${facts.elapsed}% of schedule elapsed`, tone: behind >= 10 ? 'warn' : '' },
    { id: 'milestones', auto: true, label: 'Milestones', value: ms.length ? `${facts.milestones_done} of ${ms.length}` : '–',
      detail: ms.length ? (late ? `${late} past due` : 'none past due') : 'none marked yet', tone: late ? 'bad' : '' },
    { id: 'critical', auto: true, label: 'Critical path', value: `${crit} event${crit === 1 ? '' : 's'}`,
      detail: trouble ? `${trouble} blocked or overdue task${trouble === 1 ? '' : 's'} on it` : 'no blocked or overdue tasks on it', tone: trouble ? 'warn' : '' },
    { id: 'tasks', auto: true, label: 'Blocked · overdue', value: `${facts.blocked_tasks} · ${facts.overdue_tasks}`, detail: 'open tasks',
      tone: facts.blocked_tasks || facts.overdue_tasks ? 'bad' : 'ok' },
  ]
}

const listFrom = (evs, n = 3) => (evs || []).slice(0, n).map(e => ({ id: uid('l'), text: e.title, when: fmtDay(e.end) }))

function suggestedRisks(facts, suggestion) {
  const out = []
  if (facts.variance_days > 0) out.push({ id: uid('r'), severity: facts.variance_working_days > 10 ? 'high' : 'medium', text: `Finish is ${facts.variance_days} day${facts.variance_days === 1 ? '' : 's'} past the commitment.`, detail: '' })
  if (facts.critical_blocked_or_overdue) out.push({ id: uid('r'), severity: 'medium', text: 'Blocked or overdue work sits on the critical path.', detail: '' })
  if (!out.length && suggestion?.status !== 'on_track') out.push({ id: uid('r'), severity: 'medium', text: suggestion.rule_fired, detail: '' })
  return out
}

/** A fresh document for this project, filled in from the schedule. When a previous report exists
 *  its SHAPE carries over (which blocks are shown, titles, custom numbers, hidden tracks, the
 *  author's standing text such as risks and who decides) while schedule-derived content refreshes. */
export function newDocument({ facts, suggestion, previous, user }) {
  const prev = previous?.content || null
  const sinceLabel = previous ? `Since last report · ${fmtDay(previous.as_of)}` : 'Last two weeks'
  const doc = {
    v: 1,
    header: { project: facts.project.name, subtitle: 'Status report', date: fmtLong(facts.as_of), pm: prev?.header?.pm ?? (user?.username ? `PM: ${user.username}` : '') },
    headline: suggestion.headline,
    pathToGreen: '',
    show: { pathToGreen: true, decision: true, kpis: true, timeline: true, columns: true, milestoneTable: true, footer: true, ...(prev?.show || {}) },
    decision: { none: prev?.decision?.none ?? true, title: prev?.decision?.title || 'Decision needed', text: prev?.decision?.text || '', neededBy: prev?.decision?.neededBy || '', from: prev?.decision?.from || '' },
    kpis: autoKpis(facts),
    timeline: { hiddenRows: prev?.timeline?.hiddenRows || [], milestoneIds: prev?.timeline?.milestoneIds ?? null, showCritical: prev?.timeline?.showCritical ?? true, showProgress: prev?.timeline?.showProgress ?? true },
    columns: [
      { id: 'done', kind: 'list', mark: '✓', title: sinceLabel, source: 'completed', items: listFrom(facts.completed_recently) },
      { id: 'next', kind: 'list', mark: '›', title: 'Next three weeks', source: 'next', items: listFrom(facts.due_next) },
      { id: 'risks', kind: 'risks', title: 'Top risks · impact · owner · mitigation', items: prev?.columns?.find(c => c.kind === 'risks')?.items?.length ? prev.columns.find(c => c.kind === 'risks').items : suggestedRisks(facts, suggestion) },
    ],
    footer: { text: '' },
  }
  if (prev) {
    // Keep the previous page's custom numbers and any custom/free-text columns and titles.
    const custom = (prev.kpis || []).filter(k => !k.auto)
    doc.kpis = [...doc.kpis.filter(k => !(prev.hiddenKpis || []).includes(k.id)), ...custom].slice(0, LIMITS.kpis)
    doc.hiddenKpis = prev.hiddenKpis || []
    const prevCols = prev.columns || []
    if (prevCols.length) {
      doc.columns = prevCols.map(pc => {
        const fresh = doc.columns.find(c => c.id === pc.id)
        if (fresh && pc.kind === 'list' && pc.source) return { ...fresh, title: pc.source === 'completed' ? sinceLabel : pc.title }
        return pc
      })
    }
  }
  return doc
}

/** Overwrite only what the schedule owns; leave the author's words alone. */
export function refreshFromSchedule(doc, { facts, suggestion, previous }) {
  const fresh = autoKpis(facts).filter(k => !(doc.hiddenKpis || []).includes(k.id))
  const kept = doc.kpis.filter(k => !k.auto)
  return {
    ...doc,
    header: { ...doc.header, project: facts.project.name, date: fmtLong(facts.as_of) },
    kpis: [...fresh, ...kept].slice(0, LIMITS.kpis),
    columns: doc.columns.map(c => c.source === 'completed' ? { ...c, items: listFrom(facts.completed_recently) }
      : c.source === 'next' ? { ...c, items: listFrom(facts.due_next) } : c),
    headline: doc.headline || suggestion.headline,
    _previousAsOf: previous?.as_of,
  }
}

export function footerText(doc, report, facts) {
  if (doc.footer?.text) return doc.footer.text
  const parts = [`Schedule data as of ${fmtLong(facts?.as_of)}`]
  if (facts?.project?.committed_end) parts.push(`committed finish ${fmtDateOnly(facts.project.committed_end)}`)
  else parts.push('no committed finish date set')
  if (report.status_source === 'override') parts.push(`status set by the author: ${report.override_reason || 'no reason given'}`)
  else if (report.rule_fired) parts.push(`${STATUS[report.status]?.label} by rule: ${report.rule_fired}`)
  return parts.join(' · ')
}

/** Milestones to draw: the author's pick for this report, else every event flagged as one. */
export function chosenMilestones(doc, facts) {
  const all = facts?.events || []
  const ids = doc.timeline?.milestoneIds
  const picked = ids ? all.filter(e => ids.includes(e.id)) : all.filter(e => e.is_milestone)
  const now = new Date(facts.as_of)
  return picked.map(e => ({ ...e, date: e.end, state: e.percent_complete >= 100 ? 'done' : (new Date(e.end) < now ? 'late' : 'upcoming') }))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
}
